import { truncateAll } from '../support/db';
import { attemptsOf, countOf, createPayApp, ipn, ipnQuery, MINUTE, payOutbox, payRow, people, refundsOf, seedPayment, txNoOf, type PayApp } from '../support/pay';
import { JOB_BATCH, RECONCILE_CLOSED_WINDOW_MS } from '../../src/modules/payment/config';

// Job đối soát lượt thử (PAY-REQ-20261006-103110684 BR5, PAY-DB mục 9) với Payment đã đóng: giới hạn lô, hạn thời gian và đóng lượt khi không chắc (REV-PAY-01).
const DAY = 24 * 60 * MINUTE;
describe('PAY job đối soát lượt thử: Payment đã đóng, giới hạn lô và đóng khi không chắc', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); });
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  const expiredAgo = (now: Date, ms: number) => [{ no: 1, status: 'processing' as const, createdAt: new Date(now.getTime() - ms - 10 * MINUTE), expiresAt: new Date(now.getTime() - ms) }];
  const closed = (now: Date, ms: number, status: 'expired' | 'cancelled' | 'refunded' = 'expired') => seedPayment(t, { user: p.a.id, status, attemptNo: 1, orderStatus: status === 'refunded' ? 'paid' : status, attempts: expiredAgo(now, ms) });

  it('PAY-TC-20261013-193715606 (job `payment-reconcile`, Job đối soát lượt thử (REQ 684 BR5), SB-34): Payment đã đóng chịu giới hạn lô: mỗi lượt tối đa JOB_BATCH dòng, cổng luôn lỗi không chặn lượt còn lại, lượt đã chốt không bị hỏi lại (idempotent)', async () => {
    const now = t.clock.now();
    const N = JOB_BATCH + 3;
    for (let i = 0; i < N; i++) await closed(now, 10 * MINUTE, i % 2 ? 'cancelled' : 'expired');
    t.gw.queryImpl = () => ({ kind: 'error' });
    expect((await t.reconcile.run(now)).checked).toBe(JOB_BATCH);
    expect((await t.reconcile.run(new Date(now.getTime() + 2 * MINUTE))).checked).toBe(JOB_BATCH); // lượt vừa thuê xuống cuối hàng
    expect(new Set(t.gw.queries.map((x) => x.txnRef)).size).toBe(N);
    expect(await countOf(t, 'payment_attempts', `status = 'processing'`)).toBe(N); // cổng lỗi: không đóng lượt, không Refund, Payment không đổi
    expect(await countOf(t, 'refunds')).toBe(0);
    // cổng trả lời thì chốt hết; lần chạy tiếp theo không hỏi lại lượt đã chốt
    t.gw.queries = [];
    t.gw.queryImpl = () => ({ kind: 'not_found' });
    expect((await t.reconcile.run(new Date(now.getTime() + 4 * MINUTE))).resolved).toBe(JOB_BATCH);
    expect((await t.reconcile.run(new Date(now.getTime() + 4 * MINUTE))).resolved).toBe(3);
    expect(await t.reconcile.run(new Date(now.getTime() + 8 * MINUTE))).toEqual({ checked: 0, resolved: 0 });
    expect(t.gw.queries).toHaveLength(N);
  }, 120_000);

  it('PAY-TC-20261013-193715697 (job `payment-reconcile`, Job đối soát lượt thử (REQ 684 BR5), SB-34): lượt của Payment đã đóng mà cổng không chốt được quá hạn thời gian RECONCILE_CLOSED_WINDOW_MS (cổng lỗi, số tiền lệch, trùng mã giao dịch) thì bị đóng failed timeout kèm log error; lượt chưa quá hạn, và lượt của Payment còn mở thì không; IPN thành công về muộn sau đó vẫn hoàn tiền', async () => {
    const now = t.clock.now();
    const old = RECONCILE_CLOSED_WINDOW_MS + DAY, young = RECONCILE_CLOSED_WINDOW_MS - DAY;
    const errOld = await closed(now, old), mismatch = await closed(now, old, 'cancelled'), dup = await closed(now, old), errYoung = await closed(now, young);
    const open = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: expiredAgo(now, old) }); // Payment còn mở: không bao giờ bị đóng lượt vì quá hạn
    const taken = txNoOf();
    await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, providerRef: taken, attempts: [{ no: 1, status: 'succeeded', txNo: taken }] });
    t.gw.queryImpl = (i) => {
      if (i.txnRef === mismatch.attempts[0].txnRef) return { kind: 'success', transactionNo: txNoOf(), amount: 100n, code: '00' }; // số tiền lệch
      if (i.txnRef === dup.attempts[0].txnRef) return { kind: 'success', transactionNo: taken, amount: 350000n, code: '00' }; // mã giao dịch đã gắn lượt khác
      return { kind: 'error' };
    };
    t.logs.clear();
    const r = await t.reconcile.run(now);
    expect(r).toEqual({ checked: 5, resolved: 3 });
    for (const x of [errOld, mismatch, dup]) expect(await attemptsOf(t, x.id)).toMatchObject([{ status: 'failed', reason: 'timeout' }]);
    expect(await payRow(t, errOld.id)).toMatchObject({ status: 'expired', version: 0 });
    expect((await attemptsOf(t, errYoung.id))[0].status).toBe('processing');
    expect((await attemptsOf(t, open.id))[0].status).toBe('processing');
    const errs = t.logs.records.filter((x) => x.level === 'error' && x.code === 'reconcile-closed-unresolved');
    expect(errs.map((x) => [x.order_code, x.why]).sort()).toEqual([[errOld.order.code, 'gateway_error'], [mismatch.order.code, 'amount_mismatch'], [dup.order.code, 'duplicate_txn']].sort());
    expect(await countOf(t, 'refunds')).toBe(0);
    expect(await payOutbox(t)).toEqual([]);
    // IPN thành công của lượt đã đóng vì quá hạn vẫn được nhận: tiền thật thì hoàn (late_payment), không mất dấu
    const release = t.gw.hold();
    const late = await ipn(t, ipnQuery({ txnRef: errOld.attempts[0].txnRef, amount: 350000, txNo: txNoOf() }));
    expect(late.body.RspCode).toBe('00');
    expect(await refundsOf(t, errOld.id)).toMatchObject([{ reason: 'late_payment', status: 'requested', attempt_id: errOld.attempts[0].id }]);
    expect(await payRow(t, errOld.id)).toMatchObject({ status: 'expired' });
    release(); await t.refunds.idle();
  }, 120_000);
});
