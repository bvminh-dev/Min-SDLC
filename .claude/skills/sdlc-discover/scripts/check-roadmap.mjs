#!/usr/bin/env node
// Kiểm roadmap do sdlc-discover tạo: bảng STT, Mã, Epic, Mục con; mã epic; cỡ epic; hai mục cuối bắt buộc.
// Dùng: node check-roadmap.mjs [đường-dẫn-roadmap, mặc định spec/roadmap.md]
// Kiểm nhất quán với nền (entity, event...) do check-foundation.mjs; file này chỉ kiểm chất lượng hình thức của roadmap.
import { existsSync, readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'spec/roadmap.md';
if (!existsSync(path)) { console.error(`Không thấy ${path}`); process.exit(2); }
const text = readFileSync(path, 'utf8');
const errors = [];
const err = (m) => errors.push(`${path}: ${m}`);

if (!/^---\r?\n[\s\S]*?\bstatus:\s*(draft|approved|superseded)\b[\s\S]*?\r?\n---/.test(text)) err('thiếu frontmatter status (draft | approved | superseded)');
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const lines = text.split(/\r?\n/);
const h = lines.findIndex((l) => squash(l).startsWith('| STT | Mã | Epic | Mục con'));
if (h < 0) { err('thiếu bảng với tiêu đề: | STT | Mã | Epic | Mục con |'); }
else {
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  if (rows.length < 2) err('roadmap cần ít nhất 2 epic (nền kỹ thuật và một epic nghiệp vụ)');
  const codes = new Set();
  rows.forEach((r, i) => {
    const [stt, code, name, subs] = r;
    if (r.length !== 4) { err(`dòng ${i + 1} sai số cột`); return; }
    if (Number(stt) !== i + 1 || !/^\d{2}$/.test(stt)) err(`STT dòng ${i + 1} phải là ${String(i + 1).padStart(2, '0')} (liên tục, hai chữ số), đang là "${stt}"`);
    if (!/^[A-Z]{2,4}$/.test(code)) err(`mã epic "${code}": 2-4 chữ in hoa`);
    if (codes.has(code)) err(`mã epic trùng: ${code}`);
    codes.add(code);
    if (!name) err(`epic ${code} thiếu tên`);
    const items = subs.split(';').map((s) => s.trim()).filter(Boolean);
    if (items.length < 3) err(`epic ${code}: mục con ít hơn 3 (${items.length}), gộp vào epic khác`);
    if (items.length > 12) err(`epic ${code}: mục con nhiều hơn 12 (${items.length}), tách epic`);
    if (new Set(items.map((s) => s.toLowerCase())).size !== items.length) err(`epic ${code}: mục con bị trùng`);
  });
  if (rows[0] && rows[0][1] !== 'PRJ') err('epic 01 phải là nền kỹ thuật với mã PRJ');
}
for (const sec of ['Nguồn khảo sát', 'Giả định và câu hỏi mở']) if (!new RegExp(`^## ${sec}\\s*$`, 'm').test(text)) err(`thiếu mục "## ${sec}"`);

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log('OK: roadmap hợp lệ.');
