import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderApi } from '../order';
import { AuditService, DomainError, PrismaService, TransactionService, paginate, toPage, type SessionContext } from '../platform';
import { HISTORY_MAX, type FailReason, type ShipmentStatus } from './config';
import type { ListQuery } from './policy';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
/** Staff chỉ thấy khối người nhận khi vận đơn còn đang xử lý (ngoại lệ (b) của SB-08); admin luôn thấy. */
const STAFF_RECIPIENT: readonly ShipmentStatus[] = ['pending', 'shipped', 'failed'];
/** Điện thoại, địa chỉ ở danh sách chỉ khi vận đơn còn trong hàng đợi xử lý (SB-08 (d)); đã giao, hoàn, hủy thì null, như nhau cho staff, sale, admin. */
const DISPLAY_PHONE: readonly ShipmentStatus[] = STAFF_RECIPIENT;

/** Câu chọn trang danh sách (index (status, created_at, id) hoặc (created_at, id), SHP-DB mục Bảng): test EXPLAIN đúng câu này. `dir` chỉ nhận ASC hoặc DESC (hằng của mã, không từ đầu vào). */
export const listRowsSql = (cond: Prisma.Sql, dir: 'ASC' | 'DESC', take: number, skip: number): Prisma.Sql => {
  const d = dir === 'ASC' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return Prisma.sql`
    SELECT s.order_id, s.order_code, s.status::text AS status, s.tracking_number, m.name AS method_name, s.created_at, s.updated_at
    FROM shipments s JOIN shipping_methods m ON m.id = s.shipping_method_id ${cond} ORDER BY s.created_at ${d}, s.id ${d} LIMIT ${take} OFFSET ${skip}`;
};
export const listCountSql = (cond: Prisma.Sql): Prisma.Sql => Prisma.sql`SELECT count(*)::int AS n FROM shipments s ${cond}`;

interface ListRow { order_id: string; order_code: string | null; status: string; tracking_number: string | null; method_name: string; created_at: Date; updated_at: Date }

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

    /**
   * Danh sách cho staff, sale, admin (SHP-REQ ...927 BR1, BR11 đến BR13; SB-08 (d)). Thứ tự: truy vấn trang (sale: `created_by` = người trong phiên áp ở truy vấn lẫn đếm tổng, không lọc sau khi lấy trang) ->
   * trang rỗng thì trả ngay (không gọi ORD, không audit) -> MỘT lời gọi `getShipmentDisplay` cho cả trang (lỗi hay thiếu đơn thì ném: 500, không trả trang thiếu khối khách) -> ẩn `phone`, `address` theo trạng thái
   * vận đơn TRƯỚC khi serialize -> audit `shipment.view_list` ghi trước khi trả (lỗi thì 500, đóng kín). `order_code` của bộ lọc và của từng dòng so khớp, đọc từ cột `shipments.order_code`: không gọi ORD theo mã.
   */
  async list(s: SessionContext, q: ListQuery) {
    const where: Prisma.Sql[] = [];
    if (s.role === 'sale') where.push(Prisma.sql`s.created_by = ${s.user_id}::uuid`);
    if (q.status) where.push(Prisma.sql`s.status = ${q.status}::shipment_status`);
    if (q.tracking_number) where.push(Prisma.sql`s.tracking_number = ${q.tracking_number}`);
    if (q.order_code !== undefined) {
      if (/[^ -~]/.test(q.order_code)) return toPage([], 0, q); // ngoài ASCII in được thì không khớp khuôn mã nào (đổi chữ hoa Unicode làm `ſ` thành `S`)
      where.push(Prisma.sql`s.order_code = ${q.order_code.toUpperCase()}`);
    }
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const { skip, take } = paginate(q);
    const [rows, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<ListRow[]>(listRowsSql(cond, q.sort === 'oldest' ? 'ASC' : 'DESC', take, skip)),
      this.prisma.$queryRaw<{ n: number }[]>(listCountSql(cond)),
    ]);
    if (rows.length === 0) return toPage([], n, q);

    // một vận đơn còn hiệu lực mỗi đơn nhưng đơn có thể còn nhiều vận đơn `cancelled`: bỏ trùng, `getShipmentDisplay` chỉ nhận id không trùng
    const display = await this.orders.getShipmentDisplay([...new Set(rows.map((r) => r.order_id))]);
    const byOrder = new Map(display.map((d) => [d.order_id, d]));
    const items = [];
    for (const r of rows) {
      const d = byOrder.get(r.order_id);
      if (!d) throw new Error('getShipmentDisplay thiếu đơn của vận đơn'); // không bịa khối khách (500)
      if (s.role === 'sale' && d.created_by !== s.user_id) continue; // cột bản chụp lệch khi admin đổi người tạo (SB-45): sale không thấy dòng này
      const open = DISPLAY_PHONE.includes(r.status as ShipmentStatus);
      items.push({
        order_code: r.order_code ?? '', status: r.status, tracking_number: r.tracking_number, method_name: r.method_name, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
        customer_name: d.customer_name, phone: open ? d.phone : null, address: open ? d.address : null, created_by_name: d.created_by_name,
      });
    }
    if (items.length === 0) return toPage([], n, q);
    // audit TRƯỚC khi trả, một dòng cho cả trang; không ghi nội dung khối khách (SB-08 (d), SB-18); lỗi thì ném (500), `items` không rời khỏi hàm (SB-19)
    await this.transactions.run((tx) => this.audit.record(tx, {
      actor_id: s.user_id, actor_role: s.role, action: 'shipment.view_list', target_type: 'shipment', target_id: 'list', before: null,
      after: { rows: items.length, status: q.status, order_code: q.order_code, tracking_number: q.tracking_number, sort: q.sort, page: q.page, limit: q.limit },
    }));
    return toPage(items, n, q);
  }
}
