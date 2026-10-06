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
const report = ({ result = 'pass', path = 'src/orders.spec.ts', note = '-', slang = 'Không có', src = API } = {}) => `---
epic: ORD
test_command: pnpm test
test_result: 1 pass
---
## Kế hoạch task
| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | API | ${src} | - | done |
## Kết quả test
| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| ${TC} | TC | ${path} | ${result} | ${note} |
## Lệch spec
${slang}
`;
function run(o = {}, code = `// ${TC}\ntest('x')\n`) {
  const r = mkdtempSync(join(tmpdir(), 'impl-'));
  put(r, `spec/epics/ORD/design/${API}.md`, `---\nid: ${API}\n---\n`);
  put(r, `spec/epics/ORD/tests/${TC}.md`, `---\nid: ${TC}\n---\n`);
  put(r, 'spec/epics/ORD/report.md', report(o));
  put(r, 'src/orders.spec.ts', code);
  return spawnSync('node', [script, join(r, 'spec'), r, '--epic', 'ORD'], { encoding: 'utf8' });
}
const bad = (o, re, code) => { const x = run(o, code); assert.equal(x.status, 1, String(re)); assert.match(x.stderr, re); };
const ok = run();
assert.equal(ok.status, 0, ok.stderr);
bad({}, /không chứa ID/, "test('x')\n");
bad({ path: 'src/none.ts' }, /không tồn tại/);
bad({ result: 'skip' }, /skip phải có lý do/);
bad({ result: 'ok' }, /pass\|fail\|skip/);
bad({ src: 'ORD-API-20261006-999999999' }, /không có trong spec/);
bad({ slang: '' }, /Lệch spec/);
console.log('OK: check-report.mjs');
