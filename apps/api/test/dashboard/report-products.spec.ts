import { createDshApp, get, order, people, product, REPORT, reset, withTimeout, later, type DshApp, type People, type Status } from '../support/dsh';

// DSH-REQ-20261006-105126458 (báo cáo sản phẩm bán chạy): OrderApi.getTopProducts và getProductSalesTotals (ORD), tên từ PRD; tính theo ngày thu tiền paid_at.
describe('DSH báo cáo sản phẩm (DSH-REQ-20261006-105126458)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const report = (qs = '?from=2026-09-01&to=2026-09-30', cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, `${REPORT.products}${qs}`);
  const D = new Date('2026-09-10T03:00:00Z');
  const sell = (lines: { product: string; price: number; qty: number; name?: string }[], o: { status?: Status; payment?: 'succeeded' | 'refunded' | 'pending'; paidAt?: Date | null; createdAt?: Date; method?: 'vnpay' | 'cod' } = {}) =>
    order(t, { status: o.status ?? 'delivered', payment: o.payment ?? 'succeeded', paidAt: o.paidAt === undefined ? D : o.paidAt, createdAt: o.createdAt ?? D, method: o.method, items: lines.map((l) => ({ product: l.product, price: l.price, qty: l.qty, name: l.name })), noHistory: true });
  const three = async () => {
    const P1 = await product(t, { name: 'P1 Áo' }), P2 = await product(t, { name: 'P2 Quần' }), P3 = await product(t, { name: 'P3 Tất' });
    await sell([{ product: P1, price: 100_000, qty: 40 }]);
    await sell([{ product: P2, price: 200_000, qty: 25 }]);
    await sell([{ product: P3, price: 50_000, qty: 25 }]);
    return { P1, P2, P3 };
  };

  it('DSH-TC-20261006-110331842: xếp theo số lượng, P1 trước, P2 trước P3 khi cùng 25 cái (giá trị lớn hơn)', async () => {
    const { P1, P2, P3 } = await three();
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ from: '2026-09-01', to: '2026-09-30', as_of: '2026-10-06T03:00:00Z', sort: 'units', limit: 10, units_total: 90, distinct_products: 3,
      items: [{ product_id: P1, name: 'P1 Áo', units_sold: 40, items_amount: 4000000 }, { product_id: P2, name: 'P2 Quần', units_sold: 25, items_amount: 5000000 }, { product_id: P3, name: 'P3 Tất', units_sold: 25, items_amount: 1250000 }] });
  });

  it('DSH-TC-20261006-110331871: xếp theo giá trị, P2, P1, P3', async () => {
    const { P1, P2, P3 } = await three();
    const r = await report('?from=2026-09-01&to=2026-09-30&sort=amount');
    expect(r.body.items.map((i: { product_id: string }) => i.product_id)).toEqual([P2, P1, P3]);
    expect([r.body.sort, r.body.items.map((i: { items_amount: number }) => i.items_amount)]).toEqual(['amount', [5000000, 4000000, 1250000]]);
  });

  it('DSH-TC-20261006-110331903: staff và customer nhận 403, chưa đăng nhập 401 ở báo cáo sản phẩm', async () => {
    const spy = jest.spyOn(t.ord, 'getTopProducts');
    for (const w of [p.staff, p.customer]) expect((await report(undefined, w.cookie)).status).toBe(403);
    expect((await report(undefined, null)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110331936: limit hoặc sort sai nhận 400, ORD được gọi 0 lần; limit 1 và 50 là hợp lệ', async () => {
    const spy = jest.spyOn(t.ord, 'getTopProducts');
    const bad: [string, string][] = [['limit=51', 'limit'], ['limit=0', 'limit'], ['limit=2.5', 'limit'], ['sort=price', 'sort'], ['limit=-1', 'limit'], ['limit=abc', 'limit'], ['limit=1e1', 'limit'], ['limit=%2B5', 'limit'], ['limit=05', 'limit'], ['limit=99999999999999999999', 'limit'], ['sort=UNITS', 'sort'], ['sort=units&sort=amount', 'sort'], ['limit=', 'limit'], ['sort=', 'sort']];
    for (const [qs, field] of bad) {
      const r = await report(`?from=2026-09-01&to=2026-09-30&${qs}`);
      expect([qs, r.status, r.body.type, r.body.errors?.[0]?.field]).toEqual([qs, 400, 'urn:ecom:error:invalid-parameter', field]);
    }
    expect(spy).not.toHaveBeenCalled();
    for (const l of [1, 50]) expect([l, (await report(`?from=2026-09-01&to=2026-09-30&limit=${l}`)).status]).toEqual([l, 200]);
  });

  it('DSH-TC-20261006-110331973: ORD quá hạn trả 503 nguồn ORD ở báo cáo sản phẩm', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.ord, 'getTopProducts').mockImplementation(() => later(1500, []));
    const r = await report();
    expect([r.status, r.body.source]).toEqual([503, 'ORD']);
    expect(r.text).not.toMatch(/items|units_total/);
  });

  it('DSH-TC-20261006-110332004: không có đơn đã thu tiền thì danh sách rỗng và tổng bằng 0', async () => {
    const P1 = await product(t);
    await sell([{ product: P1, price: 100_000, qty: 3 }], { payment: 'pending', paidAt: null, status: 'shipped', method: 'cod' });
    const r = await report();
    expect([r.status, r.body.items, r.body.units_total, r.body.distinct_products]).toEqual([200, [], 0, 0]);
  });

  it('DSH-TC-20261006-110332035: 12 sản phẩm có bán, limit mặc định 10, tổng tính cả 12', async () => {
    for (let i = 0; i < 12; i++) await sell([{ product: await product(t), price: 10_000, qty: 5 }]);
    const r = await report();
    expect([r.body.items.length, r.body.distinct_products, r.body.units_total]).toEqual([10, 12, 60]);
    const five = await report('?from=2026-09-01&to=2026-09-30&limit=5');
    expect([five.body.items.length, five.body.distinct_products, five.body.limit]).toEqual([5, 12, 5]);
  });

  it('DSH-TC-20261006-110332066: sản phẩm đổi giá và đổi tên cho một dòng, tên gần nhất, tiền cộng đúng', async () => {
    const P4 = await product(t, { name: 'Áo A mới' }); // tên hiện tại ở PRD (tên đã đổi sau đơn đầu)
    await sell([{ product: P4, price: 100_000, qty: 3, name: 'Áo A' }], { paidAt: new Date('2026-09-05T03:00:00Z') });
    await sell([{ product: P4, price: 120_000, qty: 2, name: 'Áo A mới' }], { paidAt: new Date('2026-09-20T03:00:00Z') });
    const r = await report();
    expect(r.body.items).toEqual([{ product_id: P4, name: 'Áo A mới', units_sold: 5, items_amount: 540000 }]);
  });

  it('DSH-TC-20261006-110332095: đơn đã hoàn tiền (payment_status refunded) không tính vào số lượng bán', async () => {
    const P1 = await product(t);
    await sell([{ product: P1, price: 100_000, qty: 4 }]);
    await sell([{ product: P1, price: 100_000, qty: 6 }], { payment: 'refunded' });
    const r = await report();
    expect([r.body.items[0].units_sold, r.body.units_total]).toEqual([4, 4]);
  });

  it('DSH-TC-20261006-120001003: tính theo ngày thu tiền paid_at, đơn COD thu muộn vào khoảng ngày thu chứ không theo ngày tạo', async () => {
    const P1 = await product(t);
    await sell([{ product: P1, price: 100_000, qty: 2 }], { method: 'cod', createdAt: new Date('2026-08-30T03:00:00Z'), paidAt: new Date('2026-09-02T04:00:00Z') });
    const sep = await report('?from=2026-09-01&to=2026-09-30');
    expect(sep.body.items.map((i: { product_id: string; units_sold: number }) => [i.product_id, i.units_sold])).toEqual([[P1, 2]]);
    const aug = await report('?from=2026-08-01&to=2026-08-31');
    expect([aug.body.items, aug.body.units_total]).toEqual([[], 0]);
  });

  it('DSH-TC-20261006-120001004: đơn hoàn về (returned) và đơn vừa hủy chưa hoàn tiền xong không tính vào số lượng bán', async () => {
    const P1 = await product(t);
    await sell([{ product: P1, price: 100_000, qty: 4 }], { status: 'delivered' });
    await sell([{ product: P1, price: 100_000, qty: 3 }], { status: 'returned' });
    await sell([{ product: P1, price: 100_000, qty: 5 }], { status: 'cancelled' });
    await sell([{ product: P1, price: 100_000, qty: 7 }], { status: 'expired' });
    const r = await report();
    expect([r.body.items[0].units_sold, r.body.units_total, r.body.distinct_products]).toEqual([4, 4, 1]);
  });
});
