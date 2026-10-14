// Kiểm nhanh check-review.mjs: node check-review.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// ---- L48 (kit_version: 3): dòng "Đã sửa" ở Việc cần làm phải có mục "## Kết quả sau sửa" với Đã sửa ở là file:dòng có thật và Chứng minh; kit_version 2 chỉ cảnh báo
const F3 = 'kit_version: 3\n', FIXED = row('Xem đơn của tôi', 'đạt', 'src/a.ts:1', 'Đã sửa trong lượt review (M1)');
const AFTER = (fixedAt = '`src/a.ts:2`', proof = 'test đỏ khi bỏ bản sửa', rows = null) => `## Kết quả sau sửa\n| Phát hiện (mức) | Đã sửa ở | Chứng minh |\n|---|---|---|\n${rows ?? `| MEDIUM: x | ${fixedAt} | ${proof} |`}\n\n`;
const f3 = (o, rep = REPORT()) => run({ sb: SB2, fm: F3, rerun: RR(), perm: FIXED, ...o }, { report: rep });
const f3bad = (o, re) => { const x = f3(o); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
assert.equal(f3({ rerun: RR() + AFTER() }).status, 0, f3({ rerun: RR() + AFTER() }).stderr);
f3bad({}, /Đã sửa.*Kết quả sau sửa/);
f3bad({ rerun: RR() + AFTER('`src/none.ts:2`') }, /Kết quả sau sửa.*file:dòng có thật/);
f3bad({ rerun: RR() + AFTER('`src/a.ts:99`') }, /Kết quả sau sửa.*vượt quá/);
f3bad({ rerun: RR() + AFTER('sửa ở trang đăng nhập') }, /Kết quả sau sửa.*file:dòng/);
f3bad({ rerun: RR() + AFTER('`src/a.ts:2`', '-') }, /Kết quả sau sửa.*Chứng minh/);
const l48 = run({ sb: SB2, fm: F2, rerun: RR(), perm: FIXED }, { report: REPORT() });
assert.equal(l48.status, 0, l48.stderr);
assert.match(l48.stdout, /Lưu ý: .*Kết quả sau sửa/);
assert.equal(f3({ perm: row('Xem đơn của tôi'), rerun: RR() }).status, 0, 'không có dòng Đã sửa thì không cần mục');

// ---- L93 (kit_version: 4): review bị ngắt giữa chừng còn chữ giữ chỗ vẫn không được qua; kit_version 3 chỉ cảnh báo
const F4 = 'kit_version: 4\n';
const f4 = (o, rep = REPORT()) => run({ sb: SB2, fm: F4, rerun: RR(), ...o }, { report: rep });
const f4bad = (o, re) => { const x = f4(o); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
assert.equal(f4().status, 0, f4().stderr);
f4bad({ rerun: RR('TBD_TEST_RESULT', 'TBD_TEST_COMPARE') }, /giữ chỗ|TBD/);
f4bad({ rerun: RR('Tests: chạy xong, xanh') }, /số pass/);
f4bad({ rerun: RR('Tests: ... passed') }, /giữ chỗ|\.\.\./);
f4bad({ fm: `${F4}reviewed_tree: 0000000\n` }, /reviewed_tree.*40/);
f4bad({ sb: SB2.replace('src/a.ts:2', 'TBD_EVIDENCE') }, /giữ chỗ|TBD/);
const PH = { rerun: RR('TBD_TEST_RESULT', 'TBD_TEST_COMPARE'), fm: `${F3}reviewed_tree: 0000000\n` };
const w93 = run({ sb: SB2, ...PH }, { report: REPORT() });
assert.equal(w93.status, 0, 'kit_version 3 chỉ cảnh báo, không làm đỏ review đã có\n' + w93.stderr);
assert.match(w93.stdout, /Lưu ý: .*(giữ chỗ|TBD)/);
assert.match(w93.stdout, /Lưu ý: .*reviewed_tree/);
assert.equal(run({ sb: SB2, rerun: RR(), fm: F4 }, { report: REPORT() }).status, 0);

// ---- L65: review trên cây sạch tại reviewed_commit, mã đổi sau đó: nói dòng bằng chứng nào lệch và dòng cũ nay ở đâu; dòng bằng chứng trống hoặc chỉ `}` là cảnh báo (kit_version 4: lỗi)
const D = run({ sb: SB2, fm: F3, rerun: RR(), api: row('GET /api/v1/orders', 'đạt', 'src/a.ts:2') }, { git: true, report: REPORT() });
const gitIn = (...a) => spawnSync('git', a, { cwd: D.r, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
rmSync(join(D.r, 'src/dirty.ts'));
put(D.r, 'spec/epics/ORD/review.md', review({ sb: SB2, fm: F3, rerun: RR(), commit: D.o2.commit, api: row('GET /api/v1/orders', 'đạt', 'src/a.ts:2') }));
put(D.r, 'src/a.ts', 'X\na\nb\nc\n');
gitIn('commit', '-qam', 'chèn một dòng');
const drift = spawnSync('node', [script, join(D.r, 'spec'), D.r, '--epic', 'ORD'], { encoding: 'utf8' });
assert.equal(drift.status, 0, drift.stderr);
assert.match(drift.stdout, /Lưu ý: .*dòng 2 của src\/a\.ts đã đổi; dòng cũ nay ở 3/);
const eof = run({ sb: SB2, fm: F4, rerun: RR(), api: row('GET /api/v1/orders', 'đạt', 'src/a.ts:4') }, { report: REPORT() }); // dòng 4 của 'a\nb\nc\n' là dòng rỗng cuối
assert.equal(eof.status, 1, 'kit_version 4: bằng chứng trỏ dòng trống phải lỗi');
assert.match(eof.stderr, /dòng trống|chỉ gồm/);
const eof3 = run({ sb: SB2, fm: F3, rerun: RR(), api: row('GET /api/v1/orders', 'đạt', 'src/a.ts:4') }, { report: REPORT() });
assert.equal(eof3.status, 0, eof3.stderr);
assert.match(eof3.stdout, /Lưu ý: .*dòng trống|Lưu ý: .*chỉ gồm/);
console.log('OK: check-review.mjs');
