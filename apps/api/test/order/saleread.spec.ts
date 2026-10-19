import { randomUUID } from 'node:crypto';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { baseHo, createHo, ho, resetSources } from '../support/ho';
import { baseInput, call, createOrdApp, createPending, deliver, historyOf, outboxOf, seedOrder, sqlOf, type OrdApp } from '../support/ord';

// Đọc đơn hộ theo role (ORD-REQ-20261015-092748715 BR13, BR14; ORD-REQ-20261006-092320743, 092320768, 092320812): sale chỉ đơn của mình, staff không thấy khách, chỉ admin thấy giá vốn, cùng 404 (SB-44).
// fixed-clock: Clock giả đặt ở 2026-10-15 giờ Việt Nam, mỗi đơn cách nhau một giây để thứ tự `created_at` xác định.
const D15 = new Date('2026-10-15T02:00:00Z');
const cod = (user: string, o = {}) => baseInput(user, { payment_method: 'cod', payment_expires_at: null, ...o });

describe('ORD đọc đơn hộ theo role', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); await resetSources(t); t.logs.clear(); t.clock.set(D15); });
  const tick = () => t.clock.advance(1000); // một giây giữa hai đơn: thứ tự created_at xác định mà phiên đăng nhập (dựng trước) chưa hết hạn
  const mk = async (by: string, source: string, o = {}) => { tick(); return createHo(t, baseHo(by, { source_code: source, ...o })); };
  const get = (path: string, cookie?: string) => call(t, 'get', path, { cookie });
  const shape = (r: { status: number; headers: Record<string, string>; body: Record<string, unknown> }) => ({ status: r.status, ct: r.headers['content-type'], body: { ...r.body, trace_id: undefined } });
  const notFound = (r: { status: number; body: Record<string, unknown> }) => expect([r.status, r.body.type, r.body.status]).toEqual([404, 'urn:ecom:error:not-found', 404]);

  it('ORD-TC-20261015-092749753: staff lọc theo nguồn và người tạo, sale chỉ thấy đơn của mình (total không lộ đơn người khác), các bộ lọc kết hợp AND', async () => {
    const { s1, s2, a, staff, admin } = await ho(t);
    for (let i = 0; i < 4; i++) await mk(s1.id, 'facebook');
    for (let i = 0; i < 2; i++) await mk(s2.id, 'facebook');
    await mk(s1.id, 'hotline');
    for (let i = 0; i < 3; i++) await mk(s2.id, 'tiktok');
    for (let i = 0; i < 20; i++) { tick(); await createPending(t, cod(a.id)); }
    const fb = await get('/admin/orders?source=facebook', admin.cookie);
    expect(fb.body.total).toBe(6);
    for (const i of fb.body.items) expect(i).toMatchObject({ source: { code: 'facebook', name: 'Facebook' }, created_by_name: expect.stringMatching(/Trần Thu|Lê Hoa/) });
    expect((await get(`/admin/orders?source=facebook&created_by=${s1.id}`, staff.cookie)).body.total).toBe(4);
    const mine = await get('/admin/orders', s1.cookie);
    expect([mine.body.total, mine.body.items.length]).toEqual([5, 5]);
    expect(new Set(mine.body.items.map((i: { created_by_name: string }) => i.created_by_name))).toEqual(new Set(['Trần Thu']));
    expect((await get('/admin/orders?source=hotline', s1.cookie)).body.total).toBe(1);
    const site = await get('/admin/orders?source=website', staff.cookie);
    expect([site.body.total, site.body.items[0].created_by_name]).toEqual([20, null]); // đơn khách tự đặt: nguồn website, không người tạo
    const combo = await get(`/admin/orders?status=confirmed&source=facebook&code=${mine.body.items[4].code}`, admin.cookie);
    expect([combo.status, combo.body.total, combo.body.items.map((i: { code: string }) => i.code)]).toEqual([200, 1, [mine.body.items[4].code]]);
    const none = await get(`/admin/orders?status=paid&source=facebook&code=${mine.body.items[4].code}`, admin.cookie);
    expect([none.status, none.body.total]).toEqual([200, 0]);
  });

  it('ORD-TC-20261015-092749793: danh sách quản trị bị từ chối: nguồn lạ, created_by sai, sale thử xem đơn người khác, sai quyền, quá hạn mức bậc D', async () => {
    const { s1, s2, a, staff } = await ho(t);
    const o2 = await mk(s2.id, 'facebook');
    for (const path of ['/admin/orders?source=khong_co', '/admin/orders?created_by=abc', '/admin/orders?source=FB', '/admin/orders?email=a@x.vn']) {
      const r = await get(path, staff.cookie);
      expect([path, r.status, r.body.type, r.body.items]).toEqual([path, 400, 'urn:ecom:error:validation-failed', undefined]);
    }
    const other = await get(`/admin/orders?created_by=${s2.id}`, s1.cookie);
    expect([other.status, other.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']); // sale không lọc theo người tạo
    const byCode = await get(`/admin/orders?code=${o2.code}`, s1.cookie);
    expect([byCode.status, byCode.body.items, byCode.body.total]).toEqual([200, [], 0]); // giống mã không tồn tại
    expect((await get('/admin/orders?code=HD261015-09999', s1.cookie)).body).toEqual(byCode.body);
    expect([(await get('/admin/orders', a.cookie)).status, (await get('/admin/orders')).status]).toEqual([403, 401]);
    let blocked: Awaited<ReturnType<typeof get>> | undefined;
    for (let i = 0; i < 40 && !blocked; i++) { const r = await get('/admin/orders', staff.cookie); if (r.status === 429) blocked = r; }
    expect([blocked?.body.type, Number(blocked?.headers['retry-after']) > 0]).toEqual(['urn:ecom:error:rate-limited', true]);
    expect((await get('/admin/orders', s1.cookie)).status).toBe(200); // bộ đếm riêng từng người
  });

  it('ORD-TC-20261015-092749829: tìm mã cũ và mã mới chuẩn hóa chữ hoa, nguồn đã tắt vẫn lọc được, ô tìm 32 ký tự là biên', async () => {
    const { s1, a, staff } = await ho(t);
    const old = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    const fresh = await mk(s1.id, 'tiktok');
    for (let i = 0; i < 11; i++) await mk(s1.id, 'tiktok'); // 12 đơn tiktok
    await q(t, `UPDATE order_sources SET is_active = false WHERE code = 'tiktok'`);
    const codes = async (qs: string) => (await get(`/admin/orders?${qs}`, staff.cookie)).body;
    expect((await codes('code=7k3m9q2xh4tb')).items.map((i: { code: string }) => i.code)).toEqual([old.code]);
    expect((await codes(`code=${fresh.code.toLowerCase()}`)).items.map((i: { code: string }) => i.code)).toEqual([fresh.code]);
    expect((await get('/admin/orders?source=tiktok', staff.cookie)).body.total).toBe(12); // không 400 với nguồn đã tắt
    const long32 = await get(`/admin/orders?code=${'HD261015-00002HD261015-00002ABC'}`, staff.cookie);
    expect([long32.status, long32.body.items]).toEqual([200, []]);
    expect((await get(`/admin/orders?code=${'A'.repeat(33)}`, staff.cookie)).status).toBe(400);
  });

  it('ORD-TC-20261015-092749864: chi tiết đơn hộ theo role: sale thấy khách, ghi chú, địa chỉ nhưng không có giá vốn; staff không thấy khách và địa chỉ; admin thấy cả giá vốn; khóa vắng chứ không null', async () => {
    const { s1, staff, admin } = await ho(t);
    const r = await mk(s1.id, 'facebook', { note: 'Giao sau 18h' });
    const sale = (await get(`/orders/${r.code}`, s1.cookie)).body, st = (await get(`/orders/${r.code}`, staff.cookie)).body, ad = (await get(`/orders/${r.code}`, admin.cookie)).body;
    expect(sale).toMatchObject({ source: { code: 'facebook', name: 'Facebook' }, created_by_name: 'Trần Thu', note: 'Giao sau 18h', customer: { full_name: 'Trần Thị Mai', phone: '0912345678' } });
    expect(sale.items[0].note).toBe('size M, màu đen');
    expect(sale.shipping_address).toBeDefined();
    expect(sale.items[0]).not.toHaveProperty('cost_snapshot');
    expect(st).toMatchObject({ source: { code: 'facebook' }, created_by_name: 'Trần Thu', note: 'Giao sau 18h' });
    expect(st.items[0].note).toBe('size M, màu đen');
    for (const k of ['customer', 'shipping_address']) expect(st).not.toHaveProperty(k);
    expect(st.items[0]).not.toHaveProperty('cost_snapshot');
    expect(ad).toMatchObject({ source: { code: 'facebook' }, note: 'Giao sau 18h', customer: { phone: '0912345678' }, created_by_name: 'Trần Thu' });
    expect(ad.items.map((i: { cost_snapshot: number }) => i.cost_snapshot)).toEqual([60000, 150000]);
    expect([sale.can_cancel, st.can_cancel, ad.can_cancel]).toEqual([false, false, true]); // sale và staff không hủy
    const everywhere = JSON.stringify([await outboxOf(t, r.order_id), await q(t, `SELECT * FROM audit_logs`), t.logs.lines]);
    expect(everywhere).not.toMatch(/cost_snapshot|Giao sau 18h|Trần Thị Mai|0912345678|size M/);
  });

  it('ORD-TC-20261015-092749900 ORD-TC-20261015-092749008 ORD-TC-20261015-092748973: sale mở chi tiết, lịch sử, ô tìm mã đơn của sale khác, đơn khách tự đặt, mã không tồn tại: cùng 404 hoặc danh sách rỗng giống hệt; customer không phải chủ đơn hộ cũng 404; mọi trường hợp cùng đường truy vấn', async () => {
    const { s1, s2, a } = await ho(t);
    const hoOrder = await mk(s1.id, 'facebook');
    const own = await createPending(t, cod(a.id));
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    const rs: { shape: unknown; sql: string[] }[] = [];
    for (const c of [hoOrder.code, own.code, 'HD261015-09999']) { spy.mockClear(); const r = await get(`/orders/${c}`, s2.cookie); notFound(r); rs.push({ shape: shape(r), sql: sqlOf(spy.mock.calls as unknown[][]) }); }
    spy.mockRestore();
    for (const x of rs) expect(x).toEqual(rs[0]);
    notFound(await get(`/orders/${hoOrder.code}`, a.cookie)); // đơn hộ không gắn A
    expect((await get(`/orders/${hoOrder.code}`, s1.cookie)).status).toBe(200);
    for (const c of [hoOrder.code, own.code]) notFound(await get(`/orders/${c}/status-history`, s2.cookie)); // lịch sử: cùng 404 (ORD-TC-20261015-092749008)
    const search = await get(`/admin/orders?code=${hoOrder.code}`, s2.cookie), none = await get('/admin/orders?code=HD261015-09999', s2.cookie);
    expect([search.status, search.body.items, search.body.total]).toEqual([200, [], 0]);
    expect(search.body).toEqual(none.body); // ô tìm mã của sale khác giống hệt mã không tồn tại
  });

  it('ORD-TC-20261015-095530520: sale xem lịch sử đơn hộ của mình đúng thứ tự ghi (không dòng paid), không lộ người tạo hay actor_role; admin xem được, customer không phải chủ đơn nhận 404', async () => {
    const { s1, a, admin } = await ho(t);
    const r = await mk(s1.id, 'facebook', { payment_method: 'cash' });
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: r.order_id, amount: 480000, method: 'cash', paid_at: t.clock.now().toISOString() });
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: r.order_id, tracking_number: 'VN123456' });
    await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: r.order_id });
    const mine = await get(`/orders/${r.code}/status-history`, s1.cookie);
    expect([mine.status, mine.body.items.map((i: { status: string }) => i.status)]).toEqual([200, ['pending', 'confirmed', 'shipped', 'delivered']]);
    for (const i of mine.body.items) expect(Object.keys(i).sort()).toEqual(['at', 'status']);
    expect(JSON.stringify(mine.body)).not.toMatch(/actor|sale|Trần Thu|user/);
    expect((await historyOf(t, r.order_id))[0]).toMatchObject({ actor_id: s1.id, actor_role: 'sale' }); // chỉ ở CSDL
    expect((await get(`/orders/${r.code}/status-history`, admin.cookie)).body).toEqual(mine.body);
    notFound(await get(`/orders/${r.code}/status-history`, a.cookie));
  });

  it('ORD-TC-20261015-095530563: sale đọc lịch sử đơn của sale khác, đơn khách tự đặt, mã không tồn tại: cùng 404; PATCH, DELETE vào lịch sử bị từ chối', async () => {
    const { s1, s2, a } = await ho(t);
    const r = await mk(s1.id, 'facebook');
    const own = await createPending(t, cod(a.id));
    const shapes = [];
    for (const c of [r.code, own.code, 'HD261015-09999']) { const x = await get(`/orders/${c}/status-history`, s2.cookie); notFound(x); shapes.push(shape(x)); }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    const before = JSON.stringify(await historyOf(t, r.order_id));
    for (const m of ['patch', 'delete'] as const) expect([404, 405]).toContain((await call(t, m, `/orders/${r.code}/status-history`, { cookie: s2.cookie, body: m === 'patch' ? {} : undefined })).status);
    expect(JSON.stringify(await historyOf(t, r.order_id))).toBe(before);
  });

  it('ORD-TC-20261015-094427527: listForSale và getForSale trả đơn hộ của đúng sale, admin xem mọi đơn hộ, tên người tạo bằng một lời gọi AUTH cho cả trang, không user_id và giá vốn', async () => {
    const { s1, s2, a } = await ho(t);
    const mine: { code: string }[] = [];
    for (let i = 0; i < 4; i++) mine.push(await mk(s1.id, 'facebook', i === 2 ? { note: 'Có ghi chú đơn' } : {}));
    mine.push(await mk(s1.id, 'hotline'));
    for (let i = 0; i < 3; i++) await mk(s2.id, 'tiktok');
    for (let i = 0; i < 20; i++) { tick(); await createPending(t, cod(a.id)); }
    const names = jest.spyOn(t.api, 'getDisplayNames');
    const page = await t.ord.listForSale({ created_by: s1.id, page: 1, limit: 20 });
    expect(page.total).toBe(5);
    expect(names).toHaveBeenCalledTimes(1);
    expect(page.items.map((i) => i.code)).toEqual(mine.map((m) => m.code).reverse()); // created_at giảm dần
    for (const i of page.items) {
      expect(i).toMatchObject({ created_by: { id: s1.id, name: 'Trần Thu' }, customer: { name: 'Trần Thị Mai', phone: '0912345678' }, items_count: 2 });
      expect(Object.keys(i).sort()).toEqual(['code', 'created_at', 'created_by', 'customer', 'grand_total', 'items_count', 'payment_method', 'payment_status', 'source', 'status']);
    }
    expect(JSON.stringify(page)).not.toMatch(/user_id|cost_snapshot|size M|line1|Bến Nghé/);
    expect((await t.ord.listForSale({ created_by: s1.id, source: 'hotline', page: 1, limit: 20 })).total).toBe(1);
    expect((await t.ord.listForSale({ created_by: null, page: 1, limit: 20 })).total).toBe(8); // mọi đơn hộ, không có đơn khách tự đặt
    expect((await t.ord.listForSale({ created_by: s1.id, status: 'paid', page: 1, limit: 20 })).total).toBe(0);
    const one = await t.ord.getForSale(mine[0].code, { created_by: s1.id });
    expect(one).toMatchObject({ code: mine[0].code, status: 'confirmed', customer: { name: 'Trần Thị Mai', phone: '0912345678', has_account: false }, source: { code: 'facebook', name: 'Facebook' }, note: 'Khách muốn giao sau 18h' });
    expect(one?.items[0]).toMatchObject({ note: 'size M, màu đen', name: 'Áo thun', quantity: 2, unit_price: 100000, line_total: 200000 });
    expect(Object.keys(one?.shipping_address as object).sort()).toEqual(['city', 'district', 'line1', 'phone', 'receiver', 'ward']);
    for (const k of ['cost_snapshot', 'user_id', 'created_by']) expect(JSON.stringify(one)).not.toContain(`"${k}"`);
    const admin = await t.ord.getForSale(mine[0].code.toLowerCase(), { created_by: null });
    expect(admin).toMatchObject({ created_by: { id: s1.id, name: 'Trần Thu' } });
    expect(JSON.stringify(admin)).not.toMatch(/cost_snapshot|user_id/);
    names.mockRestore();
  });

  it('ORD-TC-20261015-094427624: getForSale trả null giống nhau (cùng đường truy vấn) cho đơn người khác, đơn khách tự đặt, không tồn tại, mã sai định dạng; listForSale từ chối tham số sai bằng RangeError; lỗi AUTH ném nguyên', async () => {
    const { s1, s2, a } = await ho(t);
    const mine = await mk(s1.id, 'facebook'), other = await mk(s2.id, 'facebook');
    const own = await createPending(t, cod(a.id));
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    const sqls: string[][] = [];
    for (const c of [other.code, own.code, 'HD261015-09999', 'HD2610-1']) { spy.mockClear(); expect(await t.ord.getForSale(c, { created_by: s1.id })).toBeNull(); sqls.push(sqlOf(spy.mock.calls as unknown[][])); }
    for (const s of sqls) expect(s).toEqual(sqls[0]);
    expect(await t.ord.getForSale(mine.code, { created_by: s1.id })).not.toBeNull();
    spy.mockClear();
    for (const bad of [{ limit: 101 }, { page: 0 }, { status: 'shipping' }, { created_by: 'abc' }]) await expect(t.ord.listForSale({ created_by: s1.id, page: 1, limit: 20, ...bad } as never)).rejects.toThrow(RangeError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const down = jest.spyOn(t.api, 'getDisplayNames').mockRejectedValue(new Error('auth down'));
    await expect(t.ord.listForSale({ created_by: s1.id, page: 1, limit: 20 })).rejects.toThrow('auth down');
    down.mockRestore();
  });

  it('ORD-TC-20261015-094427719: listForSale và getForSale ở biên: trang cuối rỗng, đơn gắn tài khoản có has_account (không lộ user_id), đơn của admin có ở cả hai cách gọi, đơn khách tự đặt không lọt vào', async () => {
    const { s1, a, admin } = await ho(t);
    const rows: { code: string }[] = [];
    for (let i = 0; i < 20; i++) rows.push(await mk(s1.id, 'facebook', i === 4 ? { user_id: a.id } : {}));
    const p1 = await t.ord.listForSale({ created_by: s1.id, page: 1, limit: 20 }), p2 = await t.ord.listForSale({ created_by: s1.id, page: 2, limit: 20 });
    expect([p1.items.length, p1.total, p2.items, p2.total]).toEqual([20, 20, [], 20]);
    const linked = await t.ord.getForSale(rows[4].code, { created_by: s1.id });
    expect(linked?.customer.has_account).toBe(true);
    expect(JSON.stringify(linked)).not.toContain(a.id);
    tick();
    const adminOrder = await createHo(t, baseHo(admin.id, { created_by_role: 'admin' }));
    await createPending(t, cod(a.id));
    expect((await t.ord.listForSale({ created_by: null, page: 1, limit: 100 })).items.map((i) => i.code)).toContain(adminOrder.code);
    expect((await t.ord.listForSale({ created_by: admin.id, page: 1, limit: 100 })).items.map((i) => i.code)).toEqual([adminOrder.code]);
    expect((await t.ord.listForSale({ created_by: null, page: 1, limit: 100 })).total).toBe(21); // không có đơn khách tự đặt
  });
});
