import { badgeText } from '../../../web/lib/cart-const';
import { activeCart, buyer, call, cartsOf, createCrtApp, delItem, getCart, itemsOf, product, putCoupon, putShipping, q, resetCrt, seedCart, seedCoupon, seedMethod, sku, stock, type CrtApp } from '../support/crt';

// Ca bổ sung của lượt review độc lập epic CRT (REV-CRT-nn trong spec/epics/CRT/review.md): mỗi ca đóng một đột biến `lọt` ở bảng đột biến của implement. Mỗi tên test mang ID TC gần nhất
// của spec và mã REV để `mutations-crt.json` chạy đúng một ca. PRD, INV, PRM, SHP chạy thật trên PostgreSQL thật.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => jest.restoreAllMocks());

const summaryOf = (u: { cookie: string }) => call(t, 'get', '/cart/summary', { cookie: u.cookie });

describe('CRT review độc lập: ca bổ sung từ đột biến lọt', () => {
  it('CRT-TC-20261006-104452170 (REV-CRT-01): xóa một dòng (còn dòng khác) tăng version đúng 1 và ghi last_activity_at, để CHK thấy giỏ đã đổi (SB-30)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t), p2 = await sku(t);
    const old = new Date(Date.now() - 3600_000);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1 }, { product: p2 }], version: 5, lastActivityAt: old });
    expect((await delItem(t, u, items[0])).status).toBe(204);
    const c = (await cartsOf(t, u.id))[0];
    expect([c.id, c.version]).toEqual([cart, 6]);
    expect(c.last_activity_at.getTime()).toBeGreaterThan(old.getTime() + 3000_000);
    expect((await itemsOf(t, cart)).map((i) => i.product_id)).toEqual([p2]);
  });

  it('CRT-TC-20261006-104453162 (REV-CRT-02): gỡ mã khi giỏ không có mã trả 204 mà không đổi version và last_activity_at (idempotent)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t);
    const old = new Date(Date.now() - 3600_000);
    await seedCart(t, u.id, { lines: [{ product: p1 }], version: 7, lastActivityAt: old });
    const r = await call(t, 'delete', '/cart/coupon', { cookie: u.cookie });
    expect(r.status).toBe(204);
    const c = (await cartsOf(t, u.id))[0];
    expect([c.version, c.last_activity_at.getTime()]).toEqual([7, old.getTime()]);
  });

  it('CRT-TC-20261006-104453359 (REV-CRT-03): giỏ bị làm trống trong lúc chờ PRM thì áp mã 409 cart-empty và mã không được lưu vào giỏ trống', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const real = t.deps.evaluate.bind(t.deps);
    jest.spyOn(t.deps, 'evaluate').mockImplementation(async (input) => { await q(t, `DELETE FROM cart_items WHERE cart_id = '${cart}'`); return real(input); });
    const r = await putCoupon(t, u, 'SALE10');
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:cart-empty']);
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
  });

  it('CRT-TC-20261006-104453717 (REV-CRT-04): giỏ bị làm trống trong lúc chờ SHP thì chọn vận chuyển 409 cart-empty và lựa chọn không được lưu', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10);
    const m = await seedMethod(t, {});
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const real = t.deps.quote.bind(t.deps);
    jest.spyOn(t.deps, 'quote').mockImplementation(async (input) => { await q(t, `DELETE FROM cart_items WHERE cart_id = '${cart}'`); return real(input); });
    const r = await putShipping(t, u, m, 'Hà Nội');
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:cart-empty']);
    const c = (await activeCart(t, u.id))!;
    expect([c.shipping_method_id, c.shipping_city]).toEqual([null, null]);
  });

  it('CRT-TC-20261006-104452935 (REV-CRT-05): huy hiệu giỏ chỉ đếm giỏ active, không cộng dòng của giỏ đã converted hay abandoned', async () => {
    const u = await buyer(t);
    const p1 = await sku(t), p2 = await sku(t);
    await seedCart(t, u.id, { status: 'converted', lines: [{ product: p1, quantity: 4 }] });
    await seedCart(t, u.id, { status: 'abandoned', lines: [{ product: p2, quantity: 5 }] });
    expect((await summaryOf(u)).body).toEqual({ line_count: 0, item_count: 0 });
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    expect((await summaryOf(u)).body).toEqual({ line_count: 1, item_count: 2 });
  });

  it('CRT-TC-20261006-104452775 (REV-CRT-06): price_changed là true khi chỉ một trong hai dòng đổi giá, dòng không đổi giá không có previous_unit_price', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000), p2 = await sku(t, 50000);
    await seedCart(t, u.id, { lines: [{ product: p1, price: 140000 }, { product: p2, price: 50000 }] });
    const r = await getCart(t, u);
    expect(r.body.price_changed).toBe(true);
    expect(r.body.items.map((i: { price_changed: boolean }) => i.price_changed)).toEqual([true, false]);
    expect(r.body.items[1]).not.toHaveProperty('previous_unit_price');
  });

  it('CRT-TC-20261006-104452994 (REV-CRT-07): dòng ngừng bán có giá lúc thêm khác giá cuối không bật price_changed và không có previous_unit_price', async () => {
    const u = await buyer(t);
    const gone = await product(t, { price: 80000, status: 'archived' });
    await stock(t, gone, 5);
    await seedCart(t, u.id, { lines: [{ product: gone, price: 70000, reason: 'product_archived' }] });
    const r = await getCart(t, u);
    expect(r.body.items[0].availability).toEqual({ status: 'unavailable' });
    expect(r.body.price_changed).toBe(false);
    expect(r.body.items[0]).not.toHaveProperty('previous_unit_price');
  });

  it('CRT-TC-20261006-104452994 (REV-CRT-08): giỏ chỉ còn dòng ngừng bán và đang giữ mã thì xem giỏ không gọi PRM, mã giữ lại với lý do no_discount', async () => {
    const u = await buyer(t);
    const gone = await product(t, { price: 80000, status: 'archived' });
    await seedCart(t, u.id, { lines: [{ product: gone, reason: 'product_archived' }], coupon: 'SALE10' });
    const evaluate = jest.spyOn(t.prm, 'evaluate');
    const r = await getCart(t, u);
    expect(r.status).toBe(200);
    expect(r.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'no_discount' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('CRT-TC-20261006-104453603 (REV-CRT-09): thành phố đo bằng ký tự Unicode như char_length của PostgreSQL: 50 ký tự emoji được chọn, 51 bị 400', async () => {
    const u = await buyer(t);
    const p1 = await sku(t);
    const m = await seedMethod(t, {});
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const city = '😀'.repeat(50);
    const ok = await putShipping(t, u, m, city);
    expect(ok.status).toBe(200);
    expect((await activeCart(t, u.id))!.shipping_city).toBe(city);
    const long = await putShipping(t, u, m, `${city}😀`);
    expect([long.status, long.body.errors[0]]).toEqual([400, { field: 'city', code: 'too_long' }]);
  });

  it('CRT-TC-20261006-104453980 (REV-CRT-10): CartApi từ chối user_id không phải uuid bằng RangeError ở cả snapshotForCheckout và lockForCheckout (không để lỗi CSDL lọt ra)', async () => {
    for (const bad of ['abc', '', "x'; DROP TABLE carts; --", 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', 42 as unknown as string]) {
      await expect(t.cart.snapshotForCheckout(bad)).rejects.toBeInstanceOf(RangeError);
      await expect(t.tx.run((tx) => t.cart.lockForCheckout(bad, tx))).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('CRT-TC-20261006-104454533 (REV-CRT-11): dòng hết hàng hẳn (kho 0 hay chưa có bản ghi kho) là issue insufficient_stock với available 0 và chặn can_checkout ở giao diện CHK', async () => {
    const u = await buyer(t);
    const zero = await product(t, { price: 100000 }), none = await product(t, { price: 100000 });
    await stock(t, zero, 0);
    await seedCart(t, u.id, { lines: [{ product: zero }, { product: none }] });
    const s = await t.cart.snapshotForCheckout(u.id);
    expect(s).toMatchObject({ ok: true, can_checkout: false });
    if (s.ok) expect(s.issues).toEqual([{ product_id: zero, reason: 'insufficient_stock', available: 0 }, { product_id: none, reason: 'insufficient_stock', available: 0 }]);
    expect(await t.tx.run((tx) => t.cart.lockForCheckout(u.id, tx))).toEqual(s);
  });

  it('CRT-E2E-20261006-104523348 (REV-CRT-12): huy hiệu giỏ hiện "99+" từ 99 sản phẩm trở lên (ui/add-to-cart)', () => {
    expect([0, 1, 98].map(badgeText)).toEqual(['0', '1', '98']);
    expect([99, 100, 5000].map(badgeText)).toEqual(['99+', '99+', '99+']);
  });
});
