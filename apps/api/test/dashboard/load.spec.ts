import { createDshApp, DASH, get, order, paid, people, product, REPORT, reset, q, type DshApp, type People, type Status } from '../support/dsh';

// Tải hỗn hợp kiểm BẢO TOÀN (DSH-SEC-20261006-105535103 T5, SB-23): dựng dữ liệu rải 14 tháng (có mốc đúng ranh giới ngày giờ Việt Nam), rồi so từng mốc, tổng và danh sách của DSH với truy vấn ĐỘC LẬP
// ở CSDL (múi giờ `Asia/Ho_Chi_Minh` của PostgreSQL, không dùng mã của DSH hay của module nguồn): khoảng 31 ngày (ngày), 92 (tuần), 279 và 366 (tháng, chia nhiều đoạn gọi nguồn).
const SEC = 'DSH-SEC-20261006-105535103';
const TZ = 'Asia/Ho_Chi_Minh';
let seed = 20261006;
const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const MS = 86_400_000;

describe('DSH tải hỗn hợp: tổng DSH bằng tổng nguồn (DSH-SEC-20261006-105535103 T5)', () => {
  let t: DshApp;
  let p: People;
  let prods: string[];
  beforeAll(async () => {
    t = await createDshApp();
    await reset(t);
    p = await people(t);
    prods = [];
    for (let i = 0; i < 8; i++) prods.push(await product(t, { name: `Hàng tải ${i}` }));
    const start = Date.parse('2025-08-01T00:00:00Z'), span = Date.parse('2026-10-06T03:00:00Z') - start;
    const edges = [Date.parse('2025-10-05T17:00:00Z'), Date.parse('2026-01-31T17:00:00Z'), Date.parse('2026-02-28T17:00:00Z'), Date.parse('2026-06-28T17:00:00Z'), Date.parse('2026-07-05T17:00:00Z'), Date.parse('2026-08-31T17:00:00Z'), Date.parse('2026-09-05T17:00:00Z'), Date.parse('2026-09-06T17:00:00Z'), Date.parse('2026-10-05T17:00:00Z')];
    const instants = [...edges.flatMap((e) => [e - 1000, e, e + 1000]), ...Array.from({ length: 90 }, () => start + rnd(span))]; // mốc ranh giới ngày cộng 90 mốc ngẫu nhiên
    for (const [i, at] of instants.entries()) {
      const refunded = i % 4 === 0;
      await paid(t, new Date(at), { amount: 10_000 * (1 + rnd(40)), method: i % 3 === 0 ? 'cod' : 'vnpay', refund: refunded && i % 3 !== 0 ? { at: new Date(Math.min(at + rnd(40) * MS, Date.parse('2026-10-06T03:00:00Z'))) } : undefined });
    }
    const statuses: Status[] = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'];
    for (let i = 0; i < 160; i++) {
      const created = i < edges.length * 2 ? edges[i % edges.length] - (i < edges.length ? 1000 : 0) : start + rnd(span);
      const status = statuses[rnd(statuses.length)];
      const payment = (['paid', 'shipped', 'delivered', 'returned'] as Status[]).includes(status) ? (rnd(5) === 0 ? 'refunded' : 'succeeded') : status === 'cancelled' ? 'cancelled' : 'pending';
      const paidAt = payment === 'succeeded' || payment === 'refunded' ? new Date(created + rnd(5 * MS)) : null;
      await order(t, { status, payment, createdAt: new Date(created), paidAt, method: status === 'confirmed' ? 'cod' : 'vnpay', noHistory: true, items: [{ product: prods[rnd(8)], price: 10_000 * (1 + rnd(20)), qty: 1 + rnd(4) }, { product: prods[rnd(8)], price: 5_000 * (1 + rnd(10)), qty: 1 + rnd(3) }] });
    }
  }, 180_000);
  afterAll(() => t.close());
  beforeEach(async () => { t.cache.clear(); await t.prisma.$executeRaw`TRUNCATE rate_limit_counters`; });

  const day = (d: string) => Date.parse(`${d}T00:00:00+07:00`);
  const kind = (days: number) => (days <= 31 ? 'day' : days <= 92 ? 'week' : 'month');
  const RANGES: [string, string][] = [['2026-09-06', '2026-10-06'], ['2026-07-07', '2026-10-06'], ['2026-01-01', '2026-10-06'], ['2025-10-06', '2026-10-06']];
  const days = (a: string, b: string) => Math.round((day(b) - day(a)) / MS) + 1;
  const bounds = (a: string, b: string) => `${new Date(day(a)).toISOString()}::timestamptz`.replace('::timestamptz', '') && [new Date(day(a)).toISOString(), new Date(day(b) + MS).toISOString()];
  const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

  it.each(RANGES)(`${SEC}: báo cáo doanh thu từ %s tới %s khớp truy vấn độc lập từng mốc, tổng và theo phương thức, và khớp ô doanh thu`, async (a, b) => {
    const [from, to] = bounds(a, b);
    const g = kind(days(a, b));
    const bucket = `date_trunc('${g}', %COL% AT TIME ZONE '${TZ}')::date`;
    const gross = await q<{ b: Date; s: string; n: number; m: string }>(t, `SELECT ${bucket.replace('%COL%', 'paid_at')} AS b, method::text AS m, sum(amount)::text AS s, count(*)::int AS n FROM payments WHERE status IN ('succeeded', 'refunded') AND paid_at >= '${from}' AND paid_at < '${to}' GROUP BY 1, 2`);
    const refunds = await q<{ b: Date; s: string; m: string }>(t, `SELECT ${bucket.replace('%COL%', 'f.resolved_at')} AS b, p.method::text AS m, sum(f.amount)::text AS s FROM refunds f JOIN payments p ON p.id = f.payment_id WHERE f.status = 'succeeded' AND p.status = 'refunded' AND f.resolved_at >= '${from}' AND f.resolved_at < '${to}' GROUP BY 1, 2`);
    const want = new Map<string, { gross: number; refunded: number; payment_count: number }>();
    const by: Record<string, { gross: number; refunded: number; payment_count: number }> = { vnpay: { gross: 0, refunded: 0, payment_count: 0 }, cod: { gross: 0, refunded: 0, payment_count: 0 } };
    const cell = (k: string) => want.get(k) ?? (want.set(k, { gross: 0, refunded: 0, payment_count: 0 }), want.get(k)!);
    for (const r of gross) { cell(ymd(r.b)).gross += Number(r.s); cell(ymd(r.b)).payment_count += r.n; by[r.m].gross += Number(r.s); by[r.m].payment_count += r.n; }
    for (const r of refunds) { cell(ymd(r.b)).refunded += Number(r.s); by[r.m].refunded += Number(r.s); }
    const res = await get(t, p.admin.cookie, `${REPORT.revenue}?from=${a}&to=${b}`);
    expect(res.status).toBe(200);
    expect(res.body.granularity).toBe(g);
    const got = new Map<string, Record<string, number>>(res.body.buckets.map((x: Record<string, number | string>) => [String(x.bucket_start), x as Record<string, number>]));
    expect(got.size).toBe(res.body.buckets.length);
    for (const k of want.keys()) expect([k, got.has(k)]).toEqual([k, true]); // không mốc nào của nguồn bị rơi
    for (const [k, v] of got) expect([k, v.gross, v.refunded, v.net, v.payment_count]).toEqual([k, want.get(k)?.gross ?? 0, want.get(k)?.refunded ?? 0, (want.get(k)?.gross ?? 0) - (want.get(k)?.refunded ?? 0), want.get(k)?.payment_count ?? 0]);
    const tg = [...want.values()].reduce((s, x) => s + x.gross, 0), tr = [...want.values()].reduce((s, x) => s + x.refunded, 0), tc = [...want.values()].reduce((s, x) => s + x.payment_count, 0);
    expect(res.body.totals).toEqual({ gross: tg, refunded: tr, net: tg - tr, payment_count: tc });
    for (const m of ['vnpay', 'cod']) expect([m, res.body.by_method[m]]).toEqual([m, { ...by[m], net: by[m].gross - by[m].refunded }]);
    const dash = await get(t, p.admin.cookie, `${DASH.revenue}?from=${a}&to=${b}`);
    expect([dash.body.gross, dash.body.refunded, dash.body.net, dash.body.payment_count]).toEqual([tg, tr, tg - tr, tc]);
    expect(tc).toBeGreaterThan(0);
    if (a === '2025-10-06') expect(res.body.buckets).toHaveLength(13); // 10/2025 tới 10/2026: nhiều đoạn gọi nguồn mà không mất hay trùng số
  });

  it.each(RANGES)(`${SEC}: báo cáo đơn từ %s tới %s khớp truy vấn độc lập từng mốc theo tám trạng thái, tổng, tỷ lệ và giá trị trung bình`, async (a, b) => {
    const [from, to] = bounds(a, b);
    const g = kind(days(a, b));
    const rows = await q<{ b: Date; status: string; n: number }>(t, `SELECT date_trunc('${g}', created_at AT TIME ZONE '${TZ}')::date AS b, status::text, count(*)::int AS n FROM orders WHERE created_at >= '${from}' AND created_at < '${to}' GROUP BY 1, 2`);
    const [paidAgg] = await q<{ n: number; s: string | null }>(t, `SELECT count(*)::int AS n, sum(grand_total)::text AS s FROM orders WHERE payment_status = 'succeeded' AND paid_at >= '${from}' AND paid_at < '${to}'`);
    const res = await get(t, p.admin.cookie, `${REPORT.orders}?from=${a}&to=${b}`);
    expect(res.status).toBe(200);
    const want = new Map<string, Record<string, number>>();
    for (const r of rows) { const k = ymd(r.b); want.set(k, { ...(want.get(k) ?? {}), [r.status]: r.n }); }
    for (const x of res.body.buckets) {
      const w = want.get(x.bucket_start) ?? {};
      for (const s of ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired']) expect([x.bucket_start, s, x.by_status[s]]).toEqual([x.bucket_start, s, w[s] ?? 0]);
      expect(x.total).toBe(Object.values(w).reduce((s, n) => s + n, 0));
    }
    for (const k of want.keys()) expect(res.body.buckets.some((x: { bucket_start: string }) => x.bucket_start === k)).toBe(true);
    const total = rows.reduce((s, r) => s + r.n, 0);
    const cancelled = rows.filter((r) => r.status === 'cancelled').reduce((s, r) => s + r.n, 0), expired = rows.filter((r) => r.status === 'expired').reduce((s, r) => s + r.n, 0);
    expect(res.body.totals.total).toBe(total);
    expect(res.body.totals.cancel_rate).toBe(total ? Math.round((cancelled * 1000) / total + 1e-9) / 10 : null);
    expect(res.body.totals.expired_rate).toBe(total ? Math.round((expired * 1000) / total + 1e-9) / 10 : null);
    expect(res.body.totals.average_order_value).toBe(paidAgg.n ? Math.floor(Number(paidAgg.s) / paidAgg.n) : null);
    const dash = await get(t, p.admin.cookie, `${DASH.orders}?from=${a}&to=${b}`);
    expect([dash.body.total, dash.body.by_status]).toEqual([total, res.body.totals.by_status]);
    expect(total).toBeGreaterThan(0);
  });

  it(`${SEC}: báo cáo sản phẩm khớp truy vấn độc lập (số lượng, giá trị, tổng toàn khoảng, thứ tự) cho cả hai cách xếp`, async () => {
    const [from, to] = bounds('2026-07-07', '2026-10-06');
    const rows = await q<{ product_id: string; units: string; amount: string }>(t, `SELECT i.product_id, sum(i.quantity)::text AS units, sum(i.unit_price * i.quantity)::text AS amount FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.payment_status = 'succeeded' AND o.paid_at >= '${from}' AND o.paid_at < '${to}' AND o.status NOT IN ('cancelled', 'expired', 'returned') GROUP BY i.product_id`);
    expect(rows.length).toBeGreaterThan(3);
    const sorted = (by: 'units' | 'amount') => [...rows].sort((x, y) => (by === 'units' ? Number(y.units) - Number(x.units) || Number(y.amount) - Number(x.amount) : Number(y.amount) - Number(x.amount) || Number(y.units) - Number(x.units)) || (x.product_id < y.product_id ? -1 : 1));
    for (const by of ['units', 'amount'] as const) {
      const res = await get(t, p.admin.cookie, `${REPORT.products}?from=2026-07-07&to=2026-10-06&sort=${by}&limit=5`);
      expect(res.body.items.map((i: { product_id: string; units_sold: number; items_amount: number }) => [i.product_id, i.units_sold, i.items_amount])).toEqual(sorted(by).slice(0, 5).map((r) => [r.product_id, Number(r.units), Number(r.amount)]));
      expect([res.body.units_total, res.body.distinct_products]).toEqual([rows.reduce((s, r) => s + Number(r.units), 0), rows.length]);
      for (const i of res.body.items) expect([i.product_id, i.name]).toEqual([i.product_id, prods.includes(i.product_id) ? expect.stringMatching(/^Hàng tải \d$/) : '']); // dòng đơn của Payment mồi trỏ sản phẩm không có ở PRD: tên rỗng
    }
  });
});
