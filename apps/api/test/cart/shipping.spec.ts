import { randomUUID } from 'node:crypto';
import {
  activeCart, alignWindow, buyer, call, createCrtApp, getCart, putShipping, q, resetCrt, seedCart, seedMethod, sku, type CrtApp,
} from '../support/crt';
import { noTrace } from '../support/crt';

// REQ ...103226537 (chọn vận chuyển, phí): SHP thật (phương thức dựng thẳng), PRD, INV, PRM thật; đếm lời gọi bằng jest.spyOn.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => { jest.restoreAllMocks(); });

describe('CRT chọn phương thức vận chuyển và phí (CRT-REQ-20261006-103226537)', () => {
  it('CRT-TC-20261006-104453603: chọn phương thức: 200 kèm phí, lưu method và city; phí đổi theo ngưỡng miễn phí khi thêm hàng (tính lại ở mỗi lần xem)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50), p2 = await sku(t, 250000, 50);
    const m = await seedMethod(t, { name: 'Giao tiêu chuẩn', fee: 30000, freeOver: 500000 });
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 3 }] });
    const r = await putShipping(t, u, m, 'Hà Nội');
    expect(r.status).toBe(200);
    expect(r.body.shipping).toEqual({ method_id: m, city: 'Hà Nội', fee: 30000, free_shipping: false });
    expect(r.body).toMatchObject({ shipping_fee: 30000, subtotal: 300000, total: 330000, total_is_estimate: false });
    expect((await call(t, 'post', '/cart/items', { cookie: u.cookie, body: { product_id: p2, quantity: 1 } })).status).toBe(201);
    const g = await getCart(t, u);
    expect(g.body.shipping).toEqual({ method_id: m, city: 'Hà Nội', fee: 0, free_shipping: true });
    expect(g.body).toMatchObject({ shipping_fee: 0, subtotal: 550000 });
    expect(await activeCart(t, u.id)).toMatchObject({ shipping_method_id: m, shipping_city: 'Hà Nội' });
  });

  it('CRT-TC-20261006-104453658: phương thức tắt hay không có cùng một 409 method-unavailable, lựa chọn cũ giữ nguyên', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const sm1 = await seedMethod(t), sm2 = await seedMethod(t, { active: false });
    await seedCart(t, u.id, { lines: [{ product: p1 }], method: sm1, city: 'Hà Nội' });
    const a = await putShipping(t, u, sm2, 'Hà Nội'), b = await putShipping(t, u, randomUUID(), 'Hà Nội');
    expect([a.status, b.status]).toEqual([409, 409]);
    expect(a.body.type).toBe('urn:ecom:error:method-unavailable');
    expect(noTrace(a.body)).toEqual(noTrace(b.body));
    expect(await activeCart(t, u.id)).toMatchObject({ shipping_method_id: sm1, shipping_city: 'Hà Nội' });
  });

  it('CRT-TC-20261006-104453717: giỏ trống thì 409 cart-empty; city rỗng, method_id "abc", trường fee lạ, NUL đều 400; SHP không bị gọi, giỏ không đổi', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const sm1 = await seedMethod(t);
    const quote = jest.spyOn(t.shp, 'quote');
    const e = await putShipping(t, u, sm1, 'Hà Nội');
    expect([e.status, e.body.type]).toEqual([409, 'urn:ecom:error:cart-empty']);
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    for (const [m, city, extra] of [[sm1, ''], [sm1, '   '], ['abc', 'Hà Nội'], [sm1, 'Hà Nội', { fee: 0 }], [sm1, 'Hà\u0000 Nội'], [sm1, 'X'.repeat(51)], [sm1, 12], [12, 'Hà Nội']] as [unknown, unknown, Record<string, unknown>?][]) {
      const r = await putShipping(t, u, m, city, extra);
      expect([String(m), String(city), r.status, r.body.type]).toEqual([String(m), String(city), 400, 'urn:ecom:error:validation-failed']);
    }
    expect(quote).not.toHaveBeenCalled();
    expect(await activeCart(t, u.id)).toMatchObject({ shipping_method_id: null, shipping_city: null });
    expect((await putShipping(t, u, sm1, 'X'.repeat(50))).status).toBe(200); // đúng 50 ký tự qua schema
  });

  it('CRT-TC-20261006-104453780: ngưỡng miễn phí so sánh lớn hơn hoặc bằng (499999: 30000 và không miễn phí; 500000: 0 và miễn phí)', async () => {
    const sm1 = await seedMethod(t, { fee: 30000, freeOver: 500000 });
    for (const [price, fee, free] of [[499999, 30000, false], [500000, 0, true]] as const) {
      const u = await buyer(t);
      const p = await sku(t, price, 10);
      await seedCart(t, u.id, { lines: [{ product: p }], method: sm1, city: 'Hà Nội' });
      expect([price, (await getCart(t, u)).body.shipping]).toEqual([price, { method_id: sm1, city: 'Hà Nội', fee, free_shipping: free }]);
    }
  });

  it('CRT-TC-20261006-104453829: thành phố không phân biệt hoa thường và dấu (ha giang khớp Hà Giang: 30000 + 20000); city lưu đúng như khách gõ đã cắt khoảng trắng', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const sm1 = await seedMethod(t, { fee: 30000, surcharge: 20000, cities: ['Hà Giang'] });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const r = await putShipping(t, u, sm1, '  ha giang  ');
    expect(r.status).toBe(200);
    expect(r.body.shipping).toMatchObject({ fee: 50000, city: 'ha giang' });
    expect((await activeCart(t, u.id))!.shipping_city).toBe('ha giang');
  });

  it('CRT-TC-20261006-104453875: phương thức bị tắt sau khi chọn: xem giỏ báo method_unavailable (fee null, tổng ước tính), chọn lại phương thức khác thì có phí; không tự đổi phương thức', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const sm1 = await seedMethod(t, { fee: 30000 }), sm3 = await seedMethod(t, { fee: 45000 });
    await seedCart(t, u.id, { lines: [{ product: p1 }], method: sm1, city: 'Hà Nội' });
    await t.prisma.$executeRaw`UPDATE shipping_methods SET is_active = false WHERE id = ${sm1}::uuid`;
    const g = await getCart(t, u);
    expect(g.body.shipping).toEqual({ method_id: sm1, city: 'Hà Nội', fee: null, error: 'method_unavailable' });
    expect(g.body).toMatchObject({ shipping_fee: null, total_is_estimate: true, total: 300000 });
    expect((await activeCart(t, u.id))!.shipping_method_id).toBe(sm1);
    const r = await putShipping(t, u, sm3, 'Hà Nội');
    expect([r.status, r.body.shipping.fee]).toEqual([200, 45000]);
    expect((await activeCart(t, u.id))!.shipping_method_id).toBe(sm3);
  });

  it('SHP không trả lời: xem giỏ ghi service_unavailable và các phần còn lại vẫn trả; chọn thì 503 và lựa chọn cũ giữ nguyên', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const sm1 = await seedMethod(t), sm3 = await seedMethod(t);
    await seedCart(t, u.id, { lines: [{ product: p1 }], method: sm1, city: 'Hà Nội' });
    jest.spyOn(t.shp, 'quote').mockRejectedValueOnce(new Error('shp down'));
    const g = await getCart(t, u);
    expect(g.status).toBe(200);
    expect(g.body.shipping).toEqual({ method_id: sm1, city: 'Hà Nội', fee: null, error: 'service_unavailable' });
    expect(g.body.subtotal).toBe(300000);
    jest.spyOn(t.shp, 'quote').mockRejectedValueOnce(new Error('shp down'));
    const r = await putShipping(t, u, sm3, 'Hà Nội');
    expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
    expect((await activeCart(t, u.id))!.shipping_method_id).toBe(sm1);
  });

  it('CRT-TC-20261006-104453603 CRT-REQ-20261006-103226537 BR8: quá 60 lần chọn vận chuyển mỗi phút bị 429 rate-limited (chặt hơn bậc B), SHP không bị gọi lần 61', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const sm1 = await seedMethod(t);
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    alignWindow(t);
    for (let i = 0; i < 60; i++) { const r = await putShipping(t, u, sm1, 'Hà Nội'); expect([i, r.status]).toEqual([i, 200]); }
    const quote = jest.spyOn(t.shp, 'quote');
    const r = await putShipping(t, u, sm1, 'Hà Nội');
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(quote).not.toHaveBeenCalled();
    expect((await q<{ n: number }>(t, 'SELECT count(*)::int AS n FROM carts'))[0].n).toBe(1);
  }, 60_000);
});
