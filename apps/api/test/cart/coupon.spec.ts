import { randomUUID } from 'node:crypto';
import { DomainError } from '../../src/modules/platform';
import {
  activeCart, addItem, alignWindow, buyer, call, createCrtApp, delItem, getCart, medianPairMs, noTrace, putCoupon, q, resetCrt, seedCart, seedCoupon, seedRedemption, setQty, sku, wrongHits, type CrtApp,
} from '../support/crt';

// REQ ...103226511 (áp và gỡ mã giảm giá): PRM thật (bộ đếm sai ở kho PostgreSQL của platform), PRD, INV, SHP thật; đếm lời gọi bằng jest.spyOn.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => { jest.restoreAllMocks(); t.deps.timeoutMs = 2000; });

describe('CRT áp và gỡ mã giảm giá (CRT-REQ-20261006-103226511)', () => {
  it('CRT-TC-20261006-104453162: áp mã " sale10 " rồi gỡ: lưu mã chuẩn hóa, không giữ lượt ở PRM, gỡ 204 và giảm về 0', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    const c = await seedCoupon(t, { code: 'SALE10', value: 10, min: 200000 });
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }] });
    const r = await putCoupon(t, u, ' sale10 ');
    expect(r.status).toBe(200);
    expect(r.body.coupon).toEqual({ code: 'SALE10', applied: true, discount: 30000 });
    expect(r.body).toMatchObject({ discount: 30000, total: 270000 });
    expect((await activeCart(t, u.id))!.coupon_code).toBe('SALE10');
    expect(await q(t, `SELECT * FROM coupon_redemptions WHERE coupon_id = '${c.id}'`)).toEqual([]);
    expect((await q<{ reserved_count: number }>(t, `SELECT reserved_count FROM coupons WHERE id = '${c.id}'`))[0].reserved_count).toBe(0);
    const d = await call(t, 'delete', '/cart/coupon', { cookie: u.cookie });
    expect([d.status, d.text]).toEqual([204, '']);
    const g = await getCart(t, u);
    expect([g.body.coupon, g.body.discount]).toEqual([null, 0]);
    expect((await call(t, 'delete', '/cart/coupon', { cookie: u.cookie })).status).toBe(204); // gỡ khi không có mã cũng 204
  });

  it('CRT-TC-20261006-104453207: chưa đủ giá trị đơn tối thiểu: 409 min-order-not-met kèm min_order_value và shortfall, giỏ không có mã', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10, min: 200000 });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const r = await putCoupon(t, u, 'SALE10');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:min-order-not-met', status: 409, min_order_value: 200000, shortfall: 50000 });
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
  });

  it('CRT-TC-20261006-104453261: mã không có, đã tắt, đã xóa cùng một 404 coupon-not-found (không dò được mã); thời gian trả lời không khác biệt', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 150000, 10);
    await seedCoupon(t, { code: 'OLD10', status: 'disabled' });
    await seedCoupon(t, { code: 'GONE10', status: 'deleted' });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const bodies: Record<string, unknown>[] = [];
    for (const code of ['NOPE1234', 'OLD10', 'GONE10']) {
      const r = await putCoupon(t, u, code);
      expect([code, r.status, r.body.type]).toEqual([code, 404, 'urn:ecom:error:coupon-not-found']);
      bodies.push(noTrace(r.body));
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
    // thời gian: người dùng mới mỗi lần (không chạm bộ đếm 10 lần), hai nhánh đo xen kẽ từng cặp, trung vị lệch dưới 30% (ngưỡng tạm của PRM, chưa chốt)
    const mk = async () => { const id = randomUUID(); await seedCart(t, id, { lines: [{ product: p1 }] }); return id; };
    const ids = await Promise.all(Array.from({ length: 200 }, mk));
    const run = (code: string, off: number) => (i: number) => t.writes.applyCoupon(ids[off + i], { code }).catch((e) => { if (!(e instanceof DomainError)) throw e; });
    const [missing, off] = await medianPairMs(100, run('NOPE1234', 0), run('OLD10', 100));
    expect(Math.abs(missing - off) / Math.max(missing, off)).toBeLessThan(0.3);
  }, 90_000);

  it('CRT-TC-20261006-104453306: thử sai 10 lần thì bị khóa kể cả mã đúng (429 too-many-attempts kèm Retry-After và retry_after_seconds); người khác không bị ảnh hưởng', async () => {
    const a = await buyer(t), b = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, a.id, { lines: [{ product: p1 }] });
    await seedCart(t, b.id, { lines: [{ product: p1 }] });
    t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / 600_000) * 600_000 + 1000)); // đầu cửa sổ 10 phút của PRM
    for (let i = 0; i < 10; i++) {
      if (i === 5) t.clock.advance(61_000); // 10 lần sai nằm trong 10 phút nhưng qua hai cửa sổ 60 giây của giới hạn CRT
      expect((await putCoupon(t, a, `NOPE${1000 + i}`)).status).toBe(404);
    }
    const r = await putCoupon(t, a, 'SALE10');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:too-many-attempts', status: 429 });
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.body.retry_after_seconds).toBeGreaterThan(0);
    expect((await activeCart(t, a.id))!.coupon_code).toBeNull();
    expect((await putCoupon(t, b, 'SALE10')).status).toBe(200);
  });

  it('CRT-TC-20261006-104453261: tạm tính vượt miền của PRM (quá 1.000.000.000): áp mã 409 no-discount, xem giỏ mã giữ lại với giảm 0 (lý do no_discount), tổng vẫn đúng và không ném 500', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 1_000_000_000, 99);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1, quantity: 2 }], coupon: 'SALE10' }); // tạm tính 2.000.000.000: PRM `invalid_subtotal`
    const g = await getCart(t, u);
    expect(g.status).toBe(200);
    expect(g.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'no_discount' });
    expect(g.body).toMatchObject({ subtotal: 2_000_000_000, discount: 0, total: 2_000_000_000 });
    await q(t, `UPDATE carts SET coupon_code = NULL`);
    const r = await putCoupon(t, u, 'SALE10');
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:no-discount']);
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
  });

  it('CRT-TC-20261006-104453359: giỏ trống thì 409 cart-empty; code rỗng, 51 ký tự, trường discount lạ, NUL đều 400; PRM không bị gọi và giỏ không đổi', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    const evaluate = jest.spyOn(t.prm, 'evaluate');
    const e = await putCoupon(t, u, 'SALE10');
    expect([e.status, e.body.type]).toEqual([409, 'urn:ecom:error:cart-empty']);
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    for (const [code, extra] of [['', undefined], ['   ', undefined], ['A'.repeat(51), undefined], ['SALE10', { discount: 99999 }], ['SALE\u000010', undefined], [12345, undefined], [null, undefined]] as [unknown, Record<string, unknown>?][]) {
      const r = await putCoupon(t, u, code, extra);
      expect([String(code), r.status, r.body.type]).toEqual([String(code), 400, 'urn:ecom:error:validation-failed']);
    }
    expect((await call(t, 'put', '/cart/coupon', { cookie: u.cookie, body: '{"code":"\\udc00"}' })).status).toBe(400); // nửa cặp thay thế lẻ
    expect(evaluate).not.toHaveBeenCalled();
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
    expect((await putCoupon(t, u, 'A'.repeat(50))).status).toBe(404); // đúng 50 ký tự qua schema, tới PRM thì không có mã
  });

  it('CRT-TC-20261006-104453404: mã bị giữ khi giỏ đổi: mất hiệu lực (kèm shortfall, giảm 0, mã vẫn trong giỏ) rồi tự áp lại', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 50000, 100);
    await seedCoupon(t, { code: 'SALE10', value: 10, min: 200000 });
    const { items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 6 }] }); // 300000
    expect((await putCoupon(t, u, 'SALE10')).body.coupon.applied).toBe(true);
    expect((await setQty(t, u, items[0], 3)).status).toBe(200); // 150000
    const g1 = await getCart(t, u);
    expect(g1.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'min_order_not_met', shortfall: 50000 });
    expect(g1.body.discount).toBe(0);
    expect((await activeCart(t, u.id))!.coupon_code).toBe('SALE10');
    expect((await setQty(t, u, items[0], 5)).status).toBe(200); // 250000
    const g2 = await getCart(t, u);
    expect(g2.body.coupon).toEqual({ code: 'SALE10', applied: true, discount: 25000 });
  });

  it('CRT-TC-20261006-104453444: xem giỏ 12 lần với mã đã tắt không làm khách bị khóa: evaluate nhận count_attempt = false, bộ đếm sai vẫn 0, áp SALE20 vẫn 200', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10, status: 'disabled' });
    await seedCoupon(t, { code: 'SALE20', value: 20 });
    await seedCart(t, u.id, { lines: [{ product: p1 }], coupon: 'SALE10' });
    const evaluate = jest.spyOn(t.prm, 'evaluate');
    for (let i = 0; i < 12; i++) {
      const g = await getCart(t, u);
      expect([i, g.body.coupon]).toEqual([i, { code: 'SALE10', applied: false, reason: 'coupon_not_found' }]);
    }
    expect(evaluate).toHaveBeenCalledTimes(12);
    for (const [input] of evaluate.mock.calls) expect(input.count_attempt).toBe(false);
    expect(await wrongHits(t, u.id)).toBe(0); // bộ đếm sai ở kho đếm PostgreSQL (ADR-014, bậc A) vẫn 0
    const r = await putCoupon(t, u, 'SALE20');
    expect([r.status, r.body.coupon]).toEqual([200, { code: 'SALE20', applied: true, discount: 60000 }]);
    expect(evaluate.mock.calls[12][0].count_attempt).toBe(true); // chỉ lệnh áp mã do khách nhập mới tính lượt
  });

  it('CRT-TC-20261006-104453501: áp mã mới lỗi thì mã cũ giữ nguyên (404, coupon_code vẫn SALE10, giảm như trước)', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    expect((await putCoupon(t, u, 'SALE10')).status).toBe(200);
    const r = await putCoupon(t, u, 'NOPE1234');
    expect([r.status, r.body.type]).toEqual([404, 'urn:ecom:error:coupon-not-found']);
    expect((await activeCart(t, u.id))!.coupon_code).toBe('SALE10');
    expect((await getCart(t, u)).body.coupon).toEqual({ code: 'SALE10', applied: true, discount: 30000 });
  });

  it('CRT-TC-20261006-104453546: quá 10 lần gọi áp mã mỗi phút bị 429 rate-limited kèm Retry-After; PRM không bị gọi lần 11; sau 60 giây gọi lại được', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    alignWindow(t);
    for (let i = 0; i < 10; i++) expect([i, (await putCoupon(t, u, 'SALE10')).status]).toEqual([i, 200]);
    const evaluate = jest.spyOn(t.prm, 'evaluate');
    const r = await putCoupon(t, u, 'SALE10');
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(evaluate).not.toHaveBeenCalled();
    t.clock.advance(61_000);
    expect((await putCoupon(t, u, 'SALE10')).status).toBe(200);
  }, 60_000);

  it('CRT-TC-20261006-113000440: mã hết lượt mỗi người: 409 per-user-limit-reached kèm limit và used, giỏ không có mã, evaluate đúng một lần với count_attempt true, bộ đếm sai không tăng; xem giỏ giữ mã', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    const c = await seedCoupon(t, { code: 'ONCE10', value: 10, perUser: 1, consumed: 1 });
    await seedRedemption(t, c.id, { user: u.id, status: 'consumed' });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    const evaluate = jest.spyOn(t.prm, 'evaluate');
    const r = await putCoupon(t, u, 'once10');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:per-user-limit-reached', limit: 1, used: 1 });
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0].count_attempt).toBe(true);
    expect(await wrongHits(t, u.id)).toBe(0); // lý do này không tính vào bộ đếm của PRM
    await t.prisma.$executeRaw`UPDATE carts SET coupon_code = 'ONCE10' WHERE user_id = ${u.id}::uuid`;
    const g = await getCart(t, u);
    expect(g.body.coupon).toEqual({ code: 'ONCE10', applied: false, reason: 'per_user_limit_reached', limit: 1, used: 1 });
    expect(g.body.discount).toBe(0);
  });

  it('CRT-TC-20261006-104453261: mọi lý do lỗi của PRM đổi đúng sang mã HTTP của CRT (expired, exhausted, no-discount) và PRM lỗi thì 503 khi áp, `service_unavailable` khi xem', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'EXP10', status: 'expired' });
    await seedCoupon(t, { code: 'FULL10', status: 'exhausted' });
    await seedCoupon(t, { code: 'LIMIT10', usageLimit: 1, consumed: 1 });
    await seedCart(t, u.id, { lines: [{ product: p1 }] });
    expect((await putCoupon(t, u, 'EXP10')).body.type).toBe('urn:ecom:error:coupon-expired');
    expect((await putCoupon(t, u, 'FULL10')).body.type).toBe('urn:ecom:error:coupon-exhausted');
    expect((await putCoupon(t, u, 'LIMIT10')).body.type).toBe('urn:ecom:error:coupon-exhausted');
    jest.spyOn(t.prm, 'evaluate').mockRejectedValueOnce(new Error('prm down'));
    const a = await putCoupon(t, u, 'SALE10');
    expect([a.status, a.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
    expect((await activeCart(t, u.id))!.coupon_code).toBeNull();
    await t.prisma.$executeRaw`UPDATE carts SET coupon_code = 'SALE10' WHERE user_id = ${u.id}::uuid`;
    jest.spyOn(t.prm, 'evaluate').mockRejectedValueOnce(new Error('prm down'));
    const g = await getCart(t, u);
    expect(g.status).toBe(200);
    expect(g.body.coupon).toEqual({ code: 'SALE10', applied: false, reason: 'service_unavailable' });
    expect(g.body).toMatchObject({ subtotal: 300000, discount: 0, total: 300000 }); // các phần khác vẫn trả
  });

  it('CRT-TC-20261006-104453359: mã chỉ còn dòng ngừng bán: không có gì để giảm (no-discount), không gọi PRM; xóa dòng cuối tự bỏ mã', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 300000, 10);
    await seedCoupon(t, { code: 'SALE10', value: 10 });
    await seedCart(t, u.id, { lines: [{ product: p1, reason: 'product_archived' }] });
    const evaluate = jest.spyOn(t.prm, 'evaluate');
    const r = await putCoupon(t, u, 'SALE10');
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:no-discount']);
    expect(evaluate).not.toHaveBeenCalled();
    const item = (await q<{ id: string }>(t, 'SELECT id FROM cart_items'))[0].id;
    expect((await delItem(t, u, item)).status).toBe(204);
    expect(await activeCart(t, u.id)).toMatchObject({ coupon_code: null });
    expect((await addItem(t, u, p1, 1)).status).toBe(201); // dòng ngừng bán đã gỡ: thêm lại là dòng mới (sản phẩm đã `active` ở PRD)
  });
});
