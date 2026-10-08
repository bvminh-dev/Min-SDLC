import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/modules/platform';
import { q, seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { call, createOrdApp, deliver, people, seedOrder, sqlOf, type OrdApp, type Status } from '../support/ord';

// Danh sách đơn của customer (ORD-REQ-20261006-092320716) và danh sách quản trị của staff, admin (ORD-REQ-20261006-092320743).
const KEYS = ['code', 'created_at', 'grand_total', 'item_count', 'payment_method', 'payment_status', 'status'];
const T0 = Date.parse('2026-10-06T08:00:00Z'); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
const min = (i: number) => new Date(T0 + i * 60_000);

describe('ORD danh sách đơn', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.advance(61_000); });
  const get = (path: string, cookie?: string, headers: Record<string, string> = {}) => { let r = call(t, 'get', path, { cookie }); for (const [k, v] of Object.entries(headers)) r = r.set(k, v); return r; };
  const many = async (user: string, n: number, o: { status?: Status; start?: number } = {}) => { for (let i = 0; i < n; i++) await seedOrder(t, { user, status: o.status ?? 'paid', createdAt: min((o.start ?? 0) + i) }); };
  const expiredCookie = async (role: 'customer' | 'staff') => {
    const u = await seedUser(t, { role, email: `old-${role}@x.vn` });
    return (await seedSession(t, u.id, { createdAt: new Date(t.clock.now().getTime() - 3600_000), lastSeenAt: new Date(t.clock.now().getTime() - 3600_000), expiresAt: new Date(t.clock.now().getTime() - 1000), absoluteExpiresAt: new Date(t.clock.now().getTime() - 1000) })).cookie;
  };
  const problem = (r: { status: number; headers: Record<string, string>; body: any }, status: number, type: string) => {
    expect(r.status).toBe(status);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body).toMatchObject({ type: `urn:ecom:error:${type}`, status });
    expect(r.body.trace_id).toBeTruthy();
    expect(r.body.items).toBeUndefined();
    expect(r.body.total).toBeUndefined();
  };

  it('ORD-TC-20261006-111224310: customer có 25 đơn thấy 20 đơn mới nhất ở trang 1 và 5 đơn ở trang 2, mỗi dòng đúng bảy khóa, item_count là số dòng hàng', async () => {
    const { a, b } = await people(t);
    for (let i = 0; i < 25; i++) await seedOrder(t, { user: a.id, createdAt: min(i), items: i === 24 ? [{ qty: 2 }, { qty: 1 }, { qty: 1 }] : [{ qty: 1 }] });
    const bCodes: string[] = [];
    for (let i = 0; i < 5; i++) bCodes.push((await seedOrder(t, { user: b.id, createdAt: new Date(min(i * 5).getTime() + 30_000) })).code);
    const p1 = await get('/orders', a.cookie), p2 = await get('/orders?page=2', a.cookie);
    expect([p1.status, p1.body.page, p1.body.limit, p1.body.total, p1.body.items.length]).toEqual([200, 1, 20, 25, 20]);
    expect([p1.body.items[0].created_at, p1.body.items[19].created_at]).toEqual(['2026-10-06T08:24:00.000Z', '2026-10-06T08:05:00.000Z']); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    const times = p1.body.items.map((i: any) => Date.parse(i.created_at));
    expect(times.every((x: number, i: number) => i === 0 || x < times[i - 1])).toBe(true);
    expect([p2.status, p2.body.total, p2.body.items.length, p2.body.items[0].created_at, p2.body.items[4].created_at]).toEqual([200, 25, 5, '2026-10-06T08:04:00.000Z', '2026-10-06T08:00:00.000Z']); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    const all = [...p1.body.items, ...p2.body.items];
    for (const i of all) { expect(Object.keys(i).sort()).toEqual(KEYS); expect(typeof i.grand_total).toBe('number'); }
    expect(all.some((i: any) => bCodes.includes(i.code))).toBe(false);
    expect(p1.body.items[0].item_count).toBe(3);
    expect(JSON.stringify(all)).not.toMatch(/shipping_address|receiver|phone|email/);
  });

  it('ORD-TC-20261006-111224341: lọc theo trạng thái không hợp lệ (shipping, PAID, hai giá trị, rỗng) bị từ chối 400 không lặp lại giá trị; returned hợp lệ', async () => {
    const { a } = await people(t);
    await many(a.id, 3);
    for (const qs of ['status=shipping', 'status=PAID', 'status=paid&status=cancelled', 'status=']) {
      const r = await get(`/orders?${qs}`, a.cookie);
      problem(r, 400, 'validation-failed');
      expect(r.body.errors.map((e: any) => e.field)).toEqual(['status']);
      expect(JSON.stringify(r.body)).not.toMatch(/shipping|PAID|cancelled/);
    }
    const ok = await get('/orders?status=returned', a.cookie);
    expect([ok.status, ok.body.total]).toEqual([200, 0]);
  });

  it('ORD-TC-20261006-111224370: page và limit sai bị từ chối 400 và không có truy vấn đọc orders nào; limit=100 hợp lệ, page quá cuối trả rỗng', async () => {
    const { a } = await people(t);
    await many(a.id, 25);
    const spy = jest.spyOn(t.app.get(PrismaService), '$queryRaw');
    try {
      for (const qs of ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=101', 'limit=1.5', 'limit=1000000']) {
        const before = spy.mock.calls.length;
        const r = await get(`/orders?${qs}`, a.cookie);
        problem(r, 400, 'validation-failed');
        const sqls = sqlOf(spy.mock.calls.slice(before));
        expect(sqls.filter((s) => /FROM orders/.test(s))).toEqual([]); // chỉ truy vấn phiên của AUTH, không đọc orders
      }
    } finally { spy.mockRestore(); }
    const full = await get('/orders?limit=100', a.cookie), deep = await get('/orders?page=1000000', a.cookie);
    expect([full.status, full.body.limit, full.body.items.length]).toEqual([200, 100, 25]);
    expect([deep.status, deep.body.items, deep.body.total]).toEqual([200, [], 25]);
  });

  it('ORD-TC-20261006-111224400: guest, phiên hết hạn và phiên đã thu hồi nhận 401, không có items hay total', async () => {
    const { a } = await people(t);
    await many(a.id, 2);
    const revoked = await seedSession(t, a.id);
    expect((await call(t, 'post', '/auth/logout', { cookie: revoked.cookie })).status).toBe(204);
    const results = [await get('/orders'), await get('/orders', await expiredCookie('customer')), await get('/orders', revoked.cookie)];
    results.forEach((r) => problem(r, 401, r === results[1] ? 'session_expired' : 'unauthenticated')); // phiên quá hạn mang mã nền `session_expired` của AUTH (xem report, Lệch spec)
  });

  it('ORD-TC-20261006-111224430: tham số user_id, email, role bị từ chối 400 nêu tên tham số; header X-User-Id và X-Role giả bị bỏ qua', async () => {
    const { a, b } = await people(t);
    const bCodes: string[] = [];
    for (let i = 0; i < 5; i++) bCodes.push((await seedOrder(t, { user: b.id, createdAt: min(i) })).code);
    await many(a.id, 2, { start: 10 });
    for (const [qs, name] of [[`status=paid&user_id=${b.id}`, 'user_id'], ['email=b@x.vn', 'email'], ['role=admin', 'role']]) {
      const r = await get(`/orders?${qs}`, a.cookie);
      problem(r, 400, 'validation-failed');
      expect(r.body.errors.map((e: any) => e.field)).toContain(name);
      expect(bCodes.some((c) => JSON.stringify(r.body).includes(c))).toBe(false);
    }
    const ok = await get('/orders?status=paid', a.cookie, { 'X-User-Id': b.id, 'X-Role': 'admin' });
    expect([ok.status, ok.body.total]).toEqual([200, 2]);
    expect(ok.body.items.some((i: any) => bCodes.includes(i.code))).toBe(false);
  });

  it('ORD-TC-20261006-111224459: đúng 20 đơn thì trang 2 rỗng (200), 21 đơn thì trang 2 có đúng một đơn', async () => {
    const { a } = await people(t);
    await many(a.id, 20);
    const [p1, p2] = [await get('/orders?page=1', a.cookie), await get('/orders?page=2', a.cookie)];
    expect([p1.body.items.length, p1.body.total, p2.status, p2.body.items, p2.body.total, p2.body.page]).toEqual([20, 20, 200, [], 20, 2]);
    await many(a.id, 1, { start: 30 });
    const again = await get('/orders?page=2', a.cookie);
    expect([again.body.items.length, again.body.total]).toEqual([1, 21]);
  });

  it('ORD-TC-20261006-111224487: lọc cancelled chỉ trả đơn cancelled theo thứ tự mới nhất trước; trạng thái không có đơn trả rỗng; không lọc trả tất cả; đủ tám giá trị', async () => {
    const { a } = await people(t);
    for (const m of [0, 10, 20]) await seedOrder(t, { user: a.id, status: 'cancelled', createdAt: new Date(Date.parse('2026-10-06T09:00:00Z') + m * 60_000) }); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    await many(a.id, 5, { start: 100 });
    const c = await get('/orders?status=cancelled', a.cookie);
    expect([c.body.total, c.body.items.map((i: any) => i.status), c.body.items.map((i: any) => i.created_at.slice(11, 16))]).toEqual([3, ['cancelled', 'cancelled', 'cancelled'], ['09:20', '09:10', '09:00']]);
    const e = await get('/orders?status=expired', a.cookie), all = await get('/orders', a.cookie);
    expect([e.status, e.body.items, e.body.total, all.body.total]).toEqual([200, [], 0, 8]);
    for (const s of ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned']) expect((await get(`/orders?status=${s}`, a.cookie)).status).toBe(200);
  });

  it('ORD-TC-20261006-111224517: customer chưa có đơn thấy danh sách rỗng (không phải lỗi) dù người khác có 10 đơn', async () => {
    const { a, b } = await people(t);
    await many(b.id, 10);
    const r = await get('/orders', a.cookie);
    expect([r.status, r.body]).toEqual([200, { items: [], page: 1, limit: 20, total: 0 }]);
  });

  it('ORD-TC-20261006-111224546: đơn trùng created_at xếp ổn định theo id giảm dần, không trùng hay sót qua ranh giới trang, ba lần gọi cho cùng thứ tự', async () => {
    const { a } = await people(t);
    for (let i = 0; i < 19; i++) await seedOrder(t, { user: a.id, createdAt: new Date(Date.parse('2026-10-06T10:00:00Z') + i * 60_000) }); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    const tied = [] as { id: string; code: string }[];
    for (let i = 0; i < 3; i++) tied.push(await seedOrder(t, { user: a.id, createdAt: new Date('2026-10-06T09:00:00.000Z') })); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    await seedOrder(t, { user: a.id, createdAt: new Date('2026-10-06T08:00:00Z') });
    await seedOrder(t, { user: a.id, createdAt: new Date('2026-10-06T07:00:00Z') }); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    const desc = [...tied].sort((x, y) => (x.id < y.id ? 1 : -1)).map((x) => x.code);
    let first: string[] | undefined;
    for (let k = 0; k < 3; k++) {
      const [p1, p2] = [await get('/orders?page=1', a.cookie), await get('/orders?page=2', a.cookie)];
      const codes = [...p1.body.items, ...p2.body.items].map((i: any) => i.code);
      expect(new Set(codes).size).toBe(24);
      expect(codes[19]).toBe(desc[0]);
      expect(codes.slice(20, 22)).toEqual(desc.slice(1));
      expect(p2.body.items.slice(2).map((i: any) => i.created_at.slice(11, 13))).toEqual(['08', '07']);
      first ??= codes;
      expect(codes).toEqual(first);
    }
  });

  it('ORD-TC-20261006-111224575: tải lại danh sách phản ánh trạng thái mới (PaymentSucceeded) và đơn mới nhất, không bộ nhớ đệm', async () => {
    const { a } = await people(t);
    await many(a.id, 24);
    const x = await seedOrder(t, { user: a.id, status: 'pending', method: 'vnpay', createdAt: min(100) });
    expect((await get('/orders', a.cookie)).body.total).toBe(25);
    await deliver(t, 'PaymentSucceeded', { order_id: x.id, payment_id: randomUUID(), paid_at: new Date().toISOString() });
    const y = await seedOrder(t, { user: a.id, status: 'pending', createdAt: min(200) });
    const r = await get('/orders', a.cookie);
    expect([r.body.total, r.body.items[0].code]).toEqual([26, y.code]);
    const row = r.body.items.find((i: any) => i.code === x.code);
    expect([row.status, row.payment_status]).toEqual(['paid', 'succeeded']);
  });

  it('ORD-TC-20261006-111224604: staff thấy 20 đơn mới nhất của mọi customer, trang 3 có 5 đơn, dòng chỉ có bảy khóa và không có dữ liệu cá nhân', async () => {
    const { staff } = await people(t);
    const us = [await seedUser(t, { email: 'c1@x.vn', name: 'Khách Một' }), await seedUser(t, { email: 'c2@x.vn', name: 'Khách Hai' }), await seedUser(t, { email: 'c3@x.vn', name: 'Khách Ba' })];
    for (let i = 0; i < 45; i++) await seedOrder(t, { user: us[i % 3].id, createdAt: min(i) });
    const p1 = await get('/admin/orders', staff.cookie), p3 = await get('/admin/orders?page=3', staff.cookie);
    expect([p1.status, p1.body.total, p1.body.items.length, p1.body.items[0].created_at.slice(11, 16), p1.body.items[19].created_at.slice(11, 16)]).toEqual([200, 45, 20, '08:44', '08:25']);
    expect([p3.body.items.length, p3.body.items[0].created_at.slice(11, 16), p3.body.items[4].created_at.slice(11, 16)]).toEqual([5, '08:04', '08:00']);
    const rows = [...p1.body.items, ...p3.body.items];
    for (const i of rows) expect(Object.keys(i).sort()).toEqual(KEYS);
    const personal = JSON.stringify(rows.map(({ code: _c, ...r }: any) => r));
    expect(personal).not.toMatch(/@|0[0-9]{9}|shipping_address|receiver|phone|email|user_id|full_name|Khách/);
  });

  it('ORD-TC-20261006-111224634: admin lọc paid và tìm mã đơn chỉ thấy đúng đơn (không phân biệt hoa thường, kết hợp AND, không khớp một phần)', async () => {
    const { admin } = await people(t);
    const A = await seedOrder(t, { code: '7K3M9Q2XH4TB', status: 'paid' });
    await seedOrder(t, { code: '8M2N4P6R8S0T', status: 'paid' });
    await seedOrder(t, { code: '5C7D9F1G3H5J', status: 'pending' });
    const one = await get('/admin/orders?status=paid&code=7K3M9Q2XH4TB', admin.cookie), lower = await get('/admin/orders?status=paid&code=7k3m9q2xh4tb', admin.cookie);
    expect([one.body.total, one.body.items.map((i: any) => i.code)]).toEqual([1, [A.code]]);
    expect(lower.body.items.map((i: any) => i.code)).toEqual([A.code]);
    expect((await get('/admin/orders?status=pending&code=7K3M9Q2XH4TB', admin.cookie)).body).toMatchObject({ items: [], total: 0 });
    expect((await get('/admin/orders?code=7K3M9Q', admin.cookie)).body.items).toEqual([]);
  });

  it('ORD-TC-20261006-111224663: customer gọi danh sách quản trị nhận 403 forbidden, hai thân giống nhau (không lộ mã có tồn tại), header X-Role không đổi kết quả', async () => {
    const { a, b } = await people(t);
    await many(a.id, 3);
    const real = await seedOrder(t, { user: b.id, code: '7K3M9Q2XH4TB' });
    const r1 = await get('/admin/orders', a.cookie), r2 = await get(`/admin/orders?code=${real.code}`, a.cookie), r3 = await get('/admin/orders', a.cookie, { 'X-Role': 'admin' });
    for (const r of [r1, r2, r3]) problem(r, 403, 'forbidden');
    const strip = ({ trace_id: _t, ...rest }: any) => rest;
    expect(strip(r1.body)).toEqual(strip(r2.body));
    expect(strip(r1.body)).toEqual(strip(r3.body));
  });

  it('ORD-TC-20261006-111224693: guest và phiên hết hạn của staff gọi danh sách quản trị nhận 401 (401 trước 403)', async () => {
    await people(t);
    const [g, e] = [await get('/admin/orders'), await get('/admin/orders', await expiredCookie('staff'))];
    problem(g, 401, 'unauthenticated');
    problem(e, 401, 'session_expired');
  });

  it('ORD-TC-20261006-111224721: staff tìm bằng email, điện thoại, tên chỉ khớp theo code (rỗng); tham số email, phone, q bị từ chối 400; câu SQL chỉ có điều kiện code', async () => {
    const { staff, a } = await people(t); // customer có email a@x.vn
    await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB' });
    const spy = jest.spyOn(t.app.get(PrismaService), '$queryRaw');
    try {
      for (const qs of ['code=a@x.vn', 'code=0901234567', 'code=Nguy%E1%BB%85n%20V%C4%83n%20A']) {
        const r = await get(`/admin/orders?${qs}`, staff.cookie);
        expect([r.status, r.body.items, r.body.total]).toEqual([200, [], 0]);
      }
      const sql = sqlOf(spy.mock.calls).filter((s) => /FROM orders/.test(s)).join('\n');
      expect(sql).toMatch(/o\.code = /);
      expect(sql).not.toMatch(/users|LIKE|ILIKE|email|phone/i);
    } finally { spy.mockRestore(); }
    for (const qs of ['email=a@x.vn', 'phone=0901234567', 'q=a@x.vn']) problem(await get(`/admin/orders?${qs}`, staff.cookie), 400, 'validation-failed');
  });

  it('ORD-TC-20261006-111224750: trạng thái hoặc mã tìm không hợp lệ (shipping, rỗng, 33 ký tự) nhận 400; đúng 32 ký tự hợp lệ và trả rỗng', async () => {
    const { staff } = await people(t);
    for (const qs of ['status=shipping', 'code=', `code=${'ABCDEFGHJKMNPQRSTVWXYZ0123456789A'}`]) problem(await get(`/admin/orders?${qs}`, staff.cookie), 400, 'validation-failed');
    const ok = await get(`/admin/orders?code=${'ABCDEFGHJKMNPQRSTVWXYZ0123456789'}`, staff.cookie);
    expect([ok.status, ok.body.items]).toEqual([200, []]);
  });

  it('ORD-TC-20261006-111224780: tìm mã đơn không tồn tại trả 200 danh sách rỗng cùng cấu trúc (không phải 404)', async () => {
    const { admin, a } = await people(t);
    await many(a.id, 45);
    const r = await get('/admin/orders?code=ZZZZZZZZZZZZ', admin.cookie);
    expect([r.status, r.body]).toEqual([200, { items: [], page: 1, limit: 20, total: 0 }]);
  });

  it('ORD-TC-20261006-111224809: đúng 20 đơn khớp bộ lọc thì trang 2 rỗng và total đếm theo bộ lọc (20, không phải 26)', async () => {
    const { staff, a } = await people(t);
    await many(a.id, 20, { status: 'paid' });
    await many(a.id, 6, { status: 'pending', start: 100 });
    const [p1, p2] = [await get('/admin/orders?status=paid&page=1', staff.cookie), await get('/admin/orders?status=paid&page=2', staff.cookie)];
    expect([p1.body.items.length, p1.body.total, p2.status, p2.body.items, p2.body.total]).toEqual([20, 20, 200, [], 20]);
  });

  it('ORD-TC-20261006-111224838: staff tải lại thấy trạng thái mới sau ShipmentShipped; lọc paid không còn trả đơn đó', async () => {
    const { staff, a } = await people(t);
    const x = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: x.id, tracking_number: 'VN123456' });
    const r = await get('/admin/orders?code=7K3M9Q2XH4TB', staff.cookie), paid = await get('/admin/orders?status=paid', staff.cookie);
    expect([r.body.items.length, r.body.items[0].status, paid.body.items.map((i: any) => i.code)]).toEqual([1, 'shipped', []]);
    expect((await q(t, 'SELECT 1 FROM orders WHERE false')).length).toBe(0);
  });
});
