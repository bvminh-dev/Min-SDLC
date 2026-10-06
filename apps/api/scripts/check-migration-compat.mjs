#!/usr/bin/env node
// CI (PRJ-REQ-20261006-095422563 BR3, BR4): migration tương thích ngược một phiên bản, phá vỡ đi hai bước (mở rộng rồi thu hẹp),
// và migration đã merge không được sửa.
//   --base <ref>      so với nhánh gốc: migration thêm mới bị kiểm nội dung; migration cũ bị sửa hoặc xóa thì lỗi
//   --files <f...>    kiểm trực tiếp các tệp SQL (dùng cho test)
// Bước thu hẹp hợp lệ phải có dòng `-- contract-step: <migration mở rộng đã phát hành trước đó>`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
let files = [];
const errors = [];

if (argv.includes('--files')) files = argv.slice(argv.indexOf('--files') + 1).filter((a) => !a.startsWith('--'));
else {
  const base = val('--base') ?? 'origin/main';
  const dir = 'apps/api/prisma/migrations/';
  const diff = (f) => execFileSync('git', ['diff', '--name-only', `--diff-filter=${f}`, `${base}...HEAD`, '--', dir], { encoding: 'utf8' }).split('\n').filter(Boolean);
  files = diff('A').filter((f) => f.endsWith('.sql'));
  for (const f of diff('MDR')) errors.push(`${f}: migration đã merge không được sửa, xóa hoặc đổi tên (tạo migration mới)`);
}

const RULES = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, 'đổi kiểu cột'],
  [/\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i, 'thu hẹp cột sang NOT NULL'],
  [/\bRENAME\b/i, 'đổi tên bảng hoặc cột'],
  [/\bDROP\s+CONSTRAINT\b/i, 'DROP CONSTRAINT'],
  // thêm cột NOT NULL không có DEFAULT làm bản cũ INSERT lỗi
  [/\bADD\s+COLUMN\b(?=[^;,]*\bNOT\s+NULL\b)(?![^;,]*\bDEFAULT\b)/i, 'thêm cột NOT NULL không DEFAULT'],
];
for (const f of files) {
  const sql = readFileSync(f, 'utf8');
  if (/^\s*--\s*contract-step:\s*\S+/m.test(sql)) continue;
  for (const [re, why] of RULES) {
    if (re.test(sql)) errors.push(`${f}: ${why} làm bản ứng dụng cũ lỗi; tách thành hai bước (bản N mở rộng, bản N+1 thu hẹp kèm dòng "-- contract-step: <migration mở rộng>")`);
  }
}
if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exit(1); }
process.stdout.write(`check-migration-compat: ${files.length} migration mới, tương thích ngược\n`);
