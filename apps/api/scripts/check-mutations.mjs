#!/usr/bin/env node
// Kiểm CHÍNH bảng đột biến của một epic (dùng với `.claude/skills/sdlc-review/scripts/mutate.mjs`, không chạy test): bảng không lỗi thời và phủ mọi SB `Kiểm bằng: test`.
// Dùng: node scripts/check-mutations.mjs <mutations.json> --sec <tài-liệu-SEC.md> [--cwd <gốc-mã>]
//   mutations.json: { "test": "...", "mutations": [ { "id", "sb": ["SB-10"], "tc": "PRD-TC-...", "file", "find", "replace", "test": "node scripts/run-jest.mjs <tệp test> -t \"<tc>\"", "equivalent"? } ] }
// Đỏ (thoát 1) khi: không đọc được tài liệu SEC hay không tìm thấy SB nào kiểm bằng test; SB `test` chưa có đột biến; `find` không có đúng một lần; đột biến không đổi gì;
// tệp mã hay tệp test không có; tệp test không chứa ID `tc` (lệnh `-t` sẽ chạy 0 test và "đỏ" giả).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const cwd = resolve(opt('--cwd') ?? '.');
const [table, sec] = [argv.find((a, i) => !a.startsWith('--') && !['--sec', '--cwd'].includes(argv[i - 1])), opt('--sec')];
if (!table || !sec) { console.error('Dùng: check-mutations.mjs <mutations.json> --sec <SEC.md> [--cwd <gốc mã>]'); process.exit(2); }
const out = [];
const bad = (m) => out.push(m);

let doc = null;
try { doc = JSON.parse(readFileSync(table, 'utf8')); } catch { bad(`không đọc được bảng đột biến ${table}`); }
const muts = doc?.mutations ?? [];

// SB có Kiểm bằng `test` trong tài liệu SEC (cột 6 là SB, cột 7 là Kiểm bằng của bảng mối đe dọa)
const required = new Set();
if (!existsSync(sec)) bad(`không đọc được tài liệu SEC ${sec}`);
else {
  for (const l of readFileSync(sec, 'utf8').split(/\r?\n/)) {
    if (!/^\|\s*T\d+\s*\|/.test(l)) continue;
    const c = l.split('|').slice(1, -1).map((x) => x.trim());
    if (c.length >= 7 && /\btest\b/.test(c[6])) for (const m of c[5].matchAll(/SB-\d+/g)) required.add(m[0]);
  }
  if (!required.size) bad(`không tìm thấy SB nào có Kiểm bằng \`test\` trong ${sec}`);
}
const covered = new Set(muts.flatMap((m) => m.sb ?? []));
for (const sb of [...required].sort()) if (!covered.has(sb)) bad(`${sb}: SB \`Kiểm bằng: test\` chưa có đột biến nào`);

for (const m of muts) {
  const at = `đột biến "${m.id}"`;
  const f = join(cwd, m.file ?? '');
  if (!m.file || !existsSync(f)) { bad(`${at}: không có tệp ${m.file}`); continue; }
  const n = readFileSync(f, 'utf8').split(m.find ?? '\u0000').length - 1;
  if (n === 0) bad(`${at}: không thấy đoạn cần phá trong ${m.file}`);
  else if (n > 1) bad(`${at}: đoạn cần phá xuất hiện ${n} lần trong ${m.file} (mơ hồ)`);
  if (m.find === m.replace) bad(`${at}: đột biến không đổi gì`);
  const testFile = (m.test ?? doc?.test ?? '').match(/(?:^|\s)((?:test|\.\.?)\/[\w./-]+\.spec\.ts)/)?.[1];
  if (!testFile || !existsSync(join(cwd, testFile))) bad(`${at}: không có tệp test (${testFile ?? 'lệnh không nêu tệp .spec.ts'})`);
  else if (!m.tc || !readFileSync(join(cwd, testFile), 'utf8').includes(m.tc)) bad(`${at}: ${testFile} không chứa ID ${m.tc}`);
}
if (out.length) { console.error(out.join('\n')); process.exit(1); }
console.log(`check-mutations: ${muts.length} đột biến hợp lệ, phủ ${required.size} SB kiểm bằng test (${[...required].sort().join(', ')})`);
