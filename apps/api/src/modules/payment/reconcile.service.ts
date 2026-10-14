import { Inject, Injectable } from '@nestjs/common';
import { AppLogger, PrismaService, TransactionService } from '../platform';
import { OrderApi } from '../order';
import { JOB_BATCH, RECONCILE_CLOSED_WINDOW_MS, RECONCILE_GRACE_MS } from './config';
import { PaymentCore } from './core.service';
import type { AttemptRow } from './db';
import { VNPAY_GATEWAY, type VnpayGateway } from './gateway';
import { DuplicateGatewayTxn, OutcomeService } from './outcome.service';
import { RefundService } from './refund.service';

/**
 * Job đối soát lượt thử (ADR-013, PAY-REQ ...684 BR5, PAY-DB mục 9; mỗi phút): lượt `processing` quá `vnp_ExpireDate` cộng 2 phút mà chưa có IPN thì hỏi cổng (`querydr`) NGOÀI giao dịch rồi áp kết quả như IPN:
 * thành công thì như webhook thành công (kể cả thanh toán muộn, trùng); thất bại hoặc cổng báo không có giao dịch thì `failed` với `reason` = `timeout`; cổng lỗi thì bỏ qua và thử lại lượt sau.
 * Đối soát MỌI lượt `processing` kể cả của Payment đã đóng (`expired`, `cancelled`, `refunded`; REV-PAY-01): khách trả ở cổng mà IPN mất thì tiền đã thu không được mất dấu. Payment đã đóng không đổi trạng thái:
 * cổng báo thành công thì ghi lượt `succeeded` và tạo Refund `late_payment` (Payment `expired`, `cancelled`) hay `duplicate_payment` (Payment `refunded`), mỗi giao dịch cổng một Refund (unique `attempt_id`, không hoàn trùng);
 * cổng báo thất bại hay không có giao dịch thì chỉ ghi lượt `failed`/`timeout`. Lượt của Payment đã đóng quá `RECONCILE_CLOSED_WINDOW_MS` kể từ hạn mà cổng vẫn lỗi (hoặc số tiền lệch, trùng mã giao dịch) thì đóng lượt `failed`/`timeout`
 * kèm log `error` `reconcile-closed-unresolved` (người vận hành đối chiếu tay; IPN thành công về muộn vẫn được nhận) để không hỏi cổng vô hạn. Thuê dòng bằng `updated_at` (cổng gọi đúng một lần dù nhiều tiến trình) và tối đa JOB_BATCH dòng mỗi lượt (SB-34).
 */
/** Payment đã đóng: không còn đổi trạng thái, nhưng lượt `processing` còn lại vẫn có thể là tiền đã thu (REV-PAY-01). */
const CLOSED: ReadonlySet<string> = new Set(['expired', 'cancelled', 'refunded']);

@Injectable()
export class ReconcileService {
  private readonly log: AppLogger;
  constructor(
    private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly core: PaymentCore, private readonly orders: OrderApi,
    private readonly outcome: OutcomeService, private readonly refunds: RefundService, @Inject(VNPAY_GATEWAY) private readonly gateway: VnpayGateway, logger: AppLogger,
  ) {
    this.log = logger.for('payment');
  }

  /** Chờ giữa hai lần thuê cùng một lượt: lỗi cổng thì lượt sau (phút kế) mới thử lại. */
  private static readonly LEASE_MS = 50_000;

  async run(now: Date = this.core.now(), signal?: AbortSignal): Promise<{ checked: number; resolved: number }> {
    const due = await this.prisma.$queryRaw<{ id: string; payment_id: string }[]>`
      SELECT a.id, a.payment_id FROM payment_attempts a
      WHERE a.status = 'processing'::attempt_status AND a.expires_at < ${new Date(now.getTime() - RECONCILE_GRACE_MS)}::timestamptz
        AND a.updated_at <= ${new Date(now.getTime() - ReconcileService.LEASE_MS)}::timestamptz
      ORDER BY a.updated_at, a.expires_at, a.id LIMIT ${JOB_BATCH}`; // updated_at trước: lượt vừa thuê (cổng lỗi, số tiền lệch) xuống cuối hàng, lượt kẹt vĩnh viễn không chặn lượt mới khi quá JOB_BATCH
    let checked = 0, resolved = 0;
    for (const d of due) {
      if (signal?.aborted) break;
      const lease = await this.transactions.run(async (tx) => {
        const p = await this.core.lockSkip(tx, d.payment_id); // bên khác đang xử lý Payment này thì bỏ qua (SKIP LOCKED)
        if (!p) return null;
        const a = (await tx.$queryRaw<AttemptRow[]>`
          SELECT id, payment_id, attempt_no, txn_ref, status::text AS status, reason::text AS reason, gateway_code, provider_txn_no, create_date, expires_at, resolved_at, created_at, updated_at
          FROM payment_attempts WHERE id = ${d.id}::uuid AND status = 'processing'::attempt_status AND expires_at < ${new Date(now.getTime() - RECONCILE_GRACE_MS)}::timestamptz AND updated_at <= ${new Date(now.getTime() - ReconcileService.LEASE_MS)}::timestamptz FOR UPDATE`)[0];
        if (!a) return null;
        await tx.$executeRaw`UPDATE payment_attempts SET updated_at = ${now}::timestamptz WHERE id = ${a.id}::uuid`;
        return { a, amount: p.amount, orderId: p.order_id, orderCode: p.order_code, closed: CLOSED.has(p.status) };
      });
      if (!lease) continue;
      checked++;
      try { if (await this.one(lease.a, lease.amount, lease.orderId, lease.orderCode, lease.closed, now)) resolved++; } catch (e) { this.log.error('đối soát lượt thử lỗi', { code: 'reconcile-failed', order_code: lease.orderCode, err: e }); }
    }
    return { checked, resolved };
  }

  /** Hỏi cổng rồi áp kết quả; `false` khi cổng lỗi hoặc kết quả không tin được (giữ nguyên, lượt sau thử lại; riêng lượt của Payment đã đóng quá hạn `RECONCILE_CLOSED_WINDOW_MS` thì đóng lượt, xem `giveUp`). */
  private async one(a: AttemptRow, amount: bigint, orderId: string, orderCode: string, closed: boolean, now: Date): Promise<boolean> {
    const expired = closed && a.expires_at.getTime() < now.getTime() - RECONCILE_CLOSED_WINDOW_MS;
    const q = await this.gateway.queryTransaction({ txnRef: a.txn_ref, amount, createDate: a.create_date, orderInfo: `Thanh toan don ${orderCode}` }).catch(() => ({ kind: 'error' as const }));
    if (q.kind === 'error') {
      if (expired) return this.giveUp(a, orderCode, 'gateway_error');
      this.log.warn('cổng không trả lời truy vấn giao dịch, thử lại lượt sau', { code: 'reconcile-gateway-error', order_code: orderCode });
      return false;
    }
    if (q.kind === 'success' && (q.amount !== amount || !q.transactionNo)) {
      if (expired) return this.giveUp(a, orderCode, 'amount_mismatch');
      this.log.warn('kết quả truy vấn lệch số tiền hoặc thiếu mã giao dịch, bỏ qua', { code: 'reconcile-amount-mismatch', order_code: orderCode });
      return false;
    }
    const order = q.kind === 'success' ? await this.orders.findForPayment(orderId) : null;
    let refundId: string | null = null, paidAfterClose = false;
    const done = await this.transactions.run(async (tx) => {
      const p = await this.core.lockById(tx, a.payment_id);
      const cur = p ? await this.outcome.lockAttempt(tx, a.id) : undefined;
      if (!p || !cur || cur.status !== 'processing') return false; // IPN hay bên khác đã chốt giữa lúc hỏi cổng
      if (q.kind === 'success') {
        const r = await this.outcome.success(tx, p, cur, order?.status === 'pending', q.transactionNo, q.code);
        refundId = r.refund?.id ?? null;
        paidAfterClose = CLOSED.has(p.status);
      } else {
        await this.outcome.failure(tx, p, cur, 'timeout', q.kind === 'failed' ? q.code : null); // Payment đã đóng: chỉ ghi lượt, Payment không đổi
      }
      return true;
    }).catch((e) => {
      if (!(e instanceof DuplicateGatewayTxn)) throw e;
      return null; // cùng mã giao dịch cổng đã gắn lượt khác
    });
    if (done === null) return expired ? this.giveUp(a, orderCode, 'duplicate_txn') : false;
    if (paidAfterClose) this.log.warn('đối soát thấy khoản đã thu ở Payment đã đóng, hoàn tiền tự động', { code: 'reconcile-closed-collected', order_code: orderCode, refund: refundId ? 'requested' : 'exists' });
    if (refundId) this.refunds.dispatchSoon(refundId);
    return done;
  }

  /** Đóng lượt của Payment đã đóng mà cổng không chốt được quá hạn: lượt `failed`/`timeout` (Payment không đổi), log `error` cho người vận hành. IPN thành công về muộn vẫn được nhận (lượt `failed` do `timeout`). */
  private async giveUp(a: AttemptRow, orderCode: string, why: 'gateway_error' | 'amount_mismatch' | 'duplicate_txn'): Promise<boolean> {
    const closed = await this.transactions.run(async (tx) => {
      const p = await this.core.lockById(tx, a.payment_id);
      const cur = p ? await this.outcome.lockAttempt(tx, a.id) : undefined;
      if (!p || !cur || cur.status !== 'processing') return false; // đã chốt bởi IPN hay bên khác
      await this.outcome.failure(tx, p, cur, 'timeout', null);
      return true;
    });
    if (closed) this.log.error('lượt thử của Payment đã đóng không đối soát được sau hạn, đã đóng lượt; đối chiếu tay với VNPay', { code: 'reconcile-closed-unresolved', order_code: orderCode, why });
    return closed;
  }

  /** Job hằng ngày: xóa nhật ký webhook quá 12 tháng theo lô (ADR-022); trigger chỉ cho xóa đúng dòng quá hạn. Bảng khác của PAY không bao giờ bị xóa. */
  async purgeWebhookLogs(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`DELETE FROM payment_webhook_logs WHERE id IN (SELECT id FROM payment_webhook_logs WHERE created_at < now() - interval '12 months' LIMIT 1000)`;
      total += n;
      if (n < 1000) break;
    }
    if (total) this.log.info('đã xóa nhật ký webhook quá 12 tháng', { code: 'webhook-log-purged', deleted: total });
    return total;
  }
}
