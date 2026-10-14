import { Injectable } from '@nestjs/common';
import { ConfigService, DomainError, type SessionContext } from '../platform';
import { SHIP_SUBTOTAL_MAX, type ChkConfig } from './config';
import { type SessionRow } from './db';
import { DependencyError, DepsService } from './deps.service';
import { PriceService, linesOf, type Cart, type CouponState, type Priced } from './price.service';
import { SessionService, addressChanged, closed, gone, unavailable } from './session.service';

/** Điều cản trở đặt hàng, mã máy đọc được (CHK-REQ-20261006-105051681 BR5). */
export type Blocker = import('./config').BlockerCode;

export interface AddressView { address_id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; changed: boolean }

/**
 * Xem lại đơn trước khi đặt (CHK-REQ-20261006-105051681) và lấy phí theo địa chỉ (CHK-REQ-20261006-105051242): chỉ đọc, KHÔNG gia hạn phiên, mọi số tiền tính lại ở server (SB-23); phản hồi `Cache-Control: no-store`
 * (đặt ở controller) vì có dữ liệu cá nhân (SB-08). Module khác lỗi tạm thời (PRM, SHP, ORD quá 2 giây) thì phần liên quan ghi `service_unavailable` và `can_place_order` = false, không trả số bịa; CRT lỗi thì 503.
 */
@Injectable()
export class ViewService {
  private readonly cfg: ChkConfig;
  constructor(private readonly sessions: SessionService, private readonly deps: DepsService, private readonly prices: PriceService, config: ConfigService) {
    this.cfg = { RESERVATION_TTL: config.get('RESERVATION_TTL'), CHK_MAX_OPEN_VNPAY_ORDERS: config.get('CHK_MAX_OPEN_VNPAY_ORDERS'), CHK_MAX_OPEN_COD_ORDERS: config.get('CHK_MAX_OPEN_COD_ORDERS') } as ChkConfig;
  }

  /** Phiên không còn `open`: chỉ trả trạng thái (và `order_code` khi `completed`); không có dòng hàng, tiền hay địa chỉ (BR9). Có thể mở lại bằng nút quay lại của trình duyệt mà không tạo đơn thứ hai. */
  private async finished(r: SessionRow): Promise<Record<string, unknown>> {
    if (r.status !== 'completed') return { id: r.id, status: r.status };
    const o = await this.deps.summary(r.order_id!).catch((e) => { throw unavailable(e); });
    return { id: r.id, status: 'completed', order_code: o?.code ?? '' };
  }

  async view(s: SessionContext, id: string): Promise<Record<string, unknown>> {
    const row = await this.sessions.find(s.user_id, id);
    if (!row) throw gone();
    if (row.status !== 'open') return this.finished(row);
    if (row.overdue) { await this.sessions.settleExpired(s.user_id, row.id); return { id: row.id, status: 'expired' }; } // quá hạn mà job chưa chạy: coi là `expired` ngay (BR2 của CHK-REQ ...105052414)
    let snap;
    try { snap = await this.deps.snapshot(s.user_id); } catch (e) { throw unavailable(e); }
    if (snap.ok && snap.cart_id !== row.cart_id) { await this.sessions.settleCancelled(s.user_id, row.id); throw closed('cancelled'); } // giỏ hiện hành đã khác giỏ của phiên (BR5)
    return this.build(s, row, snap.ok ? snap : null);
  }

  /** Dựng bản xem lại từ phiên và giỏ (giỏ trống: không dòng nào, `cart_empty` ở `blockers`). */
  private async build(s: SessionContext, row: SessionRow, snap: Cart | null): Promise<Record<string, unknown>> {
    let degraded = false;
    const blockers: Blocker[] = [];
    // địa chỉ: đọc lại từ USR; bản chụp của phiên chỉ để so sánh
    let address: AddressView | { address_id: null; error: 'address_unavailable' } | null = null, city: string | null = null;
    if (row.address_id) {
      try {
        const a = await this.deps.getAddress(s.user_id, row.address_id);
        if (!a) { address = { address_id: null, error: 'address_unavailable' }; blockers.push('address_unavailable'); } else {
          const changed = addressChanged(row.address_snapshot, a);
          address = { address_id: a.id, receiver: a.receiver, phone: a.phone, line1: a.line1, ward: a.ward, district: a.district, city: a.city, changed };
          city = a.city;
          if (changed) blockers.push('address_changed');
        }
      } catch (e) { if (!(e instanceof DependencyError)) throw e; degraded = true; }
    } else blockers.push('missing_address');
    // vận chuyển
    let methods: { id: string; name: string }[] | null = null;
    try { methods = await this.deps.listMethods(); } catch (e) { if (!(e instanceof DependencyError)) throw e; degraded = true; }
    const lines = snap ? linesOf(snap) : [];
    const priced: Priced = snap
      ? await this.prices.price(s.user_id, snap, { couponCode: row.coupon_code, methodId: row.shipping_method_id && methods?.some((m) => m.id === row.shipping_method_id) ? row.shipping_method_id : null, city, strict: false })
      : { items_subtotal: 0, coupon: null, discount: 0, ship: null, shipping_fee: null, grand_total: 0, total_is_estimate: true };
    let shipping: Record<string, unknown> | null = null;
    if (!row.shipping_method_id) {
      blockers.push('missing_shipping_method');
      if (methods && methods.length === 0) blockers.push('no_shipping_methods');
    } else if (methods === null) { shipping = { method_id: row.shipping_method_id, error: 'service_unavailable' }; }
    else {
      const m = methods.find((x) => x.id === row.shipping_method_id);
      if (!m) { shipping = { method_id: row.shipping_method_id, error: 'method_unavailable' }; blockers.push('shipping_method_unavailable'); }
      else if (!city) shipping = { method_id: m.id, name: m.name, city: null, fee: null, free_shipping: false };
      else if (priced.ship && 'fee' in priced.ship) shipping = { method_id: m.id, name: m.name, city, fee: priced.ship.fee, free_shipping: priced.ship.free_shipping };
      else if (priced.ship) { shipping = { method_id: m.id, error: priced.ship.error }; if (priced.ship.error === 'method_unavailable') blockers.push('shipping_method_unavailable'); else degraded = true; }
    }
    // mã giảm giá
    const coupon = priced.coupon;
    if (coupon && !coupon.applied) { blockers.push('coupon_invalid'); }
    // giỏ
    if (!snap) blockers.push('cart_empty' as Blocker);
    else {
      if (snap.issues.some((i) => i.reason === 'unavailable')) blockers.push('cart_unavailable_items');
      if (snap.issues.some((i) => i.reason === 'insufficient_stock')) blockers.push('insufficient_stock');
    }
    // thanh toán
    if (!row.payment_method) blockers.push('missing_payment_method');
    const total = priced.grand_total;
    if (row.payment_method === 'vnpay' && (total > 999_999_999 || (!priced.total_is_estimate && total < 5000))) blockers.push('amount_out_of_range_online');
    if (!priced.total_is_estimate && total === 0 && snap) blockers.push('zero_total');
    if (row.payment_method) {
      try {
        const open = await this.deps.countOpenOrders(s.user_id);
        if (row.payment_method === 'vnpay' ? open.online_pending >= this.cfg.CHK_MAX_OPEN_VNPAY_ORDERS : open.cod_open >= this.cfg.CHK_MAX_OPEN_COD_ORDERS) blockers.push('too_many_open_orders');
      } catch (e) { if (!(e instanceof DependencyError)) throw e; degraded = true; }
    }
    if (!s.email_verified) blockers.push('email_not_verified');
    return {
      id: row.id, status: 'open', expires_at: row.expires_at.toISOString(), cart_version: snap?.cart_version ?? 0,
      lines, items_subtotal: priced.items_subtotal, coupon: couponView(coupon), address, shipping,
      payment_method: row.payment_method,
      payment_note: row.payment_method === 'vnpay' ? { hold_minutes: this.cfg.RESERVATION_TTL, confirmed_immediately: false } : row.payment_method === 'cod' ? { hold_minutes: null, confirmed_immediately: true } : null,
      discount: priced.discount, shipping_fee: priced.shipping_fee, grand_total: total, total_is_estimate: priced.total_is_estimate, expected_grand_total: total,
      blockers, can_place_order: blockers.length === 0 && !degraded && !!snap,
    };
  }

  /** Bản xem lại rút gọn cho `price-changed` và `cart-changed` (CHK-API): số tiền mới cùng `cart_version` và từng dòng với giá hiện hành. */
  review(snap: Cart, p: Priced): Record<string, unknown> {
    return {
      items_subtotal: p.items_subtotal, discount: p.discount, shipping_fee: p.shipping_fee, grand_total: p.grand_total, expected_grand_total: p.grand_total, cart_version: snap.cart_version,
      lines: linesOf(snap).map((l) => ({ product_id: l.product_id, name: l.name, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total })),
    };
  }

  /** Phí từng phương thức theo `city` của địa chỉ trong phiên (CHK-REQ ...105051242 BR1, BR3, BR5); sắp theo `fee` tăng dần rồi `name`. Không ghi, không gia hạn phiên. */
  async shippingOptions(s: SessionContext, id: string): Promise<Record<string, unknown>> {
    const row = await this.sessions.find(s.user_id, id);
    if (!row) throw gone();
    if (row.status !== 'open') throw closed(row.status);
    if (row.overdue) { await this.sessions.settleExpired(s.user_id, row.id); throw closed('expired'); }
    if (!row.address_id) throw new DomainError('address-required');
    try {
      const addr = await this.deps.getAddress(s.user_id, row.address_id);
      if (!addr) throw new DomainError('address-unavailable');
      const snap = await this.deps.snapshot(s.user_id);
      if (!snap.ok) throw new DomainError('cart-empty');
      const methods = await this.deps.listMethods();
      if (!methods.length) throw new DomainError('no-shipping-methods');
      const options: { method_id: string; name: string; fee: number; free_shipping: boolean }[] = [];
      for (const m of methods) {
        try { const q = await this.deps.quote({ method_id: m.id, city: addr.city, subtotal: Math.min(snap.items_subtotal, SHIP_SUBTOTAL_MAX) }); options.push({ method_id: m.id, name: m.name, fee: q.fee, free_shipping: q.free_shipping }); } catch (e) {
          if (!(e instanceof DomainError && e.code === 'method-unavailable')) throw e; // vừa bị tắt giữa hai lời gọi: bỏ khỏi danh sách
        }
      }
      if (!options.length) throw new DomainError('no-shipping-methods');
      options.sort((a, b) => a.fee - b.fee || a.name.localeCompare(b.name));
      return { city: addr.city, items_subtotal: snap.items_subtotal, options };
    } catch (e) { throw unavailable(e); }
  }
}

function couponView(c: CouponState | null): Record<string, unknown> | null {
  if (!c) return null;
  if (c.applied) return { code: c.code, applied: true, discount: c.discount };
  const { code, reason, applied: _a, ...rest } = c;
  return { code, applied: false, reason, ...rest };
}
