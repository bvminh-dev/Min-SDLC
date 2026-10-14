import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { attemptsOf, callKey, countOf, createPayApp, deliver, ipn, ipnQuery, logsOf, orderRow, payAudits, payOutbox, payRow, people, refund, refundsOf, seedPayment, type PayApp } from '../support/pay';

// Đóng thanh toán khi đơn hết hạn, bị hủy hoặc hoàn về (PAY-REQ-20261006-103110858); hoàn tiền theo trạng thái Payment chứ không theo was_paid; một giao dịch thắng (K-02).
describe('PAY đóng thanh toán theo event của đơn', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  type O = { id: string; code: string; user: string };
  const expired = (o: O, eid?: string) => deliver(t, 'OrderExpired', { order_id: o.id, order_code: o.code, user_id: o.user }, eid);
  const cancelled = (o: O, over: Record<string, unknown> = {}, eid?: string) => deliver(t, 'OrderCancelled', { order_id: o.id, order_code: o.code, user_id: o.user, reason: 'customer_request', was_paid: false, ...over }, eid);
  const returned = (o: O, eid?: string) => deliver(t, 'OrderReturned', { order_id: o.id, order_code: o.code, user_id: o.user }, eid);

  it('PAY-TC-20261006-104539947: OrderExpired đóng Payment đang processing: expired và đúng một PaymentExpired; lượt thử vẫn processing về mặt cổng nhưng kết quả thành công về sau không đưa Payment sang succeeded', async () => {
    const hold = t.gw.hold();
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    await expired(pay.order);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'expired', version: 1 });
    const ev = await payOutbox(t);
    expect(ev.map((e) => e.type)).toEqual(['PaymentExpired']);
    expect(ev[0].payload).toEqual({ payment_id: pay.id, order_id: pay.order.id });
    expect((await attemptsOf(t, pay.id))[0].status).toBe('processing');
    await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000 }));
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'expired', provider_ref: null });
    expect(await payOutbox(t, 'PaymentSucceeded')).toEqual([]);
    // sau khi ORD nhận PaymentExpired, payment_status của đơn là expired
    hold(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104539981: OrderCancelled đóng Payment COD chưa thu tiền thành cancelled; không Refund, không event', async () => {
    const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending' });
    await cancelled(pay.order);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'cancelled' });
    expect(await refundsOf(t, pay.id)).toEqual([]);
    expect(await countOf(t, 'outbox_events')).toBe(0);
  });

  it('PAY-TC-20261006-104540014 (SB-24): OrderCancelled với Payment đã succeeded khởi tạo đúng một hoàn tiền toàn phần order_cancelled (requested, requested_by rỗng, mã yêu cầu 32 hex); Payment giữ succeeded cho tới khi hoàn xong; audit system', async () => {
    const hold = t.gw.hold();
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    await cancelled(pay.order, { was_paid: true });
    const r = await refundsOf(t, pay.id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ reason: 'order_cancelled', amount: '350000', status: 'requested', requested_by: null, attempt_id: pay.attempts[0].id, auto_attempt_no: 1, note: null });
    expect(r[0].gateway_request_id).toMatch(/^[0-9a-f]{32}$/);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    expect(await payAudits(t, pay.id)).toMatchObject([{ actor_id: null, actor_role: 'system', action: 'payment.refund.auto', after: { amount: 350000, reason: 'order_cancelled' } }]);
    await cancelled(pay.order, { was_paid: true }); // giao lặp khác event_id: unique attempt_id chặn
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    hold(); await t.refunds.idle();
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    // OrderExpired cho Payment succeeded: hoàn order_expired
    const hold2 = t.gw.hold();
    const pe = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    await expired(pe.order);
    expect(await refundsOf(t, pe.id)).toMatchObject([{ reason: 'order_expired', status: 'requested' }]);
    hold2(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104540047: event đóng cho đơn không có Payment hoặc giao lặp thì bỏ qua (cảnh báo có order_id, không dòng mới, không PaymentExpired thứ hai)', async () => {
    const ghost = randomUUID();
    await expect(deliver(t, 'OrderCancelled', { order_id: ghost, order_code: '7K3M9Q2XH4TB', user_id: randomUUID(), reason: 'admin', was_paid: false })).resolves.toBeUndefined();
    const warn = t.logs.records.filter((r) => r.level === 'warn' && r.code === 'payment-none');
    expect(warn).toHaveLength(1);
    expect(warn[0].order_id).toBe(ghost);
    expect(await countOf(t, 'payments')).toBe(0);
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    await expired(pay.order);
    await expired(pay.order); // khác event_id
    await expired(pay.order, '33333333-3333-4333-8333-333333333333');
    await expired(pay.order, '33333333-3333-4333-8333-333333333333'); // cùng event_id
    expect((await payOutbox(t, 'PaymentExpired'))).toHaveLength(1);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'expired', version: 1 });
    // payload sai hình dạng: bỏ qua có log, không ném
    await expect(deliver(t, 'OrderExpired', { order_id: 'x' })).resolves.toBeUndefined();
    await expect(deliver(t, 'OrderCancelled', {})).resolves.toBeUndefined();
  });

  it('PAY-TC-20261006-104540079 (T14): hủy khi PaymentSucceeded chưa tới ORD (was_paid false) vẫn hoàn tiền theo trạng thái Payment, kèm log paid-but-was-paid-false có mã đơn', async () => {
    const hold = t.gw.hold();
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto', amount: 420_000 });
    await cancelled(pay.order, { was_paid: false });
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'order_cancelled', amount: '420000', status: 'requested' }]);
    const w = t.logs.records.filter((r) => r.code === 'paid-but-was-paid-false');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: 'warn', order_code: pay.order.code });
    hold(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104540111 (T14): khách trả thành công ở cổng sau khi đơn bị hủy: Payment giữ cancelled, không PaymentSucceeded, Refund late_payment, nhật ký late_payment', async () => {
    const hold = t.gw.hold();
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    await cancelled(pay.order);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'cancelled' });
    const r = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000 }));
    expect(r.body.RspCode).toBe('00');
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'cancelled' });
    expect(await payOutbox(t, 'PaymentSucceeded')).toEqual([]);
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'late_payment', amount: '350000' }]);
    expect((await logsOf(t))[0].result).toBe('late_payment');
    hold(); await t.refunds.idle();
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'cancelled' }); // hoàn muộn không đổi Payment đã đóng
    expect(await payOutbox(t, 'PaymentRefunded')).toEqual([]);
    expect((await payOutbox(t, 'RefundSucceeded'))).toHaveLength(1);
  });

  it('PAY-TC-20261006-104540144: OrderExpired và OrderCancelled đến đảo thứ tự: event đến trước đóng Payment, event sau bị bỏ qua; mỗi Payment đúng một chuyển, chỉ bên expired phát PaymentExpired, không Refund', async () => {
    const mk = () => seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto' });
    const [px, py] = [await mk(), await mk()];
    await expired(px.order); await cancelled(px.order);
    await cancelled(py.order); await expired(py.order);
    expect(await payRow(t, px.id)).toMatchObject({ status: 'expired', version: 1 });
    expect(await payRow(t, py.id)).toMatchObject({ status: 'cancelled', version: 1 });
    expect((await payOutbox(t, 'PaymentExpired')).map((e) => e.payload.payment_id)).toEqual([px.id]);
    expect(await countOf(t, 'refunds')).toBe(0);
    expect(t.logs.records.filter((r) => r.code === 'payment-already-closed')).toHaveLength(2);
  });

  it('PAY-TC-20261006-130000100 (T9, M-03): OrderReturned đóng Payment COD pending thành cancelled (một chuyển, không Refund, không event); giao lặp hay Payment đã cancelled bỏ qua; Payment COD đã succeeded giữ nguyên', async () => {
    const p8 = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'returned' });
    const p9 = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'cancelled', orderStatus: 'returned' });
    const p10 = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'succeeded', orderStatus: 'returned' });
    const eid = '44444444-4444-4444-8444-444444444444';
    await returned(p8.order, eid);
    expect(await payRow(t, p8.id)).toMatchObject({ status: 'cancelled', version: 1 });
    expect(await refundsOf(t, p8.id)).toEqual([]);
    expect(await countOf(t, 'outbox_events')).toBe(0);
    expect(await countOf(t, 'processed_events', `consumer = 'payment' AND event_id = '${eid}'`)).toBe(1);
    await returned(p8.order, eid); await returned(p8.order);
    expect(await payRow(t, p8.id)).toMatchObject({ status: 'cancelled', version: 1 });
    const online = await seedPayment(t, { user: p.a.id, status: 'pending', orderStatus: 'returned' }); // online pending không đóng bằng OrderReturned (chỉ COD)
    await returned(p9.order); await returned(p10.order); await returned(online.order);
    expect(await payRow(t, online.id)).toMatchObject({ status: 'pending', version: 0 });
    expect(await payRow(t, p9.id)).toMatchObject({ status: 'cancelled', version: 0 });
    expect(await payRow(t, p10.id)).toMatchObject({ status: 'succeeded', version: 0 });
    expect(await countOf(t, 'refunds')).toBe(0);
    expect(await countOf(t, 'outbox_events')).toBe(0);
  });

  it('PAY-TC-20261006-130000200 (K-03c, M-03): OrderReturned không tự hoàn Payment online đã thu (không Refund, không event, log nêu hoàn tay); admin vẫn hoàn thủ công admin_manual cho đơn returned', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto', orderStatus: 'returned', amount: 350_000 });
    await returned(pay.order);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    expect(await refundsOf(t, pay.id)).toEqual([]);
    expect(await payOutbox(t, 'PaymentRefunded', 'RefundSucceeded')).toEqual([]);
    expect(t.logs.records.some((r) => r.code === 'refund-manual-required' && r.order_code === pay.order.code)).toBe(true);
    const r = await refund(t, p.admin.cookie, pay.id, 'Hàng hoàn về kho, đã nhận lại');
    expect([r.status, r.body.status, r.body.amount]).toEqual([202, 'requested', 350000]);
    await t.refunds.idle();
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'admin_manual', amount: '350000', requested_by: p.admin.id, note: 'Hàng hoàn về kho, đã nhận lại' }]);
    void callKey;
  });

  it('PAY-TC-20261006-130000300 (M-04, R-02, T8, T14): OrderCancelled stock_commit_failed khi Refund late_payment còn requested không tạo Refund thứ hai (cổng nhận đúng một lệnh); khi cổng xác nhận R10 succeeded, P10 sang refunded và không bao giờ qua cancelled', async () => {
    const hold = t.gw.hold();
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    await deliver(t, 'StockCommitFailed', { order_id: pay.order.id, reason: 'reservation_expired' });
    const [r10] = await refundsOf(t, pay.id);
    expect(r10).toMatchObject({ reason: 'late_payment', amount: '350000', status: 'requested' });
    await cancelled(pay.order, { reason: 'stock_commit_failed', was_paid: true });
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    expect(t.logs.records.some((r) => r.code === 'refund-already-created' && r.order_code === pay.order.code)).toBe(true);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    hold(); await t.refunds.idle();
    expect(t.gw.distinctRefundRequests).toBe(1);
    expect(t.gw.refundCalls).toHaveLength(1);
    expect(await refundsOf(t, pay.id)).toMatchObject([{ id: r10.id, status: 'succeeded', reason: 'late_payment' }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect((await payOutbox(t, 'PaymentRefunded', 'RefundSucceeded')).map((e) => e.type)).toEqual(['PaymentRefunded', 'RefundSucceeded']);
    expect((await payOutbox(t, 'RefundSucceeded'))[0].payload).toMatchObject({ reason: 'late_payment', amount: 350000, refund_id: r10.id });
    expect(await countOf(t, 'outbox_events', `payload->>'payment_id' = '${pay.id}' AND type = 'PaymentExpired'`)).toBe(0); // không qua cancelled hay expired
    await cancelled(pay.order, { reason: 'stock_commit_failed', was_paid: true }, randomUUID()); // Payment đã refunded: bỏ qua
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    // Payment succeeded mà chưa có Refund: chỉ cảnh báo để đối soát, không tự tạo (StockCommitFailed là nguồn tạo)
    const orphan = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    await cancelled(orphan.order, { reason: 'stock_commit_failed', was_paid: true });
    expect(await refundsOf(t, orphan.id)).toEqual([]);
    expect(t.logs.records.some((r) => r.level === 'warn' && r.code === 'refund-missing' && r.order_code === orphan.order.code)).toBe(true);
    void orderRow;
  });
});
