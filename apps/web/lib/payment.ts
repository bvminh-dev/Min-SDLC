// Thanh toán (epic PAY): kiểu dữ liệu, nhãn và ánh xạ dùng chung năm màn `order-payment`, `payment-history`, `admin-payment-list`, `admin-payment-detail`, `admin-refund-queue`.
import { own } from './shipping';

export type PayStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'refunded';
export const PAY_STATUSES: PayStatus[] = ['pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded'];
export type PayMethod = 'vnpay' | 'cod';
export type RefundStatus = 'requested' | 'succeeded' | 'failed';
export const REFUND_STATUSES: RefundStatus[] = ['requested', 'succeeded', 'failed'];

export interface PaymentRow { id: string; order_code: string; method: PayMethod; amount: number; status: PayStatus; attempt_no: number; max_attempts: number; created_at: string }
export interface Attempt { attempt_no: number; status: string; reason: string | null; created_at: string }
export interface CustomerRefund { amount: number; status: RefundStatus; created_at: string }
export interface PaymentDetail extends PaymentRow { expires_at: string | null; can_retry: boolean; can_initiate: boolean; attempts: Attempt[]; refunds: CustomerRefund[] }
export interface PaymentList { items: PaymentRow[]; page: number; limit: number; total: number }

export interface AdminAttempt extends Attempt { txn_ref?: string | null; gateway_code?: string | null }
export interface WebhookLog { created_at: string; rsp_code: string; result: string }
export interface AdminRefund { id: string; amount: number; status: RefundStatus; reason: string; note?: string | null; failure_reason: string | null; auto_attempt_no: number | null; created_at: string; resolved_at: string | null }
export interface AdminPaymentDetail extends PaymentRow {
  expires_at: string | null; paid_at?: string | null; provider_ref?: string | null; user_id?: string | null;
  attempts: AdminAttempt[]; webhook_logs: WebhookLog[]; refunds: AdminRefund[];
}
export interface RefundRow { id: string; payment_id: string; order_code: string; amount: number; reason: string; status: RefundStatus; failure_reason: string | null; auto_attempt_no: number | null; created_at: string; resolved_at: string | null }
export interface RefundList { items: RefundRow[]; page: number; limit: number; total: number }

/** Nhãn trạng thái thanh toán (chữ, không chỉ màu). COD chưa thu là "Chờ thu", không bao giờ mang chữ "đã thanh toán". */
const STATUS_LABEL: Record<PayStatus, string> = { pending: 'Chưa thanh toán', processing: 'Đang xử lý', succeeded: 'Đã thanh toán', failed: 'Thất bại', expired: 'Hết hạn', cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền' };
export const payStatusText = (status: string, method?: string): string => (method === 'cod' && status === 'pending' ? 'Chờ thu' : own(STATUS_LABEL, status) ?? status); // COD đã thu cũng là "Đã thanh toán" (ui/admin-payment-detail: COD thành công)
export const methodText = (m: string): string => (m === 'vnpay' ? 'VNPay' : m === 'cod' ? 'COD' : m);

/** Lý do thất bại của lượt thử: bốn mã cố định đổi thành câu dễ hiểu; mã lạ cũng ra câu chung, không bao giờ hiện mã gốc của cổng. */
const FAIL_SENTENCE: Record<string, string> = { cancelled_by_user: 'Bạn đã hủy giao dịch', declined: 'Ngân hàng từ chối giao dịch', timeout: 'Giao dịch quá thời gian', other: 'Giao dịch không thành công' };
export const failSentence = (reason: string | null | undefined): string => (reason ? own(FAIL_SENTENCE, reason) ?? FAIL_SENTENCE.other : FAIL_SENTENCE.other);

const ATTEMPT_LABEL: Record<string, string> = { processing: 'Đang xử lý', succeeded: 'Thành công', failed: 'Thất bại', superseded: 'Đã thay thế' };
/** "Thất bại (Ngân hàng từ chối giao dịch)"; trạng thái lạ giữ nguyên chữ từ API (văn bản thường). */
export const attemptText = (a: { status: string; reason: string | null }): string => `${own(ATTEMPT_LABEL, a.status) ?? a.status}${a.status === 'failed' ? ` (${failSentence(a.reason)})` : ''}`;

const REFUND_ADMIN_LABEL: Record<string, string> = { requested: 'Đang xử lý', succeeded: 'Thành công', failed: 'Thất bại' };
const REFUND_CUSTOMER_LABEL: Record<string, string> = { requested: 'Đang xử lý', succeeded: 'Đã hoàn', failed: 'Đang xử lý hoàn tiền, cửa hàng sẽ liên hệ' };
export const refundStatusText = (status: string, customer = false): string => own(customer ? REFUND_CUSTOMER_LABEL : REFUND_ADMIN_LABEL, status) ?? status;

const REFUND_REASON: Record<string, string> = { order_cancelled: 'Hủy đơn', order_expired: 'Đơn hết hạn', late_payment: 'Thanh toán muộn', duplicate_payment: 'Thanh toán trùng', admin_manual: 'Hoàn thủ công' };
export const refundReasonText = (r: string): string => own(REFUND_REASON, r) ?? r;

const WEBHOOK_RESULT: Record<string, string> = {
  confirmed_success: 'xác nhận thành công', confirmed_failure: 'xác nhận thất bại', duplicate: 'lặp', late_payment: 'thanh toán muộn', duplicate_payment: 'thanh toán trùng',
  invalid_signature: 'sai chữ ký', unknown_txn: 'không rõ mã giao dịch', amount_mismatch: 'số tiền không khớp',
};
export const webhookResultText = (r: string): string => own(WEBHOOK_RESULT, r) ?? r;

/** `12:40` (phút:giây còn lại). */
export const formatRemaining = (sec: number): string => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** Khóa idempotency mới (8 tới 64 ký tự [A-Za-z0-9_-]): uuid, hoặc 32 ký tự hex khi trình duyệt không có `randomUUID` (trang http không phải localhost). */
export const newIdemKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined') crypto.getRandomValues(b); else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

/** Chỉ chuyển trình duyệt tới đường dẫn http(s) của cổng: không bao giờ `javascript:` hay `data:` dù API trả gì. */
export const safeRedirect = (url: unknown): string | null => {
  if (typeof url !== 'string') return null;
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
};

export const payHref = (code: string): string => `/orders/${encodeURIComponent(code)}/payment`;

/** Testid của hộp thoại phiên hết hạn theo trang của PAY; ngoài PAY trả `undefined`. */
export function payExpiredTestId(path: string): string | undefined {
  if (/^\/orders\/[^/]+\/payment\/?$/.test(path)) return 'pay-order-payment-session-expired';
  if (/^\/payments\/?$/.test(path)) return 'pay-payment-history-session-expired';
  if (/^\/admin\/payments\/?$/.test(path)) return 'pay-admin-payment-list-session-expired';
  if (/^\/admin\/payments\/[^/]+\/?$/.test(path)) return 'pay-admin-payment-detail-session-expired';
  if (/^\/admin\/refunds\/?$/.test(path)) return 'pay-admin-refund-queue-session-expired';
  return undefined;
}
