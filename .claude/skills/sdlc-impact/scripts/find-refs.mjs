#!/usr/bin/env node
// Liệt kê tài liệu trong spec/ tham chiếu tới một ID (tín hiệu cứng, không suy luận).
// Dùng: node find-refs.mjs <thư-mục-spec> <ID>
//       node find-refs.mjs <thư-mục-spec> --phrase "<cụm từ>"   (mọi tài liệu chép lại cùng một quy tắc: tìm theo cụm từ thay vì ID; không phân biệt hoa thường và khoảng trắng)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [specDir, id, phrase] = process.argv.slice(2);
const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ');
if (!specDir || !id || (id === '--phrase' && !phrase)) {
  console.error('Dùng: find-refs.mjs <spec-dir> <ID> | --phrase "<cụm từ>"');
  process.exit(2);
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const rows = [];
for (const file of walk(specDir)) {
  if (id !== '--phrase' && file.endsWith(`${id}.md`)) continue; // chính nó
  const text = readFileSync(file, 'utf8');
  if (id === '--phrase') { if (norm(text).includes(norm(phrase))) rows.push(`nhắc cụm từ\t${file}`); continue; }
  if (!text.includes(id)) continue;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const inFm = fm.includes(id);
  rows.push(`${inFm ? 'links/covers' : 'nhắc trong thân'}\t${file}`);
}

if (rows.length === 0) console.log(`Không có tài liệu nào tham chiếu ${id === '--phrase' ? 'cụm từ đó' : id}.`);
else console.log(rows.sort().join('\n'));
