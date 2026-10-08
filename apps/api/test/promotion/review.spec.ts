import { truncateAll } from '../support/db';
import { actor, call, cancelled, confirmed, countOf, couponOf, createPrmApp, deliver, eventsOf, expiredOrder, paid, q, redemptionOfOrder, redemptionsOf, reserve, resetLimits, rid, seedCoupon, seedRedemption, type PrmApp } from '../support/prm';

// Thăm dò của reviewer độc lập (REV-PRM-nn trong spec/epics/PRM/review.md): các ca người implement chưa nghĩ tới, giữ lại làm hồi quy. PostgreSQL thật, nhiều giao dịch song song.
describe('PRM review: thăm dò của reviewer', () => {
  let t: PrmApp;
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });
  const ev = (code: string, user: string, count?: boolean) => t.prm.evaluate({ code, user_id: user, items_subtotal: 300000, ...(count === undefined ? {} : { count_attempt: count }) });

  it('REV-PRM-01 (hồi quy của reviewer): giao dịch của CHK quay lui sau khi reserve thành công thì không còn lượt, bộ đếm về 0, lượt cuối còn dùng được; reserve lỗi rồi CHK cam kết cũng không để lại dòng nào', async () => {
    await seedCoupon(t, { code: 'FLASH1', usageLimit: 1 });
    await expect(t.tx.run(async (tx) => {
      expect(await t.evaluator.reserve({ order_id: rid(), user_id: rid(), code: 'FLASH1', items_subtotal: 100000 }, tx)).toMatchObject({ ok: true });
      throw new Error('chk quay lui');
    })).rejects.toThrow('chk quay lui');
    expect([(await couponOf(t, 'FLASH1')).reserved_count, await countOf(t, 'coupon_redemptions')]).toEqual([0, 0]);
    expect(await reserve(t, { code: 'FLASH1' })).toMatchObject({ ok: true });
  });

  it('REV-PRM-02 (hồi quy của reviewer): tải hỗn hợp với usage_limit nhỏ (6): trạng thái coupon luôn khớp bộ đếm (exhausted khi và chỉ khi consumed = usage_limit, không bao giờ active khi đã tiêu thụ đủ), mỗi lượt từng consumed có đúng một CouponRedeemed, event giao lặp và đảo thứ tự không đếm đôi', async () => {
    await seedCoupon(t, { code: 'TINY06', usageLimit: 6 });
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const dups = new Map<string, string>();
    const ops = Array.from({ length: 40 }, async (_v, i) => {
      const order = rid(), user = rid();
      if (!(await reserve(t, { code: 'TINY06', order_id: order, user_id: user })).ok) return;
      await new Promise((res) => setTimeout(res, rnd(10)));
      const send = (type: string, payload: Record<string, unknown>) => { const key = `${type}:${order}`; if (!dups.has(key)) dups.set(key, rid()); return deliver(t, type, payload, dups.get(key)); };
      const steps = [
        () => send('PaymentSucceeded', paid(order, user)), () => send('OrderConfirmed', confirmed(order, user)), () => send('OrderCancelled', cancelled(order, { user })), () => send('OrderExpired', expiredOrder(order, user)),
      ].sort(() => Math.random() - 0.5).slice(0, 1 + (i % 3));
      await Promise.all(steps.map((s) => s())); // đồng thời, thứ tự ngẫu nhiên, có thể cùng event_id gọi hai lần ở lượt sau
      if (i % 4 === 0) await Promise.all(steps.map((s) => s()));
    });
    await Promise.all(ops);
    const c = await couponOf(t, 'TINY06');
    const rows = await redemptionsOf(t, c.id);
    const n = (s: string) => rows.filter((r) => r.status === s).length;
    expect([c.consumed_count, c.reserved_count]).toEqual([n('consumed'), n('reserved')]);
    expect(c.consumed_count + c.reserved_count).toBeLessThanOrEqual(6);
    expect(c.status === 'exhausted').toBe(c.consumed_count === 6);
    const everConsumed = rows.filter((r) => r.consumed_at !== null).map((r) => r.id).sort();
    const events = (await eventsOf(t, 'CouponRedeemed')).map((e) => e.aggregate_id).sort();
    expect(events).toEqual(everConsumed);
    expect(await t.jobs.reconcileOnce()).toEqual({ mismatched: 0 });
  }, 120_000);

  // REV-PRM-03 (SB-14, ADR-014): trước đây `check` rồi `hitCounter` không nguyên tử nên 40 lời gọi sai song song đều qua cổng. Nay `evaluate` đếm bằng `RateLimitService.take` (một câu UPSERT) TRƯỚC khi tra mã.
  it('PRM-TC-20261007-144433497 (REV-PRM-03): 40 lời gọi mã sai song song của một người chỉ được trả lời coupon_not_found đúng 10 lần, 30 lần còn lại too_many_attempts; mã đúng sau đó cũng bị chặn; trộn mã đúng và sai song song không vượt 10 lần sai (SB-14, PRM-REQ-20261006-101036327 BR7)', async () => {
    await seedCoupon(t, { code: 'SALE10' });
    const user = rid();
    const rs = await Promise.all(Array.from({ length: 40 }, (_v, i) => ev(`NOPE${1000 + i}`, user)));
    expect(rs.filter((r) => !r.ok && r.reason === 'coupon_not_found')).toHaveLength(10);
    const blocked = rs.filter((r) => !r.ok && r.reason === 'too_many_attempts');
    expect(blocked).toHaveLength(30);
    for (const b of blocked) expect(b.ok === false && 'retry_after_seconds' in b && b.retry_after_seconds > 0).toBe(true);
    expect(await ev('SALE10', user)).toMatchObject({ ok: false, reason: 'too_many_attempts' });

    const other = rid();
    const mixed = await Promise.all(Array.from({ length: 40 }, (_v, i) => (i % 2 ? ev('SALE10', other) : ev(`NOPE${2000 + i}`, other))));
    expect(mixed.filter((r) => !r.ok && r.reason === 'coupon_not_found').length).toBeLessThanOrEqual(10);
  });

  it('REV-PRM-04: sửa coupon qua API với version cũ: đổi giá trị thì 409 version_mismatch kèm current_version, không đổi giá trị thì 200 không đổi version và không audit (PRM-REQ-20261006-101036227 BR10)', async () => {
    const admin = await actor(t, 'admin');
    const { id } = await seedCoupon(t, { code: 'SALE10', version: 5 });
    const same = await call(t, 'patch', `/admin/coupons/${id}`, { cookie: admin.cookie, body: { version: 1, value: 10 } });
    expect([same.status, same.body.version]).toEqual([200, 5]);
    const stale = await call(t, 'patch', `/admin/coupons/${id}`, { cookie: admin.cookie, body: { version: 1, value: 11 } });
    expect([stale.status, stale.body.code, stale.body.current_version]).toEqual([409, 'version_mismatch', 5]);
    expect((await couponOf(t, 'SALE10')).value).toBe('10');
    expect(await countOf(t, 'audit_logs', `action = 'promotion.coupon.update'`)).toBe(0);
  });

  it('REV-PRM-05: biên của tiền giảm qua evaluate và reserve: 100% của 1 tỷ là đúng 1 tỷ (khớp CHECK amount), cố định 1 tỷ cho tạm tính 1 là 1, làm tròn xuống (33% của 3 là no_discount), tạm tính 1 tỷ cộng 1, 0, âm, thập phân, chuỗi, 2^53 là invalid_subtotal', async () => {
    await seedCoupon(t, { code: 'PCT100', value: 100 });
    await seedCoupon(t, { code: 'FIXBIG', type: 'fixed', value: 1_000_000_000 });
    await seedCoupon(t, { code: 'PCT33', value: 33 });
    const u = rid();
    const at = (code: string, s: unknown) => t.prm.evaluate({ code, user_id: u, items_subtotal: s as number });
    expect(await at('PCT100', 1_000_000_000)).toMatchObject({ ok: true, discount_amount: 1_000_000_000 });
    expect(await at('FIXBIG', 1)).toMatchObject({ ok: true, discount_amount: 1 });
    expect(await at('PCT33', 3)).toEqual({ ok: false, reason: 'no_discount' });
    expect(await at('PCT33', 4)).toMatchObject({ ok: true, discount_amount: 1 }); // 1,32 làm tròn xuống
    expect(await at('PCT33', 100)).toMatchObject({ ok: true, discount_amount: 33 });
    for (const s of [1_000_000_001, 0, -1, 1.5, '5', 2 ** 53, NaN]) expect([String(s), await at('PCT100', s)]).toEqual([String(s), { ok: false, reason: 'invalid_subtotal' }]);
    expect(await reserve(t, { code: 'PCT100', items_subtotal: 1_000_000_000 })).toMatchObject({ ok: true, amount: 1_000_000_000 });
    expect((await q<{ amount: string }>(t, `SELECT amount::text FROM coupon_redemptions`))[0].amount).toBe('1000000000');
  });

  it('REV-PRM-07: reserve đúng giờ hạn (now = expires_at) là coupon_expired và không để lại lượt hay bộ đếm; sớm hơn 1 ms thì giữ được', async () => {
    await seedCoupon(t, { code: 'EDGE10', expiresInSec: 3600 });
    const exp = (await couponOf(t, 'EDGE10')).expires_at;
    expect(await reserve(t, { code: 'EDGE10' }, { now: exp })).toEqual({ ok: false, reason: 'coupon_expired' });
    expect([(await couponOf(t, 'EDGE10')).reserved_count, await countOf(t, 'coupon_redemptions')]).toEqual([0, 0]);
    expect(await reserve(t, { code: 'EDGE10' }, { now: new Date(exp.getTime() - 1) })).toMatchObject({ ok: true });
  });

  it.each(['disabled', 'expired', 'deleted'] as const)('REV-PRM-08: lượt của coupon %s được tiêu thụ rồi trả lại mà status của coupon giữ nguyên (không thành exhausted khi đủ lượt, không thành active khi trả lượt)', async (status) => {
    const { id } = await seedCoupon(t, { code: 'KEEP10', usageLimit: 1, reserved: 1, status });
    const { order, user } = await seedRedemption(t, id);
    const state = async () => { const c = await couponOf(t, 'KEEP10'); return [c.consumed_count, c.reserved_count, c.status]; };
    await deliver(t, 'PaymentSucceeded', paid(order, user));
    expect(await state()).toEqual([1, 0, status]);
    await deliver(t, 'OrderCancelled', cancelled(order, { was_paid: true, user }));
    expect(await state()).toEqual([0, 0, status]);
  });

  it('PRM-TC-20261007-144433185 (REV-PRM-09): job đối soát báo cả bộ đếm reserved_count lệch số dòng reserved (không chỉ consumed_count), chỉ báo không sửa', async () => {
    const { id } = await seedCoupon(t, { code: 'RECON9', usageLimit: 5, reserved: 2 });
    await seedRedemption(t, id); // chỉ một dòng reserved, bộ đếm ghi 2
    expect(await t.jobs.reconcileOnce()).toEqual({ mismatched: 1 });
    expect((await couponOf(t, 'RECON9')).reserved_count).toBe(2);
  });

  it('REV-PRM-10: tạo coupon với max_discount 0 hoặc âm là 400 nêu trường max_discount (không lọt xuống CHECK của CSDL thành 500)', async () => {
    const admin = await actor(t, 'admin');
    for (const max_discount of [0, -1]) {
      const r = await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body: { code: 'MAXZ10', type: 'percentage', value: 10, max_discount, expires_at: new Date(Date.now() + 86_400_000).toISOString(), usage_limit: 5 } });
      expect([max_discount, r.status, r.body.errors?.map((e: { field: string }) => e.field)]).toEqual([max_discount, 400, ['max_discount']]);
    }
    expect(await countOf(t, 'coupons')).toBe(0);
  });

  it('REV-PRM-11: mọi endpoint quản trị chung một bộ đếm bậc D: sau 30 lần gọi list, mỗi route khác (tạo, chi tiết, sửa, xóa, tắt, bật) đều nhận 429 kèm Retry-After', async () => {
    const admin = await actor(t, 'admin');
    const { id } = await seedCoupon(t, { code: 'LIM10' });
    await resetLimits(t);
    for (let i = 0; i < 30; i++) expect((await call(t, 'get', '/admin/coupons', { cookie: admin.cookie })).status).toBe(200);
    const body = { code: 'LIMIT10', type: 'fixed', value: 1000, expires_at: new Date(Date.now() + 86_400_000).toISOString(), usage_limit: 5 };
    const rs = await Promise.all([
      call(t, 'get', '/admin/coupons', { cookie: admin.cookie }), call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body }), call(t, 'get', '/admin/coupons/' + id, { cookie: admin.cookie }),
      call(t, 'patch', '/admin/coupons/' + id, { cookie: admin.cookie, body: { version: 1, value: 20 } }), call(t, 'delete', '/admin/coupons/' + id, { cookie: admin.cookie }),
      call(t, 'post', '/admin/coupons/' + id + '/disable', { cookie: admin.cookie }), call(t, 'post', '/admin/coupons/' + id + '/enable', { cookie: admin.cookie }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([429, 429, 429, 429, 429, 429, 429]);
    for (const r of rs) expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await couponOf(t, 'LIM10')).status).toBe('active'); // không route nào chạy
  });

  it('REV-PRM-12: reserve lặp của CÙNG người, CÙNG mã, CÙNG đơn sau khi lượt đã nhả (đơn hủy hay hết hạn) là order_already_has_coupon, lượt không sống lại và bộ đếm không đổi', async () => {
    await seedCoupon(t, { code: 'REL10', usageLimit: 3 });
    const order = rid(), user = rid();
    expect(await reserve(t, { code: 'REL10', order_id: order, user_id: user })).toMatchObject({ ok: true });
    await deliver(t, 'OrderCancelled', cancelled(order, { user }));
    expect(await reserve(t, { code: 'REL10', order_id: order, user_id: user })).toEqual({ ok: false, reason: 'order_already_has_coupon' });
    expect([(await couponOf(t, 'REL10')).reserved_count, (await redemptionOfOrder(t, order)).status]).toEqual([0, 'released']);
  });

  it('REV-PRM-13: reserve mã đã xóa mềm hoặc đang tắt là coupon_not_found (cùng lỗi với mã không có), không để lại lượt hay bộ đếm', async () => {
    await seedCoupon(t, { code: 'GONE10', status: 'deleted' });
    await seedCoupon(t, { code: 'OFF10', status: 'disabled' });
    for (const code of ['GONE10', 'OFF10', 'NOPE1234']) expect([code, await reserve(t, { code })]).toEqual([code, { ok: false, reason: 'coupon_not_found' }]);
    expect(await countOf(t, 'coupon_redemptions')).toBe(0);
    expect(await q(t, `SELECT 1 FROM coupons WHERE reserved_count <> 0`)).toHaveLength(0);
  });

  it('REV-PRM-14: đường chạy thật dùng giờ CSDL (không tham số now): coupon còn 5 phút vẫn dùng, sửa, bật được và job không chuyển expired; coupon đã quá hạn 5 phút bị từ chối, không sửa, không bật được và job chuyển expired kèm một CouponExpired', async () => {
    const admin = await actor(t, 'admin');
    const near = await seedCoupon(t, { code: 'NEAR10', expiresInSec: 300 }), late = await seedCoupon(t, { code: 'LATE10', expiresInSec: -300 });
    const nearOff = await seedCoupon(t, { code: 'NEAROFF', status: 'disabled', expiresInSec: 300 }), lateOff = await seedCoupon(t, { code: 'LATEOFF', status: 'disabled', expiresInSec: -300 });
    const u = rid();
    expect(await t.prm.evaluate({ code: 'NEAR10', user_id: u, items_subtotal: 100000 })).toMatchObject({ ok: true });
    expect(await t.prm.evaluate({ code: 'LATE10', user_id: u, items_subtotal: 100000 })).toEqual({ ok: false, reason: 'coupon_expired' });
    expect(await reserve(t, { code: 'NEAR10' })).toMatchObject({ ok: true });
    expect(await reserve(t, { code: 'LATE10' })).toEqual({ ok: false, reason: 'coupon_expired' });
    const patch = (id: string) => call(t, 'patch', '/admin/coupons/' + id, { cookie: admin.cookie, body: { version: 1, value: 20 } });
    expect([(await patch(near.id)).status, (await patch(late.id)).body.code]).toEqual([200, 'coupon_not_editable']);
    const enable = (id: string) => call(t, 'post', '/admin/coupons/' + id + '/enable', { cookie: admin.cookie });
    expect([(await enable(nearOff.id)).status, (await enable(lateOff.id)).body.code]).toEqual([200, 'coupon_expired']);
    expect(await t.jobs.expireOnce()).toEqual({ coupons: 2, batches: 1 }); // LATE10 và LATEOFF; NEAR10 và NEAROFF còn
    expect(await q(t, `SELECT code FROM coupons WHERE status = 'expired' ORDER BY code`)).toEqual([{ code: 'LATE10' }, { code: 'LATEOFF' }]);
    expect((await eventsOf(t, 'CouponExpired')).map((e) => e.aggregate_id).sort()).toEqual([late.id, lateOff.id].sort());
  });

  it('PRM-TC-20261007-144433343 và PRM-TC-20261007-144433185 (REV-PRM-15): hằng số mặc định của job: 501 coupon quá hạn chạy hai lô (500 rồi 1) trong một lượt; đối soát chỉ báo tối đa 1000 coupon lệch dù có 1001', async () => {
    await q(t, `INSERT INTO coupons (code, type, value, expires_at, usage_limit, created_by, created_at) SELECT 'BULK' || lpad(g::text, 5, '0'), 'fixed', 1000, now() - interval '1 hour', 5, gen_random_uuid(), now() FROM generate_series(1, 501) g`);
    expect(await t.jobs.expireOnce()).toEqual({ coupons: 501, batches: 2 });
    expect(await countOf(t, 'outbox_events', `type = 'CouponExpired'`)).toBe(501);
    await q(t, `UPDATE coupons SET status = 'active', consumed_count = 1`); // 501 lệch (không có dòng lượt)
    await q(t, `INSERT INTO coupons (code, type, value, expires_at, usage_limit, consumed_count, created_by, created_at) SELECT 'MISM' || lpad(g::text, 5, '0'), 'fixed', 1000, now() + interval '1 day', 5, 1, gen_random_uuid(), now() FROM generate_series(1, 500) g`);
    expect(await countOf(t, 'coupons', 'consumed_count = 1')).toBe(1001);
    expect(await t.jobs.reconcileOnce()).toEqual({ mismatched: 1000 });
  }, 120_000);

  it('REV-PRM-16: id có đuôi lạ sau uuid hợp lệ là 404 (không phải 500); user_id và order_id của giao diện nội bộ có đuôi lạ là invalid_argument; user_id viết HOA dùng chung bộ đếm thử sai với bản viết thường', async () => {
    const admin = await actor(t, 'admin');
    const { id } = await seedCoupon(t, { code: 'SALE10' });
    for (const bad of [id + 'x', id + ' ', id + '%0A', id.slice(0, 35)]) expect([bad, (await call(t, 'get', '/admin/coupons/' + encodeURIComponent(bad), { cookie: admin.cookie })).status]).toEqual([bad, 404]);
    expect(await t.prm.evaluate({ code: 'SALE10', user_id: id + 'x', items_subtotal: 1000 })).toEqual({ ok: false, reason: 'invalid_argument' });
    expect(await reserve(t, { code: 'SALE10', order_id: rid() + 'x' })).toEqual({ ok: false, reason: 'invalid_argument' });
    const user = rid();
    for (let i = 0; i < 10; i++) expect(await ev(`NOPE${1000 + i}`, i % 2 ? user.toUpperCase() : user)).toEqual({ ok: false, reason: 'coupon_not_found' });
    expect(await ev('SALE10', user.toUpperCase())).toMatchObject({ ok: false, reason: 'too_many_attempts' });
    expect(await ev('SALE10', user)).toMatchObject({ ok: false, reason: 'too_many_attempts' });
  });
});
