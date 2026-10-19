import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_DIR } from '../support/db';
import { run } from '../support/sh';
import { mkTmp } from '../support/tmp';

// Cổng kiểm của bảng đột biến ORD (`scripts/mutations-ord.json`, chạy bằng script chung `.claude/skills/sdlc-review/scripts/mutate.mjs`): mỗi SB `Kiểm bằng: test` của ORD-SEC có ít nhất một đột biến,
// đoạn cần phá còn đúng một lần trong mã, test và ID có thật. Mang ID tài liệu ORD-SEC vì chưa có TC riêng cho công cụ.
// Ca "công cụ hỏng thì đỏ" và ca dương tính từng mẫu lỗi.
const SEC = resolve(API_DIR, '../../spec/epics/ORD/design/ORD-SEC-20261006-092703802.md');
const TABLE = resolve(API_DIR, 'scripts/mutations-ord.json');

describe('Bảng đột biến ORD được kiểm lại bằng `check-mutations.mjs` (ORD-SEC-20261006-092703802)', () => {
  const dir = mkTmp('mut-inv-');
  const real = (): { test: string; mutations: any[] } => JSON.parse(readFileSync(TABLE, 'utf8'));
  const check = (table: unknown, args: string[] = ['--sec', SEC]) => {
    const f = join(dir, `t${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(table));
    return run(process.execPath, ['scripts/check-mutations.mjs', f, ...args], { cwd: API_DIR });
  };
  const withFirst = (patch: object) => { const t = real(); t.mutations[0] = { ...t.mutations[0], ...patch }; return t; };

  it('ORD-SEC-20261006-092703802: bảng thật hợp lệ và phủ mọi SB kiểm bằng test của ORD-SEC', () => {
    const r = run(process.execPath, ['scripts/check-mutations.mjs', TABLE, '--sec', SEC], { cwd: API_DIR });
    expect([r.status, r.stderr]).toEqual([0, '']);
    for (const sb of ['SB-05', 'SB-06', 'SB-07', 'SB-08', 'SB-11', 'SB-12', 'SB-13', 'SB-14', 'SB-18', 'SB-19', 'SB-20', 'SB-22', 'SB-23', 'SB-24', 'SB-27', 'SB-31', 'SB-35', 'SB-42', 'SB-44', 'SB-45']) expect(r.stdout).toContain(sb);
    const t = real();
    expect(t.mutations.length).toBeGreaterThanOrEqual(120);
    for (const m of t.mutations) { expect(m.tc).toMatch(/^ORD-(TC|E2E)-\d{8}-\d{9}$/); expect(m.test).toContain(m.tc); } // lệnh chạy đúng một TC, không chạy rộng
    expect(t.mutations.filter((m) => m.equivalent)).toHaveLength(0); // mọi đột biến phải bị bắt, không có ca tương đương
    expect(t.mutations.some((m) => m.file.startsWith('src/modules/platform/'))).toBe(true); // phủ cả nền sửa kèm (thứ tự ghi của outbox)
    expect(t.mutations.some((m) => m.file.startsWith('../web/'))).toBe(true); // và giao diện (escape lý do hủy)
    expect(t.mutations.some((m) => m.file.startsWith('prisma/migrations/'))).toBe(true); // và migration (trigger chỉ-thêm, thu quyền)
    const sec = readFileSync(SEC, 'utf8');
    expect((sec.match(/^\| T\d+ /gm) ?? []).length).toBe(30); // dương tính: ORD-SEC thật có 30 mối đe dọa (T1 đến T23 và T24 đến T30 của đợt bán hộ)
  });

  it('ORD-SEC-20261006-092703802: đỏ khi một SB kiểm bằng test không còn đột biến nào', () => {
    const t = real();
    const r = check({ ...t, mutations: t.mutations.filter((m: any) => !m.sb.includes('SB-13')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SB-13: SB `Kiểm bằng: test` chưa có đột biến nào/);
    expect(r.stderr).not.toMatch(/SB-05:/); // chỉ báo SB thiếu
  });

  it('ORD-SEC-20261006-092703802: đỏ khi đoạn cần phá đã đổi, mơ hồ, vô tác dụng hoặc test, tệp hay ID không có', () => {
    expect(check(withFirst({ find: 'đoạn này không tồn tại trong mã' })).stderr).toMatch(/không thấy đoạn cần phá/);
    expect(check(withFirst({ file: 'src/modules/order/lifecycle.service.ts', find: 'this.reject(o, e,' })).stderr).toMatch(/xuất hiện \d+ lần .*mơ hồ/);
    expect(check(withFirst({ replace: real().mutations[0].find })).stderr).toMatch(/không đổi gì/);
    expect(check(withFirst({ tc: 'ORD-TC-20990101-000000000' })).stderr).toMatch(/không chứa ID ORD-TC-20990101-000000000/);
    expect(check(withFirst({ test: 'node scripts/run-jest.mjs test/order/khong-co.spec.ts -t "x"' })).stderr).toMatch(/không có tệp test/);
    expect(check(withFirst({ file: 'src/khong-co.ts' })).stderr).toMatch(/không có tệp src\/khong-co\.ts/);
  });

  it('ORD-SEC-20261006-092703802: đỏ khi không đọc được ORD-SEC hoặc bảng (không im lặng coi là "không cần đột biến")', () => {
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
