// Kiểm nhanh check-report.mjs: node check-report.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-report.mjs');
const TC = 'ORD-TC-20261006-120000001', API = 'ORD-API-20261006-110000002';
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
const MUT = (n = 3, id = TC) => `## Kiểm đột biến\n| Chỗ phá | Test đỏ | Kết quả |\n|---|---|---|\n${Array.from({ length: n }, (_, i) => `| bỏ kiểm ${i} | ${id} | bắt |`).join('\n')}\n`;
const report = ({ result = 'pass', path = 'src/orders.spec.ts', note = '-', slang = 'Không có', src = API, fm = '', extra = '', t1 = 'API' } = {}) => `---
epic: ORD
test_command: pnpm test
test_result: 1 pass
${fm}---
## Kế hoạch task
| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | ${t1} | ${src} | - | done |
## Kết quả test
| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| ${TC} | TC | ${path} | ${result} | ${note} |
${extra}## Lệch spec
${slang}
`;
function run(o = {}, code = `// ${TC}\ntest('x')\n`, tc = `---\nid: ${TC}\n---\n`) {
  const r = mkdtempSync(join(tmpdir(), 'impl-'));
  put(r, `spec/epics/ORD/design/${API}.md`, `---\nid: ${API}\n---\n`);
  put(r, `spec/epics/ORD/tests/${TC}.md`, tc);
  put(r, 'spec/epics/ORD/report.md', report(o));
  put(r, 'src/orders.spec.ts', code);
  return spawnSync('node', [script, join(r, 'spec'), r, '--epic', 'ORD'], { encoding: 'utf8' });
}
const bad = (o, re, code, tc) => { const x = run(o, code, tc); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
const ok = run();
assert.equal(ok.status, 0, ok.stderr);
bad({}, /không chứa ID/, "test('x')\n");
bad({ path: 'src/none.ts' }, /không tồn tại/);
bad({ result: 'skip' }, /skip phải có lý do/);
bad({ result: 'ok' }, /pass\|fail\|skip/);
bad({ src: 'ORD-API-20261006-999999999' }, /không có trong spec/);
bad({ slang: '' }, /Lệch spec/);

// ---- L22..L24, L29, L38: kiểm mới; báo cáo có `kit_version: 2` bị ép lỗi, báo cáo cũ (không có trường) chỉ cảnh báo
const FRESH = 'kit_version: 2\nclean_run: pass\n', LB = '1. [đã chọn] chọn mặc định X.';
const good = (o = {}) => ({ fm: FRESH, slang: LB, ...o });
const GOODX = (o = {}) => run(good(o));
assert.equal(GOODX().status, 0, GOODX().stderr);
// báo cáo cũ: thiếu trường mới chỉ cảnh báo, không đỏ
const legacy = run({ slang: '1. chọn mặc định X.' });
assert.equal(legacy.status, 0, legacy.stderr);
assert.match(legacy.stdout, /Lưu ý: .*clean_run/);
assert.match(legacy.stdout, /Lưu ý: .*nhãn/);
// L24
bad(good({ fm: 'kit_version: 2\n' }), /clean_run/);
bad(good({ fm: 'kit_version: 2\nclean_run: có\n' }), /clean_run phải là/);
bad(good({ fm: 'kit_version: 2\nclean_run: chưa\n' }), /CI chưa chạy:/);
const chua = run(good({ fm: 'kit_version: 2\nclean_run: chưa\n', slang: '1. [chưa làm] CI chưa chạy: workflow chưa lên GitHub.' }));
assert.equal(chua.status, 0, chua.stderr);
assert.match(chua.stdout, /clean_run: chưa/);
// L22
const weak = { note: 'YẾU: smoke không chạy trong container sạch' };
bad(good(weak), /YẾU/);
const w = run(good({ ...weak, slang: `${LB}\n2. [chưa làm] ${TC} bằng chứng yếu: nâng bằng container sạch.` }));
assert.equal(w.status, 0, w.stderr);
assert.match(w.stdout, /Bằng chứng yếu: 1/);
// L23
bad(good(), /đường dẫn máy/, `// ${TC}\nconst bin = '/opt/homebrew/bin/node';\n`);
bad(good(), /đường dẫn máy/, `// ${TC}\nconst v = process.env.HOME + '/.nvm/versions/node/v22.23.2';\n`);
assert.equal(run(good(), `// ${TC}\nconst bin = '/opt/homebrew/bin/node'; // check-report:allow script chỉ chạy ở máy dev\n`).status, 0);
bad(good(), /đường dẫn máy/, `// ${TC}\nconst bin = '/opt/homebrew/bin/node'; // check-report:allow\n`);
const lp = run({ slang: LB, fm: 'clean_run: pass\n' }, `// ${TC}\nconst bin = '/Users/me/x';\n`);
assert.equal(lp.status, 0, lp.stderr);
assert.match(lp.stdout, /Lưu ý: .*đường dẫn máy/);
// L29
const TCERR = `---\nid: ${TC}\nkind: lỗi\nthreats: [ORD-SEC-20261006-110000003:T1]\n---\n`;
bad(good(), /Kiểm đột biến/, undefined, TCERR);
assert.equal(run(good({ extra: MUT(3) }), undefined, TCERR).status, 0);
bad(good({ extra: MUT(2) }), /ít nhất 3 dòng/, undefined, TCERR);
bad(good({ extra: MUT(3, 'ORD-TC-20261006-999999999') }), /Test đỏ/, undefined, TCERR);
assert.equal(run(good(), undefined, `---\nid: ${TC}\nkind: lỗi\nthreats: []\n---\n`).status, 0, 'TC lỗi không kiểm SEC không cần đột biến');
bad(good({ t1: 'Khung dự án monorepo', extra: '' }), /Kiểm đột biến/);
// L38
bad(good({ slang: '1. chọn mặc định X.' }), /nhãn/);
const lbl = run(good({ slang: '1. [đã chọn] a.\n2. [chưa làm] b.\n3. [cần quyết] c.\n4. [cần quyết] d.' }));
assert.equal(lbl.status, 0, lbl.stderr);
assert.match(lbl.stdout, /đã chọn=1, chưa làm=1, cần quyết=2/);

// ---- L43, L49, L53, L55 (kit_version: 3): lỗi với báo cáo `kit_version: 3` hoặc --strict; báo cáo kit_version 2 chỉ cảnh báo
const F3 = 'kit_version: 3\nclean_run: pass\n';
const g3 = (o = {}) => ({ fm: F3, slang: LB, ...o });
assert.equal(run(g3()).status, 0, run(g3()).stderr);
const warn3 = (o, re, code, tc) => { // cùng đầu vào: v3 là lỗi, v2 chỉ cảnh báo
  const e = run(o, code, tc); assert.equal(e.status, 1, String(re)); assert.match(e.stderr, re);
  const w = run({ ...o, fm: FRESH }, code, tc); assert.equal(w.status, 0, w.stderr); assert.match(w.stdout, new RegExp(`Lưu ý: .*${re.source}`));
};
// L43: [đã chọn] mà nội dung cần người hoặc sdlc-impact/sdlc-foundation quyết
warn3(g3({ slang: '1. [đã chọn] E2E dùng công cụ trái ADR-002, nên ghi vào ADR-002 qua `sdlc-foundation`.' }), /mục 1.*\[đã chọn\].*\[cần quyết\]/);
warn3(g3({ slang: '1. [đã chọn] sửa mã PRJ, cần review PRJ cân nhắc lại.' }), /mục 1.*\[cần quyết\]/);
warn3(g3({ slang: `${LB}\n2. [đã chọn] thiếu TC job dọn. Nên thêm TC qua \`sdlc-impact\`.` }), /mục 2.*\[cần quyết\]/);
assert.equal(run(g3({ slang: '1. [cần quyết] E2E trái ADR-002, nên ghi vào ADR-002 qua `sdlc-foundation`.' })).status, 0, 'đã [cần quyết] thì qua');
assert.equal(run(g3({ slang: '1. [đã chọn] BR đã sửa qua `sdlc-impact` (báo cáo đã chạy), chọn X.' })).status, 0, 'đã chạy sdlc-impact thì không phải việc chờ');
// L49: mốc thời gian cứng quanh hôm nay trong test không có fixed-clock:
const D = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const T49 = (line) => `// ${TC}\n${line}\n`;
warn3(g3(), /orders\.spec\.ts:2.*mốc thời gian/, T49(`const NOW = new Date('${D()}T10:00:00Z');`));
warn3(g3(), /orders\.spec\.ts:2.*mốc thời gian/, T49(`const NOW = '${D(-2)}T10:00:00.000Z';`));
assert.equal(run(g3(), T49(`const NOW = '${D(-30)}T10:00:00Z';`)).status, 0, 'mốc xa hôm nay không bị bắt');
assert.equal(run(g3(), T49(`// fixed-clock: Clock giả cho mọi nguồn thời gian\nconst NOW = '${D()}T10:00:00Z';`)).status, 0);
assert.equal(run(g3(), T49(`const NOW = '${D()}T10:00:00Z'; // fixed-clock: đồng hồ giả`)).status, 0);
// L53: sửa mã module khác (nền) mà không có test đổi theo ở test/<module>/
const ARCH = '| Epic | Module | Phụ thuộc |\n|---|---|---|\n| ORD | order | - |\n| PRJ | platform | - |\n';
function runGit(o, edit) {
  const r = mkdtempSync(join(tmpdir(), 'impl-git-'));
  put(r, `spec/epics/ORD/design/${API}.md`, `---\nid: ${API}\n---\n`);
  put(r, `spec/epics/ORD/tests/${TC}.md`, `---\nid: ${TC}\n---\n`);
  put(r, 'spec/architecture.md', ARCH);
  put(r, 'spec/epics/ORD/report.md', report(o));
  put(r, 'src/orders.spec.ts', `// ${TC}\ntest('x')\n`);
  put(r, 'apps/api/src/modules/platform/a.ts', 'a\n');
  const g = (...a) => spawnSync('git', a, { cwd: r, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'x');
  edit(r);
  return spawnSync('node', [script, join(r, 'spec'), r, '--epic', 'ORD'], { encoding: 'utf8' });
}
const nền = (r) => put(r, 'apps/api/src/modules/platform/a.ts', 'đổi\n');
const g53 = runGit(g3(), nền);
assert.equal(g53.status, 1, 'sửa nền không có test');
assert.match(g53.stderr, /apps\/api\/src\/modules\/platform\/a\.ts.*test\/platform/);
const w53 = runGit({ ...g3(), fm: FRESH }, nền);
assert.equal(w53.status, 0, w53.stderr);
assert.match(w53.stdout, /Lưu ý: .*modules\/platform\/a\.ts/);
assert.equal(runGit(g3(), (r) => { nền(r); put(r, 'apps/api/test/platform/a.spec.ts', 'test\n'); }).status, 0, 'có test/platform đổi theo thì qua');
assert.equal(runGit(g3(), (r) => put(r, 'apps/api/src/modules/order/b.ts', 'b\n')).status, 0, 'sửa module của chính epic không cần');
bad(g3({ slang: '1. [đã chọn] Sửa mã nền (platform) cho CSRF, cho cả đăng nhập.' }), /sửa nền.*TC|TC.*sửa nền/);
assert.equal(run(g3({ slang: `1. [đã chọn] Sửa mã nền (platform) cho CSRF, đã có test ${TC}.` })).status, 0);
// L55: hai lời gọi medianMs( liền nhau (đo tuần tự), và "nhiễu đo" không kèm bản sửa hay việc cho người
const SEQ = `// ${TC}\nit('x', async () => {\n  const a = await medianMs(30, f);\n  const b = await medianMs(30, g);\n  expect(a).toBeCloseTo(b);\n});\n`;
warn3(g3(), /orders\.spec\.ts:3.*đo tuần tự/, SEQ);
assert.equal(run(g3(), `// ${TC}\nit('x', async () => {\n  const a = await medianMs(30, f);\n});\nit('y', async () => {\n  const b = await medianMs(30, g);\n});\n`).status, 0, 'hai test khác nhau, mỗi test một lời gọi');
warn3(g3({ slang: '1. [đã chọn] TC đỏ một lần ở 0,325 là nhiễu đo, giữ ngưỡng.' }), /mục 1.*nhiễu đo/);
assert.equal(run(g3({ slang: '1. [đã chọn] TC đỏ một lần là nhiễu đo; đã sửa sang đo xen kẽ.' })).status, 0);
assert.equal(run(g3({ slang: '1. [cần quyết] TC đỏ một lần là nhiễu đo, cần người chọn ngưỡng.' })).status, 0);
console.log('OK: check-report.mjs');
