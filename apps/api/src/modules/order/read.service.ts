import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthApi } from '../auth';
import { DomainError, PrismaService, toPage, type SessionContext } from '../platform';
import { CODE_RE, searchCode, upperCode, type OrderStatus } from './config';
import type { AdminListQuery, ListQuery } from './policy';

const offsetOf = (q: { page: number; limit: number }) => (q.page - 1) * q.limit;
const iso = (d: Date): string => d.toISOString();
const SHIPPED_ON: readonly OrderStatus[] = ['shipped', 'delivered', 'returned'];
const invalid = (field: string, code: string) => new DomainError('validation-failed', { errors: [{ field, code }] });

interface ListRow {
  code: string; created_at: Date; status: string; grand_total: bigint; payment_method: string; payment_status: string; item_count: number; source_code: string; source_name: string; created_by: string | null;
}
/** Một dòng danh sách (cả customer và quản trị): không dữ liệu cá nhân, ghi chú hay giá vốn (SB-08, SB-42). `item_count` là số dòng hàng, không phải tổng số lượng (questions.md). */
const listItem = (r: ListRow) => ({ code: r.code, created_at: iso(r.created_at), status: r.status, grand_total: Number(r.grand_total), payment_method: r.payment_method, payment_status: r.payment_status, item_count: r.item_count });

interface DetailRow {
  id: string; code: string; status: OrderStatus; created_at: Date; items_total: bigint; discount: bigint; shipping_fee: bigint; grand_total: bigint; payment_method: string; payment_status: string;
  tracking_number: string | null; shipping_address: unknown; payment_expires_at: Date | null; handoff_locked_at: Date | null;
  source_code: string; source_name: string; created_by: string | null; note: string | null; customer_snapshot: { full_name: string; phone: string } | null;
}

/**
 * Đọc cho customer, staff, sale, admin (ORD-API): truy vấn một lần, không khóa. Điều kiện sở hữu (customer: `user_id`, sale: `created_by`) lấy từ phiên và luôn nằm trong câu truy vấn, không lấy từ tham số (SB-06, SB-44).
 * Tên người tạo đơn hộ tra bằng `AuthApi.getDisplayNames` MỘT lần cho cả trang, SAU khi truy vấn đơn xong (không giữ khóa, không N+1, SB-31).
 */
@Injectable()
export class ReadService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthApi) {}

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    return new Map(list.length ? (await this.auth.getDisplayNames(list)).map((n) => [n.user_id, n.display_name]) : []);
  }

  private async page(where: Prisma.Sql, q: { page: number; limit: number }) {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM orders o WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT o.code, o.created_at, o.status::text AS status, o.grand_total, o.payment_method::text AS payment_method, o.payment_status::text AS payment_status, o.created_by,
             (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count, s.code AS source_code, s.name AS source_name
      FROM orders o JOIN order_sources s ON s.id = o.source_id WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${q.limit} OFFSET ${offsetOf(q)}`;
    return { rows, total: Number(n) };
  }

  async listMine(s: SessionContext, q: ListQuery) {
    const conds = [Prisma.sql`o.user_id = ${s.user_id}::uuid`];
    if (q.status) conds.push(Prisma.sql`o.status = ${q.status}::order_status`);
    const r = await this.page(Prisma.join(conds, ' AND '), q);
    return toPage(r.rows.map(listItem), r.total, q);
  }

  /**
   * Staff, sale, admin: `code` so khớp chính xác không phân biệt hoa thường (cả hai dạng mã), `source` (mã nguồn, phải có trong danh mục kể cả nguồn đã tắt), `created_by` (chỉ staff và admin), kết hợp theo AND.
   * Sale chỉ đơn có `created_by` là mình: điều kiện nằm trong cả câu đếm `total` (không lọc sau khi lấy trang) và ô tìm mã chỉ khớp trong tập đó; sale gửi `created_by` thì 400.
   */
  async listAll(s: SessionContext, q: AdminListQuery) {
    const conds = [Prisma.sql`TRUE`];
    if (s.role === 'sale') {
      if (q.created_by !== undefined) throw invalid('created_by', 'unknown_field');
      conds.push(Prisma.sql`o.created_by = ${s.user_id}::uuid`);
    } else if (q.created_by) conds.push(Prisma.sql`o.created_by = ${q.created_by}::uuid`);
    if (q.status) conds.push(Prisma.sql`o.status = ${q.status}::order_status`);
    if (q.code) conds.push(Prisma.sql`o.code = ${searchCode(q.code)}`);
    if (q.source) {
      const [src] = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM order_sources WHERE code = ${q.source}`;
      if (!src) throw invalid('source', 'unknown_source');
      conds.push(Prisma.sql`o.source_id = ${src.id}::uuid`);
    }
    const r = await this.page(Prisma.join(conds, ' AND '), q);
    const names = await this.names(r.rows.map((x) => x.created_by));
    // `created_by` (id) để ô lọc Người tạo của giao diện gom người tạo từ các đơn đã tải (staff không có API danh sách người dùng); id nhân viên, không phải dữ liệu của khách (xem report, Lệch spec)
    return toPage(r.rows.map((x) => ({ ...listItem(x), source: { code: x.source_code, name: x.source_name }, created_by_name: (x.created_by && names.get(x.created_by)) || null, created_by: x.created_by })), r.total, q);
  }

  /** Đơn theo mã kèm điều kiện sở hữu của role; mã sai định dạng, đơn người khác (cả đơn hộ không tài khoản) và đơn không tồn tại cùng một 404 qua CÙNG câu truy vấn (SB-44, T2). */
  private async find(s: SessionContext, rawCode: string): Promise<DetailRow> {
    const code = upperCode(rawCode);
    // mã sai định dạng không thoát sớm: chạy cùng câu truy vấn với mã không khớp để thời gian xấp xỉ nhau (SB-44)
    const probe = CODE_RE.test(code) ? code : '';
    const own = s.role === 'customer' ? Prisma.sql` AND o.user_id = ${s.user_id}::uuid` : s.role === 'sale' ? Prisma.sql` AND o.created_by = ${s.user_id}::uuid` : Prisma.empty;
    const [r] = await this.prisma.$queryRaw<DetailRow[]>`
      SELECT o.id, o.code, o.status::text AS status, o.created_at, o.items_total, o.discount, o.shipping_fee, o.grand_total, o.payment_method::text AS payment_method, o.payment_status::text AS payment_status,
             o.tracking_number, o.shipping_address, o.payment_expires_at, o.handoff_locked_at, s.code AS source_code, s.name AS source_name, o.created_by, o.note, o.customer_snapshot
      FROM orders o JOIN order_sources s ON s.id = o.source_id WHERE o.code = ${probe}${own}`;
    if (!r) throw new DomainError('not-found');
    return r;
  }

  /**
   * Chi tiết theo role (ORD-REQ-20261006-092320768 BR10), serializer loại khóa chứ không trả `null`: customer không có `source`, `created_by_name`, `note`, `customer`, `cost_snapshot`;
   * staff có nguồn, người tạo, ghi chú nhưng không có người nhận, điện thoại, địa chỉ, `customer` (SB-08 c); sale (đơn của mình) thêm địa chỉ và `customer`; chỉ admin có `items[].cost_snapshot` (SB-42).
   */
  async detail(s: SessionContext, rawCode: string) {
    const o = await this.find(s, rawCode);
    const items = await this.prisma.$queryRaw<{ name_snapshot: string; unit_price: bigint; quantity: number; note: string | null; cost_snapshot: bigint | null }[]>`
      SELECT name_snapshot, unit_price, quantity, note, cost_snapshot FROM order_items WHERE order_id = ${o.id}::uuid ORDER BY position`;
    const internal = s.role !== 'customer';
    const names = internal ? await this.names([o.created_by]) : new Map<string, string>();
    // `can_cancel` chỉ để giao diện ẩn nút (server kiểm lại khi hủy): pending, hoặc confirmed và paid chưa bị SHP khóa bàn giao; chỉ customer và admin (R-04).
    const canCancel = (s.role === 'customer' || s.role === 'admin') && (o.status === 'pending' || ((o.status === 'confirmed' || o.status === 'paid') && o.handoff_locked_at === null));
    return {
      code: o.code, status: o.status, created_at: iso(o.created_at),
      items: items.map((i) => ({
        name: i.name_snapshot, unit_price: Number(i.unit_price), quantity: i.quantity, line_total: Number(i.unit_price) * i.quantity,
        ...(internal ? { note: i.note } : {}), ...(s.role === 'admin' ? { cost_snapshot: i.cost_snapshot === null ? null : Number(i.cost_snapshot) } : {}),
      })),
      items_total: Number(o.items_total), discount: Number(o.discount), shipping_fee: Number(o.shipping_fee), grand_total: Number(o.grand_total),
      payment_method: o.payment_method, payment_status: o.payment_status,
      ...(o.tracking_number && SHIPPED_ON.includes(o.status) ? { tracking_number: o.tracking_number } : {}),
      ...(o.payment_expires_at && o.status === 'pending' && o.payment_method === 'vnpay' ? { payment_expires_at: iso(o.payment_expires_at) } : {}),
      ...(s.role === 'staff' ? {} : { shipping_address: o.shipping_address }), // staff không thấy người nhận, điện thoại, địa chỉ (SB-08 ngoại lệ (c))
      ...(internal ? { source: { code: o.source_code, name: o.source_name }, created_by_name: (o.created_by && names.get(o.created_by)) || null, note: o.note } : {}),
      ...((s.role === 'sale' || s.role === 'admin') && o.customer_snapshot ? { customer: { full_name: o.customer_snapshot.full_name, phone: o.customer_snapshot.phone } } : {}),
      can_cancel: canCancel,
    };
  }

  /** Lịch sử theo `seq` (thứ tự ghi), không theo `created_at` hay `id`; không trả người thực hiện (BR8). `reason` chỉ khi có. Đơn đi qua cùng đường tra sở hữu: đơn không thuộc customer hay sale thì không đọc lịch sử. */
  async history(s: SessionContext, rawCode: string) {
    const o = await this.find(s, rawCode);
    const rows = await this.prisma.$queryRaw<{ created_at: Date; to_status: string; reason: string | null }[]>`
      SELECT created_at, to_status::text AS to_status, reason FROM order_status_history WHERE order_id = ${o.id}::uuid ORDER BY seq`;
    return { items: rows.map((r) => ({ at: iso(r.created_at), status: r.to_status, ...(r.reason ? { reason: r.reason } : {}) })) };
  }
}
