import { truncateAll } from '../support/db';
import { medianPairMs } from '../support/auth';
import { callKey, createPayApp, attemptsOf, call, http, initiate, retry, MINUTE, newKey, ORIGIN, payRow, payOutbox, people, seedPayment, seedRefund, sqlOf, snapshot, countOf, SECRET, type PayApp } from '../support/pay';
import { sign, vnpDate } from '../../src/modules/payment/vnpay';

// Bắt đầu thanh toán online (PAY-REQ-20261006-103110422): đường dẫn VNPay đã ký, IDOR, thứ tự kiểm, bấm lặp, hạn, trường lạ, CSRF, giới hạn tần suất và Idempotency-Key.
const parse = (u: string): { host: string; params: Record<string, string> } => { const url = new URL(u); return { host: url.host, params: Object.fromEntries(url.searchParams.entries()) }; };
const iso = (d: Date) => d.toISOString();

describe('PAY bắt đầu thanh toán', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });

  it('PAY-TC-20261006-104538705: customer bắt đầu thanh toán và nhận đường dẫn VNPay đã ký (số tiền ×100, mã tham chiếu 18 ký tự, hạn 10 phút, mô tả chỉ có mã đơn, chữ ký HMAC-SHA512 khớp); không event', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending', orderCode: '7K3M9Q2XH4TB' });
    const now = t.clock.now();
    const r = await initiate(t, p.a.cookie, pay.id);
    expect(r.status).toBe(200);
    const exp = new Date(now.getTime() + 10 * MINUTE);
    expect(r.body).toMatchObject({ payment_id: pay.id, status: 'processing', attempt_no: 1, max_attempts: 3, expires_at: iso(exp) });
    const { host, params } = parse(r.body.redirect_url);
    expect(host).toBe('sandbox.vnpayment.vn');
    expect(params).toMatchObject({ vnp_Amount: '35000000', vnp_ExpireDate: vnpDate(exp), vnp_CreateDate: vnpDate(now), vnp_TmnCode: 'TESTTMN1', vnp_OrderInfo: 'Thanh toan don 7K3M9Q2XH4TB', vnp_CurrCode: 'VND', vnp_ReturnUrl: 'https://shop.example/orders/7K3M9Q2XH4TB/payment' });
    expect(params.vnp_TxnRef).toMatch(/^[0-9a-f]{16}01$/);
    expect(params.vnp_OrderInfo).not.toMatch(/@|\d{9,}/); // không email hay số điện thoại
    const { vnp_SecureHash: given, ...rest } = params;
    expect(given).toBe(sign(rest, SECRET)); // khớp khi tính lại HMAC-SHA512 bằng khóa test
    expect(given).toMatch(/^[0-9a-f]{128}$/);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', attempt_no: 1, version: 1 });
    const a = await attemptsOf(t, pay.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ status: 'processing', txn_ref: params.vnp_TxnRef, attempt_no: 1 });
    expect(a[0].expires_at.toISOString()).toBe(iso(exp));
    expect(await payOutbox(t)).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/card|cvv/i); // không dữ liệu thẻ trong phản hồi (SB-21)
    expect(t.gw.queries.length + t.gw.refundCalls.length).toBe(0); // không gọi cổng trong lúc tạo
  });

  it('PAY-TC-20261006-104538738: guest 401, staff và admin 403 (không đổi gì)', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const before = await snapshot(t);
    const g = await initiate(t, undefined, pay.id), s = await initiate(t, p.staff.cookie, pay.id), a = await initiate(t, p.admin.cookie, pay.id);
    expect([g.status, s.status, a.status]).toEqual([401, 403, 403]);
    expect(g.body.type).toBe('urn:ecom:error:unauthenticated');
    expect([s.body.type, a.body.type]).toEqual(['urn:ecom:error:forbidden', 'urn:ecom:error:forbidden']);
    for (const r of [g, s, a]) { expect(r.body.trace_id).toBeTruthy(); expect(JSON.stringify(r.body)).not.toMatch(/pending|processing/); }
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'pending', attempt_no: 0 });
    expect(await attemptsOf(t, pay.id)).toEqual([]);
    expect(await snapshot(t)).toEqual(before);
  });

  it('PAY-TC-20261006-104538772 (T6, SB-06): Payment của người khác trả cùng 404 với Payment không tồn tại (cùng nội dung, cùng chuỗi câu SQL, trung vị thời gian lệch dưới 30%); trường lạ user_id bị 400', async () => {
    const other = await seedPayment(t, { user: p.b.id, status: 'pending' });
    const ghost = '00000000-0000-4000-8000-000000000000';
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    const sqls: string[][] = [];
    for (const id of [other.id, ghost]) { spy.mockClear(); const r = await initiate(t, p.a.cookie, id); expect(r.status).toBe(404); sqls.push(sqlOf(spy.mock.calls as unknown[][])); }
    expect(sqls[0]).toEqual(sqls[1]); // cùng đường đi: không nhánh nào phân biệt hai trường hợp
    jest.restoreAllMocks();
    const [r1, r2] = [await initiate(t, p.a.cookie, other.id), await initiate(t, p.a.cookie, ghost)];
    expect([r1.body.type, r1.body.title, r1.body.detail, r1.body.status]).toEqual([r2.body.type, r2.body.title, r2.body.detail, r2.body.status]);
    expect(r1.body.trace_id).not.toBe(r2.body.trace_id);
    const bad = await initiate(t, p.a.cookie, other.id, { body: { user_id: p.b.id } });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual([{ field: 'user_id', code: 'unknown_field' }]);
    const [ma, mb] = await medianPairMs(30, () => initiate(t, p.a.cookie, other.id), () => initiate(t, p.a.cookie, ghost), () => { t.clock.advance(61_000); return Promise.resolve(); });
    expect(Math.abs(ma - mb) <= Math.max(0.3 * Math.min(ma, mb), 3)).toBe(true);
    expect(await payRow(t, other.id)).toMatchObject({ status: 'pending', attempt_no: 0 });
    const alsoBad = await initiate(t, p.a.cookie, 'khong-phai-uuid');
    expect(alsoBad.status).toBe(404); // id sai định dạng cũng là 404, không lộ định dạng
  });

  it('PAY-TC-20261006-104538804: Payment COD, đã đóng, đơn đã hủy và số tiền ngoài khoảng bị từ chối đúng mã; không lượt thử nào được tạo', async () => {
    const pc = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending' });
    const ps = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const px = await seedPayment(t, { user: p.a.id, status: 'pending', orderStatus: 'cancelled' });
    const pl = await seedPayment(t, { user: p.a.id, status: 'pending', amount: 4_999 });
    const pe = await seedPayment(t, { user: p.a.id, status: 'expired' });
    const pf = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto' });
    const out: [string, number, string][] = [];
    for (const [name, x] of [['pc', pc], ['ps', ps], ['px', px], ['pl', pl], ['pe', pe], ['pf', pf]] as const) { const r = await initiate(t, p.a.cookie, x.id); out.push([name, r.status, String(r.body.type).replace('urn:ecom:error:', '')]); }
    expect(out).toEqual([['pc', 409, 'payment-not-online'], ['ps', 409, 'payment-not-startable'], ['px', 409, 'payment-not-startable'], ['pl', 422, 'amount-out-of-range'], ['pe', 409, 'payment-not-startable'], ['pf', 409, 'payment-not-startable']]);
    expect(await countOf(t, 'payment_attempts', `payment_id IN ('${pc.id}', '${px.id}', '${pl.id}', '${pe.id}')`)).toBe(0);
    expect((await payRow(t, pl.id)).status).toBe('pending'); // vẫn pending
    expect(await countOf(t, 'payment_attempts')).toBe(2); // chỉ hai lượt dựng sẵn của ps và pf
  });

  it('PAY-TC-20261006-104538837: bấm lặp khi lượt thử còn hạn trả lại đúng đường dẫn cũ (từng ký tự), hết hạn mà chưa đối soát thì 409 payment-in-progress', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const first = await initiate(t, p.a.cookie, pay.id);
    t.clock.advance(4 * MINUTE);
    const second = await initiate(t, p.a.cookie, pay.id); // khóa mới: tab thứ hai
    expect(second.status).toBe(200);
    expect(second.body.redirect_url).toBe(first.body.redirect_url);
    expect(second.body).toEqual(first.body);
    expect(await attemptsOf(t, pay.id)).toHaveLength(1);
    expect((await payRow(t, pay.id)).attempt_no).toBe(1);
    t.clock.advance(7 * MINUTE); // quá hạn đường dẫn 10 phút, chưa tới hạn Payment 15 phút, job đối soát chưa chạy
    const third = await initiate(t, p.a.cookie, pay.id);
    expect([third.status, third.body.type]).toEqual([409, 'urn:ecom:error:payment-in-progress']);
    expect(await attemptsOf(t, pay.id)).toHaveLength(1);
  });

  it('PAY-TC-20261006-104538837 (bẫy đột biến, SB-24): Payment processing nhưng lượt thử hiện tại đã chốt (failed) thì không trả lại đường dẫn của lượt đã chốt: 409 payment-in-progress', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [{ no: 1, status: 'failed', reason: 'declined', expiresAt: new Date(t.clock.now().getTime() + 8 * MINUTE) }] });
    const r = await initiate(t, p.a.cookie, pay.id);
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:payment-in-progress']);
    expect(r.body.redirect_url).toBeUndefined();
  });

  it('PAY-TC-20261006-104538871: hạn đường dẫn không vượt expires_at của Payment (còn 30 giây thì đường dẫn chỉ sống 30 giây); đúng expires_at thì 409 payment-not-startable', async () => {
    const now = t.clock.now();
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending', expiresAt: new Date(now.getTime() + 30_000) });
    const r = await initiate(t, p.a.cookie, pay.id);
    expect(r.status).toBe(200);
    expect(r.body.expires_at).toBe(iso(new Date(now.getTime() + 30_000)));
    expect(parse(r.body.redirect_url).params.vnp_ExpireDate).toBe(vnpDate(new Date(now.getTime() + 30_000)));
    const late = await seedPayment(t, { user: p.a.id, status: 'pending', expiresAt: new Date(now.getTime() + 1_000) });
    t.clock.advance(1_000); // đúng expires_at
    const r2 = await initiate(t, p.a.cookie, late.id);
    expect([r2.status, r2.body.type]).toEqual([409, 'urn:ecom:error:payment-not-startable']);
    expect(await attemptsOf(t, late.id)).toEqual([]);
  });

  it('PAY-TC-20261006-104538903 (T2, T5, SB-23): trường lạ amount ở body bị 400; tham số quay về vnp_* giả không đổi được số tiền hay trạng thái (API chỉ nhận đọc, query lạ bị 400)', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const bad = await initiate(t, p.a.cookie, pay.id, { body: { amount: 1 } });
    expect(bad.status).toBe(400);
    expect(await attemptsOf(t, pay.id)).toEqual([]);
    for (const raw of ['{"return_url":"https://evil.example"}', '{"status":"succeeded"}', '{"vnp_ResponseCode":"00"}', '{"__proto__":{"x":1}}', '{"amount":"1"}']) {
      const r = await initiate(t, p.a.cookie, pay.id, { raw });
      expect([raw, r.status, r.body.type]).toEqual([raw, 400, 'urn:ecom:error:validation-failed']);
    }
    expect(await attemptsOf(t, pay.id)).toEqual([]);
    const ok = await initiate(t, p.a.cookie, pay.id);
    expect(parse(ok.body.redirect_url).params.vnp_Amount).toBe('35000000'); // số tiền do server quyết
    const fake = await call(t, 'get', `/payments/${pay.id}?vnp_ResponseCode=00&vnp_TransactionStatus=00&vnp_Amount=35000000`, { cookie: p.a.cookie });
    expect(fake.status).toBe(400); // không có đường nào nhận tham số quay về
    const read = await call(t, 'get', `/payments/${pay.id}`, { cookie: p.a.cookie });
    expect(read.body.status).toBe('processing'); // vẫn đang xử lý
    expect(await payOutbox(t, 'PaymentSucceeded')).toEqual([]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', paid_at: null });
  });

  it('PAY-TC-20261006-104538935 (T18, SB-13): Origin lạ, thiếu Origin và Referer (có cookie) hoặc sai Content-Type bị chặn trước khi chạm Payment, cho cả năm endpoint đổi trạng thái; Origin hợp lệ thì qua', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const failedPay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto' });
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const succ = await seedPayment(t, { user: p.a.id, status: 'succeeded', attempts: 'auto', attemptNo: 1 });
    const failedRefund = await seedRefund(t, { paymentId: succ.id, attemptId: succ.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const targets: [string, string, string, unknown][] = [
      ['initiate', `/payments/${pay.id}/initiate`, p.a.cookie, {}], ['retry', `/payments/${failedPay.id}/retry`, p.a.cookie, {}],
      ['cod-collect', `/payments/${cod.id}/cod-collect`, p.staff.cookie, { collected_amount: 180000 }], ['refunds', `/payments/${succ.id}/refunds`, p.admin.cookie, { reason: 'Khách trả hàng lỗi' }],
      ['refund-retry', `/refunds/${failedRefund}/retry`, p.admin.cookie, {}],
    ];
    const before = await snapshot(t);
    for (const [name, path, cookie, body] of targets) {
      const post = (o: { origin?: string; ct?: string; referer?: string }) => {
        let r = http(t).post(`/api/v1${path}`).set('Cookie', cookie).set('Idempotency-Key', newKey());
        if (o.origin) r = r.set('Origin', o.origin);
        if (o.referer) r = r.set('Referer', o.referer);
        return r.set('Content-Type', o.ct ?? 'application/json').send(JSON.stringify(body));
      };
      const evil = await post({ origin: 'https://evil.example' });
      const none = await post({});
      const evilReferer = await post({ referer: 'https://evil.example/x' });
      const text = await post({ origin: ORIGIN, ct: 'text/plain' });
      expect([name, evil.status, evil.body.type]).toEqual([name, 403, 'urn:ecom:error:csrf_failed']);
      expect([name, none.status]).toEqual([name, 403]);
      expect([name, evilReferer.status]).toEqual([name, 403]);
      expect([name, text.status]).toEqual([name, 415]);
    }
    expect(await snapshot(t)).toEqual(before); // chưa chạm Payment nào
    const ok = await callKey(t, `/payments/${pay.id}/initiate`, { cookie: p.a.cookie, origin: ORIGIN });
    expect(ok.status).toBe(200);
    const viaReferer = await http(t).post(`/api/v1/payments/${failedPay.id}/retry`).set('Cookie', p.a.cookie).set('Referer', `${ORIGIN}/orders/x/payment`).set('Idempotency-Key', newKey()).set('Content-Type', 'application/json').send('{}');
    expect(viaReferer.status).toBe(200); // Referer hợp lệ thay Origin
  });

  it('PAY-TC-20261006-104538969 (T13, SB-14): bắt đầu thanh toán vượt 10 yêu cầu mỗi phút mỗi người thì 429 kèm Retry-After và không tạo lượt thử; sang phút kế xử lý bình thường', async () => {
    const pays = [];
    for (let i = 0; i < 12; i++) pays.push(await seedPayment(t, { user: p.a.id, status: 'pending' }));
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await initiate(t, p.a.cookie, pays[i].id)).status);
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(codes[10]).toBe(429);
    const limited = await initiate(t, p.a.cookie, pays[10].id);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number.isInteger(Number(limited.headers['retry-after']))).toBe(true);
    expect(limited.body.type).toBe('urn:ecom:error:rate-limited');
    expect(await attemptsOf(t, pays[10].id)).toEqual([]);
    expect(await countOf(t, 'payment_attempts')).toBe(10);
    // người khác không bị ảnh hưởng (khóa đếm theo người dùng)
    const b = await seedPayment(t, { user: p.b.id, status: 'pending' });
    expect((await initiate(t, p.b.cookie, b.id)).status).toBe(200);
    t.clock.advance(61_000);
    expect((await initiate(t, p.a.cookie, pays[10].id)).status).toBe(200);
    // retry dùng chung bộ đếm bậc E với initiate: 10 lần mỗi phút (Payment hết lượt nên retry trả 409 nhưng vẫn được đếm), lần thứ 11 là 429
    t.clock.advance(61_000);
    const spent = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 3, attempts: 'auto' });
    const rc: number[] = [];
    for (let i = 0; i < 11; i++) rc.push((await retry(t, p.a.cookie, spent.id)).status);
    expect([rc.slice(0, 10).every((c) => c !== 429), rc[10]]).toEqual([true, 429]);
  });

  it('PAY-TC-20261006-113000300 (ADR-017, SB-40): initiate thiếu Idempotency-Key hoặc khóa 5 ký tự thì 400 idempotency-key-required; gửi lại cùng khóa trả đúng phản hồi đã lưu (một lượt thử); cùng khóa khác Payment thì 422', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const none = await initiate(t, p.a.cookie, pay.id, { key: null });
    const short = await initiate(t, p.a.cookie, pay.id, { key: 'abc12' });
    const spaces = await initiate(t, p.a.cookie, pay.id, { key: 'bad key with spaces!' });
    expect([none.status, short.status, spaces.status]).toEqual([400, 400, 400]);
    for (const r of [none, short, spaces]) expect(r.body.type).toBe('urn:ecom:error:idempotency-key-required');
    expect(await attemptsOf(t, pay.id)).toEqual([]);
    const k1 = 'init-7f3a9c21';
    const first = await initiate(t, p.a.cookie, pay.id, { key: k1 });
    const again = await initiate(t, p.a.cookie, pay.id, { key: k1 });
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await attemptsOf(t, pay.id)).toHaveLength(1);
    const other = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const reused = await initiate(t, p.a.cookie, other.id, { key: k1 });
    expect([reused.status, reused.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    expect(await attemptsOf(t, other.id)).toEqual([]);
    // khóa của người khác không dùng được cho mình: gắn (scope, user_id, key)
    const b = await seedPayment(t, { user: p.b.id, status: 'pending' });
    const theirs = await initiate(t, p.b.cookie, b.id, { key: k1 });
    expect(theirs.status).toBe(200);
    expect(theirs.body.payment_id).toBe(b.id);
    // 5xx không lưu: lỗi hạ tầng giữa chừng thì lần gửi lại cùng khóa chạy lại được
    const c = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const kf = newKey();
    jest.spyOn(t.ord, 'findForPayment').mockRejectedValueOnce(new Error('ORD lỗi'));
    const err = await initiate(t, p.a.cookie, c.id, { key: kf });
    expect(err.status).toBe(500);
    jest.restoreAllMocks();
    const retried = await initiate(t, p.a.cookie, c.id, { key: kf });
    expect(retried.status).toBe(200);
    expect(await attemptsOf(t, c.id)).toHaveLength(1);
  });
});
