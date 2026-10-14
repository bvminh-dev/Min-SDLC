import { Injectable } from '@nestjs/common';
import { AppLogger, EventsService, type EventEnvelope, type Tx } from '../platform';
import { ARCHIVE_BATCH } from './config';
import { UUID_RE } from './db';

const CONSUMER = 'cart'; // tên module làm `consumer` của ProcessedEvent (như `order`, `inventory`, `shipping`)
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);

/**
 * Vòng đời giỏ theo event (CRT-REQ-20261006-103226614 BR1, BR2; CRT-DB mục Giao dịch và khóa 9, 10): consumer `cart` của outbox (ADR-011), tác nhân `system`, không có endpoint HTTP nhận event (T12).
 * `EventsService.deliver` chèn ProcessedEvent (`consumer` = `cart`, `event_id`) CÙNG giao dịch với handler: giao lại cùng `event_id` thì bỏ qua, tiến trình chết giữa chừng thì cả hai cùng không commit và
 * outbox giao lại (SB-27). Lớp thứ hai là điều kiện trạng thái trong câu UPDATE (`status = 'active'`): event khác `event_id` cho cùng giỏ không đổi gì. Payload sai hình dạng thì bỏ qua có log, không ghi payload.
 */
@Injectable()
export class LifecycleService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, logger: AppLogger) {
    this.log = logger.for('cart');
  }

  register(): void {
    this.events.subscribe(CONSUMER, 'CheckoutCompleted', (tx, e) => this.checkoutCompleted(tx, e));
    this.events.subscribe(CONSUMER, 'ProductArchived', (tx, e) => this.productArchived(tx, e));
  }

  /** CheckoutCompleted (cả vnpay và COD, CRT không đọc `payment_method`): giỏ `active` có `id` = `cart_id` thành `converted`; không có hay không còn `active` thì không làm gì, ghi log, không ném lỗi. Không phát event nào. */
  private async checkoutCompleted(tx: Tx, e: EventEnvelope): Promise<void> {
    const cartId = uuidOf(e.payload?.cart_id), orderId = uuidOf(e.payload?.order_id);
    if (!cartId || !orderId) { this.log.warn('bỏ qua CheckoutCompleted: cart_id hay order_id không hợp lệ', { code: 'event-malformed', event_id: e.event_id }); return; }
    // UPDATE chờ khóa dòng nếu CHK còn giữ `lockForCheckout` của giỏ này; điều kiện trạng thái làm lần giao thứ hai (khác event_id) thành no-op
    const n = await tx.$executeRaw`UPDATE carts SET status = 'converted'::cart_status, converted_order_id = ${orderId}::uuid, updated_at = now() WHERE id = ${cartId}::uuid AND status = 'active'::cart_status`;
    if (n === 0) { this.log.info('CheckoutCompleted không đổi giỏ nào: giỏ không có hoặc không còn active', { code: 'cart-not-active', cart_id: cartId, event_id: e.event_id }); return; }
    this.log.info('giỏ chuyển converted', { code: 'cart-converted', cart_id: cartId });
  }

  /** ProductArchived: mọi dòng của sản phẩm trong giỏ `active` được đánh dấu `product_archived`, chia lô 1000 dòng mỗi câu (chạy lại không đổi thêm gì; số lượng không đổi). Dự phòng khi event mất: mỗi lần xem giỏ vẫn hỏi PRD. */
  private async productArchived(tx: Tx, e: EventEnvelope): Promise<void> {
    const productId = uuidOf(e.payload?.product_id);
    if (!productId) { this.log.warn('bỏ qua ProductArchived: product_id không hợp lệ', { code: 'event-malformed', event_id: e.event_id }); return; }
    let total = 0;
    for (;;) {
      const n = await tx.$executeRaw`
        UPDATE cart_items SET unavailable_reason = 'product_archived', updated_at = now()
        WHERE id IN (
          SELECT i.id FROM cart_items i JOIN carts c ON c.id = i.cart_id
          WHERE i.product_id = ${productId}::uuid AND i.unavailable_reason IS NULL AND c.status = 'active'::cart_status ORDER BY i.id LIMIT ${ARCHIVE_BATCH}
        )`;
      total += n;
      if (n < ARCHIVE_BATCH) break;
    }
    this.log.info('đánh dấu dòng của sản phẩm ngừng bán', { code: 'cart-items-archived', product_id: productId, items: total });
  }
}
