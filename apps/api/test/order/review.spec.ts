import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { call, countRows, createOrdApp, deliver, historyOf, orderOf, outboxOf, auditsOf, pgCode, people, seedOrder, sleep, who, type OrdApp, type Status } from '../support/ord';

// Ca bổ sung của lượt triển khai (mỗi ca mang ID của TC gần nhất để bảng đột biến trỏ tới): bất biến khi nhiều thao tác chạy lẫn nhau (tải hỗn hợp), lớp bảo vệ thứ hai của CSDL, log không rò payload, các nhánh bảng chuyển mà TC chưa chạm.
describe('ORD ca bổ sung', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });

  it('ORD-TC-20261006-120228419: ShipmentReturned chỉ chuyển đơn shipped; đơn paid, cancelled, delivered, returned nhận event này bị từ chối (không đổi, không OrderReturned)', async () => {
    const { a } = await people(t);
    const os = [await seedOrder(t, { user: a.id, status: 'paid' }), await seedOrder(t, { user: a.id, status: 'cancelled' }), await seedOrder(t, { user: a.id, status: 'delivered' }), await seedOrder(t, { user: a.id, status: 'returned' })];
    const before = await Promise.all(os.map((o) => historyOf(t, o.id)));
    t.logs.clear();
    for (const o of os) await deliver(t, 'ShipmentReturned', { shipment_id: randomUUID(), order_id: o.id, restockable: false });
    expect((await Promise.all(os.map((o) => orderOf(t, o.id)))).map((o) => o.status)).toEqual(['paid', 'cancelled', 'delivered', 'returned']);
    expect(await Promise.all(os.map((o) => historyOf(t, o.id)))).toEqual(before);
    expect(await outboxOf(t)).toEqual([]);
    expect(t.logs.records.filter((r) => r.code === 'transition-rejected')).toHaveLength(4);
  });

  it('ORD-TC-20261006-120228155: sản phẩm bán chạy loại đơn đã thu tiền nhưng cancelled, expired, returned (đơn bị hủy hay hoàn không tính) và biên paid_at nửa mở [from, to)', async () => {
    const { a } = await people(t);
    const [P, Q] = [randomUUID(), randomUUID()];
    const range = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') };
    const mk = (status: Status, product: string, paidAt: string) => seedOrder(t, { user: a.id, status, payment: 'succeeded', paidAt: new Date(paidAt), createdAt: new Date('2026-10-02T00:00:00Z'), items: [{ product, price: 1000, qty: 5 }], method: 'cod' });
    await mk('paid', P, '2026-10-02T00:00:00Z');
    await mk('delivered', P, '2026-10-01T00:00:00Z'); // đúng mốc from: tính
    await mk('delivered', P, '2026-10-08T00:00:00Z'); // đúng mốc to: không tính // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    for (const s of ['cancelled', 'expired', 'returned'] as const) await mk(s, Q, '2026-10-03T00:00:00Z');
    expect(await t.ord.getTopProducts(range, 'quantity', 10)).toEqual([{ product_id: P, quantity: 10, amount: 10000 }]);
  });

  it('ORD-TC-20261006-111226497: lớp bảo vệ thứ hai của CSDL: một đơn không thể có hai dòng chuyển cancelled (unique một phần), dòng tự trỏ chỉ cho shipped kèm mã, lý do chỉ ở cancelled hoặc giao thất bại', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'cancelled' });
    const insert = (from: string | null, to: string, reason: string | null = null) => t.prisma.$executeRaw`INSERT INTO order_status_history (order_id, from_status, to_status, actor_role, reason) VALUES (${o.id}::uuid, ${from}::order_status, ${to}::order_status, 'system', ${reason})`;
    expect(await pgCode(insert('paid', 'cancelled'))).toBe('23505'); // hủy lần hai
    expect(await pgCode(insert('shipped', 'shipped', 'refused'))).toBe('ok'); // giao thất bại được lặp
    expect(await pgCode(insert('shipped', 'shipped', 'refused'))).toBe('ok');
    expect(await pgCode(insert('paid', 'paid'))).toBe('23514'); // tự trỏ ngoài shipped
    expect(await pgCode(insert('paid', 'shipped', 'lý do ở dòng thường'))).toBe('23514'); // lý do chỉ ở cancelled hoặc giao thất bại
    expect(await pgCode(insert(null, 'paid'))).toBe('23514'); // from rỗng chỉ cho pending
    expect(await pgCode(insert('pending', 'pending'))).toBe('23514');
    expect(await pgCode(insert('paid', 'returned', 'x'.repeat(10)))).toBe('23514');
    expect(await pgCode(insert('shipped', 'cancelled', 'x'.repeat(501)))).toBe('23514'); // lý do quá 500 ký tự
  });

  it('ORD-TC-20261006-111225438: event hỏng hình dạng (tracking_number rỗng, mã giao thất bại lạ, StockCommitFailed mã lạ, order_id không phải uuid) bị bỏ qua có log không chứa payload hay dữ liệu cá nhân; không đổi gì', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'shipped', code: '8M2N4P6R8S0T', address: { receiver: 'Trần Thị B', phone: '0912345678', line1: '45 Nguyễn Huệ', ward: 'Bến Thành', city: 'TP.HCM' } });
    const p = await seedOrder(t, { user: a.id, status: 'paid' });
    const before = JSON.stringify([await historyOf(t, o.id), await orderOf(t, o.id)]);
    t.logs.clear();
    const secret = { receiver: 'Trần Thị B', phone: '0912345678', note: 'bí mật-123' };
    await deliver(t, 'ShipmentShipped', { order_id: p.id, tracking_number: '   ', ...secret });
    await deliver(t, 'ShipmentFailed', { order_id: o.id, reason: 'không-có-mã-này', ...secret });
    await deliver(t, 'StockCommitFailed', { order_id: p.id, reason: 'mã_lạ', ...secret });
    await deliver(t, 'ShipmentTrackingChanged', { order_id: o.id, tracking_number: 12345, ...secret });
    await deliver(t, 'PaymentSucceeded', { order_id: 'không-phải-uuid', ...secret });
    expect(JSON.stringify([await historyOf(t, o.id), await orderOf(t, o.id)])).toBe(before);
    expect((await orderOf(t, p.id)).status).toBe('paid');
    expect(t.logs.records.filter((r) => r.msg === 'bỏ qua event của đơn')).toHaveLength(5);
    expect(t.logs.lines.join('\n')).not.toMatch(/Trần Thị B|0912345678|bí mật-123/);
  });

  it('ORD-TC-20261006-111225678: tải hỗn hợp: 40 đơn chịu hủy của khách và admin, thanh toán, hết hạn, thiếu hàng, giao, giao thất bại, hoàn về, khóa bàn giao và event trùng chạy song song; mỗi đơn có chuỗi lịch sử hợp lệ, đúng một event cho mỗi chuyển, một audit cho mỗi hủy, không hủy của người dùng khi đã khóa bàn giao', async () => {
    const admins = [await who(t, 'admin', 'admin1@x.vn'), await who(t, 'admin', 'admin2@x.vn'), await who(t, 'admin', 'admin3@x.vn'), await who(t, 'admin', 'admin4@x.vn')];
    const orders: { id: string; code: string; cookie: string; status: Status }[] = [];
    for (let i = 0; i < 40; i++) {
      const u = await who(t, 'customer', `mix${i}@x.vn`), status: Status = i % 3 === 0 ? 'pending' : i % 3 === 1 ? 'paid' : 'confirmed';
      orders.push({ ...(await seedOrder(t, { user: u.id, status, method: status === 'confirmed' ? 'cod' : 'vnpay', payment: status === 'paid' ? 'succeeded' : 'pending' })), cookie: u.cookie, status });
    }
    const ev = (o: { id: string }, type: string, extra: Record<string, unknown> = {}) => () => deliver(t, type, { order_id: o.id, shipment_id: randomUUID(), payment_id: randomUUID(), ...extra });
    const lock = (o: { id: string }) => () => t.tx.run((tx) => t.ord.lockForHandoff(o.id, tx)).catch(() => 'refused');
    const pool = (o: (typeof orders)[number], i: number): (() => Promise<unknown>)[] => [
      () => call(t, 'post', `/orders/${o.code}/cancel`, { cookie: o.cookie, body: { reason: 'tải' } }),
      () => call(t, 'post', `/orders/${o.code}/cancel`, { cookie: admins[i % 4].cookie, body: {} }),
      ev(o, 'PaymentSucceeded', { paid_at: new Date().toISOString() }), ev(o, 'PaymentFailed', { is_final: true, attempt_no: 3, reason: 'declined' }), ev(o, 'StockReservationExpired'),
      ev(o, 'StockCommitFailed', { reason: 'reservation_expired' }), ev(o, 'ShipmentShipped', { tracking_number: `VN${i}` }), ev(o, 'ShipmentDelivered'), ev(o, 'ShipmentFailed', { reason: 'refused' }),
      ev(o, 'ShipmentReturned', { restockable: true }), lock(o), ev(o, 'PaymentRefunded'),
    ];
    const rng = (n: number) => Math.floor(Math.random() * n);
    await Promise.all(orders.map(async (o, i) => {
      const dup = randomUUID(), actions = Array.from({ length: 5 }, () => pool(o, i)[rng(12)]);
      actions.push(() => deliver(t, 'ShipmentShipped', { order_id: o.id, tracking_number: 'DUP' }, dup), () => deliver(t, 'ShipmentShipped', { order_id: o.id, tracking_number: 'DUP' }, dup));
      await Promise.all(actions.map(async (f) => { await sleep(rng(15)); await f().catch(() => undefined); }));
    }));
    const allowed = new Set(['pending>paid', 'pending>confirmed', 'pending>expired', 'pending>cancelled', 'confirmed>cancelled', 'paid>cancelled', 'paid>shipped', 'confirmed>shipped', 'shipped>delivered', 'shipped>returned']);
    const evType: Record<string, string> = { paid: 'OrderPaid', confirmed: 'OrderConfirmed', cancelled: 'OrderCancelled', expired: 'OrderExpired', shipped: 'OrderShipped', delivered: 'OrderDelivered', returned: 'OrderReturned' };
    const stats: Record<string, number> = {};
    for (const o of orders) {
      const h = await historyOf(t, o.id), row = await orderOf(t, o.id), out = (await outboxOf(t, o.id)).map((e) => e.type);
      let cur: Status = 'pending';
      expect([h[0].from_status, h[0].to_status]).toEqual([null, 'pending']);
      for (const x of h.slice(1)) {
        if (x.from_status === 'shipped' && x.to_status === 'shipped') { expect(cur).toBe('shipped'); continue; } // giao thất bại
        expect(x.from_status).toBe(cur); expect(allowed.has(`${x.from_status}>${x.to_status}`)).toBe(true);
        cur = x.to_status;
      }
      expect(cur).toBe(row.status); // chuỗi lịch sử kết thúc đúng ở trạng thái hiện tại
      expect(row.status).toBe(h.filter((x) => !(x.from_status === 'shipped' && x.to_status === 'shipped')).at(-1)?.to_status);
      for (const [status, type] of Object.entries(evType)) {
        const moved = h.filter((x) => x.to_status === status && x.from_status !== x.to_status).length;
        const seeded = (status === 'paid' && o.status === 'paid') || (status === 'confirmed' && o.status === 'confirmed') ? 1 : 0; // dòng dựng sẵn không phát event
        expect([o.code, type, out.filter((e) => e === type).length]).toEqual([o.code, type, moved - seeded]);
      }
      expect((await auditsOf(t, o.id)).length).toBe(row.status === 'cancelled' ? 1 : 0);
      if (row.status === 'cancelled' && (row.cancelled_by_role === 'customer' || row.cancelled_by_role === 'admin')) expect(row.handoff_locked_at).toBeNull();
      if (row.status === 'cancelled') expect(row.cancel_reason).not.toBeNull();
      stats[row.status] = (stats[row.status] ?? 0) + 1;
    }
    expect(Object.values(stats).reduce((x, n) => x + n, 0)).toBe(40);
    expect(Object.keys(stats).length).toBeGreaterThanOrEqual(3); // tải thật sự tạo ra nhiều kết cục khác nhau
    expect(await countRows(t, 'order_status_history', "to_status = 'cancelled' AND from_status IS DISTINCT FROM to_status")).toBe(await countRows(t, 'orders', "status = 'cancelled'"));
  }, 180_000);
});
