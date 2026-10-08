import { randomUUID } from 'node:crypto';
import { EventsService, OutboxRelay, backoffMsOf } from './relay-helpers';
import { truncateAll } from '../support/db';
import { deliver, countOf, createShpApp, histOf, pgCode, q, race, seedMethod, seedOrderFor, seedShipment, shipmentsOfOrder, shpAudits, shpOutbox, type ShpApp } from '../support/shp';
import { failingInsert } from '../support/ord';

// Tạo vận đơn theo OrderPaid, OrderConfirmed (SHP-REQ-20261006-101103829): idempotent theo event_id và theo đơn, rollback nguyên giao dịch, relay giao lại khi ORD tạm thời không đọc được.
describe('SHP tạo vận đơn theo event của ORD', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); jest.restoreAllMocks(); });
  const paid = (order: { id: string }, eventId?: string) => deliver(t, 'OrderPaid', { order_id: order.id, paid_at: new Date().toISOString() }, eventId);

  it('SHP-TC-20261006-102133407: OrderPaid và OrderConfirmed tạo vận đơn pending kèm số tiền thu hộ (online 0, COD bằng tổng đơn), lịch sử, audit system, processed_events; không phát event', async () => {
    const [m1, m2] = [await seedMethod(t, { name: 'Giao tiêu chuẩn' }), await seedMethod(t, { name: 'Giao nhanh' })];
    const m = [m1, m2].sort()[1]; // phương thức có id lớn: nếu bỏ qua phương thức của đơn thì vận đơn lấy nhầm phương thức khác
    const o1 = await seedOrderFor(t, { status: 'paid', method: 'vnpay', shippingMethod: m });
    const o2 = await seedOrderFor(t, { status: 'confirmed', method: 'cod', shippingMethod: m });
    await paid(o1);
    await deliver(t, 'OrderConfirmed', { order_id: o2.id, order_code: o2.code, user_id: o2.user, confirmed_at: new Date().toISOString() });
    for (const [o, cod] of [[o1, '0'], [o2, '380000']] as const) {
      const rows = await shipmentsOfOrder(t, o.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'pending', tracking_number: null, cod_amount: cod, version: 1 });
      expect((await q<{ shipping_method_id: string }>(t, `SELECT shipping_method_id FROM shipments WHERE id = '${rows[0].id}'`))[0].shipping_method_id).toBe(m); // đúng phương thức của đơn
      const h = await histOf(t, rows[0].id);
      expect(h.map((x) => [x.event, x.status])).toEqual([['status_changed', 'pending']]);
      const a = await shpAudits(t, rows[0].id);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ actor_id: null, actor_role: 'system', action: 'shipping.shipment.create', reason: expect.stringMatching(/^Order(Paid|Confirmed)$/) });
    }
    expect(await countOf(t, 'processed_events', `consumer = 'shipping'`)).toBe(2);
    expect(await shpOutbox(t)).toEqual([]);
    expect(await countOf(t, 'outbox_events')).toBe(0); // SHP không phát event nào khi tạo
  });

  it('SHP-TC-20261006-102133431: không tạo vận đơn cho đơn đã hủy hoặc đơn không tồn tại; log nêu mã đơn và lý do, không dữ liệu cá nhân; handler không ném, event vẫn được đánh dấu đã xử lý', async () => {
    const m = await seedMethod(t);
    const o3 = await seedOrderFor(t, { status: 'cancelled', shippingMethod: m });
    const ghost = randomUUID();
    const noMethod = await seedOrderFor(t, { status: 'paid' }); // phương thức của đơn không có ở SHP (trái nền CHK)
    await paid(o3); await deliver(t, 'OrderPaid', { order_id: ghost, paid_at: new Date().toISOString() }); await paid(noMethod);
    expect(await countOf(t, 'shipments')).toBe(0);
    expect(t.logs.records.filter((r) => r.level === 'error' && r.code === 'shipping-method-missing' && r.order_code === noMethod.code)).toHaveLength(1);
    const lines = t.logs.records.filter((r) => r.module === 'shipping');
    expect(lines.filter((r) => r.code === 'order-not-shippable' && r.order_code === o3.code && ['info', 'warn'].includes(r.level))).toHaveLength(1);
    expect(lines.filter((r) => r.code === 'order-not-found' && r.order_id === ghost)).toHaveLength(1);
    expect(t.logs.lines.join('\n')).not.toMatch(/Lê Lợi|0901234567|Nguyễn Văn A/);
    expect(await countOf(t, 'processed_events', `consumer = 'shipping'`)).toBe(3); // relay không giao lại mãi
  });

  it('SHP-TC-20261006-102133455 (ADR-011, R-35): ORD tạm thời không đọc được thì relay giao lại cùng event_id (5 s rồi 10 s) và tạo đúng một vận đơn; hết 10 lượt thì dừng, không giao lần 11, đúng một log error', async () => {
    const m = await seedMethod(t);
    const events = t.app.get(EventsService), relay = t.app.get(OutboxRelay);
    const emit = async (o: { id: string }) => t.tx.run((tx) => events.publish(tx, { type: 'OrderPaid', aggregate_type: 'order', aggregate_id: o.id, payload: { order_id: o.id, paid_at: new Date().toISOString() } }));
    // ca 1: lỗi hai lần đầu
    const o4 = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
    const spy = jest.spyOn(t.ord, 'findForShipment').mockRejectedValueOnce(new Error('ORD tạm thời lỗi')).mockRejectedValueOnce(new Error('ORD tạm thời lỗi'));
    const id4 = await emit(o4);
    const T = new Date(Date.now() + 1000);
    expect(await relay.runOnce(T)).toMatchObject({ picked: 1, failed: 1 });
    expect(await countOf(t, 'shipments') + await countOf(t, 'processed_events', `event_id = '${id4}'`)).toBe(0); // lần lỗi không để lại vận đơn nửa vời hay processed_events
    expect(await relay.runOnce(new Date(T.getTime() + 4_000))).toMatchObject({ picked: 0 }); // chưa tới 5 giây
    expect(await relay.runOnce(new Date(T.getTime() + 5_000))).toMatchObject({ picked: 1, failed: 1 });
    expect(await relay.runOnce(new Date(T.getTime() + 5_000 + 9_000))).toMatchObject({ picked: 0 }); // 10 giây
    expect(await relay.runOnce(new Date(T.getTime() + 5_000 + 10_000))).toMatchObject({ picked: 1, dispatched: 1 });
    expect(spy).toHaveBeenCalledTimes(3);
    const rows = await shipmentsOfOrder(t, o4.id);
    expect(rows).toHaveLength(1);
    expect([(await histOf(t, rows[0].id)).length, await countOf(t, 'processed_events', `event_id = '${id4}'`)]).toEqual([1, 1]);
    // ca 2: ORD luôn lỗi
    const o5 = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
    spy.mockClear(); const always = spy.mockRejectedValue(new Error('ORD luôn lỗi')); // cùng một spy: đếm lại từ 0
    const id5 = await emit(o5);
    t.logs.clear();
    let now = new Date(T.getTime() + 100_000);
    const gaps: number[] = [];
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(await relay.runOnce(now)).toMatchObject({ picked: 1, failed: 1 });
      const [{ next, attempts }] = await q<{ next: Date; attempts: number }>(t, `SELECT next_attempt_at AS next, attempts FROM outbox_events WHERE id = '${id5}'`);
      expect(attempts).toBe(attempt);
      gaps.push((next.getTime() - now.getTime()) / 1000);
      now = next;
    }
    expect(gaps.slice(0, 9)).toEqual([5, 10, 20, 40, 80, 160, 320, 600, 600]); // 9 khoảng chờ giữa 10 lần giao
    expect(always).toHaveBeenCalledTimes(10);
    expect(await relay.runOnce(new Date(now.getTime() + 3_600_000))).toMatchObject({ picked: 0 }); // không giao lần 11
    expect(always).toHaveBeenCalledTimes(10);
    expect(await countOf(t, 'shipments', `order_id = '${o5.id}'`)).toBe(0);
    const errors = t.logs.records.filter((r) => r.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ event_id: id5, attempts: 10 });
    expect(errors[0].correlation_id).toBeTruthy();
    expect(await relay.stuckCount()).toBe(1);
    expect(backoffMsOf(1)).toBe(5000); // hằng của nền: 5 giây cho lần lỗi đầu
  }, 120_000);

  it('SHP-TC-20261006-102133480 (SB-24, T18): event OrderPaid lặp hoặc xử lý song song chỉ tạo một vận đơn (100 vòng); unique một phần trên order_id là chốt chặn ở CSDL', async () => {
    const m = await seedMethod(t);
    const o1 = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
    const eid = randomUUID();
    await paid(o1, eid); await paid(o1, eid);
    const [s1] = await shipmentsOfOrder(t, o1.id);
    expect([(await shipmentsOfOrder(t, o1.id)).length, (await histOf(t, s1.id)).length, (await shpAudits(t, s1.id)).length]).toEqual([1, 1, 1]);
    for (let round = 0; round < 50; round++) { // cùng một event_id xử lý song song (hai tiến trình)
      const o = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
      const e = randomUUID();
      const res = await Promise.allSettled([race(() => paid(o, e), () => paid(o, e))]);
      expect(res[0].status).toBe('fulfilled');
      const rows = await shipmentsOfOrder(t, o.id);
      expect([rows.length, (await histOf(t, rows[0].id)).length]).toEqual([1, 1]);
    }
    for (let round = 0; round < 50; round++) { // hai event KHÁC NHAU cùng đơn (OrderPaid và OrderConfirmed): unique order_id chặn
      const o = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
      const res = await race(() => paid(o).then(() => 'ok', (e) => String(e)), () => deliver(t, 'OrderConfirmed', { order_id: o.id }).then(() => 'ok', (e) => String(e)));
      expect(res).toEqual(['ok', 'ok']);
      const rows = await shipmentsOfOrder(t, o.id);
      expect([rows.length, (await histOf(t, rows[0].id)).length]).toEqual([1, 1]);
    }
    expect(await pgCode(q(t, `INSERT INTO shipments (order_id, shipping_method_id) VALUES ('${o1.id}', '${m}')`))).toBe('23505'); // chèn thẳng dòng thứ hai bị CSDL từ chối
    await t.prisma.$executeRaw`UPDATE shipments SET status = 'cancelled'::shipment_status WHERE id = ${s1.id}::uuid`;
    expect(await pgCode(q(t, `INSERT INTO shipments (order_id, shipping_method_id) VALUES ('${o1.id}', '${m}')`))).toBe('ok'); // vận đơn cũ đã cancelled thì được tạo mới
  }, 120_000);

  it('SHP-TC-20261006-102133505: lỗi giữa chừng khi tạo vận đơn thì vận đơn, lịch sử, audit và processed_events cùng rollback; thử lại có đúng một vận đơn đủ lịch sử', async () => {
    const m = await seedMethod(t);
    const o6 = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
    const eid = randomUUID();
    await expect(failingInsert(t, 'shipment_status_history', () => paid(o6, eid))).rejects.toThrow();
    expect(await countOf(t, 'shipments', `order_id = '${o6.id}'`)).toBe(0);
    expect([await countOf(t, 'shipment_status_history'), await countOf(t, 'audit_logs'), await countOf(t, 'processed_events', `consumer = 'shipping'`)]).toEqual([0, 0, 0]);
    await paid(o6, eid); // cùng event_id: lần thử lại xử lý đủ vì processed_events đã rollback
    expect(await shipmentsOfOrder(t, o6.id)).toHaveLength(1);
    expect([await countOf(t, 'shipment_status_history'), await countOf(t, 'audit_logs', `action = 'shipping.shipment.create'`)]).toEqual([1, 1]);
    expect(await q(t, `SELECT s.id FROM shipments s LEFT JOIN shipment_status_history h ON h.shipment_id = s.id WHERE h.id IS NULL`)).toEqual([]);
    await seedShipment(t, { status: 'pending' }); // fixture hợp lệ: đủ lịch sử
    expect(await q(t, `SELECT s.id FROM shipments s LEFT JOIN shipment_status_history h ON h.shipment_id = s.id WHERE h.id IS NULL`)).toEqual([]);
  });
});
