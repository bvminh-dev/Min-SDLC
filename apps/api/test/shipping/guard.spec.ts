import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import * as shippingIndex from '../../src/modules/shipping';
import { ShippingApi } from '../../src/modules/shipping';
import { auditPermissions, auditRoutes, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { API_DIR, REPO_ROOT, truncateAll } from '../support/db';
import { createAuthApp, type AuthApp } from '../support/auth';
import { call, seedMethod, seedShipment, snapshotCounts, who } from '../support/shp';

// Kiểm quyền, ranh giới và mã lỗi của SHP trên AppModule thật (SHP-SEC-20261006-101603066: T3, T4, T11, T13, T21; SB-05, SB-07, SB-35).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const SHP_SCOPE = (id: string) => /\s\/api\/v1\/(admin\/)?shipping(\/|$)/.test(id);
// Hai hàng không có endpoint HTTP: tạo và hủy vận đơn do event của ORD (tác nhân system).
const INTERNAL = ['Tạo vận đơn tự động khi đơn paid hoặc confirmed (event của ORD, không có endpoint)', 'Hủy vận đơn chưa bàn giao khi đơn bị hủy (event của ORD, không có endpoint)'];
const opts = { scope: SHP_SCOPE, epic: 'SHP', exempt: INTERNAL };
const SEC = 'SHP-SEC-20261006-101603066';

describe('SHP kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`SHP-TC-20261006-102147397 ${SEC} T11, T13 (SB-35): danh sách route của SHP đúng 15 route của SHP-API; không có đường HTTP nào để nhận event, tạo, hủy vận đơn, gọi giao diện nội bộ hay sửa lịch sử`, async () => {
    expect(routeIds(t.app).filter(SHP_SCOPE).sort()).toEqual([
      'GET /api/v1/admin/shipping/methods', 'GET /api/v1/shipping/methods', 'GET /api/v1/shipping/orders/:code/shipment', 'GET /api/v1/shipping/orders/:code/shipment/history', 'GET /api/v1/shipping/shipments',
      'PATCH /api/v1/admin/shipping/methods/:id', 'PATCH /api/v1/shipping/orders/:code/shipment/tracking-number',
      'POST /api/v1/admin/shipping/methods', 'POST /api/v1/admin/shipping/methods/:id/disable', 'POST /api/v1/admin/shipping/methods/:id/enable', 'POST /api/v1/shipping/orders/:code/shipment/deliver',
      'POST /api/v1/shipping/orders/:code/shipment/fail', 'POST /api/v1/shipping/orders/:code/shipment/return', 'POST /api/v1/shipping/orders/:code/shipment/ship', 'POST /api/v1/shipping/quote',
    ].sort());
    expect(routeIds(t.app).filter((id) => /shipping|shipment/i.test(id) && /createFromEvent|cancelFor|events?\b|lock|handoff|internal|listActiveMethods/i.test(id))).toEqual([]);
    const staff = await who(t, 'staff', 's1@shop.vn'), admin = await who(t, 'admin', 'a1@shop.vn');
    const v = await seedShipment(t, { status: 'pending' });
    const before = await snapshotCounts(t);
    const attempts: [string, string, unknown][] = [
      ['post', '/shipping/events', { type: 'OrderPaid', order_id: v.order.id }], ['post', '/shipping/shipments', { order_id: v.order.id }], ['post', `/shipping/orders/${v.order.code}/shipment`, {}],
      ['put', `/shipping/orders/${v.order.code}/shipment`, {}], ['delete', `/shipping/orders/${v.order.code}/shipment`, {}], ['post', `/shipping/orders/${v.order.code}/shipment/cancel`, {}],
      ['post', `/shipping/orders/${v.order.code}/shipment/lock`, {}], ['patch', `/shipping/orders/${v.order.code}/shipment`, { status: 'delivered' }], ['delete', `/shipping/orders/${v.order.code}/shipment/history`, {}],
      ['delete', `/admin/shipping/methods/${v.method}`, {}], ['post', '/shipping/orders/x/shipment/ship/extra', {}],
    ];
    for (const who of [undefined, staff.cookie, admin.cookie]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie: who, body });
      expect([m, p, [401, 404, 405].includes(r.status)]).toEqual([m, p, true]);
      if (who) expect([404, 405]).toContain(r.status);
    }
    expect(await snapshotCounts(t)).toEqual(before);
  });

  it(`SHP-TC-20261006-102133082 SHP-TC-20261006-102133553 ${SEC} T3, T4 (SB-05, SB-07): mọi route của SHP khai quyền, schema và @Action khớp ma trận (customer own); AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng`, async () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    // hàng `Sale <việc>` gộp vào hàng gốc (một endpoint một @Action, route-audit.ts): danh sách vận đơn có thêm quyền `own` cho sale (SHP-REQ-20261006-101103927 BR11, SB-08 (d))
    const shpRows = parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('SHP-REQ-'));
    expect(shpRows.filter((r) => r.sale !== '-').map((r) => [r.action, r.sale, r.staff, r.admin])).toEqual([['Sale xem danh sách vận đơn (lọc theo trạng thái, mã đơn, mã vận đơn)', 'own', '-', '-']]);
    expect(shpRows.filter((r) => !r.action.startsWith('Sale ')).map((r) => r.action).sort()).toEqual([
      'Báo phí vận chuyển theo phương thức, thành phố và tạm tính', 'Bàn giao vận đơn và nhập mã vận đơn', 'Bật hoặc tắt phương thức vận chuyển', ...INTERNAL,
      'Sửa mã vận đơn đã nhập', 'Tạo và sửa phương thức vận chuyển', 'Xác nhận giao xong, báo giao thất bại, xác nhận hàng hoàn về kho', 'Xem các phương thức vận chuyển đang áp dụng',
      'Xem danh sách mọi phương thức vận chuyển (kể cả đã tắt)', 'Xem danh sách vận đơn (lọc theo trạng thái, mã đơn, mã vận đơn)', 'Xem lịch sử trạng thái vận đơn', 'Xem trạng thái và chi tiết vận đơn của một đơn',
    ].sort());
    for (const r of parseMatrix(MATRIX).filter((x) => INTERNAL.includes(x.action))) expect([r.guest, r.customer, r.staff, r.admin, r.system]).toEqual(['-', '-', '-', '-', 'Y']); // tạo và hủy do event chỉ tác nhân system
    // ma trận rộng hơn code: staff được tạo và sửa phương thức
    const widened = MATRIX.replace(/^(\| Tạo và sửa phương thức vận chuyển \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('POST /api/v1/admin/shipping/methods: code cho [admin] nhưng ma trận (Tạo và sửa phương thức vận chuyển) cho [admin, staff]');
    // customer own cũng được xem lịch sử: đổi thành "-" thì code lệch
    const narrowed = MATRIX.replace(/^(\| Xem lịch sử trạng thái vận đơn \|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(auditPermissions(t.app, narrowed, opts).join('\n')).toContain('GET /api/v1/shipping/orders/:code/shipment/history: code cho [admin, customer, staff] nhưng ma trận (Xem lịch sử trạng thái vận đơn) cho [admin, staff]');
    expect(auditPermissions(t.app, MATRIX.replace('| Sửa mã vận đơn đã nhập |', '| Sửa mã |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'SHP', exempt: INTERNAL }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(12); // 11 hàng gốc + hàng `Sale xem danh sách vận đơn` (không route nào trong phạm vi nên chưa gộp)
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it(`SHP-TC-20261006-102133602 ${SEC} T21: sổ mã lỗi có đủ chín mã của SHP-API đúng status 409 (không trùng, không sai dạng); mọi mã DomainError trong mã SHP đều có trong sổ hoặc là mã nền`, () => {
    const spec = readFileSync(resolve(REPO_ROOT, 'spec/epics/SHP/design/SHP-API-20261006-101603042.md'), 'utf8');
    const line = spec.split('\n').find((l) => l.startsWith('Mã lỗi riêng')) ?? '';
    const declared = [...line.matchAll(/`([a-z-]+)` (\d{3})/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(declared).toHaveLength(9);
    for (const [code, status] of declared) expect([code, errorRegistry.get(code)?.status]).toEqual([code, status]);
    expect(errorRegistry.audit()).toEqual([]);
    const dir = resolve(API_DIR, 'src/modules/shipping');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/DomainError\('([a-z0-9_-]+)'/g)) used.add(m[1]);
    const base = new Set(['validation-failed', 'unauthenticated', 'forbidden', 'csrf_failed', 'not-found', 'rate-limited', 'internal-error']);
    const known = new Set([...declared.map(([c]) => c), ...base]);
    expect([...used].filter((c) => !known.has(c))).toEqual([]); // không mã lỗi nào ngoài spec
    expect(used.size).toBeGreaterThanOrEqual(8);
  });

  it(`SHP-TC-20261006-102133284 ${SEC}: giao diện nội bộ ShippingApi khớp bảng Giao diện module (tên lớp, hai phương thức listActiveMethods và quote); điểm vào công khai chỉ phơi ShippingModule và ShippingApi; ShippingApi không có tx`, async () => {
    const arch = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
    expect(arch).toMatch(/\| CHK \| SHP \| `ShippingApi\.listActiveMethods`, `ShippingApi\.quote` [^|]*\| không \|/);
    expect(arch).toMatch(/\| CRT \| PRD, INV, PRM, SHP \|[^\n]*`ShippingApi\.quote`/);
    expect(arch).toMatch(/\| SHP \| ORD \|[^\n]*`OrderApi\.findForPayment`/); // `fail` gọi findForPayment lấy user_id (review SHP, hàng SHP -> ORD)
    expect(ShippingApi.name).toBe('ShippingApi');
    expect(Object.getOwnPropertyNames(ShippingApi.prototype).filter((n) => n !== 'constructor').sort()).toEqual(['listActiveMethods', 'quote']);
    expect(ShippingApi.prototype.listActiveMethods.length).toBe(0); // không nhận tx
    expect(ShippingApi.prototype.quote.length).toBe(1);
    expect(Object.keys(shippingIndex).sort()).toEqual(['ShippingApi', 'ShippingModule']);
    const api = t.app.get(ShippingApi);
    const m = await seedMethod(t, { name: 'Giao thử', fee: 12345 });
    expect(await api.listActiveMethods()).toEqual([{ id: m, name: 'Giao thử', base_fee: 12345, free_over: null }]);
    expect(await api.quote({ method_id: m, city: 'Hà Nội', subtotal: 1 })).toEqual({ fee: 12345, free_shipping: false });
    // SHP không SELECT bảng của module khác (SB-35): không `FROM orders` hay `JOIN orders` trong mã SHP
    const dir = resolve(API_DIR, 'src/modules/shipping');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) expect([f, /\b(FROM|JOIN|UPDATE|INTO)\s+"?(orders|order_items|order_status_history|users|stock_|products|coupons)/i.test(readFileSync(resolve(dir, f), 'utf8'))]).toEqual([f, false]);
  });
});
