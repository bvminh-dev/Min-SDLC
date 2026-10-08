import type { Page } from 'playwright-core';
import { advance, alignWindow, count, couponState, eventually, hasText, id, loginUi, reset, see, seedCoupon, seedUser, startE2e, textOf, withPage, type E2eEnv } from './support';

// E2E của PRM chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web.
// Giờ nhập ở biểu mẫu là giờ Việt Nam; giới hạn tần suất dùng đồng hồ của API do cổng điều khiển tua (không chờ 60 giây thật). Mỗi test: CSDL sạch, ngữ cảnh trình duyệt mới.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);
const API = 'http://localhost:3101/api/v1';
/** Giá trị `datetime-local` (giờ Việt Nam) cách bây giờ `days` ngày. */
const vn = (days: number): string => new Date(Date.now() + days * 86_400_000 + 7 * 3600_000).toISOString().slice(0, 16);
const row = (page: Page, code: string) => id(page, 'prm-admin-coupon-list-row').filter({ hasText: code });
/** Gọi API trực tiếp từ trang đang đăng nhập (cookie phiên của trình duyệt); trả danh sách mã trạng thái. */
const fromPage = (page: Page, path: string, times = 1): Promise<number[]> => page.evaluate(async ({ api, p, n }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}${p}`, { credentials: 'include' })).status);
  return out;
}, { api: API, p: path, n: times });
const fillBasics = async (page: Page, o: { code: string; value: string; usage?: string; perUser?: string }) => {
  await id(page, 'prm-admin-coupon-edit-code').fill(o.code);
  await id(page, 'prm-admin-coupon-edit-value').fill(o.value);
  await id(page, 'prm-admin-coupon-edit-expires-at').fill(vn(7));
  await id(page, 'prm-admin-coupon-edit-usage-limit').fill(o.usage ?? '100');
  if (o.perUser !== undefined) await id(page, 'prm-admin-coupon-edit-per-user-limit').fill(o.perUser);
};

describe('E2E PRM (trình duyệt thật, API thật)', () => {
  e2e('PRM-E2E-20261006-101037836: admin tạo coupon phần trăm rồi tắt và bật lại trong danh sách', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/coupons');
    await see(id(page, 'prm-admin-coupon-list-empty'));
    await id(page, 'prm-admin-coupon-list-create').click();
    await id(page, 'prm-admin-coupon-edit-code').fill('sale10');
    await id(page, 'prm-admin-coupon-edit-type').selectOption({ label: 'Phần trăm' });
    await id(page, 'prm-admin-coupon-edit-value').fill('10');
    await id(page, 'prm-admin-coupon-edit-max-discount').fill('50000');
    await id(page, 'prm-admin-coupon-edit-min-order').fill('200000');
    await id(page, 'prm-admin-coupon-edit-expires-at').fill(vn(7));
    await id(page, 'prm-admin-coupon-edit-usage-limit').fill('100');
    await id(page, 'prm-admin-coupon-edit-per-user-limit').fill('1');
    await id(page, 'prm-admin-coupon-edit-save').click();
    const r = row(page, 'SALE10');
    await see(r);
    await hasText(r.getByTestId('prm-admin-coupon-list-code'), 'SALE10');
    await hasText(r.getByTestId('prm-admin-coupon-list-status-badge'), 'Đang chạy');
    await hasText(r.getByTestId('prm-admin-coupon-list-usage'), '0/100 (còn 100)');
    expect(await couponState('SALE10')).toMatchObject({ status: 'active', type: 'percentage', value: 10, max_discount: 50000, min_order_value: 200000, usage_limit: 100, per_user_limit: 1, version: 1 });
    await r.getByTestId('prm-admin-coupon-list-toggle').click(); // Tắt
    await hasText(r.getByTestId('prm-admin-coupon-list-status-badge'), 'Đã tắt');
    await hasText(r.getByTestId('prm-admin-coupon-list-toggle'), 'Bật');
    await r.getByTestId('prm-admin-coupon-list-toggle').click(); // Bật
    await hasText(r.getByTestId('prm-admin-coupon-list-status-badge'), 'Đang chạy');
    await count(id(page, 'prm-admin-coupon-list-toggle-error'), 0);
    expect(await couponState('SALE10')).toMatchObject({ status: 'active', version: 3 });
  });

  e2e('PRM-E2E-20261006-101037859: admin gặp lỗi mã trùng và giá trị sai khi tạo coupon', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedCoupon({ code: 'SALE10' });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/coupons');
    await see(row(page, 'SALE10'));
    await id(page, 'prm-admin-coupon-list-create').click();
    await fillBasics(page, { code: 'SALE10', value: '10' });
    await id(page, 'prm-admin-coupon-edit-save').click();
    expect(await textOf(id(page, 'prm-admin-coupon-edit-code-error'))).toContain('Mã này đã được dùng');
    expect(await couponState('SALE11')).toBeNull();
    await id(page, 'prm-admin-coupon-edit-code').fill('SALE11');
    await id(page, 'prm-admin-coupon-edit-value').fill('101');
    await id(page, 'prm-admin-coupon-edit-save').click();
    await hasText(id(page, 'prm-admin-coupon-edit-value-error'), 'Phần trăm từ 1 đến 100');
    await id(page, 'prm-admin-coupon-edit-type').selectOption({ label: 'Số tiền cố định' });
    await count(id(page, 'prm-admin-coupon-edit-max-discount'), 0); // ô ẩn với loại cố định
    await id(page, 'prm-admin-coupon-edit-value').fill('50000');
    await id(page, 'prm-admin-coupon-edit-save').click();
    await see(row(page, 'SALE11'));
    expect(await couponState('SALE11')).toMatchObject({ type: 'fixed', value: 50000, max_discount: null });
    await id(page, 'prm-admin-coupon-list-create').click();
    await fillBasics(page, { code: 'SALE12', value: '10', perUser: '0' });
    await id(page, 'prm-admin-coupon-edit-save').click();
    await hasText(id(page, 'prm-admin-coupon-edit-per-user-limit-error'), 'Từ 1 đến 1.000.000, hoặc để trống nếu không giới hạn');
    expect(await couponState('SALE12')).toBeNull();
    await id(page, 'prm-admin-coupon-edit-cancel').click();
    await see(row(page, 'SALE11'));
    await count(row(page, 'SALE12'), 0);
  });

  e2e('PRM-E2E-20261006-101037882: admin sửa coupon: số lượt thấp hơn đã dùng bị từ chối rồi sửa lại', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedCoupon({ code: 'SALE10', usage_limit: 100, consumed: 30, reserved: 5 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/coupons');
    const r = row(page, 'SALE10');
    await see(r);
    await r.getByTestId('prm-admin-coupon-list-edit').click();
    await eventually(async () => expect(await textOf(id(page, 'prm-admin-coupon-edit-usage-summary'))).toMatch(/Đã dùng 30 · Đang giữ 5 · Còn lại 65/));
    await eventually(async () => {
      expect(await id(page, 'prm-admin-coupon-edit-code').isDisabled()).toBe(true);
      expect(await id(page, 'prm-admin-coupon-edit-type').isDisabled()).toBe(true);
    });
    await id(page, 'prm-admin-coupon-edit-usage-limit').fill('34');
    await id(page, 'prm-admin-coupon-edit-save').click();
    expect(await textOf(id(page, 'prm-admin-coupon-edit-usage-limit-error'))).toContain('Không nhỏ hơn 35');
    expect((await couponState('SALE10'))!.usage_limit).toBe(100); // server từ chối, không đổi
    await id(page, 'prm-admin-coupon-edit-usage-limit').fill('150');
    await id(page, 'prm-admin-coupon-edit-value').fill('15');
    await id(page, 'prm-admin-coupon-edit-save').click();
    const after = row(page, 'SALE10');
    await see(after);
    await hasText(after.getByTestId('prm-admin-coupon-list-usage'), '35/150 (còn 115)');
    expect(await textOf(after.getByTestId('prm-admin-coupon-list-discount'))).toContain('15%');
    expect(await couponState('SALE10')).toMatchObject({ usage_limit: 150, value: 15, version: 2 });
  });

  e2e('PRM-E2E-20261006-101037906: admin xóa coupon; coupon hết hạn không có nút Tắt hoặc Bật (nút Xóa vẫn có, theo ui và PRM-REQ-20261006-101036252 BR3)', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedCoupon({ code: 'SALE10', status: 'disabled', age_sec: 10 });
    await seedCoupon({ code: 'OLD20', status: 'expired', expires_in_sec: -86400, age_sec: 5 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/coupons');
    const old = row(page, 'OLD20');
    await see(old);
    await hasText(old.getByTestId('prm-admin-coupon-list-status-badge'), 'Hết hạn');
    await count(old.getByTestId('prm-admin-coupon-list-toggle'), 0);
    await count(old.getByTestId('prm-admin-coupon-list-delete'), 1); // ui và REQ BR3 cho xóa coupon hết hạn; bước 2 của E2E nói ngược lại (xem report, Lệch spec)
    await hasText(old.getByTestId('prm-admin-coupon-list-edit'), 'Xem');
    await hasText(id(page, 'prm-admin-coupon-list-summary'), '1 tới 2 trong 2 coupon');
    const s = row(page, 'SALE10');
    await s.getByTestId('prm-admin-coupon-list-delete').click();
    await id(page, 'prm-admin-coupon-list-delete-cancel').click();
    await see(s);
    expect((await couponState('SALE10'))!.status).toBe('disabled');
    await s.getByTestId('prm-admin-coupon-list-delete').click();
    await id(page, 'prm-admin-coupon-list-delete-confirm').click();
    await count(row(page, 'SALE10'), 0);
    await hasText(id(page, 'prm-admin-coupon-list-summary'), '1 tới 1 trong 1 coupon');
    expect((await couponState('SALE10'))!.status).toBe('deleted');
    await old.getByTestId('prm-admin-coupon-list-delete').click(); // xóa cả coupon hết hạn để dọn danh sách
    await id(page, 'prm-admin-coupon-list-delete-confirm').click();
    await see(id(page, 'prm-admin-coupon-list-empty'));
  });

  e2e('PRM-TC-20261006-101037026: bật coupon đã quá hạn (job chưa chạy) hiện lỗi trên bảng "Coupon đã hết hạn" và dòng được tải lại; coupon hết lượt không bật được', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedCoupon({ code: 'OLD1', status: 'disabled', expires_in_sec: -3600, age_sec: 5 });
    await seedCoupon({ code: 'FULL1', status: 'disabled', usage_limit: 10, consumed: 10, age_sec: 10 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/coupons');
    const old = row(page, 'OLD1');
    await see(old);
    await see(old.getByText('quá hạn')); // chú thích: job mỗi phút mới chuyển Hết hạn
    await old.getByTestId('prm-admin-coupon-list-toggle').click();
    await hasText(id(page, 'prm-admin-coupon-list-toggle-error'), 'Coupon đã hết hạn');
    await hasText(old.getByTestId('prm-admin-coupon-list-status-badge'), 'Đã tắt');
    await row(page, 'FULL1').getByTestId('prm-admin-coupon-list-toggle').click();
    await hasText(id(page, 'prm-admin-coupon-list-toggle-error'), 'Coupon đã hết lượt');
    expect([(await couponState('OLD1'))!.status, (await couponState('FULL1'))!.status]).toEqual(['disabled', 'disabled']);
  });

  e2e('PRM-TC-20261006-101036805: hai admin sửa cùng coupon, người sau gặp xung đột phiên bản (banner, dữ liệu đang gõ không bị ghi), tải lại rồi lưu được', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedUser({ email: 'admin2@shop.vn', role: 'admin' });
    await seedCoupon({ code: 'SALE10', value: 10, version: 3 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/coupons');
    await row(page, 'SALE10').getByTestId('prm-admin-coupon-list-edit').click();
    await eventually(async () => expect(await id(page, 'prm-admin-coupon-edit-value').inputValue()).toBe('10'));
    await withPage(env.browser, async (other) => { // admin thứ hai sửa value thành 12 qua giao diện (version thành 4)
      await loginUi(other, 'admin2@shop.vn');
      await other.goto('/admin/coupons');
      await row(other, 'SALE10').getByTestId('prm-admin-coupon-list-edit').click();
      await eventually(async () => expect(await id(other, 'prm-admin-coupon-edit-value').inputValue()).toBe('10'));
      await id(other, 'prm-admin-coupon-edit-value').fill('12');
      await id(other, 'prm-admin-coupon-edit-save').click();
      await see(row(other, 'SALE10'));
    });
    await id(page, 'prm-admin-coupon-edit-value').fill('20');
    await id(page, 'prm-admin-coupon-edit-save').click();
    await see(id(page, 'prm-admin-coupon-edit-conflict-error'));
    expect(await couponState('SALE10')).toMatchObject({ value: 12, version: 4 }); // bản của người thứ hai không bị ghi đè
    expect(await id(page, 'prm-admin-coupon-edit-value').inputValue()).toBe('20'); // dữ liệu đang gõ còn nguyên
    await id(page, 'prm-admin-coupon-edit-conflict-error').getByRole('button', { name: 'Tải lại' }).click();
    await eventually(async () => expect(await id(page, 'prm-admin-coupon-edit-value').inputValue()).toBe('12'));
    await count(id(page, 'prm-admin-coupon-edit-conflict-error'), 0);
    await id(page, 'prm-admin-coupon-edit-value').fill('20');
    await id(page, 'prm-admin-coupon-edit-save').click();
    await see(row(page, 'SALE10'));
    expect(await couponState('SALE10')).toMatchObject({ value: 20, version: 5 });
  });

  e2e('PRM-TC-20261006-113100505: danh sách coupon bị giới hạn tần suất hiện banner kèm thử lại sau N giây, rồi tải lại được (nút Thử lại) khi hết giờ chờ', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedCoupon({ code: 'SALE10' });
    await loginUi(page, 'admin@shop.vn');
    await alignWindow();
    expect((await fromPage(page, '/admin/coupons?page=1&limit=1', 30)).every((s) => s === 200)).toBe(true); // 30 yêu cầu đầu nằm trong cùng một phút (bậc D)
    await page.goto('/admin/coupons'); // lần thứ 31
    await eventually(async () => expect(await textOf(id(page, 'prm-admin-coupon-list-error'))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await count(id(page, 'prm-admin-coupon-list-row'), 0);
    await advance(61_000); // sang phút kế tiếp (đồng hồ của API)
    await id(page, 'prm-admin-coupon-list-retry').click();
    await count(id(page, 'prm-admin-coupon-list-error'), 0);
    await see(row(page, 'SALE10'));
  });

  e2e('PRM-TC-20261006-101037169: staff vào trang coupon thấy "Không có quyền truy cập" và không tải coupon nào; chưa đăng nhập chuyển về đăng nhập', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    await seedCoupon({ code: 'SALE10' });
    await page.goto('/admin/coupons');
    await eventually(() => { expect(page.url()).toMatch(/\/login\?next=%2Fadmin%2Fcoupons/); });
    await loginUi(page, 'staff@shop.vn');
    await page.goto('/admin/coupons');
    await see(id(page, 'auth-access-denied-container'));
    await count(id(page, 'prm-admin-coupon-list-row'), 0);
    await count(id(page, 'prm-admin-coupon-list-create'), 0);
  });

  e2e('REV-PRM-06 (hồi quy của reviewer): sửa trường khác của coupon có hạn lẻ giây không làm đổi hạn đã lưu (ô giờ chỉ có phút, gửi lại sẽ cắt giây)', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const { id: cid } = await seedCoupon({ code: 'SEC30', usage_limit: 10, expires_in_sec: 7 * 86400 + ((30 - new Date().getUTCSeconds() + 60) % 60) }); // hạn rơi vào khoảng giây 30, không bao giờ là giây 0
    await loginUi(page, 'admin@shop.vn');
    const expiry = (): Promise<string> => page.evaluate(async ({ api, c }) => ((await (await fetch(`${api}/admin/coupons/${c}`, { credentials: 'include' })).json()) as { expires_at: string }).expires_at, { api: API, c: cid });
    const before = await expiry();
    expect(new Date(before).getUTCSeconds()).toBeGreaterThanOrEqual(28);
    await page.goto(`/admin/coupons/${cid}`);
    await eventually(async () => { expect(await id(page, 'prm-admin-coupon-edit-usage-limit').inputValue()).toBe('10'); });
    await id(page, 'prm-admin-coupon-edit-usage-limit').fill('20');
    await id(page, 'prm-admin-coupon-edit-save').click();
    await see(row(page, 'SEC30'));
    expect(await couponState('SEC30')).toMatchObject({ usage_limit: 20, version: 2 });
    expect(await expiry()).toBe(before);
  });
});
