import { createServer } from 'node:net';

// Cổng của máy chủ E2E: bốn cổng liên tiếp từ một cơ sở (web, API, điều khiển, S3 giả). Mặc định 3100 (không đụng `pnpm dev`);
// `E2E_PORT_BASE` đổi cơ sở khi máy có dự án khác giữ 3100 đến 3103. Cơ sở chọn MỘT lần ở global-setup và truyền cho mọi bộ test qua cùng biến.
export const DEFAULT_PORT_BASE = 3100;
export const PORT_SPAN = 4;

export interface E2ePorts { base: number; web: number; api: number; ctl: number; s3: number }

/** Đọc `E2E_PORT_BASE` (mặc định 3100); giá trị không phải số nguyên trong 1024..65531 thì ném lỗi nêu tên biến. */
export function portBaseFrom(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.E2E_PORT_BASE;
  if (raw === undefined || raw === '') return DEFAULT_PORT_BASE;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1024 || n + PORT_SPAN - 1 > 65535) throw new Error(`E2E_PORT_BASE=${raw} không hợp lệ: cần số nguyên từ 1024 đến ${65535 - PORT_SPAN + 1}`);
  return n;
}

export const portsFrom = (base: number): E2ePorts => ({ base, web: base, api: base + 1, ctl: base + 2, s3: base + 3 });

/** Cổng có tiến trình đang nghe (thử nghe thật ở mọi địa chỉ, như `next start` và máy chủ API). */
export const isPortBusy = (port: number): Promise<boolean> =>
  new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(true));
    s.listen(port, () => s.close(() => res(false)));
  });

/** Tiến trình E2E CŨ (bị ngắt, chưa dọn) đang giữ cổng điều khiển: nhận ra qua `/health` của cổng điều khiển. Dùng nó thì kết quả xanh giả. */
export async function staleE2eAt(ctlPort: number): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${ctlPort}/health`, { signal: AbortSignal.timeout(1500) })).status < 500; } catch { return false; }
}

export interface PickDeps { busy: (port: number) => Promise<boolean>; stale: (ctlPort: number) => Promise<boolean> }

/**
 * Chọn cơ sở cổng cho lần chạy.
 * - `E2E_PORT_BASE` đặt rõ: dùng đúng giá trị đó (cổng bận thì `startE2e` từ chối, nêu cổng nào).
 * - Không đặt: thử 3100; bận vì dự án khác thì tự dịch sang cơ sở kế còn trống (cách 4 cổng); bận vì CHÍNH E2E cũ (cổng điều khiển trả `/health`) thì ném lỗi,
 *   không né sang cổng khác (E2E cũ còn sống thì lần chạy sau nói chuyện với mã cũ: xanh giả).
 */
export async function pickPortBase(env: NodeJS.ProcessEnv = process.env, deps: PickDeps = { busy: isPortBusy, stale: staleE2eAt }): Promise<number> {
  const explicit = env.E2E_PORT_BASE !== undefined && env.E2E_PORT_BASE !== '';
  const first = portBaseFrom(env);
  if (explicit) return first;
  for (let base = first; base + PORT_SPAN - 1 <= 65535 && base < first + 200 * PORT_SPAN; base += PORT_SPAN) {
    const p = portsFrom(base);
    if (await deps.stale(p.ctl)) throw new Error(`cổng E2E ${p.web} đến ${p.s3} đang bị tiến trình E2E cũ giữ (lần chạy trước bị ngắt?): dừng nó (lsof -i :${p.ctl}) rồi chạy lại`);
    const busy = (await Promise.all([p.web, p.api, p.ctl, p.s3].map((x) => deps.busy(x)))).some(Boolean);
    if (!busy) return base;
  }
  throw new Error('không tìm được bốn cổng liên tiếp còn trống cho E2E; đặt E2E_PORT_BASE');
}

/** Cổng của lần chạy hiện tại (biến môi trường đã được global-setup chốt; chưa chốt thì mặc định). */
export const currentPorts = (env: NodeJS.ProcessEnv = process.env): E2ePorts => portsFrom(portBaseFrom(env));
