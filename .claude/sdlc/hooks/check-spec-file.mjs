#!/usr/bin/env node
// PostToolUse (Edit|Write): kiểm hình thức đúng file spec vừa sửa. Lỗi thì trả lại cho Claude để sửa ngay.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { block, CHECK_FOUNDATION, CHECK_IMPACT, CHECK_REPORT, CHECK_REVIEW, CHECK_SPEC, CHECK_TECH_DESIGN, CHECK_TESTS, CHECK_UI, isFoundationFile, locateSpecFile, readInput } from './lib.mjs';

const input = readInput();
const loc = locateSpecFile(input.tool_input?.file_path, input.cwd);
if (!loc) process.exit(0);

const script = isFoundationFile(loc.specDir, loc.file) ? CHECK_FOUNDATION : CHECK_SPEC;
const r = spawnSync(process.execPath, [script, loc.specDir, '--file', loc.file], { encoding: 'utf8' });
if (r.status === 1) {
  block(`Spec vừa sửa chưa hợp lệ, hãy sửa:\n${r.stderr.trim()}`);
}
// Tài liệu màn hình (ui/) và thiết kế kỹ thuật (design/): kiểm chéo, nhưng chỉ báo lỗi của đúng file vừa sửa
// (lỗi của file khác chưa xong dở không được chặn việc sửa file này).
const cross = /[\\/]ui[\\/][^\\/]+\.md$/.test(loc.file) ? [CHECK_UI, '--check']
  : /[\\/]design[\\/][^\\/]+\.md$/.test(loc.file) ? [CHECK_TECH_DESIGN]
  : /[\\/]changes[\\/][^\\/]+\.md$/.test(loc.file) ? [CHECK_IMPACT]
  : /[\\/]tests[\\/][^\\/]+\.md$/.test(loc.file) ? [CHECK_TESTS] : null;
// report.md, review.md của epic: kiểm với mã nguồn ở thư mục cha của spec/
const rep = loc.file.match(/[\\/]epics[\\/]([^\\/]+)[\\/](report|review)\.md$/);
if (rep) {
  const c = spawnSync(process.execPath, [rep[2] === 'report' ? CHECK_REPORT : CHECK_REVIEW, loc.specDir, dirname(loc.specDir), '--epic', rep[1]], { encoding: 'utf8' });
  const mine = c.status === 1 ? c.stderr.split(/\r?\n/).filter((l) => l.startsWith(loc.file)) : [];
  if (mine.length) block(`Báo cáo triển khai chưa khớp spec hoặc mã nguồn, hãy sửa:\n${mine.join('\n')}`);
}
if (cross) {
  const c = spawnSync(process.execPath, [cross[0], loc.specDir, ...cross.slice(1)], { encoding: 'utf8' });
  const mine = c.status === 1 ? c.stderr.split(/\r?\n/).filter((l) => l.startsWith(loc.file)) : [];
  if (mine.length) block(`Tài liệu vừa sửa chưa khớp spec liên quan, hãy sửa:\n${mine.join('\n')}`);
}
// status 0 (qua) hoặc 2 (không phải tài liệu có ID/không có spec dir): không làm phiền.
process.exit(0);
