#!/usr/bin/env node
// Kiểm tài liệu test `spec/epics/<EPIC>/tests/*.md` (TC, E2E) với requirement, SEC và testids.md.
// Dùng: node check-tests.mjs [spec-dir, mặc định ./spec] [--epic <EPIC>] [--strict]
//  --strict: requirement thiếu test case cho một mục kịch bản, mối đe dọa SEC "Kiểm bằng test" chưa có test, mối đe dọa kiểm bằng script/hook có ít hơn 2 TC
//            (ít nhất một ca lỗi hoặc biên), và tài liệu approved có nhãn Given/When/Then lặp, cũng là lỗi (mặc định cảnh báo)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const epicOnly = argv.includes('--epic') ? argv[argv.indexOf('--epic') + 1] : null;
const strict = argv.includes('--strict');
const specDir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--epic') ?? 'spec';
if (!existsSync(specDir)) { console.error(`Không thấy thư mục spec: ${specDir}`); process.exit(2); }

const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, acc) : n.endsWith('.md') && acc.push(p); }
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
// trình định dạng markdown căn lề bảng (thêm khoảng trắng): so khớp tiêu đề sau khi gộp khoảng trắng
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const tableRows = (t, headerStart) => {
  const ls = t.split(/\r?\n/), i = ls.findIndex((l) => squash(l).startsWith(headerStart));
  if (i < 0) return [];
  const out = [];
  for (let j = i + 2; j < ls.length && ls[j].startsWith('|'); j++) out.push(ls[j].split('|').slice(1, -1).map((c) => c.trim().replace(/\\([*_])/g, '$1')));
  return out;
};

const KINDS = ['chính', 'lỗi', 'biên'];
const SECTION = { chính: 'Luồng chính', lỗi: 'Luồng lỗi', biên: 'Ca biên' };
const epicCodes = new Set(tableRows(read('roadmap.md'), '| STT').map((r) => r[1].toLowerCase()));
const matrixRoles = read('permissions-matrix.md').split(/\r?\n/).find((l) => l.startsWith('| Hành động'))?.split('|').map((s) => s.trim()).slice(3).filter(Boolean) ?? [];

// testids.md: testid -> Set(role)
const testids = new Map(tableRows(read('testids.md'), '| testid').map((r) => [r[0], new Set(r[4].split(',').map((x) => x.trim()).filter(Boolean))]));

const all = walk(specDir).map((f) => ({ f, text: readFileSync(f, 'utf8') }));
const reqs = new Map(), threats = new Map(); // threats: "<SEC-ID>:<mã>" -> {epic, check}
for (const { text } of all) {
  const fm = fmOf(text);
  if (fm.id?.includes('-REQ-')) reqs.set(fm.id, { epic: fm.epic, text });
  if (fm.id?.includes('-SEC-')) for (const r of tableRows(text, '| Mã | STRIDE')) threats.set(`${fm.id}:${r[0]}`, { epic: fm.epic, check: r[6] ?? '' });
}

const errors = [], warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const docs = all.filter(({ f }) => /[\\/]tests[\\/][^\\/]+\.md$/.test(f)).map((d) => ({ ...d, fm: fmOf(d.text) })).filter((d) => !epicOnly || d.fm.epic === epicOnly);
const coveredKind = new Set(), coveredThreat = new Set(), threatTcs = new Map(); // threatTcs: mối đe dọa -> các kind của TC trỏ tới nó

for (const { f, text, fm } of docs) {
  const type = fm.id?.split('-')[1];
  if (!['TC', 'E2E'].includes(type)) { err(f, 'ID phải có loại TC hoặc E2E'); continue; }
  if (fm.epic !== f.split(/[\\/]/).at(-3)) err(f, `epic phải trùng thư mục (${f.split(/[\\/]/).at(-3)})`);
  const covers = fm.covers ?? [];
  if (!covers.length) err(f, 'thiếu covers');
  for (const id of covers) if (!reqs.has(id)) err(f, `covers trỏ tới requirement không tồn tại: ${id}`);

  if (type === 'TC') {
    if (covers.length !== 1) err(f, 'test case phủ đúng một requirement (covers có một ID)');
    if (!KINDS.includes(fm.kind)) err(f, `kind phải là ${KINDS.join(' | ')}`);
    else if (covers.length === 1 && reqs.has(covers[0])) {
      const body = reqs.get(covers[0]).text;
      if (!new RegExp(`### ${SECTION[fm.kind]}[\\s\\S]*?\\*\\*Given\\*\\*`).test(body)) err(f, `requirement ${covers[0]} không có mục "${SECTION[fm.kind]}" để kiểm`);
      coveredKind.add(`${covers[0]}|${fm.kind}`);
    }
    for (const kw of ['Given', 'When', 'Then']) if (!text.includes(`**${kw}**`)) err(f, `thiếu ${kw} trong các bước`);
    for (const t of fm.threats ?? []) {
      if (!threats.has(t)) err(f, `threats trỏ tới mối đe dọa không tồn tại: ${t}`);
      coveredThreat.add(t);
      threatTcs.set(t, [...(threatTcs.get(t) ?? []), fm.kind]);
    }
    // L33: nhãn lặp ("**Given** **Given**") hoặc không đứng đầu bước; lỗi với draft hoặc --strict, cảnh báo với tài liệu approved (không phá tài liệu đã duyệt)
    const steps = text.replace(/^---[\s\S]*?---/, '').split(/\r?\n/).filter((l) => /\*\*(Given|When|Then)\*\*/.test(l));
    const badStep = steps.find((l) => (l.match(/\*\*(?:Given|When|Then)\*\*/g) ?? []).length > 1 || !/^\s*(?:[-*]|\d+\.)\s*\*\*(Given|When|Then)\*\*/.test(l));
    if (badStep) (fm.status === 'approved' && !strict ? warnings : errors).push(`${f}: nhãn lặp hoặc nhãn không đứng đầu bước (lặp nhãn Given/When/Then): ${badStep.trim().slice(0, 80)}`);
    // cảnh báo: Given/When nêu phiên bản công cụ cụ thể mà mục Dữ liệu không nói cách dựng (container, .nvmrc)
    const note = text.split(/^## /m).find((x) => x.startsWith('Dữ liệu')) ?? '';
    const ver = steps.find((l) => /\*\*(Given|When)\*\*/.test(l) && /\b(?:Node(?:\.js)?|pnpm|npm|PostgreSQL|Postgres|Redis|Docker|TypeScript|NestJS|Prisma|Next\.js|React|Jest|Python|Java)\s+v?\d{1,2}\.\d{1,3}(?:\.\d+)?\b/ /* ponytail: danh sách công cụ cố định, thêm tên khi gặp công cụ mới */.test(l));
    if (ver && !/container|\.nvmrc|image|docker|engines|corepack/i.test(note)) warnings.push(`${f}: Given/When nêu phiên bản công cụ cụ thể nhưng mục "Dữ liệu và ghi chú" không nói cách dựng (container, .nvmrc): ${ver.trim().slice(0, 80)}`);
  }

  if (type === 'E2E') {
    if (!matrixRoles.includes(fm.role)) err(f, `role "${fm.role}" không có trong ma trận quyền`);
    const used = [...text.replace(/^---[\s\S]*?---/, '').matchAll(/`([a-z]{2,4}-[a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map((m) => m[1]).filter((t) => epicCodes.has(t.split('-')[0]));
    if (!used.length) err(f, 'luồng E2E không dùng testid nào (ghi testid trong dấu backtick, lấy từ spec/testids.md)');
    for (const t of used) {
      if (!testids.has(t)) err(f, `testid không có trong spec/testids.md: ${t}`);
      else if (!testids.get(t).has(fm.role)) err(f, `testid ${t} không dành cho role "${fm.role}" (có: ${[...testids.get(t)].join(', ')})`);
    }
  }
}

// phủ: mọi requirement × mục kịch bản; mọi mối đe dọa kiểm bằng test
const lack = [];
for (const [id, r] of reqs) {
  if (epicOnly && r.epic !== epicOnly) continue;
  const missing = KINDS.filter((k) => !coveredKind.has(`${id}|${k}`));
  if (missing.length) lack.push(`${id}: chưa có test case cho ${missing.join(', ')}`);
}
for (const [t, v] of threats) {
  if ((epicOnly && v.epic !== epicOnly) || !/\btest\b/.test(v.check)) continue;
  if (!coveredThreat.has(t)) lack.push(`mối đe dọa ${t} (Kiểm bằng test) chưa có test case nào có threats chứa nó`);
}
// L25: cổng kiểm (script/hook) cần >= 2 TC, ít nhất một ca lỗi hoặc biên (cả hai chiều: dương tính và đầu vào hỏng)
for (const [t, v] of threats) {
  if ((epicOnly && v.epic !== epicOnly) || !/\b(script|hook)\b/.test(v.check)) continue;
  const ks = threatTcs.get(t) ?? [];
  if (ks.length < 2 || !ks.some((k) => k === 'lỗi' || k === 'biên')) lack.push(`mối đe dọa ${t} (Kiểm bằng script/hook: cổng kiểm) cần ít nhất 2 test case trỏ tới nó, một ca lỗi hoặc biên (công cụ kiểm hỏng thì phải đỏ; mỗi mẫu quét một ca dương tính); hiện có ${ks.length}`);
}
(strict ? errors : warnings).push(...lack.map((m) => `thiếu phủ: ${m}`));


if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: ${docs.length} tài liệu test hợp lệ.`);
for (const w of warnings) console.log(`Lưu ý: ${w}`);
