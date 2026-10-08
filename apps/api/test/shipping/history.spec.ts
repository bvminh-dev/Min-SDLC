import { Client } from 'pg';
import { roleDbUrl, truncateAll } from '../support/db';
import { call, countOf, createShpApp, histOf, pgCode, q, seedOrderFor, seedShipment, who, type ShpApp } from '../support/shp';

// Lịch sử vận đơn (SHP-REQ-20261006-101103972): thứ tự theo seq, customer own và không thấy lý do, chỉ thêm (trigger và thu quyền).
describe('SHP lịch sử vận đơn', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const history = (cookie: string | undefined, code: string) => call(t, 'get', `/shipping/orders/${code}/shipment/history`, { cookie });

  it('SHP-TC-20261006-102147349 (T10): customer xem lịch sử ba bước (đúng thứ tự, không khóa người thực hiện); staff thấy lý do thất bại và ghi chú, customer thì không', async () => {
    const [c1, s1] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'staff', 's1@shop.vn')];
    const v1 = await seedShipment(t, { status: 'delivered', user: c1.id, tracking: 'GHN12345678' });
    const r = await history(c1.cookie, v1.order.code);
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { status: string }) => i.status)).toEqual(['pending', 'shipped', 'delivered']);
    expect(r.body.items[1].tracking_number).toBe('GHN12345678');
    for (const i of r.body.items) {
      expect(i.event).toBe('status_changed');
      expect(typeof i.at).toBe('string');
      expect(Object.keys(i).filter((k) => /actor|user|by|reason|note/.test(k))).toEqual([]);
    }
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['at', 'event', 'status']); // dòng pending chưa có mã
    const v2 = await seedShipment(t, { status: 'failed', user: c1.id, reason: 'wrong_address', note: 'Số nhà không tồn tại' });
    const staff = await history(s1.cookie, v2.order.code), cust = await history(c1.cookie, v2.order.code);
    expect(staff.body.items.slice(-1)[0]).toMatchObject({ status: 'failed', reason_code: 'wrong_address', note: 'Số nhà không tồn tại' });
    expect(Object.keys(cust.body.items.slice(-1)[0]).sort()).toEqual(['at', 'event', 'status', 'tracking_number']);
    expect(JSON.stringify(cust.body)).not.toMatch(/Số nhà|wrong_address|reason|note/);
  });

  it('SHP-TC-20261006-102147373 (SB-06, T1): xem lịch sử của đơn người khác, mã không tồn tại và mã sai định dạng cùng 404; guest 401; staff với mã lạ cũng 404', async () => {
    const [c1, c2, s1] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'customer', 'c2@x.vn'), await who(t, 'staff', 's1@shop.vn')];
    const o9 = await seedShipment(t, { status: 'shipped', user: c2.id });
    const rs = [await history(c1.cookie, o9.order.code), await history(c1.cookie, '7K3M9Q2XH4ZZ'), await history(c1.cookie, 'x!')];
    for (const r of rs) { expect(r.status).toBe(404); expect({ ...r.body, trace_id: 0 }).toEqual({ ...rs[0].body, trace_id: 0 }); }
    expect(JSON.stringify(rs[0].body)).not.toMatch(/shipped|pending|"at"/);
    expect((await history(undefined, o9.order.code)).status).toBe(401);
    expect((await history(s1.cookie, '7K3M9Q2XH4ZZ')).status).toBe(404);
    expect((await history(s1.cookie, o9.order.code)).status).toBe(200);
  });

  it('SHP-TC-20261006-102147397 (SB-32, T13): không sửa hoặc xóa được dòng lịch sử bằng API (không có route) hay bằng SQL (trigger chặn UPDATE, DELETE cả với chủ bảng; ứng dụng bị thu quyền và TRUNCATE)', async () => {
    const a1 = await who(t, 'admin', 'a1@shop.vn');
    const v = await seedShipment(t, { status: 'delivered' });
    for (const m of ['put', 'patch', 'delete', 'post'] as const) { const r = await call(t, m, `/shipping/orders/${v.order.code}/shipment/history`, { cookie: a1.cookie, body: {} }); expect([m, [404, 405].includes(r.status)]).toEqual([m, true]); }
    expect((await histOf(t, v.id)).length).toBe(3);
    const before = JSON.stringify(await histOf(t, v.id));
    expect(await pgCode(q(t, `UPDATE shipment_status_history SET status = 'cancelled' WHERE shipment_id = '${v.id}'`))).toBe('23000'); // trigger (chủ bảng cũng bị chặn)
    expect(await pgCode(q(t, `DELETE FROM shipment_status_history WHERE shipment_id = '${v.id}'`))).toBe('23000');
    const app = new Client({ connectionString: roleDbUrl('ecom_app') });
    await app.connect();
    try {
      const code = async (sql: string) => { try { await app.query(sql); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
      expect(await code(`UPDATE shipment_status_history SET status = 'cancelled' WHERE shipment_id = '${v.id}'`)).toBe('42501'); // thiếu quyền
      expect(await code(`DELETE FROM shipment_status_history WHERE shipment_id = '${v.id}'`)).toBe('42501');
      expect(await code('TRUNCATE shipment_status_history')).toBe('42501');
      expect(await code(`INSERT INTO shipment_status_history (shipment_id, event, status) VALUES ('${v.id}', 'status_changed', 'delivered')`)).toBe('ok'); // INSERT vẫn được
      expect(await code(`SELECT count(*) FROM shipment_status_history`)).toBe('ok');
    } finally { await app.end(); }
    expect(JSON.stringify((await histOf(t, v.id)).slice(0, 3))).toBe(JSON.stringify(JSON.parse(before)).replace(/"created_at":"([^"]+)"/g, '"created_at":"$1"'));
    expect(await countOf(t, 'shipment_status_history', `shipment_id = '${v.id}'`)).toBe(4);
  });

  it('SHP-TC-20261006-102147421 (R-05): lịch sử rỗng khi chưa có vận đơn; sửa mã nhiều lần giữ đúng thứ tự; thứ tự theo seq, không theo created_at hay id', async () => {
    const [c1, s1] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'staff', 's1@shop.vn')];
    const o5 = await seedOrderFor(t, { user: c1.id, status: 'pending' });
    const empty = await history(c1.cookie, o5.code);
    expect([empty.status, empty.body]).toEqual([200, { items: [] }]);
    const v = await seedShipment(t, { status: 'shipped', tracking: 'GHN00000001', version: 2 });
    for (const [i, tr] of ['GHN00000002', 'GHN00000003'].entries()) {
      t.clock.advance(1000);
      expect((await call(t, 'patch', `/shipping/orders/${v.order.code}/shipment/tracking-number`, { cookie: s1.cookie, body: { tracking_number: tr, version: 2 + i } })).status).toBe(200);
    }
    const r = await history(s1.cookie, v.order.code);
    expect(r.body.items.map((i: { event: string; status: string; tracking_number?: string }) => [i.event, i.status, i.tracking_number ?? null])).toEqual([
      ['status_changed', 'pending', null], ['status_changed', 'shipped', 'GHN00000001'], ['tracking_changed', 'shipped', 'GHN00000002'], ['tracking_changed', 'shipped', 'GHN00000003'],
    ]);
    // hai dòng cùng created_at đến mili giây, id dòng sau NHỎ hơn dòng trước
    const w = await seedShipment(t, { status: 'pending', noHistory: true });
    const at = new Date(t.clock.now().getTime());
    await q(t, `INSERT INTO shipment_status_history (id, shipment_id, event, status, created_at) VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', '${w.id}', 'status_changed', 'pending', '${at.toISOString()}')`);
    await q(t, `INSERT INTO shipment_status_history (id, shipment_id, event, status, created_at) VALUES ('00000000-0000-4000-8000-000000000000', '${w.id}', 'status_changed', 'cancelled', '${at.toISOString()}')`);
    for (let i = 0; i < 5; i++) expect((await history(s1.cookie, w.order.code)).body.items.map((x: { status: string }) => x.status)).toEqual(['pending', 'cancelled']);
    const seqs = (await histOf(t, w.id)).map((h) => Number(h.seq));
    expect(seqs[0]).toBeLessThan(seqs[1]);
  });
});
