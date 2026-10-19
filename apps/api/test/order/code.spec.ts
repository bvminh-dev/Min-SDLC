import { OrderBusinessError } from '../../src/modules/order';
import { OrderJobsService } from '../../src/modules/order/jobs.service';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { baseHo, createHo, ho, resetSources } from '../support/ho';
import { baseInput, call, countRows, createOrdApp, createPending, historyOf, outboxOf, seedOrder, sqlOf, type OrdApp } from '../support/ord';

// Mã đơn HDyymmdd-NNNNN (ORD-REQ-20261015-092748640, ADR-024): bộ đếm nguyên tử theo ngày giờ Việt Nam, so khớp hai dạng mã, kiểm chủ đơn cùng 404 (SB-44), job dọn bộ đếm.
// fixed-clock: ngày của mã tính từ Clock của ứng dụng (FakeClock), mỗi test đặt mốc tường minh (giờ UTC), không trộn với now() của CSDL.
const D15 = '2026-10-15T02:00:00Z'; // 09:00 ngày 15/10/2026 giờ Việt Nam
const cod = (user: string, o = {}) => baseInput(user, { payment_method: 'cod', payment_expires_at: null, ...o });
const counters = (t: OrdApp) => q<{ day: string; last: number }>(t, `SELECT to_char(day, 'YYYY-MM-DD') AS day, last FROM order_code_counters ORDER BY day`);

describe('ORD mã đơn HDyymmdd-NNNNN', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); await resetSources(t); t.logs.clear(); t.clock.set(new Date(D15)); });
  const nothing = async () => expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events'), await countRows(t, 'audit_logs')]).toEqual([0, 0, 0, 0, 0]);

  it('ORD-TC-20261015-092748827: mã mới theo khuôn HDyymmdd-NNNNN, tuần tự trong ngày giờ Việt Nam; tra theo mã chữ thường chuẩn hóa chữ hoa', async () => {
    const { a, s1 } = await ho(t);
    const x = await createPending(t, cod(a.id));
    const y = await createHo(t, baseHo(s1.id, { payment_method: 'cash' }));
    expect([x.code, y.code]).toEqual(['HD261015-00001', 'HD261015-00002']);
    for (const c of [x.code, y.code]) { expect(c).toMatch(/^HD[0-9]{6}-[0-9]{5}$/); expect(c).toHaveLength(14); } // spec ghi 15 ký tự nhưng HD + 6 chữ số + dấu gạch + 5 chữ số là 14 (xem Lệch spec của report)
    expect(await counters(t)).toEqual([{ day: '2026-10-15', last: 2 }]); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    const [o] = await q<{ d: string }>(t, `SELECT to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD') AS d FROM orders WHERE code = '${x.code}'`);
    expect(o.d).toBe('261015'); // created_at cùng mốc và cùng ngày với mã
    const [lower, upper] = [await call(t, 'get', '/orders/hd261015-00001', { cookie: a.cookie }), await call(t, 'get', '/orders/HD261015-00001', { cookie: a.cookie })];
    expect([lower.status, upper.status, lower.body.code, upper.body.code]).toEqual([200, 200, 'HD261015-00001', 'HD261015-00001']);
  });

  it('ORD-TC-20261015-092748863: qua nửa đêm giờ Việt Nam số thứ tự reset (ngày theo giờ Việt Nam, không theo UTC, không theo múi giờ phiên CSDL); giao dịch kéo qua nửa đêm lấy ngày lúc cấp mã', async () => {
    const { a } = await ho(t);
    await q(t, `INSERT INTO order_code_counters (day, last) VALUES ('2026-10-15', 41)`); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    t.clock.set(new Date('2026-10-15T16:59:59Z')); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    const first = await createPending(t, cod(a.id));
    t.clock.set(new Date('2026-10-15T17:00:00Z')); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    const second = await createPending(t, cod(a.id));
    expect([first.code, second.code]).toEqual(['HD261015-00042', 'HD261016-00001']);
    expect(await counters(t)).toEqual([{ day: '2026-10-15', last: 42 }, { day: '2026-10-16', last: 1 }]); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    t.clock.set(new Date('2026-10-15T16:59:59Z')); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    const late = await t.tx.run(async (tx) => { // giao dịch bắt đầu 16:59:59Z, gọi createPending lúc 17:00:05Z, múi giờ phiên CSDL khác
      await tx.$executeRaw`SET LOCAL TIME ZONE 'America/Los_Angeles'`;
      t.clock.set(new Date('2026-10-15T17:00:05Z')); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
      return t.ord.createPending(cod(a.id), tx);
    });
    expect(late.code).toBe('HD261016-00002');
    const [o] = await q<{ created_at: Date }>(t, `SELECT created_at FROM orders WHERE code = '${late.code}'`);
    expect(o.created_at).toEqual(new Date('2026-10-15T17:00:05Z')); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
  });

  it('ORD-TC-20261015-092748901: hai mươi giao dịch tạo đơn song song (ba hoàn tác) cho mười bảy mã khác nhau và dãy 00001 đến 00017; hai trăm giao dịch song song không trùng mã, không bế tắc', async () => {
    const { a, s1 } = await ho(t);
    const one = (i: number, fail: boolean) => t.tx.run(async (tx) => {
      const r = i % 2 ? await t.ord.createHo(baseHo(s1.id), tx) : await t.ord.createPending(cod(a.id), tx);
      if (fail) throw new Error('INV hết hàng ở bước sau');
      return r.code;
    });
    const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => one(i, i < 3)));
    const codes = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect([codes.length, res.filter((r) => r.status === 'rejected').length, new Set(codes).size]).toEqual([17, 3, 17]);
    expect(codes.map((c) => Number(c.slice(-5))).sort((x, y) => x - y)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1)); // bộ đếm hoàn tác cùng giao dịch nên dãy liên tục
    expect([await countRows(t, 'orders'), (await counters(t))[0].last]).toEqual([17, 17]);
    t.clock.set(new Date('2026-11-20T02:00:00Z')); // một ngày khác
    const big = await Promise.allSettled(Array.from({ length: 200 }, (_, i) => one(i, false)));
    expect(big.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(new Set(big.map((r) => (r as PromiseFulfilledResult<string>).value)).size).toBe(200);
  }, 120_000);

  it('ORD-TC-20261015-092748937: chuẩn hóa mã: chữ thường và khoảng trắng ở ô tìm, thiếu dấu gạch nối là sai định dạng, mã cũ 12 ký tự vẫn tra được và không đổi', async () => {
    const { a, staff } = await ho(t);
    const old = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    await q(t, `INSERT INTO order_code_counters (day, last) VALUES ('2026-10-15', 1)`); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    const fresh = await createPending(t, cod(a.id));
    expect(fresh.code).toBe('HD261015-00002');
    const find = async (code: string) => (await call(t, 'get', `/admin/orders?code=${encodeURIComponent(code)}`, { cookie: staff.cookie })).body;
    for (const [c, want] of [['7k3m9q2xh4tb', old.code], [' hd261015-00002 ', fresh.code]]) { const b = await find(c); expect([b.items.length, b.items[0]?.code]).toEqual([1, want]); }
    const noDash = await call(t, 'get', '/admin/orders?code=HD26101500002', { cookie: staff.cookie });
    expect([noDash.status, noDash.body.items, noDash.body.total]).toEqual([200, [], 0]);
    expect([(await call(t, 'get', '/orders/7K3M9Q2XH4TB', { cookie: a.cookie })).status, (await call(t, 'get', '/orders/HD261015-00002', { cookie: a.cookie })).status]).toEqual([200, 200]);
    expect((await q<{ code: string }>(t, `SELECT code FROM orders WHERE id = '${old.id}'`))[0].code).toBe('7K3M9Q2XH4TB');
    for (const bad of ['HD261015-00002%20', 'HD261015-0000;2']) expect((await call(t, 'get', `/orders/${bad}`, { cookie: a.cookie })).body).toMatchObject({ type: 'urn:ecom:error:not-found', status: 404 });
  });

  it('ORD-TC-20261015-092748973: mọi đường đọc theo mã trả cùng 404 cho đơn người khác, đơn không tồn tại và mã sai định dạng (cùng đường truy vấn); đơn của A không đổi', async () => {
    const { a, b, s1 } = await ho(t);
    const mine = await createPending(t, cod(a.id));
    const hoOrder = await createHo(t, baseHo(s1.id)); // đơn hộ không tài khoản: không thuộc customer nào
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    const shape = (r: { status: number; headers: Record<string, string>; body: Record<string, unknown> }) => ({ status: r.status, ct: r.headers['content-type'], body: { ...r.body, trace_id: undefined } });
    const probe = async (path: (c: string) => string, m: 'get' | 'post' = 'get') => {
      const out: { shape: unknown; sql: string[] }[] = [];
      for (const c of [mine.code, 'HD261015-09999', 'HD2610-1', hoOrder.code]) { spy.mockClear(); const r = await call(t, m, path(c), { cookie: b.cookie, ...(m === 'post' ? { body: {} } : {}) }); out.push({ shape: shape(r), sql: sqlOf(spy.mock.calls as unknown[][]) }); }
      return out;
    };
    for (const [path, m] of [[(c: string) => `/orders/${c}`, 'get'], [(c: string) => `/orders/${c}/status-history`, 'get'], [(c: string) => `/orders/${c}/cancel`, 'post']] as const) {
      const out = await probe(path, m);
      expect(out[0].shape).toMatchObject({ status: 404, body: { type: 'urn:ecom:error:not-found', status: 404 } });
      for (const o of out) expect(o.shape).toEqual(out[0].shape); // cùng type, title, status, nội dung
      if (m === 'get') for (const o of out) expect(o.sql).toEqual(out[0].sql); // cùng đường truy vấn: không thoát sớm với mã sai định dạng (SB-44)
    }
    spy.mockRestore();
    const list = await call(t, 'get', `/orders?status=pending`, { cookie: b.cookie });
    expect([list.status, list.body.items]).toEqual([200, []]);
    expect(await t.ord.findOwned(mine.code, b.id)).toBeNull();
    expect(await t.ord.findOwned('HD261015-09999', b.id)).toBeNull();
    expect(await t.ord.findOwned(hoOrder.code, a.id)).toBeNull(); // đơn hộ không user_id không thuộc ai
    expect((await q<{ status: string }>(t, `SELECT status::text FROM orders WHERE id = '${mine.order_id}'`))[0].status).toBe('pending');
    expect((await historyOf(t, mine.order_id)).length).toBe(1);
    expect((await outboxOf(t, mine.order_id)).map((e) => e.type)).toEqual(['OrderCreated']);
    expect(await countRows(t, 'audit_logs', `target_id = '${mine.order_id}'`)).toBe(0); // không hủy, không audit
  });

  it('ORD-TC-20261015-092749043: số thứ 100000 trong ngày bị từ chối bằng order_code_exhausted (không ghi gì), số 99999 vẫn cấp được, ngày mới có bộ đếm mới', async () => {
    const { a } = await ho(t);
    await q(t, `INSERT INTO order_code_counters (day, last) VALUES ('2026-10-15', 99998)`); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    expect((await createPending(t, cod(a.id))).code).toBe('HD261015-99999');
    const before = await countRows(t, 'orders');
    const err = await createPending(t, cod(a.id)).catch((e) => e);
    expect(err).toBeInstanceOf(OrderBusinessError);
    expect((err as OrderBusinessError).code).toBe('order_code_exhausted');
    expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')]).toEqual([before, 2, before, before]);
    expect((await counters(t))[0].last).toBe(99999);
    t.clock.set(new Date('2026-10-16T02:00:00Z')); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    expect((await createPending(t, cod(a.id))).code).toBe('HD261016-00001');
  });

  it('ORD-TC-20261015-092749079: job ord.sweep-code-counters chỉ xóa dòng cũ hơn hai ngày, tối đa 500 dòng mỗi lượt, idempotent, đóng khi không tính được ngày hiện tại', async () => {
    const job = t.app.get(OrderJobsService);
    await nothing();
    for (const d of ['2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-20']) await q(t, `INSERT INTO order_code_counters (day, last) VALUES ('${d}', 3)`);
    expect(await job.sweepCodeCounters()).toEqual({ deleted: 2 });
    expect((await counters(t)).map((c) => c.day)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-20']); // 10-13 bằng hôm nay trừ 2 ngày nên giữ; dòng tương lai giữ // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    expect(await job.sweepCodeCounters()).toEqual({ deleted: 0 });
    await q(t, `INSERT INTO order_code_counters (day, last) SELECT d::date, 1 FROM generate_series('2020-01-01'::date, '2020-01-01'::date + 1199, '1 day') d`);
    expect([(await job.sweepCodeCounters()).deleted, (await job.sweepCodeCounters()).deleted, (await job.sweepCodeCounters()).deleted]).toEqual([500, 500, 200]); // giới hạn lô
    for (const bad of [() => { throw new Error('đồng hồ hỏng'); }, () => new Date('x')]) {
      await q(t, `INSERT INTO order_code_counters (day, last) VALUES ('2019-01-01', 1)`);
      const spy = jest.spyOn(t.clock, 'now').mockImplementation(bad);
      await expect(job.sweepCodeCounters()).rejects.toThrow();
      spy.mockRestore();
      expect(await countRows(t, 'order_code_counters', `day = '2019-01-01'`)).toBe(1); // không xóa gì
      await q(t, `DELETE FROM order_code_counters WHERE day = '2019-01-01'`);
    }
  });
});
