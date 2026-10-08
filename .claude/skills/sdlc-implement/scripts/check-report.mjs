#!/usr/bin/env node
// Kiểm `spec/epics/<EPIC>/report.md` với spec và mã nguồn: truy vết test case -> test code, task -> tài liệu spec.
// Dùng: node check-report.mjs <spec-dir> <thư-mục-mã> --epic <EPIC>
// Không chạy test (không biết stack); chỉ kiểm báo cáo trung thực với những gì có trên đĩa.
// Kiểm mới (L22 YẾU, L23 đường dẫn máy, L24 clean_run, L29 Kiểm đột biến, L38 nhãn Lệch spec) là LỖI với báo cáo có `kit_version: 2`
// (template mới) hoặc `--strict`; báo cáo cũ không có trường đó chỉ bị cảnh báo để không làm vỡ báo cáo đã có.
// Kiểm thêm (L43 nhãn sai, L49 mốc thời gian cứng, L53 sửa mã nền không test, L55 đo thời gian tuần tự) là LỖI với `kit_version: 3` hoặc `--strict`,
// cảnh báo với báo cáo kit_version 2 (không làm đỏ báo cáo đã có).
//  --base <ref>: so mã đổi với <ref> thay vì HEAD (L53; mặc định: tệp sửa và tệp chưa theo dõi so với HEAD)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const epic = argv.includes('--epic') ? argv[argv.indexOf('--epic') + 1] : null;
const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'HEAD';
const [specDir, codeDir] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--epic' && argv[i - 1] !== '--base');
if (!specDir || !codeDir || !epic) { console.error('Dùng: check-report.mjs <spec-dir> <code-dir> --epic <EPIC>'); process.exit(2); }

const walk = (d, acc = []) => {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, acc) : acc.push(p); }
  return acc;
};
const fmOf = (t) => {
  const fm = {};
  for (const l of (t.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '').split(/\r?\n/)) {
    const kv = l.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
};
// trình định dạng markdown căn lề bảng (thêm khoảng trắng): so khớp tiêu đề sau khi gộp khoảng trắng
const squash = (l) => l.replace(/[ \t]+/g, ' ');
const rows = (t, headerStart) => {
  const ls = t.split(/\r?\n/), i = ls.findIndex((l) => squash(l).startsWith(headerStart));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 2; j < ls.length && ls[j].startsWith('|'); j++) out.push(ls[j].split('|').slice(1, -1).map((c) => c.trim()));
  return out;
};

const errors = [], warnings = [];
const reportPath = join(specDir, 'epics', epic, 'report.md');
const err = (m) => errors.push(`${reportPath}: ${m}`);
if (!existsSync(reportPath)) { console.error(`${reportPath}: chưa có báo cáo triển khai`); process.exit(1); }
const text = readFileSync(reportPath, 'utf8');
const fm = fmOf(text);
const fresh = Number(fm.kit_version) >= 2 || argv.includes('--strict');
const gate = (m) => (fresh ? err(m) : warnings.push(`${reportPath}: ${m} (báo cáo không có kit_version: 2 nên chỉ cảnh báo)`));
const fresh3 = Number(fm.kit_version) >= 3 || argv.includes('--strict');
const gate3 = (m) => (fresh3 ? err(m) : warnings.push(`${reportPath}: ${m} (báo cáo chưa có kit_version: 3 nên chỉ cảnh báo)`));
if (fm.epic !== epic) err(`epic trong frontmatter phải là ${epic}`);
if (!fm.test_command) err('thiếu test_command (lệnh test đã chạy)');
if (!fm.test_result) err('thiếu test_result (dòng tóm tắt do lệnh test in ra)');

// ID có thật trong spec; tài liệu test của epic
const specIds = new Set(), tests = [];
let sawSecError = false; // epic có TC kind `lỗi` kiểm một mối đe dọa SEC
for (const f of walk(specDir)) {
  if (!f.endsWith('.md')) continue;
  const doc = readFileSync(f, 'utf8'), id = (doc.match(/^id:\s*(\S+)/m) ?? [])[1];
  if (id) specIds.add(id);
  if (id && /-(TC|E2E)-/.test(id) && f.includes(join('epics', epic))) {
    tests.push(id);
    const tfm = fmOf(doc);
    if (tfm.kind === 'lỗi' && /\[\s*[^\s\]]/.test(tfm.threats ?? '')) sawSecError = true;
  }
  if (/[\\/]ui[\\/][^\\/]+\.md$/.test(f) && f.includes(join('epics', epic))) specIds.add(`ui/${f.split(/[\\/]/).at(-1).replace(/\.md$/, '')}`);
}

// kế hoạch task
const tasks = rows(text, '| # | Task');
if (!tasks?.length) err('thiếu bảng "Kế hoạch task" (| # | Task | Nguồn | Phụ thuộc | Trạng thái |)');
else {
  const nums = new Set(tasks.map((t) => t[0]));
  for (const [n, , src, dep, st] of tasks) {
    if (!['todo', 'doing', 'done', 'blocked'].includes(st)) err(`task ${n}: Trạng thái phải là todo|doing|done|blocked`);
    for (const s of src.split(',').map((x) => x.trim()).filter((x) => x && x !== '-')) if (!specIds.has(s)) err(`task ${n}: Nguồn ${s} không có trong spec/`);
    for (const d of dep.split(',').map((x) => x.trim()).filter((x) => x && x !== '-')) if (!nums.has(d)) err(`task ${n}: Phụ thuộc ${d} không phải số task`);
  }
}

// kết quả test
// L49 (mốc thời gian cứng quanh hôm nay) và L55 (hai medianMs( liền nhau trong cùng một test)
const dayNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 864e5), today = Math.floor(Date.now() / 864e5);
const scanTime = (path, code) => {
  const ls = code.split('\n');
  ls.forEach((l, i) => {
    const m = l.match(/['"`](\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z?)?['"`]/);
    if (m && Math.abs(dayNum(m[1]) - today) <= 2 && !/fixed-clock:/.test(l) && !/fixed-clock:/.test(ls[i - 1] ?? '')) gate3(`${path}:${i + 1}: mốc thời gian cứng ${m[1]} quanh hôm nay: trộn với now() của CSDL thì vỡ ngay sau mốc; dùng đồng hồ giả cho mọi nguồn thời gian và ghi \`fixed-clock: <lý do>\` ở dòng này hoặc dòng trước`);
    if (/\bmedianMs\(/.test(l)) {
      for (let j = i - 1; j >= Math.max(0, i - 4) && !/^\s*(?:it|test|describe)\(/.test(ls[j]); j--) if (/\bmedianMs\(/.test(ls[j])) { gate3(`${path}:${j + 1}: đo tuần tự hai nhánh (medianMs( liền nhau): tải máy trôi theo thời gian làm lệch một nhánh; đo xen kẽ hoặc đếm số lần gọi hàm băm thay cho thời gian`); break; }
    }
  });
};
const weak = [], MACHINE = /\/Users\/|\/home\/[\w.-]+|\/opt\/homebrew|\.nvm\/versions|\b[A-Za-z]:\\{1,2}[A-Za-z]/;
const res = rows(text, '| ID | Loại');
if (!res) err('thiếu bảng "Kết quả test" (| ID | Loại | Test code | Kết quả | Ghi chú |)');
else {
  const listed = new Set(), scanned = new Set();
  for (const [id, , path, kq, note] of res) {
    listed.add(id);
    if (note.startsWith('YẾU:')) weak.push(id);
    if (!tests.includes(id)) err(`${id}: không phải test case/E2E của epic ${epic} trong spec`);
    if (!['pass', 'fail', 'skip'].includes(kq)) err(`${id}: Kết quả phải là pass|fail|skip`);
    if (kq === 'skip' && (!note || note === '-')) err(`${id}: skip phải có lý do ở Ghi chú`);
    const p = resolve(codeDir, path);
    if (!existsSync(p) || !statSync(p).isFile()) err(`${id}: file test không tồn tại: ${path}`);
    else {
      const code = readFileSync(p, 'utf8');
      if (!scanned.has(path)) scanTime(path, code);
      if (!code.includes(id)) err(`${id}: file ${path} không chứa ID (đặt ID vào tên test hoặc comment để truy vết)`);
      if (!scanned.has(path)) {
        scanned.add(path);
        const bad = code.split('\n').findIndex((l) => MACHINE.test(l) && !/check-report:allow\s+\S/.test(l));
        if (bad >= 0) gate(`${path}:${bad + 1}: đường dẫn máy (/Users, /home/<tên>, /opt/homebrew, .nvm/versions, ổ đĩa Windows) trong test: CI sẽ không có; dùng PATH/biến môi trường hoặc ghi \`check-report:allow <lý do>\``);
      }
    }
  }
  for (const id of tests) if (!listed.has(id)) err(`thiếu dòng cho ${id} (test case của epic chưa có trong báo cáo)`);
}
if (!/^## Lệch spec\s*\n+\S/m.test(text)) err('thiếu mục "## Lệch spec" có nội dung (hoặc ghi "Không có")');
const slang = (text.split(/^## /m).find((x) => x.startsWith('Lệch spec')) ?? '');

// L22: dòng YẾU phải được giải thích (lý do và cách nâng bằng chứng) trong Lệch spec
for (const id of weak) if (!slang.includes(id)) err(`${id}: Ghi chú bắt đầu bằng "YẾU:" nên mục Lệch spec phải nhắc ID này kèm lý do và cách nâng bằng chứng`);

// L24: chạy lại trong môi trường sạch giống CI
if (!fm.clean_run) gate('thiếu clean_run (pass | chưa): đã chạy bốn lệnh chuẩn trong bản clone sạch (git worktree, env -i) chưa');
else if (!['pass', 'chưa'].includes(fm.clean_run)) err('clean_run phải là pass hoặc chưa');
else if (fm.clean_run === 'chưa') {
  if (!/^\s*(?:\d+\.\s*|[-*]\s*)?(?:\*\*)?(?:\[[^\]]+\]\s*)?(?:\*\*)?CI chưa chạy:/m.test(slang)) err('clean_run: chưa thì Lệch spec phải có dòng bắt đầu bằng "CI chưa chạy:" nêu lý do');
  warnings.push(`${reportPath}: clean_run: chưa (CI chưa chạy thật): review coi là HIGH cho tới khi workflow chạy một lần`);
}

// L29: bảng Kiểm đột biến (thay test-first cho khung dự án; mỗi SB "Kiểm bằng: test" có ít nhất một đột biến)
const t1 = (tasks?.[0] ?? []).slice(0, 2).join(' ');
if (/khung|monorepo|scaffold/i.test(t1) || sawSecError) {
  const mut = rows(text, '| Chỗ phá');
  if (!mut) gate('thiếu mục "## Kiểm đột biến" (| Chỗ phá | Test đỏ | Kết quả |): khung dự án hoặc epic có TC lỗi kiểm SEC phải gài đột biến');
  else {
    if (mut.length < 3) err(`Kiểm đột biến cần ít nhất 3 dòng (có ${mut.length})`);
    const ids = new Set((res ?? []).map((r) => r[0]));
    for (const [where, red, kq] of mut) {
      if (!/^(bắt|lọt)/.test(kq)) err(`Kiểm đột biến / ${where}: Kết quả phải bắt đầu bằng "bắt" hoặc "lọt"`);
      if (![...ids].some((i) => red.includes(i)) && !(red === '-' && kq.startsWith('lọt'))) err(`Kiểm đột biến / ${where}: Test đỏ phải là ID có trong bảng Kết quả test`);
    }
  }
}

// L38: mỗi mục Lệch spec có nhãn
// L53: sửa mã module khác (nền) mà không có test dưới test/<module đó>/ đổi theo (ponytail: bố cục NestJS `src/modules/<m>/`; mã đổi lấy từ git, cây sạch thì không thấy gì)
const myMod = existsSync(join(specDir, 'architecture.md')) ? rows(readFileSync(join(specDir, 'architecture.md'), 'utf8'), '| Epic | Module')?.find((r) => r[0] === epic)?.[1] : null;
if (myMod) {
  const git = (...a) => spawnSync('git', a, { cwd: codeDir, encoding: 'utf8' }).stdout?.split('\n').filter(Boolean) ?? [];
  const changed = [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '-o', '--exclude-standard')])].filter((f) => existsSync(join(codeDir, f)));
  const byMod = new Map();
  for (const f of changed) { const m = f.match(/(?:^|\/)src\/modules\/([^/]+)\//)?.[1]; if (m && m !== myMod) byMod.set(m, [...(byMod.get(m) ?? []), f]); }
  for (const [m, fs] of byMod) if (!changed.some((f) => new RegExp(`(^|/)test/${m}/`).test(f))) gate3(`${fs.join(', ')}: sửa mã module ${m} (epic ${epic} ở module ${myMod}) mà không có test nào dưới test/${m}/ đổi theo: thêm test hoặc đột biến cho từng chỗ sửa`);
}
const labelCount = { 'đã chọn': 0, 'chưa làm': 0, 'cần quyết': 0 };
const unlabeled = [];
for (const l of slang.split(/\r?\n/)) {
  if (!/^\d+\.\s/.test(l)) continue;
  const lb = l.match(/^\d+\.\s*(?:\*\*)?\[(đã chọn|chưa làm|cần quyết)\]/)?.[1];
  lb ? labelCount[lb]++ : unlabeled.push(l.match(/^\d+/)[0]);
  const n = l.match(/^\d+/)[0];
  // L43: [đã chọn] mà việc thật cần người hoặc sdlc-impact/sdlc-foundation quyết
  if (lb === 'đã chọn' && /(?:nên|cần|phải|chờ)\b[^.;]{0,80}?(?:qua|bằng|chạy)\s*`?sdlc-(?:impact|foundation)|nên ghi vào (?:ADR|nền)|review \w+ cân nhắc lại|chưa (?:chạy|qua)\s*`?sdlc-/i.test(l)) gate3(`Lệch spec mục ${n} gắn [đã chọn] nhưng nội dung còn chờ sdlc-impact/sdlc-foundation (hoặc "nên ghi vào ADR"): đổi sang [cần quyết] (hoặc [chưa làm] nếu việc chưa xong)`);
  // L53: sửa nền phải nêu TC/E2E cho chỗ sửa
  if (/sửa (?:mã )?(?:nền|của PRJ|platform)/i.test(l) && !/-(?:TC|E2E)-\d/.test(l)) gate3(`Lệch spec mục ${n}: sửa nền (mã module khác) mà mục không nêu ID TC/E2E kiểm từng chỗ sửa`);
  // L55: "nhiễu đo" phải kèm bản sửa hoặc việc cho người
  if (/nhiễu đo/i.test(l) && lb === 'đã chọn' && !/đã sửa|đo xen kẽ|đếm số lần/i.test(l)) gate3(`Lệch spec mục ${n} ghi "nhiễu đo" cho test đỏ mà không kèm bản sửa (đo xen kẽ, đếm số lần gọi) hoặc việc cho người: đổi sang [cần quyết]/[chưa làm] hoặc sửa test`);
}
if (unlabeled.length) gate(`Lệch spec mục ${unlabeled.join(', ')} thiếu nhãn [đã chọn] | [chưa làm] | [cần quyết] ở đầu mục`);

if (errors.length) { console.error(errors.join('\n') + `\n\n${errors.length} lỗi.`); process.exit(1); }
console.log(`OK: báo cáo triển khai epic ${epic} khớp spec và mã nguồn.`);
console.log(`Bằng chứng yếu: ${weak.length}${weak.length ? ` (${weak.join(', ')})` : ''}`);
console.log(`Lệch spec theo nhãn: ${Object.entries(labelCount).map(([k, v]) => `${k}=${v}`).join(', ')}${unlabeled.length ? `, chưa nhãn=${unlabeled.length}` : ''}`);
for (const w of warnings) console.log(`Lưu ý: ${w}`);
