import { randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright-core';
import {
  count, eventually, hasText, id, loginUi, notificationsOf, publishEvent, relay, reset, runEmailJob, see, seedAddress, seedCategory, seedCoupon, seedNotification, seedProduct, seedShippingMethod, seedStock, seedUser, sesMails,
  startE2e, textOf, urlIs, withPage, type E2eEnv, API, WEB} from './support';

// E2E của NTF chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule, mọi module thật) trên PostgreSQL thật (`ecom_e2e`), bản build production của web, SES giả tự dựng (CHƯA thử với SES thật).
// Dữ liệu mồi là event thật qua outbox + relay (OrderShipped, PaymentSucceeded, LowStockDetected) hoặc thông báo dựng thẳng (các thông báo cũ); luồng đặt hàng THẬT của CHK tạo OrderCreated cho NTF.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 180_000);
const B = 'ntf-notification-bell', L = 'ntf-notification-list';
const CODE = '7K3M9Q2XH4TB';
const OID = '11111111-1111-4111-8111-111111111111';
const badge = (page: Page): Locator => id(page, `${B}-badge`);
const badgeIs = (page: Page, want: string | null) => eventually(async () => { if (want === null) expect(await badge(page).count()).toBe(0); else expect((await textOf(badge(page))).trim()).toBe(want); });
const disabled = async (l: Locator): Promise<boolean> => { await see(l); return !(await l.first().isEnabled()); };
const summaryIs = (page: Page, text: string) => hasText(id(page, `${L}-summary`), text);
const stateTab = (page: Page, name: RegExp): Locator => id(page, `${L}-status-filter`).getByRole('button', { name });
const minutes = (n: number) => n * 60_000;

describe('E2E NTF (trình duyệt thật, API thật)', () => {
  e2e('NTF-E2E-20261006-104226408: customer nhận thông báo đơn đang giao (event thật) và mở từ chuông: badge giảm, điều hướng tới đơn, danh sách đồng bộ', async (page) => {
    const u = await seedUser({ email: 'c1@x.vn', name: 'Nguyễn An' });
    await seedNotification({ email: 'c1@x.vn', type: 'order_created', title: 'Đã nhận đơn hàng', body: 'Đơn #AAAAAAAAAAAA đã được tạo. Tổng tiền 100.000 đ.', status: 'read', age_ms: minutes(600), link: '/orders' });
    await seedNotification({ email: 'c1@x.vn', type: 'order_delivered', title: 'Đơn hàng đã được giao', body: 'Đơn hàng của bạn đã được giao thành công. Cảm ơn bạn đã mua sắm.', status: 'read', age_ms: minutes(500), link: '/orders' });
    await publishEvent('PaymentSucceeded', { payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u.id, amount: 350000, method: 'vnpay', paid_at: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 30)); // hai thông báo khác created_at (clock_timestamp): shipped là mới nhất
    await publishEvent('OrderShipped', { order_id: OID, order_code: CODE, user_id: u.id, tracking_number: 'VTP12345678' });
    await loginUi(page, 'c1@x.vn');
    await badgeIs(page, '2');
    await id(page, `${B}-trigger`).click();
    await see(id(page, `${B}-panel`));
    await page.keyboard.press('Escape'); // đóng bằng Esc (ui/notification-bell)
    await count(id(page, `${B}-panel`), 0);
    await id(page, `${B}-trigger`).click();
    await see(id(page, `${B}-panel`));
    await count(id(page, `${B}-row`), 4);
    expect(await id(page, `${B}-row`).first().innerText()).toContain('Mã vận đơn: VTP12345678');
    await count(id(page, `${B}-unread-dot`), 2);
    expect(await id(page, `${B}-row`).nth(0).locator(`[data-testid="${B}-unread-dot"]`).count()).toBe(1);
    expect(await id(page, `${B}-row`).nth(1).locator(`[data-testid="${B}-unread-dot"]`).count()).toBe(1);
    expect(await disabled(id(page, `${B}-mark-all-read`))).toBe(false);
    await id(page, `${B}-row`).first().click();
    await urlIs(page, new RegExp(`/orders/${CODE}$`));
    await page.goBack();
    await see(id(page, `${B}-trigger`));
    await badgeIs(page, '1');
    await id(page, `${B}-trigger`).click();
    await see(id(page, `${B}-panel`));
    await count(id(page, `${B}-row`), 4);
    await count(id(page, `${B}-unread-dot`), 1);
    expect(await id(page, `${B}-row`).first().locator(`[data-testid="${B}-unread-dot"]`).count()).toBe(0); // dòng đang giao không còn chấm
    await id(page, `${B}-view-all`).click();
    await urlIs(page, /\/notifications$/);
    await hasText(id(page, `${L}-unread-count`), '1');
    await summaryIs(page, '1 tới 4 trong 4 thông báo');
    await count(id(page, `${L}-unread-dot`), 1);
    expect(await id(page, `${L}-row`).nth(1).locator(`[data-testid="${L}-unread-dot"]`).count()).toBe(1); // payment_succeeded là mới thứ hai, còn chưa đọc
    expect(await textOf(id(page, `${L}-row`).nth(1).getByTestId(`${L}-title`))).toBe('Thanh toán thành công');
    expect(await id(page, `${L}-row`).first().locator(`[data-testid="${L}-unread-dot"]`).count()).toBe(0); // đơn đang giao đã đọc ở chuông
    expect((await notificationsOf('c1@x.vn')).filter((n) => n.status === 'unread').map((n) => n.type)).toEqual(['payment_succeeded']);
  });

  e2e('NTF-E2E-20261006-104226408: luồng THẬT đặt hàng COD (CHK, ORD) tạo OrderCreated, relay giao cho NTF: chuông hiện thông báo "Đã nhận đơn hàng", bấm mở đúng đơn; email qua SES giả đúng người nhận', async (page) => {
    await seedUser({ email: 'a1@x.vn', name: 'Nguyễn An' });
    await seedAddress({ email: 'a1@x.vn', receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hồ Chí Minh', is_default: true, age_ms: 60_000 });
    const cat = await seedCategory('Áo');
    const p1 = await seedProduct({ name: 'Áo thun cotton', category_id: cat, price: 150000 });
    await seedStock({ product_id: p1, on_hand: 10 });
    await seedShippingMethod({ name: 'Giao tiêu chuẩn', base_fee: 30000, rule: { free_over: 500000 } });
    await seedCoupon({ code: 'SALE10', value: 10, min_order: 200000 });
    await loginUi(page, 'a1@x.vn');
    await badgeIs(page, null); // chưa có thông báo
    const add = await page.evaluate(async ({ api, product }) => (await fetch(`${api}/cart/items`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: product, quantity: 2 }) })).status, { api: API, product: p1 });
    expect([200, 201]).toContain(add);
    await page.goto('/cart');
    await id(page, 'crt-cart-summary-checkout-link').click();
    await urlIs(page, /\/checkout(\?|$)/);
    await see(id(page, 'chk-checkout-address-section'));
    for (const t of ['chk-checkout-shipping-option', 'chk-checkout-payment-cod']) { const l = id(page, t); await see(l); if (!(await l.first().isChecked())) await l.first().click(); }
    await id(page, 'chk-checkout-place-order').click();
    await urlIs(page, /\/checkout\/complete\?/);
    const code = (await textOf(id(page, 'chk-checkout-complete-order-code'))).trim();
    expect(code).toMatch(/^[A-Z0-9]{12}$/);
    await relay(); // OrderCreated và OrderConfirmed tới NTF (consumer NTF của outbox)
    await page.reload();
    await badgeIs(page, '2'); // đơn COD: order_created rồi order_confirmed (hai thông báo, một email, BR5)
    await id(page, `${B}-trigger`).click();
    await count(id(page, `${B}-row`), 2);
    expect(await id(page, `${B}-row`).nth(1).innerText()).toContain(`Đơn #${code} đã được tạo.`);
    const n = await notificationsOf('a1@x.vn');
    expect(n.map((x) => x.type).sort()).toEqual(['order_confirmed', 'order_created']);
    await runEmailJob();
    expect((await sesMails()).map((m) => [m.to, m.subject])).toEqual([[['a1@x.vn'], 'Đã nhận đơn hàng']]);
    await id(page, `${B}-row`).nth(1).click();
    await urlIs(page, new RegExp(`/orders/${code}$`));
  });

  e2e('NTF-E2E-20261006-104226475: customer lọc chưa đọc, đánh dấu từng thông báo rồi đánh dấu tất cả; bỏ lọc trở về đủ 20 dòng', async (page) => {
    await seedUser({ email: 'c1@x.vn' });
    for (let i = 0; i < 25; i++) await seedNotification({ email: 'c1@x.vn', type: 'order_created', title: `Tiêu đề ${i}`, body: `Nội dung ${i}`, link: null, status: i < 3 ? 'unread' : 'read', age_ms: minutes(10) + (25 - i) * 1000 }); // ba dòng cuối (mới nhất) chưa đọc
    await loginUi(page, 'c1@x.vn');
    await page.goto('/notifications');
    await count(id(page, `${L}-row`), 20);
    await summaryIs(page, '1 tới 20 trong 25 thông báo');
    await see(id(page, `${L}-pagination`));
    await hasText(id(page, `${L}-unread-count`), '3');
    await stateTab(page, /^Chưa đọc/).click();
    await count(id(page, `${L}-row`), 3);
    await count(id(page, `${L}-unread-dot`), 3);
    await count(id(page, `${L}-mark-read`), 3);
    await see(id(page, `${L}-clear-filter`));
    await count(id(page, `${L}-pagination`), 0);
    await id(page, `${L}-mark-read`).first().click();
    await hasText(id(page, `${L}-unread-count`), '2');
    await count(id(page, `${L}-mark-read`), 2); // dòng đã đọc mất chấm và nút Đã đọc ngay (hoặc sau khi tải lại bộ lọc)
    await id(page, `${L}-mark-all-read`).click();
    await hasText(id(page, `${L}-unread-count`), '0');
    expect(await disabled(id(page, `${L}-mark-all-read`))).toBe(true);
    await count(id(page, `${L}-unread-dot`), 0);
    await see(id(page, `${L}-empty-filtered`));
    await id(page, `${L}-clear-filter`).click();
    await count(id(page, `${L}-row`), 20);
    await count(id(page, `${L}-empty-filtered`), 0);
    await summaryIs(page, '1 tới 20 trong 25 thông báo');
    expect((await notificationsOf('c1@x.vn')).filter((x) => x.status === 'unread')).toEqual([]);
  });

  e2e('NTF-E2E-20261006-104226538: staff nhận cảnh báo tồn thấp (event thật), lọc theo loại Tồn kho và mở màn tồn kho; customer không thấy loại này', async (page) => {
    const s1 = await seedUser({ email: 's1@x.vn', role: 'staff', name: 'Nhân Viên' });
    await seedUser({ email: 'c1@x.vn' });
    await seedNotification({ email: 's1@x.vn', type: 'password_changed', title: 'Mật khẩu đã được thay đổi', body: 'Mật khẩu tài khoản của bạn vừa được đổi lúc 01/10/2026 10:00 (giờ Việt Nam). Nếu không phải bạn, hãy đặt lại mật khẩu ngay.', link: '/forgot-password', status: 'read', age_ms: minutes(900) });
    await publishEvent('LowStockDetected', { product_id: '0f8e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', product_name: 'Áo thun cotton', on_hand: 4, available: 3, threshold: 5 });
    expect((await notificationsOf('c1@x.vn')).length).toBe(0);
    expect(s1.id).toBeTruthy();
    await loginUi(page, 's1@x.vn');
    await badgeIs(page, '1');
    await id(page, `${B}-trigger`).click();
    await id(page, `${B}-view-all`).click();
    await urlIs(page, /\/notifications$/);
    await count(id(page, `${L}-row`), 2);
    expect(await id(page, `${L}-type-filter`).locator('option', { hasText: 'Tồn kho' }).count()).toBe(1); // staff thấy loại tồn kho
    expect(await id(page, `${L}-type-filter`).locator('option', { hasText: 'Hoàn tiền thất bại' }).count()).toBe(0); // chỉ admin
    await id(page, `${L}-type-filter`).selectOption({ label: 'Tồn kho' });
    await count(id(page, `${L}-row`), 1);
    await hasText(id(page, `${L}-title`), 'Sản phẩm sắp hết hàng');
    expect(await textOf(id(page, `${L}-body`))).toContain('còn 3, ngưỡng cảnh báo 5');
    await count(id(page, `${L}-unread-dot`), 1);
    await id(page, `${L}-row`).first().locator('.ntf-item-main').click();
    await urlIs(page, /\/admin\/inventory$/);
    await page.goBack();
    await hasText(id(page, `${L}-unread-count`), '0');
    await count(id(page, `${L}-unread-dot`), 0);
    // customer: ô loại không có Tồn kho
    const ctx = await env.browser.newContext({ baseURL: WEB, locale: 'vi-VN' });
    try {
      const p2 = await ctx.newPage();
      p2.setDefaultTimeout(10_000);
      await loginUi(p2, 'c1@x.vn');
      await p2.goto('/notifications');
      await see(id(p2, `${L}-type-filter`));
      expect(await id(p2, `${L}-type-filter`).locator('option', { hasText: 'Tồn kho' }).count()).toBe(0);
      await see(id(p2, `${L}-empty`));
    } finally { await ctx.close(); }
  });

  e2e('NTF-E2E-20261006-104226604: admin có 120 chưa đọc ("99+"), gặp lỗi tải khung rồi thử lại, đánh dấu tất cả ở chuông; trạng thái lỗi đánh dấu ở trang danh sách có đường thoát', async (page) => {
    await seedUser({ email: 'a1@x.vn', role: 'admin', name: 'Quản Trị' });
    for (let i = 0; i < 120; i++) await seedNotification({ email: 'a1@x.vn', type: 'low_stock', title: 'Sản phẩm sắp hết hàng', body: `Sản phẩm SP${i} có tồn kho thấp: còn 1, ngưỡng cảnh báo 5.`, link: '/admin/inventory', age_ms: minutes(5) + (120 - i) * 1000, data: { product_id: randomUUID() } });
    await loginUi(page, 'a1@x.vn');
    await badgeIs(page, '99+');
    let fail = true;
    await page.route('**/api/v1/notifications?limit=5', async (route) => { if (fail) { fail = false; await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"type":"urn:ecom:error:internal-error","status":500}' }); } else await route.continue(); });
    await id(page, `${B}-trigger`).click();
    await see(id(page, `${B}-panel`));
    await see(id(page, `${B}-error`));
    expect(await textOf(id(page, `${B}-error`))).toContain('Không tải được thông báo.');
    await see(id(page, `${B}-retry`));
    await count(id(page, `${B}-row`), 0);
    await id(page, `${B}-retry`).click();
    await count(id(page, `${B}-error`), 0);
    await count(id(page, `${B}-row`), 5);
    await count(id(page, `${B}-unread-dot`), 5);
    await id(page, `${B}-mark-all-read`).click();
    await badgeIs(page, null);
    await count(id(page, `${B}-unread-dot`), 0);
    expect(await disabled(id(page, `${B}-mark-all-read`))).toBe(true);
    await id(page, `${B}-view-all`).click();
    await urlIs(page, /\/notifications$/);
    await hasText(id(page, `${L}-unread-count`), '0');
    await summaryIs(page, '1 tới 20 trong 120 thông báo');
    await see(id(page, `${L}-pagination`));
    // giới hạn tần suất (429): banner nêu "Thử lại sau ít giây" rồi Thử lại thành công (đường thoát)
    let limited = true;
    await page.route('**/api/v1/notifications?page=1&limit=20', async (route) => { if (limited) { limited = false; await route.fulfill({ status: 429, headers: { 'retry-after': '7' }, contentType: 'application/problem+json', body: '{"type":"urn:ecom:error:rate-limited","status":429}' }); } else await route.continue(); });
    await page.reload();
    await see(id(page, `${L}-error`));
    expect(await textOf(id(page, `${L}-error`))).toContain('Thử lại sau ít giây');
    await id(page, `${L}-retry`).click();
    await count(id(page, `${L}-row`), 20);
    await count(id(page, `${L}-error`), 0);
    // trạng thái có thời hạn có đường thoát: đánh dấu một thông báo lỗi thì hiện toast, rồi toast tự biến mất; thử lại thành công
    await seedNotification({ email: 'a1@x.vn', type: 'refund_failed', title: 'Hoàn tiền thất bại', body: 'Hoàn tiền của đơn #7K3M9Q2XH4TB bị lỗi và cần xử lý thủ công.', link: null, data: { refund_id: randomUUID() } });
    await page.reload();
    await hasText(id(page, `${L}-unread-count`), '1');
    let failRead = true;
    await page.route('**/api/v1/notifications/*/read', async (route) => { if (failRead) { failRead = false; await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"type":"urn:ecom:error:internal-error","status":500}' }); } else await route.continue(); });
    await id(page, `${L}-mark-read`).first().click();
    await see(id(page, `${L}-toast-error`));
    await hasText(id(page, `${L}-unread-count`), '1'); // dòng giữ nguyên chưa đọc
    await eventually(async () => { expect(await id(page, `${L}-toast-error`).count()).toBe(0); }, 8_000); // thoát: toast tự biến mất
    await id(page, `${L}-mark-read`).first().click();
    await hasText(id(page, `${L}-unread-count`), '0');
  });
});
