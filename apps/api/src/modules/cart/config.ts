import type { RateLimitOptions } from '../platform';

// Hằng số nghiệp vụ của cart đã chốt ở spec (CRT-REQ, CRT-DB, CRT-API); đổi phải chạy sdlc-impact.
export const MAX_QUANTITY = 99; // số lượng mỗi dòng (CRT-REQ-20261006-103226376 BR2, CHECK cart_items_quantity_range)
export const MAX_LINES = 50; // số dòng mỗi giỏ (BR5), kiểm dưới khóa dòng giỏ
export const SUBTOTAL_MAX = 10_000_000_000; // trần tạm tính của giỏ = trần `subtotal` của SHP (SHP-REQ-20261006-101103806 BR1); PRM chỉ nhận tới 1.000.000.000 nên mã không áp được trên giỏ lớn hơn (CRT-REQ-20261006-103226537 BR3, BR9)
export const CODE_MAX = 50; // mã giảm giá khách nhập (CRT-REQ-20261006-103226511 BR3, CHECK carts_coupon_code_len)
export const CITY_MAX = 50; // thành phố ở giỏ (CRT-REQ-20261006-103226537 BR2, CHECK carts_shipping_city_len)
export const PRODUCT_ID_MAX = 100; // chuỗi product_id nhận vào: dài hơn là 400, ngắn hơn mà không phải uuid là 404 cùng nội dung
export const DEP_TIMEOUT_MS = 2000; // hủy lời gọi sang PRD, INV, PRM, SHP sau 2 giây (CRT-API Giao tiếp giữa module)
export const ABANDON_DAYS = 30; // giỏ active không có thao tác sửa quá 30 ngày thì abandoned (E-21, CRT-REQ-20261006-103226614 BR3)
export const ABANDON_BATCH = 1000; // số giỏ mỗi lô của job cart.abandon (CRT-DB mục 11)
export const ABANDON_BUDGET_MS = 50_000; // hạn thời gian một lượt job (SB-34): hết hạn thì thôi nhận lô mới, lượt sau làm tiếp
export const ABANDON_JOB_MS = 3_600_000; // chu kỳ job cart.abandon: mỗi giờ (ADR-013)
export const ARCHIVE_BATCH = 1000; // số dòng mỗi lô khi đánh dấu product_archived (CRT-DB mục 10)
export const AVAILABLE_CAP = 99; // số còn lại hiển thị tối đa (SB-37): không lộ tồn thật
export const COUPON_RULES = ['coupon_not_found', 'coupon_expired', 'coupon_exhausted', 'per_user_limit_reached', 'min_order_not_met', 'no_discount', 'too_many_attempts'] as const;

/**
 * Bảng bậc SB-14 cho CRT (CRT-API, ADR-014, R-41): thao tác ghi giỏ là bậc B (120 mỗi phút mỗi người, bảng PostgreSQL của platform nên đúng giữa các instance), áp mã là bậc A (10),
 * chọn vận chuyển 60 mỗi phút (chặt hơn bậc B), xem giỏ và huy hiệu là bậc C (120 mỗi phút mỗi người, trong bộ nhớ). Khóa đếm mặc định của platform: người dùng đã đăng nhập, không phải IP.
 * Mọi thao tác ghi giỏ chung một bộ đếm (`group`) để gửi luân phiên các endpoint khác nhau vẫn bị tính chung 120 lần.
 */
export const LIMITS = {
  write: { tier: 'B', limit: 120, windowSeconds: 60, group: 'crt-write' },
  coupon: { tier: 'A', limit: 10, windowSeconds: 60 },
  shipping: { tier: 'B', limit: 60, windowSeconds: 60 },
  view: { tier: 'C', limit: 120, windowSeconds: 60 },
  summary: { tier: 'C', limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;
