#!/usr/bin/env node
// Kiểm báo cáo tác động `spec/changes/<ID>.md` (hình thức + phủ tín hiệu cứng). Không đánh giá chất lượng phân tích.
// Dùng: node check-impact.mjs [spec-dir, mặc định ./spec] [--file <báo-cáo>]   (bỏ --file thì kiểm mọi file trong spec/changes/)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
const only = fi >= 0 ? resolve(argv[fi + 1] ?? '') : null;
const specDir = argv.find((a, i) => !a.startsWith('--') && i !== (fi >= 0 ? fi + 1 : -1)) ?? 'spec';
if (!existsSync(specDir)) { console.error(`Không thấy thư mục spec: ${specDir}`); process.exit(2); }

const FIND_REFS = join(dirname(fileURLToPath(import.meta.url)), 'find-refs.mjs');
const HEADER = ['ID bị ảnh hưởng', 'Loại', 'Mức', 'Lý do', 'Việc cần làm'];
const LOAI = ['phải dựng lại', 'cần xem lại', 'không đổi'];
const MUC = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', '-', ''];
const ID_RE = /\b[A-Z]{2,4}-(?:REQ|FLOW|TC|API|DB|SEC|E2E)-\d{8}-\d{9}\b/;

// trình định dạng markdown căn lề bảng (thêm khoảng trắng): so khớp tiêu đề sau khi gộp khoảng trắng
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, acc) : n.endsWith('.md') && acc.push(p); }
  return acc;
};
const allIds = new Set(walk(specDir).map((f) => basename(f, '.md')).filter((n) => ID_RE.test(n)));

const dir = join(specDir, 'changes');
const reports = only ? [only] : walk(dir);
const errors = [];
const err = (f, m) => errors.push(`${f}: ${m}`);

for (const f of reports) {
  const id = basename(f, '.md');
  if (!allIds.has(id)) err(f, `tên file phải là ID của tài liệu bị đổi (spec/changes/<ID>.md), "${id}" không có trong spec/`);
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  const h = lines.findIndex((l) => squash(l).startsWith('| ID bị ảnh hưởng'));
  if (h < 0) { err(f, `thiếu bảng báo cáo với tiêu đề: | ${HEADER.join(' | ')} |`); continue; }
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
  if (cells(lines[h]).join('|') !== HEADER.join('|')) err(f, `tiêu đề bảng phải là: | ${HEADER.join(' | ')} |`);
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(cells(lines[i]));
  if (!rows.length) err(f, 'bảng báo cáo trống');
  const listed = new Set();
  for (const r of rows) {
    if (r.length !== HEADER.length) { err(f, `dòng sai số cột: ${r.join(' | ')}`); continue; }
    const [target, loai, muc, why, todo] = r;
    const m = target.match(ID_RE);
    if (m) listed.add(m[0]);
    else if (!(target.startsWith('spec/') && existsSync(join(dirname(specDir), target)))) err(f, `"${target}": phải là ID có trong spec/ hoặc đường dẫn file spec/ có thật`);
    else if (m == null) listed.add(target);
    if (m && !allIds.has(m[0])) err(f, `${m[0]} không có trong spec/`);
    if (!LOAI.includes(loai)) err(f, `${target}: Loại phải là ${LOAI.join(' | ')}, không phải "${loai}"`);
    if (!MUC.includes(muc)) err(f, `${target}: Mức phải là CRITICAL | HIGH | MEDIUM | LOW | -, không phải "${muc}"`);
    if (!why) err(f, `${target}: thiếu Lý do`);
    if (loai !== 'không đổi' && !todo) err(f, `${target}: ${loai} phải có Việc cần làm`);
  }
  // phủ tín hiệu cứng: mọi tài liệu có links/covers trỏ tới ID bị đổi phải có dòng trong bảng (kể cả "không đổi")
  const r = spawnSync(process.execPath, [FIND_REFS, specDir, id], { encoding: 'utf8' });
  for (const line of r.stdout.split(/\r?\n/)) {
    const [kind, file] = line.split('\t');
    if (kind !== 'links/covers' || !file) continue;
    const ref = basename(file, '.md');
    if (!listed.has(ref)) err(f, `thiếu dòng cho ${ref} (có links/covers tới ${id}; nếu không bị tác động thì ghi "không đổi" kèm lý do)`);
  }
}

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: ${reports.length} báo cáo tác động hợp lệ.`);
