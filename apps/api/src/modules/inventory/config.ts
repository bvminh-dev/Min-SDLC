// Hằng số nghiệp vụ của inventory đã chốt ở spec (đổi phải chạy sdlc-impact).
export const MAX_ON_HAND = 10_000_000; // trần nghiệp vụ mỗi sản phẩm, chỉ áp cho nhập kho và điều chỉnh (INV-REQ ...463 BR4); hoàn kho khi hủy đơn không bị chặn bởi trần này
export const MAX_QTY = 100_000; // mỗi lần nhập, xuất, và mỗi dòng giữ hàng (INV-REQ ...463 BR2, ...538 BR2)
export const MAX_RESERVE_LINES = 50; // số dòng mỗi đơn (INV-REQ ...538 BR2)
export const MAX_THRESHOLD = 1_000_000; // INV-REQ ...611
export const DEFAULT_SEARCH_IDS = 200; // `q` hỏi PRD tối đa chừng này product_id (INV-API GET /admin/inventory)
export const AVAILABILITY_MAX_IDS = 100; // endpoint công khai và getAvailability
export const SUMMARY_MAX = 50; // getLowStockSummary(limit)
export const MOVEMENT_MAX_SPAN_DAYS = 366; // khoảng lọc lịch sử
export const EXPIRE_BATCH = 500; // số đơn mỗi lô của job hết hạn (INV-DB mục Giao dịch 5, SB-34)
export const EXPIRE_JOB_MS = 60_000; // job chạy mỗi phút (ADR-013)
export const EXPIRE_BUDGET_MS = 45_000; // hạn thời gian mỗi lần chạy: dừng nhận lô mới, lượt sau làm tiếp (SB-34)
export const OVERDUE_ALERT_MS = 5 * 60_000; // log error khi còn reservation quá hạn hơn chừng này chưa xử lý (INV-SEC T8)
export const RECONCILE_JOB_MS = 24 * 3600_000; // đối soát hằng đêm (ADR-013)
export const RECONCILE_PAGE = 500; // `listActiveProductIds` tối đa 500 mỗi trang
export const RECONCILE_MAX_PAGES = 200; // trần số trang tạo bù mỗi lần chạy (100.000 sản phẩm); phần còn lại để đêm sau (SB-34)
export const RECONCILE_MAX_REPORT = 1000; // trần số dòng lệch ghi log mỗi truy vấn đối soát
export const NAME_LOOKUP_MS = 2000; // hạn đọc tên sản phẩm của PRD khi phát LowStockDetected trong giao dịch (không để chờ vô hạn khi cầm khóa, SB-31)
