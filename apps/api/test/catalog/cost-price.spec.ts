import { truncateAll } from '../support/db';
import { auditOf, call, count, createPrdApp, outbox, productRow, seedCategory, seedImage, seedProduct, who, type PrdApp, type Who } from '../support/prd';

// Giá vốn `cost_price` (SB-42, đợt bán hàng hộ 2026-10-15): chỉ admin ghi và đọc; mọi phản hồi khác và giao diện nội bộ của PRD không có khóa này.
describe('PRD giá vốn cost_price (PRD-REQ-20261006-095502550, ...571, ...613, ...655, ...676; SB-42)', () => {
  let t: PrdApp;
  let admin: Who, staff: Who, sale: Who, customer: Who, cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset();
    [admin, staff, sale, customer] = [await who(t, 'admin'), await who(t, 'staff'), await who(t, 'sale'), await who(t, 'customer')];
    cat = await seedCategory(t, 'Áo');
  });
  const create = (body: unknown, cookie: string | null = admin.cookie) => call(t, 'post', '/admin/products', { cookie: cookie ?? undefined, body });
  const patch = (id: string, body: unknown, cookie: string | null = admin.cookie) => call(t, 'patch', `/admin/products/${id}`, { cookie: cookie ?? undefined, body });
  const list = (cookie: string | null, qs = '') => call(t, 'get', `/admin/products${qs}`, { cookie: cookie ?? undefined });
  const detail = (id: string, cookie: string | null) => call(t, 'get', `/admin/products/${id}`, { cookie: cookie ?? undefined });
  const valid = (over: object = {}) => ({ name: 'Áo thun cotton', sku: 'at-010', category_id: cat, price: 150000, ...over });

  it('PRD-TC-20261015-093100000: admin tạo sản phẩm có giá vốn, đọc lại ở chi tiết quản trị; audit tạo có giá vốn; không có event', async () => {
    const r = await create(valid({ cost_price: 90000 }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ sku: 'AT-010', price: 150000, cost_price: 90000, status: 'draft' });
    expect((await detail(r.body.id, admin.cookie)).body.cost_price).toBe(90000);
    const [a] = await auditOf(t, 'catalog.product.create');
    expect(a.after.cost_price).toBe(90000);
    expect(await outbox(t)).toHaveLength(0);
  });

  it('PRD-TC-20261015-093100013: giá vốn không hợp lệ khi tạo (âm, thập phân, chữ, quá trần) bị 400 nêu cost_price; không tạo sản phẩm', async () => {
    for (const bad of [-1, 1.5, 'abc', 1000000001, null]) {
      const r = await create(valid({ sku: 'bad-1', cost_price: bad }));
      expect([String(bad), r.status, r.body.type]).toEqual([String(bad), 400, 'urn:ecom:error:validation-failed']);
      expect(r.body.errors.map((e: any) => e.field)).toEqual(['cost_price']);
    }
    expect(await count(t, 'products')).toBe(0);
  });

  it('PRD-TC-20261015-093100026: staff, sale, customer 403 và khách chưa đăng nhập 401 khi tạo sản phẩm kèm giá vốn; không tạo gì', async () => {
    for (const [cookie, want] of [[staff.cookie, 403], [sale.cookie, 403], [customer.cookie, 403], [null, 401]] as const) {
      expect([want, (await create(valid({ cost_price: 90000 }), cookie)).status]).toEqual([want, want]);
    }
    expect(await count(t, 'products')).toBe(0);
  });

  it('PRD-TC-20261015-093100039: giá vốn 0, bằng trần, lớn hơn giá bán và bỏ trống đều được nhận', async () => {
    const a = await create(valid({ sku: 'c-0', cost_price: 0 })), b = await create(valid({ sku: 'c-max', price: 1000, cost_price: 1000000000 })), c = await create(valid({ sku: 'c-none' }));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect([a.body.cost_price, b.body.cost_price, c.body.cost_price]).toEqual([0, 1000000000, null]);
  });

  it('PRD-TC-20261015-093100052: admin sửa riêng giá vốn của sản phẩm đang bán: version +1, giá bán giữ, audit có giá vốn cũ và mới', async () => {
    // YẾU: cost_snapshot của đơn cũ thuộc ORD (cột order_items.cost_snapshot do epic ORD dựng song song); ở đây chỉ kiểm phía PRD: sửa giá vốn không đụng bảng nào khác ngoài products và audit.
    const id = await seedProduct(t, { category: cat, price: 150000, costPrice: 90000, version: 4 });
    const r = await patch(id, { version: 4, cost_price: 95000 });
    expect([r.status, r.body.cost_price, r.body.price, r.body.version]).toEqual([200, 95000, 150000, 5]);
    const [a] = await auditOf(t, 'catalog.product.update');
    expect([a.before, a.after]).toEqual([{ cost_price: 90000 }, { cost_price: 95000 }]);
  });

  it('PRD-TC-20261015-093100065: giá vốn không hợp lệ khi sửa bị 400 nêu cost_price; giá vốn và version giữ nguyên', async () => {
    const id = await seedProduct(t, { category: cat, costPrice: 90000, version: 4 });
    for (const bad of [-1, 1.5, 'abc', 1000000001]) {
      const r = await patch(id, { version: 4, cost_price: bad });
      expect([String(bad), r.status, r.body.errors.map((e: any) => e.field)]).toEqual([String(bad), 400, ['cost_price']]);
    }
    expect(await productRow(t, id)).toMatchObject({ cost_price: 90000, version: 4 });
  });

  it('PRD-TC-20261015-093100078: staff và sale gửi sửa giá vốn bị 403 trước mọi kiểm khác; không đổi, không audit', async () => {
    const id = await seedProduct(t, { category: cat, costPrice: 90000, version: 4 });
    for (const who2 of [staff, sale]) expect((await patch(id, { version: 4, cost_price: 1 }, who2.cookie)).status).toBe(403);
    expect(await productRow(t, id)).toMatchObject({ cost_price: 90000, version: 4 });
    expect(await count(t, 'audit_logs', "action = 'catalog.product.update'")).toBe(0);
  });

  it('PRD-TC-20261015-093100091: sửa giá vốn của sản phẩm đã lưu trữ bị 409 product-archived; giá vốn và version giữ nguyên', async () => {
    const id = await seedProduct(t, { category: cat, status: 'archived', costPrice: 90000, version: 3 });
    const r = await patch(id, { version: 3, cost_price: 100000 });
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:product-archived']);
    expect(await productRow(t, id)).toMatchObject({ cost_price: 90000, version: 3 });
  });

  it('PRD-TC-20261015-093100104: xóa giá vốn bằng null rồi đặt về 0; mỗi lần một audit có giá trị trước và sau', async () => {
    const id = await seedProduct(t, { category: cat, costPrice: 90000, version: 5 });
    const a = await patch(id, { version: 5, cost_price: null });
    expect([a.status, a.body.cost_price, a.body.version]).toEqual([200, null, 6]);
    t.clock.advance(1000); // audit sắp theo created_at: đồng hồ giả đứng yên thì hai dòng cùng mốc
    const b = await patch(id, { version: 6, cost_price: 0 });
    expect([b.status, b.body.cost_price, b.body.version]).toEqual([200, 0, 7]);
    expect((await auditOf(t, 'catalog.product.update')).map((x) => [x.before, x.after])).toEqual([[{ cost_price: 90000 }, { cost_price: null }], [{ cost_price: null }, { cost_price: 0 }]]);
  });

  it('PRD-TC-20261015-093100117: admin thấy giá vốn ở danh sách và chi tiết quản trị (null khi chưa có)', async () => {
    const a = await seedProduct(t, { category: cat, sku: 'AT-001', price: 150000, costPrice: 90000 }), b = await seedProduct(t, { category: cat, sku: 'AT-002' });
    const l = await list(admin.cookie);
    expect(l.status).toBe(200);
    const by = Object.fromEntries(l.body.items.map((x: any) => [x.sku, x]));
    expect([by['AT-001'].cost_price, by['AT-001'].price, by['AT-002'].cost_price]).toEqual([90000, 150000, null]);
    expect([(await detail(a, admin.cookie)).body.cost_price, (await detail(b, admin.cookie)).body.cost_price]).toEqual([90000, null]);
  });

  // SB-42: kiểm bằng so tập khóa và bằng hasOwnProperty, không chỉ giá trị rỗng
  const noCost = (res: { status: number; text: string; body: any }, items: boolean) => {
    expect(res.status).toBe(200);
    for (const x of items ? res.body.items : [res.body]) { expect(Object.prototype.hasOwnProperty.call(x, 'cost_price')).toBe(false); expect(x).toHaveProperty('price'); }
    expect(res.text).not.toContain('90000');
    expect(res.text).not.toContain('cost');
  };

  it('PRD-TC-20261015-093100130: staff không nhận khóa cost_price ở danh sách và chi tiết, kể cả sản phẩm chưa có giá vốn', async () => {
    const a = await seedProduct(t, { category: cat, sku: 'AT-001', costPrice: 90000 }), b = await seedProduct(t, { category: cat, sku: 'AT-002' });
    noCost(await list(staff.cookie), true);
    noCost(await detail(a, staff.cookie), false);
    noCost(await detail(b, staff.cookie), false);
  });

  it('PRD-TC-20261015-093100143: sale xem được sản phẩm quản trị (200) nhưng không nhận khóa cost_price', async () => {
    const a = await seedProduct(t, { category: cat, sku: 'AT-001', costPrice: 90000 });
    noCost(await list(sale.cookie), true);
    noCost(await detail(a, sale.cookie), false);
    expect((await list(null)).status).toBe(401);
    expect((await list(customer.cookie)).status).toBe(403);
  });

  it('PRD-TC-20261015-093100156: staff và sale dò giá vốn qua tham số lọc hoặc sắp xếp bị 400 (tham số lạ)', async () => {
    await seedProduct(t, { category: cat, costPrice: 90000 });
    for (const who2 of [staff, sale, admin]) for (const qs of ['?cost_price=90000', '?sort=cost_price', '?min_cost_price=1']) expect([qs, (await list(who2.cookie, qs)).status]).toEqual([qs, 400]);
  });

  it('PRD-TC-20261015-093100169: sản phẩm draft chưa có ảnh (như sản phẩm do import tạo) không công bố được: 422 thiếu images, vẫn draft, không event', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft', price: 150000, costPrice: 90000, images: 0 });
    const r = await call(t, 'post', `/admin/products/${id}/publish`, { cookie: admin.cookie });
    expect([r.status, r.body.type, r.body.missing]).toEqual([422, 'urn:ecom:error:product-not-publishable', ['images']]);
    expect((await productRow(t, id)).status).toBe('draft');
    expect(await outbox(t, 'ProductActivated')).toHaveLength(0);
  });

  it('PRD-TC-20261015-093100182: chưa có giá vốn vẫn công bố được; ProductActivated chỉ mang product_id (không giá bán, không giá vốn)', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft', costPrice: null });
    await seedImage(t, id, 1);
    const r = await call(t, 'post', `/admin/products/${id}/publish`, { cookie: admin.cookie });
    expect([r.status, r.body.status]).toEqual([200, 'active']);
    const ev = await outbox(t, 'ProductActivated');
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0].payload)).toEqual(['product_id']);
    expect(JSON.stringify(ev[0].payload)).not.toContain('cost');
  });

  it('PRD-TC-20261015-093100195: chi tiết công khai không có khóa giá vốn ở mọi role, kể cả admin; thân phản hồi không có chuỗi cost hay 90000', async () => {
    const id = await seedProduct(t, { category: cat, price: 150000, costPrice: 90000 });
    for (const [label, cookie] of [['guest', null], ['customer', customer.cookie], ['staff', staff.cookie], ['sale', sale.cookie], ['admin', admin.cookie]] as const) {
      const r = await call(t, 'get', `/products/${id}`, { cookie: cookie ?? undefined });
      expect([label, r.status, r.body.price]).toEqual([label, 200, 150000]);
      expect([label, Object.prototype.hasOwnProperty.call(r.body, 'cost_price'), r.text.includes('cost'), r.text.includes('90000')]).toEqual([label, false, false, false]);
    }
  });

  it('PRD-TC-20261015-093100208: danh sách theo danh mục và tìm kiếm công khai không có khóa giá vốn (khách và admin)', async () => {
    await seedProduct(t, { category: cat, name: 'Áo thun', price: 150000, costPrice: 90000 });
    for (const cookie of [null, admin.cookie]) {
      for (const path of [`/products?category_id=${cat}`, '/products/search?q=thun']) {
        const r = await call(t, 'get', path, { cookie: cookie ?? undefined });
        expect([path, r.status, r.body.items.length]).toEqual([path, 200, 1]);
        expect(r.body.items.some((x: any) => 'cost_price' in x)).toBe(false);
        expect(r.text).not.toContain('90000');
      }
    }
  });

  it('PRD-TC-20261015-093100221: getForCart và getSummaries không trả giá vốn: tập khóa đúng bằng tập khai', async () => {
    const id = await seedProduct(t, { category: cat, price: 150000, costPrice: 90000, images: 1 });
    for (const x of await t.catalog.getForCart([id])) expect(Object.keys(x).sort()).toEqual(['image_url', 'name', 'price', 'product_id', 'sellable', 'sku']);
    for (const x of await t.catalog.getSummaries([id])) expect(Object.keys(x).sort()).toEqual(['image_url', 'name', 'product_id', 'sku', 'status']);
    expect(JSON.stringify([await t.catalog.getForCart([id]), await t.catalog.getSummaries([id])])).not.toContain('90000');
  });
});
