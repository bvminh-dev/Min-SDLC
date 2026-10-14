import { truncateAll } from '../support/db';
import { call, createPayApp, ipn, ipnQuery, MINUTE, people, q, refund, refundRetry, seedPayment, seedRefund, type PayApp } from '../support/pay';

// Staff và admin xem thanh toán và hoàn tiền (PAY-REQ-20261006-103111211): hàng đợi hoàn tiền, lọc COD chờ thu, chi tiết đối soát không có dữ liệu cá nhân, quyền, tham số.
const keysDeep = (v: unknown, acc = new Set<string>()): Set<string> => { if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); keysDeep(x, acc); } return acc; };
describe('PAY staff, admin xem thanh toán và hoàn tiền', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });

  it('PAY-TC-20261006-104540928: hàng đợi hoàn tiền hiện thất bại trước (mới nhất trước trong nhóm), đủ trường; lọc status=failed trả đúng 3 dòng', async () => {
    const base = t.clock.now().getTime();
    const failed: string[] = [], okIds: string[] = [];
    for (let i = 0; i < 13; i++) {
      const isFailed = i % 4 === 0 && failed.length < 3 || i >= 10 && failed.length < 3;
      const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
      const id = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: isFailed ? 'failed' : 'succeeded', createdAt: new Date(base - (100 - i) * MINUTE), autoAttemptNo: isFailed ? 3 : 1 });
      (isFailed ? failed : okIds).push(id);
    }
    const r = await call(t, 'get', '/admin/refunds', { cookie: p.staff.cookie });
    expect([r.status, r.body.total, r.body.items.length]).toEqual([200, 13, 13]);
    expect(r.body.items.slice(0, 3).map((x: { id: string }) => x.id)).toEqual([...failed].reverse()); // failed trước, mới nhất trước trong nhóm
    expect(r.body.items.slice(3).every((x: { status: string }) => x.status === 'succeeded')).toBe(true);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['amount', 'auto_attempt_no', 'created_at', 'failure_reason', 'id', 'order_code', 'payment_id', 'reason', 'resolved_at', 'status']);
    const f = await call(t, 'get', '/admin/refunds?status=failed', { cookie: p.admin.cookie });
    expect([f.body.total, f.body.items.length]).toEqual([3, 3]);
    expect((await call(t, 'get', '/admin/refunds?status=succeeded&limit=5&page=2', { cookie: p.admin.cookie })).body.items).toHaveLength(5);
    expect(okIds.length).toBe(10);
  });

  it('REV-NTF-16 (review NTF, E2E PAY-E2E-20261006-104612463 đỏ chập chờn): chi tiết admin đọc nhất quán khi hoàn tiền chốt GIỮA các lần đọc: không bao giờ trả Payment `succeeded` kèm Refund `succeeded` (màn ngừng thăm dò và kẹt ở "Đã thanh toán")', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto', orderStatus: 'delivered' });
    const rid = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'requested', reason: 'admin_manual', requestedBy: p.admin.id });
    const read = t.reads as unknown as { refundsOf: (id: string) => Promise<unknown> };
    const real = read.refundsOf.bind(t.reads);
    let settled = false;
    jest.spyOn(read, 'refundsOf').mockImplementation(async (id: string) => { if (!settled) { settled = true; await t.refunds.dispatch(rid); } return real(id); }); // cổng trả lời ngay giữa hai lần đọc
    const r = await call(t, 'get', `/admin/payments/${pay.id}`, { cookie: p.admin.cookie });
    expect(r.status).toBe(200);
    expect([r.body.refunds[0].status, r.body.status]).toEqual(['succeeded', 'refunded']);
  });

  it('PAY-TC-20261006-104540963: admin lọc Payment COD chờ thu (method=cod, status=pending): chỉ Payment COD pending, mới nhất trước', async () => {
    const base = t.clock.now().getTime();
    const cods = [];
    for (let i = 0; i < 4; i++) cods.push(await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', createdAt: new Date(base - (10 - i) * MINUTE) }));
    for (let i = 0; i < 2; i++) await seedPayment(t, { user: p.a.id, method: 'cod', status: 'succeeded', orderStatus: 'delivered' });
    for (const s of ['pending', 'processing', 'succeeded', 'failed', 'expired'] as const) await seedPayment(t, { user: p.b.id, status: s, attemptNo: s === 'pending' ? 0 : 1, attempts: s === 'pending' ? [] : 'auto' });
    const r = await call(t, 'get', '/admin/payments?method=cod&status=pending', { cookie: p.admin.cookie });
    expect([r.status, r.body.total]).toEqual([200, 4]);
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual([...cods].reverse().map((x) => x.id));
    expect(r.body.items.every((x: { method: string; status: string }) => x.method === 'cod' && x.status === 'pending')).toBe(true);
    expect((await call(t, 'get', '/admin/payments', { cookie: p.staff.cookie })).body.total).toBe(11);
  });

  it('PAY-TC-20261006-104540996 (T11, SB-08, SB-18): chi tiết cho staff có dữ liệu đối soát (mã giao dịch cổng, mã tham chiếu từng lượt, mã gốc, user_id, nhật ký webhook, Refund kèm lý do mã) nhưng không có thông tin cá nhân của khách, khóa ký hay tham số webhook thô', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 2, attempts: [{ no: 1, status: 'failed', reason: 'declined', code: '51' }, { no: 2, status: 'processing' }] });
    const ok = ipnQuery({ txnRef: pay.attempts[1].txnRef, amount: 350000, txNo: '14012345' });
    await ipn(t, ok); await ipn(t, ok); // nhật ký: 00 rồi 02
    const attemptId = pay.attempts[1].id;
    await seedRefund(t, { paymentId: pay.id, attemptId, status: 'failed', reason: 'order_cancelled', autoAttemptNo: 2 });
    const r = await call(t, 'get', `/admin/payments/${pay.id}`, { cookie: p.staff.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: pay.id, status: 'succeeded', provider_ref: '14012345', user_id: p.a.id, method: 'vnpay' });
    expect(r.body.attempts.map((a: { txn_ref: string; gateway_code: string | null }) => [a.txn_ref, a.gateway_code])).toEqual([[pay.attempts[0].txnRef, '51'], [pay.attempts[1].txnRef, '00']]);
    expect(r.body.webhook_logs.map((l: { rsp_code: string; result: string }) => [l.rsp_code, l.result])).toEqual([['00', 'confirmed_success'], ['02', 'duplicate']]);
    expect(Object.keys(r.body.webhook_logs[0]).sort()).toEqual(['created_at', 'result', 'rsp_code']);
    expect(r.body.refunds).toMatchObject([{ reason: 'order_cancelled', status: 'failed', failure_reason: 'gateway-declined', auto_attempt_no: 2 }]);
    const keys = [...keysDeep(r.body)];
    for (const bad of ['email', 'full_name', 'phone', 'address', 'receiver', 'line1', 'payload', 'vnp_SecureHash', 'secret', 'signature_valid']) expect(keys).not.toContain(bad);
    expect(JSON.stringify(r.body)).not.toMatch(/test-vnpay|@|[0-9a-f]{128}|vnp_/);
    expect(await q(t, `SELECT 1 FROM audit_logs WHERE action LIKE 'payment.%'`)).toEqual([]); // xem là đọc: không ghi audit (K-16)
  });

  it('PAY-TC-20261006-104541031: customer 403 và guest 401 không xem được ba endpoint quản trị', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const out: number[] = [];
    for (const cookie of [p.a.cookie, undefined]) for (const path of ['/admin/payments', `/admin/payments/${pay.id}`, '/admin/refunds']) out.push((await call(t, 'get', path, { cookie })).status);
    expect(out).toEqual([403, 403, 403, 401, 401, 401]);
  });

  it('PAY-TC-20261006-104541064 (SB-08, SB-11): tham số quản trị sai (status lạ, limit 0, email, tên) bị 400; id không tồn tại 404', async () => {
    const out: number[] = [];
    for (const qs of ['status=x', 'limit=0', 'email=a@b.c', 'full_name=An', 'phone=0901234567', 'method=momo', 'user_id=1']) out.push((await call(t, 'get', `/admin/payments?${qs}`, { cookie: p.staff.cookie })).status);
    expect(out).toEqual(Array(7).fill(400));
    expect((await call(t, 'get', '/admin/payments/00000000-0000-4000-8000-000000000000', { cookie: p.staff.cookie })).status).toBe(404);
    expect((await call(t, 'get', '/admin/payments/xyz', { cookie: p.staff.cookie })).status).toBe(404);
    expect((await call(t, 'get', '/admin/refunds?status=x', { cookie: p.staff.cookie })).status).toBe(400);
  });

  it('PAY-TC-20261006-104541095: lọc mã đơn không phân biệt hoa thường nhưng khớp chính xác (không khớp một phần)', async () => {
    await seedPayment(t, { user: p.a.id, status: 'pending', orderCode: '7K3M9Q2XH4TB' });
    await seedPayment(t, { user: p.a.id, status: 'pending', orderCode: '7K3M9Q2XH4TC' });
    await seedPayment(t, { user: p.a.id, status: 'pending', orderCode: '7K3M9Q2XH4TS' }); // mã có chữ S: `ſ` (U+017F) không được đổi hoa thành S để khớp nó
    const one = await call(t, 'get', '/admin/payments?order_code=7k3m9q2xh4tb', { cookie: p.admin.cookie });
    expect(one.body.items.map((x: { order_code: string }) => x.order_code)).toEqual(['7K3M9Q2XH4TB']);
    expect((await call(t, 'get', '/admin/payments?order_code=7K3M9Q2XH4T', { cookie: p.admin.cookie })).body.items).toEqual([]);
    expect((await call(t, 'get', '/admin/payments?order_code=%25', { cookie: p.admin.cookie })).body.items).toEqual([]); // ký tự đại diện không có nghĩa
    expect((await call(t, 'get', `/admin/payments?order_code=${encodeURIComponent('7K3M9Q2XH4TBſ')}`, { cookie: p.admin.cookie })).body.items).toEqual([]); // ſ (U+017F) không đổi thành S khớp nhầm đơn khác (L90)
    expect((await call(t, 'get', `/admin/payments?order_code=${encodeURIComponent('7K3M9Q2XH4Tſ')}`, { cookie: p.admin.cookie })).body.items).toEqual([]); // ſ thay đúng chữ S của một mã có thật
    expect((await call(t, 'get', '/admin/payments?order_code=7k3m9q2xh4ts', { cookie: p.admin.cookie })).body.items.map((x: { order_code: string }) => x.order_code)).toEqual(['7K3M9Q2XH4TS']);
  });

  it('PAY-TC-20261006-104541127: staff chỉ xem: thử lại hoàn tiền và hoàn tiền thủ công trả 403, không Refund mới; hàng đợi vẫn hiện Refund failed cho staff', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const rid = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'failed', autoAttemptNo: 3 });
    const [a, b] = [await refundRetry(t, p.staff.cookie, rid), await refund(t, p.staff.cookie, pay.id, 'Khách trả hàng lỗi')];
    expect([a.status, b.status]).toEqual([403, 403]);
    expect((await q<{ n: number }>(t, 'SELECT count(*)::int AS n FROM refunds'))[0].n).toBe(1);
    const queue = await call(t, 'get', '/admin/refunds', { cookie: p.staff.cookie });
    expect(queue.body.items[0]).toMatchObject({ id: rid, status: 'failed', order_code: pay.order.code });
    expect((await call(t, 'get', `/admin/payments/${pay.id}`, { cookie: p.staff.cookie })).body.refunds[0]).toMatchObject({ id: rid, status: 'failed' });
  });

  it('PAY-TC-20261006-104541159: danh sách trống với bộ lọc không khớp (200, items rỗng, total 0, page 1, limit 20)', async () => {
    await seedPayment(t, { user: p.a.id, status: 'pending' });
    const r = await call(t, 'get', '/admin/payments?status=cancelled', { cookie: p.admin.cookie });
    expect([r.status, r.body]).toEqual([200, { items: [], page: 1, limit: 20, total: 0 }]);
    expect((await call(t, 'get', '/admin/refunds', { cookie: p.admin.cookie })).body).toEqual({ items: [], page: 1, limit: 20, total: 0 });
  });
});
