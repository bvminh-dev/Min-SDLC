import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderApi } from '../order';
import { AuditService, DomainError, PrismaService, TransactionService, paginate, toPage, type SessionContext } from '../platform';
import { HISTORY_MAX, type FailReason, type ShipmentStatus } from './config';
import type { ListQuery } from './policy';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
/** Staff chỉ thấy khối người nhận khi vận đơn còn đang xử lý (ngoại lệ (b) của SB-08); admin luôn thấy. */
const STAFF_RECIPIENT: readonly ShipmentStatus[] = ['pending', 'shipped', 'failed'];

/** Câu chọn trang danh sách (index (status, created_at, id) hoặc (created_at, id), SHP-DB mục Bảng): test EXPLAIN đúng câu này. `dir` chỉ nhận ASC hoặc DESC (hằng của mã, không từ đầu vào). */
export const listRowsSql = (cond: Prisma.Sql, dir: 'ASC' | 'DESC', take: number, skip: number): Prisma.Sql => {
  const d = dir === 'ASC' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return Prisma.sql`
    SELECT s.order_code, s.status::text AS status, s.tracking_number, m.name AS method_name, s.created_at, s.updated_at
    FROM shipments s JOIN shipping_methods m ON m.id = s.shipping_method_id ${cond} ORDER BY s.created_at ${d}, s.id ${d} LIMIT ${take} OFFSET ${skip}`;
};
export const listCountSql = (cond: Prisma.Sql): Prisma.Sql => Prisma.sql`SELECT count(*)::int AS n FROM shipments s ${cond}`;

interface Current {
  id: string; order_id: string; status: ShipmentStatus; tracking_number: string | null; cod_amount: bigint; shipped_at: Date | null; delivered_at: Date | null; version: number; method_name: string;
}

/**
 * Đọc vận đơn (SHP-REQ ...927, ...972; SHP-DB mục Giao dịch và khóa 8). Quyền sở hữu do ORD quyết (`findOwned(code, user_id)` với `user_id` từ phiên, SB-06): đơn người khác, không có và mã
 * sai định dạng cùng là 404. SHP không SELECT bảng `orders` (SB-35): mã đơn của danh sách lấy từ cột `order_code` của chính `shipments`. Mỗi lần trả khối `recipient` cho staff, admin là một dòng audit ghi TRƯỚC khi trả
 * (lỗi audit thì không trả và 500, SB-19).
 */
@Injectable()
export class ReadService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly orders: OrderApi) {}

  private async order(s: SessionContext, code: string): Promise<{ order_id: string; code: string }> {
    const o = s.role === 'customer' ? await this.orders.findOwned(code, s.user_id) : await this.orders.findByCode(code);
    if (!o) throw new DomainError('not-found');
    return o;
  }

  /** Vận đơn còn hiệu lực của đơn, nếu không có thì vận đơn `cancelled` mới nhất. */
  private async current(orderId: string): Promise<Current | undefined> {
    const [r] = await this.prisma.$queryRaw<Current[]>`
      SELECT s.id, s.order_id, s.status::text AS status, s.tracking_number, s.cod_amount, s.shipped_at, s.delivered_at, s.version, m.name AS method_name
      FROM shipments s JOIN shipping_methods m ON m.id = s.shipping_method_id
      WHERE s.order_id = ${orderId}::uuid ORDER BY (s.status <> 'cancelled'::shipment_status) DESC, s.created_at DESC, s.id DESC LIMIT 1`;
    return r;
  }

  async detail(s: SessionContext, code: string) {
    const o = await this.order(s, code);
    const c = await this.current(o.order_id);
    if (!c) return { order_code: o.code, shipment: null };
    const base = { status: c.status, tracking_number: c.tracking_number, method_name: c.method_name, shipped_at: iso(c.shipped_at), delivered_at: iso(c.delivered_at) };
    if (s.role === 'customer') return { order_code: o.code, shipment: base };

    const extra: Record<string, unknown> = { version: c.version, cod_amount: Number(c.cod_amount) };
    if (c.status === 'failed' || c.status === 'returned') {
      const [f] = await this.prisma.$queryRaw<{ reason_code: FailReason | null; note: string | null }[]>`
        SELECT reason_code::text AS reason_code, note FROM shipment_status_history WHERE shipment_id = ${c.id}::uuid AND status = 'failed'::shipment_status ORDER BY seq DESC LIMIT 1`;
      if (f) { extra.reason_code = f.reason_code; extra.note = f.note; }
    }
    if (s.role === 'admin' || STAFF_RECIPIENT.includes(c.status)) {
      const recipient = await this.orders.getRecipient(o.order_id);
      if (recipient) {
        // audit TRƯỚC khi trả địa chỉ, trong giao dịch ngắn riêng; lỗi thì ném (500), `recipient` không rời khỏi hàm (SB-19, ADR-021). Không ghi nội dung địa chỉ.
        await this.transactions.run((tx) => this.audit.record(tx, {
          actor_id: s.user_id, actor_role: s.role, action: 'shipment.view_recipient', target_type: 'shipment', target_id: c.id, before: null, after: { order_code: o.code },
        }));
        extra.recipient = recipient;
      }
    }
    return { order_code: o.code, shipment: { ...base, ...extra } };
  }

  async history(s: SessionContext, code: string) {
    const o = await this.order(s, code);
    const c = await this.current(o.order_id);
    if (!c) return { items: [] };
    const rows = await this.prisma.$queryRaw<{ created_at: Date; event: string; status: string; tracking_number: string | null; reason_code: string | null; note: string | null }[]>`
      SELECT created_at, event, status, tracking_number, reason_code, note FROM (
        SELECT seq, created_at, event::text AS event, status::text AS status, tracking_number, reason_code::text AS reason_code, note
        FROM shipment_status_history WHERE shipment_id = ${c.id}::uuid ORDER BY seq DESC LIMIT ${HISTORY_MAX}) newest ORDER BY seq ASC`; // 100 dòng MỚI NHẤT rồi cũ nhất trước: trạng thái hiện tại luôn có mặt (SHP-API history, SHP-DB mục Giao dịch và khóa 8)
    const staff = s.role !== 'customer';
    return {
      items: rows.map((r) => ({
        at: r.created_at.toISOString(), event: r.event, status: r.status,
        ...(r.tracking_number ? { tracking_number: r.tracking_number } : {}),
        ...(staff && r.reason_code ? { reason_code: r.reason_code } : {}),
        ...(staff && r.note ? { note: r.note } : {}),
      })),
    };
  }

  /** Danh sách cho staff, admin: không dữ liệu cá nhân, không tìm theo email, điện thoại (SB-08). `order_code` của bộ lọc đổi thành `order_id` qua ORD; mã đơn của từng dòng đọc từ cột `shipments.order_code` (bản chụp bất biến lúc tạo, không còn gọi ORD từng dòng). */
  async list(q: ListQuery) {
    const where: Prisma.Sql[] = [];
    if (q.status) where.push(Prisma.sql`s.status = ${q.status}::shipment_status`);
    if (q.tracking_number) where.push(Prisma.sql`s.tracking_number = ${q.tracking_number}`);
    if (q.order_code !== undefined) {
      const o = await this.orders.findByCode(q.order_code);
      if (!o) return toPage([], 0, q); // mã không có hay sai định dạng: không dòng nào khớp
      where.push(Prisma.sql`s.order_id = ${o.order_id}::uuid`);
    }
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const { skip, take } = paginate(q);
    const [rows, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<{ order_code: string | null; status: string; tracking_number: string | null; method_name: string; created_at: Date; updated_at: Date }[]>(listRowsSql(cond, q.sort === 'oldest' ? 'ASC' : 'DESC', take, skip)),
      this.prisma.$queryRaw<{ n: number }[]>(listCountSql(cond)),
    ]);
    return toPage(rows.map((r) => ({
      order_code: r.order_code ?? '', status: r.status, tracking_number: r.tracking_number, method_name: r.method_name, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
    })), n, q);
  }
}
