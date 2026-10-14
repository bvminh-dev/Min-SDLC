import { Injectable } from '@nestjs/common';
import { AppLogger, AuditService, ConfigService, DomainError, EventsService, IdempotencyService, TransactionService, type SessionContext, type Tx } from '../platform';
import { RESEND_ENDPOINT, SCOPE, type ChkConfig } from './config';
import { type SessionRow } from './db';
import { DependencyError, DepsService } from './deps.service';
import { Gate, hashOf } from './idem';
import type { PlaceBody } from './policy';
import { PriceService, amountProblem, couponFailure, type Cart, type Priced } from './price.service';
import { SessionService, addressChanged, closed, gone, snapOf } from './session.service';
import { ViewService } from './view.service';

export interface PlaceOut {
  replayed: boolean; order: { code: string; status: string; grand_total: number; payment_method: string }; next: { action: 'pay' | 'done'; url: string }; payment_deadline?: string;
}

/**
 * Lỗi nghiệp vụ cần ghi thêm SAU khi giao dịch đặt hàng đã hoàn tác (CHK-DB mục 5): giao dịch đặt hàng hoàn tác hoàn toàn (không có Order, reservation, lượt coupon, outbox, audit, khóa idempotency), rồi `after`
 * chạy trong giao dịch riêng, ngắn (cập nhật bản chụp địa chỉ, bỏ lựa chọn không còn dùng được, đóng phiên, gia hạn phiên vì "một lần đặt hàng bị từ chối" là thao tác ghi) trước khi trả lỗi cho khách.
 */
class PlaceAbort extends Error {
  constructor(readonly error: DomainError, readonly after?: (tx: Tx) => Promise<unknown>) { super(error.code); this.name = 'PlaceAbort'; }
}
const pgCode = (e: unknown): string => { const x = e as { meta?: { code?: unknown }; code?: unknown }; return String(x?.meta?.code ?? x?.code ?? ''); };

/**
 * Đặt hàng (CHK-REQ-20261006-105052272, ...105052127, ...105051825, ...105051977): MỘT giao dịch CSDL duy nhất theo thứ tự khóa cố định của ADR-012: khóa tư vấn theo người dùng, dòng phiên (`FOR UPDATE`), dòng giỏ (CRT
 * `lockForCheckout`), tạo Order (ORD), các dòng kho tăng dần theo `stock_items.id` (INV), dòng coupon (PRM). Mọi số tiền, dòng hàng, địa chỉ, phí do server lấy từ CRT, USR, PRM, SHP trong giao dịch (SB-23); `expected_grand_total` và
 * `cart_version` của client chỉ để so sánh. Bước nào lỗi thì hoàn tác toàn bộ (SB-25); module khác lỗi hay quá hạn là 503 `dependency-unavailable` (SB-31). Idempotent theo `Idempotency-Key` (lớp một) và khóa dòng phiên (lớp hai).
 */
@Injectable()
export class PlaceService {
  private readonly log: AppLogger;
  private readonly gate: Gate;
  private readonly cfg: Pick<ChkConfig, 'RESERVATION_TTL' | 'CHK_MAX_OPEN_VNPAY_ORDERS' | 'CHK_MAX_OPEN_COD_ORDERS'>;
  constructor(
    private readonly sessions: SessionService, private readonly deps: DepsService, private readonly prices: PriceService, private readonly views: ViewService, private readonly idem: IdempotencyService,
    private readonly transactions: TransactionService, private readonly events: EventsService, private readonly audit: AuditService, config: ConfigService, logger: AppLogger,
  ) {
    this.log = logger.for('checkout');
    this.cfg = { RESERVATION_TTL: config.get('RESERVATION_TTL'), CHK_MAX_OPEN_VNPAY_ORDERS: config.get('CHK_MAX_OPEN_VNPAY_ORDERS'), CHK_MAX_OPEN_COD_ORDERS: config.get('CHK_MAX_OPEN_COD_ORDERS') };
    this.gate = new Gate(Math.max(1, Math.floor(config.get<number>('DB_POOL_MAX') / 2)));
  }

  async place(s: SessionContext, id: string, key: string, body: PlaceBody): Promise<{ status: number; body: PlaceOut }> {
    const hash = hashOf('/api/v1/checkout/sessions/:id/place-order', { params: { id }, body });
    const release = await this.gate.acquire();
    try {
      const out = await this.idem.run<PlaceOut>({ scope: SCOPE, userId: s.user_id, key, requestHash: hash }, (tx) => this.run(tx, s, id, body));
      return out.replayed ? { status: 200, body: { ...out.body, replayed: true } } : { status: out.status, body: out.body };
    } catch (e) {
      if (e instanceof PlaceAbort) {
        if (e.after) await this.transactions.run(e.after).catch((err) => this.log.error('ghi sau khi đặt hàng bị từ chối thất bại', { code: 'after-failed', err_name: (err as Error)?.name ?? 'unknown' }));
        throw e.error;
      }
      if (e instanceof DependencyError || (e instanceof DomainError && e.code === 'internal-error')) throw new DomainError('dependency-unavailable'); // module lỗi hay quá hạn; bế tắc hết lượt thử của nền: đã hoàn tác
      throw e;
    } finally { release(); }
  }

  /** Phát lại kết quả của phiên đã `completed` (lớp hai của idempotency: hai lần bấm dùng hai khóa khác nhau): trả đơn đã tạo, không tạo đơn thứ hai, không giữ hàng lần hai. */
  private async replay(row: SessionRow): Promise<{ status: number; body: PlaceOut }> {
    const o = await this.deps.summary(row.order_id!);
    if (!o) throw new DomainError('dependency-unavailable');
    const cod = o.payment_method === 'cod';
    let deadline: string | undefined;
    if (!cod) { const p = await this.deps.paymentInfo(row.order_id!); if (p?.payment_expires_at) deadline = p.payment_expires_at.toISOString(); }
    return { status: 200, body: { replayed: true, order: { code: o.code, status: o.status, grand_total: o.grand_total, payment_method: o.payment_method }, next: this.next(cod, o.code), ...(deadline ? { payment_deadline: deadline } : {}) } };
  }
  private next(cod: boolean, code: string): PlaceOut['next'] { return cod ? { action: 'done', url: `/orders/${code}` } : { action: 'pay', url: `/orders/${code}/payment` }; }

  private async run(tx: Tx, s: SessionContext, id: string, body: PlaceBody): Promise<{ status: number; body: PlaceOut }> {
    // (a) khóa tư vấn theo người dùng: luôn lấy đầu tiên; làm kiểm số đơn mở và kiểm khóa idempotency thành nguyên tử (CHK-DB mục 3)
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`chk:user:${s.user_id}`}, 0))) l`;
    // (b) khóa dòng phiên (WHERE id AND user_id: phiên của người khác cùng 404 với không có)
    const row = await this.sessions.lock(tx, s.user_id, id);
    if (!row) throw gone();
    if (row.status === 'completed') return this.replay(row);
    if (row.status !== 'open') throw closed(row.status);
    const reject = (error: DomainError, more?: (t: Tx) => Promise<unknown>): PlaceAbort => new PlaceAbort(error, async (t) => { if (more) await more(t); await this.sessions.touch(t, row.id); });
    if (row.overdue) throw new PlaceAbort(closed('expired'), (t) => this.sessions.expire(t, row)); // quá hạn mà job chưa chạy: hết hạn ngay, kèm CheckoutExpired
    if (!s.email_verified) throw reject(new DomainError('email-not-verified', { extra: { resend_endpoint: RESEND_ENDPOINT } })); // kiểm lại ở đây: trạng thái có thể đổi giữa chừng (SB-26)
    const [done] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM checkout_sessions WHERE cart_id = ${row.cart_id}::uuid AND status = 'completed'::checkout_status LIMIT 1`;
    if (done) throw reject(new DomainError('cart-already-ordered')); // một đơn mỗi giỏ, kể cả khi CheckoutCompleted chưa tới CRT
    const missing = [!row.address_id && 'address', !row.shipping_method_id && 'shipping_method', !row.payment_method && 'payment_method'].filter((x): x is string => !!x);
    const methods = await this.deps.listMethods();
    if (missing.length) throw reject(missing.length === 1 && missing[0] === 'shipping_method' && methods.length === 0 ? new DomainError('no-shipping-methods') : new DomainError('checkout-incomplete', { extra: { missing } }));
    // địa chỉ: đọc lại tại lúc đặt; xóa hay sửa sau khi chọn thì từ chối, đơn không bao giờ mang nội dung khác điều khách đã thấy (T11)
    const addr = await this.deps.getAddress(s.user_id, row.address_id!);
    if (!addr) throw reject(new DomainError('address-unavailable'), (t) => t.$executeRaw`UPDATE checkout_sessions SET address_id = NULL, address_snapshot = NULL WHERE id = ${row.id}::uuid AND status = 'open'::checkout_status`);
    if (addressChanged(row.address_snapshot, addr)) {
      throw reject(new DomainError('address-changed', { extra: { address: { receiver: addr.receiver, phone: addr.phone, line1: addr.line1, ward: addr.ward, district: addr.district, city: addr.city } } }),
        (t) => t.$executeRaw`UPDATE checkout_sessions SET address_snapshot = ${JSON.stringify(snapOf(addr))}::jsonb WHERE id = ${row.id}::uuid AND status = 'open'::checkout_status`);
    }
    const clearMethod = (t: Tx) => t.$executeRaw`UPDATE checkout_sessions SET shipping_method_id = NULL WHERE id = ${row.id}::uuid AND status = 'open'::checkout_status`;
    if (!methods.some((m) => m.id === row.shipping_method_id)) throw reject(new DomainError('shipping-method-unavailable'), clearMethod);
    // (c) khóa dòng giỏ
    const snap = await this.deps.lockCart(s.user_id, tx);
    if (!snap.ok) throw reject(new DomainError('cart-empty'));
    if (snap.cart_id !== row.cart_id) throw new PlaceAbort(closed('cancelled'), (t) => this.sessions.cancel(t, row.id)); // giỏ hiện hành đã khác giỏ của phiên: phiên bị đóng, không phát event
    const bad = snap.issues.filter((i) => i.reason === 'unavailable');
    if (bad.length) throw reject(new DomainError('cart-has-unavailable-items', { extra: { issues: bad.map((i) => ({ product_id: i.product_id, reason: i.reason })) } }));
    // (d) kiểm giá: tính lại từ nguồn trong giao dịch
    const priced = await this.prices.price(s.user_id, snap, { couponCode: row.coupon_code, methodId: row.shipping_method_id, city: addr.city, strict: true });
    const review = (): Record<string, unknown> => this.views.review(snap, priced);
    if (body.cart_version !== snap.cart_version) throw reject(new DomainError('cart-changed', { extra: { review: review() as never } })); // BR3: trước price-changed
    if (priced.ship && 'error' in priced.ship) throw reject(new DomainError('shipping-method-unavailable'), clearMethod);
    if (priced.coupon && !priced.coupon.applied) throw reject(this.couponInvalid(priced.coupon)); // BR8: ưu tiên hơn price-changed
    if (body.expected_grand_total !== priced.grand_total) throw reject(new DomainError('price-changed', { extra: { previous_grand_total: body.expected_grand_total, review: review() as never } }), (t) => this.snapshotPrice(t, row.id, snap, priced));
    const bound = amountProblem(priced.grand_total, row.payment_method);
    if (bound) throw reject(bound);
    // (e) giới hạn đơn đang mở, nguyên tử dưới khóa tư vấn
    const open = await this.deps.countOpenOrders(s.user_id);
    const vnpay = row.payment_method === 'vnpay';
    const [limit, current] = vnpay ? [this.cfg.CHK_MAX_OPEN_VNPAY_ORDERS, open.online_pending] : [this.cfg.CHK_MAX_OPEN_COD_ORDERS, open.cod_open];
    if (current >= limit) throw reject(new DomainError('too-many-open-orders', { extra: { kind: vnpay ? 'vnpay' : 'cod', limit, current } }));
    // (f) tạo Order pending; `expires_at` tính MỘT lần (giờ CSDL + RESERVATION_TTL, rỗng với COD) rồi truyền cho cả INV và ORD (K-01)
    const [{ at }] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() + make_interval(mins => ${this.cfg.RESERVATION_TTL}::int) AS at`;
    const expiresAt = vnpay ? at : null;
    const items = snap.lines.map((l) => ({ product_id: l.product_id, name_snapshot: l.name, unit_price: l.unit_price, quantity: l.quantity }));
    const order = await this.deps.createPending({
      user_id: s.user_id, items, items_total: priced.items_subtotal, discount: priced.discount, shipping_fee: priced.shipping_fee!, grand_total: priced.grand_total,
      shipping_address: { receiver: addr.receiver, phone: addr.phone, line1: addr.line1, ward: addr.ward, district: addr.district ?? null, city: addr.city }, // đúng sáu khóa; `district` là null khi khách không có quận, huyện (E-06)
      shipping_method_id: row.shipping_method_id!, payment_method: row.payment_method!, payment_expires_at: expiresAt,
    }, tx);
    // (g) giữ hàng rồi giữ lượt coupon, cùng giao dịch; thiếu hàng thì INV không ghi gì và cả giao dịch hoàn tác
    const held = await this.deps.reserveStock(order.order_id, items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })), expiresAt, tx);
    if (!held.ok) {
      const name = new Map(snap.lines.map((l) => [l.product_id, l.name]));
      throw reject(new DomainError('insufficient-stock', { extra: { items: held.shortages.map((x) => ({ product_id: x.product_id, name: name.get(x.product_id) ?? '', requested: x.requested, available: x.available, reason: x.reason })) } }));
    }
    if (priced.coupon?.applied) {
      const r = await this.deps.reservePromotion({ order_id: order.order_id, user_id: s.user_id, code: priced.coupon.code, items_subtotal: snap.items_subtotal }, tx);
      if (!r.ok) throw reject(this.couponInvalid(couponFailure(priced.coupon.code, r)));
      if (r.amount !== priced.discount) throw reject(new DomainError('price-changed', { extra: { previous_grand_total: body.expected_grand_total, review: review() as never } })); // PRM tính khác điều đã kiểm giá: hoàn tác
    }
    // (h) COD vào `confirmed` ngay trong cùng giao dịch (ORD phát OrderConfirmed qua outbox)
    if (!vnpay) await this.deps.confirmCod(order.order_id, tx);
    // (i) phiên `completed`, CheckoutCompleted, AuditLog; unique `(cart_id) WHERE status = 'completed'` chặn đơn thứ hai của một giỏ
    try {
      await tx.$executeRaw`
        UPDATE checkout_sessions SET status = 'completed'::checkout_status, order_id = ${order.order_id}::uuid, completed_at = clock_timestamp(), updated_at = clock_timestamp(),
          last_activity_at = clock_timestamp(), price_snapshot = ${JSON.stringify(this.snapshotOf(snap, priced))}::jsonb WHERE id = ${row.id}::uuid AND status = 'open'::checkout_status`;
    } catch (e) {
      if (pgCode(e) === '23505') throw reject(new DomainError('cart-already-ordered'));
      throw e;
    }
    await this.events.publish(tx, { type: 'CheckoutCompleted', aggregate_type: 'CheckoutSession', aggregate_id: row.id, payload: { checkout_id: row.id, cart_id: row.cart_id, order_id: order.order_id } });
    await this.audit.record(tx, { actor_id: s.user_id, actor_role: 'customer', action: 'checkout.place_order', target_type: 'order', target_id: order.order_id, after: { order_code: order.code, grand_total: priced.grand_total, payment_method: row.payment_method } });
    this.log.info('đặt hàng thành công', { checkout_id: row.id, order_id: order.order_id, user_id: s.user_id, payment_method: row.payment_method });
    return {
      status: 201,
      body: {
        replayed: false, order: { code: order.code, status: vnpay ? 'pending' : 'confirmed', grand_total: priced.grand_total, payment_method: row.payment_method! }, next: this.next(!vnpay, order.code),
        ...(expiresAt ? { payment_deadline: expiresAt.toISOString() } : {}),
      },
    };
  }

  private couponInvalid(c: { reason: string; shortfall?: number; min_order_value?: number; limit?: number; used?: number }): DomainError {
    const extra: Record<string, string | number> = { reason: c.reason };
    for (const k of ['shortfall', 'min_order_value', 'limit', 'used'] as const) if (c[k] !== undefined) extra[k] = c[k]!;
    return new DomainError('coupon-invalid', { extra });
  }
  /** Bản chụp số liệu lần tính gần nhất (chỉ để chẩn đoán, không phải nguồn sự thật, SB-23): không có dữ liệu cá nhân. */
  private snapshotOf(snap: Cart, p: Priced): Record<string, unknown> {
    return { items_subtotal: p.items_subtotal, discount: p.discount, shipping_fee: p.shipping_fee, grand_total: p.grand_total, cart_version: snap.cart_version, computed_at: new Date().toISOString() };
  }
  private snapshotPrice(t: Tx, id: string, snap: Cart, p: Priced): Promise<number> {
    return t.$executeRaw`UPDATE checkout_sessions SET price_snapshot = ${JSON.stringify(this.snapshotOf(snap, p))}::jsonb WHERE id = ${id}::uuid AND status = 'open'::checkout_status`;
  }
}
