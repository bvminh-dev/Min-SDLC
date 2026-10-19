import { randomUUID } from 'node:crypto';
import { OrderBusinessError } from '../../src/modules/order';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { baseHo, createHo, ho, hoItems, resetSources, sourceId } from '../support/ho';
import { auditsOf, baseInput, call, countRows, createOrdApp, createPending, deliver, historyOf, orderOf, outboxOf, pgCode, type OrdApp } from '../support/ord';

// createHo, đơn hộ của sale (ORD-REQ-20261015-092748715): tạo đơn confirmed ngay trong giao dịch của SAL, nguồn, ghi chú, giá vốn, người tạo, khách không tài khoản.
// fixed-clock: ngày mã đơn lấy từ Clock giả, mỗi test đặt mốc tường minh.
const D15 = '2026-10-15T02:00:00Z';
const cod = (user: string, o = {}) => baseInput(user, { payment_method: 'cod', payment_expires_at: null, ...o });

describe('ORD createHo và đơn hộ', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); await resetSources(t); t.logs.clear(); t.clock.set(new Date(D15)); });
  const tables = ['orders', 'order_items', 'order_status_history', 'outbox_events', 'audit_logs', 'order_code_counters'];
  const counts = async () => Promise.all(tables.map((x) => countRows(t, x)));
  const nothing = async () => expect(await counts()).toEqual([0, 0, 0, 0, 0, 0]);
  const rejects = async (input: Parameters<typeof createHo>[1], code: string, reason?: string) => {
    const err = await createHo(t, input).catch((e) => e);
    expect([err instanceof OrderBusinessError && err.code, err instanceof OrderBusinessError && err.reason]).toEqual([code, reason]);
  };

  it('ORD-TC-20261015-092749306: createHo đơn COD cho khách chưa có tài khoản: confirmed ngay, ghi chú, giá vốn, hai dòng lịch sử, hai event không lộ ghi chú hay giá vốn, một audit; admin thấy giá vốn, sale không', async () => {
    const { s1, admin } = await ho(t);
    const input = baseHo(s1.id);
    const r = await createHo(t, input);
    expect(r.code).toMatch(/^HD[0-9]{6}-[0-9]{5}$/);
    const [o] = await q<Record<string, any>>(t, `SELECT o.*, s.code AS source_code FROM orders o JOIN order_sources s ON s.id = o.source_id WHERE o.id = '${r.order_id}'`);
    expect(o).toMatchObject({ status: 'confirmed', user_id: null, created_by: s1.id, source_code: 'facebook', customer_snapshot: { full_name: 'Trần Thị Mai', phone: '0912345678' }, note: 'Khách muốn giao sau 18h', payment_status: 'pending', payment_expires_at: null, payment_method: 'cod' });
    expect(o.confirmed_at).toEqual(t.clock.now());
    const items = await q<{ note: string | null; cost_snapshot: string | null; position: number; unit_price: string }>(t, `SELECT note, cost_snapshot::text, position, unit_price::text FROM order_items WHERE order_id = '${r.order_id}' ORDER BY position`);
    expect(items.map((i) => [i.position, i.note, i.cost_snapshot, i.unit_price])).toEqual([[1, 'size M, màu đen', '60000', '100000'], [2, null, '150000', '250000']]);
    const h = await historyOf(t, r.order_id);
    expect(h.map((x) => [x.from_status, x.to_status, x.actor_id, x.actor_role])).toEqual([[null, 'pending', s1.id, 'sale'], ['pending', 'confirmed', null, 'system']]);
    const ev = await outboxOf(t, r.order_id);
    expect(ev.map((e) => e.type)).toEqual(['OrderCreated', 'OrderConfirmed']);
    expect(ev[0].payload).toMatchObject({ order_id: r.order_id, order_code: r.code, user_id: null, source: 'facebook', created_by: s1.id, payment_method: 'cod', payment_expires_at: null, grand_total: 480000 });
    expect(ev[0].payload.items).toEqual(input.items.map((i) => ({ product_id: i.product_id, name: i.name_snapshot, unit_price: i.unit_price, quantity: i.quantity })));
    expect(ev[1].payload).toEqual({ order_id: r.order_id, order_code: r.code, user_id: null, confirmed_at: t.clock.now().toISOString() });
    const au = await auditsOf(t, r.order_id);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_id: s1.id, actor_role: 'sale', action: 'order.created_ho', target_type: 'order' });
    expect(au[0].after).toEqual({ order_code: r.code, source: 'facebook', has_user_id: false, items: 2, grand_total: 480000, payment_method: 'cod' }); // đúng bộ khóa, không dữ liệu cá nhân
    for (const text of [JSON.stringify(ev), JSON.stringify(au), t.logs.lines.join('\n')]) expect(text).not.toMatch(/Trần Thị Mai|0912345678|Khách muốn giao|size M|cost_snapshot|60000|150000/); // ghi chú, khách, giá vốn không vào event, audit, log
    const adminView = await call(t, 'get', `/orders/${r.code}`, { cookie: admin.cookie });
    expect(adminView.body.items.map((i: { cost_snapshot: number }) => i.cost_snapshot)).toEqual([60000, 150000]);
    const saleView = await call(t, 'get', `/orders/${r.code}`, { cookie: s1.cookie });
    expect(saleView.status).toBe(200);
    for (const i of saleView.body.items) expect(i).not.toHaveProperty('cost_snapshot'); // khóa vắng, không phải null
  });

  it('ORD-TC-20261015-092749343: createHo đơn tiền mặt gắn tài khoản khách có sẵn: khách thấy đơn của mình nhưng không thấy thông tin nội bộ; tắt nguồn không ảnh hưởng đơn cũ, đơn mới với nguồn tắt bị từ chối', async () => {
    const { s1, a, admin } = await ho(t);
    const r = await createHo(t, baseHo(s1.id, { user_id: a.id, payment_method: 'cash', source_code: 'hotline' }));
    expect(await orderOf(t, r.order_id)).toMatchObject({ status: 'confirmed', user_id: a.id, payment_method: 'cash', payment_expires_at: null });
    expect((await q<{ created_by: string }>(t, `SELECT created_by FROM orders WHERE id = '${r.order_id}'`))[0].created_by).toBe(s1.id);
    const ev = await outboxOf(t, r.order_id);
    expect(ev[0].payload).toMatchObject({ user_id: a.id, source: 'hotline' });
    const list = await call(t, 'get', '/orders', { cookie: a.cookie });
    expect(list.body.items.map((i: { code: string }) => i.code)).toEqual([r.code]);
    const detail = await call(t, 'get', `/orders/${r.code}`, { cookie: a.cookie });
    expect(detail.status).toBe(200);
    expect(detail.body.items).toHaveLength(2);
    expect(detail.body).toMatchObject({ grand_total: 480000, payment_method: 'cash', status: 'confirmed' });
    expect(detail.body.shipping_address).toBeDefined();
    expect(JSON.stringify(detail.body)).not.toMatch(/source|created_by_name|"note"|customer|cost_snapshot/);
    expect((await call(t, 'get', `/orders/${r.code}/status-history`, { cookie: a.cookie })).body.items.map((i: { status: string }) => i.status)).toEqual(['pending', 'confirmed']);
    await call(t, 'patch', `/admin/order-sources/${await sourceId(t, 'hotline')}`, { cookie: admin.cookie, body: { is_active: false } });
    const filtered = await call(t, 'get', '/admin/orders?source=hotline', { cookie: s1.cookie });
    expect([filtered.status, filtered.body.total, filtered.body.items[0].source]).toEqual([200, 1, { code: 'hotline', name: 'Hotline' }]); // đơn cũ giữ nguồn và vẫn lọc được
    await rejects(baseHo(s1.id, { source_code: 'hotline' }), 'source_unavailable', 'inactive');
  });

  // SB-33 (REV-ORD-26): giới hạn đơn đang mở chỉ tính đơn khách tự đặt; sale gắn đơn hộ vào tài khoản khách không được làm khách đó bị CHK từ chối.
  it('SB-33 countOpenOrders không đếm đơn hộ: nhiều đơn hộ confirmed (COD, cash, chuyển khoản) gắn user_id của khách vẫn cho 0, đơn khách tự đặt vẫn đếm', async () => {
    const { s1, a } = await ho(t);
    for (const payment_method of ['cod', 'cash', 'bank_transfer', 'cod'] as const) await createHo(t, baseHo(s1.id, { user_id: a.id, payment_method }));
    expect((await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM orders WHERE user_id = '${a.id}' AND status = 'confirmed' AND created_by IS NOT NULL`))[0].n).toBe(4);
    expect(await t.ord.countOpenOrders(a.id)).toEqual({ online_pending: 0, cod_open: 0 });
    await createPending(t, baseInput(a.id));
    expect(await t.ord.countOpenOrders(a.id)).toEqual({ online_pending: 1, cod_open: 0 });
  });

  it('ORD-TC-20261015-092749381: createHo với nguồn không có hoặc đã tắt bị từ chối bằng source_unavailable (reason not_found, inactive), không ghi gì, bộ đếm mã không đổi', async () => {
    await ho(t);
    const { s1 } = { s1: (await q<{ id: string }>(t, `SELECT id FROM users WHERE email = 's1@x.vn'`))[0] };
    await q(t, `UPDATE order_sources SET is_active = false WHERE code = 'tiktok'`);
    await rejects(baseHo(s1.id, { source_code: 'khong_co' }), 'source_unavailable', 'not_found');
    await nothing();
    await rejects(baseHo(s1.id, { source_code: 'tiktok' }), 'source_unavailable', 'inactive');
    await nothing();
    expect((await createHo(t, baseHo(s1.id))).code).toBe('HD261015-00001'); // đầu vào hợp lệ liền sau vẫn nhận số đầu tiên
  });

  it('ORD-TC-20261015-092749418: createHo đầu vào sai (mỗi lần đổi một nhân tố) là invalid_input và không ghi gì; createPending từ chối khóa của đơn hộ', async () => {
    const { s1 } = await ho(t);
    const sixty = (n: number) => Array.from({ length: n }, () => ({ product_id: randomUUID(), name_snapshot: 'Hàng', unit_price: 1000, cost_snapshot: null, quantity: 1, note: null }));
    const cases: [string, Parameters<typeof baseHo>[1] & Record<string, unknown>][] = [
      ['vnpay', { payment_method: 'vnpay' as never }], ['grand_total 470000', { grand_total: 470000 }], ['items_total 449999', { items_total: 449999, grand_total: 479999 }],
      ['grand_total 0', { discount: 480000, grand_total: 0 }], ['phone rỗng', { customer_snapshot: { full_name: 'Trần Thị Mai', phone: '' } }],
      ['full_name 101 ký tự', { customer_snapshot: { full_name: 'a'.repeat(101), phone: '0912345678' } }], ['created_by_role staff', { created_by_role: 'staff' as never }],
      ['quantity 0', { items: [{ ...hoItems()[0], quantity: 0 }], items_total: 0, grand_total: 30000 }], ['items rỗng', { items: [], items_total: 0, grand_total: 30000 }],
      ['101 dòng', { items: sixty(101), items_total: 101000, grand_total: 131000 }], ['user_id không có trong users', { user_id: randomUUID() }], ['khóa lạ foo', { foo: 1 }],
      ['thiếu source_code', { source_code: undefined as never }],
    ];
    for (const [why, o] of cases) { const err = await createHo(t, baseHo(s1.id, o)).catch((e) => e); expect([why, err instanceof OrderBusinessError && err.code]).toEqual([why, 'invalid_input']); await nothing(); }
    expect((await createHo(t, baseHo(s1.id, { items: sixty(100), items_total: 100000, grand_total: 130000 }))).code).toBe('HD261015-00001'); // 100 dòng là biên hợp lệ
    await q(t, 'TRUNCATE order_status_history, order_items, orders, outbox_events, order_code_counters CASCADE');
    for (const [why, o] of [['cash', { payment_method: 'cash' }], ['created_by', { created_by: s1.id }], ['source_id', { source_id: randomUUID() }]] as [string, Record<string, unknown>][]) {
      const err = await createPending(t, { ...cod(s1.id), ...o } as never).catch((e) => e);
      expect([why, err instanceof OrderBusinessError && err.code]).toEqual([why, 'invalid_input']);
    }
    expect(await counts()).toEqual([0, 0, 0, 0, 1, 0]); // chỉ còn audit của đơn hợp lệ trước đó
  });

  it('ORD-TC-20261015-092749455: createHo từ chối ghi chú quá dài và ký tự cấm; CSDL từ chối ghi chú quá dài ở cả hai bảng (lớp hai)', async () => {
    const { s1 } = await ho(t);
    const line = (note: string) => ({ items: [{ ...hoItems()[0], note }, hoItems()[1]], items_total: 450000, grand_total: 480000 });
    await rejects(baseHo(s1.id, { note: 'a'.repeat(1001) }), 'invalid_input');
    await rejects(baseHo(s1.id, line('a'.repeat(501))), 'invalid_input');
    await rejects(baseHo(s1.id, { note: 'lẻ \ud800 đôi' }), 'invalid_input');
    await rejects(baseHo(s1.id, line('nul \u0000 byte')), 'invalid_input');
    await rejects(baseHo(s1.id, { note: 'chuông \u0007' }), 'invalid_input');
    await nothing();
    const r = await createHo(t, baseHo(s1.id));
    const snapshot = `'{"full_name":"A","phone":"0912345678"}'::jsonb`;
    const insert = (note: string) => `INSERT INTO orders (user_id, code, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, created_by, customer_snapshot, note, created_at, updated_at)
      VALUES (NULL, 'HD261015-90001', 1, 0, 0, 1, '{}'::jsonb, gen_random_uuid(), 'cod', '${s1.id}', ${snapshot}, '${note}', now(), now())`;
    expect(await pgCode(q(t, insert('a'.repeat(1001))))).toBe('23514');
    expect(await pgCode(q(t, `INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, position, note) VALUES ('${r.order_id}', gen_random_uuid(), 'x', 1, 1, 9, '${'a'.repeat(501)}')`))).toBe('23514');
  });

  it('ORD-TC-20261015-092749492: createHo hoàn tác cùng giao dịch của SAL khi bước sau thất bại: không đơn, không event, không audit, bộ đếm về số cũ và số đó được dùng lại', async () => {
    const { s1 } = await ho(t);
    await q(t, `INSERT INTO order_code_counters (day, last) VALUES ('2026-10-15', 5)`); // fixed-clock: mốc ngày dựng tường minh bằng đồng hồ giả của ứng dụng, không trộn với now() của CSDL
    await expect(t.tx.run(async (tx) => { await t.ord.createHo(baseHo(s1.id), tx); throw new Error('INV hết hàng: reserve trả ok false'); })).rejects.toThrow('INV hết hàng');
    expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events'), await countRows(t, 'audit_logs')]).toEqual([0, 0, 0, 0, 0]);
    expect((await q<{ last: number }>(t, `SELECT last FROM order_code_counters`))[0].last).toBe(5);
    expect((await createHo(t, baseHo(s1.id))).code).toBe('HD261015-00006');
  });

  it('ORD-TC-20261015-092749528: createHo lưu nguyên ghi chú ở đúng biên (1000 và 500 ký tự gồm emoji) và ghi chú HTML; chi tiết trả đúng chuỗi, không biến đổi', async () => {
    const { s1, admin } = await ho(t);
    const long = '😀'.repeat(499) + 'ab' + '😀'.repeat(499), lineNote = `${'😀'.repeat(250)}${'x'.repeat(250)}`; // 1000 và 500 ký tự (code point)
    expect([...long].length).toBe(1000);
    const r1 = await createHo(t, baseHo(s1.id, { note: long, items: [{ ...hoItems()[0], note: lineNote }, hoItems()[1]], items_total: 450000, grand_total: 480000 }));
    const r2 = await createHo(t, baseHo(s1.id, { note: '<script>alert(1)</script>' }));
    const d1 = (await call(t, 'get', `/orders/${r1.code}`, { cookie: admin.cookie })).body, d2 = (await call(t, 'get', `/orders/${r2.code}`, { cookie: admin.cookie })).body;
    expect([d1.note, d1.items[0].note, d2.note]).toEqual([long, lineNote, '<script>alert(1)</script>']);
    expect(await q(t, `SELECT char_length(note) AS n FROM orders WHERE id = '${r1.order_id}'`)).toEqual([{ n: 1000 }]);
    expect(await q(t, `SELECT char_length(note) AS n FROM order_items WHERE order_id = '${r1.order_id}' AND position = 1`)).toEqual([{ n: 500 }]);
  });

  it('ORD-TC-20261015-092749566: createHo với giá vốn rỗng; hai sale tạo song song cho hai mã; tắt nguồn đua với tạo đơn: yêu cầu của admin chờ giao dịch giữ khóa chia sẻ commit', async () => {
    const { s1, s2, admin } = await ho(t);
    const nul = await createHo(t, baseHo(s1.id, { items: [{ ...hoItems()[0], cost_snapshot: null }, hoItems()[1]] }));
    expect((await call(t, 'get', `/orders/${nul.code}`, { cookie: admin.cookie })).body.items[0].cost_snapshot).toBeNull();
    const [x, y] = await Promise.all([createHo(t, baseHo(s1.id)), createHo(t, baseHo(s2.id))]);
    expect(x.code).not.toBe(y.code);
    expect((await q<{ code: string; created_by: string }>(t, `SELECT code, created_by FROM orders WHERE code IN ('${x.code}', '${y.code}') ORDER BY code`)).map((o) => o.created_by).sort()).toEqual([s1.id, s2.id].sort());
    let release: () => void = () => undefined, held: () => void = () => undefined;
    const gate = new Promise<void>((res) => { release = res; }), reached = new Promise<void>((res) => { held = res; });
    const holder = t.tx.run(async (tx) => { const r = await t.ord.createHo(baseHo(s1.id), tx); held(); await gate; return r; }); // đã đọc nguồn facebook (FOR SHARE), chưa commit
    await reached;
    let patched = false;
    const patch = call(t, 'patch', `/admin/order-sources/${await sourceId(t, 'facebook')}`, { cookie: admin.cookie, body: { is_active: false } }).then((r) => { patched = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(patched).toBe(false); // admin chờ tới khi giao dịch của sale commit
    release();
    const [made, off] = await Promise.all([holder, patch]);
    expect([off.status, off.body.is_active]).toEqual([200, false]);
    expect((await orderOf(t, made.order_id)).status).toBe('confirmed'); // đơn của sale hợp lệ
    await rejects(baseHo(s1.id), 'source_unavailable', 'inactive');
  });

  it('ORD-TC-20261015-094427219: createPending luôn là đơn khách tự đặt: nguồn website, không người tạo, không bản chụp khách, không ghi chú; từ chối khóa của đơn hộ', async () => {
    const { a } = await ho(t);
    const r = await createPending(t, cod(a.id));
    const [o] = await q<Record<string, unknown>>(t, `SELECT source_id, created_by, customer_snapshot, note FROM orders WHERE id = '${r.order_id}'`);
    expect(o).toEqual({ source_id: await sourceId(t, 'website'), created_by: null, customer_snapshot: null, note: null });
    expect(await countRows(t, 'order_items', `order_id = '${r.order_id}' AND cost_snapshot IS NULL AND note IS NULL`)).toBe(2);
    expect((await outboxOf(t, r.order_id))[0].payload).toMatchObject({ source: 'website', created_by: null, user_id: a.id });
    expect(r.code).toMatch(/^HD[0-9]{6}-[0-9]{5}$/);
    const before = await counts();
    for (const [why, o2] of [['note', { note: 'x' }], ['created_by', { created_by: a.id }], ['bank_transfer', { payment_method: 'bank_transfer' }]] as [string, Record<string, unknown>][]) {
      const err = await createPending(t, { ...cod(a.id), ...o2 } as never).catch((e) => e);
      expect([why, err instanceof OrderBusinessError && err.code]).toEqual([why, 'invalid_input']);
    }
    expect(await counts()).toEqual(before);
  });

  it('ORD-TC-20261015-094427137: đơn hộ chuyển khoản: PaymentSucceeded chỉ cập nhật payment_status (không đổi status, không OrderPaid, không log từ chối), rồi shipped, delivered; mọi event có user_id null; event trùng là no-op', async () => {
    const { s1 } = await ho(t);
    const r = await createHo(t, baseHo(s1.id, { payment_method: 'bank_transfer' }));
    t.logs.clear();
    const E = randomUUID();
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: r.order_id, amount: 480000, method: 'bank_transfer', paid_at: t.clock.now().toISOString() }, E);
    expect(await orderOf(t, r.order_id)).toMatchObject({ status: 'confirmed', payment_status: 'succeeded' });
    expect((await orderOf(t, r.order_id)).paid_at).not.toBeNull();
    expect(await historyOf(t, r.order_id)).toHaveLength(2);
    expect((await outboxOf(t, r.order_id)).map((e) => e.type)).toEqual(['OrderCreated', 'OrderConfirmed']);
    expect(t.logs.records.filter((x) => x.code === 'transition-rejected')).toEqual([]);
    await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: r.order_id, tracking_number: 'VN123456' });
    t.clock.advance(1000);
    await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: r.order_id });
    const o = await orderOf(t, r.order_id);
    expect([o.status, o.delivered_at !== null]).toEqual(['delivered', true]);
    const ev = await outboxOf(t, r.order_id);
    expect(ev.map((e) => e.type)).toEqual(['OrderCreated', 'OrderConfirmed', 'OrderShipped', 'OrderDelivered']);
    for (const e of ev) expect(e.payload.user_id).toBeNull();
    const snapshot = JSON.stringify([await historyOf(t, r.order_id), ev.length]);
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: r.order_id, amount: 480000, method: 'bank_transfer', paid_at: t.clock.now().toISOString() }, E); // cùng event_id
    expect(JSON.stringify([await historyOf(t, r.order_id), (await outboxOf(t, r.order_id)).length])).toBe(snapshot);
    const cash = await createHo(t, baseHo(s1.id, { payment_method: 'cash' }));
    await q(t, `UPDATE orders SET status = 'cancelled', cancel_reason = 'admin', cancelled_by_role = 'admin', payment_status = 'cancelled' WHERE id = '${cash.order_id}'`);
    await deliver(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: cash.order_id, amount: 480000, method: 'cash', paid_at: t.clock.now().toISOString() });
    expect(await orderOf(t, cash.order_id)).toMatchObject({ status: 'cancelled', payment_status: 'succeeded' }); // payment_status cập nhật, status giữ cancelled (PAY hoàn)
  });

  it('ORD-TC-20261015-094427316: giao diện đọc với đơn hộ không user_id: findForPayment trả user_id null, findForShipment trả created_by, findOwned không thấy, getDeliveredItems và hasUndeliveredItems chỉ tính đơn của đúng khách', async () => {
    const { s1, a } = await ho(t);
    const P = randomUUID();
    const withP = (): Partial<Parameters<typeof baseHo>[1]> => ({ items: [{ ...hoItems()[0], product_id: P }, hoItems()[1]] });
    const cash = await createHo(t, baseHo(s1.id, { payment_method: 'cash' }));
    const anon = await createHo(t, baseHo(s1.id, withP()));
    const mine = await createHo(t, baseHo(s1.id, { ...withP(), user_id: a.id }));
    expect(await t.ord.hasUndeliveredItems(a.id, P)).toBe(true); // đơn gắn tài khoản A chưa giao
    for (const o of [anon, mine]) { await deliver(t, 'ShipmentShipped', { shipment_id: randomUUID(), order_id: o.order_id, tracking_number: `VN${o.code.slice(-5)}` }); await deliver(t, 'ShipmentDelivered', { shipment_id: randomUUID(), order_id: o.order_id }); }
    expect(await t.ord.findForPayment(cash.order_id)).toMatchObject({ user_id: null, payment_method: 'cash', code: cash.code });
    const ship = await t.ord.findForShipment(cash.order_id);
    expect(ship).toMatchObject({ created_by: s1.id, order_id: cash.order_id });
    expect(ship).not.toHaveProperty('user_id');
    expect(await t.ord.findOwned(cash.code, a.id)).toBeNull();
    expect(await t.ord.findOwned('HD261015-09999', a.id)).toBeNull(); // giống mã không tồn tại
    expect((await t.ord.getDeliveredItems(a.id, P)).map((x) => x.order_id)).toEqual([mine.order_id]);
    expect(await t.ord.hasUndeliveredItems(a.id, P)).toBe(false);
    expect((await t.ord.findForShipment((await createPending(t, cod(a.id))).order_id))?.created_by).toBeNull();
  });

  it('ORD-TC-20261015-094426951: customer có đơn hộ gắn tài khoản không thấy thông tin nội bộ (nguồn, người tạo, ghi chú, khách, giá vốn); admin nhận nguyên chuỗi ghi chú HTML', async () => {
    const { s1, a, admin } = await ho(t);
    const note = '<img src=x onerror=alert(1)>';
    const r = await createHo(t, baseHo(s1.id, { user_id: a.id, source_code: 'hotline', note }));
    const mine = await call(t, 'get', `/orders/${r.code}`, { cookie: a.cookie });
    expect(mine.status).toBe(200);
    expect(Object.keys(mine.body).sort()).toEqual(['can_cancel', 'code', 'created_at', 'discount', 'grand_total', 'items', 'items_total', 'payment_method', 'payment_status', 'shipping_address', 'shipping_fee', 'status']);
    for (const i of mine.body.items) expect(Object.keys(i).sort()).toEqual(['line_total', 'name', 'quantity', 'unit_price']);
    const list = await call(t, 'get', '/orders', { cookie: a.cookie });
    expect(Object.keys(list.body.items[0]).sort()).toEqual(['code', 'created_at', 'grand_total', 'item_count', 'payment_method', 'payment_status', 'status']);
    expect((await call(t, 'get', `/orders/${r.code}`, { cookie: admin.cookie })).body.note).toBe(note); // ORD trả đúng chuỗi lưu, giao diện escape (SB-12, SB-45)
  });

  it('ORD-TC-20261015-094427047: customer thấy đơn hộ gắn tài khoản của mình và không thấy đơn hộ của khách không tài khoản; tham số user_id là lạ (400)', async () => {
    const { s1, a, b } = await ho(t);
    const mine = await createHo(t, baseHo(s1.id, { user_id: a.id }));
    const anon = await createHo(t, baseHo(s1.id));
    const list = await call(t, 'get', '/orders', { cookie: a.cookie });
    expect([list.body.total, list.body.items.map((i: { code: string }) => i.code)]).toEqual([1, [mine.code]]);
    expect(list.body.items.map((i: { code: string }) => i.code)).not.toContain(anon.code);
    for (const i of list.body.items) { expect(i).not.toHaveProperty('source'); expect(i).not.toHaveProperty('created_by_name'); }
    const lie = await call(t, 'get', `/orders?user_id=${b.id}`, { cookie: a.cookie });
    expect([lie.status, lie.body.type, lie.body.items]).toEqual([400, 'urn:ecom:error:validation-failed', undefined]);
  });
});
