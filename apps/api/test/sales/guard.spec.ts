import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Reflector } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { auditPermissions, auditRoutes, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import * as salesIndex from '../../src/modules/sales';
import { SalesController } from '../../src/modules/sales/sales.controller';
import { API_DIR, REPO_ROOT, truncateAll } from '../support/db';
import { runScript } from '../support/sh';
import { createAuthApp, type AuthApp } from '../support/auth';
import { call, who } from '../support/prd';
import { mkTmp } from '../support/tmp';

// Kiểm quyền, ranh giới và mã lỗi của SAL trên AppModule thật (SAL-SEC-20261015-093121500: T1, T15; SB-05, SB-07, SB-14, SB-35).
// Ma trận quyền của epic nằm ở permission-rows.md (lead gộp vào permissions-matrix.md một lần): test đọc đúng tệp đó.
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/epics/SAL/permission-rows.md'), 'utf8');
const SAL_SCOPE = (id: string) => /\s\/api\/v1\/sales(\/|$)/.test(id);
const NO_ENDPOINT = ['Đơn hộ bị từ chối: hết hàng, nguồn đã tắt, sản phẩm không còn bán (kết quả của lệnh tạo đơn hộ, không có endpoint riêng)']; // hàng kết quả của POST /sales/orders
const opts = { scope: SAL_SCOPE, epic: 'SAL', exempt: NO_ENDPOINT };
const SEC = 'SAL-SEC-20261015-093121500';
const F = resolve(API_DIR, 'test/fixtures/boundaries');
const boundaries = (modules: string) => runScript('scripts/check-boundaries.mjs', ['--modules', modules, '--schemas', `${F}/schemas`]);

describe('SAL kiểm quyền trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`SAL-TC-20261015-093909733 ${SEC} T1 (SB-05, SB-07): đúng năm route của SAL, mọi route khai @Roles sale và admin, @Validate và @Action khớp ma trận; route không khai không tồn tại (mặc định từ chối)`, async () => {
    expect(routeIds(t.app).filter(SAL_SCOPE).sort()).toEqual([
      'GET /api/v1/sales/customers/lookup', 'GET /api/v1/sales/orders', 'GET /api/v1/sales/orders/:code', 'GET /api/v1/sales/shipping-options', 'POST /api/v1/sales/orders',
    ].sort());
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('SAL-REQ-')).map((r) => [r.staff, r.customer, r.guest])).toEqual(Array(6).fill(['-', '-', '-'])); // staff, customer, guest không có Y ở hàng nào của SAL
    const reflector = t.app.get(Reflector);
    for (const name of Object.getOwnPropertyNames(SalesController.prototype).filter((n) => n !== 'constructor')) {
      expect([name, reflector.get<string[]>('platform:roles', (SalesController.prototype as any)[name])]).toEqual([name, ['sale', 'admin']]);
    }
    const sale = await who(t, 'sale', 's1@shop.vn');
    for (const [m, p] of [['patch', '/sales/orders/HD261015-00001'], ['delete', '/sales/orders/HD261015-00001'], ['put', '/sales/orders'], ['post', '/sales/shipping-options'], ['post', '/sales/customers/lookup'], ['get', '/sales/customers']] as const) {
      const r = await call(t, m, p, { cookie: sale.cookie, body: {} });
      expect([m, p, [404, 405].includes(r.status)]).toEqual([m, p, true]);
    }
  });

  it(`SAL-TC-20261015-093909998 SAL-TC-20261015-093910521 SAL-TC-20261015-093910933 SAL-TC-20261015-093911681 SAL-TC-20261015-093911979 ${SEC} T3, T11 (SB-14): bậc, hạn mức, cửa sổ, nhóm đếm của MỌI route SAL đúng spec (tạo đơn B 10, tra khách D 30 chung usr:customer-lookup, còn lại C 120)`, () => {
    const reflector = t.app.get(Reflector);
    const limit = (name: string) => reflector.get<object>('platform:rate-limit', (SalesController.prototype as any)[name]);
    expect(limit('create')).toEqual({ tier: 'B', limit: 10, windowSeconds: 60 });
    expect(limit('lookup')).toEqual({ tier: 'D', limit: 30, windowSeconds: 60, group: 'usr:customer-lookup' });
    for (const n of ['shipping', 'list', 'detail']) expect([n, limit(n)]).toEqual([n, { tier: 'C', limit: 120, windowSeconds: 60 }]);
    const names = Object.getOwnPropertyNames(SalesController.prototype).filter((n) => n !== 'constructor');
    expect(names.sort()).toEqual(['create', 'detail', 'list', 'lookup', 'shipping']); // thêm route phải thêm bậc vào bảng này
    expect(salesIndex).toEqual({ SalesModule: expect.any(Function) }); // điểm vào công khai chỉ có module, không giao diện nội bộ nào
  });

  it(`SAL-TC-20261015-093910259 ${SEC} T15 (SB-35): lint ranh giới đỏ khi SAL import PrismaService hay @prisma/client, đọc thẳng bảng module khác hay import chéo vào tệp bên trong; nhánh sạch thoát 0; mã thật của repo sạch`, () => {
    const bad = boundaries(`${F}/sal259/modules`);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/sales\/uses-prisma\.ts:1: \[sales\] module không sở hữu bảng không được import PrismaService/);
    expect(bad.stderr).toMatch(/sales\/uses-prisma\.ts:2: \[sales\] module không sở hữu bảng không được import PrismaService hay @prisma\/client/);
    expect(bad.stderr).toMatch(/sales\/raw-sql\.ts:2: \[sales -> order\] SQL thô đọc\/ghi bảng orders/);
    expect(bad.stderr).toMatch(/sales\/cross-import\.ts:1: \[sales -> order\] import file bên trong order/);
    expect(boundaries(`${F}/sal259ok/modules`).status).toBe(0);
    expect(runScript('scripts/check-boundaries.mjs').status).toBe(0);
  });

  describe('SAL-TC-20261015-093910292', () => {
    const mods = (files: Record<string, string>) => {
      const root = mkTmp('sal-boundaries-'); // tự xóa ở afterAll (support/tmp.ts)
      mkdirSync(join(root, 'modules/sales'), { recursive: true });
      mkdirSync(join(root, 'modules/catalog'), { recursive: true });
      writeFileSync(join(root, 'modules/catalog/x.ts'), 'export const x = 1;\n'); // module khác có mã để quét toàn cục không rỗng
      for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'modules/sales', name), text);
      return join(root, 'modules');
    };
    it(`SAL-TC-20261015-093910292 ${SEC} T15: thư mục sales rỗng hay tệp .ts có lỗi cú pháp thì lint đỏ (thoát 2, "không đọc được"), không im lặng cho qua; tệp hợp lệ thì thoát 0`, () => {
      for (const [name, dir] of [['rỗng', mods({})], ['lỗi cú pháp', mods({ 'broken.ts': 'export const = ;\nimport {{{ from\n' })]] as const) {
        const r = boundaries(dir);
        expect([name, r.status, /không đọc được/.test(r.stderr)]).toEqual([name, 2, true]);
        expect(r.stdout).not.toMatch(/sạch/);
      }
      expect(boundaries(mods({ 'fine.ts': "import { CatalogApi } from '../catalog';\nexport const a = CatalogApi;\n" })).status).toBe(0);
    });
  });

  it('mọi mã lỗi của SAL có trong sổ với status của spec', () => {
    const want: Record<string, number> = { 'order-source-unavailable': 409, 'customer-not-found': 422, 'order-total-out-of-range': 422, 'shipping-method-unavailable': 409, 'no-shipping-methods': 409, 'price-changed': 409, 'insufficient-stock': 409, 'dependency-unavailable': 503 };
    for (const [code, status] of Object.entries(want)) expect([code, errorRegistry.get(code)?.status]).toEqual([code, status]);
    expect([404, 409]).toContain(errorRegistry.get('product-unavailable')?.status); // CRT khai 404; SAL ép 409 theo từng lần ném (`status` của DomainError)
    expect(errorRegistry.audit()).toEqual([]);
  });
});
