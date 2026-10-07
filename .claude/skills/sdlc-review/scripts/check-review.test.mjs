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
const review = ({ api = row('GET /api/v1/orders'), perm = row('Xem đơn của tôi'), sb = row('SB-06'), fm = '', rerun = '', commit = 'abc123' } = {}) =>
  `---\nepic: ORD\nreviewed_commit: ${commit}\n${fm}---\n${rerun}## Đối chiếu spec\n${H}${api}\n## Quyền\n${H}${perm}\n## Bảo mật\n${H}${sb}\n## Việc còn thiếu\nkhông\n`;
function run(o = {}, { report, git } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'review-'));
  put(r, `spec/epics/ORD/design/${API}.md`, `---\nid: ${API}\nepic: ORD\n---\n## Endpoint\n| Method | Path | Role | Requirement | Lỗi | Ghi chú |\n|---|---|---|---|---|---|\n| GET | /api/v1/orders | customer | ${REQ} | 401, 403 | x |\n`);
  put(r, `spec/epics/ORD/requirements/${REQ}.md`, `---\nid: ${REQ}\nepic: ORD\nroles: [customer]\n---\n`);
  put(r, 'spec/permissions-matrix.md', `| Hành động | Requirement | guest | customer | staff | admin |\n|---|---|---|---|---|---|\n| Xem đơn của tôi | ${REQ} | - | own | - | - |\n`);
  put(r, 'spec/security-baseline.md', '| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |\n|---|---|---|---|\n| SB-06 | IDOR | test | ORD, CRT |\n| SB-09 | TLS | config | \\* |\n| SB-20 | khác | test | PAY |\n');
  put(r, 'spec/epics/ORD/review.md', review(o));
  put(r, 'src/a.ts', 'a\nb\nc\n');
  if (report) put(r, 'spec/epics/ORD/report.md', report);
  if (git) { const g = (...a) => spawnSync('git', a, { cwd: r, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }); g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'x'); put(r, 'src/dirty.ts', 'd\n'); const o2 = { ...o, commit: g('rev-parse', '--short', 'HEAD').stdout.trim() }; const tree = () => spawnSync('node', [script, '--tree', r], { encoding: 'utf8' }).stdout.trim(); return { r, o2, tree }; }
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

// ---- L27, L28, L38: kiểm mới; review có `kit_version: 2` bị ép lỗi, review cũ chỉ cảnh báo
const SB2 = row('SB-06') + row('SB-09');
const REPORT = (extra = '', res = 'Tests: 12 passed, 12 total') => `---\nepic: ORD\ntest_command: pnpm test\ntest_result: ${res}\n---\n## Lệch spec\n${extra}\n`;
const RR = (res = 'Tests: 12 passed, 12 total', cmp = 'khớp', cmd = '`pnpm test`') => `## Kết quả chạy lại\n| Lệnh | Kết quả thật | So với report.md |\n|---|---|---|\n| ${cmd} | ${res} | ${cmp} |\n\n`;
const F2 = 'kit_version: 2\n';
const fresh = (o = {}, rep = REPORT()) => run({ sb: SB2, fm: F2, rerun: RR(), ...o }, { report: rep });
const freshBad = (o, re, rep) => { const x = fresh(o, rep); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
assert.equal(fresh().status, 0, fresh().stderr);
// L27
const leg = run({ sb: SB2 }, { report: REPORT() });
assert.equal(leg.status, 0, leg.stderr);
assert.match(leg.stdout, /Lưu ý: .*Kết quả chạy lại/);
freshBad({ rerun: '' }, /Kết quả chạy lại/);
freshBad({ rerun: RR('Tests: 12 passed', 'khớp', '`pnpm lint`') }, /test_command/);
freshBad({ rerun: RR('Tests: 100 passed, 100 total') }, /không khớp test_result/);
assert.equal(fresh({ rerun: RR('Tests: 100 passed, 100 total', 'lệch: report ghi 12') }).status, 0, 'lệch được ghi nhận thì qua');
const legMis = run({ sb: SB2, rerun: RR('Tests: 100 passed, 100 total') }, { report: REPORT() });
assert.equal(legMis.status, 0, legMis.stderr);
assert.match(legMis.stdout, /Lưu ý: .*không khớp test_result/);
// L28: mã bẩn
const G = run({ sb: SB2, fm: F2, rerun: RR() }, { git: true, report: REPORT() });
const gRun = (o) => spawnSync('node', [script, join(G.r, 'spec'), G.r, '--epic', 'ORD'], { encoding: 'utf8' });
put(G.r, 'spec/epics/ORD/review.md', review({ sb: SB2, fm: F2, rerun: RR(), commit: G.o2.commit }));
const g1 = gRun();
assert.equal(g1.status, 1, 'HEAD + mã bẩn + thiếu reviewed_tree');
assert.match(g1.stderr, /reviewed_tree/);
put(G.r, 'spec/epics/ORD/review.md', review({ sb: SB2, fm: `${F2}reviewed_tree: ${G.tree()}\n`, rerun: RR(), commit: G.o2.commit }));
const g2 = gRun();
assert.equal(g2.status, 0, g2.stderr);
assert.doesNotMatch(g2.stdout, /mã đã đổi sau review/);
put(G.r, 'src/dirty.ts', 'đổi sau review\n');
const g3 = gRun();
assert.equal(g3.status, 0, g3.stderr);
assert.match(g3.stdout, /Lưu ý: .*mã đã đổi sau review/);
put(G.r, 'spec/epics/ORD/review.md', review({ sb: SB2, rerun: RR(), commit: G.o2.commit })); // review cũ: chỉ cảnh báo
const g4 = gRun();
assert.equal(g4.status, 0, g4.stderr);
assert.match(g4.stdout, /Lưu ý: .*reviewed_tree/);
// L38: mục [chưa làm] của report phải có dòng lệch/chưa làm trong review
const REP38 = REPORT('1. [đã chọn] a.\n2. [chưa làm] **Audit không chặn TRUNCATE** (SB-17).');
freshBad({}, /chưa làm.*mục 2|mục 2.*chưa làm/, REP38);
assert.equal(fresh({ sb: row('SB-06') + row('SB-09') + row('SB-17 audit', 'chưa làm', '-', 'tách vai trò CSDL') }, REP38).status, 0);
assert.equal(fresh({ sb: SB2, perm: row('Xem đơn của tôi', 'lệch', 'src/a.ts:1', 'xem Lệch spec mục 2') }, REP38).status, 0);
console.log('OK: check-review.mjs');
