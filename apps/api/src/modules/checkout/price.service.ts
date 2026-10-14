import { Injectable } from '@nestjs/common';
import type { CheckoutLine, CheckoutSnapshot } from '../cart';
import type { EvaluateResult } from '../promotion';
import { DomainError } from '../platform';
import { SHIP_SUBTOTAL_MAX, VNPAY_MAX, VNPAY_MIN, type PaymentMethod } from './config';
import { DependencyError, DepsService } from './deps.service';

export type Cart = Extract<CheckoutSnapshot, { ok: true }>;
export type Availability = { status: 'ok' } | { status: 'insufficient'; available: number } | { status: 'out_of_stock' } | { status: 'unavailable' } | { status: 'unknown' };
export interface LineOut { product_id: string; name: string; quantity: number; unit_price: number; line_total: number; availability: Availability }
export type CouponState =
  | { code: string; applied: true; discount: number }
  | { code: string; applied: false; reason: string; min_order_value?: number; shortfall?: number; limit?: number; used?: number };
export type ShipState =
  | { method_id: string; fee: number; free_shipping: boolean }
  | { method_id: string; error: 'method_unavailable' | 'service_unavailable' };
export interface Priced {
  items_subtotal: number; coupon: CouponState | null; discount: number; ship: ShipState | null; shipping_fee: number | null; grand_total: number; total_is_estimate: boolean;
}

/** Số nguyên an toàn của JS: tạm tính tối đa 50 x 1.000.000.000 x 99 = 4.950.000.000.000 (CHK-REQ ...105051825 BR9, CRT BR10) vẫn là số nguyên an toàn; tổng tính bằng bigint để không phụ thuộc vào đó. */
const num = (b: bigint): number => {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError('số tiền vượt miền số nguyên an toàn');
  return n;
};

/** Dòng hàng ra khỏi module: tên, số lượng, giá HIỆN HÀNH và thành tiền do CRT trả; tình trạng hàng suy từ `issues` của CRT (kiểm mềm): chỉ dòng thiếu mới có số, không lộ tồn của dòng đủ hàng (SB-37). */
export function linesOf(snap: Cart): LineOut[] {
  const issue = new Map(snap.issues.map((i) => [i.product_id, i]));
  return snap.lines.map((l: CheckoutLine) => {
    const i = issue.get(l.product_id);
    const availability: Availability = !i ? { status: 'ok' } : i.reason === 'unavailable' ? { status: 'unavailable' } : (i.available ?? 0) > 0 ? { status: 'insufficient', available: i.available! } : { status: 'out_of_stock' };
    return { product_id: l.product_id, name: l.name, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total, availability };
  });
}

/** Lý do lỗi của PRM thành trạng thái hiển thị (chuyển nguyên văn lý do của PRM, thêm `service_unavailable` khi PRM không trả lời; `invalid_subtotal` là tạm tính vượt miền của PRM nên không có mức giảm). */
export function couponFailure(code: string, r: Extract<EvaluateResult, { ok: false }>): CouponState & { applied: false } {
  switch (r.reason) {
    case 'min_order_not_met': return { code, applied: false, reason: r.reason, min_order_value: r.min_order_value, shortfall: r.shortfall };
    case 'per_user_limit_reached': return { code, applied: false, reason: r.reason, limit: r.limit, used: r.used };
    case 'coupon_not_found': case 'coupon_expired': case 'coupon_exhausted': case 'no_discount': case 'too_many_attempts': return { code, applied: false, reason: r.reason };
    case 'invalid_subtotal': return { code, applied: false, reason: 'no_discount' };
    default: return { code, applied: false, reason: 'service_unavailable' }; // `invalid_argument`, `order_already_has_coupon`: lỗi lập trình của CHK, không đoán
  }
}

/** Kiểm giới hạn số tiền theo phương thức (CHK-REQ ...105051386 BR4, BR5): trả mã lỗi hoặc null. `grand_total` = 0 là 422 `zero-total-unsupported` ở cả hai phương thức; `vnpay` ngoài 5.000..999.999.999 là `amount-out-of-range-online`. */
export function amountProblem(total: number, method: PaymentMethod | null): DomainError | null {
  if (total === 0) return new DomainError('zero-total-unsupported');
  if (method === 'vnpay' && (total < VNPAY_MIN || total > VNPAY_MAX)) return new DomainError('amount-out-of-range-online', { extra: { min: VNPAY_MIN, max: VNPAY_MAX } });
  return null;
}

/**
 * Tính lại MỌI số tiền ở server (CHK-REQ ...105051681 BR2, SB-23): tạm tính từ dòng của CRT (giá hiện hành), tiền giảm từ PRM `evaluate` (`count_attempt` = false: xem đơn nhiều lần không làm khách bị khóa dò mã), phí từ SHP `quote`
 * với `city` của địa chỉ THẬT và tạm tính TRƯỚC giảm giá (BR2 của ...105051242), tổng = tạm tính - giảm giá + phí. Không đọc số nào từ phiên hay từ client. `strict` (đặt hàng): module lỗi thì ném `DependencyError` thay vì
 * ghi trạng thái lỗi tạm thời.
 */
@Injectable()
export class PriceService {
  constructor(private readonly deps: DepsService) {}

  async coupon(userId: string, code: string, subtotal: number, strict: boolean, countAttempt = false): Promise<CouponState & { raw?: EvaluateResult }> {
    if (subtotal <= 0) return { code, applied: false, reason: 'no_discount' }; // chỉ còn dòng ngừng bán: không có gì để giảm (PRM đòi tạm tính >= 1)
    let r: EvaluateResult;
    try { r = await this.deps.evaluate({ code, user_id: userId, items_subtotal: subtotal, count_attempt: countAttempt }); } catch (e) {
      if (e instanceof DependencyError && !strict) return { code, applied: false, reason: 'service_unavailable' };
      throw e;
    }
    if (r.ok) return { code: r.code, applied: true, discount: r.discount_amount, raw: r };
    return { ...couponFailure(code, r), raw: r };
  }

  async ship(methodId: string, city: string, subtotal: number, strict: boolean): Promise<ShipState> {
    try {
      const q = await this.deps.quote({ method_id: methodId, city, subtotal: Math.min(subtotal, SHIP_SUBTOTAL_MAX) }); // tạm tính vượt trần của SHP thì cắt về trần (xem report, Lệch spec)
      return { method_id: methodId, fee: q.fee, free_shipping: q.free_shipping };
    } catch (e) {
      if (e instanceof DomainError && e.code === 'method-unavailable') return { method_id: methodId, error: 'method_unavailable' };
      if (e instanceof DependencyError && !strict) return { method_id: methodId, error: 'service_unavailable' };
      throw e;
    }
  }

  async price(userId: string, snap: Cart, o: { couponCode: string | null; methodId: string | null; city: string | null; strict: boolean; coupon?: CouponState }): Promise<Priced> {
    const subtotal = BigInt(snap.items_subtotal);
    const found = o.coupon ?? (o.couponCode ? await this.coupon(userId, o.couponCode, snap.items_subtotal, o.strict) : null);
    const coupon: CouponState | null = found && 'raw' in found ? (({ raw: _raw, ...rest }) => rest as CouponState)(found as CouponState & { raw?: unknown }) : found; // `raw` (kết quả thô của PRM) chỉ dành cho bên gọi `coupon()`, không ra khỏi module
    let discount = coupon?.applied ? BigInt(coupon.discount) : 0n;
    if (discount > subtotal) discount = subtotal; // PRM bảo đảm không vượt; chặn thêm để tổng không bao giờ âm (đóng khi không chắc)
    const ship = o.methodId && o.city ? await this.ship(o.methodId, o.city, snap.items_subtotal, o.strict) : null;
    const fee = ship && 'fee' in ship ? BigInt(ship.fee) : null;
    return {
      items_subtotal: snap.items_subtotal, coupon, discount: num(discount), ship, shipping_fee: fee === null ? null : num(fee), grand_total: num(subtotal - discount + (fee ?? 0n)), total_is_estimate: fee === null,
    };
  }
}
