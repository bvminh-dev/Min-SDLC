import { randomUUID } from 'node:crypto';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { baseHo, createHo, ho, resetSources } from '../support/ho';
import { ADDRESS, baseInput, createOrdApp, createPending, type OrdApp } from '../support/ord';

// Giao diện đọc cho SHP (getShipmentDisplay) và DSH (getSourcesReport, getSalesReport): ORD-REQ-20261015-092748751. Khoảng UTC nửa mở, mốc dựng tường minh (fixed-clock: Clock giả).
const FROM = new Date('2026-10-01T00:00:00Z'), TO = new Date('2026-10-06T00:00:00Z');
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 3));

describe('ORD giao diện đọc cho SHP và DSH', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); await resetSources(t); t.logs.clear(); t.clock.set(day(3)); });
  const cod = (user: string, amount: number) => baseInput(user, { payment_method: 'cod', payment_expires_at: null, items: [{ product_id: randomUUID(), name_snapshot: 'Hàng', unit_price: amount, quantity: 1 }], items_total: amount, discount: 0, shipping_fee: 0, grand_total: amount });
  const hoAmount = (by: string, amount: number, o = {}) => baseHo(by, { items: [{ product_id: randomUUID(), name_snapshot: 'Hàng', unit_price: amount, cost_snapshot: null, quantity: 1, note: null }], items_total: amount, discount: 0, shipping_fee: 0, grand_total: amount, ...o });
  const setStatus = (id: string, status: string) => q(t, `UPDATE orders SET status = '${status}'${status === 'delivered' ? ', delivered_at = created_at' : ''}${status === 'cancelled' ? ", cancel_reason = 'admin', cancelled_by_role = 'admin'" : ''}${status === 'confirmed' ? ', confirmed_at = created_at' : ''} WHERE id = '${id}'`);
  const queries = () => jest.spyOn(t.prisma, '$queryRaw');

  it('ORD-TC-20261015-092749602: getShipmentDisplay trả khối khách của cả trang bằng một SELECT và một lời gọi AUTH, đúng ánh xạ khóa, thứ tự theo order_ids; một trăm id vẫn một lời gọi AUTH', async () => {
    const { s1, a } = await ho(t);
    const addr = { receiver: 'Nguyễn Văn Nam', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', city: 'TP.HCM' };
    const A = await createHo(t, baseHo(s1.id, { customer_snapshot: { full_name: 'Lê Thị Bích', phone: '0987654321' }, shipping_address: addr }));
    const B = await createPending(t, baseInput(a.id, { payment_method: 'cod', payment_expires_at: null, shipping_address: { ...ADDRESS, receiver: 'Phạm Hoa', district: null } }));
    const C = await createHo(t, baseHo(s1.id, { customer_snapshot: { full_name: 'Đỗ Văn Cường', phone: '0911222333' } }));
    const names = jest.spyOn(t.api, 'getDisplayNames');
    const sql = queries();
    const out = await t.ord.getShipmentDisplay([A.order_id, B.order_id, C.order_id]);
    expect(out.map((x) => x.order_id)).toEqual([A.order_id, B.order_id, C.order_id]);
    expect(out[0]).toEqual({ order_id: A.order_id, customer_name: 'Lê Thị Bích', phone: '0901234567', address: '12 Lê Lợi, Bến Nghé, Quận 1, TP.HCM', created_by: s1.id, created_by_name: 'Trần Thu' });
    expect(out[1]).toEqual({ order_id: B.order_id, customer_name: 'Phạm Hoa', phone: '0901234567', address: '12 Lê Lợi, Bến Nghé, TP.HCM', created_by: null, created_by_name: null }); // không đoạn quận
    expect(out[2].customer_name).toBe('Đỗ Văn Cường');
    expect(names).toHaveBeenCalledTimes(1);
    expect(names.mock.calls[0][0]).toEqual([s1.id]); // không trùng, không null
    expect(sql).toHaveBeenCalledTimes(2); // một SELECT đơn, một truy vấn của AUTH (lời gọi AUTH)
    expect(JSON.stringify(out)).not.toMatch(/email|user_id|"note"|source|cost_snapshot/);
    names.mockClear();
    const ids = [A.order_id, B.order_id, C.order_id];
    for (let i = 0; i < 97; i++) ids.push((await createHo(t, baseHo(s1.id))).order_id);
    expect((await t.ord.getShipmentDisplay(ids)).length).toBe(100);
    expect(names).toHaveBeenCalledTimes(1);
    sql.mockRestore(); names.mockRestore();
  }, 60_000);

  it('ORD-TC-20261015-092749639: getSourcesReport và getSalesReport: đơn được tính theo created_at trong khoảng, loại cancelled, expired, returned, hai báo cáo khớp nhau và khớp countByStatus; mỗi hàm một truy vấn tổng hợp', async () => {
    const { s1, s2, a } = await ho(t);
    const plan: [string, () => Promise<{ order_id: string }>, string][] = [
      ['website', () => createPending(t, cod(a.id, 100000)), 'delivered'], ['website', () => createPending(t, cod(a.id, 200000)), 'paid'], ['website', () => createPending(t, cod(a.id, 300000)), 'confirmed'],
      ['facebook', () => createHo(t, hoAmount(s1.id, 400000)), 'shipped'], ['facebook', () => createHo(t, hoAmount(s1.id, 999000)), 'cancelled'],
      ['hotline', () => createHo(t, hoAmount(s2.id, 500000, { source_code: 'hotline' })), 'returned'], ['website', () => createPending(t, cod(a.id, 888000)), 'expired'],
    ];
    for (const [i, [, make, status]] of plan.entries()) { t.clock.set(day(2 + (i % 3))); await setStatus((await make()).order_id, status); }
    const sql = queries();
    const src = await t.ord.getSourcesReport({ from: FROM, to: TO });
    expect(sql).toHaveBeenCalledTimes(1);
    const byCode = Object.fromEntries(src.items.map((i) => [i.code, i]));
    expect(Object.keys(byCode).sort()).toEqual(['facebook', 'hotline', 'tiktok', 'website']);
    expect([byCode.website.orders, byCode.website.revenue, byCode.facebook.orders, byCode.facebook.revenue, byCode.hotline.orders, byCode.hotline.revenue, src.excluded_orders]).toEqual([3, 600000, 1, 400000, 0, 0, 3]);
    expect(Object.keys(byCode.website).sort()).toEqual(['code', 'is_active', 'name', 'orders', 'revenue', 'source_id']);
    sql.mockClear();
    const sales = await t.ord.getSalesReport({ from: FROM, to: TO });
    expect(sql).toHaveBeenCalledTimes(2); // một truy vấn tổng hợp và một lời gọi AUTH
    expect(sales.items.find((i) => i.created_by === null)).toEqual({ created_by: null, name: null, orders: 3, revenue: 600000 });
    expect(sales.items.find((i) => i.created_by === s1.id)).toEqual({ created_by: s1.id, name: 'Trần Thu', orders: 1, revenue: 400000 });
    expect(sales.items.find((i) => i.created_by === s2.id)).toBeUndefined(); // đơn duy nhất của S2 bị loại
    expect(sales.excluded_orders).toBe(3);
    const sum = (r: { items: { orders: number; revenue: number }[] }) => [r.items.reduce((n, i) => n + i.orders, 0), r.items.reduce((n, i) => n + i.revenue, 0)];
    expect(sum(src)).toEqual(sum(sales));
    const byStatus = await t.ord.countByStatus({ from: FROM, to: TO });
    expect(Object.values(byStatus).reduce((n, x) => n + x, 0)).toBe(sum(src)[0] + src.excluded_orders); // 7 = 4 + 3
    expect(JSON.stringify([src, sales])).not.toMatch(/cost_snapshot|note|full_name|phone|address|receiver/);
    sql.mockRestore();
  });

  it('ORD-TC-20261015-092749676: getShipmentDisplay và báo cáo từ chối đầu vào sai bằng RangeError trước khi truy vấn; lỗi AUTH được ném nguyên', async () => {
    const { s1 } = await ho(t);
    const o = await createHo(t, baseHo(s1.id));
    const sql = queries();
    const ok = randomUUID();
    for (const bad of [[], Array.from({ length: 101 }, () => randomUUID()), [ok, ok], ['abc']]) await expect(t.ord.getShipmentDisplay(bad)).rejects.toThrow(RangeError);
    for (const bad of [{ from: TO, to: FROM }, { from: new Date('x'), to: TO }, { from: FROM, to: new Date('+010000-01-01T00:00:00Z') }]) {
      await expect(t.ord.getSourcesReport(bad)).rejects.toThrow(RangeError);
      await expect(t.ord.getSalesReport(bad)).rejects.toThrow(RangeError);
    }
    expect(sql).not.toHaveBeenCalled();
    sql.mockRestore();
    const down = jest.spyOn(t.api, 'getDisplayNames').mockRejectedValue(new Error('auth down'));
    await expect(t.ord.getShipmentDisplay([o.order_id])).rejects.toThrow('auth down');
    t.clock.set(day(3));
    await expect(t.ord.getSalesReport({ from: new Date('2020-01-01T00:00:00Z'), to: new Date('2099-01-01T00:00:00Z') })).rejects.toThrow('auth down');
    down.mockRestore();
  });

  it('ORD-TC-20261015-092749716: báo cáo theo nguồn: khoảng rỗng, nguồn đã tắt, biên nửa mở [from, to), sale đổi role vẫn có dòng, tài khoản không còn ở AUTH có name null', async () => {
    const { s1, s2, a } = await ho(t);
    await q(t, `INSERT INTO order_sources (code, name, is_active) VALUES ('youtube', 'YouTube', false)`);
    const empty = await t.ord.getSourcesReport({ from: FROM, to: TO });
    expect(empty.items.map((i) => [i.code, i.orders, i.revenue]).sort()).toEqual([['facebook', 0, 0], ['hotline', 0, 0], ['tiktok', 0, 0], ['website', 0, 0]]); // youtube tắt, không đơn: không có mặt
    expect(empty.excluded_orders).toBe(0);
    expect(await t.ord.getSalesReport({ from: FROM, to: TO })).toEqual({ items: [], excluded_orders: 0 });
    for (const at of [FROM, new Date('2026-10-03T00:00:00Z'), TO]) { t.clock.set(at); await createHo(t, hoAmount(s1.id, 100000, { source_code: 'tiktok' })); } // đúng from, giữa khoảng, đúng to
    await q(t, `UPDATE order_sources SET is_active = false WHERE code = 'tiktok'`);
    const r = await t.ord.getSourcesReport({ from: FROM, to: TO });
    expect(r.items.find((i) => i.code === 'tiktok')).toMatchObject({ is_active: false, orders: 2, revenue: 200000 }); // đơn ở from tính, đơn ở to không
    t.clock.set(day(3));
    await createHo(t, hoAmount(s2.id, 50000));
    await createPending(t, cod(a.id, 70000));
    await q(t, `UPDATE users SET role = 'customer' WHERE id = '${s2.id}'`);
    const sales = await t.ord.getSalesReport({ from: FROM, to: TO });
    expect(sales.items.find((i) => i.created_by === s2.id)).toMatchObject({ name: 'Lê Hoa', orders: 1 }); // đổi role vẫn có dòng theo created_by
    const gone = jest.spyOn(t.api, 'getDisplayNames').mockResolvedValue([{ user_id: s1.id, display_name: 'Trần Thu', avatar_url: null }]);
    const sales2 = await t.ord.getSalesReport({ from: FROM, to: TO });
    expect(sales2.items.find((i) => i.created_by === s2.id)?.name).toBeNull(); // tài khoản không còn ở AUTH
    expect(sales2.items.find((i) => i.created_by === s1.id)?.name).toBe('Trần Thu');
    gone.mockRestore();
  });
});
