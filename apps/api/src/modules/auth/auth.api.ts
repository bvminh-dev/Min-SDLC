import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService, Clock, ConfigService, DomainError, EventsService, PrismaService, RateLimitService, TransactionService,
} from '../platform';
import { HOUR_MS } from './config';
import { hashPassword, verifyPassword, type ArgonParams } from './crypto';
import { fullNameField, normalizeEmail, passwordField, sameAsEmail } from './policy';
import { createSession, emitSessionRevoked } from './session.store';

type Role = 'customer' | 'staff' | 'admin';
const ROLES: readonly Role[] = ['customer', 'staff', 'admin'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const MAX_LIST = 200;
const PWCHANGE_WRONG_LIMIT = 5; // SB-14 bậc A: 5 lần sai mỗi 15 phút ...
const PWCHANGE_WRONG_WINDOW_S = 15 * 60;
const PWCHANGE_CALL_LIMIT = 10; // ... và 10 lần gọi mỗi giờ (mọi kết quả)
const PWCHANGE_CALL_WINDOW_S = HOUR_MS / 1000;

/** Người dùng như module USR thấy: không bao giờ có `password_hash`, token hay bộ đếm khóa (SB-01, SB-18). */
export interface UserView {
  id: string; email: string; full_name: string; phone: string | null; avatar_url: string | null;
  role: Role; status: 'active' | 'locked'; email_verified: boolean; created_at: Date;
}
export interface UserContact { user_id: string; role: Role; status: 'active' | 'locked'; email: string; email_verified: boolean; full_name: string }
export interface DisplayName { user_id: string; display_name: string; avatar_url: string | null }
export interface ProfilePatch { full_name?: string; phone?: string | null; avatar_url?: string | null }
export interface ChangePasswordResult { revoked_others: number; new_session: { id: string; token: string } }

type ViewRow = UserView;

/**
 * Giao diện đồng bộ của AUTH cho module khác (architecture.md, bảng Giao diện module; AUTH-API, mục Giao tiếp giữa module): USR, NTF, REV.
 * Gọi trong tiến trình, không nhận `tx` (mỗi hàm tự mở giao dịch của AUTH khi cần). AUTH là bên duy nhất đọc và ghi bảng `users` (SB-35).
 */
@Injectable()
export class AuthApi {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimitService,
    private readonly clock: Clock,
    private readonly config: ConfigService,
  ) {}

  private get argon(): ArgonParams {
    return { memory: this.config.get<number>('ARGON2_MEMORY_KIB'), passes: this.config.get<number>('ARGON2_TIME_COST'), parallelism: this.config.get<number>('ARGON2_PARALLELISM') };
  }

  // --- NTF
  /** Người nhận thông báo: `null` nếu không tồn tại. NTF chỉ gửi email giao dịch tới địa chỉ đã xác minh (SB-26). */
  async getUserContact(userId: string): Promise<UserContact | null> {
    if (!isUuid(userId)) return null;
    const rows = await this.prisma.$queryRaw<{ id: string; role: Role; status: 'active' | 'locked'; email: string; email_verified: boolean; full_name: string }[]>`
      SELECT id, role, status, email::text AS email, (email_verified_at IS NOT NULL) AS email_verified, full_name FROM users WHERE id = ${userId}::uuid`;
    const r = rows[0];
    return r ? { user_id: r.id, role: r.role, status: r.status, email: r.email, email_verified: r.email_verified, full_name: r.full_name } : null;
  }

  /** Id người dùng `active` có role trong `roles`, sắp `id` tăng dần, tối đa `limit` (trần 200). */
  async listActiveUserIdsByRole(roles: readonly Role[], limit: number = MAX_LIST): Promise<string[]> {
    const wanted = [...new Set(roles.filter((r) => ROLES.includes(r)))];
    if (!wanted.length) return [];
    const take = Math.min(Math.max(1, Math.trunc(limit) || MAX_LIST), MAX_LIST);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE status = 'active' AND role::text = ANY(${wanted}::text[]) ORDER BY id LIMIT ${take}`;
    return rows.map((r) => r.id);
  }

  // --- REV
  /** Tên hiển thị và ảnh đại diện theo lô; id không tồn tại hoặc sai định dạng thì không có dòng. */
  async getDisplayNames(userIds: readonly string[]): Promise<DisplayName[]> {
    const ids = [...new Set(userIds.filter(isUuid))];
    if (!ids.length) return [];
    return this.prisma.$queryRaw<DisplayName[]>`
      SELECT id AS user_id, full_name AS display_name, avatar_url FROM users WHERE id = ANY(${ids}::uuid[]) ORDER BY id`;
  }

  // --- USR (đọc, ghi hồ sơ)
  async getUser(userId: string): Promise<UserView | null> {
    return isUuid(userId) ? this.one(Prisma.sql`id = ${userId}::uuid`) : null;
  }
  async findCustomerById(id: string): Promise<UserView | null> {
    return isUuid(id) ? this.one(Prisma.sql`id = ${id}::uuid AND role = 'customer'`) : null;
  }
  async findCustomerByEmail(email: string): Promise<UserView | null> {
    return typeof email === 'string' ? this.one(Prisma.sql`email = ${normalizeEmail(email)}::citext AND role = 'customer'`) : null;
  }
  private async one(cond: Prisma.Sql): Promise<UserView | null> {
    const rows = await this.prisma.$queryRaw<ViewRow[]>`
      SELECT id, email::text AS email, full_name, phone, avatar_url, role, status, (email_verified_at IS NOT NULL) AS email_verified, created_at
      FROM users WHERE ${cond}`;
    return rows[0] ?? null;
  }

  /** Chỉ ghi ba cột `full_name`, `phone`, `avatar_url` (khóa khác bị bỏ qua, SB-05). `undefined` giữ nguyên; `null` xóa `phone`, `avatar_url`. */
  async updateProfile(userId: string, patch: ProfilePatch): Promise<UserView> {
    if (!isUuid(userId)) throw new DomainError('not-found');
    const hasName = patch.full_name !== undefined;
    let name: string | null = null;
    if (hasName) {
      const p = fullNameField.safeParse(patch.full_name);
      if (!p.success) throw new DomainError('validation-failed', { errors: [{ field: 'full_name', code: p.error.issues[0].message }] });
      name = p.data;
    }
    const hasPhone = patch.phone !== undefined;
    const hasAvatar = patch.avatar_url !== undefined;
    const now = this.clock.now();
    const rows = await this.prisma.$queryRaw<ViewRow[]>`
      UPDATE users SET
        full_name = CASE WHEN ${hasName}::boolean THEN ${name}::text ELSE full_name END,
        phone = CASE WHEN ${hasPhone}::boolean THEN ${patch.phone ?? null}::text ELSE phone END,
        avatar_url = CASE WHEN ${hasAvatar}::boolean THEN ${patch.avatar_url ?? null}::text ELSE avatar_url END,
        updated_at = ${now}::timestamptz
      WHERE id = ${userId}::uuid
      RETURNING id, email::text AS email, full_name, phone, avatar_url, role, status, (email_verified_at IS NOT NULL) AS email_verified, created_at`;
    if (!rows.length) throw new DomainError('not-found');
    return rows[0];
  }

  /** Khóa ảnh đang được người dùng nào đó dùng (job quét ảnh mồ côi của USR). */
  async listAvatarUrlsInUse(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ avatar_url: string }[]>`SELECT DISTINCT avatar_url FROM users WHERE avatar_url IS NOT NULL`;
    return rows.map((r) => r.avatar_url);
  }
  /** Số người dùng role `customer` (DSH lấy qua USR). */
  async countCustomers(): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM users WHERE role = 'customer'`;
    return Number(n);
  }

  // --- USR: đổi mật khẩu (SB-03)
  /**
   * Đổi mật khẩu cho người đang đăng nhập, một giao dịch của AUTH: băm mới, thu hồi MỌI phiên `active` (phiên của request `replaced`,
   * các phiên khác `password_changed`), cấp phiên mới, audit, PasswordChanged và SessionRevoked qua outbox.
   * Lỗi: `rate-limited` (429, kèm Retry-After), `invalid_current_password` (400), `validation-failed` (400, `errors` theo trường `new_password`),
   * `unauthenticated` (người dùng không còn hoặc đang bị khóa). Mật khẩu không bao giờ vào log, audit, event.
   */
  async changePassword(userId: string, sessionId: string, current: string, next: string, meta: { ip?: string } = {}): Promise<ChangePasswordResult> {
    if (!isUuid(userId)) throw new DomainError('unauthenticated');
    const wrongKey = `usr:pwchange:${userId}`;
    const callKey = `usr:pwchange:hour:${userId}`;
    // Đếm lần gọi TRƯỚC khi băm: cộng nguyên tử nên chạy song song cũng không vượt 10 lần thử mỗi giờ (ponytail: cửa sổ cố định như ADR-014)
    const calls = await this.limiter.hitCounter(callKey, PWCHANGE_CALL_WINDOW_S);
    const [byWrong, byCalls] = await Promise.all([this.limiter.check(wrongKey, PWCHANGE_WRONG_LIMIT, PWCHANGE_WRONG_WINDOW_S), this.limiter.check(callKey, PWCHANGE_CALL_LIMIT, PWCHANGE_CALL_WINDOW_S)]);
    if (calls > PWCHANGE_CALL_LIMIT || !byWrong.allowed) {
      const wait = Math.max(!byWrong.allowed ? byWrong.retryAfter : 0, calls > PWCHANGE_CALL_LIMIT ? byCalls.retryAfter : 0, 1);
      throw new DomainError('rate-limited', { headers: { 'Retry-After': String(wait) } });
    }

    const [u] = await this.prisma.$queryRaw<{ email: string; role: Role; password_hash: string }[]>`
      SELECT email::text AS email, role, password_hash FROM users WHERE id = ${userId}::uuid AND status = 'active'`;
    if (!u) throw new DomainError('unauthenticated');
    if (typeof current !== 'string' || !(await verifyPassword(current, u.password_hash))) {
      await this.limiter.hitCounter(wrongKey, PWCHANGE_WRONG_WINDOW_S);
      throw new DomainError('invalid_current_password');
    }
    const errors = this.policyErrors(u.email, current, next);
    if (errors.length) throw new DomainError('validation-failed', { errors: errors.map((code) => ({ field: 'new_password', code })) });

    const hash = await hashPassword(next, this.argon);
    const now = this.clock.now();
    const result = await this.transactions.run(async (tx) => {
      // so khớp băm cũ: hai yêu cầu đồng thời với cùng mật khẩu hiện tại chỉ một yêu cầu đổi được
      const upd = await tx.$queryRaw<{ id: string }[]>`
        UPDATE users SET password_hash = ${hash}, updated_at = ${now}::timestamptz
        WHERE id = ${userId}::uuid AND status = 'active' AND password_hash = ${u.password_hash} RETURNING id`;
      if (!upd.length) throw new DomainError('invalid_current_password');
      const sid = isUuid(sessionId) ? sessionId : '00000000-0000-0000-0000-000000000000';
      const revoked = await tx.$queryRaw<{ id: string; revoked_reason: 'replaced' | 'password_changed' }[]>`
        UPDATE sessions SET status = 'revoked', revoked_at = ${now}::timestamptz, updated_at = ${now}::timestamptz,
          revoked_reason = (CASE WHEN id = ${sid}::uuid THEN 'replaced' ELSE 'password_changed' END)::session_revoke_reason
        WHERE user_id = ${userId}::uuid AND status = 'active' RETURNING id, revoked_reason`;
      const others = revoked.filter((r) => r.revoked_reason === 'password_changed').map((r) => r.id);
      await emitSessionRevoked(this.events, tx, userId, others, 'password_changed');
      await emitSessionRevoked(this.events, tx, userId, revoked.filter((r) => r.revoked_reason === 'replaced').map((r) => r.id), 'replaced');
      const session = await createSession(tx, userId, now);
      await this.audit.record(tx, { actor_id: userId, actor_role: u.role, action: 'auth.password_change', target_type: 'user', target_id: userId, after: { revoked_others: others.length, revoked_total: revoked.length, ...(meta.ip ? { ip: meta.ip } : {}) } });
      await this.events.publish(tx, { type: 'PasswordChanged', aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, changed_at: now.toISOString() } });
      return { revoked_others: others.length, new_session: { id: session.id, token: session.token } };
    });
    await this.limiter.reset(wrongKey); // thành công: bộ đếm sai về 0 (bộ đếm 10 lần mỗi giờ giữ nguyên)
    return result;
  }

  /** Chính sách của đăng ký (REQ-620 BR2) cộng `same_as_current` (USR-REQ-20261006-101003591 BR1). */
  private policyErrors(email: string, current: string, next: unknown): string[] {
    const p = passwordField.safeParse(next);
    if (!p.success) return [p.error.issues[0].message]; // một mã mỗi trường, như đăng ký (zodItems)
    const out: string[] = [];
    if (sameAsEmail(email, p.data)) out.push('same_as_email');
    if (p.data === current) out.push('same_as_current');
    return out;
  }
}
