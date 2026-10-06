// Kiểm nhanh collect-foundation-requests.mjs: node collect-foundation-requests.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'collect-foundation-requests.mjs');
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const root = mkdtempSync(join(tmpdir(), 'found-'));
put(root, 'epics/ORD/questions.md', '# Q\n## A. Câu hỏi\n1. [OPEN] gì đó; có dấu chấm phẩy; nhưng ngoài mục\n\n## Nền cần sửa\n- spec/domain/entities.md; Thêm entity OrderStatusHistory; cao; ORD\n- spec/architecture.md; Thêm ADR outbox; trung bình; ORD\n- dòng văn xuôi thiếu trường\n');
put(root, 'epics/PAY/questions.md', '## Nền cần sửa\n- spec/domain/entities.md;  thêm entity  OrderStatusHistory ; thấp; PAY\n- spec/domain/events.md; Thêm PaymentExhausted; cao; PAY\n');
const r = spawnSync('node', [script, root], { encoding: 'utf8' });
assert.equal(r.status, 0, r.stderr);
// gộp trùng (cùng file và thay đổi): một dòng, epic gộp, ưu tiên cao nhất; xếp cao trước
assert.equal((r.stdout.match(/OrderStatusHistory/g) ?? []).length, 1, 'khử trùng lặp');
assert.match(r.stdout, /\| spec\/domain\/entities\.md \| Thêm entity OrderStatusHistory \| cao \| ORD, PAY \|/);
assert.ok(r.stdout.indexOf('PaymentExhausted') < r.stdout.indexOf('outbox'), 'ưu tiên cao xếp trước trung bình');
assert.doesNotMatch(r.stdout, /ngoài mục/, 'chỉ đọc mục Nền cần sửa');
assert.match(r.stderr, /1 dòng.*không đủ bốn trường/);
console.log('OK: collect-foundation-requests.mjs');
