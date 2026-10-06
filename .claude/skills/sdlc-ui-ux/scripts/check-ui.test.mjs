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
console.log('OK: check-ui.mjs');
