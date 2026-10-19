import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, Clock, DomainError, EventsService, PrismaService, TransactionService, toPage, type PaginationQuery, type SessionContext, type Tx } from '../platform';
import { revokeAllSessions } from './session.store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Role = 'customer' | 'staff' | 'sale' | 'admin';
export interface ListQuery extends PaginationQuery { role?: Role; status?: 'active' | 'locked'; q?: string }

/** `id` sai định dạng xử lý như không tồn tại: cùng 404 cùng nội dung (REQ-956 BR10). */
const assertId = (id: string): void => { if (!UUID.test(id)) throw new DomainError('not-found'); };

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(q: ListQuery) {
    const where = [
      q.role ? Prisma.sql`role = ${q.role}::user_role` : Prisma.empty,
      q.status ? Prisma.sql`status = ${q.status}::user_status` : Prisma.empty,
      // tiền tố không phân biệt hoa thường, tham số hóa; `%`, `_`, `\` trong q được escape (SB-11)
      q.q ? Prisma.sql`lower(email::text) LIKE ${`${q.q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'` : Prisma.empty,
    ].filter((c) => c !== Prisma.empty);
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const [items, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; email: string; full_name: string; role: Role; status: string; email_verified: boolean; created_at: Date }[]>`
        SELECT id, email::text AS email, full_name, role, status, (email_verified_at IS NOT NULL) AS email_verified, created_at
        FROM users ${cond} ORDER BY created_at DESC, id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM users ${cond}`,
    ]);
    return toPage(items, Number(n), q);
  }

  /** Khóa mọi admin `active` theo thứ tự id rồi mới đụng dòng đích (SB-29): hai admin hạ nhau cùng lúc chỉ một thành công. */
  private async lockAdmins(tx: Tx, actor: SessionContext): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE`;
    const [a] = await tx.$queryRaw<{ role: string; status: string }[]>`SELECT role, status FROM users WHERE id = ${actor.user_id}::uuid`;
    if (!a || a.role !== 'admin' || a.status !== 'active') throw new DomainError('forbidden'); // người gọi vừa bị hạ quyền trong lúc chờ khóa
  }
  private async assertAdminRemains(tx: Tx): Promise<void> {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`;
    if (Number(n) < 1) throw new DomainError('last_admin');
  }

  async changeRole(actor: SessionContext, id: string, role: Role): Promise<{ id: string; role: Role }> {
    if (id === actor.user_id) throw new DomainError('cannot_change_own_role');
    assertId(id);
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      await this.lockAdmins(tx, actor);
      const [t] = await tx.$queryRaw<{ role: Role }[]>`SELECT role FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      if (!t) throw new DomainError('not-found');
      if (t.role === role) throw new DomainError('role_unchanged');
      const upd = await tx.$queryRaw<{ id: string }[]>`UPDATE users SET role = ${role}::user_role, updated_at = ${now}::timestamptz WHERE id = ${id}::uuid AND role = ${t.role}::user_role RETURNING id`;
      if (!upd.length) throw new DomainError('conflict');
      await this.assertAdminRemains(tx);
      await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'user.change_role', target_type: 'user', target_id: id, before: { role: t.role }, after: { role } });
      return { id, role };
    });
  }

  async lock(actor: SessionContext, id: string, reason?: string): Promise<{ id: string; status: 'locked' }> {
    if (id === actor.user_id) throw new DomainError('cannot_lock_self');
    assertId(id);
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      await this.lockAdmins(tx, actor);
      const [t] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      if (!t) throw new DomainError('not-found');
      if (t.status === 'locked') throw new DomainError('already_locked');
      await tx.$executeRaw`UPDATE users SET status = 'locked', locked_reason = 'admin', locked_until = NULL, updated_at = ${now}::timestamptz WHERE id = ${id}::uuid AND status = 'active'`;
      await this.assertAdminRemains(tx);
      await revokeAllSessions(this.events, tx, id, 'admin_lock', now); // thu hồi mọi phiên cùng giao dịch (SB-04)
      await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'user.lock', target_type: 'user', target_id: id, before: { status: t.status }, after: { status: 'locked' }, reason });
      await this.events.publish(tx, { type: 'UserLocked', aggregate_type: 'user', aggregate_id: id, payload: { user_id: id, reason: 'admin' } });
      return { id, status: 'locked' };
    });
  }

  async unlock(actor: SessionContext, id: string): Promise<{ id: string; status: 'active' }> {
    assertId(id);
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      const [t] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      if (!t) throw new DomainError('not-found');
      if (t.status !== 'locked') throw new DomainError('not_locked');
      await tx.$executeRaw`
        UPDATE users SET status = 'active', locked_until = NULL, locked_reason = NULL, failed_login_count = 0, last_failed_login_at = NULL, updated_at = ${now}::timestamptz
        WHERE id = ${id}::uuid AND status = 'locked'`;
      await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'user.unlock', target_type: 'user', target_id: id, before: { status: 'locked' }, after: { status: 'active' } });
      return { id, status: 'active' };
    });
  }
}
