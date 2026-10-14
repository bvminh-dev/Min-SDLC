import { truncateAll } from '../support/db';
import { attemptsOf, countOf, createPayApp, deliver, MINUTE, payAudits, payOutbox, payRow, people, q, refundsOf, seedPayment, seedRefund, type PayApp } from '../support/pay';

// Hoàn tiền tự động (PAY-REQ-20261006-103110946): hủy đơn đã thanh toán, thanh toán muộn, trùng, StockCommitFailed; gọi cổng ngoài giao dịch; tự thử lại 3 lần; đối soát khi cổng không trả lời.
describe('PAY hoàn tiền tự động', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  type O = { id: string; code: string; user: string };
  const cancelled = (o: O, over: Record<string, unknown> = {}, eid?: string) => deliver(t, 'OrderCancelled', { order_id: o.id, order_code: o.code, user_id: o.user, reason: 'customer_request', was_paid: true, ...over }, eid);
  const commitFailed = (o: O, reason = 'reservation_expired', eid?: string) => deliver(t, 'StockCommitFailed', { order_id: o.id, reason }, eid);
  const succeeded = (o: Parameters<typeof seedPayment>[1] = {}) => seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto', ...o });
  /** Trong lúc cổng đang được gọi: không giao dịch nào mở (idle in transaction) và không dòng nào của PAY bị khóa (SB-31). */
  const probe = (paymentId: string) => async () => {
    const idle = await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`);
    let locked = 'ok';
    try { await q(t, `SELECT id FROM payments WHERE id = '${paymentId}' FOR UPDATE NOWAIT`); await q(t, `SELECT id FROM refunds WHERE payment_id = '${paymentId}' FOR UPDATE NOWAIT`); } catch (e) { locked = String((e as { meta?: { code?: string } }).meta?.code ?? e); }
    return { idle: idle[0].n, locked };
  };

  it('PAY-TC-20261006-104540177 (SB-27, SB-31): hoàn tiền toàn phần thành công khi hủy đơn đã thanh toán: Refund requested rồi succeeded (350000), Payment refunded, PaymentRefunded và RefundSucceeded mỗi event một lần, audit system; cổng nhận đúng mã yêu cầu và gọi ngoài giao dịch', async () => {
    const pay = await succeeded({ providerRef: '14012345', attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }] });
    let seen: { idle: number; locked: string } | null = null;
    t.gw.refundImpl = async () => { seen = await probe(pay.id)(); return { kind: 'succeeded', code: '00' }; };
    await cancelled(pay.order);
    await t.refunds.idle();
    const [r] = await refundsOf(t, pay.id);
    expect(r).toMatchObject({ status: 'succeeded', amount: '350000', reason: 'order_cancelled', failure_reason: null, gateway_code: '00' });
    expect(r.resolved_at).not.toBeNull();
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded', version: 1 });
    expect(t.gw.refundCalls).toHaveLength(1);
    expect(t.gw.refundCalls[0]).toMatchObject({ requestId: r.gateway_request_id, amount: 350000n, txnRef: pay.attempts[0].txnRef, transactionNo: '14012345' });
    expect(t.gw.refundCalls[0].requestId).toHaveLength(32);
    expect(seen).toEqual({ idle: 0, locked: 'ok' }); // gọi cổng ngoài giao dịch, không giữ khóa dòng
    const ev = await payOutbox(t);
    expect(ev.map((e) => e.type)).toEqual(['PaymentRefunded', 'RefundSucceeded']);
    expect(ev[0].payload).toEqual({ payment_id: pay.id, order_id: pay.order.id });
    expect(ev[1].payload).toEqual({ refund_id: r.id, payment_id: pay.id, order_id: pay.order.id, order_code: pay.order.code, user_id: p.a.id, amount: 350000, reason: 'order_cancelled' });
    expect(await payAudits(t, pay.id)).toMatchObject([{ actor_id: null, actor_role: 'system', action: 'payment.refund.auto', after: { amount: 350000, reason: 'order_cancelled' } }]);
    // PaymentRefunded làm ORD đặt payment_status = refunded
    await t.relay.runOnce(new Date(Date.now() + 3_600_000));
    expect((await q<{ payment_status: string }>(t, `SELECT payment_status::text AS payment_status FROM orders WHERE id = '${pay.order.id}'`))[0].payment_status).toBe('refunded');
  });

  it('PAY-TC-20261006-104540210: hoàn tiền thanh toán muộn không đổi trạng thái Payment đã đóng: Refund succeeded, Payment giữ expired, chỉ RefundSucceeded (không PaymentRefunded)', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'expired', amount: 200_000, attemptNo: 1, attempts: [{ no: 1, status: 'succeeded', txNo: '14012666' }], orderStatus: 'expired' });
    const id = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, reason: 'late_payment', status: 'requested' });
    expect(await t.refunds.dispatch(id)).toBe('done');
    expect(await refundsOf(t, pay.id)).toMatchObject([{ status: 'succeeded', reason: 'late_payment', amount: '200000' }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'expired', version: 0 });
    expect((await payOutbox(t)).map((e) => e.type)).toEqual(['RefundSucceeded']);
  });

  it('PAY-TC-20261006-104540245: cổng từ chối lần đầu: Refund failed (mã chung, hẹn thử lại sau 5 phút), RefundFailed phát một lần, Payment vẫn succeeded; tới hẹn chính Refund đó về requested (lần 2, mã yêu cầu mới, hết next_retry_at)', async () => {
    const pay = await succeeded();
    t.gw.refundImpl = (_i, n) => (n === 1 ? { kind: 'declined', code: '93' } : new Promise(() => undefined)); // lần 1 từ chối, lần 2 treo
    const t0 = t.clock.now();
    await cancelled(pay.order);
    await waitFor(async () => (await refundsOf(t, pay.id))[0]?.status === 'failed');
    const [r1] = await refundsOf(t, pay.id);
    expect(r1).toMatchObject({ status: 'failed', failure_reason: 'gateway-declined', gateway_code: '93', auto_attempt_no: 1 });
    expect(r1.next_retry_at?.toISOString()).toBe(new Date(t0.getTime() + 5 * MINUTE).toISOString());
    expect(r1.failure_reason).not.toMatch(/93|declined by|vnp/i); // mã chung, không thân lỗi của cổng
    const ev = await payOutbox(t, 'RefundFailed');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ refund_id: r1.id, payment_id: pay.id, order_id: pay.order.id, order_code: pay.order.code, user_id: p.a.id, amount: 350000, reason: 'order_cancelled', failure_reason: 'gateway-declined' });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    await t.refunds.sweep(new Date(t0.getTime() + 4 * MINUTE)); // chưa tới hẹn
    expect((await refundsOf(t, pay.id))[0].status).toBe('failed');
    const sweeping = t.refunds.sweep(new Date(t0.getTime() + 5 * MINUTE)); // tới hẹn: cùng Refund về requested rồi gọi cổng (treo)
    await waitFor(async () => (await refundsOf(t, pay.id))[0]?.status === 'requested');
    const rows = await refundsOf(t, pay.id);
    expect(rows).toHaveLength(1); // không có Refund mới
    expect(rows[0]).toMatchObject({ id: r1.id, status: 'requested', auto_attempt_no: 2, next_retry_at: null, failure_reason: null, resolved_at: null });
    expect(rows[0].gateway_request_id).not.toBe(r1.gateway_request_id);
    expect(rows[0].gateway_request_id).toMatch(/^[0-9a-f]{32}$/);
    t.gw.reset(); void sweeping; // nhả cuộc gọi treo
  });

  it('PAY-TC-20261006-104540277 (T8): hết 3 lần tự thử thì dừng (lần 2 sau 5 phút, lần 3 sau 30 phút nữa): một Refund failed với auto_attempt_no 3, ba RefundFailed, không next_retry_at, không lần thứ tư; giao lặp OrderCancelled khi Refund đang requested không tạo Refund mới', async () => {
    const pay = await succeeded();
    t.gw.refundImpl = () => ({ kind: 'declined', code: '99' });
    const t0 = t.clock.now();
    await cancelled(pay.order);
    await waitFor(async () => (await refundsOf(t, pay.id))[0]?.status === 'failed');
    t.clock.set(new Date(t0.getTime() + 5 * MINUTE)); await t.refunds.sweep(); // lần 2 (đồng hồ ứng dụng tới hẹn: Refund ghi hẹn kế theo đồng hồ này)
    let r = (await refundsOf(t, pay.id))[0];
    expect(r).toMatchObject({ status: 'failed', auto_attempt_no: 2 });
    expect(r.next_retry_at?.toISOString()).toBe(new Date(t0.getTime() + 5 * MINUTE + 30 * MINUTE).toISOString()); // lần 3 sau 30 phút nữa
    t.clock.set(new Date(t0.getTime() + 34 * MINUTE)); await t.refunds.sweep(); // chưa tới hẹn lần 3
    expect((await refundsOf(t, pay.id))[0].auto_attempt_no).toBe(2);
    t.clock.set(new Date(t0.getTime() + 35 * MINUTE)); await t.refunds.sweep(); // lần 3
    r = (await refundsOf(t, pay.id))[0];
    expect(r).toMatchObject({ status: 'failed', auto_attempt_no: 3, next_retry_at: null });
    const calls = t.gw.refundCalls.length;
    t.clock.set(new Date(t0.getTime() + 24 * 60 * MINUTE)); await t.refunds.sweep(); // không lần tự thử thứ tư
    expect(t.gw.refundCalls).toHaveLength(calls);
    expect(calls).toBe(3);
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    expect(await payOutbox(t, 'RefundFailed')).toHaveLength(3);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    expect(new Set(t.gw.refundCalls.map((c) => c.requestId)).size).toBe(3); // mỗi lần vào requested một mã mới
    // giao lặp OrderCancelled khi Refund đang requested (một lần khác): không Refund mới
    const hold = t.gw.hold();
    const other = await succeeded();
    await cancelled(other.order);
    await cancelled(other.order, {}, undefined);
    await cancelled(other.order);
    await waitFor(async () => t.gw.refundCalls.length === 4);
    expect(await refundsOf(t, other.id)).toHaveLength(1);
    expect((await refundsOf(t, other.id))[0].status).toBe('requested');
    expect(t.logs.records.filter((x) => x.code === 'refund-already-created' && x.order_code === other.order.code).length).toBeGreaterThanOrEqual(2);
    hold(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104540309: không nhận được trả lời của cổng (hết hạn gọi) thì Refund giữ requested; job đối soát chỉ hỏi lại sau 5 phút, cùng mã yêu cầu, rồi chốt succeeded: Payment refunded, không Refund thứ hai, mỗi event một lần', async () => {
    const pay = await succeeded();
    t.gw.refundImpl = (_i, n) => (n === 1 ? { kind: 'pending' } : { kind: 'succeeded', code: '00' });
    const t0 = t.clock.now();
    await cancelled(pay.order);
    await t.refunds.idle();
    const [r] = await refundsOf(t, pay.id);
    expect(r.status).toBe('requested');
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    await t.refunds.sweep(new Date(t0.getTime() + 4 * MINUTE)); // chưa đủ 5 phút
    expect(t.gw.refundCalls).toHaveLength(1);
    expect((await t.refunds.sweep(new Date(t0.getTime() + 5 * MINUTE))).reasked).toBe(1);
    expect(t.gw.refundCalls).toHaveLength(2);
    expect(t.gw.refundCalls[1].requestId).toBe(t.gw.refundCalls[0].requestId); // hỏi lại bằng chính mã yêu cầu: cổng không hoàn hai lần
    expect(await refundsOf(t, pay.id)).toMatchObject([{ id: r.id, status: 'succeeded' }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect((await payOutbox(t)).map((e) => e.type)).toEqual(['PaymentRefunded', 'RefundSucceeded']);
    // cổng ném lỗi lạ: coi như chưa trả lời, giữ requested, job không chết
    const x = await succeeded();
    t.gw.refundImpl = () => { throw new Error('mạng đứt'); };
    await cancelled(x.order);
    await t.refunds.idle();
    expect((await refundsOf(t, x.id))[0].status).toBe('requested');
    await expect(t.refunds.sweep(new Date(t0.getTime() + 10 * MINUTE))).resolves.toMatchObject({ reasked: 1 });
    expect((await refundsOf(t, x.id))[0].status).toBe('requested');
  });

  it('PAY-TC-20261006-104540342: Payment COD đã succeeded không có hoàn tiền tự động: không Refund, Payment giữ succeeded, log cod-refund-unsupported', async () => {
    const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'succeeded', orderStatus: 'delivered' });
    await cancelled(pay.order, { was_paid: true });
    await commitFailed(pay.order);
    expect(await countOf(t, 'refunds')).toBe(0);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    expect(t.logs.records.filter((r) => r.code === 'cod-refund-unsupported' && r.order_code === pay.order.code)).toHaveLength(2);
    expect(await countOf(t, 'outbox_events')).toBe(0);
  });

  it('PAY-TC-20261006-104540374: trùng thanh toán hoàn đúng 100% giao dịch thứ hai và giữ nguyên giao dịch đầu: Refund của lượt thứ hai succeeded, Payment giữ succeeded với provider_ref của giao dịch đầu, chỉ RefundSucceeded', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', providerRef: '14012345', attemptNo: 2, attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }, { no: 2, status: 'succeeded', txNo: '14012399' }] });
    const id = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[1].id, reason: 'duplicate_payment', status: 'requested' });
    await t.refunds.dispatch(id);
    expect(await refundsOf(t, pay.id)).toMatchObject([{ attempt_id: pay.attempts[1].id, status: 'succeeded', amount: '350000' }]);
    expect(t.gw.refundCalls[0]).toMatchObject({ transactionNo: '14012399', amount: 350000n });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded', provider_ref: '14012345' });
    expect((await payOutbox(t)).map((e) => e.type)).toEqual(['RefundSucceeded']);
  });

  it('PAY-TC-20261006-113000400 (bẫy đột biến, SB-24): StockCommitFailed cho Payment chưa thu tiền (pending, processing, failed, expired, cancelled) không hoàn gì: log info payment-not-refundable, không có log error', async () => {
    for (const status of ['pending', 'processing', 'failed', 'expired', 'cancelled'] as const) {
      t.logs.clear();
      const pay = await seedPayment(t, { user: p.a.id, status, attemptNo: status === 'pending' ? 0 : 1, attempts: status === 'pending' ? [] : 'auto' });
      await commitFailed(pay.order);
      await t.refunds.idle();
      expect([status, await refundsOf(t, pay.id)]).toEqual([status, []]);
      expect([status, t.logs.records.filter((r) => r.code === 'payment-not-refundable' && r.level === 'info').length]).toEqual([status, 1]);
      expect([status, t.logs.records.filter((r) => r.level === 'error')]).toEqual([status, []]);
    }
  });

  it('PAY-TC-20261006-113000400 (K-02, V-04, T14): StockCommitFailed hoàn giao dịch của chính Payment (late_payment, requested_by rỗng): Refund succeeded, Payment refunded, đủ event, audit system; OrderExpired đến sau không tạo Refund thứ hai và không PaymentExpired; Payment đã đóng hay refunded thì bỏ qua', async () => {
    const pay = await succeeded({ providerRef: '14012777', attempts: [{ no: 1, status: 'succeeded', txNo: '14012777' }] });
    await commitFailed(pay.order, 'reservation_expired');
    await t.refunds.idle();
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'late_payment', amount: '350000', status: 'succeeded', requested_by: null, attempt_id: pay.attempts[0].id }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect((await payOutbox(t)).map((e) => e.type)).toEqual(['PaymentRefunded', 'RefundSucceeded']);
    expect((await payOutbox(t, 'RefundSucceeded'))[0].payload).toMatchObject({ reason: 'late_payment' });
    expect(await payAudits(t, pay.id)).toMatchObject([{ actor_role: 'system', action: 'payment.refund.auto', after: { reason: 'late_payment' } }]);
    await deliver(t, 'OrderExpired', { order_id: pay.order.id, order_code: pay.order.code, user_id: p.a.id });
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    expect(await payOutbox(t, 'PaymentExpired')).toEqual([]);
    expect(t.logs.records.some((r) => r.code === 'payment-already-closed' && r.order_code === pay.order.code)).toBe(true);
    const gone = await seedPayment(t, { user: p.a.id, status: 'expired', orderStatus: 'expired' });
    await commitFailed(gone.order, 'reservation_released');
    expect(await countOf(t, 'refunds', `payment_id = '${gone.id}'`)).toBe(0);
    await commitFailed(pay.order, 'reservation_expired', undefined); // Payment đã refunded
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    await expect(deliver(t, 'StockCommitFailed', { order_id: pay.order.id, reason: 'moi-la' })).resolves.toBeUndefined(); // mã reason lạ: bỏ qua có log
    expect(t.logs.records.some((r) => r.event_type === 'StockCommitFailed' && r.why === 'reason không hợp lệ')).toBe(true);
  });

  it('PAY-TC-20261006-130000500 (M-04, R-02, T8): OrderCancelled stock_commit_failed khi Refund late_payment đang failed không tạo Refund mới và không gọi cổng lần hai; tới hẹn job chuyển chính R7 về requested (lần 2, mã mới) rồi succeeded, P7 refunded; RefundFailed một lần, RefundSucceeded một lần', async () => {
    const pay = await succeeded();
    let n = 0;
    t.gw.refundImpl = () => (++n === 1 ? { kind: 'declined', code: '93' } : { kind: 'succeeded', code: '00' });
    const t0 = t.clock.now();
    await commitFailed(pay.order);
    await waitFor(async () => (await refundsOf(t, pay.id))[0]?.status === 'failed');
    const [r7] = await refundsOf(t, pay.id);
    expect(r7).toMatchObject({ status: 'failed', auto_attempt_no: 1 });
    expect(r7.next_retry_at?.toISOString()).toBe(new Date(t0.getTime() + 5 * MINUTE).toISOString());
    t.clock.advance(MINUTE);
    await cancelled(pay.order, { reason: 'stock_commit_failed' });
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    expect(t.gw.refundCalls).toHaveLength(1);
    expect(t.logs.records.some((r) => r.code === 'refund-already-created' && r.order_code === pay.order.code)).toBe(true);
    t.clock.set(new Date(t0.getTime() + 5 * MINUTE));
    await t.refunds.sweep();
    const [after] = await refundsOf(t, pay.id);
    expect(after).toMatchObject({ id: r7.id, status: 'succeeded', auto_attempt_no: 2 });
    expect(after.gateway_request_id).not.toBe(r7.gateway_request_id);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect((await payOutbox(t, 'RefundFailed', 'RefundSucceeded', 'PaymentRefunded')).map((e) => e.type)).toEqual(['RefundFailed', 'PaymentRefunded', 'RefundSucceeded']);
  });

  it('PAY-TC-20261006-150000100 (R-17, T14): StockCommitFailed reservation_missing hoàn late_payment như hai mã còn lại: Refund succeeded 200000, Payment refunded, đủ event, audit system; giao lặp cùng event_id không Refund hay event thứ hai', async () => {
    const pay = await succeeded({ amount: 200_000, providerRef: '14013222', attempts: [{ no: 1, status: 'succeeded', txNo: '14013222' }] });
    const eid = '55555555-5555-4555-8555-555555555555';
    await commitFailed(pay.order, 'reservation_missing', eid);
    await t.refunds.idle();
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'late_payment', amount: '200000', status: 'succeeded', requested_by: null }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect((await payOutbox(t, 'RefundSucceeded'))[0].payload).toMatchObject({ reason: 'late_payment', amount: 200000 });
    expect(await payAudits(t, pay.id)).toHaveLength(1);
    const events = (await payOutbox(t)).length;
    await commitFailed(pay.order, 'reservation_missing', eid);
    await t.refunds.idle();
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    expect((await payOutbox(t)).length).toBe(events);
    expect(t.gw.refundCalls).toHaveLength(1);
    void attemptsOf;
  });
});

async function waitFor(cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('hết thời gian chờ điều kiện');
}
