import { truncateAll } from '../support/db';
import { call, createPrdApp, seedCategory, seedProduct, type PrdApp } from '../support/prd';

describe('PRD khu vực công khai: chi tiết, duyệt, tìm kiếm (PRD-REQ-20261006-095502676, ...697, ...718)', () => {
  let t: PrdApp;
  let cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); cat = await seedCategory(t, 'Áo'); });
  const get = (path: string, ip?: string) => call(t, 'get', path, { ip });
  const names = (r: { body: any }): string[] => r.body.items.map((x: any) => x.name);

  it('PRD-TC-20261006-100355948: chi tiết sản phẩm đang bán: đủ trường, ảnh đúng thứ tự, breadcrumb, điểm; không status, version', async () => {
    const root = await seedCategory(t, 'Thời trang'), ao = await seedCategory(t, 'Áo con', root);
    const id = await seedProduct(t, { name: 'Áo thun cotton', sku: 'AT-001', category: ao, price: 150000, description: 'Mô tả', images: 3, ratingCount: 10, ratingSum: 45 });
    const r = await get(`/products/${id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id, name: 'Áo thun cotton', sku: 'AT-001', price: 150000, description: 'Mô tả', rating_avg: 4.5, rating_count: 10 });
    expect(r.body.images.map((i: any) => Object.keys(i).sort())).toEqual([['id', 'url'], ['id', 'url'], ['id', 'url']]);
    expect(r.body.images).toHaveLength(3);
    expect(r.body.category).toMatchObject({ id: ao, name: 'Áo con', path: [{ id: root, name: 'Thời trang' }] });
    expect(r.body.category.slug).toMatch(/^ao-con/);
    for (const k of ['status', 'version', 'published_at', 'rating_sum']) expect(r.body).not.toHaveProperty(k);
  });

  it('PRD-TC-20261006-100355971: draft, archived, không tồn tại và id sai định dạng cùng một 404 (chỉ trace_id khác); lỗi CSDL trả 503 không lộ chi tiết', async () => {
    const d = await seedProduct(t, { category: cat, status: 'draft' }), a = await seedProduct(t, { category: cat, status: 'archived' }), ok = await seedProduct(t, { category: cat });
    const res = await Promise.all([d, a, '11111111-1111-4111-8111-111111111111', 'abc', 'search-xyz'].map((id) => get(`/products/${id}`)));
    const strip = (b: any) => ({ ...b, trace_id: undefined });
    for (const r of res) {
      expect(r.status).toBe(404);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(strip(r.body)).toEqual(strip(res[0].body));
      expect(r.body.type).toBe('urn:ecom:error:not-found');
    }
    expect(new Set(res.map((r) => r.body.trace_id)).size).toBe(res.length);
    expect(Object.keys(res[0].body).sort()).toEqual(['detail', 'status', 'title', 'trace_id', 'type']);
    const spy = jest.spyOn(t.prisma, '$queryRaw').mockRejectedValue(Object.assign(new Error('Server has closed the connection. select * from products'), { code: 'P1017' }));
    try {
      const r = await get(`/products/${ok}`);
      expect([r.status, r.body.type, !!r.body.trace_id]).toEqual([503, 'urn:ecom:error:service-unavailable', true]);
      expect(r.text).not.toMatch(/select|products|at Object|\.ts:/i);
    } finally { spy.mockRestore(); }
  });

  it('PRD-TC-20261006-100355994: biên: chưa có đánh giá (count 0, avg null), mô tả rỗng, mô tả đúng 5000 ký tự, sản phẩm vừa archived là 404', async () => {
    const none = await seedProduct(t, { category: cat }), empty = await seedProduct(t, { category: cat, description: null }), long = await seedProduct(t, { category: cat, description: 'd'.repeat(5000) });
    const archived = await seedProduct(t, { category: cat, status: 'archived', ratingCount: 3, ratingSum: 12 });
    expect((await get(`/products/${none}`)).body).toMatchObject({ rating_count: 0, rating_avg: null });
    expect((await get(`/products/${empty}`)).body.description).toBeNull();
    expect((await get(`/products/${long}`)).body.description).toHaveLength(5000);
    expect((await get(`/products/${archived}`)).status).toBe(404);
    expect(JSON.stringify((await get('/products')).body)).not.toContain(archived);
  });

  it('PRD-TC-20261006-100356017: duyệt theo danh mục gồm danh mục con (draft không đếm), 20 mục mới công bố trước, lọc giá và sắp xếp', async () => {
    const con = await seedCategory(t, 'Áo thun', cat);
    const base = t.clock.now().getTime();
    for (let i = 0; i < 25; i++) await seedProduct(t, { category: cat, name: `P${String(i).padStart(2, '0')}`, price: 50000, publishedAt: new Date(base - i * 60_000) });
    for (let i = 0; i < 5; i++) await seedProduct(t, { category: con, name: `C${i}`, price: 50000, publishedAt: new Date(base - (100 + i) * 60_000) });
    for (let i = 0; i < 3; i++) await seedProduct(t, { category: cat, status: 'draft', name: `D${i}` });
    const r = await get(`/products?category_id=${cat}`);
    expect([r.status, r.body.items.length, r.body.total, r.body.page, r.body.limit]).toEqual([200, 20, 30, 1, 20]);
    expect(names(r)).toEqual(Array.from({ length: 20 }, (_, i) => `P${String(i).padStart(2, '0')}`)); // mới công bố trước
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['category', 'id', 'image_url', 'name', 'price', 'rating_avg', 'rating_count']); // không sku, status, tồn kho
    expect(names(await get(`/products?category_id=${cat}&page=2`))).toEqual([...Array.from({ length: 5 }, (_, i) => `P${20 + i}`), 'C0', 'C1', 'C2', 'C3', 'C4']);
    expect((await get(`/products?category_id=${con}`)).body.total).toBe(5);
    const other = await seedCategory(t, 'Quần');
    for (const [name, price] of [['Rẻ', 90000], ['Vừa', 150000], ['Mắc', 300000]] as const) await seedProduct(t, { category: other, name, price });
    const f = await get('/products?min_price=100000&max_price=300000&sort=price_asc');
    expect(names(f)).toEqual(['Vừa', 'Mắc']);
    expect(names(await get('/products?min_price=100000&max_price=300000&sort=price_desc'))).toEqual(['Mắc', 'Vừa']);
    expect((await get(`/products?category_id=11111111-1111-4111-8111-111111111111`)).body).toMatchObject({ items: [], total: 0 }); // đúng định dạng nhưng không có: rỗng, không 404
  });

  it('PRD-TC-20261006-100356041: duyệt bị từ chối (tham số sai, sort chèn SQL, tham số lạ) và quá giới hạn bậc C 120 mỗi phút mỗi IP: 429 kèm Retry-After, hết giờ chờ thì 200; X-Forwarded-For giả không được tin', async () => {
    await seedProduct(t, { category: cat });
    const bad = ['min_price=500000&max_price=100000', 'sort=rating', 'limit=101', 'limit=0', 'page=0', 'category_id=xyz', 'sort=price_asc;%20DROP%20TABLE%20products', 'min_price=-1', 'min_price=1.5', 'q=x', 'foo=bar', 'sort=relevance', 'category_id=a&category_id=b'];
    for (const qs of bad) {
      const r = await get(`/products?${qs}`);
      expect([qs, r.status, r.body.type]).toEqual([qs, 400, 'urn:ecom:error:validation-failed']);
      expect(r.body.errors.length).toBeGreaterThan(0);
    }
    expect((await t.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM products`)[0].n).toBe(1n); // bảng còn nguyên
    const strict = await createPrdApp({ env: { TRUST_PROXY_HOPS: '0' } }); // không tin X-Forwarded-For của nguồn không phải proxy cấu hình
    try {
      const hit = (xff?: string) => call(strict, 'get', '/products', { ip: xff });
      const codes: number[] = [];
      for (let i = 0; i < 130; i++) codes.push((await hit(i % 2 ? `10.1.${i}.1` : undefined)).status); // đổi X-Forwarded-For liên tục
      expect(codes.slice(0, 120).every((c) => c === 200)).toBe(true);
      expect(codes.slice(120).every((c) => c === 429)).toBe(true);
      const limited = await hit('203.0.113.9');
      expect([limited.status, limited.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
      const wait = Number(limited.headers['retry-after']);
      expect(wait).toBeGreaterThan(0);
      strict.clock.advance(wait * 1000 + 1000);
      expect((await hit()).status).toBe(200); // hết thời gian chờ
    } finally { await strict.close(); }
  }, 120_000);

  it('PRD-TC-20261006-100356064: trang quá cuối trả items rỗng; sắp xếp ổn định khi bằng giá (mỗi sản phẩm đúng một lần qua các trang); min bằng max', async () => {
    for (let i = 0; i < 20; i++) await seedProduct(t, { category: cat, name: `S${i}`, price: i < 2 ? 150000 : 10000 + i });
    const p2 = await get('/products?page=2&limit=20');
    expect([p2.status, p2.body.items, p2.body.total]).toEqual([200, [], 20]);
    const seen: string[][] = [];
    for (let run = 0; run < 2; run++) {
      const ids: string[] = [];
      for (let p = 1; p <= 20; p++) ids.push(...(await get(`/products?sort=price_asc&limit=1&page=${p}`)).body.items.map((x: any) => x.id));
      seen.push(ids);
    }
    expect(new Set(seen[0]).size).toBe(20); // không trùng, không sót
    expect(seen[1]).toEqual(seen[0]); // thứ tự hai sản phẩm bằng giá lặp lại giống nhau
    expect(names(await get('/products?min_price=150000&max_price=150000')).sort()).toEqual(['S0', 'S1']);
  });

  it('PRD-TC-20261006-100356089: tìm theo tên không dấu và theo sku (không phân biệt hoa thường)', async () => {
    await seedProduct(t, { category: cat, name: 'Áo thun cotton', sku: 'AT-001' }); await seedProduct(t, { category: cat, name: 'Quần jean', sku: 'QJ-010' });
    const a = await get('/products/search?q=ao%20thun');
    expect([a.status, names(a), a.body.total]).toEqual([200, ['Áo thun cotton'], 1]);
    expect(names(await get('/products/search?q=qj-010'))).toEqual(['Quần jean']);
    expect(names(await get('/products/search?q=ÁO%20THUN'))).toEqual(['Áo thun cotton']);
    expect(names(await get('/products/search?q=thun%20cotton'))).toEqual(['Áo thun cotton']); // khớp con theo từ
    expect(names(await get('/products/search?q=hun'))).toEqual(['Áo thun cotton']); // khớp một phần của từ
  });

  it('PRD-TC-20261006-100356116: tìm kiếm: q rỗng, toàn khoảng trắng hoặc quá 100 ký tự bị 400; ký tự đặc biệt là chữ thường (không SQL, không lộ); không thấy draft và archived; log không ghi nguyên văn q', async () => {
    await seedProduct(t, { category: cat, name: 'Áo thun' }); await seedProduct(t, { category: cat, name: 'Áo bí mật', status: 'draft' }); await seedProduct(t, { category: cat, name: 'Áo cũ', status: 'archived' });
    for (const qs of ['q=', 'q=%20%20', `q=${'x'.repeat(101)}`, '', 'q=a&q=b', 'q=a&sort=bad']) expect([qs, (await get(`/products/search?${qs}`)).status]).toEqual([qs, 400]);
    for (const qs of ['q=%25', "q=' OR 1=1 --", 'q=_', 'q=%5C', 'q=a%00b', 'q=%25%25%25']) {
      const r = await get(`/products/search?${qs}`);
      expect([qs, r.status, r.body.items]).toEqual([qs, 200, []]); // chữ thường, không có nghĩa đặc biệt
    }
    expect(names(await get('/products/search?q=%C3%A1o'))).toEqual(['Áo thun']);
    await get('/products/search?q=zq9wxv-unlikely');
    expect(JSON.stringify(t.logs.records)).not.toContain('zq9wxv'); // SB-18: không ghi từ khóa
    expect((await get('/products/search?q=a&min_price=1&max_price=0')).status).toBe(400);
  });

  it('PRD-TC-20261006-100356141: thứ tự từ không ảnh hưởng, q dài đúng 100 ký tự nhận, đ và d như nhau, relevance đưa tên bắt đầu bằng từ khóa lên trước', async () => {
    const base = t.clock.now().getTime();
    await seedProduct(t, { category: cat, name: 'Áo thun', publishedAt: new Date(base - 3000) }); await seedProduct(t, { category: cat, name: 'Áo khoác', publishedAt: new Date(base - 2000) }); await seedProduct(t, { category: cat, name: 'Áo thun Đen', publishedAt: new Date(base - 1000) });
    await seedProduct(t, { category: cat, name: 'Mua áo', publishedAt: new Date(base) });
    expect(names(await get('/products/search?q=áo%20thun')).sort()).toEqual(['Áo thun', 'Áo thun Đen']);
    expect(names(await get('/products/search?q=thun%20áo')).sort()).toEqual(['Áo thun', 'Áo thun Đen']);
    expect(names(await get('/products/search?q=áo&sort=newest'))).toEqual(['Mua áo', 'Áo thun Đen', 'Áo khoác', 'Áo thun']);
    expect(names(await get('/products/search?q=áo'))).toEqual(['Áo thun Đen', 'Áo khoác', 'Áo thun', 'Mua áo']); // relevance: tên bắt đầu bằng "ao" trước
    const hundred = await get(`/products/search?q=${'a'.repeat(100)}`);
    expect([hundred.status, hundred.body.items]).toEqual([200, []]);
    for (const q of ['den', 'ĐEN', 'Đen', 'đen']) expect([q, names(await get(`/products/search?q=${encodeURIComponent(q)}`))]).toEqual([q, ['Áo thun Đen']]);
    const sorted = await get('/products/search?q=ao&sort=price_desc&limit=2&page=1');
    expect([sorted.body.items.length, sorted.body.total]).toEqual([2, 4]);
  });
});
