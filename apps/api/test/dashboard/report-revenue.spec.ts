import { createDshApp, DASH, get, paid, people, REPORT, reset, withTimeout, later, type DshApp, type People } from '../support/dsh';

// DSH-REQ-20261006-105126271 (báo cáo doanh thu): PaymentApi.getRevenue theo giờ UTC, DSH gộp theo ngày, tuần, tháng giờ Việt Nam.
describe('DSH báo cáo doanh thu (DSH-REQ-20261006-105126271)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const report = (qs: string, cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, `${REPORT.revenue}${qs}`);
  const Q30 = '?from=2026-09-01&to=2026-09-30';
  const z = { gross: 0, refunded: 0, net: 0, payment_count: 0 };
  /** Ca 30 ngày: thu VNPay 200.000 (02/09), thu COD 120.000 (10/09), hoàn toàn phần thanh toán 02/09 vào 20/09. */
  const month = async () => {
    await paid(t, new Date('2026-09-02T03:00:00Z'), { amount: 200_000, refund: { at: new Date('2026-09-20T03:00:00Z') } });
    await paid(t, new Date('2026-09-10T03:00:00Z'), { amount: 120_000, method: 'cod' });
  };

  it('DSH-TC-20261006-110331320: báo cáo 30 ngày chia theo ngày, mốc hoàn tiền âm, theo phương thức', async () => {
    await month();
    const r = await report(Q30);
    expect(r.status).toBe(200);
    expect([r.body.granularity, r.body.buckets.length, r.body.from, r.body.to]).toEqual(['day', 30, '2026-09-01', '2026-09-30']);
    const at = (d: string) => r.body.buckets.find((b: { bucket_start: string }) => b.bucket_start === d);
    expect(at('2026-09-02')).toEqual({ bucket_start: '2026-09-02', gross: 200000, refunded: 0, net: 200000, payment_count: 1 });
    expect(at('2026-09-10')).toMatchObject({ gross: 120000, net: 120000 });
    expect(at('2026-09-20')).toEqual({ bucket_start: '2026-09-20', gross: 0, refunded: 200000, net: -200000, payment_count: 0 });
    expect(at('2026-09-05')).toEqual({ bucket_start: '2026-09-05', ...z });
    expect(r.body.totals).toEqual({ gross: 320000, refunded: 200000, net: 120000, payment_count: 2 });
    expect(r.body.by_method.vnpay).toEqual({ gross: 200000, refunded: 200000, net: 0, payment_count: 1 });
    expect(r.body.by_method.cod).toEqual({ gross: 120000, refunded: 0, net: 120000, payment_count: 1 });
    expect(r.body.buckets.map((b: { bucket_start: string }) => b.bucket_start)).toEqual(Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`));
  });

  it('DSH-TC-20261006-110331351: báo cáo 92 ngày chia theo tuần, 14 mốc, mốc đầu và cuối bị cắt theo khoảng', async () => {
    await paid(t, new Date('2026-06-30T03:00:00Z'), { amount: 100_000 }); // 30/06: ngoài khoảng, thuộc tuần của 29/06 nhưng không được tính
    await paid(t, new Date('2026-07-01T03:00:00Z'), { amount: 100_000 });
    await paid(t, new Date('2026-09-30T03:00:00Z'), { amount: 100_000 });
    const r = await report('?from=2026-07-01&to=2026-09-30');
    expect([r.body.granularity, r.body.buckets.length]).toEqual(['week', 14]);
    expect(r.body.buckets[0]).toEqual({ bucket_start: '2026-06-29', gross: 100000, refunded: 0, net: 100000, payment_count: 1 });
    expect(r.body.buckets[13]).toMatchObject({ bucket_start: '2026-09-28', gross: 100000 });
    expect(r.body.totals.gross).toBe(200000);
    for (const b of r.body.buckets) expect(new Date(`${b.bucket_start}T00:00:00Z`).getUTCDay()).toBe(1); // mọi mốc tuần bắt đầu thứ Hai
  });

  it('DSH-TC-20261006-110331380: bất biến tổng mốc bằng totals, bằng ô doanh thu, hai phương thức cộng lại bằng totals, cùng một phương thức nguồn', async () => {
    await month();
    const spy = jest.spyOn(t.pay, 'getRevenue');
    const r = await report(Q30);
    const d = await get(t, p.admin.cookie, `${DASH.revenue}${Q30}`);
    for (const k of ['gross', 'refunded', 'net', 'payment_count']) {
      expect([k, r.body.buckets.reduce((s: number, b: Record<string, number>) => s + b[k], 0)]).toEqual([k, r.body.totals[k]]);
      expect([k, r.body.totals[k]]).toEqual([k, d.body[k]]);
      expect([k, r.body.by_method.vnpay[k] + r.body.by_method.cod[k]]).toEqual([k, r.body.totals[k]]);
    }
    expect(d.body).toMatchObject({ gross: 320000, refunded: 200000, net: 120000, payment_count: 2 });
    expect(spy).toHaveBeenCalledTimes(2); // một lời gọi getRevenue cho mỗi endpoint
    expect(spy.mock.calls[1][0]).toEqual({ from: new Date('2026-08-31T17:00:00Z'), to: new Date('2026-09-30T17:00:00Z') });
    expect(spy.mock.calls[0][0]).toEqual(spy.mock.calls[1][0]);
  });

  it('DSH-TC-20261006-110331410: staff và customer nhận 403, chưa đăng nhập 401 ở báo cáo doanh thu, PAY được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.pay, 'getRevenue');
    for (const w of [p.staff, p.customer]) { const r = await report(Q30, w.cookie); expect([r.status, r.text.includes('buckets')]).toEqual([403, false]); }
    expect((await report(Q30, null)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110331438: khoảng 367 ngày, đảo ngược, tương lai hoặc tham số độ mịn nhận 400, PAY được gọi 0 lần; 366 ngày hợp lệ độ mịn month', async () => {
    const spy = jest.spyOn(t.pay, 'getRevenue');
    for (const qs of ['?from=2025-10-05&to=2026-10-06', '?from=2026-09-30&to=2026-09-01', '?to=2026-10-07', '?granularity=day', '?from=0001-01-01&to=2026-10-06', '?from=0001-01-01&to=9999-12-31', '?from=1970-01-01&to=2026-10-06']) {
      const r = await report(qs);
      expect([qs, r.status, r.body.type]).toEqual([qs, 400, 'urn:ecom:error:invalid-parameter']);
    }
    expect(spy).not.toHaveBeenCalled(); // khoảng khổng lồ bị chặn ở API, không chạy truy vấn tổng hợp (không tới statement_timeout)
    const ok = await report('?from=2025-10-06&to=2026-10-06');
    expect([ok.status, ok.body.granularity, ok.body.buckets.length]).toEqual([200, 'month', 13]);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('DSH-TC-20261006-110331467: PAY quá hạn trả 503 nguồn PAY, không vẽ báo cáo toàn số 0', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.pay, 'getRevenue').mockImplementation(() => later(1500, { totals: z, by_method: { vnpay: z, cod: z }, series: [] }));
    const r = await report(Q30);
    expect([r.status, r.body.source]).toEqual([503, 'PAY']);
    expect(r.text).not.toMatch(/buckets|totals/);
  });

  it('DSH-TC-20261006-110331495: ranh giới độ mịn 31, 32, 92, 93 ngày', async () => {
    const got: string[] = [];
    for (const from of ['2026-09-06', '2026-09-05', '2026-07-07', '2026-07-06']) got.push((await report(`?from=${from}&to=2026-10-06`)).body.granularity);
    expect(got).toEqual(['day', 'week', 'week', 'month']);
  });

  it('DSH-TC-20261006-110331524: khoảng một ngày có đúng một mốc ngày, totals bằng mốc đó', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 100_000 });
    const r = await report('?from=2026-10-05&to=2026-10-05');
    expect([r.body.granularity, r.body.buckets]).toEqual(['day', [{ bucket_start: '2026-10-05', gross: 100000, refunded: 0, net: 100000, payment_count: 1 }]]);
    expect(r.body.totals.gross).toBe(100000);
  });

  it('DSH-TC-20261006-110331552: khoảng 273 ngày chia theo tháng, đủ 9 mốc kể cả tháng trống', async () => {
    await paid(t, new Date('2026-01-15T03:00:00Z'), { amount: 100_000 });
    await paid(t, new Date('2026-09-15T03:00:00Z'), { amount: 200_000 });
    const r = await report('?from=2026-01-01&to=2026-09-30');
    expect([r.body.granularity, r.body.buckets.length]).toEqual(['month', 9]);
    expect(r.body.buckets.map((b: { bucket_start: string }) => b.bucket_start)).toEqual(Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`));
    expect(r.body.buckets.slice(1, 8).every((b: Record<string, number>) => b.gross === 0 && b.payment_count === 0)).toBe(true);
    expect([r.body.buckets[0].gross, r.body.buckets[8].gross, r.body.totals.gross]).toEqual([100000, 200000, 300000]);
  });

  it('DSH-TC-20261006-110331580: khoảng không có giao dịch vẫn đủ mốc và toàn số 0', async () => {
    const r = await report(Q30);
    expect(r.status).toBe(200);
    expect(r.body.buckets).toHaveLength(30);
    expect(r.body.buckets.every((b: Record<string, unknown>) => ['gross', 'refunded', 'net', 'payment_count'].every((k) => b[k] === 0))).toBe(true);
    expect(r.body).toMatchObject({ totals: z, by_method: { vnpay: z, cod: z } });
  });
});
