#!/usr/bin/env node
// Kiểm `spec/epics/<EPIC>/review.md`: khuôn bảng, bằng chứng `file:dòng` có thật, và phủ endpoint/hành động/SB của epic.
// Dùng: node check-review.mjs <spec-dir> <thư-mục-gốc-mã> --epic <EPIC> [--strict]
//       node check-review.mjs --tree <thư-mục-gốc-mã>     (in giá trị `reviewed_tree` để ghi vào frontmatter)
// Kiểm mới (L27 Kết quả chạy lại, L28 reviewed_tree, L38 khớp mục [chưa làm] của report) là LỖI với review có `kit_version: 2`
// hoặc `--strict`; review cũ không có trường đó chỉ bị cảnh báo.
// Kiểm thêm L48 (dòng "Đã sửa" cần mục Kết quả sau sửa) là LỖI với `kit_version: 3` hoặc `--strict`, cảnh báo với review kit_version 2.
// Kiểm thêm L93 (giá trị giữ chỗ TBD/TODO/`0000000`, ô Kết quả thật thiếu số pass) và L65 (bằng chứng trỏ dòng trống hay chỉ `}`) là LỖI với `kit_version: 4` hoặc `--strict`,
// cảnh báo với review kit_version 3. L65: review trên cây sạch tại reviewed_commit mà mã đổi sau đó thì in "dòng N của <tệp> đã đổi; dòng cũ nay ở M" (chỉ cảnh báo).
// Không đánh giá code đúng hay sai; chỉ bảo đảm review không bỏ sót mục nào và mỗi kết luận có bằng chứng kiểm được trên đĩa.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);

// băm SHA-1 danh sách và nội dung file mã (git ls-files -co --exclude-standard) ngoài spec/ và .claude/; null nếu không phải repo git
const git = (root, ...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
const treeHash = (root) => {
  const ls = git(root, 'ls-files', '-co', '--exclude-standard', '-z');
  if (ls.status !== 0) return null;
  const h = createHash('sha1');
  for (const f of ls.stdout.split('\0').filter((x) => x && !/^(spec|\.claude)\//.test(x)).sort()) {
    h.update(f + '\0');
    try { h.update(readFileSync(join(root, f))); } catch { h.update('<thiếu>'); }
  }
  return h.digest('hex');
};
if (argv[0] === '--tree') { console.log(treeHash(resolve(argv[1] ?? '.')) ?? ''); process.exit(0); }
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
const errors = [], warnings = [];
const err = (m) => errors.push(`${path}: ${m}`);
if (!existsSync(path)) { console.error(`${path}: chưa có review`); process.exit(1); }
const text = readFileSync(path, 'utf8');
const fm = fmOf(text);
const fresh = Number(fm.kit_version) >= 2 || argv.includes('--strict');
const gate = (m) => (fresh ? err(m) : warnings.push(`${path}: ${m} (review không có kit_version: 2 nên chỉ cảnh báo)`));
const fresh3 = Number(fm.kit_version) >= 3 || argv.includes('--strict');
const gate3 = (m) => (fresh3 ? err(m) : warnings.push(`${path}: ${m} (review chưa có kit_version: 3 nên chỉ cảnh báo)`));
const fresh4 = Number(fm.kit_version) >= 4 || argv.includes('--strict');
const gate4 = (m) => (fresh4 ? err(m) : warnings.push(`${path}: ${m} (review chưa có kit_version: 4 nên chỉ cảnh báo)`));
if (fm.epic !== epic) err(`epic trong frontmatter phải là ${epic}`);
if (fm.reviewed_tree && !/^[0-9a-f]{40}$/.test(fm.reviewed_tree)) gate4(`reviewed_tree "${fm.reviewed_tree}" không phải chuỗi 40 chữ số thập lục phân (giá trị 0000000 là giữ chỗ): ghi kết quả của "check-review.mjs --tree <gốc mã>" hoặc xóa dòng nếu mã sạch`);
for (const l of text.split(/\r?\n/)) for (const c of l.startsWith('|') ? cells(l) : []) if (/\bTBD\w*|\bTODO\b/.test(c)) gate4(`ô còn chữ giữ chỗ "${c.slice(0, 40)}": review chưa xong, điền kết quả thật`);
if (!fm.reviewed_commit) err('thiếu reviewed_commit (git rev-parse --short HEAD của mã đã review)');

// L28: mã đổi sau review thì số dòng bằng chứng có thể sai
const nowTree = treeHash(resolve(root));
if (nowTree) {
  const head = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
  const dirty = git(root, 'status', '--porcelain', '--', '.', ':!spec', ':!.claude').stdout.trim();
  if (fm.reviewed_tree && fm.reviewed_tree !== nowTree) warnings.push(`${path}: mã đã đổi sau review (reviewed_tree khác hiện tại), số dòng bằng chứng có thể sai: review lại hoặc cập nhật bằng "check-review.mjs --tree <gốc mã>"`);
  else if (!fm.reviewed_tree && head && fm.reviewed_commit && head.startsWith(fm.reviewed_commit) && dirty) gate('reviewed_commit là HEAD nhưng mã đang bẩn mà thiếu reviewed_tree: ghi `node check-review.mjs --tree <gốc mã>` vào frontmatter');
}

// L27: Kết quả chạy lại (độc lập với report.md)
const rpPath = join(specDir, 'epics', epic, 'report.md'), rp = existsSync(rpPath) ? readFileSync(rpPath, 'utf8') : '';
const rerun = section(text, 'Kết quả chạy lại');
if (rerun == null) gate('thiếu mục "## Kết quả chạy lại" (| Lệnh | Kết quả thật | So với report.md |): reviewer phải chạy lại lệnh test và ghi kết quả thật');
else if (rp) {
  const { test_command: cmd, test_result: res } = fmOf(rp);
  const rr = tableOf(rerun), line = rr.find((r) => cmd && r[0].includes(cmd));
  if (cmd && !line) gate(`Kết quả chạy lại không có dòng chứa test_command của report.md (${cmd})`);
  else if (line) {
    const pass = (t) => t.match(/(\d+)\s+pass(?:ed)?\b/)?.[1];
    if (!pass(line[1] ?? '')) gate4(`Kết quả chạy lại: ô Kết quả thật của dòng test_command không có số pass ("${(line[1] ?? '').slice(0, 40)}")`);
    if (/\.\.\.|…/.test(line[1] ?? '')) gate4('Kết quả chạy lại: ô Kết quả thật chứa "..." (giá trị giữ chỗ)');
    if (pass(res ?? '') && pass(line[1] ?? '') && pass(res) !== pass(line[1]) && /^khớp/i.test(line[2] ?? '')) gate(`Kết quả chạy lại: ${pass(line[1])} pass không khớp test_result của report.md (${pass(res)} pass) mà cột So với report.md ghi "khớp"`);
  }
}

const commitOk = fm.reviewed_commit && !fm.reviewed_tree && git(root, 'cat-file', '-e', `${fm.reviewed_commit}^{commit}`).status === 0;
const drifted = new Set(), blankRefs = [];
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
        const cur = readFileSync(p, 'utf8').split('\n'), n = Number(m[2]);
        if (n < 1 || n > cur.length) { err(`${name} / ${item}: dòng ${m[2]} vượt quá độ dài file ${m[1]}`); continue; }
        if (/^\s*[})\];,]*\s*$/.test(cur[n - 1])) blankRefs.push(`${ref} (${item.slice(0, 30)})`);
        // L65: cây sạch tại reviewed_commit: so dòng được trích lúc đó với hiện tại
        if (commitOk && !drifted.has(ref)) {
          drifted.add(ref);
          const old = git(root, 'show', `${fm.reviewed_commit}:./${m[1]}`);
          const was = old.status === 0 ? old.stdout.split('\n')[n - 1] : undefined;
          if (was !== undefined && was.trim() && was !== cur[n - 1]) {
            const at = cur.map((t, i) => (t === was ? i + 1 : 0)).filter(Boolean).sort((a, b) => Math.abs(a - n) - Math.abs(b - n))[0];
            warnings.push(`${path}: ${name} / ${item}: dòng ${n} của ${m[1]} đã đổi; ${at ? `dòng cũ nay ở ${at}` : 'dòng cũ không còn trong tệp'}: dịch bằng chứng`);
          }
        }
      }
    }
  }
}

if (blankRefs.length) gate4(`${blankRefs.length} bằng chứng trỏ dòng trống hoặc chỉ gồm ngoặc đóng (dòng này không chứng minh gì; trỏ dòng có mã làm chứng): ${[...new Set(blankRefs)].slice(0, 4).join('; ')}${blankRefs.length > 4 ? '; ...' : ''}`);

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

// L48: dòng có Việc cần làm bắt đầu bằng "Đã sửa" phải có mục "Kết quả sau sửa": Đã sửa ở là file:dòng có thật, Chứng minh không trống
const nFixed = ['Đối chiếu spec', 'Quyền', 'Bảo mật'].flatMap((n) => tableOf(section(text, n))).filter((r) => /^Đã sửa/.test(r[4] ?? '')).length;
if (nFixed) {
  const fx = tableOf(section(text, 'Kết quả sau sửa'));
  if (!fx.length) gate3(`có ${nFixed} dòng "Đã sửa" ở Việc cần làm nhưng thiếu mục "## Kết quả sau sửa" dạng bảng (| Phát hiện (mức) | Đã sửa ở | Chứng minh |)`);
  for (const r of fx) {
    const tag = `Kết quả sau sửa / ${(r[0] ?? '').slice(0, 40)}`, refs = [...(r[1] ?? '').matchAll(/([^\s`,()]+):(\d+)/g)];
    if (!refs.length) gate3(`${tag}: cột Đã sửa ở phải có file:dòng`);
    for (const [, f, n] of refs) {
      const p = resolve(root, f);
      if (!existsSync(p) || !statSync(p).isFile()) gate3(`${tag}: "${f}:${n}" không phải file:dòng có thật`);
      else if (Number(n) < 1 || Number(n) > readFileSync(p, 'utf8').split('\n').length) gate3(`${tag}: dòng ${n} vượt quá độ dài file ${f}`);
    }
    if (!r[2] || r[2] === '-') gate3(`${tag}: thiếu Chứng minh (test nào đỏ khi bỏ bản sửa)`);
  }
}

// L38: mục [chưa làm] của report.md phải có dòng lệch hoặc chưa làm tương ứng (khớp bằng ID spec, "mục N" hoặc tên in đậm)
const lechRows = ['Đối chiếu spec', 'Quyền', 'Bảo mật'].flatMap((n) => tableOf(section(text, n))).filter((r) => ['lệch', 'chưa làm'].includes(r[2])).map((r) => r.join(' ').toLowerCase());
for (const l of (section(rp, 'Lệch spec') ?? '').split(/\r?\n/)) {
  const m = l.match(/^(\d+)\.\s*(?:\*\*)?\[chưa làm\]/);
  if (!m) continue;
  const keys = [...(l.match(/\b(?:[A-Z]{2,4}-(?:REQ|API|DB|SEC|TC|FLOW|E2E)-[\d-]+|SB-\d+|ADR-\d+)\b/g) ?? []), l.match(/\*\*([^*]+)\*\*/)?.[1]].filter(Boolean).map((k) => k.toLowerCase());
  const byNum = new RegExp(`mục\\s*${m[1]}\\b`);
  if (!lechRows.some((r) => byNum.test(r) || keys.some((k) => r.includes(k)))) gate(`Lệch spec mục ${m[1]} của report.md là [chưa làm] nhưng review không có dòng lệch hoặc chưa làm tương ứng (ghi ID spec của mục đó hoặc "mục ${m[1]}" ở dòng review)`);
}

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: review epic ${epic} đủ mục và bằng chứng có thật.`);
for (const w of warnings) console.log(`Lưu ý: ${w}`);
