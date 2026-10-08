import { PlatformModule, EventsService, TransactionService, runWithCorrelation, type EventEnvelope, type Tx } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { CatalogModule } from '../../src/modules/catalog/catalog.module';
import { InventoryApi, InventoryModule } from '../../src/modules/inventory';
import { JobsService } from '../../src/modules/inventory/jobs.service';
import { LifecycleService } from '../../src/modules/inventory/lifecycle.service';
import { createAuthApp, type AuthApp } from './auth';
import { seedCategory, seedProduct, who, type Who } from './prd';
import { randomUUID } from 'node:crypto';
import { call } from './usr';
import { q } from './auth';

export interface InvApp extends AuthApp { inv: InventoryApi; jobs: JobsService; life: LifecycleService; tx: TransactionService; cat: string }

/** Ứng dụng thật (PlatformModule + AuthModule + CatalogModule + InventoryModule), PostgreSQL thật; pool lớn hơn mặc định test để chạy giao dịch song song thật. Kho object chưa cấu hình (dev). */
export async function createInvApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<InvApp> {
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, CatalogModule, InventoryModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16', ...(o.env ?? {}) } });
  return Object.assign(t, { inv: t.app.get(InventoryApi), jobs: t.app.get(JobsService), life: t.app.get(LifecycleService), tx: t.app.get(TransactionService), cat: '' });
}

export interface SeedStock { id?: string; product?: string; on_hand?: number; reserved?: number; threshold?: number; archived?: boolean; version?: number; notified?: boolean; updatedAt?: Date; name?: string; sku?: string; status?: 'draft' | 'active' | 'archived' }
let n = 0;
/** Sản phẩm (PRD) cộng bản ghi kho dựng thẳng trong CSDL (fixture, không qua ProductActivated). `reserved` nhỏ hơn hay bằng `on_hand` (CHECK). Trả `{ product, item }`. */
export async function seedStock(t: InvApp, o: SeedStock = {}): Promise<{ product: string; item: string }> {
  const category = t.cat || (t.cat = await seedCategory(t, 'Áo'));
  const i = ++n;
  const product = o.product ?? await seedProduct(t as never, { category, name: o.name ?? `Sản phẩm kho ${i}`, sku: o.sku ?? `KHO-${String(i).padStart(4, '0')}`, status: o.status ?? (o.archived ? 'archived' : 'active'), images: 0 });
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO stock_items (id, product_id, on_hand, reserved, low_stock_threshold, low_stock_notified, archived_at, version, updated_at)
    VALUES (COALESCE(${o.id ?? null}::uuid, gen_random_uuid()), ${product}::uuid, ${o.on_hand ?? 0}, ${o.reserved ?? 0}, ${o.threshold ?? 5}, ${o.notified ?? true}, ${o.archived ? new Date(t.clock.now().getTime() - 1000) : null}::timestamptz, ${o.version ?? 1}, ${o.updatedAt ?? new Date()}::timestamptz) RETURNING id`;
  return { product, item: rows[0].id };
}
/** Một dòng reservation dựng thẳng (fixture); khớp `reserved` do bên gọi tự đặt ở seedStock. */
export async function seedReservation(t: InvApp, item: string, order: string, quantity: number, status: 'held' | 'committed' | 'released' | 'expired' = 'held', expiresAt: Date | null = new Date(Date.now() + 900_000)): Promise<void> {
  await t.prisma.$executeRaw`INSERT INTO stock_reservations (stock_item_id, order_id, quantity, status, expires_at) VALUES (${item}::uuid, ${order}::uuid, ${quantity}, ${status}::reservation_status, ${expiresAt}::timestamptz)`;
}

export const stockOf = async (t: InvApp, product: string) =>
  (await q<{ on_hand: number; reserved: number; version: number; low_stock_threshold: number; low_stock_notified: boolean; archived_at: Date | null }>(t, `SELECT on_hand, reserved, version, low_stock_threshold, low_stock_notified, archived_at FROM stock_items WHERE product_id = '${product}'`))[0];
export const movementsOf = (t: InvApp, product: string) =>
  q<{ type: string; quantity: number; on_hand_after: number; reason: string | null; note: string | null; actor_id: string | null; actor_name: string | null; ref_type: string | null; ref_id: string | null }>(t, `SELECT m.type, m.quantity, m.on_hand_after, m.reason, m.note, m.actor_id, m.actor_name, m.ref_type, m.ref_id FROM stock_movements m JOIN stock_items s ON s.id = m.stock_item_id WHERE s.product_id = '${product}' ORDER BY m.created_at, m.id`);
export const reservationsOf = (t: InvApp, order: string) =>
  q<{ product_id: string; quantity: number; status: string; expires_at: Date | null }>(t, `SELECT s.product_id, r.quantity, r.status, r.expires_at FROM stock_reservations r JOIN stock_items s ON s.id = r.stock_item_id WHERE r.order_id = '${order}' ORDER BY s.product_id`);
export const eventsOf = (t: InvApp, type?: string) =>
  q<{ type: string; aggregate_id: string; payload: any; id: string }>(t, `SELECT id, type, aggregate_id, payload FROM outbox_events ${type ? `WHERE type = '${type}'` : `WHERE type LIKE 'Stock%' OR type = 'LowStockDetected'`} ORDER BY occurred_at, id`);
export const auditCount = async (t: InvApp, action: string): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM audit_logs WHERE action = '${action}'`))[0].n;

/** Giữ hàng qua giao diện nội bộ, trong MỘT giao dịch như CHK (cam kết khi xong; ném lỗi thì quay lui). */
export const reserve = (t: InvApp, order: string, items: { product_id: string; quantity: number }[], expiresAt: Date | null = new Date(Date.now() + 900_000)) =>
  t.tx.run((tx: Tx) => t.inv.reserve(order, items, expiresAt, tx));

/** Giao một event cho mọi consumer đã đăng ký (như relay, nhưng không chờ lịch): `event_id` tùy chọn để thử giao lại cùng event. */
export async function deliver(t: InvApp, type: string, payload: Record<string, unknown>, eventId: string = randomUUID()): Promise<void> {
  const env: EventEnvelope = { event_id: eventId, type, aggregate_type: 'x', aggregate_id: String(payload.order_id ?? payload.product_id ?? payload.shipment_id), payload, occurred_at: new Date().toISOString(), correlation_id: 'test-corr' };
  await runWithCorrelation(env.correlation_id, async () => { for (const sub of t.app.get(EventsService).consumersFor(type)) await t.app.get(EventsService).deliver(sub, env); });
}

export const newId = (): string => randomUUID();
export { call, who, seedCategory, seedProduct, type Who };
let k = 0;
export const idem = (): string => `test-key-${Date.now().toString(36)}-${++k}`;

/** Consumer giả (như ORD, PAY, NTF): ghi lại event theo `event_id` mỗi lần được giao. */
export function sink(t: InvApp, ...types: string[]): EventEnvelope[] {
  const seen: EventEnvelope[] = [];
  for (const type of types) t.app.get(EventsService).subscribe(`sink-${Math.random()}`, type, async (_tx, e) => { seen.push(e); });
  return seen;
}
/** Chạy relay outbox thật hai lượt (event cách nhau hạn thuê và backoff được bỏ qua bằng mốc giờ tương lai). */
export async function relay(t: InvApp, rounds = 2): Promise<void> {
  const base = Date.now() + 10_000;
  for (let i = 0; i < rounds; i++) await t.relay.runOnce(new Date(base + i * 120_000));
}
/** Giờ CSDL cộng `minutes` (dựng `expires_at` như CHK: giờ CSDL + RESERVATION_TTL, không giờ máy kiểm thử). */
export async function dbNowPlus(t: InvApp, seconds: number): Promise<Date> {
  return (await t.prisma.$queryRaw<{ d: Date }[]>`SELECT now() + make_interval(secs => ${seconds}) AS d`)[0].d;
}

/** Dựng hàng loạt bằng SQL (fixture): `n` sản phẩm active, mỗi sản phẩm một bản ghi kho (on_hand, reserved = quantity) và một reservation held của đơn riêng. `overdueSec` > 0 là đã quá hạn từng ấy giây, `null` là COD không hạn. */
export async function bulkReservations(t: InvApp, n: number, o: { quantity?: number; onHand?: number; overdueSec?: number | null } = {}): Promise<{ items: string[]; orders: string[] }> {
  const category = t.cat || (t.cat = await seedCategory(t, 'Áo'));
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase(), qty = o.quantity ?? 1, onHand = o.onHand ?? 10, ago = o.overdueSec === undefined ? 60 : o.overdueSec;
  const rows = await t.prisma.$queryRaw<{ stock_item_id: string; order_id: string }[]>`
    WITH p AS (
      INSERT INTO products (category_id, name, sku, price, status, published_at, search_text)
      SELECT ${category}::uuid, 'Bulk ' || g, 'BULK-' || ${tag} || '-' || g, 100000, 'active', now(), 'bulk ' || g FROM generate_series(1, ${n}) g RETURNING id
    ), s AS (
      INSERT INTO stock_items (product_id, on_hand, reserved) SELECT id, ${onHand}, ${qty} FROM p RETURNING id
    )
    INSERT INTO stock_reservations (stock_item_id, order_id, quantity, expires_at)
    SELECT id, gen_random_uuid(), ${qty}, CASE WHEN ${ago}::int IS NULL THEN NULL ELSE now() - make_interval(secs => ${ago}::int) END FROM s RETURNING stock_item_id, order_id`;
  return { items: rows.map((r) => r.stock_item_id), orders: rows.map((r) => r.order_id) };
}

/**
 * Hai bản ghi kho có thứ tự `id` NGƯỢC thứ tự `product_id` và thứ tự chèn (item1 có id lớn nhất, chèn trước): khóa theo `id` tăng dần, theo `product_id` hay theo thứ tự quét bảng cho ra thứ tự ngược nhau,
 * nên một đường khóa không sắp theo `stock_items.id` sẽ bế tắc với đường khóa đúng (ADR-012, T17). Trả `a` (id lớn, product_id nhỏ) và `b` (id nhỏ, product_id lớn).
 */
export async function invertedPair(t: InvApp, o: SeedStock = {}): Promise<{ a: { product: string; item: string }; b: { product: string; item: string } }> {
  const category = t.cat || (t.cat = await seedCategory(t, 'Áo'));
  const ps = [await seedProduct(t as never, { category, name: 'Cặp ngược 1', sku: `NGUOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}` }), await seedProduct(t as never, { category, name: 'Cặp ngược 2', sku: `NGUOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}` })].sort();
  const a = await seedStock(t, { ...o, product: ps[0], id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  const b = await seedStock(t, { ...o, product: ps[1], id: '00000000-0000-4000-8000-000000000001' });
  return { a, b };
}
