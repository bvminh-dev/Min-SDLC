// Hằng số nghiệp vụ của order đã chốt ở spec (đổi phải chạy sdlc-impact).
// Mã đơn (ADR-024): mã mới `HDyymmdd-NNNNN` (bộ đếm theo ngày giờ Việt Nam) và mã cũ 12 ký tự Crockford base32 hoa (bỏ I, L, O, U) của đơn tạo trước 2026-10-15; mọi chỗ nhận mã chấp nhận cả hai.
export const CODE_RE = /^(HD[0-9]{6}-[0-9]{5}|[0-9A-HJKMNP-TV-Z]{12})$/;
export const CODE_TZ = 'Asia/Ho_Chi_Minh'; // ngày của mã tính theo giờ này, không theo UTC
export const CODE_DAILY_MAX = 99999; // CHECK của order_code_counters: số thứ 100000 trong ngày là `order_code_exhausted`
/** Mã đơn viết hoa để tra: CHỈ ký tự ASCII in được mới đổi chữ hoa. `toUpperCase()` của chuỗi Unicode đổi `ſ` thành `S` nên mã lạ lọt khuôn `CODE_RE` và một đơn có hai cách gọi (review SHP); không phải ASCII thì trả rỗng (không khớp khuôn). Đường dẫn `{code}` không cắt khoảng trắng (`HD261015-00002%20` là 404); ô tìm của danh sách cắt trước (`searchCode`). */
export const upperCode = (v: unknown): string => (typeof v === 'string' && !/[^ -~]/.test(v) ? v.toUpperCase() : '');
/** Mã ở ô tìm (danh sách quản trị, `listForSale`): cắt khoảng trắng hai đầu rồi chuẩn hóa như `upperCode` (ORD-REQ-20261015-092748640 BR5). */
export const searchCode = (v: string): string => upperCode(v.trim());
export const SOURCE_LIMIT = 50; // số nguồn đơn tối đa (ORD-REQ-20261015-092748678 BR8)
export const SOURCE_CODE_RE = /^[a-z0-9_]{2,32}$/;
export const WEBSITE_SOURCE_ID = '00000000-0000-4000-8000-000000000001'; // nguồn hệ thống `website` của đơn khách tự đặt
export const NOTE_MAX = 1000; // ghi chú đơn hộ (ký tự)
export const ITEM_NOTE_MAX = 500; // ghi chú dòng hàng
export const HO_ITEMS_MAX = 100; // số dòng hàng tối đa của createHo
export const DISPLAY_IDS_MAX = 100; // getShipmentDisplay nhận 1..100 id
export const SWEEP_BATCH = 500; // job ord.sweep-code-counters: giới hạn lô
export const SWEEP_JOB_MS = 24 * 3600_000; // mỗi ngày
export const SEARCH_CODE_MAX = 32; // `code` của danh sách quản trị: 1..32 ký tự (ORD-API)
export const REASON_MAX = 500; // lý do hủy, đếm ký tự (ORD-DB CHECK length(reason) <= 500)
export const AGG_LIMIT_MAX = 100; // `limit` của giao diện tổng hợp cho DSH (ORD-REQ ...681 BR7)
export const SERIES_MAX_BUCKETS = 1000; // trần số mốc của getOrderSeries: chống generate_series khổng lồ (SB-34)
export const ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const FAILURE_REASONS = ['customer_unreachable', 'refused', 'wrong_address', 'damaged', 'other'] as const; // reason của ShipmentFailed (events.md)
export const COMMIT_FAILED_REASONS = ['reservation_expired', 'reservation_released', 'reservation_missing'] as const; // reason của StockCommitFailed (events.md, R-17)
export const CANCELLABLE: readonly OrderStatus[] = ['pending', 'confirmed', 'paid'];
