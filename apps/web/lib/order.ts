// Đơn hàng (epic ORD): kiểu dữ liệu, nhãn và định dạng dùng chung ba màn `order-list`, `order-admin-list`, `order-detail`.
export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'expired' | 'returned';
export const STATUS_ORDER: OrderStatus[] = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'];
/** Nhãn trạng thái đơn (ui/order-list, ghi chú thiết kế): đọc rõ không chỉ bằng màu. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Chờ xử lý', confirmed: 'Đã xác nhận', paid: 'Đã thanh toán', shipped: 'Đang giao', delivered: 'Đã giao', returned: 'Đã hoàn', cancelled: 'Đã hủy', expired: 'Hết hạn',
};
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'refunded';
const PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: 'Chờ thanh toán', processing: 'Đang xử lý', succeeded: 'Thành công', failed: 'Thất bại', expired: 'Hết hạn', cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền' };

export type PaymentMethod = 'vnpay' | 'cod' | 'cash' | 'bank_transfer';
/** Đơn hộ (cod, cash, bank_transfer) thu sau hoặc ngoài cổng: chưa thu không bao giờ mang chữ "đã thanh toán". */
const OFFLINE_LABEL: Record<Exclude<PaymentMethod, 'vnpay'>, string> = { cod: 'COD', cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản' };
/** "VNPay · Thành công", "COD · Chưa thu tiền", "Tiền mặt · Đã thu tiền", "Chuyển khoản · Chưa thu tiền". COD chưa thu không bao giờ mang chữ "đã thanh toán" (ui/order-detail). */
export function paymentText(method: PaymentMethod, status: PaymentStatus): string {
  if (method !== 'vnpay') return `${OFFLINE_LABEL[method]} · ${status === 'pending' ? 'Chưa thu tiền' : status === 'succeeded' ? 'Đã thu tiền' : PAYMENT_LABEL[status]}`;
  return `VNPay · ${PAYMENT_LABEL[status]}`;
}

/** Lý do trong lịch sử: lý do hủy của người dùng là văn bản thường; lý do của hệ thống và mã giao thất bại đổi thành nhãn cố định. */
const REASON_LABEL: Record<string, string> = {
  payment_failed: 'Thanh toán thất bại', stock_commit_failed: 'Hết hàng giữ chỗ, đã hoàn tiền',
  customer_unreachable: 'khách vắng nhà', refused: 'từ chối nhận', wrong_address: 'sai địa chỉ', damaged: 'hàng hư hỏng', other: 'khác',
};
const hasLabel = (reason: string): boolean => Object.prototype.hasOwnProperty.call(REASON_LABEL, reason); // lý do do người nhập: `__proto__`, `constructor` không được tra ra thuộc tính của Object.prototype
export const reasonText = (status: string, reason: string, failedDelivery: boolean): string => (failedDelivery || status === 'cancelled' ? (hasLabel(reason) ? REASON_LABEL[reason] : reason) : reason);

/** Dòng danh sách: `source`, `created_by_name`, `created_by` chỉ có ở danh sách quản trị (staff, sale, admin; customer không có, ORD-API). */
export interface OrderRow {
  code: string; created_at: string; status: OrderStatus; grand_total: number; payment_method: PaymentMethod; payment_status: PaymentStatus; item_count: number;
  source?: { code: string; name: string }; created_by_name?: string | null; created_by?: string | null;
}
/** Nguồn đơn của danh mục (`GET /order-sources`). */
export interface SourceOption { id: string; code: string; name: string; is_active: boolean }
export interface OrderDetail {
  code: string; status: OrderStatus; created_at: string; items: { name: string; unit_price: number; quantity: number; line_total: number; note?: string | null; cost_snapshot?: number | null }[];
  items_total: number; discount: number; shipping_fee: number; grand_total: number; payment_method: PaymentMethod; payment_status: PaymentStatus;
  /** Chỉ staff, sale, admin (customer không có): nguồn, người tạo, ghi chú; `customer` chỉ sale và admin, đơn hộ; `items[].cost_snapshot` chỉ admin (ORD-REQ-20261006-092320768 BR10). */
  source?: { code: string; name: string }; created_by_name?: string | null; note?: string | null; customer?: { full_name: string; phone: string };
  tracking_number?: string; payment_expires_at?: string; shipping_address?: { receiver: string; phone: string; line1: string; ward: string; district?: string | null; city: string }; can_cancel: boolean;
}
export interface HistoryItem { at: string; status: OrderStatus; reason?: string }

const VN_OFFSET_MS = 7 * 3600_000; // Asia/Ho_Chi_Minh, không giờ mùa hè: tính tay UTC+7 để không phụ thuộc múi giờ của máy hay `Intl`
const two = (n: number): string => String(n).padStart(2, '0');
const vn = (iso: string): Date => new Date(new Date(iso).getTime() + VN_OFFSET_MS);
/** `06/10/2026 09:00` theo giờ Việt Nam. */
export const formatOrderTime = (iso: string): string => { const d = vn(iso); return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
/** `09:15` theo giờ Việt Nam (hạn thanh toán). */
export const formatClock = (iso: string): string => { const d = vn(iso); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
