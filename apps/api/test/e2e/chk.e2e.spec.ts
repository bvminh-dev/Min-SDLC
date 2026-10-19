import type { Locator, Page } from 'playwright-core';
import {
  advance, alignWindow, cartState, chkSessions, count, eventually, expireChkSession, expireHolds, hasText, id, loginUi, mailToken, orderState, relay, reservations, reset, see, seedAddress, seedCart, seedCategory, seedCoupon, seedProduct,
  seedShippingMethod, seedStock, seedUser, setCoupon, setProduct, setStock, startE2e, stockState, textOf, urlIs, withPage, type E2eEnv, API} from './support';

// E2E của CHK chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule: mọi module thật, không giả module nào) trên PostgreSQL thật (`ecom_e2e`), bản build production của web. Luồng THẬT từ giỏ tới đơn:
// đăng nhập bằng giao diện, giỏ/sản phẩm/kho/mã/phương thức vận chuyển/địa chỉ dựng thẳng qua cổng điều khiển (fixture), phiên checkout và đơn do API tạo. VNPay: cổng giả của PAY (`E2eGateway`), màn thanh toán của PAY chỉ được mở tới nút Thanh toán.
// Tiền tệ hiển thị "345.000 đ", giảm giá dấu trừ thật "−35.000 đ" (spec ghi "-" ASCII, giao diện CRT dùng "−"). Hạn phiên checkout và hạn giữ hàng tính theo giờ CSDL nên test lùi mốc trong CSDL (cổng điều khiển), đồng hồ trình duyệt do `page.clock`.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
let category = '';
beforeEach(async () => { await reset(); category = ''; });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 180_000);
const K = 'chk-checkout', S = `${K}-summary`;
const EMAIL = 'a1@x.vn';

const locked = async (l: Locator): Promise<boolean> => { await see(l); return (await l.first().getAttribute('aria-disabled')) === 'true' || !(await l.first().isEnabled()); };
const lockedIs = (l: Locator, want: boolean) => eventually(async () => { expect(await locked(l)).toBe(want); });
const checkedIs = (l: Locator, want: boolean) => eventually(async () => { expect(await l.first().isChecked()).toBe(want); });
const valIs = (l: Locator, expected: string) => eventually(async () => { expect(await l.first().inputValue()).toBe(expected); });
const textHas = (l: Locator, ...parts: (string | RegExp)[]) => eventually(async () => { const t = await textOf(l); for (const p of parts) { if (typeof p === 'string') expect(t).toContain(p); else expect(t).toMatch(p); } });

/** Gọi API trực tiếp từ trang đang đăng nhập (cookie phiên của trình duyệt); trả danh sách mã trạng thái. */
const fromPage = (page: Page, path: string, init: { method: string; body: unknown }, times = 1): Promise<number[]> => page.evaluate(async ({ api, p, n, i }) => {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((await fetch(`${api}${p}`, { method: i.method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(i.body) })).status);
  return out;
}, { api: API, p: path, n: times, i: init });

async function item(name: string, price: number, onHand: number): Promise<string> {
  category ||= await seedCategory('Áo');
  const p = await seedProduct({ name, category_id: category, price });
  await seedStock({ product_id: p, on_hand: onHand });
  return p;
}
interface World { email: string; p1: string; p2: string; sm1: string; addr: string }
/** Dữ liệu mồi: P1 "Áo thun cotton" 150000, P2 "Tất cổ cao" 50000, SM1 "Giao tiêu chuẩn" 30000 miễn phí từ 500000, SALE10 giảm 10% từ 200000, khách đã xác minh có địa chỉ mặc định "Nguyễn An". */
async function world(o: { stock1?: number; stock2?: number; verified?: boolean; sale?: boolean } = {}): Promise<World> {
  await seedUser({ email: EMAIL, verified: o.verified });
  const addr = (await seedAddress({ email: EMAIL, receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hồ Chí Minh', is_default: true, age_ms: 60_000 })).id;
  const p1 = await item('Áo thun cotton', 150000, o.stock1 ?? 10), p2 = await item('Tất cổ cao', 50000, o.stock2 ?? 10);
  const sm1 = (await seedShippingMethod({ name: 'Giao tiêu chuẩn', base_fee: 30000, rule: { free_over: 500000 } })).id;
  if (o.sale !== false) await seedCoupon({ code: 'SALE10', value: 10, min_order: 200000 });
  return { email: EMAIL, p1, p2, sm1, addr };
}
/** Từ trang giỏ bấm Tiến hành thanh toán (đường đi thật của khách). */
async function toCheckout(page: Page): Promise<void> {
  await page.goto('/cart');
  await id(page, 'crt-cart-summary-checkout-link').click();
  await urlIs(page, /\/checkout(\?|$)/);
}
const option = (page: Page, testid: string, text: string): Locator => page.locator('label', { hasText: text }).getByTestId(testid);
/** Chọn một radio nếu chưa chọn (phiên dùng lại giữ lựa chọn cũ), rồi chờ máy chủ xác nhận. */
async function choose(l: Locator): Promise<void> {
  await see(l);
  if (!(await l.first().isChecked())) await l.first().click();
  await checkedIs(l, true);
}
const chooseShipping = (page: Page) => choose(option(page, `${K}-shipping-option`, 'Giao tiêu chuẩn'));
const chooseCod = (page: Page) => choose(id(page, `${K}-payment-cod`));
/** Phiên checkout đầy đủ: địa chỉ mặc định (điền sẵn), vận chuyển SM1, COD; nút Đặt hàng bật. */
async function fullCod(page: Page): Promise<void> {
  await see(id(page, `${K}-address-section`));
  await chooseShipping(page);
  await chooseCod(page);
  await lockedIs(id(page, `${K}-place-order`), false);
}
const orderCodeOf = async (page: Page): Promise<string> => { const c = await textOf(id(page, `${K}-complete-order-code`)); expect(c).toMatch(/^HD[0-9]{6}-[0-9]{5}$/); return c; }; // mã đơn do ORD cấp theo khuôn HDyymmdd-NNNNN (ORD-REQ-20261015-092748640, ADR-024); CHK chỉ chuyển tiếp

describe('E2E CHK (trình duyệt thật, API thật)', () => {
  e2e('CHK-E2E-20261006-110743989: Customer đặt đơn COD đầy đủ từ giỏ, có mã giảm giá', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }, { product_id: w.p2, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await see(id(page, `${K}-address-section`));
    await checkedIs(option(page, `${K}-address-option`, 'Nguyễn An'), true);
    await hasText(id(page, `${S}-total`), '350.000 đ');
    await see(id(page, `${S}-total-estimate`));
    await lockedIs(id(page, `${K}-place-order`), true);
    await textHas(id(page, `${K}-blockers`), /vận chuyển/, /thanh toán/);
    await chooseShipping(page);
    await chooseCod(page);
    await hasText(id(page, `${S}-shipping-fee`), '30.000 đ');
    await textHas(id(page, `${K}-payment-note`), /xác nhận ngay/i, /không có hạn chờ/);
    await hasText(id(page, `${S}-total`), '380.000 đ');
    await id(page, `${K}-coupon-input`).fill(' sale10 ');
    await id(page, `${K}-coupon-apply`).click();
    await textHas(id(page, `${K}-coupon-applied`), 'SALE10', '−35.000 đ');
    await hasText(id(page, `${S}-discount`), '−35.000 đ');
    await hasText(id(page, `${S}-total`), '345.000 đ');
    await lockedIs(id(page, `${K}-place-order`), false);
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-cod`));
    const code = await orderCodeOf(page);
    await hasText(id(page, `${K}-complete-total`), '345.000 đ');
    await count(id(page, `${K}-complete-deadline`), 0);
    await count(id(page, `${K}-complete-online`), 0);
    await id(page, `${K}-complete-view-order`).click();
    await urlIs(page, new RegExp(`/orders/${code}$`));
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã xác nhận');
    await hasText(id(page, 'ord-order-detail-code'), code);
    const s = (await chkSessions(w.email))[0];
    expect(s).toMatchObject({ status: 'completed', order_code: code, payment_method: 'cod', coupon_code: 'SALE10' });
    await relay(); // CheckoutCompleted tới CRT: giỏ chuyển khỏi trạng thái hoạt động
    await page.goto('/cart');
    await see(id(page, 'crt-cart-empty'));
  });

  e2e('CHK-E2E-20261006-110744027: Customer đặt đơn VNPay, thấy hạn giữ hàng và sang màn thanh toán', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await see(id(page, `${K}-address-section`));
    await chooseShipping(page);
    await choose(id(page, `${K}-payment-vnpay`));
    await textHas(id(page, `${K}-payment-note`), /15 phút/);
    await hasText(id(page, `${S}-total`), '180.000 đ');
    await lockedIs(id(page, `${K}-place-order`), false);
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-online`));
    const code = await orderCodeOf(page);
    await textHas(id(page, `${K}-complete-deadline`), /^Hàng được giữ tới [0-9]{2}:[0-9]{2} \(còn 1[45]:[0-9]{2}\)$/);
    await textHas(id(page, `${K}-complete-expiry-warning`), /tự hết hạn/);
    await count(id(page, `${K}-complete-cod`), 0);
    await relay(); // PAY nhận OrderCreated và tạo Payment
    await id(page, `${K}-complete-pay-now`).click();
    await urlIs(page, new RegExp(`/orders/${code}/payment$`));
    await textHas(id(page, 'pay-order-payment-amount'), /180\.000/);
    await see(id(page, 'pay-order-payment-countdown'));
    await lockedIs(id(page, 'pay-order-payment-pay-button'), false);
    expect((await reservations(code)).map((r) => r.status)).toEqual(['held']);
  });

  e2e('CHK-E2E-20261006-110744065: Giá đổi lúc đang ở checkout: xác nhận giá mới rồi mới đặt được', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }, { product_id: w.p2, quantity: 1 }], coupon: 'SALE10', method_id: w.sm1, city: 'Hồ Chí Minh' });
    await loginUi(page, w.email);
    await page.goto('/checkout');
    await see(id(page, `${K}-address-section`));
    await chooseCod(page);
    await hasText(id(page, `${S}-total`), '345.000 đ');
    await setProduct({ id: w.p1, price: 160000 }); // admin tăng giá P1
    await id(page, `${K}-place-order`).click();
    await textHas(id(page, `${K}-price-changed`), '345.000 đ', '363.000 đ');
    expect(page.url()).toMatch(/\/checkout(\?|$)/);
    await hasText(id(page, `${S}-total`), '363.000 đ');
    expect((await chkSessions(w.email))[0].status).toBe('open'); // chưa có đơn nào
    await lockedIs(id(page, `${K}-price-changed-confirm`), false);
    await id(page, `${K}-price-changed-confirm`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-cod`));
    await hasText(id(page, `${K}-complete-total`), '363.000 đ');
  });

  e2e('CHK-E2E-20261006-110744101: Hết hàng khi đặt: báo mặt hàng thiếu, về giỏ chỉnh số lượng rồi đặt lại', async (page) => {
    const w = await world({ stock2: 5 });
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }, { product_id: w.p2, quantity: 3 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    await setStock({ product_id: w.p2, on_hand: 2 }); // khách khác mua P2 còn 2
    await id(page, `${K}-place-order`).click();
    await see(id(page, `${K}-stock-error`));
    await count(id(page, `${K}-stock-error-item`), 1);
    await hasText(id(page, `${K}-stock-error-item`), 'Tất cổ cao: cần 3, còn 2');
    expect(await textOf(id(page, `${K}-stock-error`))).not.toContain('Áo thun cotton');
    await count(id(page, `${K}-place-error`), 0);
    expect(page.url()).toMatch(/\/checkout(\?|$)/);
    expect(await stockState(w.p1)).toMatchObject({ on_hand: 10, reserved: 0 }); // không có gì bị giữ hay trừ
    await id(page, `${K}-stock-error-back`).click();
    await urlIs(page, /\/cart$/);
    await count(id(page, 'crt-cart-line'), 2);
    const p2line = page.locator('[data-testid="crt-cart-line"]', { hasText: 'Tất cổ cao' });
    await p2line.getByTestId('crt-cart-line-quantity-decrease').click();
    await valIs(p2line.getByTestId('crt-cart-line-quantity'), '2');
    await id(page, 'crt-cart-summary-checkout-link').click();
    await urlIs(page, /\/checkout(\?|$)/);
    await fullCod(page);
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-cod`));
  });

  e2e('CHK-E2E-20261006-110744136: Địa chỉ bị sửa trong lúc checkout: phải xác nhận địa chỉ mới', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    await textHas(id(page, `${K}-address-section`), '0901111111');
    const other = await page.context().newPage(); // tab khác: A sửa số điện thoại qua màn địa chỉ của USR
    await other.goto(`/account/addresses/edit?id=${w.addr}`);
    await id(other, 'usr-address-form-phone').fill('0902222222');
    await id(other, 'usr-address-form-submit').click();
    await urlIs(other, /\/account\/addresses(\?|$)/);
    await other.close();
    await id(page, `${K}-place-order`).click();
    await textHas(id(page, `${K}-address-changed`), '0902222222');
    expect(page.url()).toMatch(/\/checkout(\?|$)/);
    await count(id(page, `${K}-complete-cod`), 0);
    await lockedIs(id(page, `${K}-place-order`), true); // phải xác nhận địa chỉ mới trước
    await id(page, `${K}-address-confirm`).click();
    await count(id(page, `${K}-address-changed`), 0);
    await lockedIs(id(page, `${K}-place-order`), false);
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-cod`));
    await id(page, `${K}-complete-view-order`).click();
    await textHas(id(page, 'ord-order-detail-address'), '0902222222');
  });

  e2e('CHK-E2E-20261006-110744171: Tài khoản chưa xác minh email bị chặn, xác minh xong thì vào được checkout', async (page) => {
    const w = await world({ verified: false });
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await see(id(page, `${K}-blocked-email-not-verified`));
    await count(id(page, `${K}-place-order`), 0);
    await id(page, `${K}-blocked-resend-verification`).click();
    await textHas(id(page, `${K}-blocked-email-not-verified`), /Đã gửi lại email xác minh/);
    const token = await mailToken(w.email, 'EmailVerificationRequested');
    await page.goto(`/verify-email#token=${encodeURIComponent(token)}`); // B mở liên kết trong email
    await see(id(page, 'auth-verify-email-success'));
    await page.goto('/cart');
    await id(page, 'crt-cart-summary-checkout-link').click();
    await see(id(page, `${K}-address-section`));
    await count(id(page, `${K}-blocked-email-not-verified`), 0);
  });

  e2e('CHK-E2E-20261006-110744206: Phiên checkout hết hạn: bắt đầu lại, giỏ còn nguyên', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }, { product_id: w.p2, quantity: 2 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    await see(id(page, `${K}-session-timer`));
    const first = (await chkSessions(w.email))[0].id;
    await expireChkSession(w.email, 1); // hạn phiên tính theo giờ CSDL: lùi mốc trong CSDL (tương đương tiến đồng hồ 31 phút)
    await id(page, `${K}-place-order`).click();
    await see(id(page, `${K}-blocked-session-expired`));
    await textHas(id(page, `${K}-blocked-session-expired`), /giỏ hàng của bạn vẫn còn/);
    expect(await chkSessions(w.email)).toMatchObject([{ id: first, status: 'expired', order_id: null }]);
    expect((await cartState(w.email))?.items).toHaveLength(2);
    await id(page, `${K}-blocked-restart`).click();
    await count(id(page, `${K}-line`), 2);
    await textHas(id(page, `${K}-session-timer`), /^Phiên còn (29:[5-9]\d|30:00)$/);
    const sessions = await chkSessions(w.email);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ status: 'open', fresh: true });
    expect(sessions[0].id).not.toBe(first);
  });

  e2e('CHK-E2E-20261006-110744206 (bộ đếm): bộ đếm phiên đổi màu dưới 5 phút và về 0 thì tự chuyển sang màn hết hạn, không giữ mãi', async (page) => {
    await page.clock.install();
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }] });
    await loginUi(page, w.email);
    await page.goto('/checkout');
    await see(id(page, `${K}-address-section`));
    expect(await id(page, `${K}-session-timer`).getAttribute('data-warn')).toBe('false');
    await page.clock.fastForward(26 * 60_000); // còn khoảng 4 phút
    await eventually(async () => expect(await id(page, `${K}-session-timer`).getAttribute('data-warn')).toBe('true'));
    await expireChkSession(w.email, 1);
    await page.clock.fastForward(5 * 60_000); // đồng hồ về 0: giao diện đọc lại, máy chủ báo phiên đã hết hạn
    await see(id(page, `${K}-blocked-session-expired`));
    await count(id(page, `${K}-place-order`), 0);
  });

  e2e('CHK-E2E-20261006-110744240: Mã giảm giá bị tắt lúc đặt: gỡ mã rồi đặt với tổng mới', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }, { product_id: w.p2, quantity: 1 }], coupon: 'SALE10', method_id: w.sm1, city: 'Hồ Chí Minh' });
    await loginUi(page, w.email);
    await page.goto('/checkout');
    await see(id(page, `${K}-address-section`));
    await chooseCod(page);
    await hasText(id(page, `${S}-total`), '345.000 đ');
    await lockedIs(id(page, `${K}-place-order`), false);
    await setCoupon('SALE10', 'disabled'); // admin tắt SALE10
    await id(page, `${K}-place-order`).click();
    await see(id(page, `${K}-coupon-invalid`));
    await textHas(id(page, `${K}-coupon-invalid`), 'SALE10');
    expect(page.url()).toMatch(/\/checkout(\?|$)/);
    await lockedIs(id(page, `${K}-place-order`), true);
    await id(page, `${K}-coupon-remove`).click();
    await hasText(id(page, `${S}-discount`), '0 đ');
    await hasText(id(page, `${S}-total`), '380.000 đ');
    await lockedIs(id(page, `${K}-place-order`), false);
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-cod`));
    await hasText(id(page, `${K}-complete-total`), '380.000 đ');
  });

  e2e('CHK-E2E-20261006-110744274: Đặt đơn COD rồi hủy trước khi giao', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    const before = await stockState(w.p1);
    expect(before).toMatchObject({ on_hand: 10, reserved: 0 });
    await id(page, `${K}-place-order`).click();
    await see(id(page, `${K}-complete-cod`));
    const code = await orderCodeOf(page);
    expect((await reservations(code)).map((r) => r.status)).toEqual(['held']);
    await id(page, `${K}-complete-view-order`).click();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã xác nhận');
    await id(page, 'ord-order-detail-cancel-button').click();
    await id(page, 'ord-order-detail-cancel-confirm').click();
    await see(id(page, 'ord-order-detail-cancel-success'));
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Đã hủy');
    await relay(); // OrderCancelled tới INV: giữ hàng được trả
    await eventually(async () => {
      expect((await reservations(code)).map((r) => r.status)).toEqual(['released']);
      expect(await stockState(w.p1)).toMatchObject({ on_hand: before!.on_hand, reserved: before!.reserved });
    });
    expect((await orderState(code))?.status).toBe('cancelled');
  });

  e2e('CHK-E2E-20261006-110743989 (mở lại): mở lại phiên đã đặt bằng nút quay lại hiện thẻ kết quả của đơn đã tạo, không tạo đơn thứ hai', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    await id(page, `${K}-place-order`).click();
    await see(id(page, `${K}-complete-cod`));
    const code = await orderCodeOf(page);
    await count(id(page, `${K}-complete-replayed`), 0);
    await page.goBack(); // địa chỉ /checkout?session=... của phiên đã `completed`
    await see(id(page, `${K}-complete-replayed`));
    await see(id(page, `${K}-complete-cod`));
    expect(await orderCodeOf(page)).toBe(code);
    expect((await chkSessions(w.email)).filter((s) => s.status === 'completed')).toHaveLength(1);
  });

  e2e('CHK-E2E-20261006-110744171 (các lý do chặn khác): giỏ trống và hàng ngừng bán chặn ở màn checkout, mỗi lần một lý do kèm lối đi tiếp', async (page) => {
    const w = await world();
    await loginUi(page, w.email);
    await page.goto('/checkout'); // chưa có giỏ
    await see(id(page, `${K}-blocked-cart-empty`));
    await see(id(page, `${K}-blocked-continue-shopping`));
    await count(id(page, `${K}-place-order`), 0);
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }, { product_id: w.p2, quantity: 1, reason: 'product_archived' }] });
    await setProduct({ id: w.p2, status: 'archived' });
    await page.goto('/checkout');
    await see(id(page, `${K}-blocked-unavailable-items`));
    await count(id(page, `${K}-blocked-unavailable-item`), 1);
    await hasText(id(page, `${K}-blocked-unavailable-item`), 'Tất cổ cao');
    await id(page, `${K}-blocked-back-to-cart`).click();
    await urlIs(page, /\/cart$/);
    expect(await chkSessions(w.email)).toEqual([]); // không phiên nào được tạo
  });

  e2e('CHK-TC-20261007-085336884: Mở checkout quá 10 lần mỗi phút hiện thông báo thử lại sau N giây rồi mở lại được khi hết giờ chờ', async (page) => {
    await page.clock.install(); // đồng hồ trình duyệt do test điều khiển; đồng hồ API do cổng điều khiển tua
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }] });
    await loginUi(page, w.email);
    await page.goto('/cart');
    await see(id(page, 'crt-cart-summary-checkout-link'));
    await alignWindow(); // mười lần tạo phiên nằm trọn một cửa sổ 60 giây
    expect(await fromPage(page, '/checkout/sessions', { method: 'POST', body: {} }, 10)).toEqual([201, 200, 200, 200, 200, 200, 200, 200, 200, 200]);
    await page.goto('/checkout'); // lần thứ 11 trong phút
    const secs = async (): Promise<number> => { const m = (await textOf(id(page, `${K}-blocked-rate-limited`))).match(/thử lại sau (\d+) giây/); expect(m).toBeTruthy(); return Number(m![1]); };
    expect(await secs()).toBeGreaterThan(0);
    await count(id(page, `${K}-address-section`), 0);
    expect(await chkSessions(w.email)).toHaveLength(1); // không có phiên mới
    await page.reload(); // chưa hết giờ chờ: tải lại vẫn bị chặn (máy chủ là nơi chặn)
    const n = await secs();
    expect(n).toBeGreaterThan(0);
    await advance((n + 5) * 1000); // API: sang cửa sổ mới
    await page.clock.fastForward((n + 3) * 1000); // trình duyệt: hết Retry-After, thông báo tự mất và màn mở lại
    await count(id(page, `${K}-blocked-rate-limited`), 0);
    await see(id(page, `${K}-address-section`));
    await see(id(page, `${K}-session-timer`));
    const sessions = await chkSessions(w.email);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('open'); // trả lại đúng phiên `open` cũ
    await page.reload(); // tải lại sau khi hết giờ chờ: thông báo không dính lại
    await see(id(page, `${K}-address-section`));
    await count(id(page, `${K}-blocked-rate-limited`), 0);
  });

  e2e('CHK-TC-20261007-085336918: Đơn VNPay chờ thanh toán: đếm ngược tới hạn giữ hàng rồi cảnh báo quá hạn và nút Thanh toán ngay không còn', async (page) => {
    await page.clock.install();
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await see(id(page, `${K}-address-section`));
    await chooseShipping(page);
    await choose(id(page, `${K}-payment-vnpay`));
    await lockedIs(id(page, `${K}-place-order`), false);
    await id(page, `${K}-place-order`).click();
    await see(id(page, `${K}-complete-online`));
    const code = await orderCodeOf(page);
    await textHas(id(page, `${K}-complete-deadline`), /\(còn 1[45]:\d\d\)$/);
    await see(id(page, `${K}-complete-pay-now`));
    await page.clock.fastForward(15 * 60_000 + 5000); // đồng hồ trình duyệt tới `payment_deadline`
    await count(id(page, `${K}-complete-pay-now`), 0);
    await count(id(page, `${K}-complete-online`), 0);
    await count(id(page, `${K}-complete-deadline`), 0);
    await textHas(id(page, `${K}-complete-expiry-warning`), /quá hạn/);
    expect((await orderState(code))?.status).toBe('pending'); // job của INV chưa chạy: đơn chưa `expired`
    const r = await expireHolds(); // job hết hạn của INV với mốc giờ 16 phút sau, rồi ORD nhận event
    expect(r.orders).toBe(1);
    await eventually(async () => expect((await orderState(code))?.status).toBe('expired'));
    await page.goto(`/checkout/complete?code=${code}`); // mở lại màn: không còn hạn trên địa chỉ, đơn đã `expired`
    await textHas(id(page, `${K}-complete-expiry-warning`), /hết hạn/);
    await count(id(page, `${K}-complete-pay-now`), 0);
    await count(id(page, `${K}-complete-online`), 0);
    await id(page, `${K}-complete-view-order`).click();
    await hasText(id(page, 'ord-order-detail-status-badge'), 'Hết hạn');
    expect((await reservations(code)).map((x) => x.status)).toEqual(['expired']);
  });

  e2e('CHK-TC-20261007-085336951: Thử mã giảm giá quá nhiều ở checkout hiện thử lại sau N giây, nút Áp dụng mở lại khi hết giờ chờ', async (page) => {
    await page.clock.install();
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }] });
    await loginUi(page, w.email);
    await page.goto('/checkout');
    await see(id(page, `${K}-coupon-input`));
    const sid = (await chkSessions(w.email))[0].id;
    await alignWindow(600); // mười lần sai nằm trọn một cửa sổ 10 phút của PRM, chia hai cửa sổ 60 giây của giới hạn CHK (10 lần mỗi phút)
    const wrong = (n: number) => fromPage(page, `/checkout/sessions/${sid}/coupon`, { method: 'PUT', body: { code: `NOPE${n}XYZ` } });
    for (let i = 0; i < 5; i++) expect(await wrong(i)).toEqual([404]);
    await advance(61_000);
    for (let i = 5; i < 10; i++) expect(await wrong(i)).toEqual([404]);
    await id(page, `${K}-coupon-input`).fill('SALE10');
    await id(page, `${K}-coupon-apply`).click();
    let n = 0;
    await eventually(async () => { const m = (await textOf(id(page, `${K}-coupon-retry-after`))).match(/^Thử lại sau (\d+) giây$/); expect(m).toBeTruthy(); n = Number(m![1]); });
    expect(n).toBeGreaterThan(0);
    await lockedIs(id(page, `${K}-coupon-apply`), true);
    await count(id(page, `${K}-coupon-applied`), 0);
    expect((await chkSessions(w.email))[0].coupon_code).toBeNull();
    await advance((n + 5) * 1000); // API: sang cửa sổ mới
    await page.clock.fastForward((n + 3) * 1000); // trình duyệt: hết giờ chờ
    await count(id(page, `${K}-coupon-retry-after`), 0);
    await lockedIs(id(page, `${K}-coupon-apply`), false);
    await id(page, `${K}-coupon-apply`).click();
    await textHas(id(page, `${K}-coupon-applied`), 'SALE10', '−30.000 đ');
    expect((await chkSessions(w.email))[0].coupon_code).toBe('SALE10');
  });
  e2e('CHK-E2E-20261006-110743989 (REV-CHK-40: mạng đứt sau khi máy chủ đã tạo đơn): giao diện tự gửi lại MỘT lần cùng Idempotency-Key, máy chủ phát lại (replayed): đúng một đơn, khách tới trang kết quả', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }, { product_id: w.p2, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    const keys: (string | undefined)[] = [];
    await page.route('**/place-order', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) { await route.fetch(); await route.abort('failed'); return; } // máy chủ đã cam kết đơn, trình duyệt không nhận được phản hồi
      await route.continue();
    });
    await id(page, `${K}-place-order`).click();
    await urlIs(page, /\/checkout\/complete\?/);
    await see(id(page, `${K}-complete-replayed`));
    const code = await orderCodeOf(page);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]); // lần tự gửi lại giữ nguyên khóa
    expect((await chkSessions(w.email)).map((x) => [x.status, x.order_code])).toEqual([['completed', code]]);
    expect((await reservations(code)).map((r) => r.status).sort()).toEqual(['held', 'held']); // hai dòng hàng của MỘT đơn, không giữ hàng lần hai
  });

  e2e('CHK-E2E-20261006-110743989 (REV-CHK-41: bấm đôi nút Đặt hàng): chỉ một yêu cầu place-order rời trình duyệt, đúng một đơn', async (page) => {
    const w = await world();
    await seedCart({ email: w.email, lines: [{ product_id: w.p1, quantity: 2 }, { product_id: w.p2, quantity: 1 }] });
    await loginUi(page, w.email);
    await toCheckout(page);
    await fullCod(page);
    let sent = 0;
    await page.route('**/place-order', async (route) => { sent++; await route.continue(); });
    await id(page, `${K}-place-order`).dblclick();
    await urlIs(page, /\/checkout\/complete\?/);
    const code = await orderCodeOf(page);
    expect(sent).toBe(1);
    expect((await reservations(code)).map((r) => r.status).sort()).toEqual(['held', 'held']);
  });
});
