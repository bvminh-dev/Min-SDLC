// Hằng số và hàm thuần của NTF cho giao diện (ui/notification-bell, ui/notification-list). Ở tệp riêng, không phụ thuộc React hay `window`, để test API import được (như `cart-const.ts`).
export type NotifType =
  | 'order_created' | 'order_confirmed' | 'payment_succeeded' | 'payment_failed' | 'order_cancelled' | 'order_expired' | 'refund_succeeded' | 'order_shipped' | 'shipment_failed'
  | 'order_delivered' | 'order_returned' | 'welcome' | 'password_changed' | 'low_stock' | 'refund_failed';
export interface Notif { id: string; type: NotifType; title: string; body: string; link: string | null; status: 'unread' | 'read'; read_at: string | null; created_at: string }
export interface NotifList { items: Notif[]; page: number; limit: number; total: number; unread_count: number }

/** Số trên huy hiệu: ẩn khi 0 (trả rỗng), lớn hơn 99 hiện "99+" (NTF-REQ-20261006-103209256 BR4; API trả số thật). */
export const badgeText = (n: number): string => (n > 99 ? '99+' : n > 0 ? String(n) : '');

/** Nhãn tiếng Việt của từng loại (ô lọc ở notification-list), đúng bảng của ui/notification-list; không gom nhóm vì API lọc theo từng `type`. */
export const TYPE_LABEL: Record<NotifType, string> = {
  order_created: 'Đơn đã tạo', order_confirmed: 'Đơn đã xác nhận', payment_succeeded: 'Thanh toán thành công', payment_failed: 'Thanh toán thất bại', order_cancelled: 'Đơn bị hủy',
  order_expired: 'Đơn hết hạn', refund_succeeded: 'Hoàn tiền', order_shipped: 'Đang giao', shipment_failed: 'Giao thất bại', order_delivered: 'Đã giao', order_returned: 'Hoàn về',
  welcome: 'Chào mừng', password_changed: 'Đổi mật khẩu', low_stock: 'Tồn kho', refund_failed: 'Hoàn tiền thất bại',
};
const CUSTOMER_TYPES: NotifType[] = ['order_created', 'order_confirmed', 'payment_succeeded', 'payment_failed', 'order_cancelled', 'order_expired', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'welcome', 'password_changed'];
/** Loại trong ô lọc theo role: customer chỉ các loại nó nhận được; staff thêm `low_stock`; admin thêm `low_stock` và `refund_failed` (NTF-REQ-20261006-103209168 BR1 đến BR3). */
export const typesFor = (role: 'customer' | 'staff' | 'sale' | 'admin' | undefined): NotifType[] =>
  role === 'admin' ? [...CUSTOMER_TYPES, 'low_stock', 'refund_failed'] : role === 'staff' ? [...CUSTOMER_TYPES, 'low_stock'] : CUSTOMER_TYPES;
export const isType = (v: string | null | undefined): v is NotifType => typeof v === 'string' && Object.prototype.hasOwnProperty.call(TYPE_LABEL, v);

/** Chỉ đường dẫn nội bộ MỘT dấu gạch chéo đầu mới được điều hướng (CHECK `link ~ '^/[A-Za-z0-9/_-]*$'` ở CSDL là lớp thứ nhất; đây là lớp thứ hai ở trình duyệt, chống chuyển hướng ra ngoài). */
export const safeLink = (l: unknown): string | null => (typeof l === 'string' && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(l) ? l : null); // `(?!\/)`: không `//host` không chấm (`//intranet`, `//2130706433` là URL cùng giao thức); cùng ngôn ngữ với CHECK `notifications_link_internal_v2` (`^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$`, NTF-DB, NTF-SEC T15, REV-NTF-04)
export const STATUS_TABS = [{ value: '', label: 'Tất cả' }, { value: 'unread', label: 'Chưa đọc' }, { value: 'read', label: 'Đã đọc' }] as const;
export const POLL_MS = 60_000; // làm mới huy hiệu mỗi 60 giây khi tab đang mở (ui/notification-bell: không có kênh đẩy ở v1)
export const PANEL_LIMIT = 5;
