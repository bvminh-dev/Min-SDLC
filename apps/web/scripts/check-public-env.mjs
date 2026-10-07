// PRJ-REQ-20261006-095422735 BR7 / PRJ-SEC T3: build web thất bại nếu biến NEXT_PUBLIC_* có tên chứa bí mật.
// Kiểm cả biến môi trường của tiến trình lẫn các tệp .env của web (Next.js nạp .env, .env.local, .env.<môi trường>[.local] vào gói trình duyệt).
// Chỉ in TÊN biến và tên tệp, không in giá trị. `--dir <thư mục>` đổi thư mục web (mặc định: thư mục cha của script).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN = /(SECRET|KEY|PASSWORD|TOKEN)/i;
const dirArg = process.argv.indexOf('--dir');
const webDir = dirArg > 0 ? resolve(process.argv[dirArg + 1] ?? '') : resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(webDir)) {
  process.stderr.write(`check-public-env: không thấy thư mục web: ${webDir}\n`);
  process.exit(2);
}

const bad = Object.keys(process.env).filter((n) => n.startsWith('NEXT_PUBLIC_') && FORBIDDEN.test(n)).map((n) => `${n} (biến môi trường)`);
for (const f of readdirSync(webDir).filter((n) => /^\.env(\.(development|production|test))?(\.local)?$/.test(n))) {
  for (const line of readFileSync(join(webDir, f), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?(NEXT_PUBLIC_[A-Za-z0-9_]*)\s*=/);
    if (m && FORBIDDEN.test(m[1])) bad.push(`${m[1]} (${f})`);
  }
}
if (bad.length) {
  process.stderr.write(`Build web bị chặn: biến NEXT_PUBLIC_* có tên chứa SECRET, KEY, PASSWORD hoặc TOKEN: ${bad.join(', ')}\n`);
  process.exit(1);
}
