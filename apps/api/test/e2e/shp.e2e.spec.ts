import type { Page } from 'playwright-core';
import { advance, alignWindow, count, eventually, hasText, id, loginUi, reset, see, seedOrder, seedShipment, seedShippingMethod, seedUser, shipmentState, startE2e, textOf, urlIs, withPage, WEB, type E2eEnv } from './support';

// E2E của SHP chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web.
// Đơn, phương thức và vận đơn dựng thẳng qua cổng điều khiển (SHP không có endpoint tạo vận đơn: vận đơn do event của ORD, test dựng sẵn ở trạng thái cần). Giờ hiển thị là giờ Việt Nam (UTC+7).
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);
const API = 'http://localhost:3101/api/v1';

/** Giờ Việt Nam `2026-10-06 09:59` thành ISO UTC. */
const vn = (day: string, hhmm: string, plusMin = 0): string => new Date(Date.parse(`${day}T${hhmm}:00+07:00`) + plusMin * 60_000).toISOString();
const D = '2026-10-06'; // fixed-clock: mốc của spec (bàn giao 06/10/2026 10:00), dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
const ADDR = { receiver: 'Nguyễn Văn An', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' };
// Mã đơn "2N6R4T8W0KL" + "A" trong spec E2E có chữ L (ngoài bảng Crockford của mã đơn, API coi là sai định dạng và trả 404): test dùng "2N6R4T8W0KMA" ở mọi chỗ.
const bodyText = (page: Page) => page.locator('body').innerText();
const P = { list: 'shp-shipment-admin-list', det: 'shp-shipment-admin-detail', trk: 'shp-shipment-tracking', mth: 'shp-shipping-method-admin' };
/** Tab trạng thái của danh sách vận đơn theo nhãn. */
const tab = (page: Page, label: string) => id(page, `${P.list}-status-filter`).getByRole('tab', { name: label, exact: true });
/** Gọi API trực tiếp từ trang đang đăng nhập (cookie phiên của trình duyệt); trả danh sách mã trạng thái. */
const fromPage = (page: Page, path: string, times = 1, init?: { method: string; body: unknown }): Promise<number[]> => page.evaluate(async ({ api, p, n, i }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}${p}`, { method: i?.method ?? 'GET', credentials: 'include', headers: i ? { 'Content-Type': 'application/json' } : undefined, body: i ? JSON.stringify(i.body) : undefined })).status);
  return out;
}, { api: API, p: path, n: times, i: init });
/** Đơn COD đã xác nhận (đủ điều kiện bàn giao) của khách `email`; tổng 380.000 đ (350.000 hàng và 30.000 phí). */
const order = (email: string, code: string, status: 'confirmed' | 'shipped' | 'delivered' | 'returned' = 'confirmed') =>
  seedOrder({ email, code, status, method: 'cod', created_at: vn(D, '09:00'), address: ADDR, items: [{ price: 350000, qty: 1 }], shipping: 30000, tracking: status === 'confirmed' ? null : 'GHN12345678' });

describe('E2E SHP (trình duyệt thật, API thật)', () => {
  e2e('SHP-E2E-20261006-102134090: admin tạo phương thức, thấy tên trùng bị chặn, sửa phí, tắt rồi bật lại', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin' });
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/shipping-methods');
    await see(id(page, `${P.mth}-empty`));
    expect(await id(page, `${P.mth}-add`).isEnabled()).toBe(true);
    await id(page, `${P.mth}-add`).click();
    await id(page, `${P.mth}-name-input`).fill('Giao tiêu chuẩn');
    await id(page, `${P.mth}-base-fee-input`).fill('30000');
    await id(page, `${P.mth}-free-over-input`).fill('500000');
    await id(page, `${P.mth}-surcharge-input`).fill('20000');
    await id(page, `${P.mth}-cities-input`).fill('Hà Giang');
    await id(page, `${P.mth}-cities-input`).press('Enter');
    await id(page, `${P.mth}-save`).click();
    await see(id(page, `${P.mth}-toast-saved`));
    await count(id(page, `${P.mth}-row`), 1);
    await hasText(id(page, `${P.mth}-name`), 'Giao tiêu chuẩn');
    await hasText(id(page, `${P.mth}-base-fee`), '30.000 đ');
    await hasText(id(page, `${P.mth}-free-over`), '500.000 đ');
    await hasText(id(page, `${P.mth}-surcharge`), '+20.000 đ · 1 TP');
    await hasText(id(page, `${P.mth}-status`), 'Đang bật');
    await hasText(id(page, `${P.mth}-count`), '1 trên 20 phương thức tối đa');
    await count(id(page, `${P.mth}-form`), 0);
    await count(id(page, `${P.mth}-toast-saved`), 0); // toast tự mất (đường thoát của trạng thái có thời hạn)

    await id(page, `${P.mth}-add`).click();
    await id(page, `${P.mth}-name-input`).fill('giao tiêu chuẩn');
    await id(page, `${P.mth}-base-fee-input`).fill('10000');
    await id(page, `${P.mth}-save`).click();
    await see(id(page, `${P.mth}-name-taken`));
    await see(id(page, `${P.mth}-form`));
    await id(page, `${P.mth}-cancel`).click();
    await count(id(page, `${P.mth}-form`), 0);
    await count(id(page, `${P.mth}-row`), 1);

    await id(page, `${P.mth}-row-menu`).click();
    await id(page, `${P.mth}-edit`).click();
    expect(await id(page, `${P.mth}-name-input`).inputValue()).toBe('Giao tiêu chuẩn');
    expect(await id(page, `${P.mth}-free-over-input`).inputValue()).toBe('500000'); // sửa không làm mất hay làm tròn giá trị đã lưu
    await id(page, `${P.mth}-base-fee-input`).fill('35000');
    await id(page, `${P.mth}-save`).click();
    await hasText(id(page, `${P.mth}-base-fee`), '35.000 đ');
    await hasText(id(page, `${P.mth}-free-over`), '500.000 đ');
    await hasText(id(page, `${P.mth}-surcharge`), '+20.000 đ · 1 TP');

    await id(page, `${P.mth}-row-menu`).click();
    await id(page, `${P.mth}-disable`).click();
    await see(id(page, `${P.mth}-disable-confirm`));
    await id(page, `${P.mth}-disable-confirm-yes`).click();
    await hasText(id(page, `${P.mth}-status`), 'Đã tắt');
    await see(id(page, `${P.mth}-toast-state`));
    await id(page, `${P.mth}-row-menu`).click();
    await count(id(page, `${P.mth}-disable`), 0); // dòng đã tắt chỉ còn mục Bật
    await id(page, `${P.mth}-enable`).click();
    await hasText(id(page, `${P.mth}-status`), 'Đang bật');
    await count(id(page, `${P.mth}-disable-confirm`), 0); // bật lại không có hộp xác nhận
  });

  e2e('SHP-E2E-20261006-102134118: staff tìm vận đơn chờ bàn giao, bàn giao, sửa mã rồi xác nhận giao xong', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' }); await seedUser({ email: 'c1@x.vn' });
    for (const c of ['7K3M9Q2XH4TB', '5FQ2H8B7C1ZD']) { await order('c1@x.vn', c); await seedShipment({ order_code: c, status: 'pending', cod_amount: 380000, created_at: vn(D, '09:05') }); }
    await order('c1@x.vn', '2N6R4T8W0KMA', 'shipped'); await seedShipment({ order_code: '2N6R4T8W0KMA', status: 'shipped', tracking: 'VTP99887766', created_at: vn(D, '09:10') });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/shipments');
    await count(id(page, `${P.list}-row`), 3);
    await tab(page, 'Chờ bàn giao').click();
    await count(id(page, `${P.list}-row`), 2);
    for (const b of await id(page, `${P.list}-status-badge`).all()) expect((await b.innerText()).trim()).toBe('Chờ bàn giao');
    await id(page, `${P.list}-search-by`).selectOption({ label: 'Mã đơn' });
    await id(page, `${P.list}-search`).fill('7K3M9Q2XH4TB');
    await count(id(page, `${P.list}-row`), 1);
    await hasText(id(page, `${P.list}-tracking`), '—');
    expect(await bodyText(page)).not.toMatch(/@x\.vn|@shop\.vn|0901234567|Nguyễn Văn An/); // danh sách không có dữ liệu cá nhân
    await id(page, `${P.list}-row`).click();

    await hasText(id(page, `${P.det}-order-code`), '7K3M9Q2XH4TB');
    await hasText(id(page, `${P.det}-status-badge`), 'Chờ bàn giao');
    const rec = await textOf(id(page, `${P.det}-recipient`));
    for (const w of ['Nguyễn Văn An', '0901234567', '12 Lê Lợi']) expect(rec).toContain(w);
    expect(await textOf(id(page, `${P.det}-cod`))).toContain('380.000 đ');
    await see(id(page, `${P.det}-ship`));
    await count(id(page, `${P.det}-deliver`), 0); await count(id(page, `${P.det}-edit-tracking`), 0);

    await id(page, `${P.det}-ship`).click();
    await id(page, `${P.det}-ship-tracking-input`).fill('abc');
    await id(page, `${P.det}-ship-confirm`).click();
    await hasText(id(page, `${P.det}-ship-error`), /8 tới 30 ký tự/);
    await see(id(page, `${P.det}-ship-form`));
    await hasText(id(page, `${P.det}-status-badge`), 'Chờ bàn giao');
    await id(page, `${P.det}-ship-tracking-input`).fill('ghn12345678');
    expect(await id(page, `${P.det}-ship-tracking-input`).inputValue()).toBe('GHN12345678'); // ô tự đổi sang chữ hoa
    await id(page, `${P.det}-ship-confirm`).click();
    await see(id(page, `${P.det}-toast-shipped`));
    await hasText(id(page, `${P.det}-status-badge`), 'Đang giao');
    await hasText(id(page, `${P.det}-tracking`), 'GHN12345678');
    await count(id(page, `${P.det}-history-item`), 2);
    await count(id(page, `${P.det}-ship`), 0);
    for (const t of ['deliver', 'fail', 'edit-tracking']) await see(id(page, `${P.det}-${t}`));
    await count(id(page, `${P.det}-ship-form`), 0);

    await id(page, `${P.det}-edit-tracking`).click();
    expect(await id(page, `${P.det}-edit-input`).inputValue()).toBe('GHN12345678');
    expect(await id(page, `${P.det}-edit-save`).isDisabled()).toBe(true); // mã chưa đổi
    await id(page, `${P.det}-edit-input`).fill('GHN12345679');
    await id(page, `${P.det}-edit-save`).click();
    await see(id(page, `${P.det}-toast-tracking`));
    await hasText(id(page, `${P.det}-tracking`), 'GHN12345679');
    await count(id(page, `${P.det}-history-item`), 3);
    await hasText(id(page, `${P.det}-status-badge`), 'Đang giao');

    await id(page, `${P.det}-deliver`).click();
    await id(page, `${P.det}-deliver-confirm`).click();
    await hasText(id(page, `${P.det}-status-badge`), 'Đã giao');
    expect((await textOf(id(page, `${P.det}-delivered-at`))).length).toBeGreaterThan(5);
    for (const t of ['deliver', 'fail', 'edit-tracking', 'ship', 'return']) await count(id(page, `${P.det}-${t}`), 0);
    await count(id(page, `${P.det}-recipient`), 0);
    await hasText(id(page, `${P.det}-recipient-hidden`), 'Thông tin người nhận được ẩn theo chính sách dữ liệu');
    expect(await bodyText(page)).not.toMatch(/Nguyễn Văn An|0901234567/);
    await eventually(async () => { const s = await shipmentState('7K3M9Q2XH4TB'); expect(s?.status).toBe('delivered'); expect(s?.tracking_number).toBe('GHN12345679'); expect(s?.history).toBe(4); });
    expect((await shipmentState('7K3M9Q2XH4TB'))?.outbox).toEqual(['ShipmentShipped', 'ShipmentTrackingChanged', 'ShipmentDelivered']);
  });

  e2e('SHP-E2E-20261006-102134145: staff báo giao thất bại kèm lý do rồi xác nhận hàng về kho', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' }); await seedUser({ email: 'c1@x.vn' });
    await order('c1@x.vn', '5FQ2H8B7C1ZD', 'shipped');
    await seedShipment({ order_code: '5FQ2H8B7C1ZD', status: 'shipped', tracking: 'VTP99887766', created_at: vn(D, '09:05') });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/shipments');
    await id(page, `${P.list}-search-by`).selectOption({ label: 'Mã vận đơn' });
    await id(page, `${P.list}-search`).fill('VTP9988'); // gõ dở (7 ký tự): không phải lỗi, chỉ chưa có kết quả (API chỉ nhận mã 8 tới 30 ký tự và sẽ 400)
    await see(id(page, `${P.list}-empty-filtered`));
    await count(id(page, `${P.list}-error`), 0);
    await id(page, `${P.list}-search`).fill('VTP99887766');
    await count(id(page, `${P.list}-row`), 1);
    await count(id(page, `${P.list}-order-code`).getByRole('link'), 1); // mở chi tiết được bằng bàn phím (liên kết thật), không chỉ bấm cả hàng
    await id(page, `${P.list}-row`).click();
    await hasText(id(page, `${P.det}-status-badge`), 'Đang giao');
    await id(page, `${P.det}-fail`).click();
    expect(await id(page, `${P.det}-fail-confirm`).isDisabled()).toBe(true);
    await id(page, `${P.det}-fail-reason`).selectOption({ label: 'Không liên lạc được' });
    await id(page, `${P.det}-fail-note`).fill('Gọi 3 lần không nghe máy');
    await id(page, `${P.det}-fail-confirm`).click();
    await see(id(page, `${P.det}-toast-result`));
    await hasText(id(page, `${P.det}-status-badge`), 'Giao thất bại');
    await count(id(page, `${P.det}-fail`), 0); await count(id(page, `${P.det}-deliver`), 0);
    await see(id(page, `${P.det}-return`));
    await count(id(page, `${P.det}-history-item`), 3);
    const reason = await textOf(id(page, `${P.det}-history-reason`));
    expect(reason).toContain('Không liên lạc được'); expect(reason).toContain('Gọi 3 lần không nghe máy');
    expect(await id(page, `${P.det}-history-item`).last().innerText()).toContain('Không liên lạc được');
    await see(id(page, `${P.det}-recipient`)); // thất bại là trạng thái đang xử lý
    await count(id(page, `${P.det}-toast-result`), 0); // toast tự mất

    await id(page, `${P.det}-return`).click();
    await id(page, `${P.det}-return-confirm`).click();
    await hasText(id(page, `${P.det}-status-badge`), 'Đã hoàn');
    await count(id(page, `${P.det}-return`), 0);
    await see(id(page, `${P.det}-recipient-hidden`));
    await count(id(page, `${P.det}-recipient`), 0);
    await eventually(async () => { const s = await shipmentState('5FQ2H8B7C1ZD'); expect(s?.status).toBe('returned'); expect(s?.outbox).toEqual(['ShipmentFailed', 'ShipmentReturned']); });
  });

  e2e('SHP-E2E-20261006-102134172: admin vẫn thấy người nhận ở vận đơn đã giao và không có nút hành động', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin' }); await seedUser({ email: 'c1@x.vn' });
    await order('c1@x.vn', '2N6R4T8W0KMA', 'delivered');
    await seedShipment({ order_code: '2N6R4T8W0KMA', status: 'delivered', tracking: 'GHN12345678', created_at: vn(D, '09:05') });
    await order('c1@x.vn', '5FQ2H8B7C1ZD', 'shipped');
    await seedShipment({ order_code: '5FQ2H8B7C1ZD', status: 'shipped', tracking: 'VTP99887766', created_at: vn(D, '09:10') });
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/shipments');
    await count(id(page, `${P.list}-row`), 2);
    await tab(page, 'Đã giao').click();
    await count(id(page, `${P.list}-row`), 1);
    await hasText(id(page, `${P.list}-order-code`), '2N6R4T8W0KMA');
    expect(await bodyText(page)).not.toMatch(/@x\.vn|@shop\.vn|0901234567|Nguyễn Văn An/);
    await id(page, `${P.list}-row`).click();
    await hasText(id(page, `${P.det}-status-badge`), 'Đã giao');
    const rec = await textOf(id(page, `${P.det}-recipient`));
    for (const w of ['Nguyễn Văn An', '0901234567', '12 Lê Lợi', 'Bến Nghé', 'TP.HCM']) expect(rec).toContain(w);
    expect((await textOf(id(page, `${P.det}-delivered-at`))).length).toBeGreaterThan(5);
    for (const t of ['ship', 'deliver', 'fail', 'return', 'edit-tracking']) await count(id(page, `${P.det}-${t}`), 0);
    await count(id(page, `${P.det}-history-item`), 3);
    const h = await id(page, `${P.det}-history-item`).allInnerTexts();
    expect(['Đã tạo vận đơn', 'Đã bàn giao', 'Đã giao'].map((s, i) => h[i].includes(s))).toEqual([true, true, true]); // cũ nhất trước
    await id(page, `${P.det}-back-link`).click();
    await urlIs(page, /\/admin\/shipments\?status=delivered/);
    await eventually(async () => expect(await tab(page, 'Đã giao').getAttribute('aria-selected')).toBe('true')); // bộ lọc vẫn giữ
    await count(id(page, `${P.list}-row`), 1);
  });

  e2e('SHP-E2E-20261006-102134197: customer theo dõi vận đơn của đơn mình và gặp 404 với đơn người khác', async (page) => {
    await seedUser({ email: 'c1@x.vn' }); await seedUser({ email: 'c2@x.vn' });
    await seedShippingMethod({ name: 'Giao tiêu chuẩn' });
    await order('c1@x.vn', '7K3M9Q2XH4TB', 'shipped');
    await seedShipment({ order_code: '7K3M9Q2XH4TB', status: 'shipped', tracking: 'GHN12345678', cod_amount: 380000, created_at: vn(D, '09:59') }); // bàn giao một phút sau khi tạo: 06/10/2026 10:00
    await order('c1@x.vn', '5FQ2H8B7C1ZD', 'confirmed');
    await order('c2@x.vn', '9ZZZZZZZZZZZ', 'shipped');
    await seedShipment({ order_code: '9ZZZZZZZZZZZ', status: 'shipped', tracking: 'VTP99887766', created_at: vn(D, '09:05') });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
    await loginUi(page, 'c1@x.vn');
    await page.goto('/orders/7K3M9Q2XH4TB/shipment');
    await hasText(id(page, `${P.trk}-status-badge`), 'Đang giao');
    await hasText(id(page, `${P.trk}-number`), 'GHN12345678');
    await hasText(id(page, `${P.trk}-method`), 'Giao tiêu chuẩn');
    await hasText(id(page, `${P.trk}-shipped-at`), '06/10/2026 10:00');
    expect(await id(page, `${P.trk}-stepper`).locator('li[aria-current="step"]').innerText()).toContain('Đang giao');

    await id(page, `${P.trk}-copy`).click();
    await hasText(id(page, `${P.trk}-copy`), 'Đã chép');
    expect(await page.evaluate(() => (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText())).toBe('GHN12345678');
    await hasText(id(page, `${P.trk}-copy`), 'Sao chép'); // sau 2 giây nút về lại chữ cũ

    await count(id(page, `${P.trk}-history-item`), 2);
    const h = await id(page, `${P.trk}-history-item`).allInnerTexts();
    expect(h[0]).toContain('Đã tạo vận đơn'); expect(h[1]).toContain('Đã bàn giao');
    await count(id(page, `${P.trk}-history-time`), 2);
    await count(id(page, `${P.trk}-failed-notice`), 0); await count(id(page, `${P.trk}-closed-notice`), 0);
    expect(await bodyText(page)).not.toMatch(/Thu hộ|COD|380\.000|Lý do|Ghi chú|Nguyễn Văn An|0901234567/);

    const seen: string[] = [];
    for (const code of ['9ZZZZZZZZZZZ', 'AAAAAAAAAAAA', 'abc']) { // đơn của c2, đơn không tồn tại, mã sai định dạng: cùng một giao diện
      await page.goto(`/orders/${code}/shipment`);
      await see(id(page, `${P.trk}-not-found`));
      await count(id(page, `${P.trk}-number`), 0);
      seen.push(await bodyText(page));
    }
    expect(seen[0]).toContain('Không tìm thấy đơn hàng');
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).not.toMatch(/VTP99887766/);
    await id(page, `${P.trk}-not-found-back`).click();
    await urlIs(page, /\/orders$/);

    await page.goto('/orders/5FQ2H8B7C1ZD/shipment');
    await hasText(id(page, `${P.trk}-no-shipment`), 'Đơn chưa được bàn giao cho vận chuyển.');
    await see(id(page, `${P.trk}-history-empty`));
    await count(id(page, `${P.trk}-status-badge`), 0); await count(id(page, `${P.trk}-number`), 0);
  });

  e2e('SHP-E2E-20261006-102134222: customer thấy lời báo giao chưa thành công mà không lộ lý do nội bộ', async (page) => {
    await seedUser({ email: 'c1@x.vn' }); await seedUser({ email: 's1@shop.vn', role: 'staff' });
    await order('c1@x.vn', '2N6R4T8W0KMA', 'shipped');
    await seedShipment({ order_code: '2N6R4T8W0KMA', status: 'failed', tracking: 'GHN12345678', reason_code: 'wrong_address', note: 'Số nhà không tồn tại', cod_amount: 380000, created_at: vn(D, '09:05') });
    await loginUi(page, 'c1@x.vn');
    await page.goto('/orders/2N6R4T8W0KMA/shipment');
    await hasText(id(page, `${P.trk}-status-badge`), 'Giao thất bại');
    await hasText(id(page, `${P.trk}-failed-notice`), 'Giao hàng chưa thành công. Shop sẽ liên hệ với bạn.');
    await count(id(page, `${P.trk}-history-item`), 3);
    const text = await bodyText(page);
    expect(text).not.toMatch(/Sai địa chỉ|Số nhà không tồn tại|wrong_address|Thu hộ|380\.000/);
    const last = await id(page, `${P.trk}-history-item`).last().innerText();
    expect(last).toContain('Giao thất bại'); expect(last).not.toMatch(/Sai địa chỉ|Số nhà/);

    await withPage(env.browser, async (staff) => { // nhân viên xác nhận hàng về kho (API thật, cùng đường với màn chi tiết)
      await loginUi(staff, 's1@shop.vn');
      expect(await fromPage(staff, '/shipping/orders/2N6R4T8W0KMA/shipment/return', 1, { method: 'POST', body: {} })).toEqual([200]);
    });
    await page.reload();
    await hasText(id(page, `${P.trk}-status-badge`), 'Đã hoàn');
    await hasText(id(page, `${P.trk}-closed-notice`), 'Hàng đã hoàn về kho.');
    await count(id(page, `${P.trk}-failed-notice`), 0);

    const API_RE = /\/api\/v1\/shipping\/orders\/2N6R4T8W0KMA\/shipment(\/history)?$/;
    await page.route(API_RE, (route) => route.abort('failed')); // mất mạng
    await page.reload();
    await see(id(page, `${P.trk}-error`));
    await count(id(page, `${P.trk}-status-badge`), 0);
    await page.unroute(API_RE);
    await id(page, `${P.trk}-retry`).click();
    await hasText(id(page, `${P.trk}-status-badge`), 'Đã hoàn');
    await count(id(page, `${P.trk}-error`), 0);
    await count(id(page, `${P.trk}-history-item`), 4);
  });

  // Bổ sung của web (rút từ bài học các epic trước): dữ liệu người nhập hiển thị như văn bản, bảng nhãn an toàn với tên thuộc tính của Object.prototype.
  e2e('SHP-E2E-20261006-102134145 SHP-WEB-01: tên phương thức là __proto__ hoặc mã HTML và ghi chú thất bại chứa HTML hiện như văn bản thường, không thực thi', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin' }); await seedUser({ email: 'c1@x.vn' });
    const html = '<b>đậm</b><img src=x onerror="document.title=\'xss\'">';
    const m1 = await seedShippingMethod({ name: '__proto__' });
    await seedShippingMethod({ name: html });
    await order('c1@x.vn', '2N6R4T8W0KMA', 'shipped');
    await seedShipment({ order_code: '2N6R4T8W0KMA', status: 'failed', tracking: 'GHN12345678', reason_code: 'damaged', note: html, method_id: m1.id, created_at: vn(D, '09:05') });
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/shipping-methods');
    await count(id(page, `${P.mth}-row`), 2);
    const names = await id(page, `${P.mth}-name`).allInnerTexts();
    expect(names.sort()).toEqual([html, '__proto__'].sort());
    expect(await id(page, `${P.mth}-table`).locator('b, img').count()).toBe(0);
    await page.goto('/admin/shipments/2N6R4T8W0KMA');
    await hasText(id(page, `${P.det}-method`), '__proto__');
    await eventually(async () => expect(await textOf(id(page, `${P.det}-history-reason`))).toBe(`Hàng hỏng · ${html}`));
    expect(await id(page, `${P.det}-history`).locator('b, img').count()).toBe(0);
    expect(await page.title()).not.toBe('xss');
    await page.goto('/admin/shipments');
    await hasText(id(page, `${P.list}-method`), '__proto__');
  });

  e2e('SHP-E2E-20261006-102134090 SHP-WEB-02: đạt trần 20 phương thức khóa nút Thêm; sửa khi người khác đã sửa trước hiện xung đột và tải lại giữ được thao tác', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin' });
    const first = await seedShippingMethod({ name: 'Phương thức 0', age_sec: 100 });
    for (let i = 1; i < 20; i++) await seedShippingMethod({ name: `Phương thức ${i}`, age_sec: 100 - i });
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/shipping-methods');
    await count(id(page, `${P.mth}-row`), 20);
    await hasText(id(page, `${P.mth}-count`), '20 trên 20 phương thức tối đa');
    await see(id(page, `${P.mth}-limit-note`));
    expect(await id(page, `${P.mth}-add`).isDisabled()).toBe(true);
    const row = id(page, `${P.mth}-row`).filter({ hasText: 'Phương thức 0' }); // mới nhất trước: dòng "Phương thức 19" ở đầu, "Phương thức 0" cuối
    await row.getByTestId(`${P.mth}-row-menu`).click();
    await row.getByTestId(`${P.mth}-edit`).click();
    await id(page, `${P.mth}-base-fee-input`).fill('45000');
    expect(await fromPage(page, `/admin/shipping/methods/${first.id}`, 1, { method: 'PATCH', body: { name: 'Phương thức 0 (đổi)', version: 1 } })).toEqual([200]); // người khác sửa trước
    await id(page, `${P.mth}-save`).click();
    await see(id(page, `${P.mth}-conflict`));
    expect(await id(page, `${P.mth}-base-fee-input`).inputValue()).toBe('45000'); // giữ giá trị đang nhập
    await id(page, `${P.mth}-conflict-reload`).click();
    await count(id(page, `${P.mth}-conflict`), 0);
    expect(await id(page, `${P.mth}-name-input`).inputValue()).toBe('Phương thức 0 (đổi)');
    await id(page, `${P.mth}-base-fee-input`).fill('45000');
    await id(page, `${P.mth}-save`).click();
    await see(id(page, `${P.mth}-toast-saved`));
    await count(id(page, `${P.mth}-form`), 0);
    await hasText(id(page, `${P.mth}-row`).filter({ hasText: 'Phương thức 0 (đổi)' }).getByTestId(`${P.mth}-base-fee`), '45.000 đ');
  });

  e2e('SHP-TC-20261006-102133082 SHP-WEB-03: staff và customer không có quyền mở màn quản trị phương thức; customer không mở được danh sách vận đơn', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/shipping-methods');
    await see(id(page, `${P.mth}-forbidden`));
    await count(id(page, `${P.mth}-row`), 0);
    await withPage(env.browser, async (c) => {
      await seedUser({ email: 'c1@x.vn' });
      await loginUi(c, 'c1@x.vn');
      await c.goto('/admin/shipments');
      await see(id(c, `${P.list}-forbidden`));
      await c.goto('/admin/shipments/7K3M9Q2XH4TB');
      await see(id(c, `${P.det}-forbidden`));
    });
  });

  e2e('SHP-E2E-20261006-102134197 SHP-WEB-04: từ chi tiết đơn của ORD bấm "Theo dõi vận chuyển" tới màn theo dõi của SHP (ORD-E2E-20261006-111226558 cần đích này)', async (page) => {
    await seedUser({ email: 'c1@x.vn' });
    await seedShippingMethod({ name: 'Giao tiêu chuẩn' });
    await order('c1@x.vn', '7K3M9Q2XH4TB', 'shipped');
    await seedShipment({ order_code: '7K3M9Q2XH4TB', status: 'shipped', tracking: 'GHN12345678', created_at: vn(D, '09:59') });
    await loginUi(page, 'c1@x.vn');
    await page.goto('/orders/7K3M9Q2XH4TB');
    await id(page, 'ord-order-detail-tracking-link').click();
    await urlIs(page, /\/orders\/7K3M9Q2XH4TB\/shipment$/);
    await hasText(id(page, `${P.trk}-status-badge`), 'Đang giao');
    await hasText(id(page, `${P.trk}-number`), 'GHN12345678');
  });

  // Trạng thái có thời hạn (429, bậc D) phải có đường thoát: banner kèm thử lại sau N giây rồi tải lại được khi hết giờ chờ (đồng hồ API do cổng điều khiển tua).
  e2e('SHP-TC-20261006-102134039: danh sách vận đơn bị giới hạn tần suất (bậc D) hiện banner kèm thử lại sau N giây, rồi tải lại được khi hết giờ chờ', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' }); await seedUser({ email: 'c1@x.vn' });
    await order('c1@x.vn', '7K3M9Q2XH4TB'); await seedShipment({ order_code: '7K3M9Q2XH4TB', status: 'pending', created_at: vn(D, '09:05') });
    await loginUi(page, 's1@shop.vn');
    await alignWindow();
    expect((await fromPage(page, '/shipping/shipments?page=1&limit=1', 30)).every((s) => s === 200)).toBe(true);
    await page.goto('/admin/shipments'); // lần thứ 31
    await eventually(async () => expect(await textOf(id(page, `${P.list}-error`))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await count(id(page, `${P.list}-row`), 0);
    await advance(61_000);
    await id(page, `${P.list}-retry`).click();
    await count(id(page, `${P.list}-error`), 0);
    await see(id(page, `${P.list}-row`));
  });

  e2e('SHP-TC-20261006-130000001: bàn giao bị giới hạn tần suất (bậc D) hiện lỗi kèm thử lại sau N giây trong hộp thoại, rồi bàn giao được khi hết giờ chờ', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' }); await seedUser({ email: 'c1@x.vn' });
    await order('c1@x.vn', '7K3M9Q2XH4TB'); await seedShipment({ order_code: '7K3M9Q2XH4TB', status: 'pending', created_at: vn(D, '09:05') });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/shipments/7K3M9Q2XH4TB');
    await see(id(page, `${P.det}-ship`));
    await alignWindow();
    expect((await fromPage(page, '/shipping/orders/9X9X9X9X9X9X/shipment/ship', 30, { method: 'POST', body: { tracking_number: 'GHN00000001' } })).every((s) => s === 404)).toBe(true); // 30 yêu cầu của bậc D
    await id(page, `${P.det}-ship`).click();
    await id(page, `${P.det}-ship-tracking-input`).fill('GHN12345678');
    await id(page, `${P.det}-ship-confirm`).click(); // lần thứ 31
    await eventually(async () => expect(await textOf(id(page, `${P.det}-ship-blocked`))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/));
    await see(id(page, `${P.det}-ship-form`));
    expect((await shipmentState('7K3M9Q2XH4TB'))?.status).toBe('pending');
    await advance(61_000);
    await id(page, `${P.det}-ship-confirm`).click();
    await see(id(page, `${P.det}-toast-shipped`));
    await hasText(id(page, `${P.det}-status-badge`), 'Đang giao');
  });
});
