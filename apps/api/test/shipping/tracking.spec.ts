import { truncateAll } from '../support/db';
import { call, createShpApp, histOf, q, seedShipment, shipmentRow, shpAudits, shpOutbox, sleep, snapshotCounts, who, type ShpApp } from '../support/shp';

// Sửa mã vận đơn (SHP-REQ-20261006-101103880): chỉ khi shipped, khóa lạc quan version, lịch sử tracking_changed, ShipmentTrackingChanged.
describe('SHP sửa mã vận đơn', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const patch = (cookie: string | undefined, code: string, body: unknown) => call(t, 'patch', `/shipping/orders/${code}/shipment/tracking-number`, { cookie, body });

  it('SHP-TC-20261006-102133722: staff sửa mã vận đơn đang giao, ghi lịch sử tracking_changed, giữ nguyên trạng thái và shipped_at; một ShipmentTrackingChanged, không ShipmentShipped thứ hai', async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678', version: 2 });
    const before = await shipmentRow(t, v.id);
    const r = await patch(s1.cookie, v.order.code, { tracking_number: 'GHN12345679', version: 2 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ order_code: v.order.code, status: 'shipped', tracking_number: 'GHN12345679', version: 3 });
    const row = await shipmentRow(t, v.id);
    expect([row.status, row.shipped_at, row.version]).toEqual(['shipped', before.shipped_at, 3]);
    const h = await histOf(t, v.id);
    expect(h.slice(-1)[0]).toMatchObject({ event: 'tracking_changed', status: 'shipped', tracking_number: 'GHN12345679' });
    expect(h.filter((x) => x.event === 'tracking_changed')).toHaveLength(1);
    const a = await shpAudits(t, v.id, 'shipping.shipment.tracking');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: s1.id, actor_role: 'staff', before: { tracking_number: 'GHN12345678' }, after: { tracking_number: 'GHN12345679' } });
    const ev = await shpOutbox(t, v.id);
    expect(ev.map((e) => e.type)).toEqual(['ShipmentTrackingChanged']);
    expect(ev[0].payload).toEqual({ shipment_id: v.id, order_id: v.order.id, tracking_number: 'GHN12345679' });
    // sửa không thành công (trùng mã, sai định dạng) không tạo dòng outbox
    await seedShipment(t, { status: 'shipped', tracking: 'VTP99887766' });
    await patch(s1.cookie, v.order.code, { tracking_number: 'vtp99887766', version: 3 });
    await patch(s1.cookie, v.order.code, { tracking_number: 'x', version: 3 });
    expect((await shpOutbox(t)).length).toBe(1);
  });

  it('SHP-TC-20261006-102133746 (SB-24, T8): sửa mã ở trạng thái không cho phép, sai định dạng hoặc trùng bị từ chối; quyền rồi schema rồi 404 rồi trạng thái', async () => {
    const [s1, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    const p = await seedShipment(t, { status: 'pending' }), d = await seedShipment(t, { status: 'delivered', tracking: 'GHN00009999' });
    const s = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678', version: 2 }); await seedShipment(t, { status: 'shipped', tracking: 'VTP99887766' });
    for (const x of [p, d]) { const r = await patch(s1.cookie, x.order.code, { tracking_number: 'GHN77776666', version: 99 }); expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:shipment-invalid-transition']); }
    expect([(await shipmentRow(t, p.id)).tracking_number, (await shipmentRow(t, d.id)).tracking_number]).toEqual([null, 'GHN00009999']);
    for (const bad of ['', 'ABC', 'ghn!2345678']) expect([bad, (await patch(s1.cookie, s.order.code, { tracking_number: bad, version: 2 })).status]).toEqual([bad, 400]);
    const dup = await patch(s1.cookie, s.order.code, { tracking_number: 'vtp99887766', version: 2 });
    expect([dup.status, dup.body.type]).toEqual([409, 'urn:ecom:error:tracking-number-taken']);
    expect((await shipmentRow(t, s.id)).tracking_number).toBe('GHN12345678');
    expect([(await patch(c1.cookie, s.order.code, { tracking_number: 'GHN12345679', version: 2 })).status, (await patch(undefined, s.order.code, { tracking_number: 'GHN12345679', version: 2 })).status]).toEqual([403, 401]);
    expect((await patch(s1.cookie, s.order.code, { tracking_number: 'GHN12345679' })).status).toBe(400); // thiếu version
    expect((await patch(s1.cookie, s.order.code, { tracking_number: 'GHN12345679', version: 2, status: 'delivered' })).status).toBe(400);
    expect((await patch(s1.cookie, 'x!', { tracking_number: 'GHN12345679', version: 2 })).status).toBe(404);
  });

  it('SHP-TC-20261006-102133770: sửa mã chỉ khác hoa thường bị từ chối (unchanged), hai nhân viên sửa cùng lúc thì người sau gặp version-conflict, vận đơn vừa delivered thì shipment-invalid-transition', async () => {
    const [s1, s2] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'staff', 's2@shop.vn')];
    const v = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678', version: 2 });
    const same = await patch(s1.cookie, v.order.code, { tracking_number: 'ghn12345678', version: 2 });
    expect([same.status, same.body.type]).toEqual([409, 'urn:ecom:error:tracking-number-unchanged']);
    const counts = await snapshotCounts(t);
    expect([(await shipmentRow(t, v.id)).version, counts]).toEqual([2, counts]);
    expect((await patch(s1.cookie, v.order.code, { tracking_number: 'GHN12345679', version: 2 })).body.version).toBe(3);
    const staleSame = await patch(s2.cookie, v.order.code, { tracking_number: 'GHN12345679', version: 2 }); // version cũ và mã trùng mã hiện tại: version-conflict đứng trước unchanged
    expect([staleSame.status, staleSame.body.type]).toEqual([409, 'urn:ecom:error:version-conflict']);
    const stale = await patch(s2.cookie, v.order.code, { tracking_number: 'GHN12345680', version: 2 });
    expect([stale.status, stale.body.type]).toEqual([409, 'urn:ecom:error:version-conflict']);
    expect([(await shipmentRow(t, v.id)).tracking_number, (await histOf(t, v.id)).filter((h) => h.event === 'tracking_changed').length]).toEqual(['GHN12345679', 1]);
    // giao dịch deliver giữ khóa dòng và commit trước khi PATCH lấy được khóa
    let release: () => void = () => undefined, started: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; }), up = new Promise<void>((r) => { started = r; });
    const holder = t.tx.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${v.id}::uuid FOR UPDATE`;
      started();
      await gate;
      await tx.$executeRaw`UPDATE shipments SET status = 'delivered'::shipment_status, delivered_at = now(), version = version + 1 WHERE id = ${v.id}::uuid`;
    });
    await up;
    const pending = Promise.resolve(patch(s1.cookie, v.order.code, { tracking_number: 'GHN12345681', version: 3 })); // chờ khóa dòng
    await sleep(300);
    release();
    await holder;
    const late = await pending;
    expect([late.status, late.body.type]).toEqual([409, 'urn:ecom:error:shipment-invalid-transition']);
    expect((await shipmentRow(t, v.id)).tracking_number).toBe('GHN12345679');
    expect(await q(t, `SELECT 1 FROM shipments WHERE status = 'delivered' AND tracking_number <> 'GHN12345679'`)).toEqual([]);
  });
});
