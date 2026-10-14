import { randomUUID } from 'node:crypto';
import {
  activeCart, addItem, buyer, cartCount, cartsOf, createCrtApp, getCart, itemCount, itemsOf, noTrace, product, q, resetCrt, seedCart, setQty, sku, stock, who, call, type CrtApp,
} from '../support/crt';

// REQ ...103226376 (thêm sản phẩm vào giỏ): PRD, INV, PRM, SHP chạy thật trên PostgreSQL thật; đếm lời gọi bằng jest.spyOn trên các lớp `*Api`.
const REQ = 'CRT-REQ-20261006-103226376';
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => jest.restoreAllMocks());

describe(`CRT thêm sản phẩm vào giỏ (${REQ})`, () => {
  it('CRT-TC-20261006-104451036: thêm sản phẩm đầu tiên tạo giỏ mới, đúng một giỏ active version 1, INV không giữ hàng', async () => {
    const u = await buyer(t);
    const p1 = await product(t, { price: 150000 });
    await stock(t, p1, 10);
    const getForCart = jest.spyOn(t.catalog, 'getForCart'), reserve = jest.spyOn(t.inv, 'reserve'), evaluate = jest.spyOn(t.prm, 'evaluate'), quote = jest.spyOn(t.shp, 'quote');
    const before = Date.now();
    const r = await addItem(t, u, p1, 2);
    expect(r.status).toBe(201);
    expect(r.body.item).toMatchObject({ product_id: p1, quantity: 2, unit_price: 150000, line_total: 300000 });
    expect(r.body.summary).toEqual({ line_count: 1, item_count: 2 });
    const carts = await cartsOf(t, u.id);
    expect(carts).toHaveLength(1);
    expect(carts[0]).toMatchObject({ status: 'active', version: 1, coupon_code: null });
    expect(Math.abs(carts[0].last_activity_at.getTime() - before)).toBeLessThan(2000);
    expect((await itemsOf(t, carts[0].id)).map((i) => [i.product_id, i.quantity, i.unit_price])).toEqual([[p1, 2, '150000']]);
    expect(getForCart).toHaveBeenCalledTimes(1);
    expect(reserve).not.toHaveBeenCalled(); // giỏ không giữ hàng
    expect([evaluate.mock.calls.length, quote.mock.calls.length]).toEqual([0, 0]);
    expect(await q(t, 'SELECT * FROM stock_reservations')).toEqual([]);
    expect((await q<{ reserved: number }>(t, `SELECT reserved FROM stock_items WHERE product_id = '${p1}'`))[0].reserved).toBe(0);
  });

  it('CRT-TC-20261006-104451082: thêm sản phẩm đã có thì gộp số lượng vào một dòng (200, không 201)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    expect((await addItem(t, u, p1, 2)).status).toBe(201);
    const r = await addItem(t, u, p1, 3);
    expect(r.status).toBe(200);
    expect(r.body.item.quantity).toBe(5);
    expect(r.body.summary).toEqual({ line_count: 1, item_count: 5 });
    const items = await itemsOf(t, (await activeCart(t, u.id))!.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });

  it('CRT-TC-20261006-104451131: sản phẩm draft, archived, không có và id sai định dạng cùng một 404, không dò được sản phẩm chưa công bố', async () => {
    const u = await buyer(t);
    const archived = await product(t, { status: 'archived' }), draft = await product(t, { status: 'draft' });
    await stock(t, archived, 10); await stock(t, draft, 10);
    const bodies: Record<string, unknown>[] = [];
    for (const id of [archived, draft, randomUUID(), 'abc', randomUUID().toUpperCase().replace(/.$/, 'Z'), '../../x']) {
      const r = await addItem(t, u, id, 1);
      expect([id, r.status]).toEqual([id, 404]);
      expect(r.body.type).toBe('urn:ecom:error:product-unavailable');
      expect(typeof r.body.trace_id).toBe('string');
      bodies.push(noTrace(r.body));
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect(await cartCount(t)).toBe(0); // không tạo giỏ khi lỗi
  });

  it('CRT-TC-20261006-104451178: số lượng sai và trường tiền lạ bị 400, PRD và INV không bị gọi, không có giỏ', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    const getForCart = jest.spyOn(t.catalog, 'getForCart'), availability = jest.spyOn(t.inv, 'getAvailability');
    const bad: [string, unknown, Record<string, unknown>?][] = [
      ['quantity', 0], ['quantity', -1], ['quantity', 1.5], ['quantity', '2'], ['quantity', 100], ['quantity', null], ['quantity', undefined], ['quantity', Infinity], ['quantity', true],
      ['unit_price', 1, { unit_price: 1 }], ['total', 1, { total: 1 }], ['price', 1, { price: 1 }], ['name', 1, { name: 'x' }], ['__proto__', 1, JSON.parse('{"__proto__": {"x": 1}}')],
    ];
    for (const [field, qty, extra] of bad) {
      const r = field === 'quantity' && qty === undefined ? await call(t, 'post', '/cart/items', { cookie: u.cookie, body: { product_id: p1 } }) : await addItem(t, u, p1, field === 'quantity' ? qty : 1, extra);
      expect([field, qty, r.status]).toEqual([field, qty, 400]);
      expect(r.body.type).toBe('urn:ecom:error:validation-failed');
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    }
    expect((await call(t, 'post', '/cart/items', { cookie: u.cookie, body: '{"product_id":"x","quantity":1}\u0000' })).status).toBe(400);
    expect((await call(t, 'post', '/cart/items', { cookie: u.cookie, body: '{"product_id":"\\ud800","quantity":1}' })).status).toBe(400); // nửa cặp thay thế lẻ
    expect((await call(t, 'post', '/cart/items', { cookie: u.cookie, body: `{"product_id":"${p1}","quantity":1e400}` })).status).toBe(400); // số vượt miền double (Infinity khi đọc JSON)
    expect((await call(t, 'post', '/cart/items', { cookie: u.cookie, body: { product_id: 'x'.repeat(101), quantity: 1 } })).status).toBe(400);
    expect((await call(t, 'post', '/cart/items', { cookie: u.cookie, body: { product_id: '', quantity: 1 } })).status).toBe(400);
    expect(await cartCount(t)).toBe(0);
    expect([getForCart.mock.calls.length, availability.mock.calls.length]).toEqual([0, 0]);
  });

  it('CRT-TC-20261006-104451226: thêm quá số còn bán bị 409 insufficient-stock kèm available và in_cart, giỏ không đổi', async () => {
    const u = await buyer(t);
    const p3 = await sku(t, 100000, 3);
    const r = await addItem(t, u, p3, 5);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', status: 409, available: 3, in_cart: 0 });
    expect(await cartCount(t)).toBe(0);
    expect(await q(t, 'SELECT * FROM stock_reservations')).toEqual([]);
    // đã có 2 trong giỏ, còn 3: thêm 2 nữa thành 4 > 3 thì bị từ chối (tồn kiểm trên TỔNG sau khi thêm), kèm in_cart
    await seedCart(t, u.id, { lines: [{ product: p3, quantity: 2 }] });
    const more = await addItem(t, u, p3, 2);
    expect(more.status).toBe(409);
    expect(more.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', available: 3, in_cart: 2 });
    expect((await addItem(t, u, p3, 1)).body.item.quantity).toBe(3); // đúng bằng tồn thì được
  });

  it('CRT-TC-20261006-104451291: guest 401, staff và admin 403, phiên hết hạn 401; quyền kiểm trước khi tìm sản phẩm, không tạo giỏ', async () => {
    const p1 = await sku(t);
    const staff = await who(t, 'staff', 's@shop.vn'), admin = await who(t, 'admin', 'a@shop.vn');
    const getForCart = jest.spyOn(t.catalog, 'getForCart'), availability = jest.spyOn(t.inv, 'getAvailability');
    expect((await addItem(t, undefined, p1, 1)).status).toBe(401);
    expect((await addItem(t, staff, p1, 1)).status).toBe(403);
    expect((await addItem(t, admin, p1, 1)).status).toBe(403);
    const c = await buyer(t);
    t.clock.advance(31 * 60_000); // quá 30 phút không thao tác
    const expired = await addItem(t, c, p1, 1);
    expect(expired.status).toBe(401);
    expect(await cartCount(t)).toBe(0);
    expect([getForCart.mock.calls.length, availability.mock.calls.length]).toEqual([0, 0]);
  });

  it('CRT-TC-20261006-104451335: gộp tới đúng 99 rồi vượt 99 bị 409 quantity-limit-exceeded, quantity vẫn 99', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 500);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 98 }] });
    const a = await addItem(t, u, p1, 1);
    expect([a.status, a.body.item.quantity]).toEqual([200, 99]);
    const b = await addItem(t, u, p1, 1);
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ type: 'urn:ecom:error:quantity-limit-exceeded', max: 99, in_cart: 99 });
    expect((await itemsOf(t, cart))[0].quantity).toBe(99);
  });

  it('CRT-TC-20261006-104451335: hai yêu cầu gộp cùng lúc vượt 99 (50 + 30 + 30): đúng một bên 200, bên kia 409 quantity-limit-exceeded, không 500, quantity cuối 80 (lặp 20 lần)', async () => {
    const p1 = await sku(t, 100000, 1000);
    for (let i = 0; i < 20; i++) {
      const u = await buyer(t);
      const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 50 }] });
      const rs = await Promise.all([addItem(t, u, p1, 30), addItem(t, u, p1, 30)]); // cả hai qua kiểm trước (50 + 30 <= 99); chỉ câu INSERT có điều kiện chặn bên thứ hai (BR10)
      expect([i, rs.map((r) => r.status).sort()]).toEqual([i, [200, 409]]);
      expect(rs.find((r) => r.status === 409)!.body.type).toBe('urn:ecom:error:quantity-limit-exceeded');
      expect([i, (await itemsOf(t, cart))[0].quantity]).toEqual([i, 80]);
    }
  }, 120_000);

  it('CRT-TC-20261006-104451389: 50 dòng: dòng thứ 50 được, thứ 51 bị cart-line-limit-reached, gộp vào dòng sẵn có vẫn được', async () => {
    const u = await buyer(t);
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push(await sku(t));
    const { cart } = await seedCart(t, u.id, { lines: ids.slice(0, 49).map((p) => ({ product: p })) });
    const r50 = await addItem(t, u, ids[49], 1);
    expect([r50.status, r50.body.summary.line_count]).toEqual([201, 50]);
    const r51 = await addItem(t, u, ids[50], 1);
    expect(r51.status).toBe(409);
    expect(r51.body).toMatchObject({ type: 'urn:ecom:error:cart-line-limit-reached', max: 50 });
    const merge = await addItem(t, u, ids[0], 1);
    expect([merge.status, merge.body.item.quantity]).toEqual([200, 2]);
    expect(await itemCount(t, `cart_id = '${cart}'`)).toBe(50);
  });

  it('CRT-TC-20261006-104451453: hai yêu cầu thêm đầu tiên cùng lúc chỉ ra một giỏ active, cả hai 201, không 500 (lặp 50 lần)', async () => {
    const p1 = await sku(t, 100000, 1000), p2 = await sku(t, 100000, 1000);
    for (let i = 0; i < 50; i++) {
      const u = await buyer(t);
      const [a, b] = await Promise.all([addItem(t, u, p1, 1), addItem(t, u, p2, 1)]);
      expect([i, a.status, b.status]).toEqual([i, 201, 201]);
      const carts = await cartsOf(t, u.id);
      expect([i, carts.filter((c) => c.status === 'active').length]).toEqual([i, 1]);
      expect((await itemsOf(t, carts[0].id)).map((x) => x.product_id).sort()).toEqual([p1, p2].sort());
    }
  }, 120_000);

  it('CRT-TC-20261006-104451601: gộp vào dòng cũ làm mới giá lúc thêm theo giá hiện hành', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1, price: 140000 }] });
    const r = await addItem(t, u, p1, 1);
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ quantity: 2, unit_price: 150000, line_total: 300000 });
    expect((await itemsOf(t, cart))[0]).toMatchObject({ quantity: 2, unit_price: '150000' });
  });

  it('CRT-TC-20261006-113000550: quá 120 lần ghi giỏ mỗi phút bị 429 rate-limited, PRD và INV không bị gọi lần 121, người khác vẫn 200', async () => {
    const a = await buyer(t), b = await buyer(t);
    const p1 = await sku(t, 100000, 500);
    const { items } = await seedCart(t, a.id, { lines: [{ product: p1 }] });
    const bItems = (await seedCart(t, b.id, { lines: [{ product: p1 }] })).items;
    // `alignWindow`: đưa đồng hồ tới đầu cửa sổ 60 giây kế tiếp để 120 lần nằm trọn một cửa sổ cố định
    t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / 60_000) * 60_000 + 1000));
    for (let i = 0; i < 120; i++) { const r = await setQty(t, a, items[0], i % 2 ? 3 : 2); expect([i, r.status]).toEqual([i, 200]); }
    const getForCart = jest.spyOn(t.catalog, 'getForCart'), availability = jest.spyOn(t.inv, 'getAvailability');
    const r = await setQty(t, a, items[0], 4);
    expect(r.status).toBe(429);
    expect(r.body.type).toBe('urn:ecom:error:rate-limited');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await itemsOf(t, (await activeCart(t, a.id))!.id))[0].quantity).toBe(3); // giá trị sau lần 120 (i = 119 là số lẻ nên 3)
    expect([getForCart.mock.calls.length, availability.mock.calls.length]).toEqual([0, 0]);
    expect((await setQty(t, b, bItems[0], 2)).status).toBe(200); // đếm theo người, không theo địa chỉ IP chung
    t.clock.advance(61_000);
    expect((await setQty(t, a, items[0], 2)).status).toBe(200); // sau 60 giây gọi lại được
  }, 120_000);

  it('CRT-TC-20261006-113000550: mọi thao tác ghi giỏ chung MỘT bộ đếm 120 lần mỗi phút: gửi luân phiên đổi số lượng, gỡ mã, cập nhật giá (40 lần mỗi loại) thì lần 121 của loại nào cũng bị 429', async () => {
    const a = await buyer(t);
    const p1 = await sku(t, 100000, 500);
    const { items } = await seedCart(t, a.id, { lines: [{ product: p1 }] });
    t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / 60_000) * 60_000 + 1000)); // alignWindow: 120 lần nằm trọn một cửa sổ cố định
    for (let i = 0; i < 40; i++) {
      const rs = [await setQty(t, a, items[0], 1 + (i % 2)), await call(t, 'delete', '/cart/coupon', { cookie: a.cookie }), await call(t, 'post', '/cart/refresh-prices', { cookie: a.cookie, body: {} })];
      expect([i, rs.map((r) => r.status)]).toEqual([i, [200, 204, 200]]);
    }
    const over = await call(t, 'delete', '/cart/coupon', { cookie: a.cookie });
    expect([over.status, over.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect((await setQty(t, a, items[0], 3)).status).toBe(429);
  }, 120_000);

  it('CRT-TC-20261006-113000550: xem giỏ có hạn riêng 120 lần mỗi phút mỗi người (bậc C): lần 121 bị 429 rate-limited; huy hiệu có bộ đếm riêng; người khác vẫn 200', async () => {
    const a = await buyer(t), b = await buyer(t);
    t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / 60_000) * 60_000 + 1000));
    for (let i = 0; i < 120; i++) { const r = await getCart(t, a); expect([i, r.status]).toEqual([i, 200]); }
    const r = await getCart(t, a);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await call(t, 'get', '/cart/summary', { cookie: a.cookie })).status).toBe(200);
    expect((await getCart(t, b)).status).toBe(200);
    t.clock.advance(61_000);
    expect((await getCart(t, a)).status).toBe(200);
  }, 60_000);

  it('thêm khi INV hay PRD không trả lời: 503 service-unavailable, giỏ không đổi (CRT-TC-20261006-104454713, CRT-TC-20261006-104452875)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t);
    jest.spyOn(t.inv, 'getAvailability').mockRejectedValueOnce(new Error('inv down'));
    const a = await addItem(t, u, p1, 1);
    expect([a.status, a.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
    jest.spyOn(t.catalog, 'getForCart').mockRejectedValueOnce(new Error('prd down'));
    expect((await addItem(t, u, p1, 1)).status).toBe(503);
    expect(await cartCount(t)).toBe(0);
    expect((await getCart(t, u)).status).toBe(200);
  });
});
