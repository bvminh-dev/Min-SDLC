import { randomUUID } from 'node:crypto';
import { OrderBusinessError } from '../../src/modules/order';
import { truncateAll } from '../support/db';
import { call, countRows, createOrdApp, historyOf, orderOf, outboxOf, people, pgCode, race, seedOrder, who, insertRaw, type OrdApp } from '../support/ord';
import { q } from '../support/auth';

// Khóa hủy đơn khi SHP bàn giao: lockForHandoff (ORD-REQ-20261006-150000100, R-04).
describe('ORD lockForHandoff', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const lock = (id: string) => t.tx.run((tx) => t.ord.lockForHandoff(id, tx));
  const cancel = (code: string, cookie: string) => call(t, 'post', `/orders/${code}/cancel`, { cookie, body: {} });

  it('ORD-TC-20261006-150000300: SHP khóa đơn khi bàn giao thì đơn không đổi trạng thái, không lịch sử, event hay audit; khách và admin hủy nhận 409; can_cancel false; ShipmentShipped vẫn chuyển sang shipped', async () => {
    const { a, admin } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod' });
    const [rows, ev, au] = [await historyOf(t, o.id), await countRows(t, 'outbox_events'), await countRows(t, 'audit_logs')];
    expect(await lock(o.id)).toEqual({ order_id: o.id, status: 'confirmed' });
    const row = await orderOf(t, o.id);
    expect([row.status, row.handoff_locked_at]).toEqual(['confirmed', t.clock.now()]);
    expect([(await historyOf(t, o.id)).length, await countRows(t, 'outbox_events'), await countRows(t, 'audit_logs')]).toEqual([rows.length, ev, au]);
    for (const who of [a, admin]) { const r = await cancel(o.code, who.cookie); expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:order-not-cancellable']); }
    expect((await orderOf(t, o.id)).status).toBe('confirmed');
    expect((await outboxOf(t, o.id)).filter((e) => e.type === 'OrderCancelled')).toEqual([]);
    expect((await call(t, 'get', `/orders/${o.code}`, { cookie: a.cookie })).body.can_cancel).toBe(false);
    const { deliver } = await import('../support/ord');
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.id, tracking_number: 'VN123456' });
    expect([(await orderOf(t, o.id)).status, (await historyOf(t, o.id)).length]).toEqual(['shipped', 3]);
  });

  it('ORD-TC-20261006-150000400 ORD-TC-20261007-182433180: lockForHandoff từ chối đơn pending, cancelled, shipped, expired và đơn không tồn tại (lỗi nghiệp vụ, không để lại cờ); CHECK chặn cờ trên pending và expired; không có route HTTP nào cho lock hay handoff', async () => {
    const { a, staff } = await people(t);
    const [p, c, s, e] = [await seedOrder(t, { user: a.id, status: 'pending' }), await seedOrder(t, { user: a.id, status: 'cancelled' }), await seedOrder(t, { user: a.id, status: 'shipped' }), await seedOrder(t, { user: a.id, status: 'expired' })];
    const before = [await historyOf(t, p.id), await countRows(t, 'outbox_events'), await countRows(t, 'audit_logs')];
    for (const [id, code] of [[p.id, 'not_lockable'], [c.id, 'not_lockable'], [s.id, 'not_lockable'], [e.id, 'not_lockable'], [randomUUID(), 'order_not_found'], ['không-phải-uuid', 'order_not_found']] as const) {
      const err = await lock(id).catch((x) => x);
      expect([id, err instanceof OrderBusinessError && err.code]).toEqual([id, code]);
    }
    for (const o of [p, c, s, e]) expect((await orderOf(t, o.id)).handoff_locked_at).toBeNull();
    expect([await historyOf(t, p.id), await countRows(t, 'outbox_events'), await countRows(t, 'audit_logs')]).toEqual(before);
    expect(await pgCode(q(t, `UPDATE orders SET handoff_locked_at = now() WHERE id = '${p.id}'`))).not.toBe('ok');
    expect(await pgCode(q(t, `UPDATE orders SET handoff_locked_at = now() WHERE id = '${e.id}'`))).not.toBe('ok');
    expect(await pgCode(insertRaw(t, a.id, { status: 'expired', method: 'cod', handoff: new Date(), items: 100000, discount: 0, shipping: 0, grand: 100000 }))).toBe('23514');
    for (const who of [a, staff]) for (const m of ['get', 'post', 'put'] as const) for (const path of [`/orders/${p.code}/lock`, `/orders/${p.code}/handoff`, '/lock', '/handoff', `/admin/orders/${p.code}/handoff`]) expect([404, 405]).toContain((await call(t, m, path, { cookie: who.cookie, body: {} })).status);
  });

  it('ORD-TC-20261006-150000500: gọi lại lockForHandoff giữ giờ khóa đầu; hủy và khóa song song trên 50 đơn paid chỉ một bên thắng (không đơn nào vừa cancelled vừa có cờ); bàn giao rollback thì mở khóa và hủy được', async () => {
    const o6 = await seedOrder(t, { user: (await who(t, 'customer', 'first@x.vn')).id, status: 'paid', handoff: new Date('2026-10-06T10:00:00Z') }); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    t.clock.set(new Date('2026-10-06T10:05:00Z'));
    await lock(o6.id);
    expect((await orderOf(t, o6.id)).handoff_locked_at).toEqual(new Date('2026-10-06T10:00:00Z')); // fixed-clock: mốc của TC, dữ liệu dựng tường minh theo mốc này, không trộn với now() của CSDL
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    const orders = [] as { id: string; code: string; cookie: string }[];
    for (let i = 0; i < 50; i++) { const u = await who(t, 'customer', `lock${i}@x.vn`); orders.push({ ...(await seedOrder(t, { user: u.id, status: 'paid' })), cookie: u.cookie }); }
    const res = await Promise.all(orders.map(async (o) => { const [c, l] = await race(() => cancel(o.code, o.cookie), () => lock(o.id).then(() => 'locked', () => 'refused')); return { o, c, l }; }));
    let won = 0, locked = 0;
    for (const { o, c, l } of res) {
      const row = await orderOf(t, o.id);
      expect(row.status === 'cancelled' && row.handoff_locked_at !== null).toBe(false);
      if (c.status === 200) { won++; expect([l, row.status, row.handoff_locked_at]).toEqual(['refused', 'cancelled', null]); } else { locked++; expect([c.status, l, row.status]).toEqual([409, 'locked', 'paid']); expect(row.handoff_locked_at).not.toBeNull(); }
    }
    expect(won + locked).toBe(50);
    const u7 = await who(t, 'customer', 'rollback@x.vn'), o7 = await seedOrder(t, { user: u7.id, status: 'paid' });
    await expect(t.tx.run(async (tx) => { await t.ord.lockForHandoff(o7.id, tx); throw new Error('mã vận đơn trùng (23505)'); })).rejects.toThrow('23505');
    expect((await orderOf(t, o7.id)).handoff_locked_at).toBeNull();
    expect((await cancel(o7.code, u7.cookie)).status).toBe(200);
    expect((await outboxOf(t, o7.id)).filter((e) => e.type === 'OrderCancelled').map((e) => e.payload.was_paid)).toEqual([true]);
  }, 120_000);
});
