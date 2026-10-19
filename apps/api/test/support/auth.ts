import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  AppLogger, Clock, ConfigService, EventsService, OutboxRelay, PlatformModule, PrismaService, configureApp, type EventEnvelope,
} from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AuthApi } from '../../src/modules/auth/auth.api';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AuthCleanupService } from '../../src/modules/auth/cleanup.service';
import { hashPassword } from '../../src/modules/auth/crypto';
import { hashToken } from '../../src/modules/auth/crypto';
import { ProbeController, StubOrdController } from './probe';
import { FakeClock, LogCapture, ORIGIN, testConfig } from './app';

export const PASSWORD = 'Correct-Horse-9';
export interface Mail { type: string; user_id: string; token: string }
export interface AuthApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  clock: FakeClock;
  logs: LogCapture;
  config: ConfigService;
  auth: AuthService;
  api: AuthApi;
  cleanup: AuthCleanupService;
  relay: OutboxRelay;
  events: EventsService;
  /** Hộp thư giả: bắt hai event mang token thô (phát in-process, không qua outbox) thay NTF. */
  mails: Mail[];
  close: () => Promise<void>;
}

/** Ứng dụng thật (PlatformModule + AuthModule), PostgreSQL thật, đồng hồ giả; không thay SESSION_RESOLVER (dùng bộ giải phiên của AUTH). */
export async function createAuthApp(o: { env?: Record<string, string>; level?: string; controllers?: any[]; imports?: any[]; overrides?: { provide: any; useValue: unknown }[] } = {}): Promise<AuthApp> {
  const config = testConfig(o.env);
  const logs = new LogCapture();
  const logger = AppLogger.create({ level: o.level ?? 'info', env: 'dev', destination: logs });
  const clock = new FakeClock();
  let builder = Test.createTestingModule({ imports: o.imports ?? [PlatformModule, AuthModule], controllers: o.controllers ?? [ProbeController, StubOrdController] })
    .overrideProvider(ConfigService).useValue(config)
    .overrideProvider(AppLogger).useValue(logger)
    .overrideProvider(Clock).useValue(clock);
  for (const ov of o.overrides ?? []) builder = builder.overrideProvider(ov.provide).useValue(ov.useValue); // thay phụ thuộc ngoài (ví dụ cổng VNPay) bằng bộ giả lập
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { config, logger });
  await app.init();
  app.getHttpServer().setMaxListeners(0); // test gửi nhiều request song song vào cùng một máy chủ
  const events = app.get(EventsService);
  const mails: Mail[] = [];
  for (const type of ['EmailVerificationRequested', 'PasswordResetRequested']) {
    events.subscribe('test-mailbox', type, async (_tx, e: EventEnvelope) => { mails.push({ type, user_id: String(e.payload.user_id), token: String(e.payload.token_ref) }); });
  }
  return {
    app, prisma: app.get(PrismaService), clock, logs, config, auth: app.get(AuthService), api: app.get(AuthApi), cleanup: app.get(AuthCleanupService),
    relay: app.get(OutboxRelay), events, mails, close: () => app.close(),
  };
}

export const http = (t: AuthApp) => request(t.app.getHttpServer());
/** POST JSON từ Origin hợp lệ (mặc định), tùy chọn cookie phiên. */
export const post = (t: AuthApp, path: string, body?: unknown, o: { cookie?: string; origin?: string | null; ip?: string } = {}) => {
  let r = http(t).post(`/api/v1${path}`).set('Content-Type', 'application/json');
  if (o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  if (o.cookie) r = r.set('Cookie', o.cookie);
  if (o.ip) r = r.set('X-Forwarded-For', o.ip);
  return r.send(body === undefined ? undefined : JSON.stringify(body));
};
export const get = (t: AuthApp, path: string, cookie?: string) => {
  const r = http(t).get(`/api/v1${path}`);
  return cookie ? r.set('Cookie', cookie) : r;
};

const hashCache = new Map<string, Promise<string>>();
const hashOf = (t: AuthApp, pw: string) => {
  const key = `${t.config.get('ARGON2_MEMORY_KIB')}:${pw}`;
  if (!hashCache.has(key)) hashCache.set(key, hashPassword(pw, { memory: t.config.get('ARGON2_MEMORY_KIB'), passes: t.config.get('ARGON2_TIME_COST'), parallelism: t.config.get('ARGON2_PARALLELISM') }));
  return hashCache.get(key)!;
};

export interface SeedUser { id: string; email: string; password: string }
let counter = 0;
/** Dữ liệu mồi trực tiếp vào CSDL (fixture), không qua API. */
export async function seedUser(t: AuthApp, o: { email?: string; password?: string; role?: 'customer' | 'staff' | 'sale' | 'admin'; verified?: boolean; name?: string; createdAt?: Date; status?: 'active' | 'locked'; lockedReason?: 'admin' | 'too_many_attempts'; lockedUntil?: Date; hash?: string } = {}): Promise<SeedUser> {
  const email = (o.email ?? `user${++counter}@shop.vn`).toLowerCase();
  const password = o.password ?? PASSWORD;
  const hash = o.hash ?? (await hashOf(t, password));
  const created = o.createdAt ?? t.clock.now();
  const verifiedAt = o.verified === false ? null : t.clock.now();
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO users (email, password_hash, full_name, role, email_verified_at, status, locked_reason, locked_until, created_at, updated_at)
    VALUES (${email}::citext, ${hash}, ${o.name ?? 'Người Dùng'}, ${o.role ?? 'customer'}::user_role, ${verifiedAt}::timestamptz, ${o.status ?? 'active'}::user_status,
            ${o.lockedReason ?? null}::lock_reason, ${o.lockedUntil ?? null}::timestamptz, ${created}::timestamptz, ${created}::timestamptz) RETURNING id`;
  return { id: rows[0].id, email, password };
}

/** Đăng nhập qua API, trả giá trị header Cookie (`sid=...`). */
export async function login(t: AuthApp, u: { email: string; password: string }, cookie?: string): Promise<string> {
  const r = await post(t, '/auth/login', { email: u.email, password: u.password }, { cookie });
  if (r.status !== 200) throw new Error(`đăng nhập fixture thất bại: ${r.status} ${JSON.stringify(r.body)}`);
  return String(r.headers['set-cookie'][0]).split(';')[0];
}

/** Tạo phiên trực tiếp trong CSDL với mốc thời gian tùy ý (fixture); trả cookie. */
export async function seedSession(t: AuthApp, userId: string, o: { createdAt?: Date; lastSeenAt?: Date; expiresAt?: Date; absoluteExpiresAt?: Date; token?: string } = {}): Promise<{ cookie: string; token: string; id: string }> {
  const token = o.token ?? `${'s'.repeat(10)}${Math.random().toString(36).slice(2).padEnd(33, 'x')}`.slice(0, 43);
  const created = o.createdAt ?? t.clock.now();
  const last = o.lastSeenAt ?? created;
  const absolute = o.absoluteExpiresAt ?? new Date(created.getTime() + 7 * 24 * 3600_000);
  const idle = o.expiresAt ?? new Date(Math.min(last.getTime() + 30 * 60_000, absolute.getTime()));
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO sessions (user_id, token_hash, status, created_at, last_seen_at, expires_at, absolute_expires_at, updated_at)
    VALUES (${userId}::uuid, ${hashToken(token)}, 'active', ${created}::timestamptz, ${last}::timestamptz, ${idle}::timestamptz, ${absolute}::timestamptz, ${created}::timestamptz) RETURNING id`;
  return { cookie: `sid=${token}`, token, id: rows[0].id };
}

/** Truy vấn kiểm tra trong test (SQL cố định, không có đầu vào người dùng). */
export const q = <T = Record<string, any>>(t: AuthApp, sql: string): Promise<T[]> => t.prisma.$queryRaw<T[]>(Prisma.raw(sql));
export const outboxTypes = async (t: AuthApp): Promise<string[]> => (await q<{ type: string }>(t, 'SELECT type FROM outbox_events ORDER BY occurred_at, created_at, id')).map((r) => r.type);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mốc "bây giờ" của test AUTH: giờ thật lúc nạp module (làm tròn giây), không mốc ngày cố định, để đồng hồ giả và now() của CSDL không lệch nhau khi ngày trôi qua. */
export const NOW0 = new Date(Math.floor(Date.now() / 1000) * 1000);

/** Trung vị thời gian (ms) của hai nhánh, đo XEN KẼ từng cặp (A rồi B ở vòng chẵn, B rồi A ở vòng lẻ, lặp n lần) để tải máy trôi theo thời gian ảnh hưởng đều cả hai nhánh. */
export async function medianPairMs(n: number, a: (i: number) => Promise<unknown>, b: (i: number) => Promise<unknown>, after?: () => Promise<unknown>): Promise<[number, number]> {
  const xa: number[] = [], xb: number[] = [];
  const timed = async (fn: () => Promise<unknown>) => { const s0 = process.hrtime.bigint(); await fn(); const ms = Number(process.hrtime.bigint() - s0) / 1e6; if (after) await after(); return ms; };
  // đổi chỗ A và B ở các vòng lẻ: lời gọi ĐỨNG ĐẦU mỗi cặp chậm hơn lời gọi đứng sau (đo: 1,8 ms so với 1,1 ms lúc rảnh, 30 ms so với 3,6 ms lúc máy tải nặng) nên nếu A luôn đứng đầu thì A luôn "chậm hơn" và ca đỏ giả khi máy bận (REV-ORD-23)
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) { xa.push(await timed(() => a(i))); xb.push(await timed(() => b(i))); } else { xb.push(await timed(() => b(i))); xa.push(await timed(() => a(i))); }
  }
  const med = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  return [med(xa), med(xb)];
}

/** Token một lần dựng trực tiếp trong CSDL (fixture); trả token thô để gọi API. */
export async function seedToken(t: AuthApp, kind: 'verify' | 'reset', userId: string, o: { status?: 'issued' | 'used' | 'expired'; createdAt?: Date; expiresAt?: Date } = {}): Promise<string> {
  const token = `${kind}${Math.random().toString(36).slice(2)}${'T'.repeat(43)}`.slice(0, 43);
  const created = o.createdAt ?? t.clock.now();
  const ttl = kind === 'verify' ? 24 * 3600_000 : 30 * 60_000;
  const expires = o.expiresAt ?? new Date(created.getTime() + ttl);
  const status = o.status ?? 'issued';
  const used = status === 'used' ? created : null;
  const table = kind === 'verify' ? 'email_verification_tokens' : 'password_reset_tokens';
  await t.prisma.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(table)} (user_id, token_hash, status, expires_at, created_at, used_at, updated_at)
    VALUES (${userId}::uuid, ${hashToken(token)}, ${status}::token_status, ${expires}::timestamptz, ${created}::timestamptz, ${used}::timestamptz, ${created}::timestamptz)`);
  return token;
}
