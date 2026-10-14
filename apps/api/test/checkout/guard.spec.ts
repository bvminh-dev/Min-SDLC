import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import * as checkoutIndex from '../../src/modules/checkout';
import { ConfigError, auditPermissions, auditRoutes, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { testConfig } from '../support/app';
import { API_DIR, REPO_ROOT, truncateAll } from '../support/db';
import { createAuthApp, type AuthApp } from '../support/auth';
import { call, who } from '../support/prd';
import { countOf } from '../support/chk';

// Kiểm quyền, ranh giới, cấu hình và mã lỗi của CHK trên AppModule thật (CHK-SEC-20261006-105800857: T4, T12, T16; SB-05, SB-13, SB-35, ADR-007, ADR-023).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const CHK_SCOPE = (id: string) => /\s\/api\/v1\/checkout(\/|$)/.test(id);
// Ba hàng không có endpoint HTTP: kiểm giá, kiểm tồn và giữ hàng nằm BÊN TRONG giao dịch đặt hàng (CHK-API mục Endpoint).
const INTERNAL = [
  'Kiểm tra giá khi đặt đơn (trong giao dịch đặt hàng, không có endpoint)', 'Kiểm tra tồn kho khi xem lại và khi đặt đơn (không có endpoint riêng)',
  'Giữ hàng và giữ lượt coupon trong giao dịch đặt đơn (gọi nội bộ INV, PRM, không có endpoint)',
];
const opts = { scope: CHK_SCOPE, epic: 'CHK', exempt: INTERNAL };
const SEC = 'CHK-SEC-20261006-105800857';
const API_SPEC = 'spec/epics/CHK/design/CHK-API-20261006-105800712.md';

describe('CHK kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`CHK-TC-20261006-110700904 CHK-TC-20261006-110703163 ${SEC} T4, T16 (SB-05): danh sách route của CHK đúng 10 route của CHK-API; không có đường HTTP nào để nhận event, đổi trạng thái phiên từ ngoài hay gọi giao diện nội bộ; guest 401, staff và admin 403 hoặc 404, không tạo phiên`, async () => {
    expect(routeIds(t.app).filter(CHK_SCOPE).sort()).toEqual([
      'DELETE /api/v1/checkout/sessions/:id', 'DELETE /api/v1/checkout/sessions/:id/coupon', 'GET /api/v1/checkout/sessions/:id', 'GET /api/v1/checkout/sessions/:id/shipping-options',
      'POST /api/v1/checkout/sessions', 'POST /api/v1/checkout/sessions/:id/place-order', 'PUT /api/v1/checkout/sessions/:id/address', 'PUT /api/v1/checkout/sessions/:id/coupon',
      'PUT /api/v1/checkout/sessions/:id/payment-method', 'PUT /api/v1/checkout/sessions/:id/shipping-method',
    ].sort());
    const staff = await who(t, 'staff', 's@shop.vn'), admin = await who(t, 'admin', 'a@shop.vn');
    const id = '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c';
    const attempts: [string, string, unknown][] = [
      ['post', '/checkout/events', { type: 'StockReserved' }], ['post', '/events', { type: 'StockReserved' }], ['patch', `/checkout/sessions/${id}`, { status: 'completed' }], ['put', `/checkout/sessions/${id}`, { status: 'completed' }],
      ['post', `/checkout/sessions/${id}/complete`, {}], ['post', `/checkout/sessions/${id}/expire`, {}], ['get', '/checkout/sessions', undefined], ['get', '/admin/checkout/sessions', undefined],
      ['put', `/checkout/sessions/${id}/status`, { status: 'completed' }], ['post', '/checkout/snapshot', {}], ['post', `/checkout/sessions/${id}/reserve`, {}], ['delete', '/checkout/sessions', undefined],
    ];
    for (const who of [undefined, staff.cookie, admin.cookie]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie: who, body });
      expect([m, p, [401, 403, 404, 405].includes(r.status)]).toEqual([m, p, true]);
    }
    const g = await call(t, 'post', '/checkout/sessions', { body: {} }), s = await call(t, 'post', '/checkout/sessions', { cookie: staff.cookie, body: {} }), a = await call(t, 'post', '/checkout/sessions', { cookie: admin.cookie, body: {} });
    expect([g.status, s.status, a.status]).toEqual([401, 403, 403]);
    expect(await countOf(t, 'checkout_sessions')).toBe(0);
  });

  it(`CHK-TC-20261006-110700904 ${SEC} T4 (SB-05): mọi route của CHK khai quyền, schema và @Action khớp ma trận (customer own); AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng`, () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    const rows = parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('CHK-REQ-'));
    expect(rows).toHaveLength(11);
    for (const r of rows) { expect([r.guest, r.customer, r.staff, r.admin]).toEqual(['-', 'own', '-', '-']); } // chỉ customer có phiên checkout (BR1)
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(INTERNAL));
    // ma trận rộng hơn code: staff được đặt hàng
    const widened = MATRIX.replace(/^(\| Đặt hàng và tạo đơn \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 own |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('POST /api/v1/checkout/sessions/:id/place-order: code cho [customer] nhưng ma trận (Đặt hàng và tạo đơn) cho [customer, staff]');
    const guestRow = MATRIX.replace(/^(\| Hủy phiên checkout và hết hạn phiên[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(auditPermissions(t.app, guestRow, opts).join('\n')).toContain('ma trận cho guest');
    expect(auditPermissions(t.app, MATRIX.replace('| Đặt hàng và tạo đơn |', '| Mua ngay |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'CHK', exempt: INTERNAL }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(8); // quét rỗng thì đỏ
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it(`CHK-TC-20261006-110703453 ${SEC} T12 (SB-13): endpoint ghi có chống CSRF: Origin lạ hay vắng thì 403 csrf_failed, thân không phải JSON thì 415; không tạo phiên`, async () => {
    const u = await who(t, 'customer', 'c@shop.vn');
    const id = '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c';
    const writes: [string, string, unknown][] = [
      ['post', '/checkout/sessions', {}], ['put', `/checkout/sessions/${id}/address`, { address_id: 'x' }], ['put', `/checkout/sessions/${id}/shipping-method`, { method_id: 'x' }], ['put', `/checkout/sessions/${id}/payment-method`, { payment_method: 'cod' }],
      ['put', `/checkout/sessions/${id}/coupon`, { code: 'ABCD' }], ['delete', `/checkout/sessions/${id}/coupon`, undefined], ['post', `/checkout/sessions/${id}/place-order`, { expected_grand_total: 1, cart_version: 1 }], ['delete', `/checkout/sessions/${id}`, undefined],
    ];
    for (const [m, p, body] of writes) for (const origin of ['https://evil.example', null]) {
      const r = await call(t, m as 'post', p, { cookie: u.cookie, body, origin });
      expect([m, p, origin, r.status, r.body.type]).toEqual([m, p, origin, 403, 'urn:ecom:error:csrf_failed']);
    }
    const r = await call(t, 'post', '/checkout/sessions', { cookie: u.cookie, body: 'a=1', contentType: 'text/plain' });
    expect(r.status).toBe(415);
    expect(await countOf(t, 'checkout_sessions')).toBe(0);
  });

  it(`CHK-TC-20261006-110703163 ${SEC} (ADR-023): sổ mã lỗi có đủ mã của CHK-API đúng status; mọi mã DomainError trong mã CHK đều có trong CHK-API hoặc là mã nền, INV, CRT; quét không rỗng`, () => {
    const spec = readFileSync(resolve(REPO_ROOT, API_SPEC), 'utf8');
    const section = spec.slice(spec.indexOf('### Danh mục lỗi'), spec.indexOf('### POST /api/v1/checkout/sessions'));
    const declared: [string, number][] = [];
    for (const l of section.split('\n')) {
      const c = l.startsWith('|') ? l.split('|').slice(1, -1).map((x) => x.trim()) : [];
      if (c.length >= 4 && /^[a-z]+(-[a-z]+)*(, [a-z]+(-[a-z]+)*)*$/.test(c[0]) && /^\d{3}$/.test(c[1])) for (const code of c[0].split(', ')) declared.push([code, Number(c[1])]);
    }
    expect(declared.length).toBeGreaterThanOrEqual(30);
    for (const [code, status] of declared) expect([code, errorRegistry.get(code)?.status]).toEqual([code, status]);
    expect(errorRegistry.audit()).toEqual([]);
    const dir = resolve(API_DIR, 'src/modules/checkout');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) for (const m of readFileSync(resolve(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').matchAll(/new DomainError\('([a-z0-9_-]+)'/g)) used.add(m[1]); // bỏ chú thích: chỉ mã ném thật
    const known = new Set(declared.map(([c]) => c));
    expect([...used].filter((c) => !known.has(c))).toEqual([]); // không mã lỗi nào ngoài spec
    expect(used.size).toBeGreaterThanOrEqual(20);
    const registered = [...readFileSync(resolve(dir, 'errors.ts'), 'utf8').matchAll(/^\s*\['([a-z-]+)', (\d{3})/gm)].map((m) => [m[1], Number(m[2])] as const);
    expect(registered.length).toBeGreaterThanOrEqual(25);
    for (const [c, s] of registered) expect(declared).toContainEqual([c, s]);
  });

  it(`CHK-TC-20261006-110702894 ${SEC} (A-02, ADR-012, SB-35): CHK gọi đúng sáu module trong cột Phụ thuộc bằng các lớp *Api của bảng Giao diện module; điểm vào công khai chỉ phơi CheckoutModule; CHK không SELECT bảng của module khác và không có consumer nào`, () => {
    const arch = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
    expect(arch).toMatch(/\| CHK {2}\| checkout {5}\| CRT, USR, PRM, INV, SHP, ORD \|/);
    expect(Object.keys(checkoutIndex)).toEqual(['CheckoutModule']);
    const dir = resolve(API_DIR, 'src/modules/checkout');
    const deps = readFileSync(resolve(dir, 'deps.service.ts'), 'utf8');
    for (const cls of ['CartApi', 'AddressService', 'PromotionApi', 'InventoryApi', 'ShippingApi', 'OrderApi']) expect(deps).toContain(cls);
    expect(deps).toMatch(/\.snapshotForCheckout\(/); expect(deps).toMatch(/\.lockForCheckout\(userId, tx\)/); expect(deps).toMatch(/\.reserve\(orderId, items, expiresAt, tx\)/); expect(deps).toMatch(/\.createPending\(input, tx\)/);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(resolve(dir, f), 'utf8');
      expect([f, /\b(FROM|JOIN|UPDATE|INTO)\s+"?(carts|cart_items|addresses|orders|order_items|order_status_history|users|stock_|products|coupons|coupon_redemptions|shipping_methods|shipments|payments)\b/i.test(src)]).toEqual([f, false]);
      expect([f, /\.subscribe\(/.test(src)]).toEqual([f, false]); // consumes rỗng (CHK-API, T16)
    }
  });

  it('CHK-TC-20261006-110702894 (ADR-007): biến cấu hình của CHK có mặc định đã chốt (RESERVATION_TTL 15, CHK_SESSION_TTL_MINUTES 30, CHK_MAX_OPEN_VNPAY_ORDERS 3, CHK_MAX_OPEN_COD_ORDERS 5, CHK_DEPENDENCY_TIMEOUT_MS 2000), kiểm schema lúc khởi động và từ chối giá trị sai', () => {
    const c = testConfig();
    expect(['RESERVATION_TTL', 'CHK_SESSION_TTL_MINUTES', 'CHK_MAX_OPEN_VNPAY_ORDERS', 'CHK_MAX_OPEN_COD_ORDERS', 'CHK_DEPENDENCY_TIMEOUT_MS'].map((k) => c.get(k))).toEqual([15, 30, 3, 5, 2000]);
    expect(testConfig({ CHK_SESSION_TTL_MINUTES: '45', CHK_MAX_OPEN_COD_ORDERS: '7' }).get('CHK_SESSION_TTL_MINUTES')).toBe(45);
    const bads: Record<string, string>[] = [{ CHK_SESSION_TTL_MINUTES: '0' }, { CHK_MAX_OPEN_VNPAY_ORDERS: 'ba' }, { CHK_DEPENDENCY_TIMEOUT_MS: '10' }, { RESERVATION_TTL: '-1' }, { CHK_MAX_OPEN_COD_ORDERS: '0' }];
    for (const bad of bads) {
      expect(() => testConfig(bad)).toThrow(ConfigError);
    }
  });
});
