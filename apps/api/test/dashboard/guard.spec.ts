import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError, errorRegistry, loadConfig, auditPermissions, auditRoutes, parseMatrix } from '../../src/modules/platform';
import { DASHBOARD_VARS } from '../../src/modules/dashboard/config';
import { API_DIR, REPO_ROOT } from '../support/db';
import { runScript } from '../support/sh';
import { baseEnv } from '../support/app';
import { ALL_PATHS, createDshApp, type DshApp } from '../support/dsh';

// DSH-SEC-20261006-105535103 T8 (SB-35, script) và các cổng cấu hình, ma trận quyền, sổ mã lỗi của DSH trên AppModule thật.
const F = resolve(API_DIR, 'test/fixtures/boundaries');
const check = (dir: string, extra: string[] = []) => runScript('scripts/check-boundaries.mjs', ['--modules', `${F}/${dir}/modules`, ...extra]);
const ARCH = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');

describe('DSH ranh giới module (DSH-SEC-20261006-105535103 T8, SB-35)', () => {
  it('DSH-TC-20261007-085337285: cổng ranh giới đỏ khi DSH import module không nằm trong cột Phụ thuộc; cây chỉ import ORD, PRD, INV, USR, PAY qua index.ts thì thoát 0', () => {
    const r = check('dsh285', ['--schemas', `${F}/schemas`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/dashboard\/uses-cart\.ts:1: \[dashboard -> cart\] cart không nằm trong cột Phụ thuộc của dashboard/);
    expect(r.stderr).toMatch(/dashboard\/uses-cart\.ts:2: \[dashboard -> shipping\] shipping không nằm trong cột Phụ thuộc của dashboard/);
    expect(r.stderr).not.toMatch(/uses-cart\.ts:3/); // order nằm trong cột Phụ thuộc
    const ok = check('dshok', ['--schemas', `${F}/schemas`]);
    expect([ok.status, ok.stderr]).toEqual([0, '']);
  });

  it('DSH-TC-20261007-085337320: cổng ranh giới đỏ khi DSH import file bên trong module được phép (không qua index.ts)', () => {
    const r = check('dsh320', ['--schemas', `${F}/schemas`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/dashboard\/uses-internal\.ts:1: \[dashboard -> order\] import file bên trong order \(internal\/order\.repository\); chỉ được import điểm vào công khai \(index\.ts\)/);
    expect(r.stderr).not.toMatch(/uses-internal\.ts:2/);
    expect(r.stderr).not.toMatch(/không nằm trong cột Phụ thuộc/);
  });

  it('DSH-TC-20261007-085337354: cổng ranh giới đỏ khi DSH đọc model Prisma hoặc bảng của module khác, nêu phải gọi giao diện ở architecture.md', () => {
    const r = check('dsh354', ['--schemas', `${F}/schemas`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/dashboard\/reads-prisma\.ts:2: \[dashboard -> order\] đọc\/ghi model Prisma order thuộc module order; phải gọi giao diện ở architecture\.md \(SB-35\)/);
    expect(r.stderr).toMatch(/dashboard\/reads-raw\.ts:2: \[dashboard -> order\] SQL thô đọc\/ghi bảng orders thuộc module order; phải gọi giao diện ở architecture\.md \(SB-35\)/);
    expect(r.stderr).not.toMatch(/reads-own/);
  });

  it('DSH-SEC-20261006-105535103 T8: mã thật của DSH chỉ import ORD, PRD, INV, USR, PAY qua điểm vào công khai và không có model Prisma hay bảng nào (không migration, không schema riêng)', () => {
    expect(runScript('scripts/check-boundaries.mjs').status).toBe(0);
    expect(ARCH).toMatch(/\|\s*DSH\s*\|\s*dashboard\s*\|\s*ORD, PRD, INV, USR, PAY\s*\|/);
    const src = readFileSync(resolve(API_DIR, 'src/modules/dashboard/blocks.service.ts'), 'utf8');
    expect([...src.matchAll(/from '\.\.\/([a-z]+)'/g)].map((m) => m[1]).sort()).toEqual(['catalog', 'inventory', 'order', 'payment', 'user']);
    expect(() => readFileSync(resolve(API_DIR, 'prisma/schema/dashboard.prisma'))).toThrow(); // DSH không có bảng
    expect(runScript('node', ['-e', `process.stdout.write(require('fs').readdirSync('prisma/migrations').filter((d) => /dashboard|dsh/i.test(d)).join())`], { cwd: API_DIR }).stdout).toBe('');
  });
});

describe('DSH cấu hình, ma trận quyền và sổ mã lỗi trên AppModule thật (DSH-API, AUTH-REQ-20261006-095515918 BR5)', () => {
  const SEC = 'DSH-SEC-20261006-105535103';
  let t: DshApp;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());

  it(`${SEC} T1 (SB-05, SB-07): chín tuyến của DSH khớp ma trận quyền (chỉ admin, @Action trỏ đúng hàng), test quét route sạch, mỗi hàng ma trận của DSH có endpoint trừ hàng trang web`, () => {
    const opts = { scope: (id: string) => /\/api\/v1\/admin\/(dashboard|reports)\//.test(id), epic: 'DSH', exempt: ['Mở trang dashboard (kiểm quyền admin, lỗi từng khối, độ tươi)'] };
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    expect(auditRoutes(t.app)).toEqual([]);
    const rows = parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('DSH-REQ-'));
    expect(rows).toHaveLength(12); // mười hàng cũ cộng hai hàng báo cáo theo nguồn và theo sale (spec/epics/DSH/permission-rows.md)
    for (const r of rows) expect([r.action, r.guest, r.customer, r.staff, r.admin]).toEqual([r.action, '-', '-', '-', 'Y']);
    // dương tính: nới role (staff) hoặc đổi nhãn thì cổng đỏ
    const widened = MATRIX.replace(/(\| Xem tổng doanh thu và hoàn tiền thất bại cần xử lý \| DSH-REQ-20261006-105125714 \| - \| - \| )-( \| - \| Y \|)/, '$1Y$2');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('code cho [admin] nhưng ma trận (Xem tổng doanh thu và hoàn tiền thất bại cần xử lý) cho [admin, staff]');
    expect(ALL_PATHS).toHaveLength(11);
  });

  it('DSH-API mục Biến môi trường (ADR-007): ba biến có mặc định 60, 5000, 30; giá trị sai (không phải số, ngoài khoảng) làm khởi động thất bại và nêu tên biến, không in giá trị', () => {
    const c = loadConfig(baseEnv(), [DASHBOARD_VARS]);
    expect([c.get('DASHBOARD_CACHE_TTL_SECONDS'), c.get('DASHBOARD_SOURCE_TIMEOUT_MS'), c.get('DASHBOARD_RATE_LIMIT_PER_MINUTE')]).toEqual([60, 5000, 30]);
    const set = loadConfig(baseEnv({ DASHBOARD_CACHE_TTL_SECONDS: '5', DASHBOARD_SOURCE_TIMEOUT_MS: '250', DASHBOARD_RATE_LIMIT_PER_MINUTE: '7' }), [DASHBOARD_VARS]);
    expect([set.get('DASHBOARD_CACHE_TTL_SECONDS'), set.get('DASHBOARD_SOURCE_TIMEOUT_MS'), set.get('DASHBOARD_RATE_LIMIT_PER_MINUTE')]).toEqual([5, 250, 7]);
    for (const [name, bad] of [['DASHBOARD_CACHE_TTL_SECONDS', 'sáu mươi'], ['DASHBOARD_CACHE_TTL_SECONDS', '0'], ['DASHBOARD_SOURCE_TIMEOUT_MS', '-5'], ['DASHBOARD_SOURCE_TIMEOUT_MS', '10'], ['DASHBOARD_RATE_LIMIT_PER_MINUTE', '0'], ['DASHBOARD_RATE_LIMIT_PER_MINUTE', '3.5']]) {
      let err: unknown;
      try { loadConfig(baseEnv({ [name]: bad }), [DASHBOARD_VARS]); } catch (e) { err = e; }
      expect([name, bad, err instanceof ConfigError]).toEqual([name, bad, true]);
      expect((err as ConfigError).format()).toContain(name);
      expect((err as ConfigError).format()).not.toContain(bad);
    }
  });

  it(`${SEC} T9: sổ mã lỗi sạch; DSH khai đúng hai mã riêng invalid-parameter (400) và dashboard-source-unavailable (503), rate-limited là mã nền`, () => {
    expect(errorRegistry.audit()).toEqual([]);
    expect(errorRegistry.get('invalid-parameter')).toMatchObject({ status: 400, title: 'Invalid parameter' });
    expect(errorRegistry.get('dashboard-source-unavailable')).toMatchObject({ status: 503, title: 'Dashboard source unavailable' });
    expect(errorRegistry.get('rate-limited')?.status).toBe(429);
    const code = readFileSync(resolve(API_DIR, 'src/modules/dashboard/errors.ts'), 'utf8');
    expect([...code.matchAll(/\['([a-z-]+)', \d+/g)].map((m) => m[1])).toEqual(['invalid-parameter', 'dashboard-source-unavailable']);
    // mã lỗi dùng trong mã DSH đều có trong spec (DSH-API mục Quy tắc chung)
    const spec = readFileSync(resolve(REPO_ROOT, 'spec/epics/DSH/design/DSH-API-20261006-105535010.md'), 'utf8');
    const used = new Set<string>();
    for (const f of ['policy.ts', 'sources.service.ts', 'guard.ts', 'range.ts']) for (const m of readFileSync(resolve(API_DIR, 'src/modules/dashboard', f), 'utf8').matchAll(/DomainError\('([a-z_-]+)'/g)) used.add(m[1]);
    for (const c of ['invalid-parameter', 'dashboard-source-unavailable', 'rate-limited', 'forbidden']) expect(c === 'forbidden' || spec.includes(`urn:ecom:error:${c}`)).toBe(true);
    expect([...used].filter((u) => !errorRegistry.get(u))).toEqual([]);
  });
});
