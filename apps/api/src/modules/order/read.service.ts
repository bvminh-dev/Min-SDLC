import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, PrismaService, toPage, type SessionContext } from '../platform';
import { CODE_RE, upperCode, type OrderStatus } from './config';
import type { AdminListQuery, ListQuery } from './policy';

const offsetOf = (q: { page: number; limit: number }) => (q.page - 1) * q.limit;
const iso = (d: Date): string => d.toISOString();
const SHIPPED_ON: readonly OrderStatus[] = ['shipped', 'delivered', 'returned'];

interface ListRow { code: string; created_at: Date; status: string; grand_total: bigint; payment_method: string; payment_status: string; item_count: number }
/** Một dòng danh sách (cả customer và quản trị): không dữ liệu cá nhân (SB-08). `item_count` là số dòng hàng, không phải tổng số lượng (questions.md). */
const listItem = (r: ListRow) => ({ code: r.code, created_at: iso(r.created_at), status: r.status, grand_total: Number(r.grand_total), payment_method: r.payment_method, payment_status: r.payment_status, item_count: r.item_count });

interface DetailRow {
  id: string; code: string; status: OrderStatus; created_at: Date; items_total: bigint; discount: bigint; shipping_fee: bigint; grand_total: bigint; payment_method: string; payment_status: string;
  tracking_number: string | null; shipping_address: unknown; payment_expires_at: Date | null; handoff_locked_at: Date | null;
}

/** Đọc cho customer, staff, admin (ORD-API): truy vấn một lần, không khóa. Điều kiện sở hữu `user_id` lấy từ phiên luôn nằm trong câu truy vấn của customer (SB-06), không lấy từ tham số. */
@Injectable()
export class ReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async page(where: Prisma.Sql, q: { page: number; limit: number }) {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM orders o WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT o.code, o.created_at, o.status::text AS status, o.grand_total, o.payment_method::text AS payment_method, o.payment_status::text AS payment_status,
             (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${q.limit} OFFSET ${offsetOf(q)}`;
    return { items: rows.map(listItem), total: Number(n) };
  }

  async listMine(s: SessionContext, q: ListQuery) {
    const conds = [Prisma.sql`o.user_id = ${s.user_id}::uuid`];
    if (q.status) conds.push(Prisma.sql`o.status = ${q.status}::order_status`);
    const r = await this.page(Prisma.join(conds, ' AND '), q);
    return toPage(r.items, r.total, q);
  }

  /** Staff, admin: mọi đơn; `code` so khớp chính xác không phân biệt hoa thường (chuẩn hóa chữ hoa), kết hợp với `status` theo AND; không có tham số nào theo dữ liệu cá nhân. */
  async listAll(q: AdminListQuery) {
    const conds = [Prisma.sql`TRUE`];
    if (q.status) conds.push(Prisma.sql`o.status = ${q.status}::order_status`);
    if (q.code) conds.push(Prisma.sql`o.code = ${upperCode(q.code)}`);
    const r = await this.page(Prisma.join(conds, ' AND '), q);
    return toPage(r.items, r.total, q);
  }

  /** Đơn theo mã kèm điều kiện sở hữu của customer; mã sai định dạng, đơn người khác và đơn không tồn tại cùng một 404 (T2). */
  private async find(s: SessionContext, rawCode: string): Promise<DetailRow> {
    const code = upperCode(rawCode);
    if (!CODE_RE.test(code)) throw new DomainError('not-found');
    const own = s.role === 'customer' ? Prisma.sql` AND user_id = ${s.user_id}::uuid` : Prisma.empty;
    const [r] = await this.prisma.$queryRaw<DetailRow[]>`
      SELECT id, code, status::text AS status, created_at, items_total, discount, shipping_fee, grand_total, payment_method::text AS payment_method, payment_status::text AS payment_status,
             tracking_number, shipping_address, payment_expires_at, handoff_locked_at
      FROM orders WHERE code = ${code}${own}`;
    if (!r) throw new DomainError('not-found');
    return r;
  }

  async detail(s: SessionContext, rawCode: string) {
    const o = await this.find(s, rawCode);
    const items = await this.prisma.$queryRaw<{ name_snapshot: string; unit_price: bigint; quantity: number }[]>`
      SELECT name_snapshot, unit_price, quantity FROM order_items WHERE order_id = ${o.id}::uuid ORDER BY position`;
    // `can_cancel` chỉ để giao diện ẩn nút (server kiểm lại khi hủy): pending, hoặc confirmed và paid chưa bị SHP khóa bàn giao; luôn false cho staff (R-04).
    const canCancel = s.role !== 'staff' && (o.status === 'pending' || ((o.status === 'confirmed' || o.status === 'paid') && o.handoff_locked_at === null));
    return {
      code: o.code, status: o.status, created_at: iso(o.created_at),
      items: items.map((i) => ({ name: i.name_snapshot, unit_price: Number(i.unit_price), quantity: i.quantity, line_total: Number(i.unit_price) * i.quantity })),
      items_total: Number(o.items_total), discount: Number(o.discount), shipping_fee: Number(o.shipping_fee), grand_total: Number(o.grand_total),
      payment_method: o.payment_method, payment_status: o.payment_status,
      ...(o.tracking_number && SHIPPED_ON.includes(o.status) ? { tracking_number: o.tracking_number } : {}),
      ...(o.payment_expires_at && o.status === 'pending' && o.payment_method === 'vnpay' ? { payment_expires_at: iso(o.payment_expires_at) } : {}),
      ...(s.role === 'staff' ? {} : { shipping_address: o.shipping_address }), // staff không thấy người nhận, điện thoại, địa chỉ (SB-08 ngoại lệ (c))
      can_cancel: canCancel,
    };
  }

  /** Lịch sử theo `seq` (thứ tự ghi), không theo `created_at` hay `id`; không trả người thực hiện (BR8). `reason` chỉ khi có. Đơn đi qua cùng đường tra sở hữu: đơn không thuộc customer thì không đọc lịch sử. */
  async history(s: SessionContext, rawCode: string) {
    const o = await this.find(s, rawCode);
    const rows = await this.prisma.$queryRaw<{ created_at: Date; to_status: string; reason: string | null }[]>`
      SELECT created_at, to_status::text AS to_status, reason FROM order_status_history WHERE order_id = ${o.id}::uuid ORDER BY seq`;
    return { items: rows.map((r) => ({ at: iso(r.created_at), status: r.to_status, ...(r.reason ? { reason: r.reason } : {}) })) };
  }
}
