// Kiểm nhanh check-impact.mjs: node check-impact.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '../evals/reservation-ttl/fixture/spec');
const ID = 'INV-REQ-20261001-090000004';
const run = (body) => {
  const root = mkdtempSync(join(tmpdir(), 'impact-'));
  cpSync(FIX, join(root, 'spec'), { recursive: true });
  mkdirSync(join(root, 'spec/changes'));
  writeFileSync(join(root, `spec/changes/${ID}.md`), body);
  return spawnSync('node', [join(here, 'check-impact.mjs'), join(root, 'spec')], { encoding: 'utf8' });
};
const H = '| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |\n|---|---|---|---|---|\n';
const row = (id, loai = 'không đổi', muc = '-') => `| ${id} | ${loai} | ${muc} | lý do | ${loai === 'không đổi' ? '-' : 'sửa'} |\n`;
const HARD = ['CHK-REQ-20261002-100000001', 'CHK-FLOW-20261002-100000002', 'CRT-REQ-20261001-090000002', 'INV-TC-20261002-100000004', 'INV-TC-20261002-100000005'];
const good = H + HARD.map((i) => row(i)).join('') + row('CHK-E2E-20261002-100000006', 'phải dựng lại', 'HIGH');

let r = run(good);
assert.equal(r.status, 0, r.stderr);
assert.equal(run(good.replace('| Loại |', '| Kiểu |')).status, 1, 'sai tiêu đề phải lỗi');
assert.equal(run(good.replace(/\n\| INV-TC-20261002-100000005[^\n]*/, '')).status, 1, 'thiếu dòng cho tài liệu có link phải lỗi');
assert.equal(run(good.replace('| HIGH |', '| nặng |')).status, 1, 'Mức sai phải lỗi');
console.log('OK: check-impact.mjs');
