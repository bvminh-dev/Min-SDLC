import { Prisma } from '@prisma/client';
import { AuditService } from '../../src/modules/platform';
import { listRowsSql } from '../../src/modules/shipping/read.service';
import { medianPairMs } from '../support/auth';
import { truncateAll } from '../support/db';
import { call, countOf, createShpApp, q, seedMethod, seedOrderFor, seedShipment, snapshotCounts, who, type ShpApp } from '../support/shp';

// Xem vận đơn của một đơn và danh sách vận đơn (SHP-REQ-20261006-101103927): IDOR, 404 đồng nhất, khối recipient theo role và audit, danh sách không có dữ liệu cá nhân, bậc D.
const ADDR = { phone: '0901234567', line1: '12 Lê Lợi', receiver: 'Nguyễn Văn An', ward: 'Bến Nghé', city: 'TP.HCM' };

describe('SHP xem vận đơn và danh sách', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });
  const detail = (cookie: string | undefined, code: string) => call(t, 'get', `/shipping/orders/${code}/shipment`, { cookie });
  const strip = (b: Record<string, unknown>) => ({ ...b, trace_id: 0 });

  it('SHP-TC-20261006-102133965 (SB-06, SB-08, T1, T10): customer xem vận đơn đang giao của đơn mình: đúng năm khóa, không thấy cod_amount, lý do, ghi chú, người nhận, version, điện thoại hay địa chỉ', async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const m = await seedMethod(t, { name: 'Giao tiêu chuẩn' });
    const v = await seedShipment(t, { status: 'shipped', user: c1.id, tracking: 'GHN12345678', cod: 380000, method: m, address: ADDR });
    await q(t, `INSERT INTO shipment_status_history (shipment_id, event, status, reason_code, note) VALUES ('${v.id}', 'status_changed', 'failed', 'wrong_address', 'Số nhà không tồn tại')`); // dòng lịch sử cũ có lý do thất bại
    const r = await detail(c1.cookie, v.order.code);
    expect(r.status).toBe(200);
    const [row] = await q<{ shipped_at: Date }>(t, `SELECT shipped_at FROM shipments WHERE id = '${v.id}'`);
    expect(r.body).toEqual({ order_code: v.order.code, shipment: { status: 'shipped', tracking_number: 'GHN12345678', method_name: 'Giao tiêu chuẩn', shipped_at: row.shipped_at.toISOString(), delivered_at: null } });
    expect(Object.keys(r.body.shipment).sort()).toEqual(['delivered_at', 'method_name', 'shipped_at', 'status', 'tracking_number']);
    const text = JSON.stringify(r.body);
    for (const s of ['cod_amount', 'reason_code', 'note', 'recipient', 'version', '0901234567', '12 Lê Lợi', 'Nguyễn Văn An', 'wrong_address', 'Số nhà']) expect(text).not.toContain(s);
    expect((await call(t, 'get', `/shipping/orders/${v.order.code.toLowerCase()}/shipment`, { cookie: c1.cookie })).status).toBe(200); // mã đơn không phân biệt hoa thường
  });

  it('SHP-TC-20261006-102133988 (SB-08, SB-19, T9, T12): staff lọc danh sách vận đơn chờ bàn giao (không dữ liệu cá nhân), mở chi tiết thấy người nhận kèm audit shipment.view_recipient mỗi lần, lỗi audit thì đóng kín (500, không recipient)', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const owner = await who(t, 'customer', 'chu@x.vn');
    const m = await seedMethod(t, { name: 'Giao tiêu chuẩn' });
    for (let i = 0; i < 45; i++) await seedShipment(t, { status: i < 12 ? 'pending' : 'delivered', user: owner.id, method: m, createdAt: new Date(t.clock.now().getTime() - (i + 1) * 60_000) });
    const list = await call(t, 'get', '/shipping/shipments?status=pending', { cookie: s1.cookie });
    expect([list.status, list.body.total, list.body.page, list.body.limit, list.body.items.length]).toEqual([200, 12, 1, 20, 12]);
    for (const i of list.body.items) expect(Object.keys(i).sort()).toEqual(['created_at', 'method_name', 'order_code', 'status', 'tracking_number', 'updated_at']);
    expect(JSON.stringify(list.body)).not.toMatch(/recipient|phone|email|0901234567|Lê Lợi|Nguyễn Văn A/);
    const oldest = await call(t, 'get', '/shipping/shipments?sort=oldest&limit=100', { cookie: s1.cookie });
    const times = oldest.body.items.map((i: { created_at: string }) => Date.parse(i.created_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const newest = await call(t, 'get', '/shipping/shipments?limit=100', { cookie: s1.cookie });
    expect(newest.body.items.map((i: { created_at: string }) => Date.parse(i.created_at))).toEqual([...times].reverse());
    expect(await countOf(t, 'audit_logs', `action = 'shipment.view_recipient'`)).toBe(0); // danh sách không có audit xem người nhận
    const v = await seedShipment(t, { status: 'pending', user: owner.id, address: { receiver: 'Nguyễn Văn An', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' }, cod: 380000 });
    const r = await detail(s1.cookie, v.order.code);
    expect(r.status).toBe(200);
    expect(r.body.shipment.recipient).toEqual({ receiver: 'Nguyễn Văn An', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' });
    expect([r.body.shipment.cod_amount, r.body.shipment.version]).toEqual([380000, 1]);
    const audit = () => q<{ actor_id: string; actor_role: string; action: string; target_id: string; before: unknown; after: unknown }>(t, `SELECT actor_id, actor_role, action, target_id, before, after FROM audit_logs WHERE action = 'shipment.view_recipient' ORDER BY created_at, id`);
    expect(await audit()).toHaveLength(1);
    expect((await audit())[0]).toMatchObject({ actor_id: s1.id, actor_role: 'staff', after: { order_code: v.order.code } });
    expect(JSON.stringify(await audit())).not.toMatch(/Nguyễn|0901234567|Lê Lợi|Bến Nghé|TP\.HCM/); // audit không ghi nội dung địa chỉ
    await detail(s1.cookie, v.order.code);
    expect(await audit()).toHaveLength(2);
    // ép lỗi audit: 500 và không có khối recipient (đóng kín, SB-19)
    jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit lỗi'));
    const bad = await detail(s1.cookie, v.order.code);
    expect(bad.status).toBe(500);
    expect(JSON.stringify(bad.body)).not.toMatch(/recipient|Lê Lợi|0901234567/);
    // không cột địa chỉ trong bảng của SHP (một nguồn duy nhất: bản chụp của ORD)
    const cols = await q<{ column_name: string }>(t, `SELECT column_name FROM information_schema.columns WHERE table_name IN ('shipments', 'shipping_methods', 'shipment_status_history')`);
    expect(cols.map((c) => c.column_name).filter((c) => /address|phone|receiver|line1|ward|city|email/i.test(c))).toEqual([]);
  }, 120_000);

  it('SHP-TC-20261006-102134013 (SB-06, T1, T2, T21): đơn của người khác, không tồn tại và mã sai định dạng cùng trả 404 giống hệt (chỉ khác trace_id), thời gian gần nhau; guest 401; tham số lạ 400', async () => {
    const [c1, c2] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'customer', 'c2@x.vn')];
    const o9 = await seedShipment(t, { status: 'shipped', user: c2.id, tracking: 'GHN55555555' });
    const codes = [o9.order.code, '7K3M9Q2XH4ZZ', 'x!'];
    const rs = [];
    for (const c of codes) rs.push(await detail(c1.cookie, c), await call(t, 'get', `/shipping/orders/${c}/shipment/history`, { cookie: c1.cookie }));
    for (const r of rs) {
      expect([r.status, r.headers['content-type']]).toEqual([404, expect.stringMatching(/application\/problem\+json/)]);
      expect(strip(r.body)).toEqual(strip(rs[0].body));
      expect(JSON.stringify(r.body)).not.toMatch(/shipped|GHN55555555|shipments|Prisma/);
    }
    const [mOther, mNone] = await medianPairMs(30, () => detail(c1.cookie, o9.order.code), () => detail(c1.cookie, '7K3M9Q2XH4ZZ'), async () => { t.clock.advance(60_000); });
    expect(Math.abs(mOther - mNone)).toBeLessThan(10); // cùng đường truy vấn (đo xen kẽ)
    const [mBad, mNone2] = await medianPairMs(30, () => detail(c1.cookie, 'x!'), () => detail(c1.cookie, '7K3M9Q2XH4ZZ'), async () => { t.clock.advance(60_000); });
    expect(Math.abs(mBad - mNone2)).toBeLessThan(10);
    expect((await detail(undefined, o9.order.code)).status).toBe(401);
    const extra = await call(t, 'get', `/shipping/orders/${o9.order.code}/shipment?user_id=${c2.id}`, { cookie: c1.cookie });
    expect(extra.status).toBe(400);
    const s1 = await who(t, 'staff', 's1@shop.vn'); // phiên mới: phép đo đã đẩy đồng hồ giả đi hàng giờ
    expect((await detail(s1.cookie, o9.order.code)).status).toBe(200); // staff xem mọi đơn
    expect((await detail(s1.cookie, '7K3M9Q2XH4ZZ')).status).toBe(404);
  }, 120_000);

  it('SHP-TC-20261006-102134039 (SB-11, SB-14, T3, T16, T17): danh sách từ chối tham số sai; customer 403, guest 401; bậc D 30 yêu cầu mỗi phút mỗi người trong PostgreSQL (đúng giữa hai instance); lọc status dùng index với 100000 dòng', async () => {
    const [s1, s2, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'staff', 's2@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    const bads = ['limit=500', 'limit=0', 'page=0', 'page=abc', 'status=lost', 'sort=random', 'email=an@shop.vn', 'phone=0901234567', 'user_id=u1', 'order_code=', 'tracking_number=ab', 'order_code=a%00b', 'limit=100&limit=5', 'page=-1', 'limit=1.5'];
    for (const qs of bads) { const r = await call(t, 'get', `/shipping/shipments?${qs}`, { cookie: s1.cookie }); expect([qs, r.status, r.body.type, 'items' in r.body]).toEqual([qs, 400, 'urn:ecom:error:validation-failed', false]); }
    expect((await call(t, 'get', '/shipping/shipments?limit=100', { cookie: s1.cookie })).status).toBe(200);
    expect([(await call(t, 'get', '/shipping/shipments', { cookie: c1.cookie })).status, (await call(t, 'get', '/shipping/shipments')).status]).toEqual([403, 401]);
    t.clock.set(new Date(Math.floor(t.clock.now().getTime() / 60_000) * 60_000 + 60_000 + 1000)); // đầu cửa sổ kế tiếp
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await call(t, 'get', '/shipping/shipments', { cookie: s1.cookie })).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
    const limited = await call(t, 'get', '/shipping/shipments', { cookie: s1.cookie });
    expect(limited.body.type).toBe('urn:ecom:error:rate-limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await call(t, 'get', '/shipping/shipments', { cookie: s2.cookie })).status).toBe(200);
    const b = await createShpApp();
    try {
      b.clock.set(t.clock.now());
      const r = await call(b, 'get', '/shipping/shipments', { cookie: s1.cookie });
      expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']); // bộ đếm ở PostgreSQL: instance khác cũng đếm
    } finally { await b.close(); }
    // EXPLAIN đúng câu của danh sách trên 100000 dòng: lọc status dùng index (status, created_at, id)
    const owner = await who(t, 'customer', 'chu@x.vn');
    const m = await seedMethod(t, { name: 'Giao hàng' });
    await t.prisma.$transaction(async (tx) => { // dữ liệu mồi 100000 dòng không bị `statement_timeout` của ứng dụng (SB-31): trước đây đỏ chập chờn `57014` khi máy tải cao (review PAY)
    await tx.$executeRaw`SET LOCAL statement_timeout = 0`;
    await tx.$executeRaw`
      INSERT INTO orders (user_id, code, status, payment_status, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, created_at, updated_at)
      SELECT ${owner.id}::uuid, upper(substr(md5(g::text), 1, 12)), 'paid', 'pending', 100000, 0, 0, 100000, '{}'::jsonb, ${m}::uuid, 'cod', now(), now() FROM generate_series(1, 100000) g`;
    await tx.$executeRaw`
      INSERT INTO shipments (order_id, shipping_method_id, status, tracking_number, delivered_at, shipped_at, created_at, updated_at)
      SELECT o.id, ${m}::uuid, CASE WHEN n % 50 = 0 THEN 'pending' ELSE 'delivered' END::shipment_status, CASE WHEN n % 50 = 0 THEN NULL ELSE 'TRK' || lpad(n::text, 8, '0') END,
             CASE WHEN n % 50 = 0 THEN NULL ELSE now() END, CASE WHEN n % 50 = 0 THEN NULL ELSE now() END, now() - make_interval(secs => n), now()
      FROM (SELECT id, row_number() OVER () AS n FROM orders) o`;
    }, { timeout: 180_000, maxWait: 30_000 });
    await t.prisma.$executeRaw(Prisma.raw('ANALYZE shipments'));
    const plan = JSON.stringify(await t.prisma.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) ${listRowsSql(Prisma.sql`WHERE s.status = ${'pending'}::shipment_status`, 'DESC', 20, 0)}`));
    expect(plan).toContain('shipments_status_created_at_id_idx');
    expect(plan).not.toMatch(/"Node Type":"Seq Scan","[^}]*"Relation Name":"shipments"/);
    const all = JSON.stringify(await t.prisma.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) ${listRowsSql(Prisma.empty, 'DESC', 20, 0)}`));
    expect(all).toContain('shipments_created_at_id_idx');
  }, 180_000);

  it('SHP-TC-20261006-102134063 (SB-08, T9): vận đơn đã xong ẩn người nhận với staff nhưng admin vẫn thấy (và có audit); đơn chưa có vận đơn trả shipment null; trang cuối rỗng', async () => {
    const [s1, a1, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    const v6 = await seedShipment(t, { status: 'delivered' });
    const rs = await detail(s1.cookie, v6.order.code), ra = await detail(a1.cookie, v6.order.code);
    expect('recipient' in rs.body.shipment).toBe(false);
    expect(JSON.stringify(rs.body)).not.toMatch(/Nguyễn|0901234567|Lê Lợi|Bến Nghé|TP\.HCM/);
    expect(ra.body.shipment.recipient).toEqual({ receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' });
    const audits = await q<{ actor_id: string }>(t, `SELECT actor_id FROM audit_logs WHERE action = 'shipment.view_recipient'`);
    expect(audits.map((a) => a.actor_id)).toEqual([a1.id]);
    const [v7, v8] = [await seedShipment(t, { status: 'returned' }), await seedShipment(t, { status: 'cancelled' })];
    for (const v of [v7, v8]) { const r = await detail(s1.cookie, v.order.code); expect([r.status, 'recipient' in r.body.shipment]).toEqual([200, false]); expect(JSON.stringify(r.body)).not.toContain('Lê Lợi'); }
    expect((await detail(s1.cookie, v8.order.code)).body.shipment).toMatchObject({ status: 'cancelled', tracking_number: null });
    expect(await countOf(t, 'audit_logs', `action = 'shipment.view_recipient'`)).toBe(1);
    const own = await seedOrderFor(t, { user: c1.id, status: 'pending' });
    const none = await detail(c1.cookie, own.code);
    expect([none.status, none.body]).toEqual([200, { order_code: own.code, shipment: null }]);
    const before = await snapshotCounts(t);
    expect((await detail(s1.cookie, own.code)).body.shipment).toBeNull();
    expect(await snapshotCounts(t)).toEqual(before); // đọc không ghi gì (khác audit xem người nhận)
    const owner = await who(t, 'customer', 'chu@x.vn');
    for (let i = 0; i < 20; i++) await seedShipment(t, { status: 'shipped', user: owner.id });
    t.clock.advance(61_000);
    const p1 = await call(t, 'get', '/shipping/shipments?status=shipped&limit=20&page=1', { cookie: s1.cookie }), p2 = await call(t, 'get', '/shipping/shipments?status=shipped&limit=20&page=2', { cookie: s1.cookie });
    expect([p1.body.items.length, p1.body.total, p2.status, p2.body.items]).toEqual([20, 20, 200, []]);
    expect(JSON.stringify([rs.body, p1.body, p2.body])).not.toContain('Lê Lợi'); // địa chỉ mồi không có trong body của staff ở mọi ca
    const exact = await call(t, 'get', `/shipping/shipments?order_code=${v6.order.code.toLowerCase()}`, { cookie: s1.cookie });
    expect([exact.body.total, exact.body.items[0].order_code]).toEqual([1, v6.order.code]); // order_code khớp chính xác, không phân biệt hoa thường
    expect((await call(t, 'get', `/shipping/shipments?order_code=${v6.order.code.slice(0, 6)}`, { cookie: s1.cookie })).body.total).toBe(0);
    // staff thấy khi pending, shipped, failed
    for (const st of ['pending', 'shipped', 'failed'] as const) { const v = await seedShipment(t, { status: st }); expect([st, 'recipient' in (await detail(s1.cookie, v.order.code)).body.shipment]).toEqual([st, true]); }
    t.clock.advance(61_000);
    const byTracking = await call(t, 'get', `/shipping/shipments?tracking_number=${(v6.tracking as string).toLowerCase()}`, { cookie: s1.cookie });
    expect(byTracking.body.items.map((i: { order_code: string }) => i.order_code)).toEqual([v6.order.code]);
    expect((await call(t, 'get', `/shipping/shipments?tracking_number=${(v6.tracking as string).slice(0, 8)}`, { cookie: s1.cookie })).body.total).toBe(0); // khớp chính xác, không phải tiền tố
    // vận đơn còn hiệu lực thắng vận đơn cancelled mới hơn của cùng đơn
    const old = await seedShipment(t, { status: 'shipped', createdAt: new Date(t.clock.now().getTime() - 3 * 3600_000) });
    await seedShipment(t, { status: 'cancelled', order: old.order, createdAt: new Date(t.clock.now().getTime() - 60_000) });
    expect((await detail(s1.cookie, old.order.code)).body.shipment.status).toBe('shipped');
    // staff thấy lý do và ghi chú của dòng failed cả khi vận đơn đã returned
    const ret = await seedShipment(t, { status: 'returned', reason: 'damaged', note: 'Móp méo' });
    expect((await detail(s1.cookie, ret.order.code)).body.shipment).toMatchObject({ status: 'returned', reason_code: 'damaged', note: 'Móp méo' });
    // thứ tự ổn định khi cùng created_at: theo id giảm dần (newest) hoặc tăng dần (oldest)
    const tie = new Date(t.clock.now().getTime() - 5 * 3600_000);
    const tied = [await seedShipment(t, { status: 'pending', createdAt: tie }), await seedShipment(t, { status: 'pending', createdAt: tie }), await seedShipment(t, { status: 'pending', createdAt: tie })];
    const byId = [...tied].sort((a, b) => (a.id < b.id ? 1 : -1)).map((x) => x.order.code);
    t.clock.advance(61_000);
    const newest = await call(t, 'get', '/shipping/shipments?limit=3&sort=newest&status=pending&page=1', { cookie: s1.cookie });
    const tail = async (sort: string) => (await call(t, 'get', `/shipping/shipments?limit=100&sort=${sort}&status=pending`, { cookie: s1.cookie })).body.items.filter((i: { order_code: string }) => byId.includes(i.order_code)).map((i: { order_code: string }) => i.order_code);
    expect(newest.status).toBe(200);
    expect(await tail('newest')).toEqual(byId);
    expect(await tail('oldest')).toEqual([...byId].reverse());
  }, 120_000);
});
