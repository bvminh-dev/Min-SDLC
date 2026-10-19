// Biến cấu hình và hằng số của DSH (ADR-007, ADR-020, DSH-API mục Biến môi trường). DSH không có bảng, không migration.
import { cfg, registerConfigSchema } from '../platform';

export const DASHBOARD_VARS = {
  /** Bộ nhớ đệm theo (khối, tham số), giây (ADR-020, DSH-REQ-20261006-105126549 BR4). */
  DASHBOARD_CACHE_TTL_SECONDS: cfg.int({ default: 60, min: 1, max: 3600 }),
  /** Hạn mỗi lời gọi tới một module nguồn, mili giây (BR5): quá hạn thì khối đó trả 503. */
  DASHBOARD_SOURCE_TIMEOUT_MS: cfg.int({ default: 5000, min: 50, max: 60_000 }),
  /** Giới hạn tần suất mỗi admin mỗi phút trên mọi endpoint của DSH (BR6, bậc D của SB-14, kho đếm PostgreSQL của platform). */
  DASHBOARD_RATE_LIMIT_PER_MINUTE: cfg.int({ default: 30, min: 1, max: 100_000 }),
};
registerConfigSchema(DASHBOARD_VARS);

// Hằng số nghiệp vụ đã chốt ở spec (DSH-REQ, DSH-API); đổi phải chạy sdlc-impact.
export const TZ_OFFSET_MS = 7 * 3_600_000; // Asia/Ho_Chi_Minh là UTC+7 quanh năm, không có giờ mùa hè
export const MAX_RANGE_DAYS = 366; // DSH-REQ-20261006-105125714 BR5
export const DEFAULT_RANGE_DAYS = 30;
export const MIN_DATE_NUM = 0; // 1970-01-01: sớm hơn là 400 (nguồn chỉ nhận năm 1..9999, ngày địa phương trừ 7 giờ không được tràn xuống năm 0); xem report DSH, Lệch spec
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const CHUNK_HOURS = 960; // nguồn nhận tối đa 1000 mốc: PAY và ORD chia theo giờ UTC, DSH gộp lại theo ngày địa phương (xem buckets.ts)
export const GRANULARITY_DAY_MAX = 31; // DSH-REQ-20261006-105126271 BR3
export const GRANULARITY_WEEK_MAX = 92;
export const LOW_STOCK_LIMIT = 5; // DSH-REQ-20261006-105126089 BR2
export const RECENT_LIMIT = 10; // DSH-REQ-20261006-105126180 BR1
export const TOP_LIMIT_DEFAULT = 10; // DSH-REQ-20261006-105126458 BR4
export const TOP_LIMIT_MAX = 50;
export const CACHE_MAX_ENTRIES = 500; // Map có hạn (DSH-DB mục Lưu trữ tạm)
export const AUDIT_MARKS_MAX = 5000;
export const MAX_INFLIGHT_PER_SOURCE = 6; // số lời gọi tới một nguồn đang chạy (kể cả lời gọi đã quá hạn nhưng truy vấn chưa xong): quá thì 503 ngay, không dồn thêm vào nguồn đang chậm
export const AUDIT_ACTION = 'dashboard.view';
export const EXPORT_ACTION = 'dashboard.export'; // xuất CSV: MỘT dòng mỗi lần thành công, không gộp (DSH-REQ-20261015-092608812 BR8)
export const WEBSITE_LABEL = 'Khách tự đặt (website)'; // dòng gom đơn `created_by` rỗng của báo cáo theo sale (DSH-REQ-20261015-092608849 BR4)
export const DELETED_LABEL = '(tài khoản đã xóa)'; // người tạo không còn tra được tên (BR5): dòng và tiền vẫn đủ
export const SOURCES = ['ORD', 'PRD', 'INV', 'USR', 'PAY'] as const;
export type Source = (typeof SOURCES)[number];
export const BLOCKS = ['revenue', 'orders', 'customers', 'products', 'low-stock', 'recent-orders', 'report-revenue', 'report-orders', 'report-products', 'report-sources', 'report-sales'] as const;
export type Block = (typeof BLOCKS)[number];
export const ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
