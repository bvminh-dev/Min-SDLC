#!/usr/bin/env node
// Quét lỗ hổng phụ thuộc (SB-17, PRJ-SEC T21): mức `high` trở lên làm CI đỏ.
// `--input <file>`: đọc đầu ra `pnpm audit --json` đã lưu (dùng cho test); mặc định chạy `pnpm audit --json`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Cổng đóng khi lỗi (fail-closed): không có kết quả hợp lệ thì KHÔNG được coi là "0 lỗ hổng" (SB-17).
const fail = (why) => { process.stderr.write(`audit-gate: không có kết quả hợp lệ (${why}), coi như đỏ\n`); process.exit(2); };
const i = process.argv.indexOf('--input');
let raw, exitCode = 0;
if (i > 0) raw = readFileSync(process.argv[i + 1], 'utf8');
else {
  const r = spawnSync('pnpm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) fail(`không chạy được pnpm audit: ${r.error.message}`);
  raw = r.stdout; exitCode = r.status; // pnpm audit thoát 1 khi có lỗ hổng: mã thoát một mình không quyết định, nội dung mới quyết định
}
let report;
try { report = JSON.parse(raw); } catch { fail('không đọc được đầu ra, lỗi mạng hoặc registry?'); }
if (report?.error) fail(`pnpm audit báo lỗi${report.error.code ? ` ${report.error.code}` : ''}`);
const v = report?.metadata?.vulnerabilities;
if (!v || typeof v.high !== 'number' || typeof v.critical !== 'number') fail('thiếu metadata.vulnerabilities');
if (exitCode !== 0 && Object.values(v).every((n) => !n)) fail(`pnpm audit thoát ${exitCode} mà không có lỗ hổng nào`);
const high = (v.high ?? 0) + (v.critical ?? 0);
process.stdout.write(`audit-gate: low=${v.low ?? 0} moderate=${v.moderate ?? 0} high=${v.high ?? 0} critical=${v.critical ?? 0}\n`);
if (high > 0) {
  for (const a of Object.values(report.advisories ?? {})) {
    if (['high', 'critical'].includes(a.severity)) process.stderr.write(`${a.severity}: ${a.module_name} ${a.title}\n`);
  }
  process.exit(1);
}
