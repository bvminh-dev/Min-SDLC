// Hằng số nghiệp vụ của shipping đã chốt ở spec (SHP-API, SHP-DB); đổi phải chạy sdlc-impact.
export const MAX_METHODS = 20; // trần số phương thức (SHP-REQ ...755, khóa advisory khi tạo)
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const BASE_FEE_MAX = 1_000_000;
export const FREE_OVER_MAX = 10_000_000_000;
export const SURCHARGE_MAX = 500_000;
export const CITIES_MAX = 63;
export const CITY_MAX = 50; // mỗi phần tử surcharge_cities
export const CITY_QUERY_MAX = 100; // `city` của quote, khớp Address.city của USR
export const SUBTOTAL_MAX = 10_000_000_000;
export const NOTE_MAX = 300;
export const ORDER_CODE_QUERY_MAX = 32;
export const TRACKING_MIN = 8;
export const TRACKING_MAX = 30;
export const HISTORY_MAX = 100; // dòng lịch sử trả về tối đa
export const VERSION_MAX = 2_147_483_647; // int32 của cột `version`
export const SHIPMENT_STATUSES = ['pending', 'shipped', 'delivered', 'failed', 'returned', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const FAIL_REASONS = ['customer_unreachable', 'refused', 'wrong_address', 'damaged', 'other'] as const; // shipment_fail_reason, reason của ShipmentFailed (events.md)
export type FailReason = (typeof FAIL_REASONS)[number];
export const NON_RESTOCKABLE: readonly FailReason[] = ['damaged']; // hàng hỏng không nhập lại kho (R-11)

/** Bảng chuyển trạng thái vận đơn hợp lệ (SHP-DB mục Giao dịch và khóa, SB-24): NGUỒN DUY NHẤT cho mã chuyển trạng thái. Tác nhân: staff hoặc admin (HTTP), `system` (event). */
export const TRANSITIONS = {
  ship: { from: ['pending'], to: 'shipped', event: 'ShipmentShipped' },
  deliver: { from: ['shipped'], to: 'delivered', event: 'ShipmentDelivered' },
  fail: { from: ['shipped'], to: 'failed', event: 'ShipmentFailed' },
  return: { from: ['failed'], to: 'returned', event: 'ShipmentReturned' },
  cancel: { from: ['pending'], to: 'cancelled', event: null },
} as const satisfies Record<string, { from: readonly ShipmentStatus[]; to: ShipmentStatus; event: string | null }>;
export type TransitionName = keyof typeof TRANSITIONS;
