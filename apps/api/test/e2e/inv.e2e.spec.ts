import type { Page } from 'playwright-core';
import { alignWindow, advance, count, eventually, hasText, id, loginUi, reset, see, seedCategory, seedMovement, seedProduct, seedStock, seedUser, startE2e, stockState, textOf, withPage, type E2eEnv } from './support';

// E2E của INV chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web.
// Giới hạn tần suất dùng đồng hồ của API do cổng điều khiển tua (không chờ 60 giây thật). Mỗi test: CSDL sạch, ngữ cảnh trình duyệt mới.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);
const API = 'http://localhost:3101/api/v1';

/** Sản phẩm Áo thun cotton (AT-001) với bản ghi kho đã dựng. */
async function atShirt(stock: { on_hand: number; reserved?: number; threshold?: number; version?: number }): Promise<string> {
  const cat = await seedCategory('Thời trang');
  const product = await seedProduct({ name: 'Áo thun cotton', sku: 'AT-001', category_id: cat });
  await seedStock({ product_id: product, ...stock });
  return product;
}
/** Gọi API trực tiếp từ trang đang đăng nhập (cookie phiên của trình duyệt); trả danh sách mã trạng thái. */
const fromPage = (page: Page, path: string, times = 1, init?: { method: string; body: unknown; idem: string }): Promise<number[]> => page.evaluate(async ({ api, p, n, i }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}${p}`, { method: i?.method ?? 'GET', credentials: 'include', headers: i ? { 'Content-Type': 'application/json', 'Idempotency-Key': i.idem } : undefined, body: i ? JSON.stringify(i.body) : undefined })).status);
  return out;
}, { api: API, p: path, n: times, i: init });

describe('E2E INV (trình duyệt thật, API thật)', () => {
  e2e('INV-E2E-20261006-101122818: staff tìm AT-001, mở chi tiết, nhập kho 40 từ NCC rồi thấy số tăng, thông báo và dòng lịch sử', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    const product = await atShirt({ on_hand: 10, reserved: 3 });
    await loginUi(page, 'staff@shop.vn');
    await page.goto('/admin/inventory');
    await id(page, 'inv-inventory-list-search').fill('AT-001');
    await see(id(page, 'inv-inventory-list-row'));
    await count(id(page, 'inv-inventory-list-row'), 1);
    await id(page, 'inv-inventory-list-row').click();
    await hasText(id(page, 'inv-inventory-detail-available'), '7');
    await id(page, 'inv-inventory-detail-stock-in').click();
    await id(page, 'inv-inventory-detail-stock-in-quantity').fill('40');
    await id(page, 'inv-inventory-detail-stock-in-reason').selectOption({ label: 'Nhập từ NCC' });
    await id(page, 'inv-inventory-detail-stock-in-submit').click();
    await hasText(id(page, 'inv-inventory-detail-toast'), 'Đã nhập 40 đơn vị');
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '50');
    await hasText(id(page, 'inv-inventory-detail-available'), '47');
    expect(await stockState(product)).toMatchObject({ on_hand: 50, reserved: 3, version: 2 });
    await id(page, 'inv-inventory-detail-history-link').click();
    const first = id(page, 'inv-inventory-history-row').first();
    await see(first);
    await hasText(first.getByTestId('inv-inventory-history-type'), 'Nhập kho');
    await hasText(first.getByTestId('inv-inventory-history-quantity'), '+40');
    await hasText(first.getByTestId('inv-inventory-history-on-hand-after'), '50');
  });

  e2e('INV-E2E-20261006-101122845: admin xuất kho vượt số còn bán được thì bị từ chối trong hộp thoại, sửa về 40 thì xuất được và hiện Tồn thấp', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const product = await atShirt({ on_hand: 50, reserved: 10 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/inventory');
    await id(page, 'inv-inventory-list-row').first().click();
    await id(page, 'inv-inventory-detail-stock-out').click();
    await hasText(id(page, 'inv-inventory-detail-stock-out-max'), '40');
    await id(page, 'inv-inventory-detail-stock-out-quantity').fill('41');
    await id(page, 'inv-inventory-detail-stock-out-reason').selectOption({ label: 'Hỏng' });
    await id(page, 'inv-inventory-detail-stock-out-submit').click();
    await hasText(id(page, 'inv-inventory-detail-stock-out-error'), 'Chỉ còn 40 có thể xuất');
    await see(id(page, 'inv-inventory-detail-stock-out-submit')); // hộp thoại vẫn mở
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '50');
    expect((await stockState(product))!.on_hand).toBe(50);
    await id(page, 'inv-inventory-detail-stock-out-quantity').fill('40');
    await id(page, 'inv-inventory-detail-stock-out-submit').click();
    await see(id(page, 'inv-inventory-detail-toast'));
    await hasText(id(page, 'inv-inventory-detail-available'), '0');
    await see(id(page, 'inv-inventory-detail-low-badge'));
    expect(await stockState(product)).toMatchObject({ on_hand: 10, reserved: 10 });
  });

  e2e('INV-E2E-20261006-101122872: hai nhân viên điều chỉnh cùng lúc, người sau gặp xung đột phiên bản, tải lại rồi điều chỉnh được', async (page) => {
    await seedUser({ email: 'staff1@shop.vn', role: 'staff' });
    await seedUser({ email: 'staff2@shop.vn', role: 'staff' });
    const product = await atShirt({ on_hand: 18, reserved: 4, version: 7 });
    await loginUi(page, 'staff1@shop.vn');
    await page.goto(`/admin/inventory/${product}`);
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '18');
    await id(page, 'inv-inventory-detail-adjust').click(); // để hộp thoại mở
    // phiên khác: người thứ hai điều chỉnh AT-001 thành 16 qua API thật (version thành 8)
    await withPage(env.browser, async (other) => {
      await loginUi(other, 'staff2@shop.vn');
      expect(await fromPage(other, `/admin/inventory/${product}/adjustments`, 1, { method: 'POST', body: { new_on_hand: 16, version: 7, note: 'Kiểm kê của người thứ hai' }, idem: 'e2e-other-session-0001' })).toEqual([200]);
    });
    await id(page, 'inv-inventory-detail-adjust-new-on-hand').fill('15');
    await id(page, 'inv-inventory-detail-adjust-note').fill('Kiểm kê 06/10');
    await id(page, 'inv-inventory-detail-adjust-submit').click();
    await hasText(id(page, 'inv-inventory-detail-adjust-error'), 'Số liệu đã thay đổi, tải lại để tiếp tục');
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '18'); // chưa đổi
    expect(await stockState(product)).toMatchObject({ on_hand: 16, version: 8 });
    await id(page, 'inv-inventory-detail-adjust-reload').click();
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '16');
    await id(page, 'inv-inventory-detail-adjust-new-on-hand').fill('15');
    await id(page, 'inv-inventory-detail-adjust-submit').click();
    await see(id(page, 'inv-inventory-detail-toast'));
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '15');
    expect(await stockState(product)).toMatchObject({ on_hand: 15, version: 9 });
  });

  e2e('INV-E2E-20261006-101122895: admin nâng ngưỡng thì sản phẩm vào tab Tồn thấp; ngưỡng -1 bị từ chối', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' });
    const product = await atShirt({ on_hand: 12, threshold: 5 });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/inventory');
    await see(id(page, 'inv-inventory-list-row'));
    await id(page, 'inv-inventory-list-tab-low-stock').click();
    await see(id(page, 'inv-inventory-list-empty-low-stock')); // chưa có AT-001 ở tab Tồn thấp
    await page.goto(`/admin/inventory/${product}`);
    await id(page, 'inv-inventory-detail-edit-threshold').click();
    await id(page, 'inv-inventory-detail-threshold-input').fill('20');
    await id(page, 'inv-inventory-detail-threshold-submit').click();
    await hasText(id(page, 'inv-inventory-detail-threshold'), '20');
    await see(id(page, 'inv-inventory-detail-low-badge'));
    expect(await stockState(product)).toMatchObject({ threshold: 20, version: 2 });
    await id(page, 'inv-inventory-detail-back').click();
    await id(page, 'inv-inventory-list-tab-low-stock').click();
    const row = id(page, 'inv-inventory-list-row');
    await see(row);
    await see(row.getByTestId('inv-inventory-list-low-badge'));
    await row.click();
    await id(page, 'inv-inventory-detail-edit-threshold').click();
    await id(page, 'inv-inventory-detail-threshold-input').fill('-1');
    await hasText(id(page, 'inv-inventory-detail-threshold-error'), 'Ngưỡng từ 0 đến 1.000.000');
    await id(page, 'inv-inventory-detail-threshold-submit').click(); // không gửi yêu cầu
    expect((await stockState(product))!.threshold).toBe(20);
  });

  e2e('INV-E2E-20261006-101122919: staff lọc lịch sử theo loại, xóa lọc, và khoảng ngày sai hiện lỗi', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    const product = await atShirt({ on_hand: 20 });
    for (const [type, quantity, after, ago, human] of [['in', 20, 20, 40, true], ['in', 10, 30, 30, true], ['out', -5, 25, 20, true], ['sale', -5, 20, 10, false]] as const) await seedMovement({ product_id: product, type, quantity, on_hand_after: after, minutes_ago: ago, human, reason: type === 'out' ? 'damaged' : type === 'in' ? 'purchase' : undefined });
    await loginUi(page, 'staff@shop.vn');
    await page.goto(`/admin/inventory/${product}`);
    await id(page, 'inv-inventory-detail-history-link').click();
    await count(id(page, 'inv-inventory-history-row'), 4);
    await id(page, 'inv-inventory-history-type-filter').selectOption({ label: 'Xuất kho' });
    await id(page, 'inv-inventory-history-apply').click();
    await count(id(page, 'inv-inventory-history-row'), 1);
    expect(await textOf(id(page, 'inv-inventory-history-quantity'))).toMatch(/^−/);
    await hasText(id(page, 'inv-inventory-history-summary'), '1 tới 1 trong 1 dòng');
    await id(page, 'inv-inventory-history-clear-filter').click();
    await count(id(page, 'inv-inventory-history-row'), 4);
    await id(page, 'inv-inventory-history-type-filter').selectOption({ label: 'Bán' });
    await id(page, 'inv-inventory-history-from').fill('2030-01-10');
    await id(page, 'inv-inventory-history-to').fill('2030-01-01');
    await id(page, 'inv-inventory-history-apply').click();
    expect(await textOf(id(page, 'inv-inventory-history-error'))).toContain('Khoảng thời gian không hợp lệ');
  });

  e2e('INV-TC-20261007-085337018: danh sách tồn kho bị giới hạn tần suất hiện banner kèm thử lại sau N giây, rồi tải lại được (nút Thử lại) khi hết giờ chờ', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    await atShirt({ on_hand: 5 });
    await loginUi(page, 'staff@shop.vn');
    await alignWindow();
    expect((await fromPage(page, '/admin/inventory?page=1&limit=1', 30)).every((s) => s === 200)).toBe(true); // 30 yêu cầu đầu nằm trong cùng một phút
    await page.goto('/admin/inventory'); // lần thứ 31
    await eventually(async () => expect(await textOf(id(page, 'inv-inventory-list-error'))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await count(id(page, 'inv-inventory-list-row'), 0);
    await advance(61_000); // sang phút kế tiếp (đồng hồ của API)
    await id(page, 'inv-inventory-list-retry').click();
    await count(id(page, 'inv-inventory-list-error'), 0);
    await see(id(page, 'inv-inventory-list-row'));
  });

  e2e('INV-TC-20261007-085337051: chi tiết tồn kho bị giới hạn tần suất hiện banner kèm thử lại sau N giây, rồi tải lại được khi hết giờ chờ', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    const product = await atShirt({ on_hand: 5, reserved: 1 });
    await loginUi(page, 'staff@shop.vn');
    await alignWindow();
    for (const p of ['/admin/inventory', '/admin/inventory/low-stock', `/admin/inventory/${product}/movements`]) await fromPage(page, p, 10); // 30 lần chung một bộ đếm bậc D
    await page.goto(`/admin/inventory/${product}`); // lần thứ 31
    await eventually(async () => expect(await textOf(id(page, 'inv-inventory-detail-error'))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await count(id(page, 'inv-inventory-detail-on-hand'), 0);
    await advance(61_000);
    await id(page, 'inv-inventory-detail-retry').click();
    await count(id(page, 'inv-inventory-detail-error'), 0);
    await hasText(id(page, 'inv-inventory-detail-on-hand'), '5');
    await hasText(id(page, 'inv-inventory-detail-available'), '4');
  });

  e2e('INV-TC-20261007-085337083: lịch sử kho với khoảng ngày sai hiện banner lỗi tham số rồi biến mất khi staff sửa khoảng ngày', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    const product = await atShirt({ on_hand: 5 });
    for (let i = 1; i <= 5; i++) await seedMovement({ product_id: product, type: 'in', quantity: 1, on_hand_after: i, minutes_ago: 50 - i, human: true, reason: 'purchase' });
    await loginUi(page, 'staff@shop.vn');
    await page.goto(`/admin/inventory/${product}/history`);
    await count(id(page, 'inv-inventory-history-row'), 5);
    await id(page, 'inv-inventory-history-from').fill('2030-01-10');
    await id(page, 'inv-inventory-history-to').fill('2030-01-01');
    await id(page, 'inv-inventory-history-apply').click();
    await eventually(async () => expect(await textOf(id(page, 'inv-inventory-history-error'))).toContain('Khoảng thời gian không hợp lệ'));
    await count(id(page, 'inv-inventory-history-row'), 0);
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    await id(page, 'inv-inventory-history-from').fill(day(-1));
    await id(page, 'inv-inventory-history-to').fill(day(1));
    await id(page, 'inv-inventory-history-apply').click();
    await count(id(page, 'inv-inventory-history-error'), 0);
    await count(id(page, 'inv-inventory-history-row'), 5);
  });
});
