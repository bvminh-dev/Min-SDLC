import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Gốc thư mục tạm của MỘT lần chạy test (`ecom-run-*`). global-setup đặt nó vào TMPDIR nên mọi `mkdtemp(tmpdir())` của test và của
// tiến trình con (pnpm, git, prisma) đều rơi vào đây; global-teardown đỏ cả lần chạy nếu còn gì sót rồi xóa gốc.
/** Gốc của lượt chạy cũ bị ngắt (SIGKILL, mất điện, máy treo) không còn ai dọn: xóa gốc `ecom-run-*` quá một ngày trước khi dựng gốc mới. */
const STALE_MS = 24 * 3600_000;
export function createRunRoot(): string {
  for (const n of readdirSync(tmpdir())) {
    const p = join(tmpdir(), n);
    try { if (n.startsWith('ecom-run-') && Date.now() - statSync(p).mtimeMs > STALE_MS) rmSync(p, { recursive: true, force: true }); } catch { /* lượt chạy khác đang dùng hay không đọc được: bỏ qua */ }
  }
  return mkdtempSync(join(tmpdir(), 'ecom-run-'));
}
/** Mục còn sót trong gốc (rỗng khi mọi test đã dọn). */
export const leftovers = (root: string): string[] => { try { return readdirSync(root); } catch { return []; } };
/** Xóa gốc (luôn), rồi ném lỗi nếu có mục sót. */
export function sweepRunRoot(root: string): void {
  const left = leftovers(root);
  rmSync(root, { recursive: true, force: true });
  if (left.length) throw new Error(`Test để sót thư mục tạm trong ${root} (đã xóa): ${left.join(', ')}. Dùng mkTmp() của test/support/tmp.ts hoặc rmSync ở afterAll/finally.`);
}
