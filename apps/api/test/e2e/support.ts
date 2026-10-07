import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { waitFor } from '../support/boot';
import { API_DIR, REPO_ROOT } from '../support/db';

// E2E dùng Jest (công cụ test duy nhất, PRJ-REQ-20261006-095422475 BR7) và `playwright-core` chỉ làm thư viện điều khiển trình duyệt.
// Ba cổng riêng (không đụng `pnpm dev`): web 3100, API 3101, cổng điều khiển 3102 của máy chủ E2E (test/e2e/server.ts).
export const WEB_PORT = 3100, API_PORT = 3101, CTL_PORT = 3102, S3_PORT = 3103;
export const WEB = `http://localhost:${WEB_PORT}`;
const WEB_DIR = resolve(REPO_ROOT, 'apps/web');
const NEXT = resolve(WEB_DIR, 'node_modules/next/dist/bin/next');
export const PASSWORD = 'Correct-Horse-9';

export interface E2eEnv { browser: Browser; stop: () => Promise<void> }

/** Dựng API thật (CSDL `ecom_e2e` dựng lại từ migration), bản build production của web, và trình duyệt Chromium. */
export async function startE2e(): Promise<E2eEnv> {
  const procs: ChildProcess[] = [];
  const keep = (c: ChildProcess) => { procs.push(c); return c; };
  const pipe = (c: ChildProcess, log: string[]) => { c.stdout?.on('data', (d) => log.push(String(d))); c.stderr?.on('data', (d) => log.push(String(d))); };
  const apiLog: string[] = [], webLog: string[] = [];
  const up = async (url: string) => { try { return (await fetch(url)).status < 500; } catch { return false; } };
  // review USR: lần chạy trước đỏ hay bị ngắt có thể để lại máy chủ API/web mồ côi giữ cổng; lần sau nói chuyện với mã cũ (xanh giả). Dừng ngay, không tái dùng.
  if ((await up(`http://127.0.0.1:${CTL_PORT}/health`)) || (await up(WEB))) throw new Error(`cổng E2E ${WEB_PORT} đến ${S3_PORT} đang bị tiến trình cũ giữ (lần chạy trước bị ngắt?): dừng nó (lsof -i :${WEB_PORT}) rồi chạy lại`);
  try {
    return await boot();
  } catch (e) { // lỗi bất kỳ khi dựng (build web hỏng, API không lên, trình duyệt không mở): không để tiến trình con mồ côi
    procs.forEach((p) => p.kill('SIGKILL'));
    throw e;
  }

  async function boot(): Promise<E2eEnv> {
    const api = keep(spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/e2e/server.ts'], {
      cwd: API_DIR,
      env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: 'postgresql://ecom:ecom@localhost:5433/ecom_e2e', CORS_ALLOWED_ORIGINS: WEB, E2E_API_PORT: String(API_PORT), E2E_CTL_PORT: String(CTL_PORT), E2E_S3_PORT: String(S3_PORT), ...(process.env.TEST_DB_BASE ? { TEST_DB_BASE: process.env.TEST_DB_BASE } : {}) },
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
export const seedUser = (u: { email: string; password?: string; role?: 'customer' | 'staff' | 'admin'; verified?: boolean; name?: string; createdAt?: string; phone?: string; avatar?: boolean }) => ctl('/seed-user', u);
export const seedAddress = (a: { email: string; receiver?: string; phone?: string; line1?: string; ward?: string; district?: string | null; city?: string; is_default?: boolean; age_ms?: number }) => ctl('/seed-address', a);
export const s3Keys = async (): Promise<string[]> => (await ctl('/s3-objects')).keys;
export const advance = (ms: number) => ctl('/advance', { ms });

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
export const hasText = (l: Locator, expected: string | RegExp): Promise<void> =>
  eventually(async () => {
    const t = (await l.first().innerText()).trim();
    if (typeof expected === 'string') expect(t).toBe(expected); else expect(t).toMatch(expected);
  });
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
