#!/usr/bin/env node
// Dựng "clean run" (chạy lại các lệnh chuẩn như CI) bằng script, không chép công thức tay (L98).
// Dùng: node clean-run.mjs [--cwd <repo>] [--steps <steps.json>] [--store-dir <kho pnpm>] [--playwright-browsers <thư mục>] [--env NAME]... [--keep]
//   1. `git worktree add --detach` tại HEAD trong thư mục tạm.
//   2. Phủ tệp đã sửa, đã stage và chưa theo dõi (so với HEAD) trừ `.claude/`; tệp đã xóa thì xóa theo.
//   3. Chạy từng bước với môi trường SẠCH (`env -i`): chỉ PATH, HOME, CI=true, TEST_DB_BASE, STORAGE_TEST_ENDPOINT, NEXT_TELEMETRY_DISABLED=1,
//      PLAYWRIGHT_BROWSERS_PATH (+ tên khác qua --env). Giữ HOME thật và truyền --store-dir để pnpm cài offline được.
//   4. In bảng `| Bước | Lệnh | Mã thoát | Giây |` và dòng `clean_run: pass|fail`; thoát 1 nếu có bước đỏ (bước sau bị bỏ qua); luôn dọn worktree.
// steps.json: { "steps": [ { "name": "install", "cmd": "pnpm install --frozen-lockfile --offline --store-dir {store}" }, ... ] } ({store} = --store-dir).
// Mặc định (không có --steps): install rồi các script có trong package.json gốc theo thứ tự scan:secrets|scan, check:boundaries|boundaries, lint, typecheck, test, build.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const cwd = resolve(opt('--cwd') ?? '.');
const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const top = git('rev-parse', '--show-toplevel');
if (top.status !== 0) { console.error('Không phải repo git'); process.exit(2); }
const repo = top.stdout.trim();
const lines = (r) => r.stdout.split('\n').filter(Boolean);
const pm = (...a) => spawnSync('pnpm', a, { cwd: repo, encoding: 'utf8' });
const store = opt('--store-dir') ?? (pm('store', 'path').status === 0 ? pm('store', 'path').stdout.trim() : '');
const pw = opt('--playwright-browsers') ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? '', process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');

let steps;
if (opt('--steps')) steps = JSON.parse(readFileSync(resolve(opt('--steps')), 'utf8')).steps;
else {
  const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts ?? {};
  const pick = (...names) => names.find((n) => scripts[n]);
  steps = [{ name: 'install', cmd: 'pnpm install --frozen-lockfile --offline --store-dir {store}' }];
  for (const names of [['scan:secrets', 'scan'], ['check:boundaries', 'boundaries'], ['lint'], ['typecheck'], ['test'], ['build']]) { const n = pick(...names); if (n) steps.push({ name: n, cmd: `pnpm run ${n}` }); }
}

const tmp = mkdtempSync(join(tmpdir(), 'clean-run-'));
const wt = join(tmp, 'wt');
const cleanup = () => { spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo }); spawnSync('git', ['worktree', 'prune'], { cwd: repo }); if (!argv.includes('--keep')) rmSync(tmp, { recursive: true, force: true }); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });

const head = spawnSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: repo, encoding: 'utf8' });
if (head.status !== 0) { console.error(head.stderr); rmSync(tmp, { recursive: true, force: true }); process.exit(2); }
try {
  // phủ tệp chưa commit (so với HEAD, gồm cả tệp đã stage) và tệp chưa theo dõi, trừ .claude/
  const g = (...a) => lines(spawnSync('git', a, { cwd: repo, encoding: 'utf8' }));
  const copy = [...new Set([...g('diff', '--name-only', '--diff-filter=ACMRT', 'HEAD'), ...g('ls-files', '-o', '--exclude-standard')])].filter((f) => !f.startsWith('.claude/'));
  for (const f of copy) if (existsSync(join(repo, f))) { mkdirSync(dirname(join(wt, f)), { recursive: true }); copyFileSync(join(repo, f), join(wt, f)); }
  for (const f of g('diff', '--name-only', '--diff-filter=D', 'HEAD')) rmSync(join(wt, f), { force: true });
  // môi trường sạch (env -i): chỉ biến cho phép
  const allow = ['PATH', 'HOME', 'TEST_DB_BASE', 'STORAGE_TEST_ENDPOINT', ...argv.flatMap((a, i) => (a === '--env' ? [argv[i + 1]] : []))];
  const env = Object.fromEntries(allow.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  Object.assign(env, { CI: 'true', NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_BROWSERS_PATH: pw });

  const out = ['| Bước | Lệnh | Mã thoát | Giây |', '|---|---|---|---|'];
  let failed = false;
  for (const { name, cmd } of steps) {
    const line = cmd.replaceAll('{store}', store);
    if (failed) { out.push(`| ${name} | ${line} | bỏ qua (bước trước đỏ) | - |`); continue; }
    const t0 = Date.now();
    const r = await new Promise((done) => {
      const c = spawn(line, { cwd: wt, shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '';
      c.stdout.on('data', (d) => (buf += d));
      c.stderr.on('data', (d) => (buf += d));
      c.on('close', (status) => done({ status: status ?? 1, buf }));
    });
    out.push(`| ${name} | ${line} | ${r.status} | ${((Date.now() - t0) / 1000).toFixed(1)} |`);
    if (r.status !== 0) { failed = true; console.error(`--- bước ${name} đỏ (30 dòng cuối) ---\n${r.buf.split('\n').slice(-30).join('\n')}`); }
  }
  console.log(out.join('\n'));
  console.log(`\nclean_run: ${failed ? 'fail' : 'pass'}`);
  process.exitCode = failed ? 1 : 0;
} finally { cleanup(); }
