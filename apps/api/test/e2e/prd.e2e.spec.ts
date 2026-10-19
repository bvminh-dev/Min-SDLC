import sharp from 'sharp';
import { kiot } from '../support/import';
import type { Page, Route } from 'playwright-core';
import { count, eventually, hasText, id, loginUi, productState, reset, s3Keys, see, seedCategory, seedProduct, seedUser, startE2e, textOf, withPage, type E2eEnv, API } from './support';

// E2E của PRD chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật trên PostgreSQL thật (CSDL `ecom_e2e`), kho ảnh là dịch vụ S3 giả trong tiến trình của máy chủ E2E
// (client S3 thật của platform nói chuyện với nó qua HTTP; có STORAGE_TEST_ENDPOINT thì là MinIO thật), bản build production của web. INV chưa có code: web gọi
// `GET /inventory/availability` được giả lập ở mức HTTP bằng `page.route` (ngoài mã ứng dụng). Mỗi test: CSDL sạch, ngữ cảnh trình duyệt mới.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);
const byId = (page: Page, testid: string, dataId: string) => page.locator(`[data-testid="${testid}"][data-id="${dataId}"]`);
const val = (page: Page, testid: string) => id(page, testid).inputValue();
/** Trình duyệt không được bật hộp thoại (alert) trong suốt test: bằng chứng chuỗi giống HTML không thực thi (SB-12). */
const noDialogs = (page: Page): string[] => { const seen: string[] = []; page.on('dialog', (d) => { seen.push(d.message()); void d.dismiss(); }); return seen; };
const jpeg = (): Promise<Buffer> => sharp({ create: { width: 300, height: 200, channels: 3, background: '#e11d48' } }).jpeg().toBuffer();
const digits = (s: string): number => Number(s.replace(/\D/g, ''));

/** INV giả ở mức HTTP: `stock` theo product_id (mặc định còn hàng), hoặc `'fail'` để làm INV lỗi. Ghi lại từng lời gọi. */
async function stubInventory(page: Page, stock: Record<string, boolean> | 'fail' = {}): Promise<{ calls: string[][] }> {
  const calls: string[][] = [];
  await page.route('**/inventory/availability**', async (route: Route) => {
    const ids = (new URL(route.request().url()).searchParams.get('product_ids') ?? '').split(',').filter(Boolean);
    calls.push(ids);
    const cors = { 'access-control-allow-origin': '*' };
    if (stock === 'fail') return route.fulfill({ status: 503, headers: cors, contentType: 'application/problem+json', body: JSON.stringify({ type: 'urn:ecom:error:service-unavailable', status: 503 }) });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ items: ids.map((p) => ({ product_id: p, in_stock: stock[p] ?? true })) }) });
  });
  return { calls };
}

describe('E2E PRD (trình duyệt thật, API thật)', () => {
  e2e('PRD-E2E-20261006-100417163 và PRD-E2E-20261006-100417219 (bước tạo): admin tạo danh mục, tạo sản phẩm nháp, thấy thiếu ảnh khi công bố, tải ảnh rồi công bố (sku bị khóa)', async (page) => {
    const dialogs = noDialogs(page);
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/categories');
    await see(id(page, 'prd-admin-category-empty'));
    await id(page, 'prd-admin-category-create-root').click();
    await id(page, 'prd-admin-category-name').fill('Thời trang');
    await id(page, 'prd-admin-category-save').click();
    await see(id(page, 'prd-admin-category-tree').locator('[data-testid="prd-admin-category-row"]', { hasText: 'Thời trang' }));

    await page.goto('/admin/products');
    await id(page, 'prd-admin-product-list-create').first().click();
    await id(page, 'prd-admin-product-edit-name').fill('Áo thun cotton');
    await id(page, 'prd-admin-product-edit-sku').fill('at-001');
    await id(page, 'prd-admin-product-edit-category').selectOption({ label: 'Thời trang' });
    await id(page, 'prd-admin-product-edit-price').fill('150000');
    await id(page, 'prd-admin-product-edit-save').click();
    await hasText(id(page, 'prd-admin-product-edit-status-badge'), 'Nháp');
    await eventually(() => expect(page.url()).toMatch(/\/admin\/products\/[0-9a-f-]{36}$/));
    const productId = page.url().split('/').at(-1)!;
    expect(await productState(productId)).toMatchObject({ status: 'draft', sku: 'AT-001', price: 150000, images: 0 });

    await id(page, 'prd-admin-product-edit-publish').click(); // chưa có ảnh
    await see(id(page, 'prd-admin-product-edit-publish-missing'));
    expect(await textOf(id(page, 'prd-admin-product-edit-publish-missing'))).toContain('Cần ít nhất 1 ảnh');
    await hasText(id(page, 'prd-admin-product-edit-status-badge'), 'Nháp');
    expect((await productState(productId))!.status).toBe('draft');

    await id(page, 'prd-admin-product-edit-image-upload').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
    await see(id(page, 'prd-admin-product-edit-image-item'));
    await count(id(page, 'prd-admin-product-edit-image-item'), 1);
    await eventually(async () => expect(await s3Keys('products/')).toHaveLength(1));
    await id(page, 'prd-admin-product-edit-publish').click();
    await eventually(async () => expect(await textOf(id(page, 'prd-admin-product-edit-status-badge'))).toBe('Đang bán'));
    expect(await id(page, 'prd-admin-product-edit-sku').isDisabled()).toBe(true);
    expect(await productState(productId)).toMatchObject({ status: 'active', images: 1 });
    await count(id(page, 'prd-admin-product-edit-publish'), 0); // không còn Công bố
    // khách thấy sản phẩm ở khu vực công khai
    await page.goto(`/products/${productId}`);
    await hasText(id(page, 'prd-product-detail-name'), 'Áo thun cotton');
    expect(dialogs).toEqual([]);
  });

  e2e('PRD-E2E-20261006-100417191: admin ngừng bán có hộp xác nhận (hủy thì giữ nguyên), rồi sản phẩm lưu trữ không sửa được và vẫn có trong danh sách quản trị', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const c = await seedCategory('Áo');
    const p = await seedProduct({ name: 'Áo thun cotton', category_id: c, images: 1 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/products');
    await byId(page, 'prd-admin-product-list-row', p).click();
    await hasText(id(page, 'prd-admin-product-edit-status-badge'), 'Đang bán');
    await id(page, 'prd-admin-product-edit-archive').click();
    await id(page, 'prd-admin-product-edit-archive-cancel').click();
    await hasText(id(page, 'prd-admin-product-edit-status-badge'), 'Đang bán');
    expect((await productState(p))!.status).toBe('active');
    await id(page, 'prd-admin-product-edit-archive').click();
    await id(page, 'prd-admin-product-edit-archive-confirm').click();
    await eventually(async () => expect(await textOf(id(page, 'prd-admin-product-edit-status-badge'))).toBe('Đã lưu trữ'));
    await see(id(page, 'prd-admin-product-edit-archived-note'));
    expect(await id(page, 'prd-admin-product-edit-name').isDisabled()).toBe(true);
    await count(id(page, 'prd-admin-product-edit-save'), 0);
    expect((await productState(p))!.status).toBe('archived');
    await page.goto('/admin/products');
    await id(page, 'prd-admin-product-list-status-filter').selectOption({ label: 'Đã lưu trữ' });
    await see(byId(page, 'prd-admin-product-list-row', p));
    expect(await textOf(byId(page, 'prd-admin-product-list-row', p).locator('[data-testid="prd-admin-product-list-status-badge"]'))).toBe('Đã lưu trữ');
  });

  e2e('PRD-E2E-20261006-100417219: admin xóa danh mục bị chặn khi còn sản phẩm lưu trữ rồi xóa được khi rỗng; ô danh mục cha loại chính nó và con cháu', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const pk = await seedCategory('Phụ kiện'), old = await seedCategory('Phụ kiện cũ');
    await seedProduct({ name: 'Ví cũ', category_id: pk, status: 'archived' });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/categories');
    await byId(page, 'prd-admin-category-row', pk).locator('[data-testid="prd-admin-category-delete"]').click();
    await id(page, 'prd-admin-category-delete-confirm').click();
    await eventually(async () => expect(await textOf(id(page, 'prd-admin-category-delete-error'))).toContain('Còn sản phẩm'));
    await see(byId(page, 'prd-admin-category-row', pk));
    await id(page, 'prd-admin-category-delete-cancel').click();
    await byId(page, 'prd-admin-category-row', old).locator('[data-testid="prd-admin-category-delete"]').click();
    await id(page, 'prd-admin-category-delete-confirm').click();
    await count(byId(page, 'prd-admin-category-row', old), 0);
    await see(byId(page, 'prd-admin-category-row', pk));
    // Bước 5: ô cha không cho chọn chính nó hay con cháu (chặn chu trình từ giao diện; server vẫn kiểm: PRD-TC-20261006-100355387)
    await byId(page, 'prd-admin-category-row', pk).locator('[data-testid="prd-admin-category-create-child"]').click();
    await id(page, 'prd-admin-category-name').fill('Phụ kiện con');
    await id(page, 'prd-admin-category-save').click();
    await see(id(page, 'prd-admin-category-tree').locator('[data-testid="prd-admin-category-row"]', { hasText: 'Phụ kiện con' }));
    const kid = (await id(page, 'prd-admin-category-tree').locator('[data-testid="prd-admin-category-row"]', { hasText: 'Phụ kiện con' }).getAttribute('data-id'))!;
    await byId(page, 'prd-admin-category-row', pk).locator('[data-testid="prd-admin-category-edit"]').click();
    const parent = id(page, 'prd-admin-category-parent');
    await see(parent);
    await count(parent.locator(`option[value="${pk}"]`), 0); // chính nó
    await count(parent.locator(`option[value="${kid}"]`), 0); // con của nó
    await count(parent.locator('option'), 1); // chỉ còn "(gốc)"
  });

  e2e('PRD-E2E-20261006-100417248: khách chưa đăng nhập duyệt theo danh mục (gồm danh mục con), lọc giá, sắp xếp, tìm kiếm và mở chi tiết; nhãn còn hàng chỉ có chữ', async (page) => {
    const root = await seedCategory('Thời trang'), ao = await seedCategory('Áo', root), thun = await seedCategory('Áo thun', ao), quan = await seedCategory('Quần', root);
    const p1 = await seedProduct({ name: 'Áo thun cotton', category_id: ao, price: 150000, images: 1, rating_count: 10, rating_sum: 45 });
    await seedProduct({ name: 'Áo sơ mi', category_id: ao, price: 90000, images: 1 });
    await seedProduct({ name: 'Áo thun cổ tròn', category_id: thun, price: 300000, images: 2 });
    await seedProduct({ name: 'Quần jean', category_id: quan, price: 500000, images: 1 });
    await stubInventory(page, { [p1]: false });
    await page.goto('/products');
    await see(id(page, 'prd-product-list-category-tree'));
    await see(id(page, 'prd-product-list-category-count'));
    await byId(page, 'prd-product-list-category-item', ao).click();
    await count(id(page, 'prd-product-list-card'), 3); // 2 của Áo và 1 của Áo thun
    expect(await textOf(id(page, 'prd-product-list-summary'))).toContain('3 sản phẩm');
    await eventually(async () => {
      const stocks = await id(page, 'prd-product-list-card-stock').allInnerTexts();
      expect(stocks).toHaveLength(3);
      for (const s of stocks) expect(['Còn hàng', 'Hết hàng']).toContain(s.trim()); // không số lượng
      expect(stocks.filter((s) => s.trim() === 'Hết hàng')).toHaveLength(1);
    });
    await id(page, 'prd-product-list-min-price').fill('100000');
    await id(page, 'prd-product-list-max-price').fill('300000');
    await id(page, 'prd-product-list-apply-price').click();
    await count(id(page, 'prd-product-list-card'), 2);
    await id(page, 'prd-product-list-sort').selectOption({ label: 'Giá tăng' });
    await eventually(async () => {
      const prices = (await id(page, 'prd-product-list-card-price').allInnerTexts()).map(digits);
      expect(prices).toEqual([150000, 300000]);
    });
    await id(page, 'prd-product-list-clear-filter').click();
    await eventually(async () => expect(await id(page, 'prd-product-list-card').count()).toBe(4));
    await id(page, 'prd-product-list-search-input').fill('ao thun');
    await id(page, 'prd-product-list-search-submit').click();
    await count(id(page, 'prd-product-list-card'), 2);
    for (const n of await id(page, 'prd-product-list-card-name').allInnerTexts()) expect(n).toContain('Áo thun');
    await eventually(async () => expect(await id(page, 'prd-product-list-card-rating').allInnerTexts()).toEqual(expect.arrayContaining(['★ 4,5 (10)', 'Chưa có đánh giá'])));
    await byId(page, 'prd-product-list-card', p1).click(); // sản phẩm có đánh giá
    await hasText(id(page, 'prd-product-detail-name'), 'Áo thun cotton');
    await see(id(page, 'prd-product-detail-price')); await see(id(page, 'prd-product-detail-breadcrumb')); await see(id(page, 'prd-product-detail-gallery'));
    await hasText(id(page, 'prd-product-detail-stock'), 'Hết hàng'); // khớp với thẻ vừa bấm
    await page.goBack();
    await id(page, 'prd-product-list-card-name').filter({ hasText: 'cổ tròn' }).click(); // sản phẩm chưa có đánh giá
    await see(id(page, 'prd-product-detail-rating-empty'));
    await hasText(id(page, 'prd-product-detail-stock'), 'Còn hàng');
  });

  e2e('PRD-E2E-20261006-100417273: customer tìm không ra gì (có nút xóa bộ lọc) và mở sản phẩm đã ngừng bán thì thấy cùng giao diện không tìm thấy', async (page) => {
    await seedUser({ email: 'c1@shop.vn' });
    const c = await seedCategory('Áo');
    await seedProduct({ name: 'Áo thun', category_id: c, images: 1 });
    const archived = await seedProduct({ name: 'Áo cũ', category_id: c, status: 'archived', images: 1 });
    await stubInventory(page);
    await loginUi(page, 'c1@shop.vn');
    await page.goto('/products');
    await see(id(page, 'prd-product-list-card'));
    await id(page, 'prd-product-list-search-input').fill('zzzzzz');
    await id(page, 'prd-product-list-search-submit').click();
    await see(id(page, 'prd-product-list-empty-filtered'));
    await count(id(page, 'prd-product-list-card'), 0);
    await id(page, 'prd-product-list-clear-filter').click();
    await see(id(page, 'prd-product-list-card'));
    await page.goto(`/products/${archived}`);
    await see(id(page, 'prd-product-detail-not-found'));
    await count(id(page, 'prd-product-detail-name'), 0);
    await id(page, 'prd-product-detail-not-found').locator('a').click();
    await see(id(page, 'prd-product-list-card'));
  });

  e2e('PRD-E2E-20261006-100417300: staff chỉ xem sản phẩm quản trị: không có thao tác ghi; màn danh mục không có quyền', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    const c = await seedCategory('Áo');
    await seedProduct({ name: 'Nháp một', category_id: c, status: 'draft', images: 1 });
    await seedProduct({ name: 'Nháp hai', category_id: c, status: 'draft' });
    await seedProduct({ name: 'Đang bán', category_id: c, images: 1 });
    await loginUi(page, 'staff@shop.vn');
    await page.goto('/admin/products');
    await count(id(page, 'prd-admin-product-list-row'), 3);
    await count(id(page, 'prd-admin-product-list-create'), 0);
    await id(page, 'prd-admin-product-list-status-filter').selectOption({ label: 'Nháp' });
    await count(id(page, 'prd-admin-product-list-row'), 2);
    for (const b of await id(page, 'prd-admin-product-list-status-badge').allInnerTexts()) expect(b.trim()).toBe('Nháp');
    await id(page, 'prd-admin-product-list-row').first().click();
    await see(id(page, 'prd-admin-product-edit-view-fields'));
    await see(id(page, 'prd-admin-product-edit-readonly-note'));
    for (const t of ['save', 'publish', 'archive', 'image-upload']) await count(id(page, `prd-admin-product-edit-${t}`), 0);
    await see(id(page, 'prd-admin-product-edit-status-badge'));
    await page.goto('/admin/categories');
    await see(id(page, 'auth-access-denied-container'));
    await count(id(page, 'prd-admin-category-tree'), 0);
  });

  e2e('PRD-TC-20261006-120604504 và PRD-TC-20261006-120650138: web ghép nhãn Còn hàng, Hết hàng từ INV theo lô (một lời gọi), INV lỗi thì ẩn nhãn mà trang và lưới vẫn đủ, không banner', async (page) => {
    const c = await seedCategory('Áo');
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await seedProduct({ name: `Sản phẩm ${String(i).padStart(2, '0')}`, category_id: c, images: 1, age_ms: i * 1000 }));
    const out = new Set(ids.slice(0, 3));
    const inv = await stubInventory(page, Object.fromEntries(ids.map((x) => [x, !out.has(x)])));
    await page.goto('/products');
    await count(id(page, 'prd-product-list-card'), 20);
    await eventually(async () => {
      const stocks = (await id(page, 'prd-product-list-card-stock').allInnerTexts()).map((s) => s.trim());
      expect([stocks.filter((s) => s === 'Hết hàng').length, stocks.filter((s) => s === 'Còn hàng').length]).toEqual([3, 17]);
    });
    expect(inv.calls).toHaveLength(1); // đúng một lời gọi theo lô cho 20 id của trang
    expect(inv.calls[0].sort()).toEqual([...ids].sort());
    // chi tiết: một lời gọi mỗi lần mở; nhãn đúng; không số lượng
    inv.calls.length = 0;
    await page.goto(`/products/${ids[0]}`);
    await hasText(id(page, 'prd-product-detail-stock'), 'Hết hàng');
    await page.goto(`/products/${ids[5]}`);
    await hasText(id(page, 'prd-product-detail-stock'), 'Còn hàng');
    expect(inv.calls).toEqual([[ids[0]], [ids[5]]]);
    // API của PRD không có trường tồn kho
    const api = await (await fetch(`${API}/products?limit=100`)).text();
    expect(api).not.toMatch(/in_stock|available|on_hand|quantity|stock/);
    // INV lỗi: PRD vẫn đủ, không nhãn, không banner lỗi
    await page.unroute('**/inventory/availability**');
    await stubInventory(page, 'fail');
    await page.goto('/products');
    await count(id(page, 'prd-product-list-card'), 20);
    await new Promise((r) => setTimeout(r, 500));
    await count(id(page, 'prd-product-list-card-stock'), 0);
    await count(id(page, 'prd-product-list-error'), 0);
    await page.goto(`/products/${ids[5]}`);
    await hasText(id(page, 'prd-product-detail-name'), 'Sản phẩm 05');
    await new Promise((r) => setTimeout(r, 500));
    await count(id(page, 'prd-product-detail-stock'), 0);
    await count(id(page, 'prd-product-detail-error'), 0);
    await see(id(page, 'prd-product-detail-price'));
  });

  e2e('PRD-TC-20261006-100355569: tên chứa mã script được hiển thị dạng chữ đã escape ở danh sách công khai, chi tiết và quản trị (không có phần tử script, không hộp thoại)', async (page) => {
    const dialogs = noDialogs(page);
    const XSS = '<script>alert(1)</script>';
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const c = await seedCategory(XSS);
    const p = await seedProduct({ name: XSS, category_id: c, images: 1, description: '<img src=x onerror=alert(2)>' });
    await stubInventory(page);
    await page.goto('/products');
    await hasText(id(page, 'prd-product-list-card-name'), XSS);
    await page.goto(`/products/${p}`);
    await hasText(id(page, 'prd-product-detail-name'), XSS);
    await hasText(id(page, 'prd-product-detail-description'), '<img src=x onerror=alert(2)>');
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/products');
    await hasText(id(page, 'prd-admin-product-list-name'), XSS);
    await page.goto(`/admin/products/${p}`);
    await eventually(async () => expect(await val(page, 'prd-admin-product-edit-name')).toBe(XSS));
    await page.goto('/admin/categories');
    await see(id(page, 'prd-admin-category-tree'));
    expect(await page.locator('main script, main img[src="x"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  e2e('PRD-E2E-20261015-094000000: admin tải mẫu, xem trước import có dòng lỗi (chưa ghi gì), xác nhận rồi thấy sản phẩm nháp ở danh sách; tệp sai loại bị từ chối', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const root = await seedCategory('Thời trang');
    await seedCategory('Áo', root);
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/products/import');
    await see(id(page, 'prd-admin-product-import-file'));
    await expect(id(page, 'prd-admin-product-import-preview').isDisabled()).resolves.toBe(true);
    await count(id(page, 'prd-admin-product-import-report'), 0);
    await count(id(page, 'prd-admin-product-import-confirm'), 0);
    // bước 2: tải mẫu
    const [download] = await Promise.all([page.waitForEvent('download'), id(page, 'prd-admin-product-import-template').click()]);
    expect(download.suggestedFilename()).toBe('mau-import-san-pham.xlsx');
    await count(id(page, 'prd-admin-product-import-template-error'), 0);
    // bước 3: chọn tệp (AT-100 hợp lệ, AT-101 nhóm hàng không có)
    const file = kiot([['AT-100', 'Áo thun', 'Thời trang>>Áo', 150000, 90000, 'Cái', 12], ['AT-101', 'Xe đồ chơi', 'Đồ chơi>>Xe', 50000, null, 'Cái', 3]]);
    await id(page, 'prd-admin-product-import-file').setInputFiles({ name: 'hang-moi.xlsx', mimeType: XLSX, buffer: file });
    await hasText(id(page, 'prd-admin-product-import-file-name'), /hang-moi\.xlsx/);
    await eventually(async () => expect(await id(page, 'prd-admin-product-import-preview').isEnabled()).toBe(true));
    // bước 4: xem trước, chưa ghi gì
    await id(page, 'prd-admin-product-import-preview').click();
    await hasText(id(page, 'prd-admin-product-import-summary'), /Tạo mới 1.*Lỗi 1/);
    await count(id(page, 'prd-admin-product-import-row'), 2);
    await hasText(id(page, 'prd-admin-product-import-row-error'), /Đồ chơi/);
    await hasText(id(page, 'prd-admin-product-import-ignored-columns'), /ĐVT/);
    await hasText(id(page, 'prd-admin-product-import-ignored-columns'), /Tồn kho/);
    const other = await page.context().newPage(); // tab khác: chưa ghi gì nên danh sách vẫn rỗng
    await other.goto('/admin/products');
    await see(id(other, 'prd-admin-product-list-empty'));
    await other.close();
    // bước 5: chỉ dòng lỗi, rồi xác nhận
    await id(page, 'prd-admin-product-import-errors-only').check();
    await count(id(page, 'prd-admin-product-import-row'), 1);
    await id(page, 'prd-admin-product-import-confirm').click();
    await hasText(id(page, 'prd-admin-product-import-result'), /Tạo mới 1/);
    await hasText(id(page, 'prd-admin-product-import-result'), /Lỗi 1/);
    // bước 6: danh sách sản phẩm
    await page.goto('/admin/products');
    await id(page, 'prd-admin-product-list-search').fill('AT-100');
    await count(id(page, 'prd-admin-product-list-row'), 1);
    await hasText(id(page, 'prd-admin-product-list-sku'), 'AT-100');
    await hasText(id(page, 'prd-admin-product-list-status-badge'), 'Nháp');
    await id(page, 'prd-admin-product-list-search').fill('AT-101');
    await see(id(page, 'prd-admin-product-list-empty-filtered'));
    // bước 7: tệp .xlsx thực chất là PDF
    await page.goto('/admin/products/import');
    await id(page, 'prd-admin-product-import-file').setInputFiles({ name: 'gia.xlsx', mimeType: XLSX, buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n') });
    await id(page, 'prd-admin-product-import-preview').click();
    await hasText(id(page, 'prd-admin-product-import-file-error'), /Sai loại tệp/);
    await count(id(page, 'prd-admin-product-import-report'), 0);
  });

  e2e('PRD-E2E-20261015-094100000: admin tạo sản phẩm có giá vốn (ô Giá bán và Giá vốn), giá vốn sai bị chặn, sửa giá vốn rồi xóa giá vốn; không bắt buộc để lưu', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    await seedCategory('Áo');
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/products');
    await id(page, 'prd-admin-product-list-create').first().click();
    await id(page, 'prd-admin-product-edit-name').fill('Áo thun cotton');
    await id(page, 'prd-admin-product-edit-sku').fill('at-010');
    await id(page, 'prd-admin-product-edit-category').selectOption({ label: 'Áo' });
    await expect(page.getByLabel('Giá bán (đ) *').count()).resolves.toBe(1); // nhãn "Giá bán"
    await id(page, 'prd-admin-product-edit-price').fill('150000');
    await id(page, 'prd-admin-product-edit-cost-price').fill('90000');
    await id(page, 'prd-admin-product-edit-save').click();
    await hasText(id(page, 'prd-admin-product-edit-status-badge'), 'Nháp');
    await eventually(async () => expect(await val(page, 'prd-admin-product-edit-cost-price')).toBe('90000'));
    const productId = page.url().split('/').at(-1)!;
    expect(await productState(productId)).toMatchObject({ price: 150000, cost_price: 90000 });
    // bước 3: giá vốn âm bị chặn, giá vốn đã lưu giữ nguyên
    await id(page, 'prd-admin-product-edit-cost-price').fill('-1');
    await id(page, 'prd-admin-product-edit-save').click();
    await hasText(id(page, 'prd-admin-product-edit-field-error'), /Giá vốn/);
    await page.reload();
    await eventually(async () => expect(await val(page, 'prd-admin-product-edit-cost-price')).toBe('90000'));
    // bước 4: sửa giá vốn
    await id(page, 'prd-admin-product-edit-cost-price').fill('95000');
    await id(page, 'prd-admin-product-edit-save').click();
    await eventually(async () => expect((await productState(productId))?.cost_price).toBe(95000));
    await page.reload();
    await eventually(async () => expect(await val(page, 'prd-admin-product-edit-cost-price')).toBe('95000'));
    // bước 5: xóa trống giá vốn
    await id(page, 'prd-admin-product-edit-cost-price').fill('');
    await id(page, 'prd-admin-product-edit-save').click();
    await eventually(async () => expect((await productState(productId))?.cost_price).toBeNull());
    await page.reload();
    await eventually(async () => expect(await val(page, 'prd-admin-product-edit-cost-price')).toBe(''));
    await count(id(page, 'prd-admin-product-edit-field-error'), 0);
  });

  e2e('PRD-E2E-20261015-094200000: sale xem sản phẩm quản trị chỉ đọc, không có nút tạo hay nhập Excel, không có giá vốn ở bất kỳ đâu trong trang', async (page) => {
    await seedUser({ email: 'sale@shop.vn', role: 'sale' });
    const c = await seedCategory('Áo');
    const p = await seedProduct({ name: 'Áo thun', sku: 'AT-001', category_id: c, price: 150000, cost_price: 90000, images: 1 });
    await loginUi(page, 'sale@shop.vn');
    await page.goto('/admin/products');
    await see(id(page, 'prd-admin-product-list-row'));
    expect((await textOf(id(page, 'prd-admin-product-list-price'))).replace(/\D/g, '')).toBe('150000');
    await count(id(page, 'prd-admin-product-list-create'), 0);
    await count(id(page, 'prd-admin-product-list-import'), 0);
    expect(await page.content()).not.toContain('90000');
    await id(page, 'prd-admin-product-list-row').first().click();
    await eventually(async () => expect(page.url()).toContain(`/admin/products/${p}`));
    await see(id(page, 'prd-admin-product-edit-view-fields'));
    expect(await textOf(id(page, 'prd-admin-product-edit-readonly-note'))).toContain('Bạn chỉ có quyền xem');
    for (const t of ['save', 'publish', 'archive', 'image-upload', 'cost-price']) await count(id(page, `prd-admin-product-edit-${t}`), 0);
    expect(await page.content()).not.toContain('90000');
    await page.goto('/admin/products/import'); // staff, sale không vào được màn import
    await see(id(page, 'auth-access-denied-container'));
    await count(id(page, 'prd-admin-product-import-file'), 0);
  });
});
