import { OrderApi } from '../../src/modules/order';
import { AuditService, EventsService, OutboxRelay } from '../../src/modules/platform';
import { medianPairMs } from '../support/auth';
import { insertOrder } from '../support/order-fixture';
import { truncateAll } from '../support/db';
import { act, call, countOf, createShpApp, histOf, q, seedShipment, shipVia, shpAudits, shpOutbox, snapshotCounts, who, type ShpApp, type Who } from '../support/shp';

// Danh sách vận đơn của đợt bán hàng hộ (SHP-REQ-20261006-101103927 BR11 đến BR13, SHP-REQ-20261006-101103903; SB-08 (d), SB-44, SB-45): khối khách, ẩn điện thoại và địa chỉ theo trạng thái,
// sale chỉ thấy đơn của mình, một dòng audit mỗi trang, một lần gọi ORD mỗi trang, bậc D. Dùng OrderApi, AuditService thật (ADR-002); chỉ gài lỗi bằng jest.spyOn.
const SEC = 'SHP-SEC-20261006-101603066';
const AN = { receiver: 'Nguyễn Văn An', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' };
const BICH = { receiver: 'Lê Thị Bích', phone: '0912345678', line1: '5 Hai Bà Trưng', ward: 'Bến Nghé', city: 'TP.HCM' };
const KEYS = ['address', 'created_at', 'created_by_name', 'customer_name', 'method_name', 'order_code', 'phone', 'status', 'tracking_number', 'updated_at'];
type Item = { order_code: string; status: string; phone: string | null; address: string | null; customer_name: string; created_by_name: string | null };

describe('SHP danh sách vận đơn: khối khách, sale, audit, ORD', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });
  const list = (u: Who | undefined, qs = '') => call(t, 'get', `/shipping/shipments${qs}`, { cookie: u?.cookie });
  const viewAudits = () => q<{ actor_id: string; actor_role: string; after: Record<string, unknown>; before: unknown; target_id: string }>(t, `SELECT actor_id, actor_role, target_id, before, after FROM audit_logs WHERE action = 'shipment.view_list' ORDER BY created_at, id`);
  /** Hai sale tên khác nhau, một staff, một admin. */
  const people = async () => {
    const [s1, s2, staff, admin] = [await who(t, 'sale', 's1@x.vn'), await who(t, 'sale', 's2@x.vn'), await who(t, 'staff', 'staff@shop.vn'), await who(t, 'admin', 'admin@shop.vn')];
    await q(t, `UPDATE users SET full_name = 'Trần Thu' WHERE id = '${s1.id}'`);
    await q(t, `UPDATE users SET full_name = 'Lê Hoa' WHERE id = '${s2.id}'`);
    return { s1, s2, staff, admin };
  };
  const hoOf = (by: string, name = 'Khách hộ', phone = '0900000000') => ({ createdBy: by, source: 'facebook', customer: { full_name: name, phone } });
  /** Đơn khách tự đặt `confirmed` (COD) dùng phương thức `m`, để thử tạo vận đơn bằng event. */
  const seedOrderForWeb = async (m: string) => {
    const c = await who(t, 'customer', 'web@x.vn');
    const o = await insertOrder(t.prisma, t.clock.now(), { user: c.id, status: 'confirmed', method: 'cod' });
    await q(t, `UPDATE orders SET shipping_method_id = '${m}' WHERE id = '${o.id}'`);
    return o;
  };
  const at = (i: number) => new Date(t.clock.now().getTime() - (i + 1) * 60_000);

  it(`SHP-TC-20261015-092815810 ${SEC} T9, T12: staff thấy tên, điện thoại, địa chỉ ở vận đơn pending, shipped, failed và tên sale tạo đơn; đúng một dòng audit cho cả trang, không chứa dữ liệu khách`, async () => {
    const { s1, staff } = await people();
    const a = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s1.id, 'Nguyễn Văn An', '0901234567'), address: AN, createdAt: at(0) });
    const b = await seedShipment(t, { status: 'shipped', address: { ...BICH, phone: '0933333333', line1: '9 Nguyễn Huệ' }, createdAt: at(1) });
    const c = await seedShipment(t, { status: 'failed', address: { ...BICH, phone: '0944444444', line1: '7 Pasteur', ward: 'Võ Thị Sáu', district: 'Quận 3' }, createdAt: at(2) });
    const r = await list(staff);
    expect([r.status, r.body.total, r.body.items.length]).toEqual([200, 3, 3]);
    for (const i of r.body.items) expect(Object.keys(i).sort()).toEqual(KEYS);
    const [ia, ib, ic] = r.body.items as Item[];
    expect(ia).toMatchObject({ order_code: a.order.code, customer_name: 'Nguyễn Văn An', phone: '0901234567', address: '12 Lê Lợi, Bến Nghé, TP.HCM', created_by_name: 'Trần Thu' }); // line1, ward, city; không có district
    expect(ib).toMatchObject({ order_code: b.order.code, phone: '0933333333', address: '9 Nguyễn Huệ, Bến Nghé, TP.HCM', created_by_name: null });
    expect(ic).toMatchObject({ order_code: c.order.code, phone: '0944444444', address: '7 Pasteur, Võ Thị Sáu, Quận 3, TP.HCM' }); // district nếu có, đúng thứ tự
    expect(JSON.stringify(r.body)).not.toMatch(/recipient|email|user_id|"created_by"|@x\.vn/);
    const audits = await viewAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: staff.id, actor_role: 'staff', before: null, after: { rows: 3, page: 1, limit: 20, sort: 'newest' } });
    expect(audits[0].after.status).toBeUndefined();
    expect(JSON.stringify(audits)).not.toMatch(/Nguyễn Văn An|0901234567|Lê Lợi|Trần Thu|Pasteur|@x\.vn/); // ba giá trị mồi và tên sale không có trong audit
    expect(await countOf(t, 'audit_logs', `action = 'shipment.view_recipient'`)).toBe(0);
  });

  it(`SHP-TC-20261015-092815845 ${SEC} T9: vận đơn delivered, returned, cancelled chỉ hiện tên khách (điện thoại, địa chỉ null) với cả staff lẫn admin; ẩn xong thì chỉ vận đơn pending, shipped còn điện thoại; đổi trạng thái thì theo`, async () => {
    const { staff, admin } = await people();
    const [d, e, f] = [await seedShipment(t, { status: 'delivered', address: BICH, createdAt: at(0) }), await seedShipment(t, { status: 'returned', address: BICH, createdAt: at(1) }), await seedShipment(t, { status: 'cancelled', address: BICH, createdAt: at(2) })];
    const g = await seedShipment(t, { status: 'pending', address: BICH, createdAt: at(3) });
    const rs = await list(staff, '?limit=100'), ra = await list(admin, '?limit=100');
    expect([rs.status, ra.status]).toEqual([200, 200]);
    const only = (b: { items: Item[] }, code: string) => b.items.find((i) => i.order_code === code) as Item;
    for (const b of [rs.body, ra.body]) {
      for (const v of [d, e, f]) expect(only(b, v.order.code)).toMatchObject({ customer_name: 'Lê Thị Bích', phone: null, address: null }); // khóa vẫn có mặt
      expect(only(b, g.order.code)).toMatchObject({ phone: '0912345678', address: '5 Hai Bà Trưng, Bến Nghé, TP.HCM' });
    }
    expect(ra.body.items.map((i: Item) => [i.order_code, i.phone, i.address])).toEqual(rs.body.items.map((i: Item) => [i.order_code, i.phone, i.address])); // admin không có ngoại lệ ở danh sách
    for (const b of [rs.body, ra.body]) expect(JSON.stringify(b).split('0912345678').length - 1).toBe(1); // chỉ phần tử ORD-G
    // ORD-G chuyển pending -> shipped -> delivered
    expect((await shipVia(t, staff.cookie, g.order.code, 'GHN12345678')).status).toBe(200);
    expect(only((await list(staff, '?limit=100')).body, g.order.code)).toMatchObject({ status: 'shipped', phone: '0912345678', address: '5 Hai Bà Trưng, Bến Nghé, TP.HCM' });
    expect((await act(t, staff.cookie, g.order.code, 'deliver')).status).toBe(200);
    expect(only((await list(staff, '?limit=100')).body, g.order.code)).toMatchObject({ status: 'delivered', customer_name: 'Lê Thị Bích', phone: null, address: null });
  });

  it(`SHP-TC-20261015-092815880 ${SEC} T26: sale chỉ thấy vận đơn của đơn do mình tạo, total chỉ đếm đơn của mình, lọc ở truy vấn (trang 3 của limit 2 còn 1 phần tử); vận đơn tạo từ event chép created_by của đơn`, async () => {
    const { s1, s2, staff } = await people();
    const mine: string[] = [];
    for (let i = 0; i < 5; i++) mine.push((await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s1.id, `Khách ${i}`), createdAt: at(i) })).order.code);
    for (let i = 0; i < 3; i++) await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s2.id), createdAt: at(10 + i) });
    for (let i = 0; i < 2; i++) await seedShipment(t, { status: 'pending', createdAt: at(20 + i) }); // đơn khách tự đặt: created_by rỗng
    const r = await list(s1, '?limit=20');
    expect([r.status, r.body.total, r.body.items.length]).toEqual([200, 5, 5]);
    expect(r.body.items.map((i: Item) => i.order_code).sort()).toEqual([...mine].sort());
    expect(r.body.items.every((i: Item) => i.created_by_name === 'Trần Thu')).toBe(true);
    const p3 = await list(s1, '?limit=2&page=3');
    expect([p3.body.items.length, p3.body.total]).toEqual([1, 5]);
    expect((await list(s2)).body.total).toBe(3);
    expect((await list(staff, '?limit=100')).body.total).toBe(10); // staff không bị lọc created_by
    expect((await viewAudits()).filter((a) => a.actor_id === s1.id).map((a) => a.after.rows).sort()).toEqual([1, 5]); // số dòng khớp từng trang (đồng hồ giả hòa created_at nên so không theo thứ tự)
    // lifecycle: vận đơn tạo từ OrderConfirmed chép created_by của đơn hộ (OrderApi.findForShipment), đơn khách tự đặt để NULL
    const m = (await seedShipment(t, { status: 'pending' })).method;
    const o = await insertOrder(t.prisma, t.clock.now(), { user: null, status: 'confirmed', ho: hoOf(s2.id) });
    await q(t, `UPDATE orders SET shipping_method_id = '${m}' WHERE id = '${o.id}'`);
    const web = await seedOrderForWeb(m);
    for (const id of [o.id, web.id]) await t.tx.run((tx) => t.app.get(EventsService).publish(tx, { type: 'OrderConfirmed', aggregate_type: 'order', aggregate_id: id, payload: { order_id: id } }));
    const run = await t.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000));
    expect([run.picked, run.dispatched, run.failed]).toEqual([2, 2, 0]);
    expect(await q(t, `SELECT created_by, order_code FROM shipments WHERE order_id = '${o.id}'`)).toEqual([{ created_by: s2.id, order_code: o.code }]);
    expect(await q(t, `SELECT created_by FROM shipments WHERE order_id = '${web.id}'`)).toEqual([{ created_by: null }]);
  });

  it(`SHP-TC-20261015-092815915 ${SEC} T26, T3: sale không truyền được created_by hay phone (400), không mở được chi tiết, lịch sử và không có thao tác ghi (403, không đổi gì)`, async () => {
    const { s1, s2 } = await people();
    const v1 = await seedShipment(t, { status: 'shipped', ho: hoOf(s1.id) });
    await seedShipment(t, { status: 'shipped', ho: hoOf(s2.id) });
    for (const qs of [`?created_by=${s2.id}`, `?created_by=${s1.id}`, '?phone=0901234567', `?user_id=${s2.id}`]) {
      const r = await list(s1, qs);
      expect([qs, r.status, r.body.type, 'items' in r.body]).toEqual([qs, 400, 'urn:ecom:error:validation-failed', false]);
    }
    expect(await viewAudits()).toEqual([]);
    const before = await snapshotCounts(t);
    const code = v1.order.code;
    const rs = [
      await call(t, 'get', `/shipping/orders/${code}/shipment`, { cookie: s1.cookie }), await call(t, 'get', `/shipping/orders/${code}/shipment/history`, { cookie: s1.cookie }),
      await act(t, s1.cookie, code, 'deliver'), await act(t, s1.cookie, code, 'fail', { reason_code: 'refused' }), await shipVia(t, s1.cookie, code, 'GHN12345678'),
    ];
    expect(rs.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await snapshotCounts(t)).toEqual(before); // vận đơn không đổi, không audit mới, không event
    expect((await q<{ status: string }>(t, `SELECT status::text FROM shipments WHERE id = '${v1.id}'`))[0].status).toBe('shipped');
  });

  it(`SHP-TC-20261015-092815948 ${SEC} T26: sale tìm mã đơn của sale khác ra danh sách rỗng giống hệt mã không tồn tại (không audit, không gọi ORD), thời gian xấp xỉ; tìm được cả mã mới lẫn mã cũ, không phân biệt hoa thường`, async () => {
    const { s1, s2, staff } = await people();
    const h1 = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', orderCode: 'HD261015-00001', ho: hoOf(s1.id), createdAt: at(0) });
    const old = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', orderCode: '7K3M9Q2XH4TB', ho: hoOf(s1.id), createdAt: at(1) });
    const h2 = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', orderCode: 'HD261015-00002', ho: hoOf(s2.id), createdAt: at(2) });
    const display = jest.spyOn(t.app.get(OrderApi), 'getShipmentDisplay');
    const other = await list(s1, '?order_code=HD261015-00002'), none = await list(s1, '?order_code=HD261015-99999');
    expect([other.status, none.status]).toEqual([200, 200]);
    expect(other.body).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(other.body).toEqual(none.body);
    expect(await viewAudits()).toEqual([]);
    expect(display).not.toHaveBeenCalled();
    const lower = await list(s1, '?order_code=hd261015-00001'), oldLower = await list(s1, '?order_code=7k3m9q2xh4tb');
    expect([lower.body.items.map((i: Item) => i.order_code), oldLower.body.items.map((i: Item) => i.order_code)]).toEqual([[h1.order.code], [old.order.code]]);
    expect((await list(staff, `?order_code=${h2.order.code}`)).body.items.map((i: Item) => i.order_code)).toEqual([h2.order.code]); // staff không bị lọc created_by
    // đo xen kẽ, đồng hồ giả tiến một phút mỗi vòng để không chạm bậc D; phiên mới sau phép đo (đồng hồ đã đi hàng giờ)
    const [mOther, mNone] = await medianPairMs(30, () => list(s1, '?order_code=HD261015-00002'), () => list(s1, '?order_code=HD261015-99999'), async () => { t.clock.advance(60_000); });
    expect(Math.abs(mOther - mNone)).toBeLessThanOrEqual(Math.max(10, 0.3 * Math.min(mOther, mNone))); // cùng đường truy vấn (chênh dưới 30%, sàn 10 ms cho nhiễu đo)
  }, 120_000);

  it(`SHP-TC-20261015-092815980 ${SEC} T3: customer 403, guest 401 ở danh sách; không audit, không gọi ORD, không có dữ liệu khách`, async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    await seedShipment(t, { status: 'shipped', user: c1.id, address: AN });
    const display = jest.spyOn(t.app.get(OrderApi), 'getShipmentDisplay');
    const rc = await list(c1), rg = await list(undefined);
    expect([rc.status, rg.status]).toEqual([403, 401]);
    for (const r of [rc, rg]) expect(JSON.stringify(r.body)).not.toMatch(/items|total|Nguyễn Văn An|0901234567|Lê Lợi/);
    expect(await viewAudits()).toEqual([]);
    expect(display).toHaveBeenCalledTimes(0);
  });

  it(`SHP-TC-20261015-092816014 ${SEC} T9, T12, T27: mỗi trang đúng một dòng audit (người, role, số dòng, bộ lọc) không chứa dữ liệu cá nhân; trang rỗng không ghi; limit 100 vẫn một dòng`, async () => {
    const { staff, admin } = await people();
    const owner = await who(t, 'customer', 'chu@x.vn');
    for (let i = 0; i < 45; i++) await seedShipment(t, { status: 'pending', user: owner.id, address: AN, createdAt: at(i) });
    const pages = [await list(staff, '?limit=20&page=1'), await list(staff, '?limit=20&page=2'), await list(staff, '?limit=20&page=3'), await list(staff, '?limit=20&page=4')];
    expect(pages.map((p) => [p.status, p.body.items.length])).toEqual([[200, 20], [200, 20], [200, 5], [200, 0]]);
    expect((await list(admin, '?status=pending&sort=oldest&limit=5')).body.items.length).toBe(5);
    const audits = await viewAudits();
    // đồng hồ giả đứng yên nên thứ tự created_at hòa: so theo (role, page)
    const key = (a: { actor_role: string; after: Record<string, unknown> }) => `${a.actor_role}:${a.after.page}`;
    audits.sort((x, y) => key(x).localeCompare(key(y)));
    expect(audits.map((a) => [a.actor_role, a.after.rows, a.after.page, a.after.limit])).toEqual([['admin', 5, 1, 5], ['staff', 20, 1, 20], ['staff', 20, 2, 20], ['staff', 5, 3, 20]]); // trang 4 rỗng không có dòng
    expect(audits[0]).toMatchObject({ actor_id: admin.id, after: { status: 'pending', sort: 'oldest', limit: 5, rows: 5 } });
    expect(audits[1].actor_id).toBe(staff.id);
    expect(JSON.stringify(audits)).not.toMatch(/0901234567|12 Lê Lợi|Nguyễn Văn An|chu@x\.vn/);
    expect(Object.keys(audits[1].after).sort()).toEqual(['limit', 'page', 'rows', 'sort']); // bộ lọc không dùng thì vắng, không ghi giá trị nào của khối khách
    t.clock.advance(61_000);
    expect((await list(staff, '?limit=100')).body.items.length).toBe(45);
    expect(await countOf(t, 'audit_logs', `action = 'shipment.view_list'`)).toBe(5); // thêm đúng một dòng, không phải 45
  });

  it(`SHP-TC-20261015-092816048 ${SEC} T9, T12: audit lỗi thì danh sách trả 500 không có dữ liệu cá nhân (đóng kín); audit chạy lại thì 200 kèm một dòng`, async () => {
    const { staff } = await people();
    await seedShipment(t, { status: 'pending', address: AN });
    jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit lỗi'));
    const bad = await list(staff);
    expect([bad.status, bad.headers['content-type']]).toEqual([500, expect.stringMatching(/application\/problem\+json/)]);
    expect(JSON.stringify(bad.body)).not.toMatch(/items|0901234567|Lê Lợi|Nguyễn Văn An/);
    expect(t.logs.records.filter((r) => r.level === 'error' && r.msg === 'request thất bại')).toHaveLength(1); // một dòng lỗi của request (dòng `request` kèm status 500 là nhật ký truy cập)
    expect(t.logs.lines.join('\n')).not.toMatch(/0901234567|Lê Lợi|Nguyễn Văn An/);
    expect(await viewAudits()).toEqual([]);
    const ok = await list(staff);
    expect([ok.status, ok.body.items.length, ok.body.items[0].phone]).toEqual([200, 1, '0901234567']);
    expect(await viewAudits()).toHaveLength(1);
  });

  it(`SHP-TC-20261015-092816083 ${SEC} T28, T9: ORD lỗi hoặc trả thiếu đơn thì danh sách trả 500, không trả trang thiếu khối khách, không audit, log không chứa dữ liệu khách`, async () => {
    const { staff } = await people();
    for (let i = 0; i < 3; i++) await seedShipment(t, { status: 'pending', address: AN, createdAt: at(i) });
    const api = t.app.get(OrderApi), real = OrderApi.prototype.getShipmentDisplay;
    const spy = jest.spyOn(api, 'getShipmentDisplay').mockRejectedValueOnce(new Error('ORD không đọc được'));
    const r1 = await list(staff);
    expect(r1.status).toBe(500);
    expect(JSON.stringify(r1.body)).not.toMatch(/items|Nguyễn Văn An|0901234567|Lê Lợi/);
    expect(await viewAudits()).toEqual([]);
    const errs = t.logs.records.filter((r) => r.level === 'error' && r.msg === 'request thất bại');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toHaveProperty('correlation_id');
    expect(t.logs.lines.join('\n')).not.toMatch(/Nguyễn Văn An|0901234567|Lê Lợi/);
    spy.mockImplementationOnce(async (ids) => (await real.call(api, ids)).slice(1)); // thiếu một trong ba đơn
    const r2 = await list(staff);
    expect([r2.status, 'items' in r2.body]).toEqual([500, false]);
    expect(await viewAudits()).toEqual([]);
  });

  it(`SHP-TC-20261015-092816118 ${SEC} T28: một trang chỉ gọi OrderApi.getShipmentDisplay đúng một lần với các order_id của trang (không N+1), không hàm đọc khác của ORD, SHP không SELECT bảng orders; trang rỗng không gọi`, async () => {
    const { staff } = await people();
    const m = (await seedShipment(t, { status: 'cancelled' })).method;
    for (let i = 0; i < 99; i++) await seedShipment(t, { status: 'pending', method: m, createdAt: at(i) });
    const api = t.app.get(OrderApi), real = OrderApi.prototype.getShipmentDisplay;
    let inOrd = false;
    const display = jest.spyOn(api, 'getShipmentDisplay').mockImplementation(async (ids) => { inOrd = true; try { return await real.call(api, ids); } finally { inOrd = false; } });
    const others = (['getSummary', 'findByCode', 'findForShipment', 'findOwned', 'getRecipient', 'findForPayment'] as const).map((fn) => jest.spyOn(api, fn));
    const outside: string[] = []; // câu SQL chạm bảng orders KHÔNG nằm trong getShipmentDisplay (tức do SHP)
    const origRaw = (t.prisma.$queryRaw as (...a: unknown[]) => unknown).bind(t.prisma);
    const raw = jest.spyOn(t.prisma, '$queryRaw').mockImplementation(((...a: any[]) => {
      const text: string = typeof a[0]?.sql === 'string' ? a[0].sql : [...a[0]].join('?');
      if (!inOrd && /\b(from|join|update)\s+"?orders\b/i.test(text)) outside.push(text);
      return origRaw(...a);
    }) as any);
    const t0 = Date.now();
    const r = await list(staff, '?limit=100');
    const ms = Date.now() - t0;
    expect([r.status, r.body.items.length]).toEqual([200, 100]);
    expect(display).toHaveBeenCalledTimes(1);
    const ids = display.mock.calls[0][0];
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    raw.mockRestore();
    const orderIds = (await q<{ order_id: string }>(t, `SELECT order_id FROM shipments`)).map((x) => x.order_id);
    expect([...ids].sort()).toEqual([...orderIds].sort()); // đúng order_id của 100 dòng
    for (const s of others) expect(s).not.toHaveBeenCalled();
    expect(outside).toEqual([]);
    expect(ms).toBeLessThan(3000);
    display.mockClear();
    t.clock.advance(61_000);
    expect((await list(staff, '?limit=20')).body.items).toHaveLength(20);
    expect(display).toHaveBeenCalledTimes(1);
    expect(display.mock.calls[0][0]).toHaveLength(20);
    display.mockClear();
    expect((await list(staff, '?page=9&limit=20')).body.items).toEqual([]);
    expect(display).toHaveBeenCalledTimes(0);
  }, 180_000);

  it(`SHP-TC-20261015-092816157 ${SEC} T9: đơn hộ của khách không tài khoản có tên và liên hệ từ bản chụp, đơn khách tự đặt có created_by_name null (khóa có mặt); không user_id`, async () => {
    const { s1, staff } = await people();
    const h = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s1.id, 'Phạm Văn Cường', '0987654321'), address: { receiver: 'Người nhận khác', phone: '0987654321', line1: '9 Nguyễn Huệ', ward: 'Bến Nghé', city: 'TP.HCM' }, createdAt: at(0) });
    const w = await seedShipment(t, { status: 'pending', address: { receiver: 'Đỗ Thị Dung', phone: '0911111111', line1: '1 Lý Tự Trọng', ward: 'Bến Nghé', city: 'TP.HCM' }, createdAt: at(1) });
    expect((await q<{ user_id: string | null }>(t, `SELECT user_id FROM orders WHERE id = '${h.order.id}'`))[0].user_id).toBeNull(); // khách không tài khoản
    await seedShipment(t, { status: 'cancelled', order: h.order, createdAt: at(5), createdBy: s1.id }); // đơn còn một vận đơn cancelled cũ: hai dòng cùng order_id trong một trang, ORD vẫn chỉ nhận id không trùng
    const r = await list(staff);
    expect(r.status).toBe(200);
    const [ih, iw] = (r.body.items as Item[]).filter((i) => i.status === 'pending');
    expect(ih).toMatchObject({ order_code: h.order.code, customer_name: 'Phạm Văn Cường', phone: '0987654321', address: '9 Nguyễn Huệ, Bến Nghé, TP.HCM', created_by_name: 'Trần Thu' });
    expect(iw).toMatchObject({ order_code: w.order.code, customer_name: 'Đỗ Thị Dung', created_by_name: null });
    expect('created_by_name' in iw).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/user_id/);
  });

  it(`SHP-TC-20261015-092816196 ${SEC} T26 (SB-45): sale đối chiếu created_by với ORD nên không thấy vận đơn khi admin đã đổi người tạo; staff vẫn thấy`, async () => {
    const { s1, s2, staff } = await people();
    const moved = await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s2.id, 'Khách đã chuyển', '0955555555'), createdBy: s1.id, createdAt: at(0) }); // bản chụp SHP vẫn là S1, ORD đã là S2
    for (let i = 1; i <= 2; i++) await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s1.id, `Khách ${i}`), createdAt: at(i) });
    const r = await list(s1);
    expect([r.status, r.body.items.length]).toEqual([200, 2]);
    expect(r.body.items.map((i: Item) => i.customer_name)).toEqual(['Khách 1', 'Khách 2']);
    expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`${moved.order.code}|Khách đã chuyển|0955555555`));
    expect((await viewAudits()).map((a) => [a.actor_id, a.after.rows])).toEqual([[s1.id, 2]]); // `rows` là số dòng THỰC TRẢ (2), không phải số dòng thô (3) (REV-SHP-13)
    const rs = await list(staff);
    expect(rs.body.items.map((i: Item) => i.order_code)).toContain(moved.order.code);
  });

  // REV-SHP-14 (SB-44): mã đơn hộ HDyymmdd-NNNNN ở chi tiết và lịch sử vận đơn: mọi đường không được phép cùng 404, thân giống nhau (chỉ khác trace_id), không lộ vận đơn.
  it('SB-44 mã HD... ở chi tiết và lịch sử vận đơn: đơn hộ không user_id với customer, mã không có, chữ thường, sai khuôn cùng 404 giống hệt; chủ đơn (sale) và staff vẫn 200 ở chi tiết của staff', async () => {
    const { s1, staff } = await people();
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const hoShip = await seedShipment(t, { status: 'shipped', ho: hoOf(s1.id), tracking: 'GHN77777777', orderCode: 'HD261015-00001' }); // đơn hộ không user_id
    const mine = await seedShipment(t, { status: 'shipped', user: (await who(t, 'customer', 'c2@x.vn')).id, orderCode: 'HD261015-00002' }); // đơn khách khác
    expect(hoShip.order.code).toMatch(/^HD\d{6}-\d{5}$/);
    const strip = (b: Record<string, unknown>) => ({ ...b, trace_id: 0 });
    const codes = [hoShip.order.code, 'HD261015-99999', hoShip.order.code.toLowerCase(), 'HD26101-000001', 'HD261015-0000A', mine.order.code];
    const rs = [];
    for (const c of codes) rs.push(await call(t, 'get', `/shipping/orders/${c}/shipment`, { cookie: c1.cookie }), await call(t, 'get', `/shipping/orders/${c}/shipment/history`, { cookie: c1.cookie }));
    for (const r of rs) {
      expect([r.status, r.headers['content-type']]).toEqual([404, expect.stringMatching(/application\/problem\+json/)]);
      expect(strip(r.body)).toEqual(strip(rs[0].body));
      expect(JSON.stringify(r.body)).not.toMatch(/shipped|GHN77777777|shipments|Prisma/);
    }
    expect((await call(t, 'get', `/shipping/orders/${hoShip.order.code}/shipment`, { cookie: staff.cookie })).status).toBe(200);
    expect((await call(t, 'get', `/shipping/orders/${hoShip.order.code}/shipment/history`, { cookie: staff.cookie })).status).toBe(200);
  });

  it(`SHP-TC-20261015-092816233 ${SEC} T27: sale gọi quá 30 lần mỗi phút nhận 429 (bậc D) trước khi vào xử lý: không audit, không gọi ORD lần 31; bộ đếm riêng từng người`, async () => {
    const { s1, s2 } = await people();
    await seedShipment(t, { status: 'pending', orderStatus: 'confirmed', ho: hoOf(s1.id) });
    t.clock.set(new Date(Math.floor(t.clock.now().getTime() / 60_000) * 60_000 + 60_000 + 1000)); // đầu cửa sổ kế tiếp
    const display = jest.spyOn(t.app.get(OrderApi), 'getShipmentDisplay');
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await list(s1)).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
    const limited = await list(s1);
    expect([limited.status, limited.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(await countOf(t, 'audit_logs', `action = 'shipment.view_list' AND actor_id = '${s1.id}'`)).toBe(30);
    expect(display).toHaveBeenCalledTimes(30);
    expect((await list(s2)).status).toBe(200);
  });

  it(`SHP-TC-20261015-092816270 ${SEC}: giao thất bại đơn hộ của khách không tài khoản vẫn 200 và phát ShipmentFailed với user_id rỗng; đơn không có vẫn 404; relay giao event không lỗi`, async () => {
    const { s1, staff } = await people();
    const v = await seedShipment(t, { status: 'shipped', orderCode: 'HD261015-00003', ho: hoOf(s1.id), createdAt: at(0) });
    expect((await q<{ user_id: string | null }>(t, `SELECT user_id FROM orders WHERE id = '${v.order.id}'`))[0].user_id).toBeNull();
    const before = (await histOf(t, v.id)).length;
    const r = await act(t, staff.cookie, 'HD261015-00003', 'fail', { reason_code: 'refused' });
    expect([r.status, r.body.status, r.body.order_code]).toEqual([200, 'failed', 'HD261015-00003']);
    expect((await histOf(t, v.id)).length).toBe(before + 1);
    expect(await shpAudits(t, v.id, 'shipping.shipment.fail')).toHaveLength(1);
    const ev = await shpOutbox(t, v.id);
    expect(ev.map((e) => e.type)).toEqual(['ShipmentFailed']);
    expect(ev[0].payload).toEqual({ shipment_id: v.id, order_id: v.order.id, order_code: 'HD261015-00003', user_id: null, reason: 'refused' }); // không note
    expect((await act(t, staff.cookie, 'HD261015-00009', 'fail', { reason_code: 'refused' })).status).toBe(404); // đơn không có: findForPayment trả null
    const run = await t.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000));
    expect(run.failed).toBe(0); // YẾU: NTF không nằm trong ứng dụng test của SHP; phần "NTF bỏ qua" do TC của NTF kiểm, ở đây chỉ kiểm consumer thật có mặt (ORD) nhận event không lỗi
    expect(await countOf(t, 'processed_events', `event_id = '${ev[0].id}'`)).toBeGreaterThanOrEqual(1);
  });
});
