import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { createdPayload, createPayApp, countOf, deliver, initiate, MINUTE, payOfOrder, payOutbox, q, attemptsOf, who, type PayApp } from '../support/pay';
import { seedOrder } from '../support/ord';
import { OutboxRelay } from '../../src/modules/platform';
import { EventsService } from '../../src/modules/platform';

// Tạo Payment khi nhận OrderCreated (PAY-REQ-20261006-103110331): một Payment pending mỗi đơn, hạn sao từ event, idempotent hai lớp, lỗi tạm thì giao lại, biên số tiền và đơn 0 đồng.
describe('PAY tạo thanh toán theo OrderCreated', () => {
  let t: PayApp;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); });
  const created = (o: { id: string; code: string; user: string }, over: Record<string, unknown> = {}, eventId?: string) => deliver(t, 'OrderCreated', createdPayload(o, over), eventId);

  it('PAY-TC-20261006-104538540: OrderCreated của đơn online tạo Payment pending, hạn sao nguyên từ payment_expires_at, không event, không lượt thử', async () => {
    const o = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending', code: '7K3M9Q2XH4TB' });
    const expires = new Date(t.clock.now().getTime() + 15 * MINUTE);
    const eid = randomUUID();
    await created(o, { payment_expires_at: expires.toISOString() }, eid);
    const p = await payOfOrder(t, o.id);
    expect(p).toMatchObject({ status: 'pending', method: 'vnpay', amount: '350000', attempt_no: 0, user_id: o.user, order_code: '7K3M9Q2XH4TB', provider_ref: null, paid_at: null, version: 0 });
    expect(p.expires_at?.toISOString()).toBe(expires.toISOString()); // sao nguyên, không tự cộng 15 phút
    expect(await payOutbox(t)).toEqual([]);
    expect(await attemptsOf(t, p.id)).toEqual([]);
    expect(await countOf(t, 'processed_events', `consumer = 'payment' AND event_id = '${eid}'`)).toBe(1);
    expect((await q<{ data_type: string }>(t, `SELECT data_type FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'amount'`))[0].data_type).toBe('bigint'); // tiền là số nguyên (bigint)
    expect((await q<{ column_name: string }>(t, `SELECT column_name FROM information_schema.columns WHERE table_name IN ('payments', 'payment_attempts', 'refunds', 'payment_webhook_logs') AND column_name ~* '(card|cvv|pan|number)'`))).toEqual([]); // không có cột nào cho số thẻ (SB-21)
  });

  it('PAY-TC-20261006-104538572: OrderCreated của đơn COD tạo Payment pending không có hạn (payment_expires_at rỗng)', async () => {
    const o = await seedOrder(t, { status: 'confirmed', method: 'cod', payment: 'pending' });
    await created(o, { grand_total: 180_000, payment_method: 'cod', payment_expires_at: null });
    expect(await payOfOrder(t, o.id)).toMatchObject({ method: 'cod', status: 'pending', amount: '180000', expires_at: null, attempt_no: 0 });
    // COD bỏ qua hạn dù payload có mang: không có đồng hồ cho COD
    const o2 = await seedOrder(t, { status: 'confirmed', method: 'cod', payment: 'pending' });
    await created(o2, { grand_total: 180_000, payment_method: 'cod', payment_expires_at: new Date().toISOString() });
    expect((await payOfOrder(t, o2.id)).expires_at).toBeNull();
  });

  it('PAY-TC-20261006-104538604: OrderCreated giao lần hai (cùng event_id, khác event_id, song song) không tạo Payment thứ hai và không lỗi; log mức thông tin', async () => {
    const o = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending' });
    const eid = randomUUID();
    await created(o, {}, eid);
    const first = await payOfOrder(t, o.id);
    t.clock.advance(30_000);
    await created(o, { grand_total: 999_999 }, eid); // cùng event_id: ProcessedEvent chặn
    await created(o, { grand_total: 999_999 }, randomUUID()); // khác event_id: unique (order_id) chặn
    expect(await countOf(t, 'payments', `order_id = '${o.id}'`)).toBe(1);
    expect(await payOfOrder(t, o.id)).toEqual(first); // không đổi (amount, created, hạn giữ nguyên)
    expect(t.logs.records.filter((r) => r.code === 'payment-exists' && r.level === 'info' && r.order_code === o.code)).toHaveLength(1);
    expect(await payOutbox(t)).toEqual([]);
    expect(await q(t, `SELECT consumer, event_id FROM processed_events WHERE consumer = 'payment' GROUP BY consumer, event_id HAVING count(*) > 1`)).toEqual([]);
    // hai OrderCreated đồng thời của cùng đơn: đúng một Payment
    const o2 = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending' });
    const res = await Promise.allSettled([created(o2), created(o2), created(o2)]);
    expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(await countOf(t, 'payments', `order_id = '${o2.id}'`)).toBe(1);
  });

  it('PAY-TC-20261006-104538638 (ADR-011): ORD lỗi tạm thì handler ném, event chưa vào ProcessedEvent; relay giao lại và tạo đúng một Payment; ORD lỗi mãi thì log error payment-create-failed kèm order_id', async () => {
    const o = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending' });
    const events = t.app.get(EventsService), relay = t.app.get(OutboxRelay);
    const emit = async () => t.tx.run((tx) => events.publish(tx, { type: 'OrderCreated', aggregate_type: 'order', aggregate_id: o.id, payload: createdPayload(o) }));
    const spy = jest.spyOn(t.ord, 'findForPayment').mockRejectedValueOnce(new Error('503')).mockRejectedValueOnce(new Error('503'));
    const id = await emit();
    const T = new Date(Date.now() + 1000);
    expect(await relay.runOnce(T)).toMatchObject({ picked: 1, failed: 1 });
    expect(await relay.runOnce(new Date(T.getTime() + 5_000))).toMatchObject({ picked: 1, failed: 1 });
    expect(await countOf(t, 'payments')).toBe(0);
    expect(await countOf(t, 'processed_events', `event_id = '${id}'`)).toBe(0);
    expect((await q<{ dispatched_at: Date | null }>(t, `SELECT dispatched_at FROM outbox_events WHERE id = '${id}'`))[0].dispatched_at).toBeNull();
    expect(await relay.runOnce(new Date(T.getTime() + 5_000 + 10_000))).toMatchObject({ picked: 1, dispatched: 1 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await countOf(t, 'payments', `order_id = '${o.id}'`)).toBe(1);
    expect(await countOf(t, 'processed_events', `event_id = '${id}'`)).toBe(1);
    expect(await payOutbox(t)).toEqual([]);
    // ORD lỗi mãi: không Payment, log error có mã và order_id (không giao lần 11)
    const o2 = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending' });
    spy.mockReset(); spy.mockRejectedValue(new Error('ORD luôn lỗi'));
    const id2 = await t.tx.run((tx) => events.publish(tx, { type: 'OrderCreated', aggregate_type: 'order', aggregate_id: o2.id, payload: createdPayload(o2) }));
    t.logs.clear();
    let now = new Date(T.getTime() + 100_000);
    for (let i = 0; i < 10; i++) {
      expect(await relay.runOnce(now)).toMatchObject({ picked: 1, failed: 1 });
      now = (await q<{ next: Date }>(t, `SELECT next_attempt_at AS next FROM outbox_events WHERE id = '${id2}'`))[0].next;
    }
    expect(await relay.runOnce(new Date(now.getTime() + 3_600_000))).toMatchObject({ picked: 0 });
    expect(await countOf(t, 'payments', `order_id = '${o2.id}'`)).toBe(0);
    const failed = t.logs.records.filter((r) => r.level === 'error' && r.code === 'payment-create-failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.every((r) => r.order_id === o2.id)).toBe(true);
    expect(t.logs.records.some((r) => r.level === 'error' && r.event_id === id2 && r.attempts === 10)).toBe(true); // relay: hết lượt thử (ADR-011)
    expect(await relay.stuckCount()).toBe(1);
  }, 120_000);

  // ADR-024 (mã đơn mới) và ADR-026 (đơn hộ): chưa có TC của spec cho PAY, tên ca dùng nhãn PAY-HO-nn (ghi ở report.md)
  it('PAY-HO-01: mã đơn mới HDyymmdd-NNNNN tạo Payment COD pending (CHECK payments_order_code_format nhận cả hai khuôn); mã sai khuôn bị bỏ qua có log, không ném', async () => {
    const o = await seedOrder(t, { status: 'confirmed', method: 'cod', payment: 'pending', code: 'HD261015-00005' });
    await created(o, { grand_total: 200_000, payment_method: 'cod', payment_expires_at: null });
    expect(await payOfOrder(t, o.id)).toMatchObject({ method: 'cod', status: 'pending', order_code: 'HD261015-00005', amount: '200000', user_id: o.user });
    for (const bad of ['HD261015-0001', 'hd261015-00001', 'HD26101-000001', 'XD261015-00001', 'HD261015_00001']) {
      t.logs.clear();
      await expect(created({ id: randomUUID(), code: bad, user: o.user }, { payment_method: 'cod', payment_expires_at: null })).resolves.toBeUndefined();
      expect([bad, t.logs.records.filter((r) => r.level === 'warn').length]).toEqual([bad, 1]);
    }
    expect(await countOf(t, 'payments')).toBe(1);
    await expect(t.prisma.$executeRaw`UPDATE payments SET order_code = 'HD2610150-0001' WHERE order_id = ${o.id}::uuid`).rejects.toThrow(/payments_order_code_format/); // CHECK ở CSDL
  });

  it('PAY-HO-02 (ADR-026): đơn hộ không user_id, hoặc thanh toán cash, bank_transfer: không Payment, không lỗi, không event, log payment-skipped-ho; đơn hộ cod có user_id vẫn có Payment COD; vnpay thiếu user_id là payload không hợp lệ', async () => {
    const ghost = (code: string) => ({ id: randomUUID(), code, user: randomUUID() });
    const cases: [string, Record<string, unknown>][] = [
      ['HD261015-00006', { user_id: null, payment_method: 'cod' }], ['HD261015-00007', { user_id: undefined, payment_method: 'cash' }],
      ['HD261015-00008', { user_id: null, payment_method: 'bank_transfer' }], ['HD261015-00009', { payment_method: 'cash' }], ['HD261015-00010', { payment_method: 'bank_transfer' }],
    ];
    for (const [code, over] of cases) {
      t.logs.clear();
      await expect(created(ghost(code), { payment_expires_at: null, ...over })).resolves.toBeUndefined();
      expect([code, t.logs.records.filter((r) => r.code === 'payment-skipped-ho' && r.level === 'info').length, t.logs.records.filter((r) => r.level === 'warn' || r.level === 'error').length]).toEqual([code, 1, 0]);
    }
    expect(await countOf(t, 'payments')).toBe(0);
    expect(await payOutbox(t)).toEqual([]);
    t.logs.clear();
    await created(ghost('HD261015-00011'), { user_id: null, payment_method: 'vnpay' });
    expect([await countOf(t, 'payments'), t.logs.records.filter((r) => r.level === 'warn').length]).toEqual([0, 1]);
    const o = await seedOrder(t, { status: 'confirmed', method: 'cod', payment: 'pending', code: 'HD261015-00012' });
    await created(o, { payment_method: 'cod', payment_expires_at: null });
    expect(await payOfOrder(t, o.id)).toMatchObject({ method: 'cod', status: 'pending', user_id: o.user });
    // các event sau của đơn hộ không có Payment: log warn payment-none, không ném
    await expect(deliver(t, 'OrderDelivered', { order_id: ghost('HD261015-00006').id, delivered_at: new Date().toISOString() })).resolves.toBeUndefined();
  });

  it('PAY-TC-20261006-104538671: giá trị biên 5000, 999999999, 1000000000 đều tạo Payment (khoảng chỉ chặn ở bước bắt đầu), 4999 cũng tạo; đơn 0 đồng không có Payment và log payment-skipped-zero-total', async () => {
    const orders: { o: { id: string; code: string; user: string }; total: number }[] = [];
    const c1 = await who(t, 'customer', 'c1@x.vn');
    for (const total of [5_000, 999_999_999, 1_000_000_000, 4_999, 0]) {
      const o = await seedOrder(t, { user: c1.id, status: 'pending', method: 'vnpay', payment: 'pending' });
      orders.push({ o, total });
      await created(o, { grand_total: total });
    }
    for (const { o, total } of orders) {
      const p = await payOfOrder(t, o.id);
      if (total === 0) expect(p).toBeUndefined(); else expect(p).toMatchObject({ amount: String(total), status: 'pending', attempt_no: 0 });
    }
    expect(t.logs.records.filter((r) => r.code === 'payment-skipped-zero-total' && r.order_code === orders[4].o.code)).toHaveLength(1);
    expect(await countOf(t, 'payments')).toBe(4);
    // bắt đầu thanh toán: 5000 và 999999999 qua (200), 1000000000 và 4999 bị 422 amount-out-of-range, Payment vẫn pending, không lượt thử
    const started: [number, number, string?][] = [];
    for (const { o, total } of orders.filter((x) => x.total > 0)) {
      const pay = await payOfOrder(t, o.id);
      const r = await initiate(t, c1.cookie, pay.id);
      started.push([total, r.status, r.status === 200 ? undefined : String(r.body.type).replace('urn:ecom:error:', '')]);
    }
    expect(started).toEqual([[5_000, 200, undefined], [999_999_999, 200, undefined], [1_000_000_000, 422, 'amount-out-of-range'], [4_999, 422, 'amount-out-of-range']]);
    for (const { o } of orders.filter((x) => x.total === 1_000_000_000 || x.total === 4_999)) {
      const pay = await payOfOrder(t, o.id);
      expect([pay.status, (await attemptsOf(t, pay.id)).length]).toEqual(['pending', 0]);
    }
    // số tiền âm, thực, chuỗi hay payload sai hình dạng: bỏ qua có log, không ném (event độc không bị giao lại mãi), không Payment
    for (const bad of [{ grand_total: -5 }, { grand_total: 1.5 }, { grand_total: '350000' }, { payment_method: 'paypal' }, { order_code: 'khong-hop-le' }, { user_id: 'x' }, { payment_expires_at: null }]) {
      const o = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending' });
      await expect(created(o, bad)).resolves.toBeUndefined();
      expect(await payOfOrder(t, o.id)).toBeUndefined();
    }
    await expect(deliver(t, 'OrderCreated', { order_id: randomUUID() })).resolves.toBeUndefined();
    expect(await countOf(t, 'payments')).toBe(4);
    // đơn đã cancelled hay expired (OrderCreated muộn) và đơn không tồn tại: không tạo (BR9)
    for (const status of ['cancelled', 'expired'] as const) {
      const o = await seedOrder(t, { status, method: 'vnpay' });
      await created(o);
      expect(await payOfOrder(t, o.id)).toBeUndefined();
    }
    await created({ id: randomUUID(), code: '7K3M9Q2XH4TC', user: randomUUID() });
    expect(await countOf(t, 'payments')).toBe(4);
  });
});
