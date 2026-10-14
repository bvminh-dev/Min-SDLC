import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TransactionService, Clock, type Tx } from '../platform';
import { AGG_LIMIT_MAX, CODE_RE, ORDER_STATUSES, SERIES_MAX_BUCKETS, upperCode, type OrderStatus } from './config';
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

/** Câu đếm đơn mở: khớp chỉ mục một phần `orders_open_idx` (user_id, payment_method) WHERE status IN ('pending','confirmed'); test EXPLAIN đúng câu này. */
export const countOpenSql = (userId: string): Prisma.Sql => Prisma.sql`
  SELECT count(*) FILTER (WHERE payment_method = 'vnpay' AND status = 'pending')::int AS online_pending,
         count(*) FILTER (WHERE payment_method = 'cod' AND status IN ('pending', 'confirmed'))::int AS cod_open
  FROM orders WHERE user_id = ${userId}::uuid AND status IN ('pending', 'confirmed')`;

/**
 * Giao diện đọc nội bộ (ORD-REQ ...681; bảng "Giao diện module"): chỉ đọc, không ghi bảng nào, không audit, không event; trả bộ trường tối thiểu, không dữ liệu cá nhân ngoài `getRecipient` (SB-08 b).
 * Đơn người khác và đơn không tồn tại cho cùng kết quả `null` (SB-06). Tổng hợp cho DSH: khoảng UTC nửa mở, một câu SQL mỗi lời gọi, GROUP BY ở CSDL, không `user_id`, không địa chỉ.
 * Đọc dữ liệu đã commit (READ COMMITTED), không bộ nhớ đệm (cache 60 giây là của DSH, ADR-020).
 */
@Injectable()
export class InternalService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly clock: Clock) {}

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
    const [r] = await this.prisma.$queryRaw<{ order_id: string; code: string; user_id: string; status: OrderStatus; payment_method: PaymentMethod; grand_total: bigint; payment_expires_at: Date | null }[]>`
      SELECT id AS order_id, code, user_id, status::text AS status, payment_method::text AS payment_method, grand_total, payment_expires_at FROM orders WHERE id = ${orderId}::uuid`;
    return r ? { ...r, grand_total: Number(r.grand_total) } : null;
  }

  private shipment(where: Prisma.Sql) {
    return this.prisma.$queryRaw<{ order_id: string; code: string; status: OrderStatus; payment_method: PaymentMethod; grand_total: bigint; shipping_method_id: string }[]>`
      SELECT id AS order_id, code, status::text AS status, payment_method::text AS payment_method, grand_total, shipping_method_id FROM orders WHERE ${where}`
      .then(([r]) => (r ? { ...r, grand_total: Number(r.grand_total) } : null));
  }
  async findForShipment(orderId: string) { return isUuid(orderId) ? this.shipment(Prisma.sql`id = ${orderId}::uuid`) : null; }
  async findByCode(code: string) { const c = upperCode(code); return CODE_RE.test(c) ? this.shipment(Prisma.sql`code = ${c}`) : null; }
  /** Đơn của người khác, không tồn tại và mã sai định dạng: cùng `null`. */
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
}
