import { availabilityOf } from '../../src/modules/cart/pricing';
import { WriteService } from '../../src/modules/cart/write.service';
import {
  activeCart, addItem, buyer, call, cartCount, cartsOf, clearCart, createCrtApp, delItem, getCart, itemCount, itemsOf, putCoupon, putShipping, resetCrt, seedCart, seedCoupon, seedMethod, setQty, sku, who,
  type CrtApp,
} from '../support/crt';

// Bẫy bổ sung rút từ bài học các epic trước (JSON nửa cặp thay thế lẻ và NUL, `__proto__`, trần tài nguyên cap+1 và gấp triệu lần kèm thời gian, tải hỗn hợp kiểm bảo toàn, hold-and-wait, log không rò dữ liệu, giao dịch quay lui).
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => jest.restoreAllMocks());

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => { const s = Date.now(); const r = await fn(); return [r, Date.now() - s]; };

describe('CRT bẫy chuỗi biên và khóa lạ (CRT-SEC-20261006-103824617 T2, T3)', () => {
  it('CRT-TC-20261006-104451178 CRT-TC-20261006-104451879 CRT-TC-20261006-104453359 CRT-TC-20261006-104453717: khóa __proto__ ở mọi thân JSON, NUL và nửa cặp thay thế lẻ ở mọi chuỗi đều 400, không 500', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    const m = await seedMethod(t);
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const bodies: [string, string, string][] = [
      ['post', '/cart/items', `{"product_id":"${p1}","quantity":1,"__proto__":{"unit_price":1}}`], ['patch', `/cart/items/${items[0]}`, '{"quantity":2,"__proto__":{"x":1}}'],
      ['put', '/cart/coupon', '{"code":"SALE10","__proto__":{"discount":1}}'], ['put', '/cart/shipping', `{"method_id":"${m}","city":"Hà Nội","__proto__":{"fee":0}}`], ['post', '/cart/refresh-prices', '{"__proto__":{"total":1}}'],
      ['post', '/cart/items', `{"product_id":"${p1}","quantity":1}\u0000`], ['put', '/cart/coupon', '{"code":"SALE\\u000010"}'], ['put', '/cart/shipping', `{"method_id":"${m}","city":"Hà\\u0000"}`],
      ['put', '/cart/coupon', '{"code":"\\ud800"}'], ['put', '/cart/shipping', `{"method_id":"${m}","city":"\\udfff"}`], ['post', '/cart/items', '{"product_id":"\\ud83d","quantity":1}'], ['put', '/cart/coupon', '{"code":"SALE10\\ud800x"}'],
    ];
    for (const [method, path, body] of bodies) {
      const r = await call(t, method as 'post', path, { cookie: u.cookie, body });
      expect([method, path, body.slice(0, 40), r.status]).toEqual([method, path, body.slice(0, 40), 400]);
    }
    // `__proto__` làm id dòng, mã giảm giá, thành phố: chuỗi thường, không tra ra thuộc tính của Object.prototype
    expect((await setQty(t, u, '__proto__', 2)).status).toBe(404);
    expect((await delItem(t, u, 'constructor')).status).toBe(404);
    expect((await putCoupon(t, u, '__proto__')).status).toBe(404);
    const c = await putShipping(t, u, m, '__proto__');
    expect([c.status, c.body.shipping.city, c.body.shipping.fee]).toEqual([200, '__proto__', 30000]);
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(availabilityOf(true, 1, key, {})).toEqual({ status: 'out_of_stock' });
    expect((await itemsOf(t, (await activeCart(t, u.id))!.id))[0].quantity).toBe(1);
  });

  it('CRT-TC-20261006-104451178 CRT-TC-20261006-104451389: trần tài nguyên cap+1 và gấp triệu lần bị từ chối nhanh (số lượng, độ dài chuỗi, số dòng), không 500 và không giữ kết nối', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    const m = await seedMethod(t);
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    for (const qty of [100, 1_000_000, 1e15, Number.MAX_SAFE_INTEGER, 1e300]) {
      const [r, ms] = await timed(() => addItem(t, u, p1, qty));
      expect([qty, r.status, ms < 1000]).toEqual([qty, 400, true]);
    }
    // chuỗi dài gấp nghìn lần trần (50.000 ký tự, còn dưới giới hạn thân của platform) và cap+1: 400 nhanh, không 500
    const huge = 'é'.repeat(50_000);
    const big: [string, () => Promise<{ status: number }>][] = [
      ['city gấp nghìn lần', () => putShipping(t, u, m, huge)], ['code gấp nghìn lần', () => putCoupon(t, u, huge)], ['product_id gấp trăm lần', () => addItem(t, u, huge, 1)],
      ['city cap+1', () => putShipping(t, u, m, 'X'.repeat(51))], ['code cap+1', () => putCoupon(t, u, 'A'.repeat(51))], ['product_id cap+1', () => addItem(t, u, 'x'.repeat(101), 1)],
    ];
    for (const [name, fn] of big) {
      const [r, ms] = await timed(fn);
      expect([name, r.status, ms < 3000]).toEqual([name, 400, true]);
    }
    // thân vượt giới hạn của platform: 413 (hoặc ngắt kết nối sớm), không bao giờ 2xx hay 5xx
    const over = await call(t, 'put', '/cart/coupon', { cookie: u.cookie, body: JSON.stringify({ code: 'A'.repeat(2_000_000) }) }).then((r) => r.status, () => 413);
    expect(over).toBe(413);
    // 51 dòng: dòng thứ 51 bị từ chối, giỏ vẫn đúng 50 dòng
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(await sku(t));
    const u2 = await buyer(t);
    await seedCart(t, u2.id, { lines: ids.map((product) => ({ product })) });
    expect((await addItem(t, u2, await sku(t), 1)).body.type).toBe('urn:ecom:error:cart-line-limit-reached');
    expect(await itemCount(t, `cart_id = '${(await activeCart(t, u2.id))!.id}'`)).toBe(50);
  }, 60_000);
});

describe('CRT tải hỗn hợp kiểm bảo toàn (CRT-SEC-20261006-103824617 T3, T9)', () => {
  it('CRT-TC-20261006-104451335 CRT-TC-20261006-104451453: 40 yêu cầu thêm cùng một sản phẩm (x3) cùng lúc: đúng 33 lần được (99), 7 lần 409 quantity-limit-exceeded, quantity cuối là 99, tổng số lượng bảo toàn', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 1000);
    const rs = await Promise.all(Array.from({ length: 40 }, () => addItem(t, u, p1, 3)));
    const ok = rs.filter((r) => r.status === 200 || r.status === 201), no = rs.filter((r) => r.status === 409);
    expect([ok.length, no.length, rs.filter((r) => r.status >= 500).length]).toEqual([33, 7, 0]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1); // đúng một lần tạo dòng, các lần còn lại gộp
    for (const r of no) expect(r.body).toMatchObject({ type: 'urn:ecom:error:quantity-limit-exceeded', max: 99 });
    const cart = (await activeCart(t, u.id))!;
    expect((await itemsOf(t, cart.id))[0].quantity).toBe(99);
    expect(ok.map((r) => r.body.item.quantity).sort((a, b) => a - b)).toEqual(Array.from({ length: 33 }, (_, i) => (i + 1) * 3)); // mỗi lần thấy số riêng, không mất cập nhật
    expect(await cartCount(t)).toBe(1);
  }, 60_000);

  it('CRT-TC-20261006-104451389: 60 sản phẩm khác nhau thêm cùng lúc cho một người: đúng 50 dòng, 10 lần 409 cart-line-limit-reached, một giỏ duy nhất', async () => {
    const u = await buyer(t);
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push(await sku(t, 100000, 100));
    const rs = await Promise.all(ids.map((p) => addItem(t, u, p, 1)));
    expect([rs.filter((r) => r.status === 201).length, rs.filter((r) => r.status === 409).length, rs.filter((r) => r.status >= 500).length]).toEqual([50, 10, 0]);
    for (const r of rs.filter((x) => x.status === 409)) expect(r.body.type).toBe('urn:ecom:error:cart-line-limit-reached');
    expect(await cartCount(t)).toBe(1);
    expect(await itemCount(t)).toBe(50);
  }, 90_000);

  it('CRT-TC-20261006-104452119 CRT-TC-20261006-104452371 CRT-TC-20261006-104452670: 300 thao tác ngẫu nhiên (thêm, đổi, xóa, làm trống, mã, vận chuyển, xem) của 12 người cùng lúc: không 5xx, mọi giỏ thỏa bất biến (1..99, tối đa 50 dòng, một giỏ active), huy hiệu khớp dòng thật', async () => {
    const prods: string[] = [];
    for (let i = 0; i < 8; i++) prods.push(await sku(t, 50000 + i * 1000, 200));
    const m = await seedMethod(t);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    const users = await Promise.all(Array.from({ length: 12 }, () => buyer(t)));
    let seed = 20261009;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const mk = (): Promise<{ status: number }> => {
      const u = users[rnd(users.length)], p = prods[rnd(prods.length)];
      const k = rnd(10);
      if (k <= 3) return addItem(t, u, p, 1 + rnd(5));
      if (k === 4) return (async () => { const c = await activeCart(t, u.id); const it = c ? (await itemsOf(t, c.id))[0] : undefined; return it ? setQty(t, u, it.id, 1 + rnd(99)) : getCart(t, u); })();
      if (k === 5) return (async () => { const c = await activeCart(t, u.id); const it = c ? (await itemsOf(t, c.id))[0] : undefined; return it ? delItem(t, u, it.id) : getCart(t, u); })();
      if (k === 6) return rnd(5) === 0 ? clearCart(t, u) : getCart(t, u);
      if (k === 7) return putCoupon(t, u, 'SALE10');
      if (k === 8) return putShipping(t, u, m, 'Hà Nội');
      return getCart(t, u);
    };
    const rs: { status: number }[] = [];
    for (let wave = 0; wave < 12; wave++) rs.push(...(await Promise.all(Array.from({ length: 25 }, mk)))); // 12 đợt, mỗi đợt 25 thao tác chạy cùng lúc
    expect(rs.filter((r) => r.status >= 500).map((r) => r.status)).toEqual([]);
    for (const u of users) {
      const carts = await cartsOf(t, u.id);
      expect(carts.filter((c) => c.status === 'active').length).toBeLessThanOrEqual(1);
      const cart = carts.find((c) => c.status === 'active');
      if (!cart) continue;
      const items = await itemsOf(t, cart.id);
      expect(items.length).toBeLessThanOrEqual(50);
      for (const it of items) expect(it.quantity >= 1 && it.quantity <= 99).toBe(true);
      const s = await call(t, 'get', '/cart/summary', { cookie: u.cookie });
      expect(s.body).toEqual({ line_count: items.length, item_count: items.reduce((a, b) => a + b.quantity, 0) });
      if (!items.length) expect([cart.coupon_code, cart.shipping_method_id]).toEqual([null, null]); // giỏ trống không còn mã hay vận chuyển
    }
  }, 120_000);
});

describe('CRT gọi mô-đun khác, kết nối và giao dịch (CRT-API Giao tiếp giữa module)', () => {
  it('CRT-TC-20261006-104453050: xem giỏ có mã và vận chuyển: PRD, INV, PRM, SHP mỗi nơi đúng một lời gọi theo lô (PRM với count_attempt false)', async () => {
    const u = await buyer(t);
    const ps: string[] = [];
    for (let i = 0; i < 20; i++) ps.push(await sku(t, 100000, 100));
    const m = await seedMethod(t);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: ps.map((product) => ({ product })), coupon: 'SALE10', method: m, city: 'Hà Nội' });
    const calls = { prd: jest.spyOn(t.catalog, 'getForCart'), inv: jest.spyOn(t.inv, 'getAvailability'), prm: jest.spyOn(t.prm, 'evaluate'), shp: jest.spyOn(t.shp, 'quote') };
    const r = await getCart(t, u);
    expect(r.body).toMatchObject({ subtotal: 2_000_000, discount: 200_000, total: 1_830_000 });
    expect([calls.prd.mock.calls.length, calls.inv.mock.calls.length, calls.prm.mock.calls.length, calls.shp.mock.calls.length]).toEqual([1, 1, 1, 1]);
    expect(calls.prm.mock.calls[0][0]).toMatchObject({ count_attempt: false, items_subtotal: 2_000_000 });
    expect(t.deps.timeoutMs).toBe(2000); // hạn 2 giây cho mọi lời gọi sang mô-đun khác (CRT-API)
  });

  it('CRT-TC-20261006-104454280: pool kết nối nhỏ nhất (DB_POOL_MAX = 2): lockForCheckout giữ một kết nối của tx trong khi gọi PRD, INV bằng kết nối còn lại, không treo', async () => {
    const t2 = await createCrtApp({ env: { DB_POOL_MAX: '2' } });
    try {
      await resetCrt(t2);
      const u = await buyer(t2);
      const p1 = await sku(t2, 100000, 10);
      await seedCart(t2, u.id, { lines: [{ product: p1, quantity: 2 }] });
      const snap = await Promise.race([
        t2.tx.run((tx) => t2.cart.lockForCheckout(u.id, tx)),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('treo: hold-and-wait')), 8000)),
      ]);
      expect(snap).toMatchObject({ ok: true, items_subtotal: 200000, can_checkout: true });
      expect((await getCart(t2, u)).status).toBe(200);
    } finally { await t2.close(); }
  }, 60_000);

  it('CRT-TC-20261006-104451036 CRT-TC-20261006-104452611: lỗi sau khi ghi dòng thì quay lui cả giỏ vừa tạo (không để lại giỏ trống hay dòng mồ côi)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10);
    jest.spyOn(WriteService.prototype as unknown as { summaryOf: () => Promise<unknown> }, 'summaryOf').mockRejectedValueOnce(new Error('boom'));
    const r = await addItem(t, u, p1, 1);
    expect(r.status).toBe(500);
    expect([await cartCount(t), await itemCount(t)]).toEqual([0, 0]);
    expect((await addItem(t, u, p1, 1)).status).toBe(201);
  });

  it('CRT-TC-20261006-104451601: thêm lại sản phẩm đã bị đánh dấu ngừng bán mà PRD bán lại: dòng được mở lại (unavailable_reason NULL), và sản phẩm đã archived thật thì 404', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, reason: 'product_archived' }] });
    expect((await getCart(t, u)).body.items[0].availability).toEqual({ status: 'unavailable' });
    expect((await addItem(t, u, p1, 1)).status).toBe(200);
    expect((await itemsOf(t, cart))[0]).toMatchObject({ unavailable_reason: null, quantity: 2 });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p1}::uuid`;
    expect((await addItem(t, u, p1, 1)).status).toBe(404);
  });
});

describe('CRT log không rò dữ liệu (CRT-SEC-20261006-103824617 T14, SB-08, SB-18)', () => {
  it('CRT-TC-20261006-104453359: log của áp mã, chọn vận chuyển và lỗi phụ thuộc không chứa mã giảm giá, thành phố, email hay user_id nguyên văn', async () => {
    const u = await who(t, 'customer', 'nguoi.bi.mat@shop.vn');
    const p1 = await sku(t, 300000, 10);
    const m = await seedMethod(t);
    await seedCoupon(t, { code: 'BIMATCODE77', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    t.logs.clear();
    expect((await putCoupon(t, u, 'bimatcode77')).status).toBe(200);
    expect((await putCoupon(t, u, 'SAIMA99999')).status).toBe(404);
    expect((await putShipping(t, u, m, 'ThanhPhoBiMat')).status).toBe(200);
    jest.spyOn(t.catalog, 'getForCart').mockRejectedValueOnce(new Error('prd down: nguoi.bi.mat@shop.vn BIMATCODE77'));
    expect((await getCart(t, u)).status).toBe(503);
    jest.spyOn(t.prm, 'evaluate').mockRejectedValueOnce(new Error('prm down'));
    await getCart(t, u);
    const text = t.logs.lines.join('\n');
    expect(t.logs.lines.length).toBeGreaterThan(0);
    for (const secret of ['BIMATCODE77', 'bimatcode77', 'SAIMA99999', 'ThanhPhoBiMat', 'nguoi.bi.mat']) expect([secret, text.includes(secret)]).toEqual([secret, false]);
    // dòng log của chính module cart: không có user_id nguyên văn (dòng `request` của platform có user_id không kèm dữ liệu khác, xem report, Lệch spec)
    const own = t.logs.records.filter((r) => r.module === 'cart');
    expect(own.length).toBeGreaterThan(0);
    expect(JSON.stringify(own)).not.toContain(u.id);
  });
});
