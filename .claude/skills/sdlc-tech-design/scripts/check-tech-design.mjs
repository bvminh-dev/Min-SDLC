#!/usr/bin/env node
// Kiểm tài liệu thiết kế `spec/epics/<EPIC>/design/*.md` (DB, API, SEC) với domain model, kiến trúc và baseline.
// Hình thức chung (ID, links, status) do check-spec.mjs kiểm; file này kiểm phần nhất quán chéo.
// Dùng: node check-tech-design.mjs [spec-dir, mặc định ./spec] [--epic <EPIC>] [--strict]
//  --strict: entity chưa có DB / epic có API mà chưa có SEC cũng là lỗi (mặc định chỉ cảnh báo)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const epicOnly = argv.includes('--epic') ? argv[argv.indexOf('--epic') + 1] : null;
const strict = argv.includes('--strict');
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
const read = (rel) => (existsSync(join(specDir, rel)) ? readFileSync(join(specDir, rel), 'utf8') : '');
const fmOf = (t) => {
  const fm = {};
  for (const l of (t.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '').split(/\r?\n/)) {
    const kv = l.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (kv) fm[kv[1]] = kv[2].startsWith('[') ? kv[2].slice(1, kv[2].lastIndexOf(']')).split(',').map((s) => s.trim()).filter(Boolean) : kv[2];
  }
  return fm;
};
const section = (t, name) => t.split(/^## /m).find((s) => s.startsWith(name))?.split(/\r?\n/).slice(1).join('\n') ?? null;
const rows = (s) => (s ?? '').split(/\r?\n/).filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const list = (c) => (c === '-' || !c ? [] : c.split(',').map((s) => s.trim()).filter(Boolean));
// trình định dạng markdown căn lề bảng (thêm khoảng trắng): so khớp tiêu đề sau khi gộp khoảng trắng
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const tableAfter = (t, headerStart) => {
  const ls = t.split(/\r?\n/), i = ls.findIndex((l) => squash(l).startsWith(headerStart));
  if (i < 0) return [];
  const out = [];
  for (let j = i + 2; j < ls.length && ls[j].startsWith('|'); j++) out.push(ls[j].split('|').slice(1, -1).map((c) => c.trim()));
  return out;
};

// ---- nền: entity, vòng đời, module, event, SB, role ----
const entText = read('domain/entities.md');
const owner = new Map(tableAfter(entText, '| Entity | Epic').map((r) => [r[0], r[1]]));
const lifecycle = new Map(); // entity -> Set(trạng thái)
for (const [e, from, to] of tableAfter(entText, '| Entity | Từ')) {
  if (!lifecycle.has(e)) lifecycle.set(e, new Set());
  lifecycle.get(e).add(from).add(to);
}
const modDeps = new Map(tableAfter(read('architecture.md'), '| Epic | Module').map((r) => [r[0], list(r[2])]));
const events = new Map(tableAfter(read('domain/events.md'), '| Event | Entity').map((r) => [r[0], { producer: r[2], consumers: list(r[3]) }]));
const sbIds = new Set([...read('security-baseline.md').matchAll(/^\| (SB-\d+) \|/gm)].map((m) => m[1]));
const matrixRoles = read('permissions-matrix.md').split(/\r?\n/).find((l) => l.startsWith('| Hành động'))?.split('|').map((s) => s.trim()).slice(3).filter(Boolean) ?? [];
const reqs = new Map();
for (const f of walk(specDir)) {
  const fm = fmOf(readFileSync(f, 'utf8'));
  if (fm.id?.includes('-REQ-')) reqs.set(fm.id, fm.roles ?? []);
}

// bảng -> epic sở hữu: từ các tài liệu DB (cột Bảng/Entity) và quy ước snake_case số nhiều của tên entity (User -> users)
const tableOwner = new Map([...owner].map(([e, ep]) => [e.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() + 's', ep]));
for (const f of walk(specDir)) {
  const t = readFileSync(f, 'utf8'), fm = fmOf(t);
  if (fm.id?.includes('-DB-')) for (const r of rows(section(t, 'Bảng'))) if (owner.has(r[1])) tableOwner.set(r[0], owner.get(r[1]));
}

const errors = [], warnings = [];
const docs = walk(specDir).filter((f) => /[\\/]design[\\/]/.test(f)).map((f) => ({ f, text: readFileSync(f, 'utf8') }))
  .map((d) => ({ ...d, fm: fmOf(d.text) })).filter((d) => !epicOnly || d.fm.epic === epicOnly);
const err = (f, m) => errors.push(`${f}: ${m}`);
const endpoints = new Map(), dbEntities = new Set(), apiEpics = new Set(), secEpics = new Set();

for (const { f, text, fm } of docs) {
  const type = fm.id?.split('-')[1];
  if (!['DB', 'API', 'SEC'].includes(type)) { err(f, 'ID phải có loại DB, API hoặc SEC'); continue; }
  const folderEpic = f.split(/[\\/]/).at(-3);
  if (fm.epic !== folderEpic) err(f, `epic phải trùng thư mục (${folderEpic})`);
  if (!(fm.links ?? []).length) err(f, 'thiếu links tới requirement mà thiết kế phục vụ');
  const roleOf = (id) => reqs.get(id) ?? [];

  if (type === 'DB') {
    const ents = fm.entities ?? [];
    for (const e of ents) {
      if (owner.get(e) !== fm.epic) err(f, `entity ${e} ${owner.has(e) ? `thuộc epic ${owner.get(e)}` : 'chưa có trong entities.md'}, không thuộc ${fm.epic}`);
      dbEntities.add(e);
    }
    for (const r of rows(section(text, 'Bảng'))) {
      if (!ents.includes(r[1])) err(f, `bảng ${r[0]}: entity ${r[1]} ngoài frontmatter entities`);
      // khóa ngoại chỉ được trỏ vào bảng của chính epic hoặc của module nằm trong Phụ thuộc (architecture.md); ngoài ra dùng cột tham chiếu không FK
      for (const m of r.slice(2).join(' ').matchAll(/\bFK\s*(?:->|→)?\s*([a-z][a-z0-9_]*)|\bREFERENCES\s+([a-z][a-z0-9_]*)|(?:->|→)\s*([a-z][a-z0-9_]*)\.[a-z_]+/gi)) {
        const target = m[1] ?? m[2] ?? m[3], ep = tableOwner.get(target);
        if (ep && ep !== fm.epic && !(modDeps.get(fm.epic) ?? []).includes(ep)) err(f, `bảng ${r[0]}: FK ${target} thuộc epic ${ep}, không có trong Phụ thuộc của ${fm.epic} ở architecture.md (dùng cột tham chiếu không FK và ghi [OPEN], hoặc ADR mới)`);
      }
    }
    const stated = new Map();
    for (const [e, s] of rows(section(text, 'Trạng thái hợp lệ'))) (stated.get(e) ?? stated.set(e, new Set()).get(e)).add(s);
    for (const e of ents.filter((x) => lifecycle.has(x))) {
      const want = lifecycle.get(e), have = stated.get(e) ?? new Set();
      const miss = [...want].filter((s) => !have.has(s)), extra = [...have].filter((s) => !want.has(s));
      if (miss.length || extra.length) err(f, `entity ${e}: trạng thái lệch vòng đời (thiếu: ${miss.join(', ') || '-'}; thừa: ${extra.join(', ') || '-'})`);
    }
  }

  if (type === 'API') {
    apiEpics.add(fm.epic);
    const rowsApi = rows(section(text, 'Endpoint'));
    if (!rowsApi.length) err(f, 'mục Endpoint trống');
    for (const [method, path, role, req, errs] of rowsApi) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) err(f, `method sai: ${method}`);
      if (!path.startsWith('/api/v1/')) err(f, `path phải bắt đầu bằng /api/v1/ (ADR-006): ${path}`);
      const key = `${method} ${path}`;
      if (endpoints.has(key)) err(f, `endpoint trùng với ${endpoints.get(key)}: ${key}`);
      endpoints.set(key, f);
      if (!(fm.links ?? []).includes(req)) err(f, `${key}: Requirement ${req} không nằm trong links`);
      const roles = list(role);
      if (!roles.length) err(f, `${key}: thiếu role`);
      for (const r of roles) {
        if (!matrixRoles.includes(r)) err(f, `${key}: role "${r}" không có trong ma trận quyền`);
        else if (!roleOf(req).includes(r)) err(f, `${key}: role "${r}" không nằm trong roles của ${req}`);
      }
      // `guest` (công khai) và `system` (webhook, tác nhân hệ thống xác thực bằng chữ ký, không có phiên) không bắt buộc 401/403
      if (roles.some((r) => r !== 'guest' && r !== 'system') && !(/\b401\b/.test(errs) && /\b403\b/.test(errs))) err(f, `${key}: endpoint cần đăng nhập phải khai lỗi 401 và 403`);
    }
    for (const dep of fm.depends_on ?? []) if (!(modDeps.get(fm.epic) ?? []).includes(dep)) err(f, `depends_on ${dep} không có trong Phụ thuộc của ${fm.epic} ở architecture.md (cần ADR mới)`);
    for (const ev of fm.emits ?? []) if (events.get(ev)?.producer !== fm.epic) err(f, `emits ${ev}: ${events.has(ev) ? `bên phát là ${events.get(ev).producer}` : 'không có trong events.md'}`);
    for (const ev of fm.consumes ?? []) if (!events.get(ev)?.consumers.includes(fm.epic)) err(f, `consumes ${ev}: ${fm.epic} không nằm trong Consumers ở events.md`);
  }

  if (type === 'SEC') {
    secEpics.add(fm.epic);
    const rowsSec = rows(section(text, 'Mối đe dọa'));
    if (!rowsSec.length) err(f, 'mục Mối đe dọa trống');
    const codes = new Set();
    for (const [code, stride, , , measure, sb, check] of rowsSec) {
      if (codes.has(code)) err(f, `mã ${code} bị trùng`);
      codes.add(code);
      if (!/^[STRIDE]$/.test(stride)) err(f, `${code}: STRIDE phải là một chữ S, T, R, I, D hoặc E`);
      if (!measure) err(f, `${code}: thiếu biện pháp`);
      if (!/\b(test|hook|script|config|review)\b/.test(check)) err(f, `${code}: Kiểm bằng phải chứa test, hook, script, config hoặc review`);
      for (const id of list(sb)) if (!sbIds.has(id)) err(f, `${code}: ${id} không có trong security-baseline.md`);
      if (!list(sb).length) warnings.push(`${f}: ${code} là biện pháp mới (SB "-"), cần thêm vào security-baseline.md qua sdlc-foundation`);
    }
  }
}

// phủ
const epics = epicOnly ? [epicOnly] : [...new Set(docs.map((d) => d.fm.epic))];
const lack = [];
for (const e of epics) {
  const noDb = [...owner].filter(([n, o]) => o === e && !dbEntities.has(n)).map(([n]) => n);
  if (noDb.length) lack.push(`epic ${e}: entity chưa có thiết kế DB: ${noDb.join(', ')}`);
  if (apiEpics.has(e) && !secEpics.has(e)) lack.push(`epic ${e}: có API nhưng chưa có thiết kế SEC`);
}
(strict ? errors : warnings).push(...lack);

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: ${docs.length} tài liệu thiết kế hợp lệ.`);
for (const w of warnings) console.log(`Lưu ý: ${w}`);
