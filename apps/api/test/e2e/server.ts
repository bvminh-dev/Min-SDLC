// Máy chủ API cho E2E (Playwright, apps/web/e2e): ứng dụng THẬT (AppModule) trên PostgreSQL thật `ecom_e2e` (dựng lại từ migration mỗi lần chạy),
// cộng một cổng điều khiển CHỈ có ở môi trường test: dựng dữ liệu mồi, lấy "hộp thư giả" (thay NTF, chưa có code), tua đồng hồ (hết phiên 31 phút).
// Cổng điều khiển không nằm trong mã ứng dụng (src/) và chỉ lắng nghe 127.0.0.1.
import 'reflect-metadata';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import sharp from 'sharp';
import { FakeS3 } from '../support/fake-s3';
import { AppModule } from '../../src/app.module';
import { hashPassword } from '../../src/modules/auth/crypto';
import { AppLogger, Clock, ConfigService, EventsService, PrismaService, configureApp, loadConfigFromProcess, type EventEnvelope } from '../../src/modules/platform';

const [apiPort, ctlPort, s3Port] = [Number(process.env.E2E_API_PORT ?? 3101), Number(process.env.E2E_CTL_PORT ?? 3102), Number(process.env.E2E_S3_PORT ?? 3103)];
const dbBase = process.env.TEST_DB_BASE ?? 'postgresql://ecom:ecom@localhost:5433';
const dbUrl = `${dbBase}/ecom_e2e`;

class OffsetClock extends Clock {
  offset = 0;
  now(): Date { return new Date(Date.now() + this.offset); }
}

async function prepareDb(): Promise<void> {
  const c = new Client({ connectionString: `${dbBase}/postgres` });
  await c.connect();
  try {
    await c.query('DROP DATABASE IF EXISTS ecom_e2e WITH (FORCE)');
    await c.query('CREATE DATABASE ecom_e2e');
  } finally { await c.end(); }
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });
}

async function main() {
  await prepareDb();
  // Kho ảnh của USR: dịch vụ S3 giả trong tiến trình (client S3 thật của USR nói chuyện qua HTTP; KHÁC MinIO thật, xem fake-s3.ts); cổng riêng 3103 như cổng điều khiển
  const s3 = new FakeS3();
  await s3.start(s3Port);
  process.env.DATABASE_URL = dbUrl; // khởi tạo môi trường test trước khi nạp cấu hình
  process.env.APP_ENV = 'dev';
  Object.assign(process.env, { STORAGE_ENDPOINT: s3.url, STORAGE_BUCKET: s3.bucket, STORAGE_ACCESS_KEY: s3.accessKey, STORAGE_SECRET_KEY: s3.secretKey });
  const config: ConfigService = loadConfigFromProcess();
  const clock = new OffsetClock();
  const logger = AppLogger.create({ level: 'warn', env: 'dev' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Clock).useValue(clock).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { config, logger });
  await app.init();
  const prisma = app.get(PrismaService);

  const mails: { type: string; user_id: string; token: string }[] = [];
  for (const type of ['EmailVerificationRequested', 'PasswordResetRequested']) {
    app.get(EventsService).subscribe('e2e-mailbox', type, async (_tx, e: EventEnvelope) => { mails.push({ type, user_id: String(e.payload.user_id), token: String(e.payload.token_ref) }); });
  }
  await app.listen(apiPort);

  const params = { memory: config.get<number>('ARGON2_MEMORY_KIB'), passes: config.get<number>('ARGON2_TIME_COST'), parallelism: config.get<number>('ARGON2_PARALLELISM') };
  const body = (req: import('node:http').IncomingMessage) => new Promise<any>((res) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => res(s ? JSON.parse(s) : {})); });
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (url.pathname === '/health') return send(200, { ok: true });
      if (url.pathname === '/reset') {
        await prisma.$executeRaw(Prisma.raw('TRUNCATE addresses, outbox_events, processed_events, idempotency_keys, rate_limit_counters, sessions, password_reset_tokens, email_verification_tokens, users CASCADE'));
        await prisma.$executeRaw`DELETE FROM audit_logs`;
        mails.length = 0; clock.offset = 0; s3.reset();
        return send(200, { ok: true });
      }
      if (url.pathname === '/advance') { clock.offset += Number((await body(req)).ms); return send(200, { offset: clock.offset }); }
      if (url.pathname === '/seed-user') {
        const b = await body(req);
        const hash = await hashPassword(b.password ?? 'Correct-Horse-9', params);
        const now = clock.now();
        // `avatar: true`: đối tượng ảnh có thật trong kho giả và `avatar_url` trỏ tới nó (khách có ảnh cho màn tra cứu của admin)
        let avatarUrl: string | null = null;
        if (b.avatar) {
          const key = `avatars/${crypto.randomUUID()}.webp`;
          s3.seed(key, await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3b82f6' } }).webp().toBuffer(), now);
          avatarUrl = `${s3.url}/${s3.bucket}/${key}`;
        }
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO users (email, password_hash, full_name, role, email_verified_at, phone, avatar_url, created_at, updated_at)
          VALUES (${String(b.email).toLowerCase()}::citext, ${hash}, ${b.name ?? 'Người Dùng'}, ${b.role ?? 'customer'}::user_role,
                  ${b.verified === false ? null : now}::timestamptz, ${b.phone ?? null}, ${avatarUrl}, ${new Date(b.createdAt ?? now)}::timestamptz, ${now}::timestamptz) RETURNING id`;
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/seed-address') {
        const b = await body(req);
        const now = clock.now();
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (user_id, receiver, phone, line1, ward, district, city, is_default, created_at, updated_at)
          SELECT id, ${b.receiver ?? 'Người nhận'}, ${b.phone ?? '0901234567'}, ${b.line1 ?? '1 Lê Lợi'}, ${b.ward ?? 'Bến Nghé'}, ${b.district ?? 'Quận 1'},
                 ${b.city ?? 'TP. Hồ Chí Minh'}, ${b.is_default ?? false}, ${new Date(now.getTime() - Number(b.age_ms ?? 0))}::timestamptz, ${new Date(now.getTime() - Number(b.age_ms ?? 0))}::timestamptz
          FROM users WHERE email = ${String(b.email).toLowerCase()}::citext RETURNING id`;
        return rows[0] ? send(200, { id: rows[0].id }) : send(404, {});
      }
      if (url.pathname === '/s3-objects') {
        return send(200, { keys: s3.keys('avatars/') });
      }
      if (url.pathname === '/mail') {
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${url.searchParams.get('email') ?? ''}::citext`;
        const m = u && [...mails].reverse().find((x) => x.user_id === u.id && x.type === url.searchParams.get('type'));
        return m ? send(200, { token: m.token }) : send(404, {});
      }
      return send(404, {});
    } catch (e) {
      return send(500, { error: (e as Error).message });
    }
  }).listen(ctlPort, '127.0.0.1');
  process.stdout.write(`E2E_READY api=${apiPort} ctl=${ctlPort}\n`);
}
void main();
