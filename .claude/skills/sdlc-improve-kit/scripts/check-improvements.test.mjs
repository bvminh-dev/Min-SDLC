// Kiểm nhanh check-improvements.mjs: node check-improvements.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-improvements.mjs');
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
const LESSON = (status) => `---\nstatus: ${status}\n---\n| Mã | Quan sát | Bằng chứng | Đề xuất rule | Nơi sửa | Loại |\n|---|---|---|---|---|---|\n| L1 | a | b | c | d | script |\n`;
const entry = ({ code = 'L1', changed = 'tool/x.mjs', reg = 'tool/x.test.mjs', st = '9/9 qua' } = {}) =>
  `# Nhật ký\n\n## 2026-10-06 | spec/lessons/2026-10-06-PRJ.md\n\n| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |\n|---|---|---|---|\n| ${code} | ${changed} | ${reg} | ${st} |\n`;
function run(o = {}, status = 'approved') {
  const r = mkdtempSync(join(tmpdir(), 'impr-'));
  put(r, '.claude/sdlc/improvements.md', entry(o));
  put(r, 'spec/lessons/2026-10-06-PRJ.md', LESSON(status));
  put(r, 'tool/x.mjs', 'x'); put(r, 'tool/x.test.mjs', 'x');
  return spawnSync('node', [script, r], { encoding: 'utf8' });
}
const ok = run();
assert.equal(ok.status, 0, ok.stderr);
const bad = (o, re, status) => { const x = run(o, status); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
bad({}, /phải approved/, 'draft');
bad({ code: 'L9' }, /không có trong file bài học/);
bad({ changed: 'tool/none.mjs' }, /không tồn tại/);
bad({ reg: '-' }, /thiếu ca hồi quy/);
bad({ st: '8/9 qua' }, /N\/N qua/);
assert.equal(run({ changed: 'chuyển nền', reg: '-' }).status, 0, 'loại spec không cần ca hồi quy');
console.log('OK: check-improvements.mjs');
