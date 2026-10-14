import { sku, type CrtApp } from '../support/crt';
import {
  ageDays, ageSession, alignWindow, cancel, countOf, outboxOf, sessionRow, create, createChkApp, dropCoupon, ordersOf, pickAddress, place, placeShown, q, ready, resetChk, seedCoupon, sessionsOf, setPrice, shopper, tally, view, world,
  type ChkApp, type World,
} from '../support/chk';

// Đồng bộ spec với mã đã review (sdlc-impact 2026-10-13): `district` là khóa thứ sáu của shipping_address, 429 ở xem lại và hai DELETE, 409 `cart-limit-exceeded` của CRT đi qua CHK.
// CRT, USR, PRM, INV, SHP, ORD, PAY chạy thật trên PostgreSQL thật.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => jest.restoreAllMocks());

const SIX = ['city', 'district', 'line1', 'phone', 'receiver', 'ward'];

describe('CHK: district trên đơn (CHK-REQ-20261006-105052272 BR1)', () => {
  it('CHK-TC-20261013-210240854: đơn lưu district làm khóa thứ sáu của shipping_address; địa chỉ không có quận, huyện lưu district null (khóa vẫn có)', async () => {
    const a = await shopper(t, w);
    const ida = await ready(t, a, w, { pay: 'cod', coupon: null });
    const ra = await placeShown(t, a, ida);
    expect(ra.status).toBe(201);
    const [oa] = await ordersOf(t, a.u.id);
    expect(Object.keys(oa.shipping_address).sort()).toEqual(SIX);
    expect(oa.shipping_address).toMatchObject({ district: 'Quận 1', city: 'Hà Nội' });
    const b = await shopper(t, w, { email: 'b-district@shop.vn' });
    const idb = await ready(t, b, w, { pay: 'cod', coupon: null });
    expect((await pickAddress(t, b.u, idb, b.a2)).status).toBe(200); // a2 không có quận, huyện
    const rb = await placeShown(t, b, idb);
    expect(rb.status).toBe(201);
    const [ob] = await ordersOf(t, b.u.id);
    expect(Object.keys(ob.shipping_address).sort()).toEqual(SIX);
    expect(ob.shipping_address).toMatchObject({ district: null, city: 'Hà Giang', line1: '9 Trần Phú' });
  });
});

describe('CHK: 429 ở xem lại và hai DELETE (SB-14, ADR-014)', () => {
  it('CHK-TC-20261013-210241009: xem lại 120 lần mỗi phút được, lần 121 là 429 rate-limited kèm Retry-After 1 đến 60; người khác cùng phút vẫn xem được; cửa sổ mới thì được lại', async () => {
    const a = await shopper(t, w);
    const b = await shopper(t, w, { email: 'b-view@shop.vn' });
    const ida = (await create(t, a.u)).body.id as string;
    const idb = (await create(t, b.u)).body.id as string;
    alignWindow(t);
    for (let i = 0; i < 120; i++) expect((await view(t, a.u, ida)).status).toBe(200);
    const r = await view(t, a.u, ida);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await view(t, b.u, idb)).status).toBe(200);
    t.clock.advance(61_000);
    expect((await view(t, a.u, ida)).status).toBe(200);
  }, 60_000);

  it('CHK-TC-20261013-210241168: hủy phiên 120 lần mỗi phút được (204), lần 121 là 429 rate-limited kèm Retry-After; cửa sổ mới thì được lại', async () => {
    const a = await shopper(t, w);
    const id = (await create(t, a.u)).body.id as string;
    alignWindow(t);
    for (let i = 0; i < 120; i++) expect((await cancel(t, a.u, id)).status).toBe(204);
    const r = await cancel(t, a.u, id);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await sessionsOf(t, a.u.id)).map((s) => s.status)).toEqual(['cancelled']);
    t.clock.advance(61_000);
    expect((await cancel(t, a.u, id)).status).toBe(204);
  }, 60_000);

  it('CHK-TC-20261013-210241326: gỡ mã 60 lần mỗi phút được (204), lần 61 là 429 rate-limited kèm Retry-After; cửa sổ mới thì được lại', async () => {
    const a = await shopper(t, w);
    const id = (await create(t, a.u)).body.id as string;
    alignWindow(t);
    for (let i = 0; i < 60; i++) expect((await dropCoupon(t, a.u, id)).status).toBe(204);
    const r = await dropCoupon(t, a.u, id);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    t.clock.advance(61_000);
    expect((await dropCoupon(t, a.u, id)).status).toBe(204);
  }, 60_000);
});

describe('CHK: giỏ vượt trần của CRT (CHK-REQ-20261006-105050948, CRT-REQ-20261006-103226562)', () => {
  it('CHK-TC-20261013-210241484: giá tăng làm giỏ vượt 10.000.000.000 thì đặt hàng bị 409 cart-limit-exceeded (không 503) và hoàn tác sạch; bớt giỏ về đúng trần thì đặt được', async () => {
    const crt = t as unknown as CrtApp;
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(await sku(crt, 900_000_000, 1000));
    const a = await shopper(t, w, { lines: ids.map((product) => ({ product })) });
    const id = await ready(t, a, w, { pay: 'cod', coupon: null }); // 9.900.000.000: dưới trần, tạo phiên và chọn vận chuyển được
    for (const p of ids) await setPrice(t, p, 1_000_000_000); // admin tăng giá: 11.000.000.000
    const before = await tally(t);
    const p = await place(t, a.u, id, { expected_grand_total: 11_000_000_000, cart_version: 7 });
    expect([p.status, p.body.type]).toEqual([409, 'urn:ecom:error:cart-limit-exceeded']);
    expect(await tally(t)).toEqual(before);
    expect((await sessionsOf(t, a.u.id)).map((x) => x.status)).toEqual(['open']);
    await q(t, `DELETE FROM cart_items WHERE id = (SELECT id FROM cart_items WHERE cart_id = '${a.cart}' ORDER BY created_at LIMIT 1)`);
    await q(t, `UPDATE carts SET version = version + 1 WHERE id = '${a.cart}'`);
    const ok = await placeShown(t, a, id);
    expect(ok.status).toBe(201);
    expect(await countOf(t, 'orders')).toBe(1);
  }, 60_000);
});

describe('CHK: job hết hạn phiên và xóa bản chụp: hạn thời gian, tín hiệu hủy, giới hạn lô (CHK-REQ-20261006-105052414)', () => {
  it('CHK-TC-20261013-211638651: hạn thời gian 0 hay tín hiệu hủy thì không đổi gì; lô 2 chia năm phiên thành 3 lô, mỗi phiên một CheckoutExpired, chạy lại không đổi (idempotent); xóa bản chụp cũng thôi khi hết hạn thời gian', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await shopper(t, w, { email: `job${i}@shop.vn` });
      const id = (await create(t, s.u)).body.id as string;
      await ageSession(t, id, 60);
      ids.push(id);
    }
    const ac = new AbortController(); ac.abort();
    expect(await t.chkJobs.expireOnce({ signal: ac.signal })).toEqual({ sessions: 0, batches: 0 });
    expect(await t.chkJobs.expireOnce({ budgetMs: 0 })).toEqual({ sessions: 0, batches: 0 });
    expect((await outboxOf(t, 'CheckoutExpired')).length).toBe(0);
    expect(await countOf(t, 'checkout_sessions', "status = 'open'")).toBe(5);
    expect(await t.chkJobs.expireOnce({ batch: 2 })).toEqual({ sessions: 5, batches: 3 });
    expect(await countOf(t, 'checkout_sessions', "status = 'expired'")).toBe(5);
    expect((await outboxOf(t, 'CheckoutExpired')).map((e) => e.aggregate_id).sort()).toEqual([...ids].sort());
    expect(await t.chkJobs.expireOnce({ batch: 2 })).toEqual({ sessions: 0, batches: 0 });
    for (const id of ids.slice(0, 2)) await ageDays(t, id, 31);
    expect(await t.chkJobs.purgeOnce({ budgetMs: 0 })).toEqual({ sessions: 0, batches: 0 });
    expect((await sessionRow(t, ids[0])).address_snapshot).not.toBeNull();
    expect(await t.chkJobs.purgeOnce()).toMatchObject({ sessions: 2 });
    expect([(await sessionRow(t, ids[0])).address_snapshot, (await sessionRow(t, ids[0])).status]).toEqual([null, 'expired']);
  }, 60_000);
});
