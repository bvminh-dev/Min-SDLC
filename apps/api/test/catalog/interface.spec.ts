import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { call, createPrdApp, seedCategory, seedProduct, who, type PrdApp } from '../support/prd';

// Giao diện nội bộ PRD phơi ra cho CRT, INV, REV, DSH (architecture.md, bảng Giao diện module; PRD-API mục Giao tiếp giữa module): gọi trực tiếp phương thức trong tiến trình, PostgreSQL thật.
describe('PRD giao diện nội bộ CatalogApi', () => {
  let t: PrdApp;
  let cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); cat = await seedCategory(t, 'Áo'); });
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());

  it('PRD-TC-20261007-085337117: getForCart chỉ đánh dấu sellable cho sản phẩm active; đúng 100 id vẫn nhận, 101 id bị từ chối cả lời gọi', async () => {
    const p1 = await seedProduct(t, { category: cat, price: 150000, images: 2, name: 'Áo A', sku: 'A-001' }), p2 = await seedProduct(t, { category: cat, status: 'draft' }), p3 = await seedProduct(t, { category: cat, status: 'archived' });
    const r = await t.catalog.getForCart([p1, p2, p3]);
    expect(r).toHaveLength(3);
    for (const x of r) expect(Object.keys(x).sort()).toEqual(['image_url', 'name', 'price', 'product_id', 'sellable', 'sku']); // danh sách khóa cho phép
    const by = Object.fromEntries(r.map((x) => [x.product_id, x]));
    expect([by[p1].sellable, by[p2].sellable, by[p3].sellable]).toEqual([true, false, false]);
    expect(by[p1]).toMatchObject({ name: 'Áo A', sku: 'A-001', price: 150000 });
    expect(by[p1].image_url).toMatch(/\/products\/.*\.webp$/);
    expect(by[p2].image_url).toBeNull();
    await expect(t.catalog.getForCart([...ids(100)])).resolves.toEqual([]); // đúng 100 id, đều không có: không lỗi
    await expect(t.catalog.getForCart([p1, ...ids(100)])).rejects.toThrow(RangeError); // 101 id
    expect(await t.catalog.getForCart([p1, p1, 'abc', ...ids(3)])).toHaveLength(1); // trùng, sai định dạng, không tồn tại: bỏ qua
    expect(await t.catalog.getForCart([])).toEqual([]);
    // giá đổi qua API admin thì getForCart thấy ngay (CRT đọc giá hiện hành, SB-23)
    const admin = await who(t, 'admin');
    expect((await call(t, 'patch', `/admin/products/${p1}`, { cookie: admin.cookie, body: { version: 1, price: 99000 } })).status).toBe(200);
    expect((await t.catalog.getForCart([p1]))[0].price).toBe(99000);
  });

  it('PRD-TC-20261007-085337148: getSummaries trả tên, sku, ảnh và trạng thái cho mọi trạng thái, không giá hay mô tả; quá 100 id bị từ chối', async () => {
    const p1 = await seedProduct(t, { category: cat, name: 'Áo A', sku: 'A-001', images: 1, description: 'mô tả', price: 5 }), p2 = await seedProduct(t, { category: cat, status: 'draft', name: 'Nháp', sku: 'N-001' }), p3 = await seedProduct(t, { category: cat, status: 'archived', name: 'Cũ', sku: 'C-001' });
    for (let i = 0; i < 4; i++) await seedProduct(t, { category: cat, status: i < 1 ? 'draft' : 'active' }); // đủ 2 draft, 5 active, 1 archived
    const r = await t.catalog.getSummaries([p1, p2, p3]);
    expect(r.map((x) => [x.name, x.sku, x.status]).sort()).toEqual([['Cũ', 'C-001', 'archived'], ['Nháp', 'N-001', 'draft'], ['Áo A', 'A-001', 'active']]);
    for (const x of r) expect(Object.keys(x).sort()).toEqual(['image_url', 'name', 'product_id', 'sku', 'status']);
    expect(r.find((x) => x.product_id === p1)!.image_url).toMatch(/\/products\//);
    expect(r.find((x) => x.product_id === p2)!.image_url).toBeNull();
    await expect(t.catalog.getSummaries(ids(101))).rejects.toThrow(RangeError);
    await expect(t.catalog.getSummaries(ids(100))).resolves.toEqual([]);
  });

  it('PRD-TC-20261007-085337181: searchProductIds khớp tên và sku cùng cách chuẩn hóa với tìm kiếm công khai; không vượt limit; limit ngoài 1..200 bị từ chối', async () => {
    const den = await seedProduct(t, { category: cat, name: 'Áo thun Đen', sku: 'AT-001' }), jean = await seedProduct(t, { category: cat, name: 'Quần jean', sku: 'QJ-010' });
    for (const q of ['den', 'ĐEN', 'at-001']) expect([q, await t.catalog.searchProductIds(q, 200)]).toEqual([q, [den]]);
    expect(await t.catalog.searchProductIds('áo', 1)).toHaveLength(1);
    expect(await t.catalog.searchProductIds('%', 200)).toEqual([]);
    expect(await t.catalog.searchProductIds('   ', 200)).toEqual([]);
    // cùng kết quả với tìm kiếm công khai
    const pub = (await call(t, 'get', '/products/search?q=den')).body.items.map((x: any) => x.id);
    expect(pub).toEqual(await t.catalog.searchProductIds('den', 200));
    expect(await t.catalog.searchProductIds('jean', 5)).toEqual([jean]);
    for (const bad of [0, 201, -1, 1.5]) await expect(t.catalog.searchProductIds('den', bad)).rejects.toThrow(RangeError);
    await expect(t.catalog.searchProductIds('x '.repeat(40000), 5)).rejects.toThrow(RangeError); // q dài vô hạn làm vỡ giới hạn tham số của PostgreSQL (review PRD)
    expect(await t.catalog.searchProductIds('x'.repeat(100), 5)).toEqual([]); // đúng 100 ký tự vẫn nhận
    // INV giữ kho cả sản phẩm đã ngừng bán: tìm ra mọi trạng thái
    const arch = await seedProduct(t, { category: cat, name: 'Áo cũ', status: 'archived' });
    expect(await t.catalog.searchProductIds('cũ', 10)).toEqual([arch]);
  });

  it('PRD-TC-20261007-085337214: listActiveProductIds phân trang theo id tăng dần, chỉ active, không trùng không sót; limit > 500 bị từ chối', async () => {
    const active: string[] = [];
    for (let i = 0; i < 25; i++) active.push(await seedProduct(t, { category: cat }));
    for (let i = 0; i < 3; i++) await seedProduct(t, { category: cat, status: 'draft' });
    for (let i = 0; i < 2; i++) await seedProduct(t, { category: cat, status: 'archived' });
    const pages: string[][] = [];
    let after: string | undefined;
    for (;;) {
      const p = await t.catalog.listActiveProductIds(after, 10);
      if (!p.length) break;
      pages.push(p); after = p.at(-1);
    }
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    const all = pages.flat();
    expect(new Set(all).size).toBe(25);
    expect(all.slice().sort()).toEqual(active.slice().sort());
    expect(all).toEqual([...all].sort()); // id tăng dần (thứ tự chuỗi uuid chữ thường khớp thứ tự bytea của PostgreSQL)
    await expect(t.catalog.listActiveProductIds(undefined, 501)).rejects.toThrow(RangeError);
    await expect(t.catalog.listActiveProductIds('abc', 10)).rejects.toThrow(RangeError);
    expect((await t.catalog.listActiveProductIds(undefined, 500)).length).toBe(25);
  });

  it('PRD-TC-20261007-085337251: countByStatus đếm đúng theo trạng thái kể cả khi chưa có sản phẩm; ngừng bán một sản phẩm thì đổi theo', async () => {
    expect(await t.catalog.countByStatus()).toEqual({ draft: 0, active: 0, archived: 0 });
    for (const [status, n] of [['draft', 2], ['active', 5], ['archived', 1]] as const) for (let i = 0; i < n; i++) await seedProduct(t, { category: cat, status, images: 1 });
    expect(await t.catalog.countByStatus()).toEqual({ draft: 2, active: 5, archived: 1 });
    const [{ id }] = await t.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE status = 'active' LIMIT 1`;
    const admin = await who(t, 'admin');
    expect((await call(t, 'post', `/admin/products/${id}/archive`, { cookie: admin.cookie })).status).toBe(200);
    expect(await t.catalog.countByStatus()).toEqual({ draft: 2, active: 4, archived: 2 });
    expect(Object.keys(await t.catalog.countByStatus()).sort()).toEqual(['active', 'archived', 'draft']);
  });
});
