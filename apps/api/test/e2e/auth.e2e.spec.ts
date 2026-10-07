import type { Page } from 'playwright-core';
import { PASSWORD, advance, count, ctl, eventually, hasText, id, loginUi, mailToken, reset, see, seedUser, startE2e, textOf, urlIs, withPage, type E2eEnv } from './support';

// E2E của AUTH chạy bằng Jest (công cụ test duy nhất) và `playwright-core` điều khiển Chromium thật: API thật trên PostgreSQL thật
// (CSDL `ecom_e2e`) và bản build production của web. Mỗi test: CSDL sạch, đồng hồ API về thật, ngữ cảnh trình duyệt mới. Xem support.ts.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 90_000);
const field = (page: Page, testid: string, name: string) => page.locator(`[data-testid="${testid}"][data-field="${name}"]`);
const val = async (page: Page, testid: string) => id(page, testid).inputValue();

describe('E2E AUTH (trình duyệt thật, API thật)', () => {
  e2e('AUTH-E2E-20261006-100707907: khách đăng ký, đăng ký lại cùng email không lộ gì, lỗi mật khẩu theo trường, rồi đăng nhập', async (page) => {
    await page.goto('/register');
    await id(page, 'auth-register-full-name').fill('Nguyễn An');
    await id(page, 'auth-register-email').fill('new@shop.vn');
    await id(page, 'auth-register-password').fill(PASSWORD);
    await id(page, 'auth-register-password-toggle').click();
    await eventually(async () => expect(await id(page, 'auth-register-password').getAttribute('type')).toBe('text'));
    await id(page, 'auth-register-submit').click();
    await see(id(page, 'auth-register-success'));
    await count(id(page, 'auth-register-form'), 0);
    await count(id(page, 'auth-account-menu-trigger'), 0); // chưa đăng nhập
    const first = await textOf(id(page, 'auth-register-success'));

    await page.goto('/register');
    await id(page, 'auth-register-full-name').fill('Nguyễn An');
    await id(page, 'auth-register-email').fill('new@shop.vn');
    await id(page, 'auth-register-password').fill(PASSWORD);
    await id(page, 'auth-register-submit').click();
    await see(id(page, 'auth-register-success'));
    expect(await textOf(id(page, 'auth-register-success'))).toBe(first); // cùng nội dung, không có thông báo email đã tồn tại
    expect(first).toContain('Chúng tôi đã nhận đăng ký');
    await see(id(page, 'auth-register-login-link'));

    await page.goto('/register');
    await id(page, 'auth-register-full-name').fill('Người Khác');
    await id(page, 'auth-register-email').fill('other@shop.vn');
    await id(page, 'auth-register-password').fill('Abcdefg12');
    await id(page, 'auth-register-submit').click();
    await see(field(page, 'auth-register-field-error', 'password'));

    await id(page, 'auth-register-login-link').first().click();
    await id(page, 'auth-login-email').fill('new@shop.vn');
    await id(page, 'auth-login-password').fill(PASSWORD);
    await id(page, 'auth-login-submit').click();
    await see(id(page, 'auth-account-menu-trigger'));
    await count(id(page, 'auth-login-form'), 0);
  });

  e2e('AUTH-E2E-20261006-100707954: đăng nhập sai nhiều lần rồi khóa tạm, thông báo luôn giống hệt, kể cả email không tồn tại', async (page) => {
    await seedUser({ email: 'u1@shop.vn' });
    await page.goto('/login');
    let expected: string | undefined;
    for (let i = 1; i <= 5; i++) {
      await id(page, 'auth-login-email').fill('u1@shop.vn');
      await id(page, 'auth-login-password').fill(`sai-mat-khau-${i}`);
      await id(page, 'auth-login-submit').click();
      const text = await textOf(id(page, 'auth-login-credentials-error'));
      expected ??= text;
      expect(text).toBe(expected);
      await eventually(async () => expect(await val(page, 'auth-login-password')).toBe('')); // mật khẩu xóa, email giữ lại
      expect(await val(page, 'auth-login-email')).toBe('u1@shop.vn');
      for (const other of ['auth-login-rate-limited', 'auth-login-error', 'auth-login-field-error']) await count(id(page, other), 0); // không có chỉ báo khóa riêng
    }
    await id(page, 'auth-login-password').fill(PASSWORD); // mật khẩu đúng nhưng đang khóa tạm
    await id(page, 'auth-login-submit').click();
    await eventually(async () => expect(await val(page, 'auth-login-password')).toBe(''));
    expect(await textOf(id(page, 'auth-login-credentials-error'))).toBe(expected);
    expect(page.url()).toMatch(/\/login/);
    await id(page, 'auth-login-email').fill('none@shop.vn');
    await id(page, 'auth-login-password').fill('bat-ky-123');
    await id(page, 'auth-login-submit').click();
    await eventually(async () => expect(await val(page, 'auth-login-password')).toBe(''));
    expect(await textOf(id(page, 'auth-login-credentials-error'))).toBe(expected);
  });

  e2e('AUTH-E2E-20261006-100708000: guest vào /orders được chuyển tới đăng nhập kèm banner, đăng nhập xong quay lại đúng trang; next lạ bị bỏ', async (page) => {
    await seedUser({ email: 'u1@shop.vn' });
    await page.goto('/orders');
    await urlIs(page, /\/login\?/);
    await see(id(page, 'auth-login-login-required'));
    await id(page, 'auth-login-email').fill('u1@shop.vn');
    await id(page, 'auth-login-password').fill(PASSWORD);
    await id(page, 'auth-login-submit').click();
    await urlIs(page, /\/orders$/);
    await see(page.getByRole('heading', { name: 'Đơn hàng' }));

    await id(page, 'auth-account-menu-trigger').click();
    await id(page, 'auth-account-menu-logout').click();
    await see(id(page, 'auth-login-form'));
    await page.goto(`/login?next=${encodeURIComponent('//evil.example')}`);
    await id(page, 'auth-login-email').fill('u1@shop.vn');
    await id(page, 'auth-login-password').fill(PASSWORD);
    await id(page, 'auth-login-submit').click();
    await see(id(page, 'auth-account-menu-trigger'));
    const u = new URL(page.url());
    expect([u.hostname, u.pathname]).toEqual(['localhost', '/']); // về trang chủ, không ra ngoài
  });

  e2e('AUTH-E2E-20261006-100708048: quên mật khẩu rồi đặt lại bằng liên kết trong email (token ở fragment, bị xóa khỏi thanh địa chỉ)', async (page) => {
    await seedUser({ email: 'u1@shop.vn' });
    await page.goto('/login');
    await id(page, 'auth-login-forgot-link').click();
    await id(page, 'auth-forgot-password-email').fill('u1@shop.vn');
    await id(page, 'auth-forgot-password-submit').click();
    const sent1 = await textOf(id(page, 'auth-forgot-password-sent'));
    await page.goto('/forgot-password');
    await id(page, 'auth-forgot-password-email').fill('none@shop.vn');
    await id(page, 'auth-forgot-password-submit').click();
    expect(await textOf(id(page, 'auth-forgot-password-sent'))).toBe(sent1); // chữ y hệt cho email không tồn tại

    const token = await mailToken('u1@shop.vn', 'PasswordResetRequested');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const res = await page.goto(`/reset-password#token=${token}`);
    expect(res?.headers()['referrer-policy']).toBe('no-referrer');
    await see(id(page, 'auth-reset-password-form'));
    await eventually(() => expect(page.url()).not.toContain('token')); // thanh địa chỉ không còn token
    expect(requests.filter((u) => u.includes(token))).toEqual([]); // token không bao giờ lên máy chủ web

    await id(page, 'auth-reset-password-new-password').fill('Short1');
    await id(page, 'auth-reset-password-submit').click();
    await see(id(page, 'auth-reset-password-field-error'));
    await count(id(page, 'auth-reset-password-invalid-link'), 0);

    await id(page, 'auth-reset-password-new-password').fill('New-Pass-67890');
    await id(page, 'auth-reset-password-submit').click();
    await see(id(page, 'auth-login-form'));
    await id(page, 'auth-login-email').fill('u1@shop.vn');
    await id(page, 'auth-login-password').fill('New-Pass-67890');
    await id(page, 'auth-login-submit').click();
    await see(id(page, 'auth-account-menu-trigger')); // mật khẩu mới dùng được

    await page.goto(`/reset-password#token=${token}`);
    await id(page, 'auth-reset-password-new-password').fill('Another-Pass-1234');
    await id(page, 'auth-reset-password-submit').click();
    await see(id(page, 'auth-reset-password-invalid-link'));
    await see(id(page, 'auth-reset-password-request-new'));
  });

  e2e('AUTH-E2E-20261006-100708094: customer chưa xác minh gửi lại email, xác minh bằng liên kết, rồi đăng xuất (Back vẫn về đăng nhập)', async (page) => {
    await seedUser({ email: 'u1@shop.vn', verified: false, name: 'Nguyễn An' });
    await loginUi(page, 'u1@shop.vn');
    await id(page, 'auth-account-menu-trigger').click();
    await hasText(id(page, 'auth-account-menu-email'), 'u1@shop.vn');
    await hasText(id(page, 'auth-account-menu-role'), 'Khách hàng');
    await id(page, 'auth-account-menu-unverified').click();
    await see(id(page, 'auth-verify-email-pending'));

    await id(page, 'auth-verify-email-resend').click();
    await see(id(page, 'auth-verify-email-resend-sent'));
    await hasText(id(page, 'auth-verify-email-resend-sent'), /giây/); // đếm ngược
    await id(page, 'auth-verify-email-resend').click(); // bấm lại ngay
    await see(id(page, 'auth-verify-email-rate-limited'));

    const token = await mailToken('u1@shop.vn', 'EmailVerificationRequested');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(`/verify-email#token=${token}`); // ở cùng phiên
    await see(id(page, 'auth-verify-email-success'));
    await see(id(page, 'auth-verify-email-continue'));
    expect(requests.filter((u) => u.includes(token))).toEqual([]); // AUTH-TC-20261006-100641066: token không vào URL gửi tới máy chủ web
    await page.goto(`/verify-email#token=${token}`);
    await see(id(page, 'auth-verify-email-invalid-link'));

    await id(page, 'auth-account-menu-trigger').click();
    await count(id(page, 'auth-account-menu-unverified'), 0); // đã xác minh: chip biến mất
    await id(page, 'auth-account-menu-logout').click();
    await see(id(page, 'auth-login-form'));
    await page.goBack();
    await see(id(page, 'auth-login-form')); // phiên đã thu hồi nên không vào lại được
    await urlIs(page, /\/login/);
  });

  e2e('AUTH-E2E-20261006-100708137: customer vào trang quản trị thấy màn không có quyền, không có dữ liệu người dùng', async (page) => {
    await seedUser({ email: 'u1@shop.vn' });
    await loginUi(page, 'u1@shop.vn');
    const apiCalls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(':3101/') && r.url().includes('/admin/users')) apiCalls.push(r.url()); });
    await page.goto('/admin/users');
    await see(id(page, 'auth-access-denied-container'));
    await hasText(id(page, 'auth-access-denied-message'), /Khách hàng/);
    await count(id(page, 'auth-admin-user-list-row'), 0);
    expect(apiCalls).toEqual([]); // không gọi API danh sách
    await id(page, 'auth-access-denied-home').click();
    await urlIs(page, /localhost:3100\/$/);
  });

  e2e('AUTH-E2E-20261006-100708184: admin tìm người dùng, đổi role, khóa rồi mở khóa', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin', name: 'Quản Trị', createdAt: '2026-01-01T00:00:00Z' });
    await seedUser({ email: 'an@shop.vn', name: 'Văn An', createdAt: '2026-01-02T00:00:00Z' });
    await seedUser({ email: 'bao@shop.vn', name: 'Bảo', createdAt: '2026-01-03T00:00:00Z' });
    await seedUser({ email: 'banan@shop.vn', name: 'Ba Nan', createdAt: '2026-01-04T00:00:00Z' });
    await loginUi(page, 'a1@shop.vn');
    const searches: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/admin/users?')) searches.push(r.url()); });
    await page.goto('/admin/users');
    const rows = id(page, 'auth-admin-user-list-row');
    await count(rows, 4);

    await id(page, 'auth-admin-user-list-search').fill('an@');
    await count(rows, 1);
    for (const e of await id(page, 'auth-admin-user-list-email').allInnerTexts()) expect(e.startsWith('an@')).toBe(true);
    searches.length = 0;
    await id(page, 'auth-admin-user-list-search').fill('an');
    await see(page.getByText('Nhập ít nhất 3 ký tự để tìm'));
    await new Promise((r) => setTimeout(r, 700));
    expect(searches.filter((u) => /[?&]q=an(&|$)/.test(u))).toEqual([]); // dưới 3 ký tự: không gọi tìm
    await id(page, 'auth-admin-user-list-search').fill('an@');
    await count(rows, 1);

    const rowOf = (email: string) => rows.filter({ has: id(page, 'auth-admin-user-list-email').getByText(email, { exact: true }) });
    const row = rowOf('an@shop.vn');
    await row.getByTestId('auth-admin-user-list-row-menu').click();
    await id(page, 'auth-admin-user-list-change-role').click();
    await id(page, 'auth-admin-user-list-role-select').selectOption({ label: 'Nhân viên' });
    await id(page, 'auth-admin-user-list-role-save').click();
    await hasText(row.getByTestId('auth-admin-user-list-role'), 'Nhân viên');
    await see(id(page, 'auth-admin-user-list-toast-role'));

    await id(page, 'auth-admin-user-list-search').fill('');
    const self = rowOf('a1@shop.vn');
    await count(self, 1);
    await self.getByTestId('auth-admin-user-list-row-menu').click();
    await eventually(async () => {
      expect(await id(page, 'auth-admin-user-list-change-role').isDisabled()).toBe(true);
      expect(await id(page, 'auth-admin-user-list-lock').isDisabled()).toBe(true);
    });
    await self.getByTestId('auth-admin-user-list-row-menu').click(); // đóng menu

    const target = rowOf('an@shop.vn');
    await target.getByTestId('auth-admin-user-list-row-menu').click();
    await id(page, 'auth-admin-user-list-lock').click();
    await id(page, 'auth-admin-user-list-lock-reason').fill('gian lận');
    await id(page, 'auth-admin-user-list-lock-confirm').click();
    await hasText(target.getByTestId('auth-admin-user-list-status'), 'Đã khóa');
    await see(id(page, 'auth-admin-user-list-toast-lock'));

    await target.getByTestId('auth-admin-user-list-row-menu').click();
    await id(page, 'auth-admin-user-list-unlock').click();
    await hasText(target.getByTestId('auth-admin-user-list-status'), 'Hoạt động');
  });

  e2e('AUTH-TC-20261006-100640931: họ tên chứa HTML được hiển thị dạng chữ (escape), không chạy script ở màn quản trị', async (page) => {
    const xss = '<img src=x onerror="window.__xss=1">';
    await seedUser({ email: 'a1@shop.vn', role: 'admin', createdAt: '2026-01-01T00:00:00Z' });
    await seedUser({ email: 'xss@shop.vn', name: xss, createdAt: '2026-01-02T00:00:00Z' });
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/users');
    await see(page.getByText(xss, { exact: true }));
    await count(page.locator('img[src="x"]'), 0);
    expect(await page.evaluate('window.__xss')).toBeUndefined();
  });

  e2e('AUTH-E2E-20261006-100708229: phiên hết hạn khi đang dùng, hộp thoại chặn thao tác và dẫn về đăng nhập kèm banner', async (page) => {
    await seedUser({ email: 'u1@shop.vn', verified: false });
    await loginUi(page, 'u1@shop.vn');
    await page.goto('/verify-email');
    await see(id(page, 'auth-verify-email-pending'));
    await advance(31 * 60_000); // đồng hồ giả của API: 31 phút không thao tác
    await id(page, 'auth-verify-email-resend').click(); // chức năng gọi API cần đăng nhập
    await see(id(page, 'auth-account-menu-session-expired'));
    await id(page, 'auth-account-menu-session-expired-login').click();
    await urlIs(page, /\/login\?next=%2Fverify-email&reason=expired/);
    await see(id(page, 'auth-login-session-expired'));
    expect(await ctl('/health')).toEqual({ ok: true });
  });
  e2e('review AUTH: đăng nhập vượt giới hạn 10 lần mỗi phút (429) khóa nút kèm banner, rồi mở lại khi hết Retry-After (ui/login: nút khóa tới hết giờ)', async (page) => {
    await page.goto('/login');
    for (let i = 0; i < 11; i++) {
      await id(page, 'auth-login-email').fill(`ghost${i}@shop.vn`);
      await id(page, 'auth-login-password').fill('sai-mat-khau-1');
      await Promise.all([page.waitForResponse((r) => r.url().includes('/auth/login')), id(page, 'auth-login-submit').click()]);
    }
    await see(id(page, 'auth-login-rate-limited'));
    expect(await id(page, 'auth-login-submit').isDisabled()).toBe(true);
    await eventually(async () => { // cửa sổ cố định 60 giây: tối đa 60 giây thật
      expect(await id(page, 'auth-login-rate-limited').count()).toBe(0);
      expect(await id(page, 'auth-login-submit').isDisabled()).toBe(false);
    }, 75_000);
  });
});
