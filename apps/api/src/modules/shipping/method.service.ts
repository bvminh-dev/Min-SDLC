import { Injectable } from '@nestjs/common';
import { AppLogger, AuditService, Clock, DomainError, PrismaService, TransactionService, paginate, toPage, type SessionContext, type Tx } from '../platform';
import { MAX_METHODS } from './config';
import { METHOD_COLS, UUID_RE, isUnique, type MethodRow } from './db';
import { computeFee, readRule, type StoredRule } from './fee';
import type { AdminListQuery, CreateMethodBody, PatchMethodBody, QuoteBody } from './policy';

const actorOf = (s: SessionContext) => ({ actor_id: s.user_id, actor_role: s.role });
const toMethod = (r: MethodRow) => ({
  id: r.id, name: r.name, base_fee: Number(r.base_fee), rule: r.rule, is_active: r.is_active, version: r.version, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
});
const snapshot = (r: MethodRow) => ({ name: r.name, base_fee: Number(r.base_fee), rule: r.rule, is_active: r.is_active, version: r.version });

export interface ActiveMethod { id: string; name: string; base_fee: number; free_over: number | null }
export type QuoteInput = { method_id: string; city: string; subtotal: number };
export type QuoteResult = { fee: number; free_shipping: boolean };

/**
 * Phương thức vận chuyển (SHP-REQ ...755, ...782, ...806; SHP-DB mục Giao dịch và khóa 6): admin tạo, sửa, bật, tắt (khóa lạc quan `version`, khóa advisory khi tạo để trần 20 không bị vượt),
 * customer xem phương thức đang bật, báo phí. `listActive` và `quoteFor` cũng là phần của giao diện nội bộ `ShippingApi` (CRT, CHK). Mọi ghi là MỘT giao dịch có audit (SB-07, SB-19).
 */
@Injectable()
export class MethodService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly clock: Clock, logger: AppLogger) {
    this.log = logger.for('shipping');
  }

  /** Khóa dòng phương thức; id sai định dạng hay không có là cùng 404. */
  private async lock(tx: Tx, id: string): Promise<MethodRow> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [m] = await tx.$queryRaw<MethodRow[]>`SELECT ${METHOD_COLS} FROM shipping_methods WHERE id = ${id.toLowerCase()}::uuid FOR UPDATE`;
    if (!m) throw new DomainError('not-found');
    return m;
  }

  async create(s: SessionContext, b: CreateMethodBody) {
    try {
      return await this.transactions.run(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shipping_methods_create'))`; // hai admin tạo song song không vượt trần
        const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM shipping_methods`;
        if (n >= MAX_METHODS) throw new DomainError('too-many-methods');
        const now = this.clock.now();
        const [r] = await tx.$queryRaw<MethodRow[]>`
          INSERT INTO shipping_methods (name, base_fee, rule, created_at, updated_at)
          VALUES (${b.name}, ${b.base_fee}, ${JSON.stringify(b.rule)}::jsonb, ${now}::timestamptz, ${now}::timestamptz) RETURNING ${METHOD_COLS}`;
        await this.audit.record(tx, { ...actorOf(s), action: 'shipping.method.create', target_type: 'shipping_method', target_id: r.id, before: null, after: snapshot(r) });
        return toMethod(r);
      });
    } catch (e) {
      if (isUnique(e, /shipping_methods_name_key|btrim\(name/)) throw new DomainError('shipping-method-name-taken'); // unique(lower(btrim(name))) ở CSDL phân xử hai admin cùng tên
      throw e;
    }
  }

  async update(s: SessionContext, id: string, b: PatchMethodBody) {
    try {
      return await this.transactions.run(async (tx) => {
        const m = await this.lock(tx, id);
        const [r] = await tx.$queryRaw<MethodRow[]>`
          UPDATE shipping_methods SET name = ${b.name ?? m.name}, base_fee = ${b.base_fee ?? Number(m.base_fee)}, rule = ${JSON.stringify(b.rule ?? m.rule)}::jsonb,
                 version = version + 1, updated_at = ${this.clock.now()}::timestamptz
          WHERE id = ${m.id}::uuid AND version = ${b.version} RETURNING ${METHOD_COLS}`;
        if (!r) throw new DomainError('version-conflict'); // khóa lạc quan: `version` của client khác `version` hiện tại (đã khóa dòng)
        await this.audit.record(tx, { ...actorOf(s), action: 'shipping.method.update', target_type: 'shipping_method', target_id: r.id, before: snapshot(m), after: snapshot(r) });
        return toMethod(r);
      });
    } catch (e) {
      if (isUnique(e, /shipping_methods_name_key|btrim\(name/)) throw new DomainError('shipping-method-name-taken');
      throw e;
    }
  }

  /** Bật hoặc tắt: trạng thái đã đúng thì 409 `method-state-unchanged` TRƯỚC khi kiểm `version`. Không có hộp xác nhận hay event; đơn và vận đơn cũ không đổi. */
  setActive(s: SessionContext, id: string, active: boolean, versionIn: number) {
    return this.transactions.run(async (tx) => {
      const m = await this.lock(tx, id);
      if (m.is_active === active) throw new DomainError('method-state-unchanged'); // trạng thái được kiểm trước `version`
      const [r] = await tx.$queryRaw<MethodRow[]>`
        UPDATE shipping_methods SET is_active = ${active}, version = version + 1, updated_at = ${this.clock.now()}::timestamptz
        WHERE id = ${m.id}::uuid AND version = ${versionIn} AND is_active = ${!active} RETURNING ${METHOD_COLS}`;
      if (!r) throw new DomainError('version-conflict');
      await this.audit.record(tx, { ...actorOf(s), action: active ? 'shipping.method.enable' : 'shipping.method.disable', target_type: 'shipping_method', target_id: r.id, before: snapshot(m), after: snapshot(r) });
      return toMethod(r);
    });
  }

  /** Admin: mọi phương thức kể cả đã tắt, mới nhất trước (index (created_at DESC, id DESC)). */
  async listAll(q: AdminListQuery) {
    const { skip, take } = paginate(q);
    const [rows, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<MethodRow[]>`SELECT ${METHOD_COLS} FROM shipping_methods ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM shipping_methods`,
    ]);
    return toPage(rows.map(toMethod), n, q);
  }

  /** Phương thức đang bật, `base_fee` tăng dần rồi tên không phân biệt hoa thường; chỉ bốn khóa `id`, `name`, `base_fee`, `free_over` (không `rule` đầy đủ, `is_active`, `version`). */
  async listActive(): Promise<ActiveMethod[]> {
    const rows = await this.prisma.$queryRaw<MethodRow[]>`SELECT ${METHOD_COLS} FROM shipping_methods WHERE is_active ORDER BY base_fee, lower(name), id`;
    return rows.map((r) => ({ id: r.id, name: r.name, base_fee: Number(r.base_fee), free_over: this.rule(r).free_over }));
  }

  /** `rule` đọc lại qua schema trước khi dùng: dữ liệu hỏng thì ném lỗi nội bộ, không tính phí sai (T6). */
  private rule(r: MethodRow): StoredRule {
    try { return readRule(r.rule); } catch { this.log.error('rule của phương thức vận chuyển sai cấu trúc', { code: 'shipping-method-rule-invalid', method_id: r.id }); throw new DomainError('internal-error'); }
  }

  /** Lõi báo phí dùng chung cho HTTP và giao diện nội bộ: `missing` (không có) và `inactive` (đã tắt) để bên gọi chọn mã lỗi. Chỉ đọc, không ghi, không nhớ giá trị của client. */
  async quoteCore(q: QuoteInput): Promise<{ ok: true; result: QuoteResult } | { ok: false; reason: 'missing' | 'inactive' }> {
    if (typeof q.method_id !== 'string' || !UUID_RE.test(q.method_id)) return { ok: false, reason: 'missing' };
    const [m] = await this.prisma.$queryRaw<MethodRow[]>`SELECT ${METHOD_COLS} FROM shipping_methods WHERE id = ${q.method_id.toLowerCase()}::uuid`;
    if (!m) return { ok: false, reason: 'missing' };
    if (!m.is_active) return { ok: false, reason: 'inactive' };
    return { ok: true, result: computeFee(Number(m.base_fee), this.rule(m), q.city, q.subtotal) };
  }

  /** HTTP: không có phương thức 404, đã tắt 409 `method-unavailable`. */
  async quote(b: QuoteBody): Promise<{ method_id: string; fee: number; free_shipping: boolean }> {
    const r = await this.quoteCore(b);
    if (!r.ok) throw new DomainError(r.reason === 'missing' ? 'not-found' : 'method-unavailable');
    return { method_id: b.method_id.toLowerCase(), ...r.result };
  }
}
