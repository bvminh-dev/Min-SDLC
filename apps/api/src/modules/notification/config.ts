// Hằng số nghiệp vụ và biến cấu hình của notification đã chốt ở spec (NTF-REQ, NTF-DB, NTF-API, NTF-SEC); đổi phải chạy sdlc-impact.
import { z } from 'zod';
import { cfg, registerConfigSchema, type ConfigVar, type RateLimitOptions } from '../platform';

// Biến cấu hình của NTF (NTF-API mục Dịch vụ ngoài, ADR-007): nạp vào schema chung của platform lúc import module. Khóa SES là bí mật: không có giá trị mặc định thật, rỗng chỉ chấp nhận ở dev
// (khi đó mọi email thất bại ngay với mã `ses_unconfigured`, không gửi đi đâu); staging và prod bắt buộc đặt (SB-15, SB-16). `APP_BASE_URL` bắt buộc https ngoài dev (kiểm ở createMailConfig lúc khởi động).
const secret = (): ConfigVar => ({ zod: z.string(), sensitive: true, default: '', requiredOutsideDev: true });
const required = (v: ConfigVar): ConfigVar => ({ ...v, requiredOutsideDev: true });
/** Gốc URL: chỉ `scheme://host[:cổng]`, không userinfo, đường dẫn con, query hay fragment (liên kết email = gốc + đường dẫn cố định của mẫu). */
const origin = (): ConfigVar => ({
  zod: z.string().refine((s) => {
    if (s === '') return true;
    try { const u = new URL(s); return /^https?:$/.test(u.protocol) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && !/[?#]/.test(s); } catch { return false; }
  }, { message: 'phải là gốc URL http(s)://host[:cổng], không đường dẫn con, query, userinfo' }),
  sensitive: false, default: '',
});

export const NTF_VARS = {
  SES_REGION: required(cfg.string({ default: '' })),
  /** Địa chỉ người gửi (`MAIL_FROM`): chỉ từ cấu hình, không bao giờ từ dữ liệu event hay người dùng (NTF-REQ-20261006-103208551 BR1). Một địa chỉ trần, không xuống dòng, không tên hiển thị. */
  MAIL_FROM: required({ zod: z.string().refine((s) => s === '' || /^[^\s<>@,;"'\\]+@[^\s<>@,;"'\\]+\.[^\s<>@,;"'\\]+$/.test(s), { message: 'phải là một địa chỉ email trần' }), sensitive: false, default: '' }),
  APP_BASE_URL: required(origin()),
  SES_ACCESS_KEY: secret(),
  SES_SECRET_KEY: secret(),
  /** Gốc dịch vụ SES (mặc định `https://email.<SES_REGION>.amazonaws.com`); chỉ đặt khi dùng bộ giả lập hay điểm cuối riêng. */
  SES_ENDPOINT: origin(),
};
registerConfigSchema(NTF_VARS);

export interface NtfConfig { SES_REGION: string; MAIL_FROM: string; APP_BASE_URL: string; SES_ACCESS_KEY: string; SES_SECRET_KEY: string; SES_ENDPOINT: string }

// Hạn lưu (NTF-REQ-20261006-103208460 BR9, NTF-REQ-20261006-103208551 BR10, ADR-022)
export const NOTIFICATION_RETENTION_DAYS = 180;
export const EMAIL_RETENTION_DAYS = 90;
export const CLEANUP_BATCH = 1000; // số dòng mỗi lô của hàm dọn, mỗi lô một giao dịch
export const CLEANUP_JOB_MS = 3_600_000; // chu kỳ job dọn: mỗi giờ (ADR-013)
export const CLEANUP_BUDGET_MS = 50_000;

// Gửi email (NTF-DB mục Giao dịch và khóa 4 đến 6, NTF-REQ-20261006-103208551 BR4 đến BR6)
export const SEND_JOB_MS = 60_000; // job gửi mỗi phút (ADR-013)
export const SEND_BATCH = 50;
export const SEND_BUDGET_MS = 45_000; // hết hạn thì thôi nhận dòng mới (SB-34); dòng đã thuê tự đến hạn lại sau LEASE_MS
export const LEASE_MS = 2 * 60_000; // thuê dòng khi nhận việc: tiến trình chết thì dòng tự đến hạn lại
export const SES_TIMEOUT_MS = 10_000; // hạn gọi SES (SB-31, SB-34)
export const MAX_SEND_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const; // sau lần gửi 1 và 2
export const SECRET_RETRY_DELAYS_MS = [0, 2_000, 5_000] as const; // email chứa bí mật: 3 lần trong handler cách nhau 2 giây và 5 giây
export const SECRET_LOST_MS = 5 * 60_000; // bản ghi bí mật còn pending quá hạn này là tiến trình đã chết giữa chừng: failed `lost`
export const NORMAL_CAP = 30; // email thường mỗi 24 giờ mỗi người nhận (bậc E của SB-14)
export const NORMAL_CAP_WINDOW_MS = 24 * 3600_000;
export const SECRET_CAP = 10; // email xác minh hoặc đặt lại mỗi giờ mỗi người nhận
export const SECRET_CAP_WINDOW_MS = 3600_000;
export const SECRET_TYPES = ['email_verification', 'password_reset'] as const;

// Người nhận cảnh báo nội bộ (NTF-REQ-20261006-103209168 BR6)
export const MAX_RECIPIENTS = 200;

// Nội dung (NTF-REQ-20261006-103208460 BR5, NTF-REQ-20261006-103209168 BR1, NTF-REQ-20261006-103208551 BR7)
export const ORDER_CODE_RE = /^[A-Z0-9]{12}$/;
export const TRACKING_RE = /^[A-Z0-9-]{8,30}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;
export const PRODUCT_NAME_MAX = 80;
export const GREETING_NAME_MAX = 50;
export const FAIL_REASONS = ['customer_unreachable', 'refused', 'wrong_address', 'damaged', 'other'] as const;
export const NOTIFICATION_TYPES = ['order_created', 'order_confirmed', 'payment_succeeded', 'payment_failed', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'order_expired', 'welcome', 'password_changed', 'low_stock', 'refund_failed'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const EMAIL_TYPES = ['order_created', 'payment_succeeded', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'password_changed', 'account_locked', 'email_verification', 'password_reset'] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

/** Bảng bậc SB-14 cho NTF (NTF-API, R-41): bốn endpoint là bậc C (120 mỗi phút mỗi người dùng, trong bộ nhớ), chung MỘT bộ đếm để gọi luân phiên các endpoint khác nhau vẫn bị tính chung 120 lần. Khóa đếm mặc định của platform: người dùng đã đăng nhập. */
export const LIMITS = {
  all: { tier: 'C', limit: 120, windowSeconds: 60, group: 'ntf' },
} as const satisfies Record<string, RateLimitOptions>;
