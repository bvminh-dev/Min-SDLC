import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_DIR } from '../support/db';
import { run } from '../support/sh';
import { mkTmp } from '../support/tmp';

// Cổng kiểm của bảng đột biến PRD (`scripts/mutations-prd.json`, chạy bằng script chung `.claude/skills/sdlc-review/scripts/mutate.mjs`): mỗi SB `Kiểm bằng: test` của PRD-SEC có ít nhất một đột biến,
// đoạn cần phá còn đúng một lần trong mã, test và ID có thật. Mang ID tài liệu PRD-SEC vì chưa có TC riêng cho công cụ.
// Ca "công cụ hỏng thì đỏ" và ca dương tính từng mẫu lỗi.
const SEC = resolve(API_DIR, '../../spec/epics/PRD/design/PRD-SEC-20261006-095502825.md');
const TABLE = resolve(API_DIR, 'scripts/mutations-prd.json');

describe('Bảng đột biến PRD được kiểm lại bằng `check-mutations.mjs` (PRD-SEC-20261006-095502825)', () => {
  const dir = mkTmp('mut-prd-');
  const real = (): { test: string; mutations: any[] } => JSON.parse(readFileSync(TABLE, 'utf8'));
  const check = (table: unknown, args: string[] = ['--sec', SEC]) => {
    const f = join(dir, `t${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(table));
    return run(process.execPath, ['scripts/check-mutations.mjs', f, ...args], { cwd: API_DIR });
  };
  const withFirst = (patch: object) => { const t = real(); t.mutations[0] = { ...t.mutations[0], ...patch }; return t; };

  it('PRD-SEC-20261006-095502825: bảng thật hợp lệ và phủ mọi SB kiểm bằng test của PRD-SEC', () => {
    const r = run(process.execPath, ['scripts/check-mutations.mjs', TABLE, '--sec', SEC], { cwd: API_DIR });
    expect([r.status, r.stderr]).toEqual([0, '']);
    for (const sb of ['SB-05', 'SB-07', 'SB-08', 'SB-10', 'SB-11', 'SB-12', 'SB-13', 'SB-14', 'SB-18', 'SB-19', 'SB-20', 'SB-23', 'SB-27', 'SB-30']) expect(r.stdout).toContain(sb);
    const t = real();
    expect(t.mutations.length).toBeGreaterThanOrEqual(40);
    for (const m of t.mutations) { expect(m.tc).toMatch(/^PRD-(TC|E2E)-\d{8}-\d{9}$/); expect(m.test).toContain(m.tc); } // lệnh chạy đúng một TC, không chạy rộng
    expect(t.mutations.filter((m) => m.equivalent)).toHaveLength(1); // chỉ một đột biến tương đương, có lý do
    const sec = readFileSync(SEC, 'utf8');
    expect((sec.match(/^\| T\d+ /gm) ?? []).length).toBe(15); // dương tính: PRD-SEC thật có 15 mối đe dọa
  });

  it('PRD-SEC-20261006-095502825: đỏ khi một SB kiểm bằng test không còn đột biến nào', () => {
    const t = real();
    const r = check({ ...t, mutations: t.mutations.filter((m: any) => !m.sb.includes('SB-30')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SB-30: SB `Kiểm bằng: test` chưa có đột biến nào/);
    expect(r.stderr).not.toMatch(/SB-05:/); // chỉ báo SB thiếu
  });

  it('PRD-SEC-20261006-095502825: đỏ khi đoạn cần phá đã đổi, mơ hồ, vô tác dụng hoặc test, tệp hay ID không có', () => {
    expect(check(withFirst({ find: 'đoạn này không tồn tại trong mã' })).stderr).toMatch(/không thấy đoạn cần phá/);
    expect(check(withFirst({ file: 'src/modules/catalog/category.service.ts', find: 'await this.audit.record(tx,' })).stderr).toMatch(/xuất hiện \d+ lần .*mơ hồ/);
    expect(check(withFirst({ replace: real().mutations[0].find })).stderr).toMatch(/không đổi gì/);
    expect(check(withFirst({ tc: 'PRD-TC-20990101-000000000' })).stderr).toMatch(/không chứa ID PRD-TC-20990101-000000000/);
    expect(check(withFirst({ test: 'node scripts/run-jest.mjs test/catalog/khong-co.spec.ts -t "x"' })).stderr).toMatch(/không có tệp test/);
    expect(check(withFirst({ file: 'src/khong-co.ts' })).stderr).toMatch(/không có tệp src\/khong-co\.ts/);
  });

  it('PRD-SEC-20261006-095502825: đỏ khi không đọc được PRD-SEC hoặc bảng (không im lặng coi là "không cần đột biến")', () => {
    const empty = join(dir, 'empty-sec.md');
    writeFileSync(empty, '# không có bảng mối đe dọa\n');
    const r = check(real(), ['--sec', empty]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/không tìm thấy SB nào có Kiểm bằng `test`/);
    const missing = check(real(), ['--sec', join(dir, 'khong-co.md')]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/không đọc được tài liệu SEC/);
    const broken = run(process.execPath, ['scripts/check-mutations.mjs', join(dir, 'khong-co.json'), '--sec', SEC], { cwd: API_DIR });
    expect(broken.status).toBe(1);
    expect(broken.stderr).toMatch(/không đọc được bảng đột biến/);
  });
});
