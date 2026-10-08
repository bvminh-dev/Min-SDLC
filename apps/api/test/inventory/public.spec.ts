import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AppLogger, Clock, ConfigService, auditPermissions, auditRoutes, configureApp, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { seedSession, seedUser } from '../support/auth';
import { FakeClock, testConfig } from '../support/app';
import { REPO_ROOT, truncateAll } from '../support/db';
import { call, createInvApp, newId, seedStock, type InvApp } from '../support/inv';
import { seedProduct } from '../support/prd';

describe('INV endpoint công khai xem còn hàng (INV-REQ-20261006-120036236)', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.clock.advance(61_000); });
  const avail = (ids: string, o: { cookie?: string; ip?: string; extra?: string } = {}) => {
    let r = call(t, 'get', `/inventory/availability?product_ids=${ids}${o.extra ?? ''}`, { cookie: o.cookie, ip: o.ip });
    r = r.set('Accept', 'application/json');
    return r;
  };

  it('INV-TC-20261006-121043713: khách chưa đăng nhập xem còn hay hết theo lô đúng thứ tự, mỗi phần tử chỉ có product_id và in_stock, không có chuỗi số tồn, Cache-Control no-store, mọi role cùng kết quả', async () => {
    const A = await seedStock(t, { on_hand: 10, reserved: 3 }), B = await seedStock(t, { on_hand: 3, reserved: 3 });
    const r = await avail(`${A.product},${B.product}`);
    expect([r.status, r.body]).toEqual([200, { items: [{ product_id: A.product, in_stock: true }, { product_id: B.product, in_stock: false }] }]);
    for (const it of r.body.items) expect(Object.keys(it).sort()).toEqual(['in_stock', 'product_id']);
    expect(JSON.stringify(r.body)).not.toMatch(/available|on_hand|reserved|version/);
    expect(r.headers['cache-control']).toBe('no-store');
    for (const role of ['customer', 'staff', 'admin'] as const) {
      const c = (await seedSession(t, (await seedUser(t, { email: `${role}@shop.vn`, role })).id)).cookie;
      expect((await avail(`${A.product},${B.product}`, { cookie: c })).body).toEqual(r.body);
    }
    const rev = await avail(`${B.product},${A.product}`);
    expect(rev.body.items.map((i: { product_id: string }) => i.product_id)).toEqual([B.product, A.product]); // đúng thứ tự product_ids
  });

  it('INV-TC-20261006-121043811: 101 id, phần tử sai định dạng, thiếu, rỗng hay tham số lạ đều 400 validation-failed và không chạm CSDL; đúng 100 id hợp lệ nhận 200 với 100 phần tử', async () => {
    const ids = Array.from({ length: 101 }, () => newId());
    const spyQ = jest.spyOn(t.prisma, '$queryRaw'), spyE = jest.spyOn(t.prisma, '$executeRaw');
    try {
      const cases = [() => avail(ids.join(',')), () => avail(`${ids.slice(0, 100).join(',')},abc`), () => call(t, 'get', '/inventory/availability', {}), () => avail(''), () => avail(ids[0], { extra: '&debug=1' })];
      for (const c of cases) { const r = await c(); expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']); expect(r.body.items).toBeUndefined(); }
      expect([spyQ.mock.calls.length, spyE.mock.calls.length]).toEqual([0, 0]); // 400 đến trước khi chạm CSDL
    } finally { spyQ.mockRestore(); spyE.mockRestore(); }
    const ok = await avail(ids.slice(0, 100).join(','));
    expect([ok.status, ok.body.items.length]).toEqual([200, 100]);
  });

  it('INV-TC-20261006-121043905: sản phẩm ngừng bán, chưa công bố, không tồn tại cùng một hình dạng in_stock false; id trùng gộp; bậc C chặn lần thứ 121 từ cùng IP (X-Forwarded-For giả không né được), sang phút sau gọi lại được', async () => {
    const C = await seedStock(t, { on_hand: 9, archived: true }), A = await seedStock(t, { on_hand: 7 });
    const cat = t.cat, D = await seedProduct(t as never, { category: cat, status: 'draft' }), E = newId();
    const r = await avail(`${C.product},${D},${E}`);
    expect(r.body.items.map((i: { in_stock: boolean }) => i.in_stock)).toEqual([false, false, false]);
    expect(r.body.items.map((i: Record<string, unknown>) => Object.keys(i).sort().join())).toEqual(['in_stock,product_id', 'in_stock,product_id', 'in_stock,product_id']);
    expect((await avail(`${A.product},${A.product}`)).body.items).toEqual([{ product_id: A.product, in_stock: true }]);
    t.clock.advance(61_000);
    const ip = '203.0.113.7';
    for (let i = 1; i <= 120; i++) { const x = await avail(A.product, { ip }); if (x.status !== 200) throw new Error(`lần ${i}: ${x.status}`); }
    const over = await avail(A.product, { ip });
    expect([over.status, over.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await avail(A.product, { ip: `198.51.100.${Math.floor(Math.random() * 200)}, ${ip}` })).status).toBe(429); // phần tử giả đứng trước phần proxy tin cậy thêm vào bị bỏ qua
    expect((await avail(A.product, { ip: '203.0.113.99' })).status).toBe(200); // IP khác đếm riêng
    t.clock.advance(61_000);
    expect((await avail(A.product, { ip })).status).toBe(200);
  }, 120_000);
});

// Kiểm quyền theo ma trận trên AppModule thật cho route của INV (INV-SEC T1, T10; SB-05, SB-07).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const INV_SCOPE = (id: string) => /\s\/api\/v1\/(admin\/inventory|inventory)(\/|$)/.test(id);
// Năm hàng của tác nhân hệ thống không có endpoint (giữ, chốt và nhả, hết hạn, chống bán vượt qua giao diện nội bộ, tạo và khóa bản ghi theo event).
const EXEMPT = [
  'Giữ hàng cho đơn (CHK gọi nội bộ trong giao dịch tạo đơn, không có endpoint)',
  'Chốt và nhả hàng giữ theo event của đơn, thanh toán, giao hàng (tác nhân hệ thống, không có endpoint)',
  'Hết hạn giữ hàng bằng job mỗi phút (tác nhân hệ thống, không có endpoint)',
  'Bảo đảm không bán vượt tồn và hỏi số còn bán được (giao diện nội bộ cho CRT, CHK, không có endpoint)',
  'Tạo và khóa bản ghi kho theo ProductActivated, ProductArchived (tác nhân hệ thống, không có endpoint)',
];
const opts = { scope: INV_SCOPE, epic: 'INV', exempt: EXEMPT };

describe('INV kiểm quyền theo ma trận trên AppModule thật', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(testConfig()).overrideProvider(Clock).useValue(new FakeClock()).compile();
    app = m.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app, { config: testConfig(), logger: AppLogger.create({ level: 'error', env: 'dev' }) });
    await app.init();
  });
  afterAll(() => app.close());

  it('INV-TC-20261006-101122968: mọi route của INV khai quyền, schema và @Action khớp ma trận; tuyến tĩnh low-stock đăng ký trước :product_id; đủ 9 route', () => {
    expect(auditRoutes(app)).toEqual([]);
    expect(auditPermissions(app, MATRIX, opts)).toEqual([]);
    expect(errorRegistry.audit()).toEqual([]); // sổ mã lỗi trên AppModule thật sạch: INV dùng lại `product-archived` của PRD, không khai trùng
    for (const [code, status] of [['no-change', 400], ['stock-limit-exceeded', 409], ['insufficient-stock', 409], ['below-reserved', 409], ['stock-version-conflict', 409], ['product-archived', 409]] as const) expect([code, errorRegistry.get(code)?.status]).toEqual([code, status]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('INV-REQ-'))).toHaveLength(13);
    const ids = routeIds(app).filter(INV_SCOPE);
    expect(ids).toHaveLength(9);
    expect(ids.indexOf('GET /api/v1/admin/inventory/low-stock')).toBeLessThan(ids.indexOf('GET /api/v1/admin/inventory/:product_id'));
  });

  it('INV-TC-20261006-101123580: kiểm lệch ma trận báo khi ma trận hay code sai và đóng khi công cụ hỏng', () => {
    // customer được nhập kho (sửa hàng ma trận) -> báo lệch
    const widened = MATRIX.replace(/^(\| Nhập kho \|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(app, widened, opts).join('\n')).toContain('POST /api/v1/admin/inventory/:product_id/stock-in: code cho [admin, staff] nhưng ma trận (Nhập kho) cho [admin, customer, staff]');
    // guest không còn xem được còn hàng -> code @Public lệch
    const closed = MATRIX.replace(/^(\| Xem còn hàng hay hết hàng theo lô \(công khai, không lộ số tồn\) \|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(auditPermissions(app, closed, opts).join('\n')).toContain('code khai @Public nhưng ma trận không cho guest');
    // hàng đổi tên: @Action không còn trong ma trận
    expect(auditPermissions(app, MATRIX.replace('| Xuất kho thủ công |', '| Xuất kho |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    // ma trận rỗng: lỗi, không im lặng cho qua
    expect(auditPermissions(app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    // phạm vi rỗng mà epic có hàng: báo từng hàng thiếu endpoint (8 hàng có endpoint: ba hàng đọc, nhập, xuất, điều chỉnh, ngưỡng, lịch sử; năm hàng hệ thống được miễn; hàng công khai cũng có endpoint)
    expect(auditPermissions(app, MATRIX, { scope: () => false, epic: 'INV', exempt: EXEMPT }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(8);
    expect(auditPermissions(app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('hàng ma trận "Hết hạn giữ hàng bằng job mỗi phút (tác nhân hệ thống, không có endpoint)" của INV không có endpoint nào khai @Action');
  });
});
