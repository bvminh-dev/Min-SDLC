#!/usr/bin/env node
// Kiểm `spec/epics/<EPIC>/report.md` với spec và mã nguồn: truy vết test case -> test code, task -> tài liệu spec.
// Dùng: node check-report.mjs <spec-dir> <thư-mục-mã> --epic <EPIC>
// Không chạy test (không biết stack); chỉ kiểm báo cáo trung thực với những gì có trên đĩa.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const epic = argv.includes('--epic') ? argv[argv.indexOf('--epic') + 1] : null;
const [specDir, codeDir] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--epic');
if (!specDir || !codeDir || !epic) { console.error('Dùng: check-report.mjs <spec-dir> <code-dir> --epic <EPIC>'); process.exit(2); }

const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, acc) : acc.push(p); }
  return acc;
};
const fmOf = (t) => {
  const fm = {};
  for (const l of (t.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '').split(/\r?\n/)) {
    const kv = l.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
};
// trình định dạng markdown căn lề bảng (thêm khoảng trắng): so khớp tiêu đề sau khi gộp khoảng trắng
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const rows = (t, headerStart) => {
  const ls = t.split(/\r?\n/), i = ls.findIndex((l) => squash(l).startsWith(headerStart));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 2; j < ls.length && ls[j].startsWith('|'); j++) out.push(ls[j].split('|').slice(1, -1).map((c) => c.trim()));
  return out;
};

const errors = [];
const reportPath = join(specDir, 'epics', epic, 'report.md');
const err = (m) => errors.push(`${reportPath}: ${m}`);
if (!existsSync(reportPath)) { console.error(`${reportPath}: chưa có báo cáo triển khai`); process.exit(1); }
const text = readFileSync(reportPath, 'utf8');
const fm = fmOf(text);
if (fm.epic !== epic) err(`epic trong frontmatter phải là ${epic}`);
if (!fm.test_command) err('thiếu test_command (lệnh test đã chạy)');
if (!fm.test_result) err('thiếu test_result (dòng tóm tắt do lệnh test in ra)');

// ID có thật trong spec; tài liệu test của epic
const specIds = new Set(), tests = [];
for (const f of walk(specDir)) {
  if (!f.endsWith('.md')) continue;
  const id = (readFileSync(f, 'utf8').match(/^id:\s*(\S+)/m) ?? [])[1];
  if (id) specIds.add(id);
  if (id && /-(TC|E2E)-/.test(id) && f.includes(join('epics', epic))) tests.push(id);
  if (/[\\/]ui[\\/][^\\/]+\.md$/.test(f) && f.includes(join('epics', epic))) specIds.add(`ui/${f.split(/[\\/]/).at(-1).replace(/\.md$/, '')}`);
}

// kế hoạch task
const tasks = rows(text, '| # | Task');
if (!tasks?.length) err('thiếu bảng "Kế hoạch task" (| # | Task | Nguồn | Phụ thuộc | Trạng thái |)');
else {
  const nums = new Set(tasks.map((t) => t[0]));
  for (const [n, , src, dep, st] of tasks) {
    if (!['todo', 'doing', 'done', 'blocked'].includes(st)) err(`task ${n}: Trạng thái phải là todo|doing|done|blocked`);
    for (const s of src.split(',').map((x) => x.trim()).filter((x) => x && x !== '-')) if (!specIds.has(s)) err(`task ${n}: Nguồn ${s} không có trong spec/`);
    for (const d of dep.split(',').map((x) => x.trim()).filter((x) => x && x !== '-')) if (!nums.has(d)) err(`task ${n}: Phụ thuộc ${d} không phải số task`);
  }
}

// kết quả test
const res = rows(text, '| ID | Loại');
if (!res) err('thiếu bảng "Kết quả test" (| ID | Loại | Test code | Kết quả | Ghi chú |)');
else {
  const listed = new Set();
  for (const [id, , path, kq, note] of res) {
    listed.add(id);
    if (!tests.includes(id)) err(`${id}: không phải test case/E2E của epic ${epic} trong spec`);
    if (!['pass', 'fail', 'skip'].includes(kq)) err(`${id}: Kết quả phải là pass|fail|skip`);
    if (kq === 'skip' && (!note || note === '-')) err(`${id}: skip phải có lý do ở Ghi chú`);
    const p = resolve(codeDir, path);
    if (!existsSync(p) || !statSync(p).isFile()) err(`${id}: file test không tồn tại: ${path}`);
    else if (!readFileSync(p, 'utf8').includes(id)) err(`${id}: file ${path} không chứa ID (đặt ID vào tên test hoặc comment để truy vết)`);
  }
  for (const id of tests) if (!listed.has(id)) err(`thiếu dòng cho ${id} (test case của epic chưa có trong báo cáo)`);
}
if (!/^## Lệch spec\s*\n+\S/m.test(text)) err('thiếu mục "## Lệch spec" có nội dung (hoặc ghi "Không có")');

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: báo cáo triển khai epic ${epic} khớp spec và mã nguồn.`);
