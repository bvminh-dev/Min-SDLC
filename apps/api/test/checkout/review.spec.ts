import { DomainError } from '../../src/modules/platform';
import { seedOrder } from '../support/ord';
import { itemsOf } from '../support/crt';
import {
  ageSession, alignWindow, applyCoupon, call, cancel, countOf, create, createChkApp, options, outboxOf, pickAddress, pickPayment, place, q, ready, resetChk, seedCoupon, seedMethod, sessionRow, sessionsOf, setEmailVerified, setMethodActive, shopper,
  reservedOf, tally, view, world, type ChkApp, type Seeded, type World,
} from '../support/chk';

// Ca bổ sung từ bảng đột biến của CHK (mẫu lọt của bảng đột biến theo SB: khe giữa các lời gọi, ma trận thao tác ghi, hồi quy hộp đen): module thật, gài vào khe bằng jest.spyOn rồi gọi hàm thật.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => { jest.restoreAllMocks(); t.chk.timeoutMs = t.config.get<number>('CHK_DEPENDENCY_TIMEOUT_MS'); });
const body = (n = 345000, v = 7) => ({ expected_grand_total: n, cart_version: v });
async function full(o: { pay?: 'cod' | 'vnpay'; email?: string; coupon?: string | null; lines?: { product: string; quantity?: number }[] } = {}): Promise<{ s: Seeded; id: string }> {
  const s = await shopper(t, w, { email: o.email, lines: o.lines });
  return { s, id: await ready(t, s, w, { pay: o.pay ?? 'cod', coupon: o.coupon === undefined ? 'SALE10' : o.coupon }) };
}
const checkoutEvents = async (type: string) => (await outboxOf(t)).filter((e) => e.type === type);
const ttlMs = async (id: string): Promise<number> => (await sessionRow(t, id)).ttl_ms;

describe('CHK đặt hàng: module phụ thuộc lỗi hay đổi ý trong khe (CHK-REQ-20261006-105052127 BR7)', () => {
  it('CHK-TC-20261006-110702243 (hồi quy: PRM quá hạn lúc ĐẶT): 503 dependency-unavailable, không đặt đơn không có số giảm (không coi là mã không còn dùng được); phiên open', async () => {
    const { s, id } = await full();
    t.chk.timeoutMs = 300;
    jest.spyOn(t.prm, 'evaluate').mockImplementation(() => new Promise((res) => setTimeout(() => res({ ok: false, reason: 'coupon_expired' }), 800)));
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:dependency-unavailable']);
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).status).toBe('open');
  });

  it('CHK-TC-20261006-110702243 (hồi quy: SHP quá hạn khi xem lại): shipping.error service_unavailable và can_place_order false, không số phí bịa', async () => {
    const { s, id } = await full();
    t.chk.timeoutMs = 300;
    jest.spyOn(t.shp, 'quote').mockImplementation(() => new Promise((res) => setTimeout(() => res({ fee: 1, free_shipping: false }), 800)));
    const r = (await view(t, s.u, id)).body;
    expect(r.shipping).toEqual({ method_id: w.sm1, error: 'service_unavailable' });
    expect([r.shipping_fee, r.can_place_order]).toEqual([null, false]);
  });

  it('CHK-TC-20261006-110701463 (hồi quy: quote ném method-unavailable giữa hai lời gọi): 409 shipping-method-unavailable, phiên bỏ lựa chọn, không đơn', async () => {
    const { s, id } = await full();
    jest.spyOn(t.shp, 'quote').mockImplementation(async () => { throw new DomainError('method-unavailable'); });
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:shipping-method-unavailable']);
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).shipping_method_id).toBeNull();
  });

  it('CHK-TC-20261006-110702996 (REV: amount của PRM khác số đã kiểm giá): 409 price-changed, hàng đã giữ được hoàn tác, không Order, không lượt coupon', async () => {
    const { s, id } = await full();
    const real = t.prm.reserve.bind(t.prm);
    jest.spyOn(t.prm, 'reserve').mockImplementation(async (...a) => { const r = await real(...a); return r.ok ? { ...r, amount: r.amount + 1 } : r; });
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type, r.body.previous_grand_total]).toEqual([409, 'urn:ecom:error:price-changed', 345000]);
    expect(await tally(t)).toEqual(before);
    expect([await countOf(t, 'stock_reservations'), await countOf(t, 'coupon_redemptions')]).toEqual([0, 0]);
  });

  it('CHK-TC-20261006-110702133 (hồi quy: giảm giá không vượt tạm tính): PRM trả mức giảm lớn hơn tạm tính thì discount bị chặn bằng tạm tính, tổng không âm (chỉ còn phí)', async () => {
    const { s, id } = await full();
    jest.spyOn(t.prm, 'evaluate').mockResolvedValue({ ok: true, coupon_id: 'c', code: 'SALE10', type: 'fixed', discount_amount: 999_999_999 });
    const v = (await view(t, s.u, id)).body;
    expect([v.discount, v.grand_total, v.shipping_fee]).toEqual([350000, 30000, 30000]);
  });
});

describe('CHK ma trận thao tác ghi lên phiên: gia hạn, hết hạn, đóng (CHK-REQ-20261006-105052414)', () => {
  it('CHK-TC-20261006-110703860 (hồi quy: thao tác ghi gia hạn phiên): mỗi thao tác ghi (chọn thanh toán, áp mã, gỡ mã, chọn địa chỉ) đặt lại hạn 30 phút và last_activity_at; xem lại và lấy phí không đổi hạn', async () => {
    const { s, id } = await full({ coupon: null });
    const writes: [string, () => Promise<{ status: number }>][] = [
      ['payment', () => pickPayment(t, s.u, id, 'vnpay')], ['coupon', () => applyCoupon(t, s.u, id, 'SALE10')], ['drop', () => call(t, 'delete', `/checkout/sessions/${id}/coupon`, { cookie: s.u.cookie })], ['address', () => pickAddress(t, s.u, id, s.a2)],
    ];
    for (const [name, f] of writes) {
      await ageSession(t, id, 25);
      expect(await ttlMs(id)).toBeLessThan(6 * 60_000);
      expect([name, (await f()).status < 300]).toEqual([name, true]);
      const ttl = await ttlMs(id);
      expect([name, ttl > 29 * 60_000 && ttl <= 30 * 60_000]).toEqual([name, true]);
    }
    await ageSession(t, id, 25);
    const before = await ttlMs(id);
    await view(t, s.u, id); await options(t, s.u, id);
    expect(Math.abs((await ttlMs(id)) - before)).toBeLessThan(2000); // đọc không gia hạn
    expect(((await sessionRow(t, id)).last_activity_at as Date).getTime()).toBeLessThan(Date.now() - 20 * 60_000);
  });

  it('CHK-TC-20261006-110703826 (ghi lên phiên quá hạn mà job chưa chạy): chọn địa chỉ 409 checkout-session-closed (expired), phiên chuyển expired trong yêu cầu đó kèm đúng một CheckoutExpired; không đổi địa chỉ', async () => {
    const { s, id } = await full();
    const before = await sessionRow(t, id);
    await ageSession(t, id, 31);
    const r = await pickAddress(t, s.u, id, s.a2);
    expect([r.status, r.body.type, r.body.session_status]).toEqual([409, 'urn:ecom:error:checkout-session-closed', 'expired']);
    const row = await sessionRow(t, id);
    expect([row.status, row.address_id]).toEqual(['expired', before.address_id]);
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
  });

  it('CHK-TC-20261006-110702421 (phiên gia hạn khi đặt hàng bị từ chối, CHK-REQ ...105052414 BR1): 409 price-changed vẫn là thao tác ghi: hạn về 30 phút; 400 sai schema thì KHÔNG gia hạn', async () => {
    const { s, id } = await full();
    await ageSession(t, id, 25);
    expect((await place(t, s.u, id, { expected_grand_total: 'x', cart_version: 7 })).status).toBe(400);
    expect(await ttlMs(id)).toBeLessThan(6 * 60_000);
    expect((await place(t, s.u, id, body(1))).status).toBe(409);
    const ttl = await ttlMs(id);
    expect(ttl > 29 * 60_000 && ttl <= 30 * 60_000).toBe(true);
  });

  it('CHK-TC-20261006-110703759 (ma trận: phiên completed và cancelled): mọi thao tác ghi bị 409 checkout-session-closed kèm session_status; xem lấy phí cũng 409', async () => {
    const a = await full(), b = await full({ email: 'b@shop.vn' });
    expect((await place(t, a.s.u, a.id, body())).status).toBe(201);
    expect((await cancel(t, b.s.u, b.id)).status).toBe(204);
    for (const [x, st] of [[a, 'completed'], [b, 'cancelled']] as const) {
      const rs = [await pickAddress(t, x.s.u, x.id, x.s.a2), await pickPayment(t, x.s.u, x.id, 'cod'), await applyCoupon(t, x.s.u, x.id, 'SALE10'), await call(t, 'delete', `/checkout/sessions/${x.id}/coupon`, { cookie: x.s.u.cookie }),
        await call(t, 'put', `/checkout/sessions/${x.id}/shipping-method`, { cookie: x.s.u.cookie, body: { method_id: w.sm1 } }), await options(t, x.s.u, x.id)];
      for (const r of rs) expect([r.status, r.body.type, r.body.session_status]).toEqual([409, 'urn:ecom:error:checkout-session-closed', st]);
    }
  });

  it('CHK-TC-20261006-110700937 (phiên open cũ đã quá hạn khi tạo phiên mới): phiên cũ expired kèm CheckoutExpired (không phải cancelled), phiên mới 201', async () => {
    const s = await shopper(t, w);
    const old = (await create(t, s.u)).body.id;
    await ageSession(t, old, 31);
    const r = await create(t, s.u);
    expect(r.status).toBe(201);
    expect((await sessionRow(t, old)).status).toBe('expired');
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
  });

  it('CHK-TC-20261006-110703657 (hủy phiên đã quá hạn mà job chưa chạy): 204 và phiên thành expired kèm CheckoutExpired, không phải cancelled', async () => {
    const { s, id } = await full();
    await ageSession(t, id, 31);
    expect((await cancel(t, s.u, id)).status).toBe(204);
    expect((await sessionRow(t, id)).status).toBe('expired');
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
  });

  it('CHK-TC-20261006-110700762 (điền sẵn được kiểm lại): phương thức vận chuyển của giỏ đã tắt thì phiên mới không điền sẵn; mã của giỏ vẫn chép sang', async () => {
    const s = await shopper(t, w, { coupon: 'SALE10', method: w.sm1 });
    await setMethodActive(t, w.sm1, false);
    const r = await create(t, s.u);
    expect([r.status, r.body.shipping_method_id, r.body.coupon_code]).toEqual([201, null, 'SALE10']);
    expect((await sessionsOf(t, s.u.id))[0].shipping_method_id).toBeNull();
  });
});

describe('CHK khe giữa kiểm sơ bộ và khóa dòng phiên (hồi quy: khóa dòng phiên, hết hạn trong khe)', () => {
  it('CHK-TC-20261006-110703521 (REV: thao tác chọn trong lúc đang đặt hàng): đặt hàng đang giữ khóa dòng phiên thì PUT chọn thanh toán chờ rồi bị 409 (phiên completed); phương thức trên phiên vẫn khớp đơn', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const real = t.chk.lockCart.bind(t.chk);
    jest.spyOn(t.chk, 'lockCart').mockImplementation(async (...a) => { await new Promise((r) => setTimeout(r, 600)); return real(...a); }); // giữ khóa phiên 600 ms giữa khóa phiên và khóa giỏ
    const placing = place(t, s.u, id, body()).then((r) => r); // .then gửi ngay (supertest gửi lười)
    await new Promise((r) => setTimeout(r, 250));
    const t0 = Date.now();
    const put = await pickPayment(t, s.u, id, 'vnpay');
    const waited = Date.now() - t0;
    expect((await placing).status).toBe(201);
    expect([put.status, put.body.type, put.body.session_status]).toEqual([409, 'urn:ecom:error:checkout-session-closed', 'completed']);
    expect(waited).toBeGreaterThan(200); // PUT phải chờ khóa dòng
    const [o] = await q<{ payment_method: string }>(t, `SELECT payment_method::text AS payment_method FROM orders WHERE user_id = '${s.u.id}'`);
    expect([(await sessionRow(t, id)).payment_method, o.payment_method]).toEqual(['cod', 'cod']);
  });

  it('CHK-TC-20261006-110703826 (REV: quá hạn đúng trong khe sau kiểm sơ bộ): phiên hết hạn giữa lúc kiểm sơ bộ và lúc khóa dòng: 409 closed (expired), phiên chuyển expired kèm đúng một CheckoutExpired, địa chỉ không đổi', async () => {
    const { s, id } = await full();
    const before = await sessionRow(t, id);
    const real = t.chk.getAddress.bind(t.chk);
    jest.spyOn(t.chk, 'getAddress').mockImplementation(async (...a) => { const r = await real(...a); await ageSession(t, id, 31); return r; });
    const r = await pickAddress(t, s.u, id, s.a2);
    expect([r.status, r.body.session_status]).toEqual([409, 'expired']);
    const row = await sessionRow(t, id);
    expect([row.status, row.address_id]).toEqual(['expired', before.address_id]);
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
  });
});

describe('CHK xem lại: điều cản trở và đầu vào (CHK-REQ-20261006-105051681 BR5; SB-11)', () => {
  it('CHK-TC-20261006-110703301 (blocker email_not_verified): tài khoản bị bỏ xác minh giữa chừng thấy blocker email_not_verified và can_place_order false', async () => {
    const { s, id } = await full();
    expect((await view(t, s.u, id)).body.blockers).not.toContain('email_not_verified');
    await setEmailVerified(t, s.u.id, false);
    const v = (await view(t, s.u, id)).body;
    expect([v.blockers, v.can_place_order]).toEqual([['email_not_verified'], false]);
  });

  it('CHK-TC-20261006-110702349 (blockers theo tiền và đơn mở): VNPay với tổng 4999 có amount_out_of_range_online; tổng 5000 không; đơn 0 đồng có zero_total; đủ 3 đơn VNPay mở có too_many_open_orders', async () => {
    const free = await seedMethod(t, { name: 'Miễn phí R', fee: 30000, freeOver: 1 });
    const { sku } = await import('../support/crt');
    const mk = async (price: number, email: string) => {
      const p = await sku(t as never, price, 5);
      const s = await shopper(t, w, { email, lines: [{ product: p, quantity: 1 }] });
      const id = await ready(t, s, w, { pay: 'cod', method: free, coupon: null });
      await t.prisma.$executeRaw`UPDATE checkout_sessions SET payment_method = 'vnpay'::checkout_payment_method WHERE id = ${id}::uuid`;
      return { s, id };
    };
    const a = await mk(4999, 'a@shop.vn'), b = await mk(5000, 'b@shop.vn');
    expect((await view(t, a.s.u, a.id)).body.blockers).toContain('amount_out_of_range_online');
    expect((await view(t, b.s.u, b.id)).body.blockers).not.toContain('amount_out_of_range_online');
    const z = await mk(5000, 'z@shop.vn');
    await seedCoupon(t, { code: 'ALL5K', type: 'fixed', value: 5000 });
    await t.prisma.$executeRaw`UPDATE checkout_sessions SET coupon_code = 'ALL5K' WHERE id = ${z.id}::uuid`;
    expect((await view(t, z.s.u, z.id)).body).toMatchObject({ grand_total: 0, blockers: expect.arrayContaining(['zero_total']) });
    for (let i = 0; i < 3; i++) await seedOrder(t, { user: b.s.u.id, status: 'pending', method: 'vnpay' });
    expect((await view(t, b.s.u, b.id)).body.blockers).toContain('too_many_open_orders');
  });

  it('CHK-TC-20261006-110701017 (__proto__ và id quá dài): body có khóa __proto__ bị 400 unknown_field; address_id 101 ký tự bị 400 too_long; id phiên rất dài là 404 giống hệt', async () => {
    const { s, id } = await full({ coupon: null });
    const proto = await call(t, 'put', `/checkout/sessions/${id}/coupon`, { cookie: s.u.cookie, body: '{"__proto__":{"admin":true},"code":"SALE10"}' });
    expect([proto.status, proto.body.errors.map((e: { field: string }) => e.field)]).toEqual([400, ['__proto__']]);
    const long = await pickAddress(t, s.u, id, 'a'.repeat(101));
    expect([long.status, long.body.errors]).toEqual([400, [{ field: 'address_id', code: 'too_long' }]]);
    const empty = await pickAddress(t, s.u, id, '');
    expect([empty.status, empty.body.errors]).toEqual([400, [{ field: 'address_id', code: 'required' }]]);
    expect((await view(t, s.u, 'z'.repeat(3000))).status).toBe(404);
  });

  it('CHK-TC-20261006-110701888 (độ dài mã): mã 50 ký tự (kể cả emoji) đi tới PRM (404 coupon-not-found), 51 ký tự bị 400 too_long, mã chỉ khoảng trắng bị 400 required', async () => {
    const { s, id } = await full({ coupon: null });
    expect((await applyCoupon(t, s.u, id, 'A'.repeat(50))).status).toBe(404);
    t.clock.advance(61_000);
    expect((await applyCoupon(t, s.u, id, '😀'.repeat(50))).status).toBe(404);
    const [a, b] = [await applyCoupon(t, s.u, id, 'A'.repeat(51)), await applyCoupon(t, s.u, id, '   ')];
    expect([a.status, a.body.errors[0].code, b.status, b.body.errors[0].code]).toEqual([400, 'too_long', 400, 'required']);
  });

  it('CHK-TC-20261006-110701922 (giới hạn 10 lần mỗi phút của CHK, bậc A): mười lần áp mã hợp lệ được, lần 11 trong cùng phút là 429 rate-limited kèm Retry-After', async () => {
    const { s, id } = await full({ coupon: null });
    alignWindow(t);
    for (let i = 0; i < 10; i++) expect((await applyCoupon(t, s.u, id, 'SALE10')).status).toBe(200);
    const r = await applyCoupon(t, s.u, id, 'SALE10');
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('CHK-TC-20261006-110702727 (vòng đời giỏ): hai dòng cùng hàng ngừng bán chỉ báo mỗi sản phẩm một lần trong issues', async () => {
    const { s, id } = await full({ lines: [{ product: w.p1, quantity: 1 }, { product: w.p2, quantity: 2 }], coupon: null });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived'::product_status WHERE id IN (${w.p1}::uuid, ${w.p2}::uuid)`;
    const r = await place(t, s.u, id, body(180000));
    expect(r.body.type).toBe('urn:ecom:error:cart-has-unavailable-items');
    expect(r.body.issues.map((i: { product_id: string }) => i.product_id).sort()).toEqual([w.p1, w.p2].sort());
    expect((await itemsOf(t, s.cart))).toHaveLength(2);
  });
});

describe('CHK tải hỗn hợp kiểm bảo toàn (CHK-SEC-20261006-105800857 T6, T7, T14; SB-25)', () => {
  it('CHK-TC-20261006-110702827 (tải hỗn hợp: bảo toàn): 14 khách đặt song song hàng và coupon có hạn mức (số lượng 1 đến 3, nửa dùng mã còn 4 lượt, nửa COD nửa VNPay): không bán lố, reserved = tổng reservation held = tổng số lượng của đơn thành công, mỗi lượt coupon gắn đúng một đơn, người thua không có đơn dở', async () => {
    await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 17 WHERE product_id = ${w.p1}::uuid`;
    await seedCoupon(t, { code: 'LIMIT4', type: 'percentage', value: 10, usageLimit: 4 });
    const users: { s: Seeded; id: string; qty: number; coupon: boolean; total: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const qty = (i % 3) + 1, coupon = i % 2 === 0;
      const s = await shopper(t, w, { email: `mix${i}@shop.vn`, lines: [{ product: w.p1, quantity: qty }] });
      const id = await ready(t, s, w, { pay: i % 4 < 2 ? 'cod' : 'vnpay', coupon: coupon ? 'LIMIT4' : null });
      users.push({ s, id, qty, coupon, total: ((await view(t, s.u, id)).body as { grand_total: number }).grand_total });
    }
    const rs = await Promise.all(users.map(async (u, i) => { await new Promise((r) => setTimeout(r, (i * 7) % 25)); return place(t, u.s.u, u.id, body(u.total)); }));
    const ok = users.filter((_, i) => rs[i].status === 201), lost = users.filter((_, i) => rs[i].status !== 201);
    for (let i = 0; i < rs.length; i++) if (rs[i].status !== 201) expect([rs[i].body.type]).toEqual([expect.stringMatching(/insufficient-stock|coupon-invalid/)]);
    expect(rs.filter((r) => r.status === 201).length + rs.filter((r) => r.status === 409).length).toBe(14);
    const sold = ok.reduce((n, u) => n + u.qty, 0);
    expect(sold).toBeLessThanOrEqual(17); // không bán lố
    expect(await reservedOf(t, w.p1)).toBe(sold);
    expect((await q<{ n: number }>(t, `SELECT coalesce(sum(r.quantity), 0)::int AS n FROM stock_reservations r JOIN stock_items s ON s.id = r.stock_item_id WHERE s.product_id = '${w.p1}' AND r.status = 'held'`))[0].n).toBe(sold);
    expect((await q<{ n: number }>(t, `SELECT coalesce(sum(quantity), 0)::int AS n FROM order_items WHERE product_id = '${w.p1}'`))[0].n).toBe(sold);
    expect(await countOf(t, 'orders')).toBe(ok.length);
    for (const u of lost) expect(await countOf(t, 'orders', `user_id = '${u.s.u.id}'`)).toBe(0);
    const withCoupon = ok.filter((u) => u.coupon).length;
    expect(withCoupon).toBeLessThanOrEqual(4);
    expect(await countOf(t, 'coupon_redemptions', "status = 'reserved'")).toBe(withCoupon);
    expect((await q<{ n: number }>(t, "SELECT reserved_count AS n FROM coupons WHERE code = 'LIMIT4'"))[0].n).toBe(withCoupon);
    expect(await countOf(t, 'checkout_sessions', "status = 'completed'")).toBe(ok.length);
    expect(await countOf(t, 'outbox_events', "type = 'CheckoutCompleted'")).toBe(ok.length);
    expect(await countOf(t, 'audit_logs', "action = 'checkout.place_order'")).toBe(ok.length);
    for (const u of lost) expect((await sessionRow(t, u.id)).status).toBe('open'); // thua thì phiên còn open, giỏ nguyên
  }, 120_000);
});

describe('CHK hold-and-wait: pool nhỏ (CHK-SEC-20261006-105800857 T18, SB-31, ADR-012)', () => {
  it('CHK-SEC-20261006-105800857 T18 (pool): với DB_POOL_MAX = 2, sáu khách đặt hàng đồng thời đều xong (201): mỗi giao dịch giữ một kết nối rồi gọi CRT bằng kết nối thứ hai, bộ chặn giữ lại tối đa ⌊pool/2⌋ giao dịch để không cạn pool', async () => {
    const p = await createChkApp({ env: { DB_POOL_MAX: '2' } });
    try {
      await resetChk(p);
      const wp = await world(p, { p1Stock: 50, p2Stock: 50 });
      await seedCoupon(p, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 });
      const users: { s: Seeded; id: string }[] = [];
      for (let i = 0; i < 6; i++) { const s = await shopper(p, wp, { email: `pool${i}@shop.vn` }); users.push({ s, id: await ready(p, s, wp, { pay: 'cod', coupon: null }) }); }
      const rs = await Promise.all(users.map((u) => place(p, u.s.u, u.id, body(380000))));
      expect(rs.map((r) => [r.status, r.body.type])).toEqual(rs.map(() => [201, undefined]));
      expect(await countOf(p, 'orders')).toBe(6);
    } finally { await p.close(); }
    expect(q).toBeDefined();
  }, 120_000);
});
