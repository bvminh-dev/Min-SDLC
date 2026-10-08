import type { RateLimitOptions } from '../platform';

/**
 * Bảng bậc SB-14 cho ORD (ORD-API mục Thứ tự kiểm, ADR-014): tra cứu của mình, chi tiết, lịch sử là bậc C (120 mỗi phút), danh sách quản trị bậc D (30 mỗi phút mỗi người),
 * hủy đơn bậc B (10 mỗi phút mỗi người, R-41). Khóa mặc định của platform: người dùng đã đăng nhập, không phải IP (xem report, Lệch spec).
 */
export const LIMITS = {
  read: { tier: 'C', limit: 120, windowSeconds: 60 },
  admin: { tier: 'D', limit: 30, windowSeconds: 60 },
  cancel: { tier: 'B', limit: 10, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;
