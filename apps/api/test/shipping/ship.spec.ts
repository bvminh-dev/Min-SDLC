import { spawn } from 'node:child_process';
import { OrderBusinessError } from '../../src/modules/order';
import { DomainError, EventsService, OutboxRelay, type SessionContext } from '../../src/modules/platform';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';
import { ORIGIN } from '../support/app';
import { http } from '../support/auth';
import { call, countOf, createShpApp, deliver, histOf, pgCode, q, race, seedOrderFor, seedShipment, shipVia, shipmentRow, shpAudits, shpOutbox, snapshotCounts, trackingOf, who, type ShpApp } from '../support/shp';

// Bàn giao vận đơn (SHP-REQ-20261006-101103855): chuẩn hóa mã, trùng mã, lockForHandoff trong giao dịch, đua, outbox, giới hạn tần suất.
const staffCtx = (id: string, role: 'staff' | 'admin' = 'staff'): SessionContext => ({ user_id: id, role, email_verified: true });

describe('SHP bàn giao vận đơn', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });

  it('SHP-TC-20261006-102133529 (T12): staff bàn giao vận đơn với mã viết thường, nhận mã chuẩn hóa, shipped_at do server đặt, đúng một event; admin bàn giao đơn COD; outbox lỗi thì vận đơn vẫn pending', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn'), a1 = await who(t, 'admin', 'a1@shop.vn');
    const v1 = await seedShipment(t, { status: 'pending' });
    const r = await shipVia(t, s1.cookie, v1.order.code, 'ghn12345678');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ order_code: v1.order.code, status: 'shipped', tracking_number: 'GHN12345678', version: 2 });
    expect(Math.abs(Date.parse(r.body.shipped_at) - t.clock.now().getTime())).toBeLessThan(2000);
    const row = await shipmentRow(t, v1.id);
    expect([row.status, row.tracking_number, row.version]).toEqual(['shipped', 'GHN12345678', 2]);
    const h = await histOf(t, v1.id);
    expect(h.slice(-1)[0]).toMatchObject({ event: 'status_changed', status: 'shipped', tracking_number: 'GHN12345678' });
    expect(h).toHaveLength(2);
    const a = await shpAudits(t, v1.id, 'shipping.shipment.ship');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: s1.id, actor_role: 'staff', after: { status: 'shipped', tracking_number: 'GHN12345678' }, before: { status: 'pending', tracking_number: null } });
    const ev = await shpOutbox(t, v1.id);
    expect(ev.map((e) => e.type)).toEqual(['ShipmentShipped']);
    expect(ev[0].payload).toEqual({ shipment_id: v1.id, order_id: v1.order.id, tracking_number: 'GHN12345678' });
    // trường lạ `shipped_at` trong body bị 400; vận đơn khác không đổi
    const v0 = await seedShipment(t, { status: 'pending' });
    const bad = await shipVia(t, s1.cookie, v0.order.code, 'GHN12345679', { shipped_at: '2020-01-01T00:00:00Z' });
    expect([bad.status, bad.body.errors[0]]).toEqual([400, { field: 'shipped_at', code: 'unknown_field' }]);
    // admin bàn giao đơn COD đã confirmed
    const v2 = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', payment: 'cod', cod: 380000 });
    const r2 = await shipVia(t, a1.cookie, v2.order.code, 'VTP-998877-01');
    expect([r2.status, r2.body.tracking_number]).toEqual([200, 'VTP-998877-01']);
    expect((await shpOutbox(t, v2.id))[0].payload.tracking_number).toBe('VTP-998877-01');
    // lỗi ghi outbox: vận đơn vẫn pending, không lịch sử, audit, event; cờ bàn giao của đơn cũng rollback
    const v3 = await seedShipment(t, { status: 'pending' });
    const before = await snapshotCounts(t);
    jest.spyOn(t.app.get(EventsService), 'publish').mockRejectedValueOnce(new Error('outbox lỗi'));
    const fail = await shipVia(t, s1.cookie, v3.order.code, 'GHN00000003');
    expect(fail.status).toBe(500);
    expect((await shipmentRow(t, v3.id)).status).toBe('pending');
    expect(await snapshotCounts(t)).toEqual(before);
    expect((await q<{ handoff_locked_at: Date | null }>(t, `SELECT handoff_locked_at FROM orders WHERE id = '${v3.order.id}'`))[0].handoff_locked_at).toBeNull();
  });

  it('SHP-TC-20261006-102133553 (SB-05, T3): customer (kể cả chủ đơn) và guest không bàn giao, giao xong, báo thất bại, hoàn hàng, sửa mã hay xem danh sách vận đơn; không đổi gì', async () => {
    const owner = await who(t, 'customer', 'c1@x.vn');
    const v = await seedShipment(t, { status: 'pending', user: owner.id });
    const before = await snapshotCounts(t);
    const all = (cookie?: string) => Promise.all([
      shipVia(t, cookie, v.order.code, 'GHN12345678'),
      call(t, 'post', `/shipping/orders/${v.order.code}/shipment/deliver`, { cookie, body: {} }),
      call(t, 'post', `/shipping/orders/${v.order.code}/shipment/fail`, { cookie, body: { reason_code: 'other' } }),
      call(t, 'post', `/shipping/orders/${v.order.code}/shipment/return`, { cookie, body: {} }),
      call(t, 'patch', `/shipping/orders/${v.order.code}/shipment/tracking-number`, { cookie, body: { tracking_number: 'GHN12345678', version: 1 } }),
      call(t, 'get', '/shipping/shipments', { cookie }),
    ]);
    expect((await all(undefined)).map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect((await all(owner.cookie)).map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]); // chủ đơn không có quyền thao tác vận đơn: 403, không phải 404
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.tracking_number, await snapshotCounts(t)]).toEqual(['pending', null, before]);
  });

  it('SHP-TC-20261006-102133578 (SB-13, T15): yêu cầu bàn giao từ trang khác nguồn hoặc không có Origin bị chặn bởi CSRF (403); đúng Origin thì 200; preflight từ nguồn lạ không có Access-Control-Allow-Origin', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'pending' });
    const post = (origin: string | null) => call(t, 'post', `/shipping/orders/${v.order.code}/shipment/ship`, { cookie: s1.cookie, origin, body: { tracking_number: 'GHN12345678' } });
    for (const origin of ['https://evil.example', null]) { const r = await post(origin); expect([origin, r.status]).toEqual([origin, 403]); }
    expect((await shipmentRow(t, v.id)).status).toBe('pending');
    expect((await post(ORIGIN)).status).toBe(200);
    // PATCH (sửa mã) và quản trị phương thức cùng một bộ lọc nền
    const evil = (method: 'patch' | 'post', path: string, body: unknown) => call(t, method, path, { cookie: s1.cookie, origin: 'https://evil.example', body });
    expect((await evil('patch', `/shipping/orders/${v.order.code}/shipment/tracking-number`, { tracking_number: 'GHN87654321', version: 2 })).status).toBe(403);
    expect((await evil('post', '/admin/shipping/methods', { name: 'Giao nhanh', base_fee: 1 })).status).toBe(403);
    expect((await q<{ tracking_number: string }>(t, `SELECT tracking_number FROM shipments WHERE id = '${v.id}'`))[0].tracking_number).toBe('GHN12345678');
    const pre = await http(t).options(`/api/v1/shipping/orders/${v.order.code}/shipment/ship`).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('SHP-TC-20261006-102133602 (SB-11, T8, T21): mã vận đơn sai định dạng hoặc trùng bị từ chối, không lộ vận đơn khác; CSDL chặn mã trùng và mã sai định dạng', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v1 = await seedShipment(t, { status: 'pending' }), v2 = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678' });
    for (const bad of ['', 'ABC', 'GHN 123 456', 'GHN_123456', 'GHN12345678!']) {
      const r = await shipVia(t, s1.cookie, v1.order.code, bad);
      expect([bad, r.status, r.body.type]).toEqual([bad, 400, 'urn:ecom:error:validation-failed']);
    }
    const extra = await shipVia(t, s1.cookie, v1.order.code, 'GHN00000001', { status: 'shipped' });
    expect(extra.status).toBe(400);
    expect((await shipVia(t, s1.cookie, v1.order.code, 12345678)).status).toBe(400); // không phải chuỗi
    expect((await shipVia(t, s1.cookie, v1.order.code, 'GHN\u000012345')).status).toBe(400); // NUL: 400, không phải 500
    expect((await shipVia(t, s1.cookie, v1.order.code, 'ghnſ2345678')).status).toBe(400); // ſ (long s) đổi chữ hoa thành S: kiểm khuôn TRƯỚC khi đổi
    const dup = await shipVia(t, s1.cookie, v1.order.code, 'ghn12345678');
    expect([dup.status, dup.body.type]).toEqual([409, 'urn:ecom:error:tracking-number-taken']);
    expect(Object.keys(dup.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
    expect(JSON.stringify(dup.body)).not.toMatch(/GHN12345678|ghn12345678|shipments|ERROR/);
    expect(JSON.stringify(dup.body)).not.toContain(v2.order.code);
    expect(JSON.stringify(dup.body)).not.toContain(v2.id);
    const row = await shipmentRow(t, v1.id);
    expect([row.status, row.tracking_number]).toEqual(['pending', null]);
    expect(await pgCode(q(t, `UPDATE shipments SET tracking_number = 'GHN12345678', status = 'shipped', shipped_at = now() WHERE id = '${v1.id}'`))).toBe('23505');
    expect(await pgCode(q(t, `UPDATE shipments SET tracking_number = 'abc', status = 'shipped', shipped_at = now() WHERE id = '${v1.id}'`))).toBe('23514');
    expect(await pgCode(q(t, `UPDATE shipments SET tracking_number = 'GHN99999999' WHERE id = '${v1.id}'`))).toBe('23514'); // pending không được có mã (CHECK trạng thái và mã)
  });

  it('SHP-TC-20261006-102133626 (SB-24, T20, R-04): lockForHandoff chạy trong giao dịch bàn giao sau khi khóa vận đơn và trước khi ghi shipped; đơn đã hủy hoặc hết hạn thì 409 order-not-shippable và vận đơn giữ pending; đã bàn giao thì khách hủy bị ORD từ chối', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    // thứ tự gọi: vận đơn đã bị khóa (dòng khác không khóa được), trong cùng tx vận đơn còn pending, sau lời gọi mới ghi shipped
    const v = await seedShipment(t, { status: 'pending' });
    const real = t.ord.lockForHandoff.bind(t.ord);
    const seen: unknown[] = [];
    jest.spyOn(t.ord, 'lockForHandoff').mockImplementation(async (id, tx) => {
      seen.push(await pgCode(t.prisma.$queryRaw`SELECT 1 FROM shipments WHERE id = ${v.id}::uuid FOR UPDATE NOWAIT`)); // một kết nối khác không khóa được: vận đơn đang bị giữ khóa
      seen.push((await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM shipments WHERE id = ${v.id}::uuid`)[0].status); // UPDATE chưa chạy
      const out = await real(id, tx);
      seen.push((await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM shipments WHERE id = ${v.id}::uuid`)[0].status);
      return out;
    });
    expect((await shipVia(t, s1.cookie, v.order.code, 'GHN55667788')).status).toBe(200);
    expect(seen).toEqual(['55P03', 'pending', 'pending']);
    expect((await shipmentRow(t, v.id)).status).toBe('shipped');
    jest.restoreAllMocks();
    // đơn đã hủy dù vận đơn còn pending (OrderCancelled chưa kịp tới)
    for (const orderStatus of ['cancelled', 'expired', 'pending', 'shipped'] as const) {
      const w = await seedShipment(t, { status: 'pending', orderStatus });
      const b = await snapshotCounts(t);
      const r = await shipVia(t, s1.cookie, w.order.code, trackingOf());
      expect([orderStatus, r.status, r.body.type]).toEqual([orderStatus, 409, 'urn:ecom:error:order-not-shippable']);
      const row = await shipmentRow(t, w.id);
      expect([row.status, row.tracking_number, row.version]).toEqual(['pending', null, 1]);
      expect((await snapshotCounts(t)).slice(1)).toEqual(b.slice(1)); // không lịch sử, audit hay event mới
      expect((await histOf(t, w.id)).map((h) => h.status)).toEqual(['pending']);
    }
    // ORD báo không có đơn (order_not_found) thì 404 not-found, vận đơn giữ pending
    const nf = await seedShipment(t, { status: 'pending' });
    jest.spyOn(t.ord, 'lockForHandoff').mockRejectedValueOnce(new OrderBusinessError('order_not_found'));
    const gone = await shipVia(t, s1.cookie, nf.order.code, trackingOf());
    expect([gone.status, gone.body.type, (await shipmentRow(t, nf.id)).status]).toEqual([404, 'urn:ecom:error:not-found', 'pending']);
    jest.restoreAllMocks();
    // đơn paid đã bàn giao: cờ đã đặt, khách hủy bị ORD từ chối, không có OrderCancelled
    const owner = await who(t, 'customer', 'chu@x.vn');
    const p = await seedShipment(t, { status: 'pending', user: owner.id });
    expect((await shipVia(t, s1.cookie, p.order.code, 'GHN99887766')).status).toBe(200);
    const cancel = await call(t, 'post', `/orders/${p.order.code}/cancel`, { cookie: owner.cookie, body: {} });
    expect([cancel.status, cancel.body.type]).toEqual([409, 'urn:ecom:error:order-not-cancellable']);
    expect((await q<{ status: string }>(t, `SELECT status::text FROM orders WHERE id = '${p.order.id}'`))[0].status).toBe('paid');
    expect(await countOf(t, 'outbox_events', `type = 'OrderCancelled'`)).toBe(0);
    // hủy do hệ thống vẫn được; OrderCancelled đến sau bàn giao chỉ để lại log lệch
    await deliver(t, 'StockCommitFailed', { order_id: p.order.id, reason: 'reservation_expired' });
    expect((await q<{ status: string }>(t, `SELECT status::text FROM orders WHERE id = '${p.order.id}'`))[0].status).toBe('cancelled');
    t.logs.clear();
    await deliver(t, 'OrderCancelled', { order_id: p.order.id, order_code: p.order.code, user_id: owner.id, reason: 'stock_commit_failed', was_paid: true });
    expect((await shipmentRow(t, p.id)).status).toBe('shipped');
    expect(t.logs.records.filter((r) => r.code === 'shipment-order-cancelled-mismatch')).toHaveLength(1);
  });

  it('SHP-TC-20261006-102133650 (SB-24, T7): bàn giao vận đơn không còn pending bị 409 shipment-invalid-transition (mã cũ không bị ghi đè); đơn chưa có vận đơn hay mã sai định dạng cùng 404', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const sts = ['shipped', 'delivered', 'failed', 'cancelled'] as const;
    const ships = [];
    for (const status of sts) ships.push(await seedShipment(t, { status }));
    const before = await Promise.all(ships.map(async (s) => [await shipmentRow(t, s.id), (await histOf(t, s.id)).length] as const));
    for (const [i, s] of ships.entries()) {
      const r = await shipVia(t, s1.cookie, s.order.code, `GHN0000000${i + 1}`);
      expect([sts[i], r.status, r.body.type]).toEqual([sts[i], 409, 'urn:ecom:error:shipment-invalid-transition']);
      const row = await shipmentRow(t, s.id);
      expect([row.status, row.tracking_number, (await histOf(t, s.id)).length]).toEqual([before[i][0].status, before[i][0].tracking_number, before[i][1]]);
    }
    expect(await countOf(t, 'outbox_events', `type = 'ShipmentShipped'`)).toBe(0);
    const noShipment = await seedOrderFor(t, { status: 'paid' });
    const [a, b] = [await shipVia(t, s1.cookie, noShipment.code, 'GHN12345678'), await shipVia(t, s1.cookie, 'x!', 'GHN12345678')];
    expect([a.status, b.status]).toEqual([404, 404]);
    expect({ ...a.body, trace_id: 0 }).toEqual({ ...b.body, trace_id: 0 });
  });

  it('SHP-TC-20261006-102133675: giá trị biên độ dài mã vận đơn (8 và 30 hợp lệ, 7 và 31 bị 400) và chuẩn hóa khoảng trắng, chữ hoa', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const cases: [string, number, string | null][] = [['AB-12345', 200, 'AB-12345'], [`${'A1-'.repeat(10)}`, 200, 'A1-'.repeat(10)], ['AB-1234', 400, null], [`${'A1-'.repeat(10)}X`, 400, null], ['  ghn-99887766  ', 200, 'GHN-99887766'], ['--------', 200, '--------']];
    for (const [input, status, norm] of cases) {
      const v = await seedShipment(t, { status: 'pending' });
      const r = await shipVia(t, s1.cookie, v.order.code, input);
      expect([input.length, r.status, r.body.tracking_number ?? null]).toEqual([input.length, status, norm]);
      if (status === 400) expect((await shipmentRow(t, v.id)).status).toBe('pending');
    }
  });

  it('SHP-TC-20261006-102133699 (SB-24, T7, T8): hai nhân viên bàn giao song song chỉ một thành công (100 vòng); mã trùng giữa hai vận đơn bị chặn ở CSDL, vận đơn thua vẫn pending và không để lại cờ bàn giao', async () => {
    const [s1, s2] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'staff', 's2@shop.vn')];
    const owner = await who(t, 'customer', 'chu@x.vn');
    const ship = (s: { id: string }, code: string, tr: string) => t.ships.ship(staffCtx(s.id), code, { tracking_number: tr }).then(() => 'ok', (e) => (e as DomainError).code ?? String(e));
    for (let i = 0; i < 100; i++) {
      const v = await seedShipment(t, { status: 'pending', user: owner.id });
      const [x, y] = [`GHN${String(i).padStart(4, '0')}0001`, `GHN${String(i).padStart(4, '0')}0002`];
      const res = await race(() => ship(s1, v.order.code, x), () => ship(s2, v.order.code, y));
      expect(res.slice().sort()).toEqual(['ok', 'shipment-invalid-transition']);
      const row = await shipmentRow(t, v.id);
      expect(row.tracking_number).toBe(res[0] === 'ok' ? x : y);
      expect([(await shpOutbox(t, v.id)).length, (await histOf(t, v.id)).filter((h) => h.status === 'shipped').length]).toEqual([1, 1]);
    }
    const [v2, v3] = [await seedShipment(t, { status: 'pending', user: owner.id }), await seedShipment(t, { status: 'pending', user: owner.id })];
    const res = await race(() => ship(s1, v2.order.code, 'GHN33330003'), () => ship(s2, v3.order.code, 'GHN33330003'));
    expect(res.slice().sort()).toEqual(['ok', 'tracking-number-taken']);
    expect(await countOf(t, 'shipments', `tracking_number = 'GHN33330003'`)).toBe(1);
    const loser = res[0] === 'ok' ? v3 : v2;
    expect((await shipmentRow(t, loser.id)).status).toBe('pending');
    expect((await q<{ handoff_locked_at: Date | null }>(t, `SELECT handoff_locked_at FROM orders WHERE id = '${loser.order.id}'`))[0].handoff_locked_at).toBeNull(); // rollback cả cờ bàn giao
  }, 180_000);

  it('SHP-TC-20261006-110000001 (SB-27, T19): tiến trình bị SIGKILL ngay sau commit thì event vẫn nằm trong outbox và được giao sau khởi động lại; giao lại cùng event_id chỉ đổi đơn một lần; lỗi ghi outbox thì không có chuyển nào', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'pending' });
    const child = (args: string[]) => new Promise<{ code: number | null; signal: string | null; out: string }>((res) => {
      const c = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/shp-then-die.ts', ...args], {
        cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('exit', (code, signal) => res({ code, signal, out }));
    });
    const died = await child(['ship', v.order.code, s1.id, 'GHN12345678']);
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect((await shipmentRow(t, v.id)).status).toBe('shipped'); // commit đã xong trước khi chết
    const rows = await shpOutbox(t, v.id);
    expect(rows.map((r) => [r.type, r.dispatched_at])).toEqual([['ShipmentShipped', null]]);
    const relay = t.app.get(OutboxRelay);
    const orderStatus = async () => (await q<{ status: string }>(t, `SELECT status::text FROM orders WHERE id = '${v.order.id}'`))[0].status;
    await relay.runOnce(new Date(Date.now() + 1000)); // khởi động lại: relay chạy; consumer ORD thật chuyển đơn sang shipped
    expect(await orderStatus()).toBe('shipped');
    expect((await shpOutbox(t, v.id))[0].dispatched_at).not.toBeNull();
    const histRows = await countOf(t, 'order_status_history', `order_id = '${v.order.id}' AND to_status = 'shipped'`);
    // chết sau khi giao mà trước khi đánh dấu dispatched_at: giao lại cùng event_id
    await t.prisma.$executeRaw`UPDATE outbox_events SET dispatched_at = NULL, next_attempt_at = now() WHERE id = ${rows[0].id}::uuid`;
    await relay.runOnce(new Date(Date.now() + 5000));
    expect(await countOf(t, 'order_status_history', `order_id = '${v.order.id}' AND to_status = 'shipped'`)).toBe(histRows); // consumer chống trùng theo event_id: đơn chỉ đổi một lần
    // không vận đơn nào ở shipped trở đi mà thiếu event outbox tương ứng
    const missing = await q(t, `SELECT s.id FROM shipments s LEFT JOIN outbox_events o ON o.aggregate_id = s.id::text WHERE s.status IN ('shipped', 'delivered', 'failed', 'returned') AND o.id IS NULL`);
    expect(missing).toEqual([]);
    // lỗi ghi outbox khi deliver: 500, vận đơn vẫn shipped, không lịch sử, audit hay outbox mới
    const w = await seedShipment(t, { status: 'shipped' });
    const before = await snapshotCounts(t);
    jest.spyOn(t.app.get(EventsService), 'publish').mockRejectedValueOnce(new Error('outbox lỗi'));
    const r = await call(t, 'post', `/shipping/orders/${w.order.code}/shipment/deliver`, { cookie: s1.cookie, body: {} });
    expect(r.status).toBe(500);
    expect((await shipmentRow(t, w.id)).status).toBe('shipped');
    expect(await snapshotCounts(t)).toEqual(before);
  }, 120_000);

  it('SHP-TC-20261006-130000001 (SB-14 bậc D, T25, T16): thao tác bàn giao của staff bị giới hạn 30 yêu cầu mỗi phút mỗi người; 429 không chạm CSDL nghiệp vụ; bộ đếm theo từng người và nằm ở PostgreSQL nên đúng giữa hai instance', async () => {
    const [s1, s2] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'staff', 's2@shop.vn')];
    const owner = await who(t, 'customer', 'chu@x.vn');
    const vs = [];
    for (let i = 0; i < 31; i++) vs.push(await seedShipment(t, { status: 'pending', user: owner.id }));
    t.clock.set(new Date(Math.floor(t.clock.now().getTime() / 60_000) * 60_000 + 1000)); // đầu cửa sổ một phút: 31 yêu cầu nằm trọn một cửa sổ
    const codes: number[] = [];
    for (let i = 0; i < 30; i++) codes.push((await shipVia(t, s1.cookie, vs[i].order.code, `GHN${String(i + 1).padStart(8, '0')}`)).status);
    expect(codes.every((c) => c === 200)).toBe(true);
    const before = await snapshotCounts(t);
    const limited = await shipVia(t, s1.cookie, vs[30].order.code, 'GHN00000031');
    expect([limited.status, limited.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await shipmentRow(t, vs[30].id)).status).toBe('pending');
    expect(await snapshotCounts(t)).toEqual(before); // không lịch sử, audit hay event của V31
    expect((await shipVia(t, s2.cookie, vs[30].order.code, 'GHN00000031')).status).toBe(200); // bộ đếm theo từng người
    // instance thứ hai dùng chung PostgreSQL
    const b = await createShpApp();
    try {
      b.clock.set(t.clock.now());
      const extra = await seedShipment(t, { status: 'pending', user: owner.id });
      const r = await shipVia(b, s1.cookie, extra.order.code, 'GHN00000099');
      expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    } finally { await b.close(); }
  }, 120_000);
});
