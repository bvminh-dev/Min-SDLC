import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { actor, call, createPrmApp, seedCoupon, type PrmApp } from '../support/prm';

// Danh sách và chi tiết coupon quản trị (PRM-REQ-20261006-101036299): chỉ admin, không bao giờ trả coupon đã xóa mềm, tìm theo tiền tố có thoát ký tự đại diện, giới hạn tần suất bậc D.
describe('PRM xem danh sách và chi tiết coupon (admin)', () => {
  let t: PrmApp;
  let admin: { id: string; cookie: string };
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); admin = await actor(t, 'admin'); });
  const get = (path: string, cookie = admin.cookie) => call(t, 'get', `/admin/coupons${path}`, { cookie });

  it('PRM-TC-20261006-101037121: danh sách trang 1 (20 dòng, total 24 không tính deleted, mới tạo trước, mỗi dòng có remaining) và chi tiết (remaining 65, version, min_order_value, max_discount, per_user_limit, không deleted_at)', async () => {
    const base = Date.now() - 60 * 60_000;
    let target = '';
    for (let i = 0; i < 25; i++) {
      const c = await seedCoupon(t, { code: `LIST${String(i).padStart(2, '0')}`, status: i === 3 ? 'deleted' : i % 8 === 0 && i > 0 ? 'disabled' : 'active', createdAt: new Date(base + i * 60_000), ...(i === 0 ? { usageLimit: 100, consumed: 30, reserved: 5, perUser: 2, max: 50000, min: 200000 } : {}) });
      if (i === 0) target = c.id;
    }
    const r = await get('');
    expect([r.status, r.body.items.length, r.body.total, r.body.page, r.body.limit]).toEqual([200, 20, 24, 1, 20]);
    expect(r.body.items[0].code).toBe('LIST24'); // tạo sau cùng không bị xóa
    expect(r.body.items.every((c: any) => typeof c.remaining === 'number' && c.status !== 'deleted')).toBe(true);
    expect(r.body.items.map((c: any) => c.code)).not.toContain('LIST03');
    expect((await get('?page=2')).body.items).toHaveLength(4);
    const d = await get(`/${target}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ code: 'LIST00', remaining: 65, version: 1, min_order_value: 200000, max_discount: 50000, per_user_limit: 2, consumed_count: 30, reserved_count: 5 });
    expect(d.body).not.toHaveProperty('deleted_at');
    const disabled = await get('?status=disabled&q=li');
    expect(disabled.body.items.every((c: any) => c.status === 'disabled' && c.code.startsWith('LI'))).toBe(true);
    expect(disabled.body.total).toBe(3); // ba coupon tắt (i = 8, 16, 24)
  });

  it('PRM-TC-20261006-101037145: tham số danh sách sai (status=deleted, limit=101, page=0, status=foo, q quá 20 ký tự, ký tự NUL, nửa cặp thay thế lẻ) là 400 nêu đúng tham số; id đã xóa và id không phải uuid là cùng một 404', async () => {
    const del = await seedCoupon(t, { status: 'deleted' });
    const bad: [string, string][] = [['?status=deleted', 'status'], ['?limit=101', 'limit'], ['?page=0', 'page'], ['?status=foo', 'status'], [`?q=${'A'.repeat(21)}`, 'q'], ['?q=%00', 'q'], ['?limit=abc', 'limit'], ['?x=1', 'x']];
    for (const [qs, field] of bad) {
      const r = await get(qs);
      expect([qs, r.status, r.body.errors?.map((e: any) => e.field)]).toEqual([qs, 400, [field]]);
    }
    expect((await get('?q=%ED%A0%80')).status).toBeLessThan(500); // UTF-8 sai: qs đổi thành U+FFFD, không phải nửa cặp thay thế lẻ và không làm PostgreSQL lỗi
    const [a, b] = [await get(`/${del.id}`), await get('/not-a-uuid')];
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.body.type).toBe(b.body.type);
    expect(a.body.detail).toBe(b.body.detail);
    expect((await get(`/${randomUUID()}`)).status).toBe(404);
  });

  it('PRM-TC-20261006-101037169: staff, customer và người chưa đăng nhập không xem được danh sách hay chi tiết (403, 403, 401), body lỗi không chứa mã hay dữ liệu coupon', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10' });
    const staff = await actor(t, 'staff'), cust = await actor(t, 'customer');
    for (const path of ['', `/${id}`]) {
      for (const [cookie, status] of [[staff.cookie, 403], [cust.cookie, 403], [undefined, 401]] as const) {
        const r = await call(t, 'get', `/admin/coupons${path}`, { cookie });
        expect([path, status, r.status]).toEqual([path, status, status]);
        expect(JSON.stringify(r.body)).not.toMatch(/SALE10|usage_limit|consumed_count/);
      }
    }
  });

  it('PRM-TC-20261006-101037193: tìm theo tiền tố không phân biệt hoa thường; % và _ bị thoát (không khớp mọi mã), SA_L khớp đúng SA_LE; không lỗi SQL', async () => {
    for (const code of ['SALE10', 'SALE20', 'SUMMER1', 'SA_LE']) await seedCoupon(t, { code });
    const codes = async (qs: string) => (await get(qs)).body.items.map((c: any) => c.code).sort();
    expect(await codes('?q=sa')).toEqual(['SALE10', 'SALE20', 'SA_LE']);
    expect(await codes('?q=sa%25')).toEqual([]);
    expect(await codes('?q=sa_')).toEqual(['SA_LE']);
    expect(await codes('?q=SA_L')).toEqual(['SA_LE']);
    expect(await codes('?q=%5C')).toEqual([]); // dấu \ cũng được thoát
    expect(await codes('?q=%20sale1%20')).toEqual(['SALE10']); // cắt khoảng trắng
    expect((await get('?q=%20')).body.total).toBe(4); // q rỗng coi như không lọc
    expect((await get("?q=a'%20OR%201=1--")).body.items).toEqual([]); // tham số hóa
  });

  it('PRM-TC-20261006-101037216: danh sách rỗng (200, items [], total 0) và trang vượt dữ liệu (đúng 20 coupon: page 2 rỗng, total 20, page 1 đủ 20)', async () => {
    const empty = await get('');
    expect([empty.status, empty.body.items, empty.body.total]).toEqual([200, [], 0]);
    for (let i = 0; i < 20; i++) await seedCoupon(t, { code: `PAGE${String(i).padStart(2, '0')}` });
    const p2 = await get('?page=2&limit=20'), p1 = await get('?page=1&limit=20');
    expect([p2.status, p2.body.items, p2.body.total, p1.body.items.length]).toEqual([200, [], 20, 20]);
  });

  it('PRM-TC-20261006-113100505: endpoint quản trị vượt bậc D (30 mỗi phút mỗi người) là 429 rate-limited kèm Retry-After; admin khác 200; sang phút kế 200; đếm chung giữa hai instance (kho PostgreSQL); POST, PATCH, DELETE, enable, disable chung bộ đếm', async () => {
    const b = await createPrmApp();
    try {
      const align = (c: { now(): Date; set(d: Date): void }) => c.set(new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 2000)); // đầu một cửa sổ cố định: 31 yêu cầu nằm trọn một phút
      align(t.clock); align(b.clock);
      await truncateAll(t.prisma);
      const a1 = await actor(t, 'admin', 'a1@shop.vn'), a2 = await actor(t, 'admin', 'a2@shop.vn');
      const c = await seedCoupon(t, { code: 'RATE10' });
      const on = (app: PrmApp, path: string, cookie: string, method: 'get' | 'post' | 'patch' | 'delete' = 'get', body?: unknown) => call(app, method, `/admin/coupons${path}`, { cookie, body });
      const mixed: Promise<any>[] = [];
      for (let i = 0; i < 6; i++) mixed.push(on(t, '', a1.cookie), on(b, '', a1.cookie), on(b, `/${c.id}`, a1.cookie)); // 18 yêu cầu đọc chia hai instance
      expect((await Promise.all(mixed)).every((r) => r.status === 200)).toBe(true);
      expect((await on(t, `/${c.id}`, a1.cookie, 'patch', { version: 1, value: 11 })).status).toBe(200);
      expect((await on(b, `/${c.id}/disable`, a1.cookie, 'post')).status).toBe(200);
      expect((await on(t, `/${c.id}/enable`, a1.cookie, 'post')).status).toBe(200);
      expect((await on(b, '', a1.cookie, 'post', { code: 'bad' })).status).toBe(400); // lỗi schema vẫn tính vào bộ đếm (guard chạy trước)
      for (let i = 0; i < 8; i++) expect((await on(i % 2 ? t : b, '', a1.cookie)).status).toBe(200); // đủ 30
      const over = await on(b, '', a1.cookie);
      expect([over.status, over.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect((await on(t, `/${c.id}`, a1.cookie)).status).toBe(429); // instance kia cũng thấy
      expect((await on(t, `/${c.id}`, a1.cookie, 'delete')).status).toBe(429);
      expect((await on(t, '', a2.cookie)).status).toBe(200); // giới hạn theo từng người
      t.clock.advance(61_000); b.clock.advance(61_000);
      const a1b = await actor(t, 'admin', 'a1b@shop.vn'); // phiên cũ hết hạn nhàn rỗi sau 61 giây giả: người dùng và phiên mới cho phút kế tiếp
      expect((await on(t, '', a1b.cookie)).status).toBe(200);
    } finally { await b.close(); }
  }, 90_000);
});
