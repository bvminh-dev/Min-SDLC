import { Injectable } from '@nestjs/common';
import {
  AppLogger, AuditService, Clock, ConfigService, DomainError, EventsService, PrismaService, TransactionService, type Tx,
} from '../platform';
import {
  FORGOT_PER_EMAIL_HOUR, HOUR_MS, LOGIN_LOCK_MS, LOGIN_LOCK_THRESHOLD, LOGIN_WINDOW_MS, RESEND_COOLDOWN_MS, RESEND_PER_HOUR, RESET_TOKEN_MS,
  VERIFY_TOKEN_MS, type AuthConfig,
} from './config';
import { hashPassword, hashToken, needsRehash, newToken, verifyPassword, type ArgonParams } from './crypto';
import { INVALID_CREDENTIALS_DETAIL, INVALID_TOKEN_DETAIL } from './errors';
import { normalizeEmail, sameAsEmail } from './policy';
import { createSession, emitSessionRevoked, revokeAllSessions } from './session.store';

interface LoginRow {
  id: string; email: string; full_name: string; role: 'customer' | 'staff' | 'admin'; status: 'active' | 'locked'; password_hash: string;
  email_verified_at: Date | null; locked_until: Date | null; locked_reason: 'too_many_attempts' | 'admin' | null;
}
export interface LoginResult {
  token: string;
  user: { id: string; email: string; full_name: string; role: string; email_verified: boolean };
}
const invalidCredentials = () => new DomainError('invalid_credentials', { detail: INVALID_CREDENTIALS_DETAIL });
const invalidToken = () => new DomainError('invalid_or_expired_token', { detail: INVALID_TOKEN_DETAIL });
const retryAfter = (ms: number) => ({ 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) });

@Injectable()
export class AuthService {
  private readonly log;
  private dummy?: Promise<string>;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.for('auth');
  }

  private get argon(): ArgonParams {
    return { memory: this.config.get<number>('ARGON2_MEMORY_KIB'), passes: this.config.get<number>('ARGON2_TIME_COST'), parallelism: this.config.get<number>('ARGON2_PARALLELISM') };
  }
  private get maxSessions(): number { return this.config.get<AuthConfig['AUTH_MAX_ACTIVE_SESSIONS']>('AUTH_MAX_ACTIVE_SESSIONS'); }

  /** Băm giả cùng tham số, dùng khi email không tồn tại để cân thời gian (SB-02). */
  private dummyHash(): Promise<string> {
    return (this.dummy ??= hashPassword('dummy-password-for-timing', this.argon));
  }

  /** Việc làm sau khi đã trả lời (quên mật khẩu: thời gian phản hồi không phụ thuộc email có tồn tại, REQ-843 BR4). Test chờ bằng `idle()`. */
  private afterReply(fn: () => Promise<void>): void {
    const p: Promise<void> = fn().catch((err) => this.log.error('việc sau phản hồi thất bại', { err })).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // --- Đăng ký (REG)
  async register(input: { email: string; password: string; full_name: string }): Promise<void> {
    const now = this.clock.now();
    const hash = await hashPassword(input.password, this.argon); // luôn băm trước: email mới hay đã có cùng chi phí (SB-02)
    await this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (email, password_hash, full_name, created_at, updated_at)
        VALUES (${input.email}::citext, ${hash}, ${input.full_name}, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (email) DO NOTHING RETURNING id`;
      if (!rows.length) return; // email đã có (kể cả chạy đua): không ghi gì thêm, vẫn 202
      const userId = rows[0].id;
      await this.issueVerification(tx, userId, now);
      await this.events.publish(tx, { type: 'UserRegistered', aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, email: input.email } });
    });
  }

  /** Phát hành token xác minh mới (làm token cũ hết hiệu lực) và phát EmailVerificationRequested sau commit (K-14). */
  private async issueVerification(tx: Tx, userId: string, now: Date): Promise<Date> {
    const token = newToken();
    const expires = new Date(now.getTime() + VERIFY_TOKEN_MS);
    await tx.$executeRaw`UPDATE email_verification_tokens SET status = 'expired', updated_at = ${now}::timestamptz WHERE user_id = ${userId}::uuid AND status = 'issued'`;
    await tx.$executeRaw`
      INSERT INTO email_verification_tokens (user_id, token_hash, status, expires_at, created_at, updated_at)
      VALUES (${userId}::uuid, ${hashToken(token)}, 'issued', ${expires}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)`;
    this.events.publishAfterCommit({ type: 'EmailVerificationRequested', aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, token_ref: token, expires_at: expires.toISOString() } });
    return expires;
  }

  // --- Xác minh email (VER)
  async verifyEmail(token: string): Promise<void> {
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<{ user_id: string }[]>`
        UPDATE email_verification_tokens SET status = 'used', used_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE token_hash = ${hashToken(token)} AND status = 'issued' AND expires_at > ${now}::timestamptz RETURNING user_id`;
      if (!rows.length) throw invalidToken();
      const userId = rows[0].user_id;
      await tx.$executeRaw`UPDATE email_verification_tokens SET status = 'expired', updated_at = ${now}::timestamptz WHERE user_id = ${userId}::uuid AND status = 'issued'`;
      await tx.$executeRaw`UPDATE users SET email_verified_at = ${now}::timestamptz, updated_at = ${now}::timestamptz WHERE id = ${userId}::uuid AND email_verified_at IS NULL`;
      await this.events.publish(tx, { type: 'EmailVerified', aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, verified_at: now.toISOString() } });
    });
  }

  // --- Gửi lại email xác minh (RESEND)
  async resendVerification(userId: string): Promise<{ resend_available_at: string }> {
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      const users = await tx.$queryRaw<{ email_verified_at: Date | null }[]>`SELECT email_verified_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!users.length) throw new DomainError('unauthenticated');
      if (users[0].email_verified_at) throw new DomainError('already_verified');
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      const [stat] = await tx.$queryRaw<{ last: Date | null; n: bigint; oldest: Date | null }[]>`
        SELECT max(created_at) AS last, count(*) AS n, min(created_at) AS oldest FROM email_verification_tokens WHERE user_id = ${userId}::uuid AND created_at > ${hourAgo}::timestamptz`;
      if (stat.last && now.getTime() - stat.last.getTime() < RESEND_COOLDOWN_MS) {
        throw new DomainError('rate-limited', { headers: retryAfter(stat.last.getTime() + RESEND_COOLDOWN_MS - now.getTime()) });
      }
      if (Number(stat.n) >= RESEND_PER_HOUR && stat.oldest) {
        throw new DomainError('rate-limited', { headers: retryAfter(stat.oldest.getTime() + HOUR_MS - now.getTime()) });
      }
      await this.issueVerification(tx, userId, now);
      return { resend_available_at: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString() };
    });
  }

  // --- Đăng nhập (LOGIN)
  async login(input: { email: string; password: string }, ctx: { ip: string; cookieToken: string | null }): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const rows = await this.prisma.$queryRaw<LoginRow[]>`
      SELECT id, email::text AS email, full_name, role, status, password_hash, email_verified_at, locked_until, locked_reason
      FROM users WHERE email = ${email}::citext`;
    const user = rows[0];
    const ok = await verifyPassword(input.password, user?.password_hash ?? (await this.dummyHash()));
    if (!user || !ok) {
      if (user) await this.recordFailure(user.id);
      else this.log.warn('đăng nhập sai: email không có tài khoản'); // không ghi email (REQ-738 BR7)
      throw invalidCredentials();
    }
    const rehash = needsRehash(user.password_hash, this.argon) ? await hashPassword(input.password, this.argon) : null;
    const now = this.clock.now();
    const token = await this.transactions.run(async (tx) => {
      const [u] = await tx.$queryRaw<{ status: string; locked_reason: string | null; locked_until: Date | null }[]>`SELECT status, locked_reason, locked_until FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      if (u.status === 'locked') {
        // khóa tạm hết hạn thì tự mở (kiểm khi đăng nhập); khóa admin hoặc chưa hết hạn: 401 chung
        if (u.locked_reason !== 'too_many_attempts' || !u.locked_until || u.locked_until > now) throw invalidCredentials();
        await tx.$executeRaw`UPDATE users SET status = 'active', locked_until = NULL, locked_reason = NULL, updated_at = ${now}::timestamptz WHERE id = ${user.id}::uuid AND status = 'locked'`;
      }
      await tx.$executeRaw`UPDATE users SET failed_login_count = 0, last_failed_login_at = NULL, updated_at = ${now}::timestamptz WHERE id = ${user.id}::uuid`;
      if (rehash) await tx.$executeRaw`UPDATE users SET password_hash = ${rehash} WHERE id = ${user.id}::uuid`; // SB-01: băm lại khi tham số đổi
      // chống session fixation: phiên cũ của request (nếu có) bị thu hồi `replaced`, phiên mới luôn là token mới (SB-04)
      if (ctx.cookieToken) {
        const old = await tx.$queryRaw<{ id: string; user_id: string }[]>`
          UPDATE sessions SET status = 'revoked', revoked_at = ${now}::timestamptz, revoked_reason = 'replaced', updated_at = ${now}::timestamptz
          WHERE token_hash = ${hashToken(ctx.cookieToken)} AND status = 'active' RETURNING id, user_id`;
        for (const o of old) await emitSessionRevoked(this.events, tx, o.user_id, [o.id], 'replaced');
      }
      const session = await createSession(tx, user.id, now);
      // tối đa N phiên còn hiệu lực: phiên cũ nhất bị thay (REQ-808 BR9); dòng users đã khóa nên hai đăng nhập đồng thời không vượt
      const over = await tx.$queryRaw<{ id: string }[]>`
        UPDATE sessions SET status = 'revoked', revoked_at = ${now}::timestamptz, revoked_reason = 'replaced', updated_at = ${now}::timestamptz
        WHERE id IN (SELECT id FROM sessions WHERE user_id = ${user.id}::uuid AND status = 'active' AND expires_at > ${now}::timestamptz AND absolute_expires_at > ${now}::timestamptz
                     ORDER BY created_at DESC, id DESC OFFSET ${this.maxSessions})
        RETURNING id`;
      await emitSessionRevoked(this.events, tx, user.id, over.map((o) => o.id), 'replaced');
      await this.audit.record(tx, { actor_id: user.id, actor_role: user.role, action: 'auth.login', target_type: 'user', target_id: user.id, after: { result: 'success', ip: ctx.ip } });
      return session.token;
    });
    return { token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, email_verified: user.email_verified_at !== null } };
  }

  /** Bộ đếm sai nguyên tử (SB-02); đạt ngưỡng thì khóa tạm đúng một lần (chỉ UPDATE đổi được hàng mới ghi event và audit). */
  private async recordFailure(userId: string): Promise<void> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
    const until = new Date(now.getTime() + LOGIN_LOCK_MS);
    await this.transactions.run(async (tx) => {
      const [{ failed_login_count: n }] = await tx.$queryRaw<{ failed_login_count: number }[]>`
        UPDATE users SET failed_login_count = CASE WHEN last_failed_login_at IS NULL OR last_failed_login_at < ${windowStart}::timestamptz THEN 1 ELSE failed_login_count + 1 END,
                         last_failed_login_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${userId}::uuid RETURNING failed_login_count`;
      if (n < LOGIN_LOCK_THRESHOLD) return;
      const locked = await tx.$queryRaw<{ id: string }[]>`
        UPDATE users SET status = 'locked', locked_reason = 'too_many_attempts', locked_until = ${until}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${userId}::uuid AND status = 'active' RETURNING id`;
      if (!locked.length) return;
      await this.events.publish(tx, { type: 'UserLocked', aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, reason: 'too_many_attempts' } });
      await this.audit.record(tx, { actor_id: null, actor_role: 'system', action: 'user.lock_temporary', target_type: 'user', target_id: userId, after: { status: 'locked', reason: 'too_many_attempts' } });
    });
  }

  // --- Đăng xuất (LOGOUT)
  async logout(sessionId: string): Promise<void> {
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; user_id: string }[]>`
        UPDATE sessions SET status = 'revoked', revoked_at = ${now}::timestamptz, revoked_reason = 'logout', updated_at = ${now}::timestamptz
        WHERE id = ${sessionId}::uuid AND status = 'active' RETURNING id, user_id`;
      if (!rows.length) throw new DomainError('unauthenticated'); // hai lần đăng xuất đồng thời: lần sau là 401
      await emitSessionRevoked(this.events, tx, rows[0].user_id, [rows[0].id], 'logout');
    });
  }

  // --- Quên mật khẩu (FORGOT): luôn 202; việc tạo token làm sau khi trả lời
  forgotPassword(emailInput: string): void {
    this.afterReply(async () => {
      const now = this.clock.now();
      const rows = await this.prisma.$queryRaw<{ id: string; status: string; locked_reason: string | null; locked_until: Date | null }[]>`
        SELECT id, status, locked_reason, locked_until FROM users WHERE email = ${normalizeEmail(emailInput)}::citext`;
      const u = rows[0];
      if (!u) return;
      const eligible = u.status === 'active' || (u.locked_reason === 'too_many_attempts' && u.locked_until !== null && u.locked_until <= now);
      if (!eligible) return;
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      await this.transactions.run(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${u.id}::uuid FOR UPDATE`;
        const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM password_reset_tokens WHERE user_id = ${u.id}::uuid AND created_at > ${hourAgo}::timestamptz`;
        if (Number(n) >= FORGOT_PER_EMAIL_HOUR) return; // từ yêu cầu thứ 6 trong giờ: vẫn 202, không token, không email
        const token = newToken();
        const expires = new Date(now.getTime() + RESET_TOKEN_MS);
        await tx.$executeRaw`UPDATE password_reset_tokens SET status = 'expired', updated_at = ${now}::timestamptz WHERE user_id = ${u.id}::uuid AND status = 'issued'`;
        await tx.$executeRaw`
          INSERT INTO password_reset_tokens (user_id, token_hash, status, expires_at, created_at, updated_at)
          VALUES (${u.id}::uuid, ${hashToken(token)}, 'issued', ${expires}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)`;
        this.events.publishAfterCommit({ type: 'PasswordResetRequested', aggregate_type: 'user', aggregate_id: u.id, payload: { user_id: u.id, token_ref: token, expires_at: expires.toISOString() } });
      });
    });
  }

  // --- Đặt lại mật khẩu (RESET)
  async resetPassword(input: { token: string; new_password: string }, ctx: { ip: string }): Promise<void> {
    const now = this.clock.now();
    const tokenHash = hashToken(input.token);
    const [t] = await this.prisma.$queryRaw<{ user_id: string; email: string; role: 'customer' | 'staff' | 'admin'; status: string; locked_reason: string | null }[]>`
      SELECT t.user_id, u.email::text AS email, u.role, u.status, u.locked_reason FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ${tokenHash} AND t.status = 'issued' AND t.expires_at > ${now}::timestamptz`;
    if (!t || (t.status === 'locked' && t.locked_reason === 'admin')) throw invalidToken();
    // chính sách kiểm TRƯỚC khi tiêu thụ token: người dùng sửa và gửi lại được trong hạn (REQ-881 BR3)
    if (sameAsEmail(t.email, input.new_password)) throw new DomainError('validation-failed', { errors: [{ field: 'new_password', code: 'same_as_email' }] });
    const hash = await hashPassword(input.new_password, this.argon);
    await this.transactions.run(async (tx) => {
      const [u] = await tx.$queryRaw<{ status: string; locked_reason: string | null }[]>`SELECT status, locked_reason FROM users WHERE id = ${t.user_id}::uuid FOR UPDATE`;
      if (u.status === 'locked' && u.locked_reason === 'admin') throw invalidToken(); // đảo giao dịch, không tiêu thụ
      const used = await tx.$queryRaw<{ id: string }[]>`
        UPDATE password_reset_tokens SET status = 'used', used_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE token_hash = ${tokenHash} AND status = 'issued' AND expires_at > ${now}::timestamptz RETURNING id`;
      if (!used.length) throw invalidToken();
      await tx.$executeRaw`UPDATE password_reset_tokens SET status = 'expired', updated_at = ${now}::timestamptz WHERE user_id = ${t.user_id}::uuid AND status = 'issued'`;
      // chỉ đặt bộ đếm sai về 0; KHÔNG đổi status, locked_until, locked_reason (khóa tạm tự hết theo thời gian)
      await tx.$executeRaw`UPDATE users SET password_hash = ${hash}, failed_login_count = 0, last_failed_login_at = NULL, updated_at = ${now}::timestamptz WHERE id = ${t.user_id}::uuid`;
      await revokeAllSessions(this.events, tx, t.user_id, 'password_changed', now);
      await this.audit.record(tx, { actor_id: t.user_id, actor_role: t.role, action: 'auth.password_reset', target_type: 'user', target_id: t.user_id, after: { ip: ctx.ip } });
      await this.events.publish(tx, { type: 'PasswordChanged', aggregate_type: 'user', aggregate_id: t.user_id, payload: { user_id: t.user_id, changed_at: now.toISOString() } });
    });
  }
}
