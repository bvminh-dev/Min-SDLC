import { OrderApi } from '../../src/modules/order';
import { ConfigError, loadConfig, type DomainError, type SessionContext } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { act, call, countOf, createShpApp, deliver, pgCode, q, race, seedOrderFor, seedShipment, shipVia, shipmentRow, shpAudits, snapshotCounts, trackingOf, who, type ShpApp } from '../support/shp';

// Thăm dò của reviewer độc lập (SHP-SEC-20261006-101603066 T7, T16, T20): ba bên đua cùng một đơn, đọc `order_code` của danh sách lớn, biến thể Unicode của mã vận đơn.
const SEC = 'SHP-SEC-20261006-101603066';

describe('SHP bẫy của review độc lập', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });

  it(`SHP-TC-20261006-102133626 ${SEC} T20, T21: lỗi KHÔNG phải nghiệp vụ của ORD khi bàn giao (kết nối hay lỗi bất ngờ) là 500 và vận đơn giữ pending, không bị nuốt thành 409 order-not-shippable; ORD không còn chủ đơn khi báo thất bại thì 404`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'pending' }), w = await seedShipment(t, { status: 'shipped' });
    const before = await snapshotCounts(t);
    jest.spyOn(t.app.get(OrderApi), 'lockForHandoff').mockRejectedValueOnce(new Error('ORD lỗi tạm thời'));
    const r = await shipVia(t, s1.cookie, v.order.code, trackingOf());
    expect([r.status, r.body.type]).toEqual([500, 'urn:ecom:error:internal-error']);
    expect((await shipmentRow(t, v.id)).status).toBe('pending');
    expect(await snapshotCounts(t)).toEqual(before);
    jest.spyOn(t.app.get(OrderApi), 'findForPayment').mockResolvedValueOnce(null);
    const f = await act(t, s1.cookie, w.order.code, 'fail', { reason_code: 'other' });
    expect(f.status).toBe(404);
    expect((await shipmentRow(t, w.id)).status).toBe('shipped');
    expect(await snapshotCounts(t)).toEqual(before);
  });

  it(`SHP-TC-20261006-102133819 ${SEC} T12: audit của báo giao thất bại ghi cả lý do (after.reason_code) và trạng thái trước, sau`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const w = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678' });
    expect((await act(t, s1.cookie, w.order.code, 'fail', { reason_code: 'wrong_address', note: 'Số nhà không có' })).status).toBe(200);
    const [a] = await shpAudits(t, w.id, 'shipping.shipment.fail');
    expect(a).toMatchObject({ actor_id: s1.id, actor_role: 'staff', before: { status: 'shipped', tracking_number: 'GHN12345678' }, after: { status: 'failed', tracking_number: 'GHN12345678', reason_code: 'wrong_address' } });
    expect(JSON.stringify(a)).not.toContain('Số nhà'); // ghi chú nội bộ không vào audit
  });

  it(`SHP-TC-20261006-102133965 ${SEC} T1: đơn có vận đơn đã hủy cũ và vận đơn còn hiệu lực mới thì chi tiết trả vận đơn còn hiệu lực (không phải vận đơn hủy dù cũ hơn hay mới hơn); chỉ có vận đơn hủy thì trả vận đơn hủy mới nhất`, async () => {
    const [c1, s1] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'staff', 's1@shop.vn')];
    const old = await seedShipment(t, { status: 'cancelled', user: c1.id, createdAt: new Date(Date.now() - 7200_000) });
    const only = await call(t, 'get', `/shipping/orders/${old.order.code}/shipment`, { cookie: c1.cookie });
    expect([only.status, only.body.shipment.status]).toEqual([200, 'cancelled']);
    await seedShipment(t, { status: 'pending', order: old.order, createdAt: new Date(Date.now() - 3600_000) });
    t.clock.advance(61_000);
    for (const who_ of [c1, s1]) {
      const r = await call(t, 'get', `/shipping/orders/${old.order.code}/shipment`, { cookie: who_.cookie });
      expect([r.status, r.body.shipment.status]).toEqual([200, 'pending']);
    }
    const h = await call(t, 'get', `/shipping/orders/${old.order.code}/shipment/history`, { cookie: c1.cookie });
    expect(h.body.items.map((x: { status: string }) => x.status)).toEqual(['pending']); // lịch sử của vận đơn còn hiệu lực, không lẫn vận đơn hủy
    // cũ hơn nữa: vận đơn hủy MỚI hơn vận đơn còn hiệu lực
    const o2 = await seedShipment(t, { status: 'pending', user: c1.id, createdAt: new Date(Date.now() - 7200_000) });
    await seedShipment(t, { status: 'cancelled', order: o2.order, createdAt: new Date(Date.now() - 3600_000) });
    const r2 = await call(t, 'get', `/shipping/orders/${o2.order.code}/shipment`, { cookie: c1.cookie });
    expect([r2.status, r2.body.shipment.status]).toEqual([200, 'pending']);
  });

  it(`SHP-TC-20261006-102133308 ${SEC} T5: báo phí với thành phố rỗng bị 400 (required), không tính phí cho thành phố rỗng`, async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const m = (await seedShipment(t, { status: 'pending' })).method;
    const r = await call(t, 'post', '/shipping/quote', { cookie: c1.cookie, body: { method_id: m, city: '', subtotal: 1000 } });
    expect([r.status, r.body.errors?.[0]]).toEqual([400, { field: 'city', code: 'required' }]);
  });

  it(`SHP-TC-20261006-102133602 ${SEC} T8: CSDL chặn mã vận đơn quá ngắn (7 ký tự) và quá dài (31 ký tự) kể cả khi bỏ qua lớp ứng dụng`, async () => {
    const v = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678' });
    for (const bad of ['ABC1234', 'A'.repeat(31)]) expect([bad.length, await pgCode(q(t, `UPDATE shipments SET tracking_number = '${bad}' WHERE id = '${v.id}'`))]).toEqual([bad.length, '23514']);
    await q(t, `UPDATE shipments SET tracking_number = 'ABC12345' WHERE id = '${v.id}'`);
    expect((await shipmentRow(t, v.id)).tracking_number).toBe('ABC12345'); // đúng 8 ký tự thì CSDL nhận
  });

  it(`SHP-TC-20261006-102147325 ${SEC} T20, T7: ba bên đua một đơn (nhân viên bàn giao, khách hủy, hệ thống hủy do StockCommitFailed), 60 vòng: không bế tắc (không lỗi 40P01 hay lỗi thô), không đơn hủy mà vẫn có cờ bàn giao với vận đơn pending, vận đơn đã shipped luôn có cờ`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const owner = await who(t, 'customer', 'chu@x.vn');
    const staff: SessionContext = { user_id: s1.id, role: 'staff', email_verified: true };
    const cust: SessionContext = { user_id: owner.id, role: 'customer', email_verified: true };
    const rounds: { v: Awaited<ReturnType<typeof seedShipment>>; out: string[] }[] = [];
    for (let i = 0; i < 60; i++) {
      const v = await seedShipment(t, { status: 'pending', user: owner.id });
      const code = (e: unknown) => (e as DomainError).code ?? `RAW:${(e as Error).message}`;
      const out = await Promise.all([
        race(() => t.ships.ship(staff, v.order.code, { tracking_number: trackingOf() }).then(() => 'ship-ok', code), () => t.cancels.cancel(cust, v.order.code, undefined).then(() => 'cancel-ok', code)).then(([a, b]) => [a, b]),
        (async () => { await new Promise((r) => setTimeout(r, 20 + Math.random() * 20)); return deliver(t, 'StockCommitFailed', { order_id: v.order.id, reason: 'reservation_expired' }).then(() => 'sys-ok', code); })(),
      ]).then(([ab, c]) => [...ab, c]);
      rounds.push({ v, out });
    }
    for (const { v, out } of rounds) {
      for (const o of out) expect(['ship-ok', 'cancel-ok', 'sys-ok', 'order-not-shippable', 'order-not-cancellable', 'shipment-invalid-transition']).toContain(o); // không RAW (40P01, lỗi CSDL thô)
      const sh = await shipmentRow(t, v.id);
      const ord = (await q<{ status: string; handoff_locked_at: Date | null }>(t, `SELECT status::text, handoff_locked_at FROM orders WHERE id = '${v.order.id}'`))[0];
      if (sh.status === 'shipped') expect(ord.handoff_locked_at).not.toBeNull(); // đã bàn giao thì có cờ
      if (sh.status === 'pending') expect(ord.status === 'cancelled' && ord.handoff_locked_at !== null).toBe(false);
    }
  }, 240_000);

  it(`SHP-TC-20261006-102134039 ${SEC} T17: danh sách một trang 100 vận đơn gọi OrderApi.getSummary đúng một lần mỗi đơn (N+1 có chủ ý, report mục 6) và vẫn trả đủ 100 mã đơn đúng thứ tự trong dưới 3 giây`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const m = (await seedShipment(t, { status: 'pending' })).method;
    for (let i = 0; i < 99; i++) await seedShipment(t, { status: 'pending', method: m, createdAt: new Date(Date.now() - (i + 1) * 60_000) });
    const spy = jest.spyOn(t.app.get(OrderApi), 'getSummary');
    t.clock.advance(61_000);
    const t0 = Date.now();
    const r = await call(t, 'get', '/shipping/shipments?limit=100&sort=newest', { cookie: s1.cookie });
    const ms = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(100);
    expect(r.body.items.every((x: { order_code: string }) => /^[0-9A-Z]{12}$/.test(x.order_code))).toBe(true);
    expect(new Set(r.body.items.map((x: { order_code: string }) => x.order_code)).size).toBe(100);
    expect(spy).toHaveBeenCalledTimes(100);
    expect(ms).toBeLessThan(3000);
  }, 120_000);

  it(`SHP-TC-20261006-102133602 ${SEC} T8: biến thể Unicode của mã vận đơn (chữ rộng, số rộng, ſ, ı, dấu Kelvin, ß, ký tự điều khiển giữa mã) bị 400 ở bàn giao, sửa mã và danh sách; không đổi gì, không rò 500`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const v = await seedShipment(t, { status: 'pending' }), w = await seedShipment(t, { status: 'shipped', tracking: 'GHN12345678' });
    const bad = ['ｇｈｎ12345678', 'GHN１２３４５６７８', 'ſhn12345678', 'ghn1234567ı', 'Khn12345678', 'ßßßß12345678', 'GHN 12345678X', 'GHN 12345678', 'GHN​12345678', 'GHN\t1234567'];
    for (const tn of bad) {
      expect([tn, (await call(t, 'post', `/shipping/orders/${v.order.code}/shipment/ship`, { cookie: s1.cookie, body: { tracking_number: tn } })).status]).toEqual([tn, 400]);
      expect([tn, (await call(t, 'patch', `/shipping/orders/${w.order.code}/shipment/tracking-number`, { cookie: s1.cookie, body: { tracking_number: tn, version: 2 } })).status]).toEqual([tn, 400]);
      expect([tn, (await call(t, 'get', `/shipping/shipments?tracking_number=${encodeURIComponent(tn)}`, { cookie: s1.cookie })).status]).toEqual([tn, 400]);
    }
    expect((await shipmentRow(t, v.id)).status).toBe('pending');
    expect((await shipmentRow(t, w.id)).tracking_number).toBe('GHN12345678');
    // khoảng trắng hai đầu và chữ thường vẫn hợp lệ, trả mã chuẩn hóa
    const ok = await call(t, 'post', `/shipping/orders/${v.order.code}/shipment/ship`, { cookie: s1.cookie, body: { tracking_number: '  ghn-0000-7777\n' } });
    expect([ok.status, ok.body.tracking_number]).toEqual([200, 'GHN-0000-7777']);
  });

  it(`SHP-TC-20261006-102134013 ${SEC} T1, T2: mã đơn có biến thể Unicode (ſ đổi chữ hoa thành S) không tra được đơn của mình (404 như mã sai định dạng)`, async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const o = await seedOrderFor(t, { user: c1.id, code: '2N6R4T8W0KSA' });
    await seedShipment(t, { status: 'shipped', order: o });
    expect((await call(t, 'get', `/shipping/orders/${o.code}/shipment`, { cookie: c1.cookie })).status).toBe(200);
    expect((await call(t, 'get', `/shipping/orders/${o.code.toLowerCase()}/shipment`, { cookie: c1.cookie })).status).toBe(200); // chữ thường ASCII hợp lệ
    expect(await countOf(t, 'orders', `code = '2N6R4T8W0KSA'`)).toBe(1);
    // ORD đổi chữ hoa trước khi kiểm khuôn nên `ſ` thành `S` lọt khuôn: cùng một đơn có hai cách gọi (phát hiện LOW, mã của ORD)
    const alias = await call(t, 'get', `/shipping/orders/2n6r4t8w0k${'ſ'}a/shipment`, { cookie: c1.cookie });
    expect(alias.status).toBe(404);
  });

  it(`SHP-TC-20261006-102133455 ${SEC} T20 (L71): handler tạo vận đơn giữ một kết nối của giao dịch giao event và đọc ORD bằng kết nối thứ hai nên pool một kết nối treo mãi: cấu hình DB_POOL_MAX nhỏ hơn 2 bị từ chối lúc khởi động, 2 trở lên qua`, () => {
    const env = { APP_ENV: 'dev', DATABASE_URL: 'postgresql://u:pw@localhost:5433/x', CORS_ALLOWED_ORIGINS: 'http://localhost:3000' };
    const err = (() => { try { loadConfig({ ...env, DB_POOL_MAX: '1' }); } catch (e) { return e as ConfigError; } return null; })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).problems.map((p) => p.name)).toEqual(['DB_POOL_MAX']);
    expect(() => loadConfig({ ...env, DB_POOL_MAX: '2' })).not.toThrow();
  });
});
