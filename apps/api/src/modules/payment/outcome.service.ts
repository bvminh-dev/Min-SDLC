import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../platform';
import type { FailReason } from './config';
import { PaymentCore } from './core.service';
import { ATTEMPT_COLS, isUnique, type AttemptRow, type PaymentRow, type RefundRow } from './db';
import { RefundService } from './refund.service';

export type SuccessResult = 'confirmed_success' | 'late_payment' | 'duplicate_payment';
/** Cùng một mã giao dịch cổng (`vnp_TransactionNo`) đã gắn vào lượt thử khác: bên gọi rollback, đọc lại và trả 02 (PAY-DB mục 3). */
export class DuplicateGatewayTxn extends Error {}

/**
 * Áp kết quả của một lượt thử lên Payment (dùng chung cho webhook IPN và job đối soát: cùng một đường, PAY-DB mục 3 và 9). Mọi hàm chạy trong giao dịch của bên gọi, đã khóa Payment rồi lượt thử; không gọi hệ thống ngoài (SB-31).
 */
@Injectable()
export class OutcomeService {
  constructor(private readonly core: PaymentCore, private readonly refunds: RefundService) {}

  /** Lượt thử có thể nhận kết quả thành công: đang `processing`, hoặc `failed` vì hết thời gian (`timeout`: tiền thật vẫn có thể về muộn, PAY-REQ ...597 BR2). */
  static acceptsSuccess(a: Pick<AttemptRow, 'status' | 'reason'>): boolean { return a.status === 'processing' || (a.status === 'failed' && a.reason === 'timeout'); }

  /**
   * Kết quả thành công của lượt thử `a`, đơn đọc từ ORD (`orderPending`): Payment còn mở (`processing`, `failed`) và đơn còn `pending` thì Payment sang `succeeded` (một PaymentSucceeded, ghi cùng giao dịch);
   * Payment đã có giao dịch thành công (`succeeded`, `refunded`) thì giao dịch này là trùng; còn lại (đã `expired`, `cancelled` hoặc đơn không còn `pending`) là thanh toán muộn. Trùng và muộn không đổi Payment:
   * chỉ ghi nhận giao dịch thật và tạo Refund tự động (K-02, T14).
   */
  async success(tx: Tx, p: PaymentRow, a: AttemptRow, orderPending: boolean, transactionNo: string, code: string): Promise<{ result: SuccessResult; refund: RefundRow | null }> {
    const now = this.core.now();
    try {
      const n = await tx.$executeRaw`
        UPDATE payment_attempts SET status = 'succeeded'::attempt_status, reason = NULL, gateway_code = ${code}, provider_txn_no = ${transactionNo}, resolved_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${a.id}::uuid AND status IN ('processing'::attempt_status, 'failed'::attempt_status)`;
      if (n === 0) throw new DuplicateGatewayTxn(); // đã đổi giữa lúc khóa và UPDATE: không xảy ra dưới khóa dòng
    } catch (e) {
      if (isUnique(e, /provider_txn_no/)) throw new DuplicateGatewayTxn();
      throw e;
    }
    if ((p.status === 'processing' || p.status === 'failed') && orderPending) {
      const moved = await this.core.move(tx, p, 'succeed', { set: Prisma.sql`, paid_at = ${now}::timestamptz, provider_ref = ${transactionNo}` });
      if (moved) return { result: 'confirmed_success', refund: null };
    }
    const dup = p.status === 'succeeded' || p.status === 'refunded';
    const refund = await this.refunds.create(tx, p, { ...a, status: 'succeeded' }, dup ? 'duplicate_payment' : 'late_payment', { id: null, role: 'system' });
    return { result: dup ? 'duplicate_payment' : 'late_payment', refund };
  }

  /**
   * Kết quả thất bại của lượt thử `a` (đang `processing`): lượt ghi `failed` kèm mã lý do cố định và mã gốc (chỉ nội bộ). Nếu đó là lượt hiện tại của Payment đang `processing` thì Payment sang `failed` và phát PaymentFailed
   * (đúng một lần mỗi lượt, `is_final` = `attempt_no` >= `PAY_MAX_ATTEMPTS`, K-03); lượt cũ hay Payment đã đóng thì chỉ ghi lượt.
   */
  async failure(tx: Tx, p: PaymentRow, a: AttemptRow, reason: FailReason, code: string | null): Promise<void> {
    const now = this.core.now();
    const n = await tx.$executeRaw`
      UPDATE payment_attempts SET status = 'failed'::attempt_status, reason = ${reason}::payment_fail_reason, gateway_code = ${code}, resolved_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
      WHERE id = ${a.id}::uuid AND status = 'processing'::attempt_status`;
    if (n === 0) return;
    if (p.status === 'processing' && a.attempt_no === p.attempt_no) {
      await this.core.move(tx, p, 'fail', { extra: { reason, attempt_no: a.attempt_no, is_final: a.attempt_no >= this.core.cfg('PAY_MAX_ATTEMPTS') } });
    }
  }

  /** Đọc lại lượt thử sau khi đã khóa Payment (trạng thái có thể đã đổi từ lúc đọc không khóa). */
  async lockAttempt(tx: Tx, id: string): Promise<AttemptRow | undefined> {
    return (await tx.$queryRaw<AttemptRow[]>`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE id = ${id}::uuid FOR UPDATE`)[0];
  }
}
