// Kiểm nhanh check-tests.mjs: node check-tests.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-tests.mjs');
const REQ = 'ORD-REQ-20261006-100000001', SEC = 'ORD-SEC-20261006-110000003';
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
const gwt = '- **Given** a\n- **When** b\n- **Then** c\n';
const sc = '### Luồng chính\n' + gwt + '### Luồng lỗi\n' + gwt + '### Ca biên\n' + gwt;
const tc = (n, kind, extra = '', body = gwt, status = 'draft') => [`epics/ORD/tests/ORD-TC-20261006-12000000${n}.md`, `---\nid: ORD-TC-20261006-12000000${n}\nepic: ORD\nstatus: ${status}\ncovers: [${REQ}]\nkind: ${kind}\n${extra}---\n## Các bước\n${body}`];
const e2e = (step, role = 'customer') => ['epics/ORD/tests/ORD-E2E-20261006-120000009.md', `---\nid: ORD-E2E-20261006-120000009\nepic: ORD\nstatus: draft\ncovers: [${REQ}]\nrole: ${role}\n---\n1. bấm ${step}\n`];

function run({ tcs = [tc(1, 'chính', `threats: [${SEC}:T1]\n`), tc(2, 'lỗi'), tc(3, 'biên')], e = e2e('`ord-order-list-row`'), chk = 'test', strict = true } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'tests-'));
  put(r, 'roadmap.md', '| STT | Mã | Epic | Mục con |\n|---|---|---|---|\n| 01 | ORD | Order | x |\n');
  put(r, 'permissions-matrix.md', '| Hành động | Requirement | guest | customer | staff | admin |\n|---|---|---|---|---|---|\n');
  put(r, `epics/ORD/requirements/${REQ}.md`, `---\nid: ${REQ}\nepic: ORD\nroles: [customer]\n---\n${sc}`);
  put(r, `epics/ORD/design/${SEC}.md`, `---\nid: ${SEC}\nepic: ORD\n---\n## Mối đe dọa\n| Mã | STRIDE | Tài sản | Mối đe dọa | Biện pháp | SB | Kiểm bằng |\n|---|---|---|---|---|---|---|\n| T1 | E | đơn | IDOR | kiểm sở hữu | SB-06 | ${chk} |\n`);
  put(r, 'testids.md', '| testid | Màn | Epic | Phần tử | Role | Requirement |\n|---|---|---|---|---|---|\n| ord-order-list-row | order-list | ORD | Dòng | customer | x |\n| ord-order-manage-row | order-manage | ORD | Dòng | staff | x |\n');
  for (const [p, t] of [...tcs, e]) put(r, p, t);
  return spawnSync('node', [script, r, ...(strict ? ['--strict'] : [])], { encoding: 'utf8' });
}
const bad = (o, re) => { const x = run(o); assert.equal(x.status, 1, `phải lỗi: ${re}`); assert.match(x.stderr, re); };

let r = run();
assert.equal(r.status, 0, r.stderr);
bad({ tcs: [tc(1, 'chính', `threats: [${SEC}:T1]\n`), tc(2, 'lỗi')] }, /chưa có test case cho biên/);
bad({ tcs: [tc(1, 'chính'), tc(2, 'lỗi'), tc(3, 'biên')] }, /T1.*chưa có test case/);
bad({ e: e2e('`ord-order-detail-x`') }, /không có trong spec\/testids\.md/);
bad({ e: e2e('`ord-order-manage-row`') }, /không dành cho role "customer"/);
bad({ e: e2e('nút gì đó') }, /không dùng testid nào/);
// L25: mối đe dọa kiểm bằng script/hook cần >= 2 TC, ít nhất một ca lỗi hoặc biên
const T1 = `threats: [${SEC}:T1]\n`;
bad({ chk: 'script' }, /T1.*cổng kiểm/);
bad({ chk: 'hook', tcs: [tc(1, 'chính', T1), tc(2, 'chính', T1), tc(3, 'lỗi'), tc(4, 'biên')] }, /T1.*cổng kiểm/);
const two = run({ chk: 'script', tcs: [tc(1, 'chính', T1), tc(2, 'lỗi', T1), tc(3, 'biên')] });
assert.equal(two.status, 0, two.stderr);
const lax = run({ chk: 'script', strict: false });
assert.equal(lax.status, 0, 'không --strict chỉ cảnh báo');
assert.match(lax.stdout, /Lưu ý: .*cổng kiểm/);
// L33: nhãn Given/When/Then lặp hoặc không đứng đầu bước (lỗi với draft hoặc --strict, cảnh báo với tài liệu approved); phiên bản công cụ cụ thể cần ghi chú cách dựng
const dup = '- **Given** **Given** a\n- **When** b\n- **Then** c\n';
bad({ tcs: [tc(1, 'chính', T1, dup), tc(2, 'lỗi'), tc(3, 'biên')], strict: false }, /lặp nhãn|nhãn không đứng đầu/);
bad({ tcs: [tc(1, 'chính', T1, '- a **Given** b\n- **When** b\n- **Then** c\n'), tc(2, 'lỗi'), tc(3, 'biên')], strict: false }, /lặp nhãn|nhãn không đứng đầu/);
const old = run({ tcs: [tc(1, 'chính', T1, dup, 'approved'), tc(2, 'lỗi'), tc(3, 'biên')], strict: false });
assert.equal(old.status, 0, old.stderr);
assert.match(old.stdout, /Lưu ý: .*lặp nhãn/);
const ver = '- **Given** chạy trong container Node 22.11.0\n- **When** b\n- **Then** c\n';
const v1 = run({ tcs: [tc(1, 'chính', T1, ver), tc(2, 'lỗi'), tc(3, 'biên')], strict: false });
assert.equal(v1.status, 0, v1.stderr);
assert.match(v1.stdout, /Lưu ý: .*phiên bản/);
const v2 = run({ tcs: [tc(1, 'chính', T1, ver + '## Dữ liệu và ghi chú\nNode dựng bằng container (image node:22.11.0) và .nvmrc.\n'), tc(2, 'lỗi'), tc(3, 'biên')], strict: false });
assert.doesNotMatch(v2.stdout, /phiên bản/);
console.log('OK: check-tests.mjs');
