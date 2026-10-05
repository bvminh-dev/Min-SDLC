#!/usr/bin/env node
// Sinh ID theo quy ước {EPIC}-{TYPE}-{YYYYMMDD}-{hhmmssSSS}.
// Dùng: node new-id.mjs <EPIC> <TYPE> [thư-mục-spec, mặc định ./spec]
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [epic, type, specDir = 'spec'] = process.argv.slice(2);
const TYPES = ['REQ', 'FLOW', 'TC', 'API', 'DB', 'SEC', 'E2E'];

if (!/^[A-Z]{2,4}$/.test(epic ?? '') || !TYPES.includes(type)) {
  console.error(`Dùng: new-id.mjs <EPIC 2-4 chữ in hoa> <${TYPES.join('|')}> [spec-dir]`);
  process.exit(2);
}

function existingNames(dir, acc = new Set()) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) existingNames(p, acc);
    else acc.add(name);
  }
  return acc;
}

const taken = existingNames(specDir);
const pad = (n, w = 2) => String(n).padStart(w, '0');

function makeId() {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
  return `${epic}-${type}-${date}-${time}`;
}

let id = makeId();
// Trùng trong cùng máy (hiếm): đợi 1ms rồi sinh lại.
while ([...taken].some((n) => n.startsWith(id))) {
  const end = Date.now() + 2;
  while (Date.now() < end);
  id = makeId();
}
console.log(id);
