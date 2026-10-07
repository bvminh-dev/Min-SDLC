// Kiểm nhanh check-spec.mjs: node check-spec.test.mjs (dừng ở assert đầu tiên sai).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-spec.mjs');
const ID = 'ORD-REQ-20261006-100000001';
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const REQ = ({ roles = '[customer]', extra = '', body = '', status = 'draft' } = {}) => `---
id: ${ID}
epic: ORD
status: ${status}
roles: ${roles}
links: []
${extra}---
## Kịch bản
### Luồng chính
- **Given** a
- **When** b
- **Then** c
### Luồng lỗi
- **Given** a
### Ca biên
- **Given** a
${body}`;

function run({ req = REQ(), matrixRoles = 'guest | customer', rolesMd = true } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'spec-'));
  put(r, 'permissions-matrix.md', `| Hành động | Requirement | ${matrixRoles} |\n|---|---|---|---|\n`);
  put(r, 'roadmap.md', '| STT | Mã | Epic | Mục con |\n|---|---|---|---|\n| 01 | ORD | Order | x |\n| 02 | CHK | Checkout | y |\n');
  if (rolesMd) put(r, 'domain/roles.md', '| Role     | Mô tả | Đăng nhập |\n| -------- | --- | --- |\n| guest | g | không |\n| customer | c | có |\n');
  put(r, `epics/ORD/requirements/${ID}.md`, req);
  return spawnSync('node', [script, r], { encoding: 'utf8' });
}
const bad = (opts, re) => { const x = run(opts); assert.equal(x.status, 1, `phải lỗi: ${re}`); assert.match(x.stderr, re); };

let r = run();
assert.equal(r.status, 0, r.stderr);
// L2/L9: depends_epics thay cho links tới epic chưa có spec; mã epic phải có trong roadmap
r = run({ req: REQ({ extra: 'depends_epics: [CHK]\n' }) });
assert.equal(r.status, 0, r.stderr);
bad({ req: REQ({ extra: 'depends_epics: [ZZZ]\n' }) }, /depends_epics.*ZZZ.*roadmap/);
// L10: role của requirement và cột của ma trận phải có trong roles.md
bad({ req: REQ({ roles: '[customer, system]' }), matrixRoles: 'guest | customer | system' }, /role "system" không có trong roles\.md/);
bad({ matrixRoles: 'guest | customer | system' }, /cột role "system" không có trong roles\.md/);
assert.equal(run({ rolesMd: false }).status, 0, 'không có roles.md thì không đối chiếu (nền chưa dựng)');
// L14: số tài liệu còn OPEN theo epic (chỉ thông tin, không làm fail)
r = run({ req: REQ({ body: '[OPEN] câu hỏi\n' }) });
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /OPEN theo epic: ORD=1/);
// L36: BR nói "bằng cấu hình" mà không đặt tên biến viết hoa trong backtick: lỗi với requirement draft, cảnh báo với requirement approved
const BR = (t) => `- BR1: ${t}\n`;
bad({ req: REQ({ body: BR('thời gian chờ đổi bằng cấu hình.') }) }, /BR1.*tên biến/);
bad({ req: REQ({ body: BR('giới hạn qua cấu hình') }) }, /BR1.*tên biến/);
bad({ req: REQ({ body: BR('retry cấu hình được') }) }, /BR1.*tên biến/);
assert.equal(run({ req: REQ({ body: BR('thời gian chờ đổi bằng cấu hình `DB_TIMEOUT_MS` (10000).') }) }).status, 0, 'có tên biến thì qua');
assert.equal(run({ req: REQ({ body: '- Ghi chú: đổi bằng cấu hình\n' }) }).status, 0, 'chỉ xét dòng BR');
r = run({ req: REQ({ status: 'approved', body: BR('đổi bằng cấu hình.') }) });
assert.equal(r.status, 0, 'requirement approved cũ chỉ cảnh báo');
assert.match(r.stdout, /Lưu ý: .*BR1.*tên biến/);
console.log('OK: check-spec.mjs');
