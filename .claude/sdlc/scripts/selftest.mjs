#!/usr/bin/env node
// Chạy toàn bộ kiểm tự động của kit: mọi `scripts/*.test.mjs` của các skill và check-adapter.
// Dùng: node .claude/sdlc/scripts/selftest.mjs [--strict-tmp]    (exit 1 nếu có kiểm nào fail)
// L97: mỗi test con chạy với TMPDIR riêng, dọn sau khi xong (không để thư mục trong $TMPDIR); test con để lại thư mục thì in danh sách,
// thoát 1 nếu có --strict-tmp. SELFTEST_CLAUDE_DIR đổi thư mục .claude (chỉ dùng cho selftest.test.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const claude = resolve(process.env.SELFTEST_CLAUDE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const strictTmp = process.argv.includes('--strict-tmp');
const jobs = [{ name: 'check-adapter', file: join(claude, 'sdlc/scripts/check-adapter.mjs') }];
const scriptsDir = join(claude, 'sdlc/scripts');
for (const f of readdirSync(scriptsDir).filter((n) => n.endsWith('.test.mjs'))) jobs.push({ name: `sdlc-scripts/${f}`, file: join(scriptsDir, f) });
const hooksDir = join(claude, 'sdlc/hooks');
for (const f of readdirSync(hooksDir).filter((n) => n.endsWith('.test.mjs'))) jobs.push({ name: `hooks/${f}`, file: join(hooksDir, f) });
for (const skill of readdirSync(join(claude, 'skills'))) {
  const dir = join(claude, 'skills', skill, 'scripts');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.mjs'))) jobs.push({ name: `${skill}/${f}`, file: join(dir, f) });
}

let failed = 0;
for (const { name, file } of jobs) {
  const priv = mkdtempSync(join(tmpdir(), 'kit-selftest-'));
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: resolve(claude, '..'), env: { ...process.env, TMPDIR: priv, TMP: priv, TEMP: priv } });
  const left = readdirSync(priv);
  rmSync(priv, { recursive: true, force: true });
  const ok = r.status === 0 && !(strictTmp && left.length);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${left.length ? `  (để lại ${left.length} thư mục tạm, đã dọn)` : ''}`);
  if (!ok) console.log((r.stderr || r.stdout).trim().split('\n').slice(0, 6).map((l) => `      ${l}`).join('\n'));
}
console.log(`\n${jobs.length - failed}/${jobs.length} qua.`);
process.exit(failed ? 1 : 0);
