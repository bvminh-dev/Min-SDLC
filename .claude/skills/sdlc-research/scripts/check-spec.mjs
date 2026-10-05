#!/usr/bin/env node
// Kiểm HÌNH THỨC của spec/. Không đánh giá chất lượng nội dung (việc đó thuộc evals/ và subagent review).
// Dùng: node check-spec.mjs [thư-mục-spec, mặc định ./spec] [--file <đường-dẫn>]
//  --file: chỉ báo lỗi của một tài liệu và bỏ qua kiểm "links trỏ tới ID chưa tồn tại"
//          (dùng cho hook sau mỗi lần sửa, khi các file liên quan chưa kịp tạo).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const argv = process.argv.slice(2);
const fileIdx = argv.indexOf('--file');
const onlyFile = fileIdx >= 0 ? resolve(argv[fileIdx + 1] ?? '') : null;
const fileValueIdx = fileIdx >= 0 ? fileIdx + 1 : -1;
const positional = argv.filter((a, i) => !a.startsWith('--') && i !== fileValueIdx);
const specDir = positional[0] ?? 'spec';
if (!existsSync(specDir)) {
  console.error(`Không thấy thư mục spec: ${specDir}`);
  process.exit(2);
}
const ID_RE = /^([A-Z]{2,4})-(REQ|FLOW|TC|API|DB|SEC|E2E)-\d{8}-\d{9}$/;
const STATUSES = ['draft', 'approved', 'superseded'];
const errors = [];
const err = (file, msg) => errors.push({ file, msg });
const OPEN_RE = /\[OPEN\]|NEEDS CLARIFICATION/;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (!kv) continue;
    let v = kv[2];
    if (v.startsWith('[')) {
      v = v.slice(1, v.lastIndexOf(']')).split(',').map((s) => s.trim()).filter(Boolean);
    }
    fm[kv[1]] = v;
  }
  return fm;
}

// Role hợp lệ lấy từ hàng tiêu đề của permissions-matrix.md
function matrixRoles() {
  const f = join(specDir, 'permissions-matrix.md');
  if (!existsSync(f)) return null;
  const header = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('| Hành động'));
  if (!header) return null;
  return header.split('|').map((s) => s.trim()).slice(3).filter(Boolean);
}

const files = walk(specDir);
const docs = [];
const seen = new Map();

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm || !fm.id) continue; // file không phải tài liệu có ID (roadmap, ma trận...)
  docs.push({ file, fm, text });

  if (!ID_RE.test(fm.id)) err(file, `ID sai định dạng: ${fm.id}`);
  if (basename(file, '.md') !== fm.id) err(file, `tên file phải trùng ID (${fm.id}.md)`);
  if (seen.has(fm.id)) err(file, `ID trùng với ${seen.get(fm.id)}`);
  seen.set(fm.id, file);
  if (!STATUSES.includes(fm.status)) err(file, `status phải là một trong ${STATUSES.join('|')}`);
}

const roles = matrixRoles();
for (const { file, fm, text } of docs) {
  for (const link of fm.links ?? []) {
    if (!seen.has(link)) err(file, `links trỏ tới ID không tồn tại: ${link}`);
  }
  if (fm.id.includes('-REQ-')) {
    if (!fm.roles || fm.roles.length === 0) err(file, 'thiếu roles');
    else if (roles) {
      for (const r of fm.roles) if (!roles.includes(r)) err(file, `role "${r}" không có trong ma trận quyền`);
    } else err(file, 'thiếu spec/permissions-matrix.md để đối chiếu role');
    for (const kw of ['Given', 'When', 'Then']) {
      if (!text.includes(`**${kw}**`)) err(file, `thiếu ${kw} trong kịch bản`);
    }
    if (!/### Luồng lỗi[\s\S]*?\*\*Given\*\*/.test(text)) err(file, 'thiếu kịch bản ở mục "Luồng lỗi"');
    if (!/### Ca biên[\s\S]*?\*\*Given\*\*/.test(text)) err(file, 'thiếu kịch bản ở mục "Ca biên"');
  }
  if (fm.id.includes('-FLOW-') && !text.includes('```mermaid')) err(file, 'flow thiếu khối mermaid');
  if (fm.status === 'approved' && OPEN_RE.test(text)) {
    err(file, 'status approved nhưng còn [OPEN] / NEEDS CLARIFICATION: giải quyết hết trước khi duyệt');
  }
}

const openCount = docs.filter((d) => d.fm.status !== 'approved' && OPEN_RE.test(d.text)).length;

const shown = onlyFile
  ? errors.filter((e) => resolve(e.file) === onlyFile && !e.msg.startsWith('links trỏ tới'))
  : errors;

if (shown.length) {
  console.error(shown.map((e) => `${e.file}: ${e.msg}`).join('\n'));
  console.error(`\n${shown.length} lỗi${onlyFile ? '' : ` trong ${docs.length} tài liệu`}.`);
  process.exit(1);
}
console.log(`OK: ${onlyFile ? '1 tài liệu' : docs.length + ' tài liệu'} hợp lệ.`);
if (!onlyFile && openCount) {
  console.log(`Lưu ý: ${openCount} tài liệu draft còn [OPEN]/NEEDS CLARIFICATION (cần người quyết định).`);
}
