#!/usr/bin/env node
// Kiểm `spec/lessons/<YYYY-MM-DD>-<EPIC>.md`: tên file, khuôn bảng, bằng chứng và nơi sửa có thật.
// Dùng: node check-lessons.mjs [spec-dir, mặc định ./spec]   (đường dẫn trong bảng tính từ thư mục cha của spec/)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const specDir = process.argv[2] ?? 'spec';
if (!existsSync(specDir)) { console.error(`Không thấy thư mục spec: ${specDir}`); process.exit(2); }
const root = dirname(resolve(specDir));
const dir = join(specDir, 'lessons');
const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')) : [];

// trình định dạng markdown căn lề bảng (thêm khoảng trắng): so khớp tiêu đề sau khi gộp khoảng trắng
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/\\([*_])/g, '$1'));
const HEADER = ['Mã', 'Quan sát', 'Bằng chứng', 'Đề xuất rule', 'Nơi sửa', 'Loại'];
const LOAI = ['script', 'hook', 'skill', 'eval', 'spec'];
const roadmap = existsSync(join(specDir, 'roadmap.md')) ? readFileSync(join(specDir, 'roadmap.md'), 'utf8') : '';
const epics = new Set(roadmap.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).map((l) => cells(l)[1]));

const errors = [];
for (const n of files) {
  const f = join(dir, n);
  const err = (m) => errors.push(`${f}: ${m}`);
  const m = n.match(/^(\d{4}-\d{2}-\d{2})-([A-Z]{2,4})\.md$/);
  if (!m) err('tên file phải dạng <YYYY-MM-DD>-<EPIC>.md');
  else if (epics.size && !epics.has(m[2])) err(`epic ${m[2]} không có trong roadmap`);
  const text = readFileSync(f, 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  if (!/^status:\s*(draft|approved)\b/m.test(fm)) err('status phải là draft hoặc approved');
  const ls = text.split(/\r?\n/), h = ls.findIndex((l) => squash(l).startsWith('| Mã |'));
  if (h < 0) { err(`thiếu bảng: | ${HEADER.join(' | ')} |`); continue; }
  if (cells(ls[h]).join('|') !== HEADER.join('|')) err(`tiêu đề bảng phải là: | ${HEADER.join(' | ')} |`);
  const ids = new Set();
  let n_rows = 0;
  for (let i = h + 2; i < ls.length && ls[i].startsWith('|'); i++) {
    const r = cells(ls[i]); n_rows++;
    if (r.length !== HEADER.length) { err(`dòng sai số cột: ${r.join(' | ')}`); continue; }
    const [id, obs, ev, rule, where, kind] = r;
    if (!/^L\d+$/.test(id) || ids.has(id)) err(`mã bài học sai hoặc trùng: ${id}`);
    ids.add(id);
    if (!obs || !rule) err(`${id}: thiếu Quan sát hoặc Đề xuất rule`);
    if (!LOAI.includes(kind)) err(`${id}: Loại phải là ${LOAI.join(' | ')}`);
    for (const [label, p] of [['Bằng chứng', ev], ['Nơi sửa', where]]) {
      for (const x of p.split(',').map((s) => s.trim()).filter(Boolean)) if (!existsSync(join(root, x.replace(/:\d+$/, '')))) err(`${id}: ${label} "${x}" không tồn tại`);
      if (!p || p === '-') err(`${id}: thiếu ${label}`);
    }
  }
  if (!n_rows) err('bảng bài học trống');
}
if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: ${files.length} file bài học hợp lệ.`);
