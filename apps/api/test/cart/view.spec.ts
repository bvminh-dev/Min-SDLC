import { WriteService } from '../../src/modules/cart/write.service';
import { randomUUID } from 'node:crypto';
import {
  activeCart, addItem, buyer, call, cartCount, clearCart, createCrtApp, delItem, getCart, itemsOf, product, putCoupon, putShipping, q, resetCrt, seedCart, seedCoupon, seedMethod, setQty, sku, sleep,
  valuesOf, who, type CrtApp,
} from '../support/crt';

// REQ ...103226486 (xem giỏ, tạm tính), ...103226562 (tổng, giao diện cho CHK), ...103226588 (kiểm tồn): PRD, INV, PRM, SHP thật; đếm lời gọi bằng jest.spyOn.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => { jest.restoreAllMocks(); t.deps.timeoutMs = 2000; });

/** Giỏ 50 dòng, mỗi dòng giá 1.000.000.000 x 99 (tạm tính lớn nhất 4.950.000.000.000). */
async function maxCart(): Promise<{ u: Awaited<ReturnType<typeof buyer>>; ids: string[] }> {
  const u = await buyer(t);
  const ids: string[] = [];
  for (let i = 0; i < 50; i++) ids.push(await sku(t, 1_000_000_000, 99));
  await seedCart(t, u.id, { lines: ids.map((product) => ({ product, quantity: 99 })) });
  return { u, ids };
}

describe('CRT xem giỏ và tạm tính theo giá hiện hành (CRT-REQ-20261006-103226486)', () => {
  it('CRT-TC-20261006-104452716: xem giỏ tính tạm tính theo giá hiện hành; chỉ đọc (version, last_activity_at, số dòng không đổi), hai lần xem cho cùng kết quả', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10), p2 = await sku(t, 50000, 10);
    const t0 = new Date(Date.now() - 3600_000);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }, { product: p2, quantity: 1 }], version: 5, lastActivityAt: t0 });
    const before = (await q(t, `SELECT * FROM carts WHERE id = '${cart}'`))[0];
    const r = await getCart(t, u);
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { line_total: number }) => i.line_total)).toEqual([300000, 50000]);
    expect(r.body).toMatchObject({ cart_id: cart, subtotal: 350000, line_count: 2, item_count: 3, price_changed: false });
    for (const i of r.body.items) expect(i).not.toHaveProperty('previous_unit_price');
    expect((await q(t, `SELECT * FROM carts WHERE id = '${cart}'`))[0]).toEqual(before);
    expect((await getCart(t, u)).body).toEqual(r.body);
    for (const k of ['user_id', 'version', 'unavailable_reason', 'converted_order_id']) expect(JSON.stringify(r.body)).not.toContain(`"${k}"`);
  });

  it('CRT-TC-20261006-104452775: giá đổi hiện giá cũ và cập nhật giá xác nhận giá mới (số lượng và tạm tính không đổi, giá lưu đổi)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2, price: 140000 }] });
    const g = await getCart(t, u);
    expect(g.body.items[0]).toMatchObject({ unit_price: 150000, previous_unit_price: 140000, price_changed: true, line_total: 300000 });
    expect(g.body).toMatchObject({ subtotal: 300000, price_changed: true });
    const r = await call(t, 'post', '/cart/refresh-prices', { cookie: u.cookie, body: {} });
    expect(r.status).toBe(200);
    expect(r.body.items[0]).not.toHaveProperty('previous_unit_price');
    expect(r.body.items[0]).toMatchObject({ price_changed: false, quantity: 2 });
    expect(r.body).toMatchObject({ subtotal: 300000, price_changed: false });
    expect((await itemsOf(t, cart))[0]).toMatchObject({ unit_price: '150000', quantity: 2 });
    expect((await call(t, 'post', '/cart/refresh-prices', { cookie: u.cookie })).status).toBe(200); // không có dòng đổi giá: 200 không đổi gì (thân vắng cũng được)
    expect((await call(t, 'post', '/cart/refresh-prices', { cookie: u.cookie, body: { total: 1 } })).status).toBe(400);
  });

  it('CRT-TC-20261006-104452823: xem giỏ và huy hiệu: khách 401, staff và admin 403, không có dữ liệu giỏ trong body', async () => {
    const staff = await who(t, 'staff', 's@shop.vn'), admin = await who(t, 'admin', 'a@shop.vn');
    const c = await buyer(t);
    await seedCart(t, c.id, { lines: [{ product: await sku(t) }] });
    for (const path of ['/cart', '/cart/summary']) {
      expect((await call(t, 'get', path)).status).toBe(401);
      for (const s of [staff, admin]) {
        const r = await call(t, 'get', path, { cookie: s.cookie });
        expect([path, r.status]).toEqual([path, 403]);
        expect(r.body).not.toHaveProperty('items');
        expect(r.body).not.toHaveProperty('line_count');
      }
    }
    // tài khoản customer chưa xác minh email vẫn dùng giỏ (SB-26 chặn đặt hàng ở CHK, không ở CRT)
    const unverified = await who(t, 'customer', 'chua@shop.vn');
    await t.prisma.$executeRaw`UPDATE users SET email_verified_at = NULL WHERE id = ${unverified.id}::uuid`;
    expect((await getCart(t, unverified)).status).toBe(200);
  });

  it('CRT-TC-20261006-104452875: PRD không trả lời (ném lỗi hay quá hạn) thì cả giỏ 503 có trace_id, không số tiền nào', async () => {
    const u = await buyer(t);
    await seedCart(t, u.id, { lines: [{ product: await sku(t), quantity: 2 }] });
    jest.spyOn(t.catalog, 'getForCart').mockRejectedValueOnce(new Error('prd timeout'));
    const r = await getCart(t, u);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:service-unavailable', status: 503 });
    expect(typeof r.body.trace_id).toBe('string');
    for (const k of ['subtotal', 'items', 'total', 'discount']) expect(r.body).not.toHaveProperty(k);
    t.deps.timeoutMs = 150; // quá hạn thật: lời gọi treo, CRT hủy chờ sau hạn và không đoán giá
    jest.spyOn(t.catalog, 'getForCart').mockImplementationOnce(() => new Promise(() => undefined));
    const t0 = Date.now();
    expect((await getCart(t, u)).status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('CRT-TC-20261006-104452935: chưa có giỏ: giỏ trống và huy hiệu bằng 0, không tạo bản ghi giỏ', async () => {
    const u = await buyer(t);
    const g = await getCart(t, u);
    expect(g.status).toBe(200);
    expect(g.body).toEqual({ cart_id: null, items: [], line_count: 0, item_count: 0, price_changed: false, subtotal: 0, coupon: null, shipping: null, discount: 0, shipping_fee: null, total: 0, total_is_estimate: false, checkout_blockers: [], can_checkout: false });
    const s = await call(t, 'get', '/cart/summary', { cookie: u.cookie });
    expect([s.status, s.body]).toEqual([200, { line_count: 0, item_count: 0 }]);
    expect(await cartCount(t)).toBe(0);
  });

  it('CRT-TC-20261006-104452994: dòng ngừng bán hiện nhưng không tính vào tạm tính; item_count tính cả dòng đó', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10), p2 = await sku(t, 80000, 10);
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p2}::uuid`;
    await seedCart(t, u.id, { lines: [{ product: p1 }, { product: p2, quantity: 3 }] });
    const r = await getCart(t, u);
    expect(r.body.items[1].availability).toEqual({ status: 'unavailable' });
    expect(r.body).toMatchObject({ subtotal: 150000, item_count: 4, line_count: 2, checkout_blockers: ['unavailable_item'], can_checkout: false });
  });

  it('CRT-TC-20261006-104453050: giỏ 50 dòng giá lớn nhất: số không tràn, PRD đúng một lời gọi với 50 id, INV đúng một lời gọi, PRM và SHP không bị gọi', async () => {
    const { u, ids } = await maxCart();
    const getForCart = jest.spyOn(t.catalog, 'getForCart'), availability = jest.spyOn(t.inv, 'getAvailability'), evaluate = jest.spyOn(t.prm, 'evaluate'), quote = jest.spyOn(t.shp, 'quote');
    const r = await getCart(t, u);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ subtotal: 4_950_000_000_000, item_count: 4950, line_count: 50 });
    expect(getForCart).toHaveBeenCalledTimes(1);
    expect([...(getForCart.mock.calls[0][0] as string[])].sort()).toEqual([...ids].sort());
    expect(availability).toHaveBeenCalledTimes(1);
    expect([evaluate.mock.calls.length, quote.mock.calls.length]).toEqual([0, 0]);
  });

  it('CRT-TC-20261006-104453118: tên sản phẩm chứa HTML trả nguyên văn dạng chuỗi JSON thô (phần hiển thị kiểm ở E2E CRT-TC-20261006-104453118 trong crt.e2e.spec.ts)', async () => {
    const u = await buyer(t);
    const name = '<img src=x onerror=alert(1)>';
    const p1 = await sku(t, 100000, 10, { name });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const r = await getCart(t, u);
    expect(r.body.items[0].name).toBe(name);
    expect(JSON.stringify(r.body)).toContain('<img src=x onerror=alert(1)>'); // không mã hóa HTML ở API
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('CRT tổng tiền và giao diện cho CHK (CRT-REQ-20261006-103226562)', () => {
  it('CRT-TC-20261006-104453932: tổng = tạm tính trừ giảm giá cộng phí (350000 − 35000 + 30000 = 345000)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10), p2 = await sku(t, 50000, 10);
    const m = await seedMethod(t, { fee: 30000, freeOver: 500000 });
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }, { product: p2 }], coupon: 'SALE10', method: m, city: 'Hà Nội' });
    const r = await getCart(t, u);
    expect(r.body).toMatchObject({ subtotal: 350000, discount: 35000, shipping_fee: 30000, total: 345000, total_is_estimate: false });
    expect(r.body.coupon).toEqual({ code: 'SALE10', applied: true, discount: 35000 });
    expect(r.body.shipping).toEqual({ method_id: m, city: 'Hà Nội', fee: 30000, free_shipping: false });
  });

  it('CRT-TC-20261006-104453980: CHK đọc giỏ đã định giá qua snapshotForCheckout; không có total, discount, shipping_fee; cart_version bằng version trong CSDL', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10), p2 = await sku(t, 50000, 10);
    const m = await seedMethod(t, { fee: 30000 });
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2, price: 140000 }, { product: p2 }], coupon: 'SALE10', method: m, city: 'Hà Nội', version: 6 });
    const s = await t.cart.snapshotForCheckout(u.id);
    expect(s).toMatchObject({ ok: true, cart_id: cart, cart_version: 6, items_subtotal: 350000, coupon_code: 'SALE10', shipping_method_id: m, shipping_city: 'Hà Nội', can_checkout: true, issues: [] });
    if (!s.ok) throw new Error('unreachable');
    expect(s.lines.map((l) => [l.product_id, l.quantity, l.unit_price, l.line_total])).toEqual([[p1, 2, 150000, 300000], [p2, 1, 50000, 50000]]); // giá HIỆN HÀNH, không phải giá lưu
    for (const k of ['total', 'discount', 'shipping_fee']) expect(s).not.toHaveProperty(k);
    expect((await q<{ version: number }>(t, `SELECT version FROM carts WHERE id = '${cart}'`))[0].version).toBe(s.cart_version);
  });

  it('CRT-TC-20261006-104454027: giỏ trống hay chưa có: cả snapshotForCheckout và lockForCheckout trả cart_empty và KHÔNG khóa dòng giỏ nào', async () => {
    const none = await buyer(t), empty = await buyer(t), full = await buyer(t);
    await seedCart(t, empty.id);
    await seedCart(t, full.id, { lines: [{ product: await sku(t) }] });
    for (const u of [none, empty]) {
      expect(await t.cart.snapshotForCheckout(u.id)).toEqual({ ok: false, reason: 'cart_empty' });
      await t.tx.run(async (tx) => {
        expect(await t.cart.lockForCheckout(u.id, tx)).toEqual({ ok: false, reason: 'cart_empty' });
        // từ kết nối khác: nếu dòng giỏ bị khóa thì NOWAIT ném 55P03; không khóa thì qua
        await expect(t.prisma.$queryRaw`SELECT id FROM carts WHERE user_id = ${u.id}::uuid FOR UPDATE NOWAIT`).resolves.toBeDefined();
      });
    }
    await t.tx.run(async (tx) => {
      expect((await t.cart.lockForCheckout(full.id, tx)).ok).toBe(true);
      await expect(t.prisma.$queryRaw`SELECT id FROM carts WHERE user_id = ${full.id}::uuid FOR UPDATE NOWAIT`).rejects.toThrow(/lock|55P03/i); // giỏ có hàng thì bị khóa tới commit
    });
  });

  it('CRT-TC-20261006-104454073: trường tiền trong body của bất kỳ endpoint giỏ nào bị 400, giỏ không đổi, tổng vẫn do máy chủ tính', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const m = await seedMethod(t, { fee: 30000 });
    const { items, cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1 }], method: m, city: 'Hà Nội' });
    const cases: [string, string, Record<string, unknown>, string][] = [
      ['post', '/cart/items', { product_id: p1, quantity: 1, total: 1 }, 'total'], ['patch', `/cart/items/${items[0]}`, { quantity: 2, subtotal: 1 }, 'subtotal'],
      ['put', '/cart/coupon', { code: 'SALE10', discount: 99999 }, 'discount'], ['put', '/cart/shipping', { method_id: m, city: 'Hà Nội', shipping_fee: 0 }, 'shipping_fee'],
      ['put', '/cart/shipping', { method_id: m, city: 'Hà Nội', fee: 0, free_shipping: true }, 'fee'], ['post', '/cart/refresh-prices', { total: 1 }, 'total'],
    ];
    const before = (await q(t, `SELECT * FROM carts WHERE id = '${cart}'`))[0];
    for (const [method, path, body, field] of cases) {
      const r = await call(t, method as 'post', path, { cookie: u.cookie, body });
      expect([path, r.status]).toEqual([path, 400]);
      expect(r.body.type).toBe('urn:ecom:error:validation-failed');
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    }
    expect((await q(t, `SELECT * FROM carts WHERE id = '${cart}'`))[0]).toEqual(before);
    expect((await getCart(t, u)).body).toMatchObject({ subtotal: 150000, total: 180000 });
  });

  it('CRT-TC-20261006-104454120: giỏ có dòng ngừng bán: CHK nhận can_checkout false và issues; items_subtotal chỉ tính dòng còn bán', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10), p2 = await sku(t, 80000, 10);
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p2}::uuid`;
    await seedCart(t, u.id, { lines: [{ product: p1 }, { product: p2, quantity: 2 }] });
    const s = await t.cart.snapshotForCheckout(u.id);
    expect(s).toMatchObject({ ok: true, can_checkout: false, items_subtotal: 150000, issues: [{ product_id: p2, reason: 'unavailable' }] });
    if (s.ok) expect(s.lines.map((l) => l.product_id)).toEqual([p1]);
    const v = await getCart(t, u);
    expect(v.body.can_checkout).toBe(false);
  });

  it('CRT-TC-20261006-104454175: tổng bằng 0 là hợp lệ (mã cố định bằng tạm tính, miễn phí vận chuyển, 200 không lỗi)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 50000, 10);
    const m = await seedMethod(t, { fee: 30000, freeOver: 50000 });
    await seedCoupon(t, { code: 'FIX50', type: 'fixed', value: 50000 });
    await seedCart(t, u.id, { lines: [{ product: p1 }], coupon: 'FIX50', method: m, city: 'Hà Nội' });
    const r = await getCart(t, u);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ discount: 50000, shipping_fee: 0, total: 0, total_is_estimate: false });
  });

  it('CRT-TC-20261006-104454175: giảm giá không bao giờ vượt tạm tính (PRM trả số lớn hơn thì cắt ở tạm tính): tổng không âm', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 50000, 10);
    await seedCart(t, u.id, { lines: [{ product: p1 }], coupon: 'SALE10' });
    jest.spyOn(t.prm, 'evaluate').mockResolvedValue({ ok: true, coupon_id: randomUUID(), code: 'SALE10', type: 'fixed', discount_amount: 999_999_999 });
    const r = await getCart(t, u);
    expect(r.body).toMatchObject({ subtotal: 50000, discount: 50000, total: 0 });
    expect(r.body.total).toBeGreaterThanOrEqual(0);
  });

  it('CRT-TC-20261006-104454222: chưa chọn vận chuyển thì tổng ước tính (shipping_fee null, tính với phí 0)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1 }], coupon: 'SALE10' });
    const r = await getCart(t, u);
    expect(r.body).toMatchObject({ shipping_fee: null, total: 270000, total_is_estimate: true, discount: 30000, shipping: null });
  });

  it('CRT-TC-20261006-104454280: lockForCheckout bắt thao tác sửa giỏ phải chờ tới sau commit, version sau lớn hơn version CHK đã đọc', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1 }], version: 12 });
    let patch!: Promise<{ status: number }>;
    let t1 = 0;
    const snap = await t.tx.run(async (tx) => {
      const s = await t.cart.lockForCheckout(u.id, tx);
      t1 = Date.now();
      patch = setQty(t, u, items[0], 2).then((r) => ({ status: r.status, at: Date.now() })) as Promise<{ status: number }>;
      await sleep(2000);
      return s;
    });
    expect(snap.ok && snap.cart_version).toBe(12);
    const r = (await patch) as { status: number; at?: number };
    expect(r.status).toBe(200);
    expect((r.at as number) - t1).toBeGreaterThanOrEqual(1900); // chờ tới sau commit của CHK
    expect((await activeCart(t, u.id))!.version).toBe(13);
  }, 30_000);

  it('CRT-TC-20261006-104454338: tổng lớn nhất không tràn số (subtotal = total = 4950000000000, cột giá là bigint)', async () => {
    const { u } = await maxCart();
    const r = await getCart(t, u);
    expect([r.body.subtotal, r.body.total]).toEqual([4_950_000_000_000, 4_950_000_000_000]);
    for (const [table, col] of [['cart_items', 'unit_price'], ['products', 'price']]) {
      expect((await q<{ data_type: string }>(t, `SELECT data_type FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${col}'`))[0].data_type).toBe('bigint');
    }
  });

  it('CRT-TC-20261006-113000660: tổng 0 đồng vẫn hợp lệ ở giỏ và CHK nhận số 0 (ngưỡng miễn phí tính trên tạm tính trước giảm giá)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10);
    const m = await seedMethod(t, { fee: 30000, freeOver: 100000 });
    await seedCoupon(t, { code: 'FIX100', type: 'fixed', value: 100000 });
    await seedCart(t, u.id, { lines: [{ product: p1 }], coupon: 'FIX100', method: m, city: 'Hà Nội' });
    const quote = jest.spyOn(t.shp, 'quote');
    const r = await getCart(t, u);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ subtotal: 100000, discount: 100000, shipping_fee: 0, total: 0, total_is_estimate: false });
    expect(quote.mock.calls[0][0]).toMatchObject({ subtotal: 100000 }); // trước giảm giá
    const s = await t.cart.snapshotForCheckout(u.id);
    expect(s).toMatchObject({ ok: true, items_subtotal: 100000, can_checkout: true });
  });
});

describe('CRT kiểm tồn khi thêm, sửa và xem giỏ (CRT-REQ-20261006-103226588)', () => {
  it('CRT-TC-20261006-104454411: dòng đủ hàng hiện ok, không có blocker, can_checkout true', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 5);
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    const r = await getCart(t, u);
    expect(r.body.items[0].availability).toEqual({ status: 'ok' });
    expect([r.body.checkout_blockers, r.body.can_checkout]).toEqual([[], true]);
  });

  it('CRT-TC-20261006-104454471: dòng thiếu hàng không bị tự giảm và chặn thanh toán (insufficient kèm available)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 2);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 3 }] });
    const r = await getCart(t, u);
    expect(r.body.items[0].availability).toEqual({ status: 'insufficient', available: 2 });
    expect([r.body.checkout_blockers, r.body.can_checkout]).toEqual([['insufficient_stock'], false]);
    expect((await itemsOf(t, cart))[0].quantity).toBe(3);
  });

  it('CRT-TC-20261006-104454533: hết hàng hẳn (out_of_stock) và thêm quá tồn bị 409 với available, giỏ không có sản phẩm đó', async () => {
    const u = await buyer(t);
    const p2 = await sku(t, 100000, 0), p3 = await sku(t, 100000, 4);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p2 }] });
    const r = await getCart(t, u);
    expect(r.body.items[0].availability).toEqual({ status: 'out_of_stock' });
    expect([r.body.checkout_blockers, r.body.can_checkout]).toEqual([['insufficient_stock'], false]);
    const a = await addItem(t, u, p3, 5);
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', available: 4 });
    expect((await itemsOf(t, cart)).map((i) => i.product_id)).toEqual([p2]);
  });

  it('CRT-TC-20261006-104454589: đúng bằng tồn là đủ, tăng thêm một thì từ chối', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 5);
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 5 }] });
    expect((await getCart(t, u)).body.items[0].availability).toEqual({ status: 'ok' });
    expect((await setQty(t, u, items[0], 4)).status).toBe(200);
    expect((await setQty(t, u, items[0], 5)).status).toBe(200); // tăng lên đúng bằng số còn bán thì được
    const r = await setQty(t, u, items[0], 6);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', available: 5 });
  });

  it('CRT-TC-20261006-104454655: không lộ tồn thật: dòng đủ hàng không có available, available không quá 99, không phản hồi nào chứa 5000', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 5000), p2 = await sku(t, 100000, 98);
    const bodies: unknown[] = [];
    const a = await addItem(t, u, p1, 200); bodies.push(a.body);
    const b = await addItem(t, u, p1, 99); bodies.push(b.body);
    const g = await getCart(t, u); bodies.push(g.body);
    const c = await addItem(t, u, p2, 99); bodies.push(c.body);
    expect([a.status, b.status]).toEqual([400, 201]);
    expect(g.body.items[0].availability).toEqual({ status: 'ok' });
    expect(g.body.items[0].availability).not.toHaveProperty('available');
    expect(c.status).toBe(409);
    expect(c.body.available).toBe(98);
    expect(JSON.stringify(bodies)).not.toContain('5000');
    for (const v of bodies.flatMap((x) => valuesOf(x, 'available'))) expect(Number(v)).toBeLessThanOrEqual(99);
    // tồn rất lớn cũng không lộ khi thêm vượt 99 dồn: 409 quantity-limit-exceeded, không kèm tồn
    const d = await addItem(t, u, p1, 1);
    expect(d.body).toMatchObject({ type: 'urn:ecom:error:quantity-limit-exceeded', max: 99, in_cart: 99 });
    expect(d.body).not.toHaveProperty('available');
  });

  it('CRT-TC-20261006-104454713: INV không trả lời: dòng unknown, không chặn, giá và tổng vẫn đúng; thêm thì 503; quá hạn 2 giây cũng vậy', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    jest.spyOn(t.inv, 'getAvailability').mockRejectedValue(new Error('inv down'));
    const g = await getCart(t, u);
    expect(g.status).toBe(200);
    expect(g.body.items[0].availability).toEqual({ status: 'unknown' });
    expect(g.body.checkout_blockers).not.toContain('insufficient_stock');
    expect(g.body).toMatchObject({ subtotal: 200000, total: 200000, can_checkout: true });
    const a = await addItem(t, u, p1, 1);
    expect([a.status, a.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
    expect((await itemsOf(t, (await activeCart(t, u.id))!.id))[0].quantity).toBe(2);
    jest.restoreAllMocks();
    jest.spyOn(t.inv, 'getAvailability').mockImplementation(() => new Promise(() => undefined)); // treo: hủy chờ sau hạn mặc định 2 giây
    const t0 = Date.now();
    const slow = await getCart(t, u);
    const dt = Date.now() - t0;
    expect(slow.body.items[0].availability).toEqual({ status: 'unknown' });
    expect(dt).toBeGreaterThanOrEqual(1900);
    expect(dt).toBeLessThan(4500);
  }, 30_000);

  it('CRT-TC-20261006-104454768: sản phẩm active chưa có bản ghi kho coi như hết hàng (409 available 0; xem giỏ out_of_stock)', async () => {
    const u = await buyer(t);
    const p9 = await product(t);
    const a = await addItem(t, u, p9, 1);
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', available: 0, in_cart: 0 });
    await seedCart(t, u.id, { lines: [{ product: p9 }] });
    expect((await getCart(t, u)).body.items[0].availability).toEqual({ status: 'out_of_stock' });
  });
});

describe('CRT thao tác không đổi giá trị đã tính (đủ chặn gấp triệu lần và hoàn tác)', () => {
  it('số tiền vượt miền: giỏ vượt trần 10 tỷ của SHP và 1 tỷ của PRM không làm hỏng giỏ; mã báo no_discount, vận chuyển báo cart_limit_exceeded (không còn service_unavailable mãi), chặn thanh toán', async () => {
    const { u } = await maxCart();
    const m = await seedMethod(t, { fee: 30000 });
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    const row = await activeCart(t, u.id);
    await t.prisma.$executeRaw`UPDATE carts SET coupon_code = 'SALE10', shipping_method_id = ${m}::uuid, shipping_city = 'Hà Nội' WHERE id = ${row!.id}::uuid`;
    const r = await getCart(t, u);
    expect(r.status).toBe(200);
    expect(r.body.subtotal).toBe(4_950_000_000_000);
    expect(r.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'no_discount' });
    expect(r.body.shipping).toEqual({ method_id: m, city: 'Hà Nội', fee: null, error: 'cart_limit_exceeded' });
    expect(r.body).toMatchObject({ discount: 0, shipping_fee: null, total: 4_950_000_000_000, total_is_estimate: true, can_checkout: false });
    expect(r.body.checkout_blockers).toContain('cart_limit_exceeded');
  });

  it('xóa, đổi, làm trống rồi xem: giỏ trống không còn tiền; WriteService không bị gọi khi chỉ xem (chỉ đọc)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10);
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const spy = jest.spyOn(WriteService.prototype as unknown as { bump: () => Promise<number> }, 'bump');
    await getCart(t, u); await call(t, 'get', '/cart/summary', { cookie: u.cookie });
    expect(spy).not.toHaveBeenCalled();
    expect((await delItem(t, u, items[0])).status).toBe(204);
    expect((await clearCart(t, u)).status).toBe(204);
    expect((await putCoupon(t, u, 'SALE10')).body.type).toBe('urn:ecom:error:cart-empty');
    expect((await putShipping(t, u, '00000000-0000-4000-8000-000000000000', 'Hà Nội')).body.type).toBe('urn:ecom:error:cart-empty');
    expect((await getCart(t, u)).body).toMatchObject({ subtotal: 0, total: 0, cart_id: null });
  });
});
