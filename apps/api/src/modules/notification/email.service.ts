import { Inject, Injectable } from '@nestjs/common';
import { AuthApi } from '../auth';
import { AppLogger, Clock, PrismaService, TransactionService, type EventEnvelope } from '../platform';
import {
  LEASE_MS, MAX_SEND_ATTEMPTS, NORMAL_CAP, NORMAL_CAP_WINDOW_MS, RETRY_DELAYS_MS, SECRET_CAP, SECRET_CAP_WINDOW_MS, SECRET_LOST_MS, SECRET_RETRY_DELAYS_MS, SEND_BATCH, SEND_BUDGET_MS, SES_TIMEOUT_MS,
  type EmailType, type NtfConfig,
} from './config';
import { MAIL_TRANSPORT, MailError, type MailMessage, type MailTransport } from './mail';
import { renderEmail } from './render';
import { planToken } from './templates';

export const NTF_CONFIG = Symbol('NTF_CONFIG');
interface Due { id: string; user_id: string; type: EmailType; data: unknown; attempts: number; due: Date }
export interface SendOptions { now?: Date; signal?: AbortSignal; budgetMs?: number; batch?: number }
export interface SendResult { picked: number; sent: number; skipped: number; failed: number; retry: number; deferred: number }

/**
 * Gửi email qua SES (NTF-REQ-20261006-103208551; NTF-DB mục Giao dịch và khóa 4 đến 6). Email thường: job mỗi phút nhận việc bằng `FOR UPDATE SKIP LOCKED` (thuê dòng 2 phút), hỏi AUTH địa chỉ hiện tại và `email_verified`
 * NGOÀI giao dịch, kiểm hạn mức dưới khóa tư vấn theo người nhận, gọi SES NGOÀI giao dịch (hạn 10 giây), ghi kết quả bằng một câu UPDATE có điều kiện `delivery_status = 'pending'`. Email chứa bí mật: gửi ngay
 * trong handler (token chỉ ở bộ nhớ), tối đa 3 lần cách nhau 2 giây và 5 giây, không bao giờ thử lại sau đó. Log chỉ ghi mã bản ghi, loại, trạng thái, mã lỗi (BR9): không địa chỉ, họ tên, thân thư, token.
 */
@Injectable()
export class EmailService {
  /** Hạn gọi SES; chỉ test đổi để thử nhánh quá hạn nhanh. */
  timeoutMs = SES_TIMEOUT_MS;
  /** Chờ giữa các lần gửi của email bí mật; chỉ test thay bằng đồng hồ giả. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly auth: AuthApi, private readonly clock: Clock,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport, @Inject(NTF_CONFIG) private readonly cfg: NtfConfig, logger: AppLogger,
  ) {
    this.log = logger.for('notification');
  }

  private async send(msg: MailMessage): Promise<void> {
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.mail.send(msg, ac.signal),
        new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new MailError('ses_timeout', false)); }, this.timeoutMs); }),
      ]);
    } catch (e) {
      throw e instanceof MailError ? e : new MailError('ses_error', false); // lỗi lạ: tạm thời, không kèm thông điệp (có thể chứa địa chỉ)
    } finally { if (timer) clearTimeout(timer); }
  }

  /** Một nhịp của job gửi email thường: tối đa 50 dòng (SB-34), tuần tự (không dồn nhiều lời gọi SES), dừng khi hết hạn thời gian hoặc job bị hủy; dòng đã thuê mà chưa kịp gửi tự đến hạn lại sau 2 phút. */
  async sendDue(o: SendOptions = {}): Promise<SendResult> {
    const start = Date.now(), budget = o.budgetMs ?? SEND_BUDGET_MS;
    const now = o.now ?? this.clock.now();
    const lease = new Date(now.getTime() + LEASE_MS);
    const rows = await this.transactions.run((tx) => tx.$queryRaw<Due[]>`
      WITH picked AS (
        SELECT id, next_attempt_at AS due FROM email_deliveries
        WHERE delivery_status = 'pending' AND next_attempt_at <= ${now}::timestamptz AND type NOT IN ('email_verification', 'password_reset')
        ORDER BY next_attempt_at, id LIMIT ${o.batch ?? SEND_BATCH} FOR UPDATE SKIP LOCKED)
      UPDATE email_deliveries e SET next_attempt_at = ${lease}::timestamptz, updated_at = ${now}::timestamptz
      FROM picked p WHERE e.id = p.id
      RETURNING e.id, e.user_id, e.type::text AS type, e.data, e.attempts, p.due`);
    rows.sort((a, b) => a.due.getTime() - b.due.getTime() || (a.id < b.id ? -1 : 1));
    const r: SendResult = { picked: rows.length, sent: 0, skipped: 0, failed: 0, retry: 0, deferred: 0 };
    for (const row of rows) {
      if (o.signal?.aborted || Date.now() - start >= budget) break;
      try {
        r[await this.deliverOne(row)]++;
      } catch (err) {
        // một dòng lỗi bất ngờ (CSDL từ chối ghi, lỗi dựng thư) không được bỏ rơi các dòng sau nó trong lượt: dòng đó tự đến hạn lại sau khi hết thuê (REV-NTF-03)
        r.deferred++;
        this.log.error('lỗi bất ngờ ở một dòng email, bỏ qua dòng này', { code: 'email-row-failed', delivery_id: row.id, err_name: (err as Error)?.name });
      }
    }
    return r;
  }

  private async deliverOne(row: Due): Promise<'sent' | 'skipped' | 'failed' | 'retry' | 'deferred'> {
    let contact;
    try {
      contact = await this.auth.getUserContact(row.user_id);
    } catch (err) {
      this.log.warn('AUTH không trả lời, dòng email đến hạn lại sau khi hết thuê', { code: 'auth-unavailable', delivery_id: row.id, err_name: (err as Error)?.name });
      return 'deferred';
    }
    if (!contact) { await this.finish(row.id, 'skipped', 'no_user'); return 'skipped'; }
    if (!contact.email_verified) { await this.finish(row.id, 'skipped', 'unverified'); return 'skipped'; } // BR3: email giao dịch chỉ tới địa chỉ đã xác minh (T11)

    const t = this.clock.now();
    const admitted = await this.transactions.run(async (tx) => {
      // khóa theo người nhận: hai job không cùng thấy dưới ngưỡng (bậc E của SB-14, NTF-DB mục 5). Đếm cả dòng đang gửi dở của lượt khác (`delivery_reason = 'sending'`, còn thuê): `sent` chỉ được ghi sau khi SES trả lời (REV-NTF-01)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.user_id}, 0))`;
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM email_deliveries
        WHERE user_id = ${row.user_id}::uuid AND id <> ${row.id}::uuid AND type NOT IN ('email_verification', 'password_reset')
          AND ((delivery_status = 'sent' AND sent_at > ${t}::timestamptz - make_interval(secs => ${NORMAL_CAP_WINDOW_MS / 1000}::int))
            OR (delivery_status = 'pending' AND delivery_reason = 'sending' AND next_attempt_at > ${t}::timestamptz))`;
      if (n >= NORMAL_CAP) {
        const c = await tx.$executeRaw`UPDATE email_deliveries SET delivery_status = 'skipped', delivery_reason = 'rate_capped', next_attempt_at = NULL, updated_at = ${t}::timestamptz WHERE id = ${row.id}::uuid AND delivery_status = 'pending'`;
        return c > 0 ? ('capped' as const) : null;
      }
      const upd = await tx.$queryRaw<{ attempts: number }[]>`
        UPDATE email_deliveries SET attempts = attempts + 1, delivery_reason = 'sending', next_attempt_at = ${new Date(t.getTime() + LEASE_MS)}::timestamptz, updated_at = ${t}::timestamptz
        WHERE id = ${row.id}::uuid AND delivery_status = 'pending' AND attempts < ${MAX_SEND_ATTEMPTS} RETURNING attempts`;
      if (upd[0]) return upd[0].attempts;
      // đã thuê đủ số lần mà chưa lần nào ghi được kết quả (tiến trình chết sau mỗi lần thuê): đóng thay vì thuê lần thứ tư (CHECK attempts <= 3 sẽ làm cả lượt ném lỗi, REV-NTF-02)
      const x = await tx.$executeRaw`UPDATE email_deliveries SET delivery_status = 'failed', delivery_reason = 'attempts_exhausted', next_attempt_at = NULL, updated_at = ${t}::timestamptz WHERE id = ${row.id}::uuid AND delivery_status = 'pending' AND attempts >= ${MAX_SEND_ATTEMPTS}`;
      return x > 0 ? ('exhausted' as const) : null;
    });
    if (admitted === null) return 'skipped';
    if (admitted === 'exhausted') { this.log.error('gửi email thất bại', { code: 'email-failed', delivery_id: row.id, kind: row.type, reason: 'attempts_exhausted' }); return 'failed'; }
    if (admitted === 'capped') { this.log.warn('vượt hạn mức email theo người nhận, bỏ qua', { code: 'email-rate-capped', delivery_id: row.id, kind: row.type }); return 'skipped'; }

    const attempts = admitted;
    try {
      await this.send({ from: this.cfg.MAIL_FROM, to: contact.email, ...renderEmail(row.type, row.data, { fullName: contact.full_name, baseUrl: this.cfg.APP_BASE_URL }) });
    } catch (e) {
      const err = e as MailError;
      const t2 = this.clock.now();
      if (err.permanent || attempts >= MAX_SEND_ATTEMPTS) {
        await this.finish(row.id, 'failed', err.code, attempts);
        this.log.error('gửi email thất bại', { code: 'email-failed', delivery_id: row.id, kind: row.type, reason: err.code, attempts });
        return 'failed';
      }
      const next = new Date(t2.getTime() + RETRY_DELAYS_MS[attempts - 1]);
      await this.prisma.$executeRaw`UPDATE email_deliveries SET next_attempt_at = ${next}::timestamptz, delivery_reason = ${err.code}, updated_at = ${t2}::timestamptz WHERE id = ${row.id}::uuid AND delivery_status = 'pending'`;
      this.log.warn('gửi email lỗi tạm thời, sẽ thử lại', { code: 'email-retry', delivery_id: row.id, kind: row.type, reason: err.code, attempts });
      return 'retry';
    }
    await this.finish(row.id, 'sent', null, attempts);
    return 'sent';
  }

  /** Ghi kết quả cuối bằng một câu UPDATE có điều kiện: dòng đã đổi trạng thái (tiến trình khác, dọn) thì không ghi đè (NTF-DB mục 4). */
  private async finish(id: string, status: 'sent' | 'failed' | 'skipped', reason: string | null, attempts?: number): Promise<void> {
    const t = this.clock.now();
    await this.prisma.$executeRaw`
      UPDATE email_deliveries SET delivery_status = ${status}::email_delivery_status, delivery_reason = ${reason}, next_attempt_at = NULL,
        sent_at = ${status === 'sent' ? t : null}::timestamptz, attempts = COALESCE(${attempts ?? null}::smallint, attempts), updated_at = ${t}::timestamptz
      WHERE id = ${id}::uuid AND delivery_status = 'pending'`;
  }

  /** Bản ghi email bí mật còn `pending` quá 5 phút là tiến trình đã chết giữa chừng: token đã mất, đổi `failed` lý do `lost`, không bao giờ gửi (NTF-DB mục 6). Theo lô, trả số dòng đã đổi. */
  async failLost(now: Date = this.clock.now(), batch = 1000): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        UPDATE email_deliveries SET delivery_status = 'failed', delivery_reason = 'lost', next_attempt_at = NULL, updated_at = ${now}::timestamptz
        WHERE id IN (SELECT id FROM email_deliveries WHERE type IN ('email_verification', 'password_reset') AND delivery_status = 'pending'
                       AND created_at < ${now}::timestamptz - make_interval(secs => ${SECRET_LOST_MS / 1000}::int) ORDER BY created_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED)`;
      total += n;
      if (n < batch) break;
    }
    if (total > 0) this.log.warn('email bí mật bị kẹt, token đã mất', { code: 'email-lost', count: total });
    return total;
  }

  /**
   * PasswordResetRequested, EmailVerificationRequested (NTF-REQ-20261006-103209078 BR1 đến BR4; NTF-REQ-20261006-103208551 BR6): chạy trong tiến trình sau commit của AUTH, không qua outbox, không ProcessedEvent.
   * Hạn mức 10 mỗi giờ dưới khóa tư vấn (đếm cả bản ghi đang gửi dở để các yêu cầu dồn dập không cùng lọt dưới ngưỡng); chèn `pending` (không `next_attempt_at`, job không bao giờ nhặt, `data` rỗng), commit, rồi gọi SES
   * tối đa ba lần (0, 2, 5 giây) với token ở bộ nhớ và ghi `sent` hay `failed`. Mọi nhánh lỗi chỉ ghi log mã, không bao giờ token, địa chỉ hay payload.
   */
  async handleToken(env: EventEnvelope): Promise<void> {
    const planned = planToken(env, this.clock.now());
    if (!planned.ok) {
      this.log[planned.level]('event token bị bỏ qua', { code: planned.code, event_type: env.type, event_id: env.event_id, user_id: planned.userId });
      return;
    }
    const { type, userId, token, expiresAt } = planned.plan;
    const contact = await this.auth.getUserContact(userId); // lỗi ném cho nơi gọi (log error không payload, mất event, khách gửi lại ở AUTH)
    if (!contact) { this.log.warn('người nhận không tồn tại, bỏ qua', { code: 'recipient-not-found', event_type: env.type, event_id: env.event_id, user_id: userId }); return; }

    const t = this.clock.now();
    const id = await this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:secret`}, 0))`;
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM email_deliveries
        WHERE user_id = ${userId}::uuid AND type IN ('email_verification', 'password_reset')
          AND ((delivery_status = 'sent' AND sent_at > ${t}::timestamptz - make_interval(secs => ${SECRET_CAP_WINDOW_MS / 1000}::int))
            OR (delivery_status = 'pending' AND created_at > ${t}::timestamptz - make_interval(secs => ${SECRET_LOST_MS / 1000}::int)))`;
      const capped = n >= SECRET_CAP;
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO email_deliveries (user_id, type, event_id, dedupe_key, delivery_status, delivery_reason, updated_at)
        VALUES (${userId}::uuid, ${type}::email_type, ${env.event_id}::uuid, ${`${type}:${env.event_id}`}, ${capped ? 'skipped' : 'pending'}::email_delivery_status, ${capped ? 'rate_capped' : null}, ${t}::timestamptz)
        ON CONFLICT DO NOTHING RETURNING id`;
      return capped || rows.length === 0 ? null : rows[0].id;
    });
    if (id === null) { this.log.warn('email bí mật bị bỏ qua (vượt hạn mức hoặc trùng)', { code: 'email-rate-capped', event_id: env.event_id, kind: type }); return; }

    let last: MailError | undefined;
    for (let i = 0; i < SECRET_RETRY_DELAYS_MS.length; i++) {
      if (SECRET_RETRY_DELAYS_MS[i] > 0) await this.sleep(SECRET_RETRY_DELAYS_MS[i]);
      try {
        await this.send({ from: this.cfg.MAIL_FROM, to: contact.email, ...renderEmail(type, {}, { fullName: contact.full_name, baseUrl: this.cfg.APP_BASE_URL, secret: { token, expiresAt } }) });
        await this.finish(id, 'sent', null, i + 1);
        return;
      } catch (e) {
        last = e as MailError;
        if (last.permanent) { await this.finish(id, 'failed', last.code, i + 1); this.log.error('gửi email bí mật thất bại', { code: 'email-failed', delivery_id: id, kind: type, reason: last.code, attempts: i + 1 }); return; }
      }
    }
    await this.finish(id, 'failed', last?.code ?? 'ses_error', SECRET_RETRY_DELAYS_MS.length); // thất bại cả ba lần: bí mật đã mất, không bao giờ thử lại (khách gửi lại ở AUTH)
    this.log.error('gửi email bí mật thất bại', { code: 'email-failed', delivery_id: id, kind: type, reason: last?.code, attempts: SECRET_RETRY_DELAYS_MS.length });
  }
}
