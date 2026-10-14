// Hằng số nghiệp vụ và biến cấu hình của payment đã chốt ở spec (PAY-API, PAY-DB, PAY-SEC); đổi phải chạy sdlc-impact.
import { z } from 'zod';
import { cfg, registerConfigSchema, type ConfigVar } from '../platform';

// Biến cấu hình của PAY (PAY-API mục Cổng ngoài, ADR-007): nạp vào schema chung của platform lúc import module. Khóa ký là bí mật: không có giá trị mặc định thật, rỗng chỉ chấp nhận ở dev
// (khi đó đường dẫn thanh toán và IPN đóng: không ký được thì từ chối, không dùng khóa mặc định); staging và prod bắt buộc đặt, prod còn bị từ chối nếu là giá trị giữ chỗ hoặc ngắn hơn 32 ký tự (SB-15, SB-16).
const secret = (): ConfigVar => ({ zod: z.string(), sensitive: true, default: '', requiredOutsideDev: true, secretRules: true });
const required = (v: ConfigVar): ConfigVar => ({ ...v, requiredOutsideDev: true });
const url = (def: string): ConfigVar => required({ zod: z.string().refine((s) => s === '' || /^https?:\/\/[^\s]+$/.test(s), { message: 'phải là URL http(s)' }), sensitive: false, default: def });

export const PAY_VARS = {
  VNPAY_TMN_CODE: required(cfg.string({ default: '' })),
  VNPAY_HASH_SECRET: secret(),
  VNPAY_PAY_URL: url('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_API_URL: url('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
  /** Địa chỉ quay về (trang giao diện đọc trạng thái, bỏ qua mọi `vnp_*`); `{order_code}` được thay bằng mã đơn. Rỗng chỉ ở dev (đường dẫn thanh toán không dựng được: 503). */
  VNPAY_RETURN_URL: url(''),
  VNPAY_IPN_IP_ALLOWLIST: cfg.csv({ default: '' }),
  PAY_MAX_ATTEMPTS: cfg.int({ default: 3, min: 1, max: 10 }),
  PAY_ATTEMPT_URL_TTL_MINUTES: cfg.int({ default: 10, min: 1, max: 15 }),
  PAY_REFUND_AUTO_ATTEMPTS: cfg.int({ default: 3, min: 1, max: 3 }),
};
registerConfigSchema(PAY_VARS);

export interface PayConfig {
  VNPAY_TMN_CODE: string; VNPAY_HASH_SECRET: string; VNPAY_PAY_URL: string; VNPAY_API_URL: string; VNPAY_RETURN_URL: string; VNPAY_IPN_IP_ALLOWLIST: string[];
  PAY_MAX_ATTEMPTS: number; PAY_ATTEMPT_URL_TTL_MINUTES: number; PAY_REFUND_AUTO_ATTEMPTS: number;
}

// Hằng số v1 (PAY-REQ ...331 BR4: [RESOLVED] giữ làm hằng số của PAY; đổi theo hợp đồng thì sửa ở đây và chạy sdlc-impact).
export const VNPAY_MIN_AMOUNT = 5_000;
export const VNPAY_MAX_AMOUNT = 999_999_999;
export const RECONCILE_GRACE_MS = 2 * 60_000; // PAY-REQ ...684 BR5: quá hạn đường dẫn cộng 2 phút mới đối soát
export const RECONCILE_CLOSED_WINDOW_MS = 7 * 24 * 60 * 60_000; // PAY-DB mục 9: lượt của Payment đã đóng chỉ được đối soát tới 7 ngày sau hạn đường dẫn; cổng vẫn lỗi thì đóng lượt và log `error` (không hỏi cổng vô hạn)
export const REFUND_STALE_MS = 5 * 60_000; // PAY-REQ ...946 BR6: Refund `requested` quá 5 phút mới hỏi lại cổng
export const REFUND_STUCK_MS = 60 * 60_000; // Refund vào `requested` quá 1 giờ mà cổng vẫn không chốt (ví dụ trả 94 mãi): chuyển `failed` (`gateway-no-answer`), RefundFailed, log `error` `refund-stuck` (PAY-REQ ...946 BR6)
export const REFUND_RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000] as const; // sau lần tự thử 1 và 2 (PAY-DB mục 7)
export const GATEWAY_TIMEOUT_MS = 10_000; // SB-31, SB-34: hạn gọi cổng ngoài
export const JOB_BATCH = 50; // trần số dòng mỗi lượt của job đối soát (SB-34)
export const WEBHOOK_RETENTION = "12 months"; // ADR-022
export const NOTE_MAX = 200; // ghi chú thu COD
export const REASON_MIN = 5; // lý do hoàn tiền
export const REASON_MAX = 300;
export const ORDER_CODE_QUERY_MAX = 32;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const PAYMENT_STATUSES = ['pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const METHODS = ['vnpay', 'cod'] as const;
export type PaymentMethod = (typeof METHODS)[number];
export const REFUND_STATUSES = ['requested', 'succeeded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const FAIL_REASONS = ['cancelled_by_user', 'declined', 'timeout', 'other'] as const; // payment_fail_reason, reason của PaymentFailed (events.md)
export type FailReason = (typeof FAIL_REASONS)[number];
export const REFUND_REASONS = ['order_cancelled', 'order_expired', 'late_payment', 'duplicate_payment', 'admin_manual'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Vòng đời Payment hợp lệ (PAY-DB mục Giao dịch và khóa, SB-24): NGUỒN DUY NHẤT cho mã chuyển trạng thái; trigger của migration là lớp bảo vệ thứ hai. */
export const TRANSITIONS = {
  start: { from: ['pending'], to: 'processing' }, // khách bắt đầu
  retry: { from: ['failed'], to: 'processing' }, // khách thử lại
  succeed: { from: ['processing', 'failed'], to: 'succeeded', event: 'PaymentSucceeded' }, // webhook, đối soát (failed: thành công muộn của lượt đã timeout)
  collect: { from: ['pending'], to: 'succeeded', event: 'PaymentSucceeded' }, // COD
  fail: { from: ['processing'], to: 'failed', event: 'PaymentFailed' },
  expire: { from: ['pending', 'processing', 'failed'], to: 'expired', event: 'PaymentExpired' },
  cancel: { from: ['pending', 'processing', 'failed'], to: 'cancelled', event: null },
  refund: { from: ['succeeded'], to: 'refunded', event: 'PaymentRefunded' },
} as const satisfies Record<string, { from: readonly PaymentStatus[]; to: PaymentStatus; event?: string | null }>;
export type TransitionName = keyof typeof TRANSITIONS;
