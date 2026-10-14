// Máy chủ API cho E2E (Playwright, apps/web/e2e): ứng dụng THẬT (AppModule) trên PostgreSQL thật `ecom_e2e` (dựng lại từ migration mỗi lần chạy),
// cộng một cổng điều khiển CHỈ có ở môi trường test: dựng dữ liệu mồi, lấy "hộp thư giả" (thay NTF, chưa có code), tua đồng hồ (hết phiên 31 phút).
// Cổng điều khiển không nằm trong mã ứng dụng (src/) và chỉ lắng nghe 127.0.0.1.
import 'reflect-metadata';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import sharp from 'sharp';
import { FakeS3 } from '../support/fake-s3';
import { FakeSes } from '../support/fake-ses';
import { EmailService } from '../../src/modules/notification/email.service';
import { purgeKeys, realS3, waitForBucket } from '../support/real-s3';
import { searchTextOf } from '../../src/modules/catalog/text';
import { AppModule } from '../../src/app.module';
import { JobsService as InvJobs } from '../../src/modules/inventory/jobs.service';
import { VNPAY_GATEWAY, type QueryResult, type RefundInput, type RefundResult, type VnpayGateway } from '../../src/modules/payment/gateway';
import { RefundService } from '../../src/modules/payment/refund.service';
import { PaymentApi } from '../../src/modules/payment';
import { BlockCache } from '../../src/modules/dashboard/cache.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import { sign, verifySignature } from '../../src/modules/payment/vnpay';
import { insertOrder } from '../support/order-fixture';
import { currentPorts } from '../support/e2e-ports';
import { seedPayment, seedRefund, type SeedPayment } from '../support/pay';
import { hashPassword } from '../../src/modules/auth/crypto';
import { AppLogger, Clock, ConfigService, EventsService, OutboxRelay, PrismaService, TransactionService, configureApp, loadConfigFromProcess, runWithCorrelation, type EventEnvelope } from '../../src/modules/platform';

const ports = currentPorts(); // cơ sở từ E2E_PORT_BASE; support.ts truyền từng cổng rõ ràng qua E2E_*_PORT
const [apiPort, ctlPort, s3Port] = [Number(process.env.E2E_API_PORT ?? ports.api), Number(process.env.E2E_CTL_PORT ?? ports.ctl), Number(process.env.E2E_S3_PORT ?? ports.s3)];
const dbBase = process.env.TEST_DB_BASE ?? 'postgresql://ecom:ecom@localhost:5433';
const dbUrl = `${dbBase}/ecom_e2e`;

class OffsetClock extends Clock {
  offset = 0;
  now(): Date { return new Date(Date.now() + this.offset); }
}

/** Cổng VNPay giả của E2E: kết quả hoàn tiền do test điều khiển qua cổng điều khiển (`/gateway`); truy vấn giao dịch luôn là "không có giao dịch". CHƯA thử với sandbox thật. */
class E2eGateway implements VnpayGateway {
  refundMode: 'ok' | 'decline' = 'ok';
  refundCalls = 0;
  async queryTransaction(): Promise<QueryResult> { return { kind: 'not_found' }; }
  async refund(_i: RefundInput): Promise<RefundResult> { this.refundCalls++; return this.refundMode === 'ok' ? { kind: 'succeeded', code: '00' } : { kind: 'declined', code: '93' }; }
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
  // Kho ảnh của USR: mặc định dịch vụ S3 giả trong tiến trình (client S3 thật của USR nói chuyện qua HTTP; KHÁC MinIO thật, xem fake-s3.ts; cổng riêng 3103 như cổng điều khiển).
  // Có STORAGE_TEST_ENDPOINT thì dùng MinIO THẬT của docker compose (trình duyệt tải ảnh thẳng từ MinIO, đọc công khai không chữ ký).
  const realCfg = realS3();
  const fake = new FakeS3();
  const real = realCfg ? await waitForBucket(realCfg) : null;
  if (!realCfg) await fake.start(s3Port);
  const s3 = realCfg && real
    ? { cfg: realCfg, seed: (key: string, body: Buffer) => real.put(key, body, { contentType: 'image/webp' }), keys: async (prefix = 'avatars/') => (await real.list(prefix)).map((o) => o.key).sort(), reset: () => purgeKeys(real, ['avatars/', 'products/', 'reviews/']), urlOf: (key: string) => real.urlFor(key) }
    : { cfg: { endpoint: fake.url, bucket: fake.bucket, region: 'us-east-1', accessKey: fake.accessKey, secretKey: fake.secretKey }, seed: async (key: string, body: Buffer) => fake.seed(key, body, new Date()), keys: async (prefix = 'avatars/') => fake.keys(prefix), reset: async () => fake.reset(), urlOf: (key: string) => `${fake.url}/${fake.bucket}/${key}` };
  // NTF: SES giả trong tiến trình (client SES thật của NTF ký SigV4 và nói chuyện qua HTTP; KHÁC SES thật, xem fake-ses.ts); thư gửi ra xem được qua cổng điều khiển `/ses-mails`
  const ses = new FakeSes();
  await ses.start();
  Object.assign(process.env, { SES_ENDPOINT: ses.url, SES_REGION: ses.region, SES_ACCESS_KEY: ses.accessKey, SES_SECRET_KEY: ses.secretKey, MAIL_FROM: 'no-reply@shop.vn', APP_BASE_URL: process.env.E2E_APP_BASE_URL ?? `http://localhost:${ports.web}` });
  process.env.DATABASE_URL = dbUrl; // khởi tạo môi trường test trước khi nạp cấu hình
  process.env.APP_ENV = 'dev';
  Object.assign(process.env, { STORAGE_ENDPOINT: s3.cfg.endpoint, STORAGE_BUCKET: s3.cfg.bucket, STORAGE_REGION: s3.cfg.region, STORAGE_ACCESS_KEY: s3.cfg.accessKey, STORAGE_SECRET_KEY: s3.cfg.secretKey });
  const config: ConfigService = loadConfigFromProcess();
  const clock = new OffsetClock();
  const logger = AppLogger.create({ level: 'warn', env: 'dev' });
  const gateway = new E2eGateway();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Clock).useValue(clock).overrideProvider(VNPAY_GATEWAY).useValue(gateway).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { config, logger });
  await app.init();
  const prisma = app.get(PrismaService);
  let preModeration = true; // REVIEW_PRE_MODERATION lúc chạy (điều khiển qua /set-pre-moderation)
  const appConfig = app.get(ConfigService);
  const configGet = appConfig.get.bind(appConfig) as (n: string) => unknown;
  (appConfig as { get: (n: string) => unknown }).get = (n: string) => (n === 'REVIEW_PRE_MODERATION' ? preModeration : configGet(n));

  const mails: { type: string; user_id: string; token: string }[] = [];
  for (const type of ['EmailVerificationRequested', 'PasswordResetRequested']) {
    app.get(EventsService).subscribe('e2e-mailbox', type, async (_tx, e: EventEnvelope) => { mails.push({ type, user_id: String(e.payload.user_id), token: String(e.payload.token_ref) }); });
  }
  await app.listen(apiPort);

  // DSH: điều khiển nguồn PAY của dashboard (chỉ ở môi trường test): `hang` làm `getRevenue` không bao giờ trả lời (hạn nguồn của DSH quá hạn thì khối doanh thu trả 503), `ok` nhả các lời gọi đang treo và trả về hàm thật.
  const pay = app.get(PaymentApi);
  const realRevenue = pay.getRevenue.bind(pay);
  const held: ((e: Error) => void)[] = [];
  const dshFault = (mode: 'hang' | 'ok'): void => {
    if (mode === 'ok') { pay.getRevenue = realRevenue; for (const r of held.splice(0)) r(new Error('released')); return; }
    pay.getRevenue = (() => new Promise((_res, rej) => { held.push(rej); })) as typeof pay.getRevenue;
  };
  const params = { memory: config.get<number>('ARGON2_MEMORY_KIB'), passes: config.get<number>('ARGON2_TIME_COST'), parallelism: config.get<number>('ARGON2_PARALLELISM') };
  const body = (req: import('node:http').IncomingMessage) => new Promise<any>((res) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => res(s ? JSON.parse(s) : {})); });
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (url.pathname === '/health') return send(200, { ok: true });
      if (url.pathname === '/reset') {
        await prisma.$executeRaw(Prisma.raw('TRUNCATE review_images, reviews, email_deliveries, notifications, checkout_sessions, cart_items, carts, refunds, payment_attempts, payment_webhook_logs, payments, shipment_status_history, shipments, shipping_methods, order_status_history, order_items, orders, coupon_redemptions, coupons, stock_movements, stock_reservations, stock_items, product_review_ratings, product_images, products, categories, addresses, outbox_events, processed_events, idempotency_keys, rate_limit_counters, sessions, password_reset_tokens, email_verification_tokens, users CASCADE'));
        await prisma.$executeRaw`DELETE FROM audit_logs`;
        await app.get(RefundService).idle();
        preModeration = true; mails.length = 0; ses.reset(); clock.offset = 0; gateway.refundMode = 'ok'; gateway.refundCalls = 0; await s3.reset();
        dshFault('ok'); app.get(BlockCache).clear(); (app.get(DashboardService) as unknown as { marks: Map<string, number> }).marks.clear(); // DSH: bộ nhớ đệm, dấu audit và lỗi gài của lần trước
        return send(200, { ok: true });
      }
      if (url.pathname === '/dsh-fault') { const b = await body(req); dshFault(b.mode === 'hang' ? 'hang' : 'ok'); return send(200, { mode: b.mode === 'hang' ? 'hang' : 'ok', held: held.length }); }
      if (url.pathname === '/advance') { clock.offset += Number((await body(req)).ms); return send(200, { offset: clock.offset }); }
      if (url.pathname === '/seed-user') {
        const b = await body(req);
        const hash = await hashPassword(b.password ?? 'Correct-Horse-9', params);
        const now = clock.now();
        // `avatar: true`: đối tượng ảnh có thật trong kho (giả hoặc MinIO) và `avatar_url` trỏ tới nó (khách có ảnh cho màn tra cứu của admin)
        let avatarUrl: string | null = null;
        if (b.avatar) {
          const key = `avatars/${crypto.randomUUID()}.webp`;
          await s3.seed(key, await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3b82f6' } }).webp().toBuffer());
          avatarUrl = s3.urlOf(key);
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
        return send(200, { keys: await s3.keys(url.searchParams.get('prefix') ?? 'avatars/') });
      }
      // PRD: danh mục và sản phẩm dựng thẳng (fixture, không qua API): ảnh là ảnh thật trong kho để trình duyệt tải được
      if (url.pathname === '/seed-category') {
        const b = await body(req);
        const now = clock.now();
        const depth = b.parent_id ? (await prisma.$queryRaw<{ depth: number }[]>`SELECT depth FROM categories WHERE id = ${b.parent_id}::uuid`)[0].depth + 1 : 1;
        const slug = `${String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'c'}-${Math.random().toString(36).slice(2, 8)}`;
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO categories (name, slug, parent_id, depth, created_at, updated_at) VALUES (${b.name}, ${slug}, ${b.parent_id ?? null}::uuid, ${depth}, ${now}::timestamptz, ${now}::timestamptz) RETURNING id`;
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/seed-product') {
        const b = await body(req);
        const now = clock.now();
        const status = b.status ?? 'active';
        const sku = String(b.sku ?? `SP-${Math.random().toString(36).slice(2, 8)}`).toUpperCase();
        const published = status === 'draft' ? null : new Date(now.getTime() - Number(b.age_ms ?? 0));
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO products (category_id, name, sku, description, price, status, published_at, rating_count, rating_sum, search_text, created_at, updated_at)
          VALUES (${b.category_id}::uuid, ${b.name}, ${sku}, ${b.description ?? null}, ${b.price ?? 100000}, ${status}::product_status, ${published}::timestamptz, ${b.rating_count ?? 0}, ${b.rating_sum ?? 0},
                  ${searchTextOf(String(b.name), sku)}, ${now}::timestamptz, ${now}::timestamptz) RETURNING id`;
        for (let k = 1; k <= Number(b.images ?? 0); k++) {
          const key = `products/${crypto.randomUUID()}.webp`;
          await s3.seed(key, await sharp({ create: { width: 64, height: 48, channels: 3, background: k % 2 ? '#2563eb' : '#16a34a' } }).webp().toBuffer());
          await prisma.$executeRaw`INSERT INTO product_images (product_id, storage_key, content_type, width, height, bytes, position) VALUES (${rows[0].id}::uuid, ${key}, 'webp'::image_type, 64, 48, 100, ${k})`;
        }
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/product') {
        const [p] = await prisma.$queryRaw<unknown[]>`SELECT status, version, price::int AS price, name, sku, (SELECT count(*)::int FROM product_images i WHERE i.product_id = p.id) AS images FROM products p WHERE p.id = ${url.searchParams.get('id') ?? ''}::uuid`;
        return p ? send(200, p) : send(404, {});
      }
      // INV: bản ghi kho, lịch sử và cửa sổ giới hạn tần suất dựng thẳng (fixture, không qua API)
      if (url.pathname === '/seed-stock') {
        const b = await body(req);
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO stock_items (product_id, on_hand, reserved, low_stock_threshold, low_stock_notified, archived_at, version)
          VALUES (${b.product_id}::uuid, ${b.on_hand ?? 0}, ${b.reserved ?? 0}, ${b.threshold ?? 5}, ${b.notified ?? false}, ${b.archived ? clock.now() : null}::timestamptz, ${b.version ?? 1}) RETURNING id`;
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/stock') {
        const [r] = await prisma.$queryRaw<unknown[]>`SELECT on_hand, reserved, version, low_stock_threshold AS threshold FROM stock_items WHERE product_id = ${url.searchParams.get('product_id') ?? ''}::uuid`;
        return r ? send(200, r) : send(404, {});
      }
      if (url.pathname === '/seed-movement') {
        const b = await body(req);
        await prisma.$executeRaw`
          INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, reason, actor_id, actor_name, ref_type, ref_id, created_at)
          SELECT id, ${b.type}::movement_type, ${b.quantity}, ${b.on_hand_after}, ${b.reason ?? null}, ${b.human ? randomUUID() : null}::uuid, ${b.human ? 'Nguyễn Văn An' : null},
                 ${b.type === 'sale' ? 'order' : null}::movement_ref, ${b.type === 'sale' ? randomUUID() : null}::uuid, now() - make_interval(mins => ${Number(b.minutes_ago ?? 0)}::int)
          FROM stock_items WHERE product_id = ${b.product_id}::uuid`;
        return send(200, { ok: true });
      }
      // PRM: coupon dựng thẳng (fixture, không qua API); hạn tính từ giờ CSDL
      if (url.pathname === '/seed-coupon') {
        const b = await body(req);
        const type = b.type ?? 'percentage', status = b.status ?? 'active';
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO coupons (code, type, value, min_order_value, max_discount, expires_at, usage_limit, per_user_limit, consumed_count, reserved_count, status, version, deleted_at, created_by, created_at)
          VALUES (${String(b.code).toUpperCase()}, ${type}::coupon_type, ${b.value ?? 10}, ${b.min_order ?? 0}, ${type === 'percentage' ? (b.max_discount ?? null) : null}, now() + make_interval(secs => ${Number(b.expires_in_sec ?? 7 * 86400)}),
            ${b.usage_limit ?? 100}, ${b.per_user_limit ?? null}, ${b.consumed ?? 0}, ${b.reserved ?? 0}, ${status}::coupon_status, ${b.version ?? 1}, ${status === 'deleted' ? clock.now() : null}::timestamptz, ${randomUUID()}::uuid,
            now() - make_interval(secs => ${Number(b.age_sec ?? 0)})) RETURNING id`;
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/coupon') {
        const [r] = await prisma.$queryRaw<unknown[]>`SELECT id, code, status::text AS status, type::text AS type, value::int AS value, min_order_value::int AS min_order_value, max_discount::int AS max_discount, usage_limit, per_user_limit, consumed_count, reserved_count, version FROM coupons WHERE code = ${(url.searchParams.get('code') ?? '').toUpperCase()}`;
        return r ? send(200, r) : send(404, {});
      }
      // ORD: đơn dựng thẳng (fixture, không qua CHK) theo email chủ đơn; `created_at` ISO, hạn và thời điểm khác tính từ `created_at` nếu không nêu
      if (url.pathname === '/seed-order') {
        const b = await body(req);
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${String(b.email).toLowerCase()}::citext`;
        if (!u) return send(404, {});
        const d = (v: unknown) => (v === undefined || v === null ? v : new Date(String(v)));
        const o = await insertOrder(prisma, clock.now(), {
          user: u.id, code: b.code, status: b.status, method: b.method, payment: b.payment, createdAt: d(b.created_at) as Date | undefined, items: b.items, discount: b.discount, shipping: b.shipping,
          paidAt: d(b.paid_at) as Date | null | undefined, tracking: b.tracking, handoff: d(b.handoff) as Date | null | undefined, expiresAt: d(b.expires_at) as Date | null | undefined, deliveredAt: d(b.delivered_at) as Date | null | undefined, address: b.address, cancel: b.cancel,
        });
        return send(200, { id: o.id, code: o.code });
      }
      if (url.pathname === '/order') {
        const [r] = await prisma.$queryRaw<unknown[]>`SELECT id, status::text AS status, payment_status::text AS payment_status, tracking_number, (SELECT count(*)::int FROM order_status_history h WHERE h.order_id = o.id) AS history FROM orders o WHERE code = ${url.searchParams.get('code') ?? ''}`;
        return r ? send(200, r) : send(404, {});
      }
      // REV: đánh giá dựng thẳng (fixture, không qua API) của khách `email` cho sản phẩm `product_id`; tự dựng một đơn đã giao chứa sản phẩm nếu khách chưa có (giao `delivered_days_ago` ngày trước, mặc định 10).
      // `status`, `rating`, `comment`, `reason` (rejected, hidden), `age_ms` (tuổi của đánh giá), `edited` (đã sửa), `images` (số ảnh thật trong kho). Trả `id`.
      if (url.pathname === '/seed-review') {
        const b = await body(req);
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${String(b.email).toLowerCase()}::citext`;
        if (!u) return send(404, {});
        let [item] = await prisma.$queryRaw<{ id: string }[]>`
          SELECT i.id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.user_id = ${u.id}::uuid AND o.status = 'delivered' AND i.product_id = ${b.product_id}::uuid
            AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_item_id = i.id AND r.status <> 'deleted') LIMIT 1`;
        if (!item) {
          const o = await insertOrder(prisma, clock.now(), { user: u.id, status: 'delivered', items: [{ product: b.product_id, name: 'Hàng đã giao' }], deliveredAt: new Date(clock.now().getTime() - Number(b.delivered_days_ago ?? 10) * 86_400_000) });
          [item] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM order_items WHERE order_id = ${o.id}::uuid`;
        }
        const status: string = b.status ?? 'published';
        const created = new Date(clock.now().getTime() - Number(b.age_ms ?? 3_600_000));
        const published = status === 'published' || status === 'hidden' ? created : null;
        const reason = b.reason ?? (status === 'rejected' || status === 'hidden' ? 'Lý do kiểm duyệt' : null);
        const [r] = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO reviews (user_id, product_id, order_item_id, status, rating, comment, moderation_reason, published_at, edited_at, created_at, updated_at)
          VALUES (${u.id}::uuid, ${b.product_id}::uuid, ${item.id}::uuid, ${status}::review_status, ${b.rating ?? 5}, ${b.comment === undefined ? 'Rất tốt' : b.comment}, ${reason}, ${published}::timestamptz,
                  ${b.edited ? created : null}::timestamptz, ${created}::timestamptz, ${created}::timestamptz) RETURNING id`;
        for (let k = 1; k <= Number(b.images ?? 0); k++) {
          const key = `reviews/${randomUUID()}.webp`;
          await s3.seed(key, await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ec4899' } }).webp().toBuffer());
          await prisma.$executeRaw`INSERT INTO review_images (user_id, review_id, position, storage_key, width, height, bytes, created_at, updated_at) VALUES (${u.id}::uuid, ${r.id}::uuid, ${k}, ${key}, 64, 48, 100, ${created}::timestamptz, ${created}::timestamptz)`;
        }
        return send(200, { id: r.id });
      }
      // REV: trạng thái đánh giá theo mã, hoặc theo (email, product_id) khi chưa biết mã; kèm tên các event đã phát và điểm tổng hợp hiện tại của PRD.
      if (url.pathname === '/review-state') {
        const id = url.searchParams.get('id'), email = url.searchParams.get('email'), product = url.searchParams.get('product_id');
        const [r] = id
          ? await prisma.$queryRaw<{ id: string; status: string; rating: number; comment: string | null; edited_at: Date | null; moderation_reason: string | null }[]>`SELECT id, status::text AS status, rating::int AS rating, comment, edited_at, moderation_reason FROM reviews WHERE id = ${id}::uuid`
          : await prisma.$queryRaw<{ id: string; status: string; rating: number; comment: string | null; edited_at: Date | null; moderation_reason: string | null }[]>`
              SELECT r.id, r.status::text AS status, r.rating::int AS rating, r.comment, r.edited_at, r.moderation_reason FROM reviews r JOIN users u ON u.id = r.user_id
              WHERE u.email = ${String(email).toLowerCase()}::citext AND r.product_id = ${product}::uuid AND r.status <> 'deleted' ORDER BY r.created_at DESC LIMIT 1`;
        if (!r) return send(404, {});
        const ev = await prisma.$queryRaw<{ type: string }[]>`SELECT type FROM outbox_events WHERE aggregate_id = ${r.id} ORDER BY occurred_at, id`;
        const [p] = await prisma.$queryRaw<{ rating_count: number; rating_sum: number }[]>`SELECT p.rating_count, p.rating_sum FROM products p JOIN reviews x ON x.product_id = p.id WHERE x.id = ${r.id}::uuid`;
        const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM review_images WHERE review_id = ${r.id}::uuid`;
        return send(200, { ...r, events: ev.map((e) => e.type), images: n, prd: p });
      }
      // REV: bật hoặc tắt kiểm duyệt trước lúc chạy (chỉ ở máy chủ E2E; thật sự là biến môi trường khởi động lại, ADR-007): thay hàm đọc cấu hình của MỘT ConfigService đang dùng chung.
      if (url.pathname === '/set-pre-moderation') {
        const b = await body(req);
        preModeration = b.on !== false;
        return send(200, { on: preModeration });
      }
      // SHP: phương thức vận chuyển và vận đơn dựng thẳng (fixture, không qua API); vận đơn kèm lịch sử đúng đường đi tới `status`, mỗi dòng cách nhau một phút từ `created_at` (ISO, mặc định một giờ trước)
      if (url.pathname === '/seed-shipping-method') {
        const b = await body(req);
        const rule = { free_over: null, surcharge: 0, surcharge_cities: [] as string[], ...(b.rule ?? {}) };
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO shipping_methods (name, base_fee, rule, is_active, version, created_at, updated_at)
          VALUES (${b.name ?? 'Giao tiêu chuẩn'}, ${b.base_fee ?? 30000}, ${JSON.stringify(rule)}::jsonb, ${b.active ?? true}, ${b.version ?? 1},
                  ${new Date(clock.now().getTime() - Number(b.age_sec ?? 0) * 1000)}::timestamptz, ${clock.now()}::timestamptz) RETURNING id`;
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/seed-shipment') {
        const b = await body(req);
        const [o] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE code = ${String(b.order_code)}`;
        if (!o) return send(404, {});
        const status: string = b.status ?? 'pending';
        const path: Record<string, string[]> = { pending: ['pending'], shipped: ['pending', 'shipped'], delivered: ['pending', 'shipped', 'delivered'], failed: ['pending', 'shipped', 'failed'], returned: ['pending', 'shipped', 'failed', 'returned'], cancelled: ['pending', 'cancelled'] };
        const steps = path[status];
        if (!steps) return send(400, { error: 'status' });
        let methodId: string | undefined = b.method_id;
        if (!methodId) {
          const [m] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM shipping_methods ORDER BY created_at LIMIT 1`;
          methodId = m?.id ?? (await prisma.$queryRaw<{ id: string }[]>`INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('Giao tiêu chuẩn', 30000, '{"free_over":null,"surcharge":0,"surcharge_cities":[]}'::jsonb) RETURNING id`)[0].id;
        }
        const tracking: string | null = status === 'pending' || status === 'cancelled' ? null : String(b.tracking ?? `GHN${Math.floor(10_000_000 + Math.random() * 89_999_999)}`).toUpperCase();
        const createdAt = b.created_at ? new Date(String(b.created_at)) : new Date(clock.now().getTime() - 3600_000);
        const at = (i: number) => new Date(createdAt.getTime() + i * 60_000);
        const shippedAt = steps.includes('shipped') ? at(1) : null;
        const deliveredAt = status === 'delivered' ? at(2) : null;
        const [s] = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO shipments (order_id, order_code, shipping_method_id, status, tracking_number, cod_amount, shipped_at, delivered_at, version, created_at, updated_at)
          VALUES (${o.id}::uuid, ${String(b.order_code)}, ${methodId}::uuid, ${status}::shipment_status, ${tracking}, ${b.cod_amount ?? 0}, ${shippedAt}::timestamptz, ${deliveredAt}::timestamptz, ${b.version ?? 1}, ${createdAt}::timestamptz, ${at(steps.length - 1)}::timestamptz) RETURNING id`;
        for (const [i, st] of steps.entries()) {
          const failed = st === 'failed';
          await prisma.$executeRaw`
            INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number, reason_code, note, created_at)
            VALUES (${s.id}::uuid, 'status_changed'::shipment_history_event, ${st}::shipment_status, ${st === 'pending' || st === 'cancelled' ? null : tracking}, ${failed ? (b.reason_code ?? 'customer_unreachable') : null}::shipment_fail_reason, ${failed ? (b.note ?? null) : null}, ${at(i)}::timestamptz)`;
        }
        return send(200, { id: s.id, method_id: methodId, tracking_number: tracking });
      }
      if (url.pathname === '/shipment') {
        // vận đơn còn hiệu lực của đơn (không phải `cancelled`) được ưu tiên; `outbox` là loại event SHP của vận đơn đó theo thứ tự phát
        const [s] = await prisma.$queryRaw<unknown[]>`
          SELECT s.id, s.status::text AS status, s.tracking_number, s.cod_amount::int AS cod_amount, s.version, (SELECT count(*)::int FROM shipment_status_history h WHERE h.shipment_id = s.id) AS history,
                 COALESCE((SELECT array_agg(e.type ORDER BY e.created_at) FROM outbox_events e WHERE e.aggregate_id = s.id::text OR e.payload->>'shipment_id' = s.id::text), ARRAY[]::text[]) AS outbox
          FROM shipments s JOIN orders o ON o.id = s.order_id WHERE o.code = ${url.searchParams.get('order_code') ?? ''} ORDER BY (s.status = 'cancelled'::shipment_status), s.created_at DESC LIMIT 1`;
        return s ? send(200, s) : send(404, {});
      }
      // Hạ tầng test thay PAY, INV, SHP: giao một event cho mọi consumer của ORD như relay (ProcessedEvent cùng giao dịch); `order_code` được đổi thành `order_id`
      if (url.pathname === '/event') {
        const b = await body(req);
        const [o] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE code = ${String(b.order_code)}`;
        if (!o) return send(404, {});
        const events = app.get(EventsService);
        const env: EventEnvelope = { event_id: randomUUID(), type: b.type, aggregate_type: 'x', aggregate_id: o.id, payload: { ...(b.payload ?? {}), order_id: o.id }, occurred_at: clock.now().toISOString(), correlation_id: 'e2e-event' };
        await runWithCorrelation(env.correlation_id, async () => { for (const sub of events.consumersFor(b.type)) await events.deliver(sub, env); });
        return send(200, { ok: true });
      }
      // PAY: Payment dựng thẳng (fixture, không qua event) theo email chủ đơn và mã đơn; đơn tự dựng khớp trạng thái nếu `order_code` chưa có. `attempts: 'auto'` dựng lượt thử theo `attempt_no` và trạng thái
      if (url.pathname === '/seed-payment') {
        const b = await body(req);
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${String(b.email).toLowerCase()}::citext`;
        if (!u) return send(404, {});
        const d = (v: unknown) => (v === undefined || v === null ? v : new Date(String(v)));
        const [existing] = b.order_code ? await prisma.$queryRaw<{ id: string; code: string }[]>`SELECT id, code FROM orders WHERE code = ${String(b.order_code)}` : [];
        const shim = { prisma, clock } as unknown as Parameters<typeof seedPayment>[0];
        const o: SeedPayment = {
          user: u.id, method: b.method, amount: b.amount, status: b.status, attemptNo: b.attempt_no, expiresAt: d(b.expires_at) as Date | null | undefined, paidAt: d(b.paid_at) as Date | null | undefined,
          createdAt: d(b.created_at) as Date | undefined, orderStatus: b.order_status, orderCode: b.order_code, attempts: b.attempts, providerRef: b.provider_ref,
          ...(existing ? { order: { id: existing.id, code: existing.code, user: u.id } } : {}),
        };
        const p = await seedPayment(shim, o);
        return send(200, { id: p.id, order_id: p.order.id, order_code: p.order.code, attempts: p.attempts.map((a) => ({ txn_ref: a.txnRef, no: a.no })) });
      }
      if (url.pathname === '/seed-refund') {
        const b = await body(req);
        const [a] = await prisma.$queryRaw<{ id: string; payment_id: string }[]>`SELECT a.id, a.payment_id FROM payment_attempts a JOIN payments p ON p.id = a.payment_id WHERE p.order_code = ${String(b.order_code)} AND a.status = 'succeeded'::attempt_status ORDER BY a.attempt_no LIMIT 1`;
        if (!a) return send(404, {});
        const shim = { prisma, clock } as unknown as Parameters<typeof seedRefund>[0];
        return send(200, { id: await seedRefund(shim, { paymentId: a.payment_id, attemptId: a.id, status: b.status, reason: b.reason, autoAttemptNo: b.auto_attempt_no, createdAt: b.created_at ? new Date(String(b.created_at)) : undefined }) });
      }
      if (url.pathname === '/payment') {
        const [p] = await prisma.$queryRaw<{ id: string; status: string; attempt_no: number; method: string; provider_ref: string | null }[]>`SELECT id, status::text AS status, attempt_no, method::text AS method, provider_ref FROM payments WHERE order_code = ${url.searchParams.get('order_code') ?? ''}`;
        if (!p) return send(404, {});
        const attempts = await prisma.$queryRaw<unknown[]>`SELECT attempt_no, txn_ref, status::text AS status, reason::text AS reason FROM payment_attempts WHERE payment_id = ${p.id}::uuid ORDER BY attempt_no`;
        const refunds = await prisma.$queryRaw<unknown[]>`SELECT id, status::text AS status, reason::text AS reason, amount::int AS amount, auto_attempt_no FROM refunds WHERE payment_id = ${p.id}::uuid ORDER BY created_at, id`;
        const events = await prisma.$queryRaw<{ type: string }[]>`SELECT type FROM outbox_events WHERE payload->>'payment_id' = ${p.id} ORDER BY occurred_at, id`;
        return send(200, { ...p, attempts, refunds, events: events.map((e) => e.type) });
      }
      // Điều khiển cổng giả: kết quả hoàn tiền (ok | decline) và số lệnh hoàn đã nhận
      if (url.pathname === '/gateway') {
        const b = await body(req);
        if (b.refund) gateway.refundMode = b.refund === 'decline' ? 'decline' : 'ok';
        return send(200, { refund: gateway.refundMode, refund_calls: gateway.refundCalls });
      }
      // Hạ tầng test thay relay: giao mọi event đang chờ (PAY phát, ORD nhận và phát tiếp, PAY nhận lại...), rồi chờ các cuộc gọi hoàn tiền đang chạy xong
      if (url.pathname === '/relay') {
        const relay = app.get(OutboxRelay);
        for (let i = 0; i < 12; i++) { if ((await relay.runOnce(new Date(Date.now() + 3_600_000))).picked === 0) break; }
        await app.get(RefundService).idle();
        return send(200, { ok: true });
      }
      // Cổng thanh toán giả (tự dựng theo tài liệu VNPay; CHƯA thử với sandbox thật): kiểm chữ ký đường dẫn như VNPay, hiện ba nút; mỗi nút gửi IPN ĐÃ KÝ tới API rồi đưa trình duyệt về địa chỉ quay về kèm `vnp_*`
      if (url.pathname === '/vnpay/pay') {
        const params = Object.fromEntries(url.searchParams.entries());
        const valid = verifySignature(params, params.vnp_SecureHash, process.env.VNPAY_HASH_SECRET ?? '');
        const href = (result: string) => `/vnpay/act?result=${result}&${url.searchParams.toString()}`;
        res.writeHead(valid ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        return void res.end(valid
          ? `<!doctype html><meta charset="utf-8"><title>Cổng VNPay giả</title><h1 id="gate-title">Cổng VNPay giả</h1><p id="gate-amount">${Number(params.vnp_Amount) / 100}</p><p id="gate-ref">${params.vnp_TxnRef}</p>
             <a id="gate-ok" href="${href('ok')}">Thanh toán thành công</a> <a id="gate-cancel" href="${href('cancel')}">Hủy giao dịch</a> <a id="gate-decline" href="${href('decline')}">Ngân hàng từ chối</a>`
          : '<!doctype html><meta charset="utf-8"><h1 id="gate-invalid">Chữ ký không hợp lệ</h1>');
      }
      if (url.pathname === '/vnpay/act') {
        const params = Object.fromEntries(url.searchParams.entries());
        const secret = process.env.VNPAY_HASH_SECRET ?? '';
        const { result, ...pay } = params;
        if (!verifySignature(pay, pay.vnp_SecureHash, secret)) { res.writeHead(400); return void res.end('invalid'); }
        const code = result === 'ok' ? '00' : result === 'cancel' ? '24' : '51';
        const ipn: Record<string, string> = {
          vnp_TmnCode: pay.vnp_TmnCode, vnp_Amount: pay.vnp_Amount, vnp_BankCode: 'NCB', vnp_OrderInfo: pay.vnp_OrderInfo, vnp_PayDate: pay.vnp_CreateDate,
          vnp_ResponseCode: code, vnp_TransactionStatus: code === '00' ? '00' : '02', vnp_TxnRef: pay.vnp_TxnRef, vnp_TransactionNo: String(14_000_000 + Math.floor(Math.random() * 999_999)),
        };
        const signed = new URLSearchParams({ ...ipn, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: sign(ipn, secret) });
        await fetch(`http://127.0.0.1:${apiPort}/api/v1/webhooks/vnpay/ipn?${signed.toString()}`);
        const back = new URL(pay.vnp_ReturnUrl);
        for (const k of ['vnp_Amount', 'vnp_TxnRef', 'vnp_ResponseCode']) back.searchParams.set(k, k === 'vnp_ResponseCode' ? code : ipn[k]);
        res.writeHead(302, { Location: back.toString() });
        return void res.end();
      }
      // Đưa đồng hồ API tới đầu cửa sổ giới hạn tần suất kế tiếp (cộng 1 giây): 30 yêu cầu của bậc D nằm trọn một cửa sổ, không vỡ khi test chạy qua ranh giới phút
      // `seconds`: độ dài cửa sổ cố định cần căn (mặc định 60; bộ đếm thử sai mã của PRM dùng cửa sổ 600 giây)
      if (url.pathname === '/align-window') {
        const ms = Number((await body(req)).seconds ?? 60) * 1000;
        clock.offset += (ms - ((Date.now() + clock.offset) % ms)) % ms + 1000;
        return send(200, { offset: clock.offset });
      }
      // CRT: giỏ dựng thẳng (fixture, không qua API) theo email chủ giỏ; dòng cách nhau 1 mili giây theo thứ tự; `price` là giá ĐÃ LƯU lúc thêm (mặc định bằng giá hiện hành)
      if (url.pathname === '/seed-cart') {
        const b = await body(req);
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${String(b.email).toLowerCase()}::citext`;
        if (!u) return send(404, {});
        const [c] = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO carts (user_id, coupon_code, shipping_method_id, shipping_city, last_activity_at) VALUES (${u.id}::uuid, ${b.coupon ?? null}, ${b.method_id ?? null}::uuid, ${b.city ?? null}, now()) RETURNING id`;
        let k = 0;
        for (const l of b.lines ?? []) {
          await prisma.$executeRaw`
            INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unavailable_reason, created_at)
            SELECT ${c.id}::uuid, p.id, ${l.quantity ?? 1}, COALESCE(${l.price ?? null}::bigint, p.price), ${l.reason ?? null}, now() + make_interval(secs => ${++k / 1000.0}) FROM products p WHERE p.id = ${l.product_id}::uuid`;
        }
        return send(200, { id: c.id });
      }
      if (url.pathname === '/cart') {
        const [c] = await prisma.$queryRaw<{ id: string }[]>`SELECT c.id FROM carts c JOIN users u ON u.id = c.user_id WHERE u.email = ${(url.searchParams.get('email') ?? '').toLowerCase()}::citext AND c.status = 'active'`;
        if (!c) return send(404, {});
        const [h] = await prisma.$queryRaw<unknown[]>`SELECT status::text AS status, coupon_code, shipping_method_id, shipping_city, version FROM carts WHERE id = ${c.id}::uuid`;
        const items = await prisma.$queryRaw<unknown[]>`SELECT product_id, quantity, unit_price::int AS unit_price, unavailable_reason FROM cart_items WHERE cart_id = ${c.id}::uuid ORDER BY created_at, id`;
        return send(200, { ...(h as object), items });
      }
      if (url.pathname === '/cart-count') {
        const [r] = await prisma.$queryRaw<unknown[]>`SELECT count(*)::int AS carts, (SELECT count(*)::int FROM cart_items) AS items FROM carts`;
        return send(200, r);
      }
      // PRD: đổi trạng thái hay giá của sản phẩm sau khi đã vào giỏ (admin ngừng bán, đổi giá); `event: true` giao thêm ProductArchived cho consumer của CRT như relay
      if (url.pathname === '/product-set') {
        const b = await body(req);
        if (b.status) await prisma.$executeRaw`UPDATE products SET status = ${b.status}::product_status, updated_at = now() WHERE id = ${b.id}::uuid`;
        if (b.price !== undefined) await prisma.$executeRaw`UPDATE products SET price = ${b.price}, updated_at = now() WHERE id = ${b.id}::uuid`;
        if (b.event) {
          const events = app.get(EventsService);
          const env: EventEnvelope = { event_id: randomUUID(), type: 'ProductArchived', aggregate_type: 'product', aggregate_id: b.id, payload: { product_id: b.id }, occurred_at: clock.now().toISOString(), correlation_id: 'e2e-event' };
          await runWithCorrelation(env.correlation_id, async () => { for (const sub of events.consumersFor('ProductArchived')) await events.deliver(sub, env); });
        }
        return send(200, { ok: true });
      }
      if (url.pathname === '/set-shipping-method') {
        const b = await body(req);
        await prisma.$executeRaw`UPDATE shipping_methods SET is_active = ${b.active}, updated_at = now() WHERE id = ${b.id}::uuid`;
        return send(200, { ok: true });
      }
      if (url.pathname === '/set-coupon') {
        const b = await body(req);
        await prisma.$executeRaw`UPDATE coupons SET status = ${b.status}::coupon_status WHERE code = ${String(b.code).toUpperCase()}`;
        return send(200, { ok: true });
      }
      // CHK: phiên checkout của khách (đọc trạng thái để kiểm không có đơn nào được tạo) và lùi hạn phiên về quá khứ theo GIỜ CSDL (đồng hồ ứng dụng `advance` không đổi `expires_at`, hạn tính bằng clock_timestamp() của CSDL)
      if (url.pathname === '/chk-session') {
        const rows = await prisma.$queryRaw<unknown[]>`
          SELECT s.id, s.status::text AS status, s.address_id, s.shipping_method_id, s.payment_method::text AS payment_method, s.coupon_code, s.order_id, s.expires_at,
                 (s.expires_at - clock_timestamp() > make_interval(mins => 29)) AS fresh, o.code AS order_code
          FROM checkout_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN orders o ON o.id = s.order_id
          WHERE u.email = ${(url.searchParams.get('email') ?? '').toLowerCase()}::citext ORDER BY s.created_at DESC, s.id`;
        return send(200, { sessions: rows });
      }
      if (url.pathname === '/chk-expire') {
        const b = await body(req);
        const n = await prisma.$executeRaw`
          UPDATE checkout_sessions SET expires_at = clock_timestamp() - make_interval(mins => ${Number(b.minutes ?? 1)}::int)
          WHERE status = 'open'::checkout_status AND user_id = (SELECT id FROM users WHERE email = ${String(b.email).toLowerCase()}::citext)`;
        return send(200, { updated: n });
      }
      // INV: đổi tồn dựng thẳng (khách khác đã mua) và đọc các dòng giữ hàng của đơn
      if (url.pathname === '/stock-set') {
        const b = await body(req);
        await prisma.$executeRaw`UPDATE stock_items SET on_hand = COALESCE(${b.on_hand ?? null}::int, on_hand), reserved = COALESCE(${b.reserved ?? null}::int, reserved), updated_at = now() WHERE product_id = ${b.product_id}::uuid`;
        return send(200, { ok: true });
      }
      if (url.pathname === '/reservations') {
        const rows = await prisma.$queryRaw<unknown[]>`
          SELECT r.status::text AS status, r.quantity, r.expires_at, s.product_id FROM stock_reservations r JOIN stock_items s ON s.id = r.stock_item_id JOIN orders o ON o.id = r.order_id
          WHERE o.code = ${url.searchParams.get('order_code') ?? ''} ORDER BY s.product_id`;
        return send(200, { items: rows });
      }
      // INV: job hết hạn giữ hàng với mốc giờ CSDL ở tương lai (`ms` sau bây giờ), rồi giao event cho ORD như relay (đơn VNPay quá hạn thành `expired`)
      if (url.pathname === '/inv-expire') {
        const b = await body(req);
        const r = await app.get(InvJobs).expireOnce({ now: new Date(Date.now() + Number(b.ms ?? 16 * 60_000)) });
        const relay = app.get(OutboxRelay);
        for (let i = 0; i < 12; i++) { if ((await relay.runOnce(new Date(Date.now() + 3_600_000))).picked === 0) break; }
        return send(200, r);
      }
      if (url.pathname === '/mail') {
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${url.searchParams.get('email') ?? ''}::citext`;
        const m = u && [...mails].reverse().find((x) => x.user_id === u.id && x.type === url.searchParams.get('type'));
        return m ? send(200, { token: m.token }) : send(404, {});
      }
      // NTF: thông báo dựng thẳng (fixture), trạng thái, phát event qua outbox + relay, thư đã gửi tới SES giả, chạy job gửi email
      if (url.pathname === '/seed-notification') {
        const b = await body(req);
        const [u] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE email = ${String(b.email).toLowerCase()}::citext`;
        if (!u) return send(404, {});
        const at = new Date(Date.now() - Number(b.age_ms ?? 0));
        const status = b.status === 'read' ? 'read' : 'unread';
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO notifications (user_id, type, title, body, link, data, status, read_at, event_id, dedupe_key, created_at, updated_at)
          VALUES (${u.id}::uuid, ${b.type ?? 'order_created'}::notification_type, ${b.title ?? 'Tiêu đề'}, ${b.body ?? 'Nội dung'}, ${b.link === undefined ? '/orders' : b.link}, ${JSON.stringify(b.data ?? {})}::jsonb,
                  ${status}::notification_status, ${status === 'read' ? at : null}::timestamptz, ${randomUUID()}::uuid, ${`e2e:${randomUUID()}`}, ${at}::timestamptz, ${at}::timestamptz) RETURNING id`;
        return send(200, { id: rows[0].id });
      }
      if (url.pathname === '/notifications') {
        const rows = await prisma.$queryRaw<{ type: string; status: string; title: string; body: string; link: string | null; read_at: Date | null }[]>`
          SELECT n.type::text AS type, n.status::text AS status, n.title, n.body, n.link, n.read_at FROM notifications n JOIN users u ON u.id = n.user_id
          WHERE u.email = ${(url.searchParams.get('email') ?? '').toLowerCase()}::citext ORDER BY n.created_at DESC, n.id DESC`;
        return send(200, { items: rows });
      }
      if (url.pathname === '/publish') { // phát một event lên outbox rồi chạy relay tới hết (NTF nhận như event thật của module khác)
        const b = await body(req);
        const events = app.get(EventsService);
        await app.get(TransactionService).run((tx) => events.publish(tx, { type: b.type, aggregate_type: 'e2e', aggregate_id: String(b.payload?.order_id ?? randomUUID()), payload: b.payload ?? {} }));
        const relay = app.get(OutboxRelay);
        for (let i = 0; i < 12; i++) { if ((await relay.runOnce(new Date(Date.now() + 3_600_000))).picked === 0) break; }
        return send(200, { ok: true });
      }
      if (url.pathname === '/ses-mode') { const b = await body(req); ses.fallback = b.status && b.status !== 200 ? { status: Number(b.status), type: b.type } : { status: 200 }; return send(200, { fallback: ses.fallback }); } // review NTF: giả lập SES lỗi (5xx, 429) hay hồi phục
      if (url.pathname === '/ses-mails') return send(200, { items: ses.mails });
      if (url.pathname === '/run-email-job') return send(200, await app.get(EmailService).sendDue({ now: new Date(Date.now() + 3_600_000) }));
      return send(404, {});
    } catch (e) {
      return send(500, { error: (e as Error).message });
    }
  }).listen(ctlPort, '127.0.0.1');
  process.stdout.write(`E2E_READY api=${apiPort} ctl=${ctlPort}\n`);
}
void main();
