import { createDshApp, DASH, get, order, people, REPORT, reset, withTimeout, later, zeroStatus, type DshApp, type People, type Status } from '../support/dsh';

// DSH-REQ-20261006-105126368 (báo cáo đơn): OrderApi.getOrderSeries theo giờ UTC, DSH gộp theo ngày, tuần, tháng giờ Việt Nam; tỷ lệ làm tròn nửa lên một chữ số, giá trị trung bình làm tròn xuống.
describe('DSH báo cáo đơn (DSH-REQ-20261006-105126368)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const report = (qs = '?from=2026-09-01&to=2026-09-30', cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, `${REPORT.orders}${qs}`);
  const at = (day: number, k = 0) => new Date(Date.parse(`2026-09-${String(day).padStart(2, '0')}T03:00:00Z`) + k * 1000);

  it('DSH-TC-20261006-110331609: 200 đơn, tỷ lệ hủy 15,0, hết hạn 4,0, giá trị trung bình 350.000, totals khớp ô tổng đơn', async () => {
    const plan: [Status, number, 'succeeded' | 'pending' | 'cancelled' | 'expired'][] = [['delivered', 118, 'succeeded'], ['returned', 1, 'succeeded'], ['delivered', 1, 'succeeded'], ['shipped', 10, 'succeeded'], ['paid', 20, 'succeeded'],
      ['confirmed', 10, 'pending'], ['pending', 2, 'pending'], ['cancelled', 30, 'cancelled'], ['expired', 8, 'expired']];
    let i = 0;
    for (const [status, n, payment] of plan) for (let k = 0; k < n; k++, i++) await order(t, { status, payment, method: status === 'confirmed' ? 'cod' : 'vnpay', createdAt: at(1 + (i % 30), i), items: [{ price: 320_000, qty: 1 }], shipping: 30_000, noHistory: true });
    const r = await report();
    expect(r.status).toBe(200);
    expect([r.body.granularity, r.body.buckets.length]).toEqual(['day', 30]);
    expect(r.body.buckets.reduce((s: number, b: { total: number }) => s + b.total, 0)).toBe(200);
    expect(r.body.totals.total).toBe(200);
    expect(r.body.totals.by_status).toEqual({ pending: 2, confirmed: 10, paid: 20, shipped: 10, delivered: 119, returned: 1, cancelled: 30, expired: 8 });
    expect([r.body.totals.cancel_rate, r.body.totals.expired_rate, r.body.totals.average_order_value]).toEqual([15, 4, 350000]);
    expect(r.text).toMatch(/"cancel_rate":15,/);
    for (const b of r.body.buckets) expect(Object.values(b.by_status as Record<string, number>).reduce((s, n) => s + n, 0)).toBe(b.total);
    const d = await get(t, p.admin.cookie, `${DASH.orders}?from=2026-09-01&to=2026-09-30`);
    expect(d.body.total).toBe(r.body.totals.total);
    expect(d.body.by_status).toEqual(r.body.totals.by_status);
  });

  it('DSH-TC-20261006-110331642: staff và customer nhận 403, chưa đăng nhập 401 ở báo cáo đơn', async () => {
    const spy = jest.spyOn(t.ord, 'getOrderSeries');
    for (const w of [p.staff, p.customer]) { const r = await report(undefined, w.cookie); expect([r.status, r.text.includes('buckets')]).toEqual([403, false]); }
    expect((await report(undefined, null)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110331671: khoảng 367 ngày hoặc ngày thiếu số 0 nhận 400, ORD được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.ord, 'getOrderSeries');
    const a = await report('?from=2025-10-05&to=2026-10-06');
    expect([a.status, a.body.type]).toEqual([400, 'urn:ecom:error:invalid-parameter']);
    const b = await report('?from=2026-9-1');
    expect([b.status, b.body.errors[0].field]).toEqual([400, 'from']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110331700: ORD quá hạn trả 503 nguồn ORD ở báo cáo đơn', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.ord, 'getOrderSeries').mockImplementation(() => later(1500, []));
    const r = await report();
    expect([r.status, r.body.source]).toEqual([503, 'ORD']);
    expect(r.text).not.toMatch(/buckets|totals/);
  });

  it('DSH-TC-20261006-110331728: không có đơn nào thì tỷ lệ và giá trị trung bình là null, không phải 0, mọi mốc đủ tám khóa', async () => {
    const r = await report();
    expect(r.body.totals).toEqual({ total: 0, by_status: zeroStatus(), cancel_rate: null, expired_rate: null, average_order_value: null });
    expect(r.body.buckets).toHaveLength(30);
    expect(r.body.buckets.every((b: { total: number; by_status: object }) => b.total === 0 && Object.keys(b.by_status).length === 8)).toBe(true);
  });

  it('DSH-TC-20261006-110331757: giá trị trung bình chỉ tính đơn payment_status succeeded (đơn đã hoàn tiền và COD chưa thu bị loại)', async () => {
    await order(t, { status: 'delivered', payment: 'succeeded', createdAt: at(2), items: [{ price: 70_000, qty: 1 }], shipping: 30_000 });
    await order(t, { status: 'cancelled', payment: 'refunded', createdAt: at(2, 1), paidAt: at(2, 1), items: [{ price: 370_000, qty: 1 }], shipping: 30_000 });
    await order(t, { status: 'shipped', method: 'cod', payment: 'pending', createdAt: at(2, 2), items: [{ price: 220_000, qty: 1 }], shipping: 30_000 });
    expect((await report()).body.totals.average_order_value).toBe(100000);
  });

  it('DSH-TC-20261006-110331785: tỷ lệ hủy làm tròn nửa lên một chữ số, 1 trên 7 là 14,3 và tỷ lệ hết hạn 0,0', async () => {
    await order(t, { status: 'cancelled', createdAt: at(3) });
    for (let i = 0; i < 6; i++) await order(t, { status: 'paid', createdAt: at(3, i + 1) });
    const r = await report();
    expect([r.body.totals.cancel_rate, r.body.totals.expired_rate]).toEqual([14.3, 0]);
    // nửa lên: 1/8 = 12,5 và 1/16 = 6,25 làm tròn thành 12,5 và 6,3 (không phải 6,2 của làm tròn về chẵn)
    const { percent1 } = await import('../../src/modules/dashboard/blocks.service');
    expect([percent1(1, 8), percent1(1, 16), percent1(1, 7), percent1(2, 3), percent1(0, 5), percent1(5, 5), percent1(1, 0)]).toEqual([12.5, 6.3, 14.3, 66.7, 0, 100, null]);
  });

  it('DSH-TC-20261006-110331813: giá trị trung bình làm tròn xuống, 200.001 chia 2 là 100.000', async () => {
    await order(t, { status: 'delivered', payment: 'succeeded', createdAt: at(4), items: [{ price: 70_000, qty: 1 }], shipping: 30_000 });
    await order(t, { status: 'delivered', payment: 'succeeded', createdAt: at(4, 1), items: [{ price: 70_001, qty: 1 }], shipping: 30_000 });
    expect((await report()).body.totals.average_order_value).toBe(100000);
  });
});
