import { randomUUID } from 'node:crypto';
import { AuditService, DomainError, EventsService, OutboxRelay, runWithCorrelation, type EventEnvelope, type SessionContext } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { call, countOf, createShpApp, failingInsert, histOf, q, race, seedMethod, seedOrderFor, seedShipment, shipmentRow, shpAudits, shpOutbox, snapshotCounts, trackingOf, who, type ShipStatus, type ShpApp } from '../support/shp';

// Bẫy rút từ các epic trước (spec/lessons): bảng quy tắc phủ từng ô, chuỗi biên (nửa cặp thay thế lẻ, NUL), trần tài nguyên gấp triệu lần, đếm giới hạn song song, event hỏng hình dạng,
// tải hỗn hợp kiểm bảo toàn, rollback khi audit hay lịch sử lỗi. Mang ID tài liệu SHP-SEC vì chưa có TC riêng cho các bẫy này.
const SEC = 'SHP-SEC-20261006-101603066';
const sess = (id: string, role: 'staff' | 'admin' = 'staff'): SessionContext => ({ user_id: id, role, email_verified: true });

describe('SHP bẫy bổ sung của review (mã mới, test mới)', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });
  const raw = async (type: string, payload: unknown, eventId: string = randomUUID()) => {
    const events = t.app.get(EventsService);
    const env = { event_id: eventId, type, aggregate_type: 'order', aggregate_id: randomUUID(), payload, occurred_at: new Date().toISOString(), correlation_id: 'rev-corr' } as unknown as EventEnvelope;
    await runWithCorrelation(env.correlation_id, async () => { for (const sub of events.consumersFor(type)) await events.deliver(sub, env); });
  };

  it(`SHP-TC-20261006-102133480 SHP-TC-20261006-102147270 ${SEC} T18, T7 (ma trận): OrderPaid và OrderConfirmed tạo vận đơn CHỈ khi đơn paid hoặc confirmed (8 trạng thái đơn x 2 event); OrderCancelled chỉ đổi vận đơn pending (6 trạng thái vận đơn): các ô còn lại không đổi gì và có log`, async () => {
    const m = await seedMethod(t);
    const statuses = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned'] as const;
    for (const type of ['OrderPaid', 'OrderConfirmed']) for (const st of statuses) {
      const o = await seedOrderFor(t, { status: st, method: st === 'confirmed' ? 'cod' : 'vnpay', shippingMethod: m });
      await raw(type, { order_id: o.id });
      const n = await countOf(t, 'shipments', `order_id = '${o.id}'`);
      expect([type, st, n]).toEqual([type, st, st === 'paid' || st === 'confirmed' ? 1 : 0]);
    }
    const states: ShipStatus[] = ['pending', 'shipped', 'delivered', 'failed', 'returned', 'cancelled'];
    for (const st of states) {
      const v = await seedShipment(t, { status: st });
      const row0 = await shipmentRow(t, v.id), h0 = (await histOf(t, v.id)).length;
      t.logs.clear();
      await raw('OrderCancelled', { order_id: v.order.id, order_code: v.order.code, user_id: v.order.user, reason: 'customer_request', was_paid: true });
      const row = await shipmentRow(t, v.id);
      if (st === 'pending') { expect([row.status, row.version, (await histOf(t, v.id)).length]).toEqual(['cancelled', row0.version + 1, h0 + 1]); continue; }
      expect([st, row.status, row.version, (await histOf(t, v.id)).length]).toEqual([st, st, row0.version, h0]);
      const lvl = t.logs.records.filter((r) => r.module === 'shipping').map((r) => r.level);
      expect([st, lvl.includes(st === 'cancelled' ? 'info' : 'error')]).toEqual([st, true]);
    }
  });

  it(`SHP-TC-20261006-102133431 ${SEC} T11 (L85): event có payload hỏng hình dạng (null, chuỗi, số, mảng, thiếu hay sai order_id) không làm handler ném lỗi, không tạo hay đổi gì, vẫn được đánh dấu đã xử lý; log không chép nội dung payload`, async () => {
    const payloads: unknown[] = [null, 'abc', 42, [], {}, { order_id: 5 }, { order_id: 'secret-value-123' }, { order_id: '' }, { order_id: randomUUID() }];
    const before = await snapshotCounts(t);
    let n = 0;
    for (const type of ['OrderPaid', 'OrderConfirmed', 'OrderCancelled']) for (const p of payloads) { await raw(type, p); n++; }
    const after = await snapshotCounts(t);
    expect(after.slice(0, 5)).toEqual(before.slice(0, 5)); // không vận đơn, lịch sử, phương thức, outbox hay audit mới
    expect(after[5] - before[5]).toBe(n); // mọi event được đánh dấu đã xử lý (relay không giao lại mãi)
    expect(t.logs.lines.join('\n')).not.toContain('secret-value-123');
    expect(t.logs.records.filter((r) => r.level === 'error')).toEqual([]);
  });

  it(`SHP-TC-20261006-102133111 ${SEC} T6, T14 (L62): nửa cặp thay thế lẻ và NUL trong chuỗi của body, query hay tham số đường dẫn cho 400 (hoặc 404 cho đường dẫn), không bao giờ 500`, async () => {
    const [s1, a1, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    const m = await seedMethod(t);
    const v = await seedShipment(t, { status: 'pending' }), w = await seedShipment(t, { status: 'shipped' });
    const methods0 = await countOf(t, 'shipping_methods');
    const json = (s: string) => ({ body: s, contentType: 'application/json' });
    const sur = '\\ud800', nul = '\\u0000';
    const cases: [string, 'post' | 'patch' | 'get', string, string | undefined, string | null][] = [
      ['ship tracking', 'post', `/shipping/orders/${v.order.code}/shipment/ship`, s1.cookie, `{"tracking_number":"GHN${sur}12345"}`],
      ['ship tracking NUL', 'post', `/shipping/orders/${v.order.code}/shipment/ship`, s1.cookie, `{"tracking_number":"GHN${nul}12345"}`],
      ['fail note', 'post', `/shipping/orders/${w.order.code}/shipment/fail`, s1.cookie, `{"reason_code":"other","note":"a${sur}b"}`],
      ['fail note NUL', 'post', `/shipping/orders/${w.order.code}/shipment/fail`, s1.cookie, `{"reason_code":"other","note":"a${nul}b"}`],
      ['method name', 'post', '/admin/shipping/methods', a1.cookie, `{"name":"Giao${sur}","base_fee":1000}`],
      ['method name NUL', 'post', '/admin/shipping/methods', a1.cookie, `{"name":"Giao${nul}","base_fee":1000}`],
      ['city list', 'post', '/admin/shipping/methods', a1.cookie, `{"name":"Giao nhanh","base_fee":1,"rule":{"surcharge":1,"surcharge_cities":["Hà${sur}"]}}`],
      ['city list NUL', 'post', '/admin/shipping/methods', a1.cookie, `{"name":"Giao nhanh","base_fee":1,"rule":{"surcharge":1,"surcharge_cities":["Hà${nul}"]}}`],
      ['quote city', 'post', '/shipping/quote', c1.cookie, `{"method_id":"${m}","city":"Hà${sur}","subtotal":1}`],
      ['quote city NUL', 'post', '/shipping/quote', c1.cookie, `{"method_id":"${m}","city":"Hà${nul}","subtotal":1}`],
      ['tracking patch', 'patch', `/shipping/orders/${w.order.code}/shipment/tracking-number`, s1.cookie, `{"tracking_number":"GHN${sur}12345","version":2}`],
    ];
    for (const [name, method, path, cookie, body] of cases) { const r = await call(t, method, path, { cookie, ...json(body as string) }); expect([name, r.status]).toEqual([name, 400]); }
    for (const qs of ['order_code=a%00b', 'tracking_number=GHN%0012345', 'status=%00']) expect([qs, (await call(t, 'get', `/shipping/shipments?${qs}`, { cookie: s1.cookie })).status]).toEqual([qs, 400]);
    for (const code of ['%00', 'A%00B', '%ED%A0%80']) { const r = await call(t, 'get', `/shipping/orders/${code}/shipment`, { cookie: s1.cookie }); expect([code, [400, 404].includes(r.status)]).toEqual([code, true]); }
    expect(await countOf(t, 'shipping_methods')).toBe(methods0); // không phương thức nào được tạo
    expect((await shipmentRow(t, v.id)).status).toBe('pending');
  });

  it(`SHP-TC-20261006-102134039 ${SEC} T17 (L80): trần tài nguyên: limit vượt một đơn vị và gấp triệu lần bị từ chối dưới 2 giây; trang gấp triệu lần chỉ trả danh sách rỗng nhanh; mảng và chuỗi khổng lồ bị từ chối nhanh; lịch sử tối đa 100 dòng`, async () => {
    const [s1, a1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn')];
    await seedShipment(t, { status: 'shipped' });
    const methods0 = await countOf(t, 'shipping_methods');
    const timed = async (fn: () => PromiseLike<{ status: number }>) => { const t0 = Date.now(); const r = await fn(); return { status: r.status, ms: Date.now() - t0 }; };
    const get = (qs: string) => timed(() => call(t, 'get', `/shipping/shipments?${qs}`, { cookie: s1.cookie }));
    expect((await get('limit=101')).status).toBe(400);
    for (const qs of ['limit=100000000', 'limit=99999999999999999999999', 'limit=9007199254740992', 'page=9007199254740992']) { const r = await get(qs); expect([qs, r.status, r.ms < 2000]).toEqual([qs, 400, true]); }
    expect((await get(`order_code=${'A'.repeat(33)}`)).status).toBe(400); // mã đơn tối đa 32 ký tự
    expect((await get(`order_code=${'A'.repeat(32)}`)).status).toBe(200);
    const deep = await get('page=9007199254740991&limit=100');
    expect([deep.status, deep.ms < 2000]).toEqual([200, true]);
    const cities = JSON.stringify({ name: 'Giao nhanh', base_fee: 1, rule: { surcharge: 1, surcharge_cities: Array.from({ length: 100_000 }, (_, i) => `T${i}`) } });
    const big = await timed(() => call(t, 'post', '/admin/shipping/methods', { cookie: a1.cookie, body: cities }));
    expect([[400, 413].includes(big.status), big.ms < 2000]).toEqual([true, true]);
    const name = await timed(() => call(t, 'post', '/admin/shipping/methods', { cookie: a1.cookie, body: { name: 'x'.repeat(5_000_000), base_fee: 1 } }));
    expect([[400, 413].includes(name.status), name.ms < 2000]).toEqual([true, true]);
    expect(await countOf(t, 'shipping_methods')).toBe(methods0);
    const v = await seedShipment(t, { status: 'shipped', tracking: 'GHN00000001', version: 2 });
    await q(t, `INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number) SELECT '${v.id}', 'tracking_changed', 'shipped', 'GHN00000001' FROM generate_series(1, 150)`);
    await q(t, `INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number) VALUES ('${v.id}', 'tracking_changed', 'shipped', 'GHN00000999')`);
    t.clock.advance(61_000);
    const h = await call(t, 'get', `/shipping/orders/${v.order.code}/shipment/history`, { cookie: s1.cookie });
    expect(h.body.items).toHaveLength(100);
    expect(h.body.items[0].status).toBe('shipped'); // 152 dòng: bỏ các dòng CŨ nhất (pending, shipped đầu tiên), giữ 100 dòng MỚI NHẤT
    expect(h.body.items[0].event).toBe('tracking_changed');
    expect(h.body.items[99].tracking_number).toBe('GHN00000999'); // trạng thái hiện tại luôn có mặt, cuối danh sách (cũ nhất trước)
    const customer = await who(t, 'customer', 'c9@x.vn');
    const own = await seedOrderFor(t, { user: customer.id, status: 'shipped' });
    const mine = await seedShipment(t, { status: 'shipped', order: own, tracking: 'GHN00000555', version: 2 });
    await q(t, `INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number) SELECT '${mine.id}', 'tracking_changed', 'shipped', 'GHN00000555' FROM generate_series(1, 120)`);
    await q(t, `INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number) VALUES ('${mine.id}', 'tracking_changed', 'shipped', 'GHN00000777')`);
    const mineH = await call(t, 'get', `/shipping/orders/${own.code}/shipment/history`, { cookie: customer.cookie });
    expect([mineH.status, mineH.body.items.length, mineH.body.items[99].tracking_number]).toEqual([200, 100, 'GHN00000777']); // customer cũng thấy trạng thái mới nhất dù lịch sử dài
  });

  it(`SHP-TC-20261006-102134039 ${SEC} T16, T25 (L72): đếm giới hạn bậc D chạy song song: 40 yêu cầu cùng lúc của một staff chỉ qua đúng 30 (đếm nguyên tử), 10 yêu cầu còn lại nhận 429`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    t.clock.set(new Date(Math.floor(t.clock.now().getTime() / 60_000) * 60_000 + 61_000)); // đầu một cửa sổ
    const rs = await Promise.all(Array.from({ length: 40 }, () => call(t, 'get', '/shipping/shipments', { cookie: s1.cookie })));
    const codes = rs.map((r) => r.status);
    expect([codes.filter((c) => c === 200).length, codes.filter((c) => c === 429).length]).toEqual([30, 10]);
  });

  it(`SHP-TC-20261006-102133383 ${SEC} T16 (SB-14 bậc C): tra cứu vận đơn và lịch sử theo mã đơn chung một hạn mức 120 yêu cầu mỗi phút mỗi người dùng (yêu cầu thứ 121 nhận 429); quote có bộ đếm riêng`, async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const v = await seedShipment(t, { status: 'shipped', user: c1.id });
    t.clock.set(new Date(Math.floor(t.clock.now().getTime() / 60_000) * 60_000 + 61_000));
    const codes: number[] = [];
    for (let i = 0; i < 60; i++) codes.push((await call(t, 'get', `/shipping/orders/${v.order.code}/shipment`, { cookie: c1.cookie })).status);
    for (let i = 0; i < 61; i++) codes.push((await call(t, 'get', `/shipping/orders/${v.order.code}/shipment/history`, { cookie: c1.cookie })).status);
    expect([codes.slice(0, 120).every((c) => c === 200), codes[120]]).toEqual([true, 429]); // lịch sử và chi tiết cộng dồn
    expect((await call(t, 'post', '/shipping/quote', { cookie: c1.cookie, body: { method_id: v.method, city: 'Hà Nội', subtotal: 1 } })).status).toBe(200);
  }, 120_000);

  it(`SHP-TC-20261006-102133308 ${SEC} T6, T22 (SB-18): rule trong CSDL sai cấu trúc thì báo phí và danh sách phương thức đóng kín (500, log error có mã phương thức), không tính phí bằng dữ liệu hỏng; order_code lạ trong payload không vào log`, async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const m = await seedMethod(t, { name: 'Giao hỏng' });
    await q(t, `UPDATE shipping_methods SET rule = '{"free_over":"0","surcharge":-5,"surcharge_cities":[]}'::jsonb WHERE id = '${m}'`);
    const bad = await call(t, 'post', '/shipping/quote', { cookie: c1.cookie, body: { method_id: m, city: 'Hà Nội', subtotal: 1000000 } });
    expect([bad.status, 'fee' in bad.body]).toEqual([500, false]);
    expect((await call(t, 'get', '/shipping/methods', { cookie: c1.cookie })).status).toBe(500);
    expect(t.logs.records.filter((r) => r.code === 'shipping-method-rule-invalid' && r.method_id === m).length).toBeGreaterThanOrEqual(2);
    await expect(t.shp.quote({ method_id: m, city: 'Hà Nội', subtotal: 1 })).rejects.toBeInstanceOf(DomainError);
    const v = await seedShipment(t, { status: 'shipped' });
    t.logs.clear();
    await raw('OrderCancelled', { order_id: v.order.id, order_code: 'Nguyễn Văn An 0901234567', user_id: v.order.user, reason: 'customer_request' });
    const err = t.logs.records.filter((r) => r.code === 'shipment-order-cancelled-mismatch');
    expect(err).toHaveLength(1);
    expect(err[0].order_id).toBe(v.order.id); // mã đơn không đúng dạng thì log theo order_id
    expect(t.logs.lines.join('\n')).not.toMatch(/Nguyễn Văn An|0901234567/);
  });

  it(`SHP-TC-20261006-102133941 ${SEC} T7, T12, T19: tải hỗn hợp 40 vận đơn (bàn giao đua nhau, sửa mã, giao xong hay thất bại, hoàn hàng, lặp lại) giữ bất biến: version bằng số dòng lịch sử, mỗi chuyển đúng một event theo đúng thứ tự và một audit, mã duy nhất, ORD đồng bộ sau relay`, async () => {
    const [s1, s2] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'staff', 's2@shop.vn')];
    const owner = await who(t, 'customer', 'chu@x.vn');
    const m = await seedMethod(t);
    const vs: Awaited<ReturnType<typeof seedShipment>>[] = [];
    for (let i = 0; i < 40; i++) vs.push(await seedShipment(t, { status: 'pending', user: owner.id, method: m }));
    const ok = async <T>(p: Promise<T>): Promise<string> => p.then(() => 'ok', (e) => { if (!(e instanceof DomainError)) throw e; return e.code; });
    const [a, b] = [sess(s1.id), sess(s2.id)];
    const phase = async (fn: (v: (typeof vs)[number], i: number) => Promise<unknown>[]) => { const out = await Promise.all(vs.map((v, i) => Promise.all(fn(v, i).map((p) => race(() => p, async () => undefined).then(([r]) => r))))); return out.flat(); };
    await phase((v, i) => [ok(t.ships.ship(a, v.order.code, { tracking_number: `MIX${String(i).padStart(4, '0')}A` })), ok(t.ships.ship(b, v.order.code, { tracking_number: `MIX${String(i).padStart(4, '0')}B` })), ok(t.ships.deliver(a, v.order.code))]);
    for (const [i, v] of vs.entries()) {
      const row = await shipmentRow(t, v.id);
      if (row.status !== 'shipped') continue;
      t.clock.advance(10);
      const plan = i % 3; // 0: sửa mã rồi giao xong; 1: thất bại rồi hoàn hàng; 2: giao xong và thất bại đua nhau
      await Promise.all([
        ok(t.ships.changeTracking(a, v.order.code, { tracking_number: `MIX${String(i).padStart(4, '0')}C`, version: row.version })),
        ok(plan === 1 ? t.ships.fail(b, v.order.code, { reason_code: i % 2 ? 'damaged' : 'refused' }) : t.ships.deliver(b, v.order.code)),
        ok(plan === 2 ? t.ships.fail(a, v.order.code, { reason_code: 'other' }) : t.ships.deliver(a, v.order.code)),
      ]);
    }
    await Promise.all(vs.map(async (v) => { if ((await shipmentRow(t, v.id)).status === 'failed') await Promise.all([ok(t.ships.returned(a, v.order.code)), ok(t.ships.returned(b, v.order.code))]); }));
    const finals: Record<string, number> = {};
    const EVENT = (h: { event: string; status: string }) => (h.event === 'tracking_changed' ? 'ShipmentTrackingChanged' : { shipped: 'ShipmentShipped', delivered: 'ShipmentDelivered', failed: 'ShipmentFailed', returned: 'ShipmentReturned' }[h.status]);
    for (const v of vs) {
      const row = await shipmentRow(t, v.id);
      finals[row.status] = (finals[row.status] ?? 0) + 1;
      const h = await histOf(t, v.id);
      expect(h[0].status).toBe('pending');
      expect(row.version).toBe(h.length); // mỗi lần đổi đúng một dòng lịch sử và một lần tăng version
      expect((await shpOutbox(t, v.id)).map((e) => e.type)).toEqual(h.slice(1).map(EVENT)); // đúng một event mỗi chuyển, đúng thứ tự
      expect(await shpAudits(t, v.id)).toHaveLength(h.length - 1); // fixture không audit dòng pending
      if (row.status === 'pending') expect(row.tracking_number).toBeNull(); else expect(row.tracking_number).toMatch(/^MIX\d{4}[ABC]$/);
    }
    expect(Object.values(finals).reduce((x, y) => x + y, 0)).toBe(40);
    expect(Object.keys(finals).sort()).toEqual(expect.arrayContaining(['delivered']));
    expect(await q(t, `SELECT tracking_number FROM shipments WHERE tracking_number IS NOT NULL GROUP BY tracking_number HAVING count(*) > 1`)).toEqual([]);
    // relay giao hết event cho ORD thật: đơn đồng bộ với vận đơn
    for (let i = 0; i < 12; i++) if ((await t.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000 + i))).picked === 0) break;
    const want: Record<string, string> = { shipped: 'shipped', delivered: 'delivered', failed: 'shipped', returned: 'returned', pending: 'paid' };
    for (const v of vs) expect((await q<{ status: string }>(t, `SELECT status::text FROM orders WHERE id = '${v.order.id}'`))[0].status).toBe(want[(await shipmentRow(t, v.id)).status]);
    expect(await t.app.get(OutboxRelay).stuckCount()).toBe(0);
  }, 240_000);

  it(`SHP-TC-20261006-102133000 ${SEC} T12 (SB-19, SB-27): audit hoặc lịch sử lỗi giữa chừng thì cả chuyển rollback (bàn giao, sửa mã, giao xong, thất bại, hoàn hàng, tạo và hủy theo event, tạo phương thức): không đổi trạng thái, cờ bàn giao, lịch sử, audit hay event`, async () => {
    const [s1, a1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn')];
    const s = sess(s1.id);
    const audit = t.app.get(AuditService);
    const ops: [string, () => Promise<{ code: string }>, ShipStatus][] = [];
    const mk = async (st: ShipStatus) => seedShipment(t, { status: st, tracking: st === 'shipped' ? trackingOf() : undefined });
    const [p, sh1, sh2, f] = [await mk('pending'), await mk('shipped'), await mk('shipped'), await mk('failed')];
    const sh3 = await mk('shipped');
    const vers = async (id: string) => (await shipmentRow(t, id)).version;
    ops.push(['ship', async () => { await t.ships.ship(s, p.order.code, { tracking_number: trackingOf() }); return p.order; }, 'pending']);
    ops.push(['tracking', async () => { await t.ships.changeTracking(s, sh1.order.code, { tracking_number: trackingOf(), version: await vers(sh1.id) }); return sh1.order; }, 'shipped']);
    ops.push(['deliver', async () => { await t.ships.deliver(s, sh2.order.code); return sh2.order; }, 'shipped']);
    ops.push(['fail', async () => { await t.ships.fail(s, sh3.order.code, { reason_code: 'other' }); return sh3.order; }, 'shipped']);
    ops.push(['return', async () => { await t.ships.returned(s, f.order.code); return f.order; }, 'failed']);
    const all = [p, sh1, sh2, sh3, f];
    const before = await Promise.all(all.map(async (x) => [JSON.stringify(await shipmentRow(t, x.id)), (await histOf(t, x.id)).length] as const));
    const counts = await snapshotCounts(t);
    for (const [name, run] of ops) {
      jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error(`audit lỗi ${name}`));
      await expect(run()).rejects.toThrow(`audit lỗi ${name}`);
    }
    for (const [i, x] of all.entries()) expect([JSON.stringify(await shipmentRow(t, x.id)), (await histOf(t, x.id)).length]).toEqual([...before[i]]);
    expect(await snapshotCounts(t)).toEqual(counts);
    expect((await q<{ handoff_locked_at: Date | null }>(t, `SELECT handoff_locked_at FROM orders WHERE id = '${p.order.id}'`))[0].handoff_locked_at).toBeNull();
    // lịch sử lỗi: cùng kết quả
    await expect(failingInsert(t, 'shipment_status_history', () => t.ships.ship(s, p.order.code, { tracking_number: trackingOf() }))).rejects.toThrow();
    await expect(failingInsert(t, 'shipment_status_history', () => t.ships.deliver(s, sh2.order.code))).rejects.toThrow();
    expect(await snapshotCounts(t)).toEqual(counts);
    expect((await shipmentRow(t, p.id)).status).toBe('pending');
    // tạo phương thức và hủy theo event: audit lỗi thì rollback
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit lỗi'));
    await expect(t.methods.create(sess(a1.id, 'admin'), { name: 'Giao mới', base_fee: 1, rule: { free_over: null, surcharge: 0, surcharge_cities: [] } })).rejects.toThrow();
    expect(await countOf(t, 'shipping_methods')).toBe(5); // chỉ năm phương thức của fixture
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit lỗi hủy'));
    await expect(raw('OrderCancelled', { order_id: p.order.id, order_code: p.order.code })).rejects.toThrow();
    expect((await shipmentRow(t, p.id)).status).toBe('pending');
    const o = await seedOrderFor(t, { status: 'paid', shippingMethod: p.method });
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit lỗi tạo'));
    await expect(raw('OrderPaid', { order_id: o.id })).rejects.toThrow();
    expect([await countOf(t, 'shipments', `order_id = '${o.id}'`), await countOf(t, 'processed_events', `consumer = 'shipping'`)]).toEqual([0, 0]);
  }, 120_000);

  it(`SHP-TC-20261006-102133111 ${SEC} T5, T14 (L81): khóa đặc biệt của JavaScript (__proto__, constructor, toString) không làm vỡ schema: khóa lạ bị 400, giá trị liệt kê bị 400, tên và thành phố hợp lệ được lưu nguyên`, async () => {
    const [s1, a1, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    const v = await seedShipment(t, { status: 'shipped' });
    for (const k of ['__proto__', 'constructor', 'toString']) {
      expect([k, (await call(t, 'get', `/shipping/shipments?status=${k}`, { cookie: s1.cookie })).status]).toEqual([k, 400]);
      expect([k, (await call(t, 'post', `/shipping/orders/${v.order.code}/shipment/fail`, { cookie: s1.cookie, body: { reason_code: k } })).status]).toEqual([k, 400]);
      expect([k, (await call(t, 'get', `/shipping/shipments?sort=${k}`, { cookie: s1.cookie })).status]).toEqual([k, 400]);
    }
    const proto = await call(t, 'post', `/shipping/orders/${v.order.code}/shipment/deliver`, { cookie: s1.cookie, body: '{"__proto__":{"status":"x"}}', contentType: 'application/json' });
    expect(proto.status).toBe(400);
    expect((await call(t, 'post', '/admin/shipping/methods', { cookie: a1.cookie, body: '{"name":"Giao nhanh","base_fee":1,"constructor":1}', contentType: 'application/json' })).status).toBe(400);
    const m = await call(t, 'post', '/admin/shipping/methods', { cookie: a1.cookie, body: { name: '__proto__', base_fee: 1, rule: { surcharge: 1, surcharge_cities: ['__proto__', 'constructor'] } } });
    expect([m.status, m.body.name, m.body.rule.surcharge_cities]).toEqual([201, '__proto__', ['__proto__', 'constructor']]);
    const q1 = await call(t, 'post', '/shipping/quote', { cookie: c1.cookie, body: { method_id: m.body.id, city: '__proto__', subtotal: 5 } });
    expect([q1.status, q1.body.fee]).toEqual([200, 2]);
    expect((await call(t, 'get', '/shipping/methods', { cookie: c1.cookie })).body.items[0].name).toBe('__proto__');
  });

  it(`SHP-TC-20261008-091406542 ${SEC} T20, T11 (L71): pool kết nối nhỏ (2) vẫn đủ cho relay giao OrderPaid lần lượt (handler giữ một kết nối của giao dịch giao event và đọc ORD bằng kết nối thứ hai); 8 event xử lý xong trong hạn, không treo`, async () => {
    const small = await createShpApp({ env: { DB_POOL_MAX: '2' } });
    try {
      const m = await seedMethod(small);
      const events = small.app.get(EventsService);
      for (let i = 0; i < 8; i++) {
        const o = await seedOrderFor(small, { status: 'paid', shippingMethod: m });
        await small.tx.run((tx) => events.publish(tx, { type: 'OrderPaid', aggregate_type: 'order', aggregate_id: o.id, payload: { order_id: o.id } }));
      }
      const t0 = Date.now();
      const r = await small.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000));
      expect([r.picked, r.dispatched, r.failed]).toEqual([8, 8, 0]);
      expect(Date.now() - t0).toBeLessThan(30_000);
      expect(await countOf(small, 'shipments')).toBe(8);
    } finally { await small.close(); }
  }, 120_000);
});
