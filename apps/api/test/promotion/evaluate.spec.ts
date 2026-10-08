import { truncateAll } from '../support/db';
import { medianPairMs } from '../support/auth';
import { countOf, createPrmApp, couponOf, deliver, paid, q, redemptionsOf, reserve, rid, seedCoupon, seedRedemption, snapshotTables, type PrmApp } from '../support/prm';

// Kiểm mã qua giao diện nội bộ `PromotionApi.evaluate` (PRM-REQ-20261006-101036327, ...400): chỉ đọc, thứ tự kiểm cố định, một lỗi chung cho mã không có, đang tắt và đã xóa, bộ đếm thử sai ở kho PostgreSQL của platform.
describe('PRM evaluate: kiểm mã', () => {
  let t: PrmApp;
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });
  const ev = (code: string, o: { user?: string; subtotal?: unknown; count?: boolean } = {}) =>
    t.prm.evaluate({ code, user_id: o.user ?? rid(), items_subtotal: ('subtotal' in o ? o.subtotal : 300000) as number, ...(o.count === undefined ? {} : { count_attempt: o.count }) });
  const wrongHits = async (user: string): Promise<number> =>
    (await q<{ count: number }>(t, `SELECT coalesce(sum(count), 0)::int AS count FROM rate_limit_counters WHERE bucket LIKE 'ctr:prm:notfound:${user}%'`))[0].count;
  /** Đặt đồng hồ giả vào đầu một cửa sổ cố định 10 phút (cộng `offsetSec`), để 10 lần sai nằm trọn một cửa sổ. */
  const windowStart = (offsetSec = 1): Date => { const d = new Date(Math.ceil(Date.now() / 600_000) * 600_000 + offsetSec * 1000); t.clock.set(d); return d; };

  it('PRM-TC-20261006-101037240: tra mã hợp lệ có khoảng trắng và chữ thường trả ok, code SALE10, type percentage, discount_amount 30000; hai bảng coupons và coupon_redemptions không đổi', async () => {
    await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000, usageLimit: 100 });
    const before = await snapshotTables(t);
    const r = await ev(' sale10 ');
    expect(r).toMatchObject({ ok: true, code: 'SALE10', type: 'percentage', discount_amount: 30000 });
    expect(typeof (r as { coupon_id: string }).coupon_id).toBe('string');
    expect(await snapshotTables(t)).toBe(before);
    expect(await countOf(t, 'coupon_redemptions')).toBe(0);
  });

  it('PRM-TC-20261006-101037263: mã không tồn tại, đang tắt và đã xóa trả cùng một lỗi coupon_not_found với nội dung giống hệt nhau; thời gian phản hồi không có khác biệt có hệ thống (đo xen kẽ, 100 cặp)', async () => {
    await seedCoupon(t, { code: 'OFF10', status: 'disabled' });
    await seedCoupon(t, { code: 'DEL10', status: 'deleted' });
    const rs = [await ev('NOPE1234'), await ev('OFF10'), await ev('DEL10'), await ev('nope1234'), await ev('x')];
    for (const r of rs) expect(r).toStrictEqual({ ok: false, reason: 'coupon_not_found' }); // cùng các trường, không chi tiết thêm
    // mỗi mã sai ghi đúng một lần vào bộ đếm của người dùng, kể cả mã đang tắt và đã xóa (không phân biệt được qua bộ đếm)
    const user = rid();
    for (const c of ['NOPE1234', 'OFF10', 'DEL10']) await ev(c, { user });
    expect(await wrongHits(user)).toBe(3);
    // thời gian: người dùng mới mỗi lần để không chạm bộ đếm 10 lần; hai nhánh đo xen kẽ từng cặp (không đo tuần tự), trung vị lệch dưới 30%
    const run = (c: string) => () => ev(c);
    const [missing, off] = await medianPairMs(100, run('NOPE1234'), run('OFF10'));
    const [missing2, del] = await medianPairMs(100, run('NOPE1235'), run('DEL10'));
    expect(Math.abs(missing - off) / Math.max(missing, off)).toBeLessThan(0.3);
    expect(Math.abs(missing2 - del) / Math.max(missing2, del)).toBeLessThan(0.3);
  }, 60_000);

  it('PRM-TC-20261006-101037286: tạm tính không hợp lệ (0, -5000, 100.5, chuỗi, thiếu, NaN, vượt 1.000.000.000) đều là invalid_subtotal, đứng trước mọi kiểm tra khác và không đụng bộ đếm thử sai', async () => {
    await seedCoupon(t, { code: 'SALE10' });
    const user = rid();
    for (const subtotal of [0, -5000, 100.5, '300000', undefined, NaN, Infinity, 1_000_000_001, null, {}]) {
      expect([String(subtotal), await ev('SALE10', { user, subtotal })]).toEqual([String(subtotal), { ok: false, reason: 'invalid_subtotal' }]);
      expect(await ev('NOPE1234', { user, subtotal })).toEqual({ ok: false, reason: 'invalid_subtotal' }); // không tra coupon nên không tính lượt sai
    }
    expect(await wrongHits(user)).toBe(0);
    expect(await t.prm.evaluate(undefined as never)).toEqual({ ok: false, reason: 'invalid_subtotal' });
    // đầu vào sai hình dạng khác: đóng, không ném
    expect(await t.prm.evaluate({ code: 'SALE10', user_id: 'not-a-uuid', items_subtotal: 1000 })).toEqual({ ok: false, reason: 'invalid_argument' });
    expect(await t.prm.evaluate({ code: 5 as never, user_id: rid(), items_subtotal: 1000 })).toEqual({ ok: false, reason: 'invalid_argument' });
    expect(await t.prm.evaluate({ code: 'SALE10', user_id: rid(), items_subtotal: 1000, amount: 1 } as never)).toEqual({ ok: false, reason: 'invalid_argument' });
    expect(await t.prm.evaluate({ code: 'SALE10', user_id: rid(), items_subtotal: 1000, count_attempt: 'no' as never })).toEqual({ ok: false, reason: 'invalid_argument' });
  });

  it('PRM-TC-20261006-101037309: lần sai thứ 10 trả coupon_not_found, mã đúng ngay sau trả too_many_attempts kèm retry_after_seconds trong (0, giây còn lại của cửa sổ], người dùng khác bình thường, sang cửa sổ mới (đồng hồ giả) dùng lại được', async () => {
    await seedCoupon(t, { code: 'SALE10' });
    const t0 = windowStart(), [u1, u2] = [rid(), rid()];
    for (let i = 0; i < 9; i++) expect([i, (await ev(`BAD${i}XX`, { user: u1 })).ok]).toEqual([i, false]);
    t.clock.set(new Date(t0.getTime() + 9 * 60_000)); // T0 + 9 phút
    expect(await ev('BAD10', { user: u1 })).toEqual({ ok: false, reason: 'coupon_not_found' }); // lần sai thứ 10 vẫn là not_found
    const blocked = await ev('SALE10', { user: u1 });
    expect(blocked).toMatchObject({ ok: false, reason: 'too_many_attempts' });
    const wait = (blocked as { retry_after_seconds: number }).retry_after_seconds;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60 - 1); // còn dưới 1 phút tới hết cửa sổ 10 phút
    expect(await ev('NOPE9999', { user: u1 })).toMatchObject({ reason: 'too_many_attempts' }); // chặn cả mã sai
    expect((await ev('SALE10', { user: u2 })).ok).toBe(true);
    t.clock.set(new Date(t0.getTime() + 10 * 60_000 + 1000)); // sang cửa sổ kế tiếp
    expect((await ev('SALE10', { user: u1 })).ok).toBe(true);
    expect(await wrongHits(u1)).toBe(12); // cửa sổ cũ vẫn còn dòng (job dọn của platform xóa sau): 10 lần sai cộng 2 lần bị chặn (`take` tăng cả lần vượt ngưỡng), cửa sổ mới 0
  });

  it('PRM-TC-20261006-101037333: chuẩn hóa mã nhập vào: sale10, "SALE10 ", " Sale10" cho cùng kết quả; mã 3 ký tự, rỗng, có khoảng trắng giữa là coupon_not_found (và tính một lần sai)', async () => {
    await seedCoupon(t, { code: 'SALE10' });
    const ok = [await ev('sale10'), await ev('SALE10 '), await ev(' Sale10'), await ev('SALE10')];
    expect(new Set(ok.map((r) => JSON.stringify({ ...r, coupon_id: undefined }))).size).toBe(1);
    expect(ok[0]).toMatchObject({ ok: true, code: 'SALE10' });
    const user = rid();
    for (const bad of ['SAL', '', 'SALE 10', 'SALE10!', 'ÁO-MỚI1', 'x'.repeat(21)]) expect([bad, await ev(bad, { user })]).toEqual([bad, { ok: false, reason: 'coupon_not_found' }]);
    expect(await wrongHits(user)).toBe(6); // mã sai khuôn vẫn tính một lần sai
  });

  it('PRM-TC-20261006-113100303: kiểm lại mã đã lưu bằng count_attempt=false không bị too_many_attempts và không tăng bộ đếm sai (20 lần mã đang tắt); count_attempt=true ngay sau đó bị chặn kèm retry_after_seconds', async () => {
    await seedCoupon(t, { code: 'SALE10' });
    await seedCoupon(t, { code: 'OLD10', status: 'disabled' });
    windowStart();
    const user = rid();
    for (let i = 0; i < 10; i++) await ev(`BAD${i}XX`, { user });
    expect(await wrongHits(user)).toBe(10);
    expect(await ev('SALE10', { user, count: false })).toMatchObject({ ok: true, discount_amount: 30000 }); // không too_many_attempts
    for (let i = 0; i < 20; i++) expect(await ev('OLD10', { user, count: false })).toEqual({ ok: false, reason: 'coupon_not_found' });
    expect(await wrongHits(user)).toBe(10); // bộ đếm sai của U1 vẫn 10
    const last = await ev('SALE10', { user, count: true });
    expect(last).toMatchObject({ ok: false, reason: 'too_many_attempts' });
    expect((last as { retry_after_seconds: number }).retry_after_seconds).toBeGreaterThan(0);
    expect(await ev('SALE10', { user })).toMatchObject({ reason: 'too_many_attempts' }); // count_attempt mặc định true
  });

  it('PRM-TC-20261006-130100303: thứ tự kiểm too_many_attempts, coupon_not_found, coupon_expired, coupon_exhausted, per_user_limit_reached (kèm limit, used, không gọi hit), min_order_not_met, no_discount', async () => {
    const once = await seedCoupon(t, { code: 'ONCE10', usageLimit: 100, perUser: 1, min: 200000, reserved: 1 });
    const [u1, u2] = [rid(), rid()];
    await seedRedemption(t, once.id, { user: u1, status: 'reserved' });
    windowStart();
    for (let i = 0; i < 9; i++) await ev(`BAD${i}XX`, { user: u1 });
    expect(await ev('ONCE10', { user: u1 })).toEqual({ ok: false, reason: 'per_user_limit_reached', limit: 1, used: 1 });
    expect(await ev('ONCE10', { user: u2 })).toMatchObject({ ok: true, discount_amount: 30000 });
    expect(await ev('ONCE10', { user: u1, subtotal: 100000 })).toEqual({ ok: false, reason: 'per_user_limit_reached', limit: 1, used: 1 }); // trước min_order_not_met
    expect(await wrongHits(u1)).toBe(9); // per_user_limit_reached không tính vào bộ đếm thử sai
    expect(await ev('NOPE9999', { user: u1 })).toMatchObject({ reason: 'coupon_not_found' });
    expect(await wrongHits(u1)).toBe(10);
    await q(t, `UPDATE coupons SET usage_limit = 1, reserved_count = 0, consumed_count = 1 WHERE code = 'ONCE10'`);
    expect(await ev('ONCE10', { user: u2 })).toEqual({ ok: false, reason: 'coupon_exhausted' }); // trước per_user_limit_reached
    await q(t, `UPDATE coupons SET expires_at = now() - interval '1 hour' WHERE code = 'ONCE10'`);
    expect(await ev('ONCE10', { user: u2, subtotal: 100000 })).toEqual({ ok: false, reason: 'coupon_expired' }); // trước hết lượt và tối thiểu
    expect(await couponOf(t, 'ONCE10')).toMatchObject({ status: 'active' }); // evaluate không đổi trạng thái đã lưu
  });

  it('PRM-TC-20261006-101037501: tạm tính đạt mức tối thiểu (250000 với min 200000) trả ok 25000, không có min_order_not_met', async () => {
    await seedCoupon(t, { code: 'SALE10', min: 200000 });
    const r = await ev('SALE10', { subtotal: 250000 });
    expect(r).toMatchObject({ ok: true, discount_amount: 25000 });
    expect(r).not.toHaveProperty('reason');
  });

  it('PRM-TC-20261006-101037525: tạm tính thiếu trả min_order_not_met kèm min_order_value và shortfall; coupon đã quá hạn báo coupon_expired (đứng trước); per_user_limit_reached đứng trước min_order_not_met', async () => {
    await seedCoupon(t, { code: 'SALE10', min: 200000 });
    await seedCoupon(t, { code: 'OLD10', min: 200000, expiresInSec: -3600 });
    expect(await ev('SALE10', { subtotal: 150000 })).toEqual({ ok: false, reason: 'min_order_not_met', min_order_value: 200000, shortfall: 50000 });
    expect(await ev('OLD10', { subtotal: 150000 })).toEqual({ ok: false, reason: 'coupon_expired' });
    const once = await seedCoupon(t, { code: 'ONCE10', min: 200000, perUser: 1, consumed: 1 });
    const u = rid();
    await seedRedemption(t, once.id, { user: u, status: 'consumed' });
    expect(await ev('ONCE10', { user: u, subtotal: 150000 })).toEqual({ ok: false, reason: 'per_user_limit_reached', limit: 1, used: 1 });
  });

  it('PRM-TC-20261006-101037548: biên 200000 đạt và 199999 thiếu đúng 1; min 0 với tạm tính 1 đạt; giỏ giảm sau khi áp mã thì reserve trả min_order_not_met shortfall 20000 và không ghi gì; đổi mức tối thiểu sau khi giữ không kiểm lại lượt đã giữ', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', min: 200000 });
    expect(await ev('SALE10', { subtotal: 200000 })).toMatchObject({ ok: true, discount_amount: 20000 });
    expect(await ev('SALE10', { subtotal: 199999 })).toEqual({ ok: false, reason: 'min_order_not_met', min_order_value: 200000, shortfall: 1 });
    await seedCoupon(t, { code: 'FIX50K', type: 'fixed', value: 50000, min: 0 });
    expect(await ev('FIX50K', { subtotal: 1 })).toMatchObject({ ok: true, discount_amount: 1 });
    expect(await reserve(t, { code: 'SALE10', items_subtotal: 250000 })).toMatchObject({ ok: true, amount: 25000 }); // ORD-1 giữ lúc min = 200000
    const before = await snapshotTables(t);
    expect(await reserve(t, { code: 'SALE10', items_subtotal: 180000 })).toEqual({ ok: false, reason: 'min_order_not_met', min_order_value: 200000, shortfall: 20000 });
    expect(await snapshotTables(t)).toBe(before);
    await q(t, `UPDATE coupons SET min_order_value = 500000 WHERE id = '${id}'`);
    expect((await redemptionsOf(t, id))).toHaveLength(1);
    await deliver(t, 'PaymentSucceeded', paid((await redemptionsOf(t, id))[0].order_id));
    expect((await redemptionsOf(t, id))[0].status).toBe('consumed'); // không kiểm lại mức tối thiểu
  });
});
