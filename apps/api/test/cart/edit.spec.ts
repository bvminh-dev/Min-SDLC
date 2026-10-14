import { randomUUID } from 'node:crypto';
import { WriteService } from '../../src/modules/cart/write.service';
import {
  activeCart, addItem, buyer, cartCount, cartsOf, clearCart, createCrtApp, delItem, getCart, itemCount, itemsOf, noTrace, q, resetCrt, seedCart, seedCoupon, seedMethod, setQty, sku, who, call,
  type CrtApp,
} from '../support/crt';

// REQ ...103226406 (đổi số lượng), ...103226434 (xóa dòng), ...103226460 (làm trống giỏ); PRD, INV, PRM, SHP thật trên PostgreSQL thật.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => jest.restoreAllMocks());

describe('CRT đổi số lượng của một dòng (CRT-REQ-20261006-103226406)', () => {
  it('CRT-TC-20261006-104451652: tăng rồi giảm số lượng (số tuyệt đối, không cộng dồn)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    const a = await setQty(t, u, items[0], 4);
    expect(a.status).toBe(200);
    expect(a.body.item).toMatchObject({ quantity: 4, line_total: 600000 });
    expect(a.body.summary.item_count).toBe(4);
    const b = await setQty(t, u, items[0], 1);
    expect([b.status, b.body.item.quantity, b.body.item.line_total]).toEqual([200, 1, 150000]);
  });

  it('CRT-TC-20261006-104451706: tăng quá tồn bị 409 insufficient-stock kèm available, dòng giữ nguyên', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 3);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    const r = await setQty(t, u, items[0], 5);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', available: 3, in_cart: 2 });
    expect((await itemsOf(t, cart))[0].quantity).toBe(2);
  });

  it('CRT-TC-20261006-104451802: dòng của người khác, dòng không có, id sai định dạng, dòng của giỏ abandoned hay converted cùng một 404, không đổi dữ liệu của người khác', async () => {
    const a = await buyer(t), b = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    const lb = (await seedCart(t, b.id, { lines: [{ product: p1, quantity: 2 }] })).items[0];
    const old = await seedCart(t, a.id, { status: 'abandoned', lines: [{ product: p1 }] });
    const conv = await seedCart(t, a.id, { status: 'converted', lines: [{ product: p1 }] });
    const bodies: Record<string, unknown>[] = [];
    const prd = jest.spyOn(t.deps, 'products'), inv = jest.spyOn(t.deps, 'availability');
    for (const id of [lb, randomUUID(), 'abc', old.items[0], conv.items[0], lb.toUpperCase()]) {
      prd.mockClear(); inv.mockClear();
      const r = await setQty(t, a, id, 3);
      expect([id, r.status]).toEqual([id, 404]);
      // sở hữu kiểm TRƯỚC mọi lời gọi sang mô-đun khác (không để người lạ làm CRT gọi PRD, INV; lớp khóa giao dịch là lớp phòng thủ thứ hai chứ không phải lớp duy nhất)
      expect([id, prd.mock.calls.length, inv.mock.calls.length]).toEqual([id, 0, 0]);
      expect(r.body.type).toBe('urn:ecom:error:cart-item-not-found');
      bodies.push(noTrace(r.body));
    }
    for (const x of bodies) expect(x).toEqual(bodies[0]);
    prd.mockRestore(); inv.mockRestore();
    expect((await q<{ quantity: number }>(t, `SELECT quantity FROM cart_items WHERE id = '${lb}'`))[0].quantity).toBe(2);
    expect((await delItem(t, a, lb)).status).toBe(404);
    for (const id of [old.items[0], conv.items[0]]) expect([id, (await delItem(t, a, id)).status]).toEqual([id, 404]); // dòng của giỏ abandoned, converted của chính A cũng không xóa được
    expect(await itemsOf(t, old.cart)).toHaveLength(1);
  });

  it('CRT-TC-20261006-104451879: số lượng ngoài 1..99 và trường lạ bị 400 (kể cả 0: không tự xóa dòng)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 500);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    for (const [qty, extra] of [[0], [-3], [2.5], ['4'], [100], [null], [2, { unit_price: 1 }], [2, { product_id: p1 }], [2, { subtotal: 1 }]] as [unknown, Record<string, unknown>?][]) {
      const r = await setQty(t, u, items[0], qty, extra);
      expect([qty, extra, r.status]).toEqual([qty, extra, 400]);
      expect(r.body.type).toBe('urn:ecom:error:validation-failed');
    }
    expect((await call(t, 'patch', `/cart/items/${items[0]}`, { cookie: u.cookie, body: {} })).status).toBe(400);
    expect((await itemsOf(t, cart))).toHaveLength(1);
    expect((await itemsOf(t, cart))[0].quantity).toBe(2);
  });

  it('CRT-TC-20261006-104451945: giảm khi đã vượt tồn được phép; đặt đúng số cũ không đổi gì (version, last_activity_at giữ nguyên)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 2);
    const t0 = new Date(Date.now() - 3600_000);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 5 }], version: 7, lastActivityAt: t0 });
    const a = await setQty(t, u, items[0], 3);
    expect(a.status).toBe(200);
    const afterA = (await cartsOf(t, u.id))[0];
    expect(afterA.version).toBe(8);
    expect(afterA.last_activity_at.getTime()).toBeGreaterThan(t0.getTime() + 3000_000);
    const b = await setQty(t, u, items[0], 3);
    expect(b.status).toBe(200);
    const afterB = (await cartsOf(t, u.id))[0];
    expect([afterB.version, afterB.last_activity_at.getTime(), afterB.updated_at.getTime()]).toEqual([8, afterA.last_activity_at.getTime(), afterA.updated_at.getTime()]);
    const v = await getCart(t, u);
    expect(v.body.items[0].availability).toEqual({ status: 'insufficient', available: 2 });
    expect(v.body.items[0].quantity).toBe(3);
    expect(await itemsOf(t, cart)).toHaveLength(1);
  });

  it('CRT-TC-20261006-104452006: dòng của sản phẩm ngừng bán chỉ giảm được (tăng bị 409 product-unavailable)', async () => {
    const u = await buyer(t);
    const p2 = await sku(t, 100000, 50);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p2, quantity: 2, reason: 'product_archived' }] });
    const up = await setQty(t, u, items[0], 3);
    expect([up.status, up.body.type]).toEqual([409, 'urn:ecom:error:product-unavailable']);
    expect((await setQty(t, u, items[0], 1)).status).toBe(200);
    expect((await itemsOf(t, cart))[0].quantity).toBe(1);
    // dự phòng khi event mất: dòng chưa bị đánh dấu nhưng PRD đã archived thì tăng cũng bị từ chối
    const p3 = await sku(t, 100000, 50);
    const u3 = await who(t, 'customer', 'khac@shop.vn');
    const c3 = await seedCart(t, u3.id, { lines: [{ product: p3 }] });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p3}::uuid`;
    expect((await setQty(t, u3, c3.items[0], 3)).body.type).toBe('urn:ecom:error:product-unavailable');
  });

  it('CRT-TC-20261006-104452063: đổi số lượng không làm mới giá lúc thêm (line_total theo giá hiện hành, unit_price lưu vẫn 140000)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1, price: 140000 }] });
    const r = await setQty(t, u, items[0], 2);
    expect([r.status, r.body.item.line_total, r.body.item.unit_price]).toEqual([200, 300000, 150000]);
    expect((await itemsOf(t, cart))[0].unit_price).toBe('140000');
    expect((await getCart(t, u)).body.items[0].previous_unit_price).toBe(140000);
  });

  it('CRT-TC-20261006-104452875: PRD không trả lời khi đổi số lượng (kể cả giảm, vì line_total cần giá hiện hành): 503 service-unavailable, dòng không đổi, không tăng version', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 3 }] });
    jest.spyOn(t.catalog, 'getForCart').mockRejectedValue(new Error('prd down'));
    for (const q of [2, 4]) {
      const r = await setQty(t, u, items[0], q);
      expect([q, r.status, r.body.type]).toEqual([q, 503, 'urn:ecom:error:service-unavailable']);
    }
    expect((await itemsOf(t, cart))[0].quantity).toBe(3);
    expect((await activeCart(t, u.id))!.version).toBe(1);
  });

  it('CRT-TC-20261006-104452119: hai yêu cầu đổi cùng một dòng cùng lúc (3 và 4) đều 200, số cuối là 3 hoặc 4 (lặp 50 lần)', async () => {
    const p1 = await sku(t, 100000, 1000);
    for (let i = 0; i < 50; i++) {
      const u = await buyer(t);
      const { items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1 }] });
      const [a, b] = await Promise.all([setQty(t, u, items[0], 3), setQty(t, u, items[0], 4)]);
      expect([i, a.status, b.status]).toEqual([i, 200, 200]);
      expect([3, 4]).toContain((await itemsOf(t, (await activeCart(t, u.id))!.id))[0].quantity);
    }
  }, 120_000);

  it('CRT-TC-20261006-104454980: dòng của giỏ đã bỏ dở không sửa được (404 cart-item-not-found), dòng không đổi', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 50);
    const { cart, items } = await seedCart(t, u.id, { status: 'abandoned', lines: [{ product: p1, quantity: 1 }] });
    const r = await setQty(t, u, items[0], 2);
    expect([r.status, r.body.type]).toEqual([404, 'urn:ecom:error:cart-item-not-found']);
    expect((await itemsOf(t, cart))[0].quantity).toBe(1);
  });
});

describe('CRT xóa một dòng khỏi giỏ (CRT-REQ-20261006-103226434)', () => {
  it('CRT-TC-20261006-104452170: xóa một dòng, dòng còn lại nguyên vẹn, tạm tính chỉ tính dòng còn lại', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10), p2 = await sku(t, 50000, 10);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }, { product: p2 }] });
    const r = await delItem(t, u, items[0]);
    expect([r.status, r.text]).toEqual([204, '']);
    expect((await itemsOf(t, cart)).map((i) => i.id)).toEqual([items[1]]);
    const v = await getCart(t, u);
    expect([v.body.items.map((i: { id: string }) => i.id), v.body.subtotal, v.body.line_count]).toEqual([[items[1]], 50000, 1]);
  });

  it('CRT-TC-20261006-104452215: xóa dòng của người khác, xóa lần hai, id lạ đều 404 cùng nội dung; guest 401, staff 403', async () => {
    const a = await buyer(t), b = await buyer(t), staff = await who(t, 'staff', 's@shop.vn');
    const p1 = await sku(t, 100000, 10);
    const lb = (await seedCart(t, b.id, { lines: [{ product: p1 }] })).items[0];
    const l1 = (await seedCart(t, a.id, { lines: [{ product: p1 }] })).items[0];
    expect((await delItem(t, a, l1)).status).toBe(204);
    const bodies: Record<string, unknown>[] = [];
    for (const id of [lb, l1, 'abc', randomUUID()]) {
      const r = await delItem(t, a, id);
      expect([id, r.status]).toEqual([id, 404]);
      bodies.push(noTrace(r.body));
    }
    for (const x of bodies) expect(x).toEqual(bodies[0]);
    expect(bodies[0].type).toBe('urn:ecom:error:cart-item-not-found');
    expect(await itemCount(t, `id = '${lb}'`)).toBe(1);
    expect((await delItem(t, undefined, lb)).status).toBe(401);
    expect((await delItem(t, staff, lb)).status).toBe(403);
  });

  it('CRT-TC-20261006-104452267: xóa dòng cuối cùng bỏ luôn mã và lựa chọn vận chuyển, giỏ vẫn active', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const m = await seedMethod(t, { fee: 30000 });
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1 }], coupon: 'SALE10', method: m, city: 'Hà Nội' });
    expect((await delItem(t, u, items[0])).status).toBe(204);
    expect(await activeCart(t, u.id)).toMatchObject({ status: 'active', coupon_code: null, shipping_method_id: null, shipping_city: null });
    const v = await getCart(t, u);
    expect(v.body).toMatchObject({ cart_id: null, items: [], coupon: null, shipping: null, subtotal: 0, total: 0 });
  });

  it('CRT-TC-20261006-104452317: xóa dòng ngừng bán gỡ blocker unavailable_item khỏi giỏ', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10), p2 = await sku(t, 100000, 10);
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p1}::uuid`;
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1 }, { product: p2 }] });
    const before = await getCart(t, u);
    expect([before.body.checkout_blockers, before.body.can_checkout]).toEqual([['unavailable_item'], false]);
    expect((await delItem(t, u, items[0])).status).toBe(204);
    const after = await getCart(t, u);
    expect([after.body.checkout_blockers, after.body.can_checkout]).toEqual([[], true]);
  });

  it('CRT-TC-20261006-104452371: hai tab cùng xóa một dòng: đúng một 204 và một 404, không 500 (lặp 50 lần)', async () => {
    const p1 = await sku(t, 100000, 10);
    for (let i = 0; i < 50; i++) {
      const u = await buyer(t);
      const { items } = await seedCart(t, u.id, { lines: [{ product: p1 }] });
      const rs = await Promise.all([delItem(t, u, items[0]), delItem(t, u, items[0])]);
      expect([i, rs.map((r) => r.status).sort()]).toEqual([i, [204, 404]]);
    }
  }, 120_000);
});

describe('CRT làm trống giỏ (CRT-REQ-20261006-103226460)', () => {
  it('CRT-TC-20261006-104452418: làm trống xóa dòng, mã và vận chuyển; giỏ vẫn active, version tăng 1', async () => {
    const u = await buyer(t);
    const ps = [await sku(t), await sku(t), await sku(t)];
    const m = await seedMethod(t);
    const { cart } = await seedCart(t, u.id, { lines: ps.map((product) => ({ product })), coupon: 'SALE10', method: m, city: 'Hà Nội', version: 9 });
    const r = await clearCart(t, u);
    expect([r.status, r.text]).toEqual([204, '']);
    expect(await itemsOf(t, cart)).toEqual([]);
    expect(await activeCart(t, u.id)).toMatchObject({ id: cart, status: 'active', coupon_code: null, shipping_method_id: null, shipping_city: null, version: 10 });
    const v = await getCart(t, u);
    expect(v.body).toMatchObject({ items: [], subtotal: 0, discount: 0, total: 0, coupon: null, shipping: null });
  });

  it('CRT-TC-20261006-104452493: không đăng nhập 401, staff 403, chỉ giỏ của người gọi bị ảnh hưởng', async () => {
    const a = await buyer(t), b = await buyer(t), staff = await who(t, 'staff', 's@shop.vn');
    const p1 = await sku(t), p2 = await sku(t);
    const bc = await seedCart(t, b.id, { lines: [{ product: p1 }, { product: p2 }] });
    const ac = await seedCart(t, a.id, { lines: [{ product: p1 }] });
    expect((await clearCart(t, undefined)).status).toBe(401);
    expect((await clearCart(t, staff)).status).toBe(403);
    expect((await itemsOf(t, ac.cart))).toHaveLength(1);
    expect((await clearCart(t, a)).status).toBe(204);
    expect(await itemsOf(t, ac.cart)).toHaveLength(0);
    expect(await itemsOf(t, bc.cart)).toHaveLength(2);
  });

  it('CRT-TC-20261006-104452550: làm trống giỏ trống hoặc chưa có giỏ vẫn 204, không tạo giỏ, version giỏ trống không đổi', async () => {
    const a = await buyer(t), c = await buyer(t);
    const { cart } = await seedCart(t, a.id, { version: 4 });
    expect((await clearCart(t, a)).status).toBe(204);
    expect((await clearCart(t, c)).status).toBe(204);
    expect((await cartsOf(t, a.id))[0]).toMatchObject({ id: cart, version: 4 });
    expect(await cartsOf(t, c.id)).toEqual([]);
  });

  it('CRT-TC-20261006-104452611: làm trống giỏ 50 dòng trong MỘT giao dịch; lỗi giữa chừng thì quay lui cả dòng lẫn mã', async () => {
    const u = await buyer(t);
    const ps: string[] = [];
    for (let i = 0; i < 50; i++) ps.push(await sku(t));
    const { cart } = await seedCart(t, u.id, { lines: ps.map((product) => ({ product })), coupon: 'SALE10' });
    const run = jest.spyOn(t.tx, 'run');
    expect((await clearCart(t, u)).status).toBe(204);
    expect(run).toHaveBeenCalledTimes(1); // một giao dịch duy nhất cho cả lời gọi
    expect(await itemsOf(t, cart)).toHaveLength(0);
    expect((await getCart(t, u)).body.line_count).toBe(0);
    // quay lui: ghi `version` lỗi sau khi đã xóa dòng thì không dòng nào mất
    const u2 = await buyer(t);
    const c2 = await seedCart(t, u2.id, { lines: ps.slice(0, 5).map((product) => ({ product })), coupon: 'SALE10' });
    jest.spyOn(WriteService.prototype as unknown as { bump: () => Promise<number> }, 'bump').mockRejectedValueOnce(new Error('boom'));
    expect((await clearCart(t, u2)).status).toBe(500);
    expect(await itemsOf(t, c2.cart)).toHaveLength(5);
    expect((await activeCart(t, u2.id))!.coupon_code).toBe('SALE10');
  }, 60_000);

  it('CRT-TC-20261006-104452670: làm trống đua với thêm sản phẩm: không bao giờ còn dòng mà còn mã của giỏ cũ (lặp 50 lần)', async () => {
    const p1 = await sku(t, 100000, 1000), pa = await sku(t, 100000, 1000);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    for (let i = 0; i < 50; i++) {
      const u = await buyer(t);
      await seedCart(t, u.id, { lines: [{ product: pa }], coupon: 'SALE10' });
      const [c, a] = await Promise.all([clearCart(t, u), addItem(t, u, p1, 1)]);
      expect([i, c.status, a.status === 200 || a.status === 201]).toEqual([i, 204, true]);
      const row = (await cartsOf(t, u.id)).find((x) => x.status === 'active')!;
      const items = await itemsOf(t, row.id);
      expect([i, row.coupon_code]).toEqual([i, null]); // cả hai kết cục hợp lệ đều không còn mã
      const lines = items.map((x) => [x.product_id, x.quantity]);
      expect([i, lines.length === 0 || (lines.length === 1 && lines[0][0] === p1 && lines[0][1] === 1)]).toEqual([i, true]);
    }
  }, 120_000);

  it('làm trống không động tới giỏ converted hay abandoned của chính người dùng, và không tạo giỏ mới (CRT-TC-20261006-104452550)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t);
    await seedCart(t, u.id, { status: 'converted', lines: [{ product: p1 }] });
    await seedCart(t, u.id, { status: 'abandoned', lines: [{ product: p1 }] });
    expect((await clearCart(t, u)).status).toBe(204);
    expect(await itemCount(t)).toBe(2);
    expect(await cartCount(t)).toBe(2);
  });
});
