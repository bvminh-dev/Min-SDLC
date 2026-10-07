import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from '../support/db';
import { run, runScript } from '../support/sh';

/** Lint mã giả ở đường dẫn giả bằng ESLint CLI (ESLint nạp cấu hình ESM nên chạy ở tiến trình con, không trong Jest). */
function lint(code: string, filePath: string) {
  const r = run(join(REPO_ROOT, 'node_modules/.bin/eslint'), ['--stdin', '--stdin-filename', filePath, '-f', 'json'], { input: code });
  const parsed = JSON.parse(r.stdout)[0];
  return { status: r.status, messages: parsed.messages as { ruleId: string; line: number; message: string }[] };
}

describe('Lint của CI', () => {
  it('PRJ-TC-20261006-100124415: lint cấm $queryRawUnsafe và $executeRawUnsafe nêu tệp, dòng, quy tắc; $queryRaw tagged template thì qua', () => {
    const bad = lint('export async function f(prisma: any, input: string) {\n  await prisma.$queryRawUnsafe("SELECT * FROM t WHERE a = " + input);\n  await prisma.$executeRawUnsafe("DELETE FROM t");\n}\n', 'apps/api/src/modules/catalog/dao.ts');
    expect(bad.status).toBe(1);
    const unsafe = bad.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(unsafe.map((m) => m.line)).toEqual([2, 3]);
    expect(unsafe[0].message).toContain('Unsafe');
    const good = lint('export async function f(prisma: any, input: string) {\n  return prisma.$queryRaw`SELECT * FROM t WHERE a = ${input}`;\n}\n', 'apps/api/src/modules/catalog/dao.ts');
    expect(good.status).toBe(0);
  });

  it('PRJ-TC-20261006-160721686: lint cấm Unsafe cả khi gọi bằng ngoặc vuông, tách thuộc tính hoặc trong callback giao dịch', () => {
    const cases: Record<string, string> = {
      'ngoặc vuông': "export async function f(prisma: any) {\n  await prisma['$queryRawUnsafe']('SELECT 1');\n}\n",
      'tách thuộc tính': 'export async function f(prisma: any) {\n  const { $executeRawUnsafe } = prisma;\n  await $executeRawUnsafe(\'DELETE FROM t\');\n}\n',
      'trong giao dịch': "export async function f(tx: any) {\n  await tx.$executeRawUnsafe('DELETE FROM t');\n}\n",
    };
    for (const [name, code] of Object.entries(cases)) {
      const r = lint(code, 'apps/api/src/modules/catalog/dao.ts');
      expect([name, r.status]).toEqual([name, 1]);
      const m = r.messages.find((x) => x.ruleId === 'no-restricted-syntax');
      expect(m?.message).toContain('Unsafe');
      expect(m?.line).toBeGreaterThan(1);
    }
    expect(lint('export async function f(tx: any, a: string) {\n  return tx.$queryRaw`SELECT ${a}`;\n}\n', 'apps/api/src/modules/catalog/dao.ts').status).toBe(0);
  });

  it('PRJ-TC-20261006-100125068: lint cấm process.env ngoài module cấu hình nêu tệp và dòng; đọc qua dịch vụ cấu hình thì qua', () => {
    const bad = lint('export const a = 1;\nexport const url = process.env.DATABASE_URL;\n', 'apps/api/src/modules/catalog/x.ts');
    expect(bad.status).toBe(1);
    expect(bad.messages.find((m) => m.ruleId === 'no-restricted-syntax')).toMatchObject({ line: 2 });
    expect(bad.messages.find((m) => m.ruleId === 'no-restricted-syntax')?.message).toContain('process.env');
    const viaConfig = lint("import { ConfigService } from '../platform';\nexport const f = (c: ConfigService) => c.get('DATABASE_URL');\n", 'apps/api/src/modules/catalog/x.ts');
    expect(viaConfig.status).toBe(0);
    expect(lint('export const url = process.env.DATABASE_URL;\n', 'apps/api/src/modules/platform/config/config.ts').status).toBe(0); // module cấu hình được phép
  });

  it('console.* bị cấm ngoài script công cụ (PRJ-REQ-20261006-095422908 BR3)', () => {
    const r = lint('export const f = () => console.log("x");\n', 'apps/api/src/modules/catalog/x.ts');
    expect(r.messages.some((m) => m.ruleId === 'no-console')).toBe(true);
  });
});

describe('Build web (PRJ-REQ-20261006-095422735 BR7)', () => {
  const check = (env: Record<string, string>, args: string[] = []) => runScript('apps/web/scripts/check-public-env.mjs', args, { env: { PATH: process.env.PATH ?? '', ...env } });
  const walk = (d: string, acc: string[] = []): string[] => {
    if (!existsSync(d)) return acc;
    for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, acc); else acc.push(p); }
    return acc;
  };

  it.each(['NEXT_PUBLIC_PAYMENT_SECRET', 'NEXT_PUBLIC_API_KEY', 'NEXT_PUBLIC_DB_PASSWORD', 'NEXT_PUBLIC_AUTH_TOKEN'])(
    'PRJ-TC-20261006-100125046: build web thất bại khi có %s, nêu tên biến, không in giá trị; bỏ biến thì qua',
    (name) => {
      const value = 'zq9-not-for-browser-7731';
      const r = check({ [name]: value });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(name);
      expect(r.out).not.toContain(value);
      // build dừng trước next build nên không có tệp build nào chứa giá trị
      for (const f of walk(join(REPO_ROOT, 'apps/web/.next')).filter((p) => /\.(js|json|html|txt|map)$/.test(p))) {
        expect(readFileSync(f, 'utf8')).not.toContain(value);
      }
      expect(check({}).status).toBe(0);
      expect(check({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001/api/v1' }).status).toBe(0);
    },
  );

  it('PRJ-TC-20261006-160721590: build web thất bại khi NEXT_PUBLIC_ chứa bí mật nằm trong tệp .env của web (Next.js nạp tệp này vào gói trình duyệt)', () => {
    const value = 'zq9-in-env-file-5521';
    const dir = mkdtempSync(join(tmpdir(), 'ecom-web-'));
    for (const [file, name] of [['.env', 'NEXT_PUBLIC_API_KEY'], ['.env.local', 'NEXT_PUBLIC_DB_PASSWORD'], ['.env.production', 'NEXT_PUBLIC_PAYMENT_SECRET'], ['.env.production.local', 'NEXT_PUBLIC_AUTH_TOKEN']]) {
      const d = mkdtempSync(join(dir, 'w-'));
      writeFileSync(join(d, file), `# cấu hình\nNEXT_PUBLIC_API_BASE_URL=http://localhost:3001\n${name}=${value}\n`);
      const r = check({}, ['--dir', d]);
      expect([file, r.status]).toEqual([file, 1]);
      expect(r.stderr).toContain(name);
      expect(r.stderr).toContain(file);
      expect(r.out).not.toContain(value);
    }
    const ok = mkdtempSync(join(dir, 'ok-'));
    writeFileSync(join(ok, '.env.production'), '# NEXT_PUBLIC_API_KEY=chú-thích\nNEXT_PUBLIC_API_BASE_URL=https://shop.example/api/v1\nexport NEXT_PUBLIC_SITE_NAME="Shop"\n');
    expect(check({}, ['--dir', ok]).status).toBe(0);
    const exported = mkdtempSync(join(dir, 'ex-'));
    writeFileSync(join(exported, '.env'), `export NEXT_PUBLIC_STRIPE_KEY="${value}"\n`);
    expect(check({}, ['--dir', exported]).status).toBe(1); // dạng `export NAME=...` cũng đọc
    expect(check({}, ['--dir', join(dir, 'khong-ton-tai')]).status).toBe(2); // thư mục sai: công cụ hỏng thì đỏ, không im lặng qua
  });
});
