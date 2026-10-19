import { routeIds } from '../../src/modules/platform';
import { ALL_PATHS, createDshApp, DASH, get, hang, MIN, NOW, paid, people, RANGE_Q, REPORT, reset, seedStock, sleep, withTimeout, type DshApp, type People, order } from '../support/dsh';
import { q, seedSession } from '../support/auth';

// DSH-REQ-20261006-105126549: quy tắc chung (quyền, từng khối độc lập, bộ nhớ đệm 60 giây, hạn nguồn 5 giây, giới hạn tần suất bậc D, audit gộp, chỉ đọc). Ứng dụng THẬT, PostgreSQL thật.
const SEC = 'DSH-SEC-20261006-105535103';
describe('DSH quy tắc chung (DSH-REQ-20261006-105126549)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const sixBlocks = [DASH.revenue, DASH.orders, DASH.customers, DASH.products, DASH.lowStock, DASH.recent];
  const open = (cookie = p.admin.cookie) => Promise.all(sixBlocks.map((b) => get(t, cookie, b)));
  const views = () => q<{ actor_id: string; actor_role: string; action: string; target_type: string; target_id: string; before: unknown; after: { block: string; from: string | null; to: string | null }; created_at: Date }>(t, `SELECT actor_id, actor_role, action, target_type, target_id, before, after, created_at FROM audit_logs WHERE action = 'dashboard.view' ORDER BY created_at, id`);
  const spies = () => ({ pay: jest.spyOn(t.pay, 'getRevenue'), failed: jest.spyOn(t.pay, 'countFailedRefunds'), ord: jest.spyOn(t.ord, 'countByStatus'), recent: jest.spyOn(t.ord, 'listRecent'), prd: jest.spyOn(t.catalog, 'countByStatus'), inv: jest.spyOn(t.inv, 'getLowStockSummary'), usr: jest.spyOn(t.usr, 'countCustomers') });
  const calls = (s: ReturnType<typeof spies>) => Object.values(s).reduce((n, x) => n + x.mock.calls.length, 0);

  it('DSH-TC-20261006-110332125: mở dashboard, sáu khối cùng trả as_of và chỉ ghi một dòng audit dashboard.view, không chứa số liệu', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 123_457 });
    await order(t, { status: 'paid', createdAt: new Date('2026-10-05T03:00:00Z') });
    const rs = await open();
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const r of rs) expect(r.body.as_of).toBe('2026-10-06T03:00:00Z');
    const rows = await views();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: p.admin.id, actor_role: 'admin', action: 'dashboard.view', target_type: 'dashboard' });
    expect(sixBlocks.map((b) => b.split('/').pop())).toContain(rows[0].after.block);
    expect(rows[0].target_id).toBe(rows[0].after.block);
    expect(JSON.stringify(rows[0])).not.toMatch(/gross|net|total|123457|refunded|payment_count/);
    expect(Object.keys(rows[0].after).sort()).toEqual(['block', 'from', 'to']);
  });

  it('DSH-TC-20261006-110332155: tải lại sau 45 giây nhận đúng nội dung đệm và as_of cũ, không gọi lại nguồn, không ghi thêm audit', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 350_000 });
    const s = spies();
    const first = await get(t, p.admin.cookie, `${DASH.revenue}${RANGE_Q}`);
    t.clock.advance(45_000);
    const again = await get(t, p.admin.cookie, `${DASH.revenue}${RANGE_Q}`);
    expect(again.body).toEqual(first.body);
    expect(again.body.as_of).toBe('2026-10-06T03:00:00Z');
    expect([s.pay.mock.calls.length, s.failed.mock.calls.length]).toEqual([1, 1]);
    expect(await views()).toHaveLength(1);
  });

  it('DSH-TC-20261006-110332185: staff và customer nhận 403 ở cả mười một endpoint, phiên hết hạn 401, năm nguồn được gọi 0 lần; mười một tuyến khớp bảng tuyến của ứng dụng', async () => {
    const routes = routeIds(t.app).filter((r) => /\/api\/v1\/admin\/(dashboard|reports)\//.test(r)).sort();
    expect(routes).toEqual(ALL_PATHS.map((x) => `GET /api/v1${x}`).sort()); // không sót tuyến mới và không có tuyến nào khác method GET
    const s = spies();
    const old = await seedSession(t, p.admin.id, { createdAt: new Date(NOW.getTime() - 45 * MIN) });
    for (const path of ALL_PATHS) {
      for (const w of [p.staff, p.customer]) { const r = await get(t, w.cookie, path); expect([path, r.status, r.body.type]).toEqual([path, 403, 'urn:ecom:error:forbidden']); expect(r.text).not.toMatch(/gross|total|items|buckets/); }
      expect([path, (await get(t, old.cookie, path)).status]).toEqual([path, 401]);
      expect([path, (await get(t, undefined, path)).status]).toEqual([path, 401]);
    }
    expect([calls(s), (await views()).length]).toEqual([0, 0]);
    // chỉ đọc: các phương thức khác không có tuyến (404), không đổi dữ liệu
    for (const m of ['post', 'put', 'patch', 'delete'] as const) { const r = await (await import('../support/usr')).call(t, m, DASH.revenue, { cookie: p.admin.cookie }); expect([m, r.status === 404 || r.status === 405]).toEqual([m, true]); }
  });

  it('DSH-TC-20261006-110332216: PAY sập thì khối doanh thu 503 nguồn PAY, năm khối còn lại vẫn 200 với số liệu', async () => {
    withTimeout(t, 300);
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 350_000 });
    await order(t, { status: 'paid', createdAt: new Date('2026-10-05T03:00:00Z') });
    await seedStock(t as never, { on_hand: 3, reserved: 0 });
    jest.spyOn(t.pay, 'getRevenue').mockImplementation(() => hang());
    const rs = await open();
    expect(rs.map((r) => r.status)).toEqual([503, 200, 200, 200, 200, 200]);
    expect([rs[0].body.source, rs[0].text.includes('gross'), rs[0].text.includes('net')]).toEqual(['PAY', false, false]);
    expect(rs[1].body.total).toBe(2); // đơn của Payment mồi và đơn vừa tạo
    expect(rs[3].body.total).toBe(1);
    expect(rs[4].body.count).toBe(1);
    expect(rs[5].body.items).toHaveLength(2);
    expect((await views()).length).toBe(1); // các khối 200 ghi một dòng, khối 503 không ghi riêng
  });

  it('DSH-TC-20261006-110332248: yêu cầu thứ 31 trong một phút nhận 429 kèm Retry-After, không gọi nguồn; phút sau gọi lại được', async () => {
    const s = spies();
    for (let i = 0; i < 30; i++) { t.clock.advance(i === 0 ? 0 : 1300); expect((await get(t, p.admin.cookie, DASH.products)).status).toBe(200); } // 10:00:00 tới 10:00:38
    const before = calls(s);
    t.clock.set(new Date('2026-10-06T03:00:41Z'));
    const r = await get(t, p.admin.cookie, DASH.products);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:rate-limited', status: 429, trace_id: expect.any(String) });
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(r.headers['retry-after']).toBe('19');
    expect(calls(s)).toBe(before);
    t.clock.set(new Date('2026-10-06T03:01:01Z'));
    expect((await get(t, p.admin.cookie, DASH.products)).status).toBe(200);
  });

  it('DSH-TC-20261006-110332279: nội dung đệm của admin không bao giờ trả cho staff (kiểm quyền trước bộ nhớ đệm)', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 470_000 });
    const s = spies();
    expect((await get(t, p.admin.cookie, `${DASH.revenue}${RANGE_Q}`)).body.net).toBe(470000);
    t.clock.advance(10_000);
    const r = await get(t, p.staff.cookie, `${DASH.revenue}${RANGE_Q}`);
    expect(r.status).toBe(403);
    expect(r.text).not.toContain('470000');
    expect(s.pay).toHaveBeenCalledTimes(1);
    expect(t.cache.size()).toBe(1);
  });

  it('DSH-TC-20261006-110332310: ranh giới 60 giây của bộ nhớ đệm, 59 giây lấy đệm và 61 giây đọc lại nguồn với as_of mới', async () => {
    const s = spies();
    await get(t, p.admin.cookie, DASH.lowStock);
    t.clock.advance(59_000);
    const mid = await get(t, p.admin.cookie, DASH.lowStock);
    expect([s.inv.mock.calls.length, mid.body.as_of]).toEqual([1, '2026-10-06T03:00:00Z']);
    t.clock.advance(2_000);
    const late = await get(t, p.admin.cookie, DASH.lowStock);
    expect([s.inv.mock.calls.length, late.body.as_of]).toEqual([2, '2026-10-06T03:01:01Z']);
  });

  it('DSH-TC-20261006-110332347: khóa đệm gồm tham số, hai khoảng ngày khác nhau không trả nhầm số', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 470_000 });
    await paid(t, new Date('2026-09-10T03:00:00Z'), { amount: 120_000 });
    const s = spies();
    const a = await get(t, p.admin.cookie, `${DASH.revenue}?from=2026-10-01&to=2026-10-06`);
    t.clock.advance(5_000);
    const b = await get(t, p.admin.cookie, `${DASH.revenue}?from=2026-09-01&to=2026-09-30`);
    expect([a.body.net, b.body.net, s.pay.mock.calls.length]).toEqual([470000, 120000, 2]);
    const asc = await get(t, p.admin.cookie, `${REPORT.products}?sort=units`);
    const desc = await get(t, p.admin.cookie, `${REPORT.products}?sort=amount`);
    expect([asc.body.sort, desc.body.sort]).toEqual(['units', 'amount']);
    expect((await get(t, p.admin.cookie, `${REPORT.products}?limit=5`)).body.limit).toBe(5);
    expect((await get(t, p.admin.cookie, `${REPORT.products}?limit=6`)).body.limit).toBe(6);
    // cùng from khác to, cùng to khác from, và hai khối khác nhau cùng khoảng không dùng chung một mục đệm
    const fromA = await get(t, p.admin.cookie, `${DASH.revenue}?from=2026-10-01&to=2026-10-05`);
    const toB = await get(t, p.admin.cookie, `${DASH.revenue}?from=2026-10-01&to=2026-10-06`);
    const fromC = await get(t, p.admin.cookie, `${DASH.revenue}?from=2026-10-02&to=2026-10-06`);
    expect([fromA.body.to, toB.body.to, toB.body.from, fromC.body.from]).toEqual(['2026-10-05', '2026-10-06', '2026-10-01', '2026-10-02']);
    const ordersSame = await get(t, p.admin.cookie, `${DASH.orders}?from=2026-10-01&to=2026-10-06`);
    expect([ordersSame.body.total, ordersSame.body.gross]).toEqual([expect.any(Number), undefined]);
  });

  it('DSH-TC-20261006-110332377: ghi audit lỗi không chặn việc xem, chỉ ghi log error audit-write-failed kèm trace_id, không có số liệu', async () => {
    await paid(t, new Date('2026-10-05T03:00:00Z'), { amount: 470_000 });
    await q(t, `CREATE OR REPLACE FUNCTION tmp_fail_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'dashboard.view' THEN RAISE EXCEPTION 'tmp failure injected'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await q(t, `CREATE TRIGGER tmp_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION tmp_fail_audit()`);
    try {
      const r = await get(t, p.admin.cookie, `${DASH.revenue}${RANGE_Q}`);
      expect([r.status, r.body.net]).toEqual([200, 470000]);
    } finally { await q(t, `DROP TRIGGER IF EXISTS tmp_fail_audit ON audit_logs`); await q(t, `DROP FUNCTION IF EXISTS tmp_fail_audit()`); }
    const logs = t.logs.records.filter((l) => l.msg === 'audit-write-failed');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'error', trace_id: expect.any(String) });
    expect(logs[0].trace_id).not.toBe('none');
    expect(JSON.stringify(logs[0])).not.toMatch(/470000|"net"|gross/);
  });

  it('DSH-TC-20261006-120001002: audit gộp mỗi admin một dòng mỗi phút, phút sau ghi dòng mới, yêu cầu 403 và 429 không ghi', async () => {
    t.clock.set(new Date('2026-10-06T03:00:05Z'));
    await open();
    t.clock.set(new Date('2026-10-06T03:00:40Z'));
    await open();
    t.clock.set(new Date('2026-10-06T03:01:10Z'));
    await open();
    const rows = await views();
    expect(rows.map((r) => r.created_at.toISOString())).toEqual(['2026-10-06T03:00:05.000Z', '2026-10-06T03:01:10.000Z']);
    expect(rows.every((r) => r.actor_id === p.admin.id)).toBe(true);
    t.clock.set(new Date('2026-10-06T03:01:20Z'));
    expect((await get(t, p.staff.cookie, DASH.revenue)).status).toBe(403);
    const orig = t.config.get.bind(t.config) as (n: string) => unknown;
    jest.spyOn(t.config, 'get').mockImplementation(((n: string) => (n === 'DASHBOARD_RATE_LIMIT_PER_MINUTE' ? 6 : orig(n))) as never); // cửa sổ 10:01 đã dùng 6 lượt ở lần mở lúc 10:01:10
    t.clock.set(new Date('2026-10-06T03:01:30Z'));
    expect((await get(t, p.admin.cookie, DASH.products)).status).toBe(429);
    expect(await views()).toHaveLength(2);
    // admin khác có dòng riêng trong cùng phút
    t.clock.set(new Date('2026-10-06T03:02:05Z'));
    await get(t, p.admin2.cookie, DASH.products);
    await get(t, p.admin.cookie, DASH.products);
    expect((await views()).map((r) => r.actor_id).slice(2).sort()).toEqual([p.admin.id, p.admin2.id].sort());
  });

  it('DSH-TC-20261006-120001005: hạn mức 30 yêu cầu mỗi phút dùng chung giữa hai instance (kho đếm PostgreSQL), không nhân đôi', async () => {
    const b = await createDshApp(); // instance thứ hai: cùng PostgreSQL, bộ nhớ đệm và dấu audit riêng
    try {
      const spyB = jest.spyOn(b.ord, 'listRecent');
      for (let i = 0; i < 20; i++) expect((await get(t, p.admin.cookie, DASH.products)).status).toBe(200);
      for (let i = 0; i < 10; i++) expect((await get(b, p.admin.cookie, DASH.recent)).status).toBe(200);
      const a31 = await get(t, p.admin.cookie, DASH.products);
      const b31 = await get(b, p.admin.cookie, DASH.recent);
      for (const r of [a31, b31]) { expect(r.status).toBe(429); expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1); expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60); }
      expect(spyB).toHaveBeenCalledTimes(1);
      const [{ count }] = await q<{ count: number }>(t, `SELECT count FROM rate_limit_counters WHERE bucket = 'ctr:dsh:${p.admin.id}'`);
      expect(count).toBe(32); // 30 lượt được qua cộng hai lượt bị từ chối: `take` vẫn đếm lượt vượt (cửa sổ cố định tự về 0)
    } finally { await b.close(); }
  });

  // --- ngoài TC: các lỗi hay gặp của họ đếm, đệm và nguồn chậm (bài học L71, L87, L104, L117)
  it(`${SEC} T4: 60 yêu cầu song song của một admin chỉ qua đúng 30 (take nguyên tử, không khe giữa kiểm và ghi); admin khác không bị ảnh hưởng`, async () => {
    const rs = await Promise.all(Array.from({ length: 60 }, () => get(t, p.admin.cookie, DASH.products)));
    expect([rs.filter((r) => r.status === 200).length, rs.filter((r) => r.status === 429).length]).toEqual([30, 30]);
    expect((await get(t, p.admin2.cookie, DASH.products)).status).toBe(200);
  });

  it(`${SEC} T4: nhiều yêu cầu cùng khóa lúc đệm trống dùng chung một lần đọc nguồn (chống dồn đàn), lần đọc lỗi không để lại gì`, async () => {
    const s = spies();
    s.recent.mockImplementation(async () => { await sleep(100); return []; });
    const rs = await Promise.all(Array.from({ length: 20 }, () => get(t, p.admin.cookie, DASH.recent)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(s.recent).toHaveBeenCalledTimes(1);
    t.cache.clear();
    s.recent.mockImplementation(async () => { await sleep(50); throw new Error('boom'); });
    const bad = await Promise.all(Array.from({ length: 5 }, () => get(t, p.admin.cookie, DASH.recent)));
    expect(bad.every((r) => r.status === 503)).toBe(true);
    expect(t.cache.size()).toBe(0); // lỗi không để lại mục đệm
  });

  it(`${SEC} T4: nguồn treo không rò: quá hạn thì 503, bộ đếm lời gọi đang chạy chỉ giảm khi truy vấn thật sự xong, đủ trần thì từ chối ngay không gọi thêm; lỗi muộn không thành unhandled rejection`, async () => {
    withTimeout(t, 150);
    const rejections: unknown[] = [];
    const onRej = (e: unknown) => rejections.push(e);
    process.on('unhandledRejection', onRej);
    try {
      let release!: (v: never[]) => void, fail!: (e: Error) => void;
      const spy = jest.spyOn(t.ord, 'listRecent').mockImplementation(() => new Promise((res, rej) => { release = res as never; fail = rej; }));
      const r = await get(t, p.admin.cookie, DASH.recent);
      expect([r.status, r.body.source]).toEqual([503, 'ORD']);
      expect(t.gate.pending().ORD).toBe(1); // truy vấn quá hạn vẫn đang chạy: được đếm
      fail(new Error('muộn')); await sleep(20);
      expect(t.gate.pending().ORD).toBe(0);
      expect(rejections).toEqual([]);
      // lấp đầy trần lời gọi đang chạy bằng các lời gọi treo (khóa khác nhau để không dùng chung một lần đọc)
      const hung: ((v: never[]) => void)[] = [];
      spy.mockImplementation(() => new Promise((res) => { hung.push(res as never); }));
      await Promise.all(Array.from({ length: 6 }, (_, i) => get(t, p.admin.cookie, `${DASH.orders}?from=2026-09-0${i + 1}&to=2026-10-06`)));
      const before = spy.mock.calls.length;
      const countSpy = jest.spyOn(t.ord, 'countByStatus').mockImplementation(() => new Promise(() => {}));
      for (let i = 0; i < 6; i++) await get(t, p.admin.cookie, `${DASH.orders}?from=2026-08-0${i + 1}&to=2026-10-06`);
      expect(t.gate.pending().ORD).toBe(6);
      const rejected = await get(t, p.admin.cookie, `${DASH.orders}?from=2026-07-01&to=2026-10-06`);
      expect([rejected.status, rejected.body.source, countSpy.mock.calls.length]).toEqual([503, 'ORD', 6]); // lời gọi thứ 7 bị từ chối ngay, không tới nguồn
      expect(before).toBe(1);
      release([]);
      hung.forEach((h) => h([]));
    } finally { process.off('unhandledRejection', onRej); }
  });

  it(`${SEC} T4: DB_POOL_MAX = 2, mười một endpoint song song vẫn trả lời (DSH không giữ kết nối rồi xin thêm), không treo tới hạn chờ`, async () => {
    const small = await createDshApp({ env: { DB_POOL_MAX: '2' } });
    try {
      const rs = await Promise.all(ALL_PATHS.map((x) => get(small, p.admin.cookie, x)));
      expect(rs.map((r) => r.status)).toEqual(ALL_PATHS.map(() => 200));
    } finally { await small.close(); }
  });

  it(`${SEC} T7: đúng 60 giây sau lúc đọc là hết hạn (59,999 giây vẫn còn đệm), đọc lại nguồn với as_of mới`, async () => {
    const s = spies();
    await get(t, p.admin.cookie, DASH.lowStock);
    t.clock.advance(59_999);
    expect((await get(t, p.admin.cookie, DASH.lowStock)).body.as_of).toBe('2026-10-06T03:00:00Z');
    t.clock.set(new Date('2026-10-06T03:01:00Z'));
    expect((await get(t, p.admin.cookie, DASH.lowStock)).body.as_of).toBe('2026-10-06T03:01:00Z');
    expect(s.inv).toHaveBeenCalledTimes(2);
  });

  it(`${SEC} T7: bộ nhớ đệm có hạn kích thước (Map có hạn) và hạn sống tính theo biến cấu hình DASHBOARD_CACHE_TTL_SECONDS`, async () => {
    const orig = t.config.get.bind(t.config) as (n: string) => unknown;
    jest.spyOn(t.config, 'get').mockImplementation(((n: string) => (n === 'DASHBOARD_CACHE_TTL_SECONDS' ? 5 : orig(n))) as never);
    const s = spies();
    await get(t, p.admin.cookie, DASH.lowStock);
    t.clock.advance(4_000); await get(t, p.admin.cookie, DASH.lowStock);
    t.clock.advance(2_000); await get(t, p.admin.cookie, DASH.lowStock);
    expect(s.inv).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 520; i++) await t.cache.get(`k${i}`, async () => ({ n: 1 })); // hạn 500 mục (DSH-DB: Map có hạn)
    expect(t.cache.size()).toBeLessThanOrEqual(500);
    expect(t.cache.size()).toBeGreaterThan(400);
  });
});
