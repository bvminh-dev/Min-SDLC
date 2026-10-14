import { truncateAll } from '../support/db';
import { attemptsOf, countOf, createPayApp, drain, ipn, ipnQuery, MINUTE, orderRow, payOutbox, payRow, pgCode, people, q, refundsOf, retry, seedPayment, type PayApp } from '../support/pay';
import { failReasonOf } from '../../src/modules/payment/vnpay';

// Thanh toán thất bại, đếm lượt, báo lượt cuối bằng is_final và đối soát quá thời gian (PAY-REQ-20261006-103110684).
describe('PAY thất bại và đối soát', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  const proc = (no: number, o: Parameters<typeof seedPayment>[1] = {}) => seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: no, attempts: 'auto', ...o });

  it('PAY-TC-20261006-104539555: lượt thử đầu thất bại (mã 24) phát PaymentFailed {attempt_no 1, is_final false, reason cancelled_by_user}; Payment sang failed, đơn vẫn pending (PAY không hủy đơn)', async () => {
    const pay = await proc(1);
    await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, code: '24' }));
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'failed', attempt_no: 1, version: 1 });
    const ev = await payOutbox(t);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'PaymentFailed', aggregate_id: pay.id });
    expect(ev[0].payload).toEqual({ payment_id: pay.id, order_id: pay.order.id, order_code: pay.order.code, user_id: p.a.id, reason: 'cancelled_by_user', attempt_no: 1, is_final: false });
    expect(JSON.stringify(ev[0].payload)).not.toMatch(/"24"|gateway|vnp_/); // không mã gốc của cổng
    await drain(t);
    expect(await orderRow(t, pay.order.id)).toMatchObject({ status: 'pending', payment_status: 'failed' }); // ORD chỉ hủy khi is_final
  });

  it('PAY-TC-20261006-104539587: lượt thứ ba thất bại là lượt cuối: reason declined, gateway_code 51, PaymentFailed {attempt_no 3, is_final true}; thử lại 409 attempts-exhausted; đổi PAY_MAX_ATTEMPTS = 2 thì lượt 2 là lượt cuối', async () => {
    const pay = await proc(3);
    await ipn(t, ipnQuery({ txnRef: pay.attempts[2].txnRef, amount: 350000, code: '51' }));
    expect((await attemptsOf(t, pay.id))[2]).toMatchObject({ status: 'failed', reason: 'declined', gateway_code: '51' });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'failed', attempt_no: 3 });
    expect((await payOutbox(t, 'PaymentFailed'))[0].payload).toMatchObject({ reason: 'declined', attempt_no: 3, is_final: true });
    const r = await retry(t, p.a.cookie, pay.id);
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:attempts-exhausted']);
    // cấu hình PAY_MAX_ATTEMPTS = 2 (hằng 3 không cứng trong mã)
    const two = await createPayApp({ env: { PAY_MAX_ATTEMPTS: '2' } });
    try {
      const x = await seedPayment(two, { status: 'processing', attemptNo: 2, attempts: 'auto' });
      expect((await ipn(two, ipnQuery({ txnRef: x.attempts[1].txnRef, amount: 350000, code: '24' }))).body.RspCode).toBe('00');
      expect((await payOutbox(two, 'PaymentFailed')).at(-1)?.payload).toMatchObject({ attempt_no: 2, is_final: true });
      const y = await seedPayment(two, { status: 'processing', attemptNo: 1, attempts: 'auto' });
      await ipn(two, ipnQuery({ txnRef: y.attempts[0].txnRef, amount: 350000, code: '24' }));
      expect((await payOutbox(two, 'PaymentFailed')).at(-1)?.payload).toMatchObject({ attempt_no: 1, is_final: false });
    } finally { await truncateAll(two.prisma); await two.close(); }
  });

  it('PAY-TC-20261006-104539621: đối soát lượt quá hạn 12 phút khi cổng báo không có giao dịch: lượt failed timeout, Payment failed, PaymentFailed {timeout, attempt_no 2}; cổng được hỏi đúng một lần dù hai job chạy song song (SKIP LOCKED)', async () => {
    const now = t.clock.now();
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 2, attempts: [{ no: 1, status: 'failed', reason: 'declined' }, { no: 2, status: 'processing', createdAt: new Date(now.getTime() - 12 * MINUTE), expiresAt: new Date(now.getTime() - 2 * MINUTE - 30_000) }] });
    const [a, b] = await Promise.all([t.reconcile.run(now), t.reconcile.run(now)]);
    expect(a.checked + b.checked).toBe(1);
    expect(t.gw.queries).toHaveLength(1);
    expect(t.gw.queries[0]).toMatchObject({ txnRef: pay.attempts[1].txnRef, amount: 350000n });
    expect((await attemptsOf(t, pay.id))[1]).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'failed', attempt_no: 2 });
    const ev = await payOutbox(t, 'PaymentFailed');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ reason: 'timeout', attempt_no: 2, is_final: false });
    await t.reconcile.run(new Date(now.getTime() + 10 * MINUTE)); // lượt đã chốt: không hỏi lại
    expect(t.gw.queries).toHaveLength(1);
  });

  it('PAY-TC-20261006-104539653: cổng truy vấn lỗi 500 thì lượt thử và Payment không đổi (hai lần chạy cách 1 phút, hai log cảnh báo, không PaymentFailed); cổng hồi phục và báo thất bại ở lần ba thì lượt failed timeout', async () => {
    const now = t.clock.now();
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [{ no: 1, status: 'processing', createdAt: new Date(now.getTime() - 16 * MINUTE), expiresAt: new Date(now.getTime() - 5 * MINUTE) }] });
    t.gw.queryImpl = () => ({ kind: 'error' });
    const run = async (n: number) => t.reconcile.run(new Date(now.getTime() + n * 60_000));
    expect((await run(0)).checked).toBe(1);
    expect((await run(1)).checked).toBe(1); // thuê dòng 50 giây: một phút sau thử lại
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing' });
    expect((await attemptsOf(t, pay.id))[0].status).toBe('processing');
    expect(await payOutbox(t)).toEqual([]);
    expect(t.logs.records.filter((r) => r.level === 'warn' && r.code === 'reconcile-gateway-error')).toHaveLength(2);
    expect((await run(1)).checked).toBe(0); // cùng phút: đang thuê, không hỏi lại
    t.gw.queryImpl = () => ({ kind: 'failed', code: '02', amount: 350000n });
    expect((await run(2)).resolved).toBe(1);
    expect((await attemptsOf(t, pay.id))[0]).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'failed' });
    t.gw.queryImpl = () => { throw new Error('cổng ném lỗi thường'); }; // lỗi lạ của cổng không làm job chết
    const other = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [{ no: 1, status: 'processing', createdAt: new Date(now.getTime() - 16 * MINUTE), expiresAt: new Date(now.getTime() - 5 * MINUTE) }] });
    await expect(run(3)).resolves.toMatchObject({ resolved: 0 });
    expect((await payRow(t, other.id)).status).toBe('processing');
  });

  it('PAY-TC-20261006-104539686: đối soát chỉ xử lý lượt quá hạn cộng hơn 2 phút (1 phút 59 giây thì chưa); lần chạy sau mới hỏi lượt còn lại', async () => {
    const base = t.clock.now();
    const mk = (expiresAt: Date) => seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [{ no: 1, status: 'processing', createdAt: new Date(base.getTime() - 20 * MINUTE), expiresAt }] });
    const a = await mk(new Date(base.getTime() + 10 * MINUTE)); // lượt A hết hạn tại base + 10 phút
    const b = await mk(new Date(base.getTime() + 9 * MINUTE)); // lượt B hết hạn sớm hơn A một phút
    const T0 = new Date(base.getTime() + 11 * MINUTE + 59_000); // A mới quá 1 phút 59 giây, B quá 2 phút 59 giây
    await t.reconcile.run(T0);
    expect(t.gw.queries.map((x) => x.txnRef)).toEqual([b.attempts[0].txnRef]);
    await t.reconcile.run(new Date(T0.getTime() + 2_000)); // A quá 2 phút 1 giây
    expect(t.gw.queries.map((x) => x.txnRef).sort()).toEqual([a.attempts[0].txnRef, b.attempts[0].txnRef].sort()); // B đã chốt nên không hỏi lại
    expect((await attemptsOf(t, b.id))[0].status).toBe('failed');
    expect((await attemptsOf(t, a.id))[0].status).toBe('failed');
  });

  it('PAY-TC-20261006-104539718 (T20): đối soát thấy cổng báo thành công (đủ số tiền) thì xử lý như webhook thành công: Payment succeeded, một PaymentSucceeded, không PaymentFailed, không Refund; lệch số tiền thì bỏ qua; đơn đã hết hạn thì hoàn late_payment', async () => {
    const now = t.clock.now();
    const stale = { no: 1, status: 'processing' as const, createdAt: new Date(now.getTime() - 15 * MINUTE), expiresAt: new Date(now.getTime() - 3 * MINUTE) };
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [stale] });
    t.gw.queryImpl = () => ({ kind: 'success', transactionNo: '14013001', amount: 350000n, code: '00' });
    expect((await t.reconcile.run(now)).resolved).toBe(1);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded', provider_ref: '14013001' });
    expect((await attemptsOf(t, pay.id))[0]).toMatchObject({ status: 'succeeded', provider_txn_no: '14013001' });
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect(await payOutbox(t, 'PaymentFailed')).toEqual([]);
    expect(await refundsOf(t, pay.id)).toEqual([]);
    // số tiền cổng báo lệch Payment: không tin, không đổi gì
    const mism = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [stale] });
    t.gw.queryImpl = () => ({ kind: 'success', transactionNo: '14013002', amount: 100n, code: '00' });
    expect((await t.reconcile.run(new Date(now.getTime() + 60_000))).resolved).toBe(0);
    expect(await payRow(t, mism.id)).toMatchObject({ status: 'processing' });
    expect(t.logs.records.some((r) => r.code === 'reconcile-amount-mismatch')).toBe(true);
    // đơn đã expired ở ORD khi cổng báo thành công muộn: Payment không đổi, Refund late_payment
    const hold = t.gw.hold();
    const late = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, orderStatus: 'expired', attempts: [{ no: 1, status: 'processing' as const, createdAt: stale.createdAt, expiresAt: stale.expiresAt }] });
    t.gw.queryImpl = (i) => ({ kind: 'success', transactionNo: `T${i.txnRef.slice(0, 12)}`, amount: 350000n, code: '00' }); // mỗi giao dịch cổng một mã (một mã không gắn được hai lượt)
    expect((await t.reconcile.run(new Date(now.getTime() + 120_000))).resolved).toBe(2);
    expect(await payRow(t, mism.id)).toMatchObject({ status: 'succeeded' }); // lần sau cổng báo đủ số tiền thì thành công
    expect(await payRow(t, late.id)).toMatchObject({ status: 'failed' });
    expect(await refundsOf(t, late.id)).toMatchObject([{ reason: 'late_payment', status: 'requested' }]);
    hold(); await t.refunds.idle();
  });

  /** Lượt `processing` quá hạn 10 phút (đã quá hạn cộng 2 phút) của Payment đã đóng; `exp`, `can`, `ref` là expired, cancelled và refunded (lượt 2 là lượt còn treo, lượt 1 là giao dịch đã hoàn). */
  const closedWithStale = async (now: Date) => {
    const stale = (no: number) => ({ no, status: 'processing' as const, createdAt: new Date(now.getTime() - 20 * MINUTE), expiresAt: new Date(now.getTime() - 10 * MINUTE) });
    const exp = await seedPayment(t, { user: p.a.id, status: 'expired', attemptNo: 1, attempts: [stale(1)], orderStatus: 'expired' });
    const can = await seedPayment(t, { user: p.a.id, status: 'cancelled', attemptNo: 1, attempts: [stale(1)], orderStatus: 'cancelled' });
    const ref = await seedPayment(t, { user: p.a.id, status: 'refunded', attemptNo: 2, providerRef: '14012345', attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }, stale(2)] });
    return { exp, can, ref, refAttempt: ref.attempts[1] };
  };

  it('PAY-TC-20261013-193715406 và PAY-TC-20261006-104539686 (REV-PAY-01, T20, T14): đối soát cả lượt processing của Payment đã đóng (expired, cancelled, refunded): cổng báo thành công thì lượt succeeded, Payment giữ nguyên, đúng một Refund mỗi giao dịch (late_payment, duplicate_payment cho refunded), chạy lại và IPN muộn không hoàn thêm', async () => {
    const now = t.clock.now();
    const { exp, can, ref, refAttempt } = await closedWithStale(now);
    const before = await Promise.all([exp, can, ref].map((x) => payRow(t, x.id)));
    t.gw.queryImpl = (i) => ({ kind: 'success', transactionNo: `T${i.txnRef.slice(0, 12)}`, amount: 350000n, code: '00' }); // mỗi giao dịch cổng một mã
    const hold = t.gw.hold();
    expect(await t.reconcile.run(now)).toEqual({ checked: 3, resolved: 3 }); // trước bản sửa REV-PAY-01: checked 0, tiền thu mà không ai phát hiện
    expect(t.gw.queries).toHaveLength(3);
    for (const [i, x] of [exp, can, ref].entries()) expect(await payRow(t, x.id)).toMatchObject({ status: before[i].status, version: before[i].version, provider_ref: before[i].provider_ref }); // Payment đã đóng không đổi
    expect((await attemptsOf(t, exp.id))[0]).toMatchObject({ status: 'succeeded', gateway_code: '00' });
    expect((await attemptsOf(t, ref.id))[1]).toMatchObject({ status: 'succeeded' });
    expect(await refundsOf(t, exp.id)).toMatchObject([{ reason: 'late_payment', status: 'requested', attempt_id: exp.attempts[0].id, amount: '350000' }]);
    expect(await refundsOf(t, can.id)).toMatchObject([{ reason: 'late_payment', status: 'requested', attempt_id: can.attempts[0].id }]);
    expect(await refundsOf(t, ref.id)).toMatchObject([{ reason: 'duplicate_payment', status: 'requested', attempt_id: refAttempt.id }]);
    expect(await payOutbox(t, 'PaymentSucceeded', 'PaymentFailed', 'PaymentRefunded')).toEqual([]); // không phát PaymentSucceeded cho Payment đã đóng
    hold(); await t.refunds.idle();
    expect(t.gw.distinctRefundRequests).toBe(3);
    expect((await Promise.all([exp, can, ref].map((x) => refundsOf(t, x.id)))).flat().map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(await payRow(t, exp.id)).toMatchObject({ status: 'expired' }); // hoàn muộn, trùng không đổi Payment đã đóng
    // idempotent: chạy lại (qua thời gian thuê) và IPN muộn của cùng giao dịch không hoàn thêm
    t.gw.queries = [];
    expect(await t.reconcile.run(new Date(now.getTime() + 5 * MINUTE))).toEqual({ checked: 0, resolved: 0 });
    expect((await ipn(t, ipnQuery({ txnRef: exp.attempts[0].txnRef, amount: 350000, txNo: `T${exp.attempts[0].txnRef.slice(0, 12)}` }))).body.RspCode).toBe('02');
    expect(t.gw.queries).toEqual([]);
    expect(await countOf(t, 'refunds')).toBe(3);
    expect(t.gw.distinctRefundRequests).toBe(3);
  });

  it('PAY-TC-20261013-193715507 (REV-PAY-01, T20): đối soát lượt processing của Payment đã đóng mà cổng báo thất bại (mã 24) hay không có giao dịch thì chỉ ghi lượt failed (timeout), Payment không đổi, không Refund, không PaymentFailed', async () => {
    const now = t.clock.now();
    const { exp, can, ref } = await closedWithStale(now);
    const before = await Promise.all([exp, can, ref].map((x) => payRow(t, x.id)));
    t.gw.queryImpl = (i) => (i.txnRef === exp.attempts[0].txnRef ? { kind: 'failed', code: '24', amount: 350000n } : { kind: 'not_found' });
    expect(await t.reconcile.run(now)).toEqual({ checked: 3, resolved: 3 });
    expect(await attemptsOf(t, exp.id)).toMatchObject([{ status: 'failed', reason: 'timeout', gateway_code: '24' }]);
    expect(await attemptsOf(t, can.id)).toMatchObject([{ status: 'failed', reason: 'timeout' }]);
    expect((await attemptsOf(t, ref.id)).map((a) => a.status)).toEqual(['succeeded', 'failed']); // giao dịch đã hoàn giữ nguyên
    for (const [i, x] of [exp, can, ref].entries()) expect(await payRow(t, x.id)).toMatchObject({ status: before[i].status, version: before[i].version });
    expect(await countOf(t, 'refunds')).toBe(0);
    expect(await payOutbox(t)).toEqual([]);
    expect(t.gw.refundCalls).toEqual([]);
    // cổng lỗi thì giữ nguyên lượt và thử lại sau (không đóng lượt khi chưa quá hạn)
    const again = await seedPayment(t, { user: p.a.id, status: 'expired', attemptNo: 1, orderStatus: 'expired', attempts: [{ no: 1, status: 'processing', createdAt: new Date(now.getTime() - 20 * MINUTE), expiresAt: new Date(now.getTime() - 10 * MINUTE) }] });
    t.gw.queryImpl = () => ({ kind: 'error' });
    expect(await t.reconcile.run(new Date(now.getTime() + 2 * MINUTE))).toEqual({ checked: 1, resolved: 0 });
    expect((await attemptsOf(t, again.id))[0]).toMatchObject({ status: 'processing' });
  });

  it('PAY-TC-20261006-104539555 (PAY-DB mục 3): IPN thất bại của lượt cũ khi Payment đang processing ở lượt mới hơn chỉ ghi lượt cũ, không đổi Payment và không PaymentFailed', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 2, attempts: [{ no: 1, status: 'processing' }, { no: 2, status: 'processing' }] });
    expect((await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, code: '24' }))).body.RspCode).toBe('00');
    expect((await attemptsOf(t, pay.id)).map((a) => a.status)).toEqual(['failed', 'processing']);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', attempt_no: 2 });
    expect(await payOutbox(t, 'PaymentFailed')).toEqual([]);
  });

  it('PAY-TC-20261006-104539718 (T20, K-02): đối soát lượt thử còn processing của Payment đã succeeded: cổng báo thành công (giao dịch khác) thì hoàn duplicate_payment, báo không có giao dịch thì lượt failed timeout mà Payment và event không đổi', async () => {
    const now = t.clock.now();
    const stale = (no: number) => ({ no, status: 'processing' as const, createdAt: new Date(now.getTime() - 20 * MINUTE), expiresAt: new Date(now.getTime() - 5 * MINUTE) });
    const hold = t.gw.hold();
    const dup = await seedPayment(t, { user: p.a.id, status: 'succeeded', providerRef: '14012345', attemptNo: 2, attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }, stale(2)] });
    t.gw.queryImpl = () => ({ kind: 'success', transactionNo: '14012399', amount: 350000n, code: '00' });
    await t.reconcile.run(now);
    expect(await refundsOf(t, dup.id)).toMatchObject([{ reason: 'duplicate_payment', attempt_id: dup.attempts[1].id }]);
    expect(await payRow(t, dup.id)).toMatchObject({ status: 'succeeded', provider_ref: '14012345' });
    hold(); await t.refunds.idle();
    const none = await seedPayment(t, { user: p.a.id, status: 'succeeded', providerRef: '14012346', attemptNo: 2, attempts: [{ no: 1, status: 'succeeded', txNo: '14012346' }, stale(2)] });
    t.gw.queryImpl = () => ({ kind: 'not_found' });
    await t.reconcile.run(now);
    expect((await attemptsOf(t, none.id))[1]).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(await payRow(t, none.id)).toMatchObject({ status: 'succeeded', version: 0 });
    expect(await payOutbox(t, 'PaymentFailed')).toEqual([]);
    expect(await refundsOf(t, none.id)).toEqual([]);
  });

  it('PAY-TC-20261006-130000400 (M-06, R-18): IPN thất bại ánh xạ mã cổng sang reason là mã cố định (24 cancelled_by_user, 51 declined, 99 other), mã gốc chỉ ở gateway_code và không có trong event; timeout do đối soát; enum chặn giá trị ngoài bốn mã', async () => {
    const out: string[][] = [];
    for (const code of ['24', '51', '99']) {
      const pay = await proc(1);
      await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, code }));
      const a = (await attemptsOf(t, pay.id))[0];
      out.push([code, a.reason as string, a.gateway_code as string]);
    }
    expect(out).toEqual([['24', 'cancelled_by_user', '24'], ['51', 'declined', '51'], ['99', 'other', '99']]);
    const ev = await payOutbox(t, 'PaymentFailed');
    expect(ev.map((e) => [e.payload.reason, e.payload.attempt_no, e.payload.is_final])).toEqual([['cancelled_by_user', 1, false], ['declined', 1, false], ['other', 1, false]]);
    for (const e of ev) { expect(Object.keys(e.payload).sort()).toEqual(['attempt_no', 'is_final', 'order_code', 'order_id', 'payment_id', 'reason', 'user_id']); expect(JSON.stringify(e.payload)).not.toMatch(/gateway|vnp_|"(24|51|99)"/); }
    // thành công cổng nhưng TransactionStatus khác 00 vẫn là thất bại; mã khác ánh xạ cố định
    expect(['07', '09', '10', '12', '13', '65', '79'].map(failReasonOf)).toEqual(Array(7).fill('declined'));
    expect([failReasonOf('11'), failReasonOf('75'), failReasonOf('xx'), failReasonOf('')]).toEqual(['timeout', 'other', 'other', 'other']);
    const odd = await proc(1);
    await ipn(t, ipnQuery({ txnRef: odd.attempts[0].txnRef, amount: 350000, code: '00', status: '02' }));
    expect((await attemptsOf(t, odd.id))[0]).toMatchObject({ status: 'failed', reason: 'other' });
    // reconcile timeout
    const now = t.clock.now();
    const slow = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [{ no: 1, status: 'processing', createdAt: new Date(now.getTime() - 15 * MINUTE), expiresAt: new Date(now.getTime() - 5 * MINUTE) }] });
    await t.reconcile.run(now);
    expect((await payOutbox(t, 'PaymentFailed')).at(-1)?.payload).toMatchObject({ reason: 'timeout', attempt_no: 1, is_final: false });
    expect((await attemptsOf(t, slow.id))[0].gateway_code).toBeNull();
    // enum payment_fail_reason chặn giá trị ngoài bốn mã (gateway_error, customer_cancelled)
    for (const bad of ['gateway_error', 'customer_cancelled']) expect(await pgCode(q(t, `UPDATE payment_attempts SET status = 'failed', reason = '${bad}' WHERE id = '${slow.attempts[0].id}'`))).toBe('22P02');
    expect(await countOf(t, 'payment_attempts', `reason IS NOT NULL AND reason::text NOT IN ('cancelled_by_user', 'declined', 'timeout', 'other')`)).toBe(0);
  });
});
