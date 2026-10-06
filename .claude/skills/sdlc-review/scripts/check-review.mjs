#!/usr/bin/env node
// Kiểm `spec/epics/<EPIC>/review.md`: khuôn bảng, bằng chứng `file:dòng` có thật, và phủ endpoint/hành động/SB của epic.
// Dùng: node check-review.mjs <spec-dir> <thư-mục-gốc-mã> --epic <EPIC>
// Không đánh giá code đúng hay sai; chỉ bảo đảm review không bỏ sót mục nào và mỗi kết luận có bằng chứng kiểm được trên đĩa.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const epic = argv.includes('--epic') ? argv[argv.indexOf('--epic') + 1] : null;
const [specDir, root] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--epic');
if (!specDir || !root || !epic) { console.error('Dùng: check-review.mjs <spec-dir> <code-root> --epic <EPIC>'); process.exit(2); }

const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, acc) : n.endsWith('.md') && acc.push(p); }
  return acc;
};
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/\\([*_])/g, '$1'));
const section = (t, name) => t.split(/^## /m).find((s) => s.startsWith(name))?.split(/\r?\n/).slice(1).join('\n') ?? null;
const tableOf = (s) => (s ?? '').split(/\r?\n/).filter((l) => l.startsWith('|')).slice(2).map(cells);
const fmOf = (t) => {
  const fm = {};
  for (const l of (t.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '').split(/\r?\n/)) { const kv = l.match(/^(\w+):\s*(.*?)\s*(#.*)?$/); if (kv) fm[kv[1]] = kv[2]; }
  return fm;
};

const path = join(specDir, 'epics', epic, 'review.md');
const errors = [];
const err = (m) => errors.push(`${path}: ${m}`);
if (!existsSync(path)) { console.error(`${path}: chưa có review`); process.exit(1); }
const text = readFileSync(path, 'utf8');
if (fmOf(text).epic !== epic) err(`epic trong frontmatter phải là ${epic}`);
if (!fmOf(text).reviewed_commit) err('thiếu reviewed_commit (git rev-parse --short HEAD của mã đã review)');

const KQ = ['đạt', 'lệch', 'chưa làm', 'không áp dụng'];
const TABLES = [['Đối chiếu spec', 'Mục'], ['Quyền', 'Hành động'], ['Bảo mật', 'Mục']];
const listed = { 'Đối chiếu spec': new Set(), 'Quyền': new Set(), 'Bảo mật': new Set() };
for (const [name] of TABLES) {
  const s = section(text, name);
  if (s == null) { err(`thiếu mục "## ${name}"`); continue; }
  const rows = tableOf(s);
  if (!rows.length) err(`mục "${name}" trống`);
  for (const r of rows) {
    if (r.length !== 5) { err(`${name}: dòng sai số cột: ${r.join(' | ')}`); continue; }
    const [item, , kq, evidence, todo] = r;
    listed[name].add(item);
    if (!KQ.includes(kq)) err(`${name} / ${item}: Kết quả phải là ${KQ.join(' | ')}`);
    if ((kq === 'lệch' || kq === 'chưa làm') && (!todo || todo === '-')) err(`${name} / ${item}: ${kq} phải có Việc cần làm`);
    if (kq === 'đạt' || kq === 'lệch') {
      const refs = evidence.split(',').map((x) => x.trim()).filter(Boolean);
      if (!refs.length || refs.every((x) => x === '-')) err(`${name} / ${item}: ${kq} phải có Bằng chứng dạng file:dòng`);
      for (const ref of refs.filter((x) => x !== '-')) {
        const m = ref.match(/^(.+):(\d+)$/);
        const p = m && resolve(root, m[1]);
        if (!m || !existsSync(p) || !statSync(p).isFile()) { err(`${name} / ${item}: bằng chứng "${ref}" không phải file:dòng có thật`); continue; }
        if (Number(m[2]) < 1 || Number(m[2]) > readFileSync(p, 'utf8').split('\n').length) err(`${name} / ${item}: dòng ${m[2]} vượt quá độ dài file ${m[1]}`);
      }
    }
  }
}

// phủ: endpoint (API docs), hành động (ma trận quyền), SB (baseline)
const docs = walk(specDir).map((f) => ({ f, t: readFileSync(f, 'utf8') }));
const need = { 'Đối chiếu spec': [], 'Quyền': [], 'Bảo mật': [] };
const epicReqs = new Set(docs.filter(({ t }) => /^id:\s*\S+-REQ-/m.test(t) && fmOf(t).epic === epic).map(({ t }) => fmOf(t).id));
for (const { f, t } of docs) {
  if (/-API-/.test(fmOf(t).id ?? '') && fmOf(t).epic === epic) {
    const s = section(t, 'Endpoint');
    for (const r of tableOf(s)) need['Đối chiếu spec'].push(`${r[0]} ${r[1]}`);
  }
}
const matrix = docs.find(({ f }) => f.endsWith('permissions-matrix.md'));
if (matrix) for (const l of matrix.t.split(/\r?\n/).filter((x) => x.startsWith('|')).slice(2)) { const c = cells(l); if (epicReqs.has(c[1])) need['Quyền'].push(c[0]); }
const sb = docs.find(({ f }) => f.endsWith('security-baseline.md'));
if (sb) for (const l of sb.t.split(/\r?\n/)) {
  const c = l.startsWith('| SB-') ? cells(l) : null;
  if (c && (c.at(-1).split(',').map((x) => x.trim().replace(/\\/g, '')).some((e) => e === epic || e === '*'))) need['Bảo mật'].push(c[0]);
}
for (const [name, items] of Object.entries(need)) {
  for (const it of items) {
    const ok = [...listed[name]].some((x) => x === it || x.startsWith(`${it} `));
    if (!ok) err(`mục "${name}" thiếu dòng cho: ${it}`);
  }
}

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: review epic ${epic} đủ mục và bằng chứng có thật.`);
