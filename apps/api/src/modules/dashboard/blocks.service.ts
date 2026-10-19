import { Injectable } from '@nestjs/common';
import { CatalogApi } from '../catalog';
import { InventoryApi } from '../inventory';
import { OrderApi } from '../order';
import { PaymentApi, type RevenueTotals } from '../payment';
import { UserApi } from '../user';
import { DELETED_LABEL, LOW_STOCK_LIMIT, ORDER_STATUSES, RECENT_LIMIT, WEBSITE_LABEL, type OrderStatus } from './config';
import { bucketList, bucketStart, civil, fmt, granularityOf, hourChunks, ictDayOf, isoZ, type DateRange, type Granularity } from './range';
import { SourceGate } from './sources.service';

type Body = Record<string, unknown>;
const zeroStatuses = (): Record<OrderStatus, number> => Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
const sum = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);
/** So sánh theo đơn vị mã (không theo locale): thứ tự cố định giữa các máy, khớp tệp CSV. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sum2 = <K extends string>(rows: Record<K, number>[], k: K): number => rows.reduce((n, x) => n + x[k], 0);
const money = (t: RevenueTotals) => ({ gross: t.gross, refunded: t.refunded, net: t.gross - t.refunded, payment_count: t.payment_count });
const addMoney = (a: RevenueTotals, b: RevenueTotals): void => { a.gross += b.gross; a.refunded += b.refunded; a.payment_count += b.payment_count; a.net = a.gross - a.refunded; };
const zeroMoney = (): RevenueTotals => ({ gross: 0, refunded: 0, net: 0, payment_count: 0 });
/** Phần trăm một chữ số thập phân, làm tròn nửa lên, bằng số nguyên (không sai số nhị phân): 1/7 thành 14,3. */
export const percent1 = (part: number, total: number): number | null => (total === 0 ? null : Math.floor((part * 2000 + total) / (2 * total)) / 10);

/**
 * Dựng từng khối từ giao diện đọc của module chủ (ADR-020): DSH không đọc bảng nào, không tự cộng tiền từ nguồn khác (SB-23, SB-35). Mọi lời gọi qua `SourceGate` (hạn 5 giây, 503 khi lỗi).
 * Tiền là số nguyên VND. Phản hồi theo danh sách trắng trường (SB-08): dù nguồn trả thừa trường nào, trường đó không ra khỏi đây.
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly gate: SourceGate, private readonly orders: OrderApi, private readonly catalog: CatalogApi, private readonly inventory: InventoryApi,
    private readonly users: UserApi, private readonly payments: PaymentApi,
  ) {}

  /** Doanh thu theo PAY (một phương thức `getRevenue` dùng chung với báo cáo, T5) và hàng đợi hoàn tiền thất bại (không phụ thuộc khoảng ngày). */
  async revenue(r: DateRange): Promise<Body> {
    const [rev, failed] = await this.gate.call('PAY', () => Promise.all([this.payments.getRevenue({ from: r.fromUtc, to: r.toUtc }), this.payments.countFailedRefunds()]));
    return { from: r.from, to: r.to, ...money(rev.totals), failed_refund_count: failed };
  }

  async orderTotals(r: DateRange): Promise<Body> {
    const by = await this.gate.call('ORD', () => this.orders.countByStatus({ from: r.fromUtc, to: r.toUtc }));
    const by_status = { ...zeroStatuses(), ...Object.fromEntries(ORDER_STATUSES.map((s) => [s, by[s] ?? 0])) } as Record<OrderStatus, number>;
    const total = sum(by_status);
    return { from: r.from, to: r.to, total, effective: total - by_status.cancelled - by_status.expired - by_status.returned, by_status };
  }

  async customers(r: DateRange): Promise<Body> {
    const c = await this.gate.call('USR', () => this.users.countCustomers({ from: r.fromUtc, to: r.toUtc }));
    return { from: r.from, to: r.to, total: c.total, locked: c.locked, new_in_range: c.new_in_range };
  }

  async products(): Promise<Body> {
    const c = await this.gate.call('PRD', () => this.catalog.countByStatus());
    const by_status = { active: c.active, draft: c.draft, archived: c.archived };
    return { total: by_status.active + by_status.draft + by_status.archived, by_status };
  }

  async lowStock(): Promise<Body> {
    const s = await this.gate.call('INV', () => this.inventory.getLowStockSummary(LOW_STOCK_LIMIT));
    return { count: s.count, items: s.items.slice(0, LOW_STOCK_LIMIT).map((i) => ({ product_id: i.product_id, name: i.name, sku: i.sku, available: i.available, low_stock_threshold: i.low_stock_threshold })) };
  }

  async recentOrders(): Promise<Body> {
    const rows = await this.gate.call('ORD', () => this.orders.listRecent(RECENT_LIMIT));
    return { items: rows.slice(0, RECENT_LIMIT).map((o) => ({ code: o.code, created_at: isoZ(o.created_at), status: o.status, grand_total: o.grand_total, payment_method: o.payment_method, payment_status: o.payment_status, item_count: o.item_count })) };
  }

  /**
   * Báo cáo doanh thu: PAY chia theo GIỜ UTC (mốc ngày UTC lệch ngày Việt Nam 7 giờ), DSH gộp các giờ thành ngày, tuần (thứ Hai) hoặc tháng theo giờ Việt Nam; tổng và theo phương thức
   * là tổng của các đoạn gọi PAY, nên tổng các mốc luôn bằng `totals` (BR5) và `totals` bằng ô doanh thu của cùng khoảng (cùng một phương thức nguồn).
   */
  async reportRevenue(r: DateRange): Promise<Body> {
    const g = granularityOf(r.days);
    const totals = zeroMoney(), by = { vnpay: zeroMoney(), cod: zeroMoney() };
    const buckets = new Map(bucketList(g, r.fromNum, r.toNum).map((n) => [n, zeroMoney()]));
    await this.gate.call('PAY', async () => {
      for (const c of hourChunks(r.fromUtc, r.toUtc)) {
        const rev = await this.payments.getRevenue(c, 'hour');
        addMoney(totals, rev.totals); addMoney(by.vnpay, rev.by_method.vnpay); addMoney(by.cod, rev.by_method.cod);
        for (const h of rev.series) addMoney(this.at(buckets, g, h.bucket_start), h);
      }
    });
    return {
      from: r.from, to: r.to, granularity: g,
      buckets: [...buckets].map(([n, t]) => ({ bucket_start: fmt(n), ...money(t) })),
      totals: money(totals), by_method: { vnpay: money(by.vnpay), cod: money(by.cod) },
    };
  }

  async reportOrders(r: DateRange): Promise<Body> {
    const g = granularityOf(r.days);
    const buckets = new Map(bucketList(g, r.fromNum, r.toNum).map((n) => [n, zeroStatuses()]));
    let paidOrders = 0, paidTotal = 0;
    await this.gate.call('ORD', async () => {
      for (const c of hourChunks(r.fromUtc, r.toUtc)) {
        for (const h of await this.orders.getOrderSeries(c, 'hour')) {
          const b = this.at(buckets, g, h.bucket_start);
          for (const s of ORDER_STATUSES) b[s] += h.orders[s] ?? 0;
          paidOrders += h.paid_orders; paidTotal += h.paid_total;
        }
      }
    });
    const all = zeroStatuses();
    for (const b of buckets.values()) for (const s of ORDER_STATUSES) all[s] += b[s];
    const total = sum(all);
    return {
      from: r.from, to: r.to, granularity: g,
      buckets: [...buckets].map(([n, b]) => ({ bucket_start: fmt(n), total: sum(b), by_status: b })),
      totals: { total, by_status: all, cancel_rate: percent1(all.cancelled, total), expired_rate: percent1(all.expired, total), average_order_value: paidOrders === 0 ? null : Math.floor(paidTotal / paidOrders) },
    };
  }

  /** `name` lấy từ PRD (ORD không trả tên); mọi số theo ORD, `items_amount` là giá trị hàng bán, không phải doanh thu (BR2). */
  async reportProducts(r: DateRange, sort: 'units' | 'amount', limit: number): Promise<Body> {
    const range = { from: r.fromUtc, to: r.toUtc };
    const { rows, totals } = await this.gate.call('ORD', async () => ({ rows: await this.orders.getTopProducts(range, sort === 'units' ? 'quantity' : 'amount', limit), totals: await this.orders.getProductSalesTotals(range) }));
    const names = new Map<string, string>();
    if (rows.length) for (const p of await this.gate.call('PRD', () => this.catalog.getSummaries(rows.map((x) => x.product_id)))) names.set(p.product_id, p.name);
    return {
      from: r.from, to: r.to, sort, limit, units_total: totals.units_total, distinct_products: totals.distinct_products,
      items: rows.slice(0, limit).map((x) => ({ product_id: x.product_id, name: names.get(x.product_id) ?? '', units_sold: x.quantity, items_amount: x.amount })),
    };
  }

  /**
   * Báo cáo theo nguồn đơn (DSH-REQ-20261015-092608812): ORD lọc ba trạng thái bị loại ngay trong truy vấn và trả mọi nguồn cần hiện; DSH chỉ sắp (`revenue` giảm dần, `code` tăng dần) và tự cộng `totals`
   * từ `items` (không gọi ORD lần hai, nên tổng dòng luôn bằng `totals`). `revenue` là giá trị đơn (`grand_total`), không phải tiền PAY (SB-23). Danh sách trắng trường: không trường cá nhân nào ra khỏi đây.
   */
  async reportSources(r: DateRange): Promise<Body> {
    const rep = await this.gate.call('ORD', () => this.orders.getSourcesReport({ from: r.fromUtc, to: r.toUtc }));
    const items = rep.items.map((i) => ({ source_id: i.source_id, code: i.code, name: i.name, is_active: i.is_active, orders: i.orders, revenue: i.revenue }))
      .sort((a, b) => b.revenue - a.revenue || cmp(a.code, b.code));
    return { from: r.from, to: r.to, items, totals: { orders: sum2(items, 'orders'), revenue: sum2(items, 'revenue'), excluded_orders: rep.excluded_orders } };
  }

  /**
   * Báo cáo theo sale (DSH-REQ-20261015-092608849): ORD nhóm theo `created_by` và tra tên theo lô từ AUTH (lỗi tra tên thì ném nguyên, thành 503 `ORD`, không trả danh sách thiếu tên). Nhóm `created_by` rỗng
   * (khách tự đặt) thành dòng `website` luôn có, đứng riêng ngoài `items`; tên không tra được thì nhãn "(tài khoản đã xóa)", dòng và tiền vẫn vào tổng. Không email, điện thoại, địa chỉ của ai.
   */
  async reportSales(r: DateRange): Promise<Body> {
    const rep = await this.gate.call('ORD', () => this.orders.getSalesReport({ from: r.fromUtc, to: r.toUtc }));
    const web = { name: WEBSITE_LABEL, orders: 0, revenue: 0 };
    const items: { user_id: string; name: string; orders: number; revenue: number }[] = [];
    for (const i of rep.items) {
      if (i.created_by === null) { web.orders += i.orders; web.revenue += i.revenue; } else items.push({ user_id: i.created_by, name: i.name ?? DELETED_LABEL, orders: i.orders, revenue: i.revenue });
    }
    items.sort((a, b) => b.revenue - a.revenue || cmp(a.name, b.name) || cmp(a.user_id, b.user_id));
    return { from: r.from, to: r.to, items, website: web, totals: { orders: sum2(items, 'orders') + web.orders, revenue: sum2(items, 'revenue') + web.revenue, excluded_orders: rep.excluded_orders } };
  }

  /** Mốc (theo giờ Việt Nam) của một giờ UTC `bucket_start` (ISO). */
  private at<T>(map: Map<number, T>, g: Granularity, hourIso: string): T {
    const key = bucketStart(g, ictDayOf(Date.parse(hourIso)));
    const b = map.get(key);
    if (!b) throw new Error(`mốc ${fmt(key)} ngoài khoảng đã dựng (${civil(key).y}): nguồn trả mốc ngoài khoảng yêu cầu`); // lỗi của nguồn: thành 503, không âm thầm bỏ số
    return b;
  }
}
