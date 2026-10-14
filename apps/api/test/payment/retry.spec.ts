import { truncateAll } from '../support/db';
import {
  attemptsOf, countOf, createPayApp, drain, initiate, ipn, ipnQuery, MINUTE, orderRow, payOutbox, payRow, pgCode, people, q, retry, seedPayment, type PayApp,
} from '../support/pay';

// Thử lại thanh toán online (PAY-REQ-20261006-103110771) và đếm lượt (PAY-REQ-20261006-103110684 BR3, BR4, T19).
const iso = (d: Date) => d.toISOString();
describe('PAY thử lại thanh toán', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });

  it('PAY-TC-20261006-104539749: thử lại lượt 2 khi còn 8 phút: attempt_no 2, mã tham chiếu mới kết thúc bằng 02, hạn đường dẫn bằng hạn Payment (8 phút, không phải 10); không event', async () => {
    const now = t.clock.now();
    const pay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', expiresAt: new Date(now.getTime() + 8 * MINUTE) });
    const r = await retry(t, p.a.cookie, pay.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ attempt_no: 2, status: 'processing', max_attempts: 3, expires_at: iso(new Date(now.getTime() + 8 * MINUTE)) });
    const ref = new URL(r.body.redirect_url).searchParams.get('vnp_TxnRef') as string;
    expect(ref).toMatch(/^[0-9a-f]{16}02$/);
    expect(ref).not.toBe(pay.attempts[0].txnRef);
    const a = await attemptsOf(t, pay.id);
    expect(a.map((x) => [x.attempt_no, x.status])).toEqual([[1, 'failed'], [2, 'processing']]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', attempt_no: 2 });
    expect(await payOutbox(t)).toEqual([]);
  });

  it('PAY-TC-20261006-104539782: hết lượt, đơn đã đóng hoặc Payment không ở failed thì không thử lại được (đúng mã, đúng thứ tự); không lượt thử mới', async () => {
    const pa = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 3, attempts: 'auto' });
    const pb = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', orderStatus: 'expired' });
    const pc = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const pd = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const pe = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', expiresAt: new Date(t.clock.now().getTime() - 1000) });
    const pf = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const out: string[] = [];
    for (const x of [pa, pb, pc, pd, pe, pf]) { const r = await retry(t, p.a.cookie, x.id); out.push(`${r.status} ${String(r.body.type).replace('urn:ecom:error:', '')}`); }
    expect(out).toEqual(['409 attempts-exhausted', '409 order-not-pending', '409 payment-not-retryable', '409 payment-not-retryable', '409 payment-expired', '409 payment-not-retryable']);
    expect(await countOf(t, 'payment_attempts')).toBe(3 + 1 + 1 + 1 + 1); // chỉ lượt dựng sẵn
    expect((await payRow(t, pa.id)).attempt_no).toBe(3);
    const codeless = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending' });
    expect((await retry(t, p.a.cookie, codeless.id)).body.type).toBe('urn:ecom:error:payment-not-retryable'); // COD không có thử lại
  });

  it('PAY-TC-20261006-104539817: guest 401, staff 403, admin 403, customer khác 404 theo thứ tự; không đổi gì', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto' });
    const r = [await retry(t, undefined, pay.id), await retry(t, p.staff.cookie, pay.id), await retry(t, p.admin.cookie, pay.id), await retry(t, p.b.cookie, pay.id)];
    expect(r.map((x) => x.status)).toEqual([401, 403, 403, 404]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'failed', attempt_no: 1 });
    expect(await attemptsOf(t, pay.id)).toHaveLength(1);
  });

  it('PAY-TC-20261006-104539848: lượt thứ ba thất bại phát PaymentFailed {attempt_no 3, is_final true}; thử lại tiếp thì 409 attempts-exhausted', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 2, attempts: 'auto' });
    const r = await retry(t, p.a.cookie, pay.id);
    expect([r.status, r.body.attempt_no, r.body.status]).toEqual([200, 3, 'processing']);
    const ref = new URL(r.body.redirect_url).searchParams.get('vnp_TxnRef') as string;
    expect((await ipn(t, ipnQuery({ txnRef: ref, amount: 350000, code: '51' }))).body.RspCode).toBe('00');
    const ev = await payOutbox(t, 'PaymentFailed');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ payment_id: pay.id, order_id: pay.order.id, attempt_no: 3, is_final: true, reason: 'declined' });
    const again = await retry(t, p.a.cookie, pay.id);
    expect([again.status, again.body.type]).toEqual([409, 'urn:ecom:error:attempts-exhausted']);
    expect(await attemptsOf(t, pay.id)).toHaveLength(3);
  });

  it('PAY-TC-20261006-104539882 (T19, SB-24, SB-25): 5 yêu cầu thử lại song song chỉ tạo một lượt thử (cả năm nhận cùng redirect_url); sau lượt 2, 3 thất bại thì 5 yêu cầu song song đều 409 attempts-exhausted và attempt_no không vượt 3; CHECK trần schema và unique còn nguyên', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto' });
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => retry(t, p.a.cookie, pay.id)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(rs.map((r) => r.body.redirect_url)).size).toBe(1);
    expect(await attemptsOf(t, pay.id)).toHaveLength(2);
    expect((await payRow(t, pay.id)).attempt_no).toBe(2);
    const ref2 = (await attemptsOf(t, pay.id))[1].txn_ref;
    await ipn(t, ipnQuery({ txnRef: ref2, amount: 350000, code: '24' }));
    const r3 = await retry(t, p.a.cookie, pay.id);
    expect(r3.body.attempt_no).toBe(3);
    await ipn(t, ipnQuery({ txnRef: new URL(r3.body.redirect_url).searchParams.get('vnp_TxnRef') as string, amount: 350000, code: '24' }));
    expect((await payRow(t, pay.id))).toMatchObject({ status: 'failed', attempt_no: 3 });
    t.clock.advance(61_000); // sang cửa sổ giới hạn tần suất mới
    const blocked = await Promise.all([1, 2, 3, 4, 5].map(() => retry(t, p.a.cookie, pay.id)));
    expect(blocked.map((r) => [r.status, r.body.type])).toEqual(Array(5).fill([409, 'urn:ecom:error:attempts-exhausted']));
    expect((await payRow(t, pay.id)).attempt_no).toBe(3);
    expect(await attemptsOf(t, pay.id)).toHaveLength(3);
    // trần của schema: ứng dụng dừng ở PAY_MAX_ATTEMPTS, CHECK chỉ là lớp bảo vệ thứ hai; unique (payment_id, attempt_no)
    expect(await pgCode(q(t, `UPDATE payments SET attempt_no = 11 WHERE id = '${pay.id}'`))).toBe('23514');
    expect(await pgCode(q(t, `INSERT INTO payment_attempts (payment_id, attempt_no, txn_ref, status, create_date, expires_at) VALUES ('${pay.id}', 3, '${'a'.repeat(16)}03', 'processing', now(), now() + interval '1 minute')`))).toBe('23505');
  });

  it('PAY-TC-20261006-104539914: thử lại đúng lúc hết hạn: còn 1 giây thì đường dẫn sống 1 giây (không âm); đúng expires_at thì 409 payment-expired, không lượt thử', async () => {
    const now = t.clock.now();
    const a = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', expiresAt: new Date(now.getTime() + 1_000) });
    const b = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', expiresAt: new Date(now.getTime()) });
    const ra = await retry(t, p.a.cookie, a.id), rb = await retry(t, p.a.cookie, b.id);
    expect([ra.status, ra.body.expires_at]).toEqual([200, iso(new Date(now.getTime() + 1_000))]);
    expect([rb.status, rb.body.type]).toEqual([409, 'urn:ecom:error:payment-expired']);
    expect(await attemptsOf(t, b.id)).toHaveLength(1);
  });

  it('PAY-TC-20261006-150000200 (T19): khách hủy ở cổng cả ba lượt vẫn tiêu đủ lượt: PaymentFailed {cancelled_by_user, attempt_no 1, 2 rồi 3 (is_final true)}; ORD hủy đơn, PAY đóng Payment thành cancelled; thử lại nữa 409', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    let res = await initiate(t, p.a.cookie, pay.id);
    for (let n = 1; n <= 3; n++) {
      expect(res.status).toBe(200);
      const ref = new URL(res.body.redirect_url).searchParams.get('vnp_TxnRef') as string;
      expect((await ipn(t, ipnQuery({ txnRef: ref, amount: 350000, code: '24' }))).body.RspCode).toBe('00');
      expect(await payRow(t, pay.id)).toMatchObject({ status: 'failed', attempt_no: n });
      if (n < 3) res = await retry(t, p.a.cookie, pay.id);
    }
    const ev = (await payOutbox(t, 'PaymentFailed')).map((e) => e.payload);
    expect(ev.map((e) => [e.reason, e.attempt_no, e.is_final])).toEqual([['cancelled_by_user', 1, false], ['cancelled_by_user', 2, false], ['cancelled_by_user', 3, true]]);
    expect((await orderRow(t, pay.order.id)).status).toBe('pending'); // chưa tới ORD
    await drain(t);
    expect(await orderRow(t, pay.order.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'payment_failed' });
    expect((await payRow(t, pay.id)).status).toBe('cancelled');
    t.clock.advance(61_000);
    const last = await retry(t, p.a.cookie, pay.id);
    expect([last.status, last.body.type]).toEqual([409, 'urn:ecom:error:payment-not-retryable']); // Payment đã cancelled
    expect(await attemptsOf(t, pay.id)).toHaveLength(3);
  });
});
