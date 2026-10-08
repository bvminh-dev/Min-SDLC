import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { actor, auditCount, auditOf, call, couponOf, createPrmApp, eventsOf, redemptionsOf, resetLimits, seedCoupon, seedRedemption, deliver, expiredOrder, reserve, rid, type PrmApp } from '../support/prm';

// Sửa coupon (PRM-REQ-20261006-101036227): khóa dòng, khóa lạc quan `version`, audit trước và sau cùng giao dịch.
describe('PRM sửa coupon (admin)', () => {
  let t: PrmApp;
  let admin: { id: string; cookie: string };
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); admin = await actor(t, 'admin'); });
  const patch = (id: string, body: unknown, cookie = admin.cookie) => call(t, 'patch', `/admin/coupons/${id}`, { cookie, body });
  const future = (sec: number) => new Date(t.clock.now().getTime() + sec * 1000).toISOString();

  it('PRM-TC-20261006-101036756: sửa value, max_discount, usage_limit của coupon đang chạy: 200, version 2, remaining 130, audit ghi trước và sau từng trường, không event; body không đổi gì thì 200, version giữ nguyên, không thêm audit', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', value: 10, usageLimit: 100, consumed: 20 });
    const r = await patch(id, { version: 1, value: 15, max_discount: 80000, usage_limit: 150 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ value: 15, max_discount: 80000, usage_limit: 150, version: 2, remaining: 130, consumed_count: 20 });
    const a = await auditOf(t, 'promotion.coupon.update');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', target_id: id, before: { value: 10, max_discount: null, usage_limit: 100 }, after: { value: 15, max_discount: 80000, usage_limit: 150 } });
    expect(await eventsOf(t)).toHaveLength(0);
    const same = await patch(id, { version: 2 });
    expect([same.status, same.body.version, await auditCount(t, 'promotion.coupon.update')]).toEqual([200, 2, 1]);
    const same2 = await patch(id, { version: 2, value: 15, code: 'sale10' });
    expect([same2.status, (await couponOf(t, code)).version]).toEqual([200, 2]);
    // sửa coupon đang tắt giữ nguyên trạng thái
    const off = await seedCoupon(t, { status: 'disabled' });
    const r2 = await patch(off.id, { version: 1, min_order_value: 300000 });
    expect([r2.status, r2.body.status, r2.body.min_order_value]).toEqual([200, 'disabled', 300000]);
  });

  it('PRM-TC-20261006-101036781: đổi code hoặc type bị 400 field_immutable và coupon không đổi; gửi lại đúng giá trị hiện tại (kể cả khác hoa thường) thì bỏ qua', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10' });
    for (const body of [{ version: 1, type: 'fixed' }, { version: 1, code: 'SALE20' }, { version: 1, code: '' }]) {
      const r = await patch(id, body);
      expect([JSON.stringify(body), r.status, r.body.code]).toEqual([JSON.stringify(body), 400, 'field_immutable']);
    }
    expect((await couponOf(t, code)).version).toBe(1);
    const ok = await patch(id, { version: 1, code: 'SALE10', type: 'percentage', value: 12 });
    expect([ok.status, ok.body.value, ok.body.version]).toEqual([200, 12, 2]);
    expect((await patch(id, { version: 2, code: ' sale10 ' })).status).toBe(200);
  });

  it('PRM-TC-20261006-101036805: sửa với version cũ là 409 version_mismatch kèm current_version, không ghi đè bản của người kia, không audit mới', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', value: 12, version: 3 });
    const r = await patch(id, { version: 2, value: 20 });
    expect([r.status, r.body.type, r.body.code, r.body.current_version]).toEqual([409, 'urn:ecom:error:version_mismatch', 'version_mismatch', 3]);
    expect(await couponOf(t, code)).toMatchObject({ value: '12', version: 3 });
    expect(await auditCount(t, 'promotion.coupon.update')).toBe(0);
    expect((await patch(id, { value: 20 })).status).toBe(400); // thiếu version
    expect((await patch(id, { version: 3, value: 20 })).status).toBe(200);
  });

  it('PRM-TC-20261006-101036829: usage_limit nhỏ hơn số đang dùng là 409 usage_limit_below_used kèm used; coupon expired, exhausted, quá hạn chưa qua job là 409 coupon_not_editable; đã xóa hay không có là 404', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', usageLimit: 100, consumed: 30, reserved: 5 });
    const r = await patch(id, { version: 1, usage_limit: 34 });
    expect([r.status, r.body.code, r.body.used]).toEqual([409, 'usage_limit_below_used', 35]);
    expect(await couponOf(t, code)).toMatchObject({ usage_limit: 100, version: 1 });
    for (const status of ['expired', 'exhausted'] as const) {
      const c = await seedCoupon(t, { status });
      expect([status, (await patch(c.id, { version: 1, value: 5 })).body.code]).toEqual([status, 'coupon_not_editable']);
    }
    const late = await seedCoupon(t, { status: 'active', expiresInSec: -300 }); // quá hạn mà job chưa chạy: coi như hết hạn (BR5)
    expect((await patch(late.id, { version: 1, value: 5 })).body.code).toBe('coupon_not_editable');
    const del = await seedCoupon(t, { status: 'deleted' });
    for (const id404 of [del.id, randomUUID(), 'not-a-uuid']) {
      const n = await patch(id404, { version: 1, value: 5 });
      expect([n.status, n.body.type]).toEqual([404, 'urn:ecom:error:not-found']);
    }
    expect((await patch(del.id, { version: 1, value: 5 })).body.detail).toBe((await patch(randomUUID(), { version: 1, value: 5 })).body.detail); // hai trường hợp không phân biệt được
  });

  it('PRM-TC-20261006-101036858: usage_limit đúng bằng số đang dùng được (200), coupon hết chỗ nhưng chưa exhausted nên evaluate trả coupon_exhausted; nhả một lượt thì dùng lại được', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', usageLimit: 100, consumed: 30, reserved: 5 });
    const r = await patch(id, { version: 1, usage_limit: 35 });
    expect([r.status, r.body.usage_limit, r.body.remaining, r.body.status]).toEqual([200, 35, 0, 'active']);
    const user = rid();
    expect(await t.prm.evaluate({ code, user_id: user, items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_exhausted' });
    expect((await couponOf(t, code)).status).toBe('active');
    // nhả một lượt reserved (đơn hủy): remaining thành 1 và evaluate thành công
    const red = await seedRedemption(t, id, { status: 'reserved' });
    await deliver(t, 'OrderExpired', expiredOrder(red.order));
    expect(await t.prm.evaluate({ code, user_id: user, items_subtotal: 300000 })).toMatchObject({ ok: true, discount_amount: 30000 });
    expect(await redemptionsOf(t, id)).toHaveLength(1);
  });

  it('PRM-TC-20261006-101036882: hai admin sửa đồng thời cùng version (50 lần): đúng một 200 (version 2), một 409 version_mismatch, giá trị cuối là của bên thắng, đúng một dòng audit', async () => {
    for (let i = 0; i < 50; i++) {
      await truncateAll(t.prisma);
      const a = await actor(t, 'admin'), b = await actor(t, 'admin', 'admin2@shop.vn');
      const { id, code } = await seedCoupon(t, { code: 'SALE10', value: 10 });
      const rs = await Promise.all([patch(id, { version: 1, value: 11 }, a.cookie), patch(id, { version: 1, value: 12 }, b.cookie)]);
      expect([i, rs.map((r) => r.status).sort()]).toEqual([i, [200, 409]]);
      const win = rs.find((r) => r.status === 200)!, lose = rs.find((r) => r.status === 409)!;
      expect([win.body.version, lose.body.code]).toEqual([2, 'version_mismatch']);
      const row = await couponOf(t, code);
      expect([Number(row.value), row.version]).toEqual([win.body.value, 2]);
      expect([11, 12]).toContain(Number(row.value));
      expect((await auditOf(t, 'promotion.coupon.update')).length).toBe(1);
    }
  }, 180_000);

  it('PRM-TC-20261006-130100202: sửa per_user_limit (đổi, bỏ giới hạn bằng null, 0 bị 400); hạ thấp dưới số đã có không thu hồi lượt nào nhưng reserve kế tiếp bị per_user_limit_reached', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', usageLimit: 100, perUser: 2, consumed: 1, reserved: 1 });
    const u1 = rid();
    const r1 = await seedRedemption(t, id, { user: u1, status: 'reserved', amount: 30000 }), r2 = await seedRedemption(t, id, { user: u1, status: 'consumed', amount: 25000 });
    const r = await patch(id, { version: 1, per_user_limit: 1 });
    expect([r.status, r.body.per_user_limit, r.body.version]).toEqual([200, 1, 2]);
    expect((await auditOf(t, 'promotion.coupon.update'))[0]).toMatchObject({ before: { per_user_limit: 2 }, after: { per_user_limit: 1 } });
    expect((await redemptionsOf(t, id)).map((x) => [x.id, x.status, x.amount]).sort()).toEqual([[r1.id, 'reserved', '30000'], [r2.id, 'consumed', '25000']].sort());
    expect(await couponOf(t, code)).toMatchObject({ consumed_count: 1, reserved_count: 1 });
    expect(await reserve(t, { code, user_id: u1, order_id: rid() })).toEqual({ ok: false, reason: 'per_user_limit_reached', limit: 1, used: 2 });
    const unl = await patch(id, { version: 2, per_user_limit: null });
    expect([unl.status, unl.body.per_user_limit, unl.body.version]).toEqual([200, null, 3]);
    const bad = await patch(id, { version: 3, per_user_limit: 0 });
    expect([bad.status, bad.body.errors[0].field, (await couponOf(t, code)).version]).toEqual([400, 'per_user_limit', 3]);
  });

  it('PRM-TC-20261006-101036756 (bổ sung): max_discount null bỏ trần, coupon fixed gửi max_discount là 400, value ngoài miền theo loại, expires_at quá khứ 400, đổi hạn mới thì 200; lượt đã giữ không đổi amount khi đổi value', async () => {
    const pct = await seedCoupon(t, { type: 'percentage', value: 10, max: 50000 });
    expect((await patch(pct.id, { version: 1, max_discount: null })).body.max_discount).toBeNull();
    expect((await patch(pct.id, { version: 2, value: 101 })).body.errors[0].field).toBe('value');
    expect((await patch(pct.id, { version: 2, expires_at: new Date(t.clock.now().getTime() - 1000).toISOString() })).body.errors[0].field).toBe('expires_at');
    const nxt = future(30 * 86400);
    expect((await patch(pct.id, { version: 2, expires_at: nxt })).body.expires_at).toBe(nxt);
    const fixed = await seedCoupon(t, { type: 'fixed', value: 50000 });
    const r = await patch(fixed.id, { version: 1, max_discount: 20000 });
    expect([r.status, r.body.errors[0].field]).toEqual([400, 'max_discount']);
    expect((await patch(fixed.id, { version: 1, max_discount: null })).status).toBe(200);
    expect((await patch(fixed.id, { version: 1 })).status).toBe(200);
    const held = await seedCoupon(t, { code: 'HOLD10', value: 10, reserved: 1 });
    const red = await seedRedemption(t, held.id, { amount: 40000 });
    expect((await patch(held.id, { version: 1, value: 5 })).status).toBe(200);
    expect((await redemptionsOf(t, held.id)).find((x) => x.id === red.id)!.amount).toBe('40000');
    expect((await patch(held.id, { version: 2, status: 'expired' })).status).toBe(400); // trường lạ
    await resetLimits(t);
  });

  it('PRM-TC-20261006-101036805 (bổ sung SB-07): staff, customer và chưa đăng nhập không sửa được (403, 403, 401); thiếu Origin là 403 csrf_failed', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10' });
    const staff = await actor(t, 'staff'), cust = await actor(t, 'customer');
    expect([(await patch(id, { version: 1, value: 5 }, staff.cookie)).status, (await patch(id, { version: 1, value: 5 }, cust.cookie)).status]).toEqual([403, 403]);
    expect((await call(t, 'patch', `/admin/coupons/${id}`, { body: { version: 1, value: 5 } })).status).toBe(401);
    expect((await call(t, 'patch', `/admin/coupons/${id}`, { cookie: admin.cookie, origin: null, body: { version: 1, value: 5 } })).body.type).toBe('urn:ecom:error:csrf_failed');
    expect(await couponOf(t, code)).toMatchObject({ value: '10', version: 1 });
  });
});
