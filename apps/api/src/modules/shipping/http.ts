import type { RateLimitOptions } from '../platform';

/**
 * Bảng bậc SB-14 cho SHP (SHP-API mục Giới hạn tần suất, ADR-014, R-42): báo phí, tra cứu vận đơn và lịch sử theo mã đơn là bậc C (120 mỗi phút mỗi người dùng, trong bộ nhớ); danh sách vận đơn,
 * quản trị phương thức (đọc và ghi chung một bộ đếm) và thao tác ghi của staff, admin là bậc D (30 mỗi phút mỗi người, bảng PostgreSQL của platform nên đúng giữa các instance). Khóa đếm mặc định
 * của platform: người dùng đã đăng nhập, không phải IP (xem report, Lệch spec).
 */
export const LIMITS = {
  quote: { tier: 'C', limit: 120, windowSeconds: 60 },
  lookup: { tier: 'C', limit: 120, windowSeconds: 60, group: 'shp-lookup' }, // vận đơn và lịch sử theo mã đơn chung hạn mức
  list: { tier: 'D', limit: 30, windowSeconds: 60 },
  adminMethods: { tier: 'D', limit: 30, windowSeconds: 60, group: 'shp-admin-methods' }, // đọc và ghi quản trị chung một bộ đếm
  write: { tier: 'D', limit: 30, windowSeconds: 60, group: 'shp-staff-write' }, // ship, tracking-number, deliver, fail, return
} as const satisfies Record<string, RateLimitOptions>;
