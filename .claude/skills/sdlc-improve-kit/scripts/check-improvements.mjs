#!/usr/bin/env node
// Kiểm nhật ký cải tiến `.claude/sdlc/improvements.md`: mỗi mục trỏ tới file bài học đã approved, mã bài học có thật,
// file đã đổi và ca hồi quy tồn tại, kết quả selftest dạng N/N qua (không fail).
// Dùng: node check-improvements.mjs [thư-mục-gốc-dự-án, mặc định .]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.';
const logPath = join(root, '.claude/sdlc/improvements.md');
if (!existsSync(logPath)) { console.error(`Không thấy ${logPath}`); process.exit(2); }
const text = readFileSync(logPath, 'utf8');
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
const errors = [];
const err = (m) => errors.push(`${logPath}: ${m}`);

const entries = text.split(/^## /m).slice(1).filter((e) => /^\d{4}-\d{2}-\d{2} \|/.test(e));
for (const e of entries) {
  const [head, ...rest] = e.split(/\r?\n/);
  const m = head.match(/^(\d{4}-\d{2}-\d{2}) \| (\S+)/);
  const lessonRel = m[2];
  const lessonPath = join(root, lessonRel);
  if (!existsSync(lessonPath)) { err(`${head}: file bài học không tồn tại`); continue; }
  const lesson = readFileSync(lessonPath, 'utf8');
  if (!/^status:\s*approved\b/m.test(lesson)) err(`${head}: file bài học phải approved mới được áp dụng`);
  const codes = new Set(lesson.split(/\r?\n/).filter((l) => /^\| L\d+ \|/.test(squash(l))).map((l) => cells(l)[0]));
  const lines = rest;
  const h = lines.findIndex((l) => squash(l).startsWith('| Mã | File đã đổi'));
  if (h < 0) { err(`${head}: thiếu bảng | Mã | File đã đổi | Ca hồi quy | Kết quả selftest |`); continue; }
  let n = 0;
  for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const [code, changed, regression, selftest] = cells(lines[i]); n++;
    if (!codes.has(code)) err(`${head}: mã ${code} không có trong file bài học`);
    const isSpec = changed === 'chuyển nền';
    if (!isSpec) for (const f of changed.split(',').map((s) => s.trim()).filter(Boolean)) if (!existsSync(join(root, f))) err(`${head} / ${code}: file đã đổi không tồn tại: ${f}`);
    if (!isSpec && (!regression || regression === '-' || !existsSync(join(root, regression)))) err(`${head} / ${code}: thiếu ca hồi quy có thật (file chứa assert hoặc golden/traps mới)`);
    const st = selftest.match(/^(\d+)\/(\d+) qua$/);
    if (!st || st[1] !== st[2]) err(`${head} / ${code}: kết quả selftest phải dạng N/N qua (mọi kiểm đều qua), đang là "${selftest}"`);
  }
  if (!n) err(`${head}: bảng trống`);
}
if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: ${entries.length} mục nhật ký cải tiến hợp lệ.`);
