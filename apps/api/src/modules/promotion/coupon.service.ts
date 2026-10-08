import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, Clock, DomainError, PrismaService, TransactionService, paginate, toPage, type SessionContext, type Tx } from '../platform';
import { problem } from './errors';
import { COLS, UUID_RE, isUnique, toCoupon, type CouponRow } from './db';
import { normalizeCode, type CreateBody, type ListQuery, type PatchBody } from './policy';

type Locked = CouponRow & { overdue: boolean };
const actorOf = (s: SessionContext) => ({ actor_id: s.user_id, actor_role: s.role });
const snapshot = (r: CouponRow) => ({
  code: r.code, type: r.type, value: Number(r.value), min_order_value: Number(r.min_order_value), max_discount: r.max_discount === null ? null : Number(r.max_discount),
  expires_at: r.expires_at.toISOString(), usage_limit: r.usage_limit, per_user_limit: r.per_user_limit,
});
const invalid = (field: string, code: string) => new DomainError('validation-failed', { errors: [{ field, code }] });
/** `LIKE` với `\`, `%`, `_` được thoát: tiền tố nhập vào chỉ là chữ thường (PRM-REQ ...299 BR4, SB-11). */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * Quản trị coupon (PRM-API mục Endpoint; PRM-DB mục Giao dịch và khóa 1 đến 3, 9, 11). Mọi ghi là MỘT giao dịch: khóa dòng coupon (`FOR UPDATE`), kiểm trạng thái hiện tại,
 * cập nhật có điều kiện (lưới an toàn thứ hai), audit cùng giao dịch (SB-07, SB-19). Coupon `deleted` và id sai định dạng là cùng một 404 `not-found` (BR4).
 * Người thao tác chỉ lấy từ phiên (SB-05). Không ghi event (tạo, sửa, xóa, bật, tắt không phát event).
 */
@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly clock: Clock) {}

  /** Khóa và đọc dòng coupon chưa xóa; không có, đã xóa mềm hay id sai định dạng là 404. */
  private async lock(tx: Tx, id: string): Promise<Locked> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [c] = await tx.$queryRaw<Locked[]>`SELECT ${COLS}, (expires_at <= now()) AS overdue FROM coupons WHERE id = ${id.toLowerCase()}::uuid AND status <> 'deleted'::coupon_status FOR UPDATE`;
    if (!c) throw new DomainError('not-found');
    return c;
  }

  async create(actor: SessionContext, b: CreateBody) {
    if (b.expires_at.getTime() <= this.clock.now().getTime()) throw invalid('expires_at', 'out_of_range'); // phải SAU giờ máy chủ (BR7): bằng đúng giờ cũng bị từ chối
    try {
      return await this.transactions.run(async (tx) => {
        const [r] = await tx.$queryRaw<CouponRow[]>`
          INSERT INTO coupons (code, type, value, min_order_value, max_discount, expires_at, usage_limit, per_user_limit, created_by)
          VALUES (${b.code}, ${b.type}::coupon_type, ${b.value}, ${b.min_order_value ?? 0}, ${b.max_discount ?? null}, ${b.expires_at}::timestamptz, ${b.usage_limit}, ${b.per_user_limit ?? null}, ${actor.user_id}::uuid)
          RETURNING ${COLS}`;
        await this.audit.record(tx, { ...actorOf(actor), action: 'promotion.coupon.create', target_type: 'coupon', target_id: r.id, after: snapshot(r) });
        return toCoupon(r);
      });
    } catch (e) {
      if (isUnique(e, /code/)) throw problem('code_taken'); // unique(code) ở CSDL phân xử hai admin cùng mã, kể cả mã đã xóa mềm (BR2)
      throw e;
    }
  }

  async list(q: ListQuery) {
    const where = Prisma.sql`status <> 'deleted'::coupon_status${q.status ? Prisma.sql` AND status = ${q.status}::coupon_status` : Prisma.empty}${q.q ? Prisma.sql` AND code LIKE ${`${likeEscape(q.q.toUpperCase())}%`} ${Prisma.raw("ESCAPE '\\'")}` : Prisma.empty}`;
    const { skip, take } = paginate(q);
    const [rows, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<CouponRow[]>`SELECT ${COLS} FROM coupons WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM coupons WHERE ${where}`,
    ]);
    return toPage(rows.map(toCoupon), n, q);
  }

  async detail(id: string) {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [c] = await this.prisma.$queryRaw<CouponRow[]>`SELECT ${COLS} FROM coupons WHERE id = ${id.toLowerCase()}::uuid AND status <> 'deleted'::coupon_status`;
    if (!c) throw new DomainError('not-found');
    return toCoupon(c);
  }

  /**
   * Sửa một phần kèm `version` đang giữ (PRM-REQ ...227; SB-30). Thứ tự: schema (400), 404, `field_immutable` và ràng buộc theo loại (400), `coupon_not_editable` (409),
   * `usage_limit_below_used` (409), rồi `version_mismatch` (câu UPDATE có điều kiện `version` là cổng duy nhất). Không có trường nào đổi thì 200, không tăng `version`, không audit (BR10).
   */
  async update(actor: SessionContext, id: string, b: PatchBody) {
    if (b.expires_at && b.expires_at.getTime() <= this.clock.now().getTime()) throw invalid('expires_at', 'out_of_range');
    return this.transactions.run(async (tx) => {
      const cur = await this.lock(tx, id);
      if (b.type !== undefined && b.type !== cur.type) throw problem('field_immutable', { errors: [{ field: 'type', code: 'field_immutable' }] });
      if (b.code !== undefined && normalizeCode(b.code) !== cur.code) throw problem('field_immutable', { errors: [{ field: 'code', code: 'field_immutable' }] });
      if (b.value !== undefined && cur.type === 'percentage' && b.value > 100) throw invalid('value', 'out_of_range');
      if (b.max_discount != null && cur.type !== 'percentage') throw invalid('max_discount', 'invalid_format'); // chỉ cho percentage (BR4)
      if (cur.status !== 'active' && cur.status !== 'disabled') throw problem('coupon_not_editable');
      if (cur.overdue) throw problem('coupon_not_editable'); // đã quá hạn mà job chưa chuyển `expired` thì coi như hết hạn (BR5)
      const used = cur.consumed_count + cur.reserved_count;
      if (b.usage_limit !== undefined && b.usage_limit < used) throw problem('usage_limit_below_used', { extra: { used } });

      const next = {
        value: b.value ?? Number(cur.value), min_order_value: b.min_order_value ?? Number(cur.min_order_value),
        max_discount: b.max_discount === undefined ? (cur.max_discount === null ? null : Number(cur.max_discount)) : b.max_discount,
        expires_at: b.expires_at ?? cur.expires_at, usage_limit: b.usage_limit ?? cur.usage_limit,
        per_user_limit: b.per_user_limit === undefined ? cur.per_user_limit : b.per_user_limit,
      };
      const before = snapshot(cur), after = snapshot({ ...cur, value: BigInt(next.value), min_order_value: BigInt(next.min_order_value), max_discount: next.max_discount === null ? null : BigInt(next.max_discount), expires_at: next.expires_at, usage_limit: next.usage_limit, per_user_limit: next.per_user_limit });
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => after[k] !== before[k]);
      if (!changed.length) return toCoupon(cur);
      const [r] = await tx.$queryRaw<CouponRow[]>`
        UPDATE coupons SET value = ${next.value}, min_order_value = ${next.min_order_value}, max_discount = ${next.max_discount}, expires_at = ${next.expires_at}::timestamptz,
          usage_limit = ${next.usage_limit}, per_user_limit = ${next.per_user_limit}, version = version + 1, updated_at = now()
        WHERE id = ${cur.id}::uuid AND version = ${b.version} AND status IN ('active'::coupon_status, 'disabled'::coupon_status) AND expires_at > now()
        RETURNING ${COLS}`;
      if (!r) throw problem('version_mismatch', { extra: { current_version: cur.version } }); // cổng khóa lạc quan DUY NHẤT (SB-30): `WHERE version = :đang-giữ` không khớp thì không ghi gì; dòng đang bị khóa nên `cur.version` là bản mới nhất
      await this.audit.record(tx, {
        ...actorOf(actor), action: 'promotion.coupon.update', target_type: 'coupon', target_id: cur.id,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      return toCoupon(r);
    });
  }

  /** Xóa mềm từ mọi trạng thái chưa xóa (PRM-REQ ...252 BR3); không hủy lượt `reserved` (BR6). Xóa lần hai là 404. */
  async remove(actor: SessionContext, id: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const cur = await this.lock(tx, id);
      await tx.$executeRaw`UPDATE coupons SET status = 'deleted'::coupon_status, deleted_at = now(), updated_at = now() WHERE id = ${cur.id}::uuid AND status <> 'deleted'::coupon_status`;
      await this.audit.record(tx, {
        ...actorOf(actor), action: 'promotion.coupon.delete', target_type: 'coupon', target_id: cur.id,
        before: { code: cur.code, status: cur.status }, after: { status: 'deleted', consumed_count: cur.consumed_count, reserved_count: cur.reserved_count },
      });
    });
  }

  /** Tắt (`active` sang `disabled`) hoặc bật (`disabled` sang `active`, còn hạn theo giờ CSDL và còn chỗ trống); tăng `version` (PRM-REQ ...275 BR8). */
  async setEnabled(actor: SessionContext, id: string, enable: boolean) {
    return this.transactions.run(async (tx) => {
      const cur = await this.lock(tx, id);
      const from = enable ? 'disabled' : 'active';
      if (cur.status !== from) throw problem('invalid_transition');
      if (enable && cur.overdue) throw problem('coupon_expired');
      if (enable && cur.consumed_count + cur.reserved_count >= cur.usage_limit) throw problem('coupon_exhausted');
      const to = enable ? 'active' : 'disabled';
      const [r] = await tx.$queryRaw<CouponRow[]>`
        UPDATE coupons SET status = ${to}::coupon_status, version = version + 1, updated_at = now() WHERE id = ${cur.id}::uuid AND status = ${from}::coupon_status RETURNING ${COLS}`;
      if (!r) throw problem('invalid_transition');
      await this.audit.record(tx, { ...actorOf(actor), action: `promotion.coupon.${enable ? 'enable' : 'disable'}`, target_type: 'coupon', target_id: cur.id, before: { status: from }, after: { status: to } });
      return toCoupon(r);
    });
  }
}
