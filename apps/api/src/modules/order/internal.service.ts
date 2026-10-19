import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthApi } from '../auth';
import { PrismaService, TransactionService, Clock, type Tx } from '../platform';
import { AGG_LIMIT_MAX, CODE_RE, DISPLAY_IDS_MAX, ORDER_STATUSES, SEARCH_CODE_MAX, SERIES_MAX_BUCKETS, SOURCE_CODE_RE, searchCode, upperCode, type OrderStatus } from './config';
import { OrderBusinessError } from './errors';
import { UUID_RE, lockById, type PaymentMethod } from './row';

export interface RangeUtc { from: Date; to: Date }
export type SeriesBucket = 'hour' | 'day' | 'month';
export type TopSort = 'quantity' | 'amount';
const BUCKETS: readonly SeriesBucket[] = ['hour', 'day', 'month'];

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const inDbDates = (d: Date): boolean => d.getUTCFullYear() >= 1 && d.getUTCFullYear() <= 9999; // ngoài miền này Prisma và PostgreSQL ném lỗi thô
const checkRange = (r: RangeUtc): void => {
  if (!r || !(r.from instanceof Date) || !(r.to instanceof Date) || Number.isNaN(r.from.getTime()) || Number.isNaN(r.to.getTime()) || r.to < r.from || !inDbDates(r.from) || !inDbDates(r.to)) throw new RangeError('range_utc phải là [from, to) hợp lệ với from không sau to, năm 1 đến 9999');
};
/** Độ dài nhỏ nhất của một mốc (tháng tính 28 ngày): khoảng dài hơn trần mốc nhiều lần bị từ chối TRƯỚC khi chạy generate_series (LIMIT không ngăn được việc sắp toàn bộ chuỗi, SB-34). */
const BUCKET_MIN_MS: Record<SeriesBucket, number> = { hour: 3_600_000, day: 86_400_000, month: 28 * 86_400_000 };
const checkLimit = (n: number): void => { if (!Number.isInteger(n) || n < 1 || n > AGG_LIMIT_MAX) throw new RangeError(`limit phải từ 1 đến ${AGG_LIMIT_MAX}`); };

/** Câu đếm đơn mở: khớp chỉ mục một phần `orders_open_self_idx` (user_id, payment_method) WHERE status IN ('pending','confirmed') AND created_by IS NULL; test EXPLAIN đúng câu này. */
export const countOpenSql = (userId: string): Prisma.Sql => Prisma.sql`
  SELECT count(*) FILTER (WHERE payment_method = 'vnpay' AND status = 'pending')::int AS online_pending,
         count(*) FILTER (WHERE payment_method = 'cod' AND status IN ('pending', 'confirmed'))::int AS cod_open
  FROM orders WHERE user_id = ${userId}::uuid AND status IN ('pending', 'confirmed') AND created_by IS NULL`; // chỉ đơn khách tự đặt: đơn hộ không tính vào giới hạn đơn mở (SB-33)

/**
 * Giao diện đọc nội bộ (ORD-REQ ...681; bảng "Giao diện module"): chỉ đọc, không ghi bảng nào, không audit, không event; trả bộ trường tối thiểu, không dữ liệu cá nhân ngoài `getRecipient` (SB-08 b).
 * Đơn người khác và đơn không tồn tại cho cùng kết quả `null` (SB-06). Tổng hợp cho DSH: khoảng UTC nửa mở, một câu SQL mỗi lời gọi, GROUP BY ở CSDL, không `user_id`, không địa chỉ.
 * Đọc dữ liệu đã commit (READ COMMITTED), không bộ nhớ đệm (cache 60 giây là của DSH, ADR-020).
 */
@Injectable()
export class InternalService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly clock: Clock, private readonly auth: AuthApi) {}

  /** CHK: đơn mở của một người (chỉ mục một phần (user_id, payment_method) WHERE status IN ('pending','confirmed')): `online_pending` là vnpay đang pending, `cod_open` là COD pending hoặc confirmed. */
  async countOpenOrders(userId: string): Promise<{ online_pending: number; cod_open: number }> {
    if (!isUuid(userId)) return { online_pending: 0, cod_open: 0 };
    const [r] = await this.prisma.$queryRaw<{ online_pending: number; cod_open: number }[]>(countOpenSql(userId));
    return r;
  }

  async getSummary(orderId: string): Promise<{ code: string; status: OrderStatus; grand_total: number; payment_method: PaymentMethod } | null> {
    if (!isUuid(orderId)) return null;
    const [r] = await this.prisma.$queryRaw<{ code: string; status: OrderStatus; grand_total: bigint; payment_method: PaymentMethod }[]>`
      SELECT code, status::text AS status, grand_total, payment_method::text AS payment_method FROM orders WHERE id = ${orderId}::uuid`;
    return r ? { code: r.code, status: r.status, grand_total: Number(r.grand_total), payment_method: r.payment_method } : null;
  }

  async findForPayment(orderId: string) {
    if (!isUuid(orderId)) return null;
    const [r] = await this.prisma.$queryRaw<{ order_id: string; code: string; user_id: string | null; status: OrderStatus; payment_method: PaymentMethod; grand_total: bigint; payment_expires_at: Date | null }[]>`
      SELECT id AS order_id, code, user_id, status::text AS status, payment_method::text AS payment_method, grand_total, payment_expires_at FROM orders WHERE id = ${orderId}::uuid`;
    return r ? { ...r, grand_total: Number(r.grand_total) } : null;
  }

  private shipment(where: Prisma.Sql) {
    return this.prisma.$queryRaw<{ order_id: string; code: string; status: OrderStatus; payment_method: PaymentMethod; grand_total: bigint; shipping_method_id: string; created_by: string | null }[]>`
      SELECT id AS order_id, code, status::text AS status, payment_method::text AS payment_method, grand_total, shipping_method_id, created_by FROM orders WHERE ${where}`
      .then(([r]) => (r ? { ...r, grand_total: Number(r.grand_total) } : null));
  }
  async findForShipment(orderId: string) { return isUuid(orderId) ? this.shipment(Prisma.sql`id = ${orderId}::uuid`) : null; }
  async findByCode(code: string) { const c = upperCode(code); return CODE_RE.test(c) ? this.shipment(Prisma.sql`code = ${c}`) : null; }
  /** Đơn của người khác, đơn hộ không tài khoản (`user_id` NULL), không tồn tại và mã sai định dạng: cùng `null` (SB-44). */
  async findOwned(code: string, userId: string) {
    const c = upperCode(code);
    return CODE_RE.test(c) && isUuid(userId) ? this.shipment(Prisma.sql`code = ${c} AND user_id = ${userId}::uuid`) : null;
  }

  /** Bản chụp người nhận lúc đặt (SB-08 b): chỉ SHP gọi, SHP ghi audit khi staff xem. Năm khóa, không có quận. */
  async getRecipient(orderId: string): Promise<{ receiver: string; phone: string; line1: string; ward: string; city: string } | null> {
    if (!isUuid(orderId)) return null;
    const [r] = await this.prisma.$queryRaw<{ a: Record<string, string> }[]>`SELECT shipping_address AS a FROM orders WHERE id = ${orderId}::uuid`;
    return r ? { receiver: r.a.receiver, phone: r.a.phone, line1: r.a.line1, ward: r.a.ward, city: r.a.city } : null;
  }

  /** REV: dòng hàng của đơn `delivered` của đúng người dùng có chứa sản phẩm; `delivered_at` là thuộc tính của đơn. */
  async getDeliveredItems(userId: string, productId: string): Promise<{ order_item_id: string; order_id: string; delivered_at: Date }[]> {
    if (!isUuid(userId) || !isUuid(productId)) return [];
    return this.prisma.$queryRaw`
      SELECT i.id AS order_item_id, o.id AS order_id, o.delivered_at
      FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.user_id = ${userId}::uuid AND o.status = 'delivered' AND i.product_id = ${productId}::uuid
      ORDER BY o.delivered_at, i.position, i.id`;
  }

  /**
   * REV (phân biệt `not_delivered` với `not_purchased`, REV-REQ-20261006-103135296 BR3 bước 4): người dùng có dòng đơn chứa sản phẩm ở đơn CHƯA giao xong (`pending`, `confirmed`, `paid`, `shipped`)?
   * Đơn `cancelled`, `expired`, `returned` không tính. Chỉ đọc, không `tx`. Bổ sung ngoài bảng Giao diện module hiện có (xem report REV, Lệch spec).
   */
  async hasUndeliveredItems(userId: string, productId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(productId)) return false;
    const [r] = await this.prisma.$queryRaw<{ yes: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.user_id = ${userId}::uuid AND o.status IN ('pending', 'confirmed', 'paid', 'shipped') AND i.product_id = ${productId}::uuid) AS yes`;
    return r.yes;
  }

  /**
   * SHP gọi trong giao dịch bàn giao `tx` (sau khi SHP khóa vận đơn, ADR-012): khóa dòng đơn, chỉ cho `paid` hoặc `confirmed`, đặt `handoff_locked_at` (giữ giờ đầu khi gọi lại).
   * Không lịch sử, event hay audit. Cờ commit hoặc rollback cùng `tx` của SHP; hủy của khách và admin gặp cờ thì 409 (R-04).
   */
  async lockForHandoff(orderId: string, tx: Tx): Promise<{ order_id: string; status: 'paid' | 'confirmed' }> {
    const o = isUuid(orderId) ? await lockById(tx, orderId) : undefined;
    if (!o || (o.status !== 'paid' && o.status !== 'confirmed')) throw new OrderBusinessError(o ? 'not_lockable' : 'order_not_found');
    const now = this.clock.now();
    await tx.$executeRaw`UPDATE orders SET handoff_locked_at = COALESCE(handoff_locked_at, ${now}::timestamptz), updated_at = ${now}::timestamptz WHERE id = ${o.id}::uuid`;
    return { order_id: o.id, status: o.status };
  }

  /** DSH: đủ tám trạng thái (có `returned`), đơn tạo trong `[from, to)` theo `created_at`. */
  async countByStatus(range: RangeUtc): Promise<Record<OrderStatus, number>> {
    checkRange(range);
    const rows = await this.prisma.$queryRaw<{ status: OrderStatus; n: number }[]>`
      SELECT status::text AS status, count(*)::int AS n FROM orders WHERE created_at >= ${range.from}::timestamptz AND created_at < ${range.to}::timestamptz GROUP BY status`;
    const out = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /**
   * DSH: mỗi mốc (UTC, không bỏ mốc rỗng) có số đơn theo trạng thái (theo `created_at`), kèm số đơn đã thu tiền (`payment_status` = succeeded) và tổng `grand_total` của chúng THEO MỐC `paid_at` (M-13).
   * Số tiền là tổng đơn, không phải doanh thu chính thức (SB-23). Một câu SQL.
   */
  async getOrderSeries(range: RangeUtc, bucket: SeriesBucket) {
    checkRange(range);
    if (!BUCKETS.includes(bucket)) throw new RangeError(`bucket phải thuộc ${BUCKETS.join(', ')}`);
    if ((range.to.getTime() - range.from.getTime()) / BUCKET_MIN_MS[bucket] > SERIES_MAX_BUCKETS + 2) throw new RangeError(`khoảng và bucket cho quá ${SERIES_MAX_BUCKETS} mốc`);
    const unit = Prisma.raw(`'${bucket}'`); // hằng đã kiểm theo danh sách, không có đầu vào người dùng
    const step = Prisma.raw(`'1 ${bucket}'`);
    const utc = (c: Prisma.Sql) => Prisma.sql`date_trunc(${unit}, ${c} AT TIME ZONE 'UTC')`;
    const rows = await this.prisma.$queryRaw<{ bucket_start: Date; statuses: Record<string, number>; paid_orders: number; paid_total: bigint }[]>`
      WITH b AS (
        SELECT g AS s FROM generate_series(${utc(Prisma.sql`${range.from}::timestamptz`)}, ${range.to}::timestamptz AT TIME ZONE 'UTC' - interval '1 microsecond', ${step}::interval) g
        WHERE ${range.to}::timestamptz > ${range.from}::timestamptz
      ), c AS (
        SELECT ${utc(Prisma.sql`created_at`)} AS s, status::text AS status, count(*)::int AS n FROM orders
        WHERE created_at >= ${range.from}::timestamptz AND created_at < ${range.to}::timestamptz GROUP BY 1, 2
      ), p AS (
        SELECT ${utc(Prisma.sql`paid_at`)} AS s, count(*)::int AS n, sum(grand_total) AS total FROM orders
        WHERE payment_status = 'succeeded' AND paid_at >= ${range.from}::timestamptz AND paid_at < ${range.to}::timestamptz GROUP BY 1
      )
      SELECT b.s AT TIME ZONE 'UTC' AS bucket_start,
             COALESCE((SELECT jsonb_object_agg(c.status, c.n) FROM c WHERE c.s = b.s), '{}'::jsonb) AS statuses,
             COALESCE((SELECT p.n FROM p WHERE p.s = b.s), 0) AS paid_orders, COALESCE((SELECT p.total FROM p WHERE p.s = b.s), 0) AS paid_total
      FROM b ORDER BY b.s LIMIT ${SERIES_MAX_BUCKETS + 1}`;
    if (rows.length > SERIES_MAX_BUCKETS) throw new RangeError(`khoảng và bucket cho quá ${SERIES_MAX_BUCKETS} mốc`);
    return rows.map((r) => ({
      bucket_start: r.bucket_start.toISOString(),
      orders: Object.fromEntries(ORDER_STATUSES.map((s) => [s, r.statuses[s] ?? 0])) as Record<OrderStatus, number>,
      paid_orders: r.paid_orders, paid_total: Number(r.paid_total),
    }));
  }

  /** DSH: các đơn mới nhất, không trường cá nhân (không `user_id`, không địa chỉ). */
  async listRecent(limit: number) {
    checkLimit(limit);
    const rows = await this.prisma.$queryRaw<{ code: string; created_at: Date; status: string; grand_total: bigint; payment_method: string; payment_status: string; item_count: number }[]>`
      SELECT o.code, o.created_at, o.status::text AS status, o.grand_total, o.payment_method::text AS payment_method, o.payment_status::text AS payment_status, (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit}`;
    return rows.map((r) => ({ code: r.code, created_at: r.created_at.toISOString(), status: r.status, grand_total: Number(r.grand_total), payment_method: r.payment_method, payment_status: r.payment_status, item_count: r.item_count }));
  }

  /** DSH: dòng hàng nhóm theo sản phẩm của đơn đã thu tiền (`succeeded`) có `paid_at` trong khoảng và trạng thái không thuộc cancelled, expired, returned (DSH-DB). */
  async getTopProducts(range: RangeUtc, sort: TopSort, limit: number): Promise<{ product_id: string; quantity: number; amount: number }[]> {
    checkRange(range);
    checkLimit(limit);
    if (sort !== 'quantity' && sort !== 'amount') throw new RangeError('sort phải là quantity hoặc amount');
    const order = sort === 'quantity' ? Prisma.sql`quantity DESC, amount DESC` : Prisma.sql`amount DESC, quantity DESC`;
    const rows = await this.prisma.$queryRaw<{ product_id: string; quantity: bigint; amount: bigint }[]>`
      SELECT i.product_id, sum(i.quantity) AS quantity, sum(i.unit_price * i.quantity) AS amount
      FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.payment_status = 'succeeded' AND o.paid_at >= ${range.from}::timestamptz AND o.paid_at < ${range.to}::timestamptz AND o.status NOT IN ('cancelled', 'expired', 'returned')
      GROUP BY i.product_id ORDER BY ${order}, i.product_id LIMIT ${limit}`;
    return rows.map((r) => ({ product_id: r.product_id, quantity: Number(r.quantity), amount: Number(r.amount) }));
  }
  /**
   * DSH (báo cáo sản phẩm, DSH-REQ ...458 BR4): tổng số lượng bán và số sản phẩm khác nhau của TOÀN khoảng (không chỉ `limit` dòng đầu của `getTopProducts`), cùng điều kiện lọc với `getTopProducts`.
   * Một câu SQL, chỉ số đếm. Bổ sung ngoài bảng Giao diện module hiện có (xem report DSH, Lệch spec).
   */
  async getProductSalesTotals(range: RangeUtc): Promise<{ units_total: number; distinct_products: number }> {
    checkRange(range);
    const [r] = await this.prisma.$queryRaw<{ units: bigint; n: bigint }[]>`
      SELECT COALESCE(sum(i.quantity), 0) AS units, count(DISTINCT i.product_id) AS n
      FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.payment_status = 'succeeded' AND o.paid_at >= ${range.from}::timestamptz AND o.paid_at < ${range.to}::timestamptz AND o.status NOT IN ('cancelled', 'expired', 'returned')`;
    return { units_total: Number(r.units), distinct_products: Number(r.n) };
  }

  // --- SAL, SHP, DSH (đợt bán hộ 2026-10-15): chỉ đọc, không `tx`; tên người tạo tra bằng `AuthApi.getDisplayNames` MỘT lần SAU khi truy vấn đơn xong, lỗi AUTH ném nguyên (không trả kết quả thiếu tên).
  private async names(ids: (string | null)[]): Promise<Map<string, string | null>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    return new Map(list.length ? (await this.auth.getDisplayNames(list)).map((n) => [n.user_id, n.display_name]) : []);
  }

  /** SAL: đơn HỘ của một sale (`created_by` uuid) hoặc mọi đơn hộ (`created_by` null, admin); điều kiện `created_by` nằm trong cả câu đếm `total`. Tham số ngoài miền ném `RangeError` trước khi truy vấn. */
  async listForSale(o: { created_by: string | null; status?: OrderStatus; source?: string; code?: string; page: number; limit: number }) {
    if (!o || (o.created_by !== null && !isUuid(o.created_by))) throw new RangeError('created_by phải là uuid hoặc null');
    if (o.status !== undefined && !ORDER_STATUSES.includes(o.status)) throw new RangeError('status ngoài tám trạng thái');
    if (o.source !== undefined && !SOURCE_CODE_RE.test(String(o.source))) throw new RangeError('source không đúng khuôn mã nguồn');
    if (o.code !== undefined && (typeof o.code !== 'string' || o.code.length > SEARCH_CODE_MAX)) throw new RangeError('code quá dài');
    if (!Number.isInteger(o.page) || o.page < 1 || o.page > 1_000_000) throw new RangeError('page phải >= 1');
    checkLimit(o.limit);
    const conds = [Prisma.sql`o.created_by IS NOT NULL`, Prisma.sql`(${o.created_by}::uuid IS NULL OR o.created_by = ${o.created_by}::uuid)`];
    if (o.status) conds.push(Prisma.sql`o.status = ${o.status}::order_status`);
    if (o.source) conds.push(Prisma.sql`s.code = ${o.source}`);
    if (o.code) conds.push(Prisma.sql`o.code = ${searchCode(o.code)}`);
    const where = Prisma.join(conds, ' AND ');
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM orders o JOIN order_sources s ON s.id = o.source_id WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<{ code: string; status: string; payment_method: string; payment_status: string; grand_total: bigint; items_count: number; source_code: string; source_name: string; customer_snapshot: { full_name: string; phone: string }; created_at: Date; created_by: string }[]>`
      SELECT o.code, o.status::text AS status, o.payment_method::text AS payment_method, o.payment_status::text AS payment_status, o.grand_total, (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS items_count,
             s.code AS source_code, s.name AS source_name, o.customer_snapshot, o.created_at, o.created_by
      FROM orders o JOIN order_sources s ON s.id = o.source_id WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${o.limit} OFFSET ${(o.page - 1) * o.limit}`;
    const names = await this.names(rows.map((r) => r.created_by));
    return {
      total: Number(n),
      items: rows.map((r) => ({
        code: r.code, status: r.status, payment_method: r.payment_method, payment_status: r.payment_status, grand_total: Number(r.grand_total), items_count: r.items_count,
        source: { code: r.source_code, name: r.source_name }, customer: { name: r.customer_snapshot.full_name, phone: r.customer_snapshot.phone }, created_at: r.created_at.toISOString(), created_by: { id: r.created_by, name: names.get(r.created_by) ?? null },
      })),
    };
  }

  /** SAL: chi tiết một đơn hộ hoặc `null` (đơn người khác, đơn khách tự đặt, không tồn tại, mã sai định dạng cùng `null`, SB-44). Không `user_id`, không `cost_snapshot` (SB-42). */
  async getForSale(code: string, o: { created_by: string | null }) {
    if (!o || (o.created_by !== null && !isUuid(o.created_by))) throw new RangeError('created_by phải là uuid hoặc null');
    const c = upperCode(code);
    const probe = CODE_RE.test(c) ? c : ''; // cùng một câu truy vấn cho mọi trường hợp không thấy (SB-44)
    const [r] = await this.prisma.$queryRaw<{
      id: string; code: string; status: string; payment_method: string; payment_status: string; created_at: Date; confirmed_at: Date | null; paid_at: Date | null; delivered_at: Date | null; cancel_reason: string | null;
      source_code: string; source_name: string; note: string | null; customer_snapshot: { full_name: string; phone: string }; has_account: boolean; shipping_address: unknown;
      items_total: bigint; discount: bigint; shipping_fee: bigint; grand_total: bigint; created_by: string;
    }[]>`
      SELECT o.id, o.code, o.status::text AS status, o.payment_method::text AS payment_method, o.payment_status::text AS payment_status, o.created_at, o.confirmed_at, o.paid_at, o.delivered_at, o.cancel_reason::text AS cancel_reason,
             s.code AS source_code, s.name AS source_name, o.note, o.customer_snapshot, (o.user_id IS NOT NULL) AS has_account, o.shipping_address, o.items_total, o.discount, o.shipping_fee, o.grand_total, o.created_by
      FROM orders o JOIN order_sources s ON s.id = o.source_id
      WHERE o.created_by IS NOT NULL AND (${o.created_by}::uuid IS NULL OR o.created_by = ${o.created_by}::uuid) AND o.code = ${probe}`;
    if (!r) return null;
    const items = await this.prisma.$queryRaw<{ product_id: string; name_snapshot: string; quantity: number; unit_price: bigint; note: string | null }[]>`
      SELECT product_id, name_snapshot, quantity, unit_price, note FROM order_items WHERE order_id = ${r.id}::uuid ORDER BY position`;
    const names = o.created_by === null ? await this.names([r.created_by]) : null;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      code: r.code, status: r.status, payment_method: r.payment_method, payment_status: r.payment_status, created_at: iso(r.created_at), confirmed_at: iso(r.confirmed_at), paid_at: iso(r.paid_at), delivered_at: iso(r.delivered_at),
      cancel_reason: r.cancel_reason, source: { code: r.source_code, name: r.source_name }, note: r.note, customer: { name: r.customer_snapshot.full_name, phone: r.customer_snapshot.phone, has_account: r.has_account },
      shipping_address: r.shipping_address,
      items: items.map((i) => ({ product_id: i.product_id, name: i.name_snapshot, quantity: i.quantity, unit_price: Number(i.unit_price), line_total: Number(i.unit_price) * i.quantity, note: i.note })),
      items_total: Number(r.items_total), discount: Number(r.discount), shipping_fee: Number(r.shipping_fee), grand_total: Number(r.grand_total),
      ...(names ? { created_by: { id: r.created_by, name: names.get(r.created_by) ?? null } } : {}),
    };
  }

  /**
   * SHP: khối khách của cả trang vận đơn bằng MỘT `SELECT` và MỘT lời gọi AUTH. ORD KHÔNG ẩn `phone`, `address` theo trạng thái vận đơn: việc của SHP (SB-08 d). Thứ tự theo `order_ids`, đơn không thấy thì không có phần tử.
   * `created_by` chỉ để SHP đối chiếu cho sale và bị bỏ trước khi trả client.
   */
  async getShipmentDisplay(orderIds: string[]) {
    if (!Array.isArray(orderIds) || orderIds.length < 1 || orderIds.length > DISPLAY_IDS_MAX || orderIds.some((id) => !isUuid(id)) || new Set(orderIds.map((x) => x.toLowerCase())).size !== orderIds.length) {
      throw new RangeError(`order_ids phải là 1 đến ${DISPLAY_IDS_MAX} uuid không trùng`);
    }
    const rows = await this.prisma.$queryRaw<{ id: string; customer_snapshot: { full_name: string } | null; shipping_address: Record<string, string | null>; created_by: string | null }[]>`
      SELECT id, customer_snapshot, shipping_address, created_by FROM orders WHERE id = ANY(${orderIds}::uuid[])`;
    const names = await this.names(rows.map((r) => r.created_by));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return orderIds.flatMap((id) => {
      const r = byId.get(id.toLowerCase());
      if (!r) return [];
      const a = r.shipping_address;
      return [{
        order_id: r.id, customer_name: r.customer_snapshot?.full_name ?? a.receiver, phone: a.phone,
        address: [a.line1, a.ward, a.district, a.city].filter((x) => typeof x === 'string' && x.trim() !== '').join(', '),
        created_by: r.created_by, created_by_name: (r.created_by && names.get(r.created_by)) || null,
      }];
    });
  }

  /**
   * DSH: số đơn và doanh thu (tổng `grand_total`) theo nguồn của đơn tạo trong `[from, to)`, loại đơn `cancelled`, `expired`, `returned` (đếm riêng ở `excluded_orders`). Mọi nguồn đang bật có mặt kể cả 0 đơn,
   * nguồn đã tắt chỉ khi có đơn được tính. MỘT truy vấn tổng hợp; không trường cá nhân, ghi chú hay giá vốn (SB-42).
   */
  async getSourcesReport(range: RangeUtc) {
    checkRange(range);
    const rows = await this.prisma.$queryRaw<{ source_id: string; code: string; name: string; is_active: boolean; orders: number; revenue: bigint; excluded: number }[]>`
      SELECT s.id AS source_id, s.code, s.name, s.is_active,
             (count(o.id) FILTER (WHERE o.status NOT IN ('cancelled', 'expired', 'returned')))::int AS orders,
             COALESCE(sum(o.grand_total) FILTER (WHERE o.status NOT IN ('cancelled', 'expired', 'returned')), 0) AS revenue,
             (count(o.id) FILTER (WHERE o.status IN ('cancelled', 'expired', 'returned')))::int AS excluded
      FROM order_sources s LEFT JOIN orders o ON o.source_id = s.id AND o.created_at >= ${range.from}::timestamptz AND o.created_at < ${range.to}::timestamptz GROUP BY s.id`;
    return {
      items: rows.filter((r) => r.is_active || r.orders > 0).map((r) => ({ source_id: r.source_id, code: r.code, name: r.name, is_active: r.is_active, orders: r.orders, revenue: Number(r.revenue) })),
      excluded_orders: rows.reduce((n, r) => n + r.excluded, 0),
    };
  }

  /** DSH: như `getSourcesReport` nhưng nhóm theo `created_by` (null là nhóm khách tự đặt); người không có đơn được tính thì không có dòng; `name` null khi AUTH không có người đó. */
  async getSalesReport(range: RangeUtc) {
    checkRange(range);
    const rows = await this.prisma.$queryRaw<{ created_by: string | null; orders: number; revenue: bigint; excluded: number }[]>`
      SELECT created_by,
             (count(*) FILTER (WHERE status NOT IN ('cancelled', 'expired', 'returned')))::int AS orders,
             COALESCE(sum(grand_total) FILTER (WHERE status NOT IN ('cancelled', 'expired', 'returned')), 0) AS revenue,
             (count(*) FILTER (WHERE status IN ('cancelled', 'expired', 'returned')))::int AS excluded
      FROM orders WHERE created_at >= ${range.from}::timestamptz AND created_at < ${range.to}::timestamptz GROUP BY created_by`;
    const names = await this.names(rows.map((r) => r.created_by));
    return {
      items: rows.filter((r) => r.orders > 0).map((r) => ({ created_by: r.created_by, name: (r.created_by && names.get(r.created_by)) || null, orders: r.orders, revenue: Number(r.revenue) })),
      excluded_orders: rows.reduce((n, r) => n + r.excluded, 0),
    };
  }
}
