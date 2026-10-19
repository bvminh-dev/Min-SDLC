import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { waitFor } from '../support/boot';
import { API_DIR, REPO_ROOT } from '../support/db';
import { currentPorts } from '../support/e2e-ports';

// E2E dùng Jest (công cụ test duy nhất, PRJ-REQ-20261006-095422475 BR7) và `playwright-core` chỉ làm thư viện điều khiển trình duyệt.
// Bốn cổng liên tiếp riêng (không đụng `pnpm dev`) từ cơ sở `E2E_PORT_BASE` (mặc định 3100; global-setup chốt cơ sở rỗi khi 3100 bị dự án khác giữ, xem support/e2e-ports.ts):
// web = cơ sở, API = +1, cổng điều khiển của máy chủ E2E (test/e2e/server.ts) = +2, S3 giả = +3.
export const { web: WEB_PORT, api: API_PORT, ctl: CTL_PORT, s3: S3_PORT } = currentPorts();
export const WEB = `http://localhost:${WEB_PORT}`;
export const API = `http://localhost:${API_PORT}/api/v1`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const GATE = new RegExp(`127\\.0\\.0\\.1:${CTL_PORT}/vnpay/pay`);
const WEB_DIR = resolve(REPO_ROOT, 'apps/web');
const NEXT = resolve(WEB_DIR, 'node_modules/next/dist/bin/next');
export const PASSWORD = 'Correct-Horse-9';
export const VNPAY_SECRET = 'test-e2e-vnpay-secret-0123456789abcdef'; // khóa giả của máy chủ E2E (dev); tiền tố `test` nên máy quét bí mật bỏ qua

export interface E2eEnv { browser: Browser; stop: () => Promise<void> }

/** Dựng API thật (CSDL `ecom_e2e` dựng lại từ migration), bản build production của web, và trình duyệt Chromium. */
export async function startE2e(): Promise<E2eEnv> {
  const procs: ChildProcess[] = [];
  const keep = (c: ChildProcess) => { procs.push(c); return c; };
  const pipe = (c: ChildProcess, log: string[]) => { c.stdout?.on('data', (d) => log.push(String(d))); c.stderr?.on('data', (d) => log.push(String(d))); };
  const apiLog: string[] = [], webLog: string[] = [];
  const up = async (url: string) => { try { return (await fetch(url)).status < 500; } catch { return false; } };
  // review USR: lần chạy trước đỏ hay bị ngắt có thể để lại máy chủ API/web mồ côi giữ cổng; lần sau nói chuyện với mã cũ (xanh giả). Dừng ngay, không tái dùng.
  if ((await up(`http://127.0.0.1:${CTL_PORT}/health`)) || (await up(WEB))) throw new Error(`cổng E2E ${WEB_PORT} đến ${S3_PORT} đang bị tiến trình giữ (E2E cũ bị ngắt? hay dự án khác?): dừng tiến trình E2E cũ (lsof -i :${WEB_PORT}) hoặc đặt E2E_PORT_BASE sang cơ sở khác còn trống rồi chạy lại`);
  try {
    return await boot();
  } catch (e) { // lỗi bất kỳ khi dựng (build web hỏng, API không lên, trình duyệt không mở): không để tiến trình con mồ côi
    procs.forEach((p) => p.kill('SIGKILL'));
    throw e;
  }

  async function boot(): Promise<E2eEnv> {
    const api = keep(spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/e2e/server.ts'], {
      cwd: API_DIR,
      env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: 'postgresql://ecom:ecom@localhost:5433/ecom_e2e', CORS_ALLOWED_ORIGINS: WEB, E2E_APP_BASE_URL: WEB, E2E_API_PORT: String(API_PORT), E2E_CTL_PORT: String(CTL_PORT), E2E_S3_PORT: String(S3_PORT), VNPAY_TMN_CODE: 'E2ETMN01', DASHBOARD_SOURCE_TIMEOUT_MS: '500', VNPAY_HASH_SECRET: VNPAY_SECRET, VNPAY_PAY_URL: `http://127.0.0.1:${CTL_PORT}/vnpay/pay`, VNPAY_RETURN_URL: `${WEB}/orders/{order_code}/payment`, ...(process.env.TEST_DB_BASE ? { TEST_DB_BASE: process.env.TEST_DB_BASE } : {}), ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('STORAGE_TEST_') && v !== undefined)) },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    pipe(api, apiLog);

    const webEnv = { PATH: process.env.PATH ?? '', NEXT_PUBLIC_API_BASE_URL: `http://localhost:${API_PORT}/api/v1`, NEXT_TELEMETRY_DISABLED: '1' };
    execFileSync(process.execPath, ['scripts/check-public-env.mjs'], { cwd: WEB_DIR, env: webEnv });
    execFileSync(process.execPath, [NEXT, 'build'], { cwd: WEB_DIR, env: webEnv, stdio: 'pipe' });
    const web = keep(spawn(process.execPath, [NEXT, 'start', '-p', String(WEB_PORT)], { cwd: WEB_DIR, env: webEnv, stdio: ['ignore', 'pipe', 'pipe'] }));
    pipe(web, webLog);

    const ready = await waitFor(async () => (await up(`http://127.0.0.1:${CTL_PORT}/health`)) && (await up(WEB)), 120_000, 300);
    if (!ready) { procs.forEach((p) => p.kill('SIGKILL')); throw new Error(`máy chủ E2E không lên:\nAPI:\n${apiLog.join('').slice(-1500)}\nWEB:\n${webLog.join('').slice(-1500)}`); }
    const browser = await chromium.launch();
    return { browser, stop: async () => { await browser.close(); procs.forEach((p) => p.kill('SIGKILL')); } };
  }
}

// Cổng điều khiển (chỉ ở môi trường test): dữ liệu mồi, hộp thư giả thay NTF, tua đồng hồ của API.
const CTL = `http://127.0.0.1:${CTL_PORT}`;
export const ctl = async (path: string, body?: unknown): Promise<any> => {
  const r = await fetch(`${CTL}${path}`, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  return r.status === 404 ? null : r.json();
};
export const reset = () => ctl('/reset', {});
export const seedUser = (u: { email: string; password?: string; role?: 'customer' | 'staff' | 'sale' | 'admin'; verified?: boolean; name?: string; createdAt?: string; phone?: string; avatar?: boolean }) => ctl('/seed-user', u);
export const seedAddress = (a: { email: string; receiver?: string; phone?: string; line1?: string; ward?: string; district?: string | null; city?: string; is_default?: boolean; age_ms?: number }) => ctl('/seed-address', a);
export const s3Keys = async (prefix = 'avatars/'): Promise<string[]> => (await ctl(`/s3-objects?prefix=${encodeURIComponent(prefix)}`)).keys;
export const seedCategory = async (name: string, parent_id?: string): Promise<string> => (await ctl('/seed-category', { name, parent_id })).id;
export const seedProduct = async (p: { name: string; category_id: string; sku?: string; price?: number; cost_price?: number | null; status?: 'draft' | 'active' | 'archived'; images?: number; rating_count?: number; rating_sum?: number; description?: string; age_ms?: number }): Promise<string> => (await ctl('/seed-product', p)).id;
export const productState = (id: string): Promise<{ status: string; version: number; price: number; cost_price: number | null; name: string; sku: string; images: number } | null> => ctl(`/product?id=${id}`);
export const advance = (ms: number) => ctl('/advance', { ms });
/** `seconds`: độ dài cửa sổ cố định cần căn (mặc định 60; bộ đếm thử sai mã của PRM là 600). */
export const alignWindow = (seconds = 60) => ctl('/align-window', { seconds });
export const seedStock = (s: { product_id: string; on_hand?: number; reserved?: number; threshold?: number; archived?: boolean; version?: number; notified?: boolean }): Promise<{ id: string }> => ctl('/seed-stock', s);
export const stockState = (product_id: string): Promise<{ on_hand: number; reserved: number; version: number; threshold: number } | null> => ctl(`/stock?product_id=${product_id}`);
export const seedCoupon = (c: { code: string; type?: 'percentage' | 'fixed'; value?: number; min_order?: number; max_discount?: number | null; expires_in_sec?: number; usage_limit?: number; per_user_limit?: number | null; consumed?: number; reserved?: number; status?: 'active' | 'disabled' | 'expired' | 'exhausted' | 'deleted'; version?: number; age_sec?: number }): Promise<{ id: string }> => ctl('/seed-coupon', c);
export const couponState = (code: string): Promise<{ id: string; code: string; status: string; type: string; value: number; min_order_value: number; max_discount: number | null; usage_limit: number; per_user_limit: number | null; consumed_count: number; reserved_count: number; version: number } | null> => ctl(`/coupon?code=${encodeURIComponent(code)}`);
export const seedMovement = (m: { product_id: string; type: 'in' | 'out' | 'adjust' | 'sale' | 'restock' | 'return'; quantity: number; on_hand_after: number; reason?: string; human?: boolean; minutes_ago?: number }) => ctl('/seed-movement', m);
export const seedOrder = (o: { email?: string; code?: string; status?: string; method?: 'vnpay' | 'cod'; payment?: string; created_at?: string; items?: { name?: string; price?: number; qty?: number }[]; discount?: number; shipping?: number; paid_at?: string; tracking?: string | null; handoff?: string; expires_at?: string; delivered_at?: string; address?: Record<string, string>; cancel?: { reason: string; by: string; text?: string };
  /** Đơn hộ: người tạo theo email (sale hay admin), nguồn theo mã, bản chụp khách, ghi chú đơn, ghi chú và giá vốn từng dòng; `email` vắng nếu khách không có tài khoản. */
  ho?: { created_by_email: string; role?: 'sale' | 'admin'; source: string; customer: { full_name: string; phone: string }; note?: string | null; item_notes?: (string | null)[]; costs?: (number | null)[] } }): Promise<{ id: string; code: string }> => ctl('/seed-order', o);
/** ORD: bật hoặc tắt một nguồn đơn theo mã (cổng điều khiển, thay cho thao tác của admin). */
export const setOrderSource = (code: string, is_active: boolean): Promise<{ ok: boolean }> => ctl('/set-order-source', { code, is_active });
export const orderState = (code: string): Promise<{ id: string; status: string; payment_status: string; tracking_number: string | null; history: number } | null> => ctl(`/order?code=${code}`);
export const seedShippingMethod = (m: { name?: string; base_fee?: number; rule?: { free_over?: number | null; surcharge?: number; surcharge_cities?: string[] }; active?: boolean; version?: number; age_sec?: number } = {}): Promise<{ id: string }> => ctl('/seed-shipping-method', m);
/** Vận đơn dựng thẳng của đơn (theo mã đơn) kèm lịch sử đúng đường đi tới `status`; chưa có phương thức thì tự tạo một phương thức mặc định. */
export const seedShipment = (s: { order_code: string; status?: 'pending' | 'shipped' | 'delivered' | 'failed' | 'returned' | 'cancelled'; tracking?: string; reason_code?: string; note?: string; cod_amount?: number; method_id?: string; created_at?: string; version?: number }): Promise<{ id: string; method_id: string; tracking_number: string | null }> => ctl('/seed-shipment', s);
export const shipmentState = (order_code: string): Promise<{ id: string; status: string; tracking_number: string | null; cod_amount: number; version: number; history: number; outbox: string[] } | null> => ctl(`/shipment?order_code=${order_code}`);
/** Giỏ dựng thẳng của khách `email` (CRT): `lines[].price` là giá ĐÃ LƯU lúc thêm (mặc định bằng giá hiện hành), `reason: 'product_archived'` là dòng đã bị đánh dấu ngừng bán. */
export const seedCart = (c: { email: string; lines: { product_id: string; quantity?: number; price?: number; reason?: 'product_archived' }[]; coupon?: string; method_id?: string; city?: string }): Promise<{ id: string }> => ctl('/seed-cart', c);
export const cartState = (email: string): Promise<{ status: string; coupon_code: string | null; shipping_method_id: string | null; shipping_city: string | null; version: number; items: { product_id: string; quantity: number; unit_price: number; unavailable_reason: string | null }[] } | null> => ctl(`/cart?email=${encodeURIComponent(email)}`);
export const cartCount = (): Promise<{ carts: number; items: number }> => ctl('/cart-count');
/** Admin đổi trạng thái hay giá của sản phẩm sau khi đã vào giỏ; `event` giao thêm ProductArchived cho consumer `cart`. */
export const setProduct = (p: { id: string; status?: 'draft' | 'active' | 'archived'; price?: number; event?: boolean }) => ctl('/product-set', p);
export const setShippingMethod = (id: string, active: boolean) => ctl('/set-shipping-method', { id, active });
export const setCoupon = (code: string, status: 'active' | 'disabled') => ctl('/set-coupon', { code, status });
/** Payment dựng thẳng của khách `email` (theo mã đơn; đơn tự dựng nếu chưa có). `attempts: 'auto'` dựng lượt thử theo `attempt_no`. Trả `txn_ref` các lượt thử. */
export const seedPayment = (p: { email: string; order_code?: string; method?: 'vnpay' | 'cod'; amount?: number; status?: string; attempt_no?: number; expires_at?: string | null; paid_at?: string | null; created_at?: string; order_status?: string; attempts?: 'auto' | { no?: number; status?: string; reason?: string | null; txNo?: string | null }[]; provider_ref?: string | null }): Promise<{ id: string; order_id: string; order_code: string; attempts: { txn_ref: string; no: number }[] }> => ctl('/seed-payment', p);
export const seedRefund = (r: { order_code: string; status?: 'requested' | 'succeeded' | 'failed'; reason?: string; auto_attempt_no?: number | null; created_at?: string }): Promise<{ id: string }> => ctl('/seed-refund', r);
export const paymentState = (order_code: string): Promise<{ id: string; status: string; attempt_no: number; method: string; provider_ref: string | null; attempts: { attempt_no: number; txn_ref: string; status: string; reason: string | null }[]; refunds: { id: string; status: string; reason: string; amount: number; auto_attempt_no: number | null }[]; events: string[] } | null> => ctl(`/payment?order_code=${order_code}`);
/** Điều khiển cổng VNPay giả: kết quả hoàn tiền `ok` hoặc `decline`; trả số lệnh hoàn đã nhận. */
export const gateway = (g: { refund?: 'ok' | 'decline' } = {}): Promise<{ refund: string; refund_calls: number }> => ctl('/gateway', g);
/** Chạy relay tới khi hết event (và chờ các cuộc gọi hoàn tiền đang chạy xong): thay hạ tầng outbox giữa PAY và ORD. */
export const relay = (): Promise<unknown> => ctl('/relay', {});
/** Giao một event của PAY, INV, SHP cho ORD (đơn theo mã đơn). */
export const sendEvent = (type: string, order_code: string, payload: Record<string, unknown> = {}) => ctl('/event', { type, order_code, payload });

/** CHK: các phiên checkout của khách (mới nhất trước); `fresh`: còn hơn 29 phút; `order_code` khi đã `completed`. */
export interface ChkSessionRow { id: string; status: string; address_id: string | null; shipping_method_id: string | null; payment_method: string | null; coupon_code: string | null; order_id: string | null; order_code: string | null; fresh: boolean }
export const chkSessions = async (email: string): Promise<ChkSessionRow[]> => (await ctl(`/chk-session?email=${encodeURIComponent(email)}`)).sessions;
/** Lùi hạn phiên `open` của khách về `minutes` phút trước (giờ CSDL): hạn phiên không phụ thuộc đồng hồ ứng dụng. */
export const expireChkSession = (email: string, minutes = 1) => ctl('/chk-expire', { email, minutes });
/** Đổi tồn dựng thẳng (khách khác đã mua): `on_hand` hoặc `reserved` mới. */
export const setStock = (s: { product_id: string; on_hand?: number; reserved?: number }) => ctl('/stock-set', s);
export const reservations = async (order_code: string): Promise<{ status: string; quantity: number; product_id: string }[]> => (await ctl(`/reservations?order_code=${order_code}`)).items;
/** Job hết hạn giữ hàng của INV với mốc giờ CSDL `ms` mili giây sau bây giờ (mặc định 16 phút), rồi giao event cho ORD. */
export const expireHolds = (ms = 16 * 60_000): Promise<{ orders: number }> => ctl('/inv-expire', { ms });

const T = 10_000;
/** Thử lại tới khi đúng (thay cho các khẳng định tự thử lại của công cụ test E2E). */
export async function eventually(fn: () => Promise<void> | void, ms = T): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try { await fn(); return; } catch (e) { if (Date.now() > end) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
}
export const id = (page: Page, testid: string): Locator => page.getByTestId(testid);
/** Chờ phần tử hiện (phần tử đầu tiên khớp). */
export const see = (l: Locator): Promise<void> => l.first().waitFor({ state: 'visible', timeout: T });
export const count = async (l: Locator, n: number): Promise<void> => eventually(async () => { expect(await l.count()).toBe(n); });
export const textOf = async (l: Locator): Promise<string> => { await see(l); return (await l.first().innerText()).trim(); };
/** `ms` dài hơn mặc định cho kết quả bất đồng bộ qua job hay cổng giả (hoàn tiền: 202 rồi cổng gọi sau commit, màn thăm dò mỗi 2 giây), đỏ chập chờn khi máy tải ở lượt clean run của review PAY. */
export const hasText = (l: Locator, expected: string | RegExp, ms?: number): Promise<void> =>
  eventually(async () => {
    const t = (await l.first().innerText()).trim();
    if (typeof expected === 'string') expect(t).toBe(expected); else expect(t).toMatch(expected);
  }, ms);
export const urlIs = (page: Page, re: RegExp): Promise<void> => eventually(() => { expect(page.url()).toMatch(re); });

/** Mọi test mở ngữ cảnh trình duyệt mới (cookie riêng). */
export async function withPage<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL: WEB, locale: 'vi-VN' });
  const page = await context.newPage();
  page.setDefaultTimeout(T);
  try { return await fn(page); } finally { await context.close(); }
}

/** Token trong "hộp thư giả" (event token thô phát in-process, có thể tới sau phản hồi vài chục mili giây). */
export async function mailToken(email: string, type: 'EmailVerificationRequested' | 'PasswordResetRequested'): Promise<string> {
  let token: string | undefined;
  await eventually(async () => { token = (await ctl(`/mail?email=${encodeURIComponent(email)}&type=${type}`))?.token; expect(token).toBeTruthy(); });
  return token!;
}

export async function loginUi(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await id(page, 'auth-login-email').fill(email);
  await id(page, 'auth-login-password').fill(password);
  await id(page, 'auth-login-submit').click();
  await see(id(page, 'auth-account-menu-trigger'));
}
export { API_DIR };

// NTF: thông báo dựng thẳng, trạng thái, phát event qua outbox + relay (NTF nhận như event thật của module khác), thư đã gửi tới SES giả, job gửi email.
export const seedNotification = (n: { email: string; type?: string; title?: string; body?: string; link?: string | null; status?: 'unread' | 'read'; age_ms?: number; data?: Record<string, unknown> }): Promise<{ id: string }> => ctl('/seed-notification', n);
export const notificationsOf = async (email: string): Promise<{ type: string; status: string; title: string; body: string; link: string | null }[]> => (await ctl(`/notifications?email=${encodeURIComponent(email)}`)).items;
/** Phát một event lên outbox rồi chạy relay tới hết: consumer NTF xử lý như event thật. */
export const publishEvent = (type: string, payload: Record<string, unknown>) => ctl('/publish', { type, payload });
export const sesMails = async (): Promise<{ from: string; to: string[]; subject: string; text: string; html: string }[]> => (await ctl('/ses-mails')).items;
export const runEmailJob = (): Promise<{ picked: number; sent: number; skipped: number; failed: number }> => ctl('/run-email-job', {});

// REV: đánh giá dựng thẳng (tự dựng đơn đã giao nếu khách chưa có), trạng thái đánh giá (kèm event đã phát và điểm tổng hợp của PRD), bật hoặc tắt kiểm duyệt trước lúc chạy.
export const seedReview = (r: { email: string; product_id: string; status?: 'pending' | 'published' | 'rejected' | 'hidden'; rating?: number; comment?: string | null; reason?: string; age_ms?: number; edited?: boolean; images?: number; delivered_days_ago?: number }): Promise<{ id: string }> => ctl('/seed-review', r);
export const reviewState = (q: { id: string } | { email: string; product_id: string }): Promise<{ id: string; status: string; rating: number; comment: string | null; edited_at: string | null; moderation_reason: string | null; events: string[]; images: number; prd: { rating_count: number; rating_sum: number } } | null> =>
  ctl(`/review-state?${new URLSearchParams(q as Record<string, string>)}`);
export const setPreModeration = (on: boolean) => ctl('/set-pre-moderation', { on });

// DSH: gài hoặc gỡ lỗi nguồn PAY của dashboard (`hang`: không trả lời tới khi gỡ; hạn nguồn của máy chủ E2E là 500 ms).
export const dshFault = (mode: 'hang' | 'ok') => ctl('/dsh-fault', { mode });
/** DSH: ORD không trả lời (`hang`), ORD tra tên người tạo từ AUTH lỗi (`names`), AUTH không tra được ai (`gone`) hoặc khỏe (`ok`), cho hai báo cáo tính lương. */
export const dshOrdFault = (mode: 'hang' | 'names' | 'gone' | 'ok') => ctl('/dsh-ord-fault', { mode });
