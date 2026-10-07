#!/usr/bin/env node
// Quét bí mật (SB-15, PRJ-SEC T1). `--staged`: chỉ tệp đã stage (hook trước commit); mặc định: mọi tệp git theo dõi (CI).
// Dòng chứa `scan-secrets:allow` được bỏ qua. In tệp và dòng, KHÔNG in giá trị khớp.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const NAME = String.raw`[\w.-]*(?:secret|password|passwd|pwd|token|key)\w*`;
const NOT_FAKE = '(?!(?:changeme|example|placeholder|your|test|dummy|xxx|\\$|\\{|<|%))';
const PATTERNS = [
  ['khóa truy cập AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['khóa riêng PEM', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['token GitHub', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['token Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['khóa Stripe', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  // Gán bí mật: tên chứa secret/password/passwd/pwd/token/key (không phân biệt hoa thường, đủ dạng
  // KEY=v, key: v, const KEY = 'v';, {"apiKey": "v"}). Giá trị >= 16 ký tự, có ít nhất một chữ số (tránh bắt tên hàm, khóa i18n),
  // không phải giá trị giả hiển nhiên. Dạng không ngoặc kép chỉ tính khi giá trị là hết dòng (tránh bắt mã như `key: fn(x)`).
  ['gán bí mật (có ngoặc kép)', new RegExp(String.raw`\b${NAME}["']?\s*[=:]\s*["']${NOT_FAKE}(?=[^"'\s]*\d)[^"'\s$<{]{16,}["']`, 'i')],
  ['gán bí mật', new RegExp(String.raw`\b${NAME}\s*[=:]\s*${NOT_FAKE}(?=[A-Za-z0-9+/_=~-]*\d)[A-Za-z0-9+/_=~-]{16,}\s*(?:#.*)?$`, 'im')],
  // URL kết nối có mật khẩu trong phần userinfo (scheme, user, mật khẩu rồi host).CSDL local của docker compose (localhost) và giá trị giữ chỗ được bỏ qua.
  ['URL có mật khẩu', new RegExp(String.raw`\b[a-z][a-z0-9+.-]*://[^\s:/@"'<>$]*:${NOT_FAKE}[^\s@/"'<>$]+@(?!localhost\b|127\.0\.0\.1|\[::1\])[^\s"']+`, 'i')], // scan-secrets:allow
];
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
// Đỏ khi công cụ hỏng: không đọc được danh sách tệp (không phải git, git lỗi) thì thoát 2, không im lặng cho qua.
let list;
try { list = staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM']) : git(['ls-files', '-co', '--exclude-standard']); } catch (e) {
  process.stderr.write(`scan-secrets: không đọc được danh sách tệp từ git (${String(e.stderr || e.message).trim().split('\n')[0]})\n`);
  process.exit(2);
}
const files = list.split('\n').filter(Boolean).filter((f) => !/(^|\/)(pnpm-lock\.yaml|.*\.(png|jpg|ico|woff2?))$/.test(f));
// Quét CI mà không có tệp nào là cấu hình sai (không phải "sạch"); hook --staged rỗng thì qua.
if (!staged && !files.length) {
  process.stderr.write('scan-secrets: không có tệp nào để quét (cấu hình sai, không phải sạch)\n');
  process.exit(2);
}

const hits = [];
for (const f of files) {
  let text;
  try { text = staged ? git(['show', `:${f}`]) : readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes('scan-secrets:allow')) return;
    for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${f}:${i + 1}: ${name}`);
  });
}
if (hits.length) {
  process.stderr.write(`Phát hiện chuỗi giống bí mật (không in giá trị):\n${hits.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`scan-secrets: sạch (${files.length} tệp)\n`);
