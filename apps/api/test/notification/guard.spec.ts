import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import * as ntfIndex from '../../src/modules/notification';
import { EventsService, auditPermissions, auditRoutes, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { API_DIR, REPO_ROOT, truncateAll } from '../support/db';
import { createAuthApp, type AuthApp } from '../support/auth';
import { call, who } from '../support/prd';
import { CODE, OID, count, createNtfApp, mkUser, viaOutbox, type NtfApp } from '../support/ntf';
import { runScript } from '../support/sh';

// Kiểm quyền, ranh giới và hook consumer của NTF trên AppModule thật (NTF-SEC-20261006-103815605: T1, T6, T10; SB-05, SB-07, SB-35, SB-27).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const NTF_SCOPE = (id: string) => /\s\/api\/v1\/notifications(\/|$)/.test(id);
const SEC = 'NTF-SEC-20261006-103815605';
// Mười một hàng ma trận của NTF không có endpoint: tác nhân system tạo bản ghi từ event (cột system = Y); người nhận là role có `own`.
const INTERNAL = parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('NTF-REQ-') && r.system === 'Y').map((r) => r.action);
const opts = { scope: NTF_SCOPE, epic: 'NTF', exempt: INTERNAL };

describe('NTF kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`${SEC} T1, T6: danh sách route của NTF đúng 4 route của NTF-API; không có đường HTTP nào để tạo, sửa, xóa thông báo, nhận event, nhận bounce của SES hay đọc EmailDelivery`, async () => {
    expect(routeIds(t.app).filter(NTF_SCOPE).sort()).toEqual(['GET /api/v1/notifications', 'GET /api/v1/notifications/unread-count', 'POST /api/v1/notifications/:id/read', 'POST /api/v1/notifications/read-all'].sort());
    expect(routeIds(t.app).filter((id) => /\/(bounces?|complaints?|sns|ses|ntf|notification-events|email-deliveries|emails?)(\/|$)/i.test(id))).toEqual([]);
    const [c, staff, admin] = [await who(t, 'customer', 'c@shop.vn'), await who(t, 'staff', 's@shop.vn'), await who(t, 'admin', 'a@shop.vn')];
    const id = randomUUID();
    const attempts: [string, string, unknown][] = [
      ['post', '/notifications', { type: 'order_created', user_id: c.id, title: 't', body: 'b' }], ['put', `/notifications/${id}`, { title: 'x' }], ['patch', `/notifications/${id}`, { status: 'unread' }], ['delete', `/notifications/${id}`, {}],
      ['post', `/notifications/${id}/unread`, {}], ['delete', '/notifications', {}], ['post', '/notifications/events', { type: 'OrderShipped' }], ['post', '/notifications/email', { to: 'x@y.z' }], ['get', '/notifications/emails', undefined],
      ['post', '/notifications/ses/bounce', {}], ['post', '/notifications/sns', {}], ['get', `/notifications/${id}`, undefined], ['post', '/notifications/read-all/extra', {}], ['get', '/email-deliveries', undefined], ['get', '/notifications/email-deliveries', undefined],
    ];
    const before = [await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'outbox_events')];
    for (const cookie of [undefined, c.cookie, staff.cookie, admin.cookie]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie, body });
      expect([m, p, [401, 404, 405].includes(r.status)]).toEqual([m, p, true]);
    }
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'outbox_events')]).toEqual(before);
  });

  it(`${SEC} sale xem thông báo của chính mình như staff: 200 ở hai route đọc và hai route đánh dấu đã đọc, rỗng (không thấy của người khác)`, async () => {
    const [c, sale] = [await who(t, 'customer', 'c@shop.vn'), await who(t, 'sale', 'sl@shop.vn')];
    await t.prisma.$executeRaw`INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key) VALUES (${c.id}::uuid, 'order_created'::notification_type, 't', 'b', ${randomUUID()}::uuid, 'k1')`;
    const list = await call(t, 'get', '/notifications', { cookie: sale.cookie });
    expect([list.status, list.body.items]).toEqual([200, []]);
    expect(((await call(t, 'get', '/notifications/unread-count', { cookie: sale.cookie })).body)).toMatchObject({ unread_count: 0 });
    expect((await call(t, 'post', '/notifications/read-all', { cookie: sale.cookie, body: {} })).status).toBe(200);
    expect((await call(t, 'post', `/notifications/${randomUUID()}/read`, { cookie: sale.cookie, body: {} })).status).toBe(404); // không tồn tại hay của người khác: cùng 404
  });

  it(`${SEC} NTF-TC-20261006-104303290 T1, T10 (SB-05, SB-07): mọi route của NTF khai quyền, schema và @Action khớp ma trận (customer, staff, sale, admin đều own); AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng`, async () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('NTF-REQ-')).map((r) => r.action)).toHaveLength(15);
    expect(INTERNAL).toHaveLength(11);
    for (const r of parseMatrix(MATRIX).filter((x) => INTERNAL.includes(x.action))) expect([r.guest, r.system]).toEqual(['-', 'Y']);
    // hai loại cảnh báo nội bộ không có customer: ma trận ghi `-` ở cột customer
    for (const r of parseMatrix(MATRIX).filter((x) => /cảnh báo tồn thấp|cảnh báo hoàn tiền thất bại/.test(x.action))) expect(r.customer).toBe('-');
    // ma trận hẹp hơn code (customer bị bỏ khỏi xem lịch sử) và rộng hơn code (guest) đều bị báo
    const narrowed = MATRIX.replace(/^(\| Xem lịch sử thông báo của mình \(lọc đọc hoặc chưa đọc, theo loại\) \|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(narrowed).not.toBe(MATRIX);
    expect(auditPermissions(t.app, narrowed, opts).join('\n')).toContain('GET /api/v1/notifications: code cho [admin, customer, sale, staff] nhưng ma trận (Xem lịch sử thông báo của mình (lọc đọc hoặc chưa đọc, theo loại)) cho [admin, sale, staff]');
    // sale tự phục vụ GIỐNG HỆT staff: cột sale của mọi hàng endpoint NTF bằng cột staff, và bỏ sale khỏi ma trận thì bị báo
    for (const r of parseMatrix(MATRIX).filter((x) => /^NTF-REQ-/.test(x.requirement) && !INTERNAL.includes(x.action))) expect(r.sale).toBe(r.staff);
    const noSale = MATRIX.replace(/^(\| Xem số thông báo chưa đọc \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(noSale).not.toBe(MATRIX);
    expect(auditPermissions(t.app, noSale, opts).join('\n')).toContain('GET /api/v1/notifications/unread-count: code cho [admin, customer, sale, staff] nhưng ma trận (Xem số thông báo chưa đọc) cho [admin, customer, staff]');
    const guestRow = MATRIX.replace(/^(\| Xem số thông báo chưa đọc \|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(guestRow).not.toBe(MATRIX);
    expect(auditPermissions(t.app, guestRow, opts).join('\n')).toContain('ma trận cho guest (Xem số thông báo chưa đọc) nhưng code không khai @Public');
    expect(auditPermissions(t.app, MATRIX.replace('| Đánh dấu tất cả thông báo đã đọc |', '| Đánh dấu hết |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'NTF', exempt: INTERNAL }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(4);
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it(`${SEC}: NTF-API khai không có mã lỗi riêng: mọi mã DomainError trong mã NTF là mã nền; sổ mã lỗi sạch`, () => {
    expect(errorRegistry.audit()).toEqual([]);
    const spec = readFileSync(resolve(REPO_ROOT, 'spec/epics/NTF/design/NTF-API-20261006-103815515.md'), 'utf8');
    expect(spec).toContain('Không có mã lỗi riêng');
    const dir = resolve(API_DIR, 'src/modules/notification');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/(?:DomainError|registerProblem)\(\s*'([a-z0-9_-]+)'/g)) used.add(m[1]);
    const base = new Set(['validation-failed', 'unauthenticated', 'forbidden', 'csrf_failed', 'not-found', 'rate-limited', 'internal-error']);
    expect([...used].filter((c) => !base.has(c))).toEqual([]);
    expect(used.has('not-found')).toBe(true);
  });

  it(`${SEC} (SB-35): điểm vào công khai chỉ phơi NotificationModule; NTF chỉ import AUTH và platform qua điểm vào; không SELECT bảng của module khác; không phát event nào`, () => {
    expect(Object.keys(ntfIndex)).toEqual(['NotificationModule']);
    const arch = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
    expect(arch).toMatch(/\| NTF\s*\| notification \| AUTH\s*\|/);
    expect(arch).toMatch(/\| NTF \| AUTH \| `AuthApi\.getUserContact\(user_id\)`[^|]*`AuthApi\.listActiveUserIdsByRole\(roles, limit\)`[^|]*\| không \|/);
    const dir = resolve(API_DIR, 'src/modules/notification');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(resolve(dir, f), 'utf8');
      expect([f, /\b(FROM|JOIN|UPDATE|INTO)\s+"?(orders|order_items|order_status_history|users|payments|refunds|shipments|stock_|products|coupons|carts|sessions|processed_events|outbox_events)\b/i.test(src)]).toEqual([f, false]);
      expect([f, /events\.publish\(|publishAfterCommit\(/.test(src)]).toEqual([f, false]); // NTF không phát event (events.md)
      for (const m of src.matchAll(/from '(\.\.\/[^']+)'/g)) expect([f, m[1]]).toEqual([f, expect.stringMatching(/^\.\.\/(auth|platform)$/)]);
    }
    expect(runScript('scripts/check-boundaries.mjs', []).status).toBe(0); // chạy trên mã thật của repo
  });

  it(`${SEC} T6: events.md và handler khớp nhau: mọi event có NTF trong Consumers có đúng một consumer NTF (hai event token là raw, còn lại hai pha); event không khai NTF thì không có; OrderPaid không có`, () => {
    const md = readFileSync(resolve(REPO_ROOT, 'spec/domain/events.md'), 'utf8');
    const rows = md.split('\n').filter((l) => /^\| [A-Z][A-Za-z]+ \| /.test(l) && !l.startsWith('| Event |')).map((l) => l.split('|').map((c) => c.trim()));
    const events = rows.map((c) => ({ type: c[1], consumers: c[4].split(',').map((x) => x.trim()) }));
    expect(events.length).toBeGreaterThan(30);
    const wanted = events.filter((e) => e.consumers.includes('NTF')).map((e) => e.type).sort();
    expect(wanted).toHaveLength(18);
    const events2 = t.app.get(EventsService);
    const handled = events.filter((e) => events2.consumersFor(e.type).some((s) => s.consumer === 'NTF')).map((e) => e.type).sort();
    expect(handled).toEqual(wanted);
    for (const type of wanted) expect([type, events2.consumersFor(type).filter((s) => s.consumer === 'NTF')]).toEqual([type, [expect.anything()]]);
    expect(events2.consumersFor('OrderPaid').some((s) => s.consumer === 'NTF')).toBe(false);
    for (const type of ['EmailVerificationRequested', 'PasswordResetRequested']) expect(events2.consumersFor(type).find((s) => s.consumer === 'NTF')?.raw).toBeInstanceOf(Function);
    for (const type of wanted.filter((x) => !/Requested$/.test(x))) expect(events2.consumersFor(type).find((s) => s.consumer === 'NTF')?.prepared).toBeDefined();
  });
});

// Mọi event khai Consumer = NTF đi qua outbox của bên phát và relay thật tới handler: một dòng processed_events (NTF) và bản ghi đúng loại (NTF-REQ-20261006-103208460 BR1).
describe('NTF hook handler cho mọi event qua outbox (relay thật)', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });

  it('NTF-TC-20261006-104222533 NTF-TC-20261006-104222599 (SB-27): mười sáu event qua outbox + relay tạo đúng thông báo hay email của loại tương ứng; mỗi event một dòng processed_events NTF', async () => {
    const [c, s, a] = [await mkUser(t, { email: 'c@shop.vn' }), await mkUser(t, { role: 'staff' }), await mkUser(t, { role: 'admin' })];
    const base = { order_id: OID, order_code: CODE, user_id: c.id };
    const P = randomUUID(), R = randomUUID();
    const table: [string, Record<string, unknown>, string, string[]][] = [
      ['OrderCreated', { ...base, grand_total: 1000, payment_method: 'cod', payment_expires_at: null, items: [] }, 'order_created', [c.id]], ['OrderConfirmed', { ...base, confirmed_at: new Date().toISOString() }, 'order_confirmed', [c.id]],
      ['OrderCancelled', { ...base, reason: 'admin', was_paid: false }, 'order_cancelled', [c.id]], ['OrderExpired', base, 'order_expired', [c.id]], ['OrderShipped', { ...base, tracking_number: 'VTP12345678' }, 'order_shipped', [c.id]],
      ['OrderDelivered', { ...base, delivered_at: new Date().toISOString() }, 'order_delivered', [c.id]], ['OrderReturned', base, 'order_returned', [c.id]],
      ['PaymentSucceeded', { ...base, payment_id: P, amount: 5, method: 'vnpay', paid_at: new Date().toISOString() }, 'payment_succeeded', [c.id]],
      ['PaymentFailed', { ...base, payment_id: P, reason: 'declined', attempt_no: 1, is_final: false }, 'payment_failed', [c.id]],
      ['RefundSucceeded', { ...base, refund_id: R, payment_id: P, amount: 5, reason: 'order_cancelled' }, 'refund_succeeded', [c.id]], ['RefundFailed', { ...base, refund_id: R, payment_id: P, amount: 5, reason: 'order_cancelled', failure_reason: 'x' }, 'refund_failed', [a.id]],
      ['ShipmentFailed', { ...base, shipment_id: randomUUID(), reason: 'refused' }, 'shipment_failed', [c.id]], ['UserRegistered', { user_id: c.id, email: 'c@shop.vn' }, 'welcome', [c.id]], ['PasswordChanged', { user_id: c.id, changed_at: new Date().toISOString() }, 'password_changed', [c.id]],
      ['LowStockDetected', { product_id: randomUUID(), product_name: 'Áo', on_hand: 1, available: 1, threshold: 5 }, 'low_stock', [s.id, a.id].sort()],
    ];
    for (const [type, payload, note, owners] of table) {
      const eid = await viaOutbox(t, type, payload);
      const got = await t.prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM notifications WHERE type = ${note}::notification_type ORDER BY user_id`;
      expect([type, got.map((r) => r.user_id)]).toEqual([type, owners]);
      expect([type, await count(t, 'processed_events', `consumer = 'NTF' AND event_id = '${eid}'`)]).toEqual([type, 1]);
    }
    const eid = await viaOutbox(t, 'UserLocked', { user_id: c.id, reason: 'admin' }); // không có thông báo trong ứng dụng, chỉ email
    expect([await count(t, 'processed_events', `consumer = 'NTF' AND event_id = '${eid}'`), await count(t, 'email_deliveries', `type = 'account_locked'`)]).toEqual([1, 1]);
    expect(await count(t, 'processed_events', `consumer = 'NTF'`)).toBe(16);
    expect(t.logs.records.filter((r) => ['warn', 'error'].includes(r.level) && r.module === 'notification')).toEqual([]);
  });

  it('NTF-TC-20261006-104222599: NTF không nhận OrderPaid, ShipmentDelivered, ShipmentReturned, ShipmentTrackingChanged (không khai trong Consumers): relay không tạo gì', async () => {
    const c = await mkUser(t);
    for (const type of ['OrderPaid', 'ShipmentDelivered', 'ShipmentReturned', 'ShipmentTrackingChanged', 'UserUnlocked', 'CouponExpired']) await viaOutbox(t, type, { order_id: OID, order_code: CODE, user_id: c.id });
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events', `consumer = 'NTF'`)]).toEqual([0, 0, 0]);
  });
});
