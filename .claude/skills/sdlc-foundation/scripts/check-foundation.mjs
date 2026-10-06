#!/usr/bin/env node
// Kiểm HÌNH THỨC và tính NHẤT QUÁN CHÉO của tài liệu nền (foundation). Không đánh giá chất lượng quyết định.
// Dùng: node check-foundation.mjs [thư-mục-spec, mặc định ./spec] [--file <đường-dẫn>] [--lenient]
//  --lenient: không báo lỗi vì file nền chưa tồn tại (hook sau mỗi lần sửa). --file ngầm bật --lenient
//             và chỉ in lỗi thuộc file đó. Hook Stop chạy chế độ đầy đủ.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const fileIdx = argv.indexOf('--file');
const onlyFile = fileIdx >= 0 ? resolve(argv[fileIdx + 1] ?? '') : null;
const lenient = argv.includes('--lenient') || onlyFile !== null;
const fileValueIdx = fileIdx >= 0 ? fileIdx + 1 : -1;
const specDir = argv.filter((a, i) => !a.startsWith('--') && i !== fileValueIdx)[0] ?? 'spec';
if (!existsSync(specDir)) {
  console.error(`Không thấy thư mục spec: ${specDir}`);
  process.exit(2);
}

const errors = [];
const err = (file, msg) => errors.push({ file, msg });
const OPEN_RE = /\[OPEN\]|NEEDS CLARIFICATION/;
const STATUSES = ['draft', 'approved', 'superseded'];
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const REL_RE = /^(1|N)-(1|N)\s+([A-Z][A-Za-z0-9]*)$/;

const REL = {
  roadmap: 'roadmap.md',
  roles: 'domain/roles.md',
  entities: 'domain/entities.md',
  events: 'domain/events.md',
  arch: 'architecture.md',
  sec: 'security-baseline.md',
  constitution: 'constitution.md',
  matrix: 'permissions-matrix.md',
};
const doc = {};
for (const [k, rel] of Object.entries(REL)) {
  const path = resolve(specDir, rel);
  doc[k] = existsSync(path) ? { path, text: readFileSync(path, 'utf8') } : { path, text: null };
}

// trình định dạng markdown (Prettier...) escape ký tự đặc biệt (`*` thành `\*`): bỏ escape sau khi tách cột
const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/`/g, '').replace(/\\([*_#<>\[\]~])/g, '$1'));

// Mọi bảng có ô đầu của hàng tiêu đề là `first`. Trả về [{header, rows}].
function tables(text, first) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|') && cells(lines[i])[0] === first) {
      const header = cells(lines[i]);
      const rows = [];
      for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) rows.push(cells(lines[j]));
      out.push({ header, rows, line: i });
    }
  }
  return out;
}
const col = (t, name) => t.header.indexOf(name);

// Lấy bảng đầu tiên và kiểm có đủ cột; trả về null nếu thiếu (đã báo lỗi).
function need(d, first, columns) {
  const t = tables(d.text, first)[0];
  if (!t) {
    err(d.path, `thiếu bảng có cột đầu "${first}"`);
    return null;
  }
  for (const c of columns) {
    if (col(t, c) < 0) {
      err(d.path, `bảng "${first}" thiếu cột "${c}"`);
      return null;
    }
  }
  return t;
}

const present = (k) => {
  if (doc[k].text === null) {
    if (!lenient && k !== 'matrix') err(doc[k].path, 'thiếu file (chạy sdlc-foundation)');
    return false;
  }
  return true;
};

// ---- frontmatter + placeholder ----
function baseChecks(k) {
  const d = doc[k];
  const fm = d.text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const status = fm.match(/^status:\s*(\w+)/m)?.[1];
  if (!STATUSES.includes(status)) err(d.path, `thiếu hoặc sai status (${STATUSES.join('|')})`);
  if (status === 'approved' && OPEN_RE.test(d.text)) err(d.path, 'approved nhưng còn [OPEN] / NEEDS CLARIFICATION');
  if (k !== 'roadmap') {
    d.text.split(/\r?\n/).forEach((l, i) => {
      if (l.startsWith('|') && cells(l).some((c) => c === '...')) err(d.path, `dòng ${i + 1}: còn ô placeholder "..."`);
    });
  }
  return status;
}

// ---- roadmap: nguồn mã epic ----
let codes = null;
let epicNames = [];
if (present('roadmap')) {
  const t = tables(doc.roadmap.text, 'STT')[0];
  if (!t || col(t, 'Mã') < 0) err(doc.roadmap.path, 'roadmap phải có bảng với cột STT, Mã, Epic, Mục con');
  else {
    codes = t.rows.map((r) => r[col(t, 'Mã')]);
    epicNames = t.rows.map((r) => r[col(t, 'Epic')] ?? '');
    const bad = codes.filter((c) => !/^[A-Z]{2,4}$/.test(c));
    if (bad.length) err(doc.roadmap.path, `mã epic sai định dạng (2-4 chữ in hoa): ${bad.join(', ')}`);
    if (new Set(codes).size !== codes.length) err(doc.roadmap.path, 'mã epic bị trùng');
  }
}
const validEpic = (c) => codes === null || codes.includes(c);

// ---- roles ----
let roles = null;
if (present('roles')) {
  baseChecks('roles');
  const t = need(doc.roles, 'Role', ['Mô tả', 'Đăng nhập']);
  if (t) {
    roles = t.rows.map((r) => r[0]);
    if (new Set(roles).size !== roles.length) err(doc.roles.path, 'role bị trùng');
    for (const r of t.rows) if (!['có', 'không'].includes(r[col(t, 'Đăng nhập')])) err(doc.roles.path, `role ${r[0]}: cột Đăng nhập phải là "có" hoặc "không"`);
    if (roles.length === 0) err(doc.roles.path, 'chưa có role nào');
  }
}
if (roles && doc.matrix.text) {
  const header = doc.matrix.text.split(/\r?\n/).find((l) => l.startsWith('| Hành động'));
  if (header) {
    for (const r of header.split('|').map((s) => s.trim()).slice(3).filter(Boolean)) {
      if (!roles.includes(r)) err(doc.matrix.path, `role "${r}" trong ma trận quyền không có trong domain/roles.md`);
    }
  }
}

// ---- entities ----
let entities = null;
const states = new Map(); // entity -> Set(trạng thái) lấy từ bảng "Vòng đời chi tiết"
if (present('entities')) {
  baseChecks('entities');
  const t = need(doc.entities, 'Entity', ['Epic', 'Khóa', 'Thuộc tính chính', 'Quan hệ', 'Vòng đời']);
  if (t) {
    entities = t.rows.map((r) => r[0]);
    if (new Set(entities).size !== entities.length) err(doc.entities.path, 'entity bị trùng');
    for (const r of t.rows) {
      const name = r[0];
      if (!PASCAL.test(name)) err(doc.entities.path, `entity "${name}" phải viết PascalCase`);
      if (!validEpic(r[col(t, 'Epic')])) err(doc.entities.path, `entity ${name}: epic sở hữu "${r[col(t, 'Epic')]}" không có trong roadmap`);
      if (!r[col(t, 'Khóa')]) err(doc.entities.path, `entity ${name}: thiếu khóa`);
      const life = r[col(t, 'Vòng đời')];
      if (life !== '-' && life.split('->').map((s) => s.trim()).filter(Boolean).length < 2) {
        err(doc.entities.path, `entity ${name}: vòng đời cần ≥2 trạng thái nối bằng "->", hoặc "-"`);
      }
    }
    for (const r of t.rows) {
      const rel = r[col(t, 'Quan hệ')];
      if (rel === '-' || rel === '') continue;
      for (const part of rel.split(';').map((s) => s.trim()).filter(Boolean)) {
        const m = part.match(REL_RE);
        if (!m) err(doc.entities.path, `entity ${r[0]}: quan hệ "${part}" sai dạng "<1|N>-<1|N> <Entity>"`);
        else if (!t.rows.some((x) => x[0] === m[3])) err(doc.entities.path, `entity ${r[0]}: quan hệ tới "${m[3]}" nhưng entity đó chưa được định nghĩa`);
      }
    }
  }
}

// ---- vòng đời chi tiết: bảng chuyển trạng thái (gồm nhánh lỗi, hủy, hết hạn) ----
if (doc.entities.text !== null) {
  const all = tables(doc.entities.text, 'Entity');
  const tt = all.find((t) => col(t, 'Từ') >= 0 && col(t, 'Sang') >= 0);
  const main = all.find((t) => col(t, 'Vòng đời') >= 0);
  const path = doc.entities.path;
  if (tt) {
    for (const r of tt.rows) {
      const ent = r[0];
      const from = r[col(tt, 'Từ')];
      const to = r[col(tt, 'Sang')];
      if (entities && !entities.includes(ent)) err(path, `bảng chuyển trạng thái: entity "${ent}" chưa được định nghĩa`);
      if (!from || !to) err(path, `bảng chuyển trạng thái: entity ${ent} thiếu cột Từ hoặc Sang`);
      if (!states.has(ent)) states.set(ent, new Set());
      states.get(ent).add(from);
      states.get(ent).add(to);
    }
  }
  if (main) {
    for (const r of main.rows) {
      const life = r[col(main, 'Vòng đời')];
      if (life === '-') {
        if (states.has(r[0])) err(path, `entity ${r[0]} ghi không có vòng đời nhưng có dòng trong bảng chuyển trạng thái`);
        continue;
      }
      const have = states.get(r[0]);
      if (!have) {
        err(path, `entity ${r[0]} có vòng đời nhưng chưa có dòng nào trong "Vòng đời chi tiết"`);
        continue;
      }
      for (const s of life.split('->').map((x) => x.trim()).filter(Boolean)) {
        if (!have.has(s)) err(path, `entity ${r[0]}: trạng thái "${s}" ở cột Vòng đời không có trong bảng chuyển trạng thái`);
      }
    }
  }
}

// ---- events ----
if (present('events')) {
  baseChecks('events');
  const t = need(doc.events, 'Event', ['Entity', 'Producer', 'Consumers', 'Payload', 'Phát khi']);
  if (t) {
    const names = t.rows.map((r) => r[0]);
    if (new Set(names).size !== names.length) err(doc.events.path, 'event bị trùng');
    for (const r of t.rows) {
      const [name] = r;
      if (!PASCAL.test(name)) err(doc.events.path, `event "${name}" phải viết PascalCase`);
      const ent = r[col(t, 'Entity')];
      if (entities && !entities.includes(ent)) err(doc.events.path, `event ${name}: entity "${ent}" chưa được định nghĩa`);
      const prod = r[col(t, 'Producer')];
      if (!validEpic(prod)) err(doc.events.path, `event ${name}: producer "${prod}" không có trong roadmap`);
      const cons = r[col(t, 'Consumers')];
      if (cons !== '-') {
        for (const c of cons.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!validEpic(c)) err(doc.events.path, `event ${name}: consumer "${c}" không có trong roadmap`);
        }
      }
      if (!r[col(t, 'Payload')] || r[col(t, 'Payload')] === '-') err(doc.events.path, `event ${name}: thiếu payload`);
      const when = r[col(t, 'Phát khi')];
      if (when !== '-') {
        const m = (when ?? '').match(/^([A-Z][A-Za-z0-9]*):(\w+)$/);
        if (!m) err(doc.events.path, `event ${name}: "Phát khi" phải dạng Entity:trạng_thái, hoặc "-" nếu không gắn với đổi trạng thái`);
        else if (entities && !entities.includes(m[1])) err(doc.events.path, `event ${name}: phát khi entity "${m[1]}" chưa được định nghĩa`);
        else if (!states.get(m[1])?.has(m[2])) {
          err(doc.events.path, `event ${name}: phát khi ${m[1]}:${m[2]} nhưng trạng thái đó không có trong vòng đời của ${m[1]} (thêm vào "Vòng đời chi tiết")`);
        }
      }
    }
  }
}

// ---- architecture ----
if (present('arch')) {
  const status = baseChecks('arch');
  const text = doc.arch.text;
  const blocks = text.split(/^(?=### ADR-\d+)/m).filter((b) => /^### ADR-\d+/.test(b));
  const adrIds = blocks.map((b) => b.match(/^### (ADR-\d+)/)[1]);
  if (!blocks.length) err(doc.arch.path, 'chưa có ADR nào (### ADR-001 ...)');
  if (new Set(adrIds).size !== adrIds.length) err(doc.arch.path, 'ADR bị trùng mã');
  for (const b of blocks) {
    const id = b.match(/^### (ADR-\d+)/)[1];
    for (const f of ['Trạng thái', 'Bối cảnh', 'Phương án', 'Quyết định', 'Hệ quả']) {
      const m = b.match(new RegExp(`^- ${f}:\\s*(.*)$`, 'm'));
      if (!m || m[1].trim().length < 3 || m[1].trim().startsWith('...')) err(doc.arch.path, `${id}: thiếu nội dung mục "${f}"`);
    }
    const st = b.match(/^- Trạng thái:\s*(\w+)/m)?.[1];
    if (st && !['proposed', 'accepted', 'superseded'].includes(st)) err(doc.arch.path, `${id}: trạng thái phải là proposed|accepted|superseded`);
    if (status === 'approved' && st === 'proposed') err(doc.arch.path, `${id}: tài liệu approved nhưng ADR còn proposed`);
    if (st === 'proposed' && !/\[OPEN\]/.test(b)) err(doc.arch.path, `${id}: ADR proposed phải kèm [OPEN] nêu câu hỏi cho người quyết định`);
  }

  const mod = need(doc.arch, 'Epic', ['Module', 'Phụ thuộc']);
  if (mod) {
    const seen = mod.rows.map((r) => r[0]);
    if (new Set(seen).size !== seen.length) err(doc.arch.path, 'epic xuất hiện nhiều lần trong bảng ánh xạ module');
    if (codes) {
      for (const c of codes) if (!seen.includes(c)) err(doc.arch.path, `epic ${c} (roadmap) chưa có module trong bảng ánh xạ`);
      for (const c of seen) if (!codes.includes(c)) err(doc.arch.path, `bảng ánh xạ có epic "${c}" không có trong roadmap`);
    }
    const graph = new Map();
    for (const r of mod.rows) {
      const deps = r[col(mod, 'Phụ thuộc')] === '-' ? [] : r[col(mod, 'Phụ thuộc')].split(',').map((s) => s.trim()).filter(Boolean);
      graph.set(r[0], deps);
      for (const d of deps) {
        if (d === r[0]) err(doc.arch.path, `module ${r[0]} phụ thuộc chính nó`);
        else if (!validEpic(d)) err(doc.arch.path, `module ${r[0]} phụ thuộc epic "${d}" không có trong roadmap`);
      }
    }
    const state = new Map();
    const stack = [];
    const visit = (n) => {
      if (state.get(n) === 2) return;
      if (state.get(n) === 1) {
        err(doc.arch.path, `vòng phụ thuộc giữa các module: ${[...stack.slice(stack.indexOf(n)), n].join(' -> ')}`);
        return;
      }
      state.set(n, 1);
      stack.push(n);
      for (const d of graph.get(n) ?? []) if (graph.has(d)) visit(d);
      stack.pop();
      state.set(n, 2);
    };
    for (const n of graph.keys()) visit(n);
  }

  const cross = need(doc.arch, 'Mối quan tâm', ['ADR']);
  if (cross) {
    const have = cross.rows.map((r) => r[0].toLowerCase());
    for (const c of ['Project setup', 'Database', 'API structure', 'Environment configuration', 'Error handling', 'Logging']) {
      if (!have.includes(c.toLowerCase())) err(doc.arch.path, `thiếu mối quan tâm cắt ngang "${c}"`);
    }
    for (const r of cross.rows) {
      if (!adrIds.includes(r[col(cross, 'ADR')])) err(doc.arch.path, `mối quan tâm "${r[0]}" trỏ tới ADR không tồn tại: ${r[col(cross, 'ADR')]}`);
    }
  }
}

// ---- security baseline ----
if (present('sec')) {
  baseChecks('sec');
  const text = doc.sec.text;
  const needPayment = epicNames.some((n) => /payment|thanh toán/i.test(n));
  const sections = ['Xác thực và phiên', 'Phân quyền', 'Bảo vệ dữ liệu', 'Đầu vào và đầu ra', 'Bí mật và cấu hình', 'Log và audit'];
  if (needPayment) sections.push('Thanh toán và dữ liệu tài chính');
  const parts = text.split(/^## /m).slice(1);
  const allCodes = [];
  for (const s of sections) {
    const part = parts.find((p) => p.startsWith(s));
    if (!part) {
      err(doc.sec.path, `thiếu mục "## ${s}"`);
      continue;
    }
    const t = tables(part, 'Mã')[0];
    if (!t || !t.rows.length) err(doc.sec.path, `mục "${s}" chưa có dòng SB-nn nào`);
  }
  for (const part of parts) {
    for (const t of tables(part, 'Mã')) {
      for (const need_ of ['Yêu cầu', 'Kiểm bằng', 'Epic liên quan']) {
        if (col(t, need_) < 0) err(doc.sec.path, `bảng bảo mật thiếu cột "${need_}"`);
      }
      if (['Yêu cầu', 'Kiểm bằng', 'Epic liên quan'].some((c) => col(t, c) < 0)) continue;
      for (const r of t.rows) {
        const id = r[0];
        allCodes.push(id);
        if (!/^SB-\d{2,}$/.test(id)) err(doc.sec.path, `mã "${id}" phải dạng SB-01`);
        if (!r[col(t, 'Yêu cầu')]) err(doc.sec.path, `${id}: thiếu yêu cầu`);
        if (!/\b(test|hook|script|config|review)\b/.test(r[col(t, 'Kiểm bằng')])) err(doc.sec.path, `${id}: "Kiểm bằng" phải nêu test|hook|script|config|review`);
        const ep = r[col(t, 'Epic liên quan')];
        if (ep !== '*') for (const c of ep.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!validEpic(c)) err(doc.sec.path, `${id}: epic "${c}" không có trong roadmap`);
        }
      }
    }
  }
  if (new Set(allCodes).size !== allCodes.length) err(doc.sec.path, 'mã SB-nn bị trùng');
}

// ---- constitution ----
if (present('constitution')) {
  baseChecks('constitution');
  const t = need(doc.constitution, 'Mã', ['Nguyên tắc', 'Kiểm bằng']);
  if (t) {
    if (t.rows.length < 3) err(doc.constitution.path, 'cần ít nhất 3 nguyên tắc');
    const ids = t.rows.map((r) => r[0]);
    if (new Set(ids).size !== ids.length) err(doc.constitution.path, 'mã nguyên tắc bị trùng');
    for (const r of t.rows) {
      if (!/^P\d+$/.test(r[0])) err(doc.constitution.path, `mã "${r[0]}" phải dạng P1`);
      if (!/\b(test|hook|script|config|review)\b/.test(r[col(t, 'Kiểm bằng')])) err(doc.constitution.path, `${r[0]}: "Kiểm bằng" phải nêu test|hook|script|config|review`);
    }
  }
}

const shown = onlyFile ? errors.filter((e) => resolve(e.file) === onlyFile) : errors;
if (shown.length) {
  console.error(shown.map((e) => `${e.file}: ${e.msg}`).join('\n'));
  console.error(`\n${shown.length} lỗi nền (foundation).`);
  process.exit(1);
}
console.log(`OK: tài liệu nền hợp lệ${onlyFile ? ' (1 file)' : ''}.`);
if (!onlyFile) {
  const open = Object.values(doc).filter((d) => d.text && OPEN_RE.test(d.text)).length;
  if (open) console.log(`Lưu ý: ${open} file nền còn [OPEN]/NEEDS CLARIFICATION (cần người quyết định).`);
}
