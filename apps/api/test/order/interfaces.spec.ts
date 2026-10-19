import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/modules/platform';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { createOrdApp, people, seedOrder, sleep, sqlOf, type OrdApp, type Status } from '../support/ord';

// Giao diện đọc nội bộ cho PAY, SHP, REV, DSH (ORD-REQ-20261006-120227681): bộ trường tối thiểu, "không thấy" đồng nhất, tổng hợp theo khoảng UTC nửa mở.
describe('ORD giao diện đọc nội bộ', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });
  const RANGE = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') };
  const day = (d: number, h = 9) => new Date(Date.UTC(2026, 9, d, h));
  const keys = (o: object | null) => Object.keys(o ?? {}).sort();

  it('ORD-TC-20261006-120228061: PAY, SHP, REV đọc đơn qua giao diện đọc với bộ trường tối thiểu (bảy, sáu, năm khóa), không địa chỉ hay điện thoại ngoài getRecipient; không ghi bảng nào', async () => {
    const { a } = await people(t);
    const exp = new Date(Date.now() + 900_000);
    const [o1, o2] = [await seedOrder(t, { user: a.id, status: 'pending', expiresAt: exp }), await seedOrder(t, { user: a.id, status: 'paid' })];
    const before = JSON.stringify([await q(t, 'SELECT * FROM orders ORDER BY id'), await q(t, 'SELECT * FROM order_status_history ORDER BY seq'), await q(t, 'SELECT count(*) FROM outbox_events'), await q(t, 'SELECT count(*) FROM audit_logs')], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const pay = await t.ord.findForPayment(o1.id);
    expect(keys(pay)).toEqual(['code', 'grand_total', 'order_id', 'payment_expires_at', 'payment_method', 'status', 'user_id']);
    expect(pay).toMatchObject({ order_id: o1.id, code: o1.code, user_id: a.id, status: 'pending', payment_method: 'vnpay', grand_total: 380000 });
    expect(pay?.payment_expires_at).toEqual(exp);
    const ship = [await t.ord.findForShipment(o2.id), await t.ord.findByCode(o2.code), await t.ord.findOwned(o2.code, a.id)];
    for (const s of ship) { expect(keys(s)).toEqual(['code', 'created_by', 'grand_total', 'order_id', 'payment_method', 'shipping_method_id', 'status']); expect(s).toEqual(ship[0]); } /* created_by: null với đơn khách tự đặt */
    expect(await t.ord.getRecipient(o2.id)).toEqual({ receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' });
    const product = randomUUID(), other = await seedOrder(t, { user: a.id, status: 'shipped', items: [{ product }] });
    const [d1, d2] = [await seedOrder(t, { user: a.id, status: 'delivered', items: [{ product }, { price: 1 }], deliveredAt: day(6, 10) }), await seedOrder(t, { user: a.id, status: 'delivered', items: [{ product }], deliveredAt: day(6, 12) })];
    const rows = await t.ord.getDeliveredItems(a.id, product);
    expect(rows.map((r) => [r.order_id, r.delivered_at.toISOString()])).toEqual([[d1.id, day(6, 10).toISOString()], [d2.id, day(6, 12).toISOString()]]);
    expect(rows.every((r) => keys(r).join() === 'delivered_at,order_id,order_item_id')).toBe(true);
    expect(rows.map((r) => r.order_id)).not.toContain(other.id);
    const after = JSON.stringify([await q(t, 'SELECT * FROM orders ORDER BY id'), await q(t, 'SELECT * FROM order_status_history ORDER BY seq'), await q(t, 'SELECT count(*) FROM outbox_events'), await q(t, 'SELECT count(*) FROM audit_logs')], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const [b4, af] = [JSON.parse(before), JSON.parse(after)];
    expect(af[0].filter((r: any) => [o1.id, o2.id].includes(r.id))).toEqual(b4[0].filter((r: any) => [o1.id, o2.id].includes(r.id))); // đọc không đổi bảng
    expect([af[2], af[3]]).toEqual([b4[2], b4[3]]); // không event, không audit
  });

  it('ORD-TC-20261006-120228155: DSH đọc tổng hợp: tám trạng thái kể cả returned, chuỗi theo mốc ngày (đơn thu theo paid_at), đơn gần đây không dữ liệu cá nhân, sản phẩm bán chạy chỉ đơn succeeded trong khoảng', async () => {
    const { a } = await people(t);
    const [P, Q, R] = [randomUUID(), randomUUID(), randomUUID()];
    // mỗi đơn đã thu tiền có tổng 380000 (phí giao chọn để bù), nên 5 đơn thu trong khoảng là 1.900.000
    const paidOrder = (status: Status, items: { product: string; price: number; qty: number }[], dayN: number, paidDay = dayN) =>
      seedOrder(t, { user: a.id, status, items, shipping: 380000 - items.reduce((s, i) => s + i.price * i.qty, 0), createdAt: day(dayN), payment: 'succeeded', paidAt: day(paidDay, 10) });
    await paidOrder('paid', [{ product: P, price: 100000, qty: 3 }], 1);
    await paidOrder('paid', [{ product: P, price: 100000, qty: 2 }], 2);
    await paidOrder('paid', [{ product: P, price: 100000, qty: 1 }, { product: Q, price: 50000, qty: 1 }], 3);
    await paidOrder('shipped', [{ product: P, price: 100000, qty: 1 }, { product: Q, price: 50000, qty: 1 }], 4);
    await paidOrder('delivered', [{ product: Q, price: 50000, qty: 1 }], 5, 6); // tạo ngày 5, thu ngày 6: doanh thu tính theo paid_at
    const plain = (status: Status, dayN: number, o: { method?: 'vnpay' | 'cod'; payment?: 'pending' | 'cancelled' | 'succeeded'; paidAt?: Date | null; items?: { product: string; price: number; qty: number }[] } = {}) =>
      seedOrder(t, { user: a.id, status, createdAt: day(dayN, 8), payment: o.payment ?? 'pending', paidAt: o.paidAt ?? null, method: o.method, items: o.items });
    await plain('pending', 1); await plain('pending', 2); await plain('confirmed', 3, { method: 'cod' });
    await plain('delivered', 6, { method: 'cod' }); await plain('delivered', 6, { method: 'cod' });
    await seedOrder(t, { user: a.id, status: 'delivered', method: 'cod', createdAt: day(7, 8), payment: 'succeeded', paidAt: new Date('2026-10-08T01:00:00Z'), items: [{ product: R, price: 270000, qty: 1 }], shipping: 30000 }); // đơn COD thu ngày 08/10: ngoài khoảng, 300.000 // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    await plain('cancelled', 4, { payment: 'cancelled', items: [{ product: Q, price: 10000, qty: 9 }] }); await plain('cancelled', 5, { payment: 'cancelled' });
    await plain('expired', 6); await plain('returned', 7, { method: 'cod' });
    const counts = await t.ord.countByStatus(RANGE);
    expect(counts).toEqual({ pending: 2, confirmed: 1, paid: 3, shipped: 1, delivered: 4, cancelled: 2, expired: 1, returned: 1 });
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(15);
    const series = await t.ord.getOrderSeries(RANGE, 'day');
    expect(series.map((s) => s.bucket_start)).toEqual([1, 2, 3, 4, 5, 6, 7].map((d) => day(d, 0).toISOString()));
    const sum = (f: (s: (typeof series)[number]) => number) => series.reduce((x, s) => x + f(s), 0);
    expect(sum((s) => Object.values(s.orders).reduce((x, n) => x + n, 0))).toBe(15);
    expect([sum((s) => s.paid_orders), sum((s) => s.paid_total)]).toEqual([5, 1_900_000]); // đơn COD thu 08/10 (300.000) không tính
    expect(series[0]).toMatchObject({ orders: { paid: 1, pending: 1 }, paid_orders: 1, paid_total: 380000 });
    expect([series[4].orders.delivered, series[4].paid_orders, series[5].paid_orders, series[5].paid_total]).toEqual([1, 0, 1, 380000]); // đơn tạo ngày 5 thu ngày 6 nằm ở mốc ngày 6 của doanh thu, ngày 5 của số đơn
    const recent = await t.ord.listRecent(5);
    expect(recent).toHaveLength(5);
    for (const r of recent) { expect(keys(r)).toEqual(['code', 'created_at', 'grand_total', 'item_count', 'payment_method', 'payment_status', 'status']); expect(Number.isInteger(r.grand_total)).toBe(true); }
    expect(JSON.stringify(recent)).not.toMatch(/shipping_address|receiver|phone|user_id/);
    expect(recent.map((r) => r.created_at)).toEqual([...recent.map((r) => r.created_at)].sort().reverse());
    const top = await t.ord.getTopProducts(RANGE, 'quantity', 10);
    expect(top).toEqual([{ product_id: P, quantity: 7, amount: 700000 }, { product_id: Q, quantity: 3, amount: 150000 }]);
    expect((await t.ord.getTopProducts(RANGE, 'amount', 1)).map((x) => x.product_id)).toEqual([P]);
  });

  it('ORD-TC-20261007-182433372: getDeliveredItems sắp theo delivered_at, position, id: ổn định giữa các lần gọi, hai dòng cùng sản phẩm trong một đơn theo position, không lẫn sản phẩm khác hay đơn chưa giao', async () => {
    const { a } = await people(t);
    const P = randomUUID();
    const d2 = await seedOrder(t, { user: a.id, status: 'delivered', items: [{ product: P }], deliveredAt: day(6, 12), createdAt: day(1) }); // tạo trước nhưng giao sau
    const d3 = await seedOrder(t, { user: a.id, status: 'delivered', items: [{ product: P }, { price: 1 }, { product: P }], deliveredAt: day(6, 11), createdAt: day(2) });
    const d1 = await seedOrder(t, { user: a.id, status: 'delivered', items: [{ product: P }], deliveredAt: day(6, 10), createdAt: day(3) });
    await seedOrder(t, { user: a.id, status: 'shipped', items: [{ product: P }] });
    const ids = async (order: string) => (await q<{ id: string }>(t, `SELECT id FROM order_items WHERE order_id = '${order}' AND product_id = '${P}' ORDER BY position`)).map((r) => r.id);
    const [first, second] = [await t.ord.getDeliveredItems(a.id, P), await t.ord.getDeliveredItems(a.id, P)];
    expect(second).toEqual(first);
    expect(first.map((r) => r.order_id)).toEqual([d1.id, d3.id, d3.id, d2.id]); // 10:00, 11:00 (hai dòng), 12:00
    expect(first.slice(1, 3).map((r) => r.order_item_id)).toEqual(await ids(d3.id)); // position 1 rồi 3
    expect(first.every((r) => keys(r).join() === 'delivered_at,order_id,order_item_id')).toBe(true);
  });

  it('ORD-TC-20261006-120228244: findOwned trả cùng "không thấy" cho đơn người khác, mã không tồn tại, mã sai định dạng; findForPayment và getDeliveredItems không lỗi khi không có; limit quá trần, khoảng ngược bị từ chối và CSDL không nhận truy vấn tổng hợp', async () => {
    const { a, b } = await people(t);
    const o6 = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T' });
    expect([await t.ord.findOwned('8M2N4P6R8S0T', a.id), await t.ord.findOwned('9X9X9X9X9X9X', a.id), await t.ord.findOwned('abc', a.id)]).toEqual([null, null, null]);
    expect(await t.ord.findOwned(o6.code, b.id)).not.toBeNull();
    expect([await t.ord.findForPayment(randomUUID()), await t.ord.findForPayment('không-phải-uuid'), await t.ord.getDeliveredItems(a.id, randomUUID())]).toEqual([null, null, []]);
    expect(await t.ord.countOpenOrders('xx')).toEqual({ online_pending: 0, cod_open: 0 });
    const spy = jest.spyOn(t.app.get(PrismaService), '$queryRaw');
    const reversed = { from: RANGE.to, to: RANGE.from };
    const rejects = [t.ord.listRecent(101), t.ord.listRecent(0), t.ord.getTopProducts(RANGE, 'quantity', 1000), t.ord.getTopProducts(RANGE, 'sai' as never, 5), t.ord.getOrderSeries(reversed, 'day'), t.ord.getOrderSeries(RANGE, 'tuan' as never), t.ord.countByStatus(reversed)];
    for (const r of rejects) await expect(r).rejects.toThrow(RangeError);
    expect(sqlOf(spy.mock.calls)).toEqual([]); // không câu SQL nào chạy cho tham số sai
    spy.mockRestore();
    expect((await t.ord.getOrderSeries(RANGE, 'hour')).length).toBe(168); // đối chứng: 7 ngày x 24 giờ hợp lệ
    await expect(t.ord.getOrderSeries({ from: new Date('2026-01-01Z'), to: new Date('2028-01-01Z') }, 'hour')).rejects.toThrow(RangeError); // quá 1000 mốc
    await expect(t.ord.countByStatus({ from: new Date('x'), to: RANGE.to })).rejects.toThrow(RangeError);
  });

  it('ORD-TC-20261006-120228334: khoảng rỗng cho 0 ở cả tám trạng thái và mọi mốc (không bỏ mốc); biên nửa mở [from, to): đơn đúng mốc to không tính, 23:59:59.999 tính; đơn chưa commit không tính', async () => {
    const { a } = await people(t);
    const empty = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') };
    expect(Object.values(await t.ord.countByStatus(empty))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    const s = await t.ord.getOrderSeries(empty, 'day');
    expect(s).toHaveLength(1);
    expect([s[0].bucket_start, Object.values(s[0].orders).every((n) => n === 0), s[0].paid_orders, s[0].paid_total]).toEqual(['2026-11-01T00:00:00.000Z', true, 0, 0]);
    expect((await t.ord.getOrderSeries({ from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-04T00:00:00Z') }, 'day')).map((x) => x.bucket_start)).toHaveLength(3);
    await seedOrder(t, { user: a.id, status: 'paid', createdAt: new Date('2026-10-02T00:00:00.000Z') });
    await seedOrder(t, { user: a.id, status: 'paid', createdAt: new Date('2026-10-01T23:59:59.999Z') });
    const oct1 = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-02T00:00:00Z') };
    expect((await t.ord.countByStatus(oct1)).paid).toBe(1);
    const held = t.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO orders (user_id, code, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, created_at)
        VALUES (${a.id}::uuid, 'ABCDEFGHJKMN', 100000, 0, 0, 100000, '{}'::jsonb, ${randomUUID()}::uuid, 'cod', '2026-10-01T12:00:00Z')`;
      await sleep(1500);
    }, { timeout: 10_000 });
    await sleep(400);
    expect((await t.ord.countByStatus(oct1)).pending).toBe(0); // chưa commit
    await held;
    expect((await t.ord.countByStatus(oct1)).pending).toBe(1);
  });
});
