import type { RateLimitOptions } from '../platform';

/** Bảng bậc SB-14 cho INV (INV-API mục Endpoint, ADR-014): quản trị bậc D (30 mỗi phút mỗi người, mọi endpoint quản trị chung một bộ đếm), công khai bậc C (120 mỗi phút mỗi IP). */
export const LIMITS = {
  admin: { tier: 'D', limit: 30, windowSeconds: 60, group: 'inv:admin' },
  publicRead: { tier: 'C', limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;
