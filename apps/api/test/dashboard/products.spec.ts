import { category0, createDshApp, DASH, get, people, product, reset, seedStock, withTimeout, later, type DshApp, type People } from '../support/dsh';

// DSH-REQ-20261006-105125995 (ô sản phẩm) và DSH-REQ-20261006-105126089 (tồn thấp): CatalogApi và InventoryApi thật trên PostgreSQL thật.
describe('DSH sản phẩm và tồn thấp (DSH-REQ-20261006-105125995, DSH-REQ-20261006-105126089)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const products = (cookie: string | null = p.admin.cookie, qs = '') => get(t, cookie ?? undefined, `${DASH.products}${qs}`);
  const low = (cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, DASH.lowStock);
  const bulkProducts = async (status: 'active' | 'draft' | 'archived', n: number) => {
    const cat = await category0(t);
    await t.prisma.$executeRaw`
      INSERT INTO products (category_id, name, sku, price, status, version, published_at, search_text, created_at, updated_at)
      SELECT ${cat}::uuid, 'Hàng ' || ${status} || g, upper(${status}) || '-' || g, 100000, ${status}::product_status, 1, CASE WHEN ${status} = 'draft' THEN NULL ELSE now() END, 'hang', now(), now() FROM generate_series(1, ${n}) g`;
  };

  it('DSH-TC-20261006-110330680: số sản phẩm theo ba trạng thái, ô chính là đang bán', async () => {
    await bulkProducts('active', 120); await bulkProducts('draft', 8); await bulkProducts('archived', 15);
    const r = await products();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ as_of: '2026-10-06T03:00:00Z', total: 143, by_status: { active: 120, draft: 8, archived: 15 } });
  });

  it('DSH-TC-20261006-110330708: staff và customer nhận 403, chưa đăng nhập 401 ở số sản phẩm, PRD được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.catalog, 'countByStatus');
    for (const w of [p.staff, p.customer]) expect((await products(w.cookie)).status).toBe(403);
    expect((await products(null)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110330735: tham số lạ trên endpoint không nhận tham số nhận 400, PRD được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.catalog, 'countByStatus');
    for (const [qs, field] of [['?status=active', 'status'], ['?from=2026-10-01', 'from'], ['?__proto__=1', '__proto__'], ['?constructor=1', 'constructor'], ['?a%00b=1', '(parameter)']]) {
      const r = await products(p.admin.cookie, qs);
      expect([qs, r.status, r.body.type, r.body.errors?.[0]?.field]).toEqual([qs, 400, 'urn:ecom:error:invalid-parameter', field]);
    }
    for (const path of [DASH.lowStock, DASH.recent]) {
      for (const [qs, field] of [['limit=5', 'limit'], ['from=2026-10-01', 'from'], ['to=2026-10-01', 'to']]) { const r = await get(t, p.admin.cookie, `${path}?${qs}`); expect([path, qs, r.status, r.body.errors?.[0]?.field]).toEqual([path, qs, 400, field]); }
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110330762: PRD quá hạn trả 503 nguồn PRD, số đơn vẫn 200', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.catalog, 'countByStatus').mockImplementation(() => later(1500, { draft: 0, active: 0, archived: 0 }));
    const [pr, o] = await Promise.all([products(), get(t, p.admin.cookie, DASH.orders)]);
    expect([pr.status, pr.body.source, pr.text.includes('by_status')]).toEqual([503, 'PRD', false]);
    expect(o.status).toBe(200);
  });

  it('DSH-TC-20261006-110330791: chưa có sản phẩm nào thì ba trạng thái bằng 0', async () => {
    const r = await products();
    expect(r.body).toMatchObject({ total: 0, by_status: { active: 0, draft: 0, archived: 0 } });
  });

  it('DSH-TC-20261006-110330826: công bố sản phẩm chỉ hiện sau khi hết bộ nhớ đệm 60 giây, as_of đứng yên trong hạn', async () => {
    await bulkProducts('active', 120); await bulkProducts('draft', 8);
    t.clock.set(new Date('2026-10-06T02:59:30Z')); // 09:59:30 giờ Việt Nam
    const first = await products();
    expect([first.body.by_status.active, first.body.by_status.draft, first.body.as_of]).toEqual([120, 8, '2026-10-06T02:59:30Z']);
    await t.prisma.$executeRaw`UPDATE products SET status = 'active', published_at = now() WHERE id = (SELECT id FROM products WHERE status = 'draft' LIMIT 1)`; // lúc 10:00:00
    t.clock.set(new Date('2026-10-06T03:00:20Z'));
    const mid = await products();
    expect([mid.body.by_status.active, mid.body.as_of]).toEqual([120, '2026-10-06T02:59:30Z']);
    t.clock.set(new Date('2026-10-06T03:01:00Z'));
    const last = await products();
    expect([last.body.by_status.active, last.body.by_status.draft, last.body.as_of]).toEqual([121, 7, '2026-10-06T03:01:00Z']);
  });

  it('DSH-TC-20261006-110330856: ngừng bán một sản phẩm đang bán thì active giảm 1, archived tăng 1, total giữ nguyên', async () => {
    await bulkProducts('active', 120); await bulkProducts('archived', 15); await bulkProducts('draft', 8);
    expect((await products()).body.total).toBe(143);
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = (SELECT id FROM products WHERE status = 'active' LIMIT 1)`;
    t.clock.advance(61_000);
    const r = await products();
    expect([r.body.by_status.active, r.body.by_status.archived, r.body.total]).toEqual([119, 16, 143]);
  });

  // --- tồn thấp
  const stockAt = (available: number, o: { threshold?: number; archived?: boolean } = {}) => seedStock(t as never, { on_hand: available + 2, reserved: 2, threshold: o.threshold ?? 5, archived: o.archived });
  const withId = async (available: number, id: string) => {
    const product0 = await product(t);
    await t.prisma.$executeRaw`UPDATE products SET id = ${id}::uuid WHERE id = ${product0}::uuid`;
    return seedStock(t as never, { product: id, on_hand: available + 1, reserved: 1, threshold: 5 });
  };

  it('DSH-TC-20261006-110330892: bảy sản phẩm tồn thấp, hiện năm sản phẩm sắp hết nhất, hai sản phẩm available 0 theo product_id', async () => {
    const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
    await withId(0, B); await withId(0, A); // tạo ngược thứ tự để thấy sắp theo product_id chứ không theo thứ tự tạo
    for (const n of [1, 2, 3, 4, 5]) await stockAt(n);
    await stockAt(9); // trên ngưỡng: không tính
    const r = await low();
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(7);
    expect(r.body.items).toHaveLength(5);
    expect(r.body.items.map((i: { available: number }) => i.available)).toEqual([0, 0, 1, 2, 3]);
    expect(r.body.items.slice(0, 2).map((i: { product_id: string }) => i.product_id)).toEqual([A, B]);
    for (const i of r.body.items) expect(Object.keys(i).sort()).toEqual(['available', 'low_stock_threshold', 'name', 'product_id', 'sku']);
    expect(r.body.items[0]).toMatchObject({ low_stock_threshold: 5, name: expect.stringMatching(/\S/), sku: expect.stringMatching(/\S/) });
    expect(Object.keys(r.body).sort()).toEqual(['as_of', 'count', 'items']);
  });

  it('DSH-TC-20261006-110330922: staff và customer nhận 403, chưa đăng nhập 401 ở tồn thấp, INV được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.inv, 'getLowStockSummary');
    for (const w of [p.staff, p.customer]) expect((await low(w.cookie)).status).toBe(403);
    expect((await low(null)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110330953: INV quá hạn trả 503 nguồn INV, không có count và items (không suy ra rỗng từ lỗi)', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.inv, 'getLowStockSummary').mockImplementation(() => later(1500, { count: 0, items: [] }));
    const r = await low();
    expect([r.status, r.body.source]).toEqual([503, 'INV']);
    expect(r.text).not.toMatch(/count|items/);
  });

  it('DSH-TC-20261006-110330985: bằng ngưỡng là thấp, trên ngưỡng một đơn vị thì không', async () => {
    const pIn = await stockAt(5);
    await stockAt(6);
    const r = await low();
    expect(r.body.count).toBe(1);
    expect(r.body.items.map((i: { product_id: string }) => i.product_id)).toEqual([pIn.product]);
  });

  it('DSH-TC-20261006-110331014: không có sản phẩm tồn thấp hoặc đã ngừng bán thì count 0 và items rỗng', async () => {
    await stockAt(50); await stockAt(0, { archived: true });
    const r = await low();
    expect(r.body).toMatchObject({ count: 0, items: [] });
  });

  it('DSH-TC-20261006-110331043: đúng năm sản phẩm tồn thấp hiện đủ năm dòng', async () => {
    for (const n of [0, 1, 2, 3, 4]) await stockAt(n);
    const r = await low();
    expect([r.body.count, r.body.items.length]).toEqual([5, 5]);
  });
});
