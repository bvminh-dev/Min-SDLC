import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/modules/platform';
import { q } from '../support/auth';
import { newPrisma, roleDbUrl, truncateAll } from '../support/db';
import { baseInput, call, createOrdApp, createPending, deliver, historyOf, people, pgCode, seedOrder, sqlOf, type OrdApp } from '../support/ord';

// Lịch sử trạng thái (ORD-REQ-20261006-092320812): theo thứ tự ghi (seq), chỉ thêm, không lộ người thực hiện, đồng nhất 404.
describe('ORD lịch sử trạng thái đơn', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); });
  const get = (path: string, cookie?: string) => call(t, 'get', path, { cookie });
  const strip = ({ trace_id: _t, ...r }: any) => r;
  const base = () => t.clock.now().getTime();

  it('ORD-TC-20261006-111225824: customer xem lịch sử đi qua pending, paid, shipped theo thứ tự ghi (cũ nhất trước), mỗi dòng chỉ có at và status', async () => {
    const { a } = await people(t);
    const b0 = base();
    const { code } = await createPending(t, baseInput(a.id));
    await createPending(t, baseInput(a.id)); // đơn thứ hai để chắc không lẫn lịch sử giữa đơn
    const id = (await q<{ id: string }>(t, `SELECT id FROM orders WHERE code = '${code}'`))[0].id;
    t.clock.set(new Date(b0 + 5 * 60_000));
    await deliver(t, 'PaymentSucceeded', { order_id: id, payment_id: randomUUID(), paid_at: new Date(b0 + 5 * 60_000).toISOString() });
    t.clock.set(new Date(b0 + 150 * 60_000));
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: id, tracking_number: 'VN123456' });
    t.clock.set(new Date(b0 + 60_000)); // phiên của AUTH hết hạn sau 30 phút theo đồng hồ giả: đọc lại ở thời điểm gần mốc đầu
    const r = await get(`/orders/${code}/status-history`, a.cookie);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([{ at: new Date(b0).toISOString(), status: 'pending' }, { at: new Date(b0 + 5 * 60_000).toISOString(), status: 'paid' }, { at: new Date(b0 + 150 * 60_000).toISOString(), status: 'shipped' }]);
    expect(JSON.stringify(r.body)).not.toMatch(/actor|user_id|"by"/);
  });

  it('ORD-TC-20261006-111225853: đơn paid bị hủy với lý do: customer và admin đều thấy dòng cuối cancelled kèm lý do, các dòng trước không có reason, không có khóa người hủy', async () => {
    const { a, admin } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '8M2N4P6R8S0T', status: 'paid' });
    const at = t.clock.now().toISOString();
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: a.cookie, body: { reason: 'đặt nhầm' } })).status).toBe(200);
    for (const who of [a, admin]) {
      const r = await get(`/orders/${o.code}/status-history`, who.cookie);
      expect(r.status).toBe(200);
      expect(r.body.items.at(-1)).toEqual({ at, status: 'cancelled', reason: 'đặt nhầm' });
      expect(r.body.items.slice(0, -1).every((i: any) => !('reason' in i))).toBe(true);
      expect(JSON.stringify(r.body)).not.toMatch(/actor|email|"by"/);
    }
  });

  it('ORD-TC-20261006-111225882: staff xem lịch sử đơn của customer bất kỳ (đúng như chủ đơn thấy); mã không tồn tại là 404 not-found', async () => {
    const { b, staff } = await people(t);
    const o = await seedOrder(t, { user: b.id, status: 'paid' });
    const [s, own, none] = [await get(`/orders/${o.code}/status-history`, staff.cookie), await get(`/orders/${o.code}/status-history`, b.cookie), await get('/orders/9X9X9X9X9X9X/status-history', staff.cookie)];
    expect([s.status, s.body.items.map((i: any) => i.status)]).toEqual([200, ['pending', 'paid']]);
    expect(s.body).toEqual(own.body);
    expect([none.status, none.body.type]).toEqual([404, 'urn:ecom:error:not-found']);
  });

  it('ORD-TC-20261006-111225911: customer xem lịch sử đơn của người khác nhận 404 giống hệt đơn không tồn tại, không 403; câu truy vấn lịch sử không chạy khi đơn không thuộc customer', async () => {
    const { a, b } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '5C7D9F1G3H5J' });
    const spy = jest.spyOn(t.app.get(PrismaService), '$queryRaw');
    try {
      const [x, y] = [await get(`/orders/${o.code}/status-history`, a.cookie), await get('/orders/9X9X9X9X9X9X/status-history', a.cookie)];
      for (const r of [x, y]) { expect(r.status).toBe(404); expect(r.headers['content-type']).toMatch(/application\/problem\+json/); }
      expect(JSON.stringify(strip(x.body))).toBe(JSON.stringify(strip(y.body)));
      expect(sqlOf(spy.mock.calls).filter((s) => /order_status_history/.test(s))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('ORD-TC-20261006-111225940: guest và phiên hết hạn xem lịch sử nhận 401, không có items', async () => {
    const r = await get('/orders/7K3M9Q2XH4TB/status-history');
    expect([r.status, r.body.type, r.body.items]).toEqual([401, 'urn:ecom:error:unauthenticated', undefined]);
  });

  it('ORD-TC-20261006-111225969: không route nào sửa hay xóa lịch sử (404 hoặc 405); ở tầng CSDL UPDATE, DELETE bị trigger chặn kể cả superuser, vai trò ứng dụng không có quyền sửa, xóa, TRUNCATE; xóa đơn bị RESTRICT', async () => {
    const { b, staff, admin } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'cancelled', cancel: { reason: 'customer_request', by: 'customer', text: 'đặt nhầm' } });
    const rows = await historyOf(t, o.id);
    for (const who of [b, staff, admin]) for (const m of ['put', 'patch', 'delete'] as const) for (const p of [`/orders/${o.code}/status-history`, `/orders/${o.code}/status-history/${rows[0].seq}`]) expect([404, 405]).toContain((await call(t, m, p, { cookie: who.cookie, body: {} })).status);
    expect(await historyOf(t, o.id)).toEqual(rows);
    const msg = async (sql: string) => { try { await q(t, sql); return 'ok'; } catch (e) { return String((e as Error).message); } };
    expect(await msg(`UPDATE order_status_history SET reason = 'x' WHERE order_id = '${o.id}'`)).toMatch(/append-only/);
    expect(await msg(`UPDATE order_status_history SET to_status = 'paid' WHERE order_id = '${o.id}'`)).toMatch(/append-only/);
    expect(await msg(`DELETE FROM order_status_history WHERE order_id = '${o.id}'`)).toMatch(/append-only/);
    expect(await msg(`DELETE FROM orders WHERE id = '${o.id}'`)).not.toBe('ok'); // ON DELETE RESTRICT từ lịch sử
    const app = newPrisma(roleDbUrl('ecom_app'));
    try {
      for (const run of [() => app.$executeRaw`UPDATE order_status_history SET reason = 'x'`, () => app.$executeRaw`DELETE FROM order_status_history`, () => app.$executeRaw`TRUNCATE order_status_history`]) expect(await pgCode(run())).toBe('42501'); // thu quyền chặn trước cả trigger (không phải 23000 của trigger)
    } finally { await app.$disconnect(); }
    expect(await historyOf(t, o.id)).toEqual(rows);
  });

  it('ORD-TC-20261006-111225998: đơn hủy không kèm lý do (body {} hoặc reason rỗng) thì dòng cancelled không có khóa reason và cột reason là NULL', async () => {
    const { a } = await people(t);
    const [x, y] = [await seedOrder(t, { user: a.id, code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod' }), await seedOrder(t, { user: a.id, code: '3B5D7F9H1K3M', status: 'confirmed', method: 'cod' })];
    expect((await call(t, 'post', `/orders/${x.code}/cancel`, { cookie: a.cookie, body: {} })).status).toBe(200);
    expect((await call(t, 'post', `/orders/${y.code}/cancel`, { cookie: a.cookie, body: { reason: '' } })).status).toBe(200);
    for (const o of [x, y]) {
      const last = (await get(`/orders/${o.code}/status-history`, a.cookie)).body.items.at(-1);
      expect(Object.keys(last).sort()).toEqual(['at', 'status']);
      expect((await historyOf(t, o.id)).at(-1)?.reason).toBeNull();
    }
  });

  it('ORD-TC-20261006-111226027: đơn pending vừa tạo qua createPending chỉ có một dòng lịch sử, không reason; đọc không sinh dòng thừa', async () => {
    const { a } = await people(t);
    const { order_id, code } = await createPending(t, baseInput(a.id));
    const r = await get(`/orders/${code}/status-history`, a.cookie);
    expect(r.body.items).toEqual([{ at: t.clock.now().toISOString(), status: 'pending' }]);
    await get(`/orders/${code}/status-history`, a.cookie);
    expect(await historyOf(t, order_id)).toHaveLength(1);
  });

  it('ORD-TC-20261006-111226057: đơn COD qua CHK (createPending + confirmCod cùng giao dịch) có lịch sử pending, confirmed, shipped, delivered theo seq ổn định trên 20 đơn, không có paid; pending và confirmed cùng created_at; truy vấn ORDER BY seq', async () => {
    const { a } = await people(t);
    const spy = jest.spyOn(t.app.get(PrismaService), '$queryRaw');
    try {
      for (let k = 0; k < 20; k++) {
        const { order_id, code } = await t.tx.run(async (tx) => { const c = await t.ord.createPending(baseInput(a.id, { payment_method: 'cod', payment_expires_at: null }), tx); await t.ord.confirmCod(c.order_id, tx); return c; });
        t.clock.advance(1000);
        await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id, tracking_number: `VN${k}` });
        t.clock.advance(1000);
        await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id });
        const r = await get(`/orders/${code}/status-history`, a.cookie);
        expect(r.body.items.map((i: any) => i.status)).toEqual(['pending', 'confirmed', 'shipped', 'delivered']);
        const h = await historyOf(t, order_id);
        expect(h[0].created_at.getTime()).toBe(h[1].created_at.getTime()); // cùng giao dịch, cùng thời điểm: chỉ seq phân biệt thứ tự
        expect(Number(h[0].seq)).toBeLessThan(Number(h[1].seq));
        t.clock.advance(61_000);
      }
      const sql = sqlOf(spy.mock.calls).filter((s) => /FROM order_status_history/.test(s)).join('\n');
      expect(sql).toMatch(/ORDER BY seq/);
      expect(sql).not.toMatch(/ORDER BY[^\n]*(created_at|\bid\b)/);
    } finally { spy.mockRestore(); }
  }, 120_000);

  it('ORD-TC-20261006-111226087: event trùng hoặc bị từ chối không để lại dòng lịch sử (paid 2 dòng, cancelled 2 dòng, delivered 4 dòng)', async () => {
    const { a } = await people(t);
    const [paid, cancelled, delivered] = [await seedOrder(t, { user: a.id, status: 'paid' }), await seedOrder(t, { user: a.id, status: 'cancelled' }), await seedOrder(t, { user: a.id, status: 'delivered' })];
    const evPaid = randomUUID();
    await deliver(t, 'PaymentSucceeded', { order_id: paid.id, payment_id: randomUUID() }, evPaid);
    await deliver(t, 'PaymentSucceeded', { order_id: paid.id, payment_id: randomUUID() }, evPaid);
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: cancelled.id, tracking_number: 'VN1' });
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: delivered.id, tracking_number: 'VN2' });
    await deliver(t, 'PaymentFailed', { order_id: delivered.id, payment_id: randomUUID(), is_final: true, attempt_no: 3, reason: 'declined' });
    expect([(await historyOf(t, paid.id)).length, (await historyOf(t, cancelled.id)).length, (await historyOf(t, delivered.id)).length]).toEqual([2, 2, 4]);
    for (const [o, hidden] of [[cancelled, 'shipped'], [delivered, 'cancelled']] as const) {
      const r = await get(`/orders/${o.code}/status-history`, a.cookie);
      expect(r.body.items.map((i: any) => i.status)).not.toContain(hidden === 'shipped' ? 'shipped' : 'cancelled');
    }
  });
});
