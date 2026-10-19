import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_DIR } from '../support/db';
import { run } from '../support/sh';
import { mkTmp } from '../support/tmp';

// Cổng kiểm của bảng đột biến SAL (`scripts/mutations-sal.json`, chạy bằng script chung `.claude/skills/sdlc-review/scripts/mutate.mjs`): mỗi SB `Kiểm bằng: test` của SAL-SEC có ít nhất một đột biến,
// đoạn cần phá còn đúng một lần trong mã, test và ID có thật. Mang ID tài liệu SAL-SEC vì chưa có TC riêng cho công cụ.
const SEC = resolve(API_DIR, '../../spec/epics/SAL/design/SAL-SEC-20261015-093121500.md');
const TABLE = resolve(API_DIR, 'scripts/mutations-sal.json');
const ID = 'SAL-SEC-20261015-093121500';

describe(`Bảng đột biến SAL được kiểm lại bằng \`check-mutations.mjs\` (${ID})`, () => {
  const dir = mkTmp('mut-sal-');
  const real = (): { test: string; mutations: any[] } => JSON.parse(readFileSync(TABLE, 'utf8'));
  const check = (table: unknown, args: string[] = ['--sec', SEC]) => {
    const f = join(dir, `t${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(table));
    return run(process.execPath, ['scripts/check-mutations.mjs', f, ...args], { cwd: API_DIR });
  };
  const withFirst = (patch: object) => { const t = real(); t.mutations[0] = { ...t.mutations[0], ...patch }; return t; };

  it(`${ID}: bảng thật hợp lệ và phủ mọi SB kiểm bằng test của SAL-SEC, kể cả nền sửa kèm (lint ranh giới, CSRF)`, () => {
    const r = run(process.execPath, ['scripts/check-mutations.mjs', TABLE, '--sec', SEC], { cwd: API_DIR });
    expect([r.status, r.stderr]).toEqual([0, '']);
    for (const sb of ['SB-05', 'SB-06', 'SB-07', 'SB-08', 'SB-11', 'SB-12', 'SB-13', 'SB-14', 'SB-18', 'SB-19', 'SB-23', 'SB-24', 'SB-25', 'SB-31', 'SB-40', 'SB-42', 'SB-44', 'SB-45']) expect(r.stdout).toContain(sb);
    const t = real();
    for (const m of t.mutations) { expect(m.tc).toMatch(/^SAL-(TC|E2E|SEC|DB)-\d{8}-\d{9}$/); expect(m.test).toMatch(/-t "/); } // lệnh chạy đúng một TC, không chạy rộng
    expect(t.mutations.some((m) => m.file === '../../scripts/check-boundaries.mjs')).toBe(true); // phủ cả nền sửa kèm
    expect(t.mutations.some((m) => m.file.startsWith('src/modules/platform/'))).toBe(true);
    expect(t.mutations.filter((m) => m.equivalent).length).toBeLessThanOrEqual(3);
    const sec = readFileSync(SEC, 'utf8');
    expect((sec.match(/^\| T\d+ /gm) ?? []).length).toBe(16); // dương tính: SAL-SEC thật có 16 mối đe dọa
  });

  it(`${ID}: đỏ khi một SB kiểm bằng test không còn đột biến nào`, () => {
    const t = real();
    const r = check({ ...t, mutations: t.mutations.filter((m: any) => !m.sb.includes('SB-13')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SB-13: SB `Kiểm bằng: test` chưa có đột biến nào/);
  });

  it(`${ID}: đỏ khi đoạn cần phá đã đổi, vô tác dụng hoặc test, tệp hay ID không có`, () => {
    expect(check(withFirst({ find: 'đoạn này không tồn tại trong mã' })).stderr).toMatch(/không thấy đoạn cần phá/);
    expect(check(withFirst({ replace: real().mutations[0].find })).stderr).toMatch(/không đổi gì/);
    expect(check(withFirst({ tc: 'SAL-TC-20990101-000000000' })).stderr).toMatch(/không chứa ID SAL-TC-20990101-000000000/);
    expect(check(withFirst({ test: 'node scripts/run-jest.mjs test/sales/khong-co.spec.ts -t "x"' })).stderr).toMatch(/không có tệp test/);
    expect(check(withFirst({ file: 'src/khong-co.ts' })).stderr).toMatch(/không có tệp src\/khong-co\.ts/);
  });

  it(`${ID}: đỏ khi không đọc được SAL-SEC hoặc bảng (không im lặng coi là "không cần đột biến")`, () => {
    const empty = join(dir, 'empty-sec.md');
    writeFileSync(empty, '# không có bảng mối đe dọa\n');
    expect(check(real(), ['--sec', empty]).stderr).toMatch(/không tìm thấy SB nào có Kiểm bằng `test`/);
    expect(check(real(), ['--sec', join(dir, 'khong-co.md')]).stderr).toMatch(/không đọc được tài liệu SEC/);
    const broken = run(process.execPath, ['scripts/check-mutations.mjs', join(dir, 'khong-co.json'), '--sec', SEC], { cwd: API_DIR });
    expect([broken.status, broken.stderr]).toEqual([1, expect.stringMatching(/không đọc được bảng đột biến/)]);
  });
});
