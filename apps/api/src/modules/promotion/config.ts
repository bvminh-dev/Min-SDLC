import type { RateLimitOptions } from '../platform';

/** Bảng bậc SB-14 cho PRM (PRM-API đầu mục Endpoint, ADR-014): mọi endpoint quản trị coupon bậc D, 30 mỗi phút mỗi người, chung một bộ đếm ở kho PostgreSQL của platform (không phải bộ nhớ từng instance, M-09, R-31). */
export const LIMITS = {
  admin: { tier: 'D', limit: 30, windowSeconds: 60, group: 'prm:admin' },
} as const satisfies Record<string, RateLimitOptions>;

// Hằng số nghiệp vụ đã chốt ở spec (đổi phải chạy sdlc-impact).
export const MAX_MONEY = 1_000_000_000; // tiền (value, min_order_value, max_discount, items_subtotal, amount) tối đa 1 tỷ VND (PRM-REQ ...201 BR4 đến BR6, CHECK ở CSDL)
export const MAX_LIMIT = 1_000_000; // usage_limit và per_user_limit
export const WRONG_ATTEMPTS = 10; // lần coupon_not_found tối đa mỗi người trong một cửa sổ (PRM-REQ ...327 BR7, SB-14 bậc A)
export const WRONG_WINDOW_SECONDS = 600; // cửa sổ cố định 10 phút
export const EXPIRE_JOB_MS = 60_000; // job hết hạn chạy mỗi phút (ADR-013, PRM-REQ ...424 BR3)
export const EXPIRE_BATCH = 500; // số coupon mỗi lô của job hết hạn (SB-34)
export const EXPIRE_BUDGET_MS = 45_000; // hạn thời gian mỗi lần chạy: dừng nhận lô mới, lượt sau làm tiếp (SB-34)
export const RECONCILE_JOB_MS = 24 * 3600_000; // đối soát bộ đếm: chu kỳ 24 giờ kể từ lúc khởi động (JobRunner chỉ có `every`, như INV)
export const RECONCILE_MAX_REPORT = 1000; // trần số coupon lệch ghi log mỗi lần chạy (SB-34)
