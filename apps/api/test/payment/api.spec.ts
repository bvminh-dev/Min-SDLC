import { truncateAll } from '../support/db';
import { createPayApp, people, seedPayment, seedRefund, type PayApp } from '../support/pay';

// Giao diện đọc PaymentApi cho DSH (ADR-020, SB-23, SB-39; bảng Giao diện module hàng DSH | PAY). Mang ID tài liệu PAY-SEC (chưa có TC riêng cho giao diện nội bộ).
const SEC = 'PAY-SEC-20261006-103701420';
const DAY = 86_400_000;
describe(`PAY giao diện đọc cho DSH (${SEC})`, () => {
  let t: PayApp;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); jest.restoreAllMocks(); });
  const day0 = (): number => Math.floor(Date.now() / DAY) * DAY - 10 * DAY; // 00:00 UTC của ngày cách đây 10 ngày: mọi mốc tính từ đây
  const paid = async (u: string, at: number, o: { amount?: number; method?: 'vnpay' | 'cod'; refunded?: { at: number; reason?: 'order_cancelled' | 'late_payment' | 'admin_manual' } | 'failed' | 'requested' } = {}) => {
    const method = o.method ?? 'vnpay';
    const pay = await seedPayment(t, { user: u, method, amount: o.amount ?? 100_000, status: o.refunded && typeof o.refunded === 'object' ? 'refunded' : 'succeeded', paidAt: new Date(at), attemptNo: method === 'vnpay' ? 1 : 0, attempts: method === 'vnpay' ? 'auto' : [], orderStatus: method === 'cod' ? 'delivered' : undefined });
    if (o.refunded && method === 'vnpay') await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, reason: typeof o.refunded === 'object' ? (o.refunded.reason ?? 'order_cancelled') : 'order_cancelled', status: typeof o.refunded === 'object' ? 'succeeded' : o.refunded, resolvedAt: typeof o.refunded === 'object' ? new Date(o.refunded.at) : undefined, nextRetryAt: null, autoAttemptNo: 3 });
    return pay;
  };

  it(`${SEC} (SB-23): getRevenue: gross theo paid_at, refunded chỉ là Refund thành công ĐÃ đưa Payment sang refunded (theo resolved_at), net = gross - refunded, tách theo phương thức; Refund của Payment đã đóng và duplicate_payment không trừ; khoảng nửa mở [from, to)`, async () => {
    const { a } = await people(t);
    const d0 = day0();
    await paid(a.id, d0 + 1 * DAY, { amount: 300_000 }); // vnpay trong khoảng, không hoàn
    await paid(a.id, d0 + 2 * DAY, { amount: 200_000, refunded: { at: d0 + 3 * DAY, reason: 'admin_manual' } }); // đã hoàn trong khoảng
    await paid(a.id, d0 + 1 * DAY, { amount: 150_000, method: 'cod' }); // COD
    await paid(a.id, d0 - 1000, { amount: 999_000 }); // trước khoảng
    await paid(a.id, d0 + 5 * DAY, { amount: 777_000 }); // đúng `to`: loại (nửa mở)
    await paid(a.id, d0, { amount: 50_000 }); // đúng `from`: gồm
    await paid(a.id, d0 + 1 * DAY, { amount: 120_000, refunded: { at: d0 + 6 * DAY, reason: 'late_payment' } }); // hoàn sau khoảng: gross có, refunded chưa
    await paid(a.id, d0 + 4 * DAY - 5000, { amount: 60_000, refunded: 'failed' }); // Refund failed: chưa trừ
    await paid(a.id, d0 + 4 * DAY - 4000, { amount: 61_000, refunded: 'requested' }); // đang hoàn: chưa trừ
    // Refund late_payment trên Payment đã đóng (expired) và duplicate_payment trên Payment succeeded: tiền chưa vào doanh thu hoặc chưa ra
    const expired = await seedPayment(t, { user: a.id, status: 'expired', orderStatus: 'expired', attemptNo: 1, attempts: [{ no: 1, status: 'succeeded' }] });
    await seedRefund(t, { paymentId: expired.id, attemptId: expired.attempts[0].id, reason: 'late_payment', status: 'succeeded', resolvedAt: new Date(d0 + 2 * DAY) });
    const dup = await seedPayment(t, { user: a.id, status: 'succeeded', amount: 80_000, paidAt: new Date(d0 + 2 * DAY), providerRef: '14012345', attemptNo: 2, attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }, { no: 2, status: 'succeeded', txNo: '14012399' }] });
    await seedRefund(t, { paymentId: dup.id, attemptId: dup.attempts[1].id, reason: 'duplicate_payment', status: 'succeeded', resolvedAt: new Date(d0 + 2 * DAY) });
    const r = await t.pay.getRevenue({ from: new Date(d0), to: new Date(d0 + 5 * DAY) });
    // gross: 300k + 200k + 150k + 50k + 120k + 60k + 61k + 80k = 1.021.000 ; refunded: 200k (admin_manual); payment_count: 8
    expect(r.totals).toEqual({ gross: 1_021_000, refunded: 200_000, net: 821_000, payment_count: 8 });
    expect(r.by_method.cod).toEqual({ gross: 150_000, refunded: 0, net: 150_000, payment_count: 1 });
    expect(r.by_method.vnpay).toEqual({ gross: 871_000, refunded: 200_000, net: 671_000, payment_count: 7 });
    expect(r.by_method.vnpay.gross + r.by_method.cod.gross).toBe(r.totals.gross); // cùng một câu truy vấn nên các số khớp nhau
    expect(r.series).toEqual([]);
    expect(Number.isInteger(r.totals.gross)).toBe(true);
    // lời gọi nửa mở: [from, to) với to = from cho khoảng rỗng
    expect((await t.pay.getRevenue({ from: new Date(d0), to: new Date(d0) })).totals).toEqual({ gross: 0, refunded: 0, net: 0, payment_count: 0 });
    // khoảng sau lúc hoàn: refunded theo resolved_at
    const later = await t.pay.getRevenue({ from: new Date(d0 + 5 * DAY), to: new Date(d0 + 8 * DAY) });
    expect(later.totals).toEqual({ gross: 777_000, refunded: 120_000, net: 657_000, payment_count: 1 });
  });

  it(`${SEC}: getRevenue theo mốc (hour, day, month): không bỏ mốc rỗng, tổng các mốc bằng totals, mốc theo UTC`, async () => {
    const { a } = await people(t);
    const d0 = day0();
    await paid(a.id, d0 + 3600_000 * 5, { amount: 100_000 });
    await paid(a.id, d0 + DAY + 1000, { amount: 200_000, refunded: { at: d0 + 2 * DAY + 1000 } });
    await paid(a.id, d0 + 3 * DAY, { amount: 400_000 });
    const r = await t.pay.getRevenue({ from: new Date(d0), to: new Date(d0 + 4 * DAY) }, 'day');
    expect(r.series.map((s) => s.bucket_start)).toEqual([0, 1, 2, 3].map((i) => new Date(d0 + i * DAY).toISOString().replace('.000Z', 'Z')));
    expect(r.series.map((s) => [s.gross, s.refunded, s.net, s.payment_count])).toEqual([[100_000, 0, 100_000, 1], [200_000, 0, 200_000, 1], [0, 200_000, -200_000, 0], [400_000, 0, 400_000, 1]]);
    expect(r.series.reduce((x, s) => x + s.gross, 0)).toBe(r.totals.gross);
    expect(r.series.reduce((x, s) => x + s.refunded, 0)).toBe(r.totals.refunded);
    const h = await t.pay.getRevenue({ from: new Date(d0), to: new Date(d0 + 6 * 3600_000) }, 'hour');
    expect(h.series).toHaveLength(6);
    expect(h.series[5]).toMatchObject({ gross: 100_000, payment_count: 1 });
    const m = await t.pay.getRevenue({ from: new Date(d0), to: new Date(d0 + 4 * DAY) }, 'month');
    expect(m.series.length).toBeGreaterThanOrEqual(1);
    expect(m.series.reduce((x, s) => x + s.gross, 0)).toBe(700_000);
  });

  it(`${SEC} (SB-39): đầu vào sai ném RangeError (khoảng ngược, ngày hỏng, bucket lạ, quá 1000 mốc); lỗi CSDL ném nguyên (DSH trả 503), không bao giờ trả 0 thay số thật`, async () => {
    const d0 = new Date(day0());
    const bad: [unknown, unknown?][] = [[{ from: new Date(d0.getTime() + 1), to: d0 }], [{ from: new Date('x'), to: d0 }], [{ from: d0, to: new Date(NaN) }], [null], [{}], [{ from: d0, to: new Date(d0.getTime() + DAY) }, 'week'], [{ from: d0, to: new Date(d0.getTime() + 1001 * 3600_000) }, 'hour'], [{ from: new Date(Date.UTC(10000, 0, 1)), to: new Date(Date.UTC(10000, 0, 2)) }]];
    for (const [range, bucket] of bad) await expect(t.pay.getRevenue(range as never, bucket as never)).rejects.toThrow(RangeError);
    await expect(t.pay.getRevenue({ from: d0, to: new Date(d0.getTime() + 1000 * 3600_000) }, 'hour')).resolves.toBeDefined(); // đúng trần 1000 mốc
    jest.spyOn(t.prisma, '$queryRaw').mockRejectedValueOnce(new Error('CSDL mất'));
    await expect(t.pay.getRevenue({ from: d0, to: new Date(d0.getTime() + DAY) })).rejects.toThrow('CSDL mất');
    jest.spyOn(t.prisma, '$queryRaw').mockRejectedValueOnce(new Error('CSDL mất'));
    await expect(t.pay.countFailedRefunds()).rejects.toThrow('CSDL mất');
  });

  it(`${SEC}: countFailedRefunds chỉ đếm Refund failed đã hết lượt tự thử (chờ admin); Refund còn hẹn tự thử, requested và succeeded không tính`, async () => {
    const { a } = await people(t);
    const mk = async (o: Parameters<typeof seedRefund>[1] extends infer X ? Partial<X> : never) => { const p = await seedPayment(t, { user: a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' }); return seedRefund(t, { paymentId: p.id, attemptId: p.attempts[0].id, ...o }); };
    expect(await t.pay.countFailedRefunds()).toBe(0);
    await mk({ status: 'failed', autoAttemptNo: 3, nextRetryAt: null });
    await mk({ status: 'failed', autoAttemptNo: 3, nextRetryAt: null });
    await mk({ status: 'failed', autoAttemptNo: 1, nextRetryAt: new Date(Date.now() + 300_000) }); // còn hẹn tự thử
    await mk({ status: 'requested' });
    await mk({ status: 'succeeded' });
    expect(await t.pay.countFailedRefunds()).toBe(2);
  });
});
