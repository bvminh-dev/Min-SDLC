import type { Page } from 'playwright-core';
import { advance, alignWindow, count, hasText, id, loginUi, reset, see, seedCategory, seedOrder, seedProduct, seedShippingMethod, seedStock, seedUser, setOrderSource, setProduct, startE2e, textOf, withPage, API, type E2eEnv } from './support';

// E2E của SAL chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web. Dữ liệu mồi dựng qua cổng điều khiển (nguồn đơn, sản phẩm, kho, phương thức vận chuyển, đơn hộ).
// Cổng riêng khi chạy song song với epic khác: `E2E_PORT_BASE=3500` (SAL); bộ E2E dùng chung CSDL `ecom_e2e` và `.next` nên mỗi lần chỉ một bộ chạy.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 180_000);

const ADDR = { receiver: 'Nguyễn An', phone: '0901234567', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', city: 'Hồ Chí Minh' };
const P = { c: 'sal-sale-create-order', l: 'sal-sale-order-list', d: 'sal-sale-order-detail' };
const bodyText = (page: Page) => page.locator('body').innerText();
/** Dữ liệu mồi chung của tài liệu E2E: S1 và S2, AD1; P1 "Áo thun cotton" 150000 (giá vốn 90000), P2 "Tất cổ cao" 50000 chỉ còn 3; SM1 30000 (miễn phí từ 500000), SM2 50000; nguồn facebook, tiktok, hotline đang bật (mồi của migration). */
async function world(): Promise<{ p1: string; p2: string }> {
  await seedUser({ email: 's1@shop.vn', role: 'sale', name: 'Trần Thu' });
  const cat = await seedCategory('Áo');
  const p1 = await seedProduct({ name: 'Áo thun cotton', category_id: cat, price: 150000, cost_price: 90000, images: 0 });
  const p2 = await seedProduct({ name: 'Tất cổ cao', category_id: cat, price: 50000, cost_price: 20000, images: 0 });
  await seedStock({ product_id: p1, on_hand: 50 });
  await seedStock({ product_id: p2, on_hand: 3 });
  await seedShippingMethod({ name: 'Giao tiêu chuẩn', base_fee: 30000, rule: { free_over: 500000 } });
  await seedShippingMethod({ name: 'Giao nhanh', base_fee: 50000 });
  return { p1, p2 };
}
/** Điền khách và địa chỉ giao đủ (người nhận giống khách). */
async function fillCustomer(page: Page): Promise<void> {
  await id(page, `${P.c}-customer-name`).fill('Nguyễn An');
  await id(page, `${P.c}-customer-phone`).fill('0901234567');
  await id(page, `${P.c}-same-as-customer`).check();
  await id(page, `${P.c}-line1`).fill(ADDR.line1);
  await id(page, `${P.c}-ward`).fill(ADDR.ward);
  await id(page, `${P.c}-city`).fill(ADDR.city);
}
/** Thêm sản phẩm theo từ khóa rồi đặt số lượng của dòng cuối. */
async function addProduct(page: Page, term: string, qty: number, name: string): Promise<void> {
  await id(page, `${P.c}-product-search`).fill(term);
  await hasText(id(page, `${P.c}-product-results`), new RegExp(name)); // chờ kết quả của từ khóa mới (không bấm nhầm kết quả cũ)
  await id(page, `${P.c}-product-add`).first().click();
  const line = id(page, `${P.c}-line-qty`).last();
  await line.fill(String(qty));
}
const eventually = async (fn: () => Promise<void>, ms = 15_000): Promise<void> => { const end = Date.now() + ms; for (;;) { try { await fn(); return; } catch (e) { if (Date.now() > end) throw e; await new Promise((r) => setTimeout(r, 100)); } } };
/** Tạo đơn hợp lệ trực tiếp bằng API từ trang đang đăng nhập (thao tác nền, mỗi lần một khóa riêng). */
const postOrders = (page: Page, body: unknown, times: number): Promise<number[]> => page.evaluate(async ({ api, b, n }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}/sales/orders`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-${Date.now()}-${k}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify(b) })).status);
  return out;
}, { api: API, b: body, n: times });

describe('E2E SAL (trình duyệt thật, API thật)', () => {
  e2e('SAL-E2E-20261015-094000544: sale tạo đơn hộ COD cho khách mới từ Facebook rồi xem trong Đơn của tôi', async (page) => {
    await world();
    await loginUi(page, 's1@shop.vn');
    await page.goto('/sales/orders/new');
    await see(id(page, `${P.c}-submit-missing`));
    expect(await id(page, `${P.c}-submit`).isDisabled()).toBe(true);
    for (const w of ['nguồn đơn', 'khách', 'địa chỉ', 'sản phẩm', 'vận chuyển']) expect(await textOf(id(page, `${P.c}-submit-missing`))).toContain(w);
    await id(page, `${P.c}-source`).selectOption({ label: 'Facebook' });
    await id(page, `${P.c}-lookup-key`).fill('0901234567');
    await id(page, `${P.c}-lookup-submit`).click();
    await see(id(page, `${P.c}-lookup-empty`));
    await fillCustomer(page);
    await id(page, `${P.c}-district`).fill('Quận 1');
    await id(page, `${P.c}-product-search`).fill('áo thun');
    await hasText(id(page, `${P.c}-product-results`), /Áo thun cotton/);
    await id(page, `${P.c}-product-add`).first().click();
    await id(page, `${P.c}-line-qty`).fill('2');
    await id(page, `${P.c}-line-note`).fill('size M, màu xanh');
    await count(id(page, `${P.c}-line`), 1);
    await hasText(id(page, `${P.c}-items-total`), '300.000 đ');
    await see(id(page, `${P.c}-shipping-options`));
    await count(id(page, `${P.c}-shipping-option`), 2);
    const opts = await textOf(id(page, `${P.c}-shipping-options`));
    expect(opts).toContain('Giao tiêu chuẩn');
    expect(opts).toContain('30.000 đ');
    expect(opts).toContain('Giao nhanh');
    expect(opts).toContain('50.000 đ');
    await id(page, `${P.c}-shipping-option`).first().check();
    await id(page, `${P.c}-payment-cod`).check();
    await id(page, `${P.c}-note`).fill('Giao giờ hành chính');
    await hasText(id(page, `${P.c}-note-counter`), '19/1000');
    await hasText(id(page, `${P.c}-shipping-fee`), '30.000 đ');
    await hasText(id(page, `${P.c}-grand-total`), '330.000 đ');
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-done`));
    const code = await textOf(id(page, `${P.c}-done-code`));
    expect(code).toMatch(/^HD\d{6}-\d{5}$/);
    await id(page, `${P.c}-done-open`).click();
    await see(id(page, `${P.d}-container`));
    await hasText(id(page, `${P.d}-code`), code);
    await hasText(id(page, `${P.d}-status`), 'Đã xác nhận');
    await hasText(id(page, `${P.d}-source`), 'Facebook');
    expect(await textOf(id(page, `${P.d}-customer`))).toMatch(/Nguyễn An.*0901234567/);
    expect(await textOf(id(page, `${P.d}-address`))).toContain('45 Nguyễn Huệ');
    await hasText(id(page, `${P.d}-note`), /Giao giờ hành chính/);
    await hasText(id(page, `${P.d}-item-note`), /size M, màu xanh/);
    await hasText(id(page, `${P.d}-grand-total`), '330.000 đ');
    expect((await bodyText(page)).toLowerCase()).not.toMatch(/giá vốn|90\.000/);
    await id(page, `${P.d}-back`).first().click();
    await see(id(page, `${P.l}-row`));
    const row = id(page, `${P.l}-row`).first();
    await hasText(row.getByTestId(`${P.l}-code`), code);
    await hasText(row.getByTestId(`${P.l}-source`), 'Facebook');
    expect(await textOf(row.getByTestId(`${P.l}-customer`))).toContain('Nguyễn An');
    await hasText(row.getByTestId(`${P.l}-total`), '330.000 đ');
    await hasText(row.getByTestId(`${P.l}-status-badge`), 'Đã xác nhận');
    expect(await textOf(id(page, `${P.l}-summary`))).toMatch(/trong [1-9]\d* đơn/);
  });

  e2e('SAL-E2E-20261015-094000581: sale gắn khách có tài khoản, thanh toán chuyển khoản', async (page) => {
    await world();
    await seedUser({ email: 'an.nguyen@shop.vn', name: 'Nguyễn An', phone: '0901234567' });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/sales/orders/new');
    await id(page, `${P.c}-source`).selectOption({ label: 'Hotline' });
    await id(page, `${P.c}-lookup-key`).fill('an.nguyen@shop.vn');
    await id(page, `${P.c}-lookup-submit`).click();
    await see(id(page, `${P.c}-lookup-results`));
    await count(id(page, `${P.c}-lookup-result`), 1);
    const hit = await textOf(id(page, `${P.c}-lookup-result`));
    expect(hit).toContain('Nguyễn An');
    expect(hit).toContain('090****567');
    expect(hit).toContain('an***@shop.vn');
    expect(hit).not.toContain('0901234567');
    expect(hit).not.toContain('an.nguyen@shop.vn');
    await id(page, `${P.c}-lookup-pick`).click();
    await hasText(id(page, `${P.c}-customer-selected`), /Nguyễn An/);
    expect(await id(page, `${P.c}-customer-name`).inputValue()).toBe('Nguyễn An');
    await id(page, `${P.c}-customer-clear`).click();
    await count(id(page, `${P.c}-customer-selected`), 0);
    await id(page, `${P.c}-lookup-submit`).click();
    await see(id(page, `${P.c}-lookup-results`));
    await id(page, `${P.c}-lookup-pick`).click();
    await see(id(page, `${P.c}-customer-selected`));
    await id(page, `${P.c}-customer-phone`).fill('0901234567');
    await id(page, `${P.c}-receiver`).fill(ADDR.receiver);
    await id(page, `${P.c}-receiver-phone`).fill(ADDR.phone);
    await id(page, `${P.c}-line1`).fill(ADDR.line1);
    await id(page, `${P.c}-ward`).fill(ADDR.ward);
    await id(page, `${P.c}-city`).fill(ADDR.city);
    await addProduct(page, 'áo thun', 1, 'Áo thun cotton');
    await see(id(page, `${P.c}-shipping-options`));
    await id(page, `${P.c}-shipping-option`).first().check();
    await id(page, `${P.c}-payment-bank-transfer`).check();
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-done`));
    await id(page, `${P.c}-done-open`).click();
    await see(id(page, `${P.d}-has-account`));
    const pay = await textOf(id(page, `${P.d}-payment`));
    expect(pay).toContain('Chuyển khoản');
    expect(pay).toContain('Chưa thu tiền');
    expect(pay.toLowerCase()).not.toContain('đã thanh toán');
    await hasText(id(page, `${P.d}-source`), 'Hotline');
    const all = await bodyText(page);
    expect(all).not.toContain('an.nguyen@shop.vn');
  });

  e2e('SAL-E2E-20261015-094000613: sale gặp hết hàng, sửa số lượng rồi tạo được đơn', async (page) => {
    await world();
    await loginUi(page, 's1@shop.vn');
    await page.goto('/sales/orders/new');
    await id(page, `${P.c}-source`).selectOption({ label: 'Facebook' });
    await fillCustomer(page);
    await id(page, `${P.c}-payment-cod`).check();
    await addProduct(page, 'tất cổ cao', 5, 'Tất cổ cao');
    await see(id(page, `${P.c}-shipping-options`));
    await id(page, `${P.c}-shipping-option`).first().check();
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-insufficient-stock`));
    const banner = await textOf(id(page, `${P.c}-insufficient-stock`));
    expect(banner).toContain('Tất cổ cao');
    expect(banner).toMatch(/cần 5/);
    expect(banner).toMatch(/còn 3/);
    await count(id(page, `${P.c}-done`), 0);
    await id(page, `${P.c}-line-qty`).fill('3');
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-done`));
    await count(id(page, `${P.c}-insufficient-stock`), 0);
    await see(id(page, `${P.c}-done-code`));
    await id(page, `${P.c}-done-new`).click();
    await fillCustomer(page);
    await id(page, `${P.c}-source`).selectOption({ label: 'Facebook' });
    await addProduct(page, 'tất cổ cao', 1, 'Tất cổ cao');
    await see(id(page, `${P.c}-shipping-options`));
    await id(page, `${P.c}-shipping-option`).first().check();
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-insufficient-stock`));
    expect(await textOf(id(page, `${P.c}-insufficient-stock`))).toMatch(/còn 0/);
    await count(id(page, `${P.c}-done`), 0);
  });

  e2e('SAL-E2E-20261015-094000645: nguồn bị tắt và sản phẩm ngừng bán giữa chừng', async (page) => {
    const { p1 } = await world();
    const cat = await seedCategory('Nón');
    const p4 = await seedProduct({ name: 'Nón lưỡi trai', category_id: cat, price: 80000, images: 0 });
    await seedStock({ product_id: p4, on_hand: 10 });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/sales/orders/new');
    await id(page, `${P.c}-source`).selectOption({ label: 'TikTok' });
    await fillCustomer(page);
    await addProduct(page, 'áo thun', 1, 'Áo thun cotton');
    await addProduct(page, 'nón lưỡi', 1, 'Nón lưỡi trai');
    await count(id(page, `${P.c}-line`), 2);
    await see(id(page, `${P.c}-shipping-options`));
    await id(page, `${P.c}-shipping-option`).first().check();
    await id(page, `${P.c}-payment-cash`).check();
    await setOrderSource('tiktok', false);
    await setProduct({ id: p4, status: 'archived' });
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-source-unavailable`));
    expect(await id(page, `${P.c}-source`).inputValue()).toBe('');
    await count(id(page, `${P.c}-done`), 0);
    await id(page, `${P.c}-source`).selectOption({ label: 'Facebook' });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-product-unavailable`));
    await count(id(page, `${P.c}-source-unavailable`), 0);
    expect(await id(page, `${P.c}-line`).filter({ hasText: 'Nón lưỡi trai' }).getAttribute('aria-invalid')).toBe('true');
    await id(page, `${P.c}-line`).filter({ hasText: 'Nón lưỡi trai' }).getByTestId(`${P.c}-line-remove`).click();
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-done`));
    await count(id(page, `${P.c}-product-unavailable`), 0);
    void p1;
  });

  e2e('SAL-E2E-20261015-094000682: tạo đơn quá nhanh: banner giới hạn rồi mở lại', async (page) => {
    const { p1 } = await world();
    await loginUi(page, 's1@shop.vn');
    const methods = await page.evaluate(async (api) => ((await (await fetch(`${api}/sales/shipping-options?city=H%C3%B2&items_subtotal=150000`, { credentials: 'include' })).json()) as { options: { method_id: string; name: string }[] }).options, API);
    const sm1 = methods.find((m) => m.name === 'Giao tiêu chuẩn')!.method_id;
    await alignWindow();
    const body = { source_code: 'facebook', customer: { full_name: 'Nguyễn An', phone: '0901234567' }, shipping_address: { ...ADDR, district: null }, shipping_method_id: sm1, payment_method: 'cod', items: [{ product_id: p1, quantity: 1 }], expected_grand_total: 180000 };
    expect(await postOrders(page, body, 10)).toEqual(Array(10).fill(201));
    await page.goto('/sales/orders/new');
    await id(page, `${P.c}-source`).selectOption({ label: 'Facebook' });
    await fillCustomer(page);
    await addProduct(page, 'áo thun', 1, 'Áo thun cotton');
    await see(id(page, `${P.c}-shipping-options`));
    await id(page, `${P.c}-shipping-option`).first().check();
    await id(page, `${P.c}-payment-cod`).check();
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-rate-limited`));
    expect(await textOf(id(page, `${P.c}-rate-limited`))).toMatch(/\d+ giây/);
    expect(await id(page, `${P.c}-submit`).isDisabled()).toBe(true);
    await count(id(page, `${P.c}-done`), 0);
    await advance(61_000); // cửa sổ giới hạn phía API sang phút mới; banner phía web hết theo Retry-After thật
    await page.getByTestId(`${P.c}-rate-limited`).waitFor({ state: 'hidden', timeout: 90_000 });
    await eventually(async () => { expect(await id(page, `${P.c}-submit`).isEnabled()).toBe(true); });
    expect(await id(page, `${P.c}-customer-name`).inputValue()).toBe('Nguyễn An');
    await id(page, `${P.c}-submit`).click();
    await see(id(page, `${P.c}-done`));
  });

  e2e('SAL-E2E-20261015-094000727: admin xem mọi đơn hộ, lọc theo người tạo và mở chi tiết', async (page) => {
    await seedUser({ email: 'ad1@shop.vn', role: 'admin', name: 'Quản Trị' });
    await seedUser({ email: 's1@shop.vn', role: 'sale', name: 'Trần Thu' });
    await seedUser({ email: 's2@shop.vn', role: 'sale', name: 'Lê Hoa' });
    await seedUser({ email: 'khach@shop.vn' });
    const ho = (by: string, code: string) => seedOrder({ code, status: 'confirmed', method: 'cod', items: [{ price: 150000, qty: 2 }], shipping: 30000, ho: { created_by_email: by, source: 'facebook', customer: { full_name: 'Nguyễn An', phone: '0901234567' } } });
    const mine = [await ho('s1@shop.vn', 'HD261015-00001'), await ho('s1@shop.vn', 'HD261015-00002'), await ho('s1@shop.vn', 'HD261015-00003'), await ho('s2@shop.vn', 'HD261015-00004'), await ho('s2@shop.vn', 'HD261015-00005')];
    await seedOrder({ email: 'khach@shop.vn', code: 'HD261015-00006', status: 'confirmed', method: 'cod', items: [{ price: 50000, qty: 1 }], shipping: 30000 }); // đơn khách tự đặt
    await loginUi(page, 'ad1@shop.vn');
    await page.goto('/sales/orders');
    await count(id(page, `${P.l}-row`), 5);
    await hasText(id(page, `${P.l}-summary`), /trong 5 đơn/);
    await count(id(page, `${P.l}-created-by`), 5);
    expect((await bodyText(page))).not.toContain('HD261015-00006');
    await id(page, `${P.l}-created-by-filter`).selectOption({ label: 'Lê Hoa' });
    await count(id(page, `${P.l}-row`), 2);
    for (const n of await id(page, `${P.l}-created-by`).allInnerTexts()) expect(n.trim()).toBe('Lê Hoa');
    await see(id(page, `${P.l}-clear-filter`));
    await id(page, `${P.l}-clear-filter`).first().click();
    await count(id(page, `${P.l}-row`), 5);
    await id(page, `${P.l}-search`).fill(mine[0].code);
    await count(id(page, `${P.l}-row`), 1);
    await id(page, `${P.l}-row`).first().click();
    await see(id(page, `${P.d}-container`));
    await hasText(id(page, `${P.d}-created-by`), 'Trần Thu');
    expect((await bodyText(page)).toLowerCase()).not.toMatch(/giá vốn/);
    await page.goto('/sales/orders');
    await id(page, `${P.l}-search`).fill('HD999999-99999');
    await see(id(page, `${P.l}-empty-filtered`));
    await id(page, `${P.l}-clear-filter`).first().click();
    await count(id(page, `${P.l}-row`), 5);
  });

  e2e('SAL-E2E-20261015-094000767: sale không thấy đơn của sale khác', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'sale', name: 'Trần Thu' });
    await seedUser({ email: 's2@shop.vn', role: 'sale', name: 'Lê Hoa' });
    await seedOrder({ code: 'HD261015-00010', status: 'confirmed', method: 'cod', items: [{ price: 150000, qty: 1 }], shipping: 30000, ho: { created_by_email: 's2@shop.vn', source: 'tiktok', customer: { full_name: 'Trần Bình', phone: '0912345678' } } });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/sales/orders');
    await see(id(page, `${P.l}-empty`));
    expect(await id(page, `${P.l}-row`).count()).toBe(0);
    await id(page, `${P.l}-search`).fill('HD261015-00010');
    await see(id(page, `${P.l}-empty-filtered`));
    await id(page, `${P.l}-clear-filter`).first().click();
    await see(id(page, `${P.l}-empty`));
    await page.goto('/sales/orders/HD261015-00010');
    await see(id(page, `${P.d}-not-found`));
    expect(await id(page, `${P.d}-container`).count()).toBe(0);
    await id(page, `${P.d}-back`).first().click();
    await see(id(page, `${P.l}-empty`));
  });
});
