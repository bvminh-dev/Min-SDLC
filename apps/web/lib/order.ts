// Đơn hàng (epic ORD): kiểu dữ liệu, nhãn và định dạng dùng chung ba màn `order-list`, `order-admin-list`, `order-detail`.
export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'expired' | 'returned';
export const STATUS_ORDER: OrderStatus[] = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'];
/** Nhãn trạng thái đơn (ui/order-list, ghi chú thiết kế): đọc rõ không chỉ bằng màu. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Chờ xử lý', confirmed: 'Đã xác nhận', paid: 'Đã thanh toán', shipped: 'Đang giao', delivered: 'Đã giao', returned: 'Đã hoàn', cancelled: 'Đã hủy', expired: 'Hết hạn',
};
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'refunded';
const PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: 'Chờ thanh toán', processing: 'Đang xử lý', succeeded: 'Thành công', failed: 'Thất bại', expired: 'Hết hạn', cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền' };

/** "VNPay · Thành công", "COD · Chưa thu tiền", "COD · Đã thu tiền". COD chưa thu không bao giờ mang chữ "đã thanh toán" (ui/order-detail). */
export function paymentText(method: 'vnpay' | 'cod', status: PaymentStatus): string {
  if (method === 'cod') return `COD · ${status === 'pending' ? 'Chưa thu tiền' : status === 'succeeded' ? 'Đã thu tiền' : PAYMENT_LABEL[status]}`;
  return `VNPay · ${PAYMENT_LABEL[status]}`;
}

/** Lý do trong lịch sử: lý do hủy của người dùng là văn bản thường; lý do của hệ thống và mã giao thất bại đổi thành nhãn cố định. */
const REASON_LABEL: Record<string, string> = {
  payment_failed: 'Thanh toán thất bại', stock_commit_failed: 'Hết hàng giữ chỗ, đã hoàn tiền',
  customer_unreachable: 'khách vắng nhà', refused: 'từ chối nhận', wrong_address: 'sai địa chỉ', damaged: 'hàng hư hỏng', other: 'khác',
};
const hasLabel = (reason: string): boolean => Object.prototype.hasOwnProperty.call(REASON_LABEL, reason); // lý do do người nhập: `__proto__`, `constructor` không được tra ra thuộc tính của Object.prototype
export const reasonText = (status: string, reason: string, failedDelivery: boolean): string => (failedDelivery || status === 'cancelled' ? (hasLabel(reason) ? REASON_LABEL[reason] : reason) : reason);

export interface OrderRow { code: string; created_at: string; status: OrderStatus; grand_total: number; payment_method: 'vnpay' | 'cod'; payment_status: PaymentStatus; item_count: number }
export interface OrderDetail {
  code: string; status: OrderStatus; created_at: string; items: { name: string; unit_price: number; quantity: number; line_total: number }[];
  items_total: number; discount: number; shipping_fee: number; grand_total: number; payment_method: 'vnpay' | 'cod'; payment_status: PaymentStatus;
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
