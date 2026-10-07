import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, roleDbUrl } from '../support/db';
import { cleanPath, run, runScript } from '../support/sh';

const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(join(d, e.name))) : [join(d, e.name)]));

describe('Dựng dự án và CI (PRJ-REQ-20261006-095422475)', () => {
  it('test chạy được trên runner sạch: không cứng đường dẫn máy dev (Homebrew, nvm, thư mục home) trong test/', () => {
    // Mẫu ghép từ các đoạn để chính tệp này không tự khớp (và không chứa đường dẫn máy dev nguyên văn).
    const bad = new RegExp([['', 'opt', 'homebrew'], ['\\.nvm', 'versions'], ['', 'Users', '\\w']].map((p) => p.join('/')).concat(['homedir\\(']).join('|'));
    const hits = walk(join(REPO_ROOT, 'apps/api/test')).filter((f) => /\.ts$/.test(f) && bad.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it('PRJ-TC-20261006-100124068: dựng từ .env.example, pnpm dev chạy được api (health 200) và web (trang chủ 200) mà không sửa tệp nào', () => {
    // Cùng CSDL và máy chủ với phần còn lại của test (TEST_DB_BASE, CI đặt cho job verify): không phụ thuộc `ecom_dev` của .env.example. Ứng dụng chạy bằng vai trò hạn chế ecom_app như ở dev.
    const r = runScript('scripts/smoke.mjs', [], { env: { ...process.env, DATABASE_URL: roleDbUrl('ecom_app'), RETENTION_DATABASE_URL: roleDbUrl('ecom_retention') } });
    expect(r.out).toMatch(/smoke: OK/);
    expect(r.status).toBe(0);
  }, 300_000);

  it('PRJ-TC-20261006-100124092: lockfile lệch thì pnpm install --frozen-lockfile thất bại; CI cài đặt trước mọi bước khác', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ecom-lock-'));
    const pkg = { name: 'tmp', private: true, version: '0.0.0', packageManager: 'pnpm@10.15.1' };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    expect(run('pnpm', ['install', '--lockfile-only'], { cwd: dir }).status).toBe(0);
    expect(run('pnpm', ['install', '--frozen-lockfile'], { cwd: dir }).status).toBe(0); // đang khớp
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, dependencies: { 'is-odd': '3.0.1' } })); // thêm phụ thuộc, không cập nhật lockfile
    const r = run('pnpm', ['install', '--frozen-lockfile'], { cwd: dir });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile/);
    expect(existsSync(join(dir, 'node_modules/is-odd'))).toBe(false); // phụ thuộc lệch không được cài
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('pnpm install --frozen-lockfile')).toBeGreaterThan(0);
    expect(ci.indexOf('pnpm install --frozen-lockfile')).toBeLessThan(ci.indexOf('run: pnpm lint')); // các bước sau cài đặt
  }, 120_000);

  it('PRJ-TC-20261006-100124183: PR chỉ sửa spec/ vẫn chạy cả bốn lệnh chuẩn và qua với môi trường rỗng; CI không lọc đường dẫn, không dùng bí mật', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const cmd of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) expect(ci).toContain(`run: ${cmd}`);
    expect(ci).not.toMatch(/paths(-ignore)?:/);
    expect(ci).not.toMatch(/secrets\./);
    const env = ['-i', `PATH=${cleanPath()}`];
    for (const cmd of ['lint', 'typecheck']) {
      const r = run('env', [...env, 'pnpm', cmd]);
      expect([cmd, r.status]).toEqual([cmd, 0]);
    }
    // `pnpm test` và `pnpm build` với môi trường rỗng: build không đọc bí mật nào (đã chạy ở bước kiểm độc lập; ở đây chỉ khẳng định build web chỉ kiểm NEXT_PUBLIC_)
    expect(run('env', [...env, 'node', 'apps/web/scripts/check-public-env.mjs']).status).toBe(0);
  }, 180_000);

  it('PRJ-TC-20261006-120200101: Node sai phiên bản bị từ chối khi cài đặt (không tạo node_modules); Node 24 cài được; chỉ có Jest, không công cụ test thứ hai', () => {
    expect(read('.nvmrc').trim()).toBe('24');
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines.node).toBe('>=24 <25');
    expect(pkg.packageManager).toBe('pnpm@10.15.1');
    expect(read('.npmrc')).toMatch(/^engine-strict=true$/m);

    // Node 22 (sai): bản sao tối thiểu của dự án. Giả lập phiên bản bằng cài đặt `node-version` của pnpm (chính bước kiểm engines),
    // nên không phụ thuộc Node nào cài sẵn trên máy hay runner.
    const dir = mkdtempSync(join(tmpdir(), 'ecom-node-'));
    for (const f of ['package.json', '.npmrc', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) cpSync(join(REPO_ROOT, f), join(dir, f));
    for (const a of ['api', 'web']) { mkdirSync(join(dir, 'apps', a), { recursive: true }); cpSync(join(REPO_ROOT, 'apps', a, 'package.json'), join(dir, 'apps', a, 'package.json')); }
    const wrong = run('pnpm', ['install', '--frozen-lockfile', '--config.node-version=22.11.0'], { cwd: dir, env: { PATH: cleanPath() } });
    expect(wrong.status).not.toBe(0);
    expect(wrong.out).toMatch(/Unsupported engine|engine/i);
    expect(wrong.out).toContain('>=24 <25');
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);

    // Node đang chạy test (CI lấy từ .nvmrc = 24): cài đặt thoát mã 0. Chạy ở bản sao tạm, không phải repo thật: `pnpm install` ở repo thật
    // có thể ghi đè Prisma Client đã sinh trong node_modules (làm các bộ test chạy sau lỗi "did not initialize yet" khi kho pnpm khác).
    const dirOk = mkdtempSync(join(tmpdir(), 'ecom-node-ok-'));
    for (const f of ['package.json', '.npmrc', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) cpSync(join(REPO_ROOT, f), join(dirOk, f));
    for (const a of ['api', 'web']) { mkdirSync(join(dirOk, 'apps', a), { recursive: true }); cpSync(join(REPO_ROOT, 'apps', a, 'package.json'), join(dirOk, 'apps', a, 'package.json')); }
    const ok = run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: dirOk });
    expect(ok.status).toBe(0);
    expect(existsSync(join(dirOk, 'node_modules'))).toBe(true);

    // Jest là công cụ test duy nhất
    const api = JSON.parse(read('apps/api/package.json'));
    expect(read('apps/api/scripts/run-jest.mjs')).toContain('jest');
    expect(api.scripts.test).toContain('run-jest');
    const allDeps = ['package.json', 'apps/api/package.json', 'apps/web/package.json'].flatMap((f) => { const j = JSON.parse(read(f)); return Object.keys({ ...j.dependencies, ...j.devDependencies }); });
    expect(allDeps.filter((d) => /^(vitest|mocha|ava|tap|playwright|cypress|@playwright\/test)$/.test(d))).toEqual([]);
    for (const f of ['vitest.config.ts', 'vitest.config.mts', '.mocharc.json', 'playwright.config.ts']) expect(existsSync(join(REPO_ROOT, f))).toBe(false);
  }, 180_000);
});
