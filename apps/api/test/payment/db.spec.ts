import { randomBytes } from 'node:crypto';
import { truncateAll } from '../support/db';
import { createPayApp, pgCode, q, seedPayment, seedRefund, txnRefOf, type PayApp } from '../support/pay';
import { insertOrder } from '../support/order-fixture';
import { TRANSITIONS } from '../../src/modules/payment/config';

// Lược đồ dữ liệu thanh toán (PAY-DB-20261006-103701241): từng CHECK, unique, khóa ngoại, trigger vòng đời và trigger chỉ-thêm của migration 20261008000200_payment_tables. Mang ID tài liệu PAY-DB và PAY-SEC (chưa có TC riêng cho lược đồ).
const DB = 'PAY-DB-20261006-103701241';
describe(`Lược đồ thanh toán (${DB})`, () => {
  let t: PayApp;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); });
  const user = async () => (await q<{ id: string }>(t, `INSERT INTO users (email, password_hash, full_name, role, created_at, updated_at) VALUES ('u${randomBytes(4).toString('hex')}@x.vn', 'h', 'U', 'customer', now(), now()) RETURNING id`))[0].id;
  const order = async () => insertOrder(t.prisma, t.clock.now(), { user: await user(), status: 'pending', method: 'vnpay' });
  const hex = (n: number) => randomBytes(n / 2).toString('hex');
  /** Chèn một Payment qua SQL thô với các cột ghi đè; trả mã SQLSTATE. */
  const insertPayment = async (over: Record<string, string | number | null> = {}, o?: { id: string; code: string; user: string }) => {
    const ord = o ?? await order();
    const v = { order_id: `'${ord.id}'`, order_code: `'${ord.code}'`, user_id: `'${ord.user}'`, amount: '350000', method: `'vnpay'`, status: `'pending'`, attempt_no: '0', provider_ref: 'NULL', expires_at: `now() + interval '15 minutes'`, paid_at: 'NULL', version: '0', ...Object.fromEntries(Object.entries(over).map(([k, x]) => [k, x === null ? 'NULL' : String(x)])) };
    return pgCode(q(t, `INSERT INTO payments (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`));
  };

  it(`${DB} payments: CHECK số tiền dương, số lượt 0..10, online bắt buộc có hạn, succeeded có paid_at và mã giao dịch, khuôn mã đơn, version không âm; unique order_id; khóa ngoại tới orders (PAY-TC-20261006-104538604, PAY-TC-20261006-104538671)`, async () => {
    expect(await insertPayment()).toBe('ok');
    expect(await insertPayment({ amount: 0 })).toBe('23514');
    expect(await insertPayment({ amount: -5 })).toBe('23514');
    expect(await insertPayment({ attempt_no: 11 })).toBe('23514');
    expect(await insertPayment({ attempt_no: -1 })).toBe('23514');
    expect(await insertPayment({ attempt_no: 10 })).toBe('ok'); // trần schema (giới hạn chính là PAY_MAX_ATTEMPTS ở ứng dụng)
    expect(await insertPayment({ expires_at: null })).toBe('23514'); // online không có hạn
    expect(await insertPayment({ method: `'cod'`, expires_at: null })).toBe('ok'); // COD không cần hạn
    expect(await insertPayment({ status: `'succeeded'`, paid_at: null, provider_ref: `'14012345'` })).toBe('23514');
    expect(await insertPayment({ status: `'succeeded'`, paid_at: 'now()', provider_ref: null })).toBe('23514'); // online succeeded không có mã giao dịch cổng
    expect(await insertPayment({ status: `'succeeded'`, paid_at: 'now()', provider_ref: `'14012345'` })).toBe('ok');
    expect(await insertPayment({ method: `'cod'`, expires_at: null, status: `'succeeded'`, paid_at: 'now()' })).toBe('ok'); // COD succeeded không cần mã cổng
    expect(await insertPayment({ order_code: `'khong-hop-le'` })).toBe('23514');
    expect(await insertPayment({ order_code: `'7k3m9q2xh4tb'` })).toBe('23514'); // chữ thường: mã đơn là bản sao chuẩn hóa chữ hoa
    expect(await insertPayment({ version: -1 })).toBe('23514');
    const o = await order();
    expect(await insertPayment({}, o)).toBe('ok');
    expect(await insertPayment({}, o)).toBe('23505'); // unique (order_id): mỗi đơn một Payment
    expect(await insertPayment({ order_id: `'${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}'` })).toBe('23503'); // khóa ngoại tới orders
    expect(await pgCode(q(t, `DELETE FROM orders WHERE id = '${o.id}'`))).toBe('23503'); // ON DELETE RESTRICT: đơn có Payment không xóa được
    const fk = await q<{ conname: string; confdeltype: string }>(t, `SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint WHERE contype = 'f' AND conname IN ('payments_order_id_fkey', 'payment_attempts_payment_id_fkey', 'refunds_payment_id_fkey', 'refunds_attempt_id_fkey') ORDER BY conname`);
    expect(fk.map((r) => [r.conname, r.confdeltype])).toEqual([['payment_attempts_payment_id_fkey', 'r'], ['payments_order_id_fkey', 'r'], ['refunds_attempt_id_fkey', 'r'], ['refunds_payment_id_fkey', 'r']]); // ON DELETE RESTRICT ('r'), không phụ thuộc khóa ngoại khác của orders chặn trước
    expect(await insertPayment({ method: `'paypal'` })).toBe('22P02'); // enum payment_method
    expect(await insertPayment({ status: `'paid'` })).toBe('22P02'); // enum payment_status
  });

  it(`${DB} payment_attempts: CHECK số lượt, khuôn txn_ref, reason chỉ ở lượt thất bại, thành công có mã giao dịch, resolved_at khớp trạng thái, hạn sau giờ tạo; unique txn_ref, (payment_id, attempt_no), provider_txn_no; khóa ngoại (PAY-TC-20261006-104539262)`, async () => {
    const pay = await seedPayment(t, { status: 'processing', attemptNo: 1, attempts: [] });
    const ins = (over: Record<string, string | number | null> = {}, id = pay.id) => {
      const v = { payment_id: `'${id}'`, attempt_no: '1', txn_ref: `'${txnRefOf(1)}'`, status: `'processing'`, reason: 'NULL', provider_txn_no: 'NULL', create_date: 'now()', expires_at: `now() + interval '10 minutes'`, resolved_at: 'NULL', ...Object.fromEntries(Object.entries(over).map(([k, x]) => [k, x === null ? 'NULL' : String(x)])) };
      return pgCode(q(t, `INSERT INTO payment_attempts (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`));
    };
    expect(await ins()).toBe('ok');
    expect(await ins({ attempt_no: 0 })).toBe('23514');
    expect(await ins({ attempt_no: 11 })).toBe('23514');
    expect(await ins({ attempt_no: 2, txn_ref: `'ABCDEF0123456789ab'` })).toBe('23514'); // khuôn: 16 hex thường và hai chữ số
    expect(await ins({ attempt_no: 2, txn_ref: `'${hex(16)}0'` })).toBe('23514'); // thiếu số lượt hai chữ số
    expect(await ins({ attempt_no: 2, txn_ref: `'${hex(16)}ab'` })).toBe('23514');
    expect(await ins({ attempt_no: 2, reason: `'declined'` })).toBe('23514'); // reason chỉ ở lượt failed
    expect(await ins({ attempt_no: 2, status: `'failed'`, reason: `'declined'`, resolved_at: 'now()' })).toBe('ok');
    expect(await ins({ attempt_no: 3, status: `'failed'`, reason: `'gateway_error'`, resolved_at: 'now()' })).toBe('22P02'); // enum payment_fail_reason
    expect(await ins({ attempt_no: 3, status: `'succeeded'`, provider_txn_no: null, resolved_at: 'now()' })).toBe('23514'); // succeeded có mã giao dịch
    expect(await ins({ attempt_no: 3, status: `'processing'`, resolved_at: 'now()' })).toBe('23514'); // processing chưa có resolved_at
    expect(await ins({ attempt_no: 3, status: `'failed'`, resolved_at: null })).toBe('23514'); // đã kết thúc phải có resolved_at
    expect(await ins({ attempt_no: 3, expires_at: `now() - interval '1 minute'` })).toBe('23514'); // hạn sau giờ tạo
    expect(await ins({ attempt_no: 3, status: `'bogus'` })).toBe('22P02');
    const ref = txnRefOf(4);
    expect(await ins({ attempt_no: 4, txn_ref: `'${ref}'` })).toBe('ok');
    expect(await ins({ attempt_no: 5, txn_ref: `'${ref}'` })).toBe('23505'); // unique txn_ref
    expect(await ins({ attempt_no: 4 })).toBe('23505'); // unique (payment_id, attempt_no)
    expect(await ins({ attempt_no: 6, status: `'succeeded'`, provider_txn_no: `'14012345'`, resolved_at: 'now()' })).toBe('ok');
    expect(await ins({ attempt_no: 7, status: `'succeeded'`, provider_txn_no: `'14012345'`, resolved_at: 'now()' })).toBe('23505'); // một giao dịch cổng chỉ gắn một lượt
    expect(await ins({ attempt_no: 8, status: `'succeeded'`, provider_txn_no: `'14012346'`, resolved_at: 'now()' }, '00000000-0000-4000-8000-000000000000')).toBe('23503'); // khóa ngoại tới payments
    expect(await pgCode(q(t, `DELETE FROM payments WHERE id = '${pay.id}'`))).toBe('23503'); // RESTRICT
  });

  it(`${DB} refunds: CHECK số tiền, ghi chú 5..300 chỉ khi admin_manual, người yêu cầu, lý do lỗi và hẹn thử chỉ khi failed, resolved_at, mã yêu cầu 32 hex, số lần tự thử 1..3; unique attempt_id; khóa ngoại (PAY-TC-20261006-104540277)`, async () => {
    const pay = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const admin = `'${pay.order.user}'`;
    // mỗi lần chèn một Payment và lượt thử riêng (unique attempt_id không che các CHECK khác)
    const ins = async (over: Record<string, string | number | null> = {}) => {
      const x = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
      const v = { payment_id: `'${x.id}'`, attempt_id: `'${x.attempts[0].id}'`, amount: '350000', reason: `'order_cancelled'`, note: 'NULL', requested_by: 'NULL', status: `'requested'`, failure_reason: 'NULL', gateway_request_id: `'${hex(32)}'`, auto_attempt_no: '1', next_retry_at: 'NULL', resolved_at: 'NULL', ...Object.fromEntries(Object.entries(over).map(([k, x2]) => [k, x2 === null ? 'NULL' : String(x2)])) };
      return pgCode(q(t, `INSERT INTO refunds (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`));
    };
    expect(await ins()).toBe('ok');
    expect(await ins({ amount: 0 })).toBe('23514');
    expect(await ins({ amount: -350000 })).toBe('23514'); // số âm cũng bị chặn (REV-M34: CHECK yếu thành khác 0 từng lọt)
    expect(await ins({ reason: `'admin_manual'`, note: null })).toBe('23514'); // hoàn thủ công bắt buộc có ghi chú
    expect(await ins({ reason: `'order_cancelled'`, note: `'Khách trả hàng lỗi'` })).toBe('23514'); // ghi chú chỉ khi admin_manual
    expect(await ins({ reason: `'admin_manual'`, note: `'abcd'`, auto_attempt_no: null })).toBe('23514');
    expect(await ins({ reason: `'admin_manual'`, note: `'${'x'.repeat(301)}'`, auto_attempt_no: null })).toBe('23514');
    expect(await ins({ reason: `'admin_manual'`, note: `'${'x'.repeat(300)}'`, auto_attempt_no: null, requested_by: admin })).toBe('ok');
    expect(await ins({ requested_by: admin })).toBe('23514'); // người yêu cầu chỉ ở hoàn thủ công
    expect(await ins({ failure_reason: `'gateway-declined'` })).toBe('23514'); // chỉ khi failed
    expect(await ins({ next_retry_at: 'now()' })).toBe('23514'); // chỉ khi failed
    expect(await ins({ status: `'failed'`, failure_reason: `'gateway-declined'`, resolved_at: 'now()', next_retry_at: 'now()' })).toBe('ok');
    expect(await ins({ status: `'succeeded'`, resolved_at: null })).toBe('23514'); // đã chốt phải có resolved_at
    expect(await ins({ status: `'requested'`, resolved_at: 'now()' })).toBe('23514'); // requested chưa có resolved_at
    expect(await ins({ gateway_request_id: `'${hex(31)}1x'` })).toBe('23514'); // 32 ký tự hex
    expect(await ins({ gateway_request_id: `'${hex(30)}'` })).toBe('23514');
    expect(await ins({ auto_attempt_no: 0 })).toBe('23514');
    expect(await ins({ auto_attempt_no: 4 })).toBe('23514');
    expect(await ins({ auto_attempt_no: 3 })).toBe('ok');
    expect(await ins({ reason: `'refund_all'` })).toBe('22P02'); // enum refund_reason
    // unique attempt_id: mỗi giao dịch cổng một Refund trọn đời
    await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'requested' });
    const dup = await pgCode(q(t, `INSERT INTO refunds (payment_id, attempt_id, amount, reason, gateway_request_id, auto_attempt_no) VALUES ('${pay.id}', '${pay.attempts[0].id}', 350000, 'late_payment', '${hex(32)}', 1)`));
    expect(dup).toBe('23505');
    const fresh = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    expect(await pgCode(q(t, `INSERT INTO refunds (payment_id, attempt_id, amount, reason, gateway_request_id, auto_attempt_no) VALUES ('00000000-0000-4000-8000-000000000000', '${fresh.attempts[0].id}', 350000, 'late_payment', '${hex(32)}', 1)`))).toBe('23503'); // khóa ngoại tới payments
    expect(await pgCode(q(t, `INSERT INTO refunds (payment_id, attempt_id, amount, reason, gateway_request_id, auto_attempt_no) VALUES ('${pay.id}', '00000000-0000-4000-8000-000000000000', 350000, 'late_payment', '${hex(32)}', 1)`))).toBe('23503'); // khóa ngoại tới payment_attempts
    expect(await pgCode(q(t, `DELETE FROM payment_attempts WHERE id = '${pay.attempts[0].id}'`))).toBe('23503'); // RESTRICT
  });

  it(`${DB} payment_webhook_logs: CHECK RspCode, payload là đối tượng, mã kết quả đúng khuôn`, async () => {
    const ins = (over: Record<string, string> = {}) => {
      const v = { txn_ref: 'NULL', payload: `'{}'`, signature_valid: 'true', rsp_code: `'00'`, result: `'confirmed_success'`, ...over };
      return pgCode(q(t, `INSERT INTO payment_webhook_logs (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`));
    };
    expect(await ins()).toBe('ok');
    for (const c of ['01', '02', '04', '97', '99']) expect(await ins({ rsp_code: `'${c}'` })).toBe('ok');
    expect(await ins({ rsp_code: `'03'` })).toBe('23514');
    expect(await ins({ rsp_code: `'0'` })).toBe('23514');
    expect(await ins({ payload: `'[]'` })).toBe('23514');
    expect(await ins({ payload: `'"x"'` })).toBe('23514');
    expect(await ins({ result: `'Confirmed Success'` })).toBe('23514');
    expect(await ins({ result: `''` })).toBe('23514');
    expect(await ins({ result: `'${'a'.repeat(41)}'` })).toBe('23514');
  });

  it(`${DB} (SB-24): trigger vòng đời chặn chuyển trạng thái ngoài bảng (Payment và Refund) ngay ở CSDL, kể cả khi mã ứng dụng sai; chuyển hợp lệ qua (PAY-TC-20261006-104539228)`, async () => {
    const mk = (status: string) => seedPayment(t, { status: status as 'pending', attemptNo: status === 'pending' ? 0 : 1, attempts: status === 'pending' ? [] : 'auto' });
    const allowed: Record<string, string[]> = { pending: ['processing', 'succeeded', 'expired', 'cancelled'], processing: ['succeeded', 'failed', 'expired', 'cancelled'], failed: ['processing', 'succeeded', 'expired', 'cancelled'], succeeded: ['refunded'], expired: [], cancelled: [], refunded: [] };
    const all = ['pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded'];
    const fromTable: Record<string, Set<string>> = {}; // bảng chuyển trạng thái của mã (nguồn duy nhất) phải đúng bằng bảng mà trigger của CSDL cho phép
    for (const tr of Object.values(TRANSITIONS)) for (const f of tr.from) (fromTable[f] ??= new Set()).add(tr.to);
    expect(Object.fromEntries(Object.entries(fromTable).map(([k, v]) => [k, [...v].sort()]))).toEqual(Object.fromEntries(Object.entries(allowed).filter(([, v]) => v.length).map(([k, v]) => [k, [...v].sort()])));
    for (const from of all) for (const to of all) {
      if (from === to) continue;
      const p = await mk(from);
      const extra = to === 'succeeded' ? `, paid_at = now(), provider_ref = '14099999'` : '';
      const code = await pgCode(q(t, `UPDATE payments SET status = '${to}'${extra} WHERE id = '${p.id}'`));
      expect([from, to, code]).toEqual([from, to, allowed[from].includes(to) ? 'ok' : '23000']);
    }
    // Refund: requested sang succeeded hoặc failed; failed về requested; mọi chuyển khác bị chặn
    const pay = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const rid = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'requested' });
    expect(await pgCode(q(t, `UPDATE refunds SET status = 'succeeded', resolved_at = now() WHERE id = '${rid}'`))).toBe('ok');
    for (const to of ['requested', 'failed']) expect(await pgCode(q(t, `UPDATE refunds SET status = '${to}' WHERE id = '${rid}'`))).toBe('23000'); // succeeded là cuối
    const pay2 = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const r2 = await seedRefund(t, { paymentId: pay2.id, attemptId: pay2.attempts[0].id, status: 'failed' });
    expect(await pgCode(q(t, `UPDATE refunds SET status = 'succeeded' WHERE id = '${r2}'`))).toBe('23000'); // failed không sang succeeded trực tiếp
    expect(await pgCode(q(t, `UPDATE refunds SET status = 'requested', resolved_at = NULL, failure_reason = NULL WHERE id = '${r2}'`))).toBe('ok');
    expect(await pgCode(q(t, `UPDATE refunds SET status = 'failed', failure_reason = 'gateway-declined', resolved_at = now() WHERE id = '${r2}'`))).toBe('ok');
  });
});
