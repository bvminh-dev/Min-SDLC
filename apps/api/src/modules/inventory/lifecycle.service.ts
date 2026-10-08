import { Injectable } from '@nestjs/common';
import { AppLogger, AuditService, EventsService, type EventEnvelope, type Tx } from '../platform';
import { UUID_RE } from './item';
import { LowStockService } from './low-stock.service';

const CONSUMER = 'inventory';
const SYSTEM = { actor_role: 'system' as const };
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
type Line = { stock_item_id: string; quantity: number };
const byItem = (a: Line, b: Line) => a.stock_item_id.localeCompare(b.stock_item_id);

/**
 * Vòng đời reservation theo event (INV-REQ ...562, ...685; INV-DB mục Giao dịch 2 đến 4): chốt (PaymentSucceeded, OrderConfirmed), nhả (OrderCancelled), hoàn về (ShipmentReturned),
 * tạo và khóa bản ghi kho (ProductActivated, ProductArchived). Consumer `inventory` của outbox (ADR-011): `EventsService.deliver` chèn ProcessedEvent cùng giao dịch trước khi gọi handler (event trùng thì bỏ qua).
 * Lớp thứ hai là điều kiện trạng thái nằm trong chính câu UPDATE (`status = 'held'`): hai event khác `event_id` cùng một đơn, job hết hạn, nhả đua nhau thì đúng MỘT bên đổi được dòng
 * (K-02, "một giao dịch thắng"). Mọi đường khóa dòng kho theo `id` tăng dần (ADR-012). Payload sai hình dạng thì bỏ qua có log, không đoán (đóng khi không chắc).
 */
@Injectable()
export class LifecycleService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, private readonly audit: AuditService, private readonly lowStock: LowStockService, logger: AppLogger) {
    this.log = logger.for('inventory');
  }

  register(): void {
    const on = (type: string, h: (tx: Tx, e: EventEnvelope) => Promise<void>) => this.events.subscribe(CONSUMER, type, h);
    on('PaymentSucceeded', (tx, e) => this.paymentSucceeded(tx, e));
    on('OrderConfirmed', (tx, e) => this.orderConfirmed(tx, e));
    on('OrderCancelled', (tx, e) => this.orderCancelled(tx, e));
    on('ShipmentReturned', (tx, e) => this.shipmentReturned(tx, e));
    on('ProductActivated', (tx, e) => this.productActivated(tx, e));
    on('ProductArchived', (tx, e) => this.productArchived(tx, e));
  }

  private skip(e: EventEnvelope, reason: string): void {
    this.log.warn('bỏ qua event của kho', { event_type: e.type, event_id: e.event_id, reason }); // không ghi payload
  }

  private lockOrder(tx: Tx, order: string): Promise<void> {
    return tx.$queryRaw`SELECT id FROM stock_items WHERE id IN (SELECT stock_item_id FROM stock_reservations WHERE order_id = ${order}::uuid) ORDER BY id FOR UPDATE`.then(() => undefined);
  }

  /** Bước đổi `on_hand` của một dòng kho kèm dòng lịch sử cùng loại (chỉ `on_hand` đổi mới ghi lịch sử, INV-DB ghi chú 1). */
  private async move(tx: Tx, item: string, delta: number, type: 'sale' | 'restock', order: string): Promise<void> {
    const [row] = await tx.$queryRaw<{ on_hand: number }[]>`
      UPDATE stock_items SET on_hand = on_hand + ${delta}, version = version + 1, updated_at = now() WHERE id = ${item}::uuid RETURNING on_hand`;
    await tx.$executeRaw`
      INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, ref_type, ref_id, created_at)
      VALUES (${item}::uuid, ${type}::movement_type, ${delta}, ${row.on_hand}, 'order'::movement_ref, ${order}::uuid, clock_timestamp()) ON CONFLICT DO NOTHING`;
  }

  private paymentSucceeded(tx: Tx, e: EventEnvelope): Promise<void> {
    const order = uuidOf(e.payload.order_id);
    if (!order) return Promise.resolve(this.skip(e, 'order_id không hợp lệ'));
    return this.commit(tx, order, 'payment', uuidOf(e.payload.payment_id));
  }
  private orderConfirmed(tx: Tx, e: EventEnvelope): Promise<void> {
    const order = uuidOf(e.payload.order_id);
    if (!order) return Promise.resolve(this.skip(e, 'order_id không hợp lệ'));
    return this.commit(tx, order, 'cod', null);
  }

  /** Chốt: `held` -> `committed`, trừ `on_hand` thật và `reserved` (movement `sale`). Không có dòng `held` thì đọc trạng thái hiện có để biết thua hay no-op. */
  async commit(tx: Tx, order: string, via: 'payment' | 'cod', paymentId: string | null): Promise<void> {
    await this.lockOrder(tx, order);
    const lines = (await tx.$queryRaw<Line[]>`
      UPDATE stock_reservations SET status = 'committed', updated_at = now() WHERE order_id = ${order}::uuid AND status = 'held' RETURNING stock_item_id, quantity`).sort(byItem);
    if (lines.length) {
      for (const l of lines) {
        await tx.$executeRaw`UPDATE stock_items SET reserved = reserved - ${l.quantity} WHERE id = ${l.stock_item_id}::uuid`;
        await this.move(tx, l.stock_item_id, -l.quantity, 'sale', order);
      }
      await this.lowStock.evaluate(tx, lines.map((l) => l.stock_item_id));
      await this.events.publish(tx, { type: 'StockCommitted', aggregate_type: 'order', aggregate_id: order, payload: { order_id: order } });
      return;
    }
    const states = (await tx.$queryRaw<{ status: string }[]>`SELECT status FROM stock_reservations WHERE order_id = ${order}::uuid`).map((r) => r.status);
    if (via === 'cod') { // OrderConfirmed gặp trạng thái không `held`: không làm gì (không phát event)
      if (!states.length) this.log.error('OrderConfirmed của đơn không có reservation', { order_id: order });
      else this.log.info('OrderConfirmed bỏ qua: reservation không còn held', { order_id: order, states });
      return;
    }
    // PaymentSucceeded thua (hoặc đơn không có reservation): không chốt muộn dù còn tồn (K-02), phát StockCommitFailed để PAY hoàn tiền, ORD hủy đơn do hệ thống
    const reason = !states.length ? 'reservation_missing' : states.includes('expired') ? 'reservation_expired' : states.includes('released') ? 'reservation_released' : null;
    if (!reason) { this.log.info('PaymentSucceeded lặp: reservation đã committed (COD thu lúc giao hoặc event trùng)', { order_id: order, payment_id: paymentId }); return; }
    const detail = { order_id: order, payment_id: paymentId, reason };
    if (reason === 'reservation_missing') this.log.error('PaymentSucceeded của đơn không có reservation', detail);
    else this.log.warn('late_payment: thanh toán đến sau khi reservation không còn held', detail);
    await this.audit.record(tx, { ...SYSTEM, action: 'inventory.late_payment', target_type: 'order', target_id: order, after: detail, reason });
    await this.events.publish(tx, { type: 'StockCommitFailed', aggregate_type: 'order', aggregate_id: order, payload: { order_id: order, reason } });
  }

  /** Nhả: `held` -> `released` trả `reserved`; `committed` -> `released` (đơn bị hủy trước khi giao) trả `on_hand` kèm movement `restock`. Hoàn kho không bị trần 10.000.000 chặn. */
  private async orderCancelled(tx: Tx, e: EventEnvelope): Promise<void> {
    const order = uuidOf(e.payload.order_id);
    if (!order) return this.skip(e, 'order_id không hợp lệ');
    await this.lockOrder(tx, order);
    const held = (await tx.$queryRaw<Line[]>`
      UPDATE stock_reservations SET status = 'released', updated_at = now() WHERE order_id = ${order}::uuid AND status = 'held' RETURNING stock_item_id, quantity`).sort(byItem);
    const committed = (await tx.$queryRaw<Line[]>`
      UPDATE stock_reservations SET status = 'released', updated_at = now() WHERE order_id = ${order}::uuid AND status = 'committed' RETURNING stock_item_id, quantity`).sort(byItem);
    if (!held.length && !committed.length) { this.log.info('OrderCancelled bỏ qua: đơn không có reservation đang giữ hay đã chốt', { order_id: order }); return; }
    for (const l of held) await tx.$executeRaw`UPDATE stock_items SET reserved = reserved - ${l.quantity}, updated_at = now() WHERE id = ${l.stock_item_id}::uuid`;
    for (const l of committed) await this.move(tx, l.stock_item_id, l.quantity, 'restock', order);
    await this.lowStock.evaluate(tx, [...held, ...committed].map((l) => l.stock_item_id));
    await this.events.publish(tx, { type: 'StockReleased', aggregate_type: 'order', aggregate_id: order, payload: { order_id: order, reason: 'order_cancelled' } });
  }

  /** Hoàn về: `restockable = true` cộng lại `on_hand` (movement `return` chèn trước nên idempotent theo `shipment_id`); `false` không đổi tồn, chỉ log và audit. Reservation vẫn `committed` (E-20). */
  private async shipmentReturned(tx: Tx, e: EventEnvelope): Promise<void> {
    const order = uuidOf(e.payload.order_id), shipment = uuidOf(e.payload.shipment_id), restockable = e.payload.restockable;
    if (!order || !shipment) return this.skip(e, 'order_id hoặc shipment_id không hợp lệ');
    if (typeof restockable !== 'boolean') return this.skip(e, 'restockable không phải boolean'); // không đoán: đoán sai là sai sổ kho
    await this.lockOrder(tx, order);
    const lines = (await tx.$queryRaw<Line[]>`SELECT stock_item_id, quantity FROM stock_reservations WHERE order_id = ${order}::uuid AND status = 'committed'`).sort(byItem);
    if (!lines.length) { this.log.info('ShipmentReturned bỏ qua: đơn không có reservation đã chốt', { order_id: order, shipment_id: shipment }); return; }
    if (!restockable) {
      this.log.info('return_not_restockable', { order_id: order, shipment_id: shipment });
      await this.audit.record(tx, { ...SYSTEM, action: 'inventory.return_not_restockable', target_type: 'order', target_id: order, after: { shipment_id: shipment } });
      return;
    }
    const changed: string[] = [];
    for (const l of lines) {
      const mv = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, ref_type, ref_id, created_at)
        SELECT id, 'return'::movement_type, ${l.quantity}, on_hand + ${l.quantity}, 'shipment'::movement_ref, ${shipment}::uuid, clock_timestamp() FROM stock_items WHERE id = ${l.stock_item_id}::uuid
        ON CONFLICT DO NOTHING RETURNING id`;
      if (!mv.length) continue; // đã hoàn cho vận đơn này
      await tx.$executeRaw`UPDATE stock_items SET on_hand = on_hand + ${l.quantity}, version = version + 1, updated_at = now() WHERE id = ${l.stock_item_id}::uuid`;
      changed.push(l.stock_item_id);
    }
    await this.lowStock.evaluate(tx, changed);
  }

  /** Tạo bản ghi kho mặc định (on_hand 0, ngưỡng 5, cờ đã cảnh báo). Nhận lại thì không đổi gì; id không có trong `products` bị khóa ngoại từ chối, bắt bằng savepoint rồi bỏ qua có log (BR5). */
  private async productActivated(tx: Tx, e: EventEnvelope): Promise<void> {
    const product = uuidOf(e.payload.product_id);
    if (!product) return this.skip(e, 'product_id không hợp lệ');
    await tx.$executeRaw`SAVEPOINT inv_activate`;
    try {
      const made = await tx.$queryRaw<{ id: string }[]>`INSERT INTO stock_items (product_id) VALUES (${product}::uuid) ON CONFLICT (product_id) DO NOTHING RETURNING id`;
      await tx.$executeRaw`RELEASE SAVEPOINT inv_activate`;
      if (made.length) await this.audit.record(tx, { ...SYSTEM, action: 'inventory.stock_item_create', target_type: 'stock_item', target_id: product, after: { on_hand: 0 } });
    } catch (err) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT inv_activate`;
      await tx.$executeRaw`RELEASE SAVEPOINT inv_activate`;
      if (!/23503|foreign key/i.test(String((err as { message?: unknown; code?: unknown })?.message ?? '') + String((err as { meta?: { code?: unknown } })?.meta?.code ?? ''))) throw err;
      this.skip(e, 'sản phẩm không có trong PRD (khóa ngoại từ chối)');
    }
  }

  /** Khóa bản ghi kho (`archived_at`): chặn nhập kho, giữ hàng; xuất, chốt, hoàn vẫn chạy. Sản phẩm chưa từng có bản ghi (hủy nháp) thì không lỗi. */
  private async productArchived(tx: Tx, e: EventEnvelope): Promise<void> {
    const product = uuidOf(e.payload.product_id);
    if (!product) return this.skip(e, 'product_id không hợp lệ');
    const [it] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_items WHERE product_id = ${product}::uuid FOR UPDATE`;
    if (!it) { this.log.info('ProductArchived của sản phẩm chưa có bản ghi kho (hủy nháp): bỏ qua', { product_id: product }); return; }
    const n = await tx.$executeRaw`UPDATE stock_items SET archived_at = now(), updated_at = now() WHERE id = ${it.id}::uuid AND archived_at IS NULL`;
    if (n === 0) return;
    await this.lowStock.evaluate(tx, [it.id]); // ngừng bán thì hết tồn thấp (cờ về false), không cảnh báo
    await this.audit.record(tx, { ...SYSTEM, action: 'inventory.stock_item_archive', target_type: 'stock_item', target_id: product, after: { archived: true } });
  }
}
