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
import { purgeKeys, realS3, waitForBucket } from '../support/real-s3';
import { searchTextOf } from '../../src/modules/catalog/text';
import { AppModule } from '../../src/app.module';
import { insertOrder } from '../support/order-fixture';
import { hashPassword } from '../../src/modules/auth/crypto';
import { AppLogger, Clock, ConfigService, EventsService, PrismaService, configureApp, loadConfigFromProcess, runWithCorrelation, type EventEnvelope } from '../../src/modules/platform';

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
  // Kho ảnh của USR: mặc định dịch vụ S3 giả trong tiến trình (client S3 thật của USR nói chuyện qua HTTP; KHÁC MinIO thật, xem fake-s3.ts; cổng riêng 3103 như cổng điều khiển).
  // Có STORAGE_TEST_ENDPOINT thì dùng MinIO THẬT của docker compose (trình duyệt tải ảnh thẳng từ MinIO, đọc công khai không chữ ký).
  const realCfg = realS3();
  const fake = new FakeS3();
  const real = realCfg ? await waitForBucket(realCfg) : null;
  if (!realCfg) await fake.start(s3Port);
  const s3 = realCfg && real
    ? { cfg: realCfg, seed: (key: string, body: Buffer) => real.put(key, body, { contentType: 'image/webp' }), keys: async (prefix = 'avatars/') => (await real.list(prefix)).map((o) => o.key).sort(), reset: () => purgeKeys(real, ['avatars/', 'products/']), urlOf: (key: string) => real.urlFor(key) }
    : { cfg: { endpoint: fake.url, bucket: fake.bucket, region: 'us-east-1', accessKey: fake.accessKey, secretKey: fake.secretKey }, seed: async (key: string, body: Buffer) => fake.seed(key, body, new Date()), keys: async (prefix = 'avatars/') => fake.keys(prefix), reset: async () => fake.reset(), urlOf: (key: string) => `${fake.url}/${fake.bucket}/${key}` };
  process.env.DATABASE_URL = dbUrl; // khởi tạo môi trường test trước khi nạp cấu hình
  process.env.APP_ENV = 'dev';
  Object.assign(process.env, { STORAGE_ENDPOINT: s3.cfg.endpoint, STORAGE_BUCKET: s3.cfg.bucket, STORAGE_REGION: s3.cfg.region, STORAGE_ACCESS_KEY: s3.cfg.accessKey, STORAGE_SECRET_KEY: s3.cfg.secretKey });
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
        await prisma.$executeRaw(Prisma.raw('TRUNCATE shipment_status_history, shipments, shipping_methods, order_status_history, order_items, orders, coupon_redemptions, coupons, stock_movements, stock_reservations, stock_items, product_review_ratings, product_images, products, categories, addresses, outbox_events, processed_events, idempotency_keys, rate_limit_counters, sessions, password_reset_tokens, email_verification_tokens, users CASCADE'));
        await prisma.$executeRaw`DELETE FROM audit_logs`;
        mails.length = 0; clock.offset = 0; await s3.reset();
        return send(200, { ok: true });
      }
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
          INSERT INTO shipments (order_id, shipping_method_id, status, tracking_number, cod_amount, shipped_at, delivered_at, version, created_at, updated_at)
          VALUES (${o.id}::uuid, ${methodId}::uuid, ${status}::shipment_status, ${tracking}, ${b.cod_amount ?? 0}, ${shippedAt}::timestamptz, ${deliveredAt}::timestamptz, ${b.version ?? 1}, ${createdAt}::timestamptz, ${at(steps.length - 1)}::timestamptz) RETURNING id`;
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
      // Đưa đồng hồ API tới đầu cửa sổ giới hạn tần suất kế tiếp (cộng 1 giây): 30 yêu cầu của bậc D nằm trọn một cửa sổ, không vỡ khi test chạy qua ranh giới phút
      if (url.pathname === '/align-window') {
        clock.offset += (60_000 - ((Date.now() + clock.offset) % 60_000)) % 60_000 + 1000;
        return send(200, { offset: clock.offset });
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
