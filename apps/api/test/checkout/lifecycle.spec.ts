import {
  ageDays, ageSession, cancel, countOf, relayAll, create, createChkApp, customer, noTrace, outboxOf, pickAddress, applyCoupon, place, placeShown, q, ready, resetChk, seedCart, seedCoupon, sessionRow, sessionsOf, shopper, tally, view, who, world,
  type ChkApp, type World,
} from '../support/chk';
import { itemsOf } from '../support/crt';

// REQ ...105052414 (hủy và hết hạn phiên): job hết hạn (`expireOnce` với mốc giờ CSDL giả `now`), job xóa bản chụp, hủy do khách, đóng do giỏ không còn hiện hành.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => jest.restoreAllMocks());
const checkoutEvents = async (type?: string) => (await outboxOf(t)).filter((e) => (type ? e.type === type : e.type.startsWith('Checkout')));

describe('CHK hủy và hết hạn phiên (CHK-REQ-20261006-105052414)', () => {
  it('CHK-TC-20261006-110703657: khách rời checkout: 204, phiên cancelled, giỏ vẫn active với version 7 và mọi dòng nguyên vẹn, không reservation, lượt coupon, Order hay event', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    const items = await itemsOf(t, s.cart);
    expect((await cancel(t, s.u, id)).status).toBe(204);
    expect((await sessionRow(t, id)).status).toBe('cancelled');
    expect((await q<{ status: string; version: number }>(t, `SELECT status::text AS status, version FROM carts WHERE id = '${s.cart}'`))[0]).toEqual({ status: 'active', version: 7 });
    expect(await itemsOf(t, s.cart)).toEqual(items);
    expect([await countOf(t, 'orders'), await countOf(t, 'stock_reservations'), await countOf(t, 'coupon_redemptions')]).toEqual([0, 0, 0]);
    expect(await checkoutEvents()).toEqual([]);
    expect((await cancel(t, s.u, id)).status).toBe(204); // idempotent
  });

  it('CHK-TC-20261006-110703691: job hết hạn: phiên tạo 10:00, ghi cuối 10:05 (hết hạn 10:35), đồng hồ CSDL 10:36: chuyển expired, đúng một CheckoutExpired (checkout_id, user_id, cart_id, không order_id) cùng phong bì, lần chạy hai không ghi thêm, giỏ vẫn active; hai lượt chạy đồng thời mỗi phiên chỉ một event', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    await ageSession(t, id, 25); // tạo cách đây 25 phút, ghi cuối cách đây 25 phút: hết hạn sau 5 phút nữa
    const [{ now }] = await q<{ now: Date }>(t, 'SELECT now() AS now');
    const at = new Date(now.getTime() + 6 * 60_000); // giờ CSDL giả: quá hạn 1 phút
    expect(await t.chkJobs.expireOnce({ now: new Date(now.getTime() + 60_000) })).toMatchObject({ sessions: 0 }); // chưa tới hạn
    expect(await t.chkJobs.expireOnce({ now: at })).toMatchObject({ sessions: 1 });
    expect((await sessionRow(t, id)).status).toBe('expired');
    const ev = await checkoutEvents('CheckoutExpired');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'CheckoutSession', aggregate_id: id, payload: { checkout_id: id, user_id: s.u.id, cart_id: s.cart } });
    expect(ev[0].payload).not.toHaveProperty('order_id');
    expect(ev[0].correlation_id).toBeTruthy();
    expect(ev[0].occurred_at).toBeInstanceOf(Date);
    expect(await t.chkJobs.expireOnce({ now: at })).toMatchObject({ sessions: 0 });
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
    await relayAll(t, 1); // không consumer nào: relay vẫn đánh dấu đã phát, không lỗi, không đổi giỏ
    expect((await checkoutEvents('CheckoutExpired'))[0].dispatched_at).not.toBeNull();
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('active');
    expect([await countOf(t, 'stock_reservations'), await countOf(t, 'coupon_redemptions')]).toEqual([0, 0]);
    // hai lượt đồng thời, nhiều phiên
    for (let i = 0; i < 6; i++) { const x = await shopper(t, w, { email: `job${i}@shop.vn` }); const sid = await ready(t, x, w, { pay: null, method: null }); await ageSession(t, sid, 40); }
    const [a, b] = await Promise.all([t.chkJobs.expireOnce({ batch: 2 }), t.chkJobs.expireOnce({ batch: 2 })]);
    expect(a.sessions + b.sessions).toBe(6);
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(7);
    expect(new Set((await checkoutEvents('CheckoutExpired')).map((e) => e.aggregate_id)).size).toBe(7);
  });

  it('CHK-TC-20261006-110703725: hủy phiên đã completed: 409 checkout-session-completed kèm order_code; Order không đổi trạng thái', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    const done = await placeShown(t, s, id);
    const r = await cancel(t, s.u, id);
    expect([r.status, r.body.type, r.body.order_code]).toEqual([409, 'urn:ecom:error:checkout-session-completed', done.body.order.code]);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM orders WHERE code = '${done.body.order.code}'`))[0].status).toBe('confirmed');
  });

  it('CHK-TC-20261006-110703759: thao tác ghi (địa chỉ, mã, đặt hàng) lên phiên đã expired bị 409 checkout-session-closed (status expired), không Order; tạo phiên mới thì 201', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    await ageSession(t, id, 31);
    await t.chkJobs.expireOnce();
    const before = await tally(t);
    const rs = [await pickAddress(t, s.u, id, s.a2), await applyCoupon(t, s.u, id, 'SALE10'), await place(t, s.u, id, { expected_grand_total: 380000, cart_version: 7 })];
    for (const r of rs) { expect(r.status).toBe(409); expect(r.body).toMatchObject({ type: 'urn:ecom:error:checkout-session-closed', session_status: 'expired' }); }
    expect(await tally(t)).toEqual(before);
    expect((await create(t, s.u)).status).toBe(201);
  });

  it('CHK-TC-20261006-110703793: hủy phiên của người khác, uuid không có, "abc" cùng một 404 checkout-session-not-found giống hệt; phiên của A vẫn open', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    const b = await customer(t);
    const rs = [await cancel(t, b, id), await cancel(t, s.u, '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c'), await cancel(t, s.u, 'abc')];
    for (const r of rs) { expect(r.status).toBe(404); expect(r.body.type).toBe('urn:ecom:error:checkout-session-not-found'); }
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[1].body));
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[2].body));
    expect((await sessionRow(t, id)).status).toBe('open');
  });

  it('CHK-TC-20261006-110703826: quá expires_at nhưng job chưa chạy: đặt hàng 409 checkout-session-closed (expired) ngay, không Order; phiên chuyển expired trong chính yêu cầu đó kèm đúng một CheckoutExpired; job chạy sau đó không ghi thêm', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    await ageSession(t, id, 31);
    const before = await tally(t);
    const r = await place(t, s.u, id, { expected_grand_total: 380000, cart_version: 7 });
    expect([r.status, r.body.type, r.body.session_status]).toEqual([409, 'urn:ecom:error:checkout-session-closed', 'expired']);
    expect((await tally(t)).slice(0, 4)).toEqual(before.slice(0, 4));
    expect((await sessionRow(t, id)).status).toBe('expired');
    const ev = await checkoutEvents('CheckoutExpired');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ checkout_id: id, user_id: s.u.id, cart_id: s.cart });
    await t.chkJobs.expireOnce();
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
  });

  it('CHK-TC-20261006-110703860: chỉ xem lại liên tục không kéo dài phiên: expires_at giữ nguyên qua các lần GET; khi quá hạn GET trả 200 status expired', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    const first = (await sessionRow(t, id)).expires_at.getTime();
    for (let i = 0; i < 4; i++) expect((await view(t, s.u, id)).status).toBe(200);
    const row = await sessionRow(t, id);
    expect(row.expires_at.getTime()).toBe(first);
    await ageSession(t, id, 31);
    const r = await view(t, s.u, id);
    expect([r.status, r.body]).toEqual([200, { id, status: 'expired' }]);
    expect((await sessionRow(t, id)).status).toBe('expired');
    expect(await checkoutEvents('CheckoutExpired')).toHaveLength(1);
  });

  it('CHK-TC-20261006-110703893: giỏ hiện hành đã khác giỏ của phiên (giỏ cũ converted): xem lại và đặt hàng đều 409 checkout-session-closed (cancelled), phiên cancelled, không event', async () => {
    for (const via of ['view', 'place'] as const) {
      const s = await shopper(t, w, { email: `${via}@shop.vn` });
      const id = await ready(t, s, w, { pay: 'cod' });
      await t.prisma.$executeRaw`UPDATE carts SET status = 'converted'::cart_status, converted_order_id = gen_random_uuid() WHERE id = ${s.cart}::uuid`;
      await seedCart(t as never, s.u.id, { lines: [{ product: w.p1, quantity: 1 }] });
      const r = via === 'view' ? await view(t, s.u, id) : await place(t, s.u, id, { expected_grand_total: 380000, cart_version: 7 });
      expect([r.status, r.body.type, r.body.session_status]).toEqual([409, 'urn:ecom:error:checkout-session-closed', 'cancelled']);
      expect((await sessionRow(t, id)).status).toBe('cancelled');
    }
    expect(await checkoutEvents()).toEqual([]);
    expect(await countOf(t, 'orders')).toBe(0);
  });

  it('CHK-TC-20261006-110703926: job xóa bản chụp địa chỉ: phiên đóng 31 ngày bị đặt null (order_id, status, thời điểm còn), phiên đóng 29 ngày và phiên open giữ nguyên', async () => {
    const mk = async (email: string, close: 'cancelled' | 'open') => {
      const s = await shopper(t, w, { email });
      const id = await ready(t, s, w, { pay: null, method: null });
      if (close === 'cancelled') await cancel(t, s.u, id);
      return id;
    };
    const [old, recent, open] = [await mk('old@shop.vn', 'cancelled'), await mk('recent@shop.vn', 'cancelled'), await mk('open@shop.vn', 'open')];
    await ageDays(t, old, 31); await ageDays(t, recent, 29); await ageDays(t, open, 40);
    const before = await sessionRow(t, old);
    expect(await t.chkJobs.purgeOnce()).toMatchObject({ sessions: 1 });
    const after = await sessionRow(t, old);
    expect(after.address_snapshot).toBeNull();
    expect([after.status, after.order_id, after.updated_at.getTime(), after.created_at]).toEqual([before.status, before.order_id, before.updated_at.getTime(), undefined]);
    expect((await sessionRow(t, recent)).address_snapshot).toMatchObject({ city: 'Hà Nội' });
    expect((await sessionRow(t, open)).address_snapshot).toMatchObject({ city: 'Hà Nội' });
    expect(await t.chkJobs.purgeOnce()).toMatchObject({ sessions: 0 }); // idempotent
    expect(sessionsOf).toBeDefined();
    expect(who).toBeDefined();
  });
});
