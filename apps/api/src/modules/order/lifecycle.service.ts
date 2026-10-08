import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger, AuditService, Clock, EventsService, type EventEnvelope, type Tx } from '../platform';
import { COMMIT_FAILED_REASONS, FAILURE_REASONS } from './config';
import { UUID_RE, lockById, type Actor, type OrderRow, type PaymentStatus } from './row';
import { TransitionService } from './transition.service';

const CONSUMER = 'order'; // tên module làm `consumer` của ProcessedEvent (như `inventory`, `promotion`)
const SYSTEM: Actor = { id: null, role: 'system' };
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
const dateOf = (v: unknown): Date | null => { if (typeof v !== 'string') return null; const d = new Date(v); return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 9999 ? null : d; }; // ngoài miền thì coi như không có (Prisma không ghi được, event sẽ bị giao lại mãi)
const trackingOf = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= 100 && !/\p{Cs}/u.test(v) ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Cột `payment_status` được phép đổi TỪ (ORD-DB mục Giao dịch và khóa 3, theo vòng đời Payment ở entities.md). */
const PAY_FROM: Record<'succeeded' | 'failed' | 'expired' | 'refunded', readonly PaymentStatus[]> = {
  succeeded: ['pending', 'processing', 'failed', 'cancelled'],
  failed: ['pending', 'processing', 'failed'],
  expired: ['pending', 'processing', 'failed'],
  refunded: ['succeeded'],
};
const CANCEL_COLS = (reason: 'payment_failed' | 'stock_commit_failed') => Prisma.sql`, cancel_reason = ${reason}::order_cancel_reason, cancelled_by_role = 'system'::order_actor_role`;
/** Hủy hệ thống do hết hàng giữ chỗ: payment_status tự đặt như hủy của người dùng (ORD-DB mục 2); `succeeded` giữ cho tới PaymentRefunded. */
const PAYMENT_CANCELLED = Prisma.sql`, payment_status = CASE WHEN payment_status IN ('pending', 'processing', 'failed') THEN 'cancelled'::order_payment_status ELSE payment_status END`;

/**
 * Chuyển trạng thái đơn theo event của PAY, INV, SHP (ORD-REQ ...790; ORD-DB mục Giao dịch và khóa 1, 3): consumer `order` của outbox (ADR-011).
 * `EventsService.deliver` chèn ProcessedEvent cùng giao dịch trước khi gọi handler (event trùng thì bỏ qua); handler khóa dòng đơn (`FOR UPDATE`), kiểm trạng thái hiện tại
 * trong cột Từ của bảng chuyển, rồi `UPDATE ... WHERE status = :cũ`, một dòng lịch sử và OutboxEvent cùng giao dịch. Chuyển không hợp lệ là no-op có log
 * (ProcessedEvent vẫn commit để event không bị xử lý lại); đơn không có thì log và dừng. Payload sai hình dạng thì bỏ qua có log (đóng khi không chắc).
 */
@Injectable()
export class LifecycleService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, private readonly transitions: TransitionService, private readonly audit: AuditService, private readonly clock: Clock, logger: AppLogger) {
    this.log = logger.for('order');
  }

  register(): void {
    const on = (type: string, h: (tx: Tx, e: EventEnvelope, o: OrderRow) => Promise<void>) => this.events.subscribe(CONSUMER, type, (tx, e) => this.withOrder(tx, e, h));
    on('PaymentSucceeded', (tx, e, o) => this.paymentSucceeded(tx, e, o));
    on('PaymentFailed', (tx, e, o) => this.paymentFailed(tx, e, o));
    on('PaymentExpired', (tx, e, o) => this.paymentStatusOnly(tx, e, o, 'expired'));
    on('PaymentRefunded', (tx, e, o) => this.paymentStatusOnly(tx, e, o, 'refunded'));
    on('StockReservationExpired', (tx, e, o) => this.reservationExpired(tx, e, o));
    on('StockCommitFailed', (tx, e, o) => this.stockCommitFailed(tx, e, o));
    on('ShipmentShipped', (tx, e, o) => this.shipped(tx, e, o));
    on('ShipmentTrackingChanged', (tx, e, o) => this.trackingChanged(tx, e, o));
    on('ShipmentDelivered', (tx, e, o) => this.delivered(tx, e, o));
    on('ShipmentFailed', (tx, e, o) => this.deliveryFailed(tx, e, o));
    on('ShipmentReturned', (tx, e, o) => this.returned(tx, e, o));
  }

  private skip(e: EventEnvelope, why: string): void {
    this.log.warn('bỏ qua event của đơn', { event_type: e.type, event_id: e.event_id, why }); // không ghi payload
  }
  private reject(o: OrderRow, e: EventEnvelope, to: string): void { this.transitions.rejected(o, e.type, to); }

  private async withOrder(tx: Tx, e: EventEnvelope, fn: (tx: Tx, e: EventEnvelope, o: OrderRow) => Promise<void>): Promise<void> {
    const id = uuidOf(e.payload?.order_id); // payload rỗng hay không phải đối tượng: bỏ qua có log, không ném (event độc không bị giao lại tới hết lượt thử)
    if (!id) return this.skip(e, 'order_id không hợp lệ');
    const o = await lockById(tx, id);
    if (!o) { this.log.warn('event của đơn không tồn tại', { event_type: e.type, order_id: id }); return; } // không dựng đơn mồ côi (lệch thứ tự event chưa có thiết kế, ORD-SEC Rủi ro còn lại)
    try {
      await fn(tx, e, o);
    } catch (err) {
      // giao dịch rollback và event được giao lại (ADR-011); log chỉ mã đơn và mã lỗi CSDL, không thông điệp lỗi (có thể mang tham số)
      this.log.error('xử lý event của đơn thất bại, sẽ giao lại', { event_type: e.type, order_code: o.code, err_code: String((err as { meta?: { code?: unknown }; code?: unknown })?.meta?.code ?? (err as { code?: unknown })?.code ?? 'unknown') });
      throw err;
    }
  }

  /** `payment_status` chỉ đổi khi trạng thái hiện tại thuộc cột Từ; ngược lại no-op có log (event lệch thứ tự, PaymentFailed lần hai khi ORD đã giữ `failed` vẫn hợp lệ). */
  private async setPayment(tx: Tx, e: EventEnvelope, o: OrderRow, to: keyof typeof PAY_FROM, extra: Prisma.Sql = Prisma.empty): Promise<boolean> {
    const from = PAY_FROM[to];
    const n = await tx.$executeRaw(Prisma.sql`
      UPDATE orders SET payment_status = ${to}::order_payment_status, updated_at = ${this.clock.now()}::timestamptz${extra}
      WHERE id = ${o.id}::uuid AND payment_status IN (${Prisma.join(from.map((s) => Prisma.sql`${s}::order_payment_status`))})`);
    if (n === 0) this.log.warn('payment_status không đổi: chuyển không hợp lệ', { code: 'transition-rejected', source: e.type, order_code: o.code, from: o.payment_status, to });
    return n > 0;
  }

  private paymentStatusOnly(tx: Tx, e: EventEnvelope, o: OrderRow, to: 'expired' | 'refunded'): Promise<void> {
    return this.setPayment(tx, e, o, to).then(() => undefined);
  }

  /** Đơn online `pending -> paid` (OrderPaid); COD chỉ cập nhật `payment_status`, `paid_at` (thu sau giao, V-10) nên không có chuyển trạng thái bị từ chối. */
  private async paymentSucceeded(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    const paidAt = dateOf(e.payload.paid_at) ?? this.clock.now();
    const pay = Prisma.sql`, paid_at = ${paidAt}::timestamptz`;
    if (o.payment_method === 'vnpay' && o.status === 'pending') {
      const set = Prisma.sql`, payment_status = 'succeeded'::order_payment_status${pay}`;
      await this.transitions.move(tx, o, 'paid', { actor: SYSTEM, now: this.clock.now(), set, event: { type: 'OrderPaid', payload: { order_id: o.id, paid_at: paidAt.toISOString() } } });
      return;
    }
    if (o.payment_method === 'vnpay') this.reject(o, e, 'paid'); // đơn đã hủy, hết hạn, đã paid hoặc xa hơn: giữ `status`, chỉ phản ánh thanh toán
    await this.setPayment(tx, e, o, 'succeeded', pay);
  }

  /** Chỉ `is_final` quyết định hủy (K-03b); `attempt_no` không được dùng (ORD không biết hằng số lượt thử). Đơn không `pending` thì chỉ ghi log từ chối. */
  private async paymentFailed(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    await this.setPayment(tx, e, o, 'failed');
    if (e.payload.is_final !== true) return;
    if (o.status !== 'pending') return this.reject(o, e, 'cancelled');
    await this.cancelBySystem(tx, o, 'payment_failed', Prisma.empty);
  }

  private async reservationExpired(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    if (o.status !== 'pending') return this.reject(o, e, 'expired');
    await this.transitions.move(tx, o, 'expired', { actor: SYSTEM, now: this.clock.now(), event: { type: 'OrderExpired', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id } } });
  }

  /** `pending` hoặc `paid` thì hủy do hệ thống (M-04, R-02); ba mã `reason` xử lý như nhau. Trạng thái khác (cả đã đóng) là no-op có log. Cờ bàn giao không chặn (R-04). */
  private async stockCommitFailed(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    const reason = e.payload.reason;
    if (!oneOf(COMMIT_FAILED_REASONS, reason)) return this.skip(e, 'reason không hợp lệ');
    if (o.status !== 'pending' && o.status !== 'paid') {
      this.log.info('StockCommitFailed là no-op: đơn không còn pending hay paid', { event_type: e.type, order_code: o.code, status: o.status, reason });
      return;
    }
    await this.cancelBySystem(tx, o, 'stock_commit_failed', PAYMENT_CANCELLED);
  }

  /** Hủy do hệ thống: người hủy `system`, audit cùng giao dịch (lỗi audit làm rollback cả hủy, SB-19), một OrderCancelled (`was_paid` theo trạng thái đọc dưới khóa). */
  private async cancelBySystem(tx: Tx, o: OrderRow, reason: 'payment_failed' | 'stock_commit_failed', extra: Prisma.Sql): Promise<void> {
    const wasPaid = o.status === 'paid';
    const moved = await this.transitions.move(tx, o, 'cancelled', {
      actor: SYSTEM, now: this.clock.now(), reason, set: Prisma.sql`${CANCEL_COLS(reason)}${extra}`,
      event: { type: 'OrderCancelled', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id, reason, was_paid: wasPaid } },
    });
    if (!moved) return;
    await this.audit.record(tx, { actor_id: null, actor_role: 'system', action: 'order.cancel', target_type: 'order', target_id: o.id, before: { status: o.status }, after: { status: 'cancelled' }, reason });
  }

  private async shipped(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    const tracking = trackingOf(e.payload.tracking_number);
    if (!tracking) return this.skip(e, 'tracking_number không hợp lệ');
    if (o.status !== 'paid' && o.status !== 'confirmed') return this.reject(o, e, 'shipped');
    await this.transitions.move(tx, o, 'shipped', {
      actor: SYSTEM, now: this.clock.now(), set: Prisma.sql`, tracking_number = ${tracking}`,
      event: { type: 'OrderShipped', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id, tracking_number: tracking } },
    });
  }

  /** Bản sao `tracking_number` cập nhật cả khi đơn đã `delivered` hay `returned` (outbox giao trễ); đơn chưa từng giao thì CHECK không cho, ghi log. Không lịch sử, không event. */
  private async trackingChanged(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    const tracking = trackingOf(e.payload.tracking_number);
    if (!tracking) return this.skip(e, 'tracking_number không hợp lệ');
    const n = await tx.$executeRaw`
      UPDATE orders SET tracking_number = ${tracking}, updated_at = ${this.clock.now()}::timestamptz WHERE id = ${o.id}::uuid AND status IN ('shipped', 'delivered', 'returned')`;
    if (n === 0) this.reject(o, e, 'tracking_number');
  }

  private async delivered(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    if (o.status !== 'shipped') return this.reject(o, e, 'delivered');
    const now = this.clock.now(); // payload không mang giờ: `delivered_at` là giờ xử lý của ORD
    await this.transitions.move(tx, o, 'delivered', {
      actor: SYSTEM, now, set: Prisma.sql`, delivered_at = ${now}::timestamptz`,
      event: { type: 'OrderDelivered', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id, delivered_at: now.toISOString() } },
    });
  }

  /** ShipmentFailed: đơn vẫn `shipped`, chỉ một dòng lịch sử tự trỏ mang mã lý do (K-03c); không có event. Nhận lại cùng event là no-op nhờ ProcessedEvent. */
  private async deliveryFailed(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    const reason = e.payload.reason;
    if (!oneOf(FAILURE_REASONS, reason)) return this.skip(e, 'reason không hợp lệ');
    if (o.status !== 'shipped') return this.reject(o, e, 'shipped');
    await this.transitions.history(tx, o.id, 'shipped', 'shipped', SYSTEM, this.clock.now(), reason);
  }

  private async returned(tx: Tx, e: EventEnvelope, o: OrderRow): Promise<void> {
    if (o.status !== 'shipped') return this.reject(o, e, 'returned');
    await this.transitions.move(tx, o, 'returned', { actor: SYSTEM, now: this.clock.now(), event: { type: 'OrderReturned', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id } } });
  }
}
