import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { seedSession } from '../support/auth';
import { call, createShpApp, q, seedMethod, snapshotCounts, who, type ShpApp } from '../support/shp';

// Phương thức đang bật cho customer (SHP-REQ-20261006-101103782) và báo phí (SHP-REQ-20261006-101103806), cùng giao diện nội bộ ShippingApi cho CRT, CHK.
describe('SHP phương thức đang bật và báo phí', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const quote = (cookie: string | undefined, body: unknown) => call(t, 'post', '/shipping/quote', { cookie, body });
  const tieuChuan = (o: { fee?: number; freeOver?: number | null; surcharge?: number; cities?: string[]; name?: string } = {}) =>
    seedMethod(t, { name: o.name ?? 'Giao tiêu chuẩn', fee: o.fee ?? 30000, freeOver: o.freeOver === undefined ? 500000 : o.freeOver, surcharge: o.surcharge ?? 20000, cities: o.cities ?? ['Hà Giang'] });

  it('SHP-TC-20261006-102133211: customer xem hai phương thức đang bật theo thứ tự phí tăng dần, đúng bốn khóa, không lộ rule hay phương thức đã tắt', async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    await seedMethod(t, { name: 'Giao nhanh', fee: 50000, freeOver: null, surcharge: 20000, cities: ['Hà Giang'] });
    await seedMethod(t, { name: 'Giao tiêu chuẩn', fee: 30000, freeOver: 500000, surcharge: 20000, cities: ['Hà Giang'] });
    await seedMethod(t, { name: 'Giao hỏa tốc', fee: 90000, active: false });
    const r = await call(t, 'get', '/shipping/methods', { cookie: c1.cookie });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { name: string }) => i.name)).toEqual(['Giao tiêu chuẩn', 'Giao nhanh']);
    for (const i of r.body.items) expect(Object.keys(i).sort()).toEqual(['base_fee', 'free_over', 'id', 'name']);
    expect(r.body.items.map((i: { free_over: number | null }) => i.free_over)).toEqual([500000, null]);
    expect(JSON.stringify(r.body)).not.toMatch(/surcharge|is_active|version|Giao hỏa tốc/);
    expect((await t.shp.listActiveMethods()).map((m) => [m.name, m.base_fee, m.free_over])).toEqual([['Giao tiêu chuẩn', 30000, 500000], ['Giao nhanh', 50000, null]]); // giao diện nội bộ cùng kết quả
  });

  it('SHP-TC-20261006-102133235: guest, staff và admin không gọi được danh sách phương thức của customer; phiên hết hạn như guest; body lỗi chỉ có type, title, status, trace_id', async () => {
    const [s1, a1, c1] = [await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn'), await who(t, 'customer', 'c1@x.vn')];
    await seedMethod(t, { name: 'Giao nhanh' }); await seedMethod(t, { name: 'Giao chậm' });
    const guest = await call(t, 'get', '/shipping/methods');
    expect(guest.status).toBe(401);
    for (const r of [guest, await call(t, 'get', '/shipping/methods', { cookie: s1.cookie }), await call(t, 'get', '/shipping/methods', { cookie: a1.cookie })]) expect(Object.keys(r.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
    expect([(await call(t, 'get', '/shipping/methods', { cookie: s1.cookie })).status, (await call(t, 'get', '/shipping/methods', { cookie: a1.cookie })).status]).toEqual([403, 403]);
    const old = new Date(t.clock.now().getTime() - 31 * 60_000);
    const stale = await seedSession(t, c1.id, { createdAt: old, lastSeenAt: old });
    expect((await call(t, 'get', '/shipping/methods', { cookie: stale.cookie })).status).toBe(401);
  });

  it('SHP-TC-20261006-102133259: danh sách rỗng khi mọi phương thức đã tắt (200, không phải lỗi); cùng phí thì theo tên không phân biệt hoa thường và ổn định', async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const [a, b] = [await seedMethod(t, { name: 'Đã tắt 1', active: false }), await seedMethod(t, { name: 'Đã tắt 2', active: false })];
    const empty = await call(t, 'get', '/shipping/methods', { cookie: c1.cookie });
    expect([empty.status, empty.body]).toEqual([200, { items: [] }]);
    await q(t, `DELETE FROM shipping_methods WHERE id IN ('${a}', '${b}')`);
    await seedMethod(t, { name: 'giao thường', fee: 30000 }); const chuan = await seedMethod(t, { name: 'Giao Chuẩn', fee: 30000 });
    for (let i = 0; i < 5; i++) expect((await call(t, 'get', '/shipping/methods', { cookie: c1.cookie })).body.items.map((x: { name: string }) => x.name)).toEqual(['Giao Chuẩn', 'giao thường']);
    await t.prisma.$executeRaw`UPDATE shipping_methods SET is_active = false WHERE id = ${chuan}::uuid`; // admin tắt giữa chừng
    expect((await call(t, 'get', '/shipping/methods', { cookie: c1.cookie })).body.items.map((x: { name: string }) => x.name)).toEqual(['giao thường']);
    await seedMethod(t, { name: 'Zeta', fee: 99000 }); await seedMethod(t, { name: 'alpha', fee: 99000 });
    expect((await call(t, 'get', '/shipping/methods', { cookie: c1.cookie })).body.items.map((x: { name: string }) => x.name)).toEqual(['giao thường', 'alpha', 'Zeta']); // cùng phí: tên không phân biệt hoa thường
  });

  it('SHP-TC-20261006-102133284: tính phí Giao tiêu chuẩn cho Hà Nội, vùng phụ thu và đơn đạt ngưỡng; không ghi gì; giao diện nội bộ giống hệt endpoint', async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const m = await tieuChuan();
    const before = await snapshotCounts(t);
    const cases: [string, number, number, boolean][] = [['Hà Nội', 499999, 30000, false], ['Hà Nội', 500000, 0, true], ['  hà  GIANG ', 100000, 50000, false]];
    for (const [city, subtotal, fee, free] of cases) {
      const http = await quote(c1.cookie, { method_id: m, city, subtotal });
      expect([http.status, http.body]).toEqual([200, { method_id: m, fee, free_shipping: free }]);
      expect(await t.shp.quote({ method_id: m, city, subtotal })).toEqual({ fee, free_shipping: free });
    }
    expect(await snapshotCounts(t)).toEqual(before);
  });

  it('SHP-TC-20261006-102133308 (SB-23, SB-11, T5, T23): báo phí bị từ chối với đầu vào sai, phương thức không có hoặc đã tắt, sai role; không có trường fee trong lỗi', async () => {
    const [c1, s1, a1] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'staff', 's1@shop.vn'), await who(t, 'admin', 'a1@shop.vn')];
    const m = await tieuChuan(); const off = await seedMethod(t, { name: 'Giao hỏa tốc', active: false });
    const ok = { method_id: m, city: 'Hà Nội', subtotal: 1000 };
    const bads: [string, unknown][] = [
      ['subtotal', { ...ok, subtotal: -1 }], ['subtotal', { ...ok, subtotal: 'abc' }], ['city', { method_id: m, subtotal: 1000 }], ['city', { ...ok, city: 'x'.repeat(101) }],
      ['method_id', { ...ok, method_id: '123' }], ['fee', { ...ok, fee: 0 }], ['subtotal', { ...ok, subtotal: 10000000001 }], ['subtotal', { ...ok, subtotal: 1.5 }], ['city', { ...ok, city: 'Hà\u0000Nội' }],
    ];
    for (const [field, body] of bads) {
      const r = await quote(c1.cookie, body);
      expect([field, r.status, r.body.type, 'fee' in r.body]).toEqual([field, 400, 'urn:ecom:error:validation-failed', false]);
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    }
    expect((await quote(c1.cookie, { ...ok, city: 'x'.repeat(100) })).status).toBe(200); // biên hợp lệ, khớp Address.city của USR
    const none = await quote(c1.cookie, { ...ok, method_id: randomUUID() });
    expect([none.status, none.body.type, 'fee' in none.body]).toEqual([404, 'urn:ecom:error:not-found', false]);
    const closed = await quote(c1.cookie, { ...ok, method_id: off });
    expect([closed.status, closed.body.type, 'fee' in closed.body]).toEqual([409, 'urn:ecom:error:method-unavailable', false]);
    expect([(await quote(undefined, ok)).status, (await quote(s1.cookie, ok)).status, (await quote(a1.cookie, ok)).status]).toEqual([401, 403, 403]);
    // giao diện nội bộ: cùng mã lỗi cho phương thức tắt, không có hay sai định dạng; đầu vào sai ném RangeError
    for (const id of [off, randomUUID(), 'không-phải-uuid']) await expect(t.shp.quote({ method_id: id, city: 'Hà Nội', subtotal: 1 })).rejects.toMatchObject({ code: 'method-unavailable' });
    await expect(t.shp.quote({ method_id: m, city: 'Hà Nội', subtotal: -1 })).rejects.toThrow(RangeError);
    await expect(t.shp.quote({ method_id: m, city: 'Hà Nội', subtotal: 1.5 })).rejects.toThrow(RangeError);
    await expect(t.shp.quote({ method_id: m, city: '', subtotal: 1 })).rejects.toThrow(RangeError);
    await expect(t.shp.quote({ method_id: m, city: 'x'.repeat(101), subtotal: 1 })).rejects.toThrow(RangeError);
    await expect(t.shp.quote({ method_id: m, city: 'Hà Nội', subtotal: 10000000001 })).rejects.toThrow(RangeError);
  });

  it('SHP-TC-20261006-102133333: biên ngưỡng miễn phí (>=), phụ thu và so khớp tên thành phố (khoảng trắng, hoa thường, dấu, đ); free_over 0 và null', async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const m = await tieuChuan();
    const fee = async (id: string, city: string, subtotal: number) => (await quote(c1.cookie, { method_id: id, city, subtotal })).body;
    expect(await fee(m, 'Hà Giang', 500000)).toMatchObject({ fee: 0, free_shipping: true }); // miễn phí thắng phụ thu
    expect(await fee(m, 'Hà Giang', 499999)).toMatchObject({ fee: 50000, free_shipping: false });
    const b = await seedMethod(t, { name: 'Phương thức B', fee: 30000, freeOver: 0 }), cc = await seedMethod(t, { name: 'Phương thức C', fee: 30000, freeOver: null });
    expect(await fee(b, 'Hà Nội', 0)).toMatchObject({ fee: 0, free_shipping: true }); // 0 >= 0
    expect(await fee(cc, 'Hà Nội', 10000000000)).toMatchObject({ fee: 30000, free_shipping: false });
    for (const [city, f] of [['Hà', 30000], ['Hà Giang 2', 30000], ['HA GIANG', 50000], ['Hà Giang', 50000], ['ha   giang', 50000], ['Há Giang', 50000], ['Hà Gian', 30000]] as const) expect([city, (await fee(m, city, 100)).fee]).toEqual([city, f]);
    const dn = await tieuChuan({ name: 'Đà Nẵng đặc biệt', cities: ['Đà Nẵng'] });
    for (const city of ['da nang', 'ĐÀ NẴNG', 'Da Nang', 'đà nẵng']) expect([city, (await fee(dn, city, 100)).fee]).toEqual([city, 50000]);
    const nfd = 'Hà Giang'; // dạng NFD của "Hà"
    expect((await fee(m, nfd, 100)).fee).toBe(50000);
  });

  it('SHP-TC-20261006-102133358 (SB-23, T5): phí trên đơn do server tính lại từ tạm tính của server, không lấy số khách đã thấy; endpoint không nhớ subtotal của client', async () => {
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const m = await tieuChuan({ fee: 30000, freeOver: 500000, surcharge: 0, cities: [] });
    const seen = await quote(c1.cookie, { method_id: m, city: 'Hà Nội', subtotal: 600000 });
    expect(seen.body).toMatchObject({ fee: 0, free_shipping: true });
    // CHK (stub): gọi giao diện nội bộ với tạm tính thật của server
    expect(await t.shp.quote({ method_id: m, city: 'Hà Nội', subtotal: 400000 })).toEqual({ fee: 30000, free_shipping: false });
    expect((await quote(c1.cookie, { method_id: m, city: 'Hà Nội', subtotal: 400000 })).body.fee).toBe(30000);
    expect((await quote(c1.cookie, { method_id: m, city: 'Hà Nội', subtotal: 600000, fee: 0 })).status).toBe(400); // `fee` của client không bao giờ là đầu vào
  });

  it('SHP-TC-20261006-102133383 (SB-14 bậc C, T16): báo phí thứ 121 trong một phút nhận 429 kèm Retry-After; qua cửa sổ thì 200; người khác không ảnh hưởng; lời gọi nội bộ không bị giới hạn', async () => {
    const [c1, c2] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'customer', 'c2@x.vn')];
    const m = await tieuChuan();
    const body = { method_id: m, city: 'Hà Nội', subtotal: 1000 };
    t.clock.set(new Date(Math.floor(t.clock.now().getTime() / 60_000) * 60_000 + 1000)); // đầu cửa sổ một phút
    const codes: number[] = [];
    for (let i = 0; i < 121; i++) codes.push((await quote(c1.cookie, body)).status);
    expect(codes.slice(0, 120).every((c) => c === 200)).toBe(true);
    expect(codes[120]).toBe(429);
    const limited = await quote(c1.cookie, body);
    expect(limited.body.type).toBe('urn:ecom:error:rate-limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await quote(c2.cookie, body)).status).toBe(200);
    for (let i = 0; i < 121; i++) await t.shp.quote(body); // giới hạn chỉ áp cho endpoint HTTP
    t.clock.advance(60_000);
    expect((await quote(c1.cookie, body)).status).toBe(200);
  }, 120_000);
});
