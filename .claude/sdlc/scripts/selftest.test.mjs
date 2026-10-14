// Kiểm selftest.mjs: node selftest.test.mjs
// L97: một lần selftest không được để thư mục tạm trong $TMPDIR (mỗi test con chạy với TMPDIR riêng, dọn sau khi xong; rò thì báo; --strict-tmp thì thoát 1)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const selftest = join(dirname(fileURLToPath(import.meta.url)), 'selftest.mjs');
const base = mkdtempSync(join(tmpdir(), 'selftest-fx-'));
process.on('exit', () => rmSync(base, { recursive: true, force: true }));
const fx = join(base, 'claude'), tmp = join(base, 'tmp');
for (const d of ['sdlc/scripts', 'sdlc/hooks', 'skills/x/scripts', '../tmp']) mkdirSync(join(fx, d), { recursive: true });
writeFileSync(join(fx, 'sdlc/scripts/check-adapter.mjs'), '');
writeFileSync(join(fx, 'skills/x/scripts/leak.test.mjs'), "import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nmkdtempSync(join(tmpdir(), 'leak-'));\n");
const run = (...a) => spawnSync(process.execPath, [selftest, ...a], { encoding: 'utf8', env: { ...process.env, SELFTEST_CLAUDE_DIR: fx, TMPDIR: tmp } });

let r = run();
assert.equal(r.status, 0, r.stdout + r.stderr);
assert.deepEqual(readdirSync(tmp), [], 'selftest không được để thư mục nào trong TMPDIR của tiến trình gọi');
assert.match(r.stdout, /để lại 1 thư mục tạm/, 'phải nêu test con đã rò thư mục tạm');
r = run('--strict-tmp');
assert.equal(r.status, 1, 'với --strict-tmp, test con rò thư mục tạm là lỗi');
assert.deepEqual(readdirSync(tmp), []);
console.log('OK: selftest.mjs');
