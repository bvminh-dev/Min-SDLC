#!/usr/bin/env node
// Stop: kiểm toàn bộ spec/ và không cho kết thúc khi còn lỗi HÌNH THỨC.
// Không chặn vì [OPEN]: xung đột mở cần người quyết định, ép model tự giải sẽ phản tác dụng.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { block, CHECK_FOUNDATION, CHECK_SPEC, foundationStarted, readInput } from './lib.mjs';

const input = readInput();
if (input.stop_hook_active) process.exit(0); // tránh vòng lặp vô hạn

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const specDir = resolve(root, 'spec');
if (!existsSync(specDir)) process.exit(0); // dự án chưa có spec/

const runs = [{ script: CHECK_SPEC, label: 'spec' }];
if (foundationStarted(specDir)) runs.push({ script: CHECK_FOUNDATION, label: 'nền (foundation)' });

const failures = [];
for (const { script, label } of runs) {
  const r = spawnSync(process.execPath, [script, specDir], { encoding: 'utf8' });
  if (r.status === 1) failures.push(`[${label}]\n${r.stderr.trim()}`);
}
if (failures.length) {
  block(`Chưa thể kết thúc: còn lỗi hình thức, hãy sửa rồi báo lại.\n${failures.join('\n')}`);
}
process.exit(0);
