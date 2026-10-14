import type { Locator, Page } from 'playwright-core';
import {
  advance, alignWindow, cartCount, cartState, count, eventually, hasText, id, loginUi, reset, see, seedCart, seedCategory, seedCoupon, seedProduct, seedShippingMethod, seedStock, seedUser, setProduct, startE2e, textOf, urlIs, withPage, WEB,
  type E2eEnv, API} from './support';

// E2E của CRT chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web. Giỏ, sản phẩm, kho, mã và phương thức vận chuyển
// dựng thẳng qua cổng điều khiển (đăng nhập bằng giao diện). Tiền tệ hiển thị "150.000 đ", giảm giá có dấu trừ thật "−30.000 đ". Mã đơn không dùng: CRT chưa có đơn.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
let category = '';
beforeEach(async () => { await reset(); category = ''; });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);

/** Giá trị của ô nhập (innerText của <input> rỗng). */
const valIs = (l: Locator, expected: string) => eventually(async () => { expect(await l.first().inputValue()).toBe(expected); });
/** Nút bị khóa theo aria-disabled hay disabled. */
const locked = async (l: Locator): Promise<boolean> => { await see(l); return (await l.first().getAttribute('aria-disabled')) === 'true' || !(await l.first().isEnabled()); };
const lockedIs = (l: Locator, want: boolean) => eventually(async () => { expect(await locked(l)).toBe(want); });
const C = { atc: 'crt-add-to-cart', cart: 'crt-cart', sum: 'crt-cart-summary', line: 'crt-cart-line' };
/** Sản phẩm đang bán kèm kho; trả id. */
async function item(name: string, price: number, onHand: number, o: { images?: number } = {}): Promise<string> {
  category ||= await seedCategory('Áo'); // tên danh mục duy nhất theo cha: một danh mục cho cả test
  const p = await seedProduct({ name, category_id: category, price, images: o.images ?? 0 });
  await seedStock({ product_id: p, on_hand: onHand });
  return p;
}
const customer = async (email = 'a1@x.vn') => { await seedUser({ email }); return email; };
/** Gọi API trực tiếp từ trang đang đăng nhập (cookie phiên của trình duyệt); trả danh sách mã trạng thái. */
const fromPage = (page: Page, path: string, init: { method: string; body: unknown }, times = 1): Promise<number[]> => page.evaluate(async ({ api, p, n, i }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}${p}`, { method: i.method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(i.body) })).status);
  return out;
}, { api: API, p: path, n: times, i: init });

describe('E2E CRT (trình duyệt thật, API thật)', () => {
  e2e('CRT-E2E-20261006-104523348: customer thêm sản phẩm từ trang chi tiết, đổi số lượng rồi xóa khỏi giỏ', async (page) => {
    const email = await customer();
    const p = await item('Áo thun cotton', 150000, 10);
    await loginUi(page, email);
    await page.goto(`/products/${p}`);
    await hasText(id(page, 'prd-product-detail-name'), 'Áo thun cotton');
    await hasText(id(page, 'prd-product-detail-price'), '150.000 đ');
    await id(page, `${C.atc}-quantity-increase`).click();
    await valIs(id(page, `${C.atc}-quantity`), '2');
    await id(page, `${C.atc}-submit`).click();
    await hasText(id(page, `${C.atc}-success`), /^Đã thêm vào giỏ/);
    await hasText(id(page, `${C.atc}-badge-count`), '2');
    expect((await cartState(email))?.items).toEqual([{ product_id: p, quantity: 2, unit_price: 150000, unavailable_reason: null }]);
    await id(page, `${C.atc}-view-cart`).click();
    await urlIs(page, /\/cart$/);
    await count(id(page, C.line), 1);
    await hasText(id(page, `${C.line}-unit-price`), '150.000 đ');
    await hasText(id(page, `${C.line}-total`), '300.000 đ');
    await hasText(id(page, `${C.sum}-subtotal`), '300.000 đ');
    await id(page, `${C.line}-quantity-increase`).click();
    await valIs(id(page, `${C.line}-quantity`), '3');
    await hasText(id(page, `${C.line}-total`), '450.000 đ');
    await hasText(id(page, `${C.sum}-subtotal`), '450.000 đ');
    await hasText(id(page, `${C.atc}-badge-count`), '3');
    await id(page, `${C.line}-remove`).click();
    await hasText(id(page, `${C.cart}-empty`), /Giỏ hàng trống/);
    await count(id(page, C.line), 0);
    await hasText(id(page, `${C.sum}-total`), '0 đ');
    await count(id(page, `${C.atc}-badge-count`), 0);
  });

  // Ca bổ sung của review (REV-CRT-20, CRT-REQ-20261006-103226434 BR3): đột biến "404 khi xóa không đọc lại giỏ" ở app/cart/page.tsx lọt cả bảng đột biến của implement.
  e2e('CRT-E2E-20261006-104523348 (REV-CRT-20): hai tab cùng xóa một dòng: tab chậm nhận 404, giao diện coi là đã xóa và đọc lại giỏ', async (page) => {
    const email = await customer();
    const p1 = await item('Áo thun cotton', 150000, 10), p2 = await item('Tất cổ cao', 50000, 10);
    await seedCart({ email, lines: [{ product_id: p1, quantity: 1 }, { product_id: p2, quantity: 2 }] });
    await loginUi(page, email);
    await page.goto('/cart');
    await count(id(page, C.line), 2);
    const other = await page.context().newPage();
    await other.goto('/cart');
    await count(id(other, C.line), 2);
    await id(other, `${C.line}-remove`).first().click();
    await count(id(other, C.line), 1);
    await other.close();
    await count(id(page, C.line), 2); // tab này chưa biết dòng đầu đã bị xóa
    await id(page, `${C.line}-remove`).first().click();
    await count(id(page, C.line), 1);
    await hasText(id(page, `${C.line}-name`), 'Tất cổ cao');
    expect((await cartState(email))?.items).toEqual([{ product_id: p2, quantity: 2, unit_price: 50000, unavailable_reason: null }]);
  });

  e2e('CRT-E2E-20261006-104523405: customer áp mã SALE10, chọn vận chuyển rồi thấy tổng đúng', async (page) => {
    const email = await customer();
    const p = await item('Áo thun cotton', 150000, 10);
    await seedCoupon({ code: 'SALE10', value: 10, min_order: 200000 });
    const m = await seedShippingMethod({ name: 'Giao tiêu chuẩn', base_fee: 30000, rule: { free_over: 500000 } });
    await seedCart({ email, lines: [{ product_id: p }] });
    await loginUi(page, email);
    await page.goto('/cart');
    await hasText(id(page, `${C.sum}-subtotal`), '150.000 đ');
    await id(page, `${C.sum}-coupon-input`).fill('sale10');
    await id(page, `${C.sum}-coupon-apply`).click();
    await eventually(async () => expect(await textOf(id(page, `${C.sum}-coupon-error`))).toContain('50.000 đ'));
    await count(id(page, `${C.sum}-coupon-applied`), 0);
    await id(page, `${C.line}-quantity-increase`).click();
    await hasText(id(page, `${C.sum}-subtotal`), '300.000 đ');
    await id(page, `${C.sum}-coupon-apply`).click();
    await eventually(async () => { const t = await textOf(id(page, `${C.sum}-coupon-applied`)); expect(t).toContain('SALE10'); expect(t).toContain('−30.000 đ'); });
    await hasText(id(page, `${C.sum}-discount`), '−30.000 đ');
    await hasText(id(page, `${C.sum}-total-estimate`), 'Chưa gồm phí vận chuyển');
    await hasText(id(page, `${C.sum}-total`), '270.000 đ');
    await id(page, `${C.sum}-shipping-method`).getByLabel(/Giao tiêu chuẩn/).check();
    await id(page, `${C.sum}-shipping-city`).fill('Hà Nội');
    await hasText(id(page, `${C.sum}-shipping-fee`), '30.000 đ');
    await hasText(id(page, `${C.sum}-total`), '300.000 đ');
    await count(id(page, `${C.sum}-total-estimate`), 0);
    expect((await cartState(email))).toMatchObject({ coupon_code: 'SALE10', shipping_method_id: m.id, shipping_city: 'Hà Nội' });
    await id(page, `${C.sum}-coupon-remove`).click();
    await count(id(page, `${C.sum}-coupon-applied`), 0);
    await hasText(id(page, `${C.sum}-total`), '330.000 đ');
    expect((await cartState(email))?.coupon_code).toBeNull();
  });

  e2e('CRT-E2E-20261006-104523460: customer thấy dòng thiếu hàng, bị chặn thanh toán rồi giảm số lượng để đi tiếp', async (page) => {
    const email = await customer();
    const p = await item('Tất cổ cao', 50000, 2);
    await seedCart({ email, lines: [{ product_id: p, quantity: 3 }] });
    await loginUi(page, email);
    await page.goto('/cart');
    await hasText(id(page, `${C.line}-stock-warning`), /Chỉ còn 2 sản phẩm$/);
    await valIs(id(page, `${C.line}-quantity`), '3'); // không tự giảm
    await hasText(id(page, `${C.cart}-blockers-notice`), 'Cần xử lý 1 sản phẩm trước khi thanh toán');
    await see(id(page, `${C.sum}-checkout-disabled-reason`));
    await lockedIs(id(page, `${C.sum}-checkout-link`), true);
    await id(page, `${C.line}-quantity-increase`).click();
    await hasText(id(page, `${C.line}-error`), 'Chỉ còn 2 sản phẩm');
    await valIs(id(page, `${C.line}-quantity`), '3');
    await id(page, `${C.line}-quantity-decrease`).click();
    await valIs(id(page, `${C.line}-quantity`), '2');
    await count(id(page, `${C.line}-stock-warning`), 0);
    await count(id(page, `${C.cart}-blockers-notice`), 0);
    await lockedIs(id(page, `${C.sum}-checkout-link`), false);
    expect((await cartState(email))?.items[0].quantity).toBe(2);
  });

  e2e('CRT-E2E-20261006-104523460: giỏ không tải được (503) hiện khối tóm tắt lỗi khóa nút thanh toán, bấm Thử lại thì tải được; phiên hết hạn (401) hiện liên kết Đăng nhập', async (page) => {
    // YẾU: phản hồi 503 và 401 của GET /cart do trình duyệt giả (page.route), không do PRD hay phiên thật hỏng; render thật của trang production
    const email = await customer();
    const p = await item('Áo thun cotton', 150000, 10);
    await seedCart({ email, lines: [{ product_id: p }] });
    await loginUi(page, email);
    const CORS = { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' }; // API và web khác nguồn: phản hồi giả phải có CORS như API thật
    let fail = true;
    await page.route(`${API}/cart`, (route) => (fail ? route.fulfill({ status: 503, headers: CORS, contentType: 'application/problem+json', body: JSON.stringify({ type: 'urn:ecom:error:service-unavailable', title: 'x', status: 503, trace_id: 't' }) }) : route.continue()));
    await page.goto('/cart');
    await see(id(page, `${C.cart}-error`));
    await see(id(page, `${C.sum}-error`));
    await count(id(page, `${C.sum}-checkout-link`), 0); // không có liên kết thanh toán khi chưa có tổng
    fail = false;
    await id(page, `${C.sum}-retry`).click();
    await hasText(id(page, `${C.sum}-subtotal`), '150.000 đ');
    await count(id(page, `${C.sum}-error`), 0);
    await page.unroute(`${API}/cart`);
    await page.route(`${API}/cart`, (route) => route.fulfill({ status: 401, headers: CORS, contentType: 'application/problem+json', body: JSON.stringify({ type: 'urn:ecom:error:unauthenticated', title: 'x', status: 401, trace_id: 't' }) }));
    await page.reload();
    await see(id(page, `${C.cart}-session-expired`));
    await see(id(page, `${C.sum}-session-expired`));
  });

  e2e('CRT-E2E-20261006-104523521: customer thấy giá đã đổi và xác nhận bằng nút cập nhật giá', async (page) => {
    const email = await customer();
    const p = await item('Áo thun cotton', 150000, 10);
    await seedCart({ email, lines: [{ product_id: p, quantity: 2, price: 140000 }] }); // thêm lúc 140.000 đ, giá hiện hành 150.000 đ
    await loginUi(page, email);
    await page.goto('/cart');
    await see(id(page, `${C.cart}-price-changed-banner`));
    await hasText(id(page, `${C.line}-unit-price`), '150.000 đ');
    await hasText(id(page, `${C.line}-previous-price`), '140.000 đ');
    await hasText(id(page, `${C.line}-total`), '300.000 đ');
    await hasText(id(page, `${C.sum}-subtotal`), '300.000 đ'); // tiền theo giá hiện hành
    await id(page, `${C.cart}-refresh-prices`).click();
    await count(id(page, `${C.cart}-price-changed-banner`), 0);
    await count(id(page, `${C.line}-previous-price`), 0);
    await hasText(id(page, `${C.line}-unit-price`), '150.000 đ');
    await valIs(id(page, `${C.line}-quantity`), '2');
    expect((await cartState(email))?.items[0]).toMatchObject({ unit_price: 150000, quantity: 2 });
  });

  e2e('CRT-E2E-20261006-104523568: customer làm trống giỏ: bấm giữ giỏ trước rồi xác nhận làm trống', async (page) => {
    const email = await customer();
    await seedCoupon({ code: 'SALE10', value: 10 });
    const ps = [await item('Áo A', 100000, 10), await item('Áo B', 120000, 10), await item('Áo C', 140000, 10)];
    await seedCart({ email, lines: ps.map((product_id) => ({ product_id })), coupon: 'SALE10' });
    await loginUi(page, email);
    await page.goto('/cart');
    await count(id(page, C.line), 3);
    await see(id(page, `${C.sum}-coupon-applied`));
    await id(page, `${C.cart}-clear`).click();
    await see(id(page, `${C.cart}-clear-dialog`));
    await id(page, `${C.cart}-clear-dismiss`).click();
    await count(id(page, `${C.cart}-clear-dialog`), 0);
    await count(id(page, C.line), 3);
    await id(page, `${C.cart}-clear`).click();
    await id(page, `${C.cart}-clear-confirm`).click();
    await hasText(id(page, `${C.cart}-clear-success`), 'Đã làm trống giỏ');
    await see(id(page, `${C.cart}-empty`));
    await see(id(page, `${C.atc}-badge`));
    await count(id(page, `${C.atc}-badge-count`), 0);
    await count(id(page, `${C.sum}-coupon-applied`), 0);
    await count(id(page, `${C.cart}-clear-success`), 0); // thông báo ngắn tự mất (đường thoát của trạng thái có thời hạn)
    await page.reload();
    await see(id(page, `${C.cart}-empty`)); // giỏ trống ở máy chủ, không chỉ ở giao diện
    expect((await cartState(email))?.items).toEqual([]);
  });

  e2e('CRT-E2E-20261006-104523612: customer gặp dòng sản phẩm ngừng bán, xóa dòng đó rồi đi tiếp', async (page) => {
    const email = await customer();
    const shirt = await item('Áo thun cotton', 150000, 10), shorts = await item('Quần short', 90000, 10);
    await seedCart({ email, lines: [{ product_id: shirt }, { product_id: shorts, quantity: 2 }] });
    await setProduct({ id: shorts, status: 'archived', event: true }); // admin ngừng bán: ProductArchived đánh dấu dòng, PRD cũng báo không còn bán
    expect((await cartState(email))?.items[1].unavailable_reason).toBe('product_archived');
    await loginUi(page, email);
    await page.goto('/cart');
    await count(id(page, C.line), 2);
    await hasText(id(page, `${C.line}-unavailable`), 'Ngừng bán');
    await hasText(id(page, `${C.sum}-subtotal`), '150.000 đ');
    await see(id(page, `${C.cart}-blockers-notice`));
    await lockedIs(id(page, `${C.sum}-checkout-link`), true);
    await see(id(page, `${C.sum}-checkout-disabled-reason`));
    await page.locator(`[data-testid="${C.line}"]`, { hasText: 'Quần short' }).getByTestId(`${C.line}-remove`).click();
    await count(id(page, C.line), 1);
    await count(id(page, `${C.cart}-blockers-notice`), 0);
    await lockedIs(id(page, `${C.sum}-checkout-link`), false);
    await hasText(id(page, `${C.sum}-subtotal`), '150.000 đ');
  });

  e2e('CRT-TC-20261006-104453118: tên sản phẩm chứa HTML hiển thị nguyên văn, không thực thi (không có img trong tên, không có hộp thoại alert)', async (page) => {
    const email = await customer();
    const name = '<img src=x onerror=alert(1)>';
    const p = await item(name, 100000, 10);
    await seedCart({ email, lines: [{ product_id: p }] });
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await loginUi(page, email);
    await page.goto('/cart');
    await hasText(id(page, `${C.line}-name`), name);
    expect(await id(page, `${C.line}-name`).locator('img').count()).toBe(0);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
    const api = await page.evaluate(async (u) => (await (await fetch(`${u}/cart`, { credentials: 'include' })).json()) as { items: { name: string }[] }, API);
    expect(api.items[0].name).toBe(name); // chuỗi thô ở JSON, escape là việc của giao diện
  });

  e2e('CRT-TC-20261007-085336986: thử mã giảm giá quá nhiều trên giỏ hiện thử lại sau N giây, nút Áp dụng mở lại khi hết giờ chờ', async (page) => {
    await page.clock.install(); // đồng hồ trình duyệt do test điều khiển (Retry-After của PRM tới 600 giây); đồng hồ API do cổng điều khiển tua
    const email = await customer();
    const p = await item('Áo thun cotton', 150000, 10);
    await seedCoupon({ code: 'SALE10', value: 10 });
    await seedCart({ email, lines: [{ product_id: p, quantity: 2 }] });
    await loginUi(page, email);
    await page.goto('/cart');
    await see(id(page, `${C.sum}-coupon-input`));
    await alignWindow(600); // mười lần sai nằm trọn một cửa sổ 10 phút của PRM, chia hai cửa sổ 60 giây của giới hạn CRT (10 lần mỗi phút)
    const wrong = (n: number) => fromPage(page, '/cart/coupon', { method: 'PUT', body: { code: `NOPE${n}XYZ` } });
    for (let i = 0; i < 5; i++) expect(await wrong(i)).toEqual([404]);
    await advance(61_000);
    for (let i = 5; i < 10; i++) expect(await wrong(i)).toEqual([404]);
    await id(page, `${C.sum}-coupon-input`).fill('SALE10');
    await id(page, `${C.sum}-coupon-apply`).click();
    let n = 0;
    await eventually(async () => { const m = (await textOf(id(page, `${C.sum}-coupon-retry-after`))).match(/^Bạn thử quá nhiều lần, thử lại sau (\d+) giây$/); expect(m).toBeTruthy(); n = Number(m![1]); });
    expect(n).toBeGreaterThan(0);
    await lockedIs(id(page, `${C.sum}-coupon-apply`), true);
    await count(id(page, `${C.sum}-coupon-applied`), 0);
    expect((await cartState(email))?.coupon_code).toBeNull();
    await advance((n + 5) * 1000); // API: sang cửa sổ mới
    await page.clock.fastForward((n + 3) * 1000); // trình duyệt: hết giờ chờ
    await count(id(page, `${C.sum}-coupon-retry-after`), 0);
    await lockedIs(id(page, `${C.sum}-coupon-apply`), false);
    await id(page, `${C.sum}-coupon-apply`).click();
    await see(id(page, `${C.sum}-coupon-applied`));
    expect((await cartState(email))?.coupon_code).toBe('SALE10');
  });

  e2e('CRT-TC-20261006-104451226: thêm quá số còn bán hiện "Chỉ còn N sản phẩm" ngay tại khối thêm vào giỏ, giỏ không đổi; thành công tự ẩn thông báo', async (page) => {
    const email = await customer();
    const p = await item('Áo thun cotton', 150000, 3);
    await loginUi(page, email);
    await page.goto(`/products/${p}`);
    await id(page, `${C.atc}-quantity`).fill('5');
    await id(page, `${C.atc}-submit`).click();
    await hasText(id(page, `${C.atc}-error-stock`), 'Chỉ còn 3 sản phẩm');
    expect(await cartCount()).toEqual({ carts: 0, items: 0 });
    await id(page, `${C.atc}-quantity`).fill('0');
    await see(id(page, `${C.atc}-error-quantity`).or(id(page, `${C.atc}-submit`)));
    await lockedIs(id(page, `${C.atc}-submit`), true); // ô sai thì nút không gửi
    await id(page, `${C.atc}-quantity`).fill('2');
    await id(page, `${C.atc}-submit`).click();
    await see(id(page, `${C.atc}-success`));
    await count(id(page, `${C.atc}-success`), 0); // thông báo thành công tự ẩn sau vài giây
    await hasText(id(page, `${C.atc}-badge-count`), '2');
  });

  e2e('CRT-TC-20261006-104451291: khách chưa đăng nhập bấm Thêm vào giỏ nhận 401 và được mời đăng nhập kèm quay lại đúng sản phẩm; staff không thấy khối thêm vào giỏ', async (page) => {
    const p = await item('Áo thun cotton', 150000, 10);
    await seedUser({ email: 's1@shop.vn', role: 'staff' });
    await page.goto(`/products/${p}`);
    await id(page, `${C.atc}-submit`).click();
    await see(id(page, `${C.atc}-session-expired`));
    const href = await id(page, `${C.atc}-session-expired`).locator('a').getAttribute('href');
    expect(href).toContain(encodeURIComponent(`/products/${p}`));
    expect(await cartCount()).toEqual({ carts: 0, items: 0 });
    await loginUi(page, 's1@shop.vn');
    await page.goto(`/products/${p}`);
    await see(id(page, 'prd-product-detail-name'));
    await count(id(page, `${C.atc}-submit`), 0);
    await count(id(page, `${C.atc}-badge`), 0);
    expect(WEB).toContain('localhost');
  });
});
