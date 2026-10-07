// Lệnh tạo admin đầu tiên (SB-29, AUTH-DB mục Migration 3): email và mật khẩu một lần lấy từ biến môi trường, không có mật khẩu mặc định,
// không có đường đăng ký admin qua API. Chạy: `pnpm --filter @ecom/api auth:create-admin` với AUTH_ADMIN_EMAIL và AUTH_ADMIN_PASSWORD.
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './crypto';
import { emailField, passwordField } from './policy';

export type CreateAdminResult = { ok: true; id: string } | { ok: false; error: string };
export interface CreateAdminInput { databaseUrl: string; email?: string; password?: string; fullName?: string; argon: { memory: number; passes: number; parallelism: number } }

export async function createAdmin(i: CreateAdminInput): Promise<CreateAdminResult> {
  if (!i.email || !i.password) return { ok: false, error: 'thiếu AUTH_ADMIN_EMAIL hoặc AUTH_ADMIN_PASSWORD (không có mật khẩu mặc định)' };
  const email = emailField.safeParse(i.email);
  if (!email.success) return { ok: false, error: 'AUTH_ADMIN_EMAIL không đúng định dạng' };
  const pw = passwordField.safeParse(i.password);
  if (!pw.success) return { ok: false, error: `mật khẩu không đạt chính sách (${pw.error.issues.map((x) => x.message).join(', ')})` };
  const prisma = new PrismaClient({ datasourceUrl: i.databaseUrl, log: [] });
  try {
    const hash = await hashPassword(i.password, i.argon);
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO users (email, password_hash, full_name, role, email_verified_at, created_at, updated_at)
      VALUES (${email.data}::citext, ${hash}, ${i.fullName ?? 'Quản trị viên'}, 'admin', now(), now(), now())
      ON CONFLICT (email) DO NOTHING RETURNING id`;
    return rows.length ? { ok: true, id: rows[0].id } : { ok: false, error: 'email này đã có tài khoản; không đổi gì' };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  // eslint-disable-next-line no-restricted-syntax -- điểm vào CLI, đọc biến môi trường một lần như seed.ts
  const env = process.env;
  void createAdmin({
    databaseUrl: env.DATABASE_URL ?? '', email: env.AUTH_ADMIN_EMAIL, password: env.AUTH_ADMIN_PASSWORD, fullName: env.AUTH_ADMIN_NAME,
    argon: { memory: Number(env.ARGON2_MEMORY_KIB ?? 19456), passes: Number(env.ARGON2_TIME_COST ?? 2), parallelism: Number(env.ARGON2_PARALLELISM ?? 1) },
  }).then((r) => {
    process.stdout.write(r.ok ? `đã tạo admin ${r.id}\n` : `không tạo được admin: ${r.error}\n`);
    process.exit(r.ok ? 0 : 1);
  });
}
