import { EventsService } from '../../src/modules/platform';
import { deliver } from '../support/ord';
import { itemsOf, sku, type CrtApp } from '../support/crt';
import {
  alignWindow, auditsOf, call, countOf, create, createChkApp, customer, holdsOf, idemRows, noTrace, onHandOf, orderItemsOf, ordersOf, outboxOf, place, placeShown, pickShipping, q, race, ready, redemptionsFor, relayAll, reservedCount,
  reservedOf, resetChk, seedCart, seedCoupon, seedMethod, sessionRow, sessionsOf, setCouponStatus, setEmailVerified, setPrice, shopper, tally, view, who, world, type ChkApp, type Seeded, type World,
} from '../support/chk';

// REQ ...105051825 (kiểm giá), ...105051977 (kiểm tồn), ...105052127 (giữ hàng, giữ coupon), ...105052272 (đặt hàng): MỘT giao dịch, module thật (CRT, USR, PRM, INV, SHP, ORD, PAY), PostgreSQL thật.
// Gài lỗi và độ trễ bằng jest.spyOn trên chính các lớp `*Api` mà CHK gọi (mockImplementation gọi hàm thật rồi ném lỗi, hay chờ rồi gọi hàm thật).
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => { jest.restoreAllMocks(); t.chk.timeoutMs = t.config.get<number>('CHK_DEPENDENCY_TIMEOUT_MS'); });
const asCrt = (): CrtApp => t as unknown as CrtApp;

/** Phiên đầy đủ của khách A: P1 x 2 và P2 x 1, SALE10, SM1, địa chỉ a1 (Hà Nội), `cod` hoặc `vnpay`; giỏ version 7; xem lại thấy 345000. */
async function full(o: { pay?: 'cod' | 'vnpay'; email?: string; coupon?: string | null; lines?: { product: string; quantity?: number }[] } = {}): Promise<{ s: Seeded; id: string }> {
  const s = await shopper(t, w, { email: o.email, lines: o.lines });
  const id = await ready(t, s, w, { pay: o.pay ?? 'cod', coupon: o.coupon === undefined ? 'SALE10' : o.coupon });
  return { s, id };
}
const body = (n = 345000, v = 7) => ({ expected_grand_total: n, cart_version: v });

describe('CHK kiểm giá khi đặt (CHK-REQ-20261006-105051825)', () => {
  it('CHK-TC-20261006-110702386: số khớp thì đặt thành công với số do máy chủ tính: Order grand_total 345000 = 350000 - 35000 + 30000, hai dòng hàng đúng giá', async () => {
    const { s, id } = await full();
    const shown = (await view(t, s.u, id)).body;
    expect([shown.grand_total, shown.cart_version]).toEqual([345000, 7]);
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(201);
    const [o] = await ordersOf(t, s.u.id);
    expect([o.grand_total, o.items_total, o.discount, o.shipping_fee]).toEqual(['345000', '350000', '35000', '30000']);
    expect(Number(o.grand_total)).toBe(Number(o.items_total) - Number(o.discount) + Number(o.shipping_fee));
    expect((await orderItemsOf(t, o.id)).map((i) => [i.product_id, i.unit_price, i.quantity, i.name_snapshot])).toEqual([[w.p1, '150000', 2, 'Áo thun cotton'], [w.p2, '50000', 1, 'Tất cổ cao']]);
  });

  it('CHK-TC-20261006-110702421: giá tăng sau khi xem: 409 price-changed (previous_grand_total 345000, review mới 370000, 37000, 30000, 363000), không Order, không reservation, reserved_count không đổi; đặt lại với 363000 thì 201 và Order 363000', async () => {
    const { s, id } = await full();
    await setPrice(t, w.p1, 160000);
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:price-changed', previous_grand_total: 345000, review: { items_subtotal: 370000, discount: 37000, shipping_fee: 30000, grand_total: 363000, expected_grand_total: 363000, cart_version: 7 } });
    expect(r.body.review.lines[0]).toMatchObject({ product_id: w.p1, unit_price: 160000, quantity: 2 });
    expect(await tally(t)).toEqual(before);
    expect(await reservedCount(t, 'SALE10')).toBe(0);
    expect((await sessionRow(t, id)).price_snapshot).toMatchObject({ grand_total: 363000 }); // bản chụp chẩn đoán cập nhật, ngoài giao dịch đặt hàng
    const ok = await place(t, s.u, id, body(363000));
    expect(ok.status).toBe(201);
    expect((await ordersOf(t, s.u.id))[0].grand_total).toBe('363000');
  });

  it('CHK-TC-20261006-110702458: expected_grand_total thấp giả (1): 409 price-changed kèm số thật 345000; không Order nào có grand_total 1', async () => {
    const { s, id } = await full();
    const r = await place(t, s.u, id, body(1));
    expect([r.status, r.body.type, r.body.previous_grand_total, r.body.review.grand_total]).toEqual([409, 'urn:ecom:error:price-changed', 1, 345000]);
    expect(await countOf(t, 'orders', 'grand_total = 1')).toBe(0);
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110702492: giỏ đổi ở tab khác (cart_version 7 lên 8): 409 cart-changed kèm review.cart_version 8 và tổng theo P1 x 1; không Order, reservation, lượt coupon', async () => {
    const { s, id } = await full();
    const [i1] = await itemsOf(t, s.cart);
    expect((await call(t, 'patch', `/cart/items/${i1.id}`, { cookie: s.u.cookie, body: { quantity: 1 } })).status).toBe(200);
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:cart-changed', review: { cart_version: 8, items_subtotal: 200000, discount: 20000, shipping_fee: 30000, grand_total: 210000 } });
    expect(await tally(t)).toEqual(before);
  });

  it('CHK-TC-20261006-110702525: body thiếu hay sai kiểu (rỗng, 345000.5, "345000", thiếu cart_version) bị 400 validation-failed nêu đúng trường; không Order', async () => {
    const { s, id } = await full();
    const cases: [unknown, string[]][] = [
      [{}, ['expected_grand_total', 'cart_version']], [{ expected_grand_total: 345000.5, cart_version: 7 }, ['expected_grand_total']],
      [{ expected_grand_total: '345000', cart_version: 7 }, ['expected_grand_total']], [{ expected_grand_total: 345000 }, ['cart_version']],
    ];
    for (const [b, fields] of cases) {
      const r = await place(t, s.u, id, b);
      expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']);
      expect(r.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([...fields].sort());
    }
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110702559: giá giảm cũng phải xác nhận lại: 409 price-changed (grand_total mới 327000 = 330000 - 33000 + 30000), lần đặt sau với số mới thì 201', async () => {
    const { s, id } = await full();
    await setPrice(t, w.p1, 140000);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type, r.body.review.grand_total, r.body.review.items_subtotal, r.body.review.discount]).toEqual([409, 'urn:ecom:error:price-changed', 327000, 330000, 33000]);
    expect((await place(t, s.u, id, body(327000))).status).toBe(201);
  });

  it('CHK-TC-20261006-110702592: giá đổi lần nữa sau khi xác nhận: 409 price-changed lần hai (381000 = 390000 - 39000 + 30000); không Order', async () => {
    const { s, id } = await full();
    await setPrice(t, w.p1, 160000);
    const a = await place(t, s.u, id, body());
    expect(a.body.review.grand_total).toBe(363000);
    await setPrice(t, w.p1, 170000);
    const b = await place(t, s.u, id, body(363000));
    expect([b.status, b.body.type, b.body.review.grand_total, b.body.review.items_subtotal, b.body.review.discount]).toEqual([409, 'urn:ecom:error:price-changed', 381000, 390000, 39000]);
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110702626: cart_version lệch thắng price-changed khi cả hai cùng xảy ra (phí 30000 xuất hiện vì tạm tính xuống 450000): 409 cart-changed', async () => {
    const { s, id } = await full({ lines: [{ product: w.p1, quantity: 3 }, { product: w.p2, quantity: 1 }], coupon: null }); // 500000: miễn phí
    const shown = (await view(t, s.u, id)).body;
    expect([shown.items_subtotal, shown.shipping_fee, shown.grand_total]).toEqual([500000, 0, 500000]);
    const items = await itemsOf(t, s.cart);
    await call(t, 'delete', `/cart/items/${items[1].id}`, { cookie: s.u.cookie }); // tab 2: bỏ P2 → 450000, phí 30000, version đổi
    const r = await place(t, s.u, id, body(500000));
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:cart-changed']);
    expect(r.body.review.shipping_fee).toBe(30000);
  });
});

describe('CHK kiểm tồn và giữ hàng khi đặt (CHK-REQ-20261006-105051977, ...105052127)', () => {
  it('CHK-TC-20261006-110702659: đủ hàng ở cả hai lớp: xem lại mọi dòng availability ok, không blocker insufficient_stock; đặt 201, reserved của P1 tăng 2 và P2 tăng 1', async () => {
    const { s, id } = await full();
    const v = (await view(t, s.u, id)).body;
    expect(v.lines.map((l: { availability: unknown }) => l.availability)).toEqual([{ status: 'ok' }, { status: 'ok' }]);
    expect(v.blockers).not.toContain('insufficient_stock');
    expect((await place(t, s.u, id, body())).status).toBe(201);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([2, 1]);
  });

  it('CHK-TC-20261006-110702693: một mặt hàng hết: 409 insufficient-stock chỉ nêu P2 (requested 1, available 0, reason insufficient_stock), không lộ tồn của P1; reserved không đổi, không Order, không có stack hay tên bảng', async () => {
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 0 WHERE product_id = ${w.p2}::uuid`;
    const { s, id } = await full();
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', items: [{ product_id: w.p2, name: 'Tất cổ cao', requested: 1, available: 0, reason: 'insufficient_stock' }] });
    expect(r.text).not.toMatch(/"available":10\b|stock_items|prisma|Error:|\bat \w+\.</);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([0, 0]);
    expect(await tally(t)).toEqual(before);
  });

  it('CHK-TC-20261006-110702727: dòng sản phẩm ngừng bán chặn trước khi giữ hàng: 409 cart-has-unavailable-items (issues có P3 unavailable), InventoryApi.reserve không được gọi, không Order', async () => {
    const p3 = await sku(asCrt(), 70000, 10, { name: 'Sản phẩm P3' });
    const { s, id } = await full({ lines: [{ product: w.p1, quantity: 1 }, { product: p3, quantity: 1 }], coupon: null });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived'::product_status WHERE id = ${p3}::uuid`;
    const spy = jest.spyOn(t.inv, 'reserve');
    const r = await place(t, s.u, id, body(220000));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:cart-has-unavailable-items', issues: [{ product_id: p3, reason: 'unavailable' }] });
    expect(spy).toHaveBeenCalledTimes(0);
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110702761: INV quá 2 giây: 503 dependency-unavailable trong khoảng 2 đến 3 giây; không Order, reservation, lượt coupon; INV trở lại thì đặt lại được (201)', async () => {
    const { s, id } = await full();
    const orig = t.inv.reserve.bind(t.inv);
    jest.spyOn(t.inv, 'reserve').mockImplementation((...a) => new Promise((res) => setTimeout(res, 2500)).then(() => orig(...a)));
    const before = await tally(t);
    const t0 = Date.now();
    const r = await place(t, s.u, id, body(), { key: 'slow-key-0001' });
    const ms = Date.now() - t0;
    expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:dependency-unavailable']);
    expect(ms).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThan(3000);
    expect(await tally(t)).toEqual(before);
    jest.restoreAllMocks();
    await new Promise((res) => setTimeout(res, 700)); // lời gọi chậm đã bỏ chạy nốt trên giao dịch đóng
    expect((await place(t, s.u, id, body(), { key: 'slow-key-0001' })).status).toBe(201); // khóa không bị "đốt" bởi lần lỗi
  });

  it('CHK-TC-20261006-110702794: còn đúng 2, mua 2: thành công, available của P1 về 0 (reserved tăng 2)', async () => {
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 2 WHERE product_id = ${w.p1}::uuid`;
    const { s, id } = await full({ lines: [{ product: w.p1, quantity: 2 }], coupon: null });
    const r = await place(t, s.u, id, body(330000));
    expect(r.status).toBe(201);
    expect([await onHandOf(t, w.p1), await reservedOf(t, w.p1)]).toEqual([2, 2]);
  });

  it('CHK-TC-20261006-110702827: hai khách cùng mua đơn vị cuối cùng (lặp 20 lần): đúng một 201, người kia 409 insufficient-stock (requested 1, available 0), reserved = 1, người thua không có Order', async () => {
    for (let i = 0; i < 20; i++) {
      await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 1, reserved = 0 WHERE product_id = ${w.p1}::uuid`;
      const a = await shopper(t, w, { email: `a${i}@shop.vn`, lines: [{ product: w.p1, quantity: 1 }] }), b = await shopper(t, w, { email: `b${i}@shop.vn`, lines: [{ product: w.p1, quantity: 1 }] });
      const ia = await ready(t, a, w, { pay: 'cod', coupon: null }), ib = await ready(t, b, w, { pay: 'cod', coupon: null });
      const [ra, rb] = await race(() => place(t, a.u, ia, body(180000)), () => place(t, b.u, ib, body(180000)));
      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
      const lose = ra.status === 409 ? ra : rb, loser = ra.status === 409 ? a.u : b.u;
      expect(lose.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', items: [{ product_id: w.p1, requested: 1, available: 0 }] });
      expect(await reservedOf(t, w.p1)).toBe(1);
      expect(await countOf(t, 'orders', `user_id = '${loser.id}'`)).toBe(0);
      expect((await sessionRow(t, ra.status === 409 ? ia : ib)).status).toBe('open');
    }
  }, 120_000);

  it('CHK-TC-20261006-110702860: lớp mềm báo đủ nhưng người khác mua hết đúng lúc: lớp cứng quyết, 409 insufficient-stock (requested 2, available 0)', async () => {
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 2 WHERE product_id = ${w.p1}::uuid`;
    const a = await shopper(t, w, { email: 'a@shop.vn', lines: [{ product: w.p1, quantity: 2 }] }), b = await shopper(t, w, { email: 'b@shop.vn', lines: [{ product: w.p1, quantity: 2 }] });
    const ia = await ready(t, a, w, { pay: 'cod', coupon: null }), ib = await ready(t, b, w, { pay: 'cod', coupon: null });
    expect((await view(t, a.u, ia)).body.lines[0].availability).toEqual({ status: 'ok' });
    expect((await place(t, b.u, ib, body(330000))).status).toBe(201);
    const r = await place(t, a.u, ia, body(330000));
    expect([r.status, r.body.type, r.body.items]).toEqual([409, 'urn:ecom:error:insufficient-stock', [{ product_id: w.p1, name: 'Áo thun cotton', requested: 2, available: 0, reason: 'insufficient_stock' }]]);
  });

  it('CHK-TC-20261006-110702894: đơn VNPay: Order pending, hai reservation held (P1 2, P2 3) hạn = giờ CSDL + 15 phút và đúng bằng payment_expires_at của Order, một lượt coupon reserved, phản hồi payment_deadline; không StockMovement; CHK không có handler StockReserved', async () => {
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 5 WHERE product_id = ${w.p1}::uuid`;
    const { s, id } = await full({ pay: 'vnpay', lines: [{ product: w.p1, quantity: 2 }, { product: w.p2, quantity: 3 }] });
    const shown = (await view(t, s.u, id)).body;
    const [{ ms }] = await q<{ ms: number }>(t, 'SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms');
    const r = await place(t, s.u, id, body(shown.grand_total, 7));
    expect(r.status).toBe(201);
    const [o] = await ordersOf(t, s.u.id);
    expect(o.status).toBe('pending');
    const holds = await holdsOf(t, o.id);
    expect(holds.map((h) => [h.product_id, h.quantity, h.status])).toEqual([[w.p1, 2, 'held'], [w.p2, 3, 'held']].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    for (const h of holds) { expect(Math.abs(h.expires_at!.getTime() - (ms + 15 * 60_000))).toBeLessThan(5000); expect(h.expires_at!.getTime()).toBe(o.payment_expires_at!.getTime()); }
    expect(r.body.payment_deadline).toBe(o.payment_expires_at!.toISOString());
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2), await onHandOf(t, w.p1)]).toEqual([2, 3, 5]);
    expect(await redemptionsFor(t, 'SALE10')).toMatchObject([{ order_id: o.id, status: 'reserved' }]);
    expect(await countOf(t, 'stock_movements')).toBe(0);
    expect(t.app.get(EventsService).consumersFor('StockReserved').filter((c) => c.consumer === 'checkout')).toEqual([]);
  });

  it('CHK-TC-20261006-110702928: đơn COD: hai reservation held có expires_at null, Order payment_expires_at null, phản hồi không có payment_deadline', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(201);
    expect(r.body).not.toHaveProperty('payment_deadline');
    const [o] = await ordersOf(t, s.u.id);
    expect(o.payment_expires_at).toBeNull();
    expect((await holdsOf(t, o.id)).map((h) => [h.status, h.expires_at])).toEqual([['held', null], ['held', null]]);
  });

  it('CHK-TC-20261006-110702962: thiếu hàng (P2 còn 2, cần 3): 409 insufficient-stock (requested 3, available 2); số Order không đổi, reserved của P1 và P2 không đổi, không lượt coupon', async () => {
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 2 WHERE product_id = ${w.p2}::uuid`;
    const { s, id } = await full({ lines: [{ product: w.p1, quantity: 2 }, { product: w.p2, quantity: 3 }] });
    const before = await tally(t);
    const r = await place(t, s.u, id, body(480000 - 48000 + 30000)); // 450000 + 50000 x... số đúng không quan trọng: giá khớp là điều kiện để tới bước giữ hàng
    const shown = (await view(t, s.u, id)).body;
    const r2 = await place(t, s.u, id, body(shown.grand_total));
    expect([r.status, r2.status, r2.body.type, r2.body.items]).toEqual([409, 409, 'urn:ecom:error:insufficient-stock', [{ product_id: w.p2, name: 'Tất cổ cao', requested: 3, available: 2, reason: 'insufficient_stock' }]]);
    expect(await tally(t)).toEqual(before);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2), await reservedCount(t, 'SALE10')]).toEqual([0, 0, 0]);
  });

  it('CHK-TC-20261006-110702996: coupon hết lượt do người khác giữ trước đúng lúc A gọi reserve (gài vào khe giữa kiểm giá và giữ lượt): 409 coupon-invalid (coupon_exhausted), reserved của INV về giá trị cũ (hàng đã giữ bị hoàn tác), không Order', async () => {
    await t.prisma.$executeRaw`UPDATE coupons SET usage_limit = 1 WHERE code = 'SALE10'`;
    const { s, id } = await full();
    const orig = t.prm.evaluate.bind(t.prm);
    jest.spyOn(t.prm, 'evaluate').mockImplementation(async (...a) => { const r = await orig(...a); await t.prisma.$executeRaw`UPDATE coupons SET reserved_count = 1 WHERE code = 'SALE10'`; return r; });
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type, r.body.reason]).toEqual([409, 'urn:ecom:error:coupon-invalid', 'coupon_exhausted']);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([0, 0]);
    expect(await tally(t)).toEqual(before);
    expect(await reservedCount(t, 'SALE10')).toBe(1); // lượt của người "khác", không phải của A
  });

  it('CHK-TC-20261006-110703029: lỗi gài sau từng bước (createPending, INV reserve, PRM reserve, confirmCod): 503 dependency-unavailable, số Order, reservation, lượt coupon, outbox, audit, khóa idempotency không đổi, reserved không đổi, phiên open; hết gài đặt lại cùng khóa thì 201', async () => {
    const steps: [string, object, string][] = [['createPending', t.ord, 'createPending'], ['InventoryApi.reserve', t.inv, 'reserve'], ['PromotionApi.reserve', t.prm, 'reserve'], ['confirmCod', t.ord, 'confirmCod']];
    const { s, id } = await full({ pay: 'cod' });
    const before = await tally(t);
    for (const [name, owner, method] of steps) {
      const orig = (owner as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[method].bind(owner);
      jest.spyOn(owner as never, method as never).mockImplementation((async (...a: unknown[]) => { await orig(...a); throw new Error('lỗi gài sau bước'); }) as never); // gọi hàm thật (đã ghi trong giao dịch) rồi ném lỗi
      const r = await place(t, s.u, id, body(), { key: 'fail-step-key-1' });
      expect([name, r.status, r.body.type]).toEqual([name, 503, 'urn:ecom:error:dependency-unavailable']);
      expect([name, await tally(t)]).toEqual([name, before]);
      expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([0, 0]);
      expect((await sessionRow(t, id)).status).toBe('open');
      jest.restoreAllMocks();
    }
    expect((await place(t, s.u, id, body(), { key: 'fail-step-key-1' })).status).toBe(201);
  });

  it('CHK-TC-20261006-110703063: đơn VNPay quá 15 phút không thanh toán: INV chuyển reservation expired, ORD chuyển Order expired, PRM nhả lượt (reserved_count trừ 1), hàng trả về; hạn khớp payment_expires_at; phiên checkout vẫn completed và CHK không phát thêm event nào', async () => {
    const { s, id } = await full({ pay: 'vnpay' });
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(201);
    const [o] = await ordersOf(t, s.u.id);
    await relayAll(t, 3);
    expect(await reservedCount(t, 'SALE10')).toBe(1);
    const chkEvents = (await outboxOf(t)).filter((e) => e.type.startsWith('Checkout')).length;
    const late = new Date(o.payment_expires_at!.getTime() + 70_000); // 16 phút 10 giây sau lúc đặt
    expect(await t.invJobs.expireOnce({ now: late })).toMatchObject({ orders: 1 });
    await relayAll(t, 6);
    expect((await holdsOf(t, o.id)).every((h) => h.status === 'expired')).toBe(true);
    expect((await ordersOf(t, s.u.id))[0].status).toBe('expired');
    expect(await reservedCount(t, 'SALE10')).toBe(0);
    expect((await redemptionsFor(t, 'SALE10'))[0].status).toBe('released');
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([0, 0]);
    expect((await sessionRow(t, id)).status).toBe('completed');
    expect((await outboxOf(t)).filter((e) => e.type.startsWith('Checkout')).length).toBe(chkEvents);
  });

  it('CHK-TC-20261006-110703096: giỏ 50 dòng, mỗi dòng 99, tất cả đủ hàng: 201, đúng 50 StockReservation held, reserved của mỗi sản phẩm = 99', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(await sku(asCrt(), 100_000, 99));
    const s = await shopper(t, w, { lines: ids.map((product) => ({ product, quantity: 99 })) });
    const free = await seedMethod(t, { name: 'Miễn phí 50', fee: 30000, freeOver: 1 });
    const id = await ready(t, s, w, { pay: 'cod', method: free });
    const shown = (await view(t, s.u, id)).body;
    expect(shown.grand_total).toBe(50 * 99 * 100_000);
    const r = await place(t, s.u, id, body(shown.grand_total));
    expect(r.status).toBe(201);
    const [o] = await ordersOf(t, s.u.id);
    expect((await holdsOf(t, o.id)).filter((h) => h.status === 'held')).toHaveLength(50);
    for (const p of ids) expect(await reservedOf(t, p)).toBe(99);
  }, 120_000);

  it('CHK-TC-20261006-110703129: hai đơn VNPay liên tiếp cùng mặt hàng còn đủ: mỗi đơn có hạn riêng (đơn hai hạn muộn hơn đơn một khoảng 4 phút), reserved = 5', async () => {
    const a = await shopper(t, w, { lines: [{ product: w.p1, quantity: 2 }] });
    const ia = await ready(t, a, w, { pay: 'vnpay', coupon: null });
    expect((await place(t, a.u, ia, body(330000))).status).toBe(201);
    await relayAll(t, 3); // CheckoutCompleted tới CRT: giỏ thứ nhất converted
    const [first] = await ordersOf(t, a.u.id);
    await t.prisma.$executeRaw`UPDATE stock_reservations SET expires_at = expires_at - interval '4 minutes' WHERE order_id = ${first.id}::uuid`; // như đơn đầu đặt cách đây 4 phút
    await t.prisma.$executeRaw`UPDATE orders SET payment_expires_at = payment_expires_at - interval '4 minutes' WHERE id = ${first.id}::uuid`;
    await seedCart(t as never, a.u.id, { lines: [{ product: w.p1, quantity: 3 }], version: 2 });
    const ib = (await create(t, a.u)).body.id;
    await call(t, 'put', `/checkout/sessions/${ib}/shipping-method`, { cookie: a.u.cookie, body: { method_id: w.sm1 } });
    await call(t, 'put', `/checkout/sessions/${ib}/payment-method`, { cookie: a.u.cookie, body: { payment_method: 'vnpay' } });
    const r = await place(t, a.u, ib, body(480000, 2));
    expect(r.status).toBe(201);
    const orders = await ordersOf(t, a.u.id);
    expect(orders).toHaveLength(2);
    const second = orders.find((o) => o.id !== first.id)!; // đơn tạo trong cùng mili giây của đồng hồ giả nên không dựa vào thứ tự created_at
    const [h1, h2] = [(await holdsOf(t, first.id))[0], (await holdsOf(t, second.id))[0]];
    expect(h2.expires_at!.getTime() - h1.expires_at!.getTime()).toBeGreaterThan(3.5 * 60_000);
    expect(h2.expires_at!.getTime() - h1.expires_at!.getTime()).toBeLessThan(5 * 60_000);
    expect([h1.quantity, h2.quantity, await reservedOf(t, w.p1)]).toEqual([2, 3, 5]);
  });

  it('CHK-TC-20261006-110703163: CHK không nhận event: không subscriber nào của CHK cho StockReserved, StockReleased; event giả không đổi phiên completed, không phát event mới; POST /api/v1/events là 404', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const done = await place(t, s.u, id, body());
    const [o] = await ordersOf(t, s.u.id);
    const bus = t.app.get(EventsService);
    for (const type of ['StockReserved', 'StockReleased']) expect(bus.consumersFor(type).filter((c) => c.consumer === 'checkout')).toEqual([]);
    const outbox = (await outboxOf(t)).length;
    t.logs.clear();
    await deliver(t, 'StockReserved', { order_id: o.id, items: [], expires_at: null });
    await deliver(t, 'StockReleased', { order_id: o.id, items: [], reason: 'cancelled' });
    expect((await sessionRow(t, id)).status).toBe('completed');
    expect((await outboxOf(t)).filter((e) => e.type.startsWith('Checkout')).map((e) => e.type)).toEqual(['CheckoutCompleted']);
    expect(t.logs.records.filter((r) => r.module === 'checkout')).toEqual([]);
    expect((await call(t, 'post', '/events', { cookie: s.u.cookie, body: { type: 'StockReserved' } })).status).toBe(404);
    expect(done.status).toBe(201);
    expect(outbox).toBeGreaterThan(0);
  });
});

describe('CHK đặt hàng một giao dịch (CHK-REQ-20261006-105052272)', () => {
  it('CHK-TC-20261006-110703196: đặt đơn VNPay: 201 replayed false, Order pending (2 dòng, bản chụp địa chỉ, SM1, vnpay), hai reservation held, một lượt coupon reserved, phiên completed kèm order_id; OrderCreated và CheckoutCompleted trong outbox rồi relay: giỏ converted, PAY tạo một Payment pending; một IdempotencyKey, một AuditLog', async () => {
    const { s, id } = await full({ pay: 'vnpay' });
    const r = await place(t, s.u, id, body());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ replayed: false, order: { status: 'pending', grand_total: 345000, payment_method: 'vnpay' }, next: { action: 'pay', url: `/orders/${r.body.order.code}/payment` } });
    expect(typeof r.body.payment_deadline).toBe('string');
    const [o] = await ordersOf(t, s.u.id);
    expect(o).toMatchObject({ status: 'pending', payment_method: 'vnpay', shipping_method_id: w.sm1, code: r.body.order.code });
    expect(o.shipping_address).toEqual({ receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hà Nội' });
    expect(await orderItemsOf(t, o.id)).toHaveLength(2);
    expect((await holdsOf(t, o.id)).map((h) => h.status)).toEqual(['held', 'held']);
    expect(await redemptionsFor(t, 'SALE10')).toMatchObject([{ order_id: o.id, user_id: s.u.id, status: 'reserved', amount: '35000' }]);
    const row = await sessionRow(t, id);
    expect([row.status, row.order_id]).toEqual(['completed', o.id]);
    const [{ drift }] = await q<{ drift: number }>(t, `SELECT abs(extract(epoch FROM now() - completed_at))::float8 AS drift FROM checkout_sessions WHERE id = '${id}'`);
    expect(drift).toBeLessThan(30); // completed_at là lúc cam kết (giờ CSDL), không lệch
    const types = (await outboxOf(t)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['OrderCreated', 'CheckoutCompleted']));
    const cc = (await outboxOf(t, 'CheckoutCompleted'))[0];
    expect(cc.payload).toEqual({ checkout_id: id, cart_id: s.cart, order_id: o.id });
    expect((await outboxOf(t, 'OrderCreated'))[0].payload).toMatchObject({ order_code: o.code, user_id: s.u.id, payment_method: 'vnpay' });
    expect(cc.aggregate_type).toBe('CheckoutSession');
    await relayAll(t, 3);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('converted');
    expect(await q(t, `SELECT status::text AS status FROM payments WHERE order_id = '${o.id}'`)).toEqual([{ status: 'pending' }]);
    expect(await idemRows(t)).toHaveLength(1);
    expect(await auditsOf(t)).toHaveLength(1);
  });

  it('CHK-TC-20261006-110703231: đặt đơn COD: 201 confirmed, next done, không payment_deadline; lịch sử pending rồi confirmed trong một giao dịch; ba OutboxEvent OrderCreated, OrderConfirmed, CheckoutCompleted; sau relay INV chốt hàng (on_hand giảm), PRM consumed, SHP có vận đơn pending, PAY tạo Payment COD pending, giỏ converted', async () => {
    const { s, id } = await full({ pay: 'cod', coupon: null, lines: [{ product: w.p1, quantity: 1 }] }); // 150000 + 30000 = 180000
    const r = await place(t, s.u, id, body(180000));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ order: { status: 'confirmed', grand_total: 180000, payment_method: 'cod' }, next: { action: 'done', url: `/orders/${r.body.order.code}` } });
    expect(r.body).not.toHaveProperty('payment_deadline');
    const [o] = await ordersOf(t, s.u.id);
    expect(o.payment_expires_at).toBeNull();
    expect((await q<{ to_status: string }>(t, `SELECT to_status::text AS to_status FROM order_status_history WHERE order_id = '${o.id}' ORDER BY seq`)).map((h) => h.to_status)).toEqual(['pending', 'confirmed']);
    const ev = (await outboxOf(t)).map((e) => e.type);
    for (const type of ['OrderCreated', 'OrderConfirmed', 'CheckoutCompleted']) expect(ev.filter((x) => x === type)).toHaveLength(1);
    await relayAll(t, 6);
    expect((await holdsOf(t, o.id)).map((h) => h.status)).toEqual(['committed']);
    expect([await onHandOf(t, w.p1), await reservedOf(t, w.p1)]).toEqual([9, 0]);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM shipments WHERE order_id = '${o.id}'`))).toEqual([{ status: 'pending' }]);
    expect(await q(t, `SELECT status::text AS status, method::text AS method FROM payments WHERE order_id = '${o.id}'`)).toEqual([{ status: 'pending', method: 'cod' }]);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('converted');
  });

  it('CHK-TC-20261006-110703231 (coupon COD): lượt coupon reserved chuyển consumed khi PRM xử lý OrderConfirmed (K-10)', async () => {
    const { s, id } = await full({ pay: 'cod' });
    expect((await place(t, s.u, id, body())).status).toBe(201);
    await relayAll(t, 6);
    expect((await redemptionsFor(t, 'SALE10'))[0].status).toBe('consumed');
  });

  it('CHK-TC-20261006-110703267: hết hàng lúc đặt: 409 insufficient-stock; không Order, reservation, lượt coupon; phiên còn open; không CheckoutCompleted, AuditLog hay IdempotencyKey; giỏ vẫn active', async () => {
    const { s, id } = await full();
    const shown = (await view(t, s.u, id)).body;
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 0 WHERE product_id = ${w.p2}::uuid`;
    const before = await tally(t);
    const r = await place(t, s.u, id, body(shown.grand_total));
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:insufficient-stock']);
    expect(await tally(t)).toEqual(before);
    expect(await outboxOf(t, 'CheckoutCompleted')).toEqual([]);
    expect(await auditsOf(t)).toEqual([]);
    expect(await idemRows(t)).toEqual([]);
    expect((await sessionRow(t, id)).status).toBe('open');
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('active');
  });

  it('CHK-TC-20261006-110703301: email bị bỏ xác minh giữa chừng (phiên mở lúc đã xác minh): đặt hàng 403 email-not-verified; không Order, reservation, lượt coupon', async () => {
    const { s, id } = await full();
    await setEmailVerified(t, s.u.id, false);
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type, r.body.resend_endpoint]).toEqual([403, 'urn:ecom:error:email-not-verified', '/api/v1/auth/verify-email/resend']);
    expect(await tally(t)).toEqual(before);
  });

  it('CHK-TC-20261006-110703334: thiếu địa chỉ và thanh toán (có SM1): 409 checkout-incomplete với missing = [address, payment_method]; không Order', async () => {
    const u = await customer(t);
    await seedCart(t as never, u.id, { lines: [{ product: w.p1, quantity: 1 }], version: 3 });
    const id = (await create(t, u)).body.id;
    expect((await pickShipping(t, u, id, w.sm1)).status).toBe(200);
    const r = await place(t, u, id, body(180000, 3));
    expect([r.status, r.body.type, r.body.missing]).toEqual([409, 'urn:ecom:error:checkout-incomplete', ['address', 'payment_method']]);
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110703367: body có thêm items, grand_total, user_id, status, address, payment_method: 400 validation-failed nêu từng trường lạ; không Order, không dòng hàng giá 1', async () => {
    const { s, id } = await full();
    const r = await place(t, s.u, id, { ...body(), items: [{ product_id: w.p1, unit_price: 1, quantity: 1000 }], grand_total: 1, user_id: s.u.id, status: 'paid', address: { city: 'x' }, payment_method: 'cod' });
    expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']);
    expect(r.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['address', 'grand_total', 'items', 'payment_method', 'status', 'user_id']);
    expect(await countOf(t, 'orders')).toBe(0);
    expect(await countOf(t, 'order_items', 'unit_price = 1')).toBe(0);
  });

  it('CHK-TC-20261006-110703400: đặt hàng trên phiên của A: guest 401, staff 403, admin 403, customer B 404 (giống phản hồi cho uuid không tồn tại); không Order', async () => {
    const { s, id } = await full();
    const staff = await who(t, 'staff', 's@shop.vn'), admin = await who(t, 'admin', 'm@shop.vn'), b = await customer(t);
    const rs = [await place(t, undefined, id, body()), await place(t, staff, id, body()), await place(t, admin, id, body()), await place(t, b, id, body())];
    expect(rs.map((r) => r.status)).toEqual([401, 403, 403, 404]);
    const unknown = await place(t, s.u, '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c', body());
    expect(noTrace(rs[3].body)).toEqual(noTrace(unknown.body));
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110703453: yêu cầu từ Origin ngoài danh sách (CSRF): 403, không Order, reservation, lượt coupon, phiên còn open; cùng yêu cầu từ Origin hợp lệ được xử lý bình thường', async () => {
    const { s, id } = await full();
    const before = await tally(t);
    const r = await place(t, s.u, id, body(), { origin: 'https://evil.example' });
    expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).status).toBe('open');
    expect((await place(t, s.u, id, body())).status).toBe(201);
  });

  it('CHK-TC-20261006-110703521: bấm đặt hai lần song song cùng Idempotency-Key rồi lần ba bằng khóa khác: một 201, hai còn lại 200 replayed = true cùng order.code; đúng một Order, một bộ reservation (reserved tăng một lần), một lượt coupon, một AuditLog, một CheckoutCompleted', async () => {
    const { s, id } = await full({ pay: 'vnpay' });
    const [a, b] = await race(() => place(t, s.u, id, body(), { key: 'same-key-12345' }), () => place(t, s.u, id, body(), { key: 'same-key-12345' }));
    const c = await place(t, s.u, id, body(), { key: 'other-key-12345' });
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(c.status).toBe(200);
    const winner = a.status === 201 ? a : b;
    for (const r of [a, b, c]) expect(r.body.order.code).toBe(winner.body.order.code);
    expect([a, b, c].filter((r) => r.body.replayed === true)).toHaveLength(2);
    expect(c.body.payment_deadline).toBe(winner.body.payment_deadline); // phát lại từ phiên completed vẫn mang hạn của đơn
    expect([await countOf(t, 'orders'), await countOf(t, 'stock_reservations'), await countOf(t, 'coupon_redemptions'), await countOf(t, 'audit_logs', "action = 'checkout.place_order'")]).toEqual([1, 2, 1, 1]);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([2, 1]);
    expect(await outboxOf(t, 'CheckoutCompleted')).toHaveLength(1);
  });

  it('CHK-TC-20261006-110703556: hai phiên của cùng một giỏ (CheckoutCompleted chưa tới CRT): phiên thứ hai 409 cart-already-ordered; vẫn một Order cho giỏ và một phiên completed', async () => {
    const { s, id } = await full({ pay: 'cod' });
    expect((await place(t, s.u, id, body())).status).toBe(201);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('active');
    const [o2] = await q<{ id: string }>(t, `INSERT INTO checkout_sessions (user_id, cart_id, address_id, shipping_method_id, payment_method, address_snapshot, expires_at)
      VALUES ('${s.u.id}', '${s.cart}', '${s.a1}', '${w.sm1}', 'cod', (SELECT address_snapshot FROM checkout_sessions WHERE id = '${id}'), now() + interval '30 minutes') RETURNING id`);
    const before = await tally(t);
    const r = await place(t, s.u, o2.id, body());
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:cart-already-ordered']);
    expect(await tally(t)).toEqual(before);
    expect(await countOf(t, 'checkout_sessions', `cart_id = '${s.cart}' AND status = 'completed'`)).toBe(1);
    expect(await countOf(t, 'orders')).toBe(1);
  });

  it('CHK-TC-20261006-110703589: đã có 2 đơn VNPay pending: hai yêu cầu đặt VNPay song song khác khóa chỉ ra đúng một đơn mới (tổng 3, không vượt giới hạn); đã có 3 thì 409 too-many-open-orders (limit 3, current 3)', async () => {
    const { seedOrder } = await import('../support/ord');
    const { s, id } = await full({ pay: 'vnpay' });
    for (let i = 0; i < 2; i++) await seedOrder(t, { user: s.u.id, status: 'pending', method: 'vnpay' });
    const [a, b] = await race(() => place(t, s.u, id, body()), () => place(t, s.u, id, body()));
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await countOf(t, 'orders', `user_id = '${s.u.id}' AND payment_method = 'vnpay' AND status = 'pending'`)).toBe(3);
    const x = await full({ pay: 'vnpay', email: 'x@shop.vn' });
    for (let i = 0; i < 3; i++) await seedOrder(t, { user: x.s.u.id, status: 'pending', method: 'vnpay' });
    const r = await place(t, x.s.u, x.id, body());
    expect([r.status, r.body.type, r.body.kind, r.body.limit, r.body.current]).toEqual([409, 'urn:ecom:error:too-many-open-orders', 'vnpay', 3, 3]);
    expect(await countOf(t, 'orders', `user_id = '${x.s.u.id}' AND code IS NOT NULL`)).toBe(3);
  });

  it('CHK-TC-20261006-110703623: đặt lần thứ 6 trong một phút bị 429 rate-limited kèm Retry-After 1 đến 60; năm lần đầu được xử lý', async () => {
    const { s, id } = await full();
    alignWindow(t);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await place(t, s.u, id, body())).status);
    expect(codes).toEqual([201, 200, 200, 200, 200]);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(await countOf(t, 'orders')).toBe(1);
    expect(setCouponStatus).toBeDefined();
    expect(sessionsOf).toBeDefined();
    expect(placeShown).toBeDefined();
  });
});
