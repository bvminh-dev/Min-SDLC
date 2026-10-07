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
console.log('OK: check-report.mjs');
