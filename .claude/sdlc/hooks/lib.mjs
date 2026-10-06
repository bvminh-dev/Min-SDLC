// Tiện ích dùng chung cho hook của kit SDLC. Hook nhận JSON qua stdin.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECK_SPEC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-research/scripts/check-spec.mjs',
);

export const CHECK_FOUNDATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-foundation/scripts/check-foundation.mjs',
);

export const CHECK_UI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-ui-ux/scripts/check-ui.mjs',
);

export const CHECK_IMPACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-impact/scripts/check-impact.mjs',
);

export const CHECK_TESTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-test-design/scripts/check-tests.mjs',
);

export const CHECK_REPORT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-implement/scripts/check-report.mjs',
);

export const CHECK_REVIEW = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-review/scripts/check-review.mjs',
);

export const CHECK_TECH_DESIGN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../skills/sdlc-tech-design/scripts/check-tech-design.mjs',
);

const FOUNDATION_FILES = [
  'roadmap.md',
  'permissions-matrix.md',
  'constitution.md',
  'architecture.md',
  'security-baseline.md',
  'domain/roles.md',
  'domain/entities.md',
  'domain/events.md',
];

export function isFoundationFile(specDir, file) {
  return FOUNDATION_FILES.includes(relative(specDir, file).split(sep).join('/'));
}

// Đã bắt đầu dựng nền chưa (có ít nhất một file nền do skill foundation tạo, không tính roadmap/ma trận)?
export function foundationStarted(specDir) {
  return FOUNDATION_FILES.slice(2).some((f) => existsSync(resolve(specDir, f)));
}

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

// Trả về { specDir, file } nếu file là .md nằm trong một thư mục tên "spec", ngược lại null.
export function locateSpecFile(filePath, cwd) {
  if (!filePath || !filePath.endsWith('.md')) return null;
  const abs = resolve(cwd ?? process.cwd(), filePath);
  const parts = abs.split(sep);
  const i = parts.lastIndexOf('spec');
  if (i < 0 || i === parts.length - 1) return null;
  return { specDir: parts.slice(0, i + 1).join(sep), file: abs };
}

export function frontmatterOf(text) {
  const m = (text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

export function statusOfFile(file) {
  if (!existsSync(file)) return null;
  return frontmatterOf(readFileSync(file, 'utf8'))?.status ?? null;
}

// Chặn hook: stderr được đưa lại cho Claude, exit 2 = chặn.
export function block(message) {
  console.error(message);
  process.exit(2);
}
