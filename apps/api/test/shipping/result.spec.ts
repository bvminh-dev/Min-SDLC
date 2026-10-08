import { DomainError, OutboxRelay, type SessionContext } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { act, call, countOf, createShpApp, histOf, q, race, seedShipment, shipmentRow, shpAudits, shpOutbox, snapshotCounts, who, type ShipStatus, type ShpApp } from '../support/shp';

// Kết quả giao (SHP-REQ-20261006-101103903): giao xong, thất bại kèm lý do, hoàn hàng; bảng chuyển trạng thái là nguồn duy nhất; ghi nhận đúng một lần.
const staffCtx = (id: string): SessionContext => ({ user_id: id, role: 'staff', email_verified: true });

describe('SHP kết quả giao', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const relay = () => t.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000));
  const orderRow = async (id: string) => (await q<{ status: string }>(t, `SELECT status::text FROM orders WHERE id = '${id}'`))[0].status;

  it('SHP-TC-20261006-102133795 (T12): staff xác nhận giao xong vận đơn COD đang giao: delivered_at do server đặt, cod_amount giữ nguyên, một ShipmentDelivered, ORD nhận thì đơn delivered', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'shipped', payment: 'cod', cod: 380000, version: 2 });
    const bad = await act(t, s1.cookie, v.order.code, 'deliver', { delivered_at: '2020-01-01T00:00:00Z' });
    expect(bad.status).toBe(400);
    const r = await act(t, s1.cookie, v.order.code, 'deliver');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ order_code: v.order.code, status: 'delivered', version: 3 });
    expect(Math.abs(Date.parse(r.body.delivered_at) - t.clock.now().getTime())).toBeLessThan(2000);
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.cod_amount, row.version]).toEqual(['delivered', '380000', 3]);
    expect((await histOf(t, v.id)).filter((h) => h.status === 'delivered')).toHaveLength(1);
    const a = await shpAudits(t, v.id, 'shipping.shipment.deliver');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: s1.id, actor_role: 'staff', before: { status: 'shipped' }, after: { status: 'delivered' } });
    const ev = await shpOutbox(t, v.id);
    expect(ev.map((e) => e.type)).toEqual(['ShipmentDelivered']);
    expect(ev[0].payload).toEqual({ shipment_id: v.id, order_id: v.order.id });
    await relay();
    expect(await orderRow(v.order.id)).toBe('delivered'); // ORD (consumer thật) chuyển đơn; SHP không ghi bảng nào khác của module khác
    expect(await countOf(t, 'outbox_events', `type NOT LIKE 'Shipment%' AND type NOT IN ('OrderDelivered')`)).toBe(0);
  });

  it('SHP-TC-20261006-102133819 (T10): staff báo giao thất bại, ShipmentFailed chỉ mang mã lý do (đúng năm khóa, không note); lịch sử lưu lý do và ghi chú; ghi chú tùy chọn', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'shipped' });
    const r = await act(t, s1.cookie, v.order.code, 'fail', { reason_code: 'customer_unreachable', note: 'Gọi 3 lần không nghe máy' });
    expect([r.status, r.body.status]).toEqual([200, 'failed']);
    const h = (await histOf(t, v.id)).slice(-1)[0];
    expect(h).toMatchObject({ status: 'failed', reason_code: 'customer_unreachable', note: 'Gọi 3 lần không nghe máy' });
    const ev = await shpOutbox(t, v.id);
    expect(ev.map((e) => e.type)).toEqual(['ShipmentFailed']);
    expect(Object.keys(ev[0].payload).sort()).toEqual(['order_code', 'order_id', 'reason', 'shipment_id', 'user_id']);
    expect(ev[0].payload).toEqual({ shipment_id: v.id, order_id: v.order.id, order_code: v.order.code, user_id: v.order.user, reason: 'customer_unreachable' });
    expect(JSON.stringify(ev[0].payload)).not.toContain('Gọi 3 lần');
    expect(await shpAudits(t, v.id, 'shipping.shipment.fail')).toHaveLength(1);
    await relay(); // ORD ghi một dòng lịch sử tự trỏ shipped -> shipped mang mã lý do, đơn vẫn shipped
    expect(await orderRow(v.order.id)).toBe('shipped');
    expect(await countOf(t, 'order_status_history', `order_id = '${v.order.id}' AND from_status = 'shipped' AND to_status = 'shipped' AND reason = 'customer_unreachable'`)).toBe(1);
    const w = await seedShipment(t, { status: 'shipped' });
    expect((await act(t, s1.cookie, w.order.code, 'fail', { reason_code: 'refused' })).status).toBe(200); // không có note cũng được
    expect((await histOf(t, w.id)).slice(-1)[0].note).toBeNull();
    const x = await seedShipment(t, { status: 'shipped' });
    expect((await act(t, s1.cookie, x.order.code, 'fail', { reason_code: 'other', note: '   ' })).status).toBe(200); // chỉ khoảng trắng coi như không có
    expect((await histOf(t, x.id)).slice(-1)[0].note).toBeNull();
  });

  it('SHP-TC-20261006-102133844: admin xác nhận hàng hoàn về kho: restockable true, false khi lý do trước đó là damaged; payload ShipmentReturned không có order_code, user_id, danh sách hàng; gọi lần hai 409', async () => {
    const a1 = await who(t, 'admin', 'a1@shop.vn');
    const f = await seedShipment(t, { status: 'failed', reason: 'wrong_address' }), d = await seedShipment(t, { status: 'failed', reason: 'damaged' });
    const r = await act(t, a1.cookie, f.order.code, 'return');
    expect([r.status, r.body.status]).toEqual([200, 'returned']);
    expect((await histOf(t, f.id)).filter((h) => h.status === 'returned')).toHaveLength(1);
    const ev = await shpOutbox(t, f.id);
    expect(ev.map((e) => e.type)).toEqual(['ShipmentReturned']);
    expect(ev[0].payload).toEqual({ shipment_id: f.id, order_id: f.order.id, restockable: true });
    await act(t, a1.cookie, d.order.code, 'return');
    expect((await shpOutbox(t, d.id))[0].payload).toEqual({ shipment_id: d.id, order_id: d.order.id, restockable: false });
    const again = await act(t, a1.cookie, f.order.code, 'return');
    expect([again.status, again.body.type]).toEqual([409, 'urn:ecom:error:shipment-invalid-transition']);
    expect(await shpOutbox(t, f.id)).toHaveLength(1);
    // hoàn hàng không tự hoàn tiền: SHP chỉ phát ShipmentReturned
    expect(await countOf(t, 'outbox_events', `type NOT LIKE 'Shipment%'`)).toBe(0);
    await relay();
    expect(await orderRow(f.order.id)).toBe('returned'); // ORD nhận ShipmentReturned
    // dòng failed MỚI NHẤT (theo seq) quyết định restockable
    const m = await seedShipment(t, { status: 'failed', reason: 'damaged' });
    await q(t, `INSERT INTO shipment_status_history (shipment_id, event, status, reason_code) VALUES ('${m.id}', 'status_changed', 'failed', 'refused')`);
    await act(t, a1.cookie, m.order.code, 'return');
    expect((await shpOutbox(t, m.id))[0].payload.restockable).toBe(true);
  });

  it('SHP-TC-20261006-102133868 (SB-24, T7): ma trận 6 trạng thái x 3 hành động: chỉ shipped-deliver, shipped-fail, failed-return hợp lệ; 15 ô còn lại 409, không đổi trạng thái, lịch sử, audit hay outbox', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const states: ShipStatus[] = ['pending', 'shipped', 'delivered', 'failed', 'returned', 'cancelled'];
    const actions = ['deliver', 'fail', 'return'] as const;
    const valid = new Set(['shipped:deliver', 'shipped:fail', 'failed:return']);
    let invalid = 0;
    for (const st of states) for (const ac of actions) {
      const v = await seedShipment(t, { status: st });
      const before = await snapshotCounts(t);
      const row0 = await shipmentRow(t, v.id);
      const r = await act(t, s1.cookie, v.order.code, ac, ac === 'fail' ? { reason_code: 'other' } : {});
      if (valid.has(`${st}:${ac}`)) { expect([`${st}:${ac}`, r.status]).toEqual([`${st}:${ac}`, 200]); continue; }
      invalid++;
      expect([`${st}:${ac}`, r.status, r.body.type]).toEqual([`${st}:${ac}`, 409, 'urn:ecom:error:shipment-invalid-transition']);
      const row = await shipmentRow(t, v.id);
      expect([row.status, row.version, row.tracking_number]).toEqual([row0.status, row0.version, row0.tracking_number]);
      expect(await snapshotCounts(t)).toEqual(before);
    }
    expect(invalid).toBe(15);
  });

  it('SHP-TC-20261006-102133893 (SB-11, SB-05, T3): báo kết quả với dữ liệu sai hoặc sai quyền bị từ chối; bỏ qua bước failed thì 409', async () => {
    const [s1, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    const v = await seedShipment(t, { status: 'shipped', user: c1.id });
    const bads: [string, unknown][] = [['reason_code', {}], ['reason_code', { reason_code: 'lost' }], ['status', { reason_code: 'other', status: 'failed' }], ['note', { reason_code: 'other', note: 123 }],
      ['note', { reason_code: 'other', note: 'a\u0000b' }], ['reason_code', { reason_code: 'OTHER' }]];
    for (const [field, body] of bads) {
      const r = await act(t, s1.cookie, v.order.code, 'fail', body);
      expect([field, r.status, r.body.type]).toEqual([field, 400, 'urn:ecom:error:validation-failed']);
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    }
    expect((await shipmentRow(t, v.id)).status).toBe('shipped');
    for (const ac of ['deliver', 'fail', 'return'] as const) {
      expect([ac, (await act(t, c1.cookie, v.order.code, ac, ac === 'fail' ? { reason_code: 'other' } : {})).status]).toEqual([ac, 403]); // chủ đơn không có quyền
      expect([ac, (await act(t, undefined, v.order.code, ac, ac === 'fail' ? { reason_code: 'other' } : {})).status]).toEqual([ac, 401]);
    }
    expect((await shipmentRow(t, v.id)).status).toBe('shipped');
    const skip = await act(t, s1.cookie, v.order.code, 'return');
    expect([skip.status, skip.body.type]).toEqual([409, 'urn:ecom:error:shipment-invalid-transition']);
    expect((await act(t, s1.cookie, v.order.code, 'deliver', { x: 1 })).status).toBe(400); // body của deliver phải rỗng
    expect((await act(t, s1.cookie, 'zzzz', 'deliver')).status).toBe(404);
  });

  it('SHP-TC-20261006-102133916 (SB-12, SB-18, T14): ghi chú thất bại 300 ký tự hợp lệ, 301 bị 400; nội dung HTML lưu và trả nguyên văn, không vào log', async () => {
    const [s1, a1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn')];
    const [v1, v2, v3] = [await seedShipment(t, { status: 'shipped' }), await seedShipment(t, { status: 'shipped' }), await seedShipment(t, { status: 'shipped' })];
    expect((await act(t, s1.cookie, v1.order.code, 'fail', { reason_code: 'other', note: 'x'.repeat(300) })).status).toBe(200);
    expect((await act(t, s1.cookie, v2.order.code, 'fail', { reason_code: 'other', note: 'x'.repeat(301) })).status).toBe(400);
    expect((await shipmentRow(t, v2.id)).status).toBe('shipped');
    const emoji = '😀'.repeat(300); // 300 ký tự Unicode (600 đơn vị UTF-16): đếm theo ký tự, khớp char_length của PostgreSQL
    const v4 = await seedShipment(t, { status: 'shipped' });
    expect((await act(t, s1.cookie, v4.order.code, 'fail', { reason_code: 'other', note: emoji })).status).toBe(200);
    const html = '<script>alert(1)</script>';
    expect((await act(t, s1.cookie, v3.order.code, 'fail', { reason_code: 'other', note: html })).status).toBe(200);
    expect((await histOf(t, v3.id)).slice(-1)[0].note).toBe(html);
    const detail = await call(t, 'get', `/shipping/orders/${v3.order.code}/shipment`, { cookie: a1.cookie });
    expect(detail.body.shipment.note).toBe(html); // API trả nguyên văn; escape là việc của giao diện (E2E)
    expect(t.logs.lines.join('\n')).not.toContain('alert(1)');
  });

  it('SHP-TC-20261006-102133941 (SB-24, T7): hai nhân viên báo giao xong và giao thất bại cùng lúc, chỉ một thắng (100 vòng); đúng một event và một dòng lịch sử mới', async () => {
    const [s1, s2] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'staff', 's2@shop.vn')];
    const owner = await who(t, 'customer', 'chu@x.vn');
    const out = { delivered: 0, failed: 0 };
    for (let i = 0; i < 100; i++) {
      const v = await seedShipment(t, { status: 'shipped', user: owner.id });
      const hist0 = (await histOf(t, v.id)).length;
      const [a, b] = await race(
        () => t.ships.deliver(staffCtx(s1.id), v.order.code).then(() => 'ok', (e) => (e as DomainError).code),
        () => t.ships.fail(staffCtx(s2.id), v.order.code, { reason_code: 'refused' }).then(() => 'ok', (e) => (e as DomainError).code),
      );
      expect([a, b].sort()).toEqual(['ok', 'shipment-invalid-transition']);
      const row = await shipmentRow(t, v.id);
      expect(['delivered', 'failed']).toContain(row.status);
      out[row.status as 'delivered' | 'failed']++;
      const ev = await shpOutbox(t, v.id);
      expect(ev.map((e) => e.type)).toEqual([row.status === 'delivered' ? 'ShipmentDelivered' : 'ShipmentFailed']);
      expect((await histOf(t, v.id)).length).toBe(hist0 + 1);
    }
    expect(out.delivered + out.failed).toBe(100);
  }, 180_000);
});
