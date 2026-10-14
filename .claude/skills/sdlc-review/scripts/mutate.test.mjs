// Kiểm nhanh mutate.mjs: node mutate.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'mutate.mjs');
const SRC = 'export const pos = (x) => x > 0;\nexport const unused = () => 1;\n';
const dirs = []; // L97: thư mục tạm xóa khi thoát, không để lại $TMPDIR
process.on('exit', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function setup({ src = SRC, test = 'node check.mjs', mutations, extra = {}, files = {} }) {
  const r = mkdtempSync(join(tmpdir(), 'mutate-'));
  dirs.push(r);
  writeFileSync(join(r, 'src.mjs'), src);
  writeFileSync(join(r, 'check.mjs'), "import { pos } from './src.mjs';\nif (!pos(1) || pos(-1)) throw new Error('assert fail');\n");
  for (const [n, t] of Object.entries(files)) writeFileSync(join(r, n), t);
  writeFileSync(join(r, 'm.json'), JSON.stringify({ test, ...extra, mutations }));
  return r;
}
function run(mutations, opts = {}, args = []) {
  const r = setup({ ...opts, mutations });
  const x = spawnSync('node', [script, join(r, 'm.json'), '--cwd', r, ...args], { encoding: 'utf8' });
  return { ...x, r, src: readFileSync(join(r, 'src.mjs'), 'utf8') };
}
const M = (id, find, replace, extra = {}) => ({ id, file: 'src.mjs', find, replace, ...extra });

// bắt: test đỏ do khẳng định; tệp luôn được khôi phục
let x = run([M('A', 'x > 0', 'x < 0')]);
assert.equal(x.status, 0, x.stdout + x.stderr);
assert.match(x.stdout, /\| A \| bắt \|/);
assert.equal(x.src, SRC, 'tệp phải được khôi phục');
// lọt chưa giải thích: thoát 1
x = run([M('B', '=> 1', '=> 2')]);
assert.equal(x.status, 1, 'lọt không có lý do phải thoát 1');
assert.match(x.stdout, /\| B \| lọt \|/);
assert.equal(x.src, SRC);
// lọt có "equivalent": qua
x = run([M('B', '=> 1', '=> 2', { equivalent: 'hàm không ai gọi' })]);
assert.equal(x.status, 0, x.stdout);
assert.match(x.stdout, /\| B \| lọt \| tương đương: hàm không ai gọi/);
// hỏng biên dịch không tính là bắt: thoát 1
x = run([M('C', 'x > 0', 'x > > 0')]);
assert.equal(x.status, 1);
assert.match(x.stdout, /\| C \| hỏng biên dịch \|/);
assert.equal(x.src, SRC);
// đoạn thay không có trong tệp: lỗi, không đoán
x = run([M('D', 'không có đoạn này', 'x')]);
assert.equal(x.status, 1);
assert.match(x.stdout, /\| D \| không áp dụng được \|/);
// test nền đang đỏ thì mọi đột biến đều "bắt" giả: dừng, thoát 2
x = run([M('E', 'x > 0', 'x < 0')], { src: 'export const pos = (x) => x < 0;\n' });
assert.equal(x.status, 2, x.stdout + x.stderr);
assert.match(x.stderr, /test nền/);

// L108, L136: bị SIGKILL giữa chừng (không bắt được tín hiệu) thì tệp ở lại trạng thái đột biến; lần chạy sau phải khôi phục từ tệp sao lưu cạnh bảng
const KILLER = "const s = require('fs').readFileSync('src.mjs', 'utf8'); if (s.includes('x < 0')) process.kill(Number(process.env.MUTATE_PID), 'SIGKILL');";
const k = setup({ mutations: [M('K', 'x > 0', 'x < 0')], test: `node -e "${KILLER}"` });
const killed = spawnSync('node', [script, join(k, 'm.json'), '--cwd', k], { encoding: 'utf8' });
assert.equal(killed.signal, 'SIGKILL', 'test tự giết mutate.mjs bằng SIGKILL (qua biến MUTATE_PID)');
assert.notEqual(readFileSync(join(k, 'src.mjs'), 'utf8'), SRC, 'SIGKILL để lại đột biến trong tệp (điều kiện của ca hồi quy)');
assert.ok(existsSync(join(k, 'm.restore.json')), 'phải có tệp sao lưu <bảng>.restore.json cạnh bảng đột biến');
writeFileSync(join(k, 'm.json'), JSON.stringify({ test: 'node check.mjs', mutations: [M('A', 'x > 0', 'x < 0')] }));
const healed = spawnSync('node', [script, join(k, 'm.json'), '--cwd', k], { encoding: 'utf8' });
assert.equal(readFileSync(join(k, 'src.mjs'), 'utf8'), SRC, 'lần chạy sau phải trả tệp về nguyên văn');
assert.match(healed.stdout + healed.stderr, /khôi phục.*lần chạy trước/i);
assert.ok(!existsSync(join(k, 'm.restore.json')), 'xóa tệp sao lưu sau khi khôi phục');

// L128: quá hạn không phải "bắt", giết cả nhóm tiến trình (không để jest mồ côi)
const HANG = "const fs = require('fs'); if (fs.readFileSync('src.mjs', 'utf8').includes('x < 0')) { fs.writeFileSync('pid.txt', String(process.pid)); setTimeout(() => {}, 30000); }";
x = run([M('T', 'x > 0', 'x < 0')], { test: `node -e "${HANG}"`, extra: { timeoutMs: 1500 } });
assert.equal(x.status, 1, 'quá hạn không được tính là bắt: thoát 1\n' + x.stdout + x.stderr);
assert.match(x.stdout, /\| T \| quá hạn \|/);
assert.equal(x.src, SRC);
const pid = Number(readFileSync(join(x.r, 'pid.txt'), 'utf8'));
assert.throws(() => process.kill(pid, 0), /ESRCH/, 'tiến trình con phải bị giết theo nhóm');

// L118: in từng hàng ngay khi đột biến chạy xong; --only; --skip-baseline
const SLOW = "if (require('fs').readFileSync('src.mjs', 'utf8').includes('x < 1')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);";
const sr = setup({ mutations: [M('A', 'x > 0', 'x < 0', { test: 'node check.mjs' }), M('B', 'x > 0', 'x < 1', { test: `node -e "${SLOW}" && node check.mjs` })] });
await new Promise((done) => {
  const t0 = Date.now(), seen = {};
  const c = spawn('node', [script, join(sr, 'm.json'), '--cwd', sr]);
  c.stdout.on('data', (d) => { const m = String(d).match(/\[(\d)\/2\]/); if (m && !seen[m[1]]) seen[m[1]] = Date.now() - t0; });
  c.on('close', () => { assert.ok(seen[1] !== undefined && seen[2] !== undefined, 'phải in dòng [i/n]'); assert.ok(seen[2] - seen[1] >= 1500, `hàng 1 phải ra trước khi đột biến 2 bắt đầu xong (${seen[1]} so với ${seen[2]})`); done(); });
});
const CNT = "require('fs').appendFileSync('calls.log', 'x\\n')";
const cr = setup({ mutations: [M('A', 'x > 0', 'x < 0', { test: `node -e "${CNT}" && node check.mjs` }), M('B', 'x > 0', 'x < 1', { test: `node -e "${CNT}" && node check.mjs` })] });
const calls = () => (existsSync(join(cr, 'calls.log')) ? readFileSync(join(cr, 'calls.log'), 'utf8').trim().split('\n').length : 0);
spawnSync('node', [script, join(cr, 'm.json'), '--cwd', cr, '--only', 'B', '--skip-baseline'], { encoding: 'utf8' });
assert.equal(calls(), 1, '--only B --skip-baseline chỉ chạy lệnh của đột biến B, không chạy baseline');
rmSync(join(cr, 'calls.log'));
spawnSync('node', [script, join(cr, 'm.json'), '--cwd', cr], { encoding: 'utf8' });
assert.equal(calls(), 3, 'mặc định: baseline một lần cho lệnh chung + hai đột biến');

// L109: lệnh hẹp báo lọt thì chạy retest (lệnh rộng) trước khi kết luận
const NARROW = { test: 'node -e "0"' };
x = run([M('N', 'x > 0', 'x < 0', NARROW)]);
assert.equal(x.status, 0, 'lệnh hẹp lọt nhưng lệnh rộng của bảng bắt: không phải lỗ hổng\n' + x.stdout);
assert.match(x.stdout, /\| N \| lọt hẹp, bắt rộng \|/);
x = run([M('N', 'x > 0', 'x < 0', { ...NARROW, retest: 'node -e "0"' })]);
assert.equal(x.status, 1, 'retest cũng lọt thì vẫn là lọt');
assert.match(x.stdout, /\| N \| lọt \|/);

// L69, L75, L79: --auto sinh đột biến từ mã đã đổi
const AUTO = [
  'export const BATCH_SIZE = 50;',
  'export const q = `SELECT * FROM t WHERE a = 1 AND b = $1 AND c IN (\'x\', \'y\') FOR UPDATE`;',
  'export const w = `UPDATE t SET d = now() WHERE e <= $2`;',
  'const CASEQ = `CASE',
  '  WHEN s = 1 THEN 2',
  '  ELSE 3 END`;',
  'export function check(v) {',
  "  if (!v) bad('v');",
  '  await this.repo.save(v);',
  '}',
  '',
].join('\n');
const MIG = 'ALTER TABLE t ADD CONSTRAINT t_pos CHECK (n >= 0);\nCREATE UNIQUE INDEX t_u ON t (a);\n';
const ar = setup({ mutations: [], files: { 'svc.mjs': AUTO, 'm1.sql': MIG } });
const lst = spawnSync('node', [script, join(ar, 'm.json'), '--cwd', ar, '--auto', 'svc.mjs', '--auto', 'm1.sql', '--list'], { encoding: 'utf8' });
assert.equal(lst.status, 0, lst.stdout + lst.stderr);
for (const op of ['and-cond', 'for-update', 'cmp', 'const-x10', 'drop-await', 'now-shift', 'in-drop', 'when-drop', 'guard-drop', 'constraint-drop']) assert.match(lst.stdout, new RegExp(`auto:(?:svc\\.mjs|m1\\.sql):\\d+:${op}`), `thiếu toán tử ${op}`);
// chạy thật: bộ test khẳng định đủ thì bắt hết; thiếu thì lọt, autoEquivalent giải thích được
const full = "import { q, BATCH_SIZE } from './svc.mjs';\nif (BATCH_SIZE !== 50 || !q.includes('AND b =') || !q.includes('FOR UPDATE')) throw new Error('assert fail');\n";
const weak = "import { BATCH_SIZE } from './svc.mjs';\nif (BATCH_SIZE !== 50) throw new Error('assert fail');\n";
const only = ['--auto', 'svc.mjs', '--only', ':and-cond'];
const rr = (chk, extra = {}) => {
  const d = setup({ mutations: [], test: 'node chk.mjs', files: { 'svc.mjs': AUTO.replace('await this.repo.save(v);\n', ''), 'chk.mjs': chk }, extra });
  return { d, ...spawnSync('node', [script, join(d, 'm.json'), '--cwd', d, ...only], { encoding: 'utf8' }) };
};
x = rr(full);
assert.equal(x.status, 0, x.stdout + x.stderr);
assert.match(x.stdout, /auto:svc\.mjs:\d+:and-cond.* bắt/);
x = rr(weak);
assert.equal(x.status, 1, 'đột biến tự sinh lọt chưa giải thích thì thoát 1');
assert.match(x.stdout, /and-cond.* lọt/);
const id = x.stdout.match(/(auto:svc\.mjs:\d+:and-cond\S*)/)[1];
assert.equal(rr(weak, { autoEquivalent: { [id]: 'ghi chú' } }).status, 0, 'đã giải thích bằng autoEquivalent thì qua');
// hỏng biên dịch ở đột biến tự sinh: bỏ qua, không tính lỗi
const cr2 = setup({ mutations: [], test: 'node chk.mjs', files: { 'svc.mjs': "export const BATCH_SIZE = 50;\nexport const k = (v) => {\n  if (!v) throw new Error('v');\n  return v;\n};\n", 'chk.mjs': "import './svc.mjs';\n" } });
x = spawnSync('node', [script, join(cr2, 'm.json'), '--cwd', cr2, '--auto', 'svc.mjs', '--only', ':guard-drop'], { encoding: 'utf8' });
assert.match(x.stdout, /guard-drop.* lọt/, 'chk không khẳng định gì nên đột biến guard lọt');
console.log('OK: mutate.mjs');
