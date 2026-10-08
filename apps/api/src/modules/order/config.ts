// Hằng số nghiệp vụ của order đã chốt ở spec (đổi phải chạy sdlc-impact).
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 hoa, bỏ I, L, O, U (ORD-DB mục Bảng)
export const CODE_LENGTH = 12;
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
/** Mã đơn viết hoa để tra: CHỈ ký tự ASCII in được mới đổi chữ hoa. `toUpperCase()` của chuỗi Unicode đổi `ſ` thành `S` nên mã lạ lọt khuôn `CODE_RE` và một đơn có hai cách gọi (review SHP); không phải ASCII thì trả rỗng (không khớp khuôn). */
export const upperCode = (v: unknown): string => (typeof v === 'string' && !/[^ -~]/.test(v) ? v.toUpperCase() : '');
export const CODE_ATTEMPTS = 5; // sinh lại mã khi trùng unique
export const SEARCH_CODE_MAX = 32; // `code` của danh sách quản trị: 1..32 ký tự (ORD-API)
export const REASON_MAX = 500; // lý do hủy, đếm ký tự (ORD-DB CHECK length(reason) <= 500)
export const AGG_LIMIT_MAX = 100; // `limit` của giao diện tổng hợp cho DSH (ORD-REQ ...681 BR7)
export const SERIES_MAX_BUCKETS = 1000; // trần số mốc của getOrderSeries: chống generate_series khổng lồ (SB-34)
export const ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const FAILURE_REASONS = ['customer_unreachable', 'refused', 'wrong_address', 'damaged', 'other'] as const; // reason của ShipmentFailed (events.md)
export const COMMIT_FAILED_REASONS = ['reservation_expired', 'reservation_released', 'reservation_missing'] as const; // reason của StockCommitFailed (events.md, R-17)
export const CANCELLABLE: readonly OrderStatus[] = ['pending', 'confirmed', 'paid'];
