import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import { OrderApi } from '../../src/modules/order';
import { auditPermissions, auditRoutes, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { truncateAll, REPO_ROOT } from '../support/db';
import { call, createOrdApp, countRows, historyOf, orderOf, outboxOf, people, seedOrder, type OrdApp } from '../support/ord';
import { createAuthApp, type AuthApp } from '../support/auth';

const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const ARCH = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
const ORD_SCOPE = (id: string) => /\s\/api\/v1\/(admin\/)?orders(\/|$)/.test(id);
// Bốn hàng không có endpoint HTTP: "Xem trạng thái đơn" (ORD-REQ ...790; trạng thái là trường `status` của danh sách và chi tiết) và ba hàng giao diện nội bộ (tác nhân system).
const INTERNAL = ['Giao diện nội bộ cho CHK - tạo đơn, xác nhận COD, đếm đơn mở, tóm tắt đơn', 'Giao diện đọc nội bộ cho PAY, SHP, REV và DSH', 'Khóa hủy đơn khi SHP bắt đầu bàn giao (giao diện nội bộ cho SHP, không có endpoint)'];
const EXEMPT = ['Xem trạng thái đơn', ...INTERNAL];
const opts = { scope: ORD_SCOPE, epic: 'ORD', exempt: EXEMPT };

describe('ORD kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it('ORD-TC-20261006-111225620: không có đường HTTP nào để staff, admin hay guest đổi trạng thái đơn hay giả event; danh sách route của ORD đúng năm route của ORD-API', async () => {
    expect(routeIds(t.app).filter(ORD_SCOPE).sort()).toEqual([
      'GET /api/v1/admin/orders', 'GET /api/v1/orders', 'GET /api/v1/orders/:code', 'GET /api/v1/orders/:code/status-history', 'POST /api/v1/orders/:code/cancel',
    ]);
    expect(routeIds(t.app).filter((id) => /order/i.test(id) && /createPending|confirmCod|countOpen|getSummary|lock|handoff|event/i.test(id))).toEqual([]);
    const { a, staff, admin } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    const attempts: [string, string, unknown][] = [
      ['patch', `/orders/${o.code}`, { status: 'shipped' }], ['put', `/orders/${o.code}/status`, {}], ['post', `/orders/${o.code}/ship`, {}],
      ['post', `/orders/${o.code}/events`, { type: 'ShipmentShipped' }], ['post', '/events', { type: 'PaymentSucceeded', order_id: o.id }],
    ];
    for (const who of [undefined, staff.cookie, admin.cookie]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie: who, body });
      expect([404, 405, 401]).toContain(r.status);
      if (who) expect([404, 405]).toContain(r.status);
    }
    expect((await orderOf(t, o.id)).status).toBe('paid');
    expect(await historyOf(t, o.id)).toHaveLength(2);
    expect(await outboxOf(t)).toEqual([]);
    expect(await countRows(t, 'orders')).toBe(1);
  });

  it('ORD-TC-20261006-111224663 và ORD-SEC-20261006-092703802 T4 (SB-05, SB-07): mọi route của ORD khai quyền, schema và @Action khớp ma trận (customer own, staff, admin); AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng', () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('ORD-REQ-')).map((r) => r.action).sort()).toEqual([
      'Hủy đơn (trước khi giao)', ...INTERNAL, 'Xem chi tiết đơn', 'Xem danh sách mọi đơn, lọc trạng thái, tìm theo mã đơn', 'Xem danh sách đơn của mình (lọc theo trạng thái)', 'Xem lịch sử trạng thái đơn', 'Xem trạng thái đơn',
    ].sort());
    for (const r of parseMatrix(MATRIX).filter((x) => INTERNAL.includes(x.action))) expect([r.guest, r.customer, r.staff, r.admin, r.system]).toEqual(['-', '-', '-', '-', 'Y']); // giao diện nội bộ chỉ tác nhân system
    const widened = MATRIX.replace(/^(\| Hủy đơn \(trước khi giao\) \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('POST /api/v1/orders/:code/cancel: code cho [admin, customer] nhưng ma trận (Hủy đơn (trước khi giao)) cho [admin, customer, staff]');
    expect(auditPermissions(t.app, MATRIX.replace('| Xem chi tiết đơn |', '| Xem đơn |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'ORD', exempt: EXEMPT }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(5);
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('hàng ma trận "Xem trạng thái đơn" của ORD không có endpoint nào khai @Action');
  });

  it('ORD-API-20261006-092703780 mục Giao tiếp giữa module: OrderApi đúng bảng Giao diện module (mười lăm phương thức, đúng số đối số, tx ở bốn phương thức ghi), chỉ có AUTH là phụ thuộc, sổ mã lỗi sạch và có order-not-cancellable (409)', () => {
    const arch = (re: RegExp) => expect(ARCH).toMatch(re);
    arch(/\| CHK \| ORD \| `OrderApi\.createPending\(\.\.\., payment_expires_at, tx\)`[^|]*`OrderApi\.confirmCod`, `OrderApi\.countOpenOrders`, `OrderApi\.getSummary` \| có \|/);
    arch(/\| PAY \| ORD \| `OrderApi\.findForPayment` \(đọc\) \| không \|/);
    arch(/\| SHP \| ORD \| `OrderApi\.findForShipment`, `OrderApi\.findByCode`, `OrderApi\.findOwned`, `OrderApi\.getRecipient` [^|]*`OrderApi\.lockForHandoff\(order_id, tx\)`/);
    arch(/\| REV \| ORD \| `OrderApi\.getDeliveredItems` \(đọc\) \| không \|/);
    arch(/\| DSH \| ORD \| `OrderApi\.countByStatus`, `OrderApi\.getOrderSeries`, `OrderApi\.listRecent`, `OrderApi\.getTopProducts`/);
    arch(/\|\s*ORD\s*\|\s*order\s*\|\s*AUTH\s*\|/);
    const arity: Record<string, number> = {
      createPending: 2, confirmCod: 2, countOpenOrders: 1, getSummary: 1, findForPayment: 1, findForShipment: 1, findByCode: 1, findOwned: 2, getRecipient: 1, lockForHandoff: 2,
      getDeliveredItems: 2, countByStatus: 1, getOrderSeries: 2, listRecent: 1, getTopProducts: 3,
    };
    const proto = Object.getOwnPropertyNames(OrderApi.prototype).filter((n) => n !== 'constructor').sort();
    expect(proto).toEqual(Object.keys(arity).sort());
    for (const [name, n] of Object.entries(arity)) expect([name, (OrderApi.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[name].length]).toEqual([name, n]);
    expect(errorRegistry.audit()).toEqual([]);
    expect(errorRegistry.get('order-not-cancellable')).toMatchObject({ status: 409, title: 'Order cannot be cancelled in its current state' });
  });
});

// một ứng dụng riêng chỉ có ORD (không AppModule) để chắc ORD chạy được một mình trên nền: cột Phụ thuộc là AUTH, không cần module khác
describe('ORD chạy độc lập trên PlatformModule và AuthModule', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  it('ORD-API-20261006-092703780: khởi động chỉ với platform và AUTH, đăng ký đủ mười một consumer của event và không job nào', async () => {
    const { EventsService, JobRunner } = await import('../../src/modules/platform');
    const ev = t.app.get(EventsService);
    const types = ['PaymentSucceeded', 'PaymentFailed', 'PaymentExpired', 'PaymentRefunded', 'StockReservationExpired', 'StockCommitFailed', 'ShipmentShipped', 'ShipmentTrackingChanged', 'ShipmentDelivered', 'ShipmentFailed', 'ShipmentReturned'];
    for (const type of types) expect(ev.consumersFor(type).map((s) => s.consumer)).toContain('order');
    expect(ev.consumersFor('OrderPaid').map((s) => s.consumer)).not.toContain('order'); // ORD không nhận event của chính mình
    const jobs = (t.app.get(JobRunner) as unknown as { jobs: Map<string, { module: string }> }).jobs;
    expect(jobs).toBeInstanceOf(Map);
    expect([...jobs.values()].filter((j) => j.module === 'order')).toEqual([]); // ORD không có job hết hạn (INV giữ đồng hồ duy nhất, ADR-009)
  });
});
