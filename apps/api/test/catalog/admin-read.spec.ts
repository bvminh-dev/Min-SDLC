import { truncateAll } from '../support/db';
import { call, createPrdApp, seedCategory, seedProduct, who, type PrdApp, type Who } from '../support/prd';

describe('PRD xem sản phẩm ở trang quản trị (PRD-REQ-20261006-095502655)', () => {
  let t: PrdApp;
  let admin: Who, staff: Who, customer: Who, cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset();
    [admin, staff, customer] = [await who(t, 'admin'), await who(t, 'staff'), await who(t, 'customer')];
    cat = await seedCategory(t, 'Áo');
  });
  const list = (qs = '', cookie: string | null = admin.cookie) => call(t, 'get', `/admin/products${qs}`, { cookie: cookie ?? undefined });

  it('PRD-TC-20261006-100355878: admin xem mọi trạng thái mới cập nhật trước; staff lọc status=draft; mỗi mục có sku, status, version; lọc theo danh mục (gồm con) và q', async () => {
    const child = await seedCategory(t, 'Áo thun', cat), other = await seedCategory(t, 'Quần');
    const base = t.clock.now().getTime();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await seedProduct(t, { category: i === 0 ? child : i === 1 ? other : cat, status: i < 2 ? 'draft' : i < 7 ? 'active' : 'archived', name: `Sản phẩm ${i}`, sku: `AD-${i}`, updatedAt: new Date(base - i * 60_000), images: i === 2 ? 1 : 0 }));
    const r = await list();
    expect(r.status).toBe(200);
    expect([r.body.items.length, r.body.total, r.body.page, r.body.limit]).toEqual([8, 8, 1, 20]);
    expect(r.body.items.map((x: any) => x.id)).toEqual(ids); // mới cập nhật trước
    for (const k of ['id', 'name', 'sku', 'price', 'status', 'category', 'image_url', 'updated_at']) expect(r.body.items[0]).toHaveProperty(k);
    expect(r.body.items[2].image_url).toMatch(/^http.*\/products\/.*\.webp$/);
    const s = await list('?status=draft', staff.cookie);
    expect([s.status, s.body.total, s.body.items.map((x: any) => x.status)]).toEqual([200, 2, ['draft', 'draft']]);
    expect((await list(`?category_id=${cat}`)).body.total).toBe(7); // 6 của chính Áo và 1 của con Áo thun; sản phẩm của Quần không tính
    expect((await list(`?category_id=${child}`)).body.total).toBe(1);
    expect((await list('?q=SẢN PHẨM 3')).body.items.map((x: any) => x.sku)).toEqual(['AD-3']);
    expect((await list('?q=ad-5')).body.items.map((x: any) => x.sku)).toEqual(['AD-5']); // theo sku, không phân biệt hoa thường
    const d = await call(t, 'get', `/admin/products/${ids[2]}`, { cookie: staff.cookie });
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ id: ids[2], sku: 'AD-2', status: 'active', version: 1, rating_count: 0, rating_avg: null });
    for (const k of ['description', 'images', 'version', 'published_at', 'rating_avg', 'category']) expect(d.body).toHaveProperty(k);
  });

  it('PRD-TC-20261006-100355901: customer 403, chưa đăng nhập 401 (không dữ liệu sản phẩm); staff gửi tham số sai 400; chi tiết không tồn tại 404; giới hạn bậc D 30 mỗi phút mỗi người', async () => {
    await seedProduct(t, { category: cat, name: 'Bí mật' });
    for (const [cookie, want] of [[customer.cookie, 403], [null, 401]] as const) {
      const r = await list('', cookie);
      expect([r.status, r.text.includes('Bí mật')]).toEqual([want, false]);
      expect((await call(t, 'get', '/admin/products/11111111-1111-4111-8111-111111111111', { cookie: cookie ?? undefined })).status).toBe(want);
    }
    for (const qs of ['?status=deleted', '?limit=101', '?limit=0', '?page=0', '?user_id=1', '?category_id=xyz', '?q=', `?q=${'x'.repeat(101)}`, '?page=abc']) {
      expect([qs, (await list(qs, staff.cookie)).status]).toEqual([qs, 400]);
    }
    expect((await call(t, 'get', '/admin/products/11111111-1111-4111-8111-111111111111', { cookie: admin.cookie })).status).toBe(404);
    expect((await call(t, 'get', '/admin/products/abc', { cookie: admin.cookie })).status).toBe(404);
    // bậc D: 30 yêu cầu mỗi phút mỗi người (danh sách và chi tiết chung một bộ đếm), staff khác không bị ảnh hưởng
    const other = await who(t, 'staff', 'staff2@shop.vn');
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await list('', other.cookie)).status);
    const over = await list('', other.cookie);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect([over.status, over.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect((await list('', admin.cookie)).status).toBe(200);
  });

  it('PRD-TC-20261006-100355924: trang quá cuối trả 200 items rỗng và total đúng; bảng rỗng trả total 0', async () => {
    expect(await list()).toMatchObject({ status: 200, body: { items: [], total: 0 } });
    for (let i = 0; i < 20; i++) await seedProduct(t, { category: cat });
    const r = await list('?page=2&limit=20');
    expect([r.status, r.body.items, r.body.total, r.body.page]).toEqual([200, [], 20, 2]);
  });
});
