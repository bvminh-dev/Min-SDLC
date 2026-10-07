// Kiểm nhanh phần L34 của check-foundation.mjs (bảng phiên bản công nghệ): node check-foundation.test.mjs
// Chạy ở chế độ --file với chỉ architecture.md: các lỗi khác của kiến trúc (thiếu bảng module...) bị bỏ qua, chỉ xét thông báo về phiên bản.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(fileURLToPath(new URL('.', import.meta.url)), 'check-foundation.mjs');
const ADR = (decision = 'TypeScript, NestJS (API) và Next.js (web)') => `### ADR-002 Stack và cấu trúc dự án

- Trạng thái: accepted
- Bối cảnh: chưa có framework.
- Phương án: A NestJS, B Spring, C Django.
- Quyết định: ${decision}
- Hệ quả: một ngôn ngữ.
`;
const TABLE = (rows = ['TypeScript', 'NestJS', 'Next.js']) => `\n## Phiên bản công nghệ\n\n| Công nghệ | Phiên bản | Lý do ghim |\n| --- | --- | --- |\n${rows.map((r) => `| ${r} | 1 | lý do |`).join('\n')}\n`;
function run(body) {
  const r = mkdtempSync(join(tmpdir(), 'found-'));
  mkdirSync(join(r, 'spec'));
  const f = join(r, 'spec', 'architecture.md');
  writeFileSync(f, `---\nstatus: draft\n---\n# Kiến trúc nền\n\n${body}`);
  return spawnSync('node', [script, join(r, 'spec'), '--file', f], { encoding: 'utf8' });
}
const msg = (x) => x.stderr + x.stdout;
assert.match(msg(run(ADR())), /Phiên bản công nghệ/, 'ADR-002 nêu framework mà không có bảng phiên bản phải lỗi');
assert.doesNotMatch(msg(run(ADR() + TABLE())), /Phiên bản công nghệ/);
assert.match(msg(run(ADR() + TABLE(['TypeScript', 'NestJS']))), /Next\.js.*Phiên bản công nghệ|Phiên bản công nghệ.*Next\.js/, 'công cụ ở Quyết định phải có trong bảng');
assert.doesNotMatch(msg(run(ADR('một monorepo pnpm'))), /Phiên bản công nghệ/, 'ADR-002 không nêu framework thì không đòi bảng');
console.log('OK: check-foundation.mjs (L34)');
