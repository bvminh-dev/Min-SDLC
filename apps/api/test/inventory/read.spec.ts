import { CatalogApi } from '../../src/modules/catalog';
import { q, seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { call, createInvApp, newId, seedStock, type InvApp } from '../support/inv';
import { seedCategory, seedProduct } from '../support/prd';

// Đọc tồn kho: danh sách, chi tiết, lịch sử (INV-REQ-20261006-101122435, ...637) và endpoint công khai (INV-REQ-20261006-120036236).
describe('INV đọc danh sách, chi tiết, lịch sử', () => {
  let t: InvApp;
  let staff: string, admin: string, customer: string;
  const cookie = async (role: 'customer' | 'staff' | 'admin') => (await seedSession(t, (await seedUser(t, { email: `${role}${Math.random()}@shop.vn`, role })).id)).cookie;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; [staff, admin, customer] = [await cookie('staff'), await cookie('admin'), await cookie('customer')]; });
  const get = (path: string, c: string | null = staff) => call(t, 'get', path, { cookie: c ?? undefined });

  it('INV-TC-20261006-101122944: staff xem trang 1 của 25 bản ghi: 20 phần tử, total 25, available = on_hand - reserved, updated_at giảm dần, có tên và sku từ PRD', async () => {
    const base = Date.now() - 3_600_000;
    let p1 = '';
    for (let i = 0; i < 25; i++) { const s = await seedStock(t, { on_hand: 50 + i, reserved: i === 3 ? 8 : 0, updatedAt: new Date(base + i * 60_000), name: `Áo số ${i}`, sku: `AO-${100 + i}` }); if (i === 3) p1 = s.product; }
    const r = await get('/admin/inventory?page=1&limit=20');
    expect([r.status, r.body.items.length, r.body.total, r.body.page, r.body.limit]).toEqual([200, 20, 25, 1, 20]);
    const stamps = r.body.items.map((x: { updated_at: string }) => Date.parse(x.updated_at));
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    expect(r.body.items[0].product).toEqual({ name: 'Áo số 24', sku: 'AO-124' });
    expect(r.body.items.every((x: { on_hand: number; reserved: number; available: number }) => x.available === x.on_hand - x.reserved)).toBe(true);
    expect((await get('/admin/inventory?limit=100')).body.items.find((x: { product_id: string }) => x.product_id === p1)).toMatchObject({ on_hand: 53, reserved: 8, available: 45 });
    const p2 = await get('/admin/inventory?page=2&limit=20');
    expect(p2.body.items).toHaveLength(5);
    expect((await get('/admin/inventory?sort=available_asc&limit=3')).body.items.map((x: { available: number }) => x.available)).toEqual([45, 50, 51]);
    const found = await get('/admin/inventory?q=so%2024'); // `q` đi qua PRD (tìm tên hoặc sku, bỏ dấu)
    expect(found.body.items.map((x: { product: { sku: string } }) => x.product.sku)).toEqual(['AO-124']);
    expect((await get('/admin/inventory?q=khong-co-san-pham-nao')).body).toMatchObject({ items: [], total: 0 });
  });

  it('INV-TC-20261007-124048486: tìm theo q khi PRD lỗi là 503 service-unavailable (không trả danh sách không lọc); không có q thì 200 với product null và số vẫn đúng', async () => {
    await seedStock(t, { on_hand: 10, reserved: 2 }); await seedStock(t, { on_hand: 4 }); await seedStock(t, { on_hand: 0 });
    const catalog = t.app.get(CatalogApi);
    const spies = [jest.spyOn(catalog, 'searchProductIds'), jest.spyOn(catalog, 'getSummaries')].map((s) => s.mockRejectedValue(new Error('PRD hỏng')));
    try {
      const r = await get('/admin/inventory?q=ao');
      expect([r.status, r.body.type, typeof r.body.trace_id, r.body.items]).toEqual([503, 'urn:ecom:error:service-unavailable', 'string', undefined]);
      expect(JSON.stringify(r.body)).not.toMatch(/on_hand|reserved|"available"/);
      const all = await get('/admin/inventory');
      expect([all.status, all.body.items.length, all.body.total]).toEqual([200, 3, 3]);
      expect(all.body.items.every((x: { product: unknown }) => x.product === null)).toBe(true);
      expect(all.body.items.map((x: { on_hand: number; reserved: number }) => [x.on_hand, x.reserved]).sort()).toEqual([[0, 0], [10, 2], [4, 0]]);
    } finally { spies.forEach((s) => s.mockRestore()); }
  });

  it('INV-TC-20261006-101122968: customer 403, khách 401 (không số liệu trong thân); limit=101, page=0, sort lạ là 400 nêu tên tham số; chi tiết sản phẩm chưa có kho và id sai định dạng cho hai thân 404 giống hệt nhau từng byte (trừ trace_id)', async () => {
    const cat = (t.cat = await seedCategory(t, 'Áo')), d1 = await seedProduct(t as never, { category: cat, status: 'draft' });
    await seedStock(t, { on_hand: 7 });
    for (const [c, status] of [[customer, 403], [null, 401]] as const) {
      const r = await get('/admin/inventory', c);
      expect([r.status, JSON.stringify(r.body)]).toEqual([status, expect.not.stringMatching(/on_hand|available|reserved/)]);
    }
    for (const [qs, field] of [['limit=101', 'limit'], ['page=0', 'page'], ['sort=price_asc', 'sort'], ['lạ=1', 'lạ']]) {
      const r = await get(`/admin/inventory?${qs}`);
      expect([qs, r.status, r.body.errors.map((e: { field: string }) => e.field)]).toEqual([qs, 400, [field]]);
    }
    const [a, b] = [await get(`/admin/inventory/${d1}`), await get('/admin/inventory/khong-phai-uuid')];
    expect([a.status, b.status]).toEqual([404, 404]);
    const strip = ({ trace_id: _t, ...rest }: Record<string, unknown>) => JSON.stringify(rest);
    expect(strip(a.body)).toBe(strip(b.body));
    expect(a.body.trace_id).not.toBe(b.body.trace_id);
    expect(a.headers['content-type']).toContain('application/problem+json');
    expect((await get(`/admin/inventory/${newId()}`)).body.detail).toBe(a.body.detail); // sản phẩm không tồn tại cũng cùng một 404
  });

  it('INV-TC-20261006-101122994: tồn bằng đang giữ cho available 0 (không âm), trang quá cuối trả 200 rỗng, lọc archived', async () => {
    const A = await seedStock(t, { on_hand: 10, reserved: 10 }), Q = await seedStock(t, { on_hand: 12, archived: true });
    for (let i = 0; i < 23; i++) await seedStock(t, { on_hand: 1 });
    expect((await get(`/admin/inventory/${A.product}`)).body).toMatchObject({ available: 0, on_hand: 10, reserved: 10, is_low_stock: true, archived: false });
    expect(await q(t, 'SELECT 1 FROM stock_items')).toHaveLength(25);
    const p3 = await get('/admin/inventory?page=3&limit=20');
    expect([p3.status, p3.body.items, p3.body.total]).toEqual([200, [], 25]);
    expect((await get('/admin/inventory?page=2&limit=20')).body.items).toHaveLength(5);
    const yes = (await get('/admin/inventory?archived=true')).body.items;
    expect(yes).toHaveLength(1);
    expect(yes[0]).toMatchObject({ product_id: Q.product, archived: true, on_hand: 12 });
    const no = (await get('/admin/inventory?archived=false&limit=100')).body.items;
    expect(no.some((x: { product_id: string }) => x.product_id === Q.product)).toBe(false);
    expect(no.some((x: { product_id: string }) => x.product_id === A.product)).toBe(true);
  });

  it('INV-TC-20261006-121043533: bậc D chặn lần thứ 31 trong một phút (429 kèm Retry-After, problem+json, không số liệu), sang phút sau gọi lại được, người khác không bị chặn; danh sách, chi tiết, tồn thấp, lịch sử chung một bộ đếm', async () => {
    const { product } = await seedStock(t, { on_hand: 9 });
    for (let i = 1; i <= 30; i++) expect([i, (await get('/admin/inventory')).status]).toEqual([i, 200]);
    const over = await get('/admin/inventory');
    expect([over.status, over.body.type, over.headers['content-type']]).toEqual([429, 'urn:ecom:error:rate-limited', expect.stringContaining('application/problem+json')]);
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(over.body)).not.toMatch(/on_hand|available/);
    for (const p of [`/admin/inventory/${product}`, '/admin/inventory/low-stock', `/admin/inventory/${product}/movements`]) expect([p, (await get(p)).status]).toEqual([p, 429]);
    expect((await get('/admin/inventory', admin)).status).toBe(200); // người dùng khác đếm riêng
    t.clock.advance(61_000);
    expect((await get('/admin/inventory')).status).toBe(200);
  });

  it('INV-TC-20261006-101123631: lịch sử năm dòng mới nhất trước, on_hand_after nhất quán, actor.name là bản chụp lúc ghi (null với dòng cũ chưa có tên, system với dòng hệ thống), không lộ khóa idempotency', async () => {
    const staffUser = await seedUser(t, { email: 'an@shop.vn', role: 'staff', name: 'An Nguyễn' }); // đã đổi tên sau khi ghi dòng cũ
    const { product, item } = await seedStock(t, { on_hand: 27 }), [order, ship] = [newId(), newId()];
    const rows: [string, number, number, string | null, string | null][] = [['in', 40, 40, null, null], ['out', -10, 30, 'Nguyễn Văn An', 'damaged'], ['adjust', -3, 27, 'Nguyễn Văn An', null], ['sale', -2, 25, null, null], ['return', 2, 27, null, null]];
    for (const [i, [type, quantity, after, name, reason]] of rows.entries()) {
      const human = type === 'in' || type === 'out' || type === 'adjust';
      await t.prisma.$executeRaw`
        INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, reason, actor_id, actor_name, ref_type, ref_id, created_at)
        VALUES (${item}::uuid, ${type}::movement_type, ${quantity}, ${after}, ${reason}, ${human ? staffUser.id : null}::uuid, ${name}, ${type === 'sale' ? 'order' : type === 'return' ? 'shipment' : null}::movement_ref,
                ${type === 'sale' ? order : type === 'return' ? ship : null}::uuid, now() - make_interval(mins => ${10 - i}::int))`;
    }
    const r = await get(`/admin/inventory/${product}/movements?page=1&limit=20`);
    expect([r.status, r.body.total, r.body.items.map((x: { type: string }) => x.type)]).toEqual([200, 5, ['return', 'sale', 'adjust', 'out', 'in']]);
    const [ret, sale, adj, out, inn] = r.body.items;
    expect(ret.on_hand_after).toBe(27);
    expect([out.actor, adj.actor]).toEqual([{ id: staffUser.id, name: 'Nguyễn Văn An' }, { id: staffUser.id, name: 'Nguyễn Văn An' }]); // không phải tên mới "An Nguyễn"
    expect(inn.actor).toEqual({ id: staffUser.id, name: null }); // dòng cũ chưa có tên: giao diện hiện id rút gọn
    expect([sale.actor, sale.ref]).toEqual([{ id: null, name: 'system' }, { type: 'order', id: order }]);
    expect(ret.ref).toEqual({ type: 'shipment', id: ship });
    for (let i = 0; i < 4; i++) expect(r.body.items[i].on_hand_after).toBe(r.body.items[i + 1].on_hand_after + r.body.items[i].quantity);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['actor', 'created_at', 'id', 'note', 'on_hand_after', 'quantity', 'reason', 'ref', 'type']);
    expect(JSON.stringify(r.body)).not.toMatch(/idempotency|request_hash|response/);
  });

  it('INV-TC-20261006-101123657: lọc lịch sử sai (type lạ, from sau to, from không phải ISO) là 400; sản phẩm chưa có kho 404; customer 403; khách 401; không có dữ liệu lịch sử trong phản hồi lỗi', async () => {
    const { product } = await seedStock(t, { on_hand: 1 }), cat = await seedCategory(t, 'Quần'), d1 = await seedProduct(t as never, { category: cat, status: 'draft' });
    for (const qs of ['type=refund', 'from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z', 'from=hôm-qua', 'from=2026-02-30', 'type=']) expect([qs, (await get(`/admin/inventory/${product}/movements?${qs}`)).status]).toEqual([qs, 400]);
    expect((await get(`/admin/inventory/${d1}/movements`)).status).toBe(404);
    expect((await get(`/admin/inventory/${product}/movements`, customer)).status).toBe(403);
    const guest = await get(`/admin/inventory/${product}/movements`, null);
    expect([guest.status, JSON.stringify(guest.body)]).toEqual([401, expect.not.stringMatching(/on_hand_after|items/)]);
  });

  it('INV-TC-20261006-101123679: from tính cả mốc, to không tính; trang quá cuối trả 200 rỗng; khoảng 400 ngày là 400', async () => {
    const { product, item } = await seedStock(t, { on_hand: 5 });
    // fixed-clock: created_at của dòng lịch sử đặt cứng 2026-10-01T00:00:00Z để thử biên from/to; mọi truy vấn truyền mốc tuyệt đối, không phụ thuộc đồng hồ
    for (let i = 0; i < 5; i++) await t.prisma.$executeRaw`INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, created_at) VALUES (${item}::uuid, 'in'::movement_type, 1, ${i + 1}, ${i === 0 ? '2026-10-01T00:00:00Z' : `2026-08-0${i}T00:00:00Z`}::timestamptz)`;
    const inRange = await get(`/admin/inventory/${product}/movements?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`);
    expect(inRange.body.items.map((x: { on_hand_after: number }) => x.on_hand_after)).toEqual([1]);
    expect((await get(`/admin/inventory/${product}/movements?from=2026-09-30T00:00:00Z&to=2026-10-01T00:00:00Z`)).body.items).toEqual([]);
    expect((await get(`/admin/inventory/${product}/movements?from=2026-10-01&to=2026-10-02`)).body.items).toHaveLength(1); // ngày không giờ là 00:00 UTC
    const p2 = await get(`/admin/inventory/${product}/movements?page=2&limit=20`);
    expect([p2.status, p2.body.items, p2.body.total]).toEqual([200, [], 5]);
    expect((await get(`/admin/inventory/${product}/movements?type=in,out&limit=2`)).body.items).toHaveLength(2);
    expect((await get(`/admin/inventory/${product}/movements?from=2025-01-01T00:00:00Z&to=2026-02-05T00:00:00Z`)).status).toBe(400); // 400 ngày
    expect((await get(`/admin/inventory/${product}/movements?from=2026-01-01T00:00:00Z&to=2027-01-02T00:00:00Z`)).status).toBe(200); // đúng 366 ngày
  });

  it('INV-TC-20261006-101123702: không sửa, không xóa được dòng lịch sử kể cả bằng SQL của vai trò ứng dụng; PUT, PATCH, DELETE trên đường dẫn movements không đổi dữ liệu', async () => {
    const { product, item } = await seedStock(t, { on_hand: 5 });
    const [m] = await t.prisma.$queryRaw<{ id: string }[]>`INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after) VALUES (${item}::uuid, 'in'::movement_type, 5, 5) RETURNING id`;
    const { Client } = await import('pg');
    const { roleDbUrl } = await import('../support/db');
    const app = new Client({ connectionString: roleDbUrl('ecom_app') }); await app.connect();
    try {
      await expect(app.query('UPDATE stock_movements SET quantity = 99 WHERE id = $1', [m.id])).rejects.toThrow(/permission denied/); // vai trò ứng dụng không có quyền (lớp trước trigger)
      await expect(app.query('DELETE FROM stock_movements WHERE id = $1', [m.id])).rejects.toThrow(/permission denied/);
      await expect(app.query('TRUNCATE stock_movements')).rejects.toThrow(/permission denied/);
    } finally { await app.end(); }
    // chủ bảng (superuser) cũng bị trigger chặn
    await expect(t.prisma.$executeRaw`UPDATE stock_movements SET quantity = 99 WHERE id = ${m.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(t.prisma.$executeRaw`DELETE FROM stock_movements WHERE id = ${m.id}::uuid`).rejects.toThrow(/append-only/);
    expect(await q(t, `SELECT quantity FROM stock_movements WHERE id = '${m.id}'`)).toEqual([{ quantity: 5 }]);
    for (const method of ['put', 'patch', 'delete'] as const) {
      const r = await call(t, method, `/admin/inventory/${product}/movements`, { cookie: admin, body: method === 'delete' ? undefined : { quantity: 1 } });
      expect([method, [404, 405].includes(r.status)]).toEqual([method, true]);
    }
    expect(await q(t, `SELECT quantity FROM stock_movements WHERE id = '${m.id}'`)).toEqual([{ quantity: 5 }]);
  });

  it('INV-TC-20261015-094057637: sale 403 ở danh sách và chi tiết tồn kho (không on_hand, reserved, available trong thân); staff vẫn 200', async () => {
    t.cat = await seedCategory(t, 'Áo');
    const { product } = await seedStock(t, { on_hand: 50, reserved: 2 });
    const sale = (await seedSession(t, (await seedUser(t, { email: `sale${Math.random()}@shop.vn`, role: 'sale' })).id)).cookie;
    for (const path of ['/admin/inventory', `/admin/inventory/${product}`]) {
      const r = await get(path, sale);
      expect([path, r.status, JSON.stringify(r.body)]).toEqual([path, 403, expect.not.stringMatching(/on_hand|available|reserved/)]);
      expect([path, (await get(path)).status]).toEqual([path, 200]);
    }
  });
});
