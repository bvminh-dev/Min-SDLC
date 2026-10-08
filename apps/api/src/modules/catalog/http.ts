import type { RateLimitOptions } from '../platform';

/** Bảng bậc SB-14 cho PRD (PRD-API mục Giới hạn tần suất): endpoint công khai dùng bậc C mặc định của platform (120 mỗi phút mỗi IP, không khai ở đây). */
export const LIMITS = {
  adminRead: { tier: 'D', limit: 30, windowSeconds: 60, group: 'prd:admin-read' }, // danh sách và chi tiết quản trị chung một bộ đếm mỗi người
} as const satisfies Record<string, RateLimitOptions>;
