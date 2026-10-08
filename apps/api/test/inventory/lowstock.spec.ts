import { CatalogApi } from '../../src/modules/catalog';
import { LowStockService } from '../../src/modules/inventory/low-stock.service';
import { q, seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { auditCount, call, createInvApp, deliver, eventsOf, idem, movementsOf, newId, reserve, seedReservation, seedStock, stockOf, type InvApp } from '../support/inv';

// Cảnh báo tồn thấp và đổi ngưỡng (INV-REQ-20261006-101122611): cờ low_stock_notified, LowStockDetected qua outbox, getLowStockSummary cho DSH.
describe('INV tồn thấp và ngưỡng', () => {
  let t: InvApp;
  let staff: string, admin: string, customer: string;
  const cookie = async (role: 'customer' | 'staff' | 'admin') => (await seedSession(t, (await seedUser(t, { email: `${role}${Math.random()}@shop.vn`, role })).id)).cookie;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.logs.clear(); t.clock.advance(61_000); [staff, admin, customer] = [await cookie('staff'), await cookie('admin'), await cookie('customer')]; });
  const patch = (product: string, body: unknown, c: string | null = staff) => call(t, 'patch', `/admin/inventory/${product}/threshold`, { cookie: c ?? undefined, body });
  const stockOut = (product: string, quantity: number, c = staff) => call(t, 'post', `/admin/inventory/${product}/stock-out`, { cookie: c, body: { quantity, reason: 'damaged' } }).set('Idempotency-Key', idem());
  const stockIn = (product: string, quantity: number) => call(t, 'post', `/admin/inventory/${product}/stock-in`, { cookie: staff, body: { quantity, reason: 'purchase' } }).set('Idempotency-Key', idem());
  const lows = async (product: string) => (await eventsOf(t, 'LowStockDetected')).filter((e) => e.aggregate_id === product);
  const listed = async () => (await call(t, 'get', '/admin/inventory/low-stock?limit=100', { cookie: staff })).body.items.map((x: { product_id: string }) => x.product_id);

  it('INV-TC-20261006-101123557: xuống tới ngưỡng phát đúng một LowStockDetected (đủ payload), đổi ngưỡng tăng version và ghi audit trước 5 sau 10, vào danh sách low-stock', async () => {
    const { product } = await seedStock(t, { on_hand: 10, reserved: 2, threshold: 5, version: 3, notified: false, name: 'Áo thun cotton' });
    expect((await stockOut(product, 4)).status).toBe(200);
    const ev = await lows(product);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ product_id: product, product_name: 'Áo thun cotton', on_hand: 6, available: 4, threshold: 5 });
    expect((await stockOf(t, product)).low_stock_notified).toBe(true);
    expect(await listed()).toContain(product);
    const r = await patch(product, { low_stock_threshold: 10, version: 4 }, admin);
    expect([r.status, r.body.low_stock_threshold, r.body.version, r.body.is_low_stock, r.body.product]).toEqual([200, 10, 5, true, expect.objectContaining({ name: 'Áo thun cotton' })]);
    expect(await lows(product)).toHaveLength(1); // đã cảnh báo rồi: nâng ngưỡng không phát lại
    const a = (await q<any>(t, `SELECT actor_role, before, after FROM audit_logs WHERE action = 'inventory.threshold'`))[0];
    expect([a.actor_role, a.before, a.after]).toEqual(['admin', { low_stock_threshold: 5 }, { low_stock_threshold: 10 }]);
  });

  it('INV-TC-20261006-101123557: PRD lỗi thì LowStockDetected vẫn phát với tên rỗng và log warn; PRD treo thì không chờ quá hạn đọc tên (SB-31, không cầm khóa chờ PRD vô hạn)', async () => {
    const { product } = await seedStock(t, { on_hand: 10, reserved: 2, threshold: 5, notified: false });
    const spy = jest.spyOn(t.app.get(CatalogApi), 'getSummaries').mockRejectedValue(new Error('PRD hỏng'));
    try {
      const r = await stockOut(product, 4);
      expect([r.status, (await lows(product)).map((e) => e.payload.product_name)]).toEqual([200, ['']]);
      expect(t.logs.records.filter((x) => x.level === 'warn' && String(x.msg).includes('không đọc được tên sản phẩm'))).toHaveLength(1);
      spy.mockImplementation(() => new Promise(() => undefined)); // PRD treo: lời gọi không bao giờ trả
      const svc = t.app.get(LowStockService) as unknown as { nameOf(id: string): Promise<string> };
      let guard: NodeJS.Timeout | undefined;
      const hung = Symbol('treo');
      const got = await Promise.race([svc.nameOf(product), new Promise((res) => { guard = setTimeout(() => res(hung), 6000); })]);
      clearTimeout(guard);
      expect(got).toBe(''); // quá hạn đọc tên (2 giây) thì rỗng, không treo theo PRD
    } finally { spy.mockRestore(); }
  }, 20_000);

  it('INV-TC-20261006-101123580: ngưỡng sai, trường lạ trong thân (on_hand, actor_id), thiếu version là 400 không đổi gì và không phát event; customer 403, khách 401', async () => {
    const { product } = await seedStock(t, { on_hand: 20, threshold: 5, version: 6 });
    const bodies: [unknown, string[]][] = [
      [{ low_stock_threshold: -1, version: 6 }, ['low_stock_threshold']], [{ low_stock_threshold: 1_000_001, version: 6 }, ['low_stock_threshold']], [{ low_stock_threshold: 'abc', version: 6 }, ['low_stock_threshold']],
      [{ low_stock_threshold: 3.5, version: 6 }, ['low_stock_threshold']], [{ low_stock_threshold: 8, version: 6, on_hand: 999 }, ['on_hand']], [{ low_stock_threshold: 8, version: 6, actor_id: 'u-khac' }, ['actor_id']], [{ low_stock_threshold: 8 }, ['version']],
    ];
    for (const [body, fields] of bodies) {
      const r = await patch(product, body);
      expect([JSON.stringify(body), r.status, r.body.errors.map((e: { field: string }) => e.field)]).toEqual([JSON.stringify(body), 400, fields]);
    }
    expect(await stockOf(t, product)).toMatchObject({ low_stock_threshold: 5, on_hand: 20, version: 6 });
    expect(await eventsOf(t, 'LowStockDetected')).toHaveLength(0);
    expect((await patch(product, { low_stock_threshold: 8, version: 6 }, customer)).status).toBe(403);
    expect((await call(t, 'get', '/admin/inventory/low-stock', {})).status).toBe(401);
  });

  it('INV-TC-20261006-101123603: ngưỡng bằng available phát đúng một lần, nhập kho đặt lại cờ không phát, xuống lần nữa phát lại; nâng ngưỡng phát ngay; sản phẩm ngừng bán không phát và không vào danh sách; bản ghi mới (on_hand 0) vào danh sách mà không phát', async () => {
    const p1 = await seedStock(t, { on_hand: 6, threshold: 5, notified: false }), p2 = await seedStock(t, { on_hand: 12, threshold: 5, notified: false });
    const p3 = await seedStock(t, { on_hand: 3, reserved: 2, archived: true, notified: false }), p4 = await seedStock(t, { on_hand: 0, threshold: 5, notified: true });
    expect((await reserve(t, newId(), [{ product_id: p1.product, quantity: 1 }])).ok).toBe(true); // available 5 = ngưỡng
    expect(await lows(p1.product)).toHaveLength(1);
    expect((await reserve(t, newId(), [{ product_id: p1.product, quantity: 1 }])).ok).toBe(true); // available 4: không phát lần hai
    expect(await lows(p1.product)).toHaveLength(1);
    await stockIn(p1.product, 10); // available 14: cờ về false, không phát
    expect([(await stockOf(t, p1.product)).low_stock_notified, (await lows(p1.product)).length]).toEqual([false, 1]);
    expect((await reserve(t, newId(), [{ product_id: p1.product, quantity: 9 }])).ok).toBe(true); // còn 5 lần nữa
    expect(await lows(p1.product)).toHaveLength(2);
    expect((await patch(p2.product, { low_stock_threshold: 20, version: 1 }, admin)).status).toBe(200); // 12 <= 20
    expect(await lows(p2.product)).toHaveLength(1);
    expect((await stockOut(p3.product, 1)).status).toBe(200); // archived: không phát
    expect(await lows(p3.product)).toHaveLength(0);
    expect(await lows(p4.product)).toHaveLength(0);
    const list = await listed();
    expect([list.includes(p3.product), list.includes(p4.product), list.includes(p2.product)]).toEqual([false, true, true]);
  });

  it('INV-TC-20261006-121044188: getLowStockSummary đếm đúng tổng (7), cắt theo limit, available tăng dần với khóa phụ product_id, bỏ sản phẩm ngừng bán, có tên và sku, không đổi dữ liệu; limit 51 là lỗi đầu vào', async () => {
    const seeded: { product: string; available: number }[] = [];
    for (const available of [5, 4, 3, 2, 1, 0, 0]) seeded.push({ ...(await seedStock(t, { on_hand: available, threshold: 5, notified: true })), available });
    await seedStock(t, { on_hand: 0, archived: true }); await seedStock(t, { on_hand: 20 });
    const zeros = seeded.filter((s) => s.available === 0).map((s) => s.product).sort();
    const s5 = await t.inv.getLowStockSummary(5);
    expect([s5.count, s5.items.map((i) => i.available)]).toEqual([7, [0, 0, 1, 2, 3]]);
    expect(s5.items.slice(0, 2).map((i) => i.product_id)).toEqual(zeros);
    expect(Object.keys(s5.items[0]).sort()).toEqual(['available', 'low_stock_threshold', 'name', 'product_id', 'sku']);
    expect(s5.items[0]).toMatchObject({ name: expect.stringMatching(/^Sản phẩm kho/), sku: expect.stringMatching(/^KHO-/), low_stock_threshold: 5 });
    const s1 = await t.inv.getLowStockSummary(1);
    expect([s1.count, s1.items.length]).toEqual([7, 1]);
    await expect(t.inv.getLowStockSummary(51)).rejects.toThrow(RangeError);
    await expect(t.inv.getLowStockSummary(0)).rejects.toThrow(RangeError);
    expect((await q(t, 'SELECT 1 FROM stock_movements')).length).toBe(0);
  });

  it('INV-TC-20261006-153000100: đổi ngưỡng sai version 409 stock-version-conflict (không đổi, không audit, không event), đúng version tăng version, gửi lại version cũ 409; ngưỡng và điều chỉnh cùng version song song: đúng một bên thắng (20 lần)', async () => {
    const { product, item } = await seedStock(t, { on_hand: 18, reserved: 6, threshold: 5, version: 7 });
    const [R1, R2] = [newId(), newId()];
    await seedReservation(t, item, R1, 2); await seedReservation(t, item, R2, 4);
    await deliver(t, 'PaymentSucceeded', { order_id: R1, payment_id: newId() }); // đơn chốt sau khi S đã tải ở version 7: on_hand 16, version 8
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 16, version: 8 });
    const one = await patch(product, { low_stock_threshold: 10, version: 7 });
    expect([one.status, one.body.type, one.body.version]).toEqual([409, 'urn:ecom:error:stock-version-conflict', 8]);
    expect([(await stockOf(t, product)).low_stock_threshold, await auditCount(t, 'inventory.threshold'), (await eventsOf(t, 'LowStockDetected')).length]).toEqual([5, 0, 0]);
    expect((await call(t, 'get', `/admin/inventory/${product}`, { cookie: staff })).body.version).toBe(8);
    const two = await patch(product, { low_stock_threshold: 10, version: 8 });
    expect([two.status, two.body.low_stock_threshold, two.body.version]).toEqual([200, 10, 9]);
    const a = (await q<any>(t, `SELECT before, after FROM audit_logs WHERE action = 'inventory.threshold'`));
    expect(a.map((x) => [x.before, x.after])).toEqual([[{ low_stock_threshold: 5 }, { low_stock_threshold: 10 }]]);
    const three = await patch(product, { low_stock_threshold: 10, version: 8 });
    expect([three.status, three.body.version, (await stockOf(t, product)).low_stock_threshold, await auditCount(t, 'inventory.threshold')]).toEqual([409, 9, 10, 1]);
    // PATCH threshold và POST adjustments cùng version, song song: đúng một bên thắng, version không giảm hay lặp
    let last = 9;
    for (let i = 0; i < 20; i++) {
      t.clock.advance(61_000);
      const v = (await stockOf(t, product)).version;
      expect(v).toBe(last);
      const [p, adj] = await Promise.all([patch(product, { low_stock_threshold: 11 + (i % 2), version: v }), call(t, 'post', `/admin/inventory/${product}/adjustments`, { cookie: staff, body: { new_on_hand: 100 + i, version: v, note: 'Kiểm kê song song' } }).set('Idempotency-Key', idem())]);
      expect([i, [p.status, adj.status].sort()]).toEqual([i, [200, 409]]);
      expect((p.status === 409 ? p : adj).body.type).toBe('urn:ecom:error:stock-version-conflict');
      last = (await stockOf(t, product)).version;
      expect(last).toBe(v + 1);
    }
  }, 120_000);

  it('INV-TC-20261006-153000100: movement của lần thử version cũ không tồn tại (không đổi tồn, không dòng lịch sử)', async () => {
    const { product } = await seedStock(t, { on_hand: 5, version: 2 });
    const r = await call(t, 'post', `/admin/inventory/${product}/adjustments`, { cookie: staff, body: { new_on_hand: 9, version: 1, note: 'Kiểm kê cũ' } }).set('Idempotency-Key', idem());
    expect([r.status, r.body.version]).toEqual([409, 2]);
    expect(await movementsOf(t, product)).toHaveLength(0);
  });
});
