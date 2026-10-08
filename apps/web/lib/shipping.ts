// Vận chuyển (epic SHP): kiểu dữ liệu, nhãn và ánh xạ dùng chung bốn màn `shipment-tracking`, `shipment-admin-list`, `shipment-admin-detail`, `shipping-method-admin`.
export type ShipmentStatus = 'pending' | 'shipped' | 'delivered' | 'failed' | 'returned' | 'cancelled';
export const SHIPMENT_STATUSES: ShipmentStatus[] = ['pending', 'shipped', 'delivered', 'failed', 'returned', 'cancelled'];

/** Tra bảng nhãn bằng giá trị từ API hoặc người nhập: `__proto__`, `constructor`, `toString` không được tra ra thuộc tính của Object.prototype. */
const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

const STATUS_LABEL: Record<ShipmentStatus, string> = { pending: 'Chờ bàn giao', shipped: 'Đang giao', delivered: 'Đã giao', failed: 'Giao thất bại', returned: 'Đã hoàn', cancelled: 'Đã hủy' };
export const shipmentStatusText = (s: string): string => own(STATUS_LABEL, s) ?? s;

export const FAIL_REASONS: { code: string; label: string }[] = [
  { code: 'customer_unreachable', label: 'Không liên lạc được' }, { code: 'refused', label: 'Từ chối nhận' }, { code: 'wrong_address', label: 'Sai địa chỉ' }, { code: 'damaged', label: 'Hàng hỏng' }, { code: 'other', label: 'Khác' },
];
const FAIL_LABEL: Record<string, string> = Object.fromEntries(FAIL_REASONS.map((r) => [r.code, r.label]));
export const failReasonText = (code: string): string => own(FAIL_LABEL, code) ?? code;

export interface Recipient { receiver: string; phone: string; line1: string; ward: string; city: string }
export interface Shipment {
  status: ShipmentStatus; tracking_number: string | null; method_name: string; shipped_at: string | null; delivered_at: string | null;
  version?: number; cod_amount?: number; reason_code?: string | null; note?: string | null; recipient?: Recipient | null;
}
export interface ShipmentView { order_code: string; shipment: Shipment | null; recipient?: Recipient | null }
export interface HistoryEntry { at: string; event: 'status_changed' | 'tracking_changed'; status: ShipmentStatus; tracking_number?: string | null; reason_code?: string | null; note?: string | null }
export interface ShipmentRow { order_code: string; status: ShipmentStatus; tracking_number: string | null; method_name: string; created_at: string; updated_at: string }
export interface MethodRule { free_over?: number | null; surcharge?: number; surcharge_cities?: string[] }
export interface ShippingMethod { id: string; name: string; base_fee: number; rule: MethodRule; is_active: boolean; version: number }

/** Nhãn một dòng hành trình: `customer` không bao giờ mang lý do hay ghi chú (nội bộ). */
export function historyText(h: HistoryEntry, customer: boolean): string {
  if (h.event === 'tracking_changed') return `Đổi mã vận đơn${h.tracking_number ? ` · ${h.tracking_number}` : ''}`;
  switch (h.status) {
    case 'pending': return customer ? 'Đã tạo vận đơn' : 'Đã tạo vận đơn (chờ bàn giao)';
    case 'shipped': return `${customer ? 'Đã bàn giao cho đơn vị vận chuyển' : 'Đã bàn giao'}${h.tracking_number ? ` · ${h.tracking_number}` : ''}`;
    case 'delivered': return 'Đã giao';
    case 'failed': return 'Giao thất bại';
    case 'returned': return 'Hàng đã hoàn về kho';
    case 'cancelled': return 'Đã hủy vận đơn';
    default: return shipmentStatusText(String(h.status));
  }
}

/** Khuôn mã vận đơn của API (8 tới 30 ký tự chữ, số, gạch nối): giá trị gõ dở ngắn hơn thì không gọi API (API trả 400) mà coi như không có kết quả. */
export const TRACKING_RE = /^[A-Za-z0-9-]{8,30}$/;

/** Mã vận đơn: chữ hoa ngay khi gõ (8 tới 30 ký tự chữ, số, gạch nối do server kiểm). */
export const upperTracking = (s: string): string => s.toUpperCase();

/** Đường dẫn chi tiết vận đơn của staff, admin; `back` là chuỗi truy vấn của danh sách để quay lại giữ bộ lọc. */
export const detailHref = (code: string, back: string): string => `/admin/shipments/${encodeURIComponent(code)}${back ? `?back=${encodeURIComponent(back)}` : ''}`;
export const listHref = (back: string | null): string => `/admin/shipments${back ? `?${back}` : ''}`;

/** Testid của hộp thoại phiên hết hạn theo trang (SHP có testid riêng cho từng màn); ngoài SHP trả `undefined`. */
export function expiredTestId(path: string): string | undefined {
  if (/^\/orders\/[^/]+\/shipment\/?$/.test(path)) return 'shp-shipment-tracking-session-expired';
  if (/^\/admin\/shipments\/?$/.test(path)) return 'shp-shipment-admin-list-session-expired';
  if (/^\/admin\/shipments\/[^/]+\/?$/.test(path)) return 'shp-shipment-admin-detail-session-expired';
  if (/^\/admin\/shipping-methods\/?$/.test(path)) return 'shp-shipping-method-admin-session-expired';
  return undefined;
}
