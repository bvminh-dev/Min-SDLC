import { truncateAll } from '../support/db';
import { medianPairMs } from '../support/auth';
import { call, createPayApp, MINUTE, people, seedPayment, seedRefund, sqlOf, type PayApp } from '../support/pay';

// Customer xem thanh toán của mình (PAY-REQ-20261006-103111122): danh sách phân trang, chi tiết không lộ dữ liệu cổng, IDOR, tham số sai, biên.
const keysDeep = (v: unknown, acc = new Set<string>()): Set<string> => { if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); keysDeep(x, acc); } return acc; };
const ROW = ['amount', 'attempt_no', 'created_at', 'id', 'max_attempts', 'method', 'order_code', 'status'];
describe('PAY customer xem thanh toán', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });

  it('PAY-TC-20261006-104540695: danh sách của khách phân trang mới nhất trước (20 dòng, total 25, page 1; trang 2 còn 5), không lẫn Payment của khách khác, đủ trường', async () => {
    const base = t.clock.now().getTime();
    const mine = [];
    for (let i = 0; i < 25; i++) mine.push(await seedPayment(t, { user: p.a.id, status: 'pending', createdAt: new Date(base - (60 - i) * 60_000), orderStatus: 'pending' }));
    for (let i = 0; i < 3; i++) await seedPayment(t, { user: p.b.id, status: 'pending' });
    const r1 = await call(t, 'get', '/payments', { cookie: p.a.cookie });
    expect([r1.status, r1.body.total, r1.body.page, r1.body.limit, r1.body.items.length]).toEqual([200, 25, 1, 20, 20]);
    expect(r1.body.items[0].id).toBe(mine[24].id); // mới nhất trước
    expect(r1.body.items[19].id).toBe(mine[5].id);
    expect(Object.keys(r1.body.items[0]).sort()).toEqual(ROW);
    expect(r1.body.items[0]).toMatchObject({ method: 'vnpay', amount: 350000, status: 'pending', attempt_no: 0, max_attempts: 3, order_code: mine[24].order.code });
    const r2 = await call(t, 'get', '/payments?page=2&limit=20', { cookie: p.a.cookie });
    expect(r2.body.items.map((x: { id: string }) => x.id)).toEqual(mine.slice(0, 5).reverse().map((x) => x.id));
    expect(r2.body.items.length).toBe(5);
    const ids = new Set(mine.map((x) => x.id));
    expect([...r1.body.items, ...r2.body.items].every((x: { id: string }) => ids.has(x.id))).toBe(true);
    const f = await call(t, 'get', `/payments?status=pending&order_code=${mine[3].order.code.toLowerCase()}`, { cookie: p.a.cookie });
    expect(f.body.items.map((x: { id: string }) => x.id)).toEqual([mine[3].id]);
  });

  it('PAY-TC-20261006-104540728 (T11, SB-20): chi tiết có lượt thử, hoàn tiền, can_retry và can_initiate, không lộ mã giao dịch cổng, mã gốc, user_id hay mã tham chiếu (danh sách khóa cho phép)', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 2, attempts: [{ no: 1, status: 'failed', reason: 'declined', code: '51' }, { no: 2, status: 'failed', reason: 'cancelled_by_user', code: '24' }] });
    const r = await call(t, 'get', `/payments/${pay.id}`, { cookie: p.a.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: pay.id, status: 'failed', can_retry: true, can_initiate: false, attempt_no: 2, max_attempts: 3 });
    expect(r.body.attempts.map((a: { attempt_no: number; status: string; reason: string }) => [a.attempt_no, a.status, a.reason])).toEqual([[1, 'failed', 'declined'], [2, 'failed', 'cancelled_by_user']]);
    expect(Object.keys(r.body.attempts[0]).sort()).toEqual(['attempt_no', 'created_at', 'reason', 'status']);
    expect([...keysDeep(r.body)].sort()).toEqual([...ROW, 'attempts', 'can_initiate', 'can_retry', 'expires_at', 'reason', 'refunds'].sort()); // danh sách khóa cho phép
    for (const bad of ['provider_ref', 'txn_ref', 'gateway_code', 'user_id', 'provider_txn_no', 'gateway_request_id', 'webhook_logs']) expect(JSON.stringify(r.body)).not.toContain(bad);
    expect(JSON.stringify(r.body)).not.toMatch(/"51"|"24"|vnp_/);
    // lượt 3: không còn thử lại; đơn đã đóng hay hết hạn cũng không
    const three = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 3, attempts: 'auto' });
    const closed = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', orderStatus: 'cancelled' });
    const late = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: 'auto', expiresAt: new Date(t.clock.now().getTime() - 1000) });
    const pending = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const gone = await seedPayment(t, { user: p.a.id, status: 'pending', expiresAt: new Date(t.clock.now().getTime() - 1000) });
    const flags = async (id: string) => { const x = (await call(t, 'get', `/payments/${id}`, { cookie: p.a.cookie })).body; return [x.can_retry, x.can_initiate]; };
    expect([await flags(three.id), await flags(closed.id), await flags(late.id), await flags(pending.id), await flags(gone.id)]).toEqual([[false, false], [false, false], [false, false], [false, true], [false, false]]);
  });

  it('PAY-TC-20261006-104540761: guest 401, staff và admin 403 ở cả danh sách và chi tiết của customer', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'pending' });
    const out: number[] = [];
    for (const cookie of [undefined, p.staff.cookie, p.admin.cookie]) for (const path of ['/payments', `/payments/${pay.id}`]) out.push((await call(t, 'get', path, { cookie })).status);
    expect(out).toEqual([401, 401, 403, 403, 403, 403]);
  });

  it('PAY-TC-20261006-104540794 (T6, SB-06): Payment của người khác trả cùng 404 với Payment không tồn tại (cùng nội dung, cùng câu SQL, trung vị thời gian lệch dưới 30%); lọc theo mã đơn của người khác trả 200 rỗng, không 403', async () => {
    const other = await seedPayment(t, { user: p.b.id, status: 'pending' });
    const ghost = '00000000-0000-4000-8000-000000000000';
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    const sqls: string[][] = [];
    for (const id of [other.id, ghost]) { spy.mockClear(); const r = await call(t, 'get', `/payments/${id}`, { cookie: p.a.cookie }); expect(r.status).toBe(404); sqls.push(sqlOf(spy.mock.calls as unknown[][])); }
    expect(sqls[0]).toEqual(sqls[1]);
    jest.restoreAllMocks();
    const [a, b] = [await call(t, 'get', `/payments/${other.id}`, { cookie: p.a.cookie }), await call(t, 'get', `/payments/${ghost}`, { cookie: p.a.cookie })];
    expect([a.body.type, a.body.title, a.body.detail, a.body.status]).toEqual([b.body.type, b.body.title, b.body.detail, b.body.status]);
    const [ma, mb] = await medianPairMs(30, () => call(t, 'get', `/payments/${other.id}`, { cookie: p.a.cookie }), () => call(t, 'get', `/payments/${ghost}`, { cookie: p.a.cookie }), () => { t.clock.advance(61_000); return Promise.resolve(); });
    expect(Math.abs(ma - mb) <= Math.max(0.3 * Math.min(ma, mb), 3)).toBe(true);
    const list = await call(t, 'get', `/payments?order_code=${other.order.code}`, { cookie: p.a.cookie });
    expect([list.status, list.body.items, list.body.total]).toEqual([200, [], 0]);
    expect((await call(t, 'get', `/payments?user_id=${p.b.id}`, { cookie: p.a.cookie })).status).toBe(400); // không có tham số chọn chủ sở hữu
  });

  it('PAY-TC-20261006-104540827 (SB-11): tham số danh sách sai (limit 101, limit 0, status lạ, page 0, tham số lạ) bị 400 ở biên và không câu SQL nào chạm bảng payments', async () => {
    await seedPayment(t, { user: p.a.id, status: 'pending' });
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    for (const qs of ['limit=101', 'limit=0', 'status=abc', 'page=0', 'foo=1', 'page=1.5', 'limit=-1', 'order_code=', `order_code=${'A'.repeat(33)}`, 'status=pending&status=failed']) {
      spy.mockClear();
      const r = await call(t, 'get', `/payments?${qs}`, { cookie: p.a.cookie });
      expect([qs, r.status, r.body.type]).toEqual([qs, 400, 'urn:ecom:error:validation-failed']);
      expect(sqlOf(spy.mock.calls as unknown[][]).filter((s) => /payments/.test(s))).toEqual([]);
    }
    expect((await call(t, 'get', `/payments?order_code=${'A'.repeat(32)}`, { cookie: p.a.cookie })).status).toBe(200); // đúng cap 32 ký tự: qua
  });

  it('PAY-TC-20261006-104540860: khách chưa có thanh toán nhận 200 rỗng (total 0); trang vượt quá nhận items rỗng nhưng total đúng', async () => {
    const c3 = (await (await import('../support/pay')).who(t, 'customer', 'c3@x.vn'));
    for (let i = 0; i < 25; i++) await seedPayment(t, { user: p.a.id, status: 'pending' });
    const r3 = await call(t, 'get', '/payments', { cookie: c3.cookie });
    expect([r3.status, r3.body.items, r3.body.total]).toEqual([200, [], 0]);
    const r = await call(t, 'get', '/payments?page=3&limit=20', { cookie: p.a.cookie });
    expect([r.status, r.body.items, r.body.total, r.body.page]).toEqual([200, [], 25, 3]);
    expect((await call(t, 'get', '/payments?page=9007199254740991&limit=100', { cookie: p.a.cookie })).status).toBe(200); // trang cực lớn: không tràn
  }, 60_000);

  it('PAY-TC-20261006-104540893: Payment COD hiển thị pending không lượt thử, không hạn, không cờ; Payment đã hoàn có hai Refund theo thứ tự thời gian (failed rồi succeeded) chỉ với số tiền, trạng thái, thời điểm', async () => {
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending' });
    const c = (await call(t, 'get', `/payments/${cod.id}`, { cookie: p.a.cookie })).body;
    expect(c).toMatchObject({ method: 'cod', status: 'pending', attempts: [], refunds: [], can_retry: false, can_initiate: false, expires_at: null, amount: 180000 });
    const base = t.clock.now().getTime();
    const pay = await seedPayment(t, { user: p.a.id, status: 'refunded', attemptNo: 2, attempts: [{ no: 1, status: 'succeeded', txNo: '14012345' }, { no: 2, status: 'succeeded', txNo: '14012399' }], providerRef: '14012345' });
    await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[1].id, reason: 'duplicate_payment', status: 'failed', createdAt: new Date(base - 5 * MINUTE), failureReason: 'gateway-declined' });
    await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, reason: 'order_cancelled', status: 'succeeded', createdAt: new Date(base - 3 * MINUTE) });
    const r = (await call(t, 'get', `/payments/${pay.id}`, { cookie: p.a.cookie })).body;
    expect(r.refunds.map((x: { status: string }) => x.status)).toEqual(['failed', 'succeeded']);
    for (const x of r.refunds) { expect(Object.keys(x).sort()).toEqual(['amount', 'created_at', 'status']); expect(x.amount).toBe(350000); }
    expect(JSON.stringify(r)).not.toMatch(/failure_reason|gateway|reason":"duplicate|order_cancelled/);
  });
});
