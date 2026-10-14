import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '../platform';
import { GATEWAY_TIMEOUT_MS } from './config';
import { fromVnpAmount, hmac512, sameHex, toVnpAmount, vnpDate } from './vnpay';

/** Cổng ngoài (PAY-API mục Cổng ngoài): luôn gọi NGOÀI giao dịch CSDL, hạn 10 giây, không tự thử lại (SB-31, SB-34). Triển khai thật nói chuyện với VNPay; test thay bằng bộ giả lập dựng theo tài liệu VNPay. */
export const VNPAY_GATEWAY = Symbol('VNPAY_GATEWAY');

export interface QueryInput { txnRef: string; amount: bigint; createDate: Date; orderInfo: string }
/** Kết quả hỏi giao dịch (`querydr`): `success` và `failed` có mã gốc; `not_found` cổng báo không có giao dịch; `error` cổng lỗi hoặc không trả lời (bỏ qua, thử lại lượt sau). */
export type QueryResult =
  | { kind: 'success'; transactionNo: string; amount: bigint; code: string }
  | { kind: 'failed'; code: string; amount: bigint | null }
  | { kind: 'not_found' }
  | { kind: 'error' };

export interface RefundInput { requestId: string; txnRef: string; amount: bigint; transactionNo: string; transactionDate: Date; createdBy: string; orderInfo: string }
/** Kết quả gọi hoàn tiền: `succeeded`; `declined` cổng từ chối (mã gốc để đối soát, không ra khách); `pending` không có trả lời chắc chắn (hết hạn gọi, 5xx, trùng yêu cầu đang xử lý): giữ `requested` cho job đối soát. */
export type RefundResult = { kind: 'succeeded'; code: string } | { kind: 'declined'; code: string } | { kind: 'pending' };

export interface VnpayGateway {
  queryTransaction(i: QueryInput): Promise<QueryResult>;
  /** Idempotent theo `requestId` cho cùng lần gọi (PAY-REQ ...946 BR4): gọi lặp cùng mã không hoàn hai lần. */
  refund(i: RefundInput): Promise<RefundResult>;
}

const API_VERSION = '2.1.0';
const requestId = (): string => randomBytes(16).toString('hex');

/**
 * Máy khách HTTP của VNPay (`querydr`, `refund`). Chữ ký yêu cầu và phản hồi là HMAC-SHA512 trên các trường nối bằng `|` theo thứ tự của tài liệu VNPay. Phản hồi sai chữ ký coi như không tin được (`error` / `pending`),
 * không bao giờ coi là thành công. Khóa ký rỗng (dev chưa cấu hình) thì không gọi: `error` / `pending`.
 */
@Injectable()
export class HttpVnpayGateway implements VnpayGateway {
  /** Hạn một lần gọi cổng (SB-31, SB-34); public để test đặt ngắn hơn khi thử cổng treo. */
  timeoutMs = GATEWAY_TIMEOUT_MS;
  constructor(private readonly config: ConfigService) {}

  private post(body: Record<string, string>): Promise<Record<string, string> | null> {
    const url = this.config.get<string>('VNPAY_API_URL');
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) })
      .then(async (r) => (r.ok ? ((await r.json()) as Record<string, string>) : null))
      .catch(() => null);
  }

  private ready(): { tmn: string; secret: string } | null {
    const tmn = this.config.get<string>('VNPAY_TMN_CODE'), secret = this.config.get<string>('VNPAY_HASH_SECRET');
    return tmn && secret && this.config.get<string>('VNPAY_API_URL') ? { tmn, secret } : null;
  }

  async queryTransaction(i: QueryInput): Promise<QueryResult> {
    const c = this.ready();
    if (!c) return { kind: 'error' };
    const now = new Date();
    const f = { vnp_RequestId: requestId(), vnp_Version: API_VERSION, vnp_Command: 'querydr', vnp_TmnCode: c.tmn, vnp_TxnRef: i.txnRef, vnp_OrderInfo: i.orderInfo, vnp_TransactionDate: vnpDate(i.createDate), vnp_CreateDate: vnpDate(now), vnp_IpAddr: '127.0.0.1' };
    const data = [f.vnp_RequestId, f.vnp_Version, f.vnp_Command, f.vnp_TmnCode, f.vnp_TxnRef, f.vnp_TransactionDate, f.vnp_CreateDate, f.vnp_IpAddr, f.vnp_OrderInfo].join('|');
    const r = await this.post({ ...f, vnp_SecureHash: hmac512(c.secret, data) });
    if (!r) return { kind: 'error' };
    const resp = [r.vnp_ResponseId, r.vnp_Command, r.vnp_ResponseCode, r.vnp_Message, r.vnp_TmnCode, r.vnp_TxnRef, r.vnp_Amount, r.vnp_BankCode, r.vnp_PayDate, r.vnp_TransactionNo, r.vnp_TransactionType, r.vnp_TransactionStatus, r.vnp_OrderInfo, r.vnp_PromotionCode, r.vnp_PromotionAmount].map((x) => x ?? '').join('|');
    if (!sameHex(hmac512(c.secret, resp), r.vnp_SecureHash)) return { kind: 'error' }; // không tin phản hồi sai chữ ký
    if (r.vnp_ResponseCode === '91') return { kind: 'not_found' }; // không tìm thấy giao dịch
    if (r.vnp_ResponseCode !== '00') return { kind: 'error' }; // lỗi của chính lời gọi truy vấn (tham số, hệ thống): không kết luận
    const amount = fromVnpAmount(String(r.vnp_Amount ?? ''));
    if (r.vnp_TransactionStatus === '00') return amount === null ? { kind: 'error' } : { kind: 'success', transactionNo: String(r.vnp_TransactionNo ?? ''), amount, code: '00' };
    return { kind: 'failed', code: String(r.vnp_TransactionStatus ?? '99'), amount };
  }

  async refund(i: RefundInput): Promise<RefundResult> {
    const c = this.ready();
    if (!c) return { kind: 'pending' };
    const now = new Date();
    const f = {
      vnp_RequestId: i.requestId, vnp_Version: API_VERSION, vnp_Command: 'refund', vnp_TmnCode: c.tmn, vnp_TransactionType: '02', vnp_TxnRef: i.txnRef, vnp_Amount: toVnpAmount(i.amount),
      vnp_OrderInfo: i.orderInfo, vnp_TransactionNo: i.transactionNo, vnp_TransactionDate: vnpDate(i.transactionDate), vnp_CreateBy: i.createdBy, vnp_CreateDate: vnpDate(now), vnp_IpAddr: '127.0.0.1',
    };
    const data = [f.vnp_RequestId, f.vnp_Version, f.vnp_Command, f.vnp_TmnCode, f.vnp_TransactionType, f.vnp_TxnRef, f.vnp_Amount, f.vnp_TransactionNo, f.vnp_TransactionDate, f.vnp_CreateBy, f.vnp_CreateDate, f.vnp_IpAddr, f.vnp_OrderInfo].join('|');
    const r = await this.post({ ...f, vnp_SecureHash: hmac512(c.secret, data) });
    if (!r) return { kind: 'pending' };
    const resp = [r.vnp_ResponseId, r.vnp_Command, r.vnp_ResponseCode, r.vnp_Message, r.vnp_TmnCode, r.vnp_TxnRef, r.vnp_Amount, r.vnp_BankCode, r.vnp_PayDate, r.vnp_TransactionNo, r.vnp_TransactionType, r.vnp_TransactionStatus, r.vnp_OrderInfo].map((x) => x ?? '').join('|');
    if (!sameHex(hmac512(c.secret, resp), r.vnp_SecureHash)) return { kind: 'pending' }; // không tin phản hồi sai chữ ký
    const code = String(r.vnp_ResponseCode ?? '99');
    // 00 là yêu cầu được nhận; `vnp_TransactionStatus` 09 là hoàn trả bị từ chối (tài liệu VNPay v2.1.0): không bao giờ coi là đã hoàn (sai thì Payment sang `refunded` mà khách chưa nhận tiền). CHƯA thử với sandbox.
    if (code === '00') return String(r.vnp_TransactionStatus ?? '') === '09' ? { kind: 'declined', code: '09' } : { kind: 'succeeded', code };
    if (['94', '99'].includes(code)) return { kind: 'pending' }; // trùng yêu cầu đang xử lý, lỗi hệ thống của cổng: chưa chốt
    return { kind: 'declined', code };
  }
}
