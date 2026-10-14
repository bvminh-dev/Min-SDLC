import { createDshApp, DASH, get, ict, MIN, NOW, paid, people, RANGE_Q, reset, SECRET_SQL, withTimeout, later, type DshApp, type People } from '../support/dsh';
import { seedRefund } from '../support/pay';
import { q, seedSession } from '../support/auth';

// DSH-REQ-20261006-105125714: ô doanh thu thuần. Ứng dụng THẬT (AppModule), PostgreSQL thật; nguồn tiền là PaymentApi thật, test gài lỗi bằng jest.spyOn trên chính lớp đó.
describe('DSH doanh thu (DSH-REQ-20261006-105125714)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const revenue = (path = `${DASH.revenue}${RANGE_Q}`, cookie: string | undefined = p.admin.cookie) => get(t, cookie, path);
  /** Ba thanh toán mẫu của ca chính: A VNPay 350.000 (05/10), B COD 120.000 (03/10), C VNPay 200.000 thu 02/10, hoàn 04/10. */
  const sample = async () => {
    const a = await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 350_000 });
    await paid(t, new Date('2026-10-03T05:00:00Z'), { amount: 120_000, method: 'cod' });
    await paid(t, new Date('2026-10-02T04:00:00Z'), { amount: 200_000, refund: { at: new Date('2026-10-04T04:00:00Z') } });
    return a;
  };

  it('DSH-TC-20261006-110329988: doanh thu thuần của khoảng khớp ba thanh toán mẫu, bất biến net toàn thời gian bằng tổng Payment succeeded', async () => {
    await sample();
    const r = await revenue();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ from: '2026-10-01', to: '2026-10-06', as_of: '2026-10-06T03:00:00Z', gross: 670000, refunded: 200000, net: 470000, payment_count: 3, failed_refund_count: 0 });
    expect(Object.values(r.body).filter((v) => typeof v === 'number').every(Number.isInteger)).toBe(true);
    expect(r.text).not.toMatch(/\d\.\d/); // tiền không có dấu thập phân trong JSON
    const all = await t.pay.getRevenue({ from: new Date('2020-01-01T00:00:00Z'), to: new Date('2026-10-06T17:00:00Z') });
    const [{ s }] = await q<{ s: string }>(t, `SELECT COALESCE(sum(amount), 0)::text AS s FROM payments WHERE status = 'succeeded'`);
    expect([all.totals.net, Number(s)]).toEqual([470000, 470000]);
    expect(r.headers['cache-control']).toBe('private, no-store');
  });

  it('DSH-TC-20261006-110330022: không truyền khoảng ngày thì dùng 30 ngày qua, PAY được gọi đúng một lần với khoảng UTC nửa mở', async () => {
    const spy = jest.spyOn(t.pay, 'getRevenue');
    const r = await revenue(DASH.revenue);
    expect(r.status).toBe(200);
    expect([r.body.from, r.body.to]).toEqual(['2026-09-07', '2026-10-06']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual({ from: new Date('2026-09-06T17:00:00Z'), to: new Date('2026-10-06T17:00:00Z') });
    // chỉ một trong hai tham số: thiếu `to` thì là hôm nay, thiếu `from` thì là `to` trừ 29 ngày
    expect((await revenue(`${DASH.revenue}?from=2026-10-01`)).body).toMatchObject({ from: '2026-10-01', to: '2026-10-06' });
    expect((await revenue(`${DASH.revenue}?to=2026-10-31`)).status).toBe(400);
    expect((await revenue(`${DASH.revenue}?to=2026-10-02`)).body).toMatchObject({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('DSH-TC-20261006-110330051: cảnh báo hoàn tiền thất bại không làm đổi doanh thu thuần, 0 thì về 0', async () => {
    await sample();
    for (const n of [1, 2]) await paid(t, new Date('2026-08-01T03:00:00Z'), { amount: 50_000 * n, refund: 'failed' }); // thu ngoài khoảng, Refund thất bại hết lượt tự thử: việc của admin
    const r = await revenue();
    expect([r.body.failed_refund_count, r.body.net]).toEqual([2, 470000]);
    await t.prisma.$executeRaw`DELETE FROM refunds WHERE status = 'failed'`;
    t.cache.clear();
    const z = await revenue();
    expect([z.body.failed_refund_count, z.body.net]).toEqual([0, 470000]);
    // Refund `failed` còn hẹn thử lại tự động (next_retry_at) chưa phải việc của admin
    const pending = await paid(t, new Date('2026-08-01T03:00:00Z'), { amount: 10_000 });
    await seedRefund(t, { paymentId: pending.id, attemptId: pending.attempts[0].id, status: 'failed', reason: 'admin_manual', nextRetryAt: new Date(NOW.getTime() + MIN) });
    t.cache.clear();
    expect((await revenue()).body.failed_refund_count).toBe(0);
  });

  it('DSH-TC-20261006-110330080: staff và customer nhận 403 không có số tiền nào, không cookie và phiên hết hạn nhận 401, PAY được gọi 0 lần', async () => {
    await sample();
    const spy = jest.spyOn(t.pay, 'getRevenue');
    const count = jest.spyOn(t.pay, 'countFailedRefunds');
    for (const who of [p.staff, p.customer]) {
      const r = await revenue(undefined, who.cookie);
      expect(r.status).toBe(403);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.text).not.toMatch(/gross|refunded|net|payment_count/);
      expect(r.body.type).toBe('urn:ecom:error:forbidden');
    }
    const anon = await get(t, undefined, `${DASH.revenue}${RANGE_Q}`);
    expect([anon.status, anon.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']);
    const old = await seedSession(t, p.admin.id, { createdAt: new Date(NOW.getTime() - 40 * MIN) });
    const expired = await revenue(undefined, old.cookie);
    expect(expired.status).toBe(401);
    expect(expired.text).not.toMatch(/gross/);
    expect([spy.mock.calls.length, count.mock.calls.length]).toEqual([0, 0]);
    expect((await q(t, `SELECT 1 FROM audit_logs WHERE action = 'dashboard.view'`)).length).toBe(0);
  });

  it('DSH-TC-20261006-110330109: khoảng ngày sai hoặc có mã độc nhận 400 invalid-parameter kèm tên tham số, không gọi nguồn; 366 ngày là hợp lệ', async () => {
    const spy = jest.spyOn(t.pay, 'getRevenue');
    const cases: [string, string][] = [
      ['to=2026-10-07', 'to'], ['from=2026-10-05&to=2026-10-01', 'from'], ['from=2025-10-05&to=2026-10-06', 'from'], ['from=06/10/2026', 'from'], ['from=2026-02-30', 'from'],
      ['to=2026-10-01;DROP%20TABLE%20payments', 'to'], ['granularity=day', 'granularity'], ['from=2026-9-1', 'from'], ['from=', 'from'], ['from=2026-10-01&from=2026-10-02', 'from'], ['to=2026-13-01', 'to'],
      ['from=1969-12-31&to=1970-01-01', 'from'], ['from=0000-01-01&to=0000-01-02', 'from'], ['__proto__=x', '__proto__'], ['to=2026-10-06T00:00:00Z', 'to'], ['from=２０２６-10-01', 'from'],
    ];
    for (const [qs, field] of cases) {
      const r = await revenue(`${DASH.revenue}?${qs}`);
      expect([qs, r.status, r.body.type]).toEqual([qs, 400, 'urn:ecom:error:invalid-parameter']);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body.trace_id).toEqual(expect.any(String));
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
      for (const e of r.body.errors) expect(e).toEqual({ field: e.field, code: expect.any(String), reason: e.code });
      expect(r.text).not.toMatch(/gross/);
    }
    expect(spy).toHaveBeenCalledTimes(0);
    const edge = await revenue(`${DASH.revenue}?from=2025-10-06&to=2026-10-06`);
    expect([edge.status, edge.body.from]).toEqual([200, '2025-10-06']);
    expect((await revenue(`${DASH.revenue}?from=2024-02-29&to=2024-02-29`)).status).toBe(200); // ngày nhuận hợp lệ ngoài ngưỡng hôm nay vẫn là một ngày
    expect((await revenue(`${DASH.revenue}?from=2025-02-29&to=2025-03-01`)).status).toBe(400);
  });

  it('DSH-TC-20261006-110330139: PAY quá hạn hoặc ném lỗi chứa SQL trả 503 nguồn PAY, không lộ chi tiết, không lưu đệm lỗi', async () => {
    withTimeout(t, 300);
    const spy = jest.spyOn(t.pay, 'getRevenue').mockImplementation(() => later(1500, { totals: { gross: 1, refunded: 0, net: 1, payment_count: 1 }, by_method: { vnpay: { gross: 1, refunded: 0, net: 1, payment_count: 1 }, cod: { gross: 0, refunded: 0, net: 0, payment_count: 0 } }, series: [] }));
    const r = await revenue();
    expect(r.status).toBe(503);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body).toEqual({ type: 'urn:ecom:error:dashboard-source-unavailable', title: 'Dashboard source unavailable', status: 503, source: 'PAY', trace_id: expect.any(String) });
    expect(r.text).not.toMatch(/gross|net|SELECT|db-prod-1|stack/);
    spy.mockImplementation(() => Promise.reject(Object.assign(new Error(`${SECRET_SQL} at db-prod-1`), { stack: 'Error: x\n at /srv/app/payment.api.ts:1' })));
    const e = await revenue();
    expect([e.status, e.body.source]).toEqual([503, 'PAY']);
    expect(e.text).not.toMatch(/SELECT|db-prod-1|stack|payment\.api|\/srv/);
    expect(t.logs.lines.join('\n')).toMatch(/nguồn dashboard lỗi hoặc quá hạn/); // chi tiết chỉ ở log nội bộ
    spy.mockRestore();
    const spy2 = jest.spyOn(t.pay, 'getRevenue');
    await sample();
    expect((await q(t, `SELECT 1 FROM audit_logs WHERE action = 'dashboard.view'`)).length).toBe(0); // 503 không ghi audit
    const ok = await revenue();
    expect([ok.status, ok.body.net]).toEqual([200, 470000]);
    expect(spy2).toHaveBeenCalledTimes(1); // 503 không bị lưu đệm: lần sau đọc lại nguồn
    expect((await q(t, `SELECT 1 FROM audit_logs WHERE action = 'dashboard.view'`)).length).toBe(1); // chỉ lần 200 ghi audit
  });

  it('DSH-TC-20261006-110330168: Payment processing, failed, expired và COD chưa thu không vào doanh thu', async () => {
    await paid(t, null, { amount: 500_000, status: 'processing' });
    await paid(t, null, { amount: 300_000, status: 'failed' });
    await paid(t, null, { amount: 100_000, status: 'expired' });
    await paid(t, null, { amount: 250_000, method: 'cod', status: 'pending' });
    await paid(t, null, { amount: 90_000, status: 'cancelled' });
    const r = await revenue();
    expect(r.body).toMatchObject({ gross: 0, refunded: 0, net: 0, payment_count: 0 });
  });

  it('DSH-TC-20261006-110330197: ranh giới ngày theo giờ Việt Nam, 23:59:59 thuộc ngày 05/10 và 00:00:00 thuộc ngày 06/10', async () => {
    await paid(t, new Date('2026-10-05T16:59:59Z'), { amount: 100_000 });
    await paid(t, new Date('2026-10-05T17:00:00Z'), { amount: 250_000 });
    const six = await revenue(`${DASH.revenue}?from=2026-10-06&to=2026-10-06`);
    expect([six.body.gross, six.body.payment_count]).toEqual([250000, 1]);
    const five = await revenue(`${DASH.revenue}?from=2026-10-05&to=2026-10-05`);
    expect([five.body.gross, five.body.payment_count]).toEqual([100000, 1]);
    expect(ict('2026-10-06', '00:00').toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });

  it('DSH-TC-20261006-110330226: doanh thu thuần âm khi hoàn tiền kỳ trước (giữ nguyên số âm), Refund failed và requested không bị trừ', async () => {
    await paid(t, new Date('2026-09-01T03:00:00Z'), { amount: 200_000, refund: { at: new Date('2026-10-02T04:00:00Z') } });
    await paid(t, new Date('2026-09-02T03:00:00Z'), { amount: 150_000, refund: { at: new Date('2026-10-03T04:00:00Z'), amount: 150_000, status: 'failed' } });
    await paid(t, new Date('2026-09-03T03:00:00Z'), { amount: 80_000, refund: { at: new Date('2026-10-03T05:00:00Z'), amount: 80_000, status: 'requested' } });
    const r = await revenue();
    expect(r.body).toMatchObject({ gross: 0, refunded: 200000, net: -200000, payment_count: 0 });
    expect(r.text).toContain('"net":-200000');
  });

  it('DSH-TC-20261006-110330253: hệ thống chưa có thanh toán trả bốn số 0 và failed_refund_count 0, không null', async () => {
    const r = await revenue();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ from: '2026-10-01', to: '2026-10-06', as_of: '2026-10-06T03:00:00Z', gross: 0, refunded: 0, net: 0, payment_count: 0, failed_refund_count: 0 });
  });

  it('DSH-TC-20261006-120001001: Refund late_payment của Payment đã đóng (expired) không bị trừ vào doanh thu thuần, Payment gốc không vào gross', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 350_000 });
    const b = await paid(t, null, { amount: 300_000, status: 'expired' });
    await seedRefund(t, { paymentId: b.id, attemptId: b.attempts[0]?.id ?? (await q<{ id: string }>(t, `SELECT id FROM payment_attempts WHERE payment_id = '${b.id}'`))[0].id, amount: 300_000, reason: 'late_payment', status: 'succeeded', resolvedAt: new Date('2026-10-04T04:00:00Z') });
    await paid(t, new Date('2026-10-02T04:00:00Z'), { amount: 200_000, refund: { at: new Date('2026-10-04T05:00:00Z'), reason: 'admin_manual' } });
    const r = await revenue();
    expect(r.body).toMatchObject({ gross: 550000, refunded: 200000, net: 350000, payment_count: 2 });
    const all = await t.pay.getRevenue({ from: new Date('2020-01-01T00:00:00Z'), to: new Date('2026-10-06T17:00:00Z') });
    const [{ s }] = await q<{ s: string }>(t, `SELECT sum(amount)::text AS s FROM payments WHERE status = 'succeeded'`);
    expect([all.totals.net, Number(s)]).toEqual([350000, 350000]);
  });

  it('DSH-TC-20261006-120001006: Refund late_payment do StockCommitFailed trên Payment succeeded làm Payment sang refunded nên bị trừ vào doanh thu thuần', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 350_000 });
    await paid(t, new Date('2026-10-05T02:00:00Z'), { amount: 400_000, refund: { at: new Date('2026-10-05T02:05:00Z'), reason: 'late_payment' } });
    const e = await paid(t, null, { amount: 300_000, status: 'expired', attempts: undefined } as never);
    const attempt = (await q<{ id: string }>(t, `SELECT id FROM payment_attempts WHERE payment_id = '${e.id}'`))[0]?.id;
    if (attempt) await seedRefund(t, { paymentId: e.id, attemptId: attempt, amount: 300_000, reason: 'late_payment', status: 'succeeded', resolvedAt: new Date('2026-10-04T04:00:00Z') });
    const r = await revenue();
    expect(r.body).toMatchObject({ gross: 750000, refunded: 400000, net: 350000, payment_count: 2 });
    const all = await t.pay.getRevenue({ from: new Date('2020-01-01T00:00:00Z'), to: new Date('2026-10-06T17:00:00Z') });
    expect(all.totals.net).toBe(350000);
  });
});
