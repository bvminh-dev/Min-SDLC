import { randomUUID } from 'node:crypto';
import { PlatformModule, EventsService, TransactionService, runWithCorrelation, type EventEnvelope, type Tx } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { OrderApi, OrderModule, type CreatePendingInput } from '../../src/modules/order';
import { CancelService } from '../../src/modules/order/cancel.service';
import { LifecycleService } from '../../src/modules/order/lifecycle.service';
import { createAuthApp, q, seedUser, type AuthApp } from './auth';
import { insertOrder, ADDRESS, code, type PayStatus, type SeedOrder, type Status } from './order-fixture';
import { call, who, type Who } from './prd';

export interface OrdApp extends AuthApp { ord: OrderApi; tx: TransactionService; life: LifecycleService; cancels: CancelService }

/**
 * Ứng dụng thật (PlatformModule + AuthModule + OrderModule), PostgreSQL thật; pool lớn hơn mặc định test để chạy giao dịch song song thật.
 * Đồng hồ giả đặt về GIỜ THẬT lúc dựng (không mốc ngày cố định): `payment_expires_at` so với giờ CSDL, `created_at` ghi theo đồng hồ của ứng dụng.
 */
export async function createOrdApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<OrdApp> {
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, OrderModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16', ...(o.env ?? {}) } });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  return Object.assign(t, { ord: t.app.get(OrderApi), tx: t.app.get(TransactionService), life: t.app.get(LifecycleService), cancels: t.app.get(CancelService) });
}

export { ADDRESS, ALPHABET, code, type PayStatus, type SeedOrder, type Status } from './order-fixture';
/** Đơn dựng thẳng trong CSDL (fixture, không qua CHK): `status` cùng cột kèm theo cho khớp CHECK, lịch sử theo đường đi hợp lệ tới `status` (mỗi dòng cách nhau một phút từ `createdAt`). Mặc định chủ đơn là một người dùng mới. */
export async function seedOrder(t: AuthApp, o: SeedOrder = {}): Promise<{ id: string; code: string; user: string }> {
  return insertOrder(t.prisma, t.clock.now(), { ...o, user: o.user ?? (await seedUser(t)).id });
}

export const orderOf = async (t: AuthApp, idOrCode: string) =>
  (await q<{ id: string; user_id: string; code: string; status: Status; payment_status: PayStatus; payment_method: string; grand_total: string; tracking_number: string | null; handoff_locked_at: Date | null; cancel_reason: string | null; cancelled_by_role: string | null; confirmed_at: Date | null; paid_at: Date | null; delivered_at: Date | null; payment_expires_at: Date | null; updated_at: Date; created_at: Date }>(
    t, `SELECT id, user_id, code, status::text AS status, payment_status::text AS payment_status, payment_method::text AS payment_method, grand_total::text AS grand_total, tracking_number, handoff_locked_at, cancel_reason::text AS cancel_reason, cancelled_by_role::text AS cancelled_by_role, confirmed_at, paid_at, delivered_at, payment_expires_at, updated_at, created_at FROM orders WHERE id::text = '${idOrCode}' OR code = '${idOrCode}'`))[0];
export const historyOf = (t: AuthApp, order: string) =>
  q<{ seq: string; from_status: Status | null; to_status: Status; actor_id: string | null; actor_role: string; reason: string | null; created_at: Date }>(
    t, `SELECT seq::text AS seq, from_status::text AS from_status, to_status::text AS to_status, actor_id, actor_role::text AS actor_role, reason, created_at FROM order_status_history h WHERE order_id = '${order}' ORDER BY h.seq`); // `h.seq`: `ORDER BY seq` sẽ sắp theo cột chữ `seq::text` (alias) và đảo '10' trước '9'
export const outboxOf = (t: AuthApp, order?: string) =>
  q<{ id: string; type: string; aggregate_type: string; aggregate_id: string; payload: any; dispatched_at: Date | null }>(
    t, `SELECT id, type, aggregate_type, aggregate_id, payload, dispatched_at FROM outbox_events ${order ? `WHERE aggregate_id = '${order}'` : ''} ORDER BY occurred_at, id`);
export const outTypes = async (t: AuthApp, order: string): Promise<string[]> => (await outboxOf(t, order)).map((e) => e.type);
export const auditsOf = (t: AuthApp, order: string) =>
  q<{ actor_id: string | null; actor_role: string; action: string; target_type: string; target_id: string; before: any; after: any; reason: string | null; correlation_id: string }>(
    t, `SELECT actor_id, actor_role, action, target_type, target_id, before, after, reason, correlation_id FROM audit_logs WHERE target_id = '${order}' ORDER BY created_at, id`);
export const countRows = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;

/** Giao một event cho mọi consumer đã đăng ký (như relay, nhưng không chờ lịch): `event_id` tùy chọn để thử giao lại cùng event. */
export async function deliver(t: AuthApp, type: string, payload: Record<string, unknown>, eventId: string = randomUUID()): Promise<void> {
  const events = t.app.get(EventsService);
  const env: EventEnvelope = { event_id: eventId, type, aggregate_type: 'x', aggregate_id: String(payload.order_id ?? randomUUID()), payload, occurred_at: new Date().toISOString(), correlation_id: 'test-corr' };
  await runWithCorrelation(env.correlation_id, async () => { for (const sub of events.consumersFor(type)) await events.deliver(sub, env); });
}

/** CHK: tạo đơn qua giao diện nội bộ trong MỘT giao dịch (cam kết khi xong; ném lỗi thì quay lui). */
export const baseInput = (user: string, o: Partial<CreatePendingInput> = {}): CreatePendingInput => ({
  user_id: user, items: [{ product_id: randomUUID(), name_snapshot: 'Áo thun cổ tròn', unit_price: 100000, quantity: 2 }, { product_id: randomUUID(), name_snapshot: 'Quần jean', unit_price: 150000, quantity: 1 }],
  items_total: 350000, discount: 0, shipping_fee: 30000, grand_total: 380000, shipping_address: { ...ADDRESS }, shipping_method_id: randomUUID(), payment_method: 'vnpay',
  payment_expires_at: new Date(Date.now() + 900_000), ...o,
});
export const createPending = (t: OrdApp, input: CreatePendingInput) => t.tx.run((tx: Tx) => t.ord.createPending(input, tx));

/** Ba người dùng có phiên: customer A, B, staff, admin. */
export async function people(t: AuthApp): Promise<{ a: Who; b: Who; staff: Who; admin: Who }> {
  return { a: await who(t, 'customer', 'a@x.vn'), b: await who(t, 'customer', 'b@x.vn'), staff: await who(t, 'staff', 'staff@shop.vn'), admin: await who(t, 'admin', 'admin@shop.vn') };
}
/** Câu SQL (đã nối cả mảnh lồng) của các lời gọi `$queryRaw` hay `$executeRaw` mà jest.spyOn thu được; giá trị là tham số `?`, chỉ mảnh SQL lồng được mở ra. */
export const sqlOf = (calls: unknown[][]): string[] => calls.map(([first, ...vals]) => {
  const render = (strings: readonly string[], values: unknown[]): string => strings.reduce((acc, s, i) => acc + s + (i < values.length ? (isSql(values[i]) ? render((values[i] as { strings: string[] }).strings, (values[i] as { values: unknown[] }).values) : '?') : ''), '');
  const isSql = (v: unknown): boolean => !!v && typeof v === 'object' && Array.isArray((v as { strings?: unknown }).strings) && Array.isArray((v as { values?: unknown }).values);
  return isSql(first) ? render((first as { strings: string[] }).strings, (first as { values: unknown[] }).values) : Array.isArray(first) ? render(first as string[], vals) : String(first);
});
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { call, q, who, type Who };

/** Mã SQLSTATE của một thao tác CSDL bị từ chối (qua Prisma raw: `meta.code`), hoặc `ok` nếu thành công. */
export const pgCode = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return 'ok'; } catch (e) { const x = e as { meta?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown }; return String(x.meta?.code ?? x.code ?? x.message); }
};
/** Chèn thẳng một đơn với số tiền tùy ý (bỏ qua createPending) để thử CHECK của CSDL. */
export const insertRaw = (t: AuthApp, user: string, o: { items?: number; discount?: number; shipping?: number; grand?: number; method?: 'vnpay' | 'cod'; expires?: Date | null; handoff?: Date | null; status?: Status; tracking?: string | null } = {}) =>
  t.prisma.$executeRaw`
    INSERT INTO orders (user_id, code, status, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, payment_expires_at, handoff_locked_at, tracking_number)
    VALUES (${user}::uuid, ${code()}, ${o.status ?? 'pending'}::order_status, ${o.items ?? 300000}, ${o.discount ?? 20000}, ${o.shipping ?? 30000}, ${o.grand ?? 310000}, ${JSON.stringify(ADDRESS)}::jsonb, ${randomUUID()}::uuid,
            ${o.method ?? 'cod'}::order_payment_method, ${o.expires === undefined ? null : o.expires}::timestamptz, ${o.handoff ?? null}::timestamptz, ${o.tracking ?? null})`;

/** Gài trigger tạm làm mọi INSERT vào `table` ném lỗi (thử rollback của giao dịch: audit lỗi, lịch sử lỗi); luôn gỡ khi xong. `when` giới hạn dòng (điều kiện SQL trên NEW). */
export async function failingInsert<T>(t: AuthApp, table: string, fn: () => Promise<T>, when = 'TRUE'): Promise<T> {
  const name = `tmp_fail_${table}`;
  await q(t, `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN IF ${when} THEN RAISE EXCEPTION 'tmp failure injected'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await q(t, `CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try { return await fn(); } finally { await q(t, `DROP TRIGGER IF EXISTS ${name} ON ${table}`); await q(t, `DROP FUNCTION IF EXISTS ${name}()`); }
}
/** Chạy hai việc cùng lúc sau một rào, mỗi việc chậm ngẫu nhiên 0 đến 20 ms để tăng xác suất đua; trả kết quả của cả hai. */
export async function race<A, B>(a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> {
  const gate = new Promise<void>((r) => setTimeout(r, 20));
  const run = async <X>(f: () => Promise<X>): Promise<X> => { await gate; await sleep(Math.random() * 20); return f(); };
  return Promise.all([run(a), run(b)]);
}
