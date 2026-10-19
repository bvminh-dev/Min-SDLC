// Bán hàng hộ (epic SAL): kiểu dữ liệu, nhãn và hàm thuần dùng chung ba màn `sale-create-order`, `sale-order-list`, `sale-order-detail`.
import type { OrderStatus, PaymentMethod, PaymentStatus } from './order';

export type SalePayment = 'cod' | 'cash' | 'bank_transfer';
export const SALE_PAYMENTS: [SalePayment, string][] = [['cod', 'COD'], ['cash', 'Tiền mặt'], ['bank_transfer', 'Chuyển khoản']];
export const NOTE_MAX = 1000;
export const ITEM_NOTE_MAX = 500;
export const QTY_MAX = 100_000;

/** Phần của kết quả `api()` mà `createOutcome` đọc (tự đủ, không import ./api vốn dùng `window`: hàm thuần ở đây được test API import trực tiếp, apps/api/test/sales/web-lib.spec.ts). */
export interface ApiLike { status: number; body: any; code?: string; retryAfter?: number; fieldErrors: Record<string, string> }
export interface SaleSource { id: string; code: string; name: string; is_active: boolean }
export interface SaleCustomerHit { id: string; full_name: string; email: string; phone: string | null; status: 'active' | 'locked' }
export interface ProductHit { id: string; name: string; price: number }
export interface ShipOption { method_id: string; name: string; fee: number; free_shipping: boolean }
export interface SaleOrderRow {
  code: string; status: OrderStatus; payment_method: PaymentMethod; payment_status: PaymentStatus; grand_total: number; items_count: number; source: { code: string; name: string };
  customer: { name: string; phone: string }; created_at: string; created_by?: { id: string; name: string | null };
}
export interface SaleOrderDetail {
  code: string; status: OrderStatus; payment_method: PaymentMethod; payment_status: PaymentStatus; created_at: string; confirmed_at: string | null; paid_at: string | null; delivered_at: string | null; cancel_reason?: string;
  source: { code: string; name: string }; note: string | null; customer: { name: string; phone: string; has_account: boolean };
  shipping_address: { receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string };
  items: { product_id: string; name: string; quantity: number; unit_price: number; line_total: number; note: string | null }[];
  items_total: number; discount: number; shipping_fee: number; grand_total: number; created_by?: { id: string; name: string | null };
}

/** Ô tra khách: có `@` thì tra theo email, còn lại theo điện thoại (SAL-REQ-20261015-092710942; ui/sale-create-order, ghi chú thiết kế). */
export const lookupQuery = (raw: string): string => { const v = raw.trim(); return v.includes('@') ? `email=${encodeURIComponent(v)}` : `phone=${encodeURIComponent(v)}`; };

/** Số ký tự Unicode (điểm mã), khớp cách đếm của server (emoji tính một ký tự). */
export const len = (s: string): number => [...s].length;
export const parseQty = (s: string): number | null => (/^\d{1,6}$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= QTY_MAX ? Number(s) : null);

/** Nhãn lý do hủy đơn: nhãn cố định (do admin hay hệ thống hủy), không bao giờ hiện mã thô. */
const CANCEL_LABEL: Record<string, string> = { admin: 'Quản trị viên hủy', customer_request: 'Khách yêu cầu hủy', payment_failed: 'Thanh toán thất bại', stock_commit_failed: 'Hết hàng giữ chỗ' };
export const cancelText = (reason: string): string => (Object.prototype.hasOwnProperty.call(CANCEL_LABEL, reason) ? CANCEL_LABEL[reason] : 'Đơn đã bị hủy');

/** Lỗi nhập liệu theo trường của server (400): tên trường trong `errors` đổi sang câu tiếng Việt. */
const FIELD_CODE: Record<string, string> = {
  required: 'Bắt buộc', too_long: 'Quá dài', too_short: 'Quá ngắn', invalid_phone: 'Số điện thoại không hợp lệ', invalid_format: 'Không hợp lệ', out_of_range: 'Ngoài khoảng cho phép',
  duplicate_product: 'Sản phẩm bị trùng', unknown_field: 'Không hợp lệ',
};
export const fieldErrorText = (code: string): string => (Object.prototype.hasOwnProperty.call(FIELD_CODE, code) ? FIELD_CODE[code] : 'Không hợp lệ');

/** Kết quả gọi tạo đơn đổi thành MỘT trạng thái giao diện (ui/sale-create-order, bảng Trạng thái). */
export type CreateOutcome =
  | { k: 'done'; code: string } | { k: 'price'; previous: number; next: number } | { k: 'source' } | { k: 'products'; ids: string[] } | { k: 'stock'; items: { product_id: string; name: string; requested: number; available: number }[] }
  | { k: 'shipping' } | { k: 'customer' } | { k: 'range' } | { k: 'rate'; seconds?: number } | { k: 'login' } | { k: 'form'; fields: Record<string, string> } | { k: 'error' };
export function createOutcome(r: ApiLike): CreateOutcome {
  const b = r.body ?? {};
  if (r.status === 201 || (r.status === 200 && b.order?.code)) return { k: 'done', code: String(b.order.code) };
  if (r.status === 401) return { k: 'login' };
  if (r.status === 429) return { k: 'rate', seconds: r.retryAfter };
  if (r.status === 400 && r.code === 'validation-failed') return { k: 'form', fields: r.fieldErrors };
  switch (r.code) {
    case 'price-changed': return { k: 'price', previous: Number(b.previous_grand_total), next: Number(b.review?.grand_total) };
    case 'order-source-unavailable': return { k: 'source' };
    case 'product-unavailable': return { k: 'products', ids: Array.isArray(b.items) ? b.items.map((i: { product_id: string }) => String(i.product_id)) : [] };
    case 'insufficient-stock': return { k: 'stock', items: Array.isArray(b.items) ? b.items.map((i: any) => ({ product_id: String(i.product_id), name: String(i.name), requested: Number(i.requested), available: Number(i.available) })) : [] };
    case 'shipping-method-unavailable': return { k: 'shipping' };
    case 'customer-not-found': return { k: 'customer' };
    case 'order-total-out-of-range': return { k: 'range' };
    default: return { k: 'error' };
  }
}
