import { spawn } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { JobRunner, type EventEnvelope } from '../../src/modules/platform';
import { CatalogApi } from '../../src/modules/catalog';
import { ORIGIN } from '../support/app';
import { q, seedSession, seedUser } from '../support/auth';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';
import { bulkReservations, call, createInvApp, deliver, eventsOf, newId, relay, reservationsOf, reserve, seedReservation, seedStock, sink, stockOf, type InvApp } from '../support/inv';
import { seedCategory, seedProduct } from '../support/prd';

// Hai job nền của INV (ADR-013): hết hạn giữ hàng mỗi phút và đối soát hằng đêm. PostgreSQL thật, hai instance thật, giết tiến trình thật.
describe('INV job hết hạn giữ hàng', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp({ level: 'error' }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.logs.clear(); });
  const expiredEvents = async () => (await eventsOf(t, 'StockReservationExpired')).map((e) => e.aggregate_id);
  const totalReserved = async () => Number((await q<{ s: bigint }>(t, 'SELECT COALESCE(sum(reserved), 0) AS s FROM stock_items'))[0].s);

  it('INV-TC-20261006-101123465: job chuyển reservation quá hạn sang expired: reserved về 0, on_hand không đổi, StockReservationExpired phát đúng một lần sau cam kết, hàng mua lại được', async () => {
    const { product: a, item } = await seedStock(t, { on_hand: 5, reserved: 2 });
    const U = newId();
    await seedReservation(t, item, U, 2, 'held', new Date(Date.now() - 60_000));
    const seen = sink(t, 'StockReservationExpired');
    expect(await t.jobs.expireOnce()).toEqual({ orders: 1, batches: 1 });
    expect((await reservationsOf(t, U))[0].status).toBe('expired');
    expect(await stockOf(t, a)).toMatchObject({ on_hand: 5, reserved: 0 });
    expect(await expiredEvents()).toEqual([U]);
    await relay(t); expect(seen.map((e) => e.payload)).toEqual([{ order_id: U }]);
    expect(await t.jobs.expireOnce()).toEqual({ orders: 0, batches: 0 }); // idempotent
    expect(await expiredEvents()).toEqual([U]);
    // đọc lại qua đường chính: hàng mua lại được (available tăng 2) và giữ được đủ số còn lại
    const u = await seedUser(t, { email: 'staff@shop.vn', role: 'staff' });
    expect((await call(t, 'get', `/admin/inventory/${a}`, { cookie: (await seedSession(t, u.id)).cookie })).body).toMatchObject({ on_hand: 5, reserved: 0, available: 5 });
    expect(await reserve(t, newId(), [{ product_id: a, quantity: 5 }])).toMatchObject({ ok: true });
  });

  it('INV-TC-20261006-101123489: reservation đã chốt trước job không bị hết hạn; lỗi CSDL giữa lô quay lui toàn bộ, lần chạy sau xử lý đủ 500 đơn, mỗi đơn đúng một StockReservationExpired (log error khi quá hạn hơn 5 phút)', async () => {
    const { product: a, item } = await seedStock(t, { on_hand: 5, reserved: 0 });
    const R1 = newId();
    await seedReservation(t, item, R1, 2, 'committed', new Date(Date.now() - 60_000)); // đã chốt, hạn đã qua
    const { items, orders } = await bulkReservations(t, 500);
    const failAt = [...items].sort()[249]; // dòng kho thứ 250 (theo id tăng dần) của lô 500 đơn; chọn trong các dòng của lô, không lấy cả dòng của đơn đã chốt
    await t.prisma.$executeRaw(Prisma.raw(`CREATE FUNCTION inv_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.id = '${failAt}' AND NEW.reserved < OLD.reserved THEN RAISE EXCEPTION 'lỗi CSDL ép giữa lô'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`));
    await t.prisma.$executeRaw(Prisma.raw('CREATE TRIGGER inv_test_fail BEFORE UPDATE ON stock_items FOR EACH ROW EXECUTE FUNCTION inv_test_fail()'));
    try {
      await expect(t.jobs.expireOnce()).rejects.toThrow(/lỗi CSDL ép giữa lô/);
      expect(await q(t, `SELECT 1 FROM stock_reservations WHERE status = 'expired'`)).toHaveLength(0); // quay lui hoàn toàn, không reservation nửa vời
      expect([await totalReserved(), (await expiredEvents()).length]).toEqual([500, 0]);
    } finally {
      await t.prisma.$executeRaw(Prisma.raw('DROP TRIGGER inv_test_fail ON stock_items'));
      await t.prisma.$executeRaw(Prisma.raw('DROP FUNCTION inv_test_fail()'));
    }
    expect(await t.jobs.expireOnce()).toEqual({ orders: 500, batches: 1 });
    expect((await expiredEvents()).sort()).toEqual([...orders].sort());
    expect((await reservationsOf(t, R1))[0].status).toBe('committed');
    expect([await totalReserved(), (await stockOf(t, a)).reserved, items.length]).toEqual([0, 0, 500]);
    // còn đơn quá hạn hơn 5 phút mà job không kịp xử lý (hạn thời gian 0): log error cho vận hành
    await seedReservation(t, (await seedStock(t, { on_hand: 3, reserved: 1 })).item, newId(), 1, 'held', new Date(Date.now() - 600_000));
    await t.jobs.expireOnce({ budgetMs: 0 });
    expect(t.logs.records.filter((r) => r.level === 'error' && String(r.msg).includes('quá hạn hơn 5 phút'))).toHaveLength(1);
  }, 120_000);

  it('INV-TC-20261006-101123513: đơn có ba dòng hết hạn cùng lúc chuyển expired trong một giao dịch với đúng một StockReservationExpired; reservation COD (expires_at rỗng) không hết hạn', async () => {
    const a = await seedStock(t, { on_hand: 5, reserved: 1 }), b = await seedStock(t, { on_hand: 5, reserved: 2 }), c = await seedStock(t, { on_hand: 5, reserved: 3 });
    const [U, V] = [newId(), newId()], past = new Date(Date.now() - 60_000);
    await seedReservation(t, a.item, U, 1, 'held', past); await seedReservation(t, b.item, U, 2, 'held', past); await seedReservation(t, c.item, U, 3, 'held', past);
    const d = await seedStock(t, { on_hand: 5, reserved: 4 });
    await seedReservation(t, d.item, V, 4, 'held', null);
    await t.jobs.expireOnce();
    expect((await reservationsOf(t, U)).map((r) => r.status)).toEqual(['expired', 'expired', 'expired']);
    expect(await expiredEvents()).toEqual([U]);
    expect([(await reservationsOf(t, V))[0].status, (await stockOf(t, d.product)).reserved]).toEqual(['held', 4]);
    expect([(await stockOf(t, a.product)).reserved, (await stockOf(t, b.product)).reserved, (await stockOf(t, c.product)).reserved]).toEqual([0, 0, 0]);
  });

  it('INV-TC-20261006-101123535: hai instance cùng đến giờ chỉ một bản chạy (khóa tư vấn); ép chạy song song vẫn không đơn nào nhận hai StockReservationExpired và tổng reserved giảm đúng; ranh giới 1 mili giây; log error khi quá hạn hơn 5 phút', async () => {
    const t2 = await createInvApp({ level: 'error' });
    try {
      const { orders } = await bulkReservations(t, 1200, { quantity: 2 });
      expect(await totalReserved()).toBe(2400);
      expect(await t.jobs.expireOnce({ budgetMs: 1 })).toMatchObject({ batches: 1, orders: 500 }); // lô tối đa 500 đơn mỗi giao dịch, hạn thời gian dừng nhận lô mới
      await t.prisma.$executeRaw`DELETE FROM outbox_events`;
      await t.prisma.$executeRaw`UPDATE stock_reservations SET status = 'held', expires_at = now() - interval '1 minute'`;
      await t.prisma.$executeRaw`UPDATE stock_items SET reserved = 2`;
      expect(await t.jobs.expireOnce()).toEqual({ orders: 1200, batches: 3 }); // 1200 đơn là ba lô 500, 500, 200
      await t.prisma.$executeRaw`DELETE FROM outbox_events`;
      await t.prisma.$executeRaw`UPDATE stock_reservations SET status = 'held', expires_at = now() - interval '1 minute'`;
      await t.prisma.$executeRaw`UPDATE stock_items SET reserved = 2`;
      const runs = await Promise.all([t.app.get(JobRunner).runOnce('inventory.expire-reservations'), t2.app.get(JobRunner).runOnce('inventory.expire-reservations')]);
      expect(runs.sort()).toEqual(['ran', 'skipped']); // một instance lấy được khóa, instance kia bỏ lượt
      expect((await expiredEvents()).sort()).toEqual([...orders].sort());
      // ép chạy song song bỏ qua khóa job (điều kiện status = 'held' trong câu UPDATE là lớp thứ hai)
      await t.prisma.$executeRaw`DELETE FROM outbox_events`;
      await t.prisma.$executeRaw`UPDATE stock_reservations SET status = 'held', expires_at = now() - interval '1 minute'`;
      await t.prisma.$executeRaw`UPDATE stock_items SET reserved = 2`;
      await Promise.all([t.jobs.expireOnce(), t2.jobs.expireOnce()]);
      const ev = await expiredEvents();
      expect([ev.length, new Set(ev).size, await totalReserved()]).toEqual([1200, 1200, 0]); // mỗi đơn đúng một event, reserved giảm đúng tổng quantity
      // ranh giới 1 mili giây: expires_at = 10:15:00.000 chưa hết hạn lúc 10:14:59.999 (mốc `now` truyền vào), hết hạn từ 10:15:00.000
      // fixed-clock: mốc 10:15:00.000 được truyền vào job bằng tham số `now`, không phụ thuộc giờ máy, giờ CSDL hay FakeClock
      const { item } = await seedStock(t, { on_hand: 3, reserved: 1 }), edge = newId(), at = new Date('2026-10-06T10:15:00.000Z');
      await seedReservation(t, item, edge, 1, 'held', at);
      await t.jobs.expireOnce({ now: new Date(at.getTime() - 1) });
      expect((await reservationsOf(t, edge))[0].status).toBe('held');
      await t.jobs.expireOnce({ now: at });
      expect((await reservationsOf(t, edge))[0].status).toBe('expired');
    } finally { await t2.close(); }
  }, 180_000);

  it('INV-TC-20261006-121044093: tiến trình chết (SIGKILL) ngay sau cam kết của job thì StockReservationExpired vẫn nằm trong outbox, relay giao tới ORD sau khởi động lại, giao lại cùng event_id bị bỏ qua', async () => {
    const { product: a, item } = await seedStock(t, { on_hand: 5, reserved: 2 }), U = newId();
    await seedReservation(t, item, U, 2, 'held', new Date(Date.now() - 60_000));
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/expire-then-die.ts'], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const [code, signal] = await new Promise<[number | null, string | null]>((r) => child.on('exit', (c, s) => r([c, s])));
    expect([code, signal]).toEqual([null, 'SIGKILL']);
    expect(out).not.toContain('SURVIVED');
    expect((await reservationsOf(t, U))[0].status).toBe('expired'); // commit đã xong trước khi chết
    const rows = await q<{ id: string; type: string; aggregate_id: string; dispatched_at: Date | null }>(t, `SELECT id, type, aggregate_id, dispatched_at FROM outbox_events WHERE type = 'StockReservationExpired'`);
    expect(rows.map((r) => [r.aggregate_id, r.dispatched_at])).toEqual([[U, null]]); // đúng một event, chưa phát
    const got: EventEnvelope[] = [], handler = async (_tx: unknown, e: EventEnvelope) => { got.push(e); };
    t.events.subscribe('ORD-stub', 'StockReservationExpired', handler);
    await relay(t); // sau khởi động lại: relay chạy, kể cả chạy lặp
    expect(got.map((e) => [e.event_id, (e.payload as { order_id: string }).order_id])).toEqual([[rows[0].id, U]]);
    const again = await t.events.deliver({ consumer: 'ORD-stub', handler }, got[0]); // giao ít nhất một lần: lần hai cùng event_id
    expect([again, got.length]).toEqual(['skipped', 1]);
    expect((await stockOf(t, a)).reserved).toBe(0);
  }, 90_000);
});

describe('INV job đối soát hằng đêm và tạo bù bản ghi kho', () => {
  let t: InvApp;
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.logs.clear(); });
  const errors = () => t.logs.records.filter((r) => r.level === 'error');
  const movement = (item: string, after: number) => t.prisma.$executeRaw`INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after) VALUES (${item}::uuid, 'in'::movement_type, ${after}, ${after})`;

  it('INV-TC-20261006-101123791: đối soát ghi hai log error (reserved 4 so với held 3; on_hand 20 so với on_hand_after 18), không sửa dữ liệu, bản ghi nhất quán không log; không tạo bù khi PRD lỗi hay bị hủy (đóng khi không chắc)', async () => {
    const A = await seedStock(t, { on_hand: 10, reserved: 4 }), B = await seedStock(t, { on_hand: 20 }), C = await seedStock(t, { on_hand: 6, reserved: 2 });
    await movement(A.item, 10); await movement(B.item, 18); await movement(C.item, 6);
    await seedReservation(t, A.item, newId(), 3); await seedReservation(t, C.item, newId(), 2);
    const before = await q(t, 'SELECT product_id, on_hand, reserved, version FROM stock_items ORDER BY product_id');
    expect(await t.jobs.reconcileOnce()).toMatchObject({ reserved_mismatch: 1, on_hand_mismatch: 1 });
    const e = errors();
    expect(e).toHaveLength(2);
    expect(e.find((r) => String(r.msg).includes('reserved lệch'))).toMatchObject({ product_id: A.product, reserved: 4, held_total: 3 });
    expect(e.find((r) => String(r.msg).includes('on_hand lệch'))).toMatchObject({ product_id: B.product, on_hand: 20, on_hand_after: 18 });
    expect(await q(t, 'SELECT product_id, on_hand, reserved, version FROM stock_items ORDER BY product_id')).toEqual(before); // chỉ báo, không sửa
    // đóng khi không chắc: PRD không trả được thì không tạo gì (kể cả sản phẩm active chưa có kho)
    const p9 = await seedProduct(t as never, { category: t.cat });
    const spy = jest.spyOn(t.app.get(CatalogApi), 'listActiveProductIds').mockRejectedValueOnce(new Error('PRD hỏng'));
    try { expect((await t.jobs.reconcileOnce()).backfilled).toBe(0); } finally { spy.mockRestore(); }
    expect(await q(t, `SELECT 1 FROM stock_items WHERE product_id = '${p9}'`)).toHaveLength(0);
    // bị hủy (quá hạn thời gian của JobRunner) thì không gọi PRD lần nào
    const ac = new AbortController(); ac.abort();
    const spy2 = jest.spyOn(t.app.get(CatalogApi), 'listActiveProductIds');
    try { expect((await t.jobs.reconcileOnce({ signal: ac.signal })).backfilled).toBe(0); expect(spy2).not.toHaveBeenCalled(); } finally { spy2.mockRestore(); }
    // tạo bù theo lô 500 (1200 sản phẩm active là ba trang), chạy lại không tạo dòng thứ hai
    await t.prisma.$executeRaw`
      INSERT INTO products (category_id, name, sku, price, status, published_at, search_text)
      SELECT ${t.cat}::uuid, 'Mồ côi ' || g, 'MC-' || g, 100000, 'active', now(), 'mo coi ' || g FROM generate_series(1, 1200) g`;
    const spy3 = jest.spyOn(t.app.get(CatalogApi), 'listActiveProductIds');
    try {
      const first = await t.jobs.reconcileOnce();
      expect(first.backfilled).toBe(1201); // 1200 mới và p9 chưa có kho
      expect(spy3.mock.calls.map((c) => c[1])).toEqual([500, 500, 500]); // trang cuối có 201 dòng nên dừng; không lần nào xin quá 500
      expect((await t.jobs.reconcileOnce()).backfilled).toBe(0);
    } finally { spy3.mockRestore(); }
  }, 120_000);

  it('INV-TC-20261006-101123881: ProductArchived của sản phẩm nháp chưa có kho không lỗi; job đối soát tạo bù bản ghi cho sản phẩm active bị mất event (on_hand 0, log info stock_item_backfilled), chạy lại không tạo dòng thứ hai', async () => {
    const cat = await seedCategory(t, 'Áo'), d1 = await seedProduct(t as never, { category: cat, status: 'draft' }), p7 = await seedProduct(t as never, { category: cat, status: 'active' });
    await deliver(t, 'ProductArchived', { product_id: d1 });
    expect(await q(t, `SELECT 1 FROM stock_items WHERE product_id = '${d1}'`)).toHaveLength(0);
    expect(await t.jobs.reconcileOnce()).toMatchObject({ backfilled: 1 });
    expect(await stockOf(t, p7)).toMatchObject({ on_hand: 0, reserved: 0, version: 1 });
    expect(t.logs.records.filter((r) => r.level === 'info' && r.msg === 'stock_item_backfilled' && r.product_id === p7)).toHaveLength(1);
    expect(await q(t, `SELECT 1 FROM stock_items WHERE product_id = '${d1}'`)).toHaveLength(0); // nháp không được tạo bù
    await t.jobs.reconcileOnce();
    expect(await q(t, `SELECT 1 FROM stock_items WHERE product_id = '${p7}'`)).toHaveLength(1);
    expect(await q(t, `SELECT 1 FROM audit_logs WHERE action = 'inventory.stock_item_create' AND target_id = '${p7}'`)).toHaveLength(1);
  });
});
