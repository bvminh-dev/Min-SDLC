import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { createOrdApp, people, seedOrder, type OrdApp } from '../support/ord';

// Sửa nền ORD kèm epic DSH (DSH-API mục Giao tiếp giữa module): `OrderApi.getProductSalesTotals` (số lượng và số sản phẩm của TOÀN khoảng) và `payment_method` ở `OrderApi.listRecent`.
// Mang ID của TC DSH kiểm kết quả cuối (DSH-TC-20261006-110332035, DSH-TC-20261006-110331071); các ca còn lại kiểm giao diện ORD ở mức hàm.
describe('ORD sửa nền cho DSH', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });
  const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };
  const at = (d: number) => new Date(Date.UTC(2026, 8, d, 3));

  it('ORD-TC-20261013-232524288 và DSH-TC-20261006-110332035 (nền ORD): getProductSalesTotals cộng TOÀN khoảng, cùng điều kiện lọc với getTopProducts, không bị giới hạn limit', async () => {
    const { a } = await people(t);
    const prods = Array.from({ length: 120 }, () => randomUUID());
    for (const [i, p] of prods.entries()) await seedOrder(t, { user: a.id, status: 'delivered', payment: 'succeeded', paidAt: at(5), createdAt: at(4), noHistory: true, items: [{ product: p, price: 1000, qty: (i % 3) + 1 }] }); // 120 sản phẩm: vượt trần limit 100 của getTopProducts
    await seedOrder(t, { user: a.id, status: 'delivered', payment: 'succeeded', paidAt: at(6), createdAt: at(4), noHistory: true, items: [{ product: prods[1], price: 1000, qty: 1 }] }); // sản phẩm thứ hai bán ở hai đơn: số sản phẩm khác nhau không đếm theo dòng
    await seedOrder(t, { user: a.id, status: 'delivered', payment: 'refunded', paidAt: at(5), createdAt: at(4), noHistory: true, items: [{ product: prods[0], price: 1000, qty: 50 }] });
    await seedOrder(t, { user: a.id, status: 'returned', method: 'cod', payment: 'succeeded', paidAt: at(5), createdAt: at(4), noHistory: true, items: [{ product: randomUUID(), price: 1000, qty: 9 }] });
    await seedOrder(t, { user: a.id, status: 'cancelled', payment: 'succeeded', paidAt: at(5), createdAt: at(4), noHistory: true, items: [{ product: randomUUID(), price: 1000, qty: 9 }] });
    await seedOrder(t, { user: a.id, status: 'delivered', payment: 'succeeded', paidAt: new Date('2026-10-01T00:00:00Z'), createdAt: at(4), noHistory: true, items: [{ product: randomUUID(), price: 1000, qty: 9 }] }); // đúng `to`: loại (nửa mở)
    await seedOrder(t, { user: a.id, status: 'paid', method: 'cod', payment: 'pending', paidAt: null, createdAt: at(4), noHistory: true, items: [{ product: randomUUID(), price: 1000, qty: 9 }] });
    const expected = prods.reduce((s, _p, i) => s + (i % 3) + 1, 0) + 1;
    expect(await t.ord.getProductSalesTotals(RANGE)).toEqual({ units_total: expected, distinct_products: 120 });
    const top = await t.ord.getTopProducts(RANGE, 'quantity', 100);
    expect(top).toHaveLength(100);
    expect(top.reduce((s, r) => s + r.quantity, 0)).toBeLessThan(expected); // danh sách cắt ở 100 dòng nên không thể suy ra tổng toàn khoảng từ đó
    expect(await t.ord.getProductSalesTotals({ from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-02T00:00:00Z') })).toEqual({ units_total: 0, distinct_products: 0 });
    for (const bad of [{ from: RANGE.to, to: RANGE.from }, { from: new Date('x'), to: RANGE.to }, { from: new Date('0001-01-01T00:00:00Z'), to: new Date('0000-12-31T00:00:00Z') }, null]) await expect(t.ord.getProductSalesTotals(bad as never)).rejects.toBeInstanceOf(RangeError);
  });

  it('DSH-TC-20261006-110331071 (nền ORD): listRecent trả payment_method (vnpay, cod) và đúng bảy khóa, không trường cá nhân', async () => {
    const { a } = await people(t);
    await seedOrder(t, { user: a.id, status: 'confirmed', method: 'cod', createdAt: at(3) });
    await seedOrder(t, { user: a.id, status: 'paid', method: 'vnpay', createdAt: at(4) });
    const r = await t.ord.listRecent(10);
    expect(r.map((o) => o.payment_method)).toEqual(['vnpay', 'cod']);
    for (const o of r) expect(Object.keys(o).sort()).toEqual(['code', 'created_at', 'grand_total', 'item_count', 'payment_method', 'payment_status', 'status']);
    expect(JSON.stringify(r)).not.toMatch(/user_id|receiver|phone|shipping_address|Lê Lợi/);
  });
});
