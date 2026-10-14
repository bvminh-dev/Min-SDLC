import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AppLogger, AuditService, DomainError, EventsService, IdempotencyService, PrismaService, TransactionService, type SessionContext, type Tx,
} from '../platform';
import { JOB_BATCH, REFUND_RETRY_DELAYS_MS, REFUND_STALE_MS, REFUND_STUCK_MS, type RefundReason } from './config';
import { PaymentCore, uuidOf } from './core.service';
import { ATTEMPT_COLS, REFUND_COLS, type AttemptRow, type PaymentRow, type RefundRow } from './db';
import { VNPAY_GATEWAY, type RefundResult, type VnpayGateway } from './gateway';
import { hashOf } from './idem';

export interface RefundAccepted { refund_id: string; status: 'requested'; amount: number }
type Actor = { id: string | null; role: 'system' | 'admin' };
const newRequestId = (): string => randomBytes(16).toString('hex');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Giao dịch cổng của chính Payment (`provider_ref` của Payment khớp `provider_txn_no` của lượt thử): lượt thử được hoàn khi Payment sang `refunded`. */
export async function winningAttempt(tx: Tx, p: PaymentRow): Promise<AttemptRow | undefined> {
  if (!p.provider_ref) return undefined;
  return (await tx.$queryRaw<AttemptRow[]>`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE payment_id = ${p.id}::uuid AND provider_txn_no = ${p.provider_ref} AND status = 'succeeded'::attempt_status`)[0];
}

/**
 * Hoàn tiền (PAY-REQ ...946, ...034; PAY-DB mục 6 đến 8): chỉ toàn phần, số tiền do server lấy từ giao dịch; mỗi giao dịch cổng một Refund trọn đời (unique `attempt_id`). Mẫu ba bước: giao dịch 1 tạo Refund `requested`
 * cùng audit và commit; gọi cổng NGOÀI giao dịch (hạn 10 giây, mã yêu cầu `gateway_request_id` idempotent phía cổng); giao dịch 2 khóa Payment rồi Refund và ghi kết quả (SB-31). Không có trả lời thì để `requested` cho job đối soát.
 */
@Injectable()
export class RefundService {
  private readonly log: AppLogger;
  private readonly inflight = new Set<Promise<void>>();
  constructor(
    private readonly core: PaymentCore, private readonly audit: AuditService, private readonly events: EventsService, private readonly prisma: PrismaService,
    private readonly transactions: TransactionService, private readonly idem: IdempotencyService, @Inject(VNPAY_GATEWAY) private readonly gateway: VnpayGateway, logger: AppLogger,
  ) {
    this.log = logger.for('payment');
  }

  /** Tạo Refund `requested` trong giao dịch của bên gọi (đã khóa Payment); `null` khi giao dịch cổng này đã có Refund (unique `attempt_id`). Audit cùng giao dịch (SB-19, T10). */
  async create(tx: Tx, p: PaymentRow, a: AttemptRow, reason: RefundReason, actor: Actor, note?: string): Promise<RefundRow | null> {
    const now = this.core.now();
    const [r] = await tx.$queryRaw<RefundRow[]>`
      INSERT INTO refunds (payment_id, attempt_id, amount, reason, note, requested_by, status, gateway_request_id, auto_attempt_no, requested_at, created_at, updated_at)
      VALUES (${p.id}::uuid, ${a.id}::uuid, ${p.amount}, ${reason}::refund_reason, ${note ?? null}, ${actor.id}::uuid, 'requested'::refund_status, ${newRequestId()}, ${actor.role === 'system' ? 1 : null}, ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (attempt_id) DO NOTHING RETURNING ${REFUND_COLS}`;
    if (!r) { this.log.info('giao dịch cổng đã có hoàn tiền', { code: 'refund-already-created', order_code: p.order_code, payment_id: p.id }); return null; }
    await this.audit.record(tx, {
      actor_id: actor.id, actor_role: actor.role, action: actor.role === 'system' ? 'payment.refund.auto' : 'payment.refund.manual', target_type: 'payment', target_id: p.id,
      before: { status: p.status }, after: { refund_id: r.id, amount: Number(r.amount), reason }, reason: note ?? reason,
    });
    return r;
  }

  /** Hoàn thủ công toàn phần (admin): khóa Payment, kiểm theo thứ tự COD, trạng thái, Refund có sẵn, tạo Refund `admin_manual`; 202 ngay, cổng gọi ngay sau commit. */
  async manual(s: SessionContext, rawId: string, reason: string, key: string): Promise<{ replayed: boolean; status: number; body: RefundAccepted }> {
    const id = uuidOf(rawId);
    if (!id) throw new DomainError('not-found');
    const out = await this.idem.run({ scope: 'pay.refund', userId: s.user_id, key, requestHash: hashOf('/payments/:id/refunds', { id, reason }) }, async (tx) => {
      const p = await this.core.lockById(tx, id);
      if (!p) throw new DomainError('not-found');
      if (p.method === 'cod') throw new DomainError('cod-refund-unsupported');
      if (p.status !== 'succeeded') throw new DomainError('payment-not-refundable');
      const a = await winningAttempt(tx, p);
      if (!a) throw new DomainError('payment-not-refundable');
      const [ex] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM refunds WHERE attempt_id = ${a.id}::uuid`;
      if (ex) throw new DomainError(ex.status === 'requested' ? 'refund-in-progress' : ex.status === 'failed' ? 'refund-use-retry' : 'payment-not-refundable');
      const r = await this.create(tx, p, a, 'admin_manual', { id: s.user_id, role: 'admin' }, reason);
      if (!r) throw new DomainError('refund-in-progress');
      return { status: 202, body: { refund_id: r.id, status: 'requested' as const, amount: Number(r.amount) } };
    });
    if (!out.replayed) this.dispatchSoon(out.body.refund_id);
    return out;
  }

  /** Admin thử lại Refund `failed`: chuyển CHÍNH Refund đó về `requested` (mã yêu cầu mới, hủy lịch tự thử, không tính vào `auto_attempt_no`), audit người thử lại (PAY-REQ ...034 BR4). */
  async retry(s: SessionContext, rawId: string, key: string): Promise<{ replayed: boolean; status: number; body: RefundAccepted }> {
    const id = uuidOf(rawId);
    const pre = id ? (await this.prisma.$queryRaw<{ payment_id: string }[]>`SELECT payment_id FROM refunds WHERE id = ${id}::uuid`)[0] : undefined;
    if (!id || !pre) throw new DomainError('not-found');
    const out = await this.idem.run({ scope: 'pay.refund-retry', userId: s.user_id, key, requestHash: hashOf('/refunds/:id/retry', { id }) }, async (tx) => {
      const p = await this.core.lockById(tx, pre.payment_id);
      const r = (await tx.$queryRaw<RefundRow[]>`SELECT ${REFUND_COLS} FROM refunds WHERE id = ${id}::uuid FOR UPDATE`)[0];
      if (!p || !r) throw new DomainError('not-found');
      if (r.status === 'requested') throw new DomainError('refund-in-progress');
      if (r.status !== 'failed' || p.status !== 'succeeded') throw new DomainError('refund-not-retryable');
      const now = this.core.now();
      const [u] = await tx.$queryRaw<RefundRow[]>`
        UPDATE refunds SET status = 'requested'::refund_status, gateway_request_id = ${newRequestId()}, next_retry_at = NULL, failure_reason = NULL, gateway_code = NULL, resolved_at = NULL, requested_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${id}::uuid AND status = 'failed'::refund_status RETURNING ${REFUND_COLS}`;
      if (!u) throw new DomainError('refund-not-retryable');
      await this.audit.record(tx, { actor_id: s.user_id, actor_role: 'admin', action: 'payment.refund.retry', target_type: 'payment', target_id: p.id, before: { refund_id: u.id, status: 'failed' }, after: { refund_id: u.id, status: 'requested', amount: Number(u.amount) }, reason: u.note ?? u.reason });
      return { status: 202, body: { refund_id: u.id, status: 'requested' as const, amount: Number(u.amount) } };
    });
    if (!out.replayed) this.dispatchSoon(out.body.refund_id);
    return out;
  }

  /** Gọi cổng ngay sau commit của giao dịch tạo Refund (không chặn bên gọi): dòng mới commit có thể chưa thấy được nên thử lại vài lần; mất tiến trình thì job đối soát hoàn tiền nhặt lại sau 5 phút. */
  dispatchSoon(refundId: string): void {
    const p: Promise<void> = (async () => {
      for (let i = 0; i < 6; i++) {
        let r: 'done' | 'pending' | 'missing';
        try { r = await this.dispatch(refundId); } catch (e) { this.log.error('gọi hoàn tiền lỗi', { code: 'refund-dispatch-failed', refund_id: refundId, err: e }); return; }
        if (r !== 'missing') return;
        await sleep(50 * 2 ** i);
      }
    })().finally(() => { this.inflight.delete(p); });
    this.inflight.add(p);
  }
  /** Chờ mọi lần gọi cổng đang chạy (test; tắt ứng dụng). */
  async idle(): Promise<void> { while (this.inflight.size) await Promise.allSettled([...this.inflight]); }

  /** Gọi cổng cho Refund `requested` rồi ghi kết quả. `missing`: không có Refund `requested` (chưa commit hay đã chốt). `pending`: cổng chưa trả lời chắc chắn. */
  async dispatch(refundId: string): Promise<'done' | 'pending' | 'missing'> {
    const [row] = await this.prisma.$queryRaw<{ amount: bigint; gateway_request_id: string; requested_by: string | null; txn_ref: string; provider_txn_no: string | null; create_date: Date; order_code: string }[]>`
      SELECT r.amount, r.gateway_request_id, r.requested_by, a.txn_ref, a.provider_txn_no, a.create_date, p.order_code
      FROM refunds r JOIN payment_attempts a ON a.id = r.attempt_id JOIN payments p ON p.id = r.payment_id
      WHERE r.id = ${refundId}::uuid AND r.status = 'requested'::refund_status`;
    if (!row) return 'missing';
    let res: RefundResult;
    try {
      res = await this.gateway.refund({
        requestId: row.gateway_request_id, txnRef: row.txn_ref, amount: row.amount, transactionNo: row.provider_txn_no ?? '', transactionDate: row.create_date,
        createdBy: row.requested_by ?? 'system', orderInfo: `Hoan tien don ${row.order_code}`,
      });
    } catch (e) {
      this.log.warn('cổng hoàn tiền lỗi, giữ requested', { code: 'refund-gateway-error', refund_id: refundId, err_name: (e as Error)?.name });
      return 'pending';
    }
    if (res.kind === 'pending') { this.log.warn('cổng chưa trả lời hoàn tiền, giữ requested', { code: 'refund-gateway-pending', refund_id: refundId }); return 'pending'; }
    await this.settle(refundId, res);
    return 'done';
  }

  /** Giao dịch 2: khóa Payment rồi Refund; Refund không còn `requested` (đã chốt bởi bên khác) thì không làm gì. */
  private async settle(refundId: string, res: Exclude<RefundResult, { kind: 'pending' }>): Promise<void> {
    const [pre] = await this.prisma.$queryRaw<{ payment_id: string }[]>`SELECT payment_id FROM refunds WHERE id = ${refundId}::uuid`;
    if (!pre) return;
    await this.transactions.run(async (tx) => {
      const p = await this.core.lockById(tx, pre.payment_id);
      const r = (await tx.$queryRaw<RefundRow[]>`SELECT ${REFUND_COLS} FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`)[0];
      if (!p || !r || r.status !== 'requested') return;
      const [a] = await tx.$queryRaw<{ provider_txn_no: string | null }[]>`SELECT provider_txn_no FROM payment_attempts WHERE id = ${r.attempt_id}::uuid`;
      const now = this.core.now();
      const base = { refund_id: r.id, payment_id: p.id, order_id: p.order_id, order_code: p.order_code, user_id: p.user_id, amount: Number(r.amount), reason: r.reason };
      if (res.kind === 'succeeded') {
        const [u] = await tx.$queryRaw<{ id: string }[]>`
          UPDATE refunds SET status = 'succeeded'::refund_status, gateway_code = ${res.code}, failure_reason = NULL, next_retry_at = NULL, resolved_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
          WHERE id = ${r.id}::uuid AND status = 'requested'::refund_status RETURNING id`;
        if (!u) return;
        if (p.status === 'succeeded' && a?.provider_txn_no === p.provider_ref) await this.core.move(tx, p, 'refund'); // hoàn giao dịch của chính Payment: Payment sang `refunded`; hoàn muộn, trùng cho Payment đã đóng không đổi Payment
        await this.events.publish(tx, { type: 'RefundSucceeded', aggregate_type: 'refund', aggregate_id: p.id, payload: base });
        return;
      }
      const auto = r.auto_attempt_no;
      const next = auto !== null && auto < this.core.cfg('PAY_REFUND_AUTO_ATTEMPTS') && p.status === 'succeeded' ? new Date(now.getTime() + (REFUND_RETRY_DELAYS_MS[auto - 1] ?? REFUND_RETRY_DELAYS_MS[REFUND_RETRY_DELAYS_MS.length - 1])) : null;
      const [u] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE refunds SET status = 'failed'::refund_status, failure_reason = 'gateway-declined', gateway_code = ${res.code}, resolved_at = ${now}::timestamptz, next_retry_at = ${next}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${r.id}::uuid AND status = 'requested'::refund_status RETURNING id`;
      if (!u) return;
      await this.events.publish(tx, { type: 'RefundFailed', aggregate_type: 'refund', aggregate_id: p.id, payload: { ...base, failure_reason: 'gateway-declined' } });
    });
  }

  /**
   * Kết thúc có hạn cho Refund kẹt `requested` (PAY-REQ ...946 BR6, PAY-DB mục 6): khóa Payment rồi Refund, vẫn `requested` và đã vào `requested` quá REFUND_STUCK_MS thì `requested -> failed`
   * (`failure_reason` = `gateway-no-answer`, không hẹn tự thử lại), phát RefundFailed (NTF báo admin) và log `error` `refund-stuck`. KHÔNG tự thử lại và không tự chốt `succeeded`: cổng có thể đã hoàn
   * (chốt sai là hoàn hai lần); admin đối chiếu giao dịch ở cổng VNPay rồi mới bấm thử lại (mã yêu cầu mới).
   */
  private async giveUp(refundId: string, now: Date): Promise<boolean> {
    const [pre] = await this.prisma.$queryRaw<{ payment_id: string }[]>`SELECT payment_id FROM refunds WHERE id = ${refundId}::uuid`;
    if (!pre) return false;
    const cutoff = new Date(now.getTime() - REFUND_STUCK_MS);
    const ended = await this.transactions.run(async (tx) => {
      const p = await this.core.lockById(tx, pre.payment_id);
      const r = (await tx.$queryRaw<RefundRow[]>`SELECT ${REFUND_COLS} FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`)[0];
      if (!p || !r || r.status !== 'requested' || r.requested_at >= cutoff) return false; // đã chốt, hay mới vào `requested` lại (thử lại tay): không kết thúc
      const [u] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE refunds SET status = 'failed'::refund_status, failure_reason = 'gateway-no-answer', resolved_at = ${now}::timestamptz, next_retry_at = NULL, updated_at = ${now}::timestamptz
        WHERE id = ${r.id}::uuid AND status = 'requested'::refund_status RETURNING id`;
      if (!u) return false;
      await this.events.publish(tx, {
        type: 'RefundFailed', aggregate_type: 'refund', aggregate_id: p.id,
        payload: { refund_id: r.id, payment_id: p.id, order_id: p.order_id, order_code: p.order_code, user_id: p.user_id, amount: Number(r.amount), reason: r.reason, failure_reason: 'gateway-no-answer' },
      });
      return true;
    });
    if (ended) this.log.error('hoàn tiền kẹt ở requested quá 1 giờ, đã chuyển failed; cần đối chiếu tay với VNPay trước khi thử lại', { code: 'refund-stuck', refund_id: refundId, payment_id: pre.payment_id });
    return ended;
  }

  /**
   * Job tự thử lại và đối soát hoàn tiền (ADR-013, PAY-DB mục 7 và 9; mỗi phút): (1) Refund `failed` tới hẹn `next_retry_at` mà Payment còn `succeeded` thì chính Refund đó `failed -> requested` (lần tự thử kế, mã yêu cầu mới);
   * (2) Refund `requested` quá 5 phút (không nhận được trả lời) thì hỏi lại cổng bằng CÙNG mã yêu cầu. Mỗi dòng một giao dịch ngắn có khóa `SKIP LOCKED` (nhiều tiến trình không làm lặp), gọi cổng ngoài giao dịch, tối đa JOB_BATCH dòng mỗi lượt (SB-34).
   */
  async sweep(now: Date = this.core.now(), signal?: AbortSignal): Promise<{ retried: number; reasked: number; gaveUp: number }> {
    let retried = 0, reasked = 0, gaveUp = 0;
    const due = await this.prisma.$queryRaw<{ id: string; payment_id: string }[]>`
      SELECT id, payment_id FROM refunds WHERE status = 'failed'::refund_status AND next_retry_at <= ${now}::timestamptz ORDER BY next_retry_at, id LIMIT ${JOB_BATCH}`;
    for (const d of due) {
      if (signal?.aborted) return { retried, reasked, gaveUp };
      const claimed = await this.transactions.run(async (tx) => {
        const p = await this.core.lockSkip(tx, d.payment_id);
        if (!p) return false; // bên khác đang xử lý Payment này
        const r = (await tx.$queryRaw<RefundRow[]>`SELECT ${REFUND_COLS} FROM refunds WHERE id = ${d.id}::uuid AND status = 'failed'::refund_status AND next_retry_at <= ${now}::timestamptz FOR UPDATE`)[0];
        if (!r) return false;
        if (p.status !== 'succeeded') { await tx.$executeRaw`UPDATE refunds SET next_retry_at = NULL, updated_at = ${now}::timestamptz WHERE id = ${r.id}::uuid`; return false; }
        await tx.$executeRaw`
          UPDATE refunds SET status = 'requested'::refund_status, auto_attempt_no = COALESCE(auto_attempt_no, 0) + 1, gateway_request_id = ${newRequestId()}, next_retry_at = NULL, failure_reason = NULL, gateway_code = NULL,
                 resolved_at = NULL, requested_at = ${now}::timestamptz, updated_at = ${now}::timestamptz WHERE id = ${r.id}::uuid AND status = 'failed'::refund_status`;
        return true;
      });
      if (claimed) { retried++; await this.dispatch(d.id).catch((e) => this.log.error('gọi hoàn tiền lỗi', { code: 'refund-dispatch-failed', refund_id: d.id, err: e })); }
    }
    const stale = await this.prisma.$queryRaw<{ id: string; payment_id: string; requested_at: Date }[]>`
      SELECT id, payment_id, requested_at FROM refunds WHERE status = 'requested'::refund_status AND updated_at <= ${new Date(now.getTime() - REFUND_STALE_MS)}::timestamptz ORDER BY updated_at, id LIMIT ${JOB_BATCH}`;
    for (const d of stale) {
      if (signal?.aborted) break;
      const claimed = await this.transactions.run(async (tx) => {
        const p = await this.core.lockSkip(tx, d.payment_id);
        if (!p) return false;
        // thuê dòng bằng `updated_at`: lượt đối soát khác (hay tiến trình khác) không nhặt lại trước 5 phút nữa
        return (await tx.$executeRaw`UPDATE refunds SET updated_at = ${now}::timestamptz WHERE id = ${d.id}::uuid AND status = 'requested'::refund_status AND updated_at <= ${new Date(now.getTime() - REFUND_STALE_MS)}::timestamptz`) > 0;
      });
      if (!claimed) continue;
      reasked++;
      const r = await this.dispatch(d.id).catch((e) => { this.log.error('gọi hoàn tiền lỗi', { code: 'refund-dispatch-failed', refund_id: d.id, err: e }); return 'pending' as const; });
      // Đường kết thúc có hạn (PAY-REQ ...946 BR6): đã vào `requested` quá REFUND_STUCK_MS mà cổng vẫn không chốt (lần hỏi lại vừa rồi cũng `pending`) thì không chờ mãi
      if (r === 'pending' && await this.giveUp(d.id, now)) gaveUp++; // giveUp kiểm hạn trên dòng đã khóa
    }
    return { retried, reasked, gaveUp };
  }
}
