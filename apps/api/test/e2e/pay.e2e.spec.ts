import type { Page } from 'playwright-core';
import { count, eventually, gateway, hasText, id, loginUi, paymentState, relay, reset, see, seedPayment, seedRefund, seedUser, sendEvent, startE2e, textOf, urlIs, withPage, type E2eEnv, API, GATE } from './support';

// E2E của PAY chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule) trên PostgreSQL thật (`ecom_e2e`), bản build production của web.
// Cổng VNPay là cổng giả do máy chủ E2E phục vụ (tự dựng theo tài liệu VNPay, CHƯA thử với sandbox thật): kiểm chữ ký đường dẫn rồi gửi IPN ĐÃ KÝ tới API thật và đưa trình duyệt về địa chỉ quay về.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);
const O = 'pay-order-payment', H = 'pay-payment-history', L = 'pay-admin-payment-list', D = 'pay-admin-payment-detail', Q = 'pay-admin-refund-queue';
const CODE = '7K3M9Q2XH4TB';
/** Ở cổng giả: chọn kết quả (ok, cancel, decline); cổng gửi IPN đã ký rồi đưa trình duyệt về màn thanh toán của đơn (bỏ qua mọi vnp_*). */
const atGate = async (page: Page, result: 'ok' | 'cancel' | 'decline'): Promise<void> => {
  await page.waitForURL(GATE, { timeout: 15_000 });
  await page.locator(`#gate-${result}`).click();
  await page.waitForURL((u) => u.pathname.endsWith('/payment') && u.hostname === 'localhost', { timeout: 15_000 });
};
const customer = async (email = 'c1@x.vn') => seedUser({ email, role: 'customer' });
const inMinutes = (n: number): string => new Date(Date.now() + n * 60_000).toISOString();

describe('E2E PAY (trình duyệt thật, API thật)', () => {
  e2e('PAY-E2E-20261006-104612099: khách thanh toán online thành công qua VNPay (cổng giả gửi IPN ký đúng, màn quay về bỏ qua vnp_*, đọc trạng thái từ API)', async (page) => {
    await customer();
    await seedPayment({ email: 'c1@x.vn', order_code: CODE, status: 'pending', expires_at: inMinutes(14) });
    await loginUi(page, 'c1@x.vn');
    await page.goto(`/orders/${CODE}/payment`);
    await hasText(id(page, `${O}-amount`), /350\.000/);
    await hasText(id(page, `${O}-status-badge`), 'Chưa thanh toán');
    await see(id(page, `${O}-countdown`));
    expect(await textOf(id(page, `${O}-countdown`))).toMatch(/Còn 1[0-4]:\d\d/); // dưới 15 phút
    await hasText(id(page, `${O}-attempts-count`), 'Lượt 0/3');
    await id(page, `${O}-pay-button`).click();
    await see(id(page, `${O}-redirecting`));
    await atGate(page, 'ok');
    expect(page.url()).toContain('vnp_ResponseCode=00'); // đường quay về mang tham số, màn không dùng chúng để đổi trạng thái
    await see(id(page, `${O}-success`));
    await hasText(id(page, `${O}-status-badge`), 'Đã thanh toán');
    await count(id(page, `${O}-pay-button`), 0);
    await count(id(page, `${O}-attempt-item`), 1);
    expect(await textOf(id(page, `${O}-attempt-item`))).toMatch(/Lượt 1.*thành công/i);
    expect((await paymentState(CODE))?.events).toEqual(['PaymentSucceeded']);
  });

  e2e('PAY-E2E-20261006-104612157: khách thất bại một lần (hủy ở cổng) rồi thử lại và thanh toán thành công; lý do là câu dễ hiểu, không có mã gốc của cổng', async (page) => {
    await customer();
    await seedPayment({ email: 'c1@x.vn', order_code: CODE, status: 'pending', expires_at: inMinutes(12) });
    await loginUi(page, 'c1@x.vn');
    await page.goto(`/orders/${CODE}/payment`);
    await id(page, `${O}-pay-button`).click();
    await atGate(page, 'cancel');
    await see(id(page, `${O}-failed`));
    expect(await textOf(id(page, `${O}-failed-reason`))).toMatch(/hủy giao dịch/i);
    expect(await textOf(id(page, `${O}-failed-reason`))).not.toMatch(/\b24\b/);
    await hasText(id(page, `${O}-attempts-count`), 'Lượt 1/3');
    await see(id(page, `${O}-retry-button`));
    await count(id(page, `${O}-pay-button`), 0);
    await id(page, `${O}-retry-button`).click();
    await see(id(page, `${O}-redirecting`));
    await atGate(page, 'ok');
    await see(id(page, `${O}-success`));
    await hasText(id(page, `${O}-attempts-count`), 'Lượt 2/3');
    await count(id(page, `${O}-attempt-item`), 2);
    const items = await id(page, `${O}-attempt-item`).allInnerTexts();
    expect(items[0]).toMatch(/Lượt 1.*(thất bại|không thành công)/i);
    expect(items[1]).toMatch(/Lượt 2.*thành công/i);
  });

  e2e('PAY-E2E-20261006-104612213: khách hết ba lượt thanh toán (ngân hàng từ chối); sau khi ORD nhận PaymentFailed lượt cuối và hủy đơn, màn báo đơn đã đóng', async (page) => {
    await customer();
    await seedPayment({ email: 'c1@x.vn', order_code: CODE, status: 'pending', expires_at: inMinutes(14) });
    await loginUi(page, 'c1@x.vn');
    await page.goto(`/orders/${CODE}/payment`);
    for (let n = 1; n <= 3; n++) {
      await id(page, n === 1 ? `${O}-pay-button` : `${O}-retry-button`).click();
      await atGate(page, 'decline');
      if (n < 3) { await see(id(page, `${O}-failed`)); expect(await textOf(id(page, `${O}-failed-reason`))).toMatch(/ngân hàng từ chối/i); }
    }
    await see(id(page, `${O}-exhausted`));
    await hasText(id(page, `${O}-attempts-count`), 'Lượt 3/3');
    await count(id(page, `${O}-retry-button`), 0);
    await relay(); // ORD nhận PaymentFailed {is_final: true}, hủy đơn; PAY nhận OrderCancelled và đóng Payment
    await page.reload();
    await see(id(page, `${O}-closed`));
    await count(id(page, `${O}-pay-button`), 0);
    await count(id(page, `${O}-retry-button`), 0);
    expect((await paymentState(CODE))?.status).toBe('cancelled');
  });

  e2e('PAY-E2E-20261006-104612262: khách hủy đơn đã thanh toán và thấy hoàn tiền ở màn thanh toán (Đã hoàn tiền, một dòng 350.000)', async (page) => {
    await customer();
    await seedPayment({ email: 'c1@x.vn', order_code: CODE, status: 'succeeded', attempt_no: 1, attempts: 'auto' });
    await loginUi(page, 'c1@x.vn');
    await page.goto(`/orders/${CODE}`);
    await id(page, 'ord-order-detail-cancel-button').click();
    await id(page, 'ord-order-detail-cancel-reason').fill('đặt nhầm');
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await see(id(page, 'ord-order-detail-cancel-success'));
    await relay(); // PAY nhận OrderCancelled, tạo hoàn tiền; cổng giả xác nhận
    await page.goto(`/orders/${CODE}/payment`);
    await hasText(id(page, `${O}-status-badge`), 'Đã hoàn tiền', 30_000);
    await count(id(page, `${O}-refund-item`), 1);
    expect(await textOf(id(page, `${O}-refund-item`))).toMatch(/350\.000.*(đã hoàn|hoàn)/i);
    expect((await paymentState(CODE))?.refunds).toMatchObject([{ status: 'succeeded', reason: 'order_cancelled', amount: 350000 }]);
  });

  e2e('PAY-E2E-20261006-104612345: khách tra cứu lịch sử thanh toán (20 dòng, tổng 25), lọc Đã hoàn tiền, mở chi tiết không có mã giao dịch của cổng, rồi lọc mã đơn không có', async (page) => {
    await customer();
    const base = Date.now();
    for (let i = 0; i < 21; i++) await seedPayment({ email: 'c1@x.vn', status: i % 3 === 0 ? 'failed' : 'pending', attempt_no: i % 3 === 0 ? 1 : 0, attempts: i % 3 === 0 ? 'auto' : undefined, created_at: new Date(base - (200 - i) * 60_000).toISOString() });
    for (let i = 0; i < 2; i++) await seedPayment({ email: 'c1@x.vn', method: 'cod', status: 'pending', created_at: new Date(base - (150 - i) * 60_000).toISOString() });
    const refunded = await seedPayment({ email: 'c1@x.vn', status: 'refunded', attempt_no: 1, attempts: 'auto', created_at: new Date(base - 100 * 60_000).toISOString() });
    await seedRefund({ order_code: refunded.order_code, status: 'succeeded', reason: 'order_cancelled' });
    await seedPayment({ email: 'c1@x.vn', method: 'cod', status: 'succeeded', order_status: 'delivered', created_at: new Date(base - 50 * 60_000).toISOString() });
    await loginUi(page, 'c1@x.vn');
    await page.goto('/payments');
    await count(id(page, `${H}-row`), 20);
    await hasText(id(page, `${H}-total`), '25');
    await id(page, `${H}-filter-status`).selectOption({ label: 'Đã hoàn tiền' });
    await id(page, `${H}-filter-apply`).click();
    await count(id(page, `${H}-row`), 1);
    await id(page, `${H}-row`).first().click();
    await see(id(page, `${H}-detail`));
    await count(id(page, `${H}-detail-refund`), 1);
    expect(await id(page, `${H}-detail`).innerText()).not.toMatch(/\b14\d{6}\b|txn_ref|provider/i); // không mã giao dịch của cổng
    await id(page, `${H}-filter-clear`).click();
    await count(id(page, `${H}-row`), 20); // chờ bộ lọc được xóa xong (địa chỉ đổi) rồi mới nhập, để ô nhập không bị đồng bộ lại về trống
    await id(page, `${H}-filter-order-code`).fill('ZZZZZZZZZZZZ');
    await id(page, `${H}-filter-apply`).click();
    await see(id(page, `${H}-no-match`));
  });

  e2e('PAY-E2E-20261006-104612407: staff ghi nhận tay thu COD (đường dự phòng): sai số tiền bị báo lỗi, đúng số tiền thì thành công; OrderDelivered tới sau không thu lần hai', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' }); await customer();
    const cod = await seedPayment({ email: 'c1@x.vn', method: 'cod', status: 'pending', order_status: 'delivered' });
    await seedPayment({ email: 'c1@x.vn', method: 'cod', status: 'pending', order_status: 'shipped' });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/payments');
    await id(page, `${L}-filter-cod-pending`).click();
    await count(id(page, `${L}-row`), 2);
    await id(page, `${L}-row`).filter({ hasText: cod.order_code }).first().click();
    await id(page, `${D}-cod-button`).click();
    await see(id(page, `${D}-cod-dialog`));
    await hasText(id(page, `${D}-cod-due`), /180\.000/);
    await id(page, `${D}-cod-amount`).fill('170000');
    await id(page, `${D}-cod-confirm`).click();
    await see(id(page, `${D}-cod-error`));
    expect(await textOf(id(page, `${D}-cod-error`))).toMatch(/180\.000/);
    await id(page, `${D}-cod-amount`).fill('180000');
    await id(page, `${D}-cod-note`).fill('phiếu GHN-778');
    await id(page, `${D}-cod-confirm`).click();
    await see(id(page, `${D}-cod-success`));
    await hasText(id(page, `${D}-status-badge`), 'Đã thanh toán');
    await count(id(page, `${D}-cod-button`), 0);
    await sendEvent('OrderDelivered', cod.order_code, { order_code: cod.order_code, delivered_at: new Date().toISOString() }); // handler OrderDelivered bỏ qua (Payment đã succeeded)
    const st = await paymentState(cod.order_code);
    expect(st?.status).toBe('succeeded');
    expect(st?.events).toEqual(['PaymentSucceeded']); // một lần
  });

  e2e('PAY-E2E-20261006-104612463: admin hoàn tiền thủ công cho đơn đã giao: cảnh báo không hoàn tác, lý do rỗng bị báo lỗi, hoàn thành công thì Đã hoàn tiền', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin' }); await customer();
    const pay = await seedPayment({ email: 'c1@x.vn', order_code: CODE, status: 'succeeded', attempt_no: 1, attempts: 'auto', order_status: 'delivered' });
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/payments');
    await id(page, `${L}-filter-order-code`).fill(pay.order_code);
    await id(page, `${L}-filter-apply`).click();
    await count(id(page, `${L}-row`), 1);
    await id(page, `${L}-row`).first().click();
    await id(page, `${D}-refund-button`).click();
    await see(id(page, `${D}-refund-dialog`));
    await see(id(page, `${D}-refund-warning`));
    await id(page, `${D}-refund-confirm`).click();
    await see(id(page, `${D}-refund-error`));
    expect(await textOf(id(page, `${D}-refund-error`))).toMatch(/5 đến 300/);
    await id(page, `${D}-refund-reason`).fill('Khách trả hàng lỗi, đã nhận lại');
    await id(page, `${D}-refund-confirm`).click();
    await see(id(page, `${D}-refund-success`));
    await hasText(id(page, `${D}-status-badge`), 'Đã hoàn tiền', 30_000);
    await count(id(page, `${D}-refund-item`), 1);
    await count(id(page, `${D}-refund-button`), 0);
    expect((await paymentState(pay.order_code))?.refunds).toMatchObject([{ status: 'succeeded', reason: 'admin_manual', amount: 350000 }]);
  });

  e2e('PAY-E2E-20261006-104612529: admin thử lại hoàn tiền thất bại từ hàng đợi: chính Refund đó thành công (không thêm dòng), hết thất bại', async (page) => {
    await seedUser({ email: 'a1@shop.vn', role: 'admin' }); await customer();
    const failed = await seedPayment({ email: 'c1@x.vn', status: 'succeeded', attempt_no: 1, attempts: 'auto' });
    await seedRefund({ order_code: failed.order_code, status: 'failed', auto_attempt_no: 3, created_at: new Date(Date.now() - 60_000).toISOString() });
    for (let i = 0; i < 2; i++) { const p = await seedPayment({ email: 'c1@x.vn', status: 'refunded', attempt_no: 1, attempts: 'auto' }); await seedRefund({ order_code: p.order_code, status: 'succeeded', created_at: new Date(Date.now() - (30 + i) * 60_000).toISOString() }); }
    await loginUi(page, 'a1@shop.vn');
    await page.goto('/admin/refunds');
    await count(id(page, `${Q}-row`), 3);
    await hasText(id(page, `${Q}-total`), '3');
    expect(await id(page, `${Q}-row`).first().innerText()).toContain(failed.order_code); // thất bại đứng đầu
    await id(page, `${Q}-refund-retry`).first().click();
    await see(id(page, `${Q}-retry-dialog`));
    await id(page, `${Q}-retry-confirm`).click();
    await see(id(page, `${Q}-retry-success`));
    await count(id(page, `${Q}-row`), 3); // không thêm dòng mới
    await eventually(async () => { expect((await paymentState(failed.order_code))?.refunds).toMatchObject([{ status: 'succeeded' }]); });
    await count(id(page, `${Q}-refund-retry`), 0);
    await id(page, `${Q}-filter-status`).selectOption({ label: 'Thất bại' });
    await id(page, `${Q}-filter-apply`).click();
    await see(id(page, `${Q}-no-failed`));
    expect((await gateway()).refund_calls).toBe(1);
  });

  e2e('PAY-E2E-20261006-104612596: staff xem hàng đợi hoàn tiền nhưng không có thao tác tiền; gọi thẳng API thử lại hoàn tiền bằng phiên staff nhận 403', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' }); await customer();
    const failed = await seedPayment({ email: 'c1@x.vn', status: 'succeeded', attempt_no: 1, attempts: 'auto' });
    const rid = (await seedRefund({ order_code: failed.order_code, status: 'failed', auto_attempt_no: 3 })).id;
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/refunds');
    await count(id(page, `${Q}-row`), 1);
    await hasText(id(page, `${Q}-row-status`), 'Thất bại');
    await id(page, `${Q}-order-link`).first().click();
    await see(id(page, `${D}-refund-item`));
    expect(await id(page, `${D}-refund-item`).first().innerText()).toMatch(/order_cancelled|Hủy đơn|hủy|Thất bại/i);
    await count(id(page, `${D}-refund-button`), 0);
    await count(id(page, `${Q}-refund-retry`), 0);
    await urlIs(page, /\/admin\/payments\/[0-9a-f-]{36}/);
    const status = await page.evaluate(async ([api, refundId]) => (await fetch(`${api}/refunds/${refundId}/retry`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-staff-retry-0001' }, body: '{}' })).status, [API, rid]); // scan-secrets:allow khóa Idempotency-Key giả của test
    expect(status).toBe(403);
    expect((await paymentState(failed.order_code))?.refunds).toMatchObject([{ id: rid, status: 'failed' }]);
  });
});
