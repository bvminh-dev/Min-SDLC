// Kiểm nhanh stop-check-spec.mjs (L40: Stop chạy check-report và check-review cho epic có report/review): node stop-check-spec.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), 'stop-check-spec.mjs');
const TC = 'ORD-TC-20261006-120000001';
const put = (r, rel, t) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
function project() {
  const r = mkdtempSync(join(tmpdir(), 'stop-'));
  put(r, `spec/epics/ORD/doc/${TC}.md`, `---\nid: ${TC}\nstatus: approved\n---\n`); // có ID kiểu TC nhưng không nằm trong tests/ nên các kiểm khác bỏ qua
  put(r, 'spec/epics/ORD/report.md', `---\nepic: ORD\ntest_command: pnpm test\ntest_result: 1 pass\n---\n## Kế hoạch task\n| # | Task | Nguồn | Phụ thuộc | Trạng thái |\n|---|---|---|---|---|\n| 1 | API | - | - | done |\n## Kết quả test\n| ID | Loại | Test code | Kết quả | Ghi chú |\n|---|---|---|---|---|\n| ${TC} | TC | src/a.spec.ts | pass | - |\n## Lệch spec\nKhông có\n`);
  put(r, 'src/a.spec.ts', `// ${TC}\n`);
  return r;
}
const stop = (r) => spawnSync('node', [hook], { input: '{}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: r } });

const r = project();
let x = stop(r);
assert.equal(x.status, 0, x.stderr);
// mã đổi sau report (file test mất ID) thì Stop bị chặn dù report.md không được sửa
put(r, 'src/a.spec.ts', "test('x')\n");
x = stop(r);
assert.equal(x.status, 2, 'Stop phải chặn khi file test không còn chứa ID');
assert.match(x.stderr, /\[báo cáo triển khai[^\]]*\][\s\S]*không chứa ID/);
// file test bị đổi tên: chặn
const r2 = project();
renameSync(join(r2, 'src/a.spec.ts'), join(r2, 'src/b.spec.ts'));
x = stop(r2);
assert.equal(x.status, 2);
assert.match(x.stderr, /không tồn tại/);
// review sai cũng chặn
const r3 = project();
put(r3, 'spec/epics/ORD/review.md', '---\nepic: ORD\n---\n## Đối chiếu spec\n');
x = stop(r3);
assert.equal(x.status, 2, 'review thiếu reviewed_commit và mục phải chặn');
assert.match(x.stderr, /\[review[^\]]*\][\s\S]*reviewed_commit/);
// epic không có report/review: không chạy thêm
const r4 = mkdtempSync(join(tmpdir(), 'stop-'));
put(r4, 'spec/epics/ORD/doc/x.md', 'không frontmatter');
assert.equal(stop(r4).status, 0);
// L24: clean_run: chưa thì Stop không chặn nhưng báo cho người dùng
const r5 = project();
put(r5, 'spec/epics/ORD/report.md', `---\nepic: ORD\nclean_run: chưa\ntest_command: pnpm test\ntest_result: 1 pass\n---\n## Kế hoạch task\n| # | Task | Nguồn | Phụ thuộc | Trạng thái |\n|---|---|---|---|---|\n| 1 | API | - | - | done |\n## Kết quả test\n| ID | Loại | Test code | Kết quả | Ghi chú |\n|---|---|---|---|---|\n| ${TC} | TC | src/a.spec.ts | pass | - |\n## Lệch spec\n1. [chưa làm] CI chưa chạy: workflow chưa lên GitHub.\n`);
x = stop(r5);
assert.equal(x.status, 0, x.stderr);
assert.match(x.stdout, /systemMessage.*clean_run: chưa/);
console.log('OK: stop-check-spec.mjs');
