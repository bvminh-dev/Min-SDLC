'use client';
// Giỏ hàng (epic CRT): kiểu dữ liệu, nhãn và ánh xạ lỗi dùng chung ba màn `add-to-cart`, `cart`, `cart-summary`. Mọi số tiền đến từ phản hồi giỏ của máy chủ; giao diện KHÔNG tự cộng trừ tổng (SB-23).
import { useEffect, useState } from 'react';
import { api, type ApiResult } from './api';
import { formatPrice } from './format';

export type Availability = { status: 'ok' } | { status: 'insufficient'; available: number } | { status: 'out_of_stock' } | { status: 'unavailable' } | { status: 'unknown' };
export interface CartLine {
  id: string; product_id: string; name: string; sku: string; image_url: string | null; unit_price: number; previous_unit_price?: number; price_changed: boolean; quantity: number; line_total: number; availability: Availability;
}
export type Coupon = { code: string; applied: true; discount: number } | { code: string; applied: false; reason: string; shortfall?: number; limit?: number; used?: number };
export type ShippingSel = { method_id: string; city: string; fee: number; free_shipping: boolean } | { method_id: string; city: string; fee: null; error: 'method_unavailable' | 'service_unavailable' | 'cart_limit_exceeded' };
export interface Cart {
  cart_id: string | null; items: CartLine[]; line_count: number; item_count: number; price_changed: boolean; subtotal: number; coupon: Coupon | null; shipping: ShippingSel | null; discount: number;
  shipping_fee: number | null; total: number; total_is_estimate: boolean; checkout_blockers: string[]; can_checkout: boolean;
}
export interface ShippingMethod { id: string; name: string; base_fee: number; free_over: number | null }

export const MAX_QTY = 99;
/** Số tiền giảm hiển thị với dấu trừ thật (−). */
export const minus = (n: number): string => `−${formatPrice(n)}`;
export const limitedText = (s?: number): string => `Thao tác quá nhanh, thử lại sau ${s ?? 60} giây`;

/** Sự kiện cho huy hiệu giỏ ở đầu trang: mọi màn đổi giỏ báo tổng số lượng mới (hoặc `null` để đọc lại từ máy chủ). */
export const CART_EVENT = 'cart:changed';
export const announceCart = (itemCount: number | null): void => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { item_count: itemCount } })); };

/** Tổng số lượng ở huy hiệu: 99 trở lên hiện "99+" (ui/add-to-cart); hàm ở `cart-const.ts`. */
export { badgeText } from './cart-const';

/** Lỗi đổi số lượng, thêm vào giỏ theo mã lỗi của CRT (ui/cart, ui/add-to-cart). `available` đã bị server chặn tối đa 99. */
export function stockText(available: unknown): string {
  return typeof available === 'number' && available > 0 ? `Chỉ còn ${Math.min(available, MAX_QTY)} sản phẩm` : 'Hết hàng';
}
export function lineErrorText(r: ApiResult): string {
  if (r.status === 404) return 'Dòng này đã bị xóa';
  if (r.code === 'insufficient-stock') return stockText(r.body?.available);
  if (r.code === 'product-unavailable') return 'Sản phẩm không còn bán';
  if (r.code === 'quantity-limit-exceeded') return `Mỗi sản phẩm tối đa ${MAX_QTY}`;
  if (r.code === 'cart-limit-exceeded') return 'Giỏ hàng đã đạt giá trị tối đa';
  if (r.status === 429) return limitedText(r.retryAfter);
  if (r.status === 400) return `Chọn từ 1 đến ${MAX_QTY}`;
  return 'Không đổi được số lượng. Thử lại.';
}
export const COUPON_REASON: Record<string, string> = {
  coupon_not_found: 'không còn tồn tại', coupon_expired: 'đã hết hạn', coupon_exhausted: 'đã hết lượt', per_user_limit_reached: 'bạn đã dùng hết lượt', no_discount: 'không có mức giảm cho giỏ này', too_many_attempts: 'đang bị tạm khóa', service_unavailable: 'chưa kiểm tra được lúc này',
};
/** Tra bảng nhãn bằng giá trị từ API: `__proto__`, `constructor` không được tra ra thuộc tính của Object.prototype. */
export const own = <T,>(table: Record<string, T>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);
export function couponWarning(c: Extract<Coupon, { applied: false }>): string {
  if (c.reason === 'min_order_not_met') return `${c.code} không còn áp dụng: thiếu ${formatPrice(c.shortfall ?? 0)}`;
  return `${c.code} ${own(COUPON_REASON, c.reason) ?? 'không còn áp dụng'}`;
}
export function couponErrorText(r: ApiResult): string {
  switch (r.code) {
    case 'coupon-not-found': return 'Mã không đúng';
    case 'coupon-expired': return 'Mã đã hết hạn';
    case 'coupon-exhausted': return 'Mã đã hết lượt';
    case 'per-user-limit-reached': return 'Bạn đã dùng hết lượt của mã này';
    case 'min-order-not-met': return `Cần thêm ${formatPrice(Number(r.body?.shortfall ?? 0))} để dùng mã`;
    case 'no-discount': return 'Mã không có mức giảm cho giỏ này';
    case 'cart-empty': return 'Giỏ hàng trống';
    default: return r.status === 400 ? 'Mã phải từ 1 đến 50 ký tự' : r.status === 503 || r.status === 0 ? 'Không áp được mã lúc này. Thử lại.' : 'Không áp được mã.';
  }
}
export const CHECKOUT_REASON = (c: Cart): string => (c.items.length === 0 ? 'Giỏ trống' : c.checkout_blockers.includes('cart_limit_exceeded') ? 'Giỏ hàng vượt giá trị tối đa, hãy bớt sản phẩm' : 'Có sản phẩm hết hàng hoặc ngừng bán');
/** Số dòng cần xử lý trước khi thanh toán (hết hàng hoặc ngừng bán). */
export const blockerLines = (c: Cart): number => c.items.filter((l) => l.availability.status === 'insufficient' || l.availability.status === 'out_of_stock' || l.availability.status === 'unavailable').length;

/** Testid của hộp thoại phiên hết hạn theo trang của CRT; ngoài giỏ trả `undefined`. */
export function crtExpiredTestId(path: string): string | undefined {
  return /^\/cart\/?$/.test(path) ? 'crt-cart-session-expired' : undefined;
}

/** Số lượng ở huy hiệu giỏ: đọc `GET /cart/summary` (chỉ đọc CSDL của CRT), cập nhật theo sự kiện `cart:changed`; lỗi thì không số, không báo lỗi to. */
export function useCartBadge(enabled: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) { setN(0); return; }
    let alive = true;
    const read = async () => { const r = await api<{ item_count: number }>('/cart/summary', { silentExpired: true }); if (alive && r.status === 200 && typeof r.body.item_count === 'number') setN(r.body.item_count); };
    void read();
    const on = (e: Event) => { const c = (e as CustomEvent<{ item_count: number | null }>).detail?.item_count; if (typeof c === 'number') setN(c); else void read(); };
    window.addEventListener(CART_EVENT, on);
    return () => { alive = false; window.removeEventListener(CART_EVENT, on); };
  }, [enabled]);
  return n;
}
