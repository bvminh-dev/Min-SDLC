import { truncateAll } from '../support/db';
import { createPayApp, MINUTE, payAudits, payOutbox, payRow, people, refundRetry, refundsOf, seedPayment, seedRefund, type PayApp } from '../support/pay';
import { REFUND_STUCK_MS } from '../../src/modules/payment/config';

// Hoàn tiền kẹt `requested` (PAY-REQ-20261006-103110946 BR6, PAY-DB mục 6): hỏi lại cổng bằng CÙNG mã yêu cầu, đường kết thúc có hạn 1 giờ (REV-PAY-04, L103).
describe('PAY hoàn tiền kẹt requested: đường kết thúc có hạn', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); });
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  const succeeded = () => seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
  const stuck = async (minAgo: number, o: { lease?: number } = {}) => {
    const pay = await succeeded(), now = t.clock.now();
    const id = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'requested', requestedAt: new Date(now.getTime() - minAgo * MINUTE), createdAt: new Date(now.getTime() - minAgo * MINUTE), updatedAt: new Date(now.getTime() - (o.lease ?? 10) * MINUTE) });
    return { pay, id };
  };

  it('PAY-TC-20261013-193715799 (job `payment-refund-sweep`, REV-PAY-04, BR6): Refund requested quá REFUND_STUCK_MS mà cổng vẫn không chốt (94 mãi) thì job hỏi lại bằng CÙNG mã yêu cầu rồi chuyển failed (gateway-no-answer), phát RefundFailed cho admin, log error và không tự thử lại; Refund mới hơn thì chỉ hỏi lại', async () => {
    const now = t.clock.now();
    const old = await stuck(REFUND_STUCK_MS / MINUTE + 30), fresh = await stuck(30);
    const reqOld = (await refundsOf(t, old.pay.id))[0].gateway_request_id;
    t.gw.refundImpl = () => ({ kind: 'pending' });
    t.logs.clear();
    expect(await t.refunds.sweep(now)).toEqual({ retried: 0, reasked: 2, gaveUp: 1 });
    expect(t.gw.refundCalls.find((c) => c.requestId === reqOld)).toBeDefined(); // hỏi lại bằng đúng mã yêu cầu cũ (idempotent phía cổng), không hoàn lần hai
    expect(await refundsOf(t, old.pay.id)).toMatchObject([{ status: 'failed', failure_reason: 'gateway-no-answer', next_retry_at: null, gateway_request_id: reqOld }]);
    expect((await refundsOf(t, old.pay.id))[0].resolved_at).not.toBeNull();
    expect(await refundsOf(t, fresh.pay.id)).toMatchObject([{ status: 'requested' }]);
    expect(await payRow(t, old.pay.id)).toMatchObject({ status: 'succeeded' }); // Payment không đổi: chưa chắc cổng đã hoàn
    const ev = await payOutbox(t, 'RefundFailed', 'RefundSucceeded', 'PaymentRefunded');
    expect(ev.map((e) => e.type)).toEqual(['RefundFailed']);
    expect(ev[0].payload).toMatchObject({ refund_id: old.id, payment_id: old.pay.id, failure_reason: 'gateway-no-answer', amount: 350000, user_id: p.a.id });
    const errs = t.logs.lines.filter((l) => l.includes('refund-stuck'));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(old.id);
    expect(await t.pay.countFailedRefunds()).toBe(1); // admin thấy trong hàng đợi và số đếm của DSH
    // không tự thử lại: lượt sau không tạo lệnh hoàn mới cho Refund đã failed
    const calls = t.gw.refundCalls.length;
    expect((await t.refunds.sweep(new Date(now.getTime() + 40 * MINUTE))).retried).toBe(0);
    expect(t.gw.refundCalls.slice(calls).some((c) => c.requestId === reqOld)).toBe(false);
  });

  it('PAY-TC-20261013-193715799 (BR6): quá hạn nhưng lần hỏi lại cuối cổng đã trả lời thì chốt theo cổng (succeeded hoặc failed do từ chối), không chuyển gateway-no-answer', async () => {
    const now = t.clock.now();
    const ok = await stuck(120), no = await stuck(120);
    t.gw.refundImpl = (i) => (i.requestId === (okReq) ? { kind: 'succeeded', code: '00' } : { kind: 'declined', code: '93' });
    const okReq = (await refundsOf(t, ok.pay.id))[0].gateway_request_id;
    expect(await t.refunds.sweep(now)).toMatchObject({ reasked: 2, gaveUp: 0 });
    expect(await refundsOf(t, ok.pay.id)).toMatchObject([{ status: 'succeeded' }]);
    expect(await payRow(t, ok.pay.id)).toMatchObject({ status: 'refunded' });
    expect(await refundsOf(t, no.pay.id)).toMatchObject([{ status: 'failed', failure_reason: 'gateway-declined' }]);
    expect(t.logs.lines.some((l) => l.includes('refund-stuck'))).toBe(false);
  });

  it('PAY-TC-20261013-193715799 (BR6, idempotent): Refund failed gateway-no-answer được admin thử lại bằng chính dòng đó (mã yêu cầu mới, requested_at mới) thì không bị đóng lại ngay ở lượt đối soát kế; quá hạn mới thì kết thúc lần nữa', async () => {
    const now = t.clock.now();
    const r = await stuck(REFUND_STUCK_MS / MINUTE + 30);
    t.gw.refundImpl = () => ({ kind: 'pending' });
    await t.refunds.sweep(now);
    const failed = (await refundsOf(t, r.pay.id))[0];
    expect(failed).toMatchObject({ status: 'failed', failure_reason: 'gateway-no-answer' });
    const rt = await refundRetry(t, p.admin.cookie, r.id);
    expect([rt.status, rt.body.status]).toEqual([202, 'requested']);
    await t.refunds.idle();
    const again = (await refundsOf(t, r.pay.id))[0];
    expect(again.gateway_request_id).not.toBe(failed.gateway_request_id);
    expect(again.requested_at.getTime()).toBeGreaterThan(failed.requested_at.getTime());
    expect(again).toMatchObject({ status: 'requested', failure_reason: null });
    expect(await payAudits(t, r.pay.id, 'payment.refund.retry')).toHaveLength(1);
    // lượt đối soát kế (sau 6 phút): chỉ hỏi lại, KHÔNG đóng (mới vào requested)
    const later = new Date(t.clock.now().getTime() + 6 * MINUTE);
    expect(await t.refunds.sweep(later)).toMatchObject({ reasked: 1, gaveUp: 0 });
    expect((await refundsOf(t, r.pay.id))[0]).toMatchObject({ status: 'requested' });
    // quá một giờ kể từ lần vào requested mới: kết thúc lần nữa
    expect(await t.refunds.sweep(new Date(later.getTime() + REFUND_STUCK_MS + 6 * MINUTE))).toMatchObject({ reasked: 1, gaveUp: 1 });
    expect((await refundsOf(t, r.pay.id))[0]).toMatchObject({ status: 'failed', failure_reason: 'gateway-no-answer' });
  });
  it('PAY-TC-20261013-193715799 (BR6, BR5): Refund failed tự thử lại về requested thì hạn 1 giờ tính lại từ lúc đó (requested_at mới), không bị đóng ngay dù đã tạo từ lâu', async () => {
    const now = t.clock.now();
    const pay = await succeeded();
    const id = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'failed', autoAttemptNo: 1, nextRetryAt: new Date(now.getTime() - 1000), requestedAt: new Date(now.getTime() - 300 * MINUTE), createdAt: new Date(now.getTime() - 300 * MINUTE) });
    t.gw.refundImpl = () => ({ kind: 'pending' });
    expect(await t.refunds.sweep(now)).toMatchObject({ retried: 1, gaveUp: 0 });
    const r = (await refundsOf(t, pay.id))[0];
    expect(r).toMatchObject({ id, status: 'requested', auto_attempt_no: 2 });
    expect(r.requested_at.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(await t.refunds.sweep(new Date(now.getTime() + 6 * MINUTE))).toMatchObject({ reasked: 1, gaveUp: 0 });
    expect((await refundsOf(t, pay.id))[0]).toMatchObject({ status: 'requested' });
  });
});
