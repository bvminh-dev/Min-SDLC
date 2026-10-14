import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import * as cartIndex from '../../src/modules/cart';
import { CartApi } from '../../src/modules/cart';
import { auditPermissions, auditRoutes, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { API_DIR, REPO_ROOT, truncateAll } from '../support/db';
import { createAuthApp, type AuthApp } from '../support/auth';
import { call, who } from '../support/prd';

// Kiểm quyền, ranh giới và mã lỗi của CRT trên AppModule thật (CRT-SEC-20261006-103824617: T4, T10, T12; SB-05, SB-13, SB-35).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const CRT_SCOPE = (id: string) => /\s\/api\/v1\/cart(\/|$)/.test(id);
// Ba hàng không có endpoint HTTP: tổng và giao diện cho CHK, kiểm tồn (nằm trong thêm, sửa, xem giỏ) và vòng đời giỏ do event, job.
const INTERNAL = [
  'Xem tổng tiền giỏ (CHK đọc giỏ đã định giá qua giao diện nội bộ, không có endpoint riêng)', 'Kiểm tồn khi thêm, sửa và xem giỏ (không giữ hàng, không có endpoint riêng)',
  'Chuyển giỏ sang đã đặt, đánh dấu dòng ngừng bán, dọn giỏ bỏ dở (do event và job, không có endpoint)',
];
const opts = { scope: CRT_SCOPE, epic: 'CRT', exempt: INTERNAL };
const SEC = 'CRT-SEC-20261006-103824617';
const API_SPEC = 'spec/epics/CRT/design/CRT-API-20261006-103824592.md';

describe('CRT kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`CRT-TC-20261006-104451291 CRT-TC-20261006-104452823 ${SEC} T4, T12 (SB-05): danh sách route của CRT đúng 10 route của CRT-API; không có đường HTTP nào để nhận event, tạo giỏ rời, gọi giao diện cho CHK hay sửa trạng thái giỏ`, async () => {
    expect(routeIds(t.app).filter(CRT_SCOPE).sort()).toEqual([
      'DELETE /api/v1/cart', 'DELETE /api/v1/cart/coupon', 'DELETE /api/v1/cart/items/:item_id', 'GET /api/v1/cart', 'GET /api/v1/cart/summary',
      'PATCH /api/v1/cart/items/:item_id', 'POST /api/v1/cart/items', 'POST /api/v1/cart/refresh-prices', 'PUT /api/v1/cart/coupon', 'PUT /api/v1/cart/shipping',
    ].sort());
    const staff = await who(t, 'staff', 's@shop.vn'), admin = await who(t, 'admin', 'a@shop.vn');
    const attempts: [string, string, unknown][] = [
      ['post', '/cart/events', { type: 'CheckoutCompleted' }], ['post', '/cart', {}], ['put', '/cart', {}], ['patch', '/cart', { status: 'converted' }], ['post', '/cart/snapshot', {}], ['post', '/cart/lock', {}],
      ['get', '/cart/checkout', undefined], ['put', '/cart/items/x', {}], ['post', '/cart/items/x', {}], ['delete', '/cart/shipping', undefined], ['get', '/admin/cart', undefined], ['get', '/carts', undefined],
      ['post', '/cart/abandon', {}], ['get', '/cart/items', undefined],
    ];
    for (const who of [undefined, staff.cookie, admin.cookie]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie: who, body });
      expect([m, p, [401, 404, 405].includes(r.status)]).toEqual([m, p, true]);
    }
    expect(await cartCount0(t)).toBe(0);
  });

  it(`CRT-TC-20261006-104451291 ${SEC} T4 (SB-05): mọi route của CRT khai quyền, schema và @Action khớp ma trận (customer own); AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng`, async () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    const rows = parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('CRT-REQ-'));
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.action).sort()).toEqual([
      'Chọn phương thức vận chuyển và xem phí trên giỏ', 'Thêm sản phẩm vào giỏ', 'Xem giỏ, tạm tính, huy hiệu giỏ và cập nhật giá', 'Xóa một sản phẩm khỏi giỏ', 'Áp và gỡ mã giảm giá trên giỏ',
      'Đổi số lượng của một dòng trong giỏ', 'Làm trống giỏ', ...INTERNAL,
    ].sort());
    for (const r of rows.filter((x) => !INTERNAL.includes(x.action))) expect([r.guest, r.customer, r.staff, r.admin, r.system]).toEqual(['-', 'own', '-', '-', '-']); // chỉ customer có giỏ (R-04)
    for (const r of rows.filter((x) => INTERNAL.includes(x.action))) expect(r.guest).toBe('-');
    // ma trận rộng hơn code: staff được thêm vào giỏ
    const widened = MATRIX.replace(/^(\| Thêm sản phẩm vào giỏ \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 own |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('POST /api/v1/cart/items: code cho [customer] nhưng ma trận (Thêm sản phẩm vào giỏ) cho [customer, staff]');
    // guest được xem giỏ trong ma trận nhưng code không @Public
    const guestRow = MATRIX.replace(/^(\| Làm trống giỏ \|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(auditPermissions(t.app, guestRow, opts).join('\n')).toContain('ma trận cho guest (Làm trống giỏ) nhưng code không khai @Public');
    expect(auditPermissions(t.app, MATRIX.replace('| Làm trống giỏ |', '| Xóa sạch |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'CRT', exempt: INTERNAL }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(7); // quét rỗng thì đỏ
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it(`CRT-TC-20261006-104451291 ${SEC} T10 (SB-13): endpoint ghi có chống CSRF: Origin lạ hay vắng thì 403 csrf_failed, thân không phải JSON thì 415; không tạo giỏ`, async () => {
    const u = await who(t, 'customer', 'c@shop.vn');
    for (const [m, p, body] of [['post', '/cart/items', { product_id: 'x', quantity: 1 }], ['delete', '/cart', undefined], ['put', '/cart/coupon', { code: 'ABCD' }], ['put', '/cart/shipping', { method_id: 'x', city: 'y' }], ['post', '/cart/refresh-prices', {}], ['delete', '/cart/coupon', undefined]] as [string, string, unknown][]) {
      for (const origin of ['https://evil.example', null]) {
        const r = await call(t, m as 'post', p, { cookie: u.cookie, body, origin });
        expect([m, p, origin, r.status, r.body.type]).toEqual([m, p, origin, 403, 'urn:ecom:error:csrf_failed']);
      }
    }
    const r = await call(t, 'post', '/cart/items', { cookie: u.cookie, body: 'product_id=x&quantity=1', contentType: 'text/plain' });
    expect(r.status).toBe(415);
    expect(await cartCount0(t)).toBe(0);
  });

  it(`CRT-TC-20261006-104451291 ${SEC} (ADR-023): sổ mã lỗi có đủ mã riêng của CRT-API đúng status; mọi mã DomainError trong mã CRT đều có trong CRT-API hoặc là mã nền, INV, SHP; quét không rỗng`, () => {
    const spec = readFileSync(resolve(REPO_ROOT, API_SPEC), 'utf8');
    const line = spec.split('\n').find((l) => l.startsWith('Mã lỗi riêng')) ?? '';
    const declared = [...line.matchAll(/`([a-z-]+)` (\d{3})/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(declared).toHaveLength(18);
    const owned = new Set(['insufficient-stock', 'method-unavailable', 'validation-failed', 'rate-limited', 'service-unavailable']); // mã của INV, SHP và nền
    for (const [code, status] of declared) expect([code, errorRegistry.get(code)?.status]).toEqual([code, status]);
    for (const [code] of declared.filter(([c]) => !owned.has(c))) expect(errorRegistry.get(code)?.title).toBeTruthy();
    expect(errorRegistry.audit()).toEqual([]);
    const dir = resolve(API_DIR, 'src/modules/cart');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/DomainError\('([a-z0-9_-]+)'/g)) used.add(m[1]);
    const base = new Set(['validation-failed', 'unauthenticated', 'forbidden', 'csrf_failed', 'not-found', 'rate-limited', 'internal-error', 'service-unavailable']);
    const known = new Set([...declared.map(([c]) => c), ...base]);
    expect([...used].filter((c) => !known.has(c))).toEqual([]); // không mã lỗi nào ngoài spec
    expect(used.size).toBeGreaterThanOrEqual(10);
    // các mã đăng ký trong errors.ts đều có trong spec
    const registered = [...readFileSync(resolve(dir, 'errors.ts'), 'utf8').matchAll(/^\s*\['([a-z-]+)', (\d{3})/gm)].map((m) => [m[1], Number(m[2])] as const);
    expect(registered.length).toBeGreaterThanOrEqual(12);
    for (const [c, s] of registered) expect(declared).toContainEqual([c, s]);
  });

  it('CRT-TC-20261006-103226562 CRT-TC-20261006-104453980 (A-02, ADR-012): giao diện nội bộ CartApi khớp bảng Giao diện module (tên lớp, hai phương thức, chữ ký có vectơ hằng số); điểm vào công khai chỉ phơi CartModule và CartApi; CRT không SELECT bảng của module khác', async () => {
    const arch = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
    expect(arch).toMatch(/\| CHK \| CRT \| `CartApi\.snapshotForCheckout\(user_id\)`[^|]*`CartApi\.lockForCheckout\(user_id, tx\)`[^|]*\| `lockForCheckout` có, `snapshotForCheckout` không \|/); // lockForCheckout nhận tx
    expect(arch).toMatch(/\| CRT \| PRD, INV, PRM, SHP \| `CatalogApi\.getForCart`, `InventoryApi\.getAvailability`, `PromotionApi\.evaluate\(\.\.\., count_attempt\)`, `ShippingApi\.quote`/);
    expect(CartApi.name).toBe('CartApi');
    expect(Object.getOwnPropertyNames(CartApi.prototype).filter((n) => n !== 'constructor' && n !== 'build').sort()).toEqual(['lockForCheckout', 'snapshotForCheckout']);
    expect([CartApi.prototype.snapshotForCheckout.length, CartApi.prototype.lockForCheckout.length]).toEqual([1, 2]); // (user_id) và (user_id, tx)
    expect(Object.keys(cartIndex).sort()).toEqual(['CartApi', 'CartModule']);
    const dir = resolve(API_DIR, 'src/modules/cart');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) expect([f, /\b(FROM|JOIN|UPDATE|INTO)\s+"?(orders|order_items|order_status_history|users|stock_|products|coupons|coupon_redemptions|shipping_methods|shipments)\b/i.test(readFileSync(resolve(dir, f), 'utf8'))]).toEqual([f, false]);
  });
});

async function cartCount0(t: AuthApp): Promise<number> { return (await t.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM carts`)[0].n; }
