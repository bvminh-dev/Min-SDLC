import { seedProduct, seedCategory } from '../support/prd';
import { medianPairMs, q } from '../support/auth';
import { truncateAll } from '../support/db';
import { call, createOrdApp, deliver, insertRaw, orderOf, people, pgCode, seedOrder, type OrdApp } from '../support/ord';

// Chi tiết đơn (ORD-REQ-20261006-092320768): customer own, staff ẩn địa chỉ, admin đầy đủ, 404 đồng nhất, snapshot bất biến.
describe('ORD chi tiết đơn', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.advance(61_000); });
  const get = (path: string, cookie?: string) => call(t, 'get', path, { cookie });
  const strip = ({ trace_id: _t, ...r }: any) => r;
  const ADDR_B = { receiver: 'Trần Thị B', phone: '0912345678', line1: '45 Nguyễn Huệ', ward: 'Bến Thành', city: 'TP.HCM' };

  it('ORD-TC-20261006-111224869: customer mở chi tiết đơn paid của mình thấy đủ trường, địa chỉ năm khóa, can_cancel; không tracking_number và payment_expires_at', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'paid', items: [{ name: 'Áo thun cổ tròn', price: 100000, qty: 2 }, { name: 'Quần jean', price: 150000, qty: 1 }] });
    const d = await get(`/orders/${o.code}`, a.cookie);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ code: '7K3M9Q2XH4TB', status: 'paid', items_total: 350000, discount: 0, shipping_fee: 30000, grand_total: 380000, payment_method: 'vnpay', payment_status: 'succeeded', can_cancel: true });
    expect(d.body.items).toEqual([{ name: 'Áo thun cổ tròn', unit_price: 100000, quantity: 2, line_total: 200000 }, { name: 'Quần jean', unit_price: 150000, quantity: 1, line_total: 150000 }]);
    expect(Object.keys(d.body.shipping_address).sort()).toEqual(['city', 'district', 'line1', 'phone', 'receiver', 'ward']);
    expect(d.body).not.toHaveProperty('tracking_number');
    expect(d.body).not.toHaveProperty('payment_expires_at'); // đã rời pending
    expect(d.body.items_total - d.body.discount + d.body.shipping_fee).toBe(d.body.grand_total);
    const h = await get(`/orders/${o.code}/status-history`, a.cookie);
    expect(h.body.items.map((i: any) => i.status)).toEqual(['pending', 'paid']);
  });

  it('ORD-TC-20261006-111224900: staff mở chi tiết đơn của customer khác không thấy người nhận, điện thoại, địa chỉ (không có khóa shipping_address), can_cancel false', async () => {
    const { b, staff } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'paid', address: ADDR_B });
    const d = await get(`/orders/${o.code}`, staff.cookie);
    expect(d.status).toBe(200);
    for (const k of ['code', 'status', 'items', 'items_total', 'discount', 'shipping_fee', 'grand_total', 'payment_method', 'payment_status']) expect(d.body).toHaveProperty(k);
    expect(d.body).not.toHaveProperty('shipping_address');
    expect(d.body.can_cancel).toBe(false);
    expect(JSON.stringify(d.body)).not.toMatch(/Trần Thị B|0912345678|Bến Thành/);
  });

  it('ORD-TC-20261006-111224930: admin mở chi tiết đơn của customer thấy đầy đủ địa chỉ giao đúng năm khóa và can_cancel true', async () => {
    const { b, admin } = await people(t);
    const o = await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T', status: 'paid', address: ADDR_B });
    const d = await get(`/orders/${o.code}`, admin.cookie);
    expect([d.status, d.body.shipping_address, d.body.can_cancel]).toEqual([200, ADDR_B, true]);
  });

  it('ORD-TC-20261006-111224962: customer mở đơn của người khác và đơn không tồn tại nhận 404 giống hệt từng byte (trừ trace_id), không 403; thời gian phản hồi gần nhau', async () => {
    const { a, b } = await people(t);
    await seedOrder(t, { user: b.id, code: '8M2N4P6R8S0T' });
    const [other, none] = [await get('/orders/8M2N4P6R8S0T', a.cookie), await get('/orders/9X9X9X9X9X9X', a.cookie)];
    for (const r of [other, none]) { expect(r.status).toBe(404); expect(r.headers['content-type']).toMatch(/application\/problem\+json/); expect(r.body).toMatchObject({ type: 'urn:ecom:error:not-found', status: 404 }); expect(JSON.stringify(r.body)).not.toContain('8M2N4P6R8S0T'); }
    expect(JSON.stringify(strip(other.body))).toBe(JSON.stringify(strip(none.body)));
    const [mOther, mNone] = await medianPairMs(60, () => get('/orders/8M2N4P6R8S0T', a.cookie), () => get('/orders/9X9X9X9X9X9X', a.cookie), async () => { t.clock.advance(60_000); }); // đo xen kẽ; sang cửa sổ mới sau mỗi cặp để không chạm bậc C
    expect(Math.abs(mOther - mNone)).toBeLessThan(10); // kiểm mềm theo TC: cùng đường truy vấn nên thời gian gần nhau
  }, 60_000);

  it('ORD-TC-20261006-111224993: guest và phiên hết hạn mở chi tiết đơn nhận 401, thân giống nhau cho mã có thật và không có thật', async () => {
    const { a } = await people(t);
    await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB' });
    const rs = [await get('/orders/7K3M9Q2XH4TB'), await get('/orders/9X9X9X9X9X9X')];
    rs.forEach((r) => expect([r.status, r.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']));
    expect(JSON.stringify(strip(rs[0].body))).toBe(JSON.stringify(strip(rs[1].body)));
    expect(JSON.stringify(rs[0].body)).not.toContain('7K3M9Q2XH4TB');
  });

  it('ORD-TC-20261006-111225023: admin và staff mở mã không tồn tại nhận cùng 404 not-found, không có thân đơn', async () => {
    const { admin, staff } = await people(t);
    const [x, y] = [await get('/orders/9X9X9X9X9X9X', admin.cookie), await get('/orders/9X9X9X9X9X9X', staff.cookie)];
    for (const r of [x, y]) expect([r.status, r.body.type, r.body.items]).toEqual([404, 'urn:ecom:error:not-found', undefined]);
    expect(JSON.stringify(strip(x.body))).toBe(JSON.stringify(strip(y.body)));
  });

  it('ORD-TC-20261006-111225056: mã sai định dạng (ngắn, dài, ngoài bảng chữ, 300 ký tự, SQL, đường dẫn) trả cùng 404 với mã mốc cho mọi role, không 400, không 500, log không có lỗi SQL', async () => {
    const { a, staff, admin } = await people(t);
    await seedOrder(t, { user: a.id });
    for (const who of [a, staff, admin]) {
      const base = await get('/orders/9X9X9X9X9X9X', who.cookie);
      for (const c of ['abc', '7K3M9Q2XH4T', '7K3M9Q2XH4TBX', 'ILOUILOUILOU', 'A'.repeat(300), '%27%20OR%201%3D1--', '..%2F..%2Fadmin']) {
        const r = await get(`/orders/${c}`, who.cookie);
        expect([r.status, JSON.stringify(strip(r.body))]).toEqual([404, JSON.stringify(strip(base.body))]);
      }
      t.clock.advance(61_000);
    }
    expect(t.logs.records.filter((r) => /SELECT|prisma|stack|syntax/i.test(JSON.stringify(r)) && ['error', 'warn'].includes(r.level)).map((r) => r.msg)).toEqual([]);
  });

  it('ORD-TC-20261006-111225088: quét mã đơn bị giới hạn bậc C (120 mỗi phút): yêu cầu 121 nhận 429 kèm Retry-After; người khác không bị ảnh hưởng; hết Retry-After thì gọi lại được; hủy bậc B (lần 11) và danh sách quản trị bậc D (lần 31) cũng 429', async () => {
    const { a, b, admin } = await people(t);
    await seedOrder(t, { user: b.id, code: '7K3M9Q2XH4TB' });
    for (let i = 0; i < 120; i++) expect((await get(`/orders/${'9X9X'.repeat(3).slice(0, 8)}${String(1000 + i)}`, a.cookie)).status).toBe(404);
    const r = await get('/orders/9X9X9X9X9X9X', a.cookie);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(JSON.stringify(r.body)).not.toContain('9X9X');
    expect((await get('/orders/7K3M9Q2XH4TB', b.cookie)).status).toBe(200);
    t.clock.advance(Number(r.headers['retry-after']) * 1000);
    expect((await get('/orders/9X9X9X9X9X9X', a.cookie)).status).toBe(404);
    for (let i = 0; i < 10; i++) expect((await call(t, 'post', '/orders/9X9X9X9X9X9X/cancel', { cookie: a.cookie, body: {} })).status).toBe(404);
    expect((await call(t, 'post', '/orders/9X9X9X9X9X9X/cancel', { cookie: a.cookie, body: {} })).status).toBe(429);
    for (let i = 0; i < 30; i++) expect((await get('/admin/orders', admin.cookie)).status).toBe(200);
    expect((await get('/admin/orders', admin.cookie)).status).toBe(429);
  }, 120_000);

  it('ORD-TC-20261006-111225118: đơn đã hủy có lý do hiện cancelled, can_cancel false, không tracking_number; lịch sử dòng cuối mang lý do (dựng bằng POST cancel thật)', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'paid' });
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    const at = t.clock.now().toISOString();
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: a.cookie, body: { reason: 'đặt nhầm' } })).status).toBe(200);
    const d = await get(`/orders/${o.code}`, a.cookie), h = await get(`/orders/${o.code}/status-history`, a.cookie);
    expect([d.body.status, d.body.can_cancel, 'tracking_number' in d.body]).toEqual(['cancelled', false, false]);
    expect(h.body.items.at(-1)).toEqual({ at, status: 'cancelled', reason: 'đặt nhầm' });
  });

  it('ORD-TC-20261006-111225149: đơn COD confirmed hiện cod, payment_status chưa thu tiền, can_cancel true, không tracking_number, không giá trị succeeded', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod', items: [{ price: 220000, qty: 1 }], shipping: 30000 });
    const d = await get(`/orders/${o.code}`, a.cookie);
    expect(d.body).toMatchObject({ payment_method: 'cod', payment_status: 'pending', status: 'confirmed', can_cancel: true, grand_total: 250000 });
    expect(d.body).not.toHaveProperty('tracking_number');
    expect(JSON.stringify(d.body)).not.toContain('succeeded');
  });

  it('ORD-TC-20261006-111225177: đơn vẫn hiện tên và giá lúc đặt khi sản phẩm bị đổi tên, đổi giá rồi lưu trữ; tổng không đổi (không join ngầm sang PRD)', async () => {
    const { a } = await people(t);
    const cat = await seedCategory(t, 'Áo');
    const product = await seedProduct(t as never, { category: cat, name: 'Áo thun cổ tròn', price: 100000 });
    const o = await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', items: [{ product, name: 'Áo thun cổ tròn', price: 100000, qty: 2 }], shipping: 0 });
    const before = (await get(`/orders/${o.code}`, a.cookie)).body;
    await q(t, `UPDATE products SET name = 'Áo thun v2', price = 120000 WHERE id = '${product}'`);
    await q(t, `UPDATE products SET status = 'archived' WHERE id = '${product}'`);
    const after = (await get(`/orders/${o.code}`, a.cookie)).body;
    expect(after.items).toEqual([{ name: 'Áo thun cổ tròn', unit_price: 100000, quantity: 2, line_total: 200000 }]);
    expect([after.items_total, after.grand_total]).toEqual([before.items_total, before.grand_total]);
  });

  it('ORD-TC-20261006-111225205: grand_total = items_total - discount + shipping_fee; INSERT lệch công thức bị CHECK 23514; không có route POST /orders hay PATCH /orders/{code}', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, code: '3B5D7F9H1K3M', items: [{ price: 300000, qty: 1 }], discount: 20000, shipping: 30000 });
    expect((await get(`/orders/${o.code}`, a.cookie)).body.grand_total).toBe(310000);
    const before = (await q<{ n: number }>(t, 'SELECT count(*)::int AS n FROM orders'))[0].n;
    expect(await pgCode(insertRaw(t, a.id, { grand: 310001 }))).toBe('23514');
    expect(await pgCode(insertRaw(t, a.id, { grand: 310000 }))).toBe('ok'); // đối chứng: đúng công thức thì chèn được
    for (const [method, path] of [['post', '/orders'], ['patch', `/orders/${o.code}`], ['put', `/orders/${o.code}`]] as const) {
      const r = await call(t, method, path, { cookie: a.cookie, body: { grand_total: 1 } });
      expect([404, 405]).toContain(r.status);
    }
    expect((await orderOf(t, o.code)).grand_total).toBe('310000');
    expect((await q<{ n: number }>(t, 'SELECT count(*)::int AS n FROM orders'))[0].n).toBe(before + 1);
  });

  it('ORD-TC-20261006-121202827: đơn online pending có payment_expires_at (ISO UTC), COD và đơn đã rời pending không có khóa này; staff thấy hạn nhưng không thấy địa chỉ; sau StockReservationExpired khóa biến mất', async () => {
    const { a, staff } = await people(t);
    const expires = new Date(Date.now() + 900_000);
    const [pend, cod, paid] = [await seedOrder(t, { user: a.id, code: '7K3M9Q2XH4TB', status: 'pending', expiresAt: expires }), await seedOrder(t, { user: a.id, code: '4G6H8J2K4M6N', status: 'confirmed', method: 'cod' }), await seedOrder(t, { user: a.id, code: '5C7D9F1G3H5J', status: 'paid' })];
    expect((await get(`/orders/${pend.code}`, a.cookie)).body.payment_expires_at).toBe(expires.toISOString());
    expect(await get(`/orders/${cod.code}`, a.cookie).then((r) => 'payment_expires_at' in r.body)).toBe(false);
    expect(await get(`/orders/${paid.code}`, a.cookie).then((r) => 'payment_expires_at' in r.body)).toBe(false);
    const s = (await get(`/orders/${pend.code}`, staff.cookie)).body;
    expect([s.payment_expires_at, 'shipping_address' in s]).toEqual([expires.toISOString(), false]);
    await deliver(t, 'StockReservationExpired', { order_id: pend.id });
    const after = (await get(`/orders/${pend.code}`, a.cookie)).body;
    expect([after.status, 'payment_expires_at' in after]).toEqual(['expired', false]);
  });
});
