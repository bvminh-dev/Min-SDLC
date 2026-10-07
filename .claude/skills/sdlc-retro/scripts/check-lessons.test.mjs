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
function run(row, name = '2026-10-06-ORD.md', more = {}) {
  const r = mkdtempSync(join(tmpdir(), 'lesson-'));
  for (const [n, t] of Object.entries(more)) put(r, `spec/lessons/${n}`, t);
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
assert.equal(run(good, '2026-10-06-ORD-code.md').status, 0, 'hậu tố nhãn được phép');
assert.equal(run(good, '2026-10-06-ORD-Code_X.md').status, 1, 'hậu tố sai định dạng phải lỗi');
// L41: mã L<n> duy nhất trên mọi file bài học; mã không tiếp nối file cũ hơn thì cảnh báo; số dòng của Bằng chứng phải nằm trong file
const bad2 = (row, re, more, name) => { const x = run(row, name, more); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
bad2(good, /mã bài học L1 trùng với/, { '2026-10-05-ORD.md': lesson(good) });
const next = good.replace('| L1 |', '| L2 |');
assert.equal(run(next, '2026-10-07-ORD-b.md', { '2026-10-05-ORD.md': lesson(good) }).status, 0, 'mã tiếp nối thì qua');
const late = run(good, '2026-10-05-ORD.md', { '2026-10-04-ORD.md': lesson(good.replace('| L1 |', '| L7 |')) });
assert.equal(late.status, 0, late.stderr);
assert.match(late.stdout, /Lưu ý: .*L1.*không tiếp nối.*L7/);
const sameDay = run(good, '2026-10-06-ORD-b.md', { '2026-10-06-ORD-a.md': lesson(good.replace('| L1 |', '| L7 |')) });
assert.doesNotMatch(sameDay.stdout, /không tiếp nối/, 'cùng ngày thì không so thứ tự');
assert.equal(run(good.replace('review.md', 'review.md:1')).status, 0, 'dòng 1 nằm trong file');
bad(good.replace('review.md', 'review.md:99'), /dòng 99 vượt quá độ dài/);
console.log('OK: check-lessons.mjs');
