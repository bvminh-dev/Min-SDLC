#!/usr/bin/env node
// PreToolUse (Edit|Write): bảo vệ tài liệu spec đã approved.
// Mặc định: chặn sửa file approved, và chặn tự "duyệt" (draft -> approved). Duyệt là quyết định của người.
// Ngoại lệ có kiểm soát (change control): người cho phép Claude sửa một file đã duyệt bằng cách khai nó trong
// `.claude/sdlc/change-control.json` với reason, solution, authorized_by. Khi đó:
//   - Claude được HẠ file đó từ approved về draft (và chỉ việc hạ đó) rồi sửa như file draft;
//   - Claude được DUYỆT LẠI file đó (draft -> approved) đúng một lần; mục đăng ký bị đóng sau khi duyệt lại;
//   - mọi lần hạ và duyệt lại được ghi vào `.claude/sdlc/change-control.log` kèm lý do và giải pháp.
// File không có trong sổ đăng ký vẫn bị chặn như cũ.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { block, locateSpecFile, readInput, statusOfFile, frontmatterOf } from './lib.mjs';

const input = readInput();
const ti = input.tool_input ?? {};
const loc = locateSpecFile(ti.file_path, input.cwd);
if (!loc) process.exit(0);

const root = dirname(loc.specDir);
const registryPath = join(root, '.claude/sdlc/change-control.json');
const logPath = join(root, '.claude/sdlc/change-control.log');
const rel = relative(root, resolve(loc.file)).split(sep).join('/');

function readRegistry() {
  try { return JSON.parse(readFileSync(registryPath, 'utf8')); } catch { return {}; }
}
function authorized(registry) {
  const e = registry[rel];
  return e && ['reason', 'solution', 'authorized_by'].every((k) => typeof e[k] === 'string' && e[k].trim()) ? e : null;
}
function log(action, e) {
  appendFileSync(logPath, `${new Date().toISOString()}\t${action}\t${rel}\treason: ${e.reason}\tsolution: ${e.solution}\tauthorized_by: ${e.authorized_by}\n`);
}

const current = statusOfFile(loc.file);
const registry = readRegistry();
const entry = authorized(registry);
const incoming = ti.new_string ?? ti.content ?? '';
const incomingStatus = ti.content !== undefined ? frontmatterOf(ti.content)?.status : undefined;
const setsApproved = /^status:\s*approved\b/m.test(incoming) || incomingStatus === 'approved';
const setsDraft = /^status:\s*draft\b/m.test(incoming) || incomingStatus === 'draft';

if (current === 'approved') {
  if (entry && setsDraft && !setsApproved) { log('HẠ approved -> draft', entry); process.exit(0); }
  block(
    `Chặn: ${loc.file} đang ở trạng thái approved nên không được sửa trực tiếp.\n` +
      (entry
        ? 'File này có trong .claude/sdlc/change-control.json: bước đầu tiên là hạ status về draft (một edit chỉ đổi status approved thành draft), rồi mới sửa nội dung.\n'
        : 'Hãy tạo bản đề xuất mới (status: draft) và chạy skill sdlc-impact; người duyệt sẽ quyết định thay thế bản cũ.\n' +
          'Muốn cho phép Claude sửa file này: người khai nó trong .claude/sdlc/change-control.json (reason, solution, authorized_by).'),
  );
}

// draft -> approved
if (setsApproved) {
  if (entry) {
    log('DUYỆT LẠI draft -> approved', entry);
    delete registry[rel];
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
    process.exit(0);
  }
  block(
    `Chặn: không được tự chuyển ${loc.file} sang status approved.\n` +
      'Duyệt là quyết định của người; để status là draft và báo người duyệt. ' +
      '(Chỉ file đã được hạ về draft theo change-control mới được Claude duyệt lại.)',
  );
}
process.exit(0);
