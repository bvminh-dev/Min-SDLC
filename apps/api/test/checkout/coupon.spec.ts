import { alignWindow, applyCoupon, countOf, createChkApp, dropCoupon, place, placeShown, q, race, ready, redemptionsFor, reservedCount, reservedOf, resetChk, seedCoupon, sessionRow, setCouponStatus, setPrice, shopper, tally, view, world, type ChkApp, type World, noTrace } from '../support/chk';
import { seedRedemption } from '../support/prm';
import { wrongHits } from '../support/crt';

// REQ ...105051536 (áp và gỡ mã giảm giá ở checkout): PRM thật; `count_attempt` kiểm qua bộ đếm dò mã thật của platform.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => jest.restoreAllMocks());

describe('CHK áp và gỡ mã giảm giá (CHK-REQ-20261006-105051536)', () => {
  it('CHK-TC-20261006-110701818: áp " sale10 " chuẩn hóa thành SALE10, giảm 35000, tổng tính lại; KHÔNG giữ lượt (reserved_count vẫn 0); gỡ hai lần đều 204 và discount về 0', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod' });
    const r = await applyCoupon(t, s.u, id, ' sale10 ');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ coupon: { code: 'SALE10', applied: true, discount: 35000 }, discount: 35000, grand_total: 345000, total_is_estimate: false });
    expect((await sessionRow(t, id)).coupon_code).toBe('SALE10');
    expect(await reservedCount(t, 'SALE10')).toBe(0);
    expect([(await dropCoupon(t, s.u, id)).status, (await dropCoupon(t, s.u, id)).status]).toEqual([204, 204]);
    expect((await view(t, s.u, id)).body).toMatchObject({ discount: 0, coupon: null });
  });

  it('CHK-TC-20261006-110701854: mã mới chưa đạt giá trị tối thiểu bị 409 min-order-not-met (min_order_value 500000, shortfall 150000), phiên giữ mã cũ SALE10', async () => {
    await seedCoupon(t, { code: 'BIG50', type: 'percentage', value: 50, min: 500000 });
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod', coupon: 'SALE10' });
    const r = await applyCoupon(t, s.u, id, 'BIG50');
    expect([r.status, r.body.type, r.body.min_order_value, r.body.shortfall]).toEqual([409, 'urn:ecom:error:min-order-not-met', 500000, 150000]);
    expect((await sessionRow(t, id)).coupon_code).toBe('SALE10');
  });

  it('CHK-TC-20261006-110701888: mã không có, đã tắt, đã xóa cùng một 404 coupon-not-found giống hệt (chỉ trace_id khác) và đều tính vào bộ đếm dò mã của PRM (bằng 3)', async () => {
    await seedCoupon(t, { code: 'OLDOFF10', status: 'disabled' });
    await seedCoupon(t, { code: 'DELETED01', status: 'deleted' });
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    expect(await wrongHits(t, s.u.id)).toBe(0);
    const rs = [await applyCoupon(t, s.u, id, 'NOPE9999'), await applyCoupon(t, s.u, id, 'OLDOFF10'), await applyCoupon(t, s.u, id, 'DELETED01')];
    for (const r of rs) { expect(r.status).toBe(404); expect(r.body.type).toBe('urn:ecom:error:coupon-not-found'); }
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[1].body));
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[2].body));
    expect(await wrongHits(t, s.u.id)).toBe(3);
  });

  it('CHK-TC-20261006-110701922: quá ngưỡng dò mã của PRM (10 lần sai mỗi 10 phút): lần 11 là 429 too-many-attempts kèm Retry-After và retry_after_seconds; hết thời gian khóa thì áp được mã đúng (không tính vào bộ đếm sai)', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: null, method: null });
    alignWindow(t, 600);
    for (let batch = 0; batch < 2; batch++) {
      for (let i = 0; i < 5; i++) expect((await applyCoupon(t, s.u, id, `KHONGCO${batch}${i}`)).status).toBe(404);
      t.clock.advance(61_000); // sang cửa sổ mới của bộ đếm 10 mỗi phút của CHK; vẫn trong cùng cửa sổ 10 phút của PRM
    }
    const r = await applyCoupon(t, s.u, id, 'KHONGCO99');
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:too-many-attempts']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(100); // còn khoảng 8 phút của cửa sổ 10 phút của PRM, không phải số tối thiểu
    expect(r.body.retry_after_seconds).toBe(Number(r.headers['retry-after']));
    t.clock.advance(600_000);
    const hits = await wrongHits(t, s.u.id);
    expect((await applyCoupon(t, s.u, id, 'SALE10')).status).toBe(200);
    expect(await wrongHits(t, s.u.id)).toBe(hits); // mã đúng được hoàn lại lượt đã `take`: không tính vào bộ đếm sai
  });

  it('CHK-TC-20261006-110701956: mã đã lưu bị admin tắt lúc đặt: 409 coupon-invalid (coupon_not_found), không Order, không giữ hàng, reserved_count không đổi; gỡ mã rồi xem lại tổng mới 380000 thì đặt được (201)', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod', coupon: 'SALE10' });
    const shown = (await view(t, s.u, id)).body;
    expect(shown.grand_total).toBe(345000);
    await setCouponStatus(t, 'SALE10', 'disabled');
    const before = await tally(t);
    const r = await place(t, s.u, id, { expected_grand_total: 345000, cart_version: shown.cart_version });
    expect([r.status, r.body.type, r.body.reason]).toEqual([409, 'urn:ecom:error:coupon-invalid', 'coupon_not_found']);
    expect(await tally(t)).toEqual(before);
    expect(await reservedCount(t, 'SALE10')).toBe(0);
    expect((await dropCoupon(t, s.u, id)).status).toBe(204);
    const v = (await view(t, s.u, id)).body;
    expect(v.grand_total).toBe(380000);
    expect((await place(t, s.u, id, { expected_grand_total: 380000, cart_version: v.cart_version })).status).toBe(201);
  });

  it('CHK-TC-20261006-110701993: tạm tính đúng bằng giá trị tối thiểu thì mã hợp lệ (giảm 20000); tạm tính 199999 thì 409 min-order-not-met shortfall 1', async () => {
    await seedCoupon(t, { code: 'MIN200', type: 'fixed', value: 20000, min: 200000 });
    const s = await shopper(t, w, { lines: [{ product: w.p1, quantity: 1 }, { product: w.p2, quantity: 1 }] }); // 200000
    const id = await ready(t, s, w, { pay: null, method: null });
    const a = await applyCoupon(t, s.u, id, 'MIN200');
    expect([a.status, a.body.discount]).toEqual([200, 20000]);
    await setPrice(t, w.p2, 49999);
    const b = await applyCoupon(t, s.u, id, 'MIN200');
    expect([b.status, b.body.type, b.body.shortfall]).toEqual([409, 'urn:ecom:error:min-order-not-met', 1]);
  });

  it('CHK-TC-20261006-110702031: mã làm tổng bằng 0: áp được (discount 50000, grand_total 0) nhưng chọn COD bị 422 zero-total-unsupported', async () => {
    await seedCoupon(t, { code: 'FULL50', type: 'fixed', value: 50000 });
    const free = await (await import('../support/chk')).seedMethod(t, { name: 'Miễn phí 1', fee: 30000, freeOver: 1 });
    const s = await shopper(t, w, { lines: [{ product: w.p2, quantity: 1 }] });
    const id = await ready(t, s, w, { pay: null, method: free });
    const a = await applyCoupon(t, s.u, id, 'FULL50');
    expect([a.status, a.body.discount, a.body.grand_total]).toEqual([200, 50000, 0]);
    const b = await (await import('../support/chk')).pickPayment(t, s.u, id, 'cod');
    expect([b.status, b.body.type]).toEqual([422, 'urn:ecom:error:zero-total-unsupported']);
  });

  it('CHK-TC-20261006-110702065: coupon còn một lượt, hai khách cùng áp rồi cùng đặt song song: đúng một người 201, người kia 409 coupon-invalid (coupon_exhausted), reserved_count = 1, người thua không có Order và hàng đã giữ được hoàn tác', async () => {
    await seedCoupon(t, { code: 'ONE1', type: 'percentage', value: 10, usageLimit: 1 });
    const a = await shopper(t, w, { email: 'a@shop.vn' }), b = await shopper(t, w, { email: 'b@shop.vn' });
    const ia = await ready(t, a, w, { pay: 'cod', coupon: 'ONE1' }), ib = await ready(t, b, w, { pay: 'cod', coupon: 'ONE1' });
    const [va, vb] = [(await view(t, a.u, ia)).body, (await view(t, b.u, ib)).body];
    const [ra, rb] = await race(() => place(t, a.u, ia, { expected_grand_total: va.expected_grand_total, cart_version: va.cart_version }), () => place(t, b.u, ib, { expected_grand_total: vb.expected_grand_total, cart_version: vb.cart_version }));
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb, loserUser = ra.status === 409 ? a.u : b.u;
    expect([loser.body.type, loser.body.reason]).toEqual(['urn:ecom:error:coupon-invalid', 'coupon_exhausted']);
    expect(await reservedCount(t, 'ONE1')).toBe(1);
    expect(await countOf(t, 'orders', `user_id = '${loserUser.id}'`)).toBe(0);
    expect(await reservedOf(t, w.p1)).toBe(2); // chỉ đơn của người thắng giữ P1 x 2
    expect(await countOf(t, 'stock_reservations')).toBe(2);
  });

  it('CHK-TC-20261006-110702099: xem lại nhiều lần với mã đã tắt không làm khách bị khóa dò mã: 15 lần đều 200 coupon.applied = false (coupon_not_found), không 429, bộ đếm PRM vẫn 0 (count_attempt = false)', async () => {
    const s = await shopper(t, w);
    const id = await ready(t, s, w, { pay: 'cod', coupon: 'SALE10' });
    await setCouponStatus(t, 'SALE10', 'disabled');
    for (let i = 0; i < 15; i++) {
      const r = await view(t, s.u, id);
      expect(r.status).toBe(200);
      expect(r.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'coupon_not_found' });
    }
    expect(await wrongHits(t, s.u.id)).toBe(0);
  });

  it('CHK-TC-20261006-122751355: khách đã dùng đủ per_user_limit (một consumed, một reserved): đặt bị 409 coupon-invalid (per_user_limit_reached), không Order, không giữ hàng, reserved_count vẫn 1; khách khác (chưa dùng) đặt được, reserved_count = 2', async () => {
    const pu2 = await seedCoupon(t, { code: 'PUTWO', type: 'percentage', value: 10, usageLimit: 100, perUser: 2, consumed: 1, reserved: 1 });
    const a = await shopper(t, w, { email: 'a@shop.vn' }), b = await shopper(t, w, { email: 'b@shop.vn' });
    await seedRedemption(t, pu2.id, { user: a.u.id, status: 'consumed' });
    await seedRedemption(t, pu2.id, { user: a.u.id, status: 'reserved' });
    const ia = await ready(t, a, w, { pay: 'cod' }), ib = await ready(t, b, w, { pay: 'cod', coupon: 'PUTWO' });
    await t.prisma.$executeRaw`UPDATE checkout_sessions SET coupon_code = 'PUTWO' WHERE id = ${ia}::uuid`; // áp được lúc A mới có một lượt, rồi A đặt đơn khác trước (dựng bằng SQL)
    const before = await tally(t);
    const r = await place(t, a.u, ia, { expected_grand_total: 345000, cart_version: 7 });
    expect([r.status, r.body.type, r.body.reason]).toEqual([409, 'urn:ecom:error:coupon-invalid', 'per_user_limit_reached']);
    expect(await tally(t)).toEqual(before);
    expect(await reservedCount(t, 'PUTWO')).toBe(1);
    const vb = (await view(t, b.u, ib)).body;
    expect((await place(t, b.u, ib, { expected_grand_total: vb.expected_grand_total, cart_version: vb.cart_version })).status).toBe(201);
    expect(await reservedCount(t, 'PUTWO')).toBe(2);
  });

  it('CHK-TC-20261006-122751396: lượt released không tính vào per_user_limit: A (một consumed, một released) đặt được lượt thứ hai; số lượt tính cho A (reserved + consumed) = 2', async () => {
    const pu2 = await seedCoupon(t, { code: 'PUTWO', type: 'percentage', value: 10, usageLimit: 100, perUser: 2, consumed: 1 });
    const a = await shopper(t, w, { email: 'a@shop.vn' });
    await seedRedemption(t, pu2.id, { user: a.u.id, status: 'consumed' });
    await seedRedemption(t, pu2.id, { user: a.u.id, status: 'released' });
    const id = await ready(t, a, w, { pay: 'cod', coupon: 'PUTWO' });
    const r = await placeShown(t, a, id);
    expect(r.status).toBe(201);
    const rows = (await redemptionsFor(t, 'PUTWO')).filter((x) => x.user_id === a.u.id);
    expect(rows.filter((x) => x.status === 'reserved' || x.status === 'consumed')).toHaveLength(3 - 1); // consumed (cũ) + reserved (mới); released không tính
    expect(rows.filter((x) => x.status === 'released')).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM coupon_redemptions WHERE status = 'reserved'")).toHaveLength(1);
  });
});
