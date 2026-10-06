// Kiểm nhanh approve.mjs: node approve.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'approve.mjs');
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
const lesson = '---\nstatus: draft\n---\nghi chú nhắc [OPEN] và NEEDS CLARIFICATION\n';
const REQ = (body = '') => `---\nid: ORD-REQ-20261006-100000001\ntitle: t\nepic: ORD\nstatus: draft\nroles: [customer]\nlinks: []\n---\n## Quy tắc\n- BR1: x\n${body}\n### Luồng chính\n- **Given** a\n- **When** b\n- **Then** c\n### Luồng lỗi\n- **Given** a\n- **When** b\n- **Then** c\n### Ca biên\n- **Given** a\n- **When** b\n- **Then** c\n`;
function project(req) {
  const r = mkdtempSync(join(tmpdir(), 'appr-'));
  put(r, 'spec/permissions-matrix.md', '| Hành động | Requirement | guest | customer | staff | admin |\n|---|---|---|---|---|---|\n');
  put(r, 'spec/lessons/2026-10-06-ORD.md', lesson);
  put(r, 'spec/epics/ORD/requirements/ORD-REQ-20261006-100000001.md', req);
  return r;
}
const run = (r, args) => spawnSync('node', [script, '--spec', join(r, 'spec'), ...args], { encoding: 'utf8' });
const AUTH = ['--reason', 'r', '--authorized-by', 'người dùng'];
const status = (r, rel) => readFileSync(join(r, rel), 'utf8').match(/^status:\s*(\w+)/m)[1];

let r = project(REQ());
assert.equal(run(r, [join(r, 'spec')]).status, 2, 'thiếu --reason/--authorized-by: từ chối');
let x = run(r, [...AUTH, join(r, 'spec')]);
assert.equal(x.status, 0, x.stderr);
assert.equal(status(r, 'spec/lessons/2026-10-06-ORD.md'), 'approved');
assert.equal(status(r, 'spec/epics/ORD/requirements/ORD-REQ-20261006-100000001.md'), 'approved');
assert.match(readFileSync(join(r, '.claude/sdlc/change-control.log'), 'utf8'), /DUYỆT ỦY QUYỀN.*authorized_by: người dùng/);
// còn OPEN trong tài liệu epic: không duyệt gì cả (kể cả file khác)
r = project(REQ('- [OPEN] chưa quyết'));
x = run(r, [...AUTH, join(r, 'spec')]);
assert.equal(x.status, 1);
assert.match(x.stderr, /còn \[OPEN\]/);
assert.equal(status(r, 'spec/lessons/2026-10-06-ORD.md'), 'draft', 'một cổng fail thì không duyệt file nào');
// bài học được miễn OPEN
r = project(REQ());
assert.equal(run(r, [...AUTH, join(r, 'spec/lessons')]).status, 0);
console.log('OK: approve.mjs');
