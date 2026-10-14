import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { CartApi } from '../../src/modules/cart';
import { DepsService as CartDeps } from '../../src/modules/cart/deps.service';
import { JobsService as CartJobs } from '../../src/modules/cart/jobs.service';
import { LifecycleService as CartLife } from '../../src/modules/cart/lifecycle.service';
import { ReadService as CartRead } from '../../src/modules/cart/read.service';
import { WriteService as CartWrite } from '../../src/modules/cart/write.service';
import { CatalogApi } from '../../src/modules/catalog';
import { DepsService } from '../../src/modules/checkout/deps.service';
import { JobsService } from '../../src/modules/checkout/jobs.service';
import { PlaceService } from '../../src/modules/checkout/place.service';
import { SessionService } from '../../src/modules/checkout/session.service';
import { InventoryApi } from '../../src/modules/inventory';
import { JobsService as InvJobs } from '../../src/modules/inventory/jobs.service';
import { OrderApi } from '../../src/modules/order';
import { VNPAY_GATEWAY } from '../../src/modules/payment/gateway';
import { PromotionApi } from '../../src/modules/promotion';
import { JobRunner, TransactionService } from '../../src/modules/platform';
import { ShippingApi } from '../../src/modules/shipping';
import { FakeS3 } from './fake-s3';
import { createAuthApp, q, type AuthApp } from './auth';
import { truncateAll } from './db';
import { seedCoupon } from './prm';
import { FakeGateway, PAY_ENV } from './pay';
import { call, who, type Who } from './prd';
import { race, sleep } from './ord';
import { product, seedCart, stock, type CrtApp } from './crt';
import { seedAddress } from './usr';
import { seedMethod } from './shp';

export interface ChkApp extends AuthApp {
  fake: FakeS3; gw: FakeGateway; chk: DepsService; sessions: SessionService; places: PlaceService; chkJobs: JobsService; runner: JobRunner; tx: TransactionService;
  catalog: CatalogApi; inv: InventoryApi; invJobs: InvJobs; prm: PromotionApi; shp: ShippingApi; cart: CartApi; ord: OrderApi; cat: string;
  deps: CartDeps; jobs: CartJobs; life: CartLife; reads: CartRead; writes: CartWrite;
}

/**
 * Ứng dụng THẬT (AppModule: platform, AUTH, USR, PRD, INV, PRM, ORD, SHP, CRT, PAY, CHK), PostgreSQL thật, MinIO giả trong tiến trình cho ảnh, cổng VNPay là `FakeGateway` (PAY khởi động thanh toán qua redirect, CHK không gọi PAY);
 * không có bản giả của module nào CHK gọi: test đếm hay gài lỗi bằng `jest.spyOn` trên chính các lớp `*Api` mà CHK dùng. Pool lớn hơn mặc định test để chạy giao dịch song song thật.
 * Đồng hồ giả đặt về GIỜ THẬT lúc dựng; `expires_at` của phiên và hạn giữ hàng tính theo giờ CSDL, test lùi mốc bằng SQL.
 */
export async function createChkApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<ChkApp> {
  const fake = new FakeS3();
  await fake.start();
  const storage = { STORAGE_ENDPOINT: fake.url, STORAGE_BUCKET: fake.bucket, STORAGE_REGION: 'us-east-1', STORAGE_ACCESS_KEY: fake.accessKey, STORAGE_SECRET_KEY: fake.secretKey };
  const gw = new FakeGateway();
  const t = await createAuthApp({ imports: [AppModule], controllers: [], level: o.level, env: { ...PAY_ENV, ...storage, ...(o.env ?? {}) }, overrides: [{ provide: VNPAY_GATEWAY, useValue: gw }] });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  const a = t.app;
  const closeBase = t.close;
  return Object.assign(t, {
    fake, gw, chk: a.get(DepsService), sessions: a.get(SessionService), places: a.get(PlaceService), chkJobs: a.get(JobsService), runner: a.get(JobRunner), tx: a.get(TransactionService),
    catalog: a.get(CatalogApi), inv: a.get(InventoryApi), invJobs: a.get(InvJobs), prm: a.get(PromotionApi), shp: a.get(ShippingApi), cart: a.get(CartApi), ord: a.get(OrderApi), cat: '',
    deps: a.get(CartDeps), jobs: a.get(CartJobs), life: a.get(CartLife), reads: a.get(CartRead), writes: a.get(CartWrite),
    close: async () => { await closeBase(); await fake.stop(); },
  }) as ChkApp;
}
export { call, who, q, seedMethod, seedCoupon, seedCart, seedAddress, race, sleep, type Who };
const crt = (t: ChkApp): CrtApp => t as unknown as CrtApp;

export const resetLimits = (t: AuthApp) => t.prisma.$executeRaw`TRUNCATE rate_limit_counters`;
/** Đầu mỗi test: CSDL sạch (kể cả danh mục dùng chung của `product`), bộ đếm tần suất sạch, đồng hồ sang cửa sổ mới, bản giả và hạn gọi về mặc định. */
export async function resetChk(t: ChkApp): Promise<void> {
  await truncateAll(t.prisma);
  t.cat = '';
  t.chk.timeoutMs = t.config.get<number>('CHK_DEPENDENCY_TIMEOUT_MS'); // mặc định theo cấu hình (không đặt cứng 2000 để đột biến đổi mặc định bị bắt)
  t.gw.reset();
  await resetLimits(t);
  t.clock.advance(61_000);
}
/** Đồng hồ ứng dụng về giây thứ 1 của cửa sổ cố định kế tiếp: N lần gọi nằm trọn một cửa sổ (bộ đếm tần suất dùng cửa sổ cố định, L-alignWindow). */
export const alignWindow = (t: ChkApp, seconds = 60): void => t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / (seconds * 1000)) * seconds * 1000 + 1000));
export const noTrace = (b: Record<string, unknown>): Record<string, unknown> => { const { trace_id: _t, ...rest } = b; return rest; };
export const newKey = (): string => `key-${randomUUID()}`;

// --- dữ liệu mồi theo tài liệu TC (P1 150000, P2 50000; SM1 30000 miễn phí từ 500000, phụ thu 50000 cho "Hà Giang"; SM2 50000; SALE10 giảm 10% từ 200000)
export interface World { p1: string; p2: string; sm1: string; sm2: string }
export async function world(t: ChkApp, o: { p1Stock?: number; p2Stock?: number } = {}): Promise<World> {
  const p1 = await product(crt(t), { name: 'Áo thun cotton', price: 150000 });
  const p2 = await product(crt(t), { name: 'Tất cổ cao', price: 50000 });
  await stock(crt(t), p1, o.p1Stock ?? 10);
  await stock(crt(t), p2, o.p2Stock ?? 10);
  const sm1 = await seedMethod(t, { name: 'Giao tiêu chuẩn', fee: 30000, freeOver: 500000, surcharge: 50000, cities: ['Hà Giang'] });
  const sm2 = await seedMethod(t, { name: 'Giao nhanh', fee: 50000 });
  return { p1, p2, sm1, sm2 };
}
let n = 0;
/** Khách đã xác minh email có phiên đăng nhập. */
export const customer = (t: ChkApp, email = `khach${++n}@shop.vn`) => who(t, 'customer', email);
export interface Seeded { u: Who; a1: string; a2: string; cart: string }
/** Khách A: hai địa chỉ (a1 mặc định city "Hà Nội", a2 "Hà Giang") và giỏ P1 x 2 + P2 x 1 (mã, vận chuyển tùy chọn); `version` của giỏ do test đặt. */
export async function shopper(t: ChkApp, w: World, o: { email?: string; lines?: { product: string; quantity?: number }[]; coupon?: string | null; version?: number; method?: string; city?: string } = {}): Promise<Seeded> {
  const u = await customer(t, o.email);
  const a1 = await seedAddress(t, u.id, { receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hà Nội', isDefault: true });
  const a2 = await seedAddress(t, u.id, { receiver: 'Trần Bình', phone: '0902222222', line1: '9 Trần Phú', ward: 'Quang Trung', district: null, city: 'Hà Giang' });
  const { cart } = await seedCart(t as unknown as CrtApp, u.id, { lines: o.lines ?? [{ product: w.p1, quantity: 2 }, { product: w.p2, quantity: 1 }], coupon: o.coupon ?? null, version: o.version ?? 7, method: o.method ?? null, city: o.method ? (o.city ?? 'Hà Nội') : null });
  return { u, a1, a2, cart };
}

// --- gọi API của CHK
export const create = (t: ChkApp, u: Who | undefined, body: unknown = {}) => call(t, 'post', '/checkout/sessions', { cookie: u?.cookie, body });
export const view = (t: ChkApp, u: Who | undefined, id: string) => call(t, 'get', `/checkout/sessions/${id}`, { cookie: u?.cookie });
export const pickAddress = (t: ChkApp, u: Who | undefined, id: string, address_id: unknown, extra: Record<string, unknown> = {}) => call(t, 'put', `/checkout/sessions/${id}/address`, { cookie: u?.cookie, body: { address_id, ...extra } });
export const options = (t: ChkApp, u: Who | undefined, id: string) => call(t, 'get', `/checkout/sessions/${id}/shipping-options`, { cookie: u?.cookie });
export const pickShipping = (t: ChkApp, u: Who | undefined, id: string, method_id: unknown, extra: Record<string, unknown> = {}) => call(t, 'put', `/checkout/sessions/${id}/shipping-method`, { cookie: u?.cookie, body: { method_id, ...extra } });
export const pickPayment = (t: ChkApp, u: Who | undefined, id: string, payment_method: unknown, extra: Record<string, unknown> = {}) => call(t, 'put', `/checkout/sessions/${id}/payment-method`, { cookie: u?.cookie, body: { payment_method, ...extra } });
export const applyCoupon = (t: ChkApp, u: Who | undefined, id: string, code: unknown, extra: Record<string, unknown> = {}) => call(t, 'put', `/checkout/sessions/${id}/coupon`, { cookie: u?.cookie, body: { code, ...extra } });
export const dropCoupon = (t: ChkApp, u: Who | undefined, id: string) => call(t, 'delete', `/checkout/sessions/${id}/coupon`, { cookie: u?.cookie });
export const cancel = (t: ChkApp, u: Who | undefined, id: string) => call(t, 'delete', `/checkout/sessions/${id}`, { cookie: u?.cookie });
/** Đặt hàng: `Idempotency-Key` mới mỗi lần bấm (khách chủ động), giữ nguyên khi truyền `key`; `headers` thêm hay bỏ header. */
export function place(t: ChkApp, u: Who | undefined, id: string, body: unknown, o: { key?: string | null; origin?: string | null } = {}) {
  const r = call(t, 'post', `/checkout/sessions/${id}/place-order`, { cookie: u?.cookie, body, origin: o.origin });
  const key = o.key === undefined ? newKey() : o.key;
  return key === null ? r : r.set('Idempotency-Key', key);
}
/** Phiên đầy đủ: tạo phiên rồi chọn địa chỉ mặc định a1, vận chuyển SM1, thanh toán và mã tùy chọn. Trả `id`. */
export async function ready(t: ChkApp, s: Seeded, w: World, o: { pay?: 'vnpay' | 'cod' | null; method?: string | null; coupon?: string | null } = {}): Promise<string> {
  const r = await create(t, s.u);
  if (r.status !== 201 && r.status !== 200) throw new Error(`tạo phiên fixture thất bại: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.id as string;
  const steps: [string, () => Promise<{ status: number; body: any }>][] = [];
  if (o.method !== null) steps.push(['shipping', () => pickShipping(t, s.u, id, o.method ?? w.sm1)]);
  if (o.pay !== null) steps.push(['payment', () => pickPayment(t, s.u, id, o.pay ?? 'cod')]);
  if (o.coupon) steps.push(['coupon', () => applyCoupon(t, s.u, id, o.coupon)]);
  for (const [name, f] of steps) { const x = await f(); if (x.status !== 200) throw new Error(`bước ${name} của fixture thất bại: ${x.status} ${JSON.stringify(x.body)}`); }
  return id;
}
/** Xem lại rồi đặt đúng số đang hiển thị. */
export async function placeShown(t: ChkApp, s: Seeded, id: string, o: { key?: string } = {}) {
  const v = (await view(t, s.u, id)).body;
  return place(t, s.u, id, { expected_grand_total: v.expected_grand_total, cart_version: v.cart_version }, o);
}

// --- đọc CSDL
export const sessionsOf = (t: ChkApp, user: string) =>
  q<{ id: string; cart_id: string; status: string; address_id: string | null; shipping_method_id: string | null; payment_method: string | null; coupon_code: string | null; address_snapshot: any; price_snapshot: any; order_id: string | null;
    expires_at: Date; last_activity_at: Date; completed_at: Date | null; created_at: Date; updated_at: Date }>(
    t, `SELECT id, cart_id, status::text AS status, address_id, shipping_method_id, payment_method::text AS payment_method, coupon_code, address_snapshot, price_snapshot, order_id, expires_at, last_activity_at, completed_at, created_at, updated_at FROM checkout_sessions WHERE user_id = '${user}' ORDER BY created_at, id`);
export const sessionRow = async (t: ChkApp, id: string) => (await q<any>(t, `SELECT id, user_id, cart_id, status::text AS status, address_id, shipping_method_id, payment_method::text AS payment_method, coupon_code, address_snapshot, price_snapshot, order_id, expires_at, last_activity_at, completed_at, updated_at, (extract(epoch FROM expires_at - now()) * 1000)::float8 AS ttl_ms FROM checkout_sessions WHERE id = '${id}'`))[0];
export const countOf = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
export const ordersOf = (t: AuthApp, user: string) =>
  q<{ id: string; code: string; status: string; payment_method: string; items_total: string; discount: string; shipping_fee: string; grand_total: string; shipping_address: Record<string, string>; shipping_method_id: string; payment_expires_at: Date | null }>(
    t, `SELECT id, code, status::text AS status, payment_method::text AS payment_method, items_total::text AS items_total, discount::text AS discount, shipping_fee::text AS shipping_fee, grand_total::text AS grand_total, shipping_address, shipping_method_id, payment_expires_at FROM orders WHERE user_id = '${user}' ORDER BY created_at, id`);
export const orderItemsOf = (t: AuthApp, order: string) => q<{ product_id: string; name_snapshot: string; unit_price: string; quantity: number; position: number }>(t, `SELECT product_id, name_snapshot, unit_price::text AS unit_price, quantity, position FROM order_items WHERE order_id = '${order}' ORDER BY position`);
export const reservedOf = async (t: AuthApp, product: string): Promise<number> => (await q<{ reserved: number }>(t, `SELECT reserved FROM stock_items WHERE product_id = '${product}'`))[0].reserved;
export const onHandOf = async (t: AuthApp, product: string): Promise<number> => (await q<{ on_hand: number }>(t, `SELECT on_hand FROM stock_items WHERE product_id = '${product}'`))[0].on_hand;
export const holdsOf = (t: AuthApp, order: string) => q<{ product_id: string; quantity: number; status: string; expires_at: Date | null }>(t, `SELECT s.product_id, r.quantity, r.status::text AS status, r.expires_at FROM stock_reservations r JOIN stock_items s ON s.id = r.stock_item_id WHERE r.order_id = '${order}' ORDER BY s.product_id`);
export const redemptionsFor = (t: AuthApp, code: string) => q<{ order_id: string; user_id: string; status: string; amount: string }>(t, `SELECT r.order_id, r.user_id, r.status::text AS status, r.amount::text AS amount FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE c.code = '${code}' ORDER BY r.created_at, r.id`);
export const reservedCount = async (t: AuthApp, code: string): Promise<number> => (await q<{ n: number }>(t, `SELECT reserved_count AS n FROM coupons WHERE code = '${code}'`))[0].n;
export const outboxOf = (t: AuthApp, type?: string) => q<{ id: string; type: string; aggregate_type: string; aggregate_id: string; payload: any; correlation_id: string; occurred_at: Date; dispatched_at: Date | null }>(
  t, `SELECT id, type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at, dispatched_at FROM outbox_events ${type ? `WHERE type = '${type}'` : ''} ORDER BY occurred_at, id`);
export const auditsOf = (t: AuthApp, action = 'checkout.place_order') => q<{ actor_id: string; actor_role: string; action: string; target_type: string; target_id: string; after: any; before: any; correlation_id: string; created_at: Date }>(
  t, `SELECT actor_id, actor_role, action, target_type, target_id, before, after, correlation_id, created_at FROM audit_logs WHERE action = '${action}' ORDER BY created_at, id`);
export const idemRows = (t: AuthApp) => q<{ user_id: string; key: string; scope: string; expires_at: Date; created_at: Date }>(t, `SELECT user_id, key, scope, expires_at, created_at FROM idempotency_keys ORDER BY created_at`);
/** Mọi dấu vết của một lần đặt hàng thất bại phải bằng nhau trước và sau (không đơn, không reservation, không lượt coupon, không outbox, không audit, không khóa idempotency). */
export const tally = async (t: AuthApp): Promise<number[]> => [
  await countOf(t, 'orders'), await countOf(t, 'order_items'), await countOf(t, 'stock_reservations'), await countOf(t, 'coupon_redemptions'), await countOf(t, 'outbox_events'),
  await countOf(t, 'audit_logs', "action = 'checkout.place_order'"), await countOf(t, 'idempotency_keys'), await countOf(t, 'stock_movements'),
];
/** Lùi mốc thời gian của phiên (giả đồng hồ CSDL tiến thêm `minutes` phút): dời `expires_at`, `last_activity_at`, `updated_at`, `created_at` về trước. */
export const ageSession = (t: AuthApp, id: string, minutes: number) =>
  t.prisma.$executeRaw`UPDATE checkout_sessions SET expires_at = expires_at - make_interval(mins => ${minutes}::int), last_activity_at = last_activity_at - make_interval(mins => ${minutes}::int), created_at = created_at - make_interval(mins => ${minutes}::int), updated_at = updated_at - make_interval(mins => ${minutes}::int) WHERE id = ${id}::uuid`;
export const ageDays = (t: AuthApp, id: string, days: number) => t.prisma.$executeRaw`UPDATE checkout_sessions SET updated_at = updated_at - make_interval(days => ${days}::int) WHERE id = ${id}::uuid`;
export const setEmailVerified = (t: AuthApp, user: string, verified: boolean) => t.prisma.$executeRaw`UPDATE users SET email_verified_at = ${verified ? new Date() : null}::timestamptz WHERE id = ${user}::uuid`;
export const setPrice = (t: AuthApp, product: string, price: number) => t.prisma.$executeRaw`UPDATE products SET price = ${price}, updated_at = now() WHERE id = ${product}::uuid`;
export const setCouponStatus = (t: AuthApp, code: string, status: 'active' | 'disabled' | 'deleted') => t.prisma.$executeRaw`UPDATE coupons SET status = ${status}::coupon_status WHERE code = ${code}`;
export const setMethodActive = (t: AuthApp, id: string, active: boolean) => t.prisma.$executeRaw`UPDATE shipping_methods SET is_active = ${active} WHERE id = ${id}::uuid`;
export const bumpCart = (t: AuthApp, cart: string, qty: { item: string; quantity: number }) => t.prisma.$executeRaw`UPDATE cart_items SET quantity = ${qty.quantity} WHERE id = ${qty.item}::uuid`.then(() => t.prisma.$executeRaw`UPDATE carts SET version = version + 1 WHERE id = ${cart}::uuid`);
/** Chạy relay outbox thật tới khi hết event (hai lượt đủ cho chuỗi OrderCreated -> PAY tạo Payment). */
export async function relayAll(t: AuthApp, rounds = 3): Promise<void> {
  const base = Date.now() + 10_000;
  for (let i = 0; i < rounds; i++) await t.relay.runOnce(new Date(base + i * 120_000));
}
