// Kiểm nhanh merge-matrix.mjs: node merge-matrix.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'merge-matrix.mjs');
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const root = mkdtempSync(join(tmpdir(), 'matrix-'));
const matrix = join(root, 'permissions-matrix.md');
put(root, 'permissions-matrix.md', '# Ma trận\n\n| Hành động | Requirement | guest | customer |\n|---|---|---|---|\n| Xem sản phẩm | PRD-REQ-1 | Y | Y |\n\n## Thay đổi\n| Ngày | Dòng |\n|---|---|\n');
put(root, 'epics/CHK/permission-rows.md', '| Hành động | Requirement | guest | customer |\n|---|---|---|---|\n| Đặt hàng | CHK-REQ-1 | - | Y |\n| Xem sản phẩm | PRD-REQ-1 | Y | Y |\n');
put(root, 'epics/ORD/permission-rows.md', '| Xem đơn | ORD-REQ-1 | - | own |\n');
const run = () => spawnSync('node', [script, root], { encoding: 'utf8' });

let r = run();
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /Đã gộp 2 dòng ma trận và 0 dòng thay đổi, bỏ 1 dòng trùng/);
const after = readFileSync(matrix, 'utf8');
assert.match(after, /\| Xem sản phẩm \| PRD-REQ-1 \| Y \| Y \|\n\| Đặt hàng \| CHK-REQ-1 \| - \| Y \|\n\| Xem đơn \| ORD-REQ-1 \| - \| own \|\n\n## Thay đổi/, 'dòng mới nằm cuối bảng chính, trước mục Thay đổi');
// idempotent: chạy lại không đổi gì
r = run();
assert.match(r.stdout, /Đã gộp 0 dòng ma trận/);
assert.equal(readFileSync(matrix, 'utf8'), after, 'chạy lại không được đổi ma trận');
// số cột lệch thì lỗi và không ghi
put(root, 'epics/SHP/permission-rows.md', '| Giao | SHP-REQ-1 | Y |\n');
r = run();
assert.equal(r.status, 1);
assert.match(r.stderr, /SHP.*số cột/);
assert.equal(readFileSync(matrix, 'utf8'), after);
rmSync(join(root, 'epics/SHP'), { recursive: true });
// file epic có kèm bảng Thay đổi (6 cột khác ma trận): không được báo lỗi số cột, mà gộp vào bảng Thay đổi của ma trận, idempotent
put(root, 'epics/PAY/permission-rows.md', 'Giới thiệu\n\n| Hành động | Requirement | guest | customer |\n|---|---|---|---|\n| Thu tiền | PAY-REQ-1 | - | Y |\n\n| Ngày | Dòng |\n|---|---|\n| 2026-10-06 | 1 dòng PAY |\n');
r = run();
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /Đã gộp 1 dòng ma trận và 1 dòng thay đổi/);
const merged = readFileSync(matrix, 'utf8');
assert.match(merged, /\| Thu tiền \| PAY-REQ-1 \| - \| Y \|\n\n## Thay đổi\n\| Ngày \| Dòng \|\n\|---\|---\|\n\| 2026-10-06 \| 1 dòng PAY \|/);
r = run();
assert.match(r.stdout, /Đã gộp 0 dòng ma trận và 0 dòng thay đổi/);
assert.equal(readFileSync(matrix, 'utf8'), merged);
console.log('OK: merge-matrix.mjs');
