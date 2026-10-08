import { randomUUID } from 'node:crypto';
import { EventsService, OutboxRelay, type EventEnvelope } from '../../src/modules/platform';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { call, countRows, createOrdApp, deliver, failingInsert, historyOf, orderOf, outboxOf, outTypes, auditsOf, people, race, seedOrder, who, type OrdApp } from '../support/ord';

// Chuyển trạng thái đơn theo event của PAY, INV, SHP (ORD-REQ-20261006-092320790): bảng chuyển hợp lệ duy nhất, khóa dòng, idempotent theo event_id, no-op có log, outbox cùng giao dịch.
describe('ORD chuyển trạng thái theo event', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const rejected = () => t.logs.records.filter((r) => r.level === 'warn' && r.code === 'transition-rejected');
  const events = async (id: string, type?: string) => (await outboxOf(t, id)).filter((e) => !type || e.type === type);
  const pay = (id: string, extra: Record<string, unknown> = {}) => ({ payment_id: randomUUID(), order_id: id, ...extra });
  const unchanged = async (o: { id: string }, status: string, rows: number) => {
    expect((await orderOf(t, o.id)).status).toBe(status);
    expect(await historyOf(t, o.id)).toHaveLength(rows);
  };
  const ADDR_B = { receiver: 'Trần Thị B', phone: '0912345678', line1: '45 Nguyễn Huệ', ward: 'Bến Thành', city: 'TP.HCM' };

  it('ORD-TC-20261006-111225234: PaymentSucceeded chuyển đơn online pending sang paid, ghi paid_at, một dòng lịch sử, một OrderPaid { order_id, paid_at } cùng giao dịch, ProcessedEvent (order, E1)', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', code: '7K3M9Q2XH4TB' });
    const before = await orderOf(t, o.id);
    const E1 = randomUUID(), paidAt = new Date(Date.now() - 5000);
    t.clock.advance(5000);
    await deliver(t, 'PaymentSucceeded', pay(o.id, { amount: 380000, method: 'vnpay', paid_at: paidAt.toISOString() }), E1);
    const after = await orderOf(t, o.id);
    expect([after.status, after.payment_status, after.paid_at?.toISOString()]).toEqual(['paid', 'succeeded', paidAt.toISOString()]);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect(await countRows(t, 'processed_events', `consumer = 'order' AND event_id = '${E1}'`)).toBe(1);
    const h = await historyOf(t, o.id);
    expect(h.map((x) => [x.to_status, x.reason])).toEqual([['pending', null], ['paid', null]]);
    expect(h[1]).toMatchObject({ from_status: 'pending', actor_id: null, actor_role: 'system' });
    const ev = await events(o.id, 'OrderPaid');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'order', aggregate_id: o.id, dispatched_at: null });
    expect(ev[0].payload).toEqual({ order_id: o.id, paid_at: after.paid_at!.toISOString() });
  });

  it('ORD-TC-20261006-111225263: ShipmentShipped chuyển đơn confirmed (COD) và paid (online) sang shipped kèm tracking_number; OrderShipped đúng payload; mỗi đơn một dòng lịch sử shipped', async () => {
    const { a } = await people(t);
    const [cod, online] = [await seedOrder(t, { user: a.id, code: '8M2N4P6R8S0T', status: 'confirmed', method: 'cod' }), await seedOrder(t, { user: a.id, code: '2H4J6K8M0N2P', status: 'paid' })];
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: cod.id, tracking_number: 'VN123456' });
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: online.id, tracking_number: 'GHN9876543' });
    expect([(await orderOf(t, cod.id)).status, (await orderOf(t, cod.id)).tracking_number, (await orderOf(t, online.id)).status, (await orderOf(t, online.id)).tracking_number]).toEqual(['shipped', 'VN123456', 'shipped', 'GHN9876543']);
    expect((await events(cod.id, 'OrderShipped'))[0].payload).toEqual({ order_id: cod.id, order_code: cod.code, user_id: a.id, tracking_number: 'VN123456' });
    expect((await events(online.id, 'OrderShipped'))[0].payload).toEqual({ order_id: online.id, order_code: online.code, user_id: a.id, tracking_number: 'GHN9876543' });
    for (const o of [cod, online]) expect((await historyOf(t, o.id)).filter((h) => h.to_status === 'shipped')).toHaveLength(1);
  });

  it('ORD-TC-20261006-111225291: ShipmentDelivered chuyển shipped sang delivered, delivered_at là giờ xử lý của ORD, payment_status COD vẫn pending, OrderDelivered một lần', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'shipped', method: 'cod', payment: 'pending', tracking: 'VN123456' });
    const at = new Date(Math.floor(Date.now() / 1000) * 1000 + 3600_000);
    t.clock.set(at);
    await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: o.id });
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'delivered', tracking_number: 'VN123456', payment_status: 'pending', delivered_at: at });
    expect((await historyOf(t, o.id)).at(-1)).toMatchObject({ to_status: 'delivered', created_at: at });
    expect((await events(o.id, 'OrderDelivered')).map((e) => e.payload)).toEqual([{ order_id: o.id, order_code: o.code, user_id: a.id, delivered_at: at.toISOString() }]);
  });

  it('ORD-TC-20261006-111225320: StockReservationExpired chuyển đơn online pending sang expired; payment_status và payment_expires_at giữ; một dòng lịch sử không reason; OrderExpired { order_id, order_code, user_id }, không OrderCancelled', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', code: '5C7D9F1G3H5J' });
    const before = await orderOf(t, o.id);
    await deliver(t, 'StockReservationExpired', { order_id: o.id });
    const after = await orderOf(t, o.id);
    expect([after.status, after.payment_status, after.payment_expires_at]).toEqual(['expired', 'pending', before.payment_expires_at]);
    expect((await historyOf(t, o.id)).at(-1)).toMatchObject({ from_status: 'pending', to_status: 'expired', reason: null, actor_role: 'system' });
    expect((await events(o.id)).map((e) => [e.type, e.payload])).toEqual([['OrderExpired', { order_id: o.id, order_code: '5C7D9F1G3H5J', user_id: a.id }]]);
  });

  it('ORD-TC-20261006-111225350: PaymentFailed chỉ hủy đơn pending khi is_final true (người hủy system, audit system); lần 1, 2 chỉ đổi payment_status sang failed; đơn paid nhận is_final bị từ chối có log', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', payment: 'processing', code: '6V8W0X2Y4Z6A' });
    for (const attempt of [1, 2]) {
      await deliver(t, 'PaymentFailed', pay(o.id, { order_code: o.code, user_id: a.id, reason: 'declined', attempt_no: attempt, is_final: false }));
      expect(await orderOf(t, o.id)).toMatchObject({ status: 'pending', payment_status: 'failed' });
      expect(await historyOf(t, o.id)).toHaveLength(1);
      expect(await events(o.id, 'OrderCancelled')).toHaveLength(0);
    }
    await deliver(t, 'PaymentFailed', pay(o.id, { order_code: o.code, user_id: a.id, reason: 'declined', attempt_no: 3, is_final: true }));
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'payment_failed', cancelled_by_role: 'system', payment_status: 'failed' });
    expect((await historyOf(t, o.id)).at(-1)).toMatchObject({ from_status: 'pending', to_status: 'cancelled', actor_id: null, actor_role: 'system', reason: 'payment_failed' });
    expect((await events(o.id, 'OrderCancelled')).map((e) => e.payload)).toEqual([{ order_id: o.id, order_code: o.code, user_id: a.id, reason: 'payment_failed', was_paid: false }]);
    expect((await auditsOf(t, o.id))).toMatchObject([{ actor_id: null, actor_role: 'system', before: { status: 'pending' }, after: { status: 'cancelled' } }]);
    const paid = await seedOrder(t, { user: a.id, status: 'paid' });
    t.logs.clear();
    await deliver(t, 'PaymentFailed', pay(paid.id, { is_final: true, attempt_no: 3 }));
    await unchanged(paid, 'paid', 2);
    expect(rejected().filter((r) => r.to === 'cancelled').map((r) => r.from)).toEqual(['paid']);
  });

  it('ORD-TC-20261006-111225410: PaymentRefunded và PaymentExpired chỉ đổi payment_status (không status, không lịch sử, không event); chuyển không hợp lệ (refund khi pending) bị từ chối có log', async () => {
    const { a } = await people(t);
    const [o1, o3, o6] = [await seedOrder(t, { user: a.id, status: 'cancelled', payment: 'succeeded' }), await seedOrder(t, { user: a.id, status: 'pending', payment: 'pending' }), await seedOrder(t, { user: a.id, status: 'pending', payment: 'pending' })];
    await deliver(t, 'PaymentRefunded', { payment_id: randomUUID(), order_id: o1.id });
    expect(await orderOf(t, o1.id)).toMatchObject({ payment_status: 'refunded', status: 'cancelled' });
    await deliver(t, 'PaymentExpired', { payment_id: randomUUID(), order_id: o3.id });
    expect(await orderOf(t, o3.id)).toMatchObject({ payment_status: 'expired', status: 'pending' });
    t.logs.clear();
    await deliver(t, 'PaymentRefunded', { payment_id: randomUUID(), order_id: o6.id });
    expect((await orderOf(t, o6.id)).payment_status).toBe('pending');
    expect(rejected()).toHaveLength(1);
    expect([(await historyOf(t, o1.id)).length, (await historyOf(t, o3.id)).length]).toEqual([2, 1]);
    for (const o of [o1, o3, o6]) expect(await events(o.id)).toEqual([]);
  });

  it('ORD-TC-20261006-111225438: ShipmentShipped đến trễ với đơn cancelled bị từ chối: vẫn cancelled, tracking NULL, lịch sử và outbox không đổi, đúng một log cảnh báo không lộ dữ liệu cá nhân hay lý do, handler không ném lỗi', async () => {
    const { b } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'cancelled', address: ADDR_B, cancel: { reason: 'customer_request', by: 'customer', text: 'đặt nhầm' } });
    t.logs.clear();
    await expect(deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.id, tracking_number: 'VN123456' })).resolves.toBeUndefined();
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', tracking_number: null });
    expect(await historyOf(t, o.id)).toHaveLength(2);
    expect(await events(o.id)).toEqual([]);
    const warns = t.logs.records.filter((r) => r.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ order_code: '8M2N4P6R8S0T', from: 'cancelled', to: 'shipped', code: 'transition-rejected', correlation_id: 'test-corr' });
    expect(t.logs.lines.join('\n')).not.toMatch(/Trần Thị B|0912345678|đặt nhầm/);
  });

  it('ORD-TC-20261006-111225467: PaymentSucceeded đến trễ với đơn cancelled vẫn cập nhật payment_status sang succeeded nhưng giữ cancelled, không OrderPaid, có log chuyển cancelled sang paid bị từ chối', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'cancelled', payment: 'cancelled', code: '9B1C3D5E7F9G' });
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: o.id, amount: 380000 });
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', payment_status: 'succeeded' });
    expect(await historyOf(t, o.id)).toHaveLength(2);
    expect(await events(o.id)).toEqual([]);
    expect(rejected().map((r) => [r.from, r.to])).toEqual([['cancelled', 'paid']]);
  });

  it('ORD-TC-20261006-111225552: đơn delivered không hủy được (409) và ShipmentShipped trễ, PaymentFailed is_final không đổi gì: vẫn delivered, 4 dòng lịch sử, không event, không audit', async () => {
    const { b } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'delivered', method: 'cod' });
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: b.cookie, body: {} })).status).toBe(409);
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.id, tracking_number: 'VN9' });
    await deliver(t, 'PaymentFailed', pay(o.id, { is_final: true, attempt_no: 3 }));
    await unchanged(o, 'delivered', 4);
    expect(await events(o.id)).toEqual([]);
    expect(await auditsOf(t, o.id)).toEqual([]);
  });

  it('ORD-TC-20261006-111225590: event của đơn không tồn tại (năm loại) bị bỏ qua có log mang tên event, order_id và correlation_id; không tạo đơn, không lịch sử, không event', async () => {
    const { a } = await people(t);
    for (let i = 0; i < 5; i++) await seedOrder(t, { user: a.id });
    const ghost = '00000000-0000-4000-8000-000000000000';
    t.logs.clear();
    const types: [string, Record<string, unknown>][] = [['PaymentSucceeded', {}], ['ShipmentShipped', { tracking_number: 'VN1' }], ['ShipmentDelivered', {}], ['StockReservationExpired', {}], ['PaymentFailed', { is_final: true, attempt_no: 3 }]];
    for (const [type, extra] of types) await expect(deliver(t, type, { order_id: ghost, payment_id: randomUUID(), shipment_id: randomUUID(), ...extra })).resolves.toBeUndefined();
    expect([await countRows(t, 'orders'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')]).toEqual([5, 5 * 2, 0]);
    const logs = t.logs.records.filter((r) => r.order_id === ghost);
    expect(logs.map((r) => r.event_type)).toEqual(types.map(([x]) => x));
    expect(logs.every((r) => r.correlation_id === 'test-corr')).toBe(true);
  });

  it('ORD-TC-20261006-111225649: nhận lại cùng event_id (một lần rồi năm lần song song) không đổi gì: một dòng paid, một OrderPaid, một ProcessedEvent; event trùng nghiệp vụ khác event_id bị chặn bởi trạng thái; ShipmentDelivered cũng vậy', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending' });
    const E1 = randomUUID(), body = pay(o.id, { amount: 380000, method: 'vnpay', paid_at: new Date().toISOString() });
    await deliver(t, 'PaymentSucceeded', body, E1);
    const first = await orderOf(t, o.id);
    await deliver(t, 'PaymentSucceeded', body, E1);
    await Promise.all(Array.from({ length: 5 }, () => deliver(t, 'PaymentSucceeded', body, E1)));
    expect((await historyOf(t, o.id)).filter((h) => h.to_status === 'paid')).toHaveLength(1);
    expect(await events(o.id, 'OrderPaid')).toHaveLength(1);
    expect(await countRows(t, 'processed_events', `consumer = 'order' AND event_id = '${E1}'`)).toBe(1);
    expect((await orderOf(t, o.id)).paid_at).toEqual(first.paid_at);
    t.logs.clear();
    await deliver(t, 'PaymentSucceeded', body); // cùng nội dung, event_id mới: lớp bảo vệ thứ hai là khóa dòng và điều kiện trạng thái
    expect(await events(o.id, 'OrderPaid')).toHaveLength(1);
    expect(rejected().filter((r) => r.msg === 'chuyển trạng thái bị từ chối').map((r) => [r.from, r.to])).toEqual([['paid', 'paid']]); // log của trạng thái đơn; payment_status cũng có log riêng
    const s = await seedOrder(t, { user: a.id, status: 'shipped' }), E2 = randomUUID();
    await Promise.all(Array.from({ length: 4 }, () => deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: s.id }, E2)));
    await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: s.id });
    expect(await events(s.id, 'OrderDelivered')).toHaveLength(1);
    expect((await historyOf(t, s.id)).filter((h) => h.to_status === 'delivered')).toHaveLength(1);
  });

  it('ORD-TC-20261006-111225678: hủy (HTTP của chủ đơn) và ShipmentShipped chạy song song trên 50 đơn COD confirmed: đúng một bên thắng mỗi đơn, không đơn nào có cả cancelled lẫn shipped, OrderCancelled cộng OrderShipped đúng một', async () => {
    const orders = [] as { id: string; code: string; cookie: string }[];
    for (let i = 0; i < 50; i++) { const u = await who(t, 'customer', `race${i}@x.vn`); orders.push({ ...(await seedOrder(t, { user: u.id, status: 'confirmed', method: 'cod' })), cookie: u.cookie }); }
    const results = await Promise.all(orders.map(async (o) => ({ o, ...(await (async () => { const [c] = await race(() => call(t, 'post', `/orders/${o.code}/cancel`, { cookie: o.cookie, body: {} }), () => deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.id, tracking_number: 'VN1' })); return { c }; })()) })));
    let cancelled = 0, shipped = 0;
    for (const { o, c } of results) {
      const h = (await historyOf(t, o.id)).map((x) => x.to_status), row = await orderOf(t, o.id);
      expect(h.includes('cancelled') && h.includes('shipped')).toBe(false);
      const types = (await outTypes(t, o.id)).filter((x) => x === 'OrderCancelled' || x === 'OrderShipped');
      expect(types).toHaveLength(1);
      expect(row.status).toBe(h.at(-1));
      if (c.status === 200) { cancelled++; expect(row.status).toBe('cancelled'); } else { shipped++; expect([c.status, row.status]).toEqual([409, 'shipped']); }
    }
    expect(cancelled + shipped).toBe(50);
  }, 120_000);

  it('ORD-TC-20261006-111225708: PaymentSucceeded của COD sau khi đã giao chỉ cập nhật payment_status và paid_at (đơn vẫn delivered, lịch sử 4 dòng, không event, không log từ chối)', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'delivered', method: 'cod', payment: 'pending' });
    const paidAt = new Date(Date.now() - 1000);
    t.logs.clear();
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: o.id, amount: 250000, method: 'cod', paid_at: paidAt.toISOString() });
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'delivered', payment_status: 'succeeded', paid_at: paidAt });
    expect(await historyOf(t, o.id)).toHaveLength(4);
    expect(await events(o.id)).toEqual([]);
    expect(rejected()).toEqual([]);
  });

  it('ORD-TC-20261006-111225737: lỗi khi ghi lịch sử rollback cả chuyển trạng thái (đơn pending, không OrderPaid, không ProcessedEvent, có log lỗi mã đơn và correlation_id); giao lại sau khi gỡ lỗi thì xử lý đúng', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', code: '7K3M9Q2XH4TB' });
    const E1 = randomUUID(), body = pay(o.id, { paid_at: new Date().toISOString() });
    t.logs.clear();
    await failingInsert(t, 'order_status_history', async () => { await expect(deliver(t, 'PaymentSucceeded', body, E1)).rejects.toThrow(); }, "NEW.to_status = 'paid'");
    expect((await orderOf(t, o.id)).status).toBe('pending');
    expect(await historyOf(t, o.id)).toHaveLength(1);
    expect(await events(o.id)).toEqual([]);
    expect(await countRows(t, 'processed_events', `event_id = '${E1}'`)).toBe(0);
    expect(t.logs.records.filter((r) => r.level === 'error')).toMatchObject([{ order_code: '7K3M9Q2XH4TB', event_type: 'PaymentSucceeded', correlation_id: 'test-corr' }]);
    await deliver(t, 'PaymentSucceeded', body, E1);
    expect((await orderOf(t, o.id)).status).toBe('paid');
    expect((await historyOf(t, o.id)).filter((h) => h.to_status === 'paid')).toHaveLength(1);
    expect(await events(o.id, 'OrderPaid')).toHaveLength(1);
  });

  it('ORD-TC-20261006-111225767: ShipmentFailed giữ đơn shipped và ghi đúng một dòng lịch sử shipped -> shipped mang mã lý do (không event, nhận lại cùng event_id không thêm); đơn cancelled hoặc delivered bị từ chối có log', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'shipped', method: 'cod', tracking: 'VN123456' });
    const E1 = randomUUID(), body = { shipment_id: randomUUID(), order_id: o.id, order_code: o.code, user_id: a.id, reason: 'customer_unreachable' };
    await deliver(t, 'ShipmentFailed', body, E1);
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'shipped', tracking_number: 'VN123456' });
    const h = await historyOf(t, o.id);
    expect(h).toHaveLength(4);
    expect(h.at(-1)).toMatchObject({ from_status: 'shipped', to_status: 'shipped', reason: 'customer_unreachable', actor_role: 'system' });
    expect(await events(o.id)).toEqual([]);
    await deliver(t, 'ShipmentFailed', body, E1);
    expect(await historyOf(t, o.id)).toHaveLength(4);
    const [c, d] = [await seedOrder(t, { user: a.id, status: 'cancelled' }), await seedOrder(t, { user: a.id, status: 'delivered' })];
    t.logs.clear();
    await deliver(t, 'ShipmentFailed', { ...body, order_id: c.id });
    await deliver(t, 'ShipmentFailed', { ...body, order_id: d.id });
    expect([(await historyOf(t, c.id)).length, (await historyOf(t, d.id)).length, rejected().length]).toEqual([2, 4, 2]);
    await deliver(t, 'ShipmentFailed', { ...body, order_id: o.id, reason: 'không-có-mã-này' }); // mã lạ: bỏ qua có log, đóng khi không chắc
    expect(await historyOf(t, o.id)).toHaveLength(4);
  });

  it('ORD-TC-20261006-111225795: StockReservationExpired với đơn đã paid bị từ chối: vẫn paid, lịch sử 2 dòng, không OrderExpired, có log từ chối paid sang expired', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'paid' });
    await deliver(t, 'StockReservationExpired', { order_id: o.id });
    await unchanged(o, 'paid', 2);
    expect(await events(o.id)).toEqual([]);
    expect(rejected().map((r) => [r.from, r.to])).toEqual([['paid', 'expired']]);
  });

  it('ORD-TC-20261006-120228419: ShipmentReturned chuyển shipped sang returned, ghi lịch sử, OrderReturned một lần; nhận lại, ShipmentShipped hay ShipmentDelivered trễ bị từ chối; khách hủy 409', async () => {
    const { b } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'shipped', method: 'cod', payment: 'pending', tracking: 'VN123456' });
    const E1 = randomUUID();
    await deliver(t, 'ShipmentReturned', { shipment_id: randomUUID(), order_id: o.id, restockable: true }, E1);
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'returned', tracking_number: 'VN123456', payment_status: 'pending' });
    expect((await historyOf(t, o.id)).at(-1)).toMatchObject({ from_status: 'shipped', to_status: 'returned', actor_role: 'system', reason: null });
    expect((await events(o.id)).map((e) => [e.type, e.payload])).toEqual([['OrderReturned', { order_id: o.id, order_code: '8M2N4P6R8S0T', user_id: b.id }]]);
    t.logs.clear();
    await deliver(t, 'ShipmentReturned', { shipment_id: randomUUID(), order_id: o.id, restockable: true }, E1);
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.id, tracking_number: 'VN2' });
    await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: o.id });
    expect(await historyOf(t, o.id)).toHaveLength(4);
    expect(await events(o.id, 'OrderReturned')).toHaveLength(1);
    expect(rejected().map((r) => r.to)).toEqual(['shipped', 'delivered']);
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: b.cookie, body: {} })).status).toBe(409);
  });

  it('ORD-TC-20261006-120228504: ShipmentTrackingChanged cập nhật tracking_number mà không đổi trạng thái, lịch sử hay phát event (kể cả đơn delivered); đơn cancelled bị CHECK chặn nên từ chối có log', async () => {
    const { a } = await people(t);
    const [s, d, c] = [await seedOrder(t, { user: a.id, status: 'shipped', code: '8M2N4P6R8S0T', tracking: 'VN123456' }), await seedOrder(t, { user: a.id, status: 'delivered', tracking: 'GHN9876543' }), await seedOrder(t, { user: a.id, status: 'cancelled' })];
    await deliver(t, 'ShipmentTrackingChanged', { shipment_id: randomUUID(), order_id: s.id, tracking_number: 'VN999' });
    expect(await orderOf(t, s.id)).toMatchObject({ status: 'shipped', tracking_number: 'VN999' });
    expect(await historyOf(t, s.id)).toHaveLength(3);
    expect(await events(s.id)).toEqual([]);
    expect((await call(t, 'get', `/orders/${s.code}`, { cookie: (await who(t, 'admin', 'admin@x.vn')).cookie })).body.tracking_number).toBe('VN999');
    await deliver(t, 'ShipmentTrackingChanged', { shipment_id: randomUUID(), order_id: d.id, tracking_number: 'GHN111' });
    expect(await orderOf(t, d.id)).toMatchObject({ status: 'delivered', tracking_number: 'GHN111' });
    t.logs.clear();
    await expect(deliver(t, 'ShipmentTrackingChanged', { shipment_id: randomUUID(), order_id: c.id, tracking_number: 'X1' })).resolves.toBeUndefined();
    expect((await orderOf(t, c.id)).tracking_number).toBeNull();
    expect(rejected()).toHaveLength(1);
  });

  it('ORD-TC-20261006-120228595: StockCommitFailed là no-op có log với đơn expired, cancelled, shipped, delivered (cả ba mã reason) và đơn không tồn tại: không đổi status, payment_status, tracking, lịch sử; không event', async () => {
    const { a } = await people(t);
    const [e, c, s, d] = [await seedOrder(t, { user: a.id, status: 'expired', code: '5C7D9F1G3H5J' }), await seedOrder(t, { user: a.id, status: 'cancelled', payment: 'cancelled' }), await seedOrder(t, { user: a.id, status: 'shipped' }), await seedOrder(t, { user: a.id, status: 'delivered' })];
    const snapshot = async () => JSON.stringify(await Promise.all([e, c, s, d].map(async (o) => [await orderOf(t, o.id), await historyOf(t, o.id)])));
    const before = await snapshot();
    t.logs.clear();
    const run: [typeof e, string][] = [[e, 'reservation_expired'], [c, 'reservation_released'], [s, 'reservation_expired'], [d, 'reservation_released'], [s, 'reservation_missing']];
    for (const [o, reason] of run) await deliver(t, 'StockCommitFailed', { order_id: o.id, reason });
    await expect(deliver(t, 'StockCommitFailed', { order_id: '00000000-0000-4000-8000-000000000000', reason: 'reservation_missing' })).resolves.toBeUndefined();
    expect(await snapshot()).toBe(before);
    for (const o of [e, c, s, d]) expect(await events(o.id)).toEqual([]);
    const info = t.logs.records.filter((r) => r.msg?.includes('no-op'));
    expect(info.map((r) => [r.order_code, r.reason])).toEqual(run.map(([o, r]) => [o.code, r]));
  });

  it('ORD-TC-20261006-120228687: event OrderPaid nằm trong outbox khi tiến trình dừng trước relay (dispatched_at NULL) và relay giao đúng nội dung với phong bì; consumer giao hai lần chỉ xử lý một lần; PaymentFailed lệch thứ tự bị từ chối; rollback sau khi ghi outbox không để lại dòng; YẾU: không giết tiến trình thật (chỉ không chạy relay)', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending' });
    const E1 = randomUUID(), body = pay(o.id, { paid_at: new Date().toISOString() });
    await deliver(t, 'PaymentSucceeded', body, E1);
    const pending = await events(o.id, 'OrderPaid');
    expect([pending.length, pending[0].dispatched_at]).toEqual([1, null]);
    const seen: EventEnvelope[] = [], events$ = t.app.get(EventsService);
    events$.subscribe('shp-sink', 'OrderPaid', async (_tx, env) => { seen.push(env); });
    const relay = t.app.get(OutboxRelay);
    await relay.runOnce(new Date(Date.now() + 10_000));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'OrderPaid', event_id: pending[0].id, aggregate_id: o.id, payload: { order_id: o.id } });
    expect(seen[0].occurred_at).toBeTruthy();
    expect(seen[0].correlation_id).toBeTruthy();
    const sub = events$.consumersFor('OrderPaid').find((s) => s.consumer === 'shp-sink')!;
    expect([await events$.deliver(sub, seen[0]), await events$.deliver(sub, seen[0])]).toEqual(['skipped', 'skipped']); // relay đã giao một lần; giao lại là no-op
    await deliver(t, 'PaymentSucceeded', body, E1);
    t.logs.clear();
    await deliver(t, 'PaymentFailed', pay(o.id, { is_final: false, attempt_no: 1, reason: 'declined' }));
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'paid', payment_status: 'succeeded' });
    expect((await historyOf(t, o.id)).filter((h) => h.to_status === 'paid')).toHaveLength(1);
    expect(await events(o.id, 'OrderPaid')).toHaveLength(1);
    expect(t.logs.records.filter((r) => r.code === 'transition-rejected')).toHaveLength(1);
    const p2 = await seedOrder(t, { user: a.id, status: 'paid' });
    await failingInsert(t, 'audit_logs', async () => { await expect(deliver(t, 'StockCommitFailed', { order_id: p2.id, reason: 'reservation_expired' })).rejects.toThrow(); });
    expect(await events(p2.id)).toEqual([]); // outbox đã ghi trong giao dịch rồi rollback cùng audit lỗi
    void q;
  });

  it('ORD-TC-20261006-140000100: StockCommitFailed hủy đơn paid do hệ thống (stock_commit_failed, was_paid true, audit system), payment_status giữ succeeded tới PaymentRefunded; lặp và mã khác không đổi gì; reservation_missing xử lý y như vậy; audit lỗi thì rollback', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'paid', code: '6B8D0F2H4K6M', items: [{ price: 420000, qty: 1 }], shipping: 30000 });
    const E1 = randomUUID();
    await deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_expired' }, E1);
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'stock_commit_failed', cancelled_by_role: 'system', payment_status: 'succeeded' });
    const h = await historyOf(t, o.id);
    expect(h).toHaveLength(3);
    expect(h.at(-1)).toMatchObject({ from_status: 'paid', to_status: 'cancelled', actor_role: 'system', reason: 'stock_commit_failed' });
    expect((await events(o.id, 'OrderCancelled')).map((e) => e.payload)).toEqual([{ order_id: o.id, order_code: '6B8D0F2H4K6M', user_id: a.id, reason: 'stock_commit_failed', was_paid: true }]);
    expect((await auditsOf(t, o.id))).toMatchObject([{ actor_role: 'system', before: { status: 'paid' }, after: { status: 'cancelled' } }]);
    await deliver(t, 'PaymentRefunded', { payment_id: randomUUID(), order_id: o.id });
    expect(await orderOf(t, o.id)).toMatchObject({ payment_status: 'refunded', status: 'cancelled' });
    await deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_expired' }, E1);
    await deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_released' });
    expect([(await historyOf(t, o.id)).length, (await events(o.id, 'OrderCancelled')).length, (await auditsOf(t, o.id)).length]).toEqual([3, 1, 1]);
    const o12 = await seedOrder(t, { user: a.id, status: 'paid' });
    await deliver(t, 'StockCommitFailed', { order_id: o12.id, reason: 'reservation_missing' });
    expect(await orderOf(t, o12.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'stock_commit_failed' });
    expect((await events(o12.id, 'OrderCancelled'))[0].payload.was_paid).toBe(true);
    const o11 = await seedOrder(t, { user: a.id, status: 'paid' }), E11 = randomUUID();
    await failingInsert(t, 'audit_logs', async () => { await expect(deliver(t, 'StockCommitFailed', { order_id: o11.id, reason: 'reservation_expired' }, E11)).rejects.toThrow(); });
    expect((await orderOf(t, o11.id)).status).toBe('paid');
    expect(await events(o11.id)).toEqual([]);
    await deliver(t, 'StockCommitFailed', { order_id: o11.id, reason: 'reservation_expired' }, E11); // giao lại khi audit hồi phục
    expect((await orderOf(t, o11.id)).status).toBe('cancelled');
  });

  it('ORD-TC-20261006-140000200: StockCommitFailed đến trước PaymentSucceeded hủy đơn pending do hệ thống (payment_status cancelled, was_paid false, audit system); PaymentSucceeded đến sau là no-op ở status (chỉ payment_status succeeded, không OrderPaid); audit lỗi thì rollback', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', payment: 'processing', code: '7C9E1G3J5L7N' });
    const E1 = randomUUID();
    await deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_expired' }, E1);
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'stock_commit_failed', cancelled_by_role: 'system', payment_status: 'cancelled' });
    expect((await historyOf(t, o.id)).map((h) => [h.from_status, h.to_status, h.actor_role, h.reason])).toEqual([[null, 'pending', 'customer', null], ['pending', 'cancelled', 'system', 'stock_commit_failed']]);
    expect((await events(o.id)).map((e) => [e.type, e.payload.was_paid])).toEqual([['OrderCancelled', false]]);
    expect((await auditsOf(t, o.id))).toMatchObject([{ actor_role: 'system', before: { status: 'pending' }, after: { status: 'cancelled' } }]);
    t.logs.clear();
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: o.id, paid_at: new Date().toISOString() });
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', payment_status: 'succeeded' });
    expect(await historyOf(t, o.id)).toHaveLength(2);
    expect((await events(o.id)).map((e) => e.type)).toEqual(['OrderCancelled']);
    expect(rejected()).toHaveLength(1);
    await deliver(t, 'PaymentRefunded', { payment_id: randomUUID(), order_id: o.id });
    await deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_expired' }, E1);
    expect([(await orderOf(t, o.id)).payment_status, (await historyOf(t, o.id)).length, (await auditsOf(t, o.id)).length]).toEqual(['refunded', 2, 1]);
    const o13 = await seedOrder(t, { user: a.id, status: 'pending' });
    await failingInsert(t, 'audit_logs', async () => { await expect(deliver(t, 'StockCommitFailed', { order_id: o13.id, reason: 'reservation_expired' })).rejects.toThrow(); });
    expect([(await orderOf(t, o13.id)).status, (await events(o13.id)).length]).toEqual(['pending', 0]);
  });
});
