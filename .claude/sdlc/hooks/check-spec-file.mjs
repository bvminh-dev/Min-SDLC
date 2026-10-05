#!/usr/bin/env node
// PostToolUse (Edit|Write): kiểm hình thức đúng file spec vừa sửa. Lỗi thì trả lại cho Claude để sửa ngay.
import { spawnSync } from 'node:child_process';
import { block, CHECK_FOUNDATION, CHECK_SPEC, isFoundationFile, locateSpecFile, readInput } from './lib.mjs';

const input = readInput();
const loc = locateSpecFile(input.tool_input?.file_path, input.cwd);
if (!loc) process.exit(0);

const script = isFoundationFile(loc.specDir, loc.file) ? CHECK_FOUNDATION : CHECK_SPEC;
const r = spawnSync(process.execPath, [script, loc.specDir, '--file', loc.file], { encoding: 'utf8' });
if (r.status === 1) {
  block(`Spec vừa sửa chưa hợp lệ, hãy sửa:\n${r.stderr.trim()}`);
}
// status 0 (qua) hoặc 2 (không phải tài liệu có ID/không có spec dir): không làm phiền.
process.exit(0);
