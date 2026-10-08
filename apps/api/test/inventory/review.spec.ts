import { q, seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { JobRunner } from '../../src/modules/platform';
import { StockService } from '../../src/modules/inventory/stock.service';
import { call, createInvApp, deliver, idem, newId, reserve, seedReservation, seedStock, stockOf, type InvApp } from '../support/inv';

// Review độc lập epic INV (reviewer): bất biến sổ kho dưới tải hỗn hợp, thứ tự lịch sử, SAVEPOINT, JSON nửa cặp thay thế. PostgreSQL thật, nhiều kết nối thật.
describe('INV review: bất biến và rủi ro nhạy cảm', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.clock.advance(61_000); });
  const staff = async () => { const u = await seedUser(t, { email: `s${Math.random()}@shop.vn`, role: 'staff', name: 'Nhân viên' }); return { id: u.id, cookie: (await seedSession(t, u.id)).cookie }; };
  const session = (id: string) => ({ user_id: id, role: 'staff' as const, email_verified: true, display_name: 'Nhân viên' });

  it('REV-INV-01: tải hỗn hợp (giữ, chốt, nhả, hết hạn, nhập, xuất) trên 3 sản phẩm: reserved luôn bằng tổng held, on_hand bằng đầu cộng tổng movement, không âm, không bế tắc', async () => {
    const u = await staff();
    const items = [await seedStock(t, { on_hand: 30 }), await seedStock(t, { on_hand: 30 }), await seedStock(t, { on_hand: 30 })];
    for (const x of items) await t.prisma.$executeRaw`INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, created_at) VALUES (${x.item}::uuid, 'in'::movement_type, 30, 30, '2020-01-01T00:00:00Z'::timestamptz)`; // sổ đầu kỳ cho on_hand đã gieo
    const deadlocks = async () => Number((await q<{ d: bigint }>(t, `SELECT deadlocks AS d FROM pg_stat_database WHERE datname = current_database()`))[0].d);
    const before = await deadlocks();
    const orders: string[] = [];
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 60; i++) {
      const o = newId(); orders.push(o);
      const lines = items.map((x) => ({ product_id: x.product, quantity: 1 + (i % 3) })).sort(() => Math.random() - 0.5).slice(0, 1 + (i % 3));
      const exp = i % 4 === 0 ? new Date(Date.now() + 1500) : i % 4 === 1 ? null : new Date(Date.now() + 900_000);
      ops.push(reserve(t, o, lines, exp).catch(() => undefined));
    }
    await Promise.all(ops);
    await new Promise((r) => setTimeout(r, 1700));
    const storm: Promise<unknown>[] = [];
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (i % 5 === 0) storm.push(deliver(t, 'PaymentSucceeded', { order_id: o, payment_id: newId() }));
      if (i % 5 === 1) storm.push(deliver(t, 'OrderCancelled', { order_id: o, reason: 'admin', was_paid: false }));
      if (i % 5 === 2) storm.push(deliver(t, 'OrderConfirmed', { order_id: o }));
      if (i % 4 === 0) storm.push(t.jobs.expireOnce());
      if (i % 6 === 0) storm.push(call(t, 'post', `/admin/inventory/${items[i % 3].product}/stock-in`, { cookie: u.cookie, body: { quantity: 3, reason: 'purchase' } }).set('Idempotency-Key', idem()).then((r) => r));
      if (i % 7 === 0) storm.push(call(t, 'post', `/admin/inventory/${items[i % 3].product}/stock-out`, { cookie: u.cookie, body: { quantity: 2, reason: 'lost' } }).set('Idempotency-Key', idem()).then((r) => r));
    }
    await Promise.all(storm);
    await t.jobs.expireOnce();
    for (const x of items) {
      const [r] = await q<{ on_hand: number; reserved: number; held: number; mv: number }>(t, `
        SELECT s.on_hand, s.reserved, COALESCE((SELECT sum(quantity) FROM stock_reservations r WHERE r.stock_item_id = s.id AND r.status = 'held'), 0)::int AS held,
               COALESCE((SELECT sum(quantity) FROM stock_movements m WHERE m.stock_item_id = s.id), 0)::int AS mv FROM stock_items s WHERE s.id = '${x.item}'`);
      expect([r.reserved, r.on_hand]).toEqual([r.held, r.mv]); // mv gồm sổ đầu kỳ 30
      expect(r.on_hand).toBeGreaterThanOrEqual(r.reserved);
    }
    expect(await deadlocks()).toBe(before);
    const rec = await t.jobs.reconcileOnce();
    expect([rec.reserved_mismatch, rec.on_hand_mismatch]).toEqual([0, 0]);
  }, 120_000);

  it('INV-TC-20261007-124049537, REV-INV-02: dòng lịch sử ghi theo thứ tự lấy khóa: giao dịch bắt đầu sớm nhưng lấy khóa sau không được đứng trước (created_at không đi lùi so với on_hand_after)', async () => {
    const { product, item } = await seedStock(t, { on_hand: 10 });
    const svc = t.app.get(StockService), who = await staff();
    const body = (n: number) => ({ quantity: n, reason: 'purchase' as const, note: undefined });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // A bắt đầu giao dịch trước (now() của A sớm), chờ; B bắt đầu sau, chạy xong và cam kết; A mới lấy khóa và ghi sau B.
    const a = t.tx.run(async (tx) => { await tx.$queryRaw`SELECT 1`; await gate; await svc.stockIn(tx, session(who.id), product, body(5)); });
    await new Promise((r) => setTimeout(r, 50));
    await t.tx.run(async (tx) => { await svc.stockIn(tx, session(who.id), product, body(1)); });
    release(); await a;
    const rows = await q<{ on_hand_after: number }>(t, `SELECT on_hand_after FROM stock_movements WHERE stock_item_id = '${item}' ORDER BY created_at DESC, id DESC`);
    expect(rows.map((r) => r.on_hand_after)).toEqual([16, 11]); // mới nhất trước: 16 (sau A) rồi 11 (sau B)
    expect((await stockOf(t, product)).on_hand).toBe(16);
    const rec = await t.jobs.reconcileOnce();
    expect(rec.on_hand_mismatch).toBe(0);
  });

  it('REV-INV-03: reserve thiếu hàng quay lui bằng SAVEPOINT: không còn dòng reservation, reserved và event; giao dịch của CHK vẫn cam kết được', async () => {
    const { product: a, item: ia } = await seedStock(t, { on_hand: 5 }), { product: b } = await seedStock(t, { on_hand: 1 });
    const X = newId();
    const r = await t.tx.run(async (tx) => {
      const out = await t.inv.reserve(X, [{ product_id: a, quantity: 2 }, { product_id: b, quantity: 3 }], new Date(Date.now() + 900_000), tx);
      await tx.$executeRaw`UPDATE stock_items SET updated_at = now() WHERE id = ${ia}::uuid`; // CHK vẫn ghi tiếp trên cùng giao dịch
      return out;
    });
    expect(r.ok).toBe(false);
    expect((await q(t, `SELECT 1 FROM stock_reservations WHERE order_id = '${X}'`)).length).toBe(0);
    expect((await stockOf(t, a)).reserved).toBe(0);
    expect((await q(t, `SELECT 1 FROM outbox_events WHERE type = 'StockReserved'`)).length).toBe(0);
  });

  it('REV-INV-04: JSON có nửa cặp thay thế lẻ ở giá trị thân yêu cầu là 400 (không 500) và không đổi dữ liệu; cặp thay thế hợp lệ (emoji) vẫn nhận', async () => {
    const u = await staff();
    const { product } = await seedStock(t, { on_hand: 10 });
    const send = (raw: string) => call(t, 'post', `/admin/inventory/${product}/stock-in`, { cookie: u.cookie }).set('Idempotency-Key', idem()).set('Content-Type', 'application/json').send(raw);
    for (const raw of ['{"quantity":1,"reason":"other","note":"\\ud800"}', '{"quantity":1,"reason":"other","note":"x\\udc00y"}', '{"quantity":1,"reason":"other","note":"\\ud800\\ud800"}', '{"quantity":1,"reason":"other","\\ud800":1}']) {
      const r = await send(raw);
      expect([raw, r.status]).toEqual([raw, 400]);
    }
    expect((await stockOf(t, product)).on_hand).toBe(10);
    const ok = await send('{"quantity":1,"reason":"other","note":"\\ud83d\\ude00 ok"}');
    expect(ok.status).toBe(200);
  });

  it('INV-TC-20261007-124050601, REV-INV-05: nhập đồng thời 12 yêu cầu cùng Idempotency-Key và cùng thân chỉ cộng một lần; cùng khóa khác sản phẩm là 422', async () => {
    const u = await staff();
    const { product: a } = await seedStock(t, { on_hand: 0 }), { product: b } = await seedStock(t, { on_hand: 0 });
    const key = idem();
    const rs = await Promise.all(Array.from({ length: 12 }, () => call(t, 'post', `/admin/inventory/${a}/stock-in`, { cookie: u.cookie, body: { quantity: 7, reason: 'purchase' } }).set('Idempotency-Key', key)));
    expect(rs.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect((await stockOf(t, a)).on_hand).toBe(7);
    const other = await call(t, 'post', `/admin/inventory/${b}/stock-in`, { cookie: u.cookie, body: { quantity: 7, reason: 'purchase' } }).set('Idempotency-Key', key);
    expect([other.status, other.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    expect((await stockOf(t, b)).on_hand).toBe(0);
  });

  it('REV-INV-08: hai nhập kho song song trên cùng sản phẩm: audit ghi chuỗi trước-sau liền nhau (before của lần sau bằng after của lần trước), không cùng một before', async () => {
    const u = await staff();
    const { product } = await seedStock(t, { on_hand: 10 });
    const rs = await Promise.all([1, 2, 3, 4].map(() => call(t, 'post', `/admin/inventory/${product}/stock-in`, { cookie: u.cookie, body: { quantity: 5, reason: 'purchase' } }).set('Idempotency-Key', idem())));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const a = await q<{ before: { on_hand: number }; after: { on_hand: number } }>(t, `SELECT before, after FROM audit_logs WHERE action = 'inventory.stock_in' ORDER BY created_at, id`);
    const pairs = a.map((x) => [x.before.on_hand, x.after.on_hand]).sort((x, y) => x[0] - y[0]);
    expect(pairs).toEqual([[10, 15], [15, 20], [20, 25], [25, 30]]);
  });

  it('REV-INV-09: ProductArchived thứ hai (event_id khác) cho sản phẩm đã ngừng bán không đổi archived_at và không audit lần hai', async () => {
    const { product, item } = await seedStock(t, { on_hand: 3 });
    await deliver(t, 'ProductArchived', { product_id: product });
    const first = (await q<{ archived_at: Date }>(t, `SELECT archived_at FROM stock_items WHERE id = '${item}'`))[0].archived_at;
    await new Promise((r) => setTimeout(r, 20));
    await deliver(t, 'ProductArchived', { product_id: product });
    const again = (await q<{ archived_at: Date }>(t, `SELECT archived_at FROM stock_items WHERE id = '${item}'`))[0].archived_at;
    expect(again.getTime()).toBe(first.getTime());
    expect((await q(t, `SELECT 1 FROM audit_logs WHERE action = 'inventory.stock_item_archive'`)).length).toBe(1);
  });

  it('REV-INV-10: hai job nền đã đăng ký đúng chu kỳ (hết hạn mỗi phút, đối soát 24 giờ) và hạn thời gian của job hết hạn nhỏ hơn chu kỳ (hai lượt không chạy chồng)', () => {
    const jobs = (t.app.get(JobRunner) as unknown as { jobs: Map<string, { every: number; timeoutMs?: number; module: string }> }).jobs;
    const exp = jobs.get('inventory.expire-reservations'), rec = jobs.get('inventory.reconcile');
    expect([exp?.every, exp?.module, (exp?.timeoutMs ?? Infinity) < (exp?.every ?? 0)]).toEqual([60_000, 'inventory', true]);
    expect([rec?.every, rec?.module]).toEqual([24 * 3600_000, 'inventory']);
  });

  it('REV-INV-11: đối soát: bản ghi chưa có dòng lịch sử mà on_hand khác 0 bị log error, bản ghi on_hand 0 không có lịch sử (tạo bởi ProductActivated) thì không; không sửa dữ liệu', async () => {
    const { product: a } = await seedStock(t, { on_hand: 7 }), { product: b } = await seedStock(t, { on_hand: 0 });
    t.logs.clear();
    const r = await t.jobs.reconcileOnce();
    expect([r.on_hand_mismatch, r.reserved_mismatch]).toEqual([1, 0]);
    const errs = t.logs.records.filter((x) => x.level === 'error' && String(x.msg).includes('on_hand lệch'));
    expect(errs.map((x) => [x.product_id, x.on_hand, x.on_hand_after])).toEqual([[a, 7, 0]]);
    expect([(await stockOf(t, a)).on_hand, (await stockOf(t, b)).on_hand]).toEqual([7, 0]);
  });

  it('REV-INV-06: chốt đua hết hạn trên reservation đã quá hạn nhưng job chưa chạy: đúng một bên thắng, 40 lần', async () => {
    const { product, item } = await seedStock(t, { on_hand: 10, reserved: 2 });
    for (let i = 0; i < 40; i++) {
      await t.prisma.$executeRaw`DELETE FROM stock_reservations`; await t.prisma.$executeRaw`DELETE FROM outbox_events`;
      await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 10, reserved = 2 WHERE id = ${item}::uuid`;
      const o = newId(); await seedReservation(t, item, o, 2, 'held', new Date(Date.now() - 1000));
      await Promise.all([deliver(t, 'PaymentSucceeded', { order_id: o, payment_id: newId() }), t.jobs.expireOnce(), deliver(t, 'OrderCancelled', { order_id: o, reason: 'admin', was_paid: false })]);
      const s = await stockOf(t, product);
      const st = (await q<{ status: string }>(t, `SELECT status FROM stock_reservations WHERE order_id = '${o}'`))[0].status;
      expect([i, s.reserved, s.on_hand]).toEqual([i, 0, st === 'committed' ? 8 : 10]); // committed trừ kho; released (cả committed rồi released) và expired thì nguyên
      const ev = (await q<{ type: string }>(t, `SELECT type FROM outbox_events WHERE type LIKE 'Stock%'`)).map((e) => e.type).sort().join();
      // kết cục hợp lệ: một bên thắng reservation held; PaymentSucceeded thua thì thêm StockCommitFailed; chốt rồi hủy là StockCommitted rồi StockReleased
      expect([i, ['StockCommitted', 'StockCommitted,StockReleased', 'StockReleased', 'StockCommitFailed,StockReleased', 'StockReservationExpired', 'StockCommitFailed,StockReservationExpired'].includes(ev)]).toEqual([i, true]);
    }
  }, 120_000);
});

// Bổ sung của reviewer: bảng đầu vào xấu (số âm, tràn, đơn vị, kiểu sai) cho mọi endpoint ghi và đọc; không đổi dữ liệu, không 500.
describe('INV review: đầu vào xấu', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; });

  it('REV-INV-07: số lượng, số đếm, ngưỡng, version, ghi chú, tham số truy vấn sai đều là 400 (không 500), dữ liệu không đổi', async () => {
    const u = await seedUser(t, { email: 'bad@shop.vn', role: 'staff' }), session = await seedSession(t, u.id);
    const cookie = session.cookie;
    let used = 0;
    const tick = () => { if (++used % 20 === 0) t.clock.advance(61_000); }; // bậc D 30 mỗi phút: tua đồng hồ giả để không chạm 429
    const { product } = await seedStock(t, { on_hand: 10, reserved: 2, version: 3 });
    const post = (kind: string, body: unknown) => { tick(); return call(t, 'post', `/admin/inventory/${product}/${kind}`, { cookie, body }).set('Idempotency-Key', idem()); };
    const bad: [string, string, unknown][] = [];
    for (const quantity of [-5, 0, 1.5, '5', 1e21, 100_001, true, null, [1], { a: 1 }, 2 ** 53, Number.MAX_SAFE_INTEGER]) {
      bad.push(['stock-in', `in ${JSON.stringify(quantity)}`, { quantity, reason: 'purchase' }], ['stock-out', `out ${JSON.stringify(quantity)}`, { quantity, reason: 'lost' }]);
    }
    for (const new_on_hand of [-1, 10_000_001, 2 ** 31, 1.2, '9', null]) bad.push(['adjustments', `adjust ${JSON.stringify(new_on_hand)}`, { new_on_hand, version: 3, note: 'kiểm kê tháng' }]);
    for (const version of [0, -1, 2 ** 31, 1.5, '3', null]) bad.push(['adjustments', `version ${JSON.stringify(version)}`, { new_on_hand: 5, version, note: 'kiểm kê tháng' }]);
    for (const note of ['abcd', 'x'.repeat(201), 'có\u0000nul', 5]) bad.push(['adjustments', `note ${JSON.stringify(note).slice(0, 12)}`, { new_on_hand: 5, version: 3, note }]);
    bad.push(['stock-in', 'reason lạ', { quantity: 1, reason: 'sale' }], ['stock-in', 'reason out dùng cho in', { quantity: 1, reason: 'damaged' }], ['stock-out', 'reason in dùng cho out', { quantity: 1, reason: 'purchase' }], ['stock-in', 'thiếu reason', { quantity: 1 }], ['stock-in', 'thân mảng', [1]], ['stock-in', 'thân chuỗi', 'x'], ['stock-in', 'other không note', { quantity: 1, reason: 'other' }], ['stock-out', 'other note trắng', { quantity: 1, reason: 'other', note: '   ' }]);
    for (const [kind, name, body] of bad) {
      const r = await post(kind, body);
      expect([name, r.status]).toEqual([name, 400]);
    }
    for (const low_stock_threshold of [-1, 1_000_001, 1.5, '5', null]) {
      tick(); const r = await call(t, 'patch', `/admin/inventory/${product}/threshold`, { cookie, body: { low_stock_threshold, version: 3 } });
      expect([String(low_stock_threshold), r.status]).toEqual([String(low_stock_threshold), 400]);
    }
    for (const body of [{ low_stock_threshold: 5 }, { low_stock_threshold: 5, version: 3, on_hand: 99 }, { version: 3 }]) {
      tick(); expect((await call(t, 'patch', `/admin/inventory/${product}/threshold`, { cookie, body })).status).toBe(400);
    }
    for (const qs of ['page=0', 'page=-1', 'limit=0', 'limit=101', 'page=1.5', 'foo=1', 'sort=on_hand', 'archived=1', 'q=', `q=${'x'.repeat(101)}`, 'page=99999999999999999999']) {
      tick(); const r = await call(t, 'get', `/admin/inventory?${qs}`, { cookie });
      expect([qs, r.status]).toEqual([qs, 400]);
    }
    for (const qs of ['type=sale,foo', 'type=', 'from=2026-02-30', 'from=2026-10-02&to=2026-10-01', 'from=hôm-qua', 'x=1']) {
      tick(); const r = await call(t, 'get', `/admin/inventory/${product}/movements?${qs}`, { cookie });
      expect([qs, r.status]).toEqual([qs, 400]);
    }
    for (const qs of ['', 'product_ids=', 'product_ids=abc', `product_ids=${newId()},`, `product_ids=${newId()}&x=1`]) {
      tick(); const r = await call(t, 'get', `/inventory/availability?${qs}`, {});
      expect([qs, r.status]).toEqual([qs, 400]);
    }
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 10, reserved: 2, version: 3, low_stock_threshold: 5 });
    expect((await q(t, 'SELECT 1 FROM stock_movements')).length).toBe(0);
  });
});
