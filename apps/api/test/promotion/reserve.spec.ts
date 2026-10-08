import { truncateAll } from '../support/db';
import { actor, call, cancelled, confirmed, countOf, couponOf, createPrmApp, deliver, eventsOf, expiredOrder, paid, q, redemptionOfOrder, redemptionsOf, reserve, rid, seedCoupon, seedRedemption, snapshotTables, type PrmApp } from '../support/prm';

// Giữ lượt và giới hạn lượt dùng dưới đồng thời (PRM-REQ-20261006-101036447; SB-25, SB-33): PostgreSQL thật, nhiều kết nối thật chạy song song (pool 16).
// `reserve` chạy trong MỘT giao dịch như CHK (cam kết khi xong, ném lỗi thì quay lui); handler event dựng theo đúng phong bì của events.md vì ORD, PAY chưa có code.
describe('PRM giữ lượt và chống dùng vượt giới hạn', () => {
  let t: PrmApp;
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });
  const resetCoupon = async (code: string, over = ''): Promise<void> => {
    await q(t, `DELETE FROM coupon_redemptions`);
    await q(t, `UPDATE coupons SET reserved_count = 0, consumed_count = 0, status = 'active' ${over} WHERE code = '${code}'`);
  };
  const counts = async (code: string) => { const c = await couponOf(t, code); return [c.consumed_count, c.reserved_count, c.status]; };

  it('PRM-TC-20261006-101037690: giữ lượt khi còn đúng một chỗ trống: thành công, reserved_count 2, consumed_count 1, remaining 0, đúng một dòng reserved của đơn kèm amount theo công thức', async () => {
    const { id } = await seedCoupon(t, { code: 'FLASH1', usageLimit: 3, consumed: 1, reserved: 1 });
    const order = rid();
    const r = await reserve(t, { code: 'FLASH1', order_id: order, user_id: rid(), items_subtotal: 300000 });
    expect(r).toMatchObject({ ok: true, coupon_id: id, amount: 30000 });
    expect(await counts('FLASH1')).toEqual([1, 2, 'active']);
    const row = await redemptionOfOrder(t, order);
    expect([row.status, row.amount, row.consumed_at, row.released_at, (r as { redemption_id: string }).redemption_id]).toEqual(['reserved', '30000', null, null, row.id]);
    const admin = await actor(t, 'admin');
    expect((await call(t, 'get', `/admin/coupons/${id}`, { cookie: admin.cookie })).body.remaining).toBe(0);
  });

  it('PRM-TC-20261006-101037713: hết chỗ thì evaluate và reserve đều trả coupon_exhausted (không ghi gì, giao dịch của CHK có hoàn tác phần coupon); coupon exhausted evaluate cũng trả coupon_exhausted', async () => {
    await seedCoupon(t, { code: 'FLASH1', usageLimit: 3, consumed: 1, reserved: 2 });
    await seedCoupon(t, { code: 'DONE1', status: 'exhausted', usageLimit: 1, consumed: 1 });
    const user = rid();
    expect(await t.prm.evaluate({ code: 'FLASH1', user_id: user, items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_exhausted' });
    const before = await snapshotTables(t);
    expect(await reserve(t, { code: 'FLASH1', user_id: user })).toEqual({ ok: false, reason: 'coupon_exhausted' });
    expect(await snapshotTables(t)).toBe(before);
    expect(await t.prm.evaluate({ code: 'DONE1', user_id: rid(), items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_exhausted' });
    expect(await reserve(t, { code: 'DONE1' })).toEqual({ ok: false, reason: 'coupon_exhausted' });
    // CHK bắt kết quả lỗi và vẫn cam kết: vẫn không có dòng nửa vời nhờ SAVEPOINT
    expect(await t.tx.run((tx) => t.evaluator.reserve({ order_id: rid(), user_id: rid(), code: 'FLASH1', items_subtotal: 300000 }, tx))).toMatchObject({ ok: false });
    expect(await snapshotTables(t)).toBe(before);
  });

  it('PRM-TC-20261006-101037738: hai khách giữ lượt cùng lúc khi chỉ còn một lượt (100 lần): đúng một thành công, một coupon_exhausted, reserved_count luôn 1 (không bao giờ 2), một dòng lượt; 20 luồng với usage_limit 5 thì đúng 5 thành công', async () => {
    await seedCoupon(t, { code: 'FLASH1', usageLimit: 1 });
    for (let i = 0; i < 100; i++) {
      await resetCoupon('FLASH1');
      const rs = await Promise.all([reserve(t, { code: 'FLASH1' }), reserve(t, { code: 'FLASH1' })]);
      expect([i, rs.filter((r) => r.ok).length]).toEqual([i, 1]);
      expect(rs.find((r) => !r.ok)).toEqual({ ok: false, reason: 'coupon_exhausted' });
      expect([i, ...(await counts('FLASH1'))]).toEqual([i, 0, 1, 'active']);
      expect(await countOf(t, 'coupon_redemptions')).toBe(1);
    }
    await q(t, `UPDATE coupons SET usage_limit = 5 WHERE code = 'FLASH1'`);
    await resetCoupon('FLASH1');
    const rs = await Promise.all(Array.from({ length: 20 }, () => reserve(t, { code: 'FLASH1' })));
    expect(rs.filter((r) => r.ok)).toHaveLength(5);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'coupon_exhausted')).toBe(true);
    expect([await counts('FLASH1'), await countOf(t, 'coupon_redemptions')]).toEqual([[0, 5, 'active'], 5]);
    await expect(q(t, `UPDATE coupons SET reserved_count = 6 WHERE code = 'FLASH1'`)).rejects.toThrow(/coupons_used_le_limit|check constraint/); // CHECK ở CSDL là lớp chặn cuối
  }, 120_000);

  it('PRM-TC-20261006-101037761: nhả lượt (OrderCancelled) trả lại chỗ trống cho khách khác: lượt released, reserved_count 0, reserve của khách B thành công, coupon vẫn active suốt quá trình', async () => {
    await seedCoupon(t, { code: 'FLASH1', usageLimit: 1 });
    const o1 = rid();
    expect(await reserve(t, { code: 'FLASH1', order_id: o1 })).toMatchObject({ ok: true });
    expect(await reserve(t, { code: 'FLASH1' })).toEqual({ ok: false, reason: 'coupon_exhausted' }); // khách B bị từ chối
    await deliver(t, 'OrderCancelled', cancelled(o1, { reason: 'customer_request', was_paid: false }));
    expect((await redemptionOfOrder(t, o1)).status).toBe('released');
    expect(await counts('FLASH1')).toEqual([0, 0, 'active']);
    expect(await reserve(t, { code: 'FLASH1' })).toMatchObject({ ok: true });
    expect(await counts('FLASH1')).toEqual([0, 1, 'active']);
  });

  it('PRM-TC-20261006-101037786: chỉ lượt TIÊU THỤ mới làm coupon exhausted: FLASH1 (consumed 1, reserved 1) sau PaymentSucceeded là consumed 2, reserved 0, exhausted; FLASH2 hết chỗ vì lượt reserved vẫn active', async () => {
    const f1 = await seedCoupon(t, { code: 'FLASH1', usageLimit: 2, consumed: 1, reserved: 1 }), f2 = await seedCoupon(t, { code: 'FLASH2', usageLimit: 2, reserved: 2 });
    const o2 = (await seedRedemption(t, f1.id)).order;
    await seedRedemption(t, f2.id); await seedRedemption(t, f2.id);
    await deliver(t, 'PaymentSucceeded', paid(o2));
    expect(await counts('FLASH1')).toEqual([2, 0, 'exhausted']);
    expect(await t.prm.evaluate({ code: 'FLASH2', user_id: rid(), items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_exhausted' });
    expect(await counts('FLASH2')).toEqual([0, 2, 'active']);
  });

  it('PRM-TC-20261006-101037811: reserve lặp cho cùng đơn trả đúng lượt cũ (cùng redemption_id, không tăng đếm); mã khác cho cùng đơn là order_already_has_coupon; hai lời gọi đồng thời (20 lần) vẫn một lượt', async () => {
    await seedCoupon(t, { code: 'FLASH1' });
    await seedCoupon(t, { code: 'SALE10' });
    const order = rid(), user = rid();
    const first = await reserve(t, { code: 'FLASH1', order_id: order, user_id: user });
    const second = await reserve(t, { code: ' flash1 ', order_id: order, user_id: user });
    expect(second).toEqual(first);
    expect((await counts('FLASH1'))[1]).toBe(1);
    expect(await reserve(t, { code: 'SALE10', order_id: order, user_id: user })).toEqual({ ok: false, reason: 'order_already_has_coupon' });
    expect([(await counts('SALE10'))[1], (await redemptionsOf(t, (await couponOf(t, 'FLASH1')).id)).length, await countOf(t, 'coupon_redemptions', `order_id = '${order}'`)]).toEqual([0, 1, 1]);
    expect(await reserve(t, { code: 'FLASH1', order_id: order, user_id: rid() })).toEqual({ ok: false, reason: 'order_already_has_coupon' }); // người khác cho cùng đơn
    for (let i = 0; i < 20; i++) {
      await resetCoupon('FLASH1');
      const o = rid(), u = rid();
      const rs = await Promise.all([reserve(t, { code: 'FLASH1', order_id: o, user_id: u }), reserve(t, { code: 'FLASH1', order_id: o, user_id: u })]);
      expect([i, rs.every((r) => r.ok), new Set(rs.map((r) => r.ok && r.redemption_id)).size]).toEqual([i, true, 1]);
      expect([i, (await counts('FLASH1'))[1], await countOf(t, 'coupon_redemptions')]).toEqual([i, 1, 1]);
    }
    // lượt đã nhả của đơn không được "sống lại" bằng reserve lặp
    const o = rid();
    await reserve(t, { code: 'SALE10', order_id: o });
    await deliver(t, 'OrderExpired', expiredOrder(o));
    expect(await reserve(t, { code: 'SALE10', order_id: o })).toEqual({ ok: false, reason: 'order_already_has_coupon' });
    expect((await counts('SALE10'))[1]).toBe(0);
  }, 120_000);

  it('PRM-TC-20261006-113100151: coupon exhausted về active khi một lượt consumed được trả (OrderCancelled), evaluate thành công, PATCH 200; trước đó exhausted là 409 coupon_not_editable', async () => {
    const { id } = await seedCoupon(t, { code: 'FLASH2', status: 'exhausted', usageLimit: 1, consumed: 1 });
    const red = await seedRedemption(t, id, { status: 'consumed' });
    const admin = await actor(t, 'admin');
    const patch = (v: number) => call(t, 'patch', `/admin/coupons/${id}`, { cookie: admin.cookie, body: { version: v, usage_limit: 5 } });
    expect((await patch(1)).body.code).toBe('coupon_not_editable');
    await deliver(t, 'OrderCancelled', cancelled(red.order, { was_paid: true }));
    expect(await counts('FLASH2')).toEqual([0, 0, 'active']);
    expect(await t.prm.evaluate({ code: 'FLASH2', user_id: rid(), items_subtotal: 300000 })).toMatchObject({ ok: true });
    const r = await patch(1);
    expect([r.status, r.body.usage_limit]).toEqual([200, 5]);
    // coupon đã quá hạn lúc trả lượt: về active rồi job chuyển expired; evaluate vẫn coupon_expired theo giờ CSDL
    const old = await seedCoupon(t, { code: 'FLASH3', status: 'exhausted', usageLimit: 1, consumed: 1, expiresInSec: -60 });
    const red2 = await seedRedemption(t, old.id, { status: 'consumed' });
    await deliver(t, 'OrderCancelled', cancelled(red2.order));
    expect((await counts('FLASH3'))[2]).toBe('active');
    expect(await t.prm.evaluate({ code: 'FLASH3', user_id: rid(), items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_expired' });
    await t.jobs.expireOnce();
    expect((await counts('FLASH3'))[2]).toBe('expired');
  });

  it('PRM-TC-20261006-130100404: hai đơn song song của một khách không cùng vượt per_user_limit (100 lần): đúng một reserved và một per_user_limit_reached; 20 luồng của U1 và 20 luồng của U2 chạy cùng lúc thì đúng 1 thành công cho mỗi người', async () => {
    const { id } = await seedCoupon(t, { code: 'ONCE10', usageLimit: 100, perUser: 1 });
    const u1 = rid();
    for (let i = 0; i < 100; i++) {
      await resetCoupon('ONCE10');
      const rs = await Promise.all([reserve(t, { code: 'ONCE10', user_id: u1 }), reserve(t, { code: 'ONCE10', user_id: u1 })]);
      expect([i, rs.filter((r) => r.ok).length]).toEqual([i, 1]);
      expect(rs.find((r) => !r.ok)).toEqual({ ok: false, reason: 'per_user_limit_reached', limit: 1, used: 1 });
      expect([i, (await counts('ONCE10'))[1]]).toEqual([i, 1]);
      expect((await redemptionsOf(t, id)).filter((x) => x.user_id === u1 && x.status === 'reserved')).toHaveLength(1);
    }
    await resetCoupon('ONCE10');
    const u2 = rid();
    const rs = await Promise.all([...Array.from({ length: 20 }, () => reserve(t, { code: 'ONCE10', user_id: u1 })), ...Array.from({ length: 20 }, () => reserve(t, { code: 'ONCE10', user_id: u2 }))]);
    expect(rs.slice(0, 20).filter((r) => r.ok)).toHaveLength(1);
    expect(rs.slice(20).filter((r) => r.ok)).toHaveLength(1);
    expect(await counts('ONCE10')).toEqual([0, 2, 'active']);
  }, 180_000);

  it('PRM-TC-20261006-130100505: lượt released không tính vào per_user_limit và giới hạn tính riêng từng người: U2 giữ được, U1 giữ lại sau OrderExpired, và sau consumed rồi bị hủy cũng giữ lại được', async () => {
    await seedCoupon(t, { code: 'ONCE10', usageLimit: 100, perUser: 1 });
    const [u1, u2, o1, o2] = [rid(), rid(), rid(), rid()];
    expect(await reserve(t, { code: 'ONCE10', user_id: u1, order_id: o1 })).toMatchObject({ ok: true });
    expect(await reserve(t, { code: 'ONCE10', user_id: u1, order_id: o2 })).toEqual({ ok: false, reason: 'per_user_limit_reached', limit: 1, used: 1 });
    expect(await reserve(t, { code: 'ONCE10', user_id: u2 })).toMatchObject({ ok: true });
    expect((await counts('ONCE10'))[1]).toBe(2);
    await deliver(t, 'OrderExpired', expiredOrder(o1, u1)); // lượt thành released, reserved_count 1
    expect((await counts('ONCE10'))[1]).toBe(1);
    expect(await reserve(t, { code: 'ONCE10', user_id: u1, order_id: o2 })).toMatchObject({ ok: true });
    expect((await redemptionsOf(t, (await couponOf(t, 'ONCE10')).id)).filter((x) => x.user_id === u1).map((x) => x.status).sort()).toEqual(['released', 'reserved']);
    expect((await counts('ONCE10'))[1]).toBe(2);
    await deliver(t, 'OrderConfirmed', confirmed(o2, u1)); // consumed
    await deliver(t, 'OrderCancelled', cancelled(o2, { user: u1 })); // rồi bị hủy: lượt consumed được trả
    expect(await counts('ONCE10')).toEqual([0, 1, 'active']);
    expect(await reserve(t, { code: 'ONCE10', user_id: u1, order_id: rid() })).toMatchObject({ ok: true });
    expect(await eventsOf(t, 'CouponRedeemed')).toHaveLength(1);
  });

  it('PRM-TC-20261006-101938470: reserve thất bại thì không để lại dòng nào, và không nhận amount từ bên gọi (trường lạ là invalid_argument, schema chặn ở biên); amount ghi theo công thức từ items_subtotal', async () => {
    await seedCoupon(t, { code: 'SALE10', usageLimit: 1, consumed: 1 });
    await seedCoupon(t, { code: 'SALE20', value: 10 });
    const before = await snapshotTables(t);
    expect(await reserve(t, { code: 'SALE10', order_id: rid(), items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_exhausted' }); // ORD-7
    expect(await snapshotTables(t)).toBe(before);
    const forged = await t.tx.run((tx) => t.evaluator.reserve({ order_id: rid(), user_id: rid(), code: 'SALE20', items_subtotal: 300000, amount: 1 } as never, tx)); // ORD-8: tiền giảm giả
    expect(forged).toEqual({ ok: false, reason: 'invalid_argument' });
    expect(await snapshotTables(t)).toBe(before);
    const ok = await reserve(t, { code: 'SALE20', items_subtotal: 300000 });
    expect(ok).toMatchObject({ ok: true, amount: 30000 }); // công thức, không phải 1
    for (const bad of [{ order_id: 'x' }, { user_id: 'x' }, { code: 5 }, { items_subtotal: 0 }, { items_subtotal: 10.5 }]) {
      expect([JSON.stringify(bad), (await t.tx.run((tx) => t.evaluator.reserve({ order_id: rid(), user_id: rid(), code: 'SALE20', items_subtotal: 300000, ...bad } as never, tx))).ok]).toEqual([JSON.stringify(bad), false]);
    }
    expect(await countOf(t, 'coupon_redemptions')).toBe(1);
  });
});
