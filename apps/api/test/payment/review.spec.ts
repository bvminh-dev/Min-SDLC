import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import {
  attemptsOf, callKey, collect, countOf, createPayApp, createdPayload, deliver, initiate, ipn, ipnQuery, logsOf, MINUTE, newKey, payOutbox, payRow, people, q, race, refund, refundsOf, retry, seedPayment, seedRefund, type PayApp, type SeededPayment,
} from '../support/pay';
import { seedOrder } from '../support/ord';
import { JOB_BATCH } from '../../src/modules/payment/config';

// Bẫy bổ sung của implement theo bài học L (JSON nửa cặp thay thế lẻ và NUL, job giới hạn lô, tải hỗn hợp kiểm bảo toàn tiền, trần tài nguyên cap và cap+1, hold-and-wait ở pool nhỏ, IPN lỗi bất ngờ).
// Mang ID TC gần nhất của từng bẫy.
describe('PAY bẫy bổ sung (JSON, job, tải hỗn hợp, tài nguyên, pool nhỏ)', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  const succeeded = (o: Parameters<typeof seedPayment>[1] = {}) => seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto', ...o });

  it('PAY-TC-20261006-104540563 (L62, T17): JSON nửa cặp thay thế lẻ, NUL và thân sai kiểu ở lý do hoàn tiền, ghi chú COD và các thân rỗng đều là 400 chứ không 500; không dòng nào được ghi', async () => {
    const pay = await succeeded();
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const before = await Promise.all([countOf(t, 'refunds'), countOf(t, 'audit_logs'), countOf(t, 'idempotency_keys')]);
    const raws = ['{"reason":"\\ud800abcdef"}', '{"reason":"abcde\\udc00"}', '{"reason":"abc\\u0000def"}', '[]', '"abcdef"', 'null', '{"reason":["abcdef"]}', '{"reason":{"a":1}}', '{', ''];
    for (const raw of raws) { const r = await callKey(t, `/payments/${pay.id}/refunds`, { cookie: p.admin.cookie, raw }); expect([raw, r.status < 500, [400, 415].includes(r.status)]).toEqual([raw, true, true]); }
    for (const note of ['\\ud800', 'x\\u0000y']) { const r = await collect(t, p.staff.cookie, cod.id, `{"collected_amount":180000,"note":"${note}"}`); expect([note, r.status]).toEqual([note, 400]); }
    for (const raw of ['[]', '"x"', 'null', '{"collected_amount":180000,"collected_amount":1}']) { const r = await collect(t, p.staff.cookie, cod.id, raw); expect([raw, r.status < 500]).toEqual([raw, true]); }
    const ini = await initiate(t, p.a.cookie, pay.id, { raw: '[]' });
    expect(ini.status).toBe(400);
    expect(await Promise.all([countOf(t, 'refunds'), countOf(t, 'audit_logs'), countOf(t, 'idempotency_keys')])).toEqual(before);
    expect(await payRow(t, cod.id)).toMatchObject({ status: 'pending' });
    expect(t.logs.records.filter((r) => r.level === 'error')).toEqual([]); // lỗi đầu vào không phải lỗi 5xx
  });

  it('PAY-TC-20261006-104539686 (SB-34, L: job giới hạn lô): mỗi lượt đối soát lượt thử xử lý tối đa JOB_BATCH dòng; các lượt sau xử lý phần còn lại, không bỏ sót', async () => {
    const now = t.clock.now();
    const stale = { no: 1, status: 'processing' as const, createdAt: new Date(now.getTime() - 20 * MINUTE), expiresAt: new Date(now.getTime() - 10 * MINUTE) };
    const N = JOB_BATCH + 12;
    for (let i = 0; i < N; i++) await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [stale] });
    const r1 = await t.reconcile.run(now);
    expect(r1.checked).toBe(JOB_BATCH);
    expect(t.gw.queries).toHaveLength(JOB_BATCH);
    const r2 = await t.reconcile.run(now);
    expect(r2.checked).toBe(12); // lượt đã thuê không bị hỏi lại, phần còn lại được xử lý
    expect(new Set(t.gw.queries.map((x) => x.txnRef)).size).toBe(N);
    expect(await countOf(t, 'payment_attempts', `status = 'failed' AND reason = 'timeout'`)).toBe(N);
    // job đối soát hoàn tiền cũng giới hạn lô
    t.gw.reset();
    const hold = t.gw.hold();
    for (let i = 0; i < JOB_BATCH + 5; i++) { const x = await succeeded(); await seedRefund(t, { paymentId: x.id, attemptId: x.attempts[0].id, status: 'requested', updatedAt: new Date(now.getTime() - 10 * MINUTE) }); }
    const sweeping = t.refunds.sweep(now);
    await new Promise((x) => setTimeout(x, 300));
    expect(t.gw.refundCalls.length).toBe(1); // dispatch tuần tự: đang treo ở lệnh đầu
    hold();
    expect((await sweeping).reasked).toBe(JOB_BATCH);
    expect((await t.refunds.sweep(now)).reasked).toBe(5);
    expect(t.gw.refundCalls).toHaveLength(JOB_BATCH + 5);
  }, 120_000);

  it('PAY-TC-20261006-104539686 (review REV-PAY-03, SB-34): lượt thử mà cổng luôn lỗi quá JOB_BATCH không chặn lượt còn lại: lượt vừa thuê xuống cuối hàng, hai lượt chạy (cách nhau quá thời gian thuê) hỏi đủ mọi lượt', async () => {
    const now = t.clock.now();
    const stale = { no: 1, status: 'processing' as const, createdAt: new Date(now.getTime() - 40 * MINUTE), expiresAt: new Date(now.getTime() - 30 * MINUTE) };
    const N = JOB_BATCH + 3;
    for (let i = 0; i < N; i++) await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [stale] });
    t.gw.queryImpl = () => ({ kind: 'error' });
    expect((await t.reconcile.run(now)).checked).toBe(JOB_BATCH);
    expect((await t.reconcile.run(new Date(now.getTime() + 2 * MINUTE))).checked).toBe(JOB_BATCH);
    expect(new Set(t.gw.queries.map((x) => x.txnRef)).size).toBe(N); // trước bản sửa: cùng 50 lượt cũ nhất bị hỏi mãi, 3 lượt còn lại không bao giờ
  }, 120_000);

  it('PAY-TC-20261006-104540309 (review REV-PAY-04, SB-34): Refund requested quá 1 giờ mà cổng vẫn không chốt (pending) thì job đối soát hoàn tiền log error refund-stuck và chuyển failed (gateway-no-answer, xem refund-stuck.spec.ts); Refund mới hơn thì chỉ hỏi lại, không error, không chốt', async () => {
    const now = t.clock.now();
    const old = await succeeded(), fresh = await succeeded();
    const rOld = await seedRefund(t, { paymentId: old.id, attemptId: old.attempts[0].id, status: 'requested', createdAt: new Date(now.getTime() - 120 * MINUTE), updatedAt: new Date(now.getTime() - 10 * MINUTE) });
    const rFresh = await seedRefund(t, { paymentId: fresh.id, attemptId: fresh.attempts[0].id, status: 'requested', createdAt: new Date(now.getTime() - 30 * MINUTE), updatedAt: new Date(now.getTime() - 10 * MINUTE) });
    t.gw.refundImpl = () => ({ kind: 'pending' });
    t.logs.clear();
    expect((await t.refunds.sweep(now)).reasked).toBe(2);
    const stuck = t.logs.lines.filter((l) => l.includes('refund-stuck'));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toContain(rOld);
    expect(stuck[0]).not.toContain(rFresh);
    expect(await refundsOf(t, old.id)).toMatchObject([{ status: 'failed', failure_reason: 'gateway-no-answer' }]); // đường kết thúc có hạn, không tự chốt succeeded
    expect(await refundsOf(t, fresh.id)).toMatchObject([{ status: 'requested' }]);
  });

  it('PAY-TC-20261006-104540309 (review REV-PAY-15, SB-24): dispatch chỉ gọi cổng cho Refund đang requested; Refund đã succeeded hay failed trả missing và không có lệnh hoàn nào (không gửi lại lệnh cho khoản đã hoàn)', async () => {
    const done = await succeeded(), failed = await succeeded(), open = await succeeded();
    const rDone = await seedRefund(t, { paymentId: done.id, attemptId: done.attempts[0].id, status: 'succeeded' });
    const rFailed = await seedRefund(t, { paymentId: failed.id, attemptId: failed.attempts[0].id, status: 'failed', nextRetryAt: null });
    const rOpen = await seedRefund(t, { paymentId: open.id, attemptId: open.attempts[0].id, status: 'requested' });
    expect([await t.refunds.dispatch(rDone), await t.refunds.dispatch(rFailed)]).toEqual(['missing', 'missing']);
    expect(t.gw.refundCalls).toHaveLength(0); // trước bản sửa của test: đột biến bỏ điều kiện status lọt (REV-M18)
    expect(await t.refunds.dispatch(rOpen)).toBe('done');
    expect(t.gw.refundCalls).toHaveLength(1);
  });

  it('PAY-TC-20261006-104539196 (T4, SB-24, tiền): tải hỗn hợp song song (IPN thành công và thất bại, trùng, thanh toán muộn, hủy, hết hạn, StockCommitFailed, hoàn tay, thu COD) rồi kiểm BẢO TOÀN TIỀN: mỗi Payment đúng một PaymentSucceeded, mỗi giao dịch cổng tối đa một Refund, tiền giữ lại là 0 hoặc đúng một lần số tiền (và chỉ khi Payment succeeded)', async () => {
    let seed = 20261008; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const now = t.clock.now();
    const stale = (no: number, status: 'processing' | 'failed') => ({ no, status, reason: status === 'failed' ? ('timeout' as const) : null, createdAt: new Date(now.getTime() - (20 - no) * 1000), expiresAt: new Date(now.getTime() + 10 * MINUTE) });
    type Item = { pay: SeededPayment; kind: 'online2' | 'online1' | 'pending' | 'cod' };
    const items: Item[] = [];
    for (let i = 0; i < 14; i++) items.push({ kind: 'online2', pay: await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 2, attempts: [stale(1, 'failed'), stale(2, 'processing')] }) });
    for (let i = 0; i < 10; i++) items.push({ kind: 'online1', pay: await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [stale(1, 'processing')] }) });
    for (let i = 0; i < 6; i++) items.push({ kind: 'pending', pay: await seedPayment(t, { user: p.a.id, status: 'pending' }) });
    for (let i = 0; i < 6; i++) items.push({ kind: 'cod', pay: await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' }) });
    const ops: (() => Promise<unknown>)[] = [];
    const ev = (type: string, o: { id: string; code: string; user: string }, extra: Record<string, unknown> = {}) => () => deliver(t, type, { order_id: o.id, order_code: o.code, user_id: o.user, ...extra });
    for (const { kind, pay } of items) {
      const o = pay.order;
      const ipnOf = (i: number, code: string) => () => ipn(t, ipnQuery({ txnRef: pay.attempts[i].txnRef, amount: 350000, code, txNo: `7${Math.floor(rnd() * 1e9)}${i}${pay.id.slice(0, 3).replace(/\D/g, '0')}` }));
      if (kind === 'online2') ops.push(ipnOf(0, '00'), ipnOf(1, '00'), ipnOf(1, '00'), ipnOf(1, '24'), ev('OrderCancelled', o, { reason: 'customer_request', was_paid: false }), ev('StockCommitFailed', o, { reason: 'reservation_expired' }), () => refund(t, p.admin.cookie, pay.id, 'Hoàn tay khi tải hỗn hợp'));
      if (kind === 'online1') ops.push(ipnOf(0, '00'), ipnOf(0, '00'), ipnOf(0, '51'), ev('OrderExpired', o), ev('OrderCancelled', o, { reason: 'admin', was_paid: true }), () => refund(t, p.admin.cookie, pay.id, 'Hoàn tay khi tải hỗn hợp'));
      if (kind === 'pending') ops.push(() => initiate(t, p.a.cookie, pay.id), () => initiate(t, p.a.cookie, pay.id), ev('OrderExpired', o), ev('OrderCancelled', o));
      if (kind === 'cod') ops.push(() => collect(t, p.staff.cookie, pay.id, { collected_amount: 180000 }), () => collect(t, p.admin.cookie, pay.id, { collected_amount: 180000 }), ev('OrderDelivered', o, { delivered_at: new Date().toISOString() }), ev('OrderCancelled', o, { reason: 'customer_request', was_paid: false }), ev('OrderReturned', o));
    }
    for (let i = ops.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ops[i], ops[j]] = [ops[j], ops[i]]; }
    for (let i = 0; i < ops.length; i += 12) {
      await Promise.allSettled(ops.slice(i, i + 12).map((f) => f()));
      t.clock.advance(61_000); // sang cửa sổ giới hạn tần suất mới để HTTP không bị 429 che đua
    }
    await t.refunds.idle();
    await t.refunds.sweep(new Date(Date.now() + 3_600_000)); // hoàn tiền còn requested (dòng chưa thấy khi gọi) được đối soát
    await t.refunds.idle();
    // bất biến bảo toàn tiền
    expect(await q(t, `SELECT payment_id FROM (SELECT (payload->>'payment_id') AS payment_id, count(*) AS n FROM outbox_events WHERE type = 'PaymentSucceeded' GROUP BY 1) x WHERE n > 1`)).toEqual([]); // đúng một PaymentSucceeded mỗi Payment
    expect(await q(t, `SELECT payload->>'payment_id' AS id FROM outbox_events WHERE type = 'PaymentRefunded' GROUP BY 1 HAVING count(*) > 1`)).toEqual([]);
    expect(await q(t, `SELECT attempt_id FROM refunds GROUP BY attempt_id HAVING count(*) > 1`)).toEqual([]);
    expect(await countOf(t, 'refunds', `status <> 'succeeded'`)).toBe(0); // cổng giả luôn xác nhận: không Refund nào kẹt
    const rows = await q<{ id: string; status: string; method: string; amount: string; provider_ref: string | null; collected: number; refunded: string; win_refunded: number; own_attempts: number }>(t, `
      SELECT p.id, p.status::text AS status, p.method::text AS method, p.amount::text AS amount, p.provider_ref,
             (SELECT count(*)::int FROM payment_attempts a WHERE a.payment_id = p.id AND a.status = 'succeeded') AS collected,
             (SELECT COALESCE(sum(r.amount), 0)::text FROM refunds r WHERE r.payment_id = p.id AND r.status = 'succeeded') AS refunded,
             (SELECT count(*)::int FROM refunds r JOIN payment_attempts a ON a.id = r.attempt_id WHERE r.payment_id = p.id AND r.status = 'succeeded' AND a.provider_txn_no = p.provider_ref) AS win_refunded,
             (SELECT count(*)::int FROM payment_attempts a WHERE a.payment_id = p.id AND a.provider_txn_no = p.provider_ref) AS own_attempts
      FROM payments p`);
    expect(rows.length).toBe(items.length);
    let collectedTotal = 0, refundedTotal = 0, kept = 0;
    for (const r of rows) {
      const amount = Number(r.amount), refunded = Number(r.refunded);
      const inMoney = r.method === 'vnpay' ? r.collected * amount : r.status === 'succeeded' ? amount : 0;
      const keptHere = inMoney - refunded;
      collectedTotal += inMoney; refundedTotal += refunded; kept += keptHere;
      expect([r.id, refunded <= inMoney]).toEqual([r.id, true]); // không bao giờ hoàn nhiều hơn đã thu
      expect([r.id, r.method === 'cod' ? refunded : 0]).toEqual([r.id, 0]); // COD không hoàn tự động
      if (r.status === 'succeeded') expect([r.id, keptHere]).toEqual([r.id, amount]); // giữ đúng một lần số tiền
      else expect([r.id, r.status, keptHere]).toEqual([r.id, r.status, 0]); // đã đóng, đã hoàn hay chưa thu: không giữ đồng nào
      if (r.status === 'refunded') expect([r.id, r.win_refunded]).toEqual([r.id, 1]); // refunded khi và chỉ khi Refund giao dịch chính đã succeeded
      if (r.status === 'succeeded' && r.method === 'vnpay') { expect([r.id, r.win_refunded, r.own_attempts]).toEqual([r.id, 0, 1]); expect(r.provider_ref).not.toBeNull(); }
    }
    expect(collectedTotal - refundedTotal).toBe(kept);
    expect(rows.filter((r) => r.status === 'succeeded').length * 1).toBeGreaterThan(0);
    expect(rows.filter((r) => r.status === 'refunded').length + rows.filter((r) => ['expired', 'cancelled'].includes(r.status)).length).toBeGreaterThan(0); // tải có phủ cả hoàn tiền và đóng
    // mỗi lượt thành công không phải giao dịch của Payment đang succeeded đều có Refund
    expect(await q(t, `SELECT a.id FROM payment_attempts a JOIN payments p ON p.id = a.payment_id LEFT JOIN refunds r ON r.attempt_id = a.id
                       WHERE a.status = 'succeeded' AND r.id IS NULL AND NOT (p.status = 'succeeded' AND a.provider_txn_no = p.provider_ref)`)).toEqual([]);
  }, 180_000);

  it('PAY-TC-20261006-104539196 (T4): IPN thất bại và IPN thành công của cùng lượt thử, và IPN thành công chạy chồng với đối soát (20 vòng): luôn đúng một kết cục nhất quán, tối đa một PaymentSucceeded', async () => {
    const now = t.clock.now();
    for (let i = 0; i < 20; i++) {
      const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: [{ no: 1, status: 'processing', createdAt: new Date(now.getTime() - 30 * MINUTE), expiresAt: new Date(now.getTime() - 10 * MINUTE) }] });
      const ref = pay.attempts[0].txnRef;
      if (i % 2 === 0) { // thành công và thất bại cùng lúc
        await race(() => ipn(t, ipnQuery({ txnRef: ref, amount: 350000 })), () => ipn(t, ipnQuery({ txnRef: ref, amount: 350000, code: '24' })));
        const a = (await attemptsOf(t, pay.id))[0];
        const succeeded = (await payOutbox(t, 'PaymentSucceeded')).filter((e) => e.payload.payment_id === pay.id).length;
        const failed = (await payOutbox(t, 'PaymentFailed')).filter((e) => e.payload.payment_id === pay.id).length;
        expect([a.status === 'succeeded' ? [1, 0] : [0, 1]]).toEqual([[succeeded, failed]]); // đúng một kết cục, không có cả hai event
        expect((await payRow(t, pay.id)).status).toBe(a.status === 'succeeded' ? 'succeeded' : 'failed');
      } else { // IPN thành công chạy chồng với job đối soát (cổng báo không có giao dịch)
        t.gw.queryImpl = () => ({ kind: 'not_found' });
        await race(() => ipn(t, ipnQuery({ txnRef: ref, amount: 350000, txNo: `8${i}${pay.id.slice(0, 4).replace(/\D/g, '1')}` })), () => t.reconcile.run(new Date(now.getTime() + i * 60_000 + 60_000)));
        expect((await payRow(t, pay.id)).status).toBe('succeeded'); // thành công muộn của lượt timeout vẫn được nhận
        expect((await payOutbox(t, 'PaymentSucceeded')).filter((e) => e.payload.payment_id === pay.id)).toHaveLength(1);
        expect((await attemptsOf(t, pay.id))[0].status).toBe('succeeded');
      }
    }
  }, 120_000);

  it('PAY-TC-20261006-104539001 (L: trần tài nguyên cap và cap+1): IPN mang 150 tham số vnp_ lạ vẫn xử lý nhưng nhật ký chỉ lưu bảy trường cho phép (cả 1000 tham số thì máy chủ từ chối 431, không sập), mỗi trường tối đa 64 ký tự; chi tiết quản trị trả tối đa 100 dòng nhật ký (100 đủ, 101 cắt dòng cũ nhất)', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const junk = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`vnp_Junk${i}`, `giá-trị-${i}`]));
    const r = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, extra: { ...junk, vnp_BankCode: 'N'.repeat(65) } }));
    expect(r.body.RspCode).toBe('00');
    const [l] = await logsOf(t);
    expect(Object.keys(l.payload).sort()).toEqual(['vnp_Amount', 'vnp_PayDate', 'vnp_ResponseCode', 'vnp_TransactionNo', 'vnp_TransactionStatus', 'vnp_TxnRef']); // vnp_BankCode dài 65 ký tự bị bỏ, không có trường lạ
    expect(JSON.stringify(l.payload)).not.toContain('Junk');
    const huge = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, extra: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`vnp_Junk${i}`, 'x'.repeat(20)])) }));
    expect([400, 413, 414, 431]).toContain(huge.status); // thân hay tiêu đề quá lớn bị từ chối ở máy chủ HTTP
    expect(await countOf(t, 'payment_webhook_logs')).toBe(1);
    const bank64 = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    await ipn(t, ipnQuery({ txnRef: bank64.attempts[0].txnRef, amount: 350000, bank: 'N'.repeat(64) }));
    expect((await logsOf(t, bank64.attempts[0].txnRef))[0].payload.vnp_BankCode).toBe('N'.repeat(64)); // đúng cap: giữ
    // chi tiết quản trị: 100 dòng đủ, 101 dòng chỉ trả 100 dòng mới nhất
    const many = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const ins = (n: number) => q(t, `INSERT INTO payment_webhook_logs (payment_id, txn_ref, payload, signature_valid, rsp_code, result, created_at) SELECT '${many.id}', NULL, '{}', true, '02', 'duplicate', now() - make_interval(secs => g) FROM generate_series(1, ${n}) g`);
    await ins(100);
    expect((await (await import('../support/pay')).call(t, 'get', `/admin/payments/${many.id}`, { cookie: p.staff.cookie })).body.webhook_logs).toHaveLength(100);
    await q(t, `INSERT INTO payment_webhook_logs (payment_id, payload, signature_valid, rsp_code, result, created_at) VALUES ('${many.id}', '{}', true, '97', 'invalid_signature', now() - interval '1 day')`);
    const d = (await (await import('../support/pay')).call(t, 'get', `/admin/payments/${many.id}`, { cookie: p.staff.cookie })).body;
    expect(d.webhook_logs).toHaveLength(100);
    expect(d.webhook_logs.some((x: { rsp_code: string }) => x.rsp_code === '97')).toBe(false); // dòng cũ nhất bị cắt
    // dọn nhật ký quá 12 tháng theo lô: hơn một lô (1000) vẫn dọn hết
    await q(t, `INSERT INTO payment_webhook_logs (payload, signature_valid, rsp_code, result, created_at) SELECT '{}', true, '01', 'unknown_txn', now() - interval '13 months' - make_interval(secs => g) FROM generate_series(1, 2100) g`);
    const old = await countOf(t, 'payment_webhook_logs', `created_at < now() - interval '12 months'`);
    expect(old).toBe(2100);
    expect(await t.reconcile.purgeWebhookLogs()).toBe(2100);
    expect(await countOf(t, 'payment_webhook_logs', `created_at < now() - interval '12 months'`)).toBe(0);
  }, 120_000);

  it('PAY-TC-20261006-104539001 (SB-31, L87): IPN khi ORD đọc lỗi bất ngờ trả RspCode 99 (cổng gọi lại), không đổi gì và không lộ lỗi; lần gọi lại sau khi ORD hồi phục thành công; IPN vẫn trả 200 JSON khi lỗi CSDL', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const query = ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000 });
    jest.spyOn(t.ord, 'findForPayment').mockRejectedValueOnce(new Error('ORD mất kết nối'));
    const bad = await ipn(t, query);
    expect([bad.status, bad.body]).toEqual([200, { RspCode: '99', Message: 'Unknown error' }]);
    expect(JSON.stringify(bad.body)).not.toMatch(/ORD|kết nối|Error|stack/);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing' });
    expect(t.logs.records.some((r) => r.level === 'error' && r.code === 'ipn-internal-error')).toBe(true);
    expect(t.logs.lines.join('\n')).not.toContain(query.vnp_SecureHash);
    expect((await ipn(t, query)).body.RspCode).toBe('00'); // cổng gọi lại
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded' });
    // thành công mà thiếu mã giao dịch cổng: không tin, 99 để cổng gọi lại, không đổi gì
    const x = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const noTx = await ipn(t, ipnQuery({ txnRef: x.attempts[0].txnRef, amount: 350000, omitTxNo: true }));
    expect(noTx.body.RspCode).toBe('99');
    expect(await payRow(t, x.id)).toMatchObject({ status: 'processing' });
    // mã tham chiếu viết hoa: không khớp (khuôn là hex thường)
    const up = await ipn(t, ipnQuery({ txnRef: x.attempts[0].txnRef.toUpperCase(), amount: 350000 }));
    expect(up.body.RspCode).toBe('01');
  });

  it('PAY-TC-20261006-104538969 (T13, SB-14, R-42): các bậc giới hạn tần suất còn lại: đọc của customer 60 mỗi phút, ba endpoint quản trị 30, hoàn tiền của admin 20, ghi nhận thu COD 30; lần vượt trả 429 kèm Retry-After; đúng cap thì qua, cap+1 thì 429', async () => {
    const { call: get } = await import('../support/pay');
    const hit = async (n: number, f: () => Promise<{ status: number; headers: Record<string, string> }>) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push((await f()).status); return out; };
    const cap = async (name: string, limit: number, f: () => Promise<{ status: number; headers: Record<string, string> }>) => {
      t.clock.advance(61_000);
      const codes = await hit(limit + 1, f);
      expect([name, codes.slice(0, limit).every((c) => c !== 429), codes[limit]]).toEqual([name, true, 429]);
      const over = await f();
      expect([name, over.status, Number(over.headers['retry-after']) > 0]).toEqual([name, 429, true]);
    };
    const pay = await succeeded();
    await cap('đọc của customer', 60, () => get(t, 'get', '/payments', { cookie: p.a.cookie }));
    await cap('quản trị: danh sách', 30, () => get(t, 'get', '/admin/payments', { cookie: p.staff.cookie }));
    t.clock.advance(61_000);
    // ba endpoint quản trị chung một bộ đếm: 10 danh sách, 10 chi tiết, 10 hàng đợi là đủ 30; yêu cầu thứ 31 bất kỳ bị chặn
    for (let i = 0; i < 10; i++) await get(t, 'get', '/admin/payments', { cookie: p.admin.cookie });
    for (let i = 0; i < 10; i++) await get(t, 'get', `/admin/payments/${pay.id}`, { cookie: p.admin.cookie });
    for (let i = 0; i < 10; i++) await get(t, 'get', '/admin/refunds', { cookie: p.admin.cookie });
    expect((await get(t, 'get', '/admin/refunds', { cookie: p.admin.cookie })).status).toBe(429);
    await cap('hoàn tiền của admin', 20, () => refund(t, p.admin.cookie, pay.id, 'Khách trả hàng lỗi'));
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'shipped' });
    await cap('ghi nhận thu COD', 30, () => collect(t, p.staff.cookie, cod.id, { collected_amount: 180000 }));
  }, 120_000);

  it('PAY-TC-20261006-104540277 (SB-34): job tự thử lại bỏ hẹn của Refund failed khi Payment không còn succeeded (không gọi cổng); Refund failed của admin_manual (không auto_attempt_no) không bao giờ có hẹn tự thử', async () => {
    const now = t.clock.now();
    const closed = await seedPayment(t, { user: p.a.id, status: 'refunded', attemptNo: 1, attempts: [{ no: 1, status: 'succeeded' }], providerRef: '14012345' });
    const rid = await seedRefund(t, { paymentId: closed.id, attemptId: closed.attempts[0].id, status: 'failed', autoAttemptNo: 1, nextRetryAt: new Date(now.getTime() - 1000) });
    const r = await t.refunds.sweep(now);
    expect(r).toEqual({ retried: 0, reasked: 0, gaveUp: 0 });
    expect(t.gw.refundCalls).toEqual([]);
    expect((await refundsOf(t, closed.id)).find((x) => x.id === rid)).toMatchObject({ status: 'failed', next_retry_at: null });
    const manual = await succeeded();
    const declined = await seedRefund(t, { paymentId: manual.id, attemptId: manual.attempts[0].id, reason: 'admin_manual', status: 'requested', autoAttemptNo: null });
    t.gw.refundImpl = () => ({ kind: 'declined', code: '93' });
    await t.refunds.dispatch(declined);
    expect((await refundsOf(t, manual.id))[0]).toMatchObject({ status: 'failed', auto_attempt_no: null, next_retry_at: null });
  });

  it('PAY-TC-20261006-104539065 (L62, SB-11): IPN mang NUL hoặc ký tự lạ ở các tham số (đã ký đúng) vẫn trả 200 với RspCode theo hợp đồng, không 500; NUL ở trường được lưu vào nhật ký bị bỏ; không dòng nào hỏng', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const ref = pay.attempts[0].txnRef;
    const cases: [string, Record<string, string>, string][] = [
      ['NUL ở tham số không lưu', { vnp_Foo: 'a\u0000b' }, '00'],
      ['NUL ở mã giao dịch cổng', { vnp_TransactionNo: '14\u000012' }, '99'],
    ];
    const before = await countOf(t, 'payment_webhook_logs');
    const r0 = await ipn(t, ipnQuery({ txnRef: `${ref}\u0000`, amount: 350000 }));
    expect([r0.status, r0.body.RspCode]).toEqual([200, '01']); // mã tham chiếu có NUL không khớp lượt nào
    const r1 = await ipn(t, ipnQuery({ txnRef: ref, amount: 350000, code: '24\u0000' }));
    expect([r1.status, typeof r1.body.RspCode]).toEqual([200, 'string']);
    expect(await countOf(t, 'payment_webhook_logs')).toBeGreaterThan(before);
    for (const [name, extra, want] of cases) {
      const x = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
      const r = await ipn(t, ipnQuery({ txnRef: x.attempts[0].txnRef, amount: 350000, extra }));
      expect([name, r.status, r.body.RspCode]).toEqual([name, 200, want]);
      expect(JSON.stringify((await logsOf(t, x.attempts[0].txnRef)).map((l) => l.payload))).not.toContain('\\u0000');
    }
    expect(t.logs.records.filter((r) => r.level === 'error' && r.code === 'ipn-internal-error')).toEqual([]);
  });

  it('PAY-TC-20261006-104538638 (L87): ở pool kết nối nhỏ nhất (DB_POOL_MAX = 2) các thao tác song song không treo: tám OrderCreated giao tuần tự như relay, tám initiate, tám retry cùng một Payment và tám IPN song song đều xong (ORD đọc bằng kết nối thứ hai, không trong giao dịch giữ khóa)', async () => {
    const small = await createPayApp({ env: { DB_POOL_MAX: '2' } });
    try {
      const pp = { a: await (await import('../support/pay')).who(small, 'customer', 'pool-a@x.vn') };
      const orders = [];
      for (let i = 0; i < 8; i++) orders.push(await seedOrder(small, { status: 'pending', method: 'vnpay', payment: 'pending' }));
      const t0 = Date.now();
      for (const o of orders) await deliver(small, 'OrderCreated', createdPayload(o)); // relay giao tuần tự (job có khóa tư vấn): handler giữ một kết nối của giao dịch giao event và đọc ORD bằng kết nối thứ hai nên pool tối thiểu 2 (platform); giao song song ở pool 2 là ngoài thiết kế (SHP report mục 7)
      expect(await countOf(small, 'payments')).toBe(8);
      const pays = await Promise.all(Array.from({ length: 8 }, () => seedPayment(small, { user: pp.a.id, status: 'pending' })));
      const rs = await Promise.all(pays.map((x) => initiate(small, pp.a.cookie, x.id)));
      expect(rs.map((r) => r.status)).toEqual(Array(8).fill(200));
      small.clock.advance(61_000);
      const same = await seedPayment(small, { user: pp.a.id, status: 'failed', attemptNo: 1, attempts: 'auto' });
      const many = await Promise.all(Array.from({ length: 8 }, () => retry(small, pp.a.cookie, same.id)));
      expect(many.map((r) => r.status)).toEqual(Array(8).fill(200)); // cùng Payment: tám yêu cầu chờ cùng một khóa dòng
      const ipns = await Promise.all(pays.map(async (x, i) => { const a = (await attemptsOf(small, x.id))[0]; return ipn(small, ipnQuery({ txnRef: a.txn_ref, amount: 350000, txNo: `6${i}${x.id.slice(0, 4).replace(/\D/g, '2')}` })); }));
      expect(ipns.map((r) => r.body.RspCode)).toEqual(Array(8).fill('00'));
      expect(Date.now() - t0).toBeLessThan(30_000);
    } finally { await truncateAll(small.prisma); await small.close(); }
  }, 90_000);

  it('PAY-TC-20261006-104538604 (T9): OrderCreated với payload độc (khóa lạ, chuỗi lạ ở mã đơn) không tạo Payment ngoài khuôn và không chép chuỗi lạ vào log', async () => {
    const o = await seedOrder(t, { status: 'pending', method: 'vnpay', payment: 'pending' });
    const evil = '<script>alert(1)</script> 7K3M9Q2XH4TB';
    await deliver(t, 'OrderCreated', createdPayload(o, { order_code: evil }));
    await deliver(t, 'OrderCancelled', { order_id: o.id, order_code: evil, user_id: o.user, reason: 'admin', was_paid: false });
    expect(await countOf(t, 'payments')).toBe(0);
    expect(t.logs.lines.join('\n')).not.toContain('alert(1)');
    expect(randomUUID()).toBeTruthy();
    void newKey;
  });
});
