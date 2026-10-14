import { truncateAll } from '../support/db';
import { call, callKey, countOf, createPayApp, drain, newKey, orderRow, payAudits, payOutbox, payRow, people, q, refund, refundRetry, refundsOf, seedPayment, seedRefund, type PayApp } from '../support/pay';

// Hoàn tiền thủ công và thử lại hoàn tiền thất bại (PAY-REQ-20261006-103111034): chỉ admin, toàn phần, idempotent, audit, chống bấm lặp và XSS.
describe('PAY hoàn tiền thủ công của admin', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  const succeeded = (o: Parameters<typeof seedPayment>[1] = {}) => seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto', ...o });

  it('PAY-TC-20261006-104540407 (SB-07, SB-19): admin hoàn tiền thủ công toàn phần cho đơn đã giao: 202 requested rồi succeeded; Refund admin_manual có requested_by và lý do nguyên văn; Payment refunded; đủ event một lần; audit có admin và lý do; trạng thái đơn ở ORD không đổi', async () => {
    const pay = await succeeded({ orderStatus: 'delivered' });
    const r = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi, đã nhận lại');
    expect([r.status, r.body.status, r.body.amount]).toEqual([202, 'requested', 350000]);
    await t.refunds.idle();
    const rows = await refundsOf(t, pay.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.body.refund_id, reason: 'admin_manual', amount: '350000', status: 'succeeded', requested_by: p.admin.id, note: 'Khách trả hàng lỗi, đã nhận lại', auto_attempt_no: null });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect((await payOutbox(t)).map((e) => e.type)).toEqual(['PaymentRefunded', 'RefundSucceeded']);
    expect((await payOutbox(t, 'RefundSucceeded'))[0].payload).toMatchObject({ reason: 'admin_manual', amount: 350000, user_id: p.a.id });
    expect(await payAudits(t, pay.id)).toMatchObject([{ actor_id: p.admin.id, actor_role: 'admin', action: 'payment.refund.manual', reason: 'Khách trả hàng lỗi, đã nhận lại', after: { amount: 350000, reason: 'admin_manual' } }]);
    await drain(t);
    expect(await orderRow(t, pay.order.id)).toMatchObject({ status: 'delivered', payment_status: 'refunded' }); // hoàn tiền không đổi trạng thái đơn
    expect(t.gw.refundCalls).toHaveLength(1);
    expect(t.gw.refundCalls[0].amount).toBe(350000n); // số tiền do server lấy từ giao dịch
  });

  it('PAY-TC-20261006-104540440: admin thử lại hoàn tiền thất bại bằng chính Refund đó (cùng refund_id, auto_attempt_no giữ 3, mã yêu cầu mới, không dòng mới); audit người thử lại; thử lại khi đang requested hoặc đã succeeded thì 409', async () => {
    const pay = await succeeded();
    const rid = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const old = (await refundsOf(t, pay.id))[0];
    const hold = t.gw.hold();
    const r = await refundRetry(t, p.admin.cookie, rid);
    expect([r.status, r.body.refund_id, r.body.status, r.body.amount]).toEqual([202, rid, 'requested', 350000]);
    await new Promise((x) => setTimeout(x, 100));
    const mid = await refundsOf(t, pay.id);
    expect(mid).toHaveLength(1);
    expect(mid[0]).toMatchObject({ id: rid, status: 'requested', auto_attempt_no: 3, next_retry_at: null, failure_reason: null, resolved_at: null });
    expect(mid[0].gateway_request_id).not.toBe(old.gateway_request_id);
    const again = await refundRetry(t, p.admin.cookie, rid); // đang requested
    expect([again.status, again.body.type]).toEqual([409, 'urn:ecom:error:refund-in-progress']);
    hold(); await t.refunds.idle();
    expect(await refundsOf(t, pay.id)).toMatchObject([{ id: rid, status: 'succeeded', auto_attempt_no: 3 }]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'refunded' });
    expect(await payAudits(t, pay.id, 'payment.refund.retry')).toMatchObject([{ actor_id: p.admin.id, actor_role: 'admin', reason: 'order_cancelled', after: { refund_id: rid, status: 'requested' } }]);
    const done = await refundRetry(t, p.admin.cookie, rid);
    expect([done.status, done.body.type]).toEqual([409, 'urn:ecom:error:refund-not-retryable']);
    const ghost = await refundRetry(t, p.admin.cookie, '00000000-0000-4000-8000-000000000000');
    expect(ghost.status).toBe(404);
    expect(await countOf(t, 'refunds')).toBe(1);
    // Refund failed của Payment không còn succeeded: không thử lại được
    const closed = await seedPayment(t, { user: p.a.id, status: 'expired', orderStatus: 'expired', attemptNo: 1, attempts: [{ no: 1, status: 'succeeded' }] });
    const late = await seedRefund(t, { paymentId: closed.id, attemptId: closed.attempts[0].id, reason: 'late_payment', status: 'failed' });
    expect((await refundRetry(t, p.admin.cookie, late)).body.type).toBe('urn:ecom:error:refund-not-retryable');
  });

  it('PAY-TC-20261006-104540482 (T7, SB-07): customer và staff 403, guest 401 cho cả hoàn tiền thủ công và thử lại; không Refund mới, Payment giữ succeeded, không gọi cổng', async () => {
    const pay = await succeeded();
    const rid = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const out: number[] = [];
    for (const cookie of [p.a.cookie, p.staff.cookie, undefined]) { out.push((await refund(t, cookie, pay.id, 'Khách trả hàng lỗi')).status, (await refundRetry(t, cookie, rid)).status); }
    expect(out).toEqual([403, 403, 403, 403, 401, 401]);
    expect(await countOf(t, 'refunds')).toBe(1);
    expect((await refundsOf(t, pay.id))[0].status).toBe('failed');
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    expect(t.gw.refundCalls).toEqual([]);
  });

  it('PAY-TC-20261006-104540530: hoàn tiền Payment COD (422 cod-refund-unsupported), đã refunded hoặc chưa thu (409 payment-not-refundable), đã có Refund failed (409 refund-use-retry), id lạ (404); không Refund nào, cổng không bị gọi', async () => {
    const pc = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'succeeded', orderStatus: 'delivered' });
    const pr = await succeeded({ status: 'refunded' });
    const pp = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const pf = await succeeded();
    await seedRefund(t, { paymentId: pf.id, attemptId: pf.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const pq = await succeeded();
    await seedRefund(t, { paymentId: pq.id, attemptId: pq.attempts[0].id, status: 'requested' });
    const out: string[] = [];
    for (const id of [pc.id, pr.id, pp.id, pf.id, pq.id, '00000000-0000-4000-8000-000000000000', 'khong-phai-uuid']) { const r = await refund(t, p.admin.cookie, id, 'Khách trả hàng lỗi'); out.push(`${r.status} ${String(r.body.type).replace('urn:ecom:error:', '')}`); }
    expect(out).toEqual(['422 cod-refund-unsupported', '409 payment-not-refundable', '409 payment-not-refundable', '409 refund-use-retry', '409 refund-in-progress', '404 not-found', '404 not-found']);
    expect(await countOf(t, 'refunds')).toBe(2); // chỉ hai dòng dựng sẵn
    expect(t.gw.refundCalls).toEqual([]);
    const d = (await refund(t, p.admin.cookie, pf.id, 'Khách trả hàng lỗi')).body;
    expect(Object.keys(d).sort()).toEqual(['status', 'title', 'trace_id', 'type']); // 409 chỉ nêu mã chung, không lộ trạng thái hay số liệu nội bộ (SB-20)
    expect(JSON.stringify(d)).not.toMatch(/350000|14\d{6}|vnp_|refund_id/);
  });

  it('PAY-TC-20261006-104540563: lý do rỗng, 4 ký tự, 301 ký tự, thiếu, ký tự điều khiển hoặc có trường amount bị 400; không Refund, cổng không bị gọi', async () => {
    const pay = await succeeded();
    const bads: unknown[] = ['', 'abcd', 'x'.repeat(301), '    ', 'a\u0000bcdef', 5, null];
    for (const reason of bads) { const r = await refund(t, p.admin.cookie, pay.id, reason); expect([JSON.stringify(reason)?.slice(0, 12), r.status, r.body.type]).toEqual([JSON.stringify(reason)?.slice(0, 12), 400, 'urn:ecom:error:validation-failed']); }
    const missing = await callKey(t, `/payments/${pay.id}/refunds`, { cookie: p.admin.cookie, raw: '{}' });
    const amount = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi', { extra: { amount: 1000 } });
    const proto = await callKey(t, `/payments/${pay.id}/refunds`, { cookie: p.admin.cookie, raw: '{"reason":"Khách trả hàng lỗi","__proto__":{"amount":1}}' });
    expect([missing.status, amount.status, proto.status]).toEqual([400, 400, 400]);
    expect(amount.body.errors).toEqual([{ field: 'amount', code: 'unknown_field' }]);
    expect(await countOf(t, 'refunds')).toBe(0);
    expect(t.gw.refundCalls).toEqual([]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
  });

  it('PAY-TC-20261006-104540596 (T8): bấm hoàn tiền hai lần liên tiếp chỉ gửi một lệnh tới cổng (cổng chậm): một yêu cầu 202, một yêu cầu 409 refund-in-progress; một Refund requested; mã yêu cầu 32 ký tự', async () => {
    const pay = await succeeded();
    const hold = t.gw.hold(); // cổng xử lý chậm
    const first = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi');
    await new Promise((x) => setTimeout(x, 100));
    const second = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi');
    expect([first.status, second.status, second.body.type]).toEqual([202, 409, 'urn:ecom:error:refund-in-progress']);
    expect(await countOf(t, 'refunds', `payment_id = '${pay.id}' AND status = 'requested'`)).toBe(1);
    await new Promise((x) => setTimeout(x, 100));
    expect(t.gw.refundCalls).toHaveLength(1);
    expect(t.gw.refundCalls[0].requestId).toMatch(/^[0-9a-f]{32}$/);
    hold(); await t.refunds.idle();
    expect(t.gw.refundCalls).toHaveLength(1);
    // hai yêu cầu thật sự đồng thời (khóa khác nhau): đúng một Refund
    const x = await succeeded();
    const rs = await Promise.all([refund(t, p.admin.cookie, x.id, 'Khách trả hàng lỗi'), refund(t, p.admin.cookie, x.id, 'Khách trả hàng lỗi'), refund(t, p.admin.cookie, x.id, 'Khách trả hàng lỗi')]);
    await t.refunds.idle();
    expect(rs.filter((r) => r.status === 202)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).every((r) => ['refund-in-progress', 'payment-not-refundable'].includes(String(r.body.type).replace('urn:ecom:error:', '')))).toBe(true);
    expect(await countOf(t, 'refunds', `payment_id = '${x.id}'`)).toBe(1);
  });

  it('PAY-TC-20261006-104540630: lý do đúng 5 và đúng 300 ký tự được chấp nhận, ghi chú lưu nguyên văn', async () => {
    const [pa, pb] = [await succeeded(), await succeeded()];
    const long = 'Đ'.repeat(300); // đếm ký tự Unicode, không đếm byte
    const [ra, rb] = [await refund(t, p.admin.cookie, pa.id, 'Trả h'), await refund(t, p.admin.cookie, pb.id, long)];
    expect([ra.status, rb.status]).toEqual([202, 202]);
    await t.refunds.idle();
    const [na, nb] = [(await refundsOf(t, pa.id))[0].note, (await refundsOf(t, pb.id))[0].note];
    expect([na, na?.length, nb, [...(nb ?? '')].length]).toEqual(['Trả h', 5, long, 300]);
    // CHECK ở CSDL: 4 và 301 ký tự không vào được dù mã ứng dụng sai
    const pc = await succeeded();
    for (const bad of ['abcd', 'x'.repeat(301)]) expect(await (await import('../support/pay')).pgCode(q(t, `INSERT INTO refunds (payment_id, attempt_id, amount, reason, note, gateway_request_id) VALUES ('${pc.id}', '${pc.attempts[0].id}', 350000, 'admin_manual', '${bad}', '${'a'.repeat(32)}')`))).toBe('23514');
  });

  it('PAY-TC-20261006-104540662 (T17, SB-11, SB-12, SB-18): lý do chứa mã script được lưu và trả về như văn bản thường (nguyên văn trong chuỗi JSON); log ứng dụng không chứa nội dung lý do', async () => {
    const pay = await succeeded();
    const xss = '<script>alert(1)</script> hoàn do lỗi';
    const r = await refund(t, p.admin.cookie, pay.id, xss);
    expect(r.status).toBe(202);
    await t.refunds.idle();
    const d = await call(t, 'get', `/admin/payments/${pay.id}`, { cookie: p.staff.cookie });
    expect(d.status).toBe(200);
    expect(d.body.refunds[0].note).toBe(xss);
    expect(d.headers['content-type']).toMatch(/application\/json/);
    expect(t.logs.lines.join('\n')).not.toContain('alert(1)');
    expect(t.logs.lines.join('\n')).not.toContain('hoàn do lỗi');
    // ghi chú COD cũng không vào log
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    await call(t, 'post', `/payments/${cod.id}/cod-collect`, { cookie: p.staff.cookie, body: { collected_amount: 180000, note: '<img src=x onerror=alert(2)>' } });
    expect(t.logs.lines.join('\n')).not.toContain('onerror');
  });

  it('PAY-TC-20261006-113000500 (ADR-017, SB-40, T8): hoàn tiền thiếu hoặc sai Idempotency-Key thì 400 idempotency-key-required; cùng khóa cùng nội dung trả đúng phản hồi lần đầu (cổng chỉ nhận một lệnh); cùng khóa khác lý do thì 422 idempotency-key-reused', async () => {
    const pay = await succeeded();
    const none = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi', { key: null });
    const bad = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi', { key: 'bad key!' });
    expect([none.status, bad.status]).toEqual([400, 400]);
    expect([none.body.type, bad.body.type]).toEqual(Array(2).fill('urn:ecom:error:idempotency-key-required'));
    expect(await countOf(t, 'refunds')).toBe(0);
    const k1 = 'ref-5d2e8b10';
    const first = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi', { key: k1 });
    await t.refunds.idle();
    const same = await refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi', { key: k1 });
    expect([first.status, same.status]).toEqual([202, 202]);
    expect(same.body).toEqual(first.body); // đúng phản hồi lần đầu
    expect(same.headers['idempotent-replayed']).toBe('true');
    expect(t.gw.refundCalls).toHaveLength(1);
    const diff = await refund(t, p.admin.cookie, pay.id, 'Lý do khác hẳn', { key: k1 });
    expect([diff.status, diff.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    expect(await countOf(t, 'refunds')).toBe(1);
    // thử lại hoàn tiền cũng bắt buộc khóa
    const other = await succeeded();
    const rid = await seedRefund(t, { paymentId: other.id, attemptId: other.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const k = await refundRetry(t, p.admin.cookie, rid, { key: null });
    expect([k.status, k.body.type]).toEqual([400, 'urn:ecom:error:idempotency-key-required']);
    const kk = newKey();
    const a1 = await refundRetry(t, p.admin.cookie, rid, { key: kk });
    await t.refunds.idle();
    const a2 = await refundRetry(t, p.admin.cookie, rid, { key: kk });
    expect(a2.body).toEqual(a1.body);
    expect(a2.status).toBe(a1.status);
    // khóa dài đúng 64 ký tự thì nhận, 65 thì 400 (biên trên của định dạng); cùng khóa cho Refund khác thì 422 idempotency-key-reused (băm gồm id)
    const edge = await succeeded();
    const longOk = await refund(t, p.admin.cookie, edge.id, 'Khách trả hàng lỗi', { key: 'k'.repeat(64) });
    const longBad = await refund(t, p.admin.cookie, edge.id, 'Khách trả hàng lỗi', { key: 'k'.repeat(65) });
    expect([longOk.status, longBad.status, longBad.body.type]).toEqual([202, 400, 'urn:ecom:error:idempotency-key-required']);
    await t.refunds.idle();
    const third = await succeeded();
    const rid2 = await seedRefund(t, { paymentId: third.id, attemptId: third.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const swap = await refundRetry(t, p.admin.cookie, rid2, { key: kk });
    expect([swap.status, swap.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
  });
});
