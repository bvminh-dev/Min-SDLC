import { seedOrder } from '../support/ord';
import { sku, type CrtApp } from '../support/crt';
import {
  applyCoupon, call, createChkApp, noTrace, options, pickPayment, pickShipping, place, q, ready, resetChk, seedCoupon, seedMethod, sessionRow, setMethodActive,
  setPrice, shopper, tally, view, world, countOf, type ChkApp, type World,
} from '../support/chk';

// REQ ...105051242 (vận chuyển) và ...105051386 (thanh toán): SHP, ORD, PRM thật; không giả module nào.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); });
afterEach(() => jest.restoreAllMocks());
const asCrt = (): CrtApp => t as unknown as CrtApp;

describe('CHK chọn vận chuyển và xem phí (CHK-REQ-20261006-105051242)', () => {
  it('CHK-TC-20261006-110701283: lấy phí theo city của địa chỉ thật (SM1 30000, SM2 50000 theo thứ tự fee tăng dần, items_subtotal 200000) rồi chọn SM1: DB có shipping_method_id, xem lại có shipping_fee 30000', async () => {
    const s = await shopper(t, w, { lines: [{ product: w.p1, quantity: 1 }, { product: w.p2, quantity: 1 }] });
    const id = await ready(t, s, w, { pay: null, method: null });
    const o = await options(t, s.u, id);
    expect(o.status).toBe(200);
    expect(o.body).toEqual({ city: 'Hà Nội', items_subtotal: 200000, options: [
      { method_id: w.sm1, name: 'Giao tiêu chuẩn', fee: 30000, free_shipping: false }, { method_id: w.sm2, name: 'Giao nhanh', fee: 50000, free_shipping: false } ] });
    const r = await pickShipping(t, s.u, id, w.sm1);
    expect(r.status).toBe(200);
    expect(r.body.shipping_method_id).toBe(w.sm1);
    expect((await sessionRow(t, id)).shipping_method_id).toBe(w.sm1);
    expect((await view(t, s.u, id)).body).toMatchObject({ shipping_fee: 30000, shipping: { method_id: w.sm1, fee: 30000, free_shipping: false } });
  });

  it('CHK-TC-20261006-110701316: ngưỡng miễn phí tính trên tạm tính TRƯỚC giảm giá: 600000 giảm 200000 vẫn miễn phí (shipping.fee 0, free_shipping true), tổng 400000', async () => {
    await seedCoupon(t, { code: 'FIXED200', type: 'fixed', value: 200000 });
    const s = await shopper(t, w, { lines: [{ product: w.p1, quantity: 4 }] });
    const id = await ready(t, s, w, { pay: null, coupon: 'FIXED200' });
    const v = (await view(t, s.u, id)).body;
    expect(v).toMatchObject({ items_subtotal: 600000, discount: 200000, shipping_fee: 0, grand_total: 400000, shipping: { fee: 0, free_shipping: true } });
  });

  it('CHK-TC-20261006-110701388: phương thức đã tắt, uuid không có, "abc" cùng một 409 shipping-method-unavailable giống hệt; phiên giữ lựa chọn trước đó', async () => {
    const sm3 = await seedMethod(t, { name: 'Đã tắt', active: false });
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null });
    const rs = [await pickShipping(t, s.u, id, sm3), await pickShipping(t, s.u, id, '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c'), await pickShipping(t, s.u, id, 'abc')];
    for (const r of rs) { expect(r.status).toBe(409); expect(r.body.type).toBe('urn:ecom:error:shipping-method-unavailable'); }
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[1].body));
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[2].body));
    expect((await sessionRow(t, id)).shipping_method_id).toBe(w.sm1);
  });

  it('CHK-TC-20261006-110701426: không có phương thức nào đang bật: lấy phí và đặt hàng cùng 409 no-shipping-methods, không đơn; xem lại có blocker no_shipping_methods', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod', method: null });
    await t.prisma.$executeRaw`UPDATE shipping_methods SET is_active = false`;
    const o = await options(t, s.u, id);
    const v = (await view(t, s.u, id)).body;
    const before = await tally(t);
    const r = await place(t, s.u, id, { expected_grand_total: v.expected_grand_total, cart_version: v.cart_version });
    expect([o.status, o.body.type, r.status, r.body.type]).toEqual([409, 'urn:ecom:error:no-shipping-methods', 409, 'urn:ecom:error:no-shipping-methods']);
    expect(await tally(t)).toEqual(before);
    expect(v.blockers).toContain('no_shipping_methods');
  });

  it('CHK-TC-20261006-110701463: phương thức bị tắt sau khi chọn: đặt hàng 409 shipping-method-unavailable, không đơn, phiên bỏ lựa chọn; xem lại có missing_shipping_method', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    const v = (await view(t, s.u, id)).body;
    await setMethodActive(t, w.sm1, false);
    const view2 = (await view(t, s.u, id)).body;
    expect(view2.shipping).toEqual({ method_id: w.sm1, error: 'method_unavailable' });
    expect(view2.blockers).toContain('shipping_method_unavailable');
    const before = await tally(t);
    const r = await place(t, s.u, id, { expected_grand_total: v.expected_grand_total, cart_version: v.cart_version });
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:shipping-method-unavailable']);
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).shipping_method_id).toBeNull();
    expect((await view(t, s.u, id)).body.blockers).toContain('missing_shipping_method');
  });

  it('CHK-TC-20261006-110701498: tạm tính đúng bằng ngưỡng miễn phí 500000 thì miễn phí; giảm còn 499999 thì phí 30000', async () => {
    const s = await shopper(t, w, { lines: [{ product: w.p1, quantity: 3 }, { product: w.p2, quantity: 1 }] }); // 450000 + 50000 = 500000
    const id = await ready(t, s, w, { pay: null, method: null });
    expect((await options(t, s.u, id)).body.options.find((x: { method_id: string }) => x.method_id === w.sm1)).toMatchObject({ fee: 0, free_shipping: true });
    await setPrice(t, w.p2, 49999);
    expect((await options(t, s.u, id)).body.options.find((x: { method_id: string }) => x.method_id === w.sm1)).toMatchObject({ fee: 30000, free_shipping: false });
  });

  it('CHK-TC-20261006-110701532: body chọn vận chuyển có thêm fee hay free_shipping bị 400 nêu đúng trường lạ; phiên không đổi', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    const a = await pickShipping(t, s.u, id, w.sm1, { fee: 0 }), b = await pickShipping(t, s.u, id, w.sm1, { free_shipping: true });
    expect([a.status, a.body.errors.map((e: { field: string }) => e.field), b.status, b.body.errors.map((e: { field: string }) => e.field)]).toEqual([400, ['fee'], 400, ['free_shipping']]);
    expect((await sessionRow(t, id)).shipping_method_id).toBeNull();
  });
});

describe('CHK chọn phương thức thanh toán (CHK-REQ-20261006-105051386)', () => {
  it('CHK-TC-20261006-110701564: chọn VNPay rồi COD: payment_note nêu hậu quả (giữ 15 phút / xác nhận ngay); DB có payment_method cod, không reservation hay Order', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    const a = await pickPayment(t, s.u, id, 'vnpay'), b = await pickPayment(t, s.u, id, 'cod');
    expect([a.status, a.body.payment_note, b.status, b.body.payment_note]).toEqual([200, { hold_minutes: 15, confirmed_immediately: false }, 200, { hold_minutes: null, confirmed_immediately: true }]);
    expect((await sessionRow(t, id)).payment_method).toBe('cod');
    expect([await countOf(t, 'orders'), await countOf(t, 'stock_reservations')]).toEqual([0, 0]);
  });

  /** Phương thức luôn miễn phí (ngưỡng 1) để tổng = tạm tính - giảm giá, dễ dựng số theo ý. */
  async function exact(price: number, o: { email?: string; coupon?: string; qty?: number } = {}) {
    const p = await sku(asCrt(), price, 99);
    const free = await seedMethod(t, { name: `Miễn phí ${Math.random()}`, fee: 30000, freeOver: 1 });
    const s = await shopper(t, w, { email: o.email, lines: [{ product: p, quantity: o.qty ?? 1 }] });
    const id = await ready(t, s, w, { pay: null, method: free, coupon: o.coupon });
    return { s, id, p, free };
  }

  it('CHK-TC-20261006-110701599: VNPay với số tiền 4999 bị 422 amount-out-of-range-online (min 5000, max 999999999), phiên giữ lựa chọn cũ; COD vẫn chọn được', async () => {
    const { s, id } = await exact(4999);
    expect((await view(t, s.u, id)).body.grand_total).toBe(4999);
    const a = await pickPayment(t, s.u, id, 'vnpay');
    expect([a.status, a.body.type, a.body.min, a.body.max]).toEqual([422, 'urn:ecom:error:amount-out-of-range-online', 5000, 999999999]);
    expect((await sessionRow(t, id)).payment_method).toBeNull();
    expect((await pickPayment(t, s.u, id, 'cod')).status).toBe(200);
  });

  it('CHK-TC-20261006-110701633: đơn 0 đồng bị 422 zero-total-unsupported ở cả COD, VNPay và đặt hàng; không Order; xem lại có blocker zero_total', async () => {
    await seedCoupon(t, { code: 'FULL50', type: 'fixed', value: 50000 });
    const { s, id } = await exact(50000);
    expect((await pickPayment(t, s.u, id, 'cod')).status).toBe(200); // còn 50000 lúc chọn
    const c = await applyCoupon(t, s.u, id, 'FULL50');
    expect([c.status, c.body.discount, c.body.grand_total]).toEqual([200, 50000, 0]);
    const rs = [await pickPayment(t, s.u, id, 'cod'), await pickPayment(t, s.u, id, 'vnpay')];
    const v = (await view(t, s.u, id)).body;
    rs.push(await place(t, s.u, id, { expected_grand_total: v.expected_grand_total, cart_version: v.cart_version }));
    for (const r of rs) { expect(r.status).toBe(422); expect(r.body.type).toBe('urn:ecom:error:zero-total-unsupported'); }
    expect(await countOf(t, 'orders')).toBe(0);
    expect(v.blockers).toContain('zero_total');
  });

  it('CHK-TC-20261006-110701666: đã có 3 đơn VNPay pending: chọn VNPay 409 too-many-open-orders (kind vnpay, limit 3, current 3); chọn COD vẫn 200', async () => {
    const s = await shopper(t, w);
    for (let i = 0; i < 3; i++) await seedOrder(t, { user: s.u.id, status: 'pending', method: 'vnpay' });
    const id = await ready(t, s, w, { pay: null, method: null });
    const r = await pickPayment(t, s.u, id, 'vnpay');
    expect([r.status, r.body.type, r.body.kind, r.body.limit, r.body.current]).toEqual([409, 'urn:ecom:error:too-many-open-orders', 'vnpay', 3, 3]);
    expect((await pickPayment(t, s.u, id, 'cod')).status).toBe(200);
  });

  it('CHK-TC-20261006-110701709: payment_method lạ, thiếu hoặc kèm card_number bị 400 validation-failed nêu đúng trường; không lưu gì, số thẻ không có trong CSDL và log', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    t.logs.clear();
    const a = await pickPayment(t, s.u, id, 'paypal');
    const b = await call(t, 'put', `/checkout/sessions/${id}/payment-method`, { cookie: s.u.cookie, body: {} });
    const c = await pickPayment(t, s.u, id, 'vnpay', { card_number: '4111111111111111' });
    expect([a.status, b.status, c.status]).toEqual([400, 400, 400]);
    expect(a.body.errors.map((e: { field: string }) => e.field)).toEqual(['payment_method']);
    expect(b.body.errors.map((e: { field: string }) => e.field)).toEqual(['payment_method']);
    expect(c.body.errors.map((e: { field: string }) => e.field)).toEqual(['card_number']);
    expect((await sessionRow(t, id)).payment_method).toBeNull();
    expect(JSON.stringify(await q(t, 'SELECT * FROM checkout_sessions'))).not.toContain('4111111111111111');
    expect(t.logs.lines.join('\n')).not.toContain('4111111111111111');
  });

  it('CHK-TC-20261006-110701748: biên số tiền VNPay: 5000 và 999999999 chọn được, 1000000000 bị 422', async () => {
    const results: number[] = [];
    for (const price of [5000, 999_999_999, 1_000_000_000]) {
      const { s, id } = await exact(price, { email: `bien${price}@shop.vn` });
      results.push((await pickPayment(t, s.u, id, 'vnpay')).status);
    }
    expect(results).toEqual([200, 200, 422]);
  });

  it('CHK-TC-20261006-110701784: 5 đơn COD confirmed chưa giao và 2 đơn VNPay pending: chọn COD 409 (kind cod, limit 5, current 5), chọn VNPay 200 (giới hạn tính riêng theo loại)', async () => {
    const s = await shopper(t, w);
    for (let i = 0; i < 5; i++) await seedOrder(t, { user: s.u.id, status: 'confirmed', method: 'cod' });
    for (let i = 0; i < 2; i++) await seedOrder(t, { user: s.u.id, status: 'pending', method: 'vnpay' });
    const id = await ready(t, s, w, { pay: null, method: null });
    const a = await pickPayment(t, s.u, id, 'cod');
    expect([a.status, a.body.type, a.body.kind, a.body.limit, a.body.current]).toEqual([409, 'urn:ecom:error:too-many-open-orders', 'cod', 5, 5]);
    expect((await pickPayment(t, s.u, id, 'vnpay')).status).toBe(200);
  });
});
