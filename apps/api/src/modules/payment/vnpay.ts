import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FailReason } from './config';

// Giao thức VNPay v2.1.0 (tài liệu cổng thanh toán VNPay: tạo đường dẫn, IPN, querydr, refund). CHƯA thử với sandbox thật: bộ giả lập trong test tự dựng theo tài liệu (PAY report, YẾU).

/** Mã trả lời IPN theo hợp đồng của VNPay (PAY-API mục GET /webhooks/vnpay/ipn). */
export const RSP = {
  ok: { RspCode: '00', Message: 'Confirm Success' },
  notFound: { RspCode: '01', Message: 'Order not found' },
  confirmed: { RspCode: '02', Message: 'Order already confirmed' },
  amount: { RspCode: '04', Message: 'Invalid amount' },
  signature: { RspCode: '97', Message: 'Invalid signature' },
  unknown: { RspCode: '99', Message: 'Unknown error' },
} as const;
export type IpnReply = (typeof RSP)[keyof typeof RSP];

/** Giá trị ở dạng VNPay mã hóa: `encodeURIComponent` rồi `%20` thành `+` (ví dụ chính thức của VNPay). */
const enc = (v: string): string => encodeURIComponent(v).replace(/%20/g, '+');

/** Chuỗi để ký: tham số theo thứ tự chữ cái của tên, `tên=giá trị đã mã hóa` nối bằng `&` (không gồm `vnp_SecureHash`, `vnp_SecureHashType`). */
export function signData(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType')
    .sort()
    .map((k) => `${k}=${enc(params[k])}`)
    .join('&');
}
export const hmac512 = (secret: string, data: string): string => createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex');
export const sign = (params: Record<string, string>, secret: string): string => hmac512(secret, signData(params));

/**
 * So sánh chữ ký không đổi thời gian (T1): hai chuỗi hex cùng độ dài thì `timingSafeEqual`; khác độ dài thì sai ngay (độ dài chữ ký không phải bí mật). Khóa ký rỗng thì luôn sai (đóng khi cấu hình thiếu).
 */
export function verifySignature(params: Record<string, string>, given: unknown, secret: string): boolean {
  return !!secret && sameHex(sign(params, secret), given);
}
/** So hai chuỗi hex (HMAC-SHA512: 128 ký tự) không đổi thời gian; không phải chuỗi hex đúng độ dài thì sai ngay. */
export function sameHex(want: string, given: unknown): boolean {
  if (typeof given !== 'string' || !/^[0-9a-fA-F]{128}$/.test(given) || !/^[0-9a-f]{128}$/.test(want)) return false;
  const a = Buffer.from(want, 'hex'), b = Buffer.from(given.toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const two = (n: number): string => String(n).padStart(2, '0');
/** `yyyyMMddHHmmss` theo giờ GMT+7 (định dạng ngày giờ của VNPay). */
export function vnpDate(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3600_000);
  return `${t.getUTCFullYear()}${two(t.getUTCMonth() + 1)}${two(t.getUTCDate())}${two(t.getUTCHours())}${two(t.getUTCMinutes())}${two(t.getUTCSeconds())}`;
}

/** Số tiền gửi cổng: đồng VND nhân 100, tính bằng BigInt để không mất chữ số (tiền là số nguyên, SB-23). */
export const toVnpAmount = (vnd: bigint): string => (vnd * 100n).toString();
/** `vnp_Amount` của cổng về đồng VND; `null` khi không phải số nguyên dương chia hết cho 100 (không hợp lệ thì không bao giờ khớp số tiền Payment). */
export function fromVnpAmount(raw: string): bigint | null {
  if (!/^[0-9]{1,20}$/.test(raw)) return null;
  const v = BigInt(raw);
  return v > 0n && v % 100n === 0n ? v / 100n : null;
}

export interface PayUrlInput {
  payUrl: string; tmnCode: string; secret: string; amount: bigint; txnRef: string; orderCode: string; returnUrl: string; ip: string; createDate: Date; expireDate: Date;
}
/** Đường dẫn trang thanh toán của VNPay (PAY-API mục initiate): số tiền, mã tham chiếu, hạn, mô tả chỉ có mã đơn, địa chỉ quay về, chữ ký HMAC-SHA512 trên mọi tham số. Dựng lại được từ dữ liệu đã lưu (bấm lặp trả đúng đường dẫn cũ). */
export function buildPayUrl(i: PayUrlInput): string {
  const params: Record<string, string> = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: i.tmnCode, vnp_Amount: toVnpAmount(i.amount), vnp_CurrCode: 'VND', vnp_TxnRef: i.txnRef,
    vnp_OrderInfo: `Thanh toan don ${i.orderCode}`, vnp_OrderType: 'other', vnp_Locale: 'vn', vnp_ReturnUrl: i.returnUrl, vnp_IpAddr: i.ip,
    vnp_CreateDate: vnpDate(i.createDate), vnp_ExpireDate: vnpDate(i.expireDate),
  };
  const data = signData(params);
  return `${i.payUrl}?${data}&vnp_SecureHash=${hmac512(i.secret, data)}`;
}

/** Mã trả lời của cổng (vnp_ResponseCode) thành mã lý do cố định của PaymentFailed (PAY-REQ ...684 BR2, M-06): mã gốc chỉ lưu nội bộ, không bao giờ ra khách hay event. */
export function failReasonOf(responseCode: string): FailReason {
  if (responseCode === '24') return 'cancelled_by_user';
  if (responseCode === '11') return 'timeout'; // hết hạn chờ thanh toán ở cổng
  if (['07', '09', '10', '12', '13', '51', '65', '79'].includes(responseCode)) return 'declined'; // ngân hàng, thẻ từ chối: không đủ tiền, sai OTP, hạn mức, thẻ khóa
  return 'other';
}
/** Thành công khi và chỉ khi `vnp_ResponseCode` và `vnp_TransactionStatus` cùng là 00 (PAY-REQ ...513 BR4). */
export const isSuccess = (responseCode: string, transactionStatus: string): boolean => responseCode === '00' && transactionStatus === '00';

/** Trường được ghi vào nhật ký webhook (PAY-DB: payload đã che; không có chữ ký, không có khóa ký, không dữ liệu cá nhân, SB-18). */
export const LOG_FIELDS = ['vnp_TxnRef', 'vnp_Amount', 'vnp_ResponseCode', 'vnp_TransactionStatus', 'vnp_TransactionNo', 'vnp_BankCode', 'vnp_PayDate'] as const;
