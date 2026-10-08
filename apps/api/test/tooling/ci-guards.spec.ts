import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../support/db';
import { run, runScript } from '../support/sh';
import { mkTmp } from '../support/tmp';

const tmp = () => mkTmp('ecom-ci-');
// Chuỗi bí mật giả ghép lúc chạy để chính tệp test này không bị máy quét bắt.
const FAKE_SECRET = `VNPAY_HASH_SECRET=${'AKIA' + 'IOSFODNN7EXAMPLE'}`;

describe('Quét bí mật và lỗ hổng (PRJ-REQ-20261006-095422475 BR6)', () => {
  it('PRJ-TC-20261006-100124136: hook trước commit chặn bí mật, nêu tệp và dòng; --no-verify qua hook nhưng quét ở CI vẫn đỏ', () => {
    const dir = tmp();
    const git = (...a: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
    git('init', '-q');
    git('config', 'core.hooksPath', join(REPO_ROOT, '.githooks'));
    writeFileSync(join(dir, 'config.txt'), `# cấu hình\n${FAKE_SECRET}\n`);
    git('add', 'config.txt');
    const blocked = git('commit', '-m', 'thêm khóa');
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('config.txt:2');
    expect(blocked.stderr).not.toContain('AKIA'); // không in giá trị
    expect(git('rev-list', '--all', '--count').stdout.trim()).toBe('0'); // commit không được tạo
    // bỏ qua hook: commit được tạo, CI vẫn quét ra
    expect(git('commit', '--no-verify', '-m', 'bỏ qua hook').status).toBe(0);
    const ci = runScript('scripts/scan-secrets.mjs', [], { cwd: dir });
    expect(ci.status).toBe(1);
    expect(ci.stderr).toContain('config.txt:2');
    // tệp sạch thì qua
    writeFileSync(join(dir, 'config.txt'), 'DATABASE_URL=postgresql://ecom:ecom@localhost:5433/ecom_dev\nNEXT_PUBLIC_API_BASE_URL=http://localhost:3001\n');
    expect(runScript('scripts/scan-secrets.mjs', [], { cwd: dir }).status).toBe(0);
  });

  it('PRJ-TC-20261006-100124159: quét lỗ hổng báo lỗi mức high và thoát mã khác 0; mức thấp hơn ngưỡng không làm đỏ', () => {
    const dir = tmp();
    const report = (v: Record<string, number>, advisories = {}) => {
      const f = join(dir, `audit-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({ advisories, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...v } } }));
      return f;
    };
    const high = runScript('scripts/audit-gate.mjs', ['--input', report({ high: 1 }, { 1: { severity: 'high', module_name: 'pkg-cố-định-có-lỗ-hổng', title: 'RCE' } })]);
    expect(high.status).toBe(1);
    expect(high.stderr).toContain('pkg-cố-định-có-lỗ-hổng');
    expect(runScript('scripts/audit-gate.mjs', ['--input', report({ critical: 1 })]).status).toBe(1);
    expect(runScript('scripts/audit-gate.mjs', ['--input', report({ low: 3, moderate: 2 })]).status).toBe(0);
    const bad = join(dir, 'garbage.json');
    writeFileSync(bad, 'không phải json');
    expect(runScript('scripts/audit-gate.mjs', ['--input', bad]).status).toBe(2); // không im lặng cho qua khi registry lỗi
  });

  it('PRJ-TC-20261006-160721784: SB-17 cổng quét lỗ hổng thất bại khi không có kết quả hợp lệ (registry lỗi, JSON {"error"}, thiếu metadata), không in high=0', () => {
    const dir = tmp();
    const input = (name: string, body: unknown) => { const f = join(dir, name); writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); return f; };
    const errBody = { error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'registry không trả lời' } };
    for (const [name, body] of [['error.json', errBody], ['no-meta.json', { advisories: {} }], ['empty-vulns.json', { metadata: { vulnerabilities: {} } }], ['empty.json', '']] as const) {
      const r = runScript('scripts/audit-gate.mjs', ['--input', input(name, body)]);
      expect([name, r.status]).toEqual([name, 2]);
      expect(r.out).toMatch(/audit-gate: .*(không có kết quả hợp lệ|không đọc được)/);
      expect(r.out).not.toMatch(/high=0/);
    }
    // chạy thật qua `pnpm audit`: pnpm giả in lỗi registry và thoát 1 (bỏ qua mã thoát là lỗi gốc của cổng cũ)
    const fake = join(dir, 'bin'); mkdirSync(fake);
    const pnpm = join(fake, 'pnpm');
    writeFileSync(pnpm, `#!/bin/sh\necho '${JSON.stringify(errBody)}'\nexit 1\n`); chmodSync(pnpm, 0o755);
    const live = runScript('scripts/audit-gate.mjs', [], { env: { ...process.env, PATH: `${fake}:${process.env.PATH}` } });
    expect(live.status).toBe(2);
    expect(live.out).not.toMatch(/high=0/);
    writeFileSync(pnpm, '#!/bin/sh\nexit 1\n'); // thoát 1, không in gì
    expect(runScript('scripts/audit-gate.mjs', [], { env: { ...process.env, PATH: `${fake}:${process.env.PATH}` } }).status).toBe(2);
    writeFileSync(pnpm, `#!/bin/sh\necho '${JSON.stringify({ metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } } })}'\nexit 1\n`); // hợp lệ nhưng thoát 1 mà không có lỗ hổng
    expect(runScript('scripts/audit-gate.mjs', [], { env: { ...process.env, PATH: `${fake}:${process.env.PATH}` } }).status).toBe(2);
    // kết quả hợp lệ không có lỗ hổng: pnpm thoát 0 thì qua
    writeFileSync(pnpm, `#!/bin/sh\necho '${JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } } })}'\n`);
    expect(runScript('scripts/audit-gate.mjs', [], { env: { ...process.env, PATH: `${fake}:${process.env.PATH}` } }).status).toBe(0);
  });

  it('PRJ-TC-20261006-160721401: SB-15 quét bí mật bắt URL CSDL có mật khẩu, gán kết thúc bằng ";", khóa JSON camelCase, tên chữ thường; không báo giá trị giả hiển nhiên', () => {
    const j = (...p: string[]) => p.join(''); // ghép lúc chạy để tệp test này không tự bị quét
    const scan = (line: string) => {
      const dir = tmp();
      run('git', ['init', '-q'], { cwd: dir });
      writeFileSync(join(dir, 'f.txt'), `${line}\n`);
      return runScript('scripts/scan-secrets.mjs', [], { cwd: dir });
    };
    const positives: Record<string, string> = {
      'URL CSDL có mật khẩu': j('DATABASE_URL=postgres://user:', 'pass@host/db'),
      'URL CSDL có mật khẩu (prod thật)': j('url: "postgresql://admin:', 'Zx9!kQ2w@db.internal.example.com:5432/ecom"'),
      'URL redis có mật khẩu': j('REDIS_URL=redis://:', 's3cretpw@cache.internal:6379'),
      'gán const kết thúc bằng ;': j("const STRIPE_", "KEY = 'abcdef1234567890abcdef';"), // scan-secrets:allow giá trị giả của test
      'khóa JSON camelCase': j('{"api', 'Key": "abcdef1234567890abcdef"}'), // scan-secrets:allow giá trị giả của test
      'tên chữ thường': j('vnp_Hash', 'Secret=abcdef1234567890abcd'),
      'tên chữ thường trong YAML': j('db_pass', 'word: Abcdef1234567890xyz'),
      'export trong shell': j('export JWT_SIGNING_', 'KEY="abcdef1234567890abcdef"'), // scan-secrets:allow giá trị giả của test
    };
    for (const [name, line] of Object.entries(positives)) {
      const r = scan(line);
      expect([name, r.status]).toEqual([name, 1]);
      expect(r.stderr).toContain('f.txt:1');
      expect(r.out).not.toContain('abcdef1234567890'); // không in giá trị
      expect(r.out).not.toContain('Zx9!');
    }
    const negatives = [
      'DATABASE_URL=postgresql://ecom:ecom@localhost:5433/ecom_dev', // .env.example: CSDL local của docker compose
      j('DATABASE_URL=postgres://user:', '${DB_PASSWORD}@db.internal/ecom'),
      j('DATABASE_URL=postgres://user:', '<mat-khau>@db.internal/ecom'),
      'SESSION_SIGNING_KEY=changeme-changeme-changeme',
      'SESSION_SIGNING_KEY=placeholder_placeholder_value',
      'const key = process.env.SOME_VERY_LONG_ENVIRONMENT_NAME;',
      'idempotencyKey: idempotencyKeyFromRequest,',
      'postgresql://ecom@localhost/db (không mật khẩu)',
      'https://example.com/path/to/some/very/long/page',
    ];
    for (const line of negatives) expect([line, scan(line).status]).toEqual([line, 0]);
    // đối chứng: dòng bí mật có đánh dấu `scan-secrets:allow` bị bỏ qua
    expect(scan(`${positives['URL CSDL có mật khẩu']} # scan-secrets:allow giá trị giả`).status).toBe(0);
  });

  it('PRJ-TC-20261006-160721494: quét bí mật đỏ khi không đọc được danh sách tệp (không phải git) hoặc không có tệp nào; --staged rỗng thì qua', () => {
    const noGit = runScript('scripts/scan-secrets.mjs', [], { cwd: tmp() });
    expect(noGit.status).not.toBe(0);
    expect(noGit.stderr).toMatch(/scan-secrets: .*(không đọc được|git)/);
    expect(noGit.stderr).not.toMatch(/at (async )?\w+.*node:internal/); // thông báo gọn, không phải stack Node
    const empty = tmp();
    run('git', ['init', '-q'], { cwd: empty });
    const none = runScript('scripts/scan-secrets.mjs', [], { cwd: empty });
    expect(none.status).not.toBe(0); // quét 0 tệp không được coi là sạch
    expect(none.stderr).toMatch(/không có tệp nào/);
    expect(none.stdout).not.toMatch(/sạch/); // không in "sạch" ra stdout
    expect(runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: empty }).status).toBe(0); // hook trước commit không chặn commit rỗng
  });

  it('quét bí mật trên chính repo này sạch (các tệp đang theo dõi)', () => {
    const r = runScript('scripts/scan-secrets.mjs');
    expect(r.out).toMatch(/sạch/);
    expect(r.status).toBe(0);
  });
});
