#!/usr/bin/env node
// Chạy toàn bộ kiểm tự động của kit: mọi `scripts/*.test.mjs` của các skill và check-adapter.
// Dùng: node .claude/sdlc/scripts/selftest.mjs     (exit 1 nếu có kiểm nào fail)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const claude = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const jobs = [{ name: 'check-adapter', file: join(claude, 'sdlc/scripts/check-adapter.mjs') }];
for (const skill of readdirSync(join(claude, 'skills'))) {
  const dir = join(claude, 'skills', skill, 'scripts');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.mjs'))) jobs.push({ name: `${skill}/${f}`, file: join(dir, f) });
}

let failed = 0;
for (const { name, file } of jobs) {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: resolve(claude, '..') });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log((r.stderr || r.stdout).trim().split('\n').slice(0, 6).map((l) => `      ${l}`).join('\n'));
}
console.log(`\n${jobs.length - failed}/${jobs.length} qua.`);
process.exit(failed ? 1 : 0);
