// Kiểm nhanh check-lessons.mjs: node check-lessons.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-lessons.mjs');
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
const H = '| Mã | Quan sát | Bằng chứng | Đề xuất rule | Nơi sửa | Loại |\n|---|---|---|---|---|---|\n';
const lesson = (row) => `---\nstatus: draft\n---\n${H}${row}\n`;
function run(row, name = '2026-10-06-ORD.md') {
  const r = mkdtempSync(join(tmpdir(), 'lesson-'));
  put(r, 'spec/roadmap.md', '| STT | Mã | Epic | Mục con |\n|---|---|---|---|\n| 01 | ORD | Order | x |\n');
  put(r, 'spec/epics/ORD/review.md', 'x');
  put(r, 'tool/check.mjs', 'x');
  put(r, `spec/lessons/${name}`, lesson(row));
  return spawnSync('node', [script, join(r, 'spec')], { encoding: 'utf8' });
}
const good = '| L1 | quan sát | spec/epics/ORD/review.md | rule | tool/check.mjs | script |';
const ok = run(good);
assert.equal(ok.status, 0, ok.stderr);
const bad = (row, re, name) => { const x = run(row, name); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
bad(good.replace('spec/epics/ORD/review.md', 'spec/none.md'), /không tồn tại/);
bad(good.replace('script', 'khác'), /Loại phải là/);
bad(good, /tên file phải dạng/, 'bai-hoc.md');
bad(good.replace('| rule |', '|  |'), /thiếu Quan sát hoặc Đề xuất/);
console.log('OK: check-lessons.mjs');
