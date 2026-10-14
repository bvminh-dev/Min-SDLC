import { Injectable } from '@nestjs/common';
import { AppLogger, PrismaService, TransactionService, type Tx } from '../platform';
import { OrderApi } from '../order';
import { PaymentCore } from './core.service';
import { LOG_FIELDS, RSP, failReasonOf, fromVnpAmount, isSuccess, verifySignature, type IpnReply } from './vnpay';
import { DuplicateGatewayTxn, OutcomeService } from './outcome.service';
import { RefundService } from './refund.service';

type Result = 'confirmed_success' | 'confirmed_failure' | 'duplicate' | 'late_payment' | 'duplicate_payment' | 'invalid_signature' | 'unknown_txn' | 'amount_mismatch' | 'internal_error';
const TXN_REF_RE = /^[0-9a-f]{16}[0-9]{2}$/;
const MAX_FIELD = 64;
const text = (v: unknown): string | null => (typeof v === 'string' && v.length <= MAX_FIELD && !v.includes('\u0000') ? v : null);

/**
 * Nhận IPN của VNPay (PAY-REQ ...513; PAY-DB mục 3): kiểm chữ ký TRƯỚC khi chạm CSDL nghiệp vụ, tìm lượt thử theo `vnp_TxnRef`, so số tiền với Payment (không bao giờ lấy số tiền từ gói tin), đọc đơn từ ORD ngoài giao dịch,
 * rồi một giao dịch khóa Payment ghi kết quả cùng nhật ký webhook. Luôn trả HTTP 200 với `RspCode` theo hợp đồng của VNPay; lỗi bất ngờ là 99 (cổng gọi lại), không lộ chi tiết (SB-20). Nhật ký chỉ mang trường trong danh sách cho phép.
 */
@Injectable()
export class WebhookService {
  private readonly log: AppLogger;
  constructor(
    private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly core: PaymentCore, private readonly orders: OrderApi,
    private readonly outcome: OutcomeService, private readonly refunds: RefundService, logger: AppLogger,
  ) {
    this.log = logger.for('payment');
  }

  async handle(query: unknown, ip: string): Promise<IpnReply> {
    try {
      return await this.run(query, ip);
    } catch (e) {
      this.log.error('xử lý IPN lỗi bất ngờ', { code: 'ipn-internal-error', err: e }); // không ghi tham số
      return RSP.unknown;
    }
  }

  private async run(query: unknown, ip: string): Promise<IpnReply> {
    const allow = this.core.cfg('VNPAY_IPN_IP_ALLOWLIST');
    if (allow.length && !allow.includes(ip)) { this.log.warn('IPN từ IP ngoài danh sách cho phép', { code: 'ipn-ip-rejected', ip }); return RSP.unknown; } // lớp phụ (SB-22): chữ ký vẫn là lớp chính

    const q = (query && typeof query === 'object' && !Array.isArray(query) ? query : {}) as Record<string, unknown>;
    // chỉ nhận tham số `vnp_*` dạng chuỗi; mảng hay đối tượng lồng (qs) không bao giờ là chữ ký hợp lệ
    const params: Record<string, string> = {};
    let shapeOk = true;
    for (const [k, v] of Object.entries(q)) {
      if (!k.startsWith('vnp_')) continue;
      if (typeof v === 'string') params[k] = v; else shapeOk = false;
    }
    const given = typeof q.vnp_SecureHash === 'string' ? q.vnp_SecureHash : undefined;
    const txnRef = text(params.vnp_TxnRef);
    const logTxn = txnRef && TXN_REF_RE.test(txnRef) ? txnRef : null;
    const masked = this.mask(params);
    if (!shapeOk || !verifySignature(params, given, this.core.cfg('VNPAY_HASH_SECRET'))) {
      this.log.warn('IPN sai chữ ký', { code: 'ipn-invalid-signature', txn_ref: logTxn });
      await this.record(this.prisma, null, logTxn, masked, false, '97', 'invalid_signature');
      return RSP.signature;
    }

    const amount = fromVnpAmount(params.vnp_Amount ?? '');
    const [hit] = logTxn
      ? await this.prisma.$queryRaw<{ payment_id: string; attempt_id: string }[]>`SELECT payment_id, id AS attempt_id FROM payment_attempts WHERE txn_ref = ${logTxn}`
      : [];
    if (!hit) {
      await this.record(this.prisma, null, logTxn, masked, true, '01', 'unknown_txn');
      return RSP.notFound;
    }
    const [pay] = await this.prisma.$queryRaw<{ order_id: string; amount: bigint; order_code: string }[]>`SELECT order_id, amount, order_code FROM payments WHERE id = ${hit.payment_id}::uuid`;
    if (amount === null || amount !== pay.amount) {
      this.log.warn('IPN lệch số tiền', { code: 'ipn-amount-mismatch', order_code: pay.order_code, expected: Number(pay.amount), got: /^[0-9]{1,20}$/.test(params.vnp_Amount ?? '') ? params.vnp_Amount : 'invalid' });
      await this.record(this.prisma, hit.payment_id, logTxn, masked, true, '04', 'amount_mismatch');
      return RSP.amount;
    }

    // đọc đơn NGOÀI giao dịch (kết nối thứ hai, không giữ khóa của ORD hay của PAY, SB-31, L87)
    const order = await this.orders.findForPayment(pay.order_id);
    const orderPending = order?.status === 'pending';
    const code = text(params.vnp_ResponseCode) ?? '99';
    const success = isSuccess(code, text(params.vnp_TransactionStatus) ?? '');
    const transactionNo = text(params.vnp_TransactionNo);

    let refundId: string | null = null;
    const reply = await this.transactions.run(async (tx) => {
      const p = await this.core.lockById(tx, hit.payment_id);
      const a = p ? await this.outcome.lockAttempt(tx, hit.attempt_id) : undefined;
      if (!p || !a) { await this.record(tx, null, logTxn, masked, true, '01', 'unknown_txn'); return RSP.notFound; }
      const duplicate = async (): Promise<IpnReply> => { await this.record(tx, p.id, logTxn, masked, true, '02', 'duplicate'); return RSP.confirmed; };
      // lượt thử đã ở trạng thái cuối: lặp, phát lại và gói thất bại cũ chỉ nhận 02; riêng lượt `failed` vì hết thời gian vẫn nhận thành công muộn (PAY-REQ ...597 BR2)
      if (success ? !OutcomeService.acceptsSuccess(a) : a.status !== 'processing') return duplicate();
      if (success) {
        if (!transactionNo) { await this.record(tx, p.id, logTxn, masked, true, '99', 'internal_error'); return RSP.unknown; } // thành công mà không có mã giao dịch cổng: không tin, cổng gọi lại
        const r = await this.outcome.success(tx, p, a, orderPending, transactionNo, code);
        refundId = r.refund?.id ?? null;
        await this.record(tx, p.id, logTxn, masked, true, '00', r.result);
        return RSP.ok;
      }
      await this.outcome.failure(tx, p, a, failReasonOf(code), code);
      await this.record(tx, p.id, logTxn, masked, true, '00', 'confirmed_failure');
      return RSP.ok;
    }).catch(async (e) => {
      if (!(e instanceof DuplicateGatewayTxn)) throw e;
      // một giao dịch cổng không gắn được vào hai lượt thử: giao dịch đã rollback, ghi nhật ký riêng và trả 02
      await this.record(this.prisma, hit.payment_id, logTxn, masked, true, '02', 'duplicate');
      return RSP.confirmed;
    });
    if (refundId) this.refunds.dispatchSoon(refundId);
    return reply;
  }

  /** Chỉ các trường trong danh sách cho phép, dạng chuỗi ngắn; không có `vnp_SecureHash`, khóa ký hay trường cá nhân (SB-18). */
  private mask(params: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of LOG_FIELDS) { const v = text(params[k]); if (v !== null) out[k] = v; }
    return out;
  }

  private async record(db: Tx | PrismaService, paymentId: string | null, txnRef: string | null, payload: Record<string, string>, valid: boolean, rsp: string, result: Result): Promise<void> {
    await (db as Tx).$executeRaw`
      INSERT INTO payment_webhook_logs (payment_id, txn_ref, payload, signature_valid, rsp_code, result)
      VALUES (${paymentId}::uuid, ${txnRef}, ${JSON.stringify(payload)}::jsonb, ${valid}, ${rsp}, ${result})`;
  }
}
