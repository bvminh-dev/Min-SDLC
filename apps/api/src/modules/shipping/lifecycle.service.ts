import { Injectable } from '@nestjs/common';
import { OrderApi } from '../order';
import { AppLogger, AuditService, Clock, EventsService, type EventEnvelope, type Tx } from '../platform';
import { TRANSITIONS } from './config';
import { UUID_RE, type ShipmentRow, SHIPMENT_COLS } from './db';

const CONSUMER = 'shipping'; // tên module làm `consumer` của ProcessedEvent (như `order`, `inventory`)
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
/** Mã đơn dùng để log: chỉ nhận dạng mã đơn (chữ hoa, số, gạch nối), không bao giờ chép chuỗi lạ từ payload vào log (T22). */
const codeOf = (v: unknown): string | null => (typeof v === 'string' && /^[0-9A-Z-]{1,32}$/.test(v) ? v : null);

/**
 * Tạo và hủy vận đơn theo event của ORD (SHP-REQ ...829, ...950; SHP-DB mục Giao dịch và khóa 4, 5): consumer `shipping` của outbox (ADR-011). `EventsService.deliver` chèn ProcessedEvent cùng
 * giao dịch với handler (event trùng thì bỏ qua). Event không hợp lệ cho trạng thái hiện tại là no-op có log (ProcessedEvent vẫn commit để relay không giao lại mãi); lỗi tạm thời (ORD
 * không đọc được, CSDL lỗi) thì ném để rollback hết và relay giao lại. Payload sai hình dạng thì bỏ qua có log, không ghi payload (đóng khi không chắc).
 */
@Injectable()
export class LifecycleService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, private readonly audit: AuditService, private readonly clock: Clock, private readonly orders: OrderApi, logger: AppLogger) {
    this.log = logger.for('shipping');
  }

  register(): void {
    this.events.subscribe(CONSUMER, 'OrderPaid', (tx, e) => this.created(tx, e));
    this.events.subscribe(CONSUMER, 'OrderConfirmed', (tx, e) => this.created(tx, e));
    this.events.subscribe(CONSUMER, 'OrderCancelled', (tx, e) => this.cancelled(tx, e));
  }

  private skip(e: EventEnvelope, why: string): void {
    this.log.warn('bỏ qua event của vận đơn', { event_type: e.type, event_id: e.event_id, why }); // không ghi payload
  }

  /** OrderPaid hoặc OrderConfirmed: một vận đơn `pending` cho đơn, cùng lịch sử và audit `system`. Hai event hay hai tiến trình cùng đơn: unique một phần trên `order_id` chốt chặn. */
  private async created(tx: Tx, e: EventEnvelope): Promise<void> {
    const orderId = uuidOf(e.payload?.order_id);
    if (!orderId) return this.skip(e, 'order_id không hợp lệ');
    const o = await this.orders.findForShipment(orderId).catch((err) => { // không `tx`, không khóa: kết nối thứ hai trong khi `tx` của giao dịch giao event còn giữ một kết nối (hold-and-wait, nên `DB_POOL_MAX` >= 2, SHP-DB mục Giao dịch và khóa 4); lỗi thì ném, rollback hết và relay giao lại (ADR-011)
      this.log.warn('không đọc được đơn, sẽ giao lại', { code: 'order-read-failed', event_type: e.type, order_id: orderId, err_code: String((err as { code?: unknown })?.code ?? 'unknown') });
      throw err;
    });
    if (!o) { this.log.info('event của đơn không tồn tại', { code: 'order-not-found', event_type: e.type, order_id: orderId }); return; }
    if (o.status !== 'paid' && o.status !== 'confirmed') {
      this.log.warn('không tạo vận đơn: đơn không còn paid hay confirmed', { code: 'order-not-shippable', event_type: e.type, order_code: o.code, status: o.status });
      return;
    }
    const [method] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shipping_methods WHERE id = ${o.shipping_method_id}::uuid`;
    if (!method) { this.log.error('không tạo vận đơn: phương thức vận chuyển của đơn không có', { code: 'shipping-method-missing', event_type: e.type, order_code: o.code }); return; }
    const now = this.clock.now();
    const cod = o.payment_method === 'cod' ? o.grand_total : 0; // số tiền thu hộ do ORD cung cấp, không tính lại ở SHP
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO shipments (order_id, order_code, shipping_method_id, cod_amount, created_at, updated_at)
      VALUES (${o.order_id}::uuid, ${o.code}, ${o.shipping_method_id}::uuid, ${cod}, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING id`;
    if (!row) { this.log.info('đơn đã có vận đơn', { code: 'shipment-exists', event_type: e.type, order_code: o.code }); return; }
    await tx.$executeRaw`
      INSERT INTO shipment_status_history (shipment_id, event, status, created_at) VALUES (${row.id}::uuid, 'status_changed'::shipment_history_event, 'pending'::shipment_status, ${now}::timestamptz)`;
    await this.audit.record(tx, { actor_id: null, actor_role: 'system', action: 'shipping.shipment.create', target_type: 'shipment', target_id: row.id, before: null, after: { status: 'pending' }, reason: e.type });
  }

  /** OrderCancelled: `pending` sang `cancelled` (mọi `reason`, kể cả `stock_commit_failed`); từ `shipped` trở đi chỉ còn dữ liệu lệch: giữ nguyên và log `error`. Không event. */
  private async cancelled(tx: Tx, e: EventEnvelope): Promise<void> {
    const orderId = uuidOf(e.payload?.order_id);
    if (!orderId) return this.skip(e, 'order_id không hợp lệ');
    const code = codeOf(e.payload?.order_code);
    const [s] = await tx.$queryRaw<ShipmentRow[]>`SELECT ${SHIPMENT_COLS} FROM shipments WHERE order_id = ${orderId}::uuid AND status <> 'cancelled'::shipment_status FOR UPDATE`;
    if (!s) { this.log.info('không có vận đơn còn hiệu lực để hủy', { code: 'shipment-none', event_type: e.type, ...(code ? { order_code: code } : { order_id: orderId }) }); return; }
    if (!(TRANSITIONS.cancel.from as readonly string[]).includes(s.status)) {
      this.log.error('đơn bị hủy khi vận đơn đã bàn giao', { code: 'shipment-order-cancelled-mismatch', event_type: e.type, status: s.status, ...(code ? { order_code: code } : { order_id: orderId }) });
      return;
    }
    const now = this.clock.now();
    const [r] = await tx.$queryRaw<ShipmentRow[]>`
      UPDATE shipments SET status = 'cancelled'::shipment_status, version = version + 1, updated_at = ${now}::timestamptz
      WHERE id = ${s.id}::uuid AND status = 'pending'::shipment_status RETURNING ${SHIPMENT_COLS}`;
    if (!r) return; // đã đổi giữa lúc khóa và UPDATE: không xảy ra dưới khóa dòng
    await tx.$executeRaw`
      INSERT INTO shipment_status_history (shipment_id, event, status, created_at) VALUES (${s.id}::uuid, 'status_changed'::shipment_history_event, 'cancelled'::shipment_status, ${now}::timestamptz)`;
    await this.audit.record(tx, { actor_id: null, actor_role: 'system', action: 'shipping.shipment.cancel', target_type: 'shipment', target_id: s.id, before: { status: 'pending' }, after: { status: 'cancelled' }, reason: e.type });
  }
}
