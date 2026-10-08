import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { actor, auditCount, auditOf, call, couponOf, createPrmApp, deliver, eventsOf, paid, redemptionsOf, reserve, rid, seedCoupon, seedRedemption, q, type PrmApp } from '../support/prm';

// Xóa mềm, bật và tắt coupon (PRM-REQ-20261006-101036252, PRM-REQ-20261006-101036275): khóa dòng rồi kiểm trạng thái hiện tại, audit cùng giao dịch, hai yêu cầu đua nhau chỉ một thắng.
describe('PRM xóa, bật, tắt coupon (admin)', () => {
  let t: PrmApp;
  let admin: { id: string; cookie: string };
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); admin = await actor(t, 'admin'); });
  const del = (id: string, cookie = admin.cookie) => call(t, 'delete', `/admin/coupons/${id}`, { cookie });
  const act = (id: string, what: 'enable' | 'disable', cookie = admin.cookie) => call(t, 'post', `/admin/coupons/${id}/${what}`, { cookie });
  const list = (query = '', cookie = admin.cookie) => call(t, 'get', `/admin/coupons${query}`, { cookie });

  it('PRM-TC-20261006-101036906: xóa mềm coupon đang tắt: 204, status deleted và deleted_at có giá trị, một dòng audit ghi trạng thái trước disabled, biến khỏi danh sách và chi tiết là 404, dòng vẫn còn trong bảng', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', status: 'disabled' });
    expect((await del(id)).status).toBe(204);
    expect(await couponOf(t, code)).toMatchObject({ status: 'deleted' });
    expect((await couponOf(t, code)).deleted_at).not.toBeNull();
    const a = await auditOf(t, 'promotion.coupon.delete');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', target_id: id, before: { code: 'SALE10', status: 'disabled' }, after: { status: 'deleted', consumed_count: 0, reserved_count: 0 } });
    expect((await list()).body.items.map((c: any) => c.code)).not.toContain('SALE10');
    expect((await call(t, 'get', `/admin/coupons/${id}`, { cookie: admin.cookie })).status).toBe(404);
    expect(await eventsOf(t)).toHaveLength(0);
  });

  it('PRM-TC-20261006-101036930: xóa coupon đã hết hạn hoặc hết lượt: 204 cả hai, mỗi coupon một dòng audit ghi trạng thái trước, lượt còn nguyên, xóa lần hai là 404', async () => {
    const e = await seedCoupon(t, { code: 'OLD20', status: 'expired' }), x = await seedCoupon(t, { code: 'GONE30', status: 'exhausted', usageLimit: 1, consumed: 1 });
    await seedRedemption(t, x.id, { status: 'consumed' });
    expect([(await del(e.id)).status, (await del(x.id)).status]).toEqual([204, 204]);
    const a = await auditOf(t, 'promotion.coupon.delete');
    expect(a.map((r) => r.before.status).sort()).toEqual(['exhausted', 'expired']);
    expect((await couponOf(t, 'OLD20')).status).toBe('deleted');
    expect((await redemptionsOf(t, x.id))).toHaveLength(1);
    expect((await list()).body.total).toBe(0);
    expect([(await del(e.id)).status, (await del(x.id)).status]).toEqual([404, 404]);
  });

  it('PRM-TC-20261006-101036954: xóa coupon đang có lượt giữ rồi PaymentSucceeded: lượt vẫn thành consumed, phát CouponRedeemed amount 30000, coupon vẫn deleted và lượt không bị xóa', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', reserved: 1 });
    const red = await seedRedemption(t, id, { amount: 30000 });
    expect((await del(id)).status).toBe(204);
    expect((await redemptionsOf(t, id))[0].status).toBe('reserved'); // xóa không hủy lượt đã giữ
    await deliver(t, 'PaymentSucceeded', paid(red.order, red.user));
    const r = (await redemptionsOf(t, id))[0];
    expect([r.status, r.consumed_at !== null]).toEqual(['consumed', true]);
    expect(await couponOf(t, code)).toMatchObject({ status: 'deleted', consumed_count: 1, reserved_count: 0 });
    const ev = await eventsOf(t, 'CouponRedeemed');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ coupon_id: id, order_id: red.order, amount: 30000 });
  });

  it('PRM-TC-20261006-101036977: xóa hai lần là 204 rồi 404 với đúng một dòng audit; tạo lại mã đã xóa là 409 code_taken; hai admin xóa cùng lúc (20 lần) một 204 một 404', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10' });
    expect([(await del(id)).status, (await del(id)).status]).toEqual([204, 404]);
    expect(await auditCount(t, 'promotion.coupon.delete')).toBe(1);
    const again = await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body: { code: 'SALE10', type: 'fixed', value: 5, expires_at: new Date(Date.now() + 86400_000).toISOString(), usage_limit: 1 } });
    expect([again.status, again.body.code]).toEqual([409, 'code_taken']);
    for (let i = 0; i < 20; i++) {
      await truncateAll(t.prisma);
      const a = await actor(t, 'admin'), b = await actor(t, 'admin', 'admin2@shop.vn');
      const c = await seedCoupon(t, { code: 'RACE10' });
      const rs = await Promise.all([del(c.id, a.cookie), del(c.id, b.cookie)]);
      expect([i, rs.map((r) => r.status).sort()]).toEqual([i, [204, 404]]);
      expect(await auditCount(t, 'promotion.coupon.delete')).toBe(1);
    }
  }, 120_000);

  it('PRM-TC-20261006-101037001: tắt rồi bật lại coupon: disable 200 (disabled, version 5), evaluate trả coupon_not_found, enable 200 (active, version 6), evaluate thành công 30000; mỗi lần một dòng audit, không event', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', version: 4, consumed: 10 });
    const user = rid();
    const off = await act(id, 'disable');
    expect([off.status, off.body.status, off.body.version]).toEqual([200, 'disabled', 5]);
    expect(await t.prm.evaluate({ code, user_id: user, items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_not_found' });
    const on = await act(id, 'enable');
    expect([on.status, on.body.status, on.body.version]).toEqual([200, 'active', 6]);
    expect(await t.prm.evaluate({ code, user_id: user, items_subtotal: 300000 })).toMatchObject({ ok: true, discount_amount: 30000 });
    expect([(await auditOf(t, 'promotion.coupon.disable')).length, (await auditOf(t, 'promotion.coupon.enable')).length, (await eventsOf(t)).length]).toEqual([1, 1, 0]);
  });

  it('PRM-TC-20261006-101037026: bật coupon đã quá hạn (job chưa chạy) là 409 coupon_expired, bật coupon hết chỗ là 409 coupon_exhausted; cả hai vẫn disabled và không đổi version', async () => {
    const old = await seedCoupon(t, { code: 'OLD1', status: 'disabled', expiresInSec: -3600 }), full = await seedCoupon(t, { code: 'FULL1', status: 'disabled', usageLimit: 10, consumed: 10 });
    const a = await act(old.id, 'enable'), b = await act(full.id, 'enable');
    expect([a.status, a.body.code, b.status, b.body.code]).toEqual([409, 'coupon_expired', 409, 'coupon_exhausted']);
    expect([(await couponOf(t, 'OLD1')).status, (await couponOf(t, 'FULL1')).status, (await couponOf(t, 'OLD1')).version]).toEqual(['disabled', 'disabled', 1]);
    expect(await auditCount(t, 'promotion.coupon.enable')).toBe(0);
    // sau khi job chạy, OLD1 thành expired và bật nhận invalid_transition (TC ...642 kiểm job)
    await t.jobs.expireOnce();
    expect((await act(old.id, 'enable')).body.code).toBe('invalid_transition');
  });

  it('PRM-TC-20261006-101037049: bật coupon đang chạy và tắt coupon đã hết hạn là 409 invalid_transition; coupon đã xóa và id không tồn tại là cùng một 404 (trừ trace_id)', async () => {
    const a = await seedCoupon(t, { status: 'active' }), b = await seedCoupon(t, { status: 'expired' }), c = await seedCoupon(t, { status: 'deleted' }), x = await seedCoupon(t, { status: 'exhausted' });
    expect([(await act(a.id, 'enable')).body.code, (await act(b.id, 'disable')).body.code, (await act(x.id, 'disable')).body.code, (await act(x.id, 'enable')).body.code]).toEqual(['invalid_transition', 'invalid_transition', 'invalid_transition', 'invalid_transition']);
    const off = await seedCoupon(t, { status: 'disabled' });
    expect((await act(off.id, 'disable')).body.code).toBe('invalid_transition'); // đã tắt, tắt lại cũng 409
    const [n1, n2] = [await act(c.id, 'disable'), await act(randomUUID(), 'disable')];
    expect([n1.status, n2.status]).toEqual([404, 404]);
    const strip = ({ trace_id: _trace, ...rest }: Record<string, unknown>) => rest;
    expect(strip(n1.body)).toEqual(strip(n2.body));
    expect([(await couponOf(t, (await q<{ code: string }>(t, `SELECT code FROM coupons WHERE id = '${a.id}'`))[0].code)).status, await auditCount(t)]).toEqual(['active', 0]);
  });

  it('PRM-TC-20261006-101037073: hai admin cùng tắt một coupon (50 lần): đúng một 200 và một 409 invalid_transition, một dòng audit, version tăng đúng 1', async () => {
    for (let i = 0; i < 50; i++) {
      await truncateAll(t.prisma);
      const a = await actor(t, 'admin'), b = await actor(t, 'admin', 'admin2@shop.vn');
      const { id, code } = await seedCoupon(t, { code: 'SALE10' });
      const rs = await Promise.all([act(id, 'disable', a.cookie), act(id, 'disable', b.cookie)]);
      expect([i, rs.map((r) => r.status).sort()]).toEqual([i, [200, 409]]);
      expect([rs.find((r) => r.status === 409)!.body.code, (await couponOf(t, code)).version, await auditCount(t, 'promotion.coupon.disable')]).toEqual(['invalid_transition', 2, 1]);
    }
  }, 180_000);

  it('PRM-TC-20261006-101037097: bật coupon khi còn đúng một chỗ trống: 200, active, remaining 1; hết chỗ (consumed 8, reserved 2) thì 409 coupon_exhausted; sau khi giữ một lượt remaining là 0', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10', status: 'disabled', usageLimit: 10, consumed: 7, reserved: 2 });
    const r = await act(id, 'enable');
    expect([r.status, r.body.status, r.body.remaining]).toEqual([200, 'active', 1]);
    expect(await t.prm.evaluate({ code, user_id: rid(), items_subtotal: 100000 })).toMatchObject({ ok: true });
    expect(await reserve(t, { code })).toMatchObject({ ok: true });
    expect((await call(t, 'get', `/admin/coupons/${id}`, { cookie: admin.cookie })).body.remaining).toBe(0);
    const full = await seedCoupon(t, { status: 'disabled', usageLimit: 10, consumed: 8, reserved: 2 });
    expect((await act(full.id, 'enable')).body.code).toBe('coupon_exhausted');
  });

  it('PRM-TC-20261006-101036906 (bổ sung SB-07): staff, customer và chưa đăng nhập không xóa, bật, tắt được (403, 403, 401), coupon không đổi', async () => {
    const { id, code } = await seedCoupon(t, { code: 'SALE10' });
    const staff = await actor(t, 'staff'), cust = await actor(t, 'customer');
    for (const cookie of [staff.cookie, cust.cookie]) {
      expect([(await del(id, cookie)).status, (await act(id, 'disable', cookie)).status, (await act(id, 'enable', cookie)).status]).toEqual([403, 403, 403]);
    }
    expect([(await call(t, 'delete', `/admin/coupons/${id}`)).status, (await call(t, 'post', `/admin/coupons/${id}/disable`)).status]).toEqual([401, 401]);
    expect(await couponOf(t, code)).toMatchObject({ status: 'active', version: 1 });
    expect(await auditCount(t)).toBe(0);
  });
});
