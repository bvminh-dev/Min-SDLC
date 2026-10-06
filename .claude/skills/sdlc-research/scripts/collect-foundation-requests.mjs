#!/usr/bin/env node
// Gom mục "Nền cần sửa" của mọi `spec/epics/*/questions.md` thành một bảng đã khử trùng lặp (ra stdout, không ghi file).
// Quy ước mỗi dòng: `- <file nền>; <thay đổi>; <ưu tiên: cao|trung bình|thấp>; <epic>` (xem templates/questions.md).
// Dòng không đủ bốn trường bị bỏ qua và đếm ở stderr.
// Dùng: node collect-foundation-requests.mjs [thư-mục-spec, mặc định ./spec]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const specDir = process.argv[2] ?? 'spec';
const epicsDir = join(specDir, 'epics');
if (!existsSync(epicsDir)) { console.error(`Không thấy ${epicsDir}`); process.exit(2); }
const RANK = { cao: 0, 'trung bình': 1, thấp: 2 };
const norm = (s) => s.trim().replace(/\s+/g, ' ');
const merged = new Map();
let skipped = 0;
for (const epic of readdirSync(epicsDir).sort()) {
  const f = join(epicsDir, epic, 'questions.md');
  if (!existsSync(f)) continue;
  const sec = readFileSync(f, 'utf8').split(/^## /m).find((s) => /^Nền cần sửa/.test(s));
  for (const l of (sec ?? '').split(/\r?\n/).slice(1).filter((x) => /^\s*[-*]\s/.test(x))) {
    const p = l.replace(/^\s*[-*]\s+/, '').split(';').map(norm);
    if (p.length !== 4 || p.some((x) => !x)) { skipped++; continue; }
    const [file, change, prio, ep] = p, k = `${file}\u0000${change.toLowerCase()}`;
    const cur = merged.get(k) ?? { file, change, prio, epics: new Set() };
    if ((RANK[prio.toLowerCase()] ?? 1) < (RANK[cur.prio.toLowerCase()] ?? 1)) cur.prio = prio;
    cur.epics.add(ep);
    merged.set(k, cur);
  }
}
const out = [...merged.values()].sort((a, b) => (RANK[a.prio.toLowerCase()] ?? 1) - (RANK[b.prio.toLowerCase()] ?? 1) || a.file.localeCompare(b.file));
console.log('| File nền | Thay đổi | Ưu tiên | Epic |\n|---|---|---|---|');
for (const r of out) console.log(`| ${r.file} | ${r.change} | ${r.prio} | ${[...r.epics].sort().join(', ')} |`);
if (skipped) console.error(`${skipped} dòng ở mục Nền cần sửa không đủ bốn trường (file; thay đổi; ưu tiên; epic), đã bỏ qua.`);
