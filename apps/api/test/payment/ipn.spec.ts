import { truncateAll } from '../support/db';
import { ipOf, setIpHops } from '../../src/modules/payment/http';
import { normalizeIp } from '../../src/modules/platform';
import {
  attemptsOf, countOf, createPayApp, deliver, ipn, ipnQuery, logsOf, payOutbox, payRow, pgCode, q, race, refundsOf, seedPayment, SECRET, snapshot, type PayApp,
} from '../support/pay';

// IPN của VNPay (PAY-REQ-20261006-103110513): chữ ký, mã tham chiếu, số tiền, idempotent, phát lại, đồng thời, thanh toán muộn và trùng, giới hạn tần suất, nhật ký chỉ thêm.
const nodeCrypto = jest.requireActual<typeof import('node:crypto')>('node:crypto'); // đối tượng module thật (không phải bản sao của import): spyOn được
const BODY = (code: string, message: string) => ({ RspCode: code, Message: message });
const OK = BODY('00', 'Confirm Success');
describe('PAY nhận IPN của VNPay', () => {
  let t: PayApp;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); });
  const processing = (o: Parameters<typeof seedPayment>[1] = {}) => seedPayment(t, { status: 'processing', attemptNo: 1, attempts: 'auto', ...o });

  it('PAY-TC-20261006-104539001: IPN thành công hợp lệ được xác nhận (đúng thân 00 Confirm Success); lượt thử và Payment succeeded; một dòng nhật ký với payload đã che (không chữ ký, không khóa ký)', async () => {
    const pay = await processing();
    const ref = pay.attempts[0].txnRef;
    const v0 = (await payRow(t, pay.id)).version;
    const r = await ipn(t, ipnQuery({ txnRef: ref, amount: 350000, txNo: '14012345' }));
    expect([r.status, r.body]).toEqual([200, OK]);
    expect(Object.keys(r.body).sort()).toEqual(['Message', 'RspCode']);
    const a = (await attemptsOf(t, pay.id))[0];
    expect(a).toMatchObject({ status: 'succeeded', provider_txn_no: '14012345', reason: null });
    const row = await payRow(t, pay.id);
    expect(row).toMatchObject({ status: 'succeeded', provider_ref: '14012345' });
    expect(row.version).toBe(v0 + 1); // mỗi chuyển trạng thái tăng version đúng 1 (khóa lạc quan, PAY-DB)
    expect(row.paid_at?.toISOString()).toBe(t.clock.now().toISOString());
    const logs = await logsOf(t, ref);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ signature_valid: true, rsp_code: '00', result: 'confirmed_success', payment_id: pay.id });
    expect(Object.keys(logs[0].payload).every((k) => ['vnp_TxnRef', 'vnp_Amount', 'vnp_ResponseCode', 'vnp_TransactionStatus', 'vnp_TransactionNo', 'vnp_BankCode', 'vnp_PayDate'].includes(k))).toBe(true);
    expect(logs[0].payload).toMatchObject({ vnp_TxnRef: ref, vnp_Amount: '35000000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '14012345' });
    const dump = JSON.stringify(await q(t, 'SELECT * FROM payment_webhook_logs'));
    expect(dump).not.toMatch(/SecureHash|vnp_TmnCode|test-vnpay|[0-9a-f]{128}/);
  });

  it('PAY-TC-20261006-104539033: IPN thất bại do khách hủy ở cổng (mã 24): lượt thử failed reason cancelled_by_user, mã gốc chỉ ở gateway_code; nhật ký confirmed_failure', async () => {
    const pay = await processing();
    const r = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, code: '24' }));
    expect([r.status, r.body]).toEqual([200, OK]);
    expect((await attemptsOf(t, pay.id))[0]).toMatchObject({ status: 'failed', reason: 'cancelled_by_user', gateway_code: '24' });
    expect((await logsOf(t))[0]).toMatchObject({ result: 'confirmed_failure', rsp_code: '00' });
    expect(JSON.stringify(r.body)).not.toContain('24');
  });

  it('PAY-TC-20261006-104539065 (T1, SB-22): IPN sai chữ ký (sửa tham số, thiếu hay rỗng chữ ký, tham số lặp) nhận RspCode 97, không đổi gì, không event; log bảo mật không in tham số hay khóa; so sánh chữ ký không đổi thời gian', async () => {
    const pay = await processing();
    const ref = pay.attempts[0].txnRef;
    const good = ipnQuery({ txnRef: ref, amount: 350000 });
    const before = await snapshot(t);
    const bad: Record<string, string | string[]>[] = [
      { ...good, vnp_Amount: '100' }, // sửa số tiền, giữ nguyên chữ ký
      Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'vnp_SecureHash')),
      { ...good, vnp_SecureHash: '' },
      { ...good, vnp_SecureHash: 'abc' },
      { ...good, vnp_SecureHash: good.vnp_SecureHash.toUpperCase().slice(0, 127) + 'Z' },
      { ...good, vnp_ResponseCode: '24' },
      { ...good, vnp_TxnRef: 'ffffffffffffffff99' },
      { ...good, vnp_Unsigned: '1' }, // thêm tham số vnp_ chưa ký
      { ...good, vnp_TxnRef: [ref, ref] }, // tham số lặp (qs thành mảng)
      { ...good, vnp_Extra: ['a', 'b'] }, // tham số vnp_ dạng mảng KHÔNG nằm trong phần đã ký: chữ ký các tham số chuỗi vẫn đúng nhưng gói vẫn bị từ chối (hình dạng sai)
    ];
    for (const q_ of bad) {
      const r = await ipn(t, q_ as Record<string, string>);
      expect([r.status, r.body.RspCode]).toEqual([200, '97']);
      expect(r.body).toEqual(BODY('97', 'Invalid signature'));
    }
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', provider_ref: null });
    expect((await attemptsOf(t, pay.id))[0].status).toBe('processing');
    expect(await payOutbox(t)).toEqual([]);
    const logs = await logsOf(t);
    expect(logs).toHaveLength(bad.length);
    expect(logs.every((l) => !l.signature_valid && l.rsp_code === '97' && l.result === 'invalid_signature')).toBe(true);
    expect(await snapshot(t)).toEqual([before[0], before[1], before[2], before[3] + bad.length, before[4], before[5], before[6]]); // chỉ thêm dòng nhật ký
    const out = t.logs.lines.join('\n');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(good.vnp_SecureHash);
    expect(out).not.toMatch(/vnp_Amount|vnp_SecureHash|35000000/); // không in tham số
    expect(t.logs.records.filter((r) => r.code === 'ipn-invalid-signature')).toHaveLength(bad.length);
    // so sánh không đổi thời gian: mỗi chữ ký đúng độ dài đi qua timingSafeEqual, chữ ký sai độ dài bị loại trước
    const spy = jest.spyOn(nodeCrypto, 'timingSafeEqual');
    await ipn(t, { ...good, vnp_Amount: '100' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await ipn(t, { ...good, vnp_SecureHash: 'abc' });
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockClear();
    expect((await ipn(t, good)).body.RspCode).toBe('00');
    expect(spy).toHaveBeenCalledTimes(1);
    // ký bằng khóa khác cũng sai
    const other = await processing();
    expect((await ipn(t, ipnQuery({ txnRef: other.attempts[0].txnRef, amount: 350000, secret: 'khoa-khac-hoan-toan' }))).body.RspCode).toBe('97');
    expect((await payRow(t, other.id)).status).toBe('processing');
  });

  it('PAY-TC-20261006-104539098: IPN chữ ký đúng nhưng mã tham chiếu lạ: RspCode 01, không đổi gì; nhật ký unknown_txn với payment_id rỗng', async () => {
    const pay = await processing();
    const r = await ipn(t, ipnQuery({ txnRef: 'ffffffffffffffff99', amount: 350000 }));
    expect([r.status, r.body]).toEqual([200, BODY('01', 'Order not found')]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing' });
    expect(await logsOf(t)).toMatchObject([{ result: 'unknown_txn', rsp_code: '01', payment_id: null, signature_valid: true }]);
    // mã lạ không phải khuôn txn_ref: vẫn 01, không ghi chuỗi lạ vào cột txn_ref của nhật ký
    const weird = await ipn(t, ipnQuery({ txnRef: "x'; DROP TABLE payments;--", amount: 350000 }));
    expect(weird.body.RspCode).toBe('01');
    expect((await logsOf(t)).at(-1)).toMatchObject({ txn_ref: null });
    expect(await countOf(t, 'payments')).toBe(1);
  });

  it('PAY-TC-20261006-104539131 (T2, SB-23): IPN ký đúng nhưng số tiền không khớp Payment (10000 tức 100 đồng, không chia hết cho 100, chữ): RspCode 04, lượt thử và Payment không đổi, không PaymentSucceeded; log bảo mật có mã đơn và hai số tiền', async () => {
    const pay = await processing({ orderCode: '7K3M9Q2XH4TB' });
    const ref = pay.attempts[0].txnRef;
    for (const amount of ['10000', '35000050', '0', '-35000000', 'abc', '35000000000000000000000', '035000000x']) {
      const r = await ipn(t, ipnQuery({ txnRef: ref, amount }));
      expect([amount, r.body.RspCode]).toEqual([amount, '04']);
    }
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing' });
    expect((await attemptsOf(t, pay.id))[0].status).toBe('processing');
    expect(await payOutbox(t)).toEqual([]);
    expect((await logsOf(t, ref)).every((l) => l.result === 'amount_mismatch' && l.rsp_code === '04')).toBe(true);
    const sec = t.logs.records.filter((r) => r.code === 'ipn-amount-mismatch');
    expect(sec.length).toBe(7);
    expect(sec[0]).toMatchObject({ order_code: '7K3M9Q2XH4TB', expected: 350000, got: '10000' });
    expect(t.logs.lines.join('\n')).not.toContain(SECRET);
    // số tiền Payment không bao giờ lấy từ gói tin: IPN đúng số tiền thì mới thành công
    expect((await ipn(t, ipnQuery({ txnRef: ref, amount: 350000 }))).body.RspCode).toBe('00');
    expect((await payRow(t, pay.id)).amount).toBe('350000');
  });

  it('PAY-TC-20261006-104539164 (T3, SB-22): IPN thành công gửi lại và IPN thất bại cũ gửi lại đều nhận 02 và không đổi gì (chỉ một PaymentSucceeded, không Refund)', async () => {
    const pay = await seedPayment(t, { status: 'processing', attemptNo: 2, attempts: [{ no: 1, status: 'failed', reason: 'declined' }, { no: 2, status: 'processing' }] });
    const [t1, t2] = pay.attempts.map((a) => a.txnRef);
    expect((await ipn(t, ipnQuery({ txnRef: t2, amount: 350000, txNo: '14012345' }))).body).toEqual(OK);
    const paidAt = (await payRow(t, pay.id)).paid_at;
    t.clock.advance(60_000);
    const replay = ipnQuery({ txnRef: t2, amount: 350000, txNo: '14012345' });
    const rs = [await ipn(t, replay), await ipn(t, replay), await ipn(t, ipnQuery({ txnRef: t1, amount: 350000, code: '51' })), await ipn(t, ipnQuery({ txnRef: t1, amount: 350000 }))];
    for (const r of rs.slice(0, 3)) expect([r.status, r.body]).toEqual([200, BODY('02', 'Order already confirmed')]);
    // IPN thành công của lượt 1 đã failed vì bị từ chối (declined, không phải timeout): cổng không đổi ý, nhận 02
    expect(rs[3].body.RspCode).toBe('02');
    const row = await payRow(t, pay.id);
    expect(row.status).toBe('succeeded');
    expect(row.paid_at?.toISOString()).toBe(paidAt?.toISOString());
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect(await refundsOf(t, pay.id)).toEqual([]);
    expect((await attemptsOf(t, pay.id)).map((a) => a.status)).toEqual(['failed', 'succeeded']);
    expect((await logsOf(t)).map((l) => l.result)).toEqual(['confirmed_success', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
  });

  it('PAY-TC-20261006-104539196 (T4, SB-24): hai IPN thành công của cùng lượt thử đến đồng thời (20 vòng): một 00 và một 02, đúng một PaymentSucceeded, provider_txn_no chỉ một dòng', async () => {
    for (let round = 0; round < 20; round++) {
      const pay = await processing();
      const query = ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, txNo: `9${round}00${pay.id.slice(0, 4).replace(/\D/g, '1')}` });
      const [a, b] = await race(() => ipn(t, query), () => ipn(t, query));
      expect([a.body.RspCode, b.body.RspCode].sort()).toEqual(['00', '02']);
      expect(await payOutbox(t, 'PaymentSucceeded').then((e) => e.filter((x) => x.payload.payment_id === pay.id))).toHaveLength(1);
      expect((await payRow(t, pay.id)).status).toBe('succeeded');
      expect(await countOf(t, 'payment_attempts', `payment_id = '${pay.id}' AND provider_txn_no IS NOT NULL`)).toBe(1);
      expect((await logsOf(t, pay.attempts[0].txnRef)).map((l) => l.result).sort()).toEqual(['confirmed_success', 'duplicate']);
    }
  }, 120_000);

  it('PAY-TC-20261006-104539196 (bẫy đột biến, T4, SB-22 T3): hai IPN thành công cùng lúc bị chặn chờ khóa dòng Payment (một giao dịch khác đang giữ `FOR UPDATE`): không bên nào xong trước khi nhả, sau đó đúng một 00 và một 02, một PaymentSucceeded', async () => {
    const pay = await processing();
    const query = ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, txNo: '14077001' });
    const held = await t.tx.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${pay.id}::uuid FOR UPDATE`;
      const both = Promise.all([Promise.resolve(ipn(t, query)).then((r) => r), Promise.resolve(ipn(t, query)).then((r) => r)]);
      const early = await Promise.race([both.then(() => 'xong'), new Promise<string>((res) => setTimeout(() => res('chờ'), 700))]);
      return { both, early };
    });
    expect(held.early).toBe('chờ');
    const [a, b] = await held.both;
    expect([a.body.RspCode, b.body.RspCode].sort()).toEqual(['00', '02']);
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect((await logsOf(t, pay.attempts[0].txnRef)).map((l) => l.result).sort()).toEqual(['confirmed_success', 'duplicate']);
  });

  it('PAY-TC-20261006-104539228 (T14): thanh toán thành công về sau khi Payment đã expired: RspCode 00, Payment giữ expired, không PaymentSucceeded, một Refund late_payment requested đúng số tiền và lượt thử', async () => {
    const release = t.gw.hold();
    const pay = await seedPayment(t, { status: 'expired', amount: 200_000, attemptNo: 1, attempts: [{ no: 1, status: 'processing' }], orderStatus: 'expired' });
    const r = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 200000, txNo: '14012666' }));
    expect([r.status, r.body]).toEqual([200, OK]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'expired', provider_ref: null });
    expect(await payOutbox(t, 'PaymentSucceeded')).toEqual([]);
    const refunds = await refundsOf(t, pay.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: 'late_payment', amount: '200000', status: 'requested', attempt_id: pay.attempts[0].id, requested_by: null, auto_attempt_no: 1 });
    expect(refunds[0].gateway_request_id).toMatch(/^[0-9a-f]{32}$/);
    expect((await attemptsOf(t, pay.id))[0]).toMatchObject({ status: 'succeeded', provider_txn_no: '14012666' }); // ghi nhận giao dịch thật
    expect((await logsOf(t))[0]).toMatchObject({ result: 'late_payment', rsp_code: '00' });
    release(); await t.refunds.idle();
    expect(await refundsOf(t, pay.id)).toMatchObject([{ status: 'succeeded' }]);
    expect((await payRow(t, pay.id)).status).toBe('expired'); // hoàn muộn không đổi Payment đã đóng
  });

  it('PAY-TC-20261006-104539262 (T14): giao dịch thứ hai cho Payment đã succeeded bị hoàn lại (duplicate_payment) mà không đổi Payment và không PaymentSucceeded thứ hai', async () => {
    const release = t.gw.hold();
    const pay = await seedPayment(t, { status: 'processing', attemptNo: 2, attempts: [{ no: 1, status: 'failed', reason: 'timeout' }, { no: 2, status: 'processing' }] });
    const [t1, t2] = pay.attempts;
    expect((await ipn(t, ipnQuery({ txnRef: t1.txnRef, amount: 350000, txNo: '14012345' }))).body).toEqual(OK); // lượt 1 từng timeout nay về muộn: Payment succeeded bằng lượt 1
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded', provider_ref: '14012345' });
    const r = await ipn(t, ipnQuery({ txnRef: t2.txnRef, amount: 350000, txNo: '14012399' }));
    expect([r.status, r.body]).toEqual([200, OK]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded', provider_ref: '14012345' }); // giữ giao dịch đầu
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    const refunds = await refundsOf(t, pay.id);
    expect(refunds).toMatchObject([{ reason: 'duplicate_payment', amount: '350000', status: 'requested', attempt_id: t2.id }]);
    expect((await logsOf(t, t2.txnRef))[0].result).toBe('duplicate_payment');
    release(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104539262 (T14): giao dịch thứ hai về khi Payment đã refunded (giao dịch đầu đã hoàn) vẫn là trùng: Refund duplicate_payment, Payment giữ refunded', async () => {
    const release = t.gw.hold();
    const pay = await seedPayment(t, { status: 'refunded', providerRef: '14012345', attemptNo: 2, attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }, { no: 2, status: 'processing' }] });
    expect((await ipn(t, ipnQuery({ txnRef: pay.attempts[1].txnRef, amount: 350000, txNo: '14012399' }))).body).toEqual(OK);
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'duplicate_payment', attempt_id: pay.attempts[1].id }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    release(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104539164 (PAY-DB mục 3, T3): một giao dịch cổng (vnp_TransactionNo) không gắn được vào hai lượt thử: IPN thứ hai trùng mã giao dịch nhận 02, giao dịch rollback (lượt thử thứ hai vẫn processing, không event, không Refund)', async () => {
    const a = await processing(), b = await processing();
    expect((await ipn(t, ipnQuery({ txnRef: a.attempts[0].txnRef, amount: 350000, txNo: '14055555' }))).body).toEqual(OK);
    const r = await ipn(t, ipnQuery({ txnRef: b.attempts[0].txnRef, amount: 350000, txNo: '14055555' }));
    expect([r.status, r.body]).toEqual([200, BODY('02', 'Order already confirmed')]);
    expect(await payRow(t, b.id)).toMatchObject({ status: 'processing', provider_ref: null });
    expect((await attemptsOf(t, b.id))[0]).toMatchObject({ status: 'processing', provider_txn_no: null });
    expect((await payOutbox(t, 'PaymentSucceeded')).map((e) => e.payload.payment_id)).toEqual([a.id]);
    expect((await logsOf(t, b.attempts[0].txnRef)).map((l) => l.result)).toEqual(['duplicate']);
    expect(await countOf(t, 'refunds')).toBe(0);
  });

  it('PAY-TC-20261006-104539228 (K-02, T14): Payment còn processing nhưng ORD đã báo đơn không còn pending (OrderCancelled chưa tới PAY): IPN thành công là thanh toán muộn, Payment không đổi, Refund late_payment; OrderCancelled tới sau đóng Payment không hoàn lần hai', async () => {
    const release = t.gw.hold();
    const pay = await processing({ orderStatus: 'cancelled' });
    expect((await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000 }))).body).toEqual(OK);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', provider_ref: null });
    expect(await payOutbox(t, 'PaymentSucceeded')).toEqual([]);
    expect(await refundsOf(t, pay.id)).toMatchObject([{ reason: 'late_payment', status: 'requested' }]);
    await deliver(t, 'OrderCancelled', { order_id: pay.order.id, order_code: pay.order.code, user_id: pay.order.user, reason: 'customer_request', was_paid: false });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'cancelled' });
    expect(await refundsOf(t, pay.id)).toHaveLength(1);
    release(); await t.refunds.idle();
  });

  it('PAY-TC-20261006-104539294 (T13, SB-14): IPN vượt 300 yêu cầu mỗi phút từ một IP thì 429 kèm Retry-After và không vào xử lý (không có dòng nhật ký thứ 301); IP khác vẫn xử lý', async () => {
    const q_ = ipnQuery({ txnRef: 'ffffffffffffffff99', amount: 350000 });
    let ok = 0;
    for (let i = 0; i < 300; i++) { const r = await ipn(t, q_, '203.0.113.7'); if (r.body.RspCode === '01') ok++; }
    expect(ok).toBe(300);
    const over = await ipn(t, q_, '203.0.113.7');
    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect(over.body.type).toBe('urn:ecom:error:rate-limited');
    expect(await countOf(t, 'payment_webhook_logs')).toBe(300);
    const other = await ipn(t, q_, '203.0.113.8');
    expect([other.status, other.body.RspCode]).toEqual([200, '01']);
    // IP thật là phần tử cuối do proxy tin cậy thêm vào (TRUST_PROXY_HOPS=1): đổi phần tử đầu (khách tự khai) không né được bộ đếm
    for (const spoofed of ['198.51.100.99', '198.51.100.100']) expect((await ipn(t, q_, `${spoofed}, 203.0.113.7`)).status).toBe(429);
    // cookie đăng nhập không đổi khóa đếm: vẫn đếm theo IP
    const cookie = await (await import('../support/pay')).who(t, 'customer', 'k@x.vn');
    const withCookie = await ipn(t, q_, '203.0.113.7').set('Cookie', cookie.cookie);
    expect(withCookie.status).toBe(429);
    t.clock.advance(61_000);
    expect((await ipn(t, q_, '203.0.113.7')).body.RspCode).toBe('01');
  }, 120_000);

  it('PAY-TC-20261006-113000600 (T22, SB-32): nhật ký webhook chỉ thêm: không sửa, không xóa trước 12 tháng; dòng quá 12 tháng xóa được (job dọn); không cột updated_at', async () => {
    const ins = (months: number) => q<{ id: string }>(t, `INSERT INTO payment_webhook_logs (txn_ref, payload, signature_valid, rsp_code, result, created_at) VALUES ('${'a'.repeat(16)}01', '{}', true, '01', 'unknown_txn', now() - interval '${months} months') RETURNING id`);
    const [l1] = await ins(1), [l2] = await ins(13);
    expect(await pgCode(q(t, `UPDATE payment_webhook_logs SET rsp_code = '00' WHERE id = '${l1.id}'`))).toBe('23000');
    expect(await pgCode(q(t, `UPDATE payment_webhook_logs SET rsp_code = '00' WHERE id = '${l2.id}'`))).toBe('23000'); // dòng cũ cũng không sửa được
    expect(await pgCode(q(t, `DELETE FROM payment_webhook_logs WHERE id = '${l1.id}'`))).toBe('23000');
    expect((await q<{ rsp_code: string }>(t, `SELECT rsp_code FROM payment_webhook_logs WHERE id = '${l1.id}'`))[0].rsp_code).toBe('01');
    expect(await pgCode(q(t, `DELETE FROM payment_webhook_logs WHERE id = '${l2.id}'`))).toBe('ok');
    expect(await countOf(t, 'payment_webhook_logs')).toBe(1);
    expect(await q(t, `SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_webhook_logs' AND column_name = 'updated_at'`)).toEqual([]);
    // job dọn hằng ngày: xóa đúng dòng quá 12 tháng, không đụng bảng khác
    const [l3] = await ins(14), [l4] = await ins(2);
    const pay = await seedPayment(t, { status: 'pending' });
    expect(await t.reconcile.purgeWebhookLogs()).toBe(1);
    expect((await q<{ id: string }>(t, 'SELECT id FROM payment_webhook_logs')).map((r) => r.id).sort()).toEqual([l1.id, l4.id].sort());
    expect(l3.id).toBeTruthy();
    expect(await payRow(t, pay.id)).toBeDefined();
    // TRUNCATE bị thu quyền với vai trò ứng dụng (CSDL test chạy bằng chủ bảng nên kiểm bằng danh mục quyền)
    const priv = await q<{ p: string }>(t, `SELECT privilege_type AS p FROM information_schema.role_table_grants WHERE table_name = 'payment_webhook_logs' AND grantee = 'app_runtime'`);
    expect(priv.map((r) => r.p).sort()).toEqual(['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER'].filter((x) => x !== 'REFERENCES' && x !== 'TRIGGER').sort());
  });

  it('PAY-TC-20261013-194320138 và PAY-TC-20261006-104539098 (bẫy đột biến, PAY-REQ-20261006-103110513 BR8 và BR10, SB-22): danh sách IP của cổng (VNPAY_IPN_IP_ALLOWLIST) rỗng thì tắt; có giá trị thì IP lạ nhận RspCode 99 và không xử lý, IP trong danh sách xử lý bình thường', async () => {
    const on = await createPayApp({ env: { VNPAY_IPN_IP_ALLOWLIST: '203.0.113.50, 203.0.113.51' } });
    try {
      const pay = await seedPayment(on, { status: 'processing', attemptNo: 1, attempts: 'auto' });
      const query = ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000 });
      const lạ = await ipn(on, query, '198.51.100.9');
      expect([lạ.status, lạ.body]).toEqual([200, BODY('99', 'Unknown error')]);
      expect((await payRow(on, pay.id)).status).toBe('processing');
      expect(await countOf(on, 'payment_webhook_logs')).toBe(0);
      expect(await ipn(on, query, '203.0.113.51').then((r) => r.body)).toEqual(OK);
      expect((await payRow(on, pay.id)).status).toBe('succeeded');
    } finally { await truncateAll(on.prisma); await on.close(); }
  });

  it('PAY-TC-20261006-104539098 (review REV-PAY-02, SB-22): máy chủ nghe `::` thấy IPv4 là `::ffff:a.b.c.d`; ipOf đổi về a.b.c.d nên danh sách IP và khóa đếm bậc E khớp (không từ chối mọi IPN thật khi bật danh sách)', () => {
    expect(normalizeIp('::ffff:203.0.113.50')).toBe('203.0.113.50');
    expect(normalizeIp('::FFFF:203.0.113.50')).toBe('203.0.113.50');
    for (const keep of ['203.0.113.50', '2001:db8::1', '::1', '::ffff:zz', '::ffff:1.2.3', 'unknown', '::ffff:1.2.3.4.5']) expect(normalizeIp(keep)).toBe(keep);
    setIpHops(0);
    try { expect(ipOf({ socket: { remoteAddress: '::ffff:203.0.113.51' }, headers: {} } as never)).toBe('203.0.113.51'); } finally { setIpHops(1); }
  });
});
