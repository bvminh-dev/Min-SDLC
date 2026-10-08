import { q, seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { auditCount, call, createInvApp, deliver, eventsOf, idem, invertedPair, movementsOf, newId, reservationsOf, reserve, seedReservation, seedStock, stockOf, type InvApp } from '../support/inv';
import { seedProduct } from '../support/prd';

// Vòng đời reservation theo event (INV-REQ-20261006-101122562, ...685): chốt, nhả, hoàn về, thu tiền trễ, tạo và khóa bản ghi kho theo ProductActivated, ProductArchived.
describe('INV vòng đời reservation theo event', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.logs.clear(); t.clock.advance(61_000); });
  const logs = (level: string, msg: string) => t.logs.records.filter((r) => r.level === level && String(r.msg).includes(msg));
  const stateOf = async (order: string) => (await reservationsOf(t, order)).map((r) => r.status);
  const typesOf = async (order: string) => (await eventsOf(t)).filter((e) => e.aggregate_id === order).map((e) => e.type);
  const staffCookie = async () => (await seedSession(t, (await seedUser(t, { email: `s${Math.random()}@shop.vn`, role: 'staff' })).id)).cookie;

  it('INV-TC-20261006-101123353: PaymentSucceeded chốt đơn online và OrderConfirmed chốt đơn COD: reservation committed, on_hand và reserved trừ, một dòng sale, StockCommitted một lần (không reservation_id)', async () => {
    const { product: a, item: ia } = await seedStock(t, { on_hand: 10, reserved: 2 }), { product: b, item: ib } = await seedStock(t, { on_hand: 20, reserved: 3 });
    const [U, V] = [newId(), newId()];
    await seedReservation(t, ia, U, 2); await seedReservation(t, ib, V, 3, 'held', null);
    await deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: newId() });
    await deliver(t, 'OrderConfirmed', { order_id: V });
    expect([await stateOf(U), await stateOf(V)]).toEqual([['committed'], ['committed']]);
    expect(await stockOf(t, a)).toMatchObject({ on_hand: 8, reserved: 0, version: 2 });
    expect(await stockOf(t, b)).toMatchObject({ on_hand: 17, reserved: 0 });
    expect(await movementsOf(t, a)).toEqual([{ type: 'sale', quantity: -2, on_hand_after: 8, reason: null, note: null, actor_id: null, actor_name: null, ref_type: 'order', ref_id: U }]);
    expect((await movementsOf(t, b))[0]).toMatchObject({ type: 'sale', quantity: -3, on_hand_after: 17, ref_id: V });
    const ev = (await eventsOf(t, 'StockCommitted')).map((e) => [e.aggregate_id, e.payload]);
    expect(ev).toEqual([[U, { order_id: U }], [V, { order_id: V }]]);
  });

  it('INV-TC-20261006-101123375: thu tiền trễ (expired, released) và đơn không có reservation: không chốt, log late_payment hoặc error, audit system, StockCommitFailed đúng lý do; OrderCancelled không có reservation chỉ có log; giao lại cùng event_id không phát thêm', async () => {
    const { product: a, item: ia } = await seedStock(t, { on_hand: 10 }), { product: b, item: ib } = await seedStock(t, { on_hand: 10 });
    const [U, R, Z, Y, P, P9] = [newId(), newId(), newId(), newId(), newId(), newId()];
    await seedReservation(t, ia, U, 2, 'expired', new Date(Date.now() - 60_000)); await seedReservation(t, ib, R, 1, 'released');
    const eU = newId(), eY = newId();
    await deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: P }, eU);
    await deliver(t, 'PaymentSucceeded', { order_id: R, payment_id: newId() });
    await deliver(t, 'OrderCancelled', { order_id: Z, reason: 'admin', was_paid: false });
    await deliver(t, 'PaymentSucceeded', { order_id: Y, payment_id: P9 }, eY);
    expect([await stateOf(U), await stateOf(R)]).toEqual([['expired'], ['released']]);
    expect([await stockOf(t, a), await stockOf(t, b)]).toMatchObject([{ on_hand: 10, reserved: 0 }, { on_hand: 10, reserved: 0 }]); // không chốt muộn dù còn tồn
    const failed = (await eventsOf(t, 'StockCommitFailed')).map((e) => [e.aggregate_id, e.payload.reason]);
    expect(failed).toEqual([[U, 'reservation_expired'], [R, 'reservation_released'], [Y, 'reservation_missing']]);
    expect(await eventsOf(t, 'StockCommitted')).toHaveLength(0);
    expect(await eventsOf(t, 'StockReleased')).toHaveLength(0); // Z: không có StockReleased
    expect(logs('warn', 'late_payment')[0]).toMatchObject({ order_id: U, payment_id: P });
    expect(logs('error', 'không có reservation')[0]).toMatchObject({ order_id: Y, payment_id: P9 });
    expect(logs('info', 'OrderCancelled bỏ qua')[0]).toMatchObject({ order_id: Z });
    const audits = await q<{ actor_role: string; target_id: string }>(t, `SELECT actor_role, target_id FROM audit_logs WHERE action = 'inventory.late_payment' ORDER BY target_id`);
    expect(audits.map((x) => x.actor_role)).toEqual(['system', 'system', 'system']);
    // giao lại cùng event_id: ProcessedEvent chặn, không phát thêm
    await deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: P }, eU); await deliver(t, 'PaymentSucceeded', { order_id: Y, payment_id: P9 }, eY);
    expect(await eventsOf(t, 'StockCommitFailed')).toHaveLength(3);
    // event_id khác cho đơn không có reservation: chấp nhận phát thêm một StockCommitFailed (PAY idempotent theo giao dịch cổng, ghi ở PAY)
    await deliver(t, 'PaymentSucceeded', { order_id: Y, payment_id: P9 });
    expect(await eventsOf(t, 'StockCommitFailed')).toHaveLength(4);
  });

  it('INV-TC-20261006-101123398: cùng PaymentSucceeded giao hai lần (cùng và khác event_id) song song chỉ trừ kho một lần; PaymentSucceeded của đơn COD đã chốt là no-op', async () => {
    const { product: a, item: ia } = await seedStock(t, { on_hand: 10, reserved: 2 }), { product: b, item: ib } = await seedStock(t, { on_hand: 20, reserved: 3 });
    const [U, V] = [newId(), newId()];
    await seedReservation(t, ia, U, 2); await seedReservation(t, ib, V, 3, 'held', null);
    const e0 = newId();
    await deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: newId() }, e0);
    await deliver(t, 'OrderConfirmed', { order_id: V });
    await Promise.all([deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: newId() }, e0), deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: newId() }), deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: newId() })]);
    await deliver(t, 'PaymentSucceeded', { order_id: V, payment_id: newId() }); // PAY thu COD lúc giao
    expect((await stockOf(t, a)).on_hand).toBe(8);
    expect((await movementsOf(t, a)).filter((m) => m.type === 'sale')).toHaveLength(1);
    expect([(await stockOf(t, b)).on_hand, (await movementsOf(t, b)).length]).toEqual([17, 1]);
    expect((await typesOf(U)).filter((x) => x === 'StockCommitted')).toHaveLength(1);
    expect(await eventsOf(t, 'StockCommitFailed')).toHaveLength(0);
  });

  it('INV-TC-20261006-101123421: hủy đơn đã trừ kho hoàn on_hand (restock, StockReleased một lần), hủy đơn đang giữ trả reserved; ShipmentReturned restockable giao hai lần chỉ hoàn một lần', async () => {
    const { product: a, item: ia } = await seedStock(t, { on_hand: 8 }), { product: b, item: ib } = await seedStock(t, { on_hand: 5 }), { product: h, item: ih } = await seedStock(t, { on_hand: 9, reserved: 3 });
    const [U, W, H, S1] = [newId(), newId(), newId(), newId()];
    await seedReservation(t, ia, U, 2, 'committed'); await seedReservation(t, ib, W, 2, 'committed'); await seedReservation(t, ih, H, 3);
    const eC = newId();
    await deliver(t, 'OrderCancelled', { order_id: U, reason: 'admin', was_paid: true }, eC);
    await deliver(t, 'OrderCancelled', { order_id: U, reason: 'admin', was_paid: true }); // event_id khác: điều kiện status trong câu UPDATE chặn
    expect(await stateOf(U)).toEqual(['released']);
    expect(await stockOf(t, a)).toMatchObject({ on_hand: 10 });
    expect(await movementsOf(t, a)).toEqual([expect.objectContaining({ type: 'restock', quantity: 2, on_hand_after: 10, ref_type: 'order', ref_id: U })]);
    expect((await eventsOf(t, 'StockReleased')).filter((e) => e.aggregate_id === U).map((e) => e.payload)).toEqual([{ order_id: U, reason: 'order_cancelled' }]);
    await deliver(t, 'OrderCancelled', { order_id: H, reason: 'customer_request', was_paid: false });
    expect([await stateOf(H), (await stockOf(t, h)).reserved, (await stockOf(t, h)).on_hand, (await movementsOf(t, h)).length]).toEqual([['released'], 0, 9, 0]); // giữ rồi nhả không ghi lịch sử
    await deliver(t, 'ShipmentReturned', { shipment_id: S1, order_id: W, restockable: true });
    await deliver(t, 'ShipmentReturned', { shipment_id: S1, order_id: W, restockable: true });
    expect((await stockOf(t, b)).on_hand).toBe(7);
    expect((await movementsOf(t, b)).filter((m) => m.type === 'return')).toEqual([expect.objectContaining({ quantity: 2, on_hand_after: 7, ref_type: 'shipment', ref_id: S1 })]);
    expect(await stateOf(W)).toEqual(['committed']);
  });

  it('INV-TC-20261006-121043995: ShipmentReturned với restockable = false không đổi tồn: không movement, log return_not_restockable, một audit system; nhận lại cùng event không thêm log hay audit; payload sai hình dạng bị bỏ qua', async () => {
    const { product: a, item: ia } = await seedStock(t, { on_hand: 8 });
    const [W, S2, e] = [newId(), newId(), newId()];
    await seedReservation(t, ia, W, 2, 'committed');
    await deliver(t, 'ShipmentReturned', { shipment_id: S2, order_id: W, restockable: false }, e);
    await deliver(t, 'ShipmentReturned', { shipment_id: S2, order_id: W, restockable: false }, e);
    expect(await stockOf(t, a)).toMatchObject({ on_hand: 8, version: 1 });
    expect(await movementsOf(t, a)).toHaveLength(0);
    expect(logs('info', 'return_not_restockable')).toHaveLength(1);
    expect(await auditCount(t, 'inventory.return_not_restockable')).toBe(1);
    expect(await stateOf(W)).toEqual(['committed']);
    await deliver(t, 'ShipmentReturned', { shipment_id: S2, order_id: W, restockable: 'yes' }); // không đoán
    await deliver(t, 'ShipmentReturned', { shipment_id: 'x', order_id: W, restockable: true });
    expect((await stockOf(t, a)).on_hand).toBe(8);
    expect(logs('warn', 'bỏ qua event của kho')).toHaveLength(2);
  });

  it('INV-TC-20261006-101123443: job hết hạn, OrderCancelled, PaymentSucceeded của cùng một đơn hai dòng và một giao dịch giữ hàng thứ tự ngược chạy song song (50 lần): một trạng thái cuối, reserved giảm đúng một lần, không bế tắc', async () => {
    const { a, b } = await invertedPair(t, { on_hand: 1000 }); // thứ tự khóa theo id ngược với product_id và thứ tự chèn: đường khóa nào không sắp theo id sẽ bế tắc
    const deadlocks = async () => Number((await q<{ d: bigint }>(t, `SELECT deadlocks AS d FROM pg_stat_database WHERE datname = current_database()`))[0].d);
    const before = await deadlocks();
    for (let i = 0; i < 50; i++) {
      await t.prisma.$executeRaw`DELETE FROM stock_reservations`; await t.prisma.$executeRaw`DELETE FROM outbox_events`;
      await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 1000, reserved = 2`;
      const [U, T] = [newId(), newId()];
      await seedReservation(t, a.item, U, 2, 'held', new Date(Date.now() - 1000)); await seedReservation(t, b.item, U, 2, 'held', new Date(Date.now() - 1000));
      const res = await Promise.all([
        t.jobs.expireOnce(), deliver(t, 'OrderCancelled', { order_id: U, reason: 'admin', was_paid: false }), deliver(t, 'PaymentSucceeded', { order_id: U, payment_id: newId() }),
        reserve(t, T, [{ product_id: b.product, quantity: 1 }, { product_id: a.product, quantity: 1 }]),
      ]);
      expect((res[3] as { ok: boolean }).ok).toBe(true);
      const states = [...new Set(await stateOf(U))];
      expect(states).toHaveLength(1); // cả hai dòng của đơn cùng một kết cục
      expect(['committed', 'expired', 'released']).toContain(states[0]);
      const kinds = (await typesOf(U)).filter((x) => x !== 'StockReserved').sort().join('+');
      // kết cục hợp lệ (K-02; INV-DB mục 3 cho phép đơn đã chốt bị hủy thì nhả `committed -> released`): đúng MỘT bên thắng reservation `held`
      expect(['StockCommitted', 'StockReservationExpired', 'StockReleased', 'StockCommitFailed+StockReleased', 'StockCommitFailed+StockReservationExpired', 'StockCommitted+StockReleased']).toContain(kinds);
      for (const x of [a, b]) {
        const s = await stockOf(t, x.product);
        expect(s.reserved).toBe(1); // giữ của T còn, giữ của U đã giảm đúng 2 một lần (không âm, không hai lần)
        expect(s.on_hand).toBe(states[0] === 'committed' ? 998 : 1000);
      }
    }
    expect(await deadlocks()).toBe(before); // không lần nào bế tắc (40P01)
  }, 180_000);

  it('INV-TC-20261006-101123443: thứ tự khóa theo stock_items.id tăng dần (xác định): giao dịch giữ dòng id nhỏ rồi xin dòng id lớn không bế tắc với chốt, job hết hạn và giữ hàng', async () => {
    const { a, b } = await invertedPair(t, { on_hand: 1000 }); // a: id lớn, product_id nhỏ; b: id nhỏ, product_id lớn
    const deadlocks = async () => Number((await q<{ d: bigint }>(t, `SELECT deadlocks AS d FROM pg_stat_database WHERE datname = current_database()`))[0].d);
    const waiting = async () => Number((await q<{ n: number }>(t, 'SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted'))[0].n) > 0;
    // Đường đang thử giữ chân giao dịch phụ ở dòng id nhỏ rồi chờ nó; giao dịch phụ xin tiếp dòng id lớn. Đường khóa đúng (id tăng dần) chờ ở dòng id nhỏ mà chưa giữ gì nên không bế tắc;
    // đường khóa sai thứ tự đã giữ dòng id lớn nên hai bên chờ nhau: CSDL báo bế tắc (đếm ở pg_stat_database).
    const clash = async (run: () => Promise<unknown>): Promise<number> => {
      const before = await deadlocks();
      let pending: Promise<unknown> = Promise.resolve(), side: unknown;
      await t.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM stock_items WHERE id = ${b.item}::uuid FOR UPDATE`;
        pending = run();
        for (let i = 0; i < 100 && !(await waiting()); i++) await new Promise((r) => setTimeout(r, 50));
        await tx.$queryRaw`SELECT id FROM stock_items WHERE id = ${a.item}::uuid FOR UPDATE`;
      }, { timeout: 20_000 }).catch((e) => { side = e; }); // nạn nhân của bế tắc có thể là chính giao dịch phụ
      await pending; // nạn nhân là đường đang thử thì lỗi 40P01 ném ra ở đây
      // nạn nhân là giao dịch phụ thì bộ đếm của pg_stat_database có thể chưa cập nhật (CSDL gộp thống kê chậm tới khoảng 1 giây, lúc máy tải nặng bộ đếm vẫn 0 và đột biến lọt): kiểm cả lỗi của giao dịch phụ
      expect(String((side as Error | undefined)?.message ?? '')).not.toMatch(/deadlock|40P01/i);
      return (await deadlocks()) - before;
    };
    const held = async (order: string) => { await t.prisma.$executeRaw`UPDATE stock_items SET reserved = reserved + 2`; await seedReservation(t, a.item, order, 2, 'held', new Date(Date.now() - 1000)); await seedReservation(t, b.item, order, 2, 'held', new Date(Date.now() - 1000)); };
    const U1 = newId(); await held(U1);
    expect(await clash(() => deliver(t, 'PaymentSucceeded', { order_id: U1, payment_id: newId() }))).toBe(0);
    expect(await stateOf(U1)).toEqual(['committed', 'committed']);
    const U2 = newId(); await held(U2);
    expect(await clash(() => t.jobs.expireOnce())).toBe(0);
    expect(await stateOf(U2)).toEqual(['expired', 'expired']);
    const T = newId();
    expect(await clash(() => reserve(t, T, [{ product_id: a.product, quantity: 1 }, { product_id: b.product, quantity: 1 }]))).toBe(0);
    expect(await stateOf(T)).toEqual(['held', 'held']);
    const U3 = newId(); await held(U3);
    expect(await clash(() => deliver(t, 'OrderCancelled', { order_id: U3, reason: 'admin', was_paid: false }))).toBe(0);
    expect(await stateOf(U3)).toEqual(['released', 'released']);
  }, 120_000);

  it('INV-TC-20261006-101123813: ProductActivated tạo bản ghi kho mặc định (on_hand 0, ngưỡng 5, đã cảnh báo, version 1), chi tiết trả available 0, không LowStockDetected', async () => {
    t.cat = '';
    const cat = await (await import('../support/prd')).seedCategory(t, 'Áo'), p1 = await seedProduct(t as never, { category: cat });
    await deliver(t, 'ProductActivated', { product_id: p1 });
    expect(await stockOf(t, p1)).toEqual({ on_hand: 0, reserved: 0, version: 1, low_stock_threshold: 5, low_stock_notified: true, archived_at: null });
    expect(await q(t, `SELECT 1 FROM stock_items WHERE product_id = '${p1}'`)).toHaveLength(1);
    const r = await call(t, 'get', `/admin/inventory/${p1}`, { cookie: await staffCookie() });
    expect([r.status, r.body.available, r.body.on_hand]).toEqual([200, 0, 0]);
    expect(await eventsOf(t, 'LowStockDetected')).toHaveLength(0);
  });

  it('INV-TC-20261006-101123835: nhận lại ProductActivated không đổi bản ghi đã có; id không có trong PRD bị khóa ngoại từ chối, không tạo dòng, log warn, event khác vẫn xử lý tiếp', async () => {
    const { product: p1 } = await seedStock(t, { on_hand: 12, version: 3 });
    const Z = newId();
    await deliver(t, 'ProductActivated', { product_id: p1 });
    await deliver(t, 'ProductActivated', { product_id: Z });
    expect(await stockOf(t, p1)).toMatchObject({ on_hand: 12, version: 3 });
    expect(await q(t, `SELECT 1 FROM stock_items WHERE product_id = '${Z}'`)).toHaveLength(0);
    expect(logs('warn', 'bỏ qua event của kho')).toHaveLength(1);
    const cat = await (await import('../support/prd')).seedCategory(t, 'Quần'), p2 = await seedProduct(t as never, { category: cat });
    await deliver(t, 'ProductActivated', { product_id: p2 }); // xử lý tiếp bình thường sau ca lỗi
    expect(await stockOf(t, p2)).toMatchObject({ on_hand: 0 });
  });

  it('INV-TC-20261006-101123858: ProductArchived chặn nhập kho (409) và giữ hàng (unavailable) nhưng vẫn xuất, chốt PaymentSucceeded và hoàn', async () => {
    const { product: p1, item } = await seedStock(t, { on_hand: 12, reserved: 2 }), cookie = await staffCookie();
    const O = newId();
    await seedReservation(t, item, O, 2);
    await deliver(t, 'ProductArchived', { product_id: p1 });
    expect((await stockOf(t, p1)).archived_at).not.toBeNull();
    const call2 = (kind: string, body: unknown) => call(t, 'post', `/admin/inventory/${p1}/${kind}`, { cookie, body }).set('Idempotency-Key', idem());
    const inn = await call2('stock-in', { quantity: 5, reason: 'purchase' });
    expect([inn.status, inn.body.type]).toEqual([409, 'urn:ecom:error:product-archived']);
    expect((await call2('stock-out', { quantity: 10, reason: 'damaged' })).body.item.on_hand).toBe(2);
    await deliver(t, 'PaymentSucceeded', { order_id: O, payment_id: newId() });
    expect([await stateOf(O), await stockOf(t, p1)]).toEqual([['committed'], expect.objectContaining({ on_hand: 0, reserved: 0 })]);
    expect(await reserve(t, newId(), [{ product_id: p1, quantity: 1 }])).toMatchObject({ ok: false, shortages: [{ reason: 'unavailable' }] });
    expect(await eventsOf(t, 'LowStockDetected')).toHaveLength(0); // ngừng bán thì hết cảnh báo tồn thấp
  });
});
