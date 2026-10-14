#!/usr/bin/env node
// Kiểm đột biến dùng chung cho implement và review: gài từng đột biến, chạy test, luôn khôi phục tệp, phân loại kết quả.
// Dùng: node mutate.mjs <mutations.json> [--cwd <gốc mã>] [--only <chuỗi trong id>] [--skip-baseline] [--timeout <ms>]
//                       [--auto <tệp mã>]... [--auto-diff] [--list]
//   mutations.json: { "test": "pnpm test", "timeoutMs": 600000, "autoEquivalent": { "<id auto>": "lý do" },
//     "mutations": [ { "id": "M1", "file": "src/a.ts", "find": "đoạn gốc", "replace": "đoạn thay", "test": "(tùy chọn, lệnh hẹp)", "retest": "(tùy chọn, lệnh rộng; mặc định `test` cấp bảng)", "equivalent": "(tùy chọn) lý do tương đương" } ] }
//   Kết quả: bắt (test đỏ do khẳng định) | lọt (test xanh) | lọt hẹp, bắt rộng (lệnh hẹp xanh, `retest` đỏ: gắn đột biến vào TC của bộ rộng)
//            | quá hạn (không tính là bắt) | hỏng biên dịch (không tính là bắt) | không áp dụng được (đoạn gốc không có đúng một lần) | bỏ qua (đột biến tự sinh hỏng biên dịch).
//   Thoát 1 nếu có `lọt` chưa ghi `equivalent`, `quá hạn`, `hỏng biên dịch`, `không áp dụng được`; thoát 2 nếu test nền đỏ hoặc dùng sai.
//   L108/L136: bản gốc mọi tệp sắp gài được ghi vào `<bảng>.restore.json` TRƯỚC khi gài; lần chạy sau thấy tệp này thì khôi phục (bị SIGKILL thì tệp ở lại đột biến).
//   L128: mỗi lệnh chạy trong nhóm tiến trình riêng; quá hạn thì giết cả nhóm (không để jest mồ côi). Biến môi trường MUTATE_PID = pid của script này.
//   L118: in từng hàng `[i/n]` ngay khi xong; --only lọc theo id; --skip-baseline bỏ chạy test nền (khi đã xanh trong phiên).
//   L69/L75/L79: --auto/--auto-diff sinh đột biến đơn giản từ mã (xem AUTO_OPS); --list chỉ in danh sách.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const VALUE = ['--cwd', '--only', '--timeout', '--auto'];
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const cwd = resolve(opt('--cwd') ?? '.');
const cfgPath = argv.find((a, i) => !a.startsWith('--') && !VALUE.includes(argv[i - 1]));
if (!cfgPath || !existsSync(cfgPath)) { console.error('Dùng: mutate.mjs <mutations.json> [--cwd <gốc mã>] [--only <id>] [--skip-baseline] [--timeout <ms>] [--auto <tệp>] [--auto-diff] [--list]'); process.exit(2); }
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const { test: defaultTest, autoEquivalent = {} } = cfg;
const timeoutMs = Number(opt('--timeout') ?? cfg.timeoutMs ?? 600000);
const restorePath = cfgPath.replace(/(\.json)?$/, '.restore.json');
// ponytail: nhận diện lỗi biên dịch bằng mẫu chữ; thêm mẫu khi gặp công cụ mới
const COMPILE = /error TS\d+|SyntaxError|Cannot find module|Failed to compile|Test suite failed to run|ParseError|Unexpected token/i;

// ---- L108/L136: khôi phục tệp bị bỏ lại bởi lần chạy trước (SIGKILL, mất điện)
if (existsSync(restorePath)) {
  const left = JSON.parse(readFileSync(restorePath, 'utf8'));
  for (const [f, t] of Object.entries(left)) writeFileSync(f, t);
  unlinkSync(restorePath);
  console.error(`Cảnh báo: đã khôi phục ${Object.keys(left).length} tệp bị lần chạy trước bỏ lại ở trạng thái đột biến (${Object.keys(left).join(', ')}); xem \`git diff\`.`);
}
const originals = new Map(); // tệp -> nội dung gốc
const saveOriginal = (f, src) => {
  if (originals.has(f)) return;
  originals.set(f, src);
  writeFileSync(restorePath, JSON.stringify(Object.fromEntries(originals)));
};
const restore = () => {
  for (const [f, t] of originals) writeFileSync(f, t);
  originals.clear();
  if (existsSync(restorePath)) unlinkSync(restorePath);
};

// ---- chạy lệnh trong nhóm tiến trình riêng, hết hạn thì giết cả nhóm (L128)
let current = null;
const killGroup = (c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* nhóm đã hết */ } };
const sh = (cmd) => new Promise((done) => {
  const c = spawn(cmd, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MUTATE_PID: String(process.pid) } });
  current = c;
  let out = '', timedOut = false;
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (out += d));
  const timer = setTimeout(() => { timedOut = true; killGroup(c); }, timeoutMs);
  c.on('close', (status) => { clearTimeout(timer); killGroup(c); current = null; done({ status, timedOut, out }); });
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { if (current) killGroup(current); restore(); process.exit(130); });

// ---- L69/L75/L79: đột biến tự sinh theo dòng. Mỗi toán tử trả danh sách dòng thay thế (mỗi phần tử một đột biến).
const reAll = (l, re, fn) => [...l.matchAll(re)].map((m) => l.slice(0, m.index) + fn(m) + l.slice(m.index + m[0].length));
const AUTO_OPS = [
  // [tên, chỉ tệp .sql?, hàm]
  ['and-cond', false, (l) => reAll(l, /\s+AND\s+[\w.]+\s*(?:<>|!=|<=|>=|=|<|>)\s*(?:\$\{[^}]*\}(?:::\w+)?|'[^']*'|[\w.$:]+)/g, () => '')],
  ['for-update', false, (l) => reAll(l, /\s+FOR UPDATE(?:\s+OF\s+\w+)?(?:\s+SKIP LOCKED)?/g, () => '')],
  ['cmp', false, (l) => [[/ <= /, ' < '], [/ >= /, ' > '], [/ < /, ' <= '], [/ > /, ' >= ']].flatMap(([re, to]) => (re.test(l) ? [l.replace(re, to)] : []))],
  ['const-x10', false, (l) => {
    const m = l.match(/^(\s*export const\s+(\w+)\s*(?::\s*number\s*)?=\s*)(\d[\d_]*)\b/) ;
    const out = m && /MS|SECOND|MINUTE|HOUR|DAY|BATCH|LIMIT|MAX|TTL|TIMEOUT|EVERY|SIZE|COUNT/i.test(m[2]) ? [l.replace(m[0], `${m[1]}${Number(m[3].replace(/_/g, '')) * 10}`)] : [];
    return [...out, ...reAll(l, /default:\s*(\d+)\b/g, (x) => `default: ${Number(x[1]) * 10}`)];
  }],
  ['drop-await', false, (l) => (/^\s*await this\.\w+(?:\.\w+)+\([^;]*\);\s*$/.test(l) ? [l.match(/^\s*/)[0]] : [])],
  ['now-shift', false, (l) => (/\bnow\(\)/i.test(l) ? ['- ', '+ '].map((s) => l.replace(/\bnow\(\)/i, `now() ${s}interval '10 minutes'`)) : [])],
  ['in-drop', false, (l) => reAll(l, /\bIN\s*\(([^()]+)\)/gi, (m) => m[0]).length === 0 ? [] : [...l.matchAll(/\bIN\s*\(([^()]+)\)/gi)].flatMap((m) => {
    const items = m[1].split(',');
    return items.length < 2 ? [] : items.map((_, k) => l.slice(0, m.index) + m[0].replace(m[1], items.filter((__, j) => j !== k).join(',')) + l.slice(m.index + m[0].length));
  })],
  ['when-drop', false, (l) => (/^\s*WHEN\b.*\bTHEN\b/.test(l) && !l.includes('`') ? [''] : [])],
  ['guard-drop', false, (l) => (/^\s*if \(.*\)\s*(?:return\s+)?(?:bad|throw)\b.*;\s*$/.test(l) ? [''] : [])],
  ['constraint-drop', true, (l) => (/ADD CONSTRAINT .*\b(?:CHECK|UNIQUE|FOREIGN KEY)\b.*;\s*$/.test(l) || /^\s*CREATE UNIQUE INDEX .*;\s*$/.test(l) ? [''] : [])],
];
const genAuto = (file) => {
  const src = readFileSync(join(cwd, file), 'utf8'), isSql = file.endsWith('.sql'), res = [];
  src.split('\n').forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*|--)/.test(line)) return;
    for (const [name, sqlOnly, fn] of AUTO_OPS) {
      if (sqlOnly !== isSql && (sqlOnly || isSql)) continue;
      fn(line).forEach((text, k) => { if (text !== line) res.push({ id: `auto:${file}:${i + 1}:${name}${k ? `#${k}` : ''}`, file, line: i, text, auto: true }); });
    }
  });
  return res;
};
const autoFiles = argv.flatMap((a, i) => (a === '--auto' ? [argv[i + 1]] : []));
if (argv.includes('--auto-diff')) {
  const g = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout?.split('\n').filter(Boolean) ?? [];
  autoFiles.push(...new Set([...g('diff', '--name-only', '--relative', 'HEAD'), ...g('ls-files', '-o', '--exclude-standard')]).values());
}
const autoOk = (f) => /\.(?:ts|tsx|js|mjs|sql)$/.test(f) && !/(?:\.spec\.|\.test\.|(?:^|\/)test\/|node_modules)/.test(f) && existsSync(join(cwd, f));
let mutations = [...(cfg.mutations ?? []), ...autoFiles.filter(autoOk).flatMap(genAuto)];
const onlyId = opt('--only');
if (onlyId) mutations = mutations.filter((m) => m.id.includes(onlyId));
if (argv.includes('--list')) { console.log(mutations.map((m) => m.id).join('\n')); process.exit(0); }

const apply = (src, m) => {
  if (m.auto) { const ls = src.split('\n'); ls[m.line] = m.text; return ls.join('\n'); }
  return !m.find || src.split(m.find).length !== 2 ? null : src.replace(m.find, () => m.replace);
};

// test nền phải xanh trước, nếu không mọi đột biến đều "bắt" giả
if (!argv.includes('--skip-baseline')) {
  for (const cmd of new Set(mutations.map((m) => m.test ?? defaultTest))) {
    const r = await sh(cmd);
    if (r.status !== 0) { console.error(`test nền ${r.timedOut ? 'quá hạn' : 'đang đỏ'} (${cmd}): sửa trước khi gài đột biến`); process.exit(2); }
  }
}

const out = ['| Đột biến | Kết quả | Ghi chú |', '|---|---|---|'];
let bad = 0, n = 0;
for (const m of mutations) {
  n++;
  const t0 = Date.now(), cmd = m.test ?? defaultTest;
  const f = join(cwd, m.file);
  const src = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const mutated = apply(src, m);
  let kq, note = '-';
  if (mutated === null) { kq = 'không áp dụng được'; note = 'đoạn gốc không có đúng một lần'; bad++; }
  else {
    saveOriginal(f, src);
    try {
      writeFileSync(f, mutated);
      let r = await sh(cmd);
      const compile = (x) => COMPILE.test(x.out);
      const equivalent = m.equivalent ?? autoEquivalent[m.id];
      if (r.timedOut) { kq = 'quá hạn'; note = `quá ${timeoutMs} ms, không tính là bắt`; bad++; }
      else if (r.status === 0) {
        const retest = m.retest ?? defaultTest;
        if (m.test && m.test !== defaultTest && retest && retest !== cmd) r = { ...(await sh(retest)), narrow: true };
        if (r.narrow && !r.timedOut && r.status !== 0 && !compile(r)) { kq = 'lọt hẹp, bắt rộng'; note = `bắt bởi: ${retest}; gắn đột biến vào TC của bộ rộng`; }
        else if (r.narrow && r.timedOut) { kq = 'quá hạn'; note = `retest quá ${timeoutMs} ms`; bad++; }
        else { kq = 'lọt'; equivalent ? (note = `tương đương: ${equivalent}`) : bad++; }
      } else if (compile(r)) { m.auto ? (kq = 'bỏ qua', note = 'đột biến tự sinh hỏng biên dịch') : ((kq = 'hỏng biên dịch'), (note = 'sửa đột biến cho biên dịch được'), bad++); }
      else if (r.status === null) { kq = 'lỗi chạy'; note = 'tiến trình bị tín hiệu giết, không phải khẳng định đỏ'; bad++; }
      else kq = 'bắt';
    } finally { writeFileSync(f, src); }
  }
  console.log(`[${n}/${mutations.length}] ${m.id} -> ${kq} (${((Date.now() - t0) / 1000).toFixed(1)}s) ${m.test ?? defaultTest}`);
  out.push(`| ${m.id} | ${kq} | ${note} |`);
}
restore();
console.log(out.join('\n'));
process.exit(bad ? 1 : 0);
