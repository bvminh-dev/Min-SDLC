#!/usr/bin/env node
// Duyệt hàng loạt có ỦY QUYỀN và có ghi vết: đổi `status: draft` thành `status: approved` cho tài liệu spec.
// Dùng khi người dùng đã ủy quyền rõ ràng cho Claude duyệt thay (hook guard-approved vẫn chặn Claude tự sửa status bằng Edit/Write).
//   node approve.mjs --reason "<vì sao>" --authorized-by "<ai ủy quyền, trích câu>" [--spec spec] <đường-dẫn-file-hoặc-thư-mục>...
// Cổng kiểm (một cổng fail là không duyệt file nào):
//  - bắt buộc có --reason và --authorized-by (ghi vào nhật ký);
//  - tài liệu epic và nền: không còn `[OPEN]` hoặc `NEEDS CLARIFICATION` (P8); file bài học (spec/lessons/) được miễn vì chúng nhắc tới các chuỗi đó;
//  - toàn bộ spec phải qua `check-spec.mjs` (và `check-foundation.mjs` nếu đã dựng nền).
// Mỗi file được duyệt ghi một dòng vào .claude/sdlc/change-control.log.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const flagVals = new Set(['--reason', '--authorized-by', '--spec']);
const specDir = resolve(opt('--spec') ?? 'spec');
const reason = opt('--reason')?.trim();
const by = opt('--authorized-by')?.trim();
const targets = argv.filter((a, i) => !a.startsWith('--') && !flagVals.has(argv[i - 1]));
if (!reason || !by || !targets.length) {
  console.error('Dùng: approve.mjs --reason "<vì sao>" --authorized-by "<ai ủy quyền>" [--spec spec] <đường-dẫn>...');
  process.exit(2);
}
const root = dirname(specDir);
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OPEN_RE = /\[OPEN\]|NEEDS CLARIFICATION/;

const walk = (p, acc = []) => {
  const abs = resolve(p);
  if (!existsSync(abs)) return acc;
  if (statSync(abs).isDirectory()) for (const n of readdirSync(abs)) walk(join(abs, n), acc);
  else if (abs.endsWith('.md')) acc.push(abs);
  return acc;
};
const statusOf = (t) => t.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^status:\s*(\w+)/m)?.[1];

const files = [...new Set(targets.flatMap((t) => walk(t)))].filter((f) => statusOf(readFileSync(f, 'utf8')) === 'draft');
if (!files.length) { console.log('Không có tài liệu draft nào trong phạm vi để duyệt.'); process.exit(0); }

const errors = [];
for (const f of files) {
  const rel = relative(root, f).split(sep).join('/');
  if (rel.startsWith('spec/lessons/')) continue;
  if (OPEN_RE.test(readFileSync(f, 'utf8'))) errors.push(`${rel}: còn [OPEN]/NEEDS CLARIFICATION (P8), giải quyết trước khi duyệt`);
}
const run = (script, ...args) => spawnSync(process.execPath, [join(kit, script), ...args], { encoding: 'utf8' });
const cs = run('skills/sdlc-research/scripts/check-spec.mjs', specDir);
if (cs.status === 1) errors.push(`check-spec không qua:\n${cs.stderr.trim()}`);
if (existsSync(join(specDir, 'architecture.md'))) {
  const cf = run('skills/sdlc-foundation/scripts/check-foundation.mjs', specDir);
  if (cf.status === 1) errors.push(`check-foundation không qua:\n${cf.stderr.trim()}`);
}
if (errors.length) { console.error(`Không duyệt (${errors.length} cổng fail):\n${errors.join('\n')}`); process.exit(1); }

const logPath = join(root, '.claude/sdlc/change-control.log');
mkdirSync(dirname(logPath), { recursive: true });
let n = 0;
for (const f of files) {
  const t = readFileSync(f, 'utf8');
  writeFileSync(f, t.replace(/^(---\r?\n(?:[\s\S]*?\r?\n)?)status:\s*draft\b/, '$1status: approved'));
  const rel = relative(root, f).split(sep).join('/');
  appendFileSync(logPath, `${new Date().toISOString()}\tDUYỆT ỦY QUYỀN draft -> approved\t${rel}\treason: ${reason}\tsolution: duyệt bằng approve.mjs sau khi qua cổng kiểm (không còn OPEN, check-spec, check-foundation)\tauthorized_by: ${by}\n`);
  n++;
}
console.log(`Đã duyệt ${n} tài liệu (ghi vào ${relative(root, logPath)}).`);
