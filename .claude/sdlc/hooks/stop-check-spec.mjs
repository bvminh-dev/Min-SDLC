#!/usr/bin/env node
// Stop: kiểm toàn bộ spec/ và không cho kết thúc khi còn lỗi HÌNH THỨC.
// Không chặn vì [OPEN]: xung đột mở cần người quyết định, ép model tự giải sẽ phản tác dụng.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { block, CHECK_FOUNDATION, CHECK_IMPACT, CHECK_REPORT, CHECK_REVIEW, CHECK_SPEC, CHECK_TECH_DESIGN, CHECK_TESTS, CHECK_UI, foundationStarted, readInput } from './lib.mjs';

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
// L40: epic đã có report.md hoặc review.md: kiểm lại với mã hiện tại (file test đổi tên mất ID, số dòng bằng chứng lệch...).
// Chỉ kiểm hình thức trên đĩa, không chạy test thật (nhanh); chỉ chặn khi script thoát 1.
const epicsDir = resolve(specDir, 'epics');
for (const e of existsSync(epicsDir) ? readdirSync(epicsDir) : []) {
  const code = ['--epic', e];
  if (existsSync(resolve(epicsDir, e, 'report.md'))) runs.push({ script: CHECK_REPORT, label: `báo cáo triển khai ${e} (implement)`, args: [dirname(specDir), ...code] });
  if (existsSync(resolve(epicsDir, e, 'review.md'))) runs.push({ script: CHECK_REVIEW, label: `review ${e}`, args: [dirname(specDir), ...code] });
}
if (foundationStarted(specDir)) runs.push({ script: CHECK_FOUNDATION, label: 'nền (foundation)' });

const failures = [], notes = [];
for (const { script, label, args = [] } of runs) {
  const r = spawnSync(process.execPath, [script, specDir, ...args], { encoding: 'utf8' });
  if (r.status === 1) failures.push(`[${label}]\n${r.stderr.trim()}`);
  else if (r.status === 0) notes.push(...r.stdout.split(/\r?\n/).filter((l) => l.includes('clean_run: chưa'))); // L24: CI chưa chạy thật
}
if (failures.length) {
  block(`Chưa thể kết thúc: còn lỗi hình thức, hãy sửa rồi báo lại.\n${failures.join('\n')}`);
}
if (notes.length) console.log(JSON.stringify({ systemMessage: notes.join('\n') })); // cảnh báo cho người dùng, không chặn
process.exit(0);
