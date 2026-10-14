import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { DomainError, IdempotencyService, PrismaService, type SessionContext, type Tx } from '../platform';
import { OrderApi } from '../order';
import { VNPAY_MAX_AMOUNT, VNPAY_MIN_AMOUNT } from './config';
import { PaymentCore, uuidOf } from './core.service';
import { ATTEMPT_COLS, isUnique, type AttemptRow, type PaymentRow } from './db';
import { hashOf } from './idem';
import { buildPayUrl } from './vnpay';

export interface StartResponse { payment_id: string; status: 'processing'; attempt_no: number; max_attempts: number; redirect_url: string; expires_at: string }

/** `vnp_IpAddr` cố định: đường dẫn dựng lại từ dữ liệu đã lưu (bấm lặp trả đúng đường dẫn cũ, từng ký tự) nên không được phụ thuộc IP của lời gọi sau (xem report, Lệch spec). */
const URL_IP = '127.0.0.1';

/**
 * Bắt đầu và thử lại thanh toán online (PAY-REQ ...422, ...771; PAY-DB mục 2). Số tiền, địa chỉ quay về và khóa ký do server quyết, không nhận từ client (SB-23). Thứ tự: đọc Payment của chính người dùng (đơn người khác
 * và không tồn tại cùng 404, SB-06), đọc đơn từ ORD NGOÀI giao dịch (không giữ kết nối trong lúc chờ khóa), rồi một giao dịch của khóa Idempotency-Key: khóa dòng Payment, kiểm điều kiện theo thứ tự của spec, tăng `attempt_no` có
 * điều kiện `< PAY_MAX_ATTEMPTS`, tạo lượt thử, sang `processing`. Không gọi cổng trong lúc tạo.
 */
@Injectable()
export class StartService {
  constructor(private readonly prisma: PrismaService, private readonly idem: IdempotencyService, private readonly core: PaymentCore, private readonly orders: OrderApi) {}

  start(s: SessionContext, rawId: string, key: string, kind: 'initiate' | 'retry'): Promise<{ replayed: boolean; status: number; body: StartResponse }> {
    return this.run(s, rawId, key, kind);
  }

  private async run(s: SessionContext, rawId: string, key: string, kind: 'initiate' | 'retry') {
    const id = uuidOf(rawId);
    const pre = id ? (await this.prisma.$queryRaw<{ order_id: string }[]>`SELECT order_id FROM payments WHERE id = ${id}::uuid AND user_id = ${s.user_id}::uuid`)[0] : undefined;
    if (!id || !pre) throw new DomainError('not-found'); // Payment của người khác, không tồn tại và id sai định dạng: cùng một 404
    const order = await this.orders.findForPayment(pre.order_id);
    return this.idem.run({ scope: `pay.${kind}`, userId: s.user_id, key, requestHash: hashOf(`/payments/:id/${kind}`, { id }) }, async (tx) => {
      const p = await this.core.lockById(tx, id, s.user_id);
      if (!p) throw new DomainError('not-found');
      return { status: 200, body: await this.decide(tx, p, order?.status === 'pending', kind) };
    });
  }

  private async decide(tx: Tx, p: PaymentRow, orderPending: boolean, kind: 'initiate' | 'retry'): Promise<StartResponse> {
    const now = this.core.now();
    const max = this.core.cfg('PAY_MAX_ATTEMPTS');
    if (kind === 'initiate') {
      if (p.method !== 'vnpay') throw new DomainError('payment-not-online');
      if (p.amount < BigInt(VNPAY_MIN_AMOUNT) || p.amount > BigInt(VNPAY_MAX_AMOUNT)) throw new DomainError('amount-out-of-range');
    }
    if (p.status === 'processing') {
      // bấm lặp: lượt thử hiện tại còn hạn thì trả đúng đường dẫn cũ; hết hạn mà chưa đối soát ra `failed` thì 409 `payment-in-progress`.
      // `retry` chỉ nhận lại lượt do chính lần thử lại tạo (lượt 2 trở đi); lượt 1 do bắt đầu thanh toán tạo nên không phải để thử lại.
      if (kind === 'retry' && p.attempt_no < 2) throw new DomainError('payment-not-retryable');
      const a = (await tx.$queryRaw<AttemptRow[]>`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE payment_id = ${p.id}::uuid AND attempt_no = ${p.attempt_no}`)[0];
      if (!a || a.status !== 'processing' || a.expires_at.getTime() <= now.getTime()) throw new DomainError('payment-in-progress');
      return this.response(p, a);
    }
    if (kind === 'initiate') {
      if (p.status !== 'pending') throw new DomainError('payment-not-startable');
      if (!orderPending || !p.expires_at || p.expires_at.getTime() <= now.getTime()) throw new DomainError('payment-not-startable');
    } else {
      if (p.status !== 'failed') throw new DomainError('payment-not-retryable');
      if (p.attempt_no >= max) throw new DomainError('attempts-exhausted');
      if (!orderPending) throw new DomainError('order-not-pending');
      if (!p.expires_at || p.expires_at.getTime() <= now.getTime()) throw new DomainError('payment-expired');
    }
    const ttl = new Date(now.getTime() + this.core.cfg('PAY_ATTEMPT_URL_TTL_MINUTES') * 60_000);
    const expiresAt = p.expires_at && p.expires_at.getTime() < ttl.getTime() ? p.expires_at : ttl; // không bao giờ vượt hạn của Payment (K-01)
    // `attempt_no + 1` có điều kiện: giới hạn chính do ứng dụng kiểm `attempt_no < PAY_MAX_ATTEMPTS`, CHECK của CSDL chỉ là trần an toàn
    const [u] = await tx.$queryRaw<{ attempt_no: number }[]>`
      UPDATE payments SET attempt_no = attempt_no + 1, updated_at = ${now}::timestamptz WHERE id = ${p.id}::uuid AND status = ${p.status}::payment_status AND attempt_no < ${max} RETURNING attempt_no`;
    if (!u) throw new DomainError('attempts-exhausted');
    const txnRef = `${randomBytes(8).toString('hex')}${String(u.attempt_no).padStart(2, '0')}`;
    let a: AttemptRow;
    try {
      [a] = await tx.$queryRaw<AttemptRow[]>`
        INSERT INTO payment_attempts (payment_id, attempt_no, txn_ref, status, create_date, expires_at, created_at, updated_at)
        VALUES (${p.id}::uuid, ${u.attempt_no}, ${txnRef}, 'processing'::attempt_status, ${now}::timestamptz, ${expiresAt}::timestamptz, ${now}::timestamptz, ${now}::timestamptz) RETURNING ${ATTEMPT_COLS}`;
    } catch (e) {
      if (isUnique(e, /payment_id.*attempt_no|attempt_no.*payment_id/)) throw new DomainError('payment-in-progress'); // bên thua đua: giao dịch rollback, lần gọi sau đọc lại
      throw e;
    }
    const moved = await this.core.move(tx, p, kind === 'retry' ? 'retry' : 'start', { set: Prisma.empty });
    if (!moved) throw new DomainError(kind === 'retry' ? 'payment-not-retryable' : 'payment-not-startable');
    return this.response(moved, a);
  }

  private response(p: PaymentRow, a: AttemptRow): StartResponse {
    const returnTpl = this.core.cfg('VNPAY_RETURN_URL'), tmn = this.core.cfg('VNPAY_TMN_CODE'), secret = this.core.cfg('VNPAY_HASH_SECRET');
    // cấu hình thiếu (chỉ ở dev) thì không dựng đường dẫn: đóng khi không chắc, không ký bằng khóa rỗng
    if (!returnTpl || !tmn || !secret) throw new DomainError('service-unavailable');
    return {
      payment_id: p.id, status: 'processing', attempt_no: a.attempt_no, max_attempts: this.core.cfg('PAY_MAX_ATTEMPTS'),
      redirect_url: buildPayUrl({
        payUrl: this.core.cfg('VNPAY_PAY_URL'), tmnCode: tmn, secret, amount: p.amount, txnRef: a.txn_ref, orderCode: p.order_code,
        returnUrl: returnTpl.replaceAll('{order_code}', encodeURIComponent(p.order_code)), ip: URL_IP, createDate: a.create_date, expireDate: a.expires_at,
      }),
      expires_at: a.expires_at.toISOString(),
    };
  }
}
