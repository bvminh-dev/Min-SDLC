// Thanh toán (epic CHK): kiểu dữ liệu, nhãn và ánh xạ lỗi dùng chung ba màn `checkout`, `checkout-complete`, `checkout-blocked`.
// Mọi số tiền đến từ phản hồi của máy chủ; giao diện KHÔNG tự cộng trừ (SB-23, CHK-REQ-20261006-105051681 BR2).
import { formatPrice } from './format';

// Tự đủ (không import ./api và ./cart, vốn dùng `window`): hàm thuần ở đây được test API import trực tiếp (apps/api/test/checkout/web-lib.spec.ts) và phải biên dịch được không cần DOM.
/** Phần của kết quả `api()` mà các hàm ở đây đọc (khớp `ApiResult` của lib/api.ts). */
export interface ApiResult { status?: number; code?: string; body?: any }
export type Availability = { status: 'ok' } | { status: 'insufficient'; available: number } | { status: 'out_of_stock' } | { status: 'unavailable' } | { status: 'unknown' };
const own = <T,>(table: Record<string, T>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

export type PayMethod = 'vnpay' | 'cod';
export interface ChkLine { product_id: string; name: string; quantity: number; unit_price: number; line_total: number; availability: Availability }
export type ChkCoupon = { code: string; applied: true; discount: number } | { code: string; applied: false; reason: string; min_order_value?: number; shortfall?: number; limit?: number; used?: number };
export interface ChkAddress { address_id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; changed: boolean }
export type ChkAddressView = ChkAddress | { address_id: null; error: 'address_unavailable' } | null;
export type ChkShipping = { method_id: string; name: string; city: string | null; fee: number | null; free_shipping: boolean } | { method_id: string; error: 'method_unavailable' | 'service_unavailable' } | null;
/** Bản xem lại của phiên còn `open` (GET /checkout/sessions/{id}). */
export interface ChkView {
  id: string; status: 'open'; expires_at: string; cart_version: number; lines: ChkLine[]; items_subtotal: number; coupon: ChkCoupon | null; address: ChkAddressView; shipping: ChkShipping;
  payment_method: PayMethod | null; payment_note: { hold_minutes: number | null; confirmed_immediately: boolean } | null; discount: number; shipping_fee: number | null; grand_total: number;
  total_is_estimate: boolean; expected_grand_total: number; blockers: string[]; can_place_order: boolean;
}
export interface ShipOption { method_id: string; name: string; fee: number; free_shipping: boolean }
export interface UserAddress { id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; is_default: boolean }
export interface PlaceOut { replayed: boolean; order: { code: string; status: string; grand_total: number; payment_method: PayMethod }; next: { action: 'pay' | 'done'; url: string }; payment_deadline?: string }

/** Lý do không đặt được (`blockers` của máy chủ) bằng tiếng Việt. */
export const BLOCKER_TEXT: Record<string, string> = {
  missing_address: 'Chưa chọn địa chỉ giao hàng',
  missing_shipping_method: 'Chưa chọn phương thức vận chuyển',
  missing_payment_method: 'Chưa chọn phương thức thanh toán',
  no_shipping_methods: 'Chưa có phương thức vận chuyển nào đang bật',
  address_unavailable: 'Địa chỉ đã chọn không còn, hãy chọn lại',
  address_changed: 'Địa chỉ đã được cập nhật, hãy xác nhận địa chỉ mới',
  shipping_method_unavailable: 'Phương thức vận chuyển không còn dùng được, hãy chọn lại',
  coupon_invalid: 'Mã giảm giá không còn áp dụng, hãy gỡ mã',
  cart_unavailable_items: 'Có sản phẩm không còn bán, hãy xóa ở giỏ hàng',
  insufficient_stock: 'Có sản phẩm không đủ hàng, hãy chỉnh số lượng ở giỏ hàng',
  amount_out_of_range_online: 'Số tiền ngoài khoảng VNPay, hãy chọn COD',
  zero_total: 'Đơn 0 đồng chưa được hỗ trợ',
  too_many_open_orders: 'Bạn đang có quá nhiều đơn chưa hoàn tất',
  email_not_verified: 'Cần xác minh email trước khi đặt hàng',
  cart_empty: 'Giỏ hàng đang trống',
};
export const blockerText = (code: string): string => own(BLOCKER_TEXT, code) ?? `Chưa đặt hàng được (${code})`;

export const waitText = (s?: number): string => `Bạn thao tác quá nhanh, thử lại sau ${s ?? 60} giây`;
export const SESSION_CLOSED = 'checkout-session-closed';
/** Trạng thái của phiên đã đóng: trường `session_status` (không phải `status`, vì `status` của problem+json là mã HTTP). */
export const sessionStatusOf = (r: ApiResult): 'expired' | 'cancelled' => (r.body?.session_status === 'cancelled' ? 'cancelled' : 'expired');

/** Địa chỉ trên một dòng (không có tên và số điện thoại). */
export const addressText = (a: { line1: string; ward: string; district: string | null; city: string }): string => [a.line1, a.ward, a.district, a.city].filter(Boolean).join(', ');

/** Nhãn tình trạng hàng của dòng: chỉ dòng thiếu mới có nhãn (không lộ tồn của dòng đủ hàng). */
export function availabilityText(a: Availability): string | null {
  if (a.status === 'out_of_stock') return 'Hết hàng';
  if (a.status === 'insufficient') return `Chỉ còn ${a.available}`;
  if (a.status === 'unavailable') return 'Ngừng bán';
  return null;
}

/** Câu lỗi của bước chọn thanh toán (422, 409) và bước đặt hàng cùng mã. */
export type PayError = { kind: 'range'; min: number; max: number } | { kind: 'zero' } | { kind: 'open-orders'; current?: number; limit?: number };
export function payErrorOf(r: ApiResult): PayError | null {
  if (r.code === 'amount-out-of-range-online') return { kind: 'range', min: Number(r.body?.min ?? 5000), max: Number(r.body?.max ?? 999_999_999) };
  if (r.code === 'zero-total-unsupported') return { kind: 'zero' };
  if (r.code === 'too-many-open-orders') return { kind: 'open-orders', current: Number(r.body?.current), limit: Number(r.body?.limit) };
  return null;
}
export function payErrorText(e: PayError): string {
  if (e.kind === 'range') return `VNPay chỉ nhận từ ${e.min.toLocaleString('vi-VN')} đến ${e.max.toLocaleString('vi-VN')} đ, hãy chọn COD`;
  if (e.kind === 'zero') return 'Đơn 0 đồng chưa được hỗ trợ';
  return `Bạn đang có quá nhiều đơn chưa hoàn tất${Number.isFinite(e.current) && Number.isFinite(e.limit) ? ` (hiện có ${e.current}, tối đa ${e.limit})` : ''}`;
}

/** Địa chỉ trang kết quả đặt hàng. `deadline` (ISO) là `payment_deadline` của phản hồi đặt hàng; khi tải lại trang lấy `payment_expires_at` từ chi tiết đơn. */
export function completeUrl(code: string, o: { replayed?: boolean; deadline?: string } = {}): string {
  const q = new URLSearchParams({ code });
  if (o.replayed) q.set('replayed', '1');
  if (o.deadline) q.set('deadline', o.deadline);
  return `/checkout/complete?${q.toString()}`;
}
export const validIso = (s: string | null | undefined): string | null => (s && Number.isFinite(new Date(s).getTime()) ? s : null);
export const priceLine = (a: number, b: number): string => `${formatPrice(a)} → ${formatPrice(b)}`;
