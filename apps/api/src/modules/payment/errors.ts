import { registerProblem } from '../platform';

// Sổ mã lỗi HTTP của PAY (PAY-API mục Sổ mã lỗi, ADR-023): `type` = urn:ecom:error:<mã kebab-case>. Mọi 409 chỉ nêu mã chung, không lộ trạng thái nội bộ khác (SB-20).
// `validation-failed`, `unauthenticated`, `forbidden`, `csrf_failed`, `not-found`, `rate-limited`, `idempotency-key-required`, `idempotency-key-reused` là mã nền của platform (không đăng ký lại).
const defs: [string, number, string][] = [
  ['payment-not-online', 409, 'Payment is not an online payment'],
  ['payment-not-startable', 409, 'Payment cannot be started in its current state'],
  ['payment-in-progress', 409, 'Payment is still being processed'],
  ['amount-out-of-range', 422, 'Amount is outside the range the gateway accepts'],
  ['payment-not-retryable', 409, 'Payment cannot be retried'],
  ['attempts-exhausted', 409, 'No payment attempts left'],
  ['order-not-pending', 409, 'Order is no longer awaiting payment'],
  ['payment-expired', 409, 'Payment window has expired'],
  ['order-not-delivered', 409, 'Order has not been delivered'],
  ['payment-not-cod', 409, 'Payment is not cash on delivery'],
  ['payment-already-succeeded', 409, 'Payment has already succeeded'],
  ['amount-mismatch', 422, 'Collected amount does not match the payment amount'],
  ['payment-not-refundable', 409, 'Payment cannot be refunded'],
  ['cod-refund-unsupported', 422, 'Refund of a cash on delivery payment is not supported'],
  ['refund-in-progress', 409, 'A refund is already in progress'],
  ['refund-not-retryable', 409, 'Refund cannot be retried'],
  ['refund-use-retry', 409, 'A failed refund exists, retry it instead'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });
