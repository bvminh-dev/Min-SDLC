import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_DIR } from '../support/db';
import { run } from '../support/sh';
import { mkTmp } from '../support/tmp';

// Cổng kiểm của bảng đột biến USR (sdlc-implement: mỗi SB `Kiểm bằng: test` có ít nhất một đột biến). Mang ID tài liệu USR-SEC vì chưa có TC riêng cho công cụ.
// Ca "công cụ hỏng thì đỏ" và ca dương tính từng mẫu lỗi: SB thiếu đột biến, đoạn cần phá đã đổi, đoạn mơ hồ, đột biến vô tác dụng, test hay ID không có, USR-SEC không đọc được.
describe('Bảng đột biến USR được kiểm lại bằng `mutations-usr.mjs --check` (USR-SEC-20261006-101342524)', () => {
  const dir = mkTmp('mut-usr-');
  const node = (args: string[]) => run(process.execPath, ['scripts/mutations-usr.mjs', ...args], { cwd: API_DIR });
  const real = (): any[] => JSON.parse(node(['--print']).stdout);
  const check = (table: unknown[], extra: string[] = []) => {
    const f = join(dir, `t${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(table));
    return node(['--check', '--file', f, ...extra]);
  };

  it('USR-SEC-20261006-101342524: bảng thật hợp lệ và phủ mọi SB kiểm bằng test của USR-SEC', () => {
    const r = node(['--check']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/phủ \d+ SB/);
    for (const sb of ['SB-01', 'SB-03', 'SB-05', 'SB-06', 'SB-07', 'SB-10', 'SB-12', 'SB-13', 'SB-14', 'SB-19', 'SB-33']) expect(r.stdout).toContain(sb);
    const table = real();
    expect(table.length).toBeGreaterThanOrEqual(40);
    for (const m of table) expect(m.id).toMatch(/^USR-(TC|E2E)-\d{8}-\d{9}$/); // mọi đột biến trỏ tới một TC hay E2E
  });

  it('USR-SEC-20261006-101342524: đỏ khi một SB kiểm bằng test không còn đột biến nào', () => {
    const r = check(real().filter((m) => m.sb !== 'SB-33'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SB-33: SB `Kiểm bằng: test` của USR chưa có đột biến nào/);
    expect(r.stderr).not.toMatch(/SB-06:/); // chỉ báo SB thiếu
  });

  it('USR-SEC-20261006-101342524: đỏ khi đoạn cần phá đã đổi, mơ hồ, vô tác dụng hoặc test hay ID không có', () => {
    const base = real();
    const first = base[0];
    const bad = (patch: object) => check([{ ...first, ...patch }, ...base.slice(1)]);
    expect(bad({ edits: [{ ...first.edits[0], from: 'đoạn này không tồn tại trong mã' }] }).stderr).toMatch(/không thấy đoạn cần phá/);
    expect(bad({ edits: [{ file: 'src/modules/user/address.service.ts', from: 'await this.lock(tx, userId);', to: '' }] }).stderr).toMatch(/xuất hiện 3 lần .*mơ hồ/);
    expect(bad({ edits: [{ file: first.edits[0].file, from: first.edits[0].from, to: first.edits[0].from }] }).stderr).toMatch(/không đổi gì/);
    expect(bad({ id: 'USR-TC-20990101-000000000' }).stderr).toMatch(/không chứa ID USR-TC-20990101-000000000/);
    expect(bad({ test: { file: 'test/user/khong-co.spec.ts' } }).stderr).toMatch(/không có tệp test/);
    expect(bad({ edits: [{ file: 'src/khong-co.ts', from: 'x', to: 'y' }] }).stderr).toMatch(/không có tệp src\/khong-co\.ts/);
  });

  it('USR-SEC-20261006-101342524: đỏ khi không đọc được USR-SEC (không im lặng coi là "không cần đột biến")', () => {
    const empty = join(dir, 'empty-sec.md');
    writeFileSync(empty, '# không có bảng mối đe dọa\n');
    const r = check(real(), ['--sec', empty]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/không tìm thấy SB nào có Kiểm bằng `test`/);
    const missing = check(real(), ['--sec', join(dir, 'khong-co.md')]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/không đọc được tài liệu SEC/);
    // dương tính: USR-SEC thật có ít nhất mười SB test, và chỉ hàng có từ `test` ở cột Kiểm bằng được tính
    const sec = readFileSync(resolve(API_DIR, '../../spec/epics/USR/design/USR-SEC-20261006-101342524.md'), 'utf8');
    expect((sec.match(/^\| T\d+ /gm) ?? []).length).toBe(20);
  });
});
