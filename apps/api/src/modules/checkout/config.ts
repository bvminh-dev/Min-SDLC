import type { RateLimitOptions } from '../platform';
import { cfg, registerConfigSchema } from '../platform';

// Biến cấu hình của CHK (CHK-API mục Cấu hình, ADR-007): nạp vào schema chung của platform lúc import module, có mặc định đã chốt ở spec. `RESERVATION_TTL` là hạn giữ hàng của đơn `vnpay` (ADR-009),
// đơn vị PHÚT (ADR-007 và CHK-API chỉ ghi "15 phút", không nêu đơn vị của biến: xem report, Lệch spec).
export const CHK_VARS = {
  RESERVATION_TTL: cfg.int({ default: 15, min: 1, max: 60 }),
  CHK_SESSION_TTL_MINUTES: cfg.int({ default: 30, min: 1, max: 1440 }),
  CHK_MAX_OPEN_VNPAY_ORDERS: cfg.int({ default: 3, min: 1, max: 100 }),
  CHK_MAX_OPEN_COD_ORDERS: cfg.int({ default: 5, min: 1, max: 100 }),
  CHK_DEPENDENCY_TIMEOUT_MS: cfg.int({ default: 2000, min: 50, max: 10_000 }),
};
registerConfigSchema(CHK_VARS);

export interface ChkConfig {
  RESERVATION_TTL: number; CHK_SESSION_TTL_MINUTES: number; CHK_MAX_OPEN_VNPAY_ORDERS: number; CHK_MAX_OPEN_COD_ORDERS: number; CHK_DEPENDENCY_TIMEOUT_MS: number;
}

// Hằng số nghiệp vụ của checkout đã chốt ở spec (CHK-REQ, CHK-DB, CHK-API); đổi phải chạy sdlc-impact.
export const VNPAY_MIN = 5_000; // CHK-REQ-20261006-105051386 BR4 (giới hạn của cổng, PAY)
export const VNPAY_MAX = 999_999_999;
export const SHIP_SUBTOTAL_MAX = 10_000_000_000; // miền `subtotal` của ShippingApi.quote (architecture.md, Hành vi lỗi của giao diện SHP): tạm tính lớn hơn bị cắt về trần (ngưỡng miễn phí luôn nhỏ hơn trần)
export const CODE_MAX = 50; // mã giảm giá khách nhập (CHK-REQ-20261006-105051536 BR9, CHECK checkout_sessions_coupon_code_len)
export const EXPIRE_BATCH = 1000; // số phiên mỗi lô của job hết hạn (CHK-REQ-20261006-105052414 BR2)
export const EXPIRE_JOB_MS = 5 * 60_000; // chu kỳ job hết hạn phiên: 5 phút (ADR-013)
export const EXPIRE_BUDGET_MS = 50_000; // hạn thời gian một lượt job (SB-34): hết hạn thì thôi nhận lô mới, lượt sau làm tiếp
export const PURGE_BATCH = 1000; // số phiên mỗi lô của job xóa bản chụp địa chỉ
export const PURGE_JOB_MS = 24 * 3600_000; // hằng ngày (ADR-013, ADR-022)
export const PURGE_BUDGET_MS = 300_000;
export const PURGE_DAYS = 30; // bản chụp địa chỉ của phiên đã đóng giữ 30 ngày rồi đặt rỗng (ADR-022, R-33, SB-08)
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const SCOPE = 'checkout.place_order'; // scope của IdempotencyKey (CHK-DB mục 4)
export const RESEND_ENDPOINT = '/api/v1/auth/verify-email/resend'; // gợi ý gửi lại email xác minh (AUTH-REQ-20261006-095515702)
export const PAYMENT_METHODS = ['vnpay', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const SESSION_STATUSES = ['open', 'completed', 'expired', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const BLOCKERS = [
  'missing_address', 'missing_shipping_method', 'missing_payment_method', 'no_shipping_methods', 'address_unavailable', 'address_changed', 'shipping_method_unavailable', 'coupon_invalid',
  'cart_unavailable_items', 'insufficient_stock', 'amount_out_of_range_online', 'zero_total', 'too_many_open_orders', 'email_not_verified',
] as const;
export type BlockerCode = (typeof BLOCKERS)[number] | 'cart_empty'; // `cart_empty`: giỏ bị làm trống sau khi mở phiên (không có trong danh sách BR5, xem report, Lệch spec)

/**
 * Bảng bậc SB-14 cho CHK (CHK-API mục đầu, ADR-014, R-41): tạo phiên 10 mỗi phút, đặt hàng 5 mỗi phút (bậc B, bảng PostgreSQL của platform nên đúng giữa các instance), áp mã 10 mỗi phút (bậc A), các thao tác chọn
 * (địa chỉ, vận chuyển, thanh toán, lấy phí) chung một bộ đếm 60 mỗi phút; xem lại và hủy phiên là bậc C (120 mỗi phút mỗi người). Khóa đếm mặc định của platform: người dùng đã đăng nhập, không phải IP.
 */
export const LIMITS = {
  create: { tier: 'B', limit: 10, windowSeconds: 60 },
  place: { tier: 'B', limit: 5, windowSeconds: 60 },
  select: { tier: 'B', limit: 60, windowSeconds: 60, group: 'chk-select' },
  coupon: { tier: 'A', limit: 10, windowSeconds: 60 },
  view: { tier: 'C', limit: 120, windowSeconds: 60 },
  cancel: { tier: 'C', limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;
