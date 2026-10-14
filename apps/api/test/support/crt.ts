import { randomUUID } from 'node:crypto';
import { PlatformModule, TransactionService } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { CartApi, CartModule } from '../../src/modules/cart';
import { DepsService } from '../../src/modules/cart/deps.service';
import { JobsService } from '../../src/modules/cart/jobs.service';
import { LifecycleService } from '../../src/modules/cart/lifecycle.service';
import { ReadService } from '../../src/modules/cart/read.service';
import { WriteService } from '../../src/modules/cart/write.service';
import { CatalogApi, CatalogModule } from '../../src/modules/catalog';
import { InventoryApi, InventoryModule } from '../../src/modules/inventory';
import { PromotionApi, PromotionModule } from '../../src/modules/promotion';
import { ShippingApi, ShippingModule } from '../../src/modules/shipping';
import { FakeS3 } from './fake-s3';
import { createAuthApp, q, type AuthApp } from './auth';
import { truncateAll } from './db';
import { call, seedCategory, seedProduct, who, type PrdApp, type Who } from './prd';
import { seedMethod } from './shp';

export interface CrtApp extends AuthApp {
  fake: FakeS3; catalog: CatalogApi; inv: InventoryApi; prm: PromotionApi; shp: ShippingApi; cart: CartApi; deps: DepsService; jobs: JobsService; life: LifecycleService;
  reads: ReadService; writes: WriteService; tx: TransactionService; cat: string;
}

/**
 * Ứng dụng thật (PlatformModule + AuthModule + CatalogModule + InventoryModule + PromotionModule + ShippingModule + CartModule), PostgreSQL thật; PRD, INV, PRM, SHP chạy thật (không bản giả),
 * test đếm lời gọi bằng `jest.spyOn` trên chính các lớp `*Api` mà CRT dùng. Pool lớn hơn mặc định test để chạy giao dịch song song thật. Đồng hồ giả đặt về GIỜ THẬT lúc dựng.
 */
export async function createCrtApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<CrtApp> {
  const fake = new FakeS3();
  await fake.start();
  const storage = { STORAGE_ENDPOINT: fake.url, STORAGE_BUCKET: fake.bucket, STORAGE_REGION: 'us-east-1', STORAGE_ACCESS_KEY: fake.accessKey, STORAGE_SECRET_KEY: fake.secretKey };
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, CatalogModule, InventoryModule, PromotionModule, ShippingModule, CartModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16', ...storage, ...(o.env ?? {}) } });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  const closeBase = t.close;
  return Object.assign(t, {
    fake, catalog: t.app.get(CatalogApi), inv: t.app.get(InventoryApi), prm: t.app.get(PromotionApi), shp: t.app.get(ShippingApi), cart: t.app.get(CartApi), deps: t.app.get(DepsService),
    jobs: t.app.get(JobsService), life: t.app.get(LifecycleService), reads: t.app.get(ReadService), writes: t.app.get(WriteService), tx: t.app.get(TransactionService), cat: '',
    close: async () => { await closeBase(); await fake.stop(); },
  });
}
export { call, who, q, seedMethod, type Who };

let n = 0;
/** Sản phẩm dựng thẳng trong CSDL (fixture). Mặc định `active`, giá 100000, 1 ảnh. */
export async function product(t: CrtApp, o: { name?: string; price?: number; status?: 'draft' | 'active' | 'archived'; sku?: string; images?: number } = {}): Promise<string> {
  const category = t.cat || (t.cat = await seedCategory(t, 'Áo'));
  const i = ++n;
  return seedProduct(t as unknown as PrdApp, { category, name: o.name ?? `Sản phẩm giỏ ${i}`, sku: o.sku ?? `GIO-${String(i).padStart(5, '0')}`, price: o.price ?? 100000, status: o.status ?? 'active', images: o.images ?? 1 });
}
/** Bản ghi kho dựng thẳng: còn bán được = `onHand` − `reserved`. Chưa gọi thì sản phẩm "chưa có bản ghi kho" (INV trả 0). */
export async function stock(t: CrtApp, productId: string, onHand = 100, reserved = 0): Promise<void> {
  await t.prisma.$executeRaw`INSERT INTO stock_items (product_id, on_hand, reserved) VALUES (${productId}::uuid, ${onHand}, ${reserved}) ON CONFLICT (product_id) DO UPDATE SET on_hand = ${onHand}, reserved = ${reserved}`;
}
/** Sản phẩm đang bán kèm kho. */
export async function sku(t: CrtApp, price = 100000, onHand = 100, o: { name?: string } = {}): Promise<string> {
  const id = await product(t, { price, name: o.name });
  await stock(t, id, onHand);
  return id;
}
export const buyer = (t: CrtApp, email = `khach${++n}@shop.vn`): Promise<Who> => who(t, 'customer', email);

export const getCart = (t: CrtApp, u: Who | undefined) => call(t, 'get', '/cart', { cookie: u?.cookie });
export const addItem = (t: CrtApp, u: Who | undefined, product_id: unknown, quantity: unknown = 1, extra: Record<string, unknown> = {}) => call(t, 'post', '/cart/items', { cookie: u?.cookie, body: { product_id, quantity, ...extra } });
export const setQty = (t: CrtApp, u: Who | undefined, itemId: string, quantity: unknown, extra: Record<string, unknown> = {}) => call(t, 'patch', `/cart/items/${itemId}`, { cookie: u?.cookie, body: { quantity, ...extra } });
export const delItem = (t: CrtApp, u: Who | undefined, itemId: string) => call(t, 'delete', `/cart/items/${itemId}`, { cookie: u?.cookie });
export const clearCart = (t: CrtApp, u: Who | undefined) => call(t, 'delete', '/cart', { cookie: u?.cookie });
export const putCoupon = (t: CrtApp, u: Who | undefined, code: unknown, extra: Record<string, unknown> = {}) => call(t, 'put', '/cart/coupon', { cookie: u?.cookie, body: { code, ...extra } });
export const putShipping = (t: CrtApp, u: Who | undefined, method_id: unknown, city: unknown, extra: Record<string, unknown> = {}) => call(t, 'put', '/cart/shipping', { cookie: u?.cookie, body: { method_id, city, ...extra } });

export interface SeedCartLine { product: string; quantity?: number; price?: number; reason?: 'product_archived' | null }
export interface SeedCart { lines?: SeedCartLine[]; coupon?: string | null; method?: string | null; city?: string | null; version?: number; lastActivityAt?: Date; status?: 'active' | 'converted' | 'abandoned'; order?: string }
/**
 * Giỏ dựng thẳng trong CSDL (fixture, không qua API): dòng cách nhau 1 mili giây theo thứ tự cho trước; `price` là giá ĐÃ LƯU lúc thêm (mặc định bằng giá hiện hành của sản phẩm).
 * Trả `{ cart, items }` theo thứ tự dòng.
 */
export async function seedCart(t: CrtApp, user: string, o: SeedCart = {}): Promise<{ cart: string; items: string[] }> {
  const status = o.status ?? 'active';
  const last = o.lastActivityAt ?? new Date();
  const [c] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO carts (user_id, status, coupon_code, shipping_method_id, shipping_city, version, last_activity_at, converted_order_id)
    VALUES (${user}::uuid, ${status}::cart_status, ${o.coupon ?? null}, ${o.method ?? null}::uuid, ${o.city ?? null}, ${o.version ?? 1}, ${last}::timestamptz, ${status === 'converted' ? (o.order ?? randomUUID()) : null}::uuid) RETURNING id`;
  const items: string[] = [];
  let k = 0;
  for (const l of o.lines ?? []) {
    const price = l.price ?? (await q<{ p: string }>(t, `SELECT price::text AS p FROM products WHERE id = '${l.product}'`))[0].p;
    const [i] = await t.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unavailable_reason, created_at) VALUES (${c.id}::uuid, ${l.product}::uuid, ${l.quantity ?? 1}, ${price}::bigint, ${l.reason ?? null}, now() + make_interval(secs => ${++k / 1000.0}))
      RETURNING id`;
    items.push(i.id);
  }
  return { cart: c.id, items };
}
export const cartsOf = (t: CrtApp, user: string) =>
  q<{ id: string; status: string; coupon_code: string | null; shipping_method_id: string | null; shipping_city: string | null; version: number; last_activity_at: Date; converted_order_id: string | null; updated_at: Date }>(
    t, `SELECT id, status::text AS status, coupon_code, shipping_method_id, shipping_city, version, last_activity_at, converted_order_id, updated_at FROM carts WHERE user_id = '${user}' ORDER BY created_at, id`);
export const activeCart = async (t: CrtApp, user: string) => (await cartsOf(t, user)).find((c) => c.status === 'active');
export const itemsOf = (t: CrtApp, cartId: string) =>
  q<{ id: string; product_id: string; quantity: number; unit_price: string; unavailable_reason: string | null }>(
    t, `SELECT id, product_id, quantity, unit_price::text AS unit_price, unavailable_reason FROM cart_items WHERE cart_id = '${cartId}' ORDER BY created_at, id`);
export const cartCount = async (t: CrtApp, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM carts WHERE ${where}`))[0].n;
export const itemCount = async (t: CrtApp, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM cart_items WHERE ${where}`))[0].n;
export const processed = (t: CrtApp, eventId?: string) => q<{ consumer: string; event_id: string }>(t, `SELECT consumer, event_id FROM processed_events WHERE consumer = 'cart' ${eventId ? `AND event_id = '${eventId}'` : ''}`);
/** Bỏ `trace_id` để so nội dung hai lỗi (chỉ `trace_id` được khác). */
export const noTrace = (b: Record<string, unknown>): Record<string, unknown> => { const { trace_id: _t, ...rest } = b; return rest; };
/** Quét đệ quy JSON: mọi giá trị của khóa `key`. */
export function valuesOf(v: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) v.forEach((x) => valuesOf(x, key, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === key) out.push(x); valuesOf(x, key, out); }
  return out;
}
export { seedCoupon } from './prm';
export { deliver } from './prm';
export { race, sleep } from './ord';
export const resetLimits = (t: AuthApp) => t.prisma.$executeRaw`TRUNCATE rate_limit_counters`;
/** Đầu mỗi test: CSDL sạch (kể cả danh mục dùng chung của `product`), bộ đếm tần suất sạch, đồng hồ sang cửa sổ mới. */
export async function resetCrt(t: CrtApp): Promise<void> {
  await truncateAll(t.prisma);
  t.cat = '';
  await resetLimits(t);
  t.clock.advance(61_000);
}
export { medianPairMs } from './auth';
export { seedRedemption } from './prm';
/** Đồng hồ ứng dụng về giây thứ 1 của cửa sổ cố định `seconds` kế tiếp (các bộ đếm tần suất dùng cửa sổ cố định): N lần gọi nằm trọn một cửa sổ, không vỡ khi test chạy qua ranh giới phút. */
export const alignWindow = (t: CrtApp, seconds = 60): void => t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / (seconds * 1000)) * seconds * 1000 + 1000));
/** Bộ đếm lần sai mã (`coupon_not_found`) của người dùng ở kho đếm của platform (PRM, ADR-014). */
export const wrongHits = async (t: CrtApp, user: string): Promise<number> =>
  (await q<{ count: number }>(t, `SELECT coalesce(sum(count), 0)::int AS count FROM rate_limit_counters WHERE bucket LIKE 'ctr:prm:notfound:${user}%'`))[0].count;
