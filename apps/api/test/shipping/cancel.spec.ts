import { randomUUID } from 'node:crypto';
import type { SessionContext } from '../../src/modules/platform';
import { OutboxRelay, DomainError } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { countOf, createShpApp, deliver, histOf, pgCode, q, race, seedMethod, seedOrderFor, seedShipment, shipmentRow, shipmentsOfOrder, shpAudits, shpOutbox, snapshotCounts, trackingOf, who, type ShpApp } from '../support/shp';

// Hủy vận đơn theo OrderCancelled (SHP-REQ-20261006-101103950): pending sang cancelled, lệch thì giữ nguyên và log lỗi, đua với bàn giao qua lockForHandoff.
describe('SHP hủy vận đơn theo OrderCancelled', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const cancelled = (o: { id: string; code: string; user: string }, over: Record<string, unknown> = {}) => ({ order_id: o.id, order_code: o.code, user_id: o.user, reason: 'customer_request', was_paid: true, ...over });
  const shpLogs = () => t.logs.records.filter((r) => r.module === 'shipping');

  it('SHP-TC-20261006-102147270: OrderCancelled hủy vận đơn đang pending: cancelled, version +1, một dòng lịch sử, audit system, không event; log nêu mã đơn nhưng không user_id; được tạo vận đơn mới sau đó', async () => {
    const v = await seedShipment(t, { status: 'pending' });
    const eid = randomUUID();
    await deliver(t, 'OrderCancelled', cancelled(v.order), eid);
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.version]).toEqual(['cancelled', 2]);
    expect((await histOf(t, v.id)).map((h) => h.status)).toEqual(['pending', 'cancelled']);
    const a = await shpAudits(t, v.id, 'shipping.shipment.cancel');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: null, actor_role: 'system', reason: 'OrderCancelled', before: { status: 'pending' }, after: { status: 'cancelled' } });
    expect(await shpOutbox(t)).toEqual([]);
    expect(await countOf(t, 'processed_events', `consumer = 'shipping' AND event_id = '${eid}'`)).toBe(1);
    expect(t.logs.lines.join('\n')).not.toContain(v.order.user);
    expect(await pgCode(q(t, `INSERT INTO shipments (order_id, shipping_method_id) VALUES ('${v.order.id}', '${v.method}')`))).toBe('ok'); // dòng cũ đã cancelled nên unique một phần cho phép
    // vận đơn mới còn hiệu lực của cùng đơn là vận đơn được thao tác (không phải dòng cancelled cũ)
    const staff = await who(t, 'staff', 's1@shop.vn');
    const shipped = await t.ships.ship({ user_id: staff.id, role: 'staff', email_verified: true }, v.order.code, { tracking_number: 'GHN12345678' });
    expect([shipped.status, (await shipmentsOfOrder(t, v.order.id)).map((x) => x.status).sort()]).toEqual(['shipped', ['cancelled', 'shipped']]);
  });

  it('SHP-TC-20261006-102147299 (SB-18, T20, T22): OrderCancelled lệch đến khi vận đơn đã shipped hoặc delivered thì giữ nguyên và chỉ log error (mã đơn, trạng thái, mã lỗi, correlation_id), không rò rỉ user_id hay lý do; order_id lạ chỉ log', async () => {
    const v = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678' });
    const counts = await snapshotCounts(t);
    await deliver(t, 'OrderCancelled', cancelled(v.order, { user_id: 'u-0901234567', reason: 'customer_request' }));
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.version]).toEqual(['shipped', 2]);
    expect((await snapshotCounts(t)).slice(0, 5)).toEqual(counts.slice(0, 5)); // không lịch sử hay audit mới (chỉ processed_events tăng)
    const errs = shpLogs().filter((r) => r.level === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ code: 'shipment-order-cancelled-mismatch', order_code: v.order.code, status: 'shipped', correlation_id: 'test-corr' });
    expect(t.logs.lines.join('\n')).not.toMatch(/0901234567|customer_request|u-0901/);
    const d = await seedShipment(t, { status: 'delivered' });
    t.logs.clear();
    await deliver(t, 'OrderCancelled', cancelled(d.order));
    expect((await shipmentRow(t, d.id)).status).toBe('delivered');
    expect(shpLogs().filter((r) => r.level === 'error')).toHaveLength(1);
    t.logs.clear();
    await deliver(t, 'OrderCancelled', cancelled({ id: randomUUID(), code: 'ZZZZZZZZZZZZ', user: randomUUID() })); // order_id lạ
    expect(shpLogs().filter((r) => r.level === 'error')).toEqual([]);
    expect(shpLogs().some((r) => r.code === 'shipment-none')).toBe(true);
  });

  it('SHP-TC-20261006-102147325 (SB-24, T7, T20, R-04): bàn giao và hủy đơn chạy song song chỉ một thắng (200 vòng, ORD thật): hủy thắng thì order-not-shippable và vận đơn rồi cancelled; bàn giao thắng thì ORD từ chối hủy, không OrderCancelled, không log lệch; mã trùng thì rollback cả cờ bàn giao', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const owner = await who(t, 'customer', 'chu@x.vn');
    const staff: SessionContext = { user_id: s1.id, role: 'staff', email_verified: true };
    const cust: SessionContext = { user_id: owner.id, role: 'customer', email_verified: true };
    const m = await seedMethod(t);
    let cancelWon = 0, shipWon = 0;
    const rounds: { v: Awaited<ReturnType<typeof seedShipment>>; tracking: string; ship: string; cancel: string }[] = [];
    for (let i = 0; i < 200; i++) {
      const v = await seedShipment(t, { status: 'pending', user: owner.id, method: m });
      const tracking = trackingOf();
      const [ship, cancel] = await race(
        () => t.ships.ship(staff, v.order.code, { tracking_number: tracking }).then(() => 'ok', (e) => (e as DomainError).code),
        () => t.cancels.cancel(cust, v.order.code, undefined).then(() => 'ok', (e) => (e as DomainError).code),
      );
      rounds.push({ v, tracking, ship, cancel });
    }
    for (const { v, ship, cancel } of rounds) {
      const sh = await shipmentRow(t, v.id);
      const ord = (await q<{ status: string; handoff_locked_at: Date | null }>(t, `SELECT status::text, handoff_locked_at FROM orders WHERE id = '${v.order.id}'`))[0];
      expect(ord.status === 'cancelled' && ord.handoff_locked_at !== null).toBe(false); // không bao giờ vừa hủy vừa có cờ
      if (ship === 'ok') { // (b) bàn giao thắng
        shipWon++;
        expect([cancel, sh.status, ord.status]).toEqual(['order-not-cancellable', 'shipped', 'paid']);
        expect(await countOf(t, 'outbox_events', `type = 'OrderCancelled' AND aggregate_id = '${v.order.id}'`)).toBe(0);
      } else { // (a) hủy thắng
        cancelWon++;
        expect([ship, cancel, sh.status, sh.tracking_number, ord.status]).toEqual(['order-not-shippable', 'ok', 'pending', null, 'cancelled']);
        expect(await countOf(t, 'outbox_events', `type = 'OrderCancelled' AND aggregate_id = '${v.order.id}'`)).toBe(1);
      }
    }
    expect(cancelWon + shipWon).toBe(200);
    // OrderCancelled của các đơn hủy thắng đi qua relay tới SHP: vận đơn pending thành cancelled, không log lệch
    t.logs.clear();
    for (let i = 0; i < 10; i++) { if ((await t.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000 + i))).picked === 0) break; }
    for (const { v, ship } of rounds) if (ship !== 'ok') expect((await shipmentRow(t, v.id)).status).toBe('cancelled');
    expect(shpLogs().filter((r) => r.code === 'shipment-order-cancelled-mismatch')).toEqual([]);
    // mã trùng: bàn giao rollback cả cờ bàn giao nên khách vẫn hủy được
    await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678' });
    const v7 = await seedShipment(t, { status: 'pending', user: owner.id, method: m });
    await expect(t.ships.ship(staff, v7.order.code, { tracking_number: 'GHN12345678' })).rejects.toMatchObject({ code: 'tracking-number-taken' });
    expect((await q<{ handoff_locked_at: Date | null }>(t, `SELECT handoff_locked_at FROM orders WHERE id = '${v7.order.id}'`))[0].handoff_locked_at).toBeNull();
    await expect(t.cancels.cancel(cust, v7.order.code, undefined)).resolves.toMatchObject({ status: 'cancelled' });
    // vận đơn cancelled không được có mã (CHECK ở CSDL)
    expect(await pgCode(q(t, `UPDATE shipments SET tracking_number = 'GHN99999999' WHERE id = '${v7.id}'`))).toBe('23514');
  }, 240_000);

  it('SHP-TC-20261006-102147445: OrderCancelled cho đơn chưa có vận đơn hoặc nhận lại không tạo thay đổi thứ hai (version, lịch sử, audit không đổi)', async () => {
    const o3 = await seedOrderFor(t, { status: 'pending' });
    const before = await snapshotCounts(t);
    await deliver(t, 'OrderCancelled', cancelled(o3, { was_paid: false }));
    expect((await snapshotCounts(t)).slice(0, 5)).toEqual(before.slice(0, 5));
    expect(shpLogs().some((r) => r.level === 'info' && r.code === 'shipment-none')).toBe(true);
    const v = await seedShipment(t, { status: 'pending' });
    const eid = randomUUID();
    await deliver(t, 'OrderCancelled', cancelled(v.order), eid);
    const after = await snapshotCounts(t);
    await deliver(t, 'OrderCancelled', cancelled(v.order), eid); // relay giao lại đúng event
    expect(await snapshotCounts(t)).toEqual(after);
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.version, (await histOf(t, v.id)).filter((h) => h.status === 'cancelled').length, (await shpAudits(t, v.id, 'shipping.shipment.cancel')).length]).toEqual(['cancelled', 2, 1, 1]);
    await deliver(t, 'OrderCancelled', cancelled(v.order)); // event khác nhưng vận đơn đã cancelled: no-op
    expect([(await shipmentRow(t, v.id)).version, (await histOf(t, v.id)).length]).toEqual([2, 2]);
  });

  it('SHP-TC-20261006-120000001: OrderCancelled do hệ thống (stock_commit_failed) hủy vận đơn pending của đơn đã thanh toán; giao lại cùng event_id không thêm gì; vận đơn đã shipped do dữ liệu lệch giữ nguyên và log error', async () => {
    const v = await seedShipment(t, { status: 'pending' });
    const e1 = randomUUID();
    await deliver(t, 'OrderCancelled', cancelled(v.order, { reason: 'stock_commit_failed', was_paid: true }), e1);
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.version]).toEqual(['cancelled', 2]);
    expect((await histOf(t, v.id)).filter((h) => h.status === 'cancelled')).toHaveLength(1);
    const a = await shpAudits(t, v.id, 'shipping.shipment.cancel');
    expect([a.length, a[0].actor_role, a[0].actor_id]).toEqual([1, 'system', null]);
    expect(await countOf(t, 'processed_events', `consumer = 'shipping' AND event_id = '${e1}'`)).toBe(1);
    expect(await countOf(t, 'outbox_events')).toBe(0); // SHP không gọi hay phát gì cho INV, PAY, PRM
    await deliver(t, 'OrderCancelled', cancelled(v.order, { reason: 'stock_commit_failed' }), e1);
    expect([(await histOf(t, v.id)).filter((h) => h.status === 'cancelled').length, (await shpAudits(t, v.id, 'shipping.shipment.cancel')).length]).toEqual([1, 1]);
    const s = await seedShipment(t, { status: 'shipped' });
    t.logs.clear();
    await deliver(t, 'OrderCancelled', cancelled(s.order, { reason: 'stock_commit_failed' }));
    expect((await shipmentRow(t, s.id)).status).toBe('shipped');
    expect(shpLogs().filter((r) => r.code === 'shipment-order-cancelled-mismatch' && r.order_code === s.order.code)).toHaveLength(1);
  });
});
