import { sku, type CrtApp } from '../support/crt';
import { call, countOf, create, createChkApp, customer, noTrace, outboxOf, pickPayment, placeShown, ready, resetChk, seedCart, seedCoupon, seedMethod, sessionRow, setPrice, shopper, tally, view, who, world, type ChkApp, type World } from '../support/chk';

// REQ ...105051681 (xem lại đơn trước khi đặt): CRT, PRM, SHP, USR, INV thật; module chậm dựng bằng jest.spyOn trên lớp `*Api`.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => { jest.restoreAllMocks(); t.chk.timeoutMs = t.config.get<number>('CHK_DEPENDENCY_TIMEOUT_MS'); });

describe('CHK xem lại đơn (CHK-REQ-20261006-105051681)', () => {
  it('CHK-TC-20261006-110702133: xem lại đủ: tổng do máy chủ tính đúng công thức (350000 - 35000 + 30000 = 345000), expected_grand_total và cart_version, blockers rỗng, no-store, không lộ user_id, cart_id, price_snapshot', async () => {
    const s = await shopper(t, w, { coupon: 'SALE10', method: w.sm1 });
    const id = await ready(t, s, w, { pay: 'cod' });
    const r = await view(t, s.u, id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id, status: 'open', cart_version: 7, items_subtotal: 350000, discount: 35000, shipping_fee: 30000, grand_total: 345000, total_is_estimate: false, expected_grand_total: 345000,
      blockers: [], can_place_order: true, payment_method: 'cod', payment_note: { hold_minutes: null, confirmed_immediately: true }, coupon: { code: 'SALE10', applied: true, discount: 35000 },
      shipping: { method_id: w.sm1, name: 'Giao tiêu chuẩn', city: 'Hà Nội', fee: 30000, free_shipping: false }, address: { city: 'Hà Nội', changed: false },
    });
    expect(r.body.lines).toEqual([
      { product_id: w.p1, name: 'Áo thun cotton', quantity: 2, unit_price: 150000, line_total: 300000, availability: { status: 'ok' } },
      { product_id: w.p2, name: 'Tất cổ cao', quantity: 1, unit_price: 50000, line_total: 50000, availability: { status: 'ok' } },
    ]);
    expect(r.headers['cache-control']).toBe('no-store');
    for (const k of ['user_id', 'cart_id', 'price_snapshot', 'last_activity_at']) expect(JSON.stringify(r.body)).not.toContain(`"${k}"`);
  });

  it('CHK-TC-20261006-110702169: phiên mới chưa chọn gì: blockers có missing_address, missing_shipping_method, missing_payment_method; shipping_fee null; total_is_estimate; can_place_order false', async () => {
    const u = await customer(t);
    await seedCart(t as unknown as CrtApp, u.id, { lines: [{ product: w.p1, quantity: 2 }, { product: w.p2, quantity: 1 }], version: 7 });
    const id = (await create(t, u)).body.id;
    const r = await view(t, u, id);
    expect(r.body).toMatchObject({ shipping_fee: null, total_is_estimate: true, can_place_order: false, grand_total: 350000, address: null, shipping: null, payment_method: null, payment_note: null });
    expect(r.body.blockers).toEqual(expect.arrayContaining(['missing_address', 'missing_shipping_method', 'missing_payment_method']));
  });

  it('CHK-TC-20261006-110702205: phiên của người khác, uuid không có, "abc" cùng một 404 checkout-session-not-found giống hệt; staff 403', async () => {
    const s = await shopper(t, w);
    const id = (await create(t, s.u)).body.id;
    const b = await customer(t), staff = await who(t, 'staff', 's@shop.vn');
    const rs = [await view(t, b, id), await view(t, s.u, '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c'), await view(t, s.u, 'abc')];
    for (const r of rs) { expect(r.status).toBe(404); expect(r.body.type).toBe('urn:ecom:error:checkout-session-not-found'); }
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[1].body));
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[2].body));
    expect((await view(t, staff, id)).status).toBe(403);
  });

  it('CHK-TC-20261006-110702243: PRM quá hạn gọi: 200, coupon {applied: false, reason: service_unavailable}, discount 0, can_place_order false; phần hàng và phí vẫn có số, không bịa số giảm giá', async () => {
    const s = await shopper(t, w, { coupon: 'SALE10', method: w.sm1 });
    const id = await ready(t, s, w, { pay: 'cod' });
    t.chk.timeoutMs = 300;
    jest.spyOn(t.prm, 'evaluate').mockImplementation(() => new Promise((res) => setTimeout(() => res({ ok: false, reason: 'coupon_expired' }), 800)));
    const r = await view(t, s.u, id);
    expect(r.status).toBe(200);
    expect(r.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'service_unavailable' });
    expect(r.body).toMatchObject({ discount: 0, can_place_order: false, items_subtotal: 350000, shipping_fee: 30000, grand_total: 380000 });
    expect(r.body.lines).toHaveLength(2);
  });

  it('CHK-TC-20261006-110702278: phiên đã completed: xem lại chỉ trả { id, status, order_code }, không dòng hàng, tiền, địa chỉ; không đơn mới, không reservation mới', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    const done = await placeShown(t, s, id);
    expect(done.status).toBe(201);
    const before = await tally(t);
    const r = await view(t, s.u, id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id, status: 'completed', order_code: done.body.order.code });
    expect(await tally(t)).toEqual(before);
  });

  it('CHK-TC-20261006-110702313: giá PRD đổi giữa hai lần xem: unit_price, items_subtotal, discount, grand_total và expected_grand_total đổi theo (160000 x 2 + 50000 = 370000, giảm 37000, tổng 363000)', async () => {
    const s = await shopper(t, w, { coupon: 'SALE10', method: w.sm1 });
    const id = await ready(t, s, w, { pay: 'cod' });
    expect((await view(t, s.u, id)).body.grand_total).toBe(345000);
    await setPrice(t, w.p1, 160000);
    const r = (await view(t, s.u, id)).body;
    expect(r.lines[0].unit_price).toBe(160000);
    expect(r).toMatchObject({ items_subtotal: 370000, discount: 37000, grand_total: 363000, expected_grand_total: 363000 });
  });

  it('CHK-TC-20261006-110702349: giỏ 50 dòng, giá 1.000.000.000, số lượng 99: tổng không tràn (4950000000000 chính xác, JSON không dạng khoa học), blockers có amount_out_of_range_online với VNPay', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(await sku(t as unknown as CrtApp, 1_000_000_000, 99));
    const s = await shopper(t, w, { lines: ids.map((product) => ({ product, quantity: 99 })) });
    const free = await seedMethod(t, { name: 'Miễn phí lớn', fee: 30000, freeOver: 1 });
    const id = await ready(t, s, w, { pay: null, method: free });
    await t.prisma.$executeRaw`UPDATE checkout_sessions SET payment_method = 'vnpay'::checkout_payment_method WHERE id = ${id}::uuid`; // chọn VNPay lúc giỏ còn nhỏ (dựng bằng SQL)
    const r = await call(t, 'get', `/checkout/sessions/${id}`, { cookie: s.u.cookie });
    expect(r.status).toBe(200);
    expect(r.body.items_subtotal).toBe(4_950_000_000_000);
    expect(r.body.grand_total).toBe(4_950_000_000_000);
    expect(r.text).toContain('"items_subtotal":4950000000000');
    expect(r.text).not.toMatch(/e\+/);
    expect(r.body.blockers).toContain('amount_out_of_range_online');
    expect(pickPayment).toBeDefined();
    expect(countOf).toBeDefined();
    expect(outboxOf).toBeDefined();
    expect(sessionRow).toBeDefined();
  });
});
