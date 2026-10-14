// Kiểm clean-run.mjs: node clean-run.test.mjs (L98: dựng clean run bằng script, không chép công thức tay)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'clean-run.mjs');
const base = mkdtempSync(join(tmpdir(), 'cleanrun-'));
process.on('exit', () => rmSync(base, { recursive: true, force: true }));
const repo = join(base, 'repo');
mkdirSync(repo);
const put = (rel, t) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), t); };
const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
git('init', '-q');
put('tracked.txt', 'cũ\n');
put('gone.txt', 'sẽ bị xóa\n');
git('add', '-A'); git('commit', '-qm', 'x');
put('tracked.txt', 'mới\n');                 // sửa chưa commit
put('staged.txt', 'đã stage\n'); git('add', 'staged.txt'); // thêm vào index, chưa commit
put('untracked.txt', 'chưa theo dõi\n');
put('.claude/x.txt', 'không được chép\n');
rmSync(join(repo, 'gone.txt'));              // xóa chưa commit

const js = (code, ...args) => `node -e "${code}" ${args.join(' ')}`;
const steps = [
  { name: 'env-sạch', cmd: js("if (process.env.KIT_SECRET_TEST) process.exit(1)") },
  { name: 'env-cho-phép', cmd: js("if (process.env.CI !== 'true' || process.env.PLAYWRIGHT_BROWSERS_PATH !== '/pw' || process.env.TEST_DB_BASE !== 'postgres://x') process.exit(1)") },
  { name: 'phủ-tệp', cmd: js("const f = require('fs'); if (f.readFileSync('tracked.txt', 'utf8') !== 'mới\\\\n' || !f.existsSync('staged.txt') || !f.existsSync('untracked.txt') || f.existsSync('gone.txt') || f.existsSync('.claude/x.txt')) process.exit(1)") },
  { name: 'store', cmd: js("if (process.argv[1] !== '/store') process.exit(1)", '{store}') },
];
writeFileSync(join(base, 'steps.json'), JSON.stringify({ steps }));
const run = (extra = [], env = {}) => spawnSync(process.execPath, [script, '--cwd', repo, '--steps', join(base, 'steps.json'), '--store-dir', '/store', '--playwright-browsers', '/pw', ...extra], { encoding: 'utf8', env: { ...process.env, KIT_SECRET_TEST: '1', TEST_DB_BASE: 'postgres://x', ...env } });

let r = run();
assert.equal(r.status, 0, r.stdout + r.stderr);
assert.match(r.stdout, /clean_run: pass/);
for (const n of ['env-sạch', 'env-cho-phép', 'phủ-tệp', 'store']) assert.match(r.stdout, new RegExp(`\\| ${n} \\|.*\\| 0 \\|`), `bước ${n} phải ghi mã thoát 0`);
assert.equal(git('worktree', 'list').stdout.trim().split('\n').length, 1, 'phải dọn worktree sau khi chạy');

// bước đỏ: thoát 1, bước sau bị bỏ qua, vẫn dọn worktree
writeFileSync(join(base, 'steps.json'), JSON.stringify({ steps: [{ name: 'đỏ', cmd: js('process.exit(3)') }, { name: 'sau', cmd: js('0') }] }));
r = run();
assert.equal(r.status, 1, r.stdout);
assert.match(r.stdout, /\| đỏ \|.*\| 3 \|/);
assert.match(r.stdout, /\| sau \|.*bỏ qua/);
assert.match(r.stdout, /clean_run: fail/);
assert.equal(git('worktree', 'list').stdout.trim().split('\n').length, 1, 'đỏ cũng phải dọn worktree');
assert.ok(!existsSync(join(base, 'wt')));
console.log('OK: clean-run.mjs');
