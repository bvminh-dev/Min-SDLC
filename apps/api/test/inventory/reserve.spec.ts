import { seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { ReservationExistsError } from '../../src/modules/inventory';
import { call, createInvApp, dbNowPlus, eventsOf, newId, relay, reservationsOf, reserve, seedStock, sink, stockOf, movementsOf, type InvApp } from '../support/inv';

// Giữ hàng qua giao diện nội bộ InventoryApi.reserve (INV-REQ-20261006-101122538, ...661): PostgreSQL thật, nhiều kết nối thật chạy song song.
describe('INV giữ hàng và chống bán vượt', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.clock.advance(61_000); });
  const reset = async (...products: string[]) => {
    await t.prisma.$executeRaw`DELETE FROM stock_reservations`;
    for (const p of products) await t.prisma.$executeRaw`UPDATE stock_items SET reserved = 0 WHERE product_id = ${p}::uuid`;
    await t.prisma.$executeRaw`DELETE FROM outbox_events`;
  };

  it('INV-TC-20261006-101123263: giữ hai mặt hàng trong giao dịch của CHK: hai reservation held với expires_at đúng giá trị CHK truyền, reserved tăng, on_hand không đổi, không movement, đúng một StockReserved (không reservation_id) phát một lần; CHK quay lui thì không có event', async () => {
    const { product: a } = await seedStock(t, { on_hand: 10, reserved: 5 }), { product: b } = await seedStock(t, { on_hand: 10 });
    const X = newId(), E = await dbNowPlus(t, 900);
    const seen = sink(t, 'StockReserved');
    const r = await reserve(t, X, [{ product_id: a, quantity: 2 }, { product_id: b, quantity: 3 }], E);
    expect(r).toEqual({ ok: true, reservations: [{ product_id: a, quantity: 2, expires_at: E }, { product_id: b, quantity: 3, expires_at: E }] });
    expect((await reservationsOf(t, X)).map((x) => [x.product_id, x.quantity, x.status, x.expires_at?.getTime()]).sort()).toEqual([[a, 2, 'held', E.getTime()], [b, 3, 'held', E.getTime()]].sort());
    expect([(await stockOf(t, a)).reserved, (await stockOf(t, a)).on_hand, (await stockOf(t, b)).reserved]).toEqual([7, 10, 3]);
    expect((await movementsOf(t, a)).length + (await movementsOf(t, b)).length).toBe(0);
    const ev = await eventsOf(t, 'StockReserved');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ order_id: X, items: expect.arrayContaining([{ product_id: a, quantity: 2 }, { product_id: b, quantity: 3 }]), expires_at: E.toISOString() });
    expect(ev[0].payload.items).toHaveLength(2);
    expect(JSON.stringify(ev[0].payload)).not.toContain('reservation_id');
    await relay(t); expect(seen.map((e) => e.aggregate_id)).toEqual([X]); // giao đúng một lần dù relay chạy hai lượt
    // CHK quay lui sau khi reserve: không reservation, không reserved, không event
    const Y = newId();
    await expect(t.tx.run(async (tx) => { await t.inv.reserve(Y, [{ product_id: b, quantity: 1 }], E, tx); throw new Error('CHK hỏng sau khi giữ hàng'); })).rejects.toThrow('CHK hỏng');
    expect([(await reservationsOf(t, Y)).length, (await stockOf(t, b)).reserved, (await eventsOf(t, 'StockReserved')).length]).toEqual([0, 3, 1]);
  });

  it('INV-TC-20261006-101123286: một mặt hàng thiếu thì không giữ gì (kể cả khi CHK bắt lỗi và vẫn cam kết) và nêu A requested 6 available 5; sản phẩm ngừng bán là unavailable', async () => {
    const { product: a } = await seedStock(t, { on_hand: 5 }), { product: b } = await seedStock(t, { on_hand: 10 }), { product: c } = await seedStock(t, { on_hand: 9, archived: true });
    const X = newId();
    const r = await t.tx.run((tx) => t.inv.reserve(X, [{ product_id: b, quantity: 3 }, { product_id: a, quantity: 6 }], new Date(Date.now() + 900_000), tx)); // CHK không hủy giao dịch: vẫn cam kết
    expect(r).toEqual({ ok: false, shortages: [{ product_id: a, requested: 6, available: 5, reason: 'insufficient_stock' }] });
    expect(await reservationsOf(t, X)).toHaveLength(0);
    expect([(await stockOf(t, a)).reserved, (await stockOf(t, b)).reserved]).toEqual([0, 0]);
    expect(await eventsOf(t, 'StockReserved')).toHaveLength(0);
    const r2 = await reserve(t, newId(), [{ product_id: c, quantity: 1 }]);
    expect(r2).toEqual({ ok: false, shortages: [{ product_id: c, requested: 1, available: 0, reason: 'unavailable' }] });
    const missing = newId(); // không có bản ghi kho
    expect(await reserve(t, newId(), [{ product_id: missing, quantity: 1 }])).toMatchObject({ ok: false, shortages: [{ product_id: missing, reason: 'unavailable' }] });
  });

  it('INV-TC-20261006-101123308: giữ đúng bằng available; gọi lại cùng đơn trả reservation cũ; cùng đơn khác số lượng là reservation-exists; đơn COD expires_at rỗng; món cuối cùng chạy đua 50 lần', async () => {
    const { product: a } = await seedStock(t, { on_hand: 7 }), { product: b } = await seedStock(t, { on_hand: 4 }), { product: l } = await seedStock(t, { on_hand: 1 });
    const X = newId(), Y = newId(), Z = newId(), E = await dbNowPlus(t, 900);
    await reserve(t, X, [{ product_id: a, quantity: 2 }], E);
    expect(await reserve(t, Y, [{ product_id: a, quantity: 5 }], E)).toMatchObject({ ok: true }); // đúng bằng available
    expect((await stockOf(t, a)).reserved).toBe(7);
    await reset(a);
    await reserve(t, X, [{ product_id: a, quantity: 2 }], E);
    const same = await reserve(t, X, [{ product_id: a, quantity: 2 }], E);
    expect(same).toEqual({ ok: true, reservations: [{ product_id: a, quantity: 2, expires_at: E }] });
    expect([(await stockOf(t, a)).reserved, (await eventsOf(t, 'StockReserved')).length]).toEqual([2, 1]); // không giữ thêm, không phát lại
    const err = await reserve(t, X, [{ product_id: a, quantity: 9 }], E).catch((e) => e);
    expect(err).toBeInstanceOf(ReservationExistsError);
    expect([err.code, (await stockOf(t, a)).reserved]).toEqual(['reservation-exists', 2]);
    expect(await reserve(t, Z, [{ product_id: b, quantity: 1 }], null)).toMatchObject({ ok: true });
    expect((await reservationsOf(t, Z))[0]).toMatchObject({ status: 'held', expires_at: null });
    for (let i = 0; i < 50; i++) {
      await reset(l);
      const rs = await Promise.all([reserve(t, newId(), [{ product_id: l, quantity: 1 }]), reserve(t, newId(), [{ product_id: l, quantity: 1 }])]);
      expect([i, rs.filter((r) => r.ok).length]).toEqual([i, 1]);
      expect(rs.find((r) => !r.ok)).toMatchObject({ shortages: [{ reason: 'insufficient_stock', requested: 1, available: 0 }] });
      expect((await stockOf(t, l)).reserved).toBe(1);
    }
  }, 120_000);

  it('INV-TC-20261006-101123330: đầu vào sai bị từ chối ở giao diện nội bộ (dòng trùng, 51 dòng, quantity 0 hay 100001, expires_at quá khứ) và không giữ gì; 100000 trên sản phẩm available 100000 thành công', async () => {
    const { product: a } = await seedStock(t, { on_hand: 200_000 }), { product: big } = await seedStock(t, { on_hand: 100_000 });
    const fifty = async (n: number) => Array.from({ length: n }, async () => ({ product_id: (await seedStock(t, { on_hand: 5 })).product, quantity: 1 }));
    const past = await t.prisma.$queryRaw<{ d: Date }[]>`SELECT now() - interval '1 second' AS d`;
    const cases: [string, () => Promise<unknown>][] = [
      ['trùng product_id', () => reserve(t, newId(), [{ product_id: a, quantity: 1 }, { product_id: a, quantity: 2 }])],
      ['51 dòng', async () => reserve(t, newId(), await Promise.all(await fifty(51)))],
      ['quantity 100001', () => reserve(t, newId(), [{ product_id: a, quantity: 100_001 }])],
      ['quantity 0', () => reserve(t, newId(), [{ product_id: a, quantity: 0 }])],
      ['expires_at giờ CSDL trừ 1 giây', () => reserve(t, newId(), [{ product_id: a, quantity: 1 }], past[0].d)],
    ];
    for (const [name, run] of cases) await expect([name, await run().then(() => 'ok', (e) => e.constructor.name)]).toEqual([name, 'RangeError']);
    expect(await t.prisma.$queryRaw`SELECT 1 FROM stock_reservations`).toHaveLength(0);
    expect(await reserve(t, newId(), [{ product_id: big, quantity: 100_000 }])).toMatchObject({ ok: true });
    expect((await stockOf(t, big)).on_hand - (await stockOf(t, big)).reserved).toBe(0);
  });

  it('INV-TC-20261006-101123724: mười giao dịch cùng giữ món có on_hand 1 bằng mười kết nối (30 lần): đúng 1 thành công, 9 insufficient_stock, reserved 1, một reservation held, CHECK không bị vi phạm', async () => {
    const { product: a } = await seedStock(t, { on_hand: 1 });
    for (let i = 0; i < 30; i++) {
      await reset(a);
      const rs = await Promise.all(Array.from({ length: 10 }, () => reserve(t, newId(), [{ product_id: a, quantity: 1 }])));
      expect([i, rs.filter((r) => r.ok).length]).toEqual([i, 1]);
      expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.shortages[0].reason === 'insufficient_stock')).toBe(true);
      const s = await stockOf(t, a);
      expect([s.reserved, s.on_hand - s.reserved]).toEqual([1, 0]);
      expect(await t.prisma.$queryRaw`SELECT 1 FROM stock_reservations WHERE status = 'held'`).toHaveLength(1);
      expect(await eventsOf(t, 'StockReserved')).toHaveLength(1);
    }
  }, 120_000);

  it('INV-TC-20261006-101123746: CHECK ở CSDL từ chối reserved > on_hand và on_hand âm; xuất 1 khi available 0 là 409 insufficient-stock available 0', async () => {
    const { product, item } = await seedStock(t, { on_hand: 5, reserved: 5 });
    await expect(t.prisma.$executeRaw`UPDATE stock_items SET reserved = 6 WHERE id = ${item}::uuid`).rejects.toThrow(/stock_items_reserved_le_on_hand|check constraint/);
    await expect(t.prisma.$executeRaw`UPDATE stock_items SET on_hand = -1 WHERE id = ${item}::uuid`).rejects.toThrow(/check constraint/);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 5, reserved: 5 });
    const u = await seedUser(t, { email: 's@shop.vn', role: 'staff' }), cookie = (await seedSession(t, u.id)).cookie;
    const r = await call(t, 'post', `/admin/inventory/${product}/stock-out`, { cookie, body: { quantity: 1, reason: 'lost' } }).set('Idempotency-Key', 'khoa-xuat-0001');
    expect([r.status, r.body.type, r.body.available]).toEqual([409, 'urn:ecom:error:insufficient-stock', 0]);
  });

  it('INV-TC-20261006-101123769: getAvailability cho sản phẩm có, không có bản ghi, ngừng bán; 101 id bị từ chối và không truy vấn CSDL; 100 id trả đủ', async () => {
    const { product: a } = await seedStock(t, { on_hand: 3 }), { product: c } = await seedStock(t, { on_hand: 9, archived: true }), b = newId();
    expect(await t.inv.getAvailability([a, b, c])).toEqual({ [a]: 3, [b]: 0, [c]: 0 });
    expect(await t.prisma.$queryRaw`SELECT 1 FROM stock_reservations`).toHaveLength(0);
    expect((await stockOf(t, a)).reserved).toBe(0);
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    try {
      await expect(t.inv.getAvailability(Array.from({ length: 101 }, () => newId()))).rejects.toThrow(RangeError);
      expect(spy).not.toHaveBeenCalled();
      expect(Object.keys(await t.inv.getAvailability(Array.from({ length: 100 }, () => newId())))).toHaveLength(100);
    } finally { spy.mockRestore(); }
  });
});
