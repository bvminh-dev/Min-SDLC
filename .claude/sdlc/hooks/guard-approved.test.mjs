// Kiểm nhanh guard-approved.mjs: node guard-approved.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), 'guard-approved.mjs');
const REL = 'spec/arch.md';
function project(status, registry) {
  const r = mkdtempSync(join(tmpdir(), 'guard-'));
  mkdirSync(join(r, 'spec'), { recursive: true });
  mkdirSync(join(r, '.claude/sdlc'), { recursive: true });
  writeFileSync(join(r, REL), `---\nstatus: ${status}\n---\nbody\n`);
  if (registry) writeFileSync(join(r, '.claude/sdlc/change-control.json'), JSON.stringify(registry));
  return r;
}
const run = (r, tool_input) => spawnSync('node', [hook], { encoding: 'utf8', input: JSON.stringify({ cwd: r, tool_input: { file_path: join(r, REL), ...tool_input } }) });
const GOOD = { [REL]: { reason: 'r', solution: 's', authorized_by: 'người dùng' } };
const toDraft = { old_string: 'status: approved', new_string: 'status: draft' };
const toApproved = { old_string: 'status: draft', new_string: 'status: approved' };
const body = { old_string: 'body', new_string: 'new body' };

// mặc định: chặn sửa file approved, chặn tự duyệt
assert.equal(run(project('approved'), body).status, 2, 'approved không sổ đăng ký: chặn sửa');
assert.equal(run(project('approved'), toDraft).status, 2, 'approved không sổ đăng ký: chặn hạ');
assert.equal(run(project('draft'), toApproved).status, 2, 'draft không sổ đăng ký: chặn tự duyệt');
assert.equal(run(project('draft'), body).status, 0, 'draft: sửa tự do');
// có đăng ký đủ thông tin
assert.equal(run(project('approved', GOOD), body).status, 2, 'có đăng ký nhưng sửa nội dung khi còn approved: vẫn chặn');
assert.equal(run(project('approved', { [REL]: { reason: 'r' } }), toDraft).status, 2, 'đăng ký thiếu solution/authorized_by: chặn');
let r = project('approved', GOOD);
assert.equal(run(r, toDraft).status, 0, 'có đăng ký: được hạ về draft');
assert.match(readFileSync(join(r, '.claude/sdlc/change-control.log'), 'utf8'), /HẠ approved -> draft/);
r = project('draft', GOOD);
assert.equal(run(r, toApproved).status, 0, 'có đăng ký: được duyệt lại');
assert.deepEqual(JSON.parse(readFileSync(join(r, '.claude/sdlc/change-control.json'), 'utf8')), {}, 'duyệt lại xong thì đóng mục đăng ký');
assert.match(readFileSync(join(r, '.claude/sdlc/change-control.log'), 'utf8'), /DUYỆT LẠI/);
assert.equal(run(r, toApproved).status, 2, 'đã đóng đăng ký: duyệt lại lần nữa bị chặn');
// file khác không bị ảnh hưởng bởi đăng ký của file này
r = project('draft', { 'spec/other.md': GOOD[REL] });
assert.equal(run(r, toApproved).status, 2, 'đăng ký của file khác không áp dụng');
console.log('OK: guard-approved.mjs');
