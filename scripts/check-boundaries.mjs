#!/usr/bin/env node
// Kiểm ranh giới module (P7, SB-35, PRJ-REQ-20261006-095422475 BR5 và BR11).
//  1. import chéo module phải nằm trong cột Phụ thuộc của spec/architecture.md và đi qua điểm vào công khai (index.ts);
//     `platform` là cắt ngang: mọi module import được điểm vào của nó nhưng không import file nội bộ.
//  2. module không đọc bảng của module khác: model Prisma hoặc tên bảng trong $queryRaw thuộc prisma/schema/<module>.prisma.
// Dùng: check-boundaries.mjs [--modules <dir>] [--architecture <file>] [--schemas <dir>]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const modulesDir = resolve(arg('--modules', 'apps/api/src/modules'));
const archFile = resolve(arg('--architecture', 'spec/architecture.md'));
const schemaDir = resolve(arg('--schemas', 'apps/api/prisma/schema'));

const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, acc); else acc.push(p); }
  return acc;
};
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// --- bảng Ánh xạ epic -> module
const archText = readFileSync(archFile, 'utf8');
const epicToModule = {}, rawDeps = {};
let inTable = false;
for (const l of archText.split(/\r?\n/)) {
  if (/^##\s+Ánh xạ epic/.test(l)) { inTable = true; continue; }
  if (inTable && /^##\s/.test(l)) break;
  const c = inTable && l.startsWith('|') ? l.split('|').slice(1, -1).map((x) => x.trim()) : null;
  if (c && /^[A-Z]{2,4}$/.test(c[0]) && c.length >= 3) {
    epicToModule[c[0]] = c[1];
    rawDeps[c[1]] = c[2] === '-' ? [] : c[2].split(',').map((x) => x.trim());
  }
}
const deps = {};
for (const [m, list] of Object.entries(rawDeps)) deps[m] = new Set(list.map((e) => epicToModule[e]).filter(Boolean));
const known = new Set(Object.values(epicToModule));

// --- bảng thuộc module nào
const ownerOfAccessor = {}, ownerOfTable = {};
for (const f of walk(schemaDir).filter((p) => p.endsWith('.prisma'))) {
  const mod = f.split(sep).pop().replace(/\.prisma$/, '');
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const table = m[2].match(/@@map\("([^"]+)"\)/)?.[1] ?? m[1];
    ownerOfAccessor[m[1][0].toLowerCase() + m[1].slice(1)] = mod;
    ownerOfTable[table] = mod;
  }
}

const out = [];
const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*|\.{1,2})\1/g;
const OPS = 'findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy';

for (const file of walk(modulesDir).filter((p) => /\.(ts|tsx|js|mjs)$/.test(p))) {
  const rel = relative(modulesDir, file).split(sep);
  const A = rel[0];
  if (rel.length < 2) continue;
  const text = readFileSync(file, 'utf8');
  const shown = relative(process.cwd(), file);
  if (!known.has(A)) { out.push(`${shown}:1: [${A}] module không có trong bảng Ánh xạ epic -> module của architecture.md`); continue; }

  for (const m of text.matchAll(IMPORT_RE)) {
    const target = relative(modulesDir, resolve(dirname(file), m[2])).split(sep);
    if (target[0] === '..' || target[0] === A) continue;
    const B = target[0];
    const rest = target.slice(1).join('/').replace(/\.(ts|js)$/, '');
    const entry = rest === '' || rest === 'index';
    const at = `${shown}:${lineOf(text, m.index)}: [${A} -> ${B}]`;
    if (!known.has(B)) { out.push(`${at} module đích không có trong architecture.md`); continue; }
    if (B === 'platform') {
      if (!entry) out.push(`${at} import file nội bộ của platform; chỉ được import điểm vào công khai (index.ts)`);
      continue;
    }
    if (!deps[A].has(B)) {
      out.push(`${at} ${B} không nằm trong cột Phụ thuộc của ${A} ở architecture.md` +
        (deps[B]?.has(A) ? `; ${B} đã phụ thuộc ${A} nên liên lạc ngược chiều chỉ bằng domain event, không import trực tiếp` : ''));
    }
    if (!entry) out.push(`${at} import file bên trong ${B} (${rest}); chỉ được import điểm vào công khai (index.ts)`);
  }

  for (const m of text.matchAll(new RegExp(`\\.(\\w+)\\.(?:${OPS})\\s*[(<]`, 'g'))) {
    const o = ownerOfAccessor[m[1]];
    if (o && o !== A) out.push(`${shown}:${lineOf(text, m.index)}: [${A} -> ${o}] đọc/ghi model Prisma ${m[1]} thuộc module ${o}; phải gọi giao diện ở architecture.md (SB-35)`);
  }
  for (const m of text.matchAll(/\$(?:queryRaw|executeRaw)(?:Unsafe)?\s*(?:<[^>]*>)?\s*[(]?\s*([`'"])([\s\S]*?)\1/g)) {
    for (const t of m[2].matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      const o = ownerOfTable[t[1]];
      if (o && o !== A) out.push(`${shown}:${lineOf(text, m.index + m[0].indexOf(t[0]))}: [${A} -> ${o}] SQL thô đọc/ghi bảng ${t[1]} thuộc module ${o}; phải gọi giao diện ở architecture.md (SB-35)`);
    }
  }
}

if (out.length) {
  process.stderr.write(`Vi phạm ranh giới module:\n${out.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-boundaries: sạch (${Object.keys(deps).length} module trong bảng)\n`);
