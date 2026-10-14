import { randomUUID } from 'node:crypto';
import { PlatformModule, TransactionService, type Tx } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { OrderApi, OrderModule } from '../../src/modules/order';
import { CancelService } from '../../src/modules/order/cancel.service';
import { LifecycleService as OrderLifecycle } from '../../src/modules/order/lifecycle.service';
import { ShippingApi, ShippingModule } from '../../src/modules/shipping';
import { MethodService } from '../../src/modules/shipping/method.service';
import { ShipmentService } from '../../src/modules/shipping/shipment.service';
import { createAuthApp, q, type AuthApp } from './auth';
import { ADDRESS, insertOrder, type Status as OrderStatus } from './order-fixture';
import { call, who, type Who } from './prd';

export type ShipStatus = 'pending' | 'shipped' | 'delivered' | 'failed' | 'returned' | 'cancelled';
export type FailReason = 'customer_unreachable' | 'refused' | 'wrong_address' | 'damaged' | 'other';
export interface ShpApp extends AuthApp { ord: OrderApi; shp: ShippingApi; tx: TransactionService; life: OrderLifecycle; cancels: CancelService; methods: MethodService; ships: ShipmentService }

/**
 * Ứng dụng thật (PlatformModule + AuthModule + OrderModule + ShippingModule), PostgreSQL thật; pool lớn hơn mặc định test để chạy giao dịch song song thật.
 * Đồng hồ giả đặt về GIỜ THẬT lúc dựng (không mốc ngày cố định): `created_at` ghi theo đồng hồ của ứng dụng, so với `now()` của CSDL.
 */
export async function createShpApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<ShpApp> {
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, OrderModule, ShippingModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16', ...(o.env ?? {}) } });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  return Object.assign(t, {
    ord: t.app.get(OrderApi), shp: t.app.get(ShippingApi), tx: t.app.get(TransactionService), life: t.app.get(OrderLifecycle), cancels: t.app.get(CancelService),
    methods: t.app.get(MethodService), ships: t.app.get(ShipmentService),
  });
}
export { call, q, who, type Who, ADDRESS };

export interface SeedMethod { name?: string; fee?: number; freeOver?: number | null; surcharge?: number; cities?: string[]; active?: boolean; version?: number; createdAt?: Date }
let methodCounter = 0;
/** Phương thức dựng thẳng trong CSDL (fixture, không qua API). */
export async function seedMethod(t: AuthApp, o: SeedMethod = {}): Promise<string> {
  const rule = { free_over: o.freeOver === undefined ? null : o.freeOver, surcharge: o.surcharge ?? 0, surcharge_cities: o.cities ?? [] };
  const at = o.createdAt ?? t.clock.now();
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO shipping_methods (name, base_fee, rule, is_active, version, created_at, updated_at)
    VALUES (${o.name ?? `Phương thức ${++methodCounter}-${randomUUID().slice(0, 6)}`}, ${o.fee ?? 30000}, ${JSON.stringify(rule)}::jsonb, ${o.active ?? true}, ${o.version ?? 1}, ${at}::timestamptz, ${at}::timestamptz) RETURNING id`;
  return r.id;
}

const ORDER_OF: Record<ShipStatus, OrderStatus> = { pending: 'paid', shipped: 'shipped', failed: 'shipped', delivered: 'delivered', returned: 'returned', cancelled: 'cancelled' };
export interface SeedShipment {
  user?: string; order?: { id: string; code: string; user: string }; orderStatus?: OrderStatus; orderCode?: string; method?: string; status?: ShipStatus; tracking?: string | null; cod?: number; payment?: 'vnpay' | 'cod';
  createdAt?: Date; reason?: FailReason; note?: string | null; version?: number; handoff?: Date | null; noHistory?: boolean; address?: Record<string, string>;
  /** Đơn không có dòng lịch sử (để thử ON DELETE RESTRICT của chính vận đơn, không bị lịch sử của đơn chặn thay). */
  bareOrder?: boolean;
  /** Vận đơn "có sẵn từ trước migration order_code": cột `order_code` để rỗng (để thử câu backfill). */
  legacyNoOrderCode?: boolean;
}
export interface SeededShipment { id: string; order: { id: string; code: string; user: string }; method: string; tracking: string | null }
let trackingCounter = 0;
/** Mã vận đơn hợp lệ, duy nhất trong một lần chạy test. */
export const trackingOf = (): string => `TRK${String(Date.now()).slice(-6)}${String(++trackingCounter).padStart(4, '0')}`;
/**
 * Vận đơn dựng thẳng trong CSDL (fixture, không qua event): đơn (nếu chưa có) cùng trạng thái khớp, cột kèm theo cho khớp CHECK, lịch sử theo đường đi hợp lệ tới `status`
 * (mỗi dòng cách nhau một phút từ `createdAt`). Mặc định phương thức riêng mới, chủ đơn là một customer mới.
 */
export async function seedShipment(t: AuthApp, o: SeedShipment = {}): Promise<SeededShipment> {
  const status = o.status ?? 'pending';
  const payment = o.payment ?? (status === 'pending' && o.orderStatus === 'confirmed' ? 'cod' : 'vnpay');
  const order = o.order ?? await (async () => {
    const user = o.user ?? (await who(t, 'customer', `c-${randomUUID().slice(0, 8)}@x.vn`)).id;
    const os = o.orderStatus ?? ORDER_OF[status];
    return insertOrder(t.prisma, t.clock.now(), { user, status: os, method: payment, code: o.orderCode, tracking: null, handoff: o.handoff, address: o.address, noHistory: o.bareOrder, payment: undefined, shipping: 30000, ...(os === 'confirmed' ? { payment: 'pending' as const } : {}) });
  })();
  const method = o.method ?? await seedMethod(t);
  const tracking = o.tracking !== undefined ? o.tracking : status === 'pending' || status === 'cancelled' ? null : trackingOf();
  const created = o.createdAt ?? new Date(t.clock.now().getTime() - 3600_000);
  const at = (i: number) => new Date(created.getTime() + i * 60_000);
  const path: ShipStatus[] = { pending: ['pending'], shipped: ['pending', 'shipped'], delivered: ['pending', 'shipped', 'delivered'], failed: ['pending', 'shipped', 'failed'], returned: ['pending', 'shipped', 'failed', 'returned'], cancelled: ['pending', 'cancelled'] }[status] as ShipStatus[];
  const shippedAt = path.includes('shipped') ? at(1) : null;
  const deliveredAt = status === 'delivered' ? at(2) : null;
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO shipments (order_id, order_code, shipping_method_id, status, tracking_number, cod_amount, shipped_at, delivered_at, version, created_at, updated_at)
    VALUES (${order.id}::uuid, ${o.legacyNoOrderCode ? null : order.code}, ${method}::uuid, ${status}::shipment_status, ${tracking}, ${o.cod ?? 0}, ${shippedAt}::timestamptz, ${deliveredAt}::timestamptz, ${o.version ?? (path.length)}, ${created}::timestamptz, ${at(path.length - 1)}::timestamptz) RETURNING id`;
  if (!o.noHistory) {
    for (const [i, st] of path.entries()) {
      const failed = st === 'failed';
      await t.prisma.$executeRaw`
        INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number, reason_code, note, created_at)
        VALUES (${r.id}::uuid, 'status_changed'::shipment_history_event, ${st}::shipment_status, ${st === 'shipped' || st === 'delivered' || st === 'failed' || st === 'returned' ? tracking : null},
                ${failed ? (o.reason ?? 'customer_unreachable') : null}::shipment_fail_reason, ${failed ? (o.note ?? null) : null}, ${at(i)}::timestamptz)`;
    }
  }
  return { id: r.id, order, method, tracking };
}

export const shipmentRow = async (t: AuthApp, id: string) =>
  (await q<{ id: string; order_id: string; status: ShipStatus; tracking_number: string | null; cod_amount: string; shipped_at: Date | null; delivered_at: Date | null; version: number; shipping_method_id: string; created_at: Date; updated_at: Date }>(
    t, `SELECT id, order_id, status::text AS status, tracking_number, cod_amount::text AS cod_amount, shipped_at, delivered_at, version, shipping_method_id, created_at, updated_at FROM shipments WHERE id = '${id}'`))[0];
export const shipmentsOfOrder = (t: AuthApp, orderId: string) =>
  q<{ id: string; status: ShipStatus; tracking_number: string | null; cod_amount: string; version: number }>(t, `SELECT id, status::text AS status, tracking_number, cod_amount::text AS cod_amount, version FROM shipments WHERE order_id = '${orderId}' ORDER BY created_at, id`);
export const histOf = (t: AuthApp, shipmentId: string) =>
  q<{ seq: string; event: string; status: ShipStatus; tracking_number: string | null; reason_code: string | null; note: string | null; created_at: Date }>(
    t, `SELECT seq::text AS seq, event::text AS event, status::text AS status, tracking_number, reason_code::text AS reason_code, note, created_at FROM shipment_status_history h WHERE shipment_id = '${shipmentId}' ORDER BY h.seq`);
export const shpOutbox = (t: AuthApp, shipmentId?: string) =>
  q<{ id: string; type: string; aggregate_type: string; aggregate_id: string; payload: any; dispatched_at: Date | null }>(
    t, `SELECT id, type, aggregate_type, aggregate_id, payload, dispatched_at FROM outbox_events WHERE type LIKE 'Shipment%' ${shipmentId ? `AND aggregate_id = '${shipmentId}'` : ''} ORDER BY occurred_at, id`);
export const shpAudits = (t: AuthApp, targetId?: string, like = 'shipping.%') =>
  q<{ actor_id: string | null; actor_role: string; action: string; target_type: string; target_id: string; before: any; after: any; reason: string | null }>(
    t, `SELECT actor_id, actor_role, action, target_type, target_id, before, after, reason FROM audit_logs WHERE action LIKE '${like}' ${targetId ? `AND target_id = '${targetId}'` : ''} ORDER BY created_at, id`);
export const countOf = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
/** Ảnh chụp số dòng của mọi bảng SHP và outbox, audit (để khẳng định "không đổi gì"). */
export const snapshotCounts = async (t: AuthApp): Promise<number[]> =>
  [await countOf(t, 'shipments'), await countOf(t, 'shipment_status_history'), await countOf(t, 'shipping_methods'), await countOf(t, 'outbox_events'), await countOf(t, 'audit_logs'), await countOf(t, 'processed_events')];

/** Bàn giao qua HTTP. */
export const shipVia = (t: AuthApp, cookie: string | undefined, code: string, tracking: unknown, extra: Record<string, unknown> = {}) =>
  call(t, 'post', `/shipping/orders/${code}/shipment/ship`, { cookie, body: { tracking_number: tracking, ...extra } });
export const act = (t: AuthApp, cookie: string | undefined, code: string, action: 'deliver' | 'fail' | 'return', body: unknown = {}) =>
  call(t, 'post', `/shipping/orders/${code}/shipment/${action}`, { cookie, body });
/** Giao một event của ORD (OrderPaid, OrderConfirmed, OrderCancelled) cho mọi consumer qua cùng đường như relay; `eventId` để thử giao lại cùng event. */
export { deliver } from './ord';
/** Đơn dựng thẳng (fixture) dùng cho test tạo vận đơn bằng event. */
export const seedOrderFor = (t: AuthApp, o: { user?: string; status?: OrderStatus; method?: 'vnpay' | 'cod'; shippingMethod?: string; total?: number; code?: string } = {}) => (async () => {
  const user = o.user ?? (await who(t, 'customer', `c-${randomUUID().slice(0, 8)}@x.vn`)).id;
  const ord = await insertOrder(t.prisma, t.clock.now(), { user, status: o.status ?? 'paid', method: o.method, code: o.code });
  if (o.shippingMethod) await t.prisma.$executeRaw`UPDATE orders SET shipping_method_id = ${o.shippingMethod}::uuid WHERE id = ${ord.id}::uuid`;
  return ord;
})();
/** Chạy `fn` trong một giao dịch của ứng dụng (ví dụ để gọi `lockForHandoff` hay giữ khóa dòng). */
export const inTx = <T>(t: ShpApp, fn: (tx: Tx) => Promise<T>): Promise<T> => t.tx.run(fn);
/** Hai việc cùng lúc sau một rào, mỗi việc chậm ngẫu nhiên 0 đến 20 ms để tăng xác suất đua. */
export { race, pgCode, sleep, failingInsert } from './ord';
