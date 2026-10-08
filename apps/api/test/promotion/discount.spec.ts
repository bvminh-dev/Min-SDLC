import { truncateAll } from '../support/db';
import { discountOf } from '../../src/modules/promotion/discount';
import { actor, call, couponOf, countOf, createPrmApp, q, reserve, rid, seedCoupon, type PrmApp } from '../support/prm';

// Dữ liệu minh họa của TC dùng mã P10, P1, P15 (ngắn hơn 4 ký tự của PRM-REQ ...201 BR2): test dùng PX10, PX01, PX15.
// Tính tiền giảm (PRM-REQ-20261006-101036352, ...376): số nguyên VND bằng BigInt, làm tròn xuống, trần giảm, không vượt tạm tính nên tổng không bao giờ âm.
describe('PRM tính tiền giảm', () => {
  let t: PrmApp;
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });
  const ev = (code: string, subtotal: number) => t.prm.evaluate({ code, user_id: rid(), items_subtotal: subtotal });
  const amount = async (code: string, subtotal: number): Promise<unknown> => { const r = await ev(code, subtotal); return r.ok ? r.discount_amount : r; };

  it('PRM-TC-20261006-101037357: giảm 10 phần trăm không trần là 30000 với 300000; có trần 50000 thì 800000 bị chặn ở 50000', async () => {
    await seedCoupon(t, { code: 'PX10', type: 'percentage', value: 10 });
    await seedCoupon(t, { code: 'P10C', type: 'percentage', value: 10, max: 50000 });
    expect(await amount('PX10', 300000)).toBe(30000);
    expect(await amount('P10C', 800000)).toBe(50000); // thô 80000 bị trần chặn
    expect(await amount('P10C', 300000)).toBe(30000); // dưới trần thì giữ thô
  });

  it('PRM-TC-20261006-101037382: giảm bằng 0 đồng sau khi làm tròn xuống (1 phần trăm của 99) là no_discount ở evaluate và reserve; reserve không ghi dòng nào; CHECK amount >= 1 là lớp chặn cuối', async () => {
    const { id } = await seedCoupon(t, { code: 'PX01', type: 'percentage', value: 1 });
    expect(await ev('PX01', 99)).toEqual({ ok: false, reason: 'no_discount' });
    expect(await reserve(t, { code: 'PX01', items_subtotal: 99 })).toEqual({ ok: false, reason: 'no_discount' });
    expect([await countOf(t, 'coupon_redemptions'), (await couponOf(t, 'PX01')).reserved_count]).toEqual([0, 0]);
    await expect(q(t, `INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, amount) VALUES ('${id}', gen_random_uuid(), gen_random_uuid(), 0)`)).rejects.toThrow(/check constraint/);
    expect(await amount('PX01', 100)).toBe(1);
  });

  it('PRM-TC-20261006-101037406: làm tròn xuống (15 phần trăm của 12345 là 1851), 100 phần trăm bằng tạm tính, 1 tỷ không tràn, thô bằng đúng trần không phải lỗi, biên 1 đồng (100 và 199 đều 1); bất biến 0 < giảm <= tạm tính trên 2000 ca ngẫu nhiên', async () => {
    await seedCoupon(t, { code: 'PX15', type: 'percentage', value: 15 });
    await seedCoupon(t, { code: 'P100', type: 'percentage', value: 100 });
    await seedCoupon(t, { code: 'PBIG', type: 'percentage', value: 100, max: 1_000_000_000 });
    await seedCoupon(t, { code: 'P10T', type: 'percentage', value: 10, max: 50000 });
    await seedCoupon(t, { code: 'PX01', type: 'percentage', value: 1 });
    expect(await amount('PX15', 12345)).toBe(1851); // 12345 x 15 / 100 = 1851,75 xuống 1851
    expect(await amount('P100', 120000)).toBe(120000);
    expect(await amount('PBIG', 1_000_000_000)).toBe(1_000_000_000);
    expect(await amount('P10T', 500000)).toBe(50000);
    expect([await amount('PX01', 100), await amount('PX01', 199)]).toEqual([1, 1]);
    // tính tay bằng BigInt độc lập so với hàm
    for (let i = 0; i < 2000; i++) {
      const subtotal = 1 + Math.floor(Math.random() * 1_000_000_000), value = 1 + Math.floor(Math.random() * 100);
      const max = i % 3 === 0 ? 1 + Math.floor(Math.random() * 1_000_000_000) : null;
      const raw = (BigInt(subtotal) * BigInt(value)) / 100n; // floor vì số không âm
      const want = [raw, max === null ? raw : BigInt(max), BigInt(subtotal)].reduce((a, b) => (a < b ? a : b));
      const got = discountOf({ type: 'percentage', value, max_discount: max }, subtotal);
      expect([subtotal, value, max, got]).toEqual([subtotal, value, max, Number(want)]);
      expect(got).toBeLessThanOrEqual(subtotal); // tổng không bao giờ âm
      const fixedV = 1 + Math.floor(Math.random() * 1_000_000_000);
      const f = discountOf({ type: 'fixed', value: fixedV, max_discount: null }, subtotal);
      expect([f, f >= 1 && f <= subtotal]).toEqual([Math.min(fixedV, subtotal), true]);
    }
  });

  it('PRM-TC-20261006-101037430: giảm cố định 50000 với tạm tính 300000; trần không áp dụng', async () => {
    await seedCoupon(t, { code: 'FIX50K', type: 'fixed', value: 50000, min: 0 });
    expect(await ev('FIX50K', 300000)).toMatchObject({ ok: true, type: 'fixed', discount_amount: 50000 });
  });

  it('PRM-TC-20261006-101037453: coupon fixed không nhận max_discount: POST và PATCH kèm max_discount là 400 nêu max_discount, FIX50K không đổi; CHECK ở CSDL từ chối type fixed có max_discount', async () => {
    const admin = await actor(t, 'admin');
    const { id } = await seedCoupon(t, { code: 'FIX50K', type: 'fixed', value: 50000 });
    const post = await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body: { code: 'FIXMD', type: 'fixed', value: 50000, max_discount: 10000, expires_at: new Date(Date.now() + 86400_000).toISOString(), usage_limit: 5 } });
    expect([post.status, post.body.errors.map((e: any) => e.field)]).toEqual([400, ['max_discount']]);
    const patch = await call(t, 'patch', `/admin/coupons/${id}`, { cookie: admin.cookie, body: { version: 1, max_discount: 20000 } });
    expect([patch.status, patch.body.errors.map((e: any) => e.field)]).toEqual([400, ['max_discount']]);
    expect(await couponOf(t, 'FIX50K')).toMatchObject({ max_discount: null, version: 1 });
    await expect(q(t, `UPDATE coupons SET max_discount = 1 WHERE id = '${id}'`)).rejects.toThrow(/check constraint|coupons_max_discount_percentage_only/);
  });

  it('PRM-TC-20261006-101037477: giá trị giảm lớn hơn hoặc bằng tạm tính không vượt tạm tính (30000, 50000, 50000), biên 1 tỷ và 1 đồng; discount_amount không bao giờ lớn hơn items_subtotal', async () => {
    await seedCoupon(t, { code: 'FIX50K', type: 'fixed', value: 50000 });
    await seedCoupon(t, { code: 'FIXMAX', type: 'fixed', value: 1_000_000_000 });
    await seedCoupon(t, { code: 'FIX1', type: 'fixed', value: 1 });
    expect([await amount('FIX50K', 30000), await amount('FIX50K', 50000), await amount('FIX50K', 50001)]).toEqual([30000, 50000, 50000]);
    expect(await amount('FIXMAX', 1_000_000_000)).toBe(1_000_000_000);
    expect(await amount('FIXMAX', 1)).toBe(1);
    expect(await amount('FIX1', 1)).toBe(1);
    expect(await reserve(t, { code: 'FIX50K', items_subtotal: 30000 })).toMatchObject({ ok: true, amount: 30000 }); // reserve tính lại và ghi amount cố định
  });
});
