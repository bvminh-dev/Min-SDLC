// Kiểm nhanh check-spec-file.mjs: node check-spec-file.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), 'check-spec-file.mjs');
const ID = 'ORD-REQ-20261006-100000001';
const root = mkdtempSync(join(tmpdir(), 'hook-'));
const file = join(root, `spec/epics/ORD/requirements/${ID}.md`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `---\nid: ${ID}\nepic: ORD\nstatus: bogus\nroles: [customer]\n---\n`);
const r = spawnSync('node', [hook], { encoding: 'utf8', input: JSON.stringify({ cwd: root, tool_input: { file_path: file } }) });
assert.equal(r.status, 2, 'file sai hình thức: hook trả lỗi (exit 2)');
// L6/L18: exit 2 hiện là "blocking error" nên thông báo phải nói rõ file ĐÃ ghi xuống đĩa
assert.match(r.stderr, /^File đã được ghi nhưng chưa hợp lệ, hãy sửa:/);
console.log('OK: check-spec-file.mjs');
