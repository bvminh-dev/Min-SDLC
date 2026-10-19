import type { Locator, Page } from 'playwright-core';
import {
  advance, alignWindow, API, count, ctl, dshFault, dshOrdFault, eventually, gateway, hasText, id, loginUi, orderState, paymentState, relay, reset, see, seedAddress, seedCart, seedCategory, seedOrder, seedPayment, seedProduct, seedRefund, seedShippingMethod,
  seedStock, seedUser, startE2e, textOf, urlIs, withPage, type E2eEnv, GATE} from './support';

// E2E của DSH chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule: mọi module thật) trên PostgreSQL thật (`ecom_e2e`), bản build production của web. Dữ liệu mồi (đơn, thanh toán, hoàn tiền,
// tồn kho) dựng qua cổng điều khiển như E2E của các epic khác; MỘT ca đi luồng thật (khách đặt hàng bằng giao diện, thanh toán qua cổng VNPay giả, rồi admin xem dashboard). Hạn nguồn của máy chủ E2E là 500 ms (DASHBOARD_SOURCE_TIMEOUT_MS)
// và lỗi nguồn PAY gài qua cổng điều khiển (`dshFault`). Ngày dữ liệu mồi tính từ HÔM NAY theo giờ Việt Nam (máy chủ E2E dùng giờ thật, không đồng hồ cố định); ba ca báo cáo dùng khoảng quá khứ cố định của spec.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); await dshFault('ok'); await dshOrdFault('ok'); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 180_000);
const SO = 'dsh-analytics-sources', SA = 'dsh-analytics-sales';
const D = 'dsh-admin-dashboard', R = 'dsh-analytics-revenue', O = 'dsh-analytics-orders', PR = 'dsh-analytics-products';
const DAY = 86_400_000;
const ymd = (ms: number): string => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
const today = (): string => ymd(Date.now());
/** Thời điểm (ISO) vào buổi trưa giờ Việt Nam của ngày cách hôm nay `n` ngày. */
const ago = (n: number, hour = '12'): string => new Date(`${ymd(Date.now() - n * DAY)}T${hour}:00:00+07:00`).toISOString();
const at = (date: string, hour = '12'): string => new Date(`${date}T${hour}:00:00+07:00`).toISOString();
const admin = async (page: Page, email = 'admin@shop.vn'): Promise<void> => { await seedUser({ email, role: 'admin' }); await loginUi(page, email); };
const cust = async (email: string): Promise<void> => { await seedUser({ email, role: 'customer' }); };
const valueIs = (l: Locator, expected: string) => eventually(async () => { expect(await l.first().inputValue()).toBe(expected); });
const setRange = async (page: Page, p: string, from: string, to: string): Promise<void> => {
  await id(page, `${p}-range-from`).fill(from);
  await id(page, `${p}-range-to`).fill(to);
  await id(page, `${p}-range-apply`).click();
};
let n = 0;
/** Đơn của một khách (tạo nếu chưa có) ở trạng thái `status` tạo vào `created_at`; mặc định 350.000 (320.000 + vận chuyển 30.000). */
async function orders(count: number, o: { status: string; created_at: string; method?: 'vnpay' | 'cod'; payment?: string; product?: string; price?: number; qty?: number; paid_at?: string }): Promise<void> {
  const email = `khach${++n}@x.vn`;
  await cust(email);
  for (let i = 0; i < count; i++) {
    await seedOrder({ email, status: o.status, method: o.method, payment: o.payment, created_at: o.created_at, paid_at: o.paid_at, shipping: 30_000, items: [{ price: o.price ?? 320_000, qty: o.qty ?? 1, ...(o.product ? { product: o.product } : {}) } as never] });
  }
}
async function pay(o: { amount: number; method?: 'vnpay' | 'cod'; status?: string; paid_at?: string | null; created_at?: string }): Promise<{ order_code: string }> {
  const email = `khach${++n}@x.vn`;
  await cust(email);
  const cod = o.method === 'cod';
  const p = await seedPayment({ email, method: o.method ?? 'vnpay', amount: o.amount, status: o.status ?? 'succeeded', attempt_no: cod ? 0 : 1, attempts: cod ? [] : 'auto', paid_at: o.paid_at, created_at: o.created_at, ...(cod && (o.status ?? 'succeeded') === 'succeeded' ? { order_status: 'delivered' } : {}) });
  return { order_code: p.order_code };
}

describe('E2E DSH (trình duyệt thật, API thật)', () => {
  e2e('DSH-E2E-20261006-110407878: Admin đổi khoảng ngày và thấy doanh thu, số đơn đổi theo', async (page) => {
    // thanh toán A 350.000 (hôm qua), B COD 120.000 (3 ngày trước), C 200.000 thu 4 ngày trước và hoàn 2 ngày trước; 45 đơn trong 5 ngày qua (5 hủy, 2 hết hạn, 1 hoàn về)
    await pay({ amount: 350_000, paid_at: ago(1), created_at: ago(1) });
    await pay({ amount: 120_000, method: 'cod', paid_at: ago(3), created_at: ago(3) });
    const c = await pay({ amount: 200_000, status: 'refunded', paid_at: ago(4), created_at: ago(4) });
    await seedRefund({ order_code: c.order_code, status: 'succeeded', reason: 'order_cancelled', created_at: ago(2) });
    for (const [status, k, method] of [['pending', 3, 'vnpay'], ['confirmed', 5, 'cod'], ['paid', 10, 'vnpay'], ['shipped', 8, 'vnpay'], ['delivered', 8, 'vnpay'], ['returned', 1, 'cod'], ['cancelled', 5, 'vnpay'], ['expired', 2, 'vnpay']] as const) {
      await orders(k, { status, method, created_at: ago(2, '10') });
    }
    await admin(page);
    await page.goto('/admin/dashboard');
    await hasText(id(page, `${D}-as-of`), /^Cập nhật lúc \d{2}:\d{2}$/);
    await valueIs(id(page, `${D}-range-to`), today());
    await valueIs(id(page, `${D}-range-from`), ymd(Date.now() - 29 * DAY)); // khoảng mặc định là 30 ngày qua
    await setRange(page, D, ymd(Date.now() - 5 * DAY), today());
    await hasText(id(page, `${D}-kpi-revenue`), '470.000 đ');
    const detail = await textOf(id(page, `${D}-kpi-revenue-detail`));
    expect(detail).toContain('hoàn 200.000 đ'); // giao diện hiện hành không còn số Thu ở dòng chi tiết
    expect(detail).toContain('3 giao dịch');
    await hasText(id(page, `${D}-kpi-orders`), '45');
    await hasText(id(page, `${D}-kpi-orders-effective`), 'Hiệu lực 37');
    expect(await textOf(id(page, `${D}-kpi-orders-by-status`))).toMatch(/Đã hoàn\s*1/);
    await count(id(page, `${D}-range-error`), 0);
    // ngày mai: ô chặn chọn bằng `max` (bộ chọn ngày không cho); gõ tay (bỏ `max` để mô phỏng) thì máy chủ từ chối bằng 400
    await id(page, `${D}-range-to`).evaluate((el) => { (el as unknown as { max: string }).max = ''; });
    await id(page, `${D}-range-to`).fill(ymd(Date.now() + DAY));
    await id(page, `${D}-range-apply`).click();
    await see(id(page, `${D}-range-error`));
    expect(await textOf(id(page, `${D}-range-error`))).toMatch(/không hợp lệ/);
    await hasText(id(page, `${D}-kpi-revenue`), '470.000 đ'); // số của khoảng trước được giữ
    await hasText(id(page, `${D}-kpi-orders`), '45');
    await id(page, `${D}-range-reset`).click();
    await valueIs(id(page, `${D}-range-from`), ymd(Date.now() - 29 * DAY));
    await valueIs(id(page, `${D}-range-to`), today());
    await count(id(page, `${D}-range-error`), 0);
    await hasText(id(page, `${D}-kpi-revenue`), '470.000 đ'); // 30 ngày qua gồm cả ba thanh toán
  });

  e2e('DSH-E2E-20261006-110407909: Admin thấy cảnh báo hoàn tiền thất bại và mở hàng đợi hoàn tiền', async (page) => {
    for (let i = 0; i < 2; i++) {
      const p = await pay({ amount: 100_000 + i, paid_at: ago(3), created_at: ago(3) });
      await seedRefund({ order_code: p.order_code, status: 'failed', auto_attempt_no: 3, created_at: ago(0, '08') });
    }
    await admin(page);
    await page.goto('/admin/dashboard');
    await hasText(id(page, `${D}-refund-alert`), /^2 hoàn tiền lỗi/);
    await id(page, `${D}-refund-alert-link`).click();
    await urlIs(page, /\/admin\/refunds\?status=failed/);
    await count(id(page, 'pay-admin-refund-queue-row'), 2);
    for (let i = 0; i < 2; i++) { // PAY xử lý xong cả hai (thử lại qua cổng giả thành công)
      await id(page, 'pay-admin-refund-queue-refund-retry').first().click();
      await id(page, 'pay-admin-refund-queue-retry-confirm').click();
      await see(id(page, 'pay-admin-refund-queue-retry-success'));
      await eventually(async () => { expect(await id(page, 'pay-admin-refund-queue-refund-retry').count()).toBe(1 - i); });
    }
    await relay();
    await advance(61_000); // hết bộ nhớ đệm 60 giây của DSH (đồng hồ của máy chủ E2E)
    await page.goto('/admin/dashboard');
    await see(id(page, `${D}-kpi-revenue`));
    await count(id(page, `${D}-refund-alert`), 0);
  });

  e2e('DSH-E2E-20261006-110407938: Admin xem sản phẩm tồn thấp rồi mở danh sách tồn thấp của kho', async (page) => {
    const cat = await seedCategory('Áo');
    for (const [i, available] of [0, 0, 1, 2, 3, 4, 5].entries()) {
      const product = await seedProduct({ name: `Hàng tồn ${i}`, category_id: cat, sku: `TON-${i}` });
      await seedStock({ product_id: product, on_hand: available, reserved: 0, threshold: 5 });
    }
    const big = await seedProduct({ name: 'Hàng đầy kho', category_id: cat, sku: 'TON-99' });
    await seedStock({ product_id: big, on_hand: 50, reserved: 0, threshold: 5 });
    await admin(page);
    await page.goto('/admin/dashboard');
    await hasText(id(page, `${D}-low-stock-count`), '7');
    await count(id(page, `${D}-low-stock-row`), 5);
    expect(await textOf(id(page, `${D}-low-stock-row`))).toMatch(/\b0$/); // dòng đầu: còn bán 0
    await id(page, `${D}-low-stock-view-all`).click();
    await urlIs(page, /\/admin\/inventory\?tab=low/);
    await eventually(async () => { expect(await id(page, 'inv-inventory-list-tab-low-stock').getAttribute('aria-selected')).toBe('true'); });
    await count(id(page, 'inv-inventory-list-row'), 7);
  });

  e2e('DSH-TC-20261013-232147647 và DSH-E2E-20261006-110407938 (tên sản phẩm độc hại): tên có thẻ HTML hiện thành chữ ở tồn thấp và báo cáo sản phẩm, không chạy script và không thành phần tử (SB-12)', async (page) => {
    const cat = await seedCategory('Áo');
    const evil = `<img src=x onerror="window.__dshxss=1"><script>window.__dshxss=2</script>"'>`;
    const product = await seedProduct({ name: evil, category_id: cat, sku: 'XSS-1' });
    await seedStock({ product_id: product, on_hand: 1, reserved: 0, threshold: 5 });
    await orders(1, { status: 'delivered', payment: 'succeeded', created_at: ago(2), paid_at: ago(2), product, price: 100_000, qty: 3 });
    await admin(page);
    await page.goto('/admin/dashboard');
    await hasText(id(page, `${D}-low-stock-count`), '1');
    const shown = /<img src=x onerror="window\.__dshxss=1"><script>window\.__dshxss=2<\/script>"'>/;
    await hasText(id(page, `${D}-low-stock-row`), shown);
    await page.goto('/admin/reports/products');
    await see(id(page, `${PR}-row`));
    await hasText(id(page, `${PR}-row`), shown);
    for (const path of ['/admin/dashboard', '/admin/reports/products']) {
      await page.goto(path);
      await see(id(page, path === '/admin/dashboard' ? `${D}-low-stock-row` : `${PR}-row`));
      expect(await page.evaluate(() => (globalThis as unknown as { __dshxss?: number }).__dshxss)).toBeUndefined();
      expect(await page.locator('img[src="x"]').count()).toBe(0);
      expect(await page.locator('main script').count()).toBe(0);
    }
  });

  e2e('DSH-E2E-20261006-110407966: Admin mở đơn gần đây rồi xem chi tiết đơn', async (page) => {
    await cust('khach-moi@x.vn');
    for (let i = 0; i < 24; i++) await seedOrder({ email: 'khach-moi@x.vn', status: 'paid', created_at: ago(2 + i % 5, String(10 + (i % 8))) });
    await seedOrder({ email: 'khach-moi@x.vn', code: '7K3M9Q2XH4TB', status: 'paid', created_at: new Date(Date.now() - 60_000).toISOString() });
    await admin(page);
    await page.goto('/admin/dashboard');
    await count(id(page, `${D}-recent-orders-row`), 10);
    await hasText(id(page, `${D}-recent-orders-code`), '7K3M9Q2XH4TB');
    const head = (await page.locator('table th').allInnerTexts()).join('|');
    expect(head).not.toMatch(/Email|Tên|Điện thoại|Khách/i);
    expect(await page.locator(`[data-testid="${D}-recent-orders-row"]`).first().innerText()).not.toMatch(/@|0901234567|Nguyễn Văn A/);
    await id(page, `${D}-recent-orders-row`).first().click();
    await urlIs(page, /\/orders\/7K3M9Q2XH4TB$/);
    await hasText(id(page, 'ord-order-detail-code'), '7K3M9Q2XH4TB');
    await see(id(page, 'ord-order-detail-status-badge'));
  });

  e2e('DSH-E2E-20261006-110407995: Admin xem báo cáo doanh thu 92 ngày chia theo tuần', async (page) => {
    // khoảng quá khứ cố định của spec: 01/07 tới 30/09/2026 (92 ngày); dữ liệu ở tháng 7 và 8, tháng 9 để trống cho bước cuối
    await pay({ amount: 100_000, paid_at: at('2026-07-15'), created_at: at('2026-07-15') });
    await pay({ amount: 300_000, method: 'cod', paid_at: at('2026-08-20'), created_at: at('2026-08-20') });
    const c = await pay({ amount: 200_000, status: 'refunded', paid_at: at('2026-08-01'), created_at: at('2026-08-01') });
    await seedRefund({ order_code: c.order_code, status: 'succeeded', reason: 'order_cancelled', created_at: at('2026-08-25') });
    await admin(page);
    await page.goto('/admin/reports/revenue');
    await see(id(page, `${R}-total-net`));
    await setRange(page, R, '2026-07-01', '2026-09-30');
    await hasText(id(page, `${R}-granularity`), /^Theo tuần/);
    await count(id(page, `${R}-row`), 14);
    expect(await id(page, `${R}-row`).first().innerText()).toContain('29/06/2026');
    await hasText(id(page, `${R}-total-gross`), '600.000 đ');
    await hasText(id(page, `${R}-total-refunded`), '200.000 đ');
    await hasText(id(page, `${R}-total-net`), '400.000 đ'); // Thu trừ Hoàn
    await see(id(page, `${R}-chart`));
    await id(page, `${R}-range-from`).fill('2025-10-05');
    await id(page, `${R}-range-to`).fill('2026-10-06'); // 367 ngày
    await id(page, `${R}-range-apply`).click();
    await see(id(page, `${R}-range-error`));
    await hasText(id(page, `${R}-total-net`), '400.000 đ'); // báo cáo 92 ngày được giữ
    await count(id(page, `${R}-row`), 14);
    await setRange(page, R, '2026-09-01', '2026-09-30');
    await see(id(page, `${R}-empty`));
    await hasText(id(page, `${R}-empty`), /^Chưa có giao dịch/);
    await hasText(id(page, `${R}-total-net`), '0 đ');
    await count(id(page, `${R}-range-error`), 0);
  });

  e2e('DSH-E2E-20261006-110408024: Admin xem báo cáo đơn và tỷ lệ hủy', async (page) => {
    // 200 đơn trong 09/2026: 150 đơn đã thu tiền tổng 52.500.000 đ (mỗi đơn 350.000), 30 hủy, 8 hết hạn
    const plan: [string, number, 'vnpay' | 'cod', string][] = [['delivered', 119, 'vnpay', 'succeeded'], ['returned', 1, 'cod', 'succeeded'], ['shipped', 10, 'vnpay', 'succeeded'], ['paid', 20, 'vnpay', 'succeeded'],
      ['confirmed', 10, 'cod', 'pending'], ['pending', 2, 'vnpay', 'pending'], ['cancelled', 30, 'vnpay', 'cancelled'], ['expired', 8, 'vnpay', 'expired']];
    let day = 0;
    for (const [status, k, method, payment] of plan) for (let i = 0; i < k; i++) { await orders(1, { status, method, payment, created_at: at(`2026-09-${String(1 + (day++ % 30)).padStart(2, '0')}`, '10') }); }
    await admin(page);
    await page.goto('/admin/reports/orders');
    await see(id(page, `${O}-total`));
    await setRange(page, O, '2026-09-01', '2026-09-30');
    await hasText(id(page, `${O}-total`), '200');
    await hasText(id(page, `${O}-cancel-rate`), '15,0%');
    await hasText(id(page, `${O}-expired-rate`), '4,0%');
    await hasText(id(page, `${O}-aov`), '350.000 đ');
    await count(id(page, `${O}-row`), 30);
    expect(await textOf(id(page, `${O}-note`))).toMatch(/không phải doanh thu/);
    await see(id(page, `${O}-chart`));
    await setRange(page, O, '2026-08-01', '2026-08-31'); // không có đơn nào
    await see(id(page, `${O}-empty`));
    await hasText(id(page, `${O}-cancel-rate`), '—');
    await hasText(id(page, `${O}-aov`), '—');
    await hasText(id(page, `${O}-total`), '0');
  });

  e2e('DSH-E2E-20261006-110408057: Admin đổi cách xếp báo cáo sản phẩm từ số lượng sang giá trị', async (page) => {
    const cat = await seedCategory('Áo');
    const mk = (name: string) => seedProduct({ name, category_id: cat, sku: name.toUpperCase().replace(/\W/g, '-') });
    const [p1, p2, p3] = [await mk('Sản phẩm P1'), await mk('Sản phẩm P2'), await mk('Sản phẩm P3')];
    const sell = (product: string, price: number, qty: number) => orders(1, { status: 'delivered', payment: 'succeeded', created_at: at('2026-09-10', '10'), paid_at: at('2026-09-10', '11'), product, price, qty });
    await sell(p1, 100_000, 40); await sell(p2, 200_000, 25); await sell(p3, 50_000, 25);
    await admin(page);
    await page.goto('/admin/reports/products');
    await see(id(page, `${PR}-units-total`));
    await setRange(page, PR, '2026-09-01', '2026-09-30');
    await hasText(id(page, `${PR}-units-total`), '90');
    await hasText(id(page, `${PR}-distinct`), '3');
    await eventually(async () => { expect((await id(page, `${PR}-row`).allInnerTexts()).map((t) => /P(\d)/.exec(t)?.[1])).toEqual(['1', '2', '3']); });
    await id(page, `${PR}-sort`).selectOption({ label: 'Giá trị' });
    await id(page, `${PR}-range-apply`).click();
    await eventually(async () => { expect((await id(page, `${PR}-row`).allInnerTexts()).map((t) => /P(\d)/.exec(t)?.[1])).toEqual(['2', '1', '3']); });
    for (let i = 4; i <= 12; i++) await sell(await mk(`Sản phẩm P${i}`), 10_000, 1); // thêm 9 sản phẩm: tổng 12
    await id(page, `${PR}-limit`).selectOption({ label: '5 dòng' });
    await count(id(page, `${PR}-row`), 5);
    await hasText(id(page, `${PR}-distinct`), '12');
    await hasText(id(page, `${PR}-units-total`), '99');
    expect(await textOf(id(page, `${PR}-note`))).toMatch(/không phải doanh thu/);
  });

  e2e('DSH-E2E-20261006-110408086: PAY lỗi, khối doanh thu báo lỗi và Thử lại, các khối khác vẫn hiển thị', async (page) => {
    await pay({ amount: 350_000, paid_at: ago(1), created_at: ago(1) });
    await orders(2, { status: 'paid', payment: 'succeeded', created_at: ago(1, '09') });
    await cust('khach-sp@x.vn');
    const cat = await seedCategory('Áo');
    await seedProduct({ name: 'Hàng thường', category_id: cat, sku: 'THUONG-1' });
    await dshFault('hang'); // PAY không trả lời: quá hạn nguồn (500 ms ở máy chủ E2E)
    await admin(page);
    await page.goto('/admin/dashboard');
    await see(id(page, `${D}-kpi-revenue-error`));
    await see(id(page, `${D}-kpi-revenue-retry`));
    await count(id(page, `${D}-kpi-revenue`), 0); // không hiện số 0 thay cho lỗi
    await see(id(page, `${D}-kpi-orders`));
    await see(id(page, `${D}-kpi-customers`));
    await see(id(page, `${D}-kpi-products`));
    await see(id(page, `${D}-recent-orders-row`));
    await dshFault('ok');
    await id(page, `${D}-kpi-revenue-retry`).click();
    await count(id(page, `${D}-kpi-revenue-error`), 0);
    await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ');
  });

  e2e('DSH-E2E-20261006-110408116: Staff mở trang dashboard và thấy màn không có quyền', async (page) => {
    await seedUser({ email: 'staff@shop.vn', role: 'staff' });
    await pay({ amount: 350_000, paid_at: ago(1), created_at: ago(1) });
    await loginUi(page, 'staff@shop.vn');
    expect(await page.locator('a[href="/admin/dashboard"]').count()).toBe(0); // staff không có liên kết tới trang này
    await page.goto('/admin/dashboard');
    await see(id(page, 'auth-access-denied-container'));
    await hasText(id(page, 'auth-access-denied-message'), /vai trò Nhân viên|staff/i);
    const html = await page.content();
    expect(html).not.toMatch(/350\.000|Doanh thu thuần/);
    await count(id(page, `${D}-kpi-revenue`), 0);
    await id(page, 'auth-access-denied-home').click();
    await urlIs(page, /\/$/);
  });

  e2e('DSH-E2E-20261006-110407878 (luồng thật): khách đặt hàng VNPay bằng giao diện và thanh toán qua cổng giả, admin thấy đúng doanh thu, đơn, khách và đơn gần đây', async (page) => {
    await seedUser({ email: 'a1@x.vn' });
    const category = await seedCategory('Áo');
    const p1 = await seedProduct({ name: 'Áo thun cotton', category_id: category, price: 150000 });
    await seedStock({ product_id: p1, on_hand: 10 });
    await seedAddress({ email: 'a1@x.vn', receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hồ Chí Minh', is_default: true, age_ms: 60_000 });
    await seedShippingMethod({ name: 'Giao tiêu chuẩn', base_fee: 30000, rule: { free_over: 500000 } });
    await seedCart({ email: 'a1@x.vn', lines: [{ product_id: p1, quantity: 1 }] });
    await loginUi(page, 'a1@x.vn');
    await page.goto('/cart');
    await id(page, 'crt-cart-summary-checkout-link').click();
    await urlIs(page, /\/checkout(\?|$)/);
    const K = 'chk-checkout';
    await see(id(page, `${K}-address-section`));
    for (const t of [page.locator('label', { hasText: 'Giao tiêu chuẩn' }).getByTestId(`${K}-shipping-option`), id(page, `${K}-payment-vnpay`)]) {
      await see(t);
      if (!(await t.first().isChecked())) await t.first().click();
      await eventually(async () => { expect(await t.first().isChecked()).toBe(true); });
    }
    await hasText(id(page, `${K}-summary-total`), '180.000 đ');
    await eventually(async () => { expect(await id(page, `${K}-place-order`).first().isEnabled()).toBe(true); });
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    const code = await textOf(id(page, `${K}-complete-order-code`));
    await relay(); // PAY nhận OrderCreated và tạo Payment
    await id(page, `${K}-complete-pay-now`).click();
    await urlIs(page, new RegExp(`/orders/${code}/payment$`));
    await id(page, 'pay-order-payment-pay-button').click();
    await page.waitForURL(GATE, { timeout: 15_000 });
    await page.locator('#gate-ok').click();
    await page.waitForURL((u) => u.pathname.endsWith('/payment') && u.hostname === 'localhost', { timeout: 15_000 });
    await see(id(page, 'pay-order-payment-success'));
    await relay(); // PaymentSucceeded tới ORD: đơn sang đã thanh toán
    await eventually(async () => { expect((await orderState(code))?.status).toBe('paid'); });
    expect((await paymentState(code))?.status).toBe('succeeded');
    await gateway({ refund: 'ok' });
    await withPage(env.browser, async (adminPage) => {
      await admin(adminPage);
      await adminPage.goto('/admin/dashboard');
      await hasText(id(adminPage, `${D}-kpi-revenue`), '180.000 đ');
      expect(await textOf(id(adminPage, `${D}-kpi-revenue-detail`))).toMatch(/1 giao dịch · hoàn 0 đ/);
      await hasText(id(adminPage, `${D}-kpi-orders`), '1');
      await hasText(id(adminPage, `${D}-kpi-products`), '1');
      await count(id(adminPage, `${D}-recent-orders-row`), 1);
      await hasText(id(adminPage, `${D}-recent-orders-code`), code);
      await hasText(id(adminPage, `${D}-recent-orders-total`), '180.000 đ');
      expect(await adminPage.locator(`[data-testid="${D}-recent-orders-row"]`).innerText()).not.toMatch(/Nguyễn An|a1@x\.vn|0901111111/);
      await hasText(id(adminPage, `${D}-low-stock-count`), '0');
    });
    expect(await ctl('/health')).toMatchObject({ ok: true });
  });
  e2e('DSH-E2E-20261006-110407878 (trạng thái rỗng, số âm): hệ thống chưa có dữ liệu thì mọi khối hiện 0 và vùng rỗng đúng chữ, không có cảnh báo; hoàn tiền kỳ trước lớn hơn tiền thu thì doanh thu thuần hiện dấu trừ', async (page) => {
    await admin(page);
    await page.goto('/admin/dashboard');
    await hasText(id(page, `${D}-kpi-revenue`), '0 đ');
    expect(await textOf(id(page, `${D}-kpi-revenue-detail`))).toMatch(/0 giao dịch · hoàn 0 đ/);
    await hasText(id(page, `${D}-kpi-orders`), '0');
    await hasText(id(page, `${D}-kpi-customers`), '0');
    await hasText(id(page, `${D}-kpi-products`), '0');
    await hasText(id(page, `${D}-recent-orders-empty`), 'Chưa có đơn');
    await count(id(page, `${D}-recent-orders-view-all`), 0);
    await hasText(id(page, `${D}-low-stock-empty`), 'Đủ hàng');
    await count(id(page, `${D}-low-stock-view-all`), 0);
    await count(id(page, `${D}-refund-alert`), 0);
    const old = await pay({ amount: 200_000, status: 'refunded', paid_at: ago(40), created_at: ago(40) });
    await seedRefund({ order_code: old.order_code, status: 'succeeded', reason: 'order_cancelled', created_at: ago(2) });
    await advance(61_000); // hết đệm 60 giây
    await id(page, `${D}-refresh`).click();
    await hasText(id(page, `${D}-kpi-revenue`), '-200.000 đ');
    expect(await textOf(id(page, `${D}-kpi-revenue-detail`))).toMatch(/0 giao dịch · hoàn 200\.000 đ/);
  });

  e2e('DSH-E2E-20261006-110408086 (đang tải): khối doanh thu hiện khung chờ khi nguồn chậm rồi hiện số, các khối khác không chờ nó', async (page) => {
    await pay({ amount: 350_000, paid_at: ago(1), created_at: ago(1) });
    await page.route('**/admin/dashboard/revenue*', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await admin(page);
    await page.goto('/admin/dashboard');
    await see(id(page, `${D}-kpi-revenue-loading`));
    await see(id(page, `${D}-kpi-orders`)); // khối khác đã có số khi khối doanh thu còn chờ
    await count(id(page, `${D}-kpi-revenue`), 0);
    await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ');
    await count(id(page, `${D}-kpi-revenue-loading`), 0);
  });

  e2e('DSH-E2E-20261006-110408086 (429): quá 30 yêu cầu trong một phút thì hiện dải "Thao tác quá nhanh" và giữ số cũ', async (page) => {
    await pay({ amount: 350_000, paid_at: ago(1), created_at: ago(1) });
    await admin(page);
    await alignWindow(); // cửa sổ cố định 60 giây: 31 yêu cầu nằm trọn một cửa sổ
    await page.goto('/admin/dashboard'); // 6 yêu cầu
    await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ');
    for (let i = 0; i < 4; i++) { // 4 lần làm mới x 6 = 24: tổng 30
      await id(page, `${D}-refresh`).click();
      await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ');
    }
    await count(id(page, `${D}-rate-limit`), 0);
    await id(page, `${D}-refresh`).click(); // yêu cầu thứ 31 trở đi: 429
    await see(id(page, `${D}-rate-limit`));
    expect(await textOf(id(page, `${D}-rate-limit`))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/);
    await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ'); // số cũ được giữ
    await count(id(page, `${D}-kpi-revenue-error`), 0);
  });

  // --- báo cáo theo nguồn và theo sale (đợt bán hộ): đơn hộ dựng qua cổng điều khiển (`ho`), lỗi ORD và AUTH gài qua `dshOrdFault`
  const made = new Set<string>();
  beforeEach(() => { made.clear(); });
  /** Một sale (nếu chưa có) và `n` đơn hộ của sale đó vào nguồn `source`, tạo hôm kia, trạng thái `status`. */
  async function hoOrders(n: number, o: { by?: string; name?: string; source?: string; status?: string; price?: number } = {}): Promise<void> {
    const by = o.by ?? 'sale1@x.vn';
    if (!made.has(by)) { made.add(by); await seedUser({ email: by, role: 'sale', name: o.name ?? 'Dũng' }); }
    for (let i = 0; i < n; i++) await seedOrder({ status: o.status, created_at: ago(2), shipping: 30_000, items: [{ price: o.price ?? 70_000, qty: 1 }], ho: { created_by_email: by, role: 'sale', source: o.source ?? 'hotline', customer: { full_name: 'Khách lẻ', phone: '0900000000' } } });
  }
  /** Dùng hết 29 yêu cầu còn lại của cửa sổ 60 giây (1 yêu cầu đã dành cho lần mở trang): yêu cầu kế là thứ 31. */
  const burn = (page: Page) => page.evaluate(async (u) => { for (let i = 0; i < 29; i++) await fetch(u, { credentials: 'include' }); }, `${API}/admin/dashboard/products`);

  e2e('DSH-TC-20261015-093334777 (E2E báo cáo theo nguồn): dải quá nhiều yêu cầu hiện rồi biến mất, xuất CSV khóa nút rồi mở lại và báo lỗi', async (page) => {
    await hoOrders(1);
    await admin(page);
    await alignWindow();
    await page.goto('/admin/reports/sources');
    await see(id(page, `${SO}-table`));
    await burn(page);
    await id(page, `${SO}-range-apply`).click();
    await see(id(page, `${SO}-rate-limit`));
    expect(await textOf(id(page, `${SO}-rate-limit`))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/);
    await see(id(page, `${SO}-table`)); // bảng cũ còn, không hiện 0
    await hoOrders(1, { source: 'facebook' });
    await advance(61_000); // sang cửa sổ mới, hết bộ nhớ đệm
    await id(page, `${SO}-range-apply`).click();
    await count(id(page, `${SO}-rate-limit`), 0);
    await hasText(id(page, `${SO}-total-orders`), '2');
    // xuất CSV khi ORD chậm: nút khóa kèm "Đang tạo tệp", tải xong thì mở lại
    await page.route('**/admin/reports/sources?*format=csv*', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
    const dl = page.waitForEvent('download');
    await id(page, `${SO}-export-csv`).click();
    await see(id(page, `${SO}-export-loading`));
    expect(await id(page, `${SO}-export-csv`).isDisabled()).toBe(true);
    expect((await dl).suggestedFilename()).toMatch(/^bao-cao-nguon-don_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    await count(id(page, `${SO}-export-loading`), 0);
    await eventually(async () => { expect(await id(page, `${SO}-export-csv`).isDisabled()).toBe(false); });
    await page.unroute('**/admin/reports/sources?*format=csv*');
    // API trả 503: dòng lỗi, không tải tệp rỗng, nút mở lại
    await advance(61_000);
    await dshOrdFault('hang');
    await id(page, `${SO}-export-csv`).click();
    await see(id(page, `${SO}-export-error`));
    await eventually(async () => { expect(await id(page, `${SO}-export-csv`).isDisabled()).toBe(false); });
  });

  e2e('DSH-TC-20261015-093334820 (E2E báo cáo theo sale): dải quá nhiều yêu cầu biến mất khi hết giờ, dòng website và nhãn tài khoản đã xóa', async (page) => {
    await hoOrders(2);
    await cust('khach-web@x.vn');
    await seedOrder({ email: 'khach-web@x.vn', status: 'paid', payment: 'succeeded', created_at: ago(2), shipping: 30_000, items: [{ price: 50_000, qty: 1 }] });
    await admin(page);
    await alignWindow();
    await page.goto('/admin/reports/sales');
    await see(id(page, `${SA}-table`));
    await burn(page);
    await id(page, `${SA}-range-apply`).click();
    await see(id(page, `${SA}-rate-limit`));
    expect(await textOf(id(page, `${SA}-rate-limit`))).toMatch(/^Thao tác quá nhanh, thử lại sau \d+ giây/);
    await see(id(page, `${SA}-row`)); // bảng cũ giữ nguyên
    await advance(61_000);
    await dshOrdFault('gone'); // không tra được tên người tạo: dòng vẫn đủ số đơn
    await id(page, `${SA}-range-apply`).click();
    await count(id(page, `${SA}-rate-limit`), 0);
    await hasText(id(page, `${SA}-row-deleted`), '(tài khoản đã xóa)');
    await hasText(id(page, `${SA}-row`), /2/);
    const rows = await page.locator(`[data-testid="${SA}-table"] tbody tr`).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-testid')));
    expect(rows.at(-1)).toBe(`${SA}-website-row`); // dòng website luôn là dòng cuối
    await hasText(id(page, `${SA}-website-row`), /Khách tự đặt \(website\)/);
  });

  e2e('DSH-TC-20261015-093334858 (E2E báo cáo theo nguồn): chú thích loại đơn và ghi chú giá trị đơn, 503 có Thử lại không vẽ bảng 0', async (page) => {
    await hoOrders(1);
    await hoOrders(2, { status: 'cancelled' });
    await admin(page);
    await page.goto('/admin/reports/sources');
    await see(id(page, `${SO}-table`));
    await hasText(id(page, `${SO}-excluded-note`), /hủy, hết hạn, hoàn về.*2/);
    await hasText(id(page, `${SO}-revenue-note`), /giá trị đơn.*không phải tiền đã thu/);
    await hasText(id(page, `${SO}-total-excluded`), '2');
    await dshOrdFault('hang');
    await advance(61_000);
    await id(page, `${SO}-range-apply`).click();
    await see(id(page, `${SO}-error`));
    await see(id(page, `${SO}-retry`));
    await count(id(page, `${SO}-table`), 0); // không vẽ bảng toàn 0
    await dshOrdFault('ok');
    await id(page, `${SO}-retry`).click();
    await count(id(page, `${SO}-error`), 0);
    await see(id(page, `${SO}-table`));
    await hasText(id(page, `${SO}-total-orders`), '1');
  });

  e2e('DSH-TC-20261015-093334896 (E2E báo cáo theo sale): chú thích loại đơn và ghi chú giá trị đơn, lỗi tra tên 503 có Thử lại không hiện bảng thiếu tên', async (page) => {
    await hoOrders(1);
    await hoOrders(2, { status: 'cancelled', by: 'sale2@x.vn', name: 'Hà' });
    await admin(page);
    await page.goto('/admin/reports/sales');
    await see(id(page, `${SA}-table`));
    await hasText(id(page, `${SA}-excluded-note`), /hủy, hết hạn, hoàn về.*2/);
    await hasText(id(page, `${SA}-revenue-note`), /giá trị đơn.*không phải tiền đã thu/);
    await dshOrdFault('names');
    await advance(61_000);
    await id(page, `${SA}-range-apply`).click();
    await see(id(page, `${SA}-error`));
    await see(id(page, `${SA}-retry`));
    await count(id(page, `${SA}-row`), 0); // không dòng nào thiếu tên
    await dshOrdFault('ok');
    await id(page, `${SA}-retry`).click();
    await count(id(page, `${SA}-error`), 0);
    await hasText(id(page, `${SA}-row`), /Dũng/);
  });

  e2e('DSH-E2E-20261006-110408086 (hết phiên): phiên hết hạn khi đang xem thì hộp thoại của AUTH chặn, số đang hiển thị không bị thay bằng 0', async (page) => {
    await pay({ amount: 350_000, paid_at: ago(1), created_at: ago(1) });
    await admin(page);
    await page.goto('/admin/dashboard');
    await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ');
    await advance(31 * 60_000); // 31 phút không thao tác (đồng hồ của API)
    await id(page, `${D}-refresh`).click();
    await see(id(page, 'auth-account-menu-session-expired'));
    await hasText(id(page, `${D}-kpi-revenue`), '350.000 đ');
    await id(page, 'auth-account-menu-session-expired-login').click();
    await urlIs(page, /\/login\?next=/);
  });

  // YẾU (REV-DSH-16): kịch bản đã viết nhưng `it.skip`: E2E dùng chung CSDL `ecom_e2e` và bản build `apps/web/.next` với mọi agent đang chạy song song (đợt bán hộ), chạy chồng làm hỏng cả hai bên;
  // bỏ `.skip` rồi chạy riêng một lần: `E2E_PORT_BASE=<cổng trống> pnpm test -- test/e2e/dsh.e2e.spec.ts -t "hai nút link"`.
  it.skip('REV-DSH-16 (hai nút link): bấm "Báo cáo theo nguồn đơn" và "Báo cáo theo sale" ở dashboard thì tới đúng trang, giữ khoảng ngày đang xem (?from=&to=)', () => withPage(env.browser, async (page) => {
    await admin(page);
    const from = ymd(Date.now() - 5 * DAY), to = today();
    await page.goto('/admin/dashboard');
    await setRange(page, D, from, to);
    for (const [name, table, path] of [['sources', SO, 'sources'], ['sales', SA, 'sales']] as const) {
      await page.goto('/admin/dashboard');
      await setRange(page, D, from, to);
      await urlIs(page, new RegExp(`/admin/dashboard\\?.*from=${from}`));
      await id(page, `${D}-link-${name}`).click();
      await urlIs(page, new RegExp(`/admin/reports/${path}\\?(?=.*from=${from})(?=.*to=${to})`));
      await see(id(page, `${table}-table`));
      await valueIs(id(page, `${table}-range-from`), from); // báo cáo mở đúng khoảng của dashboard
      await valueIs(id(page, `${table}-range-to`), to);
    }
  }), 180_000);
});
