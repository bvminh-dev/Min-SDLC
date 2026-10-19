import { Injectable } from '@nestjs/common';
import { AuditService, DomainError, PrismaService, TransactionService, type SessionContext } from '../platform';
import { SOURCE_LIMIT } from './config';
import type { SourceCreateBody, SourcePatchBody } from './policy';
import { UUID_RE } from './row';

export interface SourceView { id: string; code: string; name: string; is_active: boolean }
export interface AdminSourceView extends SourceView { is_system: boolean; position: number }
const pgCode = (e: unknown): string => { const x = e as { meta?: { code?: unknown }; code?: unknown }; return String(x?.meta?.code ?? x?.code ?? ''); };
const forbidden = (field: string) => new DomainError('validation-failed', { errors: [{ field, code: 'unknown_field' }] });

/**
 * Danh mục nguồn đơn (ORD-REQ-20261015-092748678): đọc cho staff, sale, admin; thêm, sửa, tắt, bật chỉ admin, mỗi lần một audit cùng giao dịch (SB-19, SB-45). V1 chỉ tắt, không xóa (trigger ở CSDL chặn xóa và đổi `code`, `is_system`).
 * Trần 50 nguồn kiểm dưới khóa tư vấn để hai yêu cầu song song không cùng vượt trần; dòng nguồn khóa `FOR UPDATE` khi sửa (xếp thứ tự với `createHo` giữ `FOR SHARE`).
 */
@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly audit: AuditService) {}

  /** Danh mục theo `position` rồi `name`; mặc định chỉ nguồn đang bật. Dùng cho `GET /order-sources` và `OrderApi.listSources` (không `tx`). */
  listSources(o: { include_inactive?: boolean } = {}): Promise<SourceView[]> {
    return this.prisma.$queryRaw<SourceView[]>`SELECT id, code, name, is_active FROM order_sources WHERE is_active OR ${o.include_inactive === true} ORDER BY position, name, id`;
  }

  /** `GET /order-sources`: sale gửi `include_inactive` thì 400 (chỉ staff và admin lọc theo nguồn đã tắt). */
  async listFor(s: SessionContext, include: boolean | undefined) {
    if (include !== undefined && s.role === 'sale') throw forbidden('include_inactive');
    return { items: await this.listSources({ include_inactive: include === true }) };
  }

  async listAdmin() {
    return { items: await this.prisma.$queryRaw<AdminSourceView[]>`SELECT id, code, name, is_active, is_system, position FROM order_sources ORDER BY position, name, id` };
  }

  create(s: SessionContext, b: SourceCreateBody): Promise<AdminSourceView> {
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('order_sources'))`; // một lượt thêm mỗi lần: kiểm trần và trùng mã không bị đua
      if ((await tx.$queryRaw<{ x: number }[]>`SELECT 1 AS x FROM order_sources WHERE code = ${b.code}`).length) throw new DomainError('order-source-code-taken');
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM order_sources`;
      if (n >= SOURCE_LIMIT) throw new DomainError('order-source-limit'); // tắt không giảm số nguồn
      let row: AdminSourceView;
      try {
        [row] = await tx.$queryRaw<AdminSourceView[]>`
          INSERT INTO order_sources (code, name, position) VALUES (${b.code}, ${b.name}, ${b.position ?? 0})
          RETURNING id, code, name, is_active, is_system, position`;
      } catch (e) { if (pgCode(e) === '23505') throw new DomainError('order-source-code-taken'); throw e; }
      await this.audit.record(tx, { actor_id: s.user_id, actor_role: 'admin', action: 'order_source.created', target_type: 'order_source', target_id: row.id, after: { code: row.code, name: row.name, position: row.position, is_active: row.is_active } });
      return row;
    });
  }

  update(s: SessionContext, id: string, b: SourcePatchBody): Promise<AdminSourceView> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    return this.transactions.run(async (tx) => {
      const [cur] = await tx.$queryRaw<AdminSourceView[]>`SELECT id, code, name, is_active, is_system, position FROM order_sources WHERE id = ${id}::uuid FOR UPDATE`;
      if (!cur) throw new DomainError('not-found');
      if (b.is_active === false && cur.is_system) throw new DomainError('order-source-protected');
      const next = { name: b.name ?? cur.name, position: b.position ?? cur.position, is_active: b.is_active ?? cur.is_active };
      const changed = (['name', 'position', 'is_active'] as const).filter((k) => next[k] !== cur[k]);
      if (!changed.length) return cur;
      const [row] = await tx.$queryRaw<AdminSourceView[]>`
        UPDATE order_sources SET name = ${next.name}, position = ${next.position}, is_active = ${next.is_active}, updated_at = now() WHERE id = ${id}::uuid
        RETURNING id, code, name, is_active, is_system, position`;
      await this.audit.record(tx, {
        actor_id: s.user_id, actor_role: 'admin', action: 'order_source.updated', target_type: 'order_source', target_id: id,
        before: Object.fromEntries(changed.map((k) => [k, cur[k]])), after: Object.fromEntries(changed.map((k) => [k, next[k]])),
      });
      return row;
    });
  }
}
