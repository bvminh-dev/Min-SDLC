#!/usr/bin/env node
// Kiểm hình thức tài liệu màn hình `spec/epics/<EPIC>/ui/*.md` và SINH `spec/testids.md` từ chúng.
// Dùng: node check-ui.mjs [spec-dir, mặc định ./spec] [--epic <EPIC>] [--strict]
//  --epic:   chỉ kiểm phủ requirement của epic đó
//  --strict: requirement chưa có màn nào cũng là lỗi (mặc định chỉ cảnh báo vì có requirement hệ thống không có UI)
//  --check:  chỉ kiểm, không ghi testids.md (hook dùng)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.indexOf(n);
const epicOnly = flag('--epic') >= 0 ? argv[flag('--epic') + 1] : null;
const strict = flag('--strict') >= 0;
const checkOnly = flag('--check') >= 0;
const specDir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--epic') ?? 'spec';
if (!existsSync(specDir)) { console.error(`Không thấy thư mục spec: ${specDir}`); process.exit(2); }

const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, acc) : n.endsWith('.md') && acc.push(p);
  }
  return acc;
};
const fmOf = (t) => {
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  for (const l of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = l.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (!kv) continue;
    fm[kv[1]] = kv[2].startsWith('[') ? kv[2].slice(1, kv[2].lastIndexOf(']')).split(',').map((s) => s.trim()).filter(Boolean) : kv[2];
  }
  return fm;
};
const section = (t, name) => t.split(/^## /m).find((s) => s.startsWith(name))?.split(/\r?\n/).slice(1).join('\n') ?? null;
const rows = (s) => (s ?? '').split(/\r?\n/).filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

const errors = [], warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);

// requirement đã có: ID -> { epic, roles }
const reqs = new Map();
for (const f of walk(specDir)) {
  const fm = fmOf(readFileSync(f, 'utf8'));
  if (fm.id?.includes('-REQ-')) reqs.set(fm.id, { epic: fm.epic, roles: fm.roles ?? [] });
}
const matrix = join(specDir, 'permissions-matrix.md');
const matrixRoles = existsSync(matrix)
  ? readFileSync(matrix, 'utf8').split(/\r?\n/).find((l) => l.startsWith('| Hành động'))?.split('|').map((s) => s.trim()).slice(3).filter(Boolean)
  : null;

const screens = walk(specDir).filter((f) => dirname(f).endsWith('/ui') || dirname(f).endsWith('\\ui'));
const seen = new Map(); // testid -> file
const covered = new Set();
const out = [];
const TESTID = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

for (const f of screens) {
  const text = readFileSync(f, 'utf8');
  const fm = fmOf(text);
  const folderEpic = f.split(/[\\/]/).at(-3);
  if (fm.screen !== basename(f, '.md')) err(f, `screen phải trùng tên file (${basename(f, '.md')})`);
  if (fm.epic !== folderEpic) err(f, `epic phải trùng thư mục (${folderEpic})`);
  if (!['draft', 'approved', 'superseded'].includes(fm.status)) err(f, 'status phải là draft|approved|superseded');
  const covers = fm.covers ?? [];
  if (!covers.length) err(f, 'thiếu covers');
  for (const id of covers) {
    if (!reqs.has(id)) err(f, `covers trỏ tới requirement không tồn tại: ${id}`);
    else if (reqs.get(id).epic !== fm.epic) err(f, `covers ${id} thuộc epic ${reqs.get(id).epic}, màn này thuộc ${fm.epic}`);
    covered.add(id);
  }
  // màn chỉ được phục vụ role mà requirement nó phủ cho phép
  const allowed = new Set(covers.flatMap((id) => reqs.get(id)?.roles ?? []));
  for (const r of fm.roles ?? []) {
    if (matrixRoles && !matrixRoles.includes(r)) err(f, `role "${r}" không có trong ma trận quyền`);
    else if (!allowed.has(r)) err(f, `role "${r}" không nằm trong roles của các requirement mà màn này phủ`);
  }
  if (!(fm.roles ?? []).length) err(f, 'thiếu roles');
  for (const s of ['Wireframe', 'Trạng thái', 'Phần tử']) if (section(text, s) == null) err(f, `thiếu mục "## ${s}"`);
  if (!rows(section(text, 'Trạng thái')).some((r) => r[0] === 'lỗi')) err(f, 'mục Trạng thái phải có dòng "lỗi"');
  for (const [, , req] of rows(section(text, 'Trạng thái'))) if (req && !covers.includes(req)) err(f, `Trạng thái nhắc ${req} ngoài covers`);
  const els = rows(section(text, 'Phần tử'));
  if (!els.length) err(f, 'mục Phần tử trống');
  for (const [id, el, role, action, req] of els) {
    if (!TESTID.test(id)) err(f, `testid sai định dạng: ${id}`);
    else if (!id.startsWith(`${fm.epic?.toLowerCase()}-${fm.screen}-`)) err(f, `testid phải bắt đầu bằng ${fm.epic?.toLowerCase()}-${fm.screen}-: ${id}`);
    if (seen.has(id)) err(f, `testid trùng với ${seen.get(id)}: ${id}`);
    seen.set(id, f);
    if (!covers.includes(req)) err(f, `phần tử ${id}: Requirement ${req} không nằm trong covers`);
    // quyền theo TỪNG phần tử: role của phần tử ⊆ role của màn và ⊆ roles của requirement mà phần tử phục vụ
    const elRoles = role === '-' || !role ? [] : role.split(',').map((r) => r.trim());
    if (!elRoles.length) err(f, `phần tử ${id}: thiếu role (ghi các role thấy/dùng được phần tử, hoặc chọn từ roles của màn)`);
    for (const r of elRoles) {
      if (!(fm.roles ?? []).includes(r)) err(f, `phần tử ${id}: role "${r}" không nằm trong roles của màn`);
      else if (reqs.has(req) && !reqs.get(req).roles.includes(r)) err(f, `phần tử ${id}: role "${r}" không nằm trong roles của ${req}`);
    }
    out.push([id, fm.screen, fm.epic, el, elRoles.join(', '), req]);
  }
}

// phủ requirement
const uncovered = [...reqs].filter(([id, r]) => (!epicOnly || r.epic === epicOnly) && !covered.has(id)).map(([id]) => id);
if (uncovered.length) (strict ? errors : warnings).push(`requirement chưa có màn nào (bỏ qua nếu là requirement hệ thống không có UI): ${uncovered.join(', ')}`);

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }

out.sort((a, b) => a[0].localeCompare(b[0]));
if (!checkOnly) writeFileSync(join(specDir, 'testids.md'), [
  '# Test ID', '',
  'Sinh tự động bởi `.claude/skills/sdlc-ui-ux/scripts/check-ui.mjs` từ `spec/epics/*/ui/*.md`. **Không sửa tay.**', '',
  '| testid | Màn | Epic | Phần tử | Role | Requirement |', '|---|---|---|---|---|---|',
  ...out.map((r) => `| ${r.join(' | ')} |`), '',
].join('\n'));
console.log(`OK: ${screens.length} màn, ${out.length} testid${checkOnly ? '' : `, đã ghi ${join(specDir, 'testids.md')}`}.`);
for (const w of warnings) console.log(`Lưu ý: ${w}`);
