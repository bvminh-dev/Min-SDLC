// Kiểm nhanh check-roadmap.mjs: node check-roadmap.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-roadmap.mjs');
const doc = (rows, tail = '## Nguồn khảo sát\n- x\n\n## Giả định và câu hỏi mở\n- y\n') =>
  `---\nstatus: draft\n---\n# Roadmap\n\n| STT | Mã | Epic | Mục con |\n|---|---|---|---|\n${rows}\n\n${tail}`;
const GOOD = '| 01 | PRJ | Project prepare | A; B; C |\n| 02 | AUTH | Auth | Login; Logout; Register |';
function run(text) {
  const p = join(mkdtempSync(join(tmpdir(), 'rm-')), 'roadmap.md');
  writeFileSync(p, text);
  return spawnSync('node', [script, p], { encoding: 'utf8' });
}
const ok = run(doc(GOOD));
assert.equal(ok.status, 0, ok.stderr);
assert.equal(run(doc(GOOD.replace('| 02 |', '| 03 |'))).status, 1, 'STT không liên tục phải lỗi');
assert.equal(run(doc(GOOD.replace('Login; Logout; Register', 'Login; Logout'))).status, 1, 'epic dưới 3 mục con phải lỗi');
assert.equal(run(doc(GOOD.replace('PRJ', 'ABC'))).status, 1, 'epic 01 phải là PRJ');
assert.equal(run(doc(GOOD.replace('AUTH', 'PRJ'))).status, 1, 'mã trùng phải lỗi');
assert.equal(run(doc(GOOD, '## Nguồn khảo sát\n- x\n')).status, 1, 'thiếu mục giả định phải lỗi');
console.log('OK: check-roadmap.mjs');
