// Kiểm nhanh check-review.mjs: node check-review.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-review.mjs');
const REQ = 'ORD-REQ-20261006-100000001', API = 'ORD-API-20261006-110000002';
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
const row = (a, kq = 'đạt', ev = 'src/a.ts:2', todo = '-') => `| ${a} | x | ${kq} | ${ev} | ${todo} |\n`;
const H = '| Mục | Nguồn | Kết quả | Bằng chứng | Việc cần làm |\n|---|---|---|---|---|\n';
const review = ({ api = row('GET /api/v1/orders'), perm = row('Xem đơn của tôi'), sb = row('SB-06') } = {}) =>
  `---\nepic: ORD\nreviewed_commit: abc123\n---\n## Đối chiếu spec\n${H}${api}\n## Quyền\n${H}${perm}\n## Bảo mật\n${H}${sb}\n## Việc còn thiếu\nkhông\n`;
function run(o = {}) {
  const r = mkdtempSync(join(tmpdir(), 'review-'));
  put(r, `spec/epics/ORD/design/${API}.md`, `---\nid: ${API}\nepic: ORD\n---\n## Endpoint\n| Method | Path | Role | Requirement | Lỗi | Ghi chú |\n|---|---|---|---|---|---|\n| GET | /api/v1/orders | customer | ${REQ} | 401, 403 | x |\n`);
  put(r, `spec/epics/ORD/requirements/${REQ}.md`, `---\nid: ${REQ}\nepic: ORD\nroles: [customer]\n---\n`);
  put(r, 'spec/permissions-matrix.md', `| Hành động | Requirement | guest | customer | staff | admin |\n|---|---|---|---|---|---|\n| Xem đơn của tôi | ${REQ} | - | own | - | - |\n`);
  put(r, 'spec/security-baseline.md', '| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |\n|---|---|---|---|\n| SB-06 | IDOR | test | ORD, CRT |\n| SB-09 | TLS | config | \\* |\n| SB-20 | khác | test | PAY |\n');
  put(r, 'spec/epics/ORD/review.md', review(o));
  put(r, 'src/a.ts', 'a\nb\nc\n');
  return spawnSync('node', [script, join(r, 'spec'), r, '--epic', 'ORD'], { encoding: 'utf8' });
}
const bad = (o, re) => { const x = run(o); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
const ok = run({ sb: row('SB-06') + row('SB-09') });
assert.equal(ok.status, 0, ok.stderr);
bad({}, /thiếu dòng cho: SB-09/);
bad({ sb: row('SB-06') + row('SB-09'), api: row('GET /api/v1/orders', 'đạt', 'src/none.ts:1') }, /không phải file:dòng có thật/);
bad({ sb: row('SB-06') + row('SB-09'), api: row('GET /api/v1/orders', 'đạt', 'src/a.ts:99') }, /vượt quá độ dài/);
bad({ sb: row('SB-06') + row('SB-09'), perm: row('Xem đơn của tôi', 'lệch', 'src/a.ts:1', '-') }, /phải có Việc cần làm/);
bad({ sb: row('SB-06') + row('SB-09'), api: row('GET /api/v1/orders', 'tốt') }, /Kết quả phải là/);
console.log('OK: check-review.mjs');
