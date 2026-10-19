import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger, AuditService, EventsService, type EventEnvelope, type Tx } from '../platform';
import { OrderApi } from '../order';
import { PaymentCore, uuidOf } from './core.service';
import type { PaymentRow } from './db';
import { winningAttempt, RefundService } from './refund.service';
import type { RefundReason } from './config';

const ORDER_CODE_RE = /^(HD[0-9]{6}-[0-9]{5}|[0-9A-HJKMNP-TV-Z]{12})$/; // mã mới HDyymmdd-NNNNN hoặc mã cũ 12 ký tự (ADR-024); khớp CHECK `payments_order_code_format`
const METHODS_IN = ['vnpay', 'cod', 'cash', 'bank_transfer'] as const; // payment_method của OrderCreated
const CONSUMER = 'payment'; // tên module làm `consumer` của ProcessedEvent (như `order`, `shipping`)
const COMMIT_FAILED_REASONS = ['reservation_expired', 'reservation_released', 'reservation_missing'] as const;
const dateOf = (v: unknown): Date | null => { if (typeof v !== 'string') return null; const d = new Date(v); return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 9999 ? null : d; };
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Consumer `payment` của outbox (ADR-011; PAY-REQ ...331, ...597 BR3, ...858, ...946 BR10): OrderCreated, OrderExpired, OrderCancelled, OrderDelivered, OrderReturned, StockCommitFailed. `EventsService.deliver` chèn
 * ProcessedEvent cùng giao dịch với handler (event trùng thì bỏ qua); handler idempotent theo trạng thái: event không hợp lệ cho trạng thái hiện tại là no-op có log (ProcessedEvent vẫn commit để relay không giao lại
 * mãi); lỗi tạm thời (ORD không đọc được, CSDL lỗi) thì ném để rollback hết và relay giao lại. Payload sai hình dạng thì bỏ qua có log, không ghi payload (đóng khi không chắc). Không endpoint HTTP nào nhận event (T9).
 */
@Injectable()
export class LifecycleService {
  private readonly log: AppLogger;
  constructor(
    private readonly events: EventsService, private readonly core: PaymentCore, private readonly orders: OrderApi, private readonly refunds: RefundService, private readonly audit: AuditService, logger: AppLogger,
  ) {
    this.log = logger.for('payment');
  }

  register(): void {
    this.events.subscribe(CONSUMER, 'OrderCreated', (tx, e) => this.created(tx, e));
    this.events.subscribe(CONSUMER, 'OrderExpired', (tx, e) => this.closing(tx, e, 'expire'));
    this.events.subscribe(CONSUMER, 'OrderCancelled', (tx, e) => this.closing(tx, e, 'cancel'));
    this.events.subscribe(CONSUMER, 'OrderDelivered', (tx, e) => this.delivered(tx, e));
    this.events.subscribe(CONSUMER, 'OrderReturned', (tx, e) => this.returned(tx, e));
    this.events.subscribe(CONSUMER, 'StockCommitFailed', (tx, e) => this.commitFailed(tx, e));
  }

  private skip(e: EventEnvelope, why: string): void {
    this.log.warn('bỏ qua event của thanh toán', { event_type: e.type, event_id: e.event_id, why }); // không ghi payload
  }
  private info(code: string, e: EventEnvelope, p?: Pick<PaymentRow, 'order_code'> | null, extra: Record<string, unknown> = {}): void {
    this.log.info(code, { code, event_type: e.type, ...(p ? { order_code: p.order_code } : { order_id: uuidOf(e.payload?.order_id) }), ...extra });
  }
  /** OrderCreated: một Payment `pending` cho mỗi đơn; `amount` và hạn sao nguyên từ event, PAY không tự tính (BR1, BR6). Đơn 0 đồng không có Payment (R-03); đơn đã `cancelled` hay `expired` thì không tạo (BR9). */
  private async created(tx: Tx, e: EventEnvelope): Promise<void> {
    const pl = e.payload ?? {};
    const orderId = uuidOf(pl.order_id), code = typeof pl.order_code === 'string' ? pl.order_code : null; // không đổi chữ hoa: mã đơn của ORD đã chuẩn hóa (đổi hoa trước khi kiểm khuôn làm `ſ` thành `S` lọt khuôn, L90)
    const method = pl.payment_method, total = pl.grand_total;
    const ho = pl.user_id == null || pl.user_id === ''; // đơn hộ của khách không tài khoản (ADR-026): không có `user_id`
    const userId = ho ? null : uuidOf(pl.user_id);
    if (!orderId || (!ho && !userId) || !code || !ORDER_CODE_RE.test(code) || (ho && method === 'vnpay') || !(METHODS_IN as readonly unknown[]).includes(method) || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return this.skip(e, 'payload OrderCreated không hợp lệ');
    // ADR-026: `cash`, `bank_transfer` của đơn hộ coi như COD nhưng PAY không tạo Payment (tiền thu ghi nhận ngoài PAY, SAL-SEC T16); đơn hộ không `user_id` cũng không có Payment (cột `user_id` NOT NULL, không đường cổng thanh toán)
    if (method === 'cash' || method === 'bank_transfer' || !userId) { this.log.info('không tạo thanh toán: đơn hộ', { code: 'payment-skipped-ho', order_code: code, method }); return; }
    if (total === 0) { this.log.info('không tạo thanh toán: đơn 0 đồng', { code: 'payment-skipped-zero-total', order_code: code }); return; }
    const expires = method === 'vnpay' ? dateOf(pl.payment_expires_at) : null;
    if (method === 'vnpay' && !expires) return this.skip(e, 'đơn online thiếu payment_expires_at');
    const o = await this.orders.findForPayment(orderId).catch((err) => { // không `tx`, không khóa: kết nối thứ hai trong khi `tx` của giao dịch giao event còn giữ một kết nối (hold-and-wait, `DB_POOL_MAX` >= 2); lỗi thì ném, rollback hết và relay giao lại (ADR-011)
      this.log.error('không tạo được thanh toán: không đọc được đơn, sẽ giao lại', { code: 'payment-create-failed', event_type: e.type, order_id: orderId, err_code: String((err as { code?: unknown })?.code ?? 'unknown') });
      throw err;
    });
    if (!o) { this.log.warn('event của đơn không tồn tại', { code: 'order-not-found', event_type: e.type, order_id: orderId }); return; }
    if (o.status === 'cancelled' || o.status === 'expired') { this.log.info('không tạo thanh toán: đơn đã đóng', { code: 'order-closed', order_code: code, status: o.status }); return; }
    const now = this.core.now();
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO payments (order_id, order_code, user_id, amount, method, expires_at, created_at, updated_at)
      VALUES (${orderId}::uuid, ${code}, ${userId}::uuid, ${total}, ${method}::payment_method, ${expires}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (order_id) DO NOTHING RETURNING id`;
    if (!row) this.log.info('đơn đã có thanh toán', { code: 'payment-exists', order_code: code });
  }

  /** OrderExpired, OrderCancelled: Payment mở thì đóng (`expired` kèm PaymentExpired, `cancelled` không event); Payment `succeeded` thì hoàn tiền theo trạng thái Payment chứ không theo `was_paid` (BR3). */
  private async closing(tx: Tx, e: EventEnvelope, kind: 'expire' | 'cancel'): Promise<void> {
    const orderId = uuidOf(e.payload?.order_id);
    if (!orderId) return this.skip(e, 'order_id không hợp lệ');
    const p = await this.core.lockByOrder(tx, orderId);
    if (!p) { this.log.warn('event đóng cho đơn không có thanh toán', { code: 'payment-none', event_type: e.type, order_id: orderId }); return; }
    const stockCommit = kind === 'cancel' && e.payload.reason === 'stock_commit_failed';
    if (p.status === 'pending' || p.status === 'processing' || p.status === 'failed') {
      await this.core.move(tx, p, kind);
      return;
    }
    if (p.status === 'succeeded') {
      if (stockCommit) { await this.alreadyRefunded(tx, e, p); return; } // ORD tự hủy đơn `paid` sau StockCommitFailed: Refund `late_payment` đã là hoàn tiền duy nhất (BR9)
      if (kind === 'cancel' && e.payload.was_paid === false) this.log.warn('Payment đã thu tiền nhưng đơn báo chưa thanh toán', { code: 'paid-but-was-paid-false', order_code: p.order_code });
      await this.autoRefund(tx, e, p, kind === 'cancel' ? 'order_cancelled' : 'order_expired');
      return;
    }
    if (stockCommit && p.status === 'refunded') { this.info('refund-already-created', e, p); return; }
    this.info('payment-already-closed', e, p, { status: p.status });
  }

  private async alreadyRefunded(tx: Tx, e: EventEnvelope, p: PaymentRow): Promise<void> {
    const a = await winningAttempt(tx, p);
    const [r] = a ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM refunds WHERE attempt_id = ${a.id}::uuid` : [];
    if (r) this.info('refund-already-created', e, p);
    else this.log.warn('Payment đã thu tiền, đơn bị hủy do StockCommitFailed nhưng chưa có Refund để đối soát', { code: 'refund-missing', order_code: p.order_code }); // không tự tạo: StockCommitFailed là nguồn tạo Refund
  }

  /** Hoàn tiền tự động cho giao dịch của chính Payment `succeeded` (online); COD không có hoàn tiền tự động (BR7). */
  private async autoRefund(tx: Tx, e: EventEnvelope, p: PaymentRow, reason: RefundReason): Promise<void> {
    if (p.method === 'cod') { this.log.info('Payment COD đã thu tiền: hoàn tiền tự động chưa hỗ trợ', { code: 'cod-refund-unsupported', order_code: p.order_code }); return; }
    const a = await winningAttempt(tx, p);
    if (!a) { this.log.error('Payment succeeded không có lượt thử thắng để hoàn tiền', { code: 'refund-attempt-missing', order_code: p.order_code }); return; }
    const r = await this.refunds.create(tx, p, a, reason, { id: null, role: 'system' });
    if (r) this.refunds.dispatchSoon(r.id); // gọi cổng NGOÀI giao dịch giao event (SB-31): chờ dòng Refund commit rồi mới gọi, giao dịch rollback thì không có gì để gọi; mất tiến trình thì job đối soát nhặt lại sau 5 phút
  }

  /** OrderDelivered: Payment COD `pending` thành `succeeded` ngay (không qua `processing`), `paid_at` = `delivered_at`, PaymentSucceeded và audit `system` (BR3). */
  private async delivered(tx: Tx, e: EventEnvelope): Promise<void> {
    const orderId = uuidOf(e.payload?.order_id);
    if (!orderId) return this.skip(e, 'order_id không hợp lệ');
    const p = await this.core.lockByOrder(tx, orderId);
    if (!p) { this.log.warn('OrderDelivered cho đơn không có thanh toán', { code: 'payment-none', event_type: e.type, order_id: orderId }); return; }
    if (p.method !== 'cod' || p.status !== 'pending') { this.info('payment-not-collectable', e, p, { status: p.status, method: p.method }); return; }
    const paidAt = dateOf(e.payload.delivered_at) ?? this.core.now();
    const moved = await this.core.move(tx, p, 'collect', { set: Prisma.sql`, paid_at = ${paidAt}::timestamptz` });
    if (!moved) return;
    await this.audit.record(tx, { actor_id: null, actor_role: 'system', action: 'payment.cod.collect', target_type: 'payment', target_id: p.id, before: { status: 'pending' }, after: { status: 'succeeded', amount: Number(p.amount) }, reason: e.type });
  }

  /** OrderReturned: Payment COD `pending` thành `cancelled` (không hoàn tiền, không event); Payment đã `succeeded` giữ nguyên, hoàn tiền là thủ công `admin_manual` (BR10). */
  private async returned(tx: Tx, e: EventEnvelope): Promise<void> {
    const orderId = uuidOf(e.payload?.order_id);
    if (!orderId) return this.skip(e, 'order_id không hợp lệ');
    const p = await this.core.lockByOrder(tx, orderId);
    if (!p) { this.log.warn('OrderReturned cho đơn không có thanh toán', { code: 'payment-none', event_type: e.type, order_id: orderId }); return; }
    if (p.method === 'cod' && p.status === 'pending') { await this.core.move(tx, p, 'cancel'); return; }
    this.info(p.status === 'succeeded' ? 'refund-manual-required' : 'payment-already-closed', e, p, { status: p.status });
  }

  /** StockCommitFailed (ba mã `reason` xử lý như nhau, R-17): Payment `succeeded` thì Refund `late_payment` cho giao dịch của chính Payment; Payment đã đóng hay đã `refunded` thì bỏ qua có log (BR10). */
  private async commitFailed(tx: Tx, e: EventEnvelope): Promise<void> {
    const orderId = uuidOf(e.payload?.order_id);
    if (!orderId) return this.skip(e, 'order_id không hợp lệ');
    if (!oneOf(COMMIT_FAILED_REASONS, e.payload.reason)) return this.skip(e, 'reason không hợp lệ');
    const p = await this.core.lockByOrder(tx, orderId);
    if (!p) { this.log.warn('StockCommitFailed cho đơn không có thanh toán', { code: 'payment-none', event_type: e.type, order_id: orderId }); return; }
    if (p.status !== 'succeeded') { this.info('payment-not-refundable', e, p, { status: p.status }); return; }
    await this.autoRefund(tx, e, p, 'late_payment');
  }
}
