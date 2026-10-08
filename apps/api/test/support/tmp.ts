import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Thư mục tạm của test, tự xóa ở afterAll của tệp test gọi, kể cả khi test đỏ. Quên dọn thì global-teardown (tmp-root.ts) đỏ.
const made: string[] = [];
export function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}
afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
