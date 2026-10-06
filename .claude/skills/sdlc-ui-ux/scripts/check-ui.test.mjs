// Kiểm nhanh check-ui.mjs: node check-ui.test.mjs (dừng ở assert đầu tiên sai).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-ui.mjs');
const REQ = 'ORD-REQ-20261006-100000001';
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const screen = (testid = 'ord-order-list-row', roles = '[customer]', stateReq = REQ, elRole = 'customer') => `---
screen: order-list
epic: ORD
status: draft
covers: [${REQ}]
roles: ${roles}
---
## Wireframe
x
## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| lỗi | banner | ${stateReq} |
## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ${testid} | Dòng | ${elRole} | mở | ${REQ} |
`;
function run(ui) {
  const root = mkdtempSync(join(tmpdir(), 'ui-'));
  put(root, 'permissions-matrix.md', '| Hành động | Requirement | guest | customer | staff | admin |\n|---|---|---|---|---|---|\n');
  put(root, `epics/ORD/requirements/${REQ}.md`, `---\nid: ${REQ}\nepic: ORD\nstatus: approved\nroles: [customer]\nlinks: []\n---\n`);
  put(root, 'epics/ORD/ui/order-list.md', ui);
  return { root, ...spawnSync('node', [script, root, '--epic', 'ORD', '--strict'], { encoding: 'utf8' }) };
}

let r = run(screen());
assert.equal(r.status, 0, r.stderr);
assert.match(readFileSync(join(r.root, 'testids.md'), 'utf8'), /ord-order-list-row/);
assert.equal(run(screen('ord-wrong-prefix')).status, 1, 'testid sai tiền tố phải lỗi');
assert.equal(run(screen('ord-order-list-row', '[staff]')).status, 1, 'role ngoài requirement phải lỗi');
assert.equal(run(screen('ord-order-list-row', '[customer]', 'ORD-REQ-20261006-199999999')).status, 1, 'Trạng thái nhắc requirement ngoài covers phải lỗi');
assert.equal(run(screen('ord-order-list-row', '[customer]', REQ, 'staff')).status, 1, 'role của phần tử ngoài roles của màn phải lỗi');
assert.equal(run(screen('ord-order-list-row', '[customer]', REQ, '-')).status, 1, 'phần tử thiếu role phải lỗi');
// L3/L12: cột testid ở bảng Trạng thái (tùy chọn): testid phải có trong bảng Phần tử; role guest ở màn role khác chỉ khi là testid của một trạng thái
const withState = (stateTestid, extraEl = '') => screen().replace('| Requirement |\n|---|---|---|\n| lỗi | banner | ' + REQ + ' |', `| Requirement | testid |\n|---|---|---|---|\n| lỗi | banner | ${REQ} | ord-order-list-row |\n| chưa đăng nhập | chuyển về đăng nhập | ${REQ} | ${stateTestid} |`) + extraEl;
const guestEl = `| ord-order-list-login | Chuyển đăng nhập | guest | - | ${REQ} |\n`;
assert.equal(run(withState('ord-order-list-row')).status, 0, 'cột testid trỏ tới phần tử có thật phải qua');
r = run(withState('ord-order-list-nope'));
assert.equal(r.status, 1, 'testid của trạng thái không có trong bảng Phần tử phải lỗi');
assert.match(r.stderr, /Trạng thái.*ord-order-list-nope.*Phần tử/);
assert.equal(run(withState('ord-order-list-login', guestEl)).status, 0, 'phần tử guest là testid của một trạng thái: được ở màn role khác');
assert.equal(run(withState('ord-order-list-row', guestEl)).status, 1, 'phần tử guest không gắn trạng thái nào vẫn phải lỗi role');
console.log('OK: check-ui.mjs');
