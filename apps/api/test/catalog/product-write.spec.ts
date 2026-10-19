import { truncateAll } from '../support/db';
import { auditOf, call, count, createPrdApp, outbox, productRow, seedCategory, seedProduct, who, type PrdApp, type Who } from '../support/prd';
import { q } from '../support/auth';

describe('PRD tạo và sửa sản phẩm (PRD-REQ-20261006-095502550, ...571)', () => {
  let t: PrdApp;
  let admin: Who, staff: Who, customer: Who, cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset();
    [admin, staff, customer] = [await who(t, 'admin'), await who(t, 'staff'), await who(t, 'customer')];
    cat = await seedCategory(t, 'Áo');
  });
  const create = (body: unknown, cookie: string | null = admin.cookie) => call(t, 'post', '/admin/products', { cookie: cookie ?? undefined, body });
  const patch = (id: string, body: unknown, cookie: string | null = admin.cookie) => call(t, 'patch', `/admin/products/${id}`, { cookie: cookie ?? undefined, body });
  const valid = (over: object = {}) => ({ name: 'Áo thun cotton', sku: 'at-001', category_id: cat, price: 150000, ...over });

  it('PRD-TC-20261006-100355524: admin tạo sản phẩm nháp (draft, sku chữ hoa, version 1, chưa ảnh); không hiện ở khu vực công khai; có audit, không có outbox', async () => {
    const r = await create(valid());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Áo thun cotton', sku: 'AT-001', category_id: cat, price: 150000, status: 'draft', version: 1, images: [] });
    expect((await call(t, 'get', `/products/${r.body.id}`)).status).toBe(404);
    expect((await call(t, 'get', '/products')).body.items).toEqual([]);
    expect(await count(t, 'audit_logs', "action = 'catalog.product.create'")).toBe(1);
    const [a] = await auditOf(t, 'catalog.product.create');
    expect([a.actor_id, a.actor_role, a.after.price, a.after.status]).toEqual([admin.id, 'admin', 150000, 'draft']);
    expect(await outbox(t)).toHaveLength(0);
    expect((await q<{ search_text: string }>(t, `SELECT search_text FROM products WHERE id = '${r.body.id}'`))[0].search_text).toBe('ao thun cotton at-001'); // chuẩn hóa cho tìm kiếm (ADR-019)
  });

  it('PRD-TC-20261006-100355547: tạo bị từ chối: trùng sku (409), dữ liệu sai (400 liệt kê trường), sai quyền (403, 401); số sản phẩm không đổi', async () => {
    await seedProduct(t, { category: cat, sku: 'AT-001' });
    const dup = await create(valid());
    expect([dup.status, dup.body.type]).toEqual([409, 'urn:ecom:error:product-sku-taken']);
    for (const [label, body, field] of [
      ['price 0', valid({ sku: 'x-1', price: 0 }), 'price'], ['price -5', valid({ sku: 'x-2', price: -5 }), 'price'], ['price 1000.5', valid({ sku: 'x-3', price: 1000.5 }), 'price'],
      ['price chuỗi', valid({ sku: 'x-4', price: 'abc' }), 'price'], ['thiếu name', { sku: 'x-5', category_id: cat, price: 1 }, 'name'], ['status active', valid({ sku: 'x-6', status: 'active' }), 'status'],
      ['category không phải uuid', valid({ sku: 'x-7', category_id: 'abc' }), 'category_id'], ['sku quá ngắn', valid({ sku: 'ab' }), 'sku'], ['sku có ký tự lạ', valid({ sku: 'a b c' }), 'sku'],
      ['description 5001', valid({ sku: 'x-8', description: 'd'.repeat(5001) }), 'description'], ['version', valid({ sku: 'x-9', version: 5 }), 'version'],
    ] as const) {
      const r = await create(body);
      expect([label, r.status]).toEqual([label, 400]);
      expect([label, r.body.errors.map((e: any) => e.field)]).toEqual([label, [field]]);
    }
    const noCat = await create(valid({ sku: 'x-10', category_id: '11111111-1111-4111-8111-111111111111' }));
    expect([noCat.status, noCat.body.errors]).toEqual([400, [{ field: 'category_id', code: 'not_found' }]]);
    expect([(await create(valid({ sku: 'zz-1' }), staff.cookie)).status, (await create(valid({ sku: 'zz-2' }), customer.cookie)).status, (await create(valid({ sku: 'zz-3' }), null)).status]).toEqual([403, 403, 401]);
    expect(await count(t, 'products')).toBe(1);
  });

  it('PRD-TC-20261006-100355569: giá biên 1 và 1.000.000.000 thành công, 1.000.000.001 bị 400; tên chứa mã script lưu nguyên; hai yêu cầu cùng sku song song: một 201, một 409', async () => {
    expect((await create(valid({ sku: 'p-1', price: 1 }))).status).toBe(201);
    expect((await create(valid({ sku: 'p-2', price: 1000000000 }))).status).toBe(201);
    expect((await create(valid({ sku: 'p-3', price: 1000000001 }))).status).toBe(400);
    const xss = await create(valid({ sku: 'p-4', name: '<script>alert(1)</script>' }));
    expect([xss.status, xss.body.name]).toEqual([201, '<script>alert(1)</script>']); // lưu nguyên; giao diện escape (E2E PRD-TC-20261006-100355569 tầng DOM)
    expect((await call(t, 'get', `/admin/products/${xss.body.id}`, { cookie: admin.cookie })).body.name).toBe('<script>alert(1)</script>');
    for (let i = 0; i < 10; i++) {
      const [a, b] = await Promise.all([create(valid({ sku: `AT-R${i}` })), create(valid({ sku: `at-r${i}` }), (await who(t, 'admin', `a${i}@shop.vn`)).cookie)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    }
  });

  it('PRD-TC-20261007-104008808 (SB-11): nửa cặp thay thế lẻ (JSON "\\ud800") ở tên, mô tả, danh mục bị 400 validation-failed ở biên (nền, app-setup.ts), không còn 500; cặp hợp lệ (emoji) vẫn nhận; tên và mô tả có ký tự điều khiển bị 400 (mô tả cho xuống dòng, tab)', async () => {
    const lone = String.fromCharCode(0xd800);
    for (const body of [valid({ sku: 'l-1', name: `a${lone}b` }), valid({ sku: 'l-2', description: `x${lone}` })]) {
      const r = await create(body);
      expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']);
    }
    const ok = await create(valid({ sku: 'l-3', name: 'Áo 😀' }));
    expect([ok.status, ok.body.name]).toEqual([201, 'Áo 😀']);
    expect((await patch(ok.body.id, { version: 1, name: `z${lone}` })).status).toBe(400);
    expect((await call(t, 'post', '/admin/categories', { cookie: admin.cookie, body: { name: `c${lone}` } })).status).toBe(400);
    expect(await count(t, 'products')).toBe(1);
    for (const [label, body] of [['tên có NUL', valid({ sku: 'l-4', name: 'a\u0000b' })], ['tên có xuống dòng', valid({ sku: 'l-5', name: 'a\nb' })], ['mô tả có BEL', valid({ sku: 'l-6', description: 'x\u0007' })]] as const) {
      const r = await create(body);
      expect([label, r.status, r.body.type]).toEqual([label, 400, 'urn:ecom:error:validation-failed']);
    }
    expect((await create(valid({ sku: 'l-7', description: 'dòng 1\n\tdòng 2' }))).status).toBe(201);
    expect(await count(t, 'products')).toBe(2);
  });

  it('PRD-TC-20261006-100355592: admin sửa giá sản phẩm đang bán: 200, version tăng, giá mới hiện ngay ở khu vực công khai, audit ghi giá cũ và mới', async () => {
    const id = await seedProduct(t, { category: cat, price: 150000, version: 3, images: 1 });
    const r = await patch(id, { version: 3, price: 120000 });
    expect(r.status).toBe(200);
    expect([r.body.price, r.body.version]).toEqual([120000, 4]);
    expect((await call(t, 'get', `/products/${id}`)).body.price).toBe(120000);
    const [a] = await auditOf(t, 'catalog.product.update');
    expect([a.actor_id, a.before, a.after]).toEqual([admin.id, { price: 150000 }, { price: 120000 }]);
    expect(await count(t, 'audit_logs', "action = 'catalog.product.update'")).toBe(1);
  });

  it('PRD-TC-20261006-100355615: sửa bị từ chối: sai version (giữ thay đổi của admin A), archived, đổi sku khi active, trường cấm; không đổi gì ngoài lần thành công', async () => {
    const a = await seedProduct(t, { category: cat, sku: 'AT-001', version: 3, images: 1 }), b = await seedProduct(t, { category: cat, status: 'archived', version: 3 });
    expect((await patch(a, { version: 3, price: 1 })).status).toBe(200);
    const stale = await patch(a, { version: 3, name: 'x' });
    expect([stale.status, stale.body.type]).toEqual([409, 'urn:ecom:error:product-version-conflict']);
    const arch = await patch(b, { version: 3, name: 'x' });
    expect([arch.status, arch.body.type]).toEqual([409, 'urn:ecom:error:product-archived']);
    const sku = await patch(a, { version: 4, sku: 'AT-999' });
    expect([sku.status, sku.body.type]).toEqual([409, 'urn:ecom:error:product-sku-locked']);
    for (const body of [{ version: 4, status: 'archived' }, { version: 4, rating_count: 99 }, { version: 4, price: -1 }, { version: 4, images: [] }, { version: 4, published_at: '2020-01-01' }, { version: 'x', price: 5 }, { price: 5 }, { version: 4 }, {}]) {
      expect([JSON.stringify(body), (await patch(a, body)).status]).toEqual([JSON.stringify(body), 400]);
    }
    expect((await patch('abc', { version: 1, price: 5 })).status).toBe(404);
    expect((await patch('11111111-1111-4111-8111-111111111111', { version: 1, price: 5 })).status).toBe(404);
    expect((await patch(a, { version: 4, price: 5 }, staff.cookie)).status).toBe(403);
    expect(await productRow(t, a)).toMatchObject({ price: 1, version: 4, name: expect.any(String) });
    expect((await q<{ name: string }>(t, `SELECT name FROM products WHERE id = '${a}'`))[0].name).not.toBe('x');
    expect((await productRow(t, b)).version).toBe(3);
    expect(await count(t, 'audit_logs', "action = 'catalog.product.update'")).toBe(1);
    // đổi sku bằng đúng giá trị hiện có khi đang bán không phải là đổi sku
    expect((await patch(a, { version: 4, sku: 'at-001', price: 7 })).status).toBe(200);
  });

  it('PRD-TC-20261006-100355642: sửa sku và danh mục ở bản nháp thành công (version 3); body chỉ có version bị 400 và version không tăng; công bố xong xuất hiện đúng danh mục mới', async () => {
    const other = await seedCategory(t, 'Quần');
    const id = await seedProduct(t, { category: cat, status: 'draft', sku: 'AT-001', images: 1 });
    expect((await patch(id, { version: 1, sku: 'AT-003' })).status).toBe(200);
    const r = await patch(id, { version: 2, category_id: other });
    expect([r.status, r.body.version, r.body.sku, r.body.category_id]).toEqual([200, 3, 'AT-003', other]);
    expect((await patch(id, { version: 3 })).status).toBe(400);
    expect((await productRow(t, id)).version).toBe(3);
    expect((await patch(id, { version: 3, category_id: '11111111-1111-4111-8111-111111111111' })).status).toBe(400);
    expect((await call(t, 'post', `/admin/products/${id}/publish`, { cookie: admin.cookie })).status).toBe(200);
    expect((await call(t, 'get', `/products?category_id=${other}`)).body.items.map((x: any) => x.id)).toEqual([id]);
    expect((await call(t, 'get', `/products?category_id=${cat}`)).body.items).toEqual([]);
    // mô tả: xóa bằng null hoặc chuỗi rỗng
    const d = await seedProduct(t, { category: cat, status: 'draft', description: 'cũ' });
    expect((await patch(d, { version: 1, description: '' })).body.description).toBeNull();
  });
  // PRD-API đầu tài liệu (đợt 2026-10-15): nhóm ghi quản trị là bậc D. Chưa có TC riêng ở tests/ (xem report.md, Lệch spec): test này mang tên mô tả, không ID TC.
  it('PRD-API nhóm ghi quản trị bậc D: 30 yêu cầu ghi mỗi phút mỗi người chung một bộ đếm cho danh mục và sản phẩm, yêu cầu thứ 31 là 429 kèm Retry-After; đọc quản trị và admin khác không bị ảnh hưởng', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push(i % 2 === 0 ? (await call(t, 'post', '/admin/categories', { cookie: admin.cookie, body: { name: `Nhóm ${i}` } })).status : (await create(valid({ sku: `rl-${i}` }))).status);
    expect(statuses.every((s) => s === 201)).toBe(true);
    const over = await create(valid({ sku: 'rl-over' }));
    expect([over.status, over.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect((await call(t, 'post', '/admin/categories', { cookie: admin.cookie, body: { name: 'Quá' } })).status).toBe(429); // cùng bộ đếm với sản phẩm
    expect((await call(t, 'get', '/admin/products', { cookie: admin.cookie })).status).toBe(200); // đọc quản trị đếm riêng
    expect(await count(t, 'products', "sku = 'RL-OVER'")).toBe(0);
    const other = await who(t, 'admin', 'admin2@shop.vn');
    expect((await create(valid({ sku: 'rl-other' }), other.cookie)).status).toBe(201); // bộ đếm theo từng người
    t.clock.advance(61_000); // cửa sổ mới: ghi lại được
    expect((await create(valid({ sku: 'rl-again' }))).status).toBe(201);
  });
});
