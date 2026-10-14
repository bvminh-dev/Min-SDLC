import { alignWindow, call, create, createChkApp, customer, noTrace, outboxOf, resetChk, countOf, q, sessionsOf, setEmailVerified, shopper, view, who, world, type ChkApp, type World } from '../support/chk';
import { itemsOf } from '../support/crt';

// REQ ...105050948 (tạo phiên checkout từ giỏ): AppModule thật, PostgreSQL thật; CRT, USR, PRM, SHP, INV, ORD chạy thật (không bản giả), số lời gọi đếm bằng jest.spyOn trên các lớp `*Api`.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); });
afterEach(() => jest.restoreAllMocks());

const dbMs = async (): Promise<number> => (await q<{ ms: number }>(t, 'SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms'))[0].ms;

describe('CHK tạo phiên checkout (CHK-REQ-20261006-105050948)', () => {
  it('CHK-TC-20261006-110700762: giỏ có hàng, mã, vận chuyển, địa chỉ mặc định: 201, phiên open điền sẵn, hạn = giờ CSDL + 30 phút, không giữ hàng, không Order, không lượt coupon', async () => {
    await t.prisma.$executeRaw`SELECT 1`;
    const s = await shopper(t, w, { coupon: 'SALE10', method: w.sm1 });
    const reservedBefore = await q(t, 'SELECT reserved FROM stock_items ORDER BY product_id');
    const t0 = await dbMs();
    const r = await create(t, s.u);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'open', address: { address_id: s.a1, changed: false }, shipping_method_id: w.sm1, payment_method: null, coupon_code: 'SALE10' });
    expect(Math.abs(new Date(r.body.expires_at).getTime() - (t0 + 30 * 60_000))).toBeLessThan(5000);
    const rows = await sessionsOf(t, s.u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', cart_id: s.cart, address_id: s.a1, shipping_method_id: w.sm1, coupon_code: 'SALE10', payment_method: null, order_id: null });
    expect(rows[0].address_snapshot).toMatchObject({ receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hà Nội' });
    expect(await q(t, 'SELECT reserved FROM stock_items ORDER BY product_id')).toEqual(reservedBefore);
    expect([await countOf(t, 'orders'), await countOf(t, 'stock_reservations'), await countOf(t, 'coupon_redemptions')]).toEqual([0, 0, 0]);
    expect(JSON.stringify(r.body)).not.toMatch(/user_id|cart_id|price_snapshot|address_snapshot|0901111111/);
  });

  it('CHK-TC-20261006-110700801: mở lần hai (hai lần liên tiếp rồi hai lần song song) trả lại đúng phiên cũ (200), expires_at không nhỏ hơn, đúng một phiên open, không lỗi 500', async () => {
    const s = await shopper(t, w);
    const first = await create(t, s.u);
    expect(first.status).toBe(201);
    const again = [await create(t, s.u), await create(t, s.u)];
    const par = await Promise.all([create(t, s.u), create(t, s.u)]);
    for (const r of [...again, ...par]) { expect(r.status).toBe(200); expect(r.body.id).toBe(first.body.id); expect(new Date(r.body.expires_at).getTime()).toBeGreaterThanOrEqual(new Date(first.body.expires_at).getTime()); }
    expect(await countOf(t, 'checkout_sessions', `user_id = '${s.u.id}' AND status = 'open'`)).toBe(1);
    expect(await countOf(t, 'checkout_sessions')).toBe(1);
  });

  it('CHK-TC-20261006-110700801 (đua tạo phiên đầu tiên): hai yêu cầu đầu tiên cùng lúc chỉ ra một phiên (khóa tư vấn cộng unique một phần), một 201 một 200', async () => {
    const s = await shopper(t, w);
    const rs = await Promise.all([create(t, s.u), create(t, s.u), create(t, s.u)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await countOf(t, 'checkout_sessions')).toBe(1);
  });

  it('CHK-TC-20261006-110700835: tài khoản chưa xác minh email bị 403 email-not-verified kèm resend_endpoint, không có phiên, version giỏ không đổi; xác minh xong thì 201', async () => {
    const u = await who(t, 'customer', 'chua@shop.vn');
    await setEmailVerified(t, u.id, false);
    const s = await shopper(t, w, { email: 'b@shop.vn' });
    await setEmailVerified(t, s.u.id, false);
    const before = (await q(t, `SELECT version FROM carts WHERE id = '${s.cart}'`))[0];
    const r = await create(t, s.u);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:email-not-verified', status: 403, resend_endpoint: '/api/v1/auth/verify-email/resend' });
    expect(Object.keys(r.body).sort()).toEqual(['resend_endpoint', 'status', 'title', 'trace_id', 'type']);
    expect(await countOf(t, 'checkout_sessions')).toBe(0);
    expect((await q(t, `SELECT version FROM carts WHERE id = '${s.cart}'`))[0]).toEqual(before);
    await setEmailVerified(t, s.u.id, true);
    expect((await create(t, s.u)).status).toBe(201);
  });

  it('CHK-TC-20261006-110700870: giỏ trống 409 cart-empty; giỏ có hàng ngừng bán 409 cart-has-unavailable-items kèm issues; không tạo phiên; xóa dòng ngừng bán thì 201', async () => {
    const u = await customer(t);
    const empty = await create(t, u);
    expect(empty.status).toBe(409);
    expect(empty.body.type).toBe('urn:ecom:error:cart-empty');
    const s = await shopper(t, w, { lines: [{ product: w.p1, quantity: 1 }, { product: w.p2, quantity: 1 }] });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived'::product_status WHERE id = ${w.p2}::uuid`;
    const bad = await create(t, s.u);
    expect(bad.status).toBe(409);
    expect(bad.body).toMatchObject({ type: 'urn:ecom:error:cart-has-unavailable-items', issues: [{ product_id: w.p2, reason: 'unavailable' }] });
    expect(await countOf(t, 'checkout_sessions')).toBe(0);
    const [, p2item] = await itemsOf(t, s.cart);
    await call(t, 'delete', `/cart/items/${p2item.id}`, { cookie: s.u.cookie });
    expect((await create(t, s.u)).status).toBe(201);
  });

  it('CHK-TC-20261006-110700904: guest 401, staff 403, admin 403 (cùng nội dung), không có dòng checkout_sessions', async () => {
    const staff = await who(t, 'staff', 's@shop.vn'), admin = await who(t, 'admin', 'm@shop.vn');
    const g = await create(t, undefined), s = await create(t, staff), m = await create(t, admin);
    expect([g.status, s.status, m.status]).toEqual([401, 403, 403]);
    expect(noTrace(s.body)).toEqual(noTrace(m.body));
    expect(await countOf(t, 'checkout_sessions')).toBe(0);
  });

  it('CHK-TC-20261006-110700937: phiên cũ gắn giỏ không còn hiện hành bị cancelled khi tạo phiên mới gắn giỏ mới; không event; đúng một phiên open', async () => {
    const s = await shopper(t, w);
    const old = await create(t, s.u);
    await t.prisma.$executeRaw`UPDATE carts SET status = 'abandoned'::cart_status WHERE id = ${s.cart}::uuid`;
    const { seedCart } = await import('../support/crt');
    const g2 = await seedCart(t as never, s.u.id, { lines: [{ product: w.p1, quantity: 1 }] });
    const r = await create(t, s.u);
    expect(r.status).toBe(201);
    expect(r.body.id).not.toBe(old.body.id);
    const rows = await sessionsOf(t, s.u.id);
    expect(rows.map((x) => x.status)).toEqual(['cancelled', 'open']);
    expect(rows[1].cart_id).toBe(g2.cart);
    expect((await outboxOf(t)).filter((e) => e.type.startsWith('Checkout'))).toEqual([]);
  });

  it('CHK-TC-20261006-110700980: 10 lần tạo phiên mỗi phút, lần 11 là 429 rate-limited kèm Retry-After 1 đến 60; tiến đồng hồ 61 giây thì được lại; người dùng khác trong cùng phút vẫn được', async () => {
    const s = await shopper(t, w);
    const b = await shopper(t, w, { email: 'b2@shop.vn' });
    alignWindow(t);
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await create(t, s.u)).status);
    expect(codes[0]).toBe(201);
    expect(codes.slice(1).every((c) => c === 200)).toBe(true);
    const r = await create(t, s.u);
    expect(r.status).toBe(429);
    expect(r.body.type).toBe('urn:ecom:error:rate-limited');
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await create(t, b.u)).status).toBe(201);
    t.clock.advance(61_000);
    expect((await create(t, s.u)).status).toBe(200);
  });

  it('CHK-TC-20261006-110701017: body có grand_total, unit_price, cart_id hay user_id bị 400 validation-failed nêu đúng tên trường lạ; không có phiên', async () => {
    const s = await shopper(t, w);
    const other = await shopper(t, w, { email: 'b3@shop.vn' });
    for (const [field, value] of [['grand_total', 1], ['unit_price', 1], ['cart_id', other.cart], ['user_id', other.u.id]] as const) {
      const r = await create(t, s.u, { [field]: value });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ type: 'urn:ecom:error:validation-failed' });
      expect(r.body.errors.map((e: { field: string }) => e.field)).toEqual([field]);
    }
    expect(await countOf(t, 'checkout_sessions')).toBe(0);
    expect((await view(t, s.u, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});
