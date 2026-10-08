#!/usr/bin/env node
// Kiểm đột biến dùng chung cho implement và review: gài từng đột biến, chạy test, luôn khôi phục tệp, phân loại kết quả.
// Dùng: node mutate.mjs <mutations.json> [--cwd <thư-mục-gốc-mã>]
//   mutations.json: { "test": "pnpm test", "mutations": [ { "id": "M1", "file": "src/a.ts", "find": "đoạn gốc", "replace": "đoạn thay", "test": "(tùy chọn, thay lệnh chung)", "equivalent": "(tùy chọn) lý do tương đương" } ] }
//   Kết quả: bắt (test đỏ do khẳng định) | lọt (test xanh) | hỏng biên dịch (không tính là bắt) | không áp dụng được (đoạn gốc không có đúng một lần).
//   Thoát 1 nếu có `lọt` chưa ghi `equivalent`, `hỏng biên dịch` hoặc `không áp dụng được`; thoát 2 nếu test nền đỏ hoặc dùng sai.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const cwd = resolve(argv.includes('--cwd') ? argv[argv.indexOf('--cwd') + 1] : '.');
const cfgPath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--cwd');
if (!cfgPath || !existsSync(cfgPath)) { console.error('Dùng: mutate.mjs <mutations.json> [--cwd <gốc mã>]'); process.exit(2); }
const { test: defaultTest, mutations = [] } = JSON.parse(readFileSync(cfgPath, 'utf8'));
const sh = (cmd) => spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 600000 });
// ponytail: nhận diện lỗi biên dịch bằng mẫu chữ; thêm mẫu khi gặp công cụ mới
const COMPILE = /error TS\d+|SyntaxError|Cannot find module|Failed to compile|Test suite failed to run|ParseError|Unexpected token/i;

// test nền phải xanh trước, nếu không mọi đột biến đều "bắt" giả
for (const cmd of new Set(mutations.map((m) => m.test ?? defaultTest))) {
  if (sh(cmd).status !== 0) { console.error(`test nền đang đỏ (${cmd}): sửa trước khi gài đột biến`); process.exit(2); }
}

const originals = new Map(); // tệp -> nội dung gốc; khôi phục cả khi bị ngắt
const restore = () => { for (const [f, t] of originals) writeFileSync(f, t); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130); });

const out = ['| Đột biến | Kết quả | Ghi chú |', '|---|---|---|'];
let bad = 0;
for (const m of mutations) {
  const f = join(cwd, m.file);
  const src = existsSync(f) ? readFileSync(f, 'utf8') : '';
  if (!originals.has(f)) originals.set(f, src);
  let kq, note = '-';
  if (!m.find || src.split(m.find).length !== 2) { kq = 'không áp dụng được'; note = 'đoạn gốc không có đúng một lần'; bad++; }
  else {
    try {
      writeFileSync(f, src.replace(m.find, () => m.replace));
      const r = sh(m.test ?? defaultTest);
      if (r.status === 0) { kq = 'lọt'; m.equivalent ? (note = `tương đương: ${m.equivalent}`) : bad++; }
      else if (COMPILE.test(`${r.stdout}\n${r.stderr}`)) { kq = 'hỏng biên dịch'; note = 'sửa đột biến cho biên dịch được'; bad++; }
      else kq = 'bắt';
    } finally { writeFileSync(f, src); }
  }
  out.push(`| ${m.id} | ${kq} | ${note} |`);
}
restore();
console.log(out.join('\n'));
process.exit(bad ? 1 : 0);
