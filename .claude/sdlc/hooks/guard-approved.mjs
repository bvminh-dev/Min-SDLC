#!/usr/bin/env node
// PreToolUse (Edit|Write): chặn sửa tài liệu spec đã approved, và chặn việc tự "duyệt" (draft -> approved).
// Duyệt là quyết định của người; người đổi status trực tiếp trong editor.
import { block, locateSpecFile, readInput, statusOfFile, frontmatterOf } from './lib.mjs';

const input = readInput();
const ti = input.tool_input ?? {};
const loc = locateSpecFile(ti.file_path, input.cwd);
if (!loc) process.exit(0);

const current = statusOfFile(loc.file);

if (current === 'approved') {
  block(
    `Chặn: ${loc.file} đang ở trạng thái approved nên không được sửa trực tiếp.\n` +
      'Hãy tạo bản đề xuất mới (status: draft) và chạy skill sdlc-impact; người duyệt sẽ quyết định thay thế bản cũ.',
  );
}

// Tự duyệt: nội dung mới có "status: approved" trong khi trước đó chưa phải approved.
const incoming = ti.new_string ?? ti.content ?? '';
const incomingStatus = ti.content !== undefined ? frontmatterOf(ti.content)?.status : undefined;
const editsToApproved = /^status:\s*approved\b/m.test(incoming) || incomingStatus === 'approved';
if (editsToApproved) {
  block(
    `Chặn: không được tự chuyển ${loc.file} sang status approved.\n` +
      'Duyệt là quyết định của người; để status là draft và báo người duyệt.',
  );
}
process.exit(0);
