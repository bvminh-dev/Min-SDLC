import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../support/db';
import { cleanPath, run, runScript } from '../support/sh';
import { mkTmp } from '../support/tmp';

// Khóa ký VNPay không nằm trong repo (PAY-SEC T12; SB-15): máy quét bí mật bắt VNPAY_HASH_SECRET ở mọi dạng gán và đỏ khi công cụ hỏng. Giá trị giả ghép lúc chạy để chính tệp này không bị máy quét bắt.
const NAME = ['VNPAY', 'HASH', 'SECRET'].join('_');
const VALUE = ['q3Z8', 'k2Mx', '9R7w', 'E5tY', '4uI1', 'oP6a', 'S0dF', 'gHjK'].join(''); // 32 ký tự ngẫu nhiên có chữ số
const sh = (dir: string, ...args: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
const repo = (): string => { const d = mkTmp('ecom-pay-secret-'); sh(d, 'init', '-q'); return d; };
const stage = (dir: string, file: string, text: string) => { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); sh(dir, 'add', file); };

describe('PAY quét bí mật cho VNPAY_HASH_SECRET (PAY-SEC T12)', () => {
  it('PAY-TC-20261007-085337421: hook trước commit đỏ khi giá trị VNPAY_HASH_SECRET nằm trong tệp đã stage, nêu tên tệp và dòng nhưng không in giá trị; giá trị giữ chỗ không bị bắt; mỗi dạng gán một ca', () => {
    const positives: Record<string, string> = {
      'KEY=giá trị': `${NAME}=${VALUE}`, 'KEY="giá trị"': `${NAME}="${VALUE}"`, "const KEY = 'giá trị';": `const ${NAME} = '${VALUE}';`, 'JSON': `{"${NAME}": "${VALUE}"}`, 'export trong shell': `export ${NAME}='${VALUE}'`,
      'YAML': `${NAME}: ${VALUE}`, 'có chú thích cuối dòng': `${NAME}=${VALUE} # khóa thật`,
    };
    for (const [label, line] of Object.entries(positives)) {
      const dir = repo();
      stage(dir, 'config/pay.txt', `# cấu hình\n${line}\n`);
      const r = runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: dir });
      expect([label, r.status]).toEqual([label, 1]);
      expect(r.stderr).toContain('config/pay.txt:2');
      expect(r.stderr).not.toContain(VALUE); // không in giá trị khớp
    }
    for (const fake of ['changeme', 'changeme-changeme-changeme-1', 'test-secret-1234567890123456', 'example-secret-1234567890123456', 'your-vnpay-secret-1234567890', '${VNPAY_SECRET_FROM_VAULT}', '<set-in-secret-store-1234567890>']) {
      const dir = repo();
      stage(dir, 'config/pay.txt', `${NAME}=${fake}\n`);
      expect([fake, runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: dir }).status]).toEqual([fake, 0]); // giá trị giữ chỗ không bị bắt
    }
    const dir = repo();
    stage(dir, 'a.txt', `${NAME}=${VALUE} # scan-secrets:allow giá trị giả của test\n`);
    expect(runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: dir }).status).toBe(0); // dòng đánh dấu allow được bỏ qua
    stage(dir, 'b.txt', `${NAME}=\n`); // tên biến không giá trị (mẫu .env.example) không bị bắt
    expect(runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: dir }).status).toBe(0);
    // hook thật chặn commit chứa khóa
    const hooked = repo();
    sh(hooked, 'config', 'core.hooksPath', join(REPO_ROOT, '.githooks'));
    stage(hooked, 'env.txt', `${NAME}=${VALUE}\n`);
    const c = sh(hooked, 'commit', '-m', 'thêm khóa');
    expect(c.status).not.toBe(0);
    expect(c.stderr).toContain('env.txt:1');
    expect(c.stderr).not.toContain(VALUE);
    expect(sh(hooked, 'rev-list', '--all', '--count').stdout.trim()).toBe('0');
  });

  it('PAY-TC-20261007-085337456: cổng quét bí mật đỏ (thoát 2) khi không đọc được danh sách tệp hoặc không có tệp nào để quét; không in "sạch"', () => {
    const noGit = mkTmp('ecom-pay-nogit-'); // không phải repo git
    const a = runScript('scripts/scan-secrets.mjs', [], { cwd: noGit });
    expect(a.status).toBe(2);
    expect(a.stderr).toMatch(/không đọc được danh sách tệp/);
    expect(a.stdout).not.toMatch(/sạch/);
    const b = runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: noGit });
    expect(b.status).toBe(2);
    const empty = repo(); // repo rỗng: quét CI không có tệp nào là cấu hình sai
    const c = runScript('scripts/scan-secrets.mjs', [], { cwd: empty });
    expect(c.status).toBe(2);
    expect(c.stderr).toMatch(/không có tệp nào để quét/);
    expect(c.stdout).not.toMatch(/sạch/);
    expect(runScript('scripts/scan-secrets.mjs', ['--staged'], { cwd: empty }).status).toBe(0); // hook --staged rỗng thì qua
    // git hỏng (không có trong PATH): vẫn đỏ, không im lặng cho qua
    const d = run(process.execPath, [join(REPO_ROOT, 'scripts/scan-secrets.mjs')], { cwd: empty, env: { PATH: cleanPath().split(':').filter((p) => !/git|bin$/.test(p) || false).join(':') || '/nonexistent' } });
    expect(d.status).toBe(2);
    expect(d.stdout).not.toMatch(/sạch/);
  });
});
