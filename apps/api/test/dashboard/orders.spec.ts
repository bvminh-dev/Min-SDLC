import { createDshApp, DASH, get, ORDER_KEYS, order, people, RANGE_Q, REPORT, reset, withTimeout, later, zeroStatus, type DshApp, type People, type Status } from '../support/dsh';
import { q } from '../support/auth';

// DSH-REQ-20261006-105125811 (ô tổng đơn). Nguồn là OrderApi thật trên PostgreSQL thật.
describe('DSH tổng đơn (DSH-REQ-20261006-105125811)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const orders = (qs = RANGE_Q, cookie: string | undefined = p.admin.cookie) => get(t, cookie, `${DASH.orders}${qs}`);
  const seed = async (n: number, status: Status, createdAt: Date, extra: Record<string, unknown> = {}) => { for (let i = 0; i < n; i++) await order(t, { status, createdAt: new Date(createdAt.getTime() + i * 1000), ...extra }); };

  it('DSH-TC-20261006-110330281: tổng đơn 45 chia tám trạng thái, đơn hiệu lực 37', async () => {
    const day = new Date('2026-10-03T03:00:00Z');
    const plan: [Status, number][] = [['pending', 3], ['confirmed', 5], ['paid', 12], ['shipped', 8], ['delivered', 9], ['returned', 1], ['cancelled', 5], ['expired', 2]];
    for (const [s, n] of plan) await seed(n, s, day, s === 'confirmed' ? { method: 'cod' } : {});
    const r = await orders();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ from: '2026-10-01', to: '2026-10-06', as_of: '2026-10-06T03:00:00Z', total: 45, effective: 37, by_status: { pending: 3, confirmed: 5, paid: 12, shipped: 8, delivered: 9, returned: 1, cancelled: 5, expired: 2 } });
    expect(Object.values(r.body.by_status as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(45);
    expect(Object.keys(r.body.by_status).sort()).toEqual([...ORDER_KEYS].sort());
  });

  it('DSH-TC-20261006-110330309: staff và customer nhận 403, chưa đăng nhập nhận 401 ở số đơn, ORD được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.ord, 'countByStatus');
    for (const w of [p.staff, p.customer]) { const r = await orders(RANGE_Q, w.cookie); expect([r.status, r.text.includes('total')]).toEqual([403, false]); }
    expect((await get(t, undefined, `${DASH.orders}${RANGE_Q}`)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110330341: khoảng ngày đảo ngược nhận 400, không có total, ORD được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.ord, 'countByStatus');
    const r = await orders('?from=2026-10-05&to=2026-10-01');
    expect([r.status, r.body.type, r.body.errors[0].field]).toEqual([400, 'urn:ecom:error:invalid-parameter', 'from']);
    expect(r.text).not.toContain('"total"');
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110330370: ORD quá hạn trả 503 nguồn ORD (không phải 0), số sản phẩm vẫn 200', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.ord, 'countByStatus').mockImplementation(() => later(1500, {} as never));
    const [o, pr] = await Promise.all([orders(), get(t, p.admin.cookie, DASH.products)]);
    expect([o.status, o.body.source, o.body.type]).toEqual([503, 'ORD', 'urn:ecom:error:dashboard-source-unavailable']);
    expect(o.text).not.toContain('"total"');
    expect(pr.status).toBe(200);
  });

  it('DSH-TC-20261006-110330398: không có đơn nào trong khoảng thì tổng, hiệu lực và tám khóa đều bằng 0', async () => {
    const r = await orders();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 0, effective: 0, by_status: zeroStatus() });
    expect(Object.keys(r.body.by_status)).toHaveLength(8);
  });

  it('DSH-TC-20261006-110330426: đơn tạo đúng 00:00 giờ Việt Nam tính vào ngày mới, 23:59:59 ngày trước', async () => {
    await order(t, { createdAt: new Date('2026-10-05T17:00:00Z'), status: 'paid' });
    await order(t, { createdAt: new Date('2026-10-05T16:59:59Z'), status: 'paid' });
    expect((await orders('?from=2026-10-06&to=2026-10-06')).body.total).toBe(1);
    expect((await orders('?from=2026-10-05&to=2026-10-05')).body.total).toBe(1);
    expect((await orders('?from=2026-10-05&to=2026-10-06')).body.total).toBe(2);
  });

  it('DSH-TC-20261006-110330455: trạng thái đếm là trạng thái hiện tại của đơn, đổi sau khi hết bộ nhớ đệm', async () => {
    const z = await order(t, { status: 'paid', createdAt: new Date('2026-10-04T03:00:00Z') });
    await order(t, { status: 'delivered', createdAt: new Date('2026-10-04T04:00:00Z') });
    const first = await orders();
    expect([first.body.by_status.paid, first.body.by_status.cancelled, first.body.effective, first.body.total]).toEqual([1, 0, 2, 2]);
    await t.prisma.$executeRaw`UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', cancel_reason = 'customer_request', cancelled_by_role = 'customer', updated_at = ${new Date('2026-10-08T03:00:00Z')}::timestamptz WHERE id = ${z.id}::uuid`; // fixed-clock: mốc hủy sau khoảng, dữ liệu mồi ghi thẳng vào CSDL (không phụ thuộc now())
    t.clock.advance(61_000);
    const second = await orders();
    expect([second.body.by_status.paid, second.body.by_status.cancelled, second.body.effective, second.body.total]).toEqual([0, 1, 1, 2]);
    expect(second.body.as_of).not.toBe(first.body.as_of);
  });

  it('DSH-TC-20261006-120001007: đơn COD hoàn về và đơn paid bị hệ thống hủy không vào giá trị đơn trung bình, tám khóa trạng thái đúng', async () => {
    const d = new Date('2026-10-04T03:00:00Z');
    await order(t, { status: 'paid', payment: 'succeeded', createdAt: d, items: [{ price: 70_000, qty: 1 }], shipping: 30_000 }); // grand_total 100.000
    await order(t, { status: 'returned', method: 'cod', payment: 'cancelled', createdAt: d, items: [{ price: 220_000, qty: 1 }], shipping: 30_000 }); // 250.000
    await order(t, { status: 'cancelled', payment: 'refunded', createdAt: d, cancel: { reason: 'stock_commit_failed', by: 'system' }, items: [{ price: 370_000, qty: 1 }], shipping: 30_000, paidAt: d }); // 400.000
    await order(t, { status: 'delivered', payment: 'succeeded', createdAt: d, items: [{ price: 270_000, qty: 1 }], shipping: 30_000 }); // 300.000
    const r = await get(t, p.admin.cookie, `${REPORT.orders}${RANGE_Q}`);
    expect(r.status).toBe(200);
    expect(r.body.totals).toEqual({ total: 4, by_status: zeroStatus({ paid: 1, delivered: 1, returned: 1, cancelled: 1 }), cancel_rate: 25, expired_rate: 0, average_order_value: 200000 });
    const [{ n }] = await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM orders WHERE payment_status = 'succeeded'`);
    expect(n).toBe(2);
  });
});
