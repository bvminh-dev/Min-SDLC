import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { q, seedSession, seedUser } from '../support/auth';
import { API_DIR, truncateAll } from '../support/db';
import { call, countRows, who, createOrdApp, deliver, failingInsert, historyOf, orderOf, outboxOf, outTypes, auditsOf, people, race, seedOrder, sleep, type OrdApp } from '../support/ord';

// Hủy đơn (ORD-REQ-20261006-092320834): customer đơn của mình, admin mọi đơn; staff 403; 409 chung; một OrderCancelled; audit cùng giao dịch; thứ tự kiểm 401, 403, 400, 404, 409.
describe('ORD hủy đơn', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const cancel = (code: string, cookie: string | undefined, body: unknown = {}, o: { origin?: string | null; contentType?: string | null; headers?: Record<string, string> } = {}) => {
    let r = call(t, 'post', `/orders/${code}/cancel`, { cookie, body, origin: o.origin, contentType: o.contentType });
    for (const [k, v] of Object.entries(o.headers ?? {})) r = r.set(k, v);
    return r;
  };
  const get = (path: string, cookie?: string) => call(t, 'get', path, { cookie });
  const strip = ({ trace_id: _t, ...r }: any) => r;
  const untouched = async (o: { id: string }, status: string, rows: number) => {
    expect((await orderOf(t, o.id)).status).toBe(status);
    expect(await historyOf(t, o.id)).toHaveLength(rows);
    expect((await outTypes(t, o.id)).filter((x) => x === 'OrderCancelled')).toEqual([]);
    expect(await auditsOf(t, o.id)).toEqual([]);
  };

  it('ORD-TC-20261006-111226117: customer hủy đơn paid kèm lý do: 200, cancel_reason customer_request, payment_status giữ succeeded, lịch sử có lý do, OrderCancelled mã lý do was_paid true, audit đầy đủ; audit lỗi thì rollback cả hủy (500 không lộ chi tiết)', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    const at = t.clock.now();
    const r = await cancel(o.code, a.cookie, { reason: 'đặt nhầm' });
    expect([r.status, r.body]).toEqual([200, { code: '7K3M9Q2XH4TB', status: 'cancelled' }]);
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'customer_request', cancelled_by_role: 'customer', payment_status: 'succeeded' });
    expect((await historyOf(t, o.id)).at(-1)).toMatchObject({ from_status: 'paid', to_status: 'cancelled', actor_id: a.id, actor_role: 'customer', reason: 'đặt nhầm', created_at: at });
    const ev = (await outboxOf(t, o.id)).filter((e) => e.type === 'OrderCancelled');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ order_id: o.id, order_code: '7K3M9Q2XH4TB', user_id: a.id, reason: 'customer_request', was_paid: true }); // mã lý do, không mang văn bản "đặt nhầm"
    const audits = await auditsOf(t, o.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: a.id, actor_role: 'customer', target_type: 'order', reason: 'đặt nhầm', before: { status: 'paid' }, after: { status: 'cancelled' } });
    expect(audits[0].action).toContain('cancel');
    expect(audits[0].correlation_id).not.toBe('none');
    const o8 = await seedOrder(t, { user: a.id, status: 'paid' });
    const bad = await failingInsert(t, 'audit_logs', () => cancel(o8.code, a.cookie, { reason: 'x' }));
    expect(bad.status).toBe(500);
    expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(Object.keys(bad.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
    expect((await orderOf(t, o8.id)).status).toBe('paid');
    expect(await historyOf(t, o8.id)).toHaveLength(2);
    expect(await outTypes(t, o8.id)).toEqual([]);
  });

  it('ORD-TC-20261006-111226147: customer hủy đơn COD confirmed không lý do: lịch sử không reason, OrderCancelled customer_request was_paid false, payment_status tự đặt cancelled, audit reason NULL before confirmed', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod' });
    const r = await cancel(o.code, a.cookie, {});
    expect([r.status, r.body.status]).toEqual([200, 'cancelled']);
    expect((await historyOf(t, o.id)).at(-1)?.reason).toBeNull();
    const ev = (await outboxOf(t, o.id)).filter((e) => e.type === 'OrderCancelled');
    expect(ev.map((e) => e.payload)).toEqual([{ order_id: o.id, order_code: o.code, user_id: a.id, reason: 'customer_request', was_paid: false }]);
    expect((await orderOf(t, o.id)).payment_status).toBe('cancelled');
    const au = await auditsOf(t, o.id);
    expect([au.length, au[0].reason, au[0].before]).toEqual([1, null, { status: 'confirmed' }]);
  });

  it('ORD-TC-20261006-111226176: customer hủy đơn online pending: cancelled, OrderCancelled was_paid false một lần, lý do chỉ ở lịch sử và audit, payment_status cancelled, payment_expires_at giữ, không OrderExpired', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '5C7D9F1G3H5J', status: 'pending', payment: 'processing' });
    const before = await orderOf(t, o.id);
    expect((await cancel(o.code, a.cookie, { reason: 'đổi ý' })).status).toBe(200);
    const after = await orderOf(t, o.id);
    expect([after.status, after.payment_status, after.payment_expires_at]).toEqual(['cancelled', 'cancelled', before.payment_expires_at]);
    expect((await outboxOf(t, o.id)).map((e) => [e.type, e.payload.reason ?? null, e.payload.was_paid ?? null])).toEqual([['OrderCancelled', 'customer_request', false]]);
    expect((await historyOf(t, o.id)).at(-1)?.reason).toBe('đổi ý');
    expect((await auditsOf(t, o.id))[0].reason).toBe('đổi ý');
  });

  it('ORD-TC-20261006-111226206: admin hủy đơn paid của customer khác: OrderCancelled reason admin was_paid true, cancelled_by_role admin, audit ghi admin, lịch sử của chủ đơn không nêu người hủy', async () => {
    const { b, admin } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '6V8W0X2Y4Z6A', status: 'paid' });
    expect((await cancel(o.code, admin.cookie, { reason: 'hết hàng thực tế' })).status).toBe(200);
    expect((await orderOf(t, o.id)).cancelled_by_role).toBe('admin');
    expect((await outboxOf(t, o.id)).filter((e) => e.type === 'OrderCancelled').map((e) => [e.payload.reason, e.payload.was_paid])).toEqual([['admin', true]]);
    expect((await auditsOf(t, o.id))[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', target_id: o.id, reason: 'hết hàng thực tế', before: { status: 'paid' } });
    const h = await get(`/orders/${o.code}/status-history`, b.cookie);
    expect(h.body.items.at(-1)).toMatchObject({ status: 'cancelled', reason: 'hết hàng thực tế' });
    expect(JSON.stringify(h.body)).not.toMatch(/admin|actor/i);
  });

  it('ORD-TC-20261006-111226244: staff hủy đơn nhận 403 forbidden (cả đơn có thật và không tồn tại, thân giống nhau); đơn không đổi, không event, không audit', async () => {
    const { staff, b } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '6V8W0X2Y4Z6A', status: 'paid' });
    const [x, y] = [await cancel(o.code, staff.cookie, { reason: 'x' }), await cancel('9X9X9X9X9X9X', staff.cookie, { reason: 'x' })];
    for (const r of [x, y]) expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);
    expect(strip(x.body)).toEqual(strip(y.body));
    await untouched(o, 'paid', 2);
  });

  it('ORD-TC-20261006-111226276: guest và phiên hết hạn hủy đơn nhận 401 (401 trước kiểm Origin và 403); đơn vẫn paid, không event, không audit', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'paid' });
    const guest = await cancel(o.code, undefined, { reason: 'x' }, { origin: null });
    expect([guest.status, guest.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']);
    const old = await seedSession(t, a.id, { createdAt: new Date(t.clock.now().getTime() - 3600_000), lastSeenAt: new Date(t.clock.now().getTime() - 3600_000), expiresAt: new Date(t.clock.now().getTime() - 1000), absoluteExpiresAt: new Date(t.clock.now().getTime() - 1000) });
    const expired = await cancel(o.code, old.cookie, { reason: 'x' }); // Origin hợp lệ: với cookie kèm Origin lạ, CsrfGuard của platform chạy trước AuthGuard và trả 403 (xem report, Lệch spec)
    expect(expired.status).toBe(401);
    expect(['urn:ecom:error:session_expired', 'urn:ecom:error:unauthenticated']).toContain(expired.body.type);
    await untouched(o, 'paid', 2);
  });

  it('ORD-TC-20261006-111226306: customer và admin hủy đơn shipped hoặc delivered nhận 409 order-not-cancellable với thân chung (không detail, không trạng thái, không chi tiết nội bộ); đơn, lịch sử, event, audit không đổi', async () => {
    const { a, admin } = await people(t);
    const [ship, deli] = [await seedOrder(t, { user: a.id, code: '2H4J6K8M0N2P', status: 'shipped' }), await seedOrder(t, { user: a.id, code: '1A3C5E7G9K2M', status: 'delivered' })];
    for (const [who, o] of [[a, ship], [a, deli], [admin, ship], [admin, deli]] as const) {
      const r = await cancel(o.code, who.cookie, {});
      expect(r.status).toBe(409);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(Object.keys(r.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
      expect(r.body).toMatchObject({ type: 'urn:ecom:error:order-not-cancellable', title: 'Order cannot be cancelled in its current state', status: 409 });
      expect(JSON.stringify(r.body)).not.toMatch(/shipped|delivered|stack|SELECT|orders|\.ts/);
    }
    await untouched(ship, 'shipped', 3);
    await untouched(deli, 'delivered', 4);
  });

  it('ORD-TC-20261006-111226336: hủy lại đơn đã cancelled hoặc expired (khách và admin) nhận 409; bus chỉ có đúng một OrderCancelled của đơn đầu, không có của đơn expired; một dòng cancelled; một audit', async () => {
    const { a, admin } = await people(t);
    const [c, e] = [await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' }), await seedOrder(t, { user: a.id, code: '5C7D9F1G3H5J', status: 'pending' })];
    expect((await cancel(c.code, a.cookie)).status).toBe(200);
    await deliver(t, 'StockReservationExpired', { order_id: e.id });
    for (const [who, o] of [[a, c], [a, e], [admin, c]] as const) expect([(await cancel(o.code, who.cookie)).status, ]).toEqual([409]);
    expect((await outTypes(t, c.id)).filter((x) => x === 'OrderCancelled')).toHaveLength(1);
    expect(await outTypes(t, e.id)).toEqual(['OrderExpired']);
    expect((await historyOf(t, c.id)).filter((h) => h.to_status === 'cancelled')).toHaveLength(1);
    expect(await auditsOf(t, c.id)).toHaveLength(1);
  });

  it('ORD-TC-20261006-111226366: customer hủy đơn của người khác hoặc đơn không tồn tại nhận cùng 404; đơn của B không đổi và không bị khóa dòng (truy vấn nạp đơn có điều kiện user_id từ phiên)', async () => {
    const { a, b } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'paid' });
    // giữ khóa dòng đơn của B ở một giao dịch khác: nếu truy vấn của A khóa dòng của B thì lời gọi sẽ treo
    const held = t.prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM orders WHERE id = ${o.id}::uuid FOR UPDATE`; await sleep(2500); }, { timeout: 10_000 });
    await sleep(300);
    const t0 = Date.now();
    const [x, y] = [await cancel(o.code, a.cookie, { reason: 'x' }), await cancel('9X9X9X9X9X9X', a.cookie, { reason: 'x' })];
    expect(Date.now() - t0).toBeLessThan(2000);
    await held;
    for (const r of [x, y]) expect([r.status, r.body.type]).toEqual([404, 'urn:ecom:error:not-found']);
    expect(JSON.stringify(strip(x.body))).toBe(JSON.stringify(strip(y.body)));
    await untouched(o, 'paid', 2);
  });

  it('ORD-TC-20261006-111226396: hủy từ Origin lạ hoặc thiếu Origin (khi có cookie) bị 403 csrf_failed, sai kiểu nội dung 415; GET không bị kiểm Origin; Origin hợp lệ thì 200; đơn không đổi khi bị từ chối', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    for (const origin of ['https://evil.example', null]) { const r = await cancel(o.code, a.cookie, { reason: 'x' }, { origin }); expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']); }
    const wrongType = await cancel(o.code, a.cookie, '{"reason":"x"}', { contentType: 'text/plain' });
    expect([wrongType.status, wrongType.body.type]).toEqual([415, 'urn:ecom:error:unsupported-media-type']);
    await untouched(o, 'paid', 2);
    expect((await call(t, 'get', `/orders/${o.code}`, { cookie: a.cookie }).set('Origin', 'https://evil.example')).status).toBe(200);
    expect((await cancel(o.code, a.cookie, { reason: 'x' })).status).toBe(200);
    expect((await orderOf(t, o.id)).status).toBe('cancelled');
  });

  it('ORD-TC-20261006-111226435: body hủy có role, user_id giả hoặc reason sai kiểu bị 400; text/plain 415; staff kèm X-Role: admin vẫn 403; đơn không đổi', async () => {
    const { a, b, staff } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid' });
    const o6 = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'paid' });
    for (const body of [{ reason: 'x', role: 'admin' }, { reason: 'x', user_id: b.id }, { reason: 123 }]) {
      const r = await cancel(o.code, a.cookie, body);
      expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']);
      expect(r.body.errors.length).toBeGreaterThan(0);
    }
    expect((await cancel(o.code, a.cookie, '{"reason":"x"}', { contentType: 'text/plain' })).status).toBe(415);
    expect((await cancel(o6.code, staff.cookie, { reason: 'x' }, { headers: { 'X-Role': 'admin' } })).status).toBe(403);
    await untouched(o, 'paid', 2);
    await untouched(o6, 'paid', 2);
  });

  it('ORD-TC-20261006-111226466: hủy sau khi đơn COD confirmed đã sang shipped (ShipmentShipped đến trước) nhận 409; vẫn shipped với tracking; không OrderCancelled; tải lại can_cancel false', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod' });
    expect((await get(`/orders/${o.code}`, a.cookie)).body.can_cancel).toBe(true);
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.id, tracking_number: 'VN123456' });
    const r = await cancel(o.code, a.cookie, {});
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:order-not-cancellable']);
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'shipped', tracking_number: 'VN123456' });
    expect(await outTypes(t, o.id)).toEqual(['OrderShipped']);
    expect(await get(`/orders/${o.code}`, a.cookie).then((x) => [x.body.status, x.body.can_cancel])).toEqual(['shipped', false]);
  });

  it('ORD-TC-20261006-111226497: hai yêu cầu hủy giống hệt chạy song song trên 20 đơn paid: mỗi đơn đúng một 200 và một 409 (không 500, không lỗi unique), một OrderCancelled, một dòng cancelled, một audit', async () => {
    const orders = [] as { id: string; code: string; cookie: string }[];
    for (let i = 0; i < 20; i++) { const u = await who(t, 'customer', `race${i}@x.vn`); orders.push({ ...(await seedOrder(t, { user: u.id, status: 'paid' })), cookie: u.cookie }); } // mỗi đơn một người: hủy là bậc B (10 mỗi phút mỗi người), 40 lời gọi của một người sẽ vướng 429
    const results = await Promise.all(orders.map(async (o) => { const [x, y] = await race(() => cancel(o.code, o.cookie, { reason: 'trùng' }), () => cancel(o.code, o.cookie, { reason: 'trùng' })); return [o, x, y] as const; }));
    for (const [o, x, y] of results) {
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      for (const r of [x, y]) expect(JSON.stringify(r.body)).not.toMatch(/unique|duplicate|constraint/i);
      expect((await outTypes(t, o.id)).filter((e) => e === 'OrderCancelled')).toHaveLength(1);
      expect((await historyOf(t, o.id)).filter((h) => h.to_status === 'cancelled')).toHaveLength(1);
      expect(await auditsOf(t, o.id)).toHaveLength(1);
    }
  }, 120_000);

  it('ORD-TC-20261006-111720124: hủy đơn paid đã có shipment pending: 200, một OrderCancelled; ORD không có lời gọi hay bảng của SHP (mã module không import hay truy vấn shipment); YẾU: bước tích hợp SHP chưa kiểm vì SHP chưa có code', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'paid' });
    expect((await cancel(o.code, a.cookie)).status).toBe(200);
    expect((await outTypes(t, o.id)).filter((e) => e === 'OrderCancelled')).toHaveLength(1);
    const dir = resolve(API_DIR, 'src/modules/order');
    const src = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/from '\.\.\/(shipping|payment|inventory|promotion|checkout|notification|review|dashboard)/);
    expect(src).not.toMatch(/(FROM|JOIN|UPDATE|INSERT INTO)\s+(shipments|shipment_|payments|refunds|stock_)/i);
  });

  it('ORD-TC-20261006-111720161: lý do 500 ký tự lưu đủ (cả ký tự 2 byte), 501 ký tự bị 400, rỗng thì không có reason, mã HTML lưu và trả đúng như văn bản (application/json), log không chứa nội dung lý do', async () => {
    const { a } = await people(t);
    const mk = () => seedOrder(t, { user: a.id, status: 'paid' });
    const [oa, ob, oc, od, oe] = [await mk(), await mk(), await mk(), await mk(), await mk()];
    const [ra, rb, rc, rd, re] = [await cancel(oa.code, a.cookie, { reason: 'a'.repeat(500) }), await cancel(ob.code, a.cookie, { reason: 'a'.repeat(501) }), await cancel(oc.code, a.cookie, { reason: '' }), await cancel(od.code, a.cookie, { reason: 'đ'.repeat(500) }), await cancel(oe.code, a.cookie, { reason: '<script>alert(1)</script>' })];
    expect([ra.status, rb.status, rb.body.type, rc.status, rd.status, re.status]).toEqual([200, 400, 'urn:ecom:error:validation-failed', 200, 200, 200]);
    expect((await historyOf(t, oa.id)).at(-1)?.reason).toHaveLength(500);
    expect((await historyOf(t, od.id)).at(-1)?.reason).toBe('đ'.repeat(500));
    expect((await historyOf(t, oc.id)).at(-1)?.reason).toBeNull();
    expect((await orderOf(t, ob.id)).status).toBe('paid');
    const h = await get(`/orders/${oe.code}/status-history`, a.cookie);
    expect(h.headers['content-type']).toMatch(/application\/json/);
    expect(h.body.items.at(-1).reason).toBe('<script>alert(1)</script>');
    const logText = t.logs.lines.join('\n');
    expect(logText).not.toContain('<script>');
    expect(logText).not.toContain('a'.repeat(50));
  });

  it('ORD-TC-20261006-111720190: thứ tự kiểm khi hủy đơn: guest 401, staff 403, schema 400 trước tra cứu sở hữu, rồi 404, rồi 409', async () => {
    const { a, b, staff } = await people(t);
    const [o6, o5] = [await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'paid' }), await seedOrder(t, { user: a.id, code: '2H4J6K8M0N2P', status: 'shipped' })];
    const long = 'x'.repeat(501);
    expect((await cancel(o6.code, undefined, { reason: long }, { origin: null })).status).toBe(401);
    expect((await cancel(o6.code, staff.cookie, { reason: long })).status).toBe(403);
    expect((await cancel(o6.code, a.cookie, { reason: long })).status).toBe(400);
    expect((await cancel(o6.code, a.cookie, { reason: 'x' })).status).toBe(404);
    expect((await cancel(o5.code, a.cookie, { reason: 'x' })).status).toBe(409);
  });

  it('ORD-TC-20261006-150000600: đơn paid đã bị SHP khóa bàn giao: khách và admin hủy nhận 409 không nêu lý do cờ, không đổi gì; StockCommitFailed vẫn hủy do hệ thống (cờ không chặn hủy hệ thống)', async () => {
    const { a, admin } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid', handoff: new Date() });
    for (const who of [a, admin]) {
      const r = await cancel(o.code, who.cookie, { reason: 'đặt nhầm' });
      expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:order-not-cancellable']);
      expect(JSON.stringify(r.body)).not.toMatch(/handoff|lock|bàn giao/i);
    }
    await untouched(o, 'paid', 2);
    await deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_expired' });
    expect(await orderOf(t, o.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'stock_commit_failed', cancelled_by_role: 'system' });
    expect((await outboxOf(t, o.id)).filter((e) => e.type === 'OrderCancelled').map((e) => e.payload.was_paid)).toEqual([true]);
    expect((await auditsOf(t, o.id))[0]).toMatchObject({ actor_role: 'system', actor_id: null });
    expect(await countRows(t, 'audit_logs', `target_id = '${o.id}'`)).toBe(1);
    void q; void seedUser;
  });
});
