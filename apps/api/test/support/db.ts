import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Prisma, PrismaClient } from '@prisma/client';

export const API_DIR = resolve(__dirname, '../..');
export const REPO_ROOT = resolve(API_DIR, '../..');
/** PostgreSQL thật của docker compose (cổng 5433), không dùng SQLite hay giả lập (BR10). */
export const DB_BASE = process.env.TEST_DB_BASE ?? 'postgresql://ecom:ecom@localhost:5433';
/** Mỗi lần chạy song song đặt ECOM_TEST_DB riêng (mặc định ecom_test): global-setup xóa và dựng lại CSDL này. */
export const TEST_DB = process.env.ECOM_TEST_DB ?? 'ecom_test';
export const testDbUrl = (db = TEST_DB) => `${DB_BASE}/${db}`;
/** URL của vai trò CSDL hạn chế (docker/initdb/01-app-roles.sql): ecom_app là tài khoản của ứng dụng, ecom_retention của job dọn audit. */
export const roleDbUrl = (role: 'ecom_app' | 'ecom_retention', db = TEST_DB) => {
  const u = new URL(testDbUrl(db));
  u.username = role; u.password = role;
  return u.toString();
};
export const ROLES_SQL = resolve(REPO_ROOT, 'docker/initdb/01-app-roles.sql');

export async function adminQuery(sql: string): Promise<void> {
  const c = new Client({ connectionString: `${DB_BASE}/postgres` });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

export const PRISMA_BIN = resolve(API_DIR, 'node_modules/.bin/prisma');
export function prismaCli(args: string[], env: Record<string, string>, cwd = API_DIR): { status: number; out: string } {
  try {
    const out = execFileSync(PRISMA_BIN, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
export const migrateDeploy = (url: string, cwd = API_DIR) => prismaCli(['migrate', 'deploy'], { DATABASE_URL: url }, cwd);

/** Tạo CSDL tạm sạch (rồi bỏ) cho test migration. */
export async function withTempDb<T>(fn: (url: string, name: string) => Promise<T>): Promise<T> {
  const name = `ecom_tmp_${randomBytes(4).toString('hex')}`;
  await adminQuery(`CREATE DATABASE ${name}`);
  try { return await fn(testDbUrl(name), name); } finally { await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
}

export function newPrisma(url = testDbUrl()): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log: [] });
}

const TABLES = ['review_images', 'reviews', 'email_deliveries', 'notifications', 'checkout_sessions', 'cart_items', 'carts', 'refunds', 'payment_attempts', 'payment_webhook_logs', 'payments', 'shipment_status_history', 'shipments', 'shipping_methods', 'order_status_history', 'order_items', 'orders', 'order_code_counters', 'coupon_redemptions', 'coupons', 'stock_movements', 'stock_reservations', 'stock_items', 'product_review_ratings', 'product_images', 'products', 'categories', 'addresses', 'outbox_events', 'processed_events', 'idempotency_keys', 'rate_limit_counters', 'sessions', 'password_reset_tokens', 'email_verification_tokens', 'users'];
/** Mỗi test bắt đầu từ CSDL sạch (BR11). */
export async function truncateAll(p: PrismaClient): Promise<void> {
  await p.$executeRaw(Prisma.raw(`TRUNCATE ${TABLES.join(', ')}`));
  await p.$executeRaw`DELETE FROM audit_logs`; // audit_logs chặn TRUNCATE (SB-32); dọn bằng DELETE cần phiên superuser hoặc app_retention
}

export function spawnNode(args: string[], env: Record<string, string | undefined>, cwd = API_DIR): ChildProcess {
  return spawn(process.execPath, args, { cwd, env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Bản bất đồng bộ: không chặn vòng lặp sự kiện của test (để chạy song song với tải ghi). */
export function migrateDeployAsync(url: string, cwd = API_DIR): Promise<{ status: number | null; out: string }> {
  return new Promise((res) => {
    const c = spawn(PRISMA_BIN, ['migrate', 'deploy'], { cwd, env: { ...process.env, DATABASE_URL: url } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('exit', (status) => res({ status, out }));
  });
}
