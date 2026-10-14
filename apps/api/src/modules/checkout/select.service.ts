import { Injectable } from '@nestjs/common';
import { AppLogger, ConfigService, DomainError, type SessionContext } from '../platform';
import { type ChkConfig, type PaymentMethod } from './config';
import { UUID_RE } from './db';
import { DepsService } from './deps.service';
import type { AddressBody, CouponBody, PaymentBody, ShippingBody } from './policy';
import { PriceService, amountProblem, type CouponState } from './price.service';
import { SessionService, briefOf, closed, gone, snapOf, unavailable, type Brief } from './session.service';

/** Mã lỗi HTTP của một lý do lỗi PRM khi khách nhập mã mới (CHK-API mục Danh mục lỗi): 404 `coupon-not-found`, 409 các lỗi còn lại, 429 `too-many-attempts` kèm `Retry-After`. */
function couponError(f: CouponState & { applied: false }, retryAfter?: number): DomainError {
  switch (f.reason) {
    case 'coupon_not_found': return new DomainError('coupon-not-found');
    case 'coupon_expired': return new DomainError('coupon-expired');
    case 'coupon_exhausted': return new DomainError('coupon-exhausted');
    case 'no_discount': return new DomainError('no-discount');
    case 'min_order_not_met': return new DomainError('min-order-not-met', { extra: { min_order_value: f.min_order_value ?? 0, shortfall: f.shortfall ?? 0 } });
    case 'per_user_limit_reached': return new DomainError('per-user-limit-reached', { extra: { limit: f.limit ?? 0, used: f.used ?? 0 } });
    case 'too_many_attempts': { const s = Math.max(1, Math.ceil(retryAfter ?? 1)); return new DomainError('too-many-attempts', { headers: { 'Retry-After': String(s) }, extra: { retry_after_seconds: s } }); }
    default: return new DomainError('dependency-unavailable'); // `service_unavailable`: PRM không trả lời đúng hạn
  }
}

/**
 * Các thao tác CHỌN trên phiên (địa chỉ, vận chuyển, thanh toán, mã giảm giá; CHK-REQ ...105051095, ...242, ...386, ...536): mỗi thao tác đọc module khác TRƯỚC khi mở giao dịch (không giữ kết nối và khóa dòng phiên
 * trong lúc chờ), rồi MỘT giao dịch ngắn khóa dòng phiên (`SessionService.mutate`), ghi và gia hạn phiên. Khách không gửi được nội dung địa chỉ, phí hay số tiền: chỉ id và mã (SB-23); số tiền trả về luôn do server tính.
 */
@Injectable()
export class SelectService {
  private readonly log: AppLogger;
  private readonly limits: { vnpay: number; cod: number; ttl: number };
  constructor(private readonly sessions: SessionService, private readonly deps: DepsService, private readonly prices: PriceService, config: ConfigService, logger: AppLogger) {
    this.log = logger.for('checkout');
    this.limits = { vnpay: config.get<ChkConfig['CHK_MAX_OPEN_VNPAY_ORDERS']>('CHK_MAX_OPEN_VNPAY_ORDERS'), cod: config.get<ChkConfig['CHK_MAX_OPEN_COD_ORDERS']>('CHK_MAX_OPEN_COD_ORDERS'), ttl: config.get<ChkConfig['RESERVATION_TTL']>('RESERVATION_TTL') };
  }

  /** Kiểm sơ bộ không khóa: 404 hay 409 trước khi gọi module khác (lỗi đầu tiên theo thứ tự của CHK-API); giao dịch sau đó kiểm lại dưới khóa. */
  private async open(userId: string, id: string) {
    const r = await this.sessions.find(userId, id);
    if (!r) throw gone();
    if (r.status !== 'open') throw closed(r.status);
    if (r.overdue) { await this.sessions.settleExpired(userId, r.id); throw closed('expired'); }
    return r;
  }

  /** Chọn địa chỉ (BR1 đến BR7): `address_id` của người khác, đã xóa, không có hay sai định dạng cùng một 404 `address-not-found` (SB-06); lưu bản chụp; chọn lại cùng địa chỉ làm mới bản chụp (xác nhận địa chỉ đã sửa). */
  async address(s: SessionContext, id: string, b: AddressBody): Promise<Brief> {
    await this.open(s.user_id, id);
    let a;
    try { a = UUID_RE.test(b.address_id) ? await this.deps.getAddress(s.user_id, b.address_id.toLowerCase()) : null; } catch (e) { throw unavailable(e); }
    if (!a) throw new DomainError('address-not-found');
    const addr = a;
    const { row } = await this.sessions.mutate(s.user_id, id, (tx, r) => tx.$executeRaw`UPDATE checkout_sessions SET address_id = ${addr.id}::uuid, address_snapshot = ${JSON.stringify(snapOf(addr))}::jsonb WHERE id = ${r.id}::uuid`);
    this.log.info('chọn địa chỉ cho phiên', { checkout_id: id });
    return briefOf(row, false);
  }

  /** Chọn vận chuyển (CHK-REQ ...105051242 BR4): chỉ `method_id`; không có, đã tắt hay sai định dạng cùng một 409 `shipping-method-unavailable`; phí không lưu, luôn tính lại. */
  async shipping(s: SessionContext, id: string, b: ShippingBody): Promise<Record<string, unknown>> {
    await this.open(s.user_id, id);
    let method: { id: string; name: string } | undefined, fee: { fee: number; free_shipping: boolean } | null = null, city: string | null = null;
    try {
      const methods = await this.deps.listMethods();
      method = UUID_RE.test(b.method_id) ? methods.find((m) => m.id === b.method_id.toLowerCase()) : undefined;
      if (!method) throw new DomainError('shipping-method-unavailable');
      const row = await this.sessions.find(s.user_id, id);
      if (row?.address_id) {
        const a = await this.deps.getAddress(s.user_id, row.address_id);
        const snap = await this.deps.snapshot(s.user_id);
        if (a && snap.ok) { city = a.city; const q = await this.prices.ship(method.id, a.city, snap.items_subtotal, true); if ('fee' in q) fee = { fee: q.fee, free_shipping: q.free_shipping }; }
      }
    } catch (e) { throw unavailable(e); }
    const chosen = method;
    const { row: after } = await this.sessions.mutate(s.user_id, id, (tx, row) => tx.$executeRaw`UPDATE checkout_sessions SET shipping_method_id = ${chosen.id}::uuid WHERE id = ${row.id}::uuid`);
    return { ...briefOf(after, false), shipping: { method_id: chosen.id, name: chosen.name, city, fee: fee?.fee ?? null, free_shipping: fee?.free_shipping ?? false } };
  }

  /**
   * Chọn thanh toán (CHK-REQ ...105051386): `vnpay` hay `cod` (tập đóng, 400 nếu khác); đơn 0 đồng là 422 `zero-total-unsupported` ở cả hai, `vnpay` ngoài 5.000..999.999.999 là 422 `amount-out-of-range-online`;
   * quá giới hạn đơn đang mở của loại đó là 409 `too-many-open-orders` (kiểm sớm để báo, kiểm lại nguyên tử ở bước đặt). Số tiền do server tính lại; chỉ kiểm khi đã biết phí (chưa chọn vận chuyển thì tổng chỉ là ước tính).
   */
  async payment(s: SessionContext, id: string, b: PaymentBody): Promise<Record<string, unknown>> {
    const row = await this.open(s.user_id, id);
    const method: PaymentMethod = b.payment_method;
    try {
      const snap = await this.deps.snapshot(s.user_id);
      if (snap.ok) {
        let city: string | null = null;
        if (row.address_id && row.shipping_method_id) city = (await this.deps.getAddress(s.user_id, row.address_id))?.city ?? null;
        const p = await this.prices.price(s.user_id, snap, { couponCode: row.coupon_code, methodId: row.shipping_method_id, city, strict: false });
        if (!p.total_is_estimate) { const bad = amountProblem(p.grand_total, method); if (bad) throw bad; }
      }
      const open = await this.deps.countOpenOrders(s.user_id);
      const [kind, limit, current] = method === 'vnpay' ? ['vnpay', this.limits.vnpay, open.online_pending] as const : ['cod', this.limits.cod, open.cod_open] as const;
      if (current >= limit) throw new DomainError('too-many-open-orders', { extra: { kind, limit, current } });
    } catch (e) { throw unavailable(e); }
    const { row: after } = await this.sessions.mutate(s.user_id, id, (tx, r) => tx.$executeRaw`UPDATE checkout_sessions SET payment_method = ${method}::checkout_payment_method WHERE id = ${r.id}::uuid`);
    return { ...briefOf(after, false), payment_note: method === 'vnpay' ? { hold_minutes: this.limits.ttl, confirmed_immediately: false } : { hold_minutes: null, confirmed_immediately: true } };
  }

  /**
   * Áp mã (CHK-REQ ...105051536): `PromotionApi.evaluate` với `count_attempt` = true (mã khách nhập mới tính vào bộ đếm dò mã của PRM), tạm tính do server tính từ dòng giỏ; mã mới lỗi thì mã cũ giữ nguyên.
   * Áp mã KHÔNG giữ lượt (chỉ `reserve` ở bước đặt). Mã lưu trong phiên, không ghi ngược vào giỏ.
   */
  async coupon(s: SessionContext, id: string, b: CouponBody): Promise<Record<string, unknown>> {
    const row = await this.open(s.user_id, id);
    let snap;
    try { snap = await this.deps.snapshot(s.user_id); } catch (e) { throw unavailable(e); }
    if (!snap.ok) throw new DomainError('cart-empty');
    let c: Awaited<ReturnType<PriceService['coupon']>>;
    try { c = await this.prices.coupon(s.user_id, b.code, snap.items_subtotal, true, true); } catch (e) { throw unavailable(e); }
    if (!c.applied) throw couponError(c, c.raw && !c.raw.ok && c.raw.reason === 'too_many_attempts' ? c.raw.retry_after_seconds : undefined);
    const applied = c;
    await this.sessions.mutate(s.user_id, id, (tx, r) => tx.$executeRaw`UPDATE checkout_sessions SET coupon_code = ${applied.code} WHERE id = ${r.id}::uuid`);
    let city: string | null = null;
    try {
      if (row.address_id && row.shipping_method_id) city = (await this.deps.getAddress(s.user_id, row.address_id))?.city ?? null;
      const p = await this.prices.price(s.user_id, snap, { couponCode: applied.code, methodId: row.shipping_method_id, city, strict: false, coupon: { code: applied.code, applied: true, discount: applied.discount } });
      return { coupon: { code: applied.code, applied: true, discount: applied.discount }, discount: p.discount, grand_total: p.grand_total, total_is_estimate: p.total_is_estimate };
    } catch (e) { throw unavailable(e); }
  }

  /** Gỡ mã: luôn thành công, idempotent (204, kể cả khi không có mã); phiên đã đóng thì 409. */
  async removeCoupon(s: SessionContext, id: string): Promise<void> {
    await this.sessions.mutate(s.user_id, id, (tx, r) => tx.$executeRaw`UPDATE checkout_sessions SET coupon_code = NULL WHERE id = ${r.id}::uuid`);
  }
}
