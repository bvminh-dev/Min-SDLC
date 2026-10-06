#!/usr/bin/env node
// Stop: kiểm toàn bộ spec/ và không cho kết thúc khi còn lỗi HÌNH THỨC.
// Không chặn vì [OPEN]: xung đột mở cần người quyết định, ép model tự giải sẽ phản tác dụng.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { block, CHECK_FOUNDATION, CHECK_IMPACT, CHECK_SPEC, CHECK_TECH_DESIGN, CHECK_TESTS, CHECK_UI, foundationStarted, readInput } from './lib.mjs';

const input = readInput();
if (input.stop_hook_active) process.exit(0); // tránh vòng lặp vô hạn

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const specDir = resolve(root, 'spec');
if (!existsSync(specDir)) process.exit(0); // dự án chưa có spec/

const runs = [
  { script: CHECK_SPEC, label: 'spec' },
  { script: CHECK_UI, label: 'màn hình (ui-ux)', args: ['--check'] },
  { script: CHECK_TECH_DESIGN, label: 'thiết kế kỹ thuật (design)' },
  { script: CHECK_IMPACT, label: 'báo cáo tác động (impact)' },
  { script: CHECK_TESTS, label: 'test (test-design)' },
];
if (foundationStarted(specDir)) runs.push({ script: CHECK_FOUNDATION, label: 'nền (foundation)' });

const failures = [];
for (const { script, label, args = [] } of runs) {
  const r = spawnSync(process.execPath, [script, specDir, ...args], { encoding: 'utf8' });
  if (r.status === 1) failures.push(`[${label}]\n${r.stderr.trim()}`);
}
if (failures.length) {
  block(`Chưa thể kết thúc: còn lỗi hình thức, hãy sửa rồi báo lại.\n${failures.join('\n')}`);
}
process.exit(0);
