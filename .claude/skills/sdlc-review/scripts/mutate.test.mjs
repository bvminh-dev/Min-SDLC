// Kiểm nhanh mutate.mjs: node mutate.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'mutate.mjs');
const SRC = 'export const pos = (x) => x > 0;\nexport const unused = () => 1;\n';
function run(mutations, { src = SRC, test = 'node check.mjs' } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'mutate-'));
  writeFileSync(join(r, 'src.mjs'), src);
  writeFileSync(join(r, 'check.mjs'), "import { pos } from './src.mjs';\nif (!pos(1) || pos(-1)) throw new Error('assert fail');\n");
  writeFileSync(join(r, 'm.json'), JSON.stringify({ test, mutations }));
  const x = spawnSync('node', [script, join(r, 'm.json'), '--cwd', r], { encoding: 'utf8' });
  return { ...x, src: readFileSync(join(r, 'src.mjs'), 'utf8') };
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
console.log('OK: mutate.mjs');
