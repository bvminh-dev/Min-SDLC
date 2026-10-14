import { ALL_PATHS, createDshApp, get, order, paid, people, REPORT, reset, DASH, q, type DshApp, type People } from '../support/dsh';

// Bổ sung của review DSH (khoảng trống mà đột biến của reviewer chỉ ra): (1) ranh giới đoạn gọi nguồn 960 giờ của báo cáo 366 ngày: đúng giao dịch ở -1 giây, 0, +1 giây của MỖI ranh giới đoạn
// (mốc ngẫu nhiên của load.spec gần như không rơi vào giờ đó, nên đoạn chồng một giờ lọt cả bộ test); (2) `Cache-Control: private, no-store` ở CẢ chín endpoint (trước đó chỉ kiểm ở doanh thu).
// Số liệu mong đợi từ truy vấn SQL độc lập theo múi giờ `Asia/Ho_Chi_Minh` của PostgreSQL, không dùng mã của DSH hay của module nguồn.
const SEC = 'DSH-SEC-20261006-105535103';
const TZ = 'Asia/Ho_Chi_Minh';
const HOUR = 3_600_000;
const START = Date.parse('2025-10-05T17:00:00Z'); // 2025-10-06 00:00 giờ Việt Nam: đầu khoảng 366 ngày kết thúc ngày 2026-10-06
const END = Date.parse('2026-10-06T17:00:00Z');

describe('DSH review: ranh giới đoạn 960 giờ và Cache-Control mọi endpoint', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });

  /** -1 giây, 0, +1 giây quanh mỗi ranh giới đoạn (từ đoạn 2 tới đoạn 10), cộng hai đầu khoảng: có mốc nằm ngoài khoảng (START - 1 giây, END). */
  const edges = (): number[] => {
    const out: number[] = [START - 1000, START, START + 1000, END - 1000, END];
    for (let k = 1; k <= 9; k++) { const e = START + k * 960 * HOUR; out.push(e - 1000, e, e + 1000); }
    return out;
  };

  it(`DSH-TC-20261006-110331380 (ranh giới đoạn): báo cáo doanh thu 366 ngày không đếm trùng, không bỏ sót giao dịch ở ranh giới các đoạn gọi nguồn; từng mốc, tổng và ô doanh thu khớp SQL độc lập (${SEC} T5)`, async () => {
    for (const [i, at] of edges().entries()) {
      const refundAt = new Date(Math.min(at + 2 * HOUR, Date.parse('2026-10-06T03:00:00Z')));
      await paid(t, new Date(at), { amount: 1000 * (i + 1), method: i % 2 ? 'cod' : 'vnpay', refund: i % 3 === 0 && i % 2 === 0 ? { at: refundAt } : undefined });
    }
    const res = await get(t, p.admin.cookie, `${REPORT.revenue}?from=2025-10-06&to=2026-10-06`);
    expect(res.status).toBe(200);
    const gross = await q<{ b: string; s: string; n: number }>(t, `SELECT to_char(date_trunc('month', paid_at AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS b, sum(amount)::text AS s, count(*)::int AS n FROM payments
      WHERE status IN ('succeeded', 'refunded') AND paid_at >= '${new Date(START).toISOString()}' AND paid_at < '${new Date(END).toISOString()}' GROUP BY 1`);
    const refunds = await q<{ b: string; s: string }>(t, `SELECT to_char(date_trunc('month', f.resolved_at AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS b, sum(f.amount)::text AS s FROM refunds f JOIN payments p ON p.id = f.payment_id
      WHERE f.status = 'succeeded' AND p.status = 'refunded' AND f.resolved_at >= '${new Date(START).toISOString()}' AND f.resolved_at < '${new Date(END).toISOString()}' GROUP BY 1`);
    const want = new Map<string, { gross: number; refunded: number; payment_count: number }>();
    const cell = (k: string) => want.get(k) ?? (want.set(k, { gross: 0, refunded: 0, payment_count: 0 }), want.get(k)!);
    for (const r of gross) { cell(r.b).gross += Number(r.s); cell(r.b).payment_count += r.n; }
    for (const r of refunds) cell(r.b).refunded += Number(r.s);
    const totalCount = [...want.values()].reduce((s, x) => s + x.payment_count, 0);
    expect(totalCount).toBe(edges().length - 2); // đúng hai mốc ngoài khoảng bị loại (START - 1 giây và END)
    expect(res.body.granularity).toBe('month');
    for (const b of res.body.buckets) expect([b.bucket_start, b.gross, b.refunded, b.payment_count]).toEqual([b.bucket_start, want.get(b.bucket_start)?.gross ?? 0, want.get(b.bucket_start)?.refunded ?? 0, want.get(b.bucket_start)?.payment_count ?? 0]);
    const tg = [...want.values()].reduce((s, x) => s + x.gross, 0), tr = [...want.values()].reduce((s, x) => s + x.refunded, 0);
    expect(res.body.totals).toEqual({ gross: tg, refunded: tr, net: tg - tr, payment_count: totalCount });
    const dash = await get(t, p.admin.cookie, `${DASH.revenue}?from=2025-10-06&to=2026-10-06`);
    expect([dash.body.gross, dash.body.refunded, dash.body.net, dash.body.payment_count]).toEqual([tg, tr, tg - tr, totalCount]);
  });

  it(`DSH-TC-20261006-110331380 (ranh giới đoạn): báo cáo đơn 366 ngày không đếm trùng, không bỏ sót đơn (theo ngày tạo) và đơn đã thu (theo ngày thu) ở ranh giới các đoạn; giá trị trung bình khớp SQL (${SEC} T5)`, async () => {
    const statuses = ['pending', 'confirmed', 'paid', 'delivered', 'cancelled', 'expired'] as const;
    for (const [i, at] of edges().entries()) {
      const status = statuses[i % statuses.length];
      const succeeded = status === 'paid' || status === 'delivered';
      await order(t, { status, payment: succeeded ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'pending', createdAt: new Date(at), paidAt: succeeded ? new Date(at) : null, method: 'vnpay', noHistory: true, items: [{ price: 10_000 * (i + 1), qty: 1 }], shipping: 0 });
    }
    const res = await get(t, p.admin.cookie, `${REPORT.orders}?from=2025-10-06&to=2026-10-06`);
    expect(res.status).toBe(200);
    const from = new Date(START).toISOString(), to = new Date(END).toISOString();
    const rows = await q<{ b: string; status: string; n: number }>(t, `SELECT to_char(date_trunc('month', created_at AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS b, status::text, count(*)::int AS n FROM orders WHERE created_at >= '${from}' AND created_at < '${to}' GROUP BY 1, 2`);
    const [paidAgg] = await q<{ n: number; s: string | null }>(t, `SELECT count(*)::int AS n, sum(grand_total)::text AS s FROM orders WHERE payment_status = 'succeeded' AND paid_at >= '${from}' AND paid_at < '${to}'`);
    const want = new Map<string, Record<string, number>>();
    for (const r of rows) want.set(r.b, { ...(want.get(r.b) ?? {}), [r.status]: r.n });
    const total = rows.reduce((s, r) => s + r.n, 0);
    expect(total).toBe(edges().length - 2);
    for (const b of res.body.buckets) {
      const w = want.get(b.bucket_start) ?? {};
      for (const s of ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired']) expect([b.bucket_start, s, b.by_status[s]]).toEqual([b.bucket_start, s, w[s] ?? 0]);
    }
    expect(res.body.totals.total).toBe(total);
    expect(res.body.totals.average_order_value).toBe(Math.floor(Number(paidAgg.s) / paidAgg.n));
    expect(paidAgg.n).toBeGreaterThan(8);
  });

  it(`DSH-TC-20261013-232147375 (DSH-REQ-20261006-105126549 Cache-Control): cả chín endpoint trả Cache-Control: private, no-store ở 200, lần đọc nguồn lẫn lần lấy từ bộ nhớ đệm, và ở 400 và 503`, async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 100_000 });
    for (const path of ALL_PATHS) {
      for (const pass of ['nguồn', 'đệm']) {
        const r = await get(t, p.admin.cookie, path);
        expect([path, pass, r.status, r.headers['cache-control']]).toEqual([path, pass, 200, 'private, no-store']);
      }
    }
    const bad = await get(t, p.admin.cookie, `${DASH.revenue}?from=khong-phai-ngay`);
    expect([bad.status, bad.headers['cache-control']]).toEqual([400, 'private, no-store']);
    t.cache.clear();
    jest.spyOn(t.catalog, 'countByStatus').mockRejectedValue(new Error('boom'));
    const down = await get(t, p.admin.cookie, DASH.products);
    expect([down.status, down.headers['cache-control']]).toEqual([503, 'private, no-store']);
  });
});
