import { Injectable } from '@nestjs/common';
import { AppLogger, EventsService, type EventEnvelope, type Tx } from '../platform';
import { UUID_RE } from './db';

const CONSUMER = 'promotion';
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
type Redemption = { id: string; coupon_id: string; status: 'reserved' | 'consumed' | 'released'; amount: bigint };

/**
 * Vòng đời lượt coupon theo event (PRM-REQ-20261006-101036470; PRM-DB mục Giao dịch và khóa 5, 6): tiêu thụ ở OrderConfirmed (COD) và PaymentSucceeded (online), nhả ở OrderCancelled (mọi `reason`) và OrderExpired.
 * Consumer `promotion` của outbox (ADR-011): `EventsService.deliver` chèn ProcessedEvent cùng giao dịch trước khi gọi handler (event trùng thì bỏ qua). Lớp thứ hai là trạng thái lượt (chỉ đúng trạng thái nguồn mới đổi),
 * nên hai event khác `event_id` cho cùng đơn đến sai thứ tự hay đua nhau thì đúng MỘT bên đổi được (K-02). Thứ tự khóa: dòng lượt trước, dòng coupon sau (ADR-012, BR8). Handler là tác nhân `system`: không audit (BR11).
 * Payload sai hình dạng thì bỏ qua có log, không đoán (đóng khi không chắc). Không có endpoint HTTP nhận event (T13).
 */
@Injectable()
export class LifecycleService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, logger: AppLogger) {
    this.log = logger.for('promotion');
  }

  register(): void {
    const on = (type: string, h: (tx: Tx, e: EventEnvelope) => Promise<void>) => this.events.subscribe(CONSUMER, type, h);
    on('PaymentSucceeded', (tx, e) => this.consume(tx, e));
    on('OrderConfirmed', (tx, e) => this.consume(tx, e));
    on('OrderCancelled', (tx, e) => this.release(tx, e));
    on('OrderExpired', (tx, e) => this.release(tx, e));
  }

  private skip(e: EventEnvelope, reason: string, order?: string, level: 'info' | 'warn' = 'info'): void {
    this.log[level]('bỏ qua event của coupon', { event_type: e.type, event_id: e.event_id, order_id: order, reason }); // không ghi payload
  }

  private async lockRedemption(tx: Tx, order: string): Promise<Redemption | null> {
    const [r] = await tx.$queryRaw<Redemption[]>`SELECT id, coupon_id, status::text AS status, amount FROM coupon_redemptions WHERE order_id = ${order}::uuid FOR UPDATE`;
    return r ?? null;
  }

  /** `reserved -> consumed`: tăng `consumed_count`, giảm `reserved_count`, coupon `active` đạt `usage_limit` sang `exhausted`, ghi CouponRedeemed cùng giao dịch (đúng một lần, SB-27). */
  private async consume(tx: Tx, e: EventEnvelope): Promise<void> {
    const order = uuidOf(e.payload.order_id);
    if (!order) return this.skip(e, 'order_id không hợp lệ');
    const r = await this.lockRedemption(tx, order);
    if (!r) return this.skip(e, 'đơn không dùng coupon', order); // đường thường gặp (BR6)
    if (r.status !== 'reserved') return this.skip(e, `lượt đã ở trạng thái ${r.status}`, order, r.status === 'released' ? 'warn' : 'info'); // thanh toán về trễ sau khi nhả (K-02) hoặc thu COD lúc giao: bỏ qua (BR5)
    await tx.$executeRaw`UPDATE coupon_redemptions SET status = 'consumed'::redemption_status, consumed_at = now(), updated_at = now() WHERE id = ${r.id}::uuid AND status = 'reserved'::redemption_status`;
    await tx.$executeRaw`
      UPDATE coupons SET reserved_count = reserved_count - 1, consumed_count = consumed_count + 1,
        status = CASE WHEN status = 'active'::coupon_status AND consumed_count + 1 = usage_limit THEN 'exhausted'::coupon_status ELSE status END, updated_at = now()
      WHERE id = ${r.coupon_id}::uuid`;
    await this.events.publish(tx, { type: 'CouponRedeemed', aggregate_type: 'coupon_redemption', aggregate_id: r.id, payload: { coupon_id: r.coupon_id, order_id: order, amount: Number(r.amount) } }); // `amount` của lượt, không từ payload event
  }

  /** `reserved -> released` (trả `reserved_count`) hoặc `consumed -> released` (trả `consumed_count`; coupon `exhausted` về `active`). Coupon `deleted`, `disabled`, `expired` giữ nguyên `status` nhưng đổi bộ đếm. Không phát event. */
  private async release(tx: Tx, e: EventEnvelope): Promise<void> {
    const order = uuidOf(e.payload.order_id);
    if (!order) return this.skip(e, 'order_id không hợp lệ');
    const r = await this.lockRedemption(tx, order);
    if (!r) return this.skip(e, 'đơn không dùng coupon', order);
    if (r.status === 'released') return this.skip(e, 'lượt đã nhả', order);
    await tx.$executeRaw`UPDATE coupon_redemptions SET status = 'released'::redemption_status, released_at = now(), updated_at = now() WHERE id = ${r.id}::uuid AND status = ${r.status}::redemption_status`;
    if (r.status === 'reserved') await tx.$executeRaw`UPDATE coupons SET reserved_count = reserved_count - 1, updated_at = now() WHERE id = ${r.coupon_id}::uuid`;
    else {
      await tx.$executeRaw`
        UPDATE coupons SET consumed_count = consumed_count - 1, status = CASE WHEN status = 'exhausted'::coupon_status THEN 'active'::coupon_status ELSE status END, updated_at = now()
        WHERE id = ${r.coupon_id}::uuid`;
    }
  }
}
