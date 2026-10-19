import { randomUUID } from 'node:crypto';
import { CreateService } from '../../src/modules/sales/create.service';
import { noTrace } from '../support/chk';
import { ADDRESS, alignWindow, call, count, createSalApp, itemRows, newKey, orderRow, postOrder, prod, q, relayAll, reservedOf, resetSal, salWorld, stdBody, traces, who, type SalApp, type SalWorld } from '../support/sal';
import { stock } from '../support/crt';

// SAL tạo đơn hộ (SAL-REQ-20261015-092710847): POST /sales/orders trên AppModule thật (PRD, INV, SHP, ORD, USR, SAL), PostgreSQL thật, không bản giả nào.
// fixed-clock: đồng hồ ứng dụng là FakeClock đặt về giờ thật lúc dựng; mã đơn lấy ngày giờ Việt Nam từ Clock, test nửa đêm đặt mốc tường minh bằng clock.set.
const ZERO = [0, 0, 0, 0, 0, 0];
const SEC = 'SAL-SEC-20261015-093121500';
const vnDay = (d: Date): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: '2-digit', month: '2-digit', day: '2-digit' }).format(d).split('/').reverse().join('');
const errorsOf = (r: { body: any }): { field: string; code: string }[] => r.body.errors;

describe('SAL tạo đơn hộ trên AppModule thật', () => {
  let t: SalApp;
  let w: SalWorld;
  beforeAll(async () => { t = await createSalApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { jest.restoreAllMocks(); await resetSal(t); alignWindow(t); w = await salWorld(t); });

  it(`SAL-TC-20261015-093909632 ${SEC} T12, T5: sale tạo đơn COD cho khách chưa có tài khoản: 201 confirmed, đơn đúng người tạo, nguồn, khách, ghi chú; giữ hàng rồi INV chốt, SHP có vận đơn pending, đúng một audit không dữ liệu cá nhân, giá vốn không ra khỏi SAL`, async () => {
    const body = stdBody(w, { note: 'Giao giờ hành chính', items: [{ product_id: w.p1, quantity: 2, note: 'size M, màu xanh' }] });
    const r = await postOrder(t, w.s1, body);
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ replayed: false, order: { status: 'confirmed', grand_total: 330000, payment_method: 'cod', source_code: 'facebook' } });
    expect(r.body.order.code).toMatch(/^HD\d{6}-\d{5}$/);
    expect(r.body.order.code.slice(2, 8)).toBe(vnDay(t.clock.now()));
    expect(r.body.next).toEqual({ url: `/sales/orders/${r.body.order.code}` });
    const o = await orderRow(t, r.body.order.code);
    expect(o).toMatchObject({ created_by: w.s1.id, user_id: null, source_code: 'facebook', status: 'confirmed', payment_status: 'pending', note: 'Giao giờ hành chính', customer_snapshot: { full_name: 'Nguyễn An', phone: '0901234567' } });
    expect(await itemRows(t, o.id)).toEqual([expect.objectContaining({ product_id: w.p1, name_snapshot: 'Áo thun cotton', unit_price: 150000, quantity: 2, note: 'size M, màu xanh', cost_snapshot: 90000 })]);
    expect(await reservedOf(t, w.p1)).toBe(2);
    const au = await q<any>(t, "SELECT actor_id, actor_role, action, after FROM audit_logs WHERE action = 'order.created_ho'");
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_id: w.s1.id, actor_role: 'sale' });
    expect(au[0].after).toEqual({ order_code: r.body.order.code, source: 'facebook', has_user_id: false, items: 1, grand_total: 330000, payment_method: 'cod' }); // đúng bộ khóa, không dữ liệu cá nhân
    expect(JSON.stringify(au)).not.toMatch(/Nguyễn An|0901234567|Nguyễn Huệ|Giao giờ|size M|90000|cost/);
    expect(`${JSON.stringify(r.body)}\n${t.logs.lines.join('\n')}`).not.toMatch(/90000|cost/i); // giá vốn không vào phản hồi hay log
    await relayAll(t);
    expect(await q(t, `SELECT on_hand, reserved FROM stock_items WHERE product_id = '${w.p1}'`)).toEqual([{ on_hand: 48, reserved: 0 }]); // INV chốt sau OrderConfirmed
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM shipments WHERE order_id = '${o.id}'`)).map((x) => x.status)).toEqual(['pending']);
  });

  it(`SAL-TC-20261015-093909666 ${SEC} T16: gắn khách có tài khoản và chọn chuyển khoản: đơn mang user_id của khách, khách thấy đơn ở danh sách của mình, SAL không tạo Payment và không đổi payment_status`, async () => {
    const r = await postOrder(t, w.s1, stdBody(w, { customer: { user_id: w.u1.id, full_name: 'Nguyễn An', phone: '0901234567' }, payment_method: 'bank_transfer' }));
    expect(r.status).toBe(201);
    const o = await orderRow(t, r.body.order.code);
    expect([o.user_id, o.created_by, o.payment_method, o.payment_status]).toEqual([w.u1.id, w.s1.id, 'bank_transfer', 'pending']);
    expect(await count(t, 'payments')).toBe(0);
    const mine = await call(t, 'get', '/orders', { cookie: w.u1.cookie });
    expect(mine.body.items.map((x: { code: string }) => x.code)).toContain(r.body.order.code);
  });

  it('SAL-TC-20261015-093909700: admin tạo đơn hộ như sale: created_by là admin, báo cáo theo sale của ORD tính cho admin', async () => {
    const r = await postOrder(t, w.ad, stdBody(w));
    expect(r.status).toBe(201);
    expect((await orderRow(t, r.body.order.code)).created_by).toBe(w.ad.id);
    const day = t.clock.now().getTime();
    const rep = await t.ord.getSalesReport({ from: new Date(day - 86_400_000), to: new Date(day + 86_400_000) });
    expect(rep.items).toEqual([expect.objectContaining({ created_by: w.ad.id, orders: 1, revenue: 330000 })]);
  });

  it(`SAL-TC-20261015-093909733 ${SEC} T1: customer, staff và guest không tạo được đơn hộ: 403, 403, 401; createHo và reserve không được gọi, không để lại gì`, async () => {
    const createHo = jest.spyOn(t.ord, 'createHo'), reserve = jest.spyOn(t.inv, 'reserve');
    const [u, st, guest] = [await postOrder(t, w.u1, stdBody(w)), await postOrder(t, w.st, stdBody(w)), await postOrder(t, undefined, stdBody(w))];
    expect([u.status, u.body.type, st.status, st.body.type, guest.status, guest.body.type]).toEqual([403, 'urn:ecom:error:forbidden', 403, 'urn:ecom:error:forbidden', 401, 'urn:ecom:error:unauthenticated']);
    expect(createHo).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(await traces(t)).toEqual(ZERO);
  });

  it(`SAL-TC-20261015-093909766 ${SEC} T2: thân gửi created_by của sale khác bị 400 unknown_field; đơn hợp lệ liền sau có created_by là người gọi`, async () => {
    const r = await postOrder(t, w.s1, stdBody(w, { created_by: w.s2.id }));
    expect(r.status).toBe(400);
    expect(errorsOf(r)).toContainEqual({ field: 'created_by', code: 'unknown_field' });
    expect(await traces(t)).toEqual(ZERO);
    const ok = await postOrder(t, w.s1, stdBody(w));
    expect(ok.status).toBe(201);
    expect((await orderRow(t, ok.body.order.code)).created_by).toBe(w.s1.id);
  });

  it(`SAL-TC-20261015-093909798 ${SEC} T4: trường tiền, tên hàng, trạng thái, người dùng ở gốc bị 400 nêu đúng trường lạ; grand_total do server tính`, async () => {
    const cases: [string, (b: Record<string, any>) => void][] = [
      ['items.0.unit_price', (b) => { b.items[0].unit_price = 1; }], ['grand_total', (b) => { b.grand_total = 1; }], ['shipping_fee', (b) => { b.shipping_fee = 0; }],
      ['items.0.name', (b) => { b.items[0].name = 'Rẻ'; }], ['status', (b) => { b.status = 'paid'; }], ['user_id', (b) => { b.user_id = w.u1.id; }],
    ];
    for (const [field, mutate] of cases) {
      const b = stdBody(w);
      mutate(b);
      const r = await postOrder(t, w.s1, b);
      expect([field, r.status, errorsOf(r)]).toEqual([field, 400, [{ field, code: 'unknown_field' }]]);
    }
    expect(await traces(t)).toEqual(ZERO);
    const ok = await postOrder(t, w.s1, stdBody(w));
    expect([ok.status, ok.body.order.grand_total]).toEqual([201, 330000]);
  });

  it('SAL-TC-20261015-093909831: thân sai định dạng bị 400 theo từng trường (nguồn sai định dạng là 409, xem Lệch spec)', async () => {
    const cases: [string, (b: Record<string, any>) => void, { field: string; code: string }][] = [
      ['phone', (b) => { b.customer.phone = '12345'; }, { field: 'customer.phone', code: 'invalid_phone' }],
      ['payment', (b) => { b.payment_method = 'vnpay'; }, { field: 'payment_method', code: 'invalid_format' }],
      ['items rỗng', (b) => { b.items = []; }, { field: 'items', code: 'required' }],
      ['quantity 0', (b) => { b.items[0].quantity = 0; }, { field: 'items.0.quantity', code: 'out_of_range' }],
      ['trùng dòng', (b) => { b.items.push({ product_id: w.p1, quantity: 1 }); }, { field: 'items.1.product_id', code: 'duplicate_product' }],
    ];
    for (const [name, mutate, want] of cases) {
      const b = stdBody(w);
      mutate(b);
      const r = await postOrder(t, w.s1, b);
      expect([name, r.status, r.body.type, errorsOf(r)]).toEqual([name, 400, 'urn:ecom:error:validation-failed', [want]]);
    }
    const src = await postOrder(t, w.s1, stdBody(w, { source_code: 'Facebook!' })); // SAL-REQ ...092711128 BR2: sai định dạng cùng 409 với không có, không phải 400
    expect([src.status, src.body.type]).toEqual([409, 'urn:ecom:error:order-source-unavailable']);
    expect(await traces(t)).toEqual(ZERO);
  });

  it(`SAL-TC-20261015-093909866 ${SEC} T7: customer.user_id là staff, admin hay không tồn tại cùng 422 customer-not-found, thân giống hệt`, async () => {
    const out = [];
    for (const id of [w.st.id, w.ad.id, randomUUID(), 'khong-phai-uuid']) out.push(await postOrder(t, w.s1, stdBody(w, { customer: { user_id: id, full_name: 'Nguyễn An', phone: '0901234567' } })));
    expect(out.map((r) => r.status)).toEqual([422, 422, 422, 422]);
    expect(new Set(out.map((r) => JSON.stringify(noTrace(r.body)))).size).toBe(1);
    expect(out[0].body.type).toBe('urn:ecom:error:customer-not-found');
    expect(JSON.stringify(out[0].body)).not.toMatch(/staff|admin|st1|ad1/i);
    expect(await traces(t)).toEqual(ZERO);
  });

  it('SAL-TC-20261015-093909900: tổng khác expected_grand_total thì 409 price-changed kèm review, không tạo gì; gửi lại đúng tổng thì 201', async () => {
    const r = await postOrder(t, w.s1, stdBody(w, { expected_grand_total: 300000 }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:price-changed', previous_grand_total: 300000, review: { items_subtotal: 300000, shipping_fee: 30000, grand_total: 330000, expected_grand_total: 330000 } });
    expect(await traces(t)).toEqual(ZERO);
    expect(await reservedOf(t, w.p1)).toBe(0);
    expect((await postOrder(t, w.s1, stdBody(w))).status).toBe(201);
  });

  it(`SAL-TC-20261015-093909933 ${SEC} T9: thiếu hay sai Idempotency-Key thì 400 idempotency-key-required (không phải validation-failed); khóa 8 ký tự hợp lệ thì 201`, async () => {
    for (const key of [null, '1234567']) {
      const r = await postOrder(t, w.s1, stdBody(w), { key });
      expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:idempotency-key-required']);
    }
    expect(await traces(t)).toEqual(ZERO);
    expect((await postOrder(t, w.s1, stdBody(w), { key: 'abcd1234' })).status).toBe(201);
  });

  it(`SAL-TC-20261015-093909966 ${SEC} T9: cùng khóa cùng nội dung phát lại 200 replayed; khác nội dung 422; hai yêu cầu song song cùng khóa chỉ tạo một đơn`, async () => {
    const key = 'ho-0001-abcd';
    const first = await postOrder(t, w.s1, stdBody(w), { key });
    expect(first.status).toBe(201);
    const again = await postOrder(t, w.s1, stdBody(w), { key });
    expect([again.status, again.body.replayed, again.body.order.code, again.headers['idempotent-replayed']]).toEqual([200, true, first.body.order.code, 'true']);
    expect([await count(t, 'orders'), await reservedOf(t, w.p1)]).toEqual([1, 2]);
    const other = await postOrder(t, w.s1, stdBody(w, { items: [{ product_id: w.p1, quantity: 3 }], expected_grand_total: 480000 }), { key });
    expect([other.status, other.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    const k2 = 'ho-0002-abcd';
    const [a, b] = await Promise.all([postOrder(t, w.s1, stdBody(w), { key: k2 }), postOrder(t, w.s1, stdBody(w), { key: k2 })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.order.code).toBe(b.body.order.code);
    expect([await count(t, 'orders'), await reservedOf(t, w.p1)]).toEqual([2, 4]);
  });

  it(`SAL-TC-20261015-093909998 ${SEC} T11: vượt 10 đơn mỗi phút thì 429 kèm Retry-After; sang phút kế tiếp tạo lại được`, async () => {
    const one = stdBody(w, { items: [{ product_id: w.p1, quantity: 1 }], expected_grand_total: 180000 });
    for (let i = 0; i < 10; i++) expect((await postOrder(t, w.s1, one)).status).toBe(201);
    const r = await postOrder(t, w.s1, one);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(await count(t, 'orders')).toBe(10);
    t.clock.advance(61_000);
    expect((await postOrder(t, w.s1, one)).status).toBe(201);
  });

  it(`SAL-TC-20261015-093910031 ${SEC} T13: yêu cầu ghi có Origin lạ bị 403 csrf_failed, không tạo gì; Origin hợp lệ thì 201`, async () => {
    const r = await postOrder(t, w.s1, stdBody(w), { origin: 'https://evil.example' });
    expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect(await traces(t)).toEqual(ZERO);
    expect((await postOrder(t, w.s1, stdBody(w))).status).toBe(201);
  });

  it('SAL-TC-20261015-093910063: hai sale tạo song song 200 đơn mỗi bên (gọi CreateService, bỏ giới hạn tần suất của HTTP): 400 mã khác nhau, số liên tiếp 00001..00400; đơn hoàn tác không làm trùng số', async () => {
    await stock(t as never, w.p1, 1000);
    const svc = t.app.get(CreateService);
    const body = (): any => ({ source_code: 'facebook', customer: { user_id: null, full_name: 'Nguyễn An', phone: '0901234567' }, shipping_address: { ...ADDRESS }, shipping_method_id: w.sm1, payment_method: 'cod', note: null, items: [{ product_id: w.p1, note: null, quantity: 1 }], expected_grand_total: 180000 });
    const as = (u: { id: string }) => ({ user_id: u.id, role: 'sale' as const, email_verified: true });
    const codes: string[] = [];
    for (let chunk = 0; chunk < 10; chunk++) {
      const batch = [...Array(20).keys()].flatMap(() => [svc.create(as(w.s1), newKey(), body()), svc.create(as(w.s2), newKey(), body())]);
      for (const r of await Promise.all(batch)) { expect(r.status).toBe(201); codes.push(r.body.order.code); }
    }
    expect(codes).toHaveLength(400);
    expect(new Set(codes).size).toBe(400);
    expect(codes.map((c) => Number(c.slice(-5))).sort((a, b) => a - b)).toEqual([...Array(400).keys()].map((i) => i + 1));
    jest.spyOn(t.inv, 'reserve').mockRejectedValueOnce(new Error('INV hỏng giữa giao dịch'));
    await expect(svc.create(as(w.s1), newKey(), body())).rejects.toMatchObject({ code: 'dependency-unavailable' });
    const next = await svc.create(as(w.s1), newKey(), body());
    expect(codes).not.toContain(next.body.order.code); // đơn hoàn tác không làm trùng số (bộ đếm hoàn tác theo giao dịch nên số kế tiếp là 00401, ORD ADR-024)
    expect(Number(next.body.order.code.slice(-5))).toBeGreaterThan(400);
  }, 180_000);

  it('SAL-TC-20261015-093910095: qua nửa đêm giờ Việt Nam thì mã đơn reset về 00001', async () => {
    t.clock.set(new Date('2026-10-15T16:59:59Z')); // fixed-clock: 23:59:59 ngày 15/10/2026 giờ Việt Nam; người dùng và phiên dựng SAU khi đặt mốc để phiên chưa hết hạn
    const s = await who(t, 'sale', 'dem@shop.vn');
    const a = await postOrder(t, s, stdBody(w));
    t.clock.set(new Date('2026-10-15T17:00:01Z')); // fixed-clock: 00:00:01 ngày 16/10/2026
    const b = await postOrder(t, s, stdBody(w));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.order.code).toMatch(/^HD261015-\d{5}$/);
    expect(b.body.order.code).toBe('HD261016-00001');
    expect(a.body.order.code).not.toBe(b.body.order.code);
  });

  // REV-ORD (SAL 4): ORD hết 99999 số trong ngày (`order_code_exhausted`) là lỗi tạm của hạ tầng, không phải lỗi 500 của SAL.
  it('hết 99999 mã đơn trong ngày: 503 dependency-unavailable kèm Retry-After tới 0 giờ Việt Nam, hoàn tác hết, khóa chưa ghi; sang ngày mới tạo lại được', async () => {
    t.clock.set(new Date('2026-10-15T16:59:00Z')); // fixed-clock: 23:59:00 ngày 15/10 giờ Việt Nam, còn đúng 60 giây tới nửa đêm (phiên chưa hết hạn khi sang ngày)
    const s = await who(t, 'sale', 'het@shop.vn');
    await q(t, "INSERT INTO order_code_counters (day, last) VALUES ('2026-10-15', 99999)"); // fixed-clock: ngày của bộ đếm khớp mốc đồng hồ giả ở trên, không dùng now() của CSDL
    const key = 'ho-exhausted-1';
    const r = await postOrder(t, s, stdBody(w), { key });
    expect([r.status, r.body.type, r.headers['retry-after']]).toEqual([503, 'urn:ecom:error:dependency-unavailable', '60']);
    expect(await traces(t)).toEqual(ZERO);
    t.clock.set(new Date('2026-10-15T17:00:01Z')); // fixed-clock: 00:00:01 ngày 16/10 giờ Việt Nam
    const next = await postOrder(t, s, stdBody(w), { key });
    expect([next.status, next.body.order.code]).toEqual([201, 'HD261016-00001']);
  });

  it('SAL-TC-20261015-093910128: đúng biên (note 1000 ký tự có emoji, ghi chú dòng 500, 50 dòng, quantity 100000) được 201; quá biên một đơn vị, NUL, nửa cặp thay thế lẻ, một triệu dòng bị từ chối, không tạo đơn', async () => {
    const ps = [w.p1];
    for (let i = 1; i < 50; i++) ps.push(await prod(t, { name: `Hàng ${i}`, price: 1000, onHand: 10 }));
    await stock(t as never, w.p1, 100_000);
    await q(t, `UPDATE products SET price = 1000 WHERE id = '${w.p1}'`);
    const emoji = `${'😀'.repeat(10)}${'a'.repeat(990)}`;
    const lines = (n = 50, qty = 100_000, itemNote = 'b'.repeat(500)) => ps.slice(0, n).map((id, i) => ({ product_id: id, quantity: i === 0 ? qty : 1, ...(i === 0 ? { note: itemNote } : {}) }));
    const total = 100_000 * 1000 + 49 * 1000 + 50000; // SM2 phí 50000 cố định
    const ok = (over: Record<string, unknown>) => stdBody(w, { shipping_method_id: w.sm2, expected_grand_total: total, items: lines(), note: emoji, ...over });
    expect([...emoji].length).toBe(1000);
    const first = await postOrder(t, w.s1, ok({}));
    expect([first.status, first.body.order?.grand_total]).toEqual([201, total]);
    const before = await count(t, 'orders');
    const bad: [string, Record<string, unknown>, string][] = [
      ['note 1001', { note: `${emoji}x` }, 'note'], ['ghi chú dòng 501', { items: lines(50, 100_000, 'b'.repeat(501)) }, 'items.0.note'], ['51 dòng', { items: [...lines(), { product_id: randomUUID(), quantity: 1 }] }, 'items'],
      ['quantity 100001', { items: lines(50, 100_001) }, 'items.0.quantity'], ['NUL', { note: 'a\u0000b' }, 'note'],
    ];
    for (const [name, over, field] of bad) {
      const r = await postOrder(t, w.s1, ok(over));
      expect([name, r.status, errorsOf(r).map((e) => e.field)]).toEqual([name, 400, [field]]);
    }
    expect((await postOrder(t, w.s1, ok({ note: 'a\ud800b' }))).status).toBe(400); // nửa cặp thay thế lẻ bị từ chối ở biên (400, không 500)
    const getForSale = jest.spyOn(t.catalog, 'getForSale');
    const started = Date.now();
    const huge = JSON.stringify(ok({})).replace(/"items":\[.*?\],"expected/, `"items":[${'{},'.repeat(999_999)}{}],"expected`);
    const r = await call(t, 'post', '/sales/orders', { cookie: w.s1.cookie, body: huge }).set('Idempotency-Key', newKey());
    expect([400, 413]).toContain(r.status);
    expect(Date.now() - started).toBeLessThan(2000);
    const many = JSON.stringify(ok({})).replace(/"items":\[.*?\],"expected/, `"items":[${'0,'.repeat(449_999)}0],"expected`); // 450 nghìn phần tử, dưới trần thân 1 MB: bị chặn trước khi zod duyệt từng phần tử
    const t0 = Date.now();
    const r2 = await call(t, 'post', '/sales/orders', { cookie: w.s1.cookie, body: many }).set('Idempotency-Key', newKey());
    expect([r2.status, errorsOf(r2)]).toEqual([400, [{ field: 'items', code: 'too_long' }]]);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(getForSale).not.toHaveBeenCalled();
    expect(await count(t, 'orders')).toBe(before);
  }, 120_000);

  it(`SAL-TC-20261015-093910162 ${SEC} T8: ghi chú chứa HTML được lưu nguyên văn và API trả lại nguyên văn dạng JSON`, async () => {
    const note = '<script>alert(1)</script>', lineNote = '<img src=x onerror=alert(1)>';
    const r = await postOrder(t, w.s1, stdBody(w, { note, items: [{ product_id: w.p1, quantity: 2, note: lineNote }] }));
    expect(r.status).toBe(201);
    const d = await call(t, 'get', `/sales/orders/${r.body.order.code}`, { cookie: w.s1.cookie });
    expect(d.headers['content-type']).toMatch(/^application\/json/);
    expect([d.body.note, d.body.items[0].note]).toEqual([note, lineNote]);
  });

  it('SAL-TC-20261015-093910194: sản phẩm chưa có giá vốn vẫn tạo được đơn, cost_snapshot rỗng', async () => {
    const p3 = await prod(t, { name: 'Nón', price: 80000, cost: null, onHand: 5 });
    const r = await postOrder(t, w.s1, stdBody(w, { items: [{ product_id: p3, quantity: 1 }], expected_grand_total: 110000 }));
    expect(r.status).toBe(201);
    expect((await itemRows(t, (await orderRow(t, r.body.order.code)).id)).map((i) => i.cost_snapshot)).toEqual([null]);
  });

  it(`SAL-TC-20261015-093910227 ${SEC} T14: dữ liệu cá nhân không vào log, audit hay phản hồi lỗi; mọi phản hồi no-store`, async () => {
    const note = 'Giao giờ hành chính';
    const ok = await postOrder(t, w.s1, stdBody(w, { note }));
    const short = await postOrder(t, w.s1, stdBody(w, { note, items: [{ product_id: w.p2, quantity: 5 }], expected_grand_total: 280000 }));
    const price = await postOrder(t, w.s1, stdBody(w, { note, expected_grand_total: 300000 }));
    expect([ok.status, short.status, price.status]).toEqual([201, 409, 409]);
    const pii = /Nguyễn An|0901234567|45 Nguyễn Huệ|Bến Nghé|Giao giờ hành chính/;
    expect(t.logs.lines.join('\n')).not.toMatch(pii);
    expect(JSON.stringify(await q(t, "SELECT * FROM audit_logs WHERE action = 'order.created_ho'"))).not.toMatch(pii);
    for (const r of [ok, short, price]) { expect(r.headers['cache-control']).toBe('no-store'); }
    for (const r of [short, price]) expect(JSON.stringify(r.body)).not.toMatch(pii);
    expect(t.logs.lines.join('\n')).toContain(w.s1.id); // log chỉ có user_id nguyên văn
  });
});
