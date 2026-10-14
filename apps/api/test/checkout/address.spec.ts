import {
  call, cancel, countOf, create, createChkApp, customer, noTrace, options, orderItemsOf, ordersOf, pickAddress, place, placeShown, q, ready, resetChk, seedAddress, seedCoupon, sessionRow, shopper, tally, view, world,
  type ChkApp, type World,
} from '../support/chk';

// REQ ...105051095 (chọn địa chỉ giao hàng) và REQ ...105051242 (phí theo địa chỉ): USR, SHP, PRM, INV, ORD thật.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => jest.restoreAllMocks());

describe('CHK chọn địa chỉ giao hàng (CHK-REQ-20261006-105051095)', () => {
  it('CHK-TC-20261006-110701050: chọn địa chỉ khác thì bản chụp và phí vận chuyển tính lại theo city thật (phụ thu Hà Giang)', async () => {
    const s = await shopper(t, w, { lines: [{ product: w.p1, quantity: 1 }, { product: w.p2, quantity: 1 }] }); // tạm tính 200000
    const id = await ready(t, s, w, { pay: null });
    const r = await pickAddress(t, s.u, id, s.a2);
    expect(r.status).toBe(200);
    expect(r.body.address).toEqual({ address_id: s.a2, changed: false });
    const row = await sessionRow(t, id);
    const [a2] = await q<{ updated_at: Date }>(t, `SELECT updated_at FROM addresses WHERE id = '${s.a2}'`);
    expect(row.address_id).toBe(s.a2);
    expect(row.address_snapshot.city).toBe('Hà Giang');
    expect(new Date(row.address_snapshot.updated_at).getTime()).toBe(a2.updated_at.getTime());
    const o = await options(t, s.u, id);
    expect(o.status).toBe(200);
    expect(o.body.options).toEqual([
      { method_id: w.sm2, name: 'Giao nhanh', fee: 50000, free_shipping: false },
      { method_id: w.sm1, name: 'Giao tiêu chuẩn', fee: 80000, free_shipping: false },
    ]);
    expect((await view(t, s.u, id)).body).toMatchObject({ shipping_fee: 80000, address: { address_id: s.a2, city: 'Hà Giang' } });
  });

  it('CHK-TC-20261006-110701084: địa chỉ của người khác, uuid không có, "abc" cùng một 404 address-not-found giống hệt; trường lạ (city) bị 400; phiên không đổi', async () => {
    const s = await shopper(t, w);
    const other = await customer(t);
    const x1 = await seedAddress(t, other.id);
    const id = await ready(t, s, w, { pay: null, method: null });
    const before = await sessionRow(t, id);
    const rs = [await pickAddress(t, s.u, id, x1), await pickAddress(t, s.u, id, '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c'), await pickAddress(t, s.u, id, 'abc')];
    for (const r of rs) { expect(r.status).toBe(404); expect(r.body.type).toBe('urn:ecom:error:address-not-found'); }
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[1].body));
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[2].body));
    const bad = await pickAddress(t, s.u, id, s.a2, { city: 'Hà Giang' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual(['city']);
    const after = await sessionRow(t, id);
    expect([after.address_id, after.address_snapshot]).toEqual([before.address_id, before.address_snapshot]);
  });

  it('CHK-TC-20261006-110701117: địa chỉ đã chọn bị xóa (USR): xem lại báo address_unavailable, đặt hàng 409 address-unavailable, không đơn, không giữ hàng, không lượt coupon, phiên còn open và bỏ địa chỉ', async () => {
    const s = await shopper(t, w, { coupon: 'SALE10' });
    const id = await ready(t, s, w, { pay: 'cod' });
    const shown = (await view(t, s.u, id)).body;
    expect((await call(t, 'delete', `/me/addresses/${s.a1}`, { cookie: s.u.cookie })).status).toBe(204);
    const v = await view(t, s.u, id);
    expect(v.body.address).toEqual({ address_id: null, error: 'address_unavailable' });
    expect(v.body.blockers).toContain('address_unavailable');
    expect(v.body.can_place_order).toBe(false);
    const before = await tally(t);
    const r = await place(t, s.u, id, { expected_grand_total: shown.expected_grand_total, cart_version: shown.cart_version });
    expect(r.status).toBe(409);
    expect(r.body.type).toBe('urn:ecom:error:address-unavailable');
    expect(await tally(t)).toEqual(before);
    const row = await sessionRow(t, id);
    expect([row.status, row.address_id]).toEqual(['open', null]);
  });

  it('CHK-TC-20261006-110701151: địa chỉ bị sửa sau khi chọn: 409 address-changed kèm địa chỉ mới, không có gì được tạo, bản chụp của phiên cập nhật; đặt lại thì 201 và đơn mang số điện thoại mới (đúng năm khóa)', async () => {
    const s = await shopper(t, w, { coupon: 'SALE10' });
    const id = await ready(t, s, w, { pay: 'cod' });
    const shown = (await view(t, s.u, id)).body;
    expect(shown.grand_total).toBe(345000);
    t.clock.advance(5000); // USR ghi updated_at theo đồng hồ ứng dụng: phải khác mốc lúc dựng địa chỉ
    expect((await call(t, 'patch', `/me/addresses/${s.a1}`, { cookie: s.u.cookie, body: { phone: '0902222222' } })).status).toBe(200);
    const v = await view(t, s.u, id);
    expect(v.body.address).toMatchObject({ address_id: s.a1, phone: '0902222222', changed: true });
    expect(v.body.blockers).toContain('address_changed');
    const before = await tally(t);
    const body = { expected_grand_total: 345000, cart_version: shown.cart_version };
    const r = await place(t, s.u, id, body);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:address-changed', address: { phone: '0902222222', city: 'Hà Nội' } });
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).address_snapshot.phone).toBe('0902222222');
    const ok = await place(t, s.u, id, body);
    expect(ok.status).toBe(201);
    const [order] = await ordersOf(t, s.u.id);
    expect(order.shipping_address).toEqual({ receiver: 'Nguyễn An', phone: '0902222222', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hà Nội' });
    expect((await orderItemsOf(t, order.id)).map((i) => [i.product_id, i.quantity])).toEqual([[w.p1, 2], [w.p2, 1]]); // theo thứ tự dòng của giỏ (position)
  });

  it('CHK-TC-20261006-110701185: chưa có địa chỉ nào: lấy phí 409 address-required, đặt hàng 409 checkout-incomplete thiếu address (và shipping_method), không đơn; thêm địa chỉ rồi chọn thì blockers không còn missing_address', async () => {
    const u = await customer(t);
    const { seedCart } = await import('../support/crt');
    await seedCart(t as never, u.id, { lines: [{ product: w.p1, quantity: 1 }], version: 3 });
    const sess = await create(t, u);
    expect(sess.status).toBe(201);
    expect(sess.body.address).toBeNull();
    const id = sess.body.id;
    expect((await options(t, u, id)).body.type).toBe('urn:ecom:error:address-required');
    expect((await call(t, 'put', `/checkout/sessions/${id}/payment-method`, { cookie: u.cookie, body: { payment_method: 'cod' } })).status).toBe(200);
    const r = await place(t, u, id, { expected_grand_total: 150000, cart_version: 3 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:checkout-incomplete' });
    expect(r.body.missing).toEqual(expect.arrayContaining(['address', 'shipping_method']));
    expect(await countOf(t, 'orders')).toBe(0);
    const a = await seedAddress(t, u.id, { city: 'Hà Nội' });
    expect((await pickAddress(t, u, id, a)).status).toBe(200);
    expect((await view(t, u, id)).body.blockers).not.toContain('missing_address');
  });

  it('CHK-TC-20261006-110701216: đổi địa chỉ mặc định ở sổ địa chỉ không đổi lựa chọn của phiên đang mở; phiên mới sau khi hủy chọn sẵn địa chỉ mặc định mới', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null });
    expect((await call(t, 'patch', `/me/addresses/${s.a2}`, { cookie: s.u.cookie, body: { is_default: true } })).status).toBe(200);
    const v = await view(t, s.u, id);
    expect(v.body.address).toMatchObject({ address_id: s.a1, changed: false });
    expect((await cancel(t, s.u, id)).status).toBe(204);
    const n = await create(t, s.u);
    expect(n.status).toBe(201);
    expect(n.body.address).toEqual({ address_id: s.a2, changed: false });
    expect(placeShown).toBeDefined();
  });

  it('CHK-TC-20261006-110701249: phản hồi chứa địa chỉ có Cache-Control: no-store và log không có dữ liệu cá nhân (tên, điện thoại, dòng địa chỉ)', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    t.logs.clear();
    const put = await pickAddress(t, s.u, id, s.a1);
    const get = await view(t, s.u, id);
    const bad = await pickAddress(t, s.u, id, 'abc');
    expect([put.headers['cache-control'], get.headers['cache-control'], bad.status]).toEqual(['no-store', 'no-store', 404]);
    expect(get.body.address.phone).toBe('0901111111'); // chủ phiên thấy dữ liệu của mình
    const text = t.logs.lines.join('\n');
    for (const pii of ['0901111111', 'Nguyễn Huệ', 'Nguyễn An', 'Bến Nghé']) expect(text).not.toContain(pii);
    expect(t.logs.records.every((r) => typeof r.correlation_id === 'string')).toBe(true);
  });
});

describe('CHK lấy phí vận chuyển theo địa chỉ (CHK-REQ-20261006-105051242)', () => {
  it('CHK-TC-20261006-110701351: chưa có địa chỉ thì lấy phí 409 address-required và SHP quote không bị gọi', async () => {
    const u = await customer(t);
    const { seedCart } = await import('../support/crt');
    await seedCart(t as never, u.id, { lines: [{ product: w.p1, quantity: 1 }] });
    const id = (await create(t, u)).body.id;
    const spy = jest.spyOn(t.shp, 'quote');
    const r = await options(t, u, id);
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:address-required']);
    expect(spy).not.toHaveBeenCalled();
  });
});
