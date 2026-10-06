#!/usr/bin/env node
// Gộp dòng ma trận quyền của từng epic (`spec/epics/<EPIC>/permission-rows.md`) vào `spec/permissions-matrix.md`.
// Idempotent: dòng đã có (cùng Hành động và Requirement) bị bỏ qua; số cột phải khớp ma trận, sai thì lỗi và không ghi gì.
// Dùng: node merge-matrix.mjs [thư-mục-spec, mặc định ./spec]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const specDir = process.argv[2] ?? 'spec';
const matrixPath = join(specDir, 'permissions-matrix.md');
if (!existsSync(matrixPath)) { console.error(`Không thấy ${matrixPath}`); process.exit(2); }
const lines = readFileSync(matrixPath, 'utf8').split('\n');
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
const head = lines.findIndex((l) => l.startsWith('| Hành động'));
if (head < 0) { console.error(`${matrixPath}: thiếu bảng "| Hành động | Requirement | ..."`); process.exit(2); }
let end = head + 2;
while (lines[end]?.startsWith('|')) end++;
const width = cells(lines[head]).length;
const key = (c) => `${c[0]}\u0000${c[1]}`;
const have = new Set(lines.slice(head + 2, end).map((l) => key(cells(l))));

// bảng "Thay đổi" của ma trận (| Ngày | Dòng | ...): epic có thể kèm một dòng ghi vết; gộp idempotent theo cả dòng
const chHead = lines.findIndex((l) => /^\|\s*Ngày\s*\|/.test(l));
let chEnd = chHead >= 0 ? chHead + 2 : -1;
while (chHead >= 0 && lines[chEnd]?.startsWith('|')) chEnd++;
const haveChange = new Set(chHead >= 0 ? lines.slice(chHead + 2, chEnd).map((l) => cells(l).join('\u0000')) : []);

const add = [], addChange = [], errors = [];
let dup = 0;
const epicsDir = join(specDir, 'epics');
for (const epic of existsSync(epicsDir) ? readdirSync(epicsDir).sort() : []) {
  const f = join(epicsDir, epic, 'permission-rows.md');
  if (!existsSync(f)) continue;
  let mode = null; // 'matrix' | 'change' | null: chỉ xử lý dòng của bảng đúng loại, bỏ qua mọi bảng khác
  for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!l.startsWith('|')) { mode = null; continue; }
    if (/^\|\s*Hành động\s*\|/.test(l)) { mode = 'matrix'; continue; }
    if (/^\|\s*Ngày\s*\|/.test(l)) { mode = 'change'; continue; }
    if (/^\|\s*:?-/.test(l)) continue;
    const c = cells(l);
    // dòng không thuộc bảng nào đã nhận diện: coi là dòng ma trận nếu cột 2 là ID requirement (file chỉ có dòng, không có tiêu đề)
    const m = mode ?? (/-REQ-/.test(c[1] ?? '') ? 'matrix' : null);
    if (!m) continue;
    if (m === 'matrix') {
      if (c.length !== width) { errors.push(`${f}: số cột ${c.length}, ma trận có ${width}: ${l}`); continue; }
      if (have.has(key(c))) { dup++; continue; }
      have.add(key(c));
      add.push(`| ${c.join(' | ')} |`);
    } else if (chHead >= 0) {
      const k = c.join('\u0000');
      if (haveChange.has(k)) { dup++; continue; }
      haveChange.add(k);
      addChange.push(`| ${c.join(' | ')} |`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (add.length || addChange.length) {
  const out = [...lines];
  if (addChange.length) out.splice(chEnd, 0, ...addChange); // bảng Thay đổi nằm sau bảng chính nên chèn trước để không lệch chỉ số
  if (add.length) out.splice(end, 0, ...add);
  writeFileSync(matrixPath, out.join('\n'));
}
console.log(`Đã gộp ${add.length} dòng ma trận và ${addChange.length} dòng thay đổi, bỏ ${dup} dòng trùng.`);
