import type { Page } from 'playwright-core';
import { advance, alignWindow, count, eventually, hasText, id, loginUi, orderState, reset, see, seedOrder, seedUser, sendEvent, setOrderSource, startE2e, textOf, withPage, type E2eEnv, API } from './support';

// E2E của ORD chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web.
// Đơn dựng thẳng qua cổng điều khiển (không qua CHK); event của PAY, INV, SHP do hạ tầng test giao cho ORD qua cùng đường consumer như relay. Giờ hiển thị là giờ Việt Nam (UTC+7).
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);

/** Giờ Việt Nam `2026-10-06 08:24` thành ISO UTC. */
const vn = (day: string, hhmm: string, plusMin = 0): string => new Date(Date.parse(`${day}T${hhmm}:00+07:00`) + plusMin * 60_000).toISOString();
const D = '2026-10-06'; // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
const ADDR_A = { receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' };
const ADDR_B = { receiver: 'Trần Thị B', phone: '0912345678', line1: '45 Nguyễn Huệ', ward: 'Bến Thành', city: 'TP.HCM' };
/** Chọn một giá trị ở bộ lọc theo nhãn: ô lọc nguồn, người tạo là select; hàng lọc trạng thái là nhóm nút (seg) theo giao diện hiện hành. */
const pick = async (page: Page, testid: string, label: string) => {
  const el = id(page, testid);
  if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption({ label });
  else await el.getByRole('button', { name: label, exact: true }).click();
};
const bodyText = (page: Page) => page.locator('body').innerText();
/** Gọi API trực tiếp từ trang đang đăng nhập (cookie phiên của trình duyệt); trả danh sách mã trạng thái. */
const fromPage = (page: Page, path: string, times = 1, init?: { method: string; body: unknown }): Promise<number[]> => page.evaluate(async ({ api, p, n, i }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}${p}`, { method: i?.method ?? 'GET', credentials: 'include', headers: i ? { 'Content-Type': 'application/json' } : undefined, body: i ? JSON.stringify(i.body) : undefined })).status);
  return out;
}, { api: API, p: path, n: times, i: init });

describe('E2E ORD (trình duyệt thật, API thật)', () => {
  e2e('ORD-E2E-20261006-111226528: khách lọc và phân trang danh sách đơn hàng của mình', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    for (let i = 0; i < 25; i++) await seedOrder({ email: 'a@x.vn', status: [2, 7, 12].includes(i) ? 'cancelled' : [1, 6, 11, 16, 21].includes(i) ? 'paid' : 'pending', created_at: vn(D, '08:00', i), items: [{ price: 100000, qty: 1 }], shipping: 30000 });
    await loginUi(page, 'a@x.vn');
    await page.goto('/orders');
    await count(id(page, 'ord-order-list-row'), 20);
    await hasText(id(page, 'ord-order-list-summary'), '1 tới 20 trong 25 đơn');
    expect(await textOf(id(page, 'ord-order-list-created-at'))).toContain('08:24');
    for (const b of await id(page, 'ord-order-list-status-badge').all()) expect((await b.innerText()).trim().length).toBeGreaterThan(2); // chữ đọc được, không chỉ màu
    await see(id(page, 'ord-order-list-pagination'));
    await id(page, 'ord-order-list-pagination').getByRole('button', { name: '2', exact: true }).click();
    await count(id(page, 'ord-order-list-row'), 5);
    await hasText(id(page, 'ord-order-list-summary'), '21 tới 25 trong 25 đơn');
    await pick(page, 'ord-order-list-status-filter', 'Đã hủy');
    await count(id(page, 'ord-order-list-row'), 3);
    for (const b of await id(page, 'ord-order-list-status-badge').all()) expect((await b.innerText()).trim()).toBe('Đã hủy');
    await count(id(page, 'ord-order-list-pagination'), 0);
    await see(id(page, 'ord-order-list-clear-filter'));
    await pick(page, 'ord-order-list-status-filter', 'Hết hạn');
    await see(id(page, 'ord-order-list-empty-filtered'));
    await count(id(page, 'ord-order-list-row'), 0);
    await id(page, 'ord-order-list-clear-filter').click();
    await count(id(page, 'ord-order-list-row'), 20);
    await count(id(page, 'ord-order-list-empty-filtered'), 0);
    for (const t of await id(page, 'ord-order-list-total').all()) expect((await t.innerText()).trim()).toMatch(/^\d{1,3}(\.\d{3})* đ$/);
    const text = await bodyText(page);
    expect(text).not.toMatch(/Lê Lợi|0901234567|@x\.vn|a@x/);
  });

  e2e('ORD-E2E-20261006-111226558: khách hủy đơn đã thanh toán và thấy lịch sử có lý do', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: vn(D, '09:00'), items: [{ name: 'Áo thun cổ tròn', price: 100000, qty: 2 }, { name: 'Quần jean', price: 150000, qty: 1 }], shipping: 30000 });
    await loginUi(page, 'a@x.vn');
    await page.goto('/orders');
    await id(page, 'ord-order-list-row').click();
    await hasText(id(page, 'ord-order-detail-code'), '7K3M9Q2XH4TB');
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã thanh toán');
    await count(id(page, 'ord-order-detail-history-item'), 2);
    expect(await id(page, 'ord-order-detail-history-item').nth(0).innerText()).toContain('Chờ xử lý');
    expect(await id(page, 'ord-order-detail-history-item').nth(1).innerText()).toContain('Đã thanh toán');
    await id(page, 'ord-order-detail-cancel-button').click();
    await see(id(page, 'ord-order-detail-cancel-dialog'));
    await see(id(page, 'ord-order-detail-cancel-refund-notice'));
    await id(page, 'ord-order-detail-cancel-reason').fill('đặt nhầm');
    await page.mouse.click(4, 4); // bấm ra ngoài (nền mờ): hộp thoại không đóng vì có ô nhập
    await see(id(page, 'ord-order-detail-cancel-dialog'));
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await see(id(page, 'ord-order-detail-cancel-success'));
    await hasText(id(page, 'ord-order-detail-cancel-success'), 'Đã hủy đơn');
    await count(id(page, 'ord-order-detail-cancel-dialog'), 0);
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã hủy');
    await count(id(page, 'ord-order-detail-history-item'), 3);
    expect(await id(page, 'ord-order-detail-history-item').nth(2).innerText()).toContain('Đã hủy');
    await hasText(id(page, 'ord-order-detail-history-reason'), 'đặt nhầm');
    await count(id(page, 'ord-order-detail-cancel-button'), 0);
    await see(id(page, 'ord-order-detail-payment-link'));
    await id(page, 'ord-order-detail-payment-link').click(); // màn thanh toán là của PAY (chưa có code): chỉ kiểm liên kết dẫn tới đường dẫn của PAY rồi quay lại
    await eventually(() => { expect(page.url()).toMatch(/\/orders\/7K3M9Q2XH4TB\/payment$/); });
    await page.goBack();
    await hasText(id(page, 'ord-order-detail-code'), '7K3M9Q2XH4TB');
    await id(page, 'ord-order-detail-back-link').click();
    await hasText(id(page, 'ord-order-list-status-badge'), 'Đã hủy');
    expect((await orderState('7K3M9Q2XH4TB'))?.status).toBe('cancelled');
  });

  e2e('ORD-E2E-20261006-111226588: khách hủy đơn vừa chuyển sang đang giao thì gặp lỗi và tải lại thấy trạng thái mới', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod', created_at: vn(D, '09:00') });
    await loginUi(page, 'a@x.vn');
    await page.goto('/orders/4G6H8J2K4M6N');
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã xác nhận');
    await id(page, 'ord-order-detail-cancel-button').click();
    await see(id(page, 'ord-order-detail-cancel-dialog'));
    await count(id(page, 'ord-order-detail-cancel-refund-notice'), 0); // COD chưa thu tiền
    await sendEvent('ShipmentShipped', '4G6H8J2K4M6N', { shipment_id: crypto.randomUUID(), tracking_number: 'VN123456' });
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await hasText(id(page, 'ord-order-detail-cancel-error'), /Đơn không thể hủy ở trạng thái hiện tại/);
    await see(id(page, 'ord-order-detail-cancel-reload'));
    await count(id(page, 'ord-order-detail-cancel-success'), 0);
    await id(page, 'ord-order-detail-cancel-reload').click();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đang giao');
    await hasText(id(page, 'ord-order-detail-tracking'), 'VN123456');
    await see(id(page, 'ord-order-detail-tracking-link'));
    await count(id(page, 'ord-order-detail-cancel-button'), 0);
    await count(id(page, 'ord-order-detail-history-item'), 3);
    expect(await id(page, 'ord-order-detail-history-item').nth(2).innerText()).toContain('Đang giao');
  });

  e2e('ORD-E2E-20261006-111226617: khách mở đơn của người khác thấy cùng trang không tìm thấy như đơn không tồn tại', async (page) => {
    await seedUser({ email: 'a@x.vn' }); await seedUser({ email: 'b@x.vn' });
    await seedOrder({ email: 'a@x.vn', created_at: vn(D, '09:00') });
    await seedOrder({ email: 'b@x.vn', code: '8M2N4P6R8S0T', created_at: vn(D, '09:00') });
    await loginUi(page, 'a@x.vn');
    const seen: string[] = [];
    for (const code of ['8M2N4P6R8S0T', '9X9X9X9X9X9X', 'abc']) {
      await page.goto(`/orders/${code}`);
      await see(id(page, 'ord-order-detail-notfound'));
      seen.push(await textOf(id(page, 'ord-order-detail-notfound')));
      for (const t of ['ord-order-detail-code', 'ord-order-detail-items', 'ord-order-detail-address', 'ord-order-detail-history']) await count(id(page, t), 0);
    }
    expect(seen[0]).toContain('Không thấy đơn');
    expect(new Set(seen).size).toBe(1); // giống hệt nhau, không lộ khác biệt
    await id(page, 'ord-order-detail-notfound-back').click();
    await count(id(page, 'ord-order-list-row'), 1);
    expect(await bodyText(page)).not.toContain('8M2N4P6R8S0T');
  });

  e2e('ORD-E2E-20261006-111226646: khách xem đơn COD đã giao với lịch sử đủ bốn bước, tiền COD được thu tự động sau khi giao', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '4G6H8J2K4M6N', status: 'delivered', method: 'cod', payment: 'pending', tracking: 'VN123456', created_at: vn(D, '09:00'), address: ADDR_A, items: [{ name: 'Áo thun cổ tròn', price: 100000, qty: 2 }, { name: 'Quần jean', price: 150000, qty: 1 }], shipping: 30000 });
    await loginUi(page, 'a@x.vn');
    await page.goto('/orders');
    await id(page, 'ord-order-list-row').click();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã giao');
    const items = await textOf(id(page, 'ord-order-detail-items'));
    expect(items).toContain('Áo thun cổ tròn'); expect(items).toContain('100.000 đ'); expect(items).toContain('Quần jean'); expect(items).toContain('150.000 đ');
    const totals = await textOf(id(page, 'ord-order-detail-totals'));
    for (const w of ['Tạm tính 350.000 đ', 'Giảm giá 0 đ', 'Giao hàng 30.000 đ', 'Tổng 380.000 đ']) expect(totals.replace(/\s+/g, ' ')).toContain(w);
    const pay = await textOf(id(page, 'ord-order-detail-payment'));
    expect(pay).toContain('COD · Chưa thu tiền');
    expect(pay.toLowerCase()).not.toContain('đã thanh toán');
    await count(id(page, 'ord-order-detail-payment-expires'), 0);
    await hasText(id(page, 'ord-order-detail-tracking'), 'VN123456');
    const addr = await textOf(id(page, 'ord-order-detail-address'));
    for (const w of ['Nguyễn Văn A', '0901234567', '12 Lê Lợi']) expect(addr).toContain(w);
    await count(id(page, 'ord-order-detail-history-item'), 4);
    const hist = await id(page, 'ord-order-detail-history-item').allInnerTexts();
    expect(['Chờ xử lý', 'Đã xác nhận', 'Đang giao', 'Đã giao'].map((s, i) => hist[i].includes(s))).toEqual([true, true, true, true]);
    expect(hist.join('\n')).not.toContain('Đã thanh toán');
    await count(id(page, 'ord-order-detail-history-reason'), 0);
    await count(id(page, 'ord-order-detail-cancel-button'), 0);
    await see(id(page, 'ord-order-detail-payment-link')); await see(id(page, 'ord-order-detail-tracking-link'));
    await sendEvent('PaymentSucceeded', '4G6H8J2K4M6N', { payment_id: crypto.randomUUID(), method: 'cod', amount: 380000, paid_at: new Date().toISOString() });
    await page.reload();
    await eventually(async () => expect(await textOf(id(page, 'ord-order-detail-payment'))).toContain('COD · Đã thu tiền'));
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã giao');
    await count(id(page, 'ord-order-detail-history-item'), 4);
    expect((await id(page, 'ord-order-detail-history-item').allInnerTexts()).join('\n')).not.toContain('Đã thanh toán');
  });

  e2e('ORD-E2E-20261006-111226677: staff tìm đơn theo mã, không tìm được theo email, xem chi tiết không có địa chỉ', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    const owners = ['a@x.vn', 'c1@x.vn', 'c2@x.vn'];
    for (const e of owners) await seedUser({ email: e });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: vn(D, '07:00'), address: ADDR_A });
    for (let i = 0; i < 44; i++) await seedOrder({ email: owners[i % 3], status: i % 5 === 0 ? 'pending' : 'confirmed', method: i % 5 === 0 ? 'vnpay' : 'cod', created_at: vn(D, '08:00', i) });
    await loginUi(page, 'staff@shop.vn');
    await page.goto('/admin/orders');
    await hasText(id(page, 'ord-order-list-source-summary'), '1 tới 20 trong 45 đơn');
    await count(id(page, 'ord-order-list-source-row'), 20);
    expect(await bodyText(page)).not.toMatch(/@x\.vn|0901234567|Nguyễn Văn A/);
    expect(await id(page, 'ord-order-list-source-row').first().getByRole('button').count()).toBe(0); // không nút Hủy hay Đã giao trên hàng
    await id(page, 'ord-order-list-source-search').fill('7K3M9Q2XH4TB');
    await count(id(page, 'ord-order-list-source-row'), 1);
    await hasText(id(page, 'ord-order-list-source-code'), '7K3M9Q2XH4TB');
    await see(id(page, 'ord-order-list-source-clear'));
    await id(page, 'ord-order-list-source-clear').click();
    await count(id(page, 'ord-order-list-source-row'), 20);
    await id(page, 'ord-order-list-source-search').fill('a@x.vn');
    await see(id(page, 'ord-order-list-source-empty'));
    await count(id(page, 'ord-order-list-source-row'), 0);
    await id(page, 'ord-order-list-source-clear').click();
    await count(id(page, 'ord-order-list-source-row'), 20);
    await pick(page, 'ord-order-admin-list-status-filter', 'Đã thanh toán');
    await id(page, 'ord-order-list-source-search').fill('7K3M9Q2XH4TB');
    await count(id(page, 'ord-order-list-source-row'), 1);
    await id(page, 'ord-order-list-source-row').click();
    await hasText(id(page, 'ord-order-detail-code'), '7K3M9Q2XH4TB');
    await see(id(page, 'ord-order-detail-items')); await see(id(page, 'ord-order-detail-totals'));
    await hasText(id(page, 'ord-order-detail-address-hidden'), 'Thông tin người nhận được ẩn theo chính sách dữ liệu');
    expect(await bodyText(page)).not.toMatch(/Nguyễn Văn A|0901234567/);
    await count(id(page, 'ord-order-detail-history-item'), 2);
    await count(id(page, 'ord-order-detail-cancel-button'), 0);
  });

  e2e('ORD-E2E-20261006-111226706: admin lọc đơn đã thanh toán, xem địa chỉ giao và hủy đơn của khách', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' }); await seedUser({ email: 'b@x.vn' });
    await seedOrder({ email: 'b@x.vn', code: '6V8W0X2Y4Z6A', status: 'paid', created_at: vn(D, '09:00'), address: ADDR_B });
    await seedOrder({ email: 'b@x.vn', status: 'pending', created_at: vn(D, '09:10') });
    await seedOrder({ email: 'b@x.vn', status: 'cancelled', created_at: vn(D, '09:20') });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/orders');
    await pick(page, 'ord-order-admin-list-status-filter', 'Đã thanh toán');
    await count(id(page, 'ord-order-list-source-row'), 1);
    for (const b of await id(page, 'ord-order-admin-list-status-badge').all()) expect((await b.innerText()).trim()).toBe('Đã thanh toán');
    await id(page, 'ord-order-list-source-search').fill('6V8W0X2Y4Z6A');
    await count(id(page, 'ord-order-list-source-row'), 1);
    await id(page, 'ord-order-list-source-row').click();
    const addr = await textOf(id(page, 'ord-order-detail-address'));
    for (const w of ['Trần Thị B', '0912345678', '45 Nguyễn Huệ', 'Bến Thành', 'TP.HCM']) expect(addr).toContain(w);
    await id(page, 'ord-order-detail-cancel-button').click();
    await see(id(page, 'ord-order-detail-cancel-refund-notice'));
    await id(page, 'ord-order-detail-cancel-reason').fill('hết hàng thực tế');
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await see(id(page, 'ord-order-detail-cancel-success'));
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã hủy');
    await eventually(async () => { const h = await id(page, 'ord-order-detail-history-item').allInnerTexts(); expect(h.at(-1)).toContain('Đã hủy'); });
    await hasText(id(page, 'ord-order-detail-history-reason'), 'hết hàng thực tế');
    await id(page, 'ord-order-detail-back-link').click();
    await see(id(page, 'ord-order-list-source-row'));
    await pick(page, 'ord-order-admin-list-status-filter', 'Đã thanh toán');
    await see(id(page, 'ord-order-list-source-empty')); // đơn đã hủy không còn trong bộ lọc Đã thanh toán
    await count(id(page, 'ord-order-list-source-row'), 0);
  });

  e2e('ORD-E2E-20261006-111226737: khách chưa có đơn thấy trạng thái rỗng, lỗi tải danh sách có nút thử lại', async (page) => {
    await seedUser({ email: 'n@x.vn' }); await seedUser({ email: 'a@x.vn' }); await seedUser({ email: 'other@x.vn' });
    await seedOrder({ email: 'other@x.vn', created_at: vn(D, '09:00') });
    for (let i = 0; i < 25; i++) await seedOrder({ email: 'a@x.vn', created_at: vn(D, '08:00', i) });
    await loginUi(page, 'n@x.vn');
    await page.goto('/orders');
    await hasText(id(page, 'ord-order-list-empty'), /Chưa có đơn/);
    await count(id(page, 'ord-order-list-row'), 0);
    await count(id(page, 'ord-order-list-pagination'), 0);
    await count(id(page, 'ord-order-list-summary'), 0); // không báo số đơn khác 0
    await withPage(env.browser, async (p2) => {
      await loginUi(p2, 'a@x.vn');
      let fail = true;
      await p2.route('**/api/v1/orders?*', async (route) => { if (fail) { await new Promise((r) => setTimeout(r, 600)); await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); } else await route.continue(); });
      await p2.goto('/orders');
      await see(id(p2, 'ord-order-list-loading'));
      await hasText(id(p2, 'ord-order-list-error'), /Không tải được đơn\./);
      await count(id(p2, 'ord-order-list-row'), 0);
      fail = false;
      await id(p2, 'ord-order-list-retry').click();
      await count(id(p2, 'ord-order-list-error'), 0);
      await count(id(p2, 'ord-order-list-row'), 20);
    });
  });

  e2e('ORD-E2E-20261006-111226766: lịch sử trạng thái lỗi riêng, các khối khác của đơn vẫn hiện, thử lại thành công', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: vn(D, '09:00') });
    await loginUi(page, 'a@x.vn');
    let historyFails = true, detailFails = false;
    await page.route('**/api/v1/orders/7K3M9Q2XH4TB/status-history', async (route) => { if (historyFails) await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); else await route.continue(); });
    await page.route('**/api/v1/orders/7K3M9Q2XH4TB', async (route) => { if (detailFails) await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); else await route.continue(); });
    await page.goto('/orders/7K3M9Q2XH4TB');
    for (const t of ['ord-order-detail-code', 'ord-order-detail-items', 'ord-order-detail-totals', 'ord-order-detail-payment']) await see(id(page, t));
    await hasText(id(page, 'ord-order-detail-history-error'), /Không tải được lịch sử\./);
    await count(id(page, 'ord-order-detail-error'), 0); // không có banner toàn trang
    historyFails = false;
    await id(page, 'ord-order-detail-history-retry').click();
    await count(id(page, 'ord-order-detail-history-error'), 0);
    await count(id(page, 'ord-order-detail-history-item'), 2);
    const h = await id(page, 'ord-order-detail-history-item').allInnerTexts();
    expect([h[0].includes('Chờ xử lý'), h[1].includes('Đã thanh toán')]).toEqual([true, true]);
    detailFails = true;
    await page.reload();
    await see(id(page, 'ord-order-detail-error'));
    await see(id(page, 'ord-order-detail-retry'));
    detailFails = false;
    await id(page, 'ord-order-detail-retry').click();
    await see(id(page, 'ord-order-detail-code'));
  });

  e2e('ORD-E2E-20261006-121317047: khách thấy hạn thanh toán của đơn chờ, rồi đơn giao thất bại và hoàn về với lịch sử đủ mốc', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'pending', created_at: vn(D, '09:00'), expires_at: vn(D, '09:15') });
    await seedOrder({ email: 'a@x.vn', code: '4G6H8J2K4M6N', status: 'shipped', method: 'cod', tracking: 'VN123456', created_at: vn(D, '09:30') });
    await loginUi(page, 'a@x.vn');
    await page.goto('/orders/7K3M9Q2XH4TB');
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Chờ xử lý');
    expect(await textOf(id(page, 'ord-order-detail-payment-expires'))).toContain('09:15');
    await see(id(page, 'ord-order-detail-payment-link'));
    await count(id(page, 'ord-order-detail-history-item'), 1);
    await see(id(page, 'ord-order-detail-cancel-button'));
    await sendEvent('StockReservationExpired', '7K3M9Q2XH4TB');
    await page.reload();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Hết hạn');
    await count(id(page, 'ord-order-detail-payment-expires'), 0);
    await count(id(page, 'ord-order-detail-cancel-button'), 0);
    await count(id(page, 'ord-order-detail-history-item'), 2);
    expect((await id(page, 'ord-order-detail-history-item').allInnerTexts()).map((s) => ['Chờ xử lý', 'Hết hạn'].find((w) => s.includes(w)))).toEqual(['Chờ xử lý', 'Hết hạn']);
    await page.goto('/orders/4G6H8J2K4M6N');
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đang giao');
    await hasText(id(page, 'ord-order-detail-tracking'), 'VN123456');
    await see(id(page, 'ord-order-detail-tracking-link'));
    await count(id(page, 'ord-order-detail-payment-expires'), 0);
    await sendEvent('ShipmentFailed', '4G6H8J2K4M6N', { shipment_id: crypto.randomUUID(), reason: 'customer_unreachable' });
    await page.reload();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đang giao');
    await count(id(page, 'ord-order-detail-history-item'), 4);
    expect((await id(page, 'ord-order-detail-history-item').last().innerText())).toContain('Giao thất bại');
    expect(await textOf(id(page, 'ord-order-detail-history-reason'))).toContain('khách vắng nhà');
    await sendEvent('ShipmentReturned', '4G6H8J2K4M6N', { shipment_id: crypto.randomUUID(), restockable: true });
    await page.reload();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã hoàn');
    expect(await id(page, 'ord-order-detail-history-item').last().innerText()).toContain('Đã hoàn');
    await count(id(page, 'ord-order-detail-cancel-button'), 0);
    await id(page, 'ord-order-detail-back-link').click();
    await pick(page, 'ord-order-list-status-filter', 'Đã hoàn');
    await count(id(page, 'ord-order-list-row'), 1);
    await hasText(id(page, 'ord-order-list-status-badge'), 'Đã hoàn');
  });

  e2e('ORD-TC-20261006-111720161: lý do hủy chứa mã HTML hiển thị như văn bản thường ở lịch sử (escape, không thực thi, không thành phần tử)', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' }); await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: vn(D, '09:00') });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/orders/7K3M9Q2XH4TB');
    await id(page, 'ord-order-detail-cancel-button').click();
    const html = '<b>đậm</b><img src=x onerror="document.title=\'xss\'">';
    await id(page, 'ord-order-detail-cancel-reason').fill(html);
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await see(id(page, 'ord-order-detail-cancel-success'));
    await eventually(async () => expect(await textOf(id(page, 'ord-order-detail-history-reason'))).toBe(html));
    expect(await id(page, 'ord-order-detail-history-reason').locator('b, img').count()).toBe(0); // `<b>` ở dòng lịch sử là nhãn trạng thái, nên chỉ kiểm bên trong phần lý do
    expect(await page.title()).not.toBe('xss');
  });

  e2e('REV-ORD-14 (hồi quy của reviewer): lý do hủy là tên thuộc tính của Object.prototype (__proto__) và lý do nhiều dòng hiện nguyên văn ở lịch sử, trang chi tiết không vỡ', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' }); await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: vn(D, '09:00') });
    await seedOrder({ email: 'a@x.vn', code: '8M2N4P6R8S0T', status: 'paid', created_at: vn(D, '09:05') });
    await loginUi(page, 'admin@shop.vn');
    for (const [code, reason] of [['7K3M9Q2XH4TB', '__proto__'], ['8M2N4P6R8S0T', 'dòng một\ndòng hai']] as const) {
      await page.goto(`/orders/${code}`);
      await id(page, 'ord-order-detail-cancel-button').click();
      await id(page, 'ord-order-detail-cancel-reason').fill(reason);
      await id(page, 'ord-order-detail-cancel-confirm').click();
      await see(id(page, 'ord-order-detail-cancel-success'));
      await eventually(async () => expect(await textOf(id(page, 'ord-order-detail-history-reason'))).toBe(reason.replace('\n', ' ')));
      await page.reload();
      await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã hủy');
      await see(id(page, 'ord-order-detail-history-reason'));
    }
  });

  // Trạng thái UI có thời hạn (429, bậc D và bậc B) phải có đường thoát: banner kèm thử lại sau N giây rồi tải lại được khi hết giờ chờ (đồng hồ API do cổng điều khiển tua).
  e2e('ORD-TC-20261006-111225088: danh sách quản trị bị giới hạn tần suất (bậc D) hiện banner kèm thử lại sau N giây, rồi tải lại được khi hết giờ chờ', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' }); await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', created_at: vn(D, '09:00') });
    await loginUi(page, 'staff@shop.vn');
    await alignWindow();
    expect((await fromPage(page, '/admin/orders?page=1&limit=1', 30)).every((s) => s === 200)).toBe(true);
    await page.goto('/admin/orders'); // lần thứ 31
    await eventually(async () => expect(await textOf(id(page, 'ord-order-list-source-error'))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await count(id(page, 'ord-order-list-source-row'), 0);
    await advance(61_000);
    await id(page, 'ord-order-list-source-retry').click();
    await count(id(page, 'ord-order-list-source-error'), 0);
    await see(id(page, 'ord-order-list-source-row'));
  });

  e2e('ORD-TC-20261006-111225088: hủy đơn bị giới hạn tần suất (bậc B) hiện lỗi kèm thử lại sau N giây trong hộp thoại, rồi hủy được khi hết giờ chờ', async (page) => {
    await seedUser({ email: 'a@x.vn' });
    await seedOrder({ email: 'a@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: vn(D, '09:00') });
    await loginUi(page, 'a@x.vn');
    await page.goto('/orders/7K3M9Q2XH4TB');
    await see(id(page, 'ord-order-detail-cancel-button'));
    await alignWindow();
    expect((await fromPage(page, '/orders/9X9X9X9X9X9X/cancel', 10, { method: 'POST', body: {} })).every((s) => s === 404)).toBe(true); // 10 lần của bậc B
    await id(page, 'ord-order-detail-cancel-button').click();
    await id(page, 'ord-order-detail-cancel-confirm').click(); // lần thứ 11
    await eventually(async () => expect(await textOf(id(page, 'ord-order-detail-cancel-error'))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await see(id(page, 'ord-order-detail-cancel-dialog'));
    expect((await orderState('7K3M9Q2XH4TB'))?.status).toBe('paid');
    await advance(61_000);
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await see(id(page, 'ord-order-detail-cancel-success'));
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã hủy');
  });

  // ----- Đợt bán hộ 2026-10-15: nguồn đơn, danh sách và chi tiết đơn hộ theo role (ORD-REQ-20261015-092748678, ORD-REQ-20261006-092320743, ORD-REQ-20261006-092320768).
  // fixed-clock: mốc 2026-10-15 giờ Việt Nam; đơn dựng thẳng qua cổng điều khiển. Chưa chạy được trong môi trường chia sẻ nhiều agent (xem report): kiểm bằng typecheck và build của web.
  const D15 = '2026-10-15';
  const srcRow = (page: Page, code: string) => page.locator(`[data-testid="ord-order-source-admin-row"][data-code="${code}"]`);
  const orderRow = (page: Page, code: string) => page.locator(`[data-testid="ord-order-list-source-row"][data-code="${code}"]`);
  const hoOrder = (by: string, source: string, o: { code?: string; at?: number; note?: string; itemNotes?: (string | null)[]; costs?: (number | null)[] } = {}) => seedOrder({
    code: o.code, status: 'confirmed', method: 'cod', created_at: vn(D15, '08:00', o.at ?? 0), items: [{ name: 'Áo thun cổ tròn', price: 100000, qty: 2 }, { name: 'Quần jean', price: 250000, qty: 1 }],
    ho: { created_by_email: by, source, customer: { full_name: 'Trần Thị Mai', phone: '0912345678' }, note: o.note ?? null, item_notes: o.itemNotes, costs: o.costs },
  });

  e2e('ORD-E2E-20261015-092749937: admin thêm nguồn đơn, bị chặn trùng mã, tắt một nguồn và thấy nguồn hệ thống không tắt được', async (page) => {
    await seedUser({ email: 'admin@shop.vn', role: 'admin' }); await seedUser({ email: 'sale@shop.vn', role: 'sale', name: 'Trần Thu' });
    for (let i = 0; i < 12; i++) await hoOrder('sale@shop.vn', 'tiktok', { at: i });
    await loginUi(page, 'admin@shop.vn');
    await page.goto('/admin/order-sources');
    await see(id(page, 'ord-order-source-admin-table'));
    await count(id(page, 'ord-order-source-admin-row'), 4);
    for (const b of await id(page, 'ord-order-source-admin-status-badge').all()) expect((await b.innerText()).trim()).toBe('Đang bật');
    await count(id(page, 'ord-order-source-admin-system-badge'), 1);
    await count(srcRow(page, 'website').getByTestId('ord-order-source-admin-toggle'), 0);
    await id(page, 'ord-order-source-admin-add').click();
    await see(id(page, 'ord-order-source-admin-dialog'));
    expect(await id(page, 'ord-order-source-admin-save').isDisabled()).toBe(true);
    await id(page, 'ord-order-source-admin-field-code').fill('facebook'); await id(page, 'ord-order-source-admin-field-name').fill('FB khác');
    await id(page, 'ord-order-source-admin-save').click();
    await hasText(id(page, 'ord-order-source-admin-field-error'), 'Mã này đã có');
    await see(id(page, 'ord-order-source-admin-dialog'));
    await count(id(page, 'ord-order-source-admin-row'), 4);
    await id(page, 'ord-order-source-admin-field-code').fill('zalo'); await id(page, 'ord-order-source-admin-field-name').fill('Zalo OA'); await id(page, 'ord-order-source-admin-field-position').fill('4');
    await id(page, 'ord-order-source-admin-save').click();
    await see(id(page, 'ord-order-source-admin-saved'));
    await count(id(page, 'ord-order-source-admin-dialog'), 0);
    await count(id(page, 'ord-order-source-admin-row'), 5);
    await hasText(id(page, 'ord-order-source-admin-code').last(), 'zalo');
    await hasText(id(page, 'ord-order-source-admin-status-badge').last(), 'Đang bật');
    await id(page, 'ord-order-source-admin-add').click();
    await id(page, 'ord-order-source-admin-field-name').fill('x'.repeat(61));
    await see(id(page, 'ord-order-source-admin-field-error'));
    expect(await id(page, 'ord-order-source-admin-save').isDisabled()).toBe(true);
    await id(page, 'ord-order-source-admin-cancel').click();
    await count(id(page, 'ord-order-source-admin-dialog'), 0);
    await count(id(page, 'ord-order-source-admin-row'), 5);
    await srcRow(page, 'tiktok').getByTestId('ord-order-source-admin-toggle').click();
    await hasText(id(page, 'ord-order-source-admin-toggle-confirm').locator('p'), 'Đơn mới không chọn được nguồn này nữa; đơn cũ giữ nguyên.');
    await id(page, 'ord-order-source-admin-toggle-confirm').getByRole('button', { name: 'Tắt nguồn' }).click();
    await hasText(srcRow(page, 'tiktok').getByTestId('ord-order-source-admin-status-badge'), 'Đã tắt');
    await see(id(page, 'ord-order-source-admin-saved'));
    await hasText(srcRow(page, 'tiktok').getByTestId('ord-order-source-admin-toggle'), 'Bật');
    await count(srcRow(page, 'website').getByTestId('ord-order-source-admin-toggle'), 0);
    await srcRow(page, 'website').getByTestId('ord-order-source-admin-edit').click();
    expect(await id(page, 'ord-order-source-admin-field-code').isDisabled()).toBe(true);
    await id(page, 'ord-order-source-admin-field-name').fill('Cửa hàng trực tuyến');
    await id(page, 'ord-order-source-admin-save').click();
    await hasText(srcRow(page, 'website').getByTestId('ord-order-source-admin-name'), 'Cửa hàng trực tuyến');
    await hasText(srcRow(page, 'website').getByTestId('ord-order-source-admin-code'), 'website');
  });

  e2e('ORD-E2E-20261015-092749975: staff lọc danh sách đơn theo nguồn và người tạo rồi mở đơn hộ thấy nguồn, ghi chú nhưng không thấy khách', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' }); await seedUser({ email: 'thu@shop.vn', role: 'sale', name: 'Trần Thu' }); await seedUser({ email: 'minh@shop.vn', role: 'sale', name: 'Lê Minh' }); await seedUser({ email: 'c@x.vn' });
    await hoOrder('thu@shop.vn', 'facebook', { code: 'HD261015-00003', at: 3, note: 'Giao sau 18h', itemNotes: ['size M', null], costs: [60000, 150000] });
    for (const i of [0, 1, 2]) await hoOrder('thu@shop.vn', 'facebook', { at: 10 + i });
    for (const i of [0, 1]) await hoOrder('minh@shop.vn', 'facebook', { at: 20 + i });
    await hoOrder('thu@shop.vn', 'hotline', { at: 30 });
    for (let i = 0; i < 10; i++) await seedOrder({ email: 'c@x.vn', status: 'confirmed', method: 'cod', created_at: vn(D15, '07:00', i) });
    await setOrderSource('tiktok', false);
    await loginUi(page, 'staff@shop.vn');
    await page.goto('/admin/orders');
    await count(id(page, 'ord-order-list-source-row'), 17);
    await hasText(id(page, 'ord-order-list-source-summary'), '1 tới 17 trong 17 đơn');
    await count(id(page, 'ord-order-list-source-cell'), 17); await count(id(page, 'ord-order-list-source-creator-cell'), 17);
    expect(await id(page, 'ord-order-list-source-creator-cell').allInnerTexts()).toContain('—'); // đơn khách tự đặt
    await count(id(page, 'ord-order-list-source-scope-note'), 0);
    await pick(page, 'ord-order-list-source-filter-source', 'Facebook');
    await count(id(page, 'ord-order-list-source-row'), 6);
    for (const c of await id(page, 'ord-order-list-source-cell').all()) expect((await c.innerText()).trim()).toBe('Facebook');
    await see(id(page, 'ord-order-list-source-clear'));
    await pick(page, 'ord-order-list-source-filter-creator', 'Trần Thu');
    await count(id(page, 'ord-order-list-source-row'), 4);
    for (const c of await id(page, 'ord-order-list-source-creator-cell').all()) expect((await c.innerText()).trim()).toBe('Trần Thu');
    await hasText(id(page, 'ord-order-list-source-summary'), '1 tới 4 trong 4 đơn');
    await id(page, 'ord-order-list-source-clear').click();
    await count(id(page, 'ord-order-list-source-row'), 17);
    await pick(page, 'ord-order-list-source-filter-source', 'TikTok (đã tắt)');
    await see(id(page, 'ord-order-list-source-empty'));
    await count(id(page, 'ord-order-list-source-row'), 0);
    await id(page, 'ord-order-list-source-clear').first().click();
    await orderRow(page, 'HD261015-00003').click();
    await see(id(page, 'ord-order-detail-source-block'));
    await hasText(id(page, 'ord-order-detail-source-name'), 'Facebook');
    await hasText(id(page, 'ord-order-detail-source-creator'), 'Trần Thu');
    await hasText(id(page, 'ord-order-detail-source-note'), 'Giao sau 18h');
    await hasText(id(page, 'ord-order-detail-source-item-note').first(), 'Ghi chú: size M');
    await see(id(page, 'ord-order-detail-source-customer-hidden'));
    expect(await bodyText(page)).not.toMatch(/Trần Thị Mai|0912345678/);
    await count(id(page, 'ord-order-detail-source-customer'), 0);
    await count(id(page, 'ord-order-detail-source-cost'), 0); // giá vốn chỉ admin
  });

  e2e('ORD-E2E-20261015-092750011: sale chỉ thấy đơn do mình tạo, lọc theo nguồn và xem chi tiết đơn của mình có khách, không có giá vốn', async (page) => {
    await seedUser({ email: 'thu@shop.vn', role: 'sale', name: 'Trần Thu' }); await seedUser({ email: 'minh@shop.vn', role: 'sale', name: 'Lê Minh' }); await seedUser({ email: 'c@x.vn' });
    await hoOrder('thu@shop.vn', 'facebook', { code: 'HD261015-00003', at: 3, note: 'Giao sau 18h', itemNotes: ['size M', null], costs: [60000, 150000] });
    for (const i of [0, 1, 2]) await hoOrder('thu@shop.vn', 'facebook', { at: 10 + i });
    await hoOrder('thu@shop.vn', 'hotline', { at: 30 });
    await hoOrder('minh@shop.vn', 'facebook', { code: 'HD261015-00007', at: 40 });
    for (const i of [0, 1]) await hoOrder('minh@shop.vn', 'hotline', { at: 50 + i });
    for (let i = 0; i < 20; i++) await seedOrder({ email: 'c@x.vn', status: 'confirmed', method: 'cod', created_at: vn(D15, '07:00', i) });
    await loginUi(page, 'thu@shop.vn');
    await page.goto('/admin/orders');
    await hasText(id(page, 'ord-order-list-source-scope-note'), 'Đang xem: đơn do bạn tạo');
    await count(id(page, 'ord-order-list-source-row'), 5);
    await hasText(id(page, 'ord-order-list-source-summary'), '1 tới 5 trong 5 đơn');
    await count(id(page, 'ord-order-list-source-filter-creator'), 0); // sale không lọc theo người tạo
    for (const c of await id(page, 'ord-order-list-source-creator-cell').all()) expect((await c.innerText()).trim()).toBe('Trần Thu');
    await pick(page, 'ord-order-list-source-filter-source-sale', 'Hotline');
    await count(id(page, 'ord-order-list-source-row'), 1);
    await see(id(page, 'ord-order-list-source-clear'));
    await id(page, 'ord-order-list-source-clear').click();
    await count(id(page, 'ord-order-list-source-row'), 5);
    await orderRow(page, 'HD261015-00003').click();
    await see(id(page, 'ord-order-detail-source-block'));
    await hasText(id(page, 'ord-order-detail-source-name'), 'Facebook');
    await hasText(id(page, 'ord-order-detail-source-creator'), 'Trần Thu');
    expect(await textOf(id(page, 'ord-order-detail-source-customer'))).toMatch(/Trần Thị Mai.*0912345678/);
    await hasText(id(page, 'ord-order-detail-source-note'), 'Giao sau 18h');
    await count(id(page, 'ord-order-detail-source-cost'), 0); // sale không thấy giá vốn
    await count(id(page, 'ord-order-detail-source-customer-hidden'), 0);
    await count(id(page, 'ord-order-detail-cancel-button'), 0); // sale không hủy đơn
    await id(page, 'ord-order-detail-back-link').click();
    await id(page, 'ord-order-list-source-search').fill('HD261015-00007');
    await see(id(page, 'ord-order-list-source-empty'));
    await count(id(page, 'ord-order-list-source-row'), 0); // đơn của sale khác: giống hệt mã không tồn tại
  });
});
