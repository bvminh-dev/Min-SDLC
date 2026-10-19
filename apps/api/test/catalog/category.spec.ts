import { truncateAll } from '../support/db';
import { auditOf, call, count, createPrdApp, seedCategory, seedProduct, who, type PrdApp, type Who } from '../support/prd';
import { q } from '../support/auth';

describe('PRD danh mục: cây, tạo, sửa, chuyển nhánh, xóa (PRD-REQ-20261006-095502484, ...507, ...529)', () => {
  let t: PrdApp;
  let admin: Who, staff: Who, customer: Who;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset();
    [admin, staff, customer] = [await who(t, 'admin'), await who(t, 'staff'), await who(t, 'customer')];
  });
  const create = (name: string, parent?: string | null, cookie = admin.cookie) => call(t, 'post', '/admin/categories', { cookie, body: { name, ...(parent === undefined ? {} : { parent_id: parent }) } });
  const tree = () => call(t, 'get', '/categories');
  const rows = () => q<{ name: string; slug: string; depth: number; parent_id: string | null }>(t, 'SELECT name, slug, depth, parent_id FROM categories ORDER BY name');

  it('PRD-TC-20261006-100355294: khách chưa đăng nhập xem cây: cha trước con, anh em theo tên, product_count gồm danh mục con và không đếm draft', async () => {
    const root = await seedCategory(t, 'Thời trang'), ao = await seedCategory(t, 'Áo', root), quan = await seedCategory(t, 'Quần', root);
    await seedCategory(t, 'Zebra'); // gốc thứ hai, đứng sau
    for (let i = 0; i < 4; i++) await seedProduct(t, { category: ao });
    for (let i = 0; i < 2; i++) await seedProduct(t, { category: quan });
    await seedProduct(t, { category: quan, status: 'draft' });
    const r = await tree();
    expect(r.status).toBe(200);
    expect(r.body.items.map((c: any) => [c.name, c.product_count])).toEqual([['Thời trang', 6], ['Áo', 4], ['Quần', 2], ['Zebra', 0]]);
    expect(Object.keys(r.body.items[1]).sort()).toEqual(['depth', 'id', 'name', 'parent_id', 'product_count', 'slug']);
    expect(r.body.items[1].parent_id).toBe(root);
  });

  it('PRD-TC-20261006-100355318: CSDL không truy cập được thì cây trả 503 problem+json có trace_id, không lộ stack, bảng hay SQL', async () => {
    const spy = jest.spyOn(t.prisma, '$queryRaw').mockRejectedValue(Object.assign(new Error("Can't reach database server at `db.internal:5432` SELECT * FROM categories"), { code: 'P1001' }));
    try {
      const r = await tree();
      expect(r.status).toBe(503);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body.trace_id).toBeTruthy();
      expect(r.body.type).toBe('urn:ecom:error:service-unavailable');
      expect(r.text).not.toMatch(/SELECT|categories|db\.internal|at Object|\.ts:/);
    } finally { spy.mockRestore(); }
  });

  it('PRD-TC-20261006-100355341: bảng rỗng trả 200 với items rỗng; danh mục chỉ có sản phẩm archived vẫn có, product_count = 0', async () => {
    expect((await tree()).body).toEqual({ items: [] });
    const c = await seedCategory(t, 'Phụ kiện');
    await seedProduct(t, { category: c, status: 'archived' });
    const r = await tree();
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: any) => [x.name, x.product_count])).toEqual([['Phụ kiện', 0]]);
  });

  it('PRD-TC-20261006-100355364: admin tạo danh mục con (slug tự sinh, depth 2, audit), đổi tên không đổi slug', async () => {
    const root = await seedCategory(t, 'Thời trang');
    const r = await create('Áo', root);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Áo', slug: 'ao', parent_id: root, depth: 2 });
    expect(await count(t, 'audit_logs', "action = 'catalog.category.create'")).toBe(1);
    const [a] = await auditOf(t, 'catalog.category.create');
    expect([a.actor_id, a.actor_role, a.target_id]).toEqual([admin.id, 'admin', r.body.id]);
    expect(a.after).toMatchObject({ name: 'Áo', parent_id: root });
    expect((await tree()).body.items.map((c: any) => [c.name, c.parent_id])).toEqual([['Thời trang', null], ['Áo', root]]);
    const p = await call(t, 'patch', `/admin/categories/${r.body.id}`, { cookie: admin.cookie, body: { name: 'Áo thun' } });
    expect(p.status).toBe(200);
    expect([p.body.name, p.body.slug]).toEqual(['Áo thun', 'ao']);
    const [u] = await auditOf(t, 'catalog.category.update');
    expect([u.before.name, u.after.name]).toEqual(['Áo', 'Áo thun']);
    expect(await count(t, 'audit_logs', "action = 'catalog.category.update'")).toBe(1);
  });

  it('PRD-TC-20261006-100355387: trùng tên (khác hoa thường, thừa khoảng trắng), tạo vòng và dữ liệu sai bị từ chối; không audit', async () => {
    const root = await seedCategory(t, 'Thời trang'), ao = await seedCategory(t, 'Áo', root), thun = await seedCategory(t, 'Áo thun', ao);
    const dup = await create('áo ', root);
    expect([dup.status, dup.body.type]).toEqual([409, 'urn:ecom:error:category-name-taken']);
    expect(await count(t, 'categories')).toBe(3);
    expect(await count(t, 'audit_logs', "action LIKE 'catalog.category.%'")).toBe(0);
    const t0 = Date.now();
    const cycle = await call(t, 'patch', `/admin/categories/${root}`, { cookie: admin.cookie, body: { parent_id: thun } });
    expect([cycle.status, cycle.body.type]).toEqual([409, 'urn:ecom:error:category-cycle']);
    expect(Date.now() - t0).toBeLessThan(1000); // không lặp vô hạn
    const self = await call(t, 'patch', `/admin/categories/${ao}`, { cookie: admin.cookie, body: { parent_id: ao } });
    expect([self.status, self.body.type]).toEqual([409, 'urn:ecom:error:category-cycle']);
    expect((await rows()).map((r) => [r.name, r.depth])).toEqual([['Thời trang', 1], ['Áo', 2], ['Áo thun', 3]]); // cây không đổi
    // dữ liệu sai
    for (const body of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, { name: 'ok', parent_id: 'not-a-uuid' }, { name: 'ok', slug: 'x' }, { name: 'a\u0000b' }, {}]) {
      const r = await call(t, 'post', '/admin/categories', { cookie: admin.cookie, body });
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
      expect(r.body.errors.length).toBeGreaterThan(0);
    }
    expect((await create('Mồ côi', '11111111-1111-4111-8111-111111111111')).status).toBe(400); // cha không tồn tại
    expect((await call(t, 'patch', `/admin/categories/${ao}`, { cookie: admin.cookie, body: {} })).status).toBe(400);
    expect(await count(t, 'categories')).toBe(3);
  });

  it('PRD-TC-20261006-100355410: chỉ admin tạo hoặc sửa danh mục: chưa đăng nhập 401, customer và staff 403, không đổi gì, không audit', async () => {
    const c = await seedCategory(t, 'Gốc');
    for (const [who_, want] of [[undefined, 401], [customer.cookie, 403], [staff.cookie, 403]] as const) {
      const a = await call(t, 'post', '/admin/categories', { cookie: who_, body: { name: 'X' } });
      const b = await call(t, 'patch', `/admin/categories/${c}`, { cookie: who_, body: { name: 'Y' } });
      expect([a.status, b.status]).toEqual([want, want]);
    }
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].name).toBe('Gốc');
    expect(await count(t, 'audit_logs', "action LIKE 'catalog.category.%'")).toBe(0);
  });

  it('PRD-TC-20261006-100355433: cùng tên khác cha được phép (slug khac-2); danh mục cấp 4 bị từ chối, không có dòng depth = 4', async () => {
    const a = await seedCategory(t, 'A'), b = await seedCategory(t, 'B');
    const k1 = await create('Khác', a), k2 = await create('Khác', b);
    expect([k1.status, k2.status]).toEqual([201, 201]);
    expect([k1.body.slug, k2.body.slug]).toEqual(['khac', 'khac-2']);
    const tt = await seedCategory(t, 'Thời trang'), ao = await seedCategory(t, 'Áo', tt), tron = await seedCategory(t, 'Áo thun cổ tròn', ao);
    const deep = await create('Cấp bốn', tron);
    expect([deep.status, deep.body.type]).toEqual([409, 'urn:ecom:error:category-too-deep']);
    expect(await count(t, 'categories', 'depth = 4')).toBe(0);
    // chuyển nhánh làm cả nhánh con vượt 3 cấp cũng bị từ chối; chuyển hợp lệ cập nhật depth cả nhánh
    const move = await call(t, 'patch', `/admin/categories/${tt}`, { cookie: admin.cookie, body: { parent_id: a } });
    expect([move.status, move.body.type]).toEqual([409, 'urn:ecom:error:category-too-deep']);
    const ok = await call(t, 'patch', `/admin/categories/${ao}`, { cookie: admin.cookie, body: { parent_id: null } });
    expect([ok.status, ok.body.depth]).toEqual([200, 1]);
    expect((await q<{ depth: number }>(t, `SELECT depth FROM categories WHERE id = '${tron}'`))[0].depth).toBe(2); // con cháu đi theo
  });

  it('PRD-TC-20261006-100355456: admin xóa danh mục rỗng (204, biến khỏi cây, audit)', async () => {
    const c = await seedCategory(t, 'Phụ kiện cũ');
    const r = await call(t, 'delete', `/admin/categories/${c}`, { cookie: admin.cookie });
    expect(r.status).toBe(204);
    expect((await tree()).body.items).toEqual([]);
    expect(await count(t, 'audit_logs', "action = 'catalog.category.delete'")).toBe(1);
  });

  it('PRD-TC-20261006-100355479: không xóa được danh mục còn con (has_children) hay còn sản phẩm archived (has_products); staff 403', async () => {
    const root = await seedCategory(t, 'Thời trang'), ao = await seedCategory(t, 'Áo', root);
    await seedProduct(t, { category: ao, status: 'archived' });
    const a = await call(t, 'delete', `/admin/categories/${root}`, { cookie: admin.cookie });
    expect([a.status, a.body.type, a.body.reasons]).toEqual([409, 'urn:ecom:error:category-not-empty', ['has_children']]);
    const b = await call(t, 'delete', `/admin/categories/${ao}`, { cookie: admin.cookie });
    expect([b.status, b.body.reasons]).toEqual([409, ['has_products']]);
    const both = await seedCategory(t, 'Cả hai'); await seedCategory(t, 'Con', both); await seedProduct(t, { category: both });
    expect((await call(t, 'delete', `/admin/categories/${both}`, { cookie: admin.cookie })).body.reasons).toEqual(['has_children', 'has_products']); // đủ cả hai lý do (BR2)
    expect((await call(t, 'delete', `/admin/categories/${ao}`, { cookie: staff.cookie })).status).toBe(403);
    expect(await count(t, 'categories')).toBe(4);
    expect(await count(t, 'audit_logs', "action = 'catalog.category.delete'")).toBe(0);
  });

  it('PRD-TC-20261006-100355501: xóa lần hai cùng id trả 404 không audit; xóa đua với chuyển sản phẩm vào: không bao giờ có sản phẩm trỏ tới danh mục đã xóa (20 lần)', async () => {
    const x = await seedCategory(t, 'X');
    expect((await call(t, 'delete', `/admin/categories/${x}`, { cookie: admin.cookie })).status).toBe(204);
    expect((await call(t, 'delete', `/admin/categories/${x}`, { cookie: admin.cookie })).status).toBe(404);
    expect((await call(t, 'delete', '/admin/categories/abc', { cookie: admin.cookie })).status).toBe(404);
    expect(await count(t, 'audit_logs', "action = 'catalog.category.delete'")).toBe(1);
    const home = await seedCategory(t, 'Nhà');
    const outcomes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      t.clock.advance(61_000); // cửa sổ bậc D của nhóm ghi quản trị (30 mỗi phút mỗi người) trôi sang phút mới, mỗi vòng hai yêu cầu ghi
      const y = await seedCategory(t, `Y${i}`);
      const p = await seedProduct(t, { category: home, status: 'draft', sku: `RC-${String(i).padStart(3, '0')}` });
      const version = (await q<{ version: number }>(t, `SELECT version FROM products WHERE id = '${p}'`))[0].version;
      const [del, mv] = await Promise.all([
        call(t, 'delete', `/admin/categories/${y}`, { cookie: admin.cookie }),
        call(t, 'patch', `/admin/products/${p}`, { cookie: admin.cookie, body: { version, category_id: y } }),
      ]);
      if (mv.status === 200) { expect([del.status, del.body.reasons]).toEqual([409, ['has_products']]); outcomes.add('move-won'); }
      else { expect([del.status, mv.status]).toEqual([204, 400]); outcomes.add('delete-won'); }
      expect(await count(t, 'products p', 'NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id)')).toBe(0);
    }
    expect(outcomes.size).toBeGreaterThan(0);
  }, 120_000);
});
