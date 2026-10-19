import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { OrderBusinessError } from '../../src/modules/order';
import { countOpenSql } from '../../src/modules/order/internal.service';
import { q, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { baseInput, call, countRows, createOrdApp, createPending, historyOf, insertRaw, orderOf, outboxOf, people, pgCode, seedOrder, type OrdApp } from '../support/ord';

// Giao diện tạo đơn cho CHK (ORD-REQ-20261006-120227589): createPending, confirmCod, countOpenOrders, getSummary.
describe('ORD giao diện tạo đơn cho CHK', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });
  const nothing = async () => expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')]).toEqual([0, 0, 0, 0]);
  const cod = (user: string, o = {}) => baseInput(user, { payment_method: 'cod', payment_expires_at: null, ...o });

  it('ORD-TC-20261006-111225380: CHK tạo đơn COD rồi confirmCod trong cùng giao dịch: confirmed, confirmed_at, lịch sử pending rồi confirmed (seq tăng), OrderCreated rồi OrderConfirmed; rollback thì không còn gì', async () => {
    const { a } = await people(t);
    const r = await t.tx.run(async (tx) => { const c = await t.ord.createPending(cod(a.id, { grand_total: 380000 }), tx); return { ...c, conf: await t.ord.confirmCod(c.order_id, tx) }; });
    expect(r.conf).toEqual({ order_id: r.order_id, status: 'confirmed' });
    const o = await orderOf(t, r.order_id);
    expect(o).toMatchObject({ status: 'confirmed', payment_status: 'pending', payment_expires_at: null, payment_method: 'cod' });
    expect(o.confirmed_at).toEqual(t.clock.now());
    const h = await historyOf(t, r.order_id);
    expect(h.map((x) => [x.from_status, x.to_status, x.actor_role])).toEqual([[null, 'pending', 'customer'], ['pending', 'confirmed', 'system']]);
    expect(Number(h[0].seq)).toBeLessThan(Number(h[1].seq));
    const ev = await outboxOf(t, r.order_id);
    expect(ev.map((e) => e.type)).toEqual(['OrderCreated', 'OrderConfirmed']);
    expect(ev[0].payload).toMatchObject({ payment_method: 'cod', payment_expires_at: null });
    expect(ev[1].payload).toEqual({ order_id: r.order_id, order_code: r.code, user_id: a.id, confirmed_at: t.clock.now().toISOString() });
    await q(t, 'TRUNCATE review_images, reviews, refunds, payment_attempts, payment_webhook_logs, payments, shipment_status_history, shipments, checkout_sessions, order_status_history, order_items, orders, outbox_events'); // bảng của SHP và PAY có khóa ngoại tới orders: TRUNCATE phải gồm cả hai
    await expect(t.tx.run(async (tx) => { const c = await t.ord.createPending(cod(a.id, { grand_total: 380000 }), tx); await t.ord.confirmCod(c.order_id, tx); throw new Error('INV hết hàng ở bước sau'); })).rejects.toThrow('INV hết hàng');
    await nothing();
  });

  it('ORD-TC-20261006-120227769 ORD-TC-20261007-182433278: createPending đơn VNPay lưu hạn thanh toán, địa chỉ sáu khóa, hai dòng hàng, một dòng lịch sử pending (actor là khách) và OrderCreated đầy đủ cùng giao dịch; hai lần đặt song song cho hai mã khác nhau', async () => {
    const { a } = await people(t);
    const expires = new Date(Date.now() + 900_000), input = baseInput(a.id, { payment_expires_at: expires });
    const { order_id, code } = await createPending(t, input);
    expect(code).toMatch(/^HD[0-9]{6}-[0-9]{5}$/); // mã mới theo bộ đếm ngày (ADR-024); mã cũ 12 ký tự chỉ còn ở đơn tạo trước đó
    const o = await orderOf(t, order_id);
    expect(o).toMatchObject({ status: 'pending', payment_status: 'pending', payment_method: 'vnpay', grand_total: '380000' });
    expect(o.payment_expires_at).toEqual(expires);
    const [row] = await q<{ shipping_address: Record<string, string>; shipping_method_id: string }>(t, `SELECT shipping_address, shipping_method_id FROM orders WHERE id = '${order_id}'`);
    expect(Object.keys(row.shipping_address).sort()).toEqual(['city', 'district', 'line1', 'phone', 'receiver', 'ward']);
    expect(row.shipping_method_id).toBe(input.shipping_method_id);
    expect((await q<{ name_snapshot: string; unit_price: string; quantity: number; position: number }>(t, `SELECT name_snapshot, unit_price::text, quantity, position FROM order_items WHERE order_id = '${order_id}' ORDER BY position`)).map((i) => [i.name_snapshot, i.unit_price, i.quantity, i.position])).toEqual([['Áo thun cổ tròn', '100000', 2, 1], ['Quần jean', '150000', 1, 2]]); // position 1, 2 theo thứ tự items (ORD-TC-20261007-182433278)
    expect(await historyOf(t, order_id)).toMatchObject([{ from_status: null, to_status: 'pending', actor_id: a.id, actor_role: 'customer' }]);
    const ev = await outboxOf(t, order_id);
    expect(ev.map((e) => e.type)).toEqual(['OrderCreated']);
    expect(ev[0].payload).toMatchObject({ order_id, order_code: code, user_id: a.id, grand_total: 380000, payment_method: 'vnpay', payment_expires_at: expires.toISOString() });
    expect(ev[0].payload.items).toHaveLength(2);
    expect((await call(t, 'get', `/orders/${code}`, { cookie: a.cookie })).body.payment_expires_at).toBe(expires.toISOString());
    const [x, y] = await Promise.all([createPending(t, baseInput(a.id)), createPending(t, baseInput(a.id))]);
    expect(x.code).not.toBe(y.code);
    expect(new Set([x.order_id, y.order_id]).size).toBe(2);
  });

  it('ORD-TC-20261013-211722071: createPending nhận district làm khóa thứ sáu (chuỗi hoặc null, khóa luôn có mặt) và bác địa chỉ thiếu district, district rỗng, district không phải chuỗi, khóa lạ: không ghi gì', async () => {
    const { a } = await people(t);
    const addr = { receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' };
    for (const district of ['Quận 1', null]) {
      const { order_id } = await createPending(t, baseInput(a.id, { shipping_address: { ...addr, district } }));
      const [row] = await q<{ shipping_address: Record<string, unknown> }>(t, `SELECT shipping_address FROM orders WHERE id = '${order_id}'`);
      expect(Object.keys(row.shipping_address).sort()).toEqual(['city', 'district', 'line1', 'phone', 'receiver', 'ward']);
      expect(row.shipping_address.district).toBe(district);
    }
    const before = [await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')];
    const bad: [string, unknown][] = [
      ['a: thiếu district (năm khóa cũ)', addr], ['b: district chỉ khoảng trắng', { ...addr, district: '  ' }], ['c: district là số', { ...addr, district: 5 }], ['d: thêm khóa lạ', { ...addr, district: 'Quận 1', country: 'VN' }],
    ];
    for (const [why, shipping_address] of bad) {
      const err = await createPending(t, baseInput(a.id, { shipping_address: shipping_address as never })).catch((e) => e);
      expect([why, err instanceof OrderBusinessError && err.code]).toEqual([why, 'invalid_input']);
    }
    expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')]).toEqual(before);
  });

  it('ORD-TC-20261006-120227861 ORD-TC-20261007-182433085: createPending từ chối chín đầu vào sai (công thức, thiếu hạn, COD có hạn, hạn quá khứ, quantity 0, rỗng, giá âm, 0 đồng, âm) và confirmCod sai trạng thái: lỗi nghiệp vụ, không để lại gì; CHECK ở CSDL là lớp hai (23514)', async () => {
    const { a } = await people(t);
    const one = [{ product_id: randomUUID(), name_snapshot: 'Áo', unit_price: 300000, quantity: 1 }];
    const bad: [string, Partial<ReturnType<typeof baseInput>>][] = [
      ['a: grand_total lệch công thức', { items: one, items_total: 300000, discount: 20000, shipping_fee: 30000, grand_total: 310001 }],
      ['b: vnpay thiếu payment_expires_at', { payment_expires_at: null }],
      ['c: COD kèm payment_expires_at', { payment_method: 'cod', payment_expires_at: new Date(Date.now() + 900_000) }],
      ['d: payment_expires_at ở quá khứ', { payment_expires_at: new Date(Date.now() - 60_000) }],
      ['e: quantity 0', { items: [{ ...one[0], quantity: 0 }], items_total: 0, grand_total: 30000 }],
      ['f: danh sách dòng hàng rỗng', { items: [], items_total: 0, grand_total: 30000 }],
      ['g: unit_price âm', { items: [{ ...one[0], unit_price: -1 }], items_total: -1, grand_total: 29999 }],
      ['h: đơn 0 đồng (R-03)', { items: [{ ...one[0], unit_price: 100000 }], items_total: 100000, discount: 130000, shipping_fee: 30000, grand_total: 0 }],
      ['i: grand_total âm', { items: one, items_total: 300000, discount: 400000, shipping_fee: 30000, grand_total: -70000 }],
      ['j: items_total không bằng tổng dòng hàng', { items_total: 340000, grand_total: 370000 }],
      ['k: địa chỉ thiếu khóa district (bản năm khóa cũ)', { shipping_address: { receiver: 'A', phone: '0901234567', line1: '1', ward: 'w', city: 'c' } as never }],
      ['l: district rỗng (phải là chuỗi có chữ hoặc null)', { shipping_address: { receiver: 'A', phone: '0901234567', line1: '1', ward: 'w', district: '  ', city: 'c' } }],
    ];
    for (const [why, over] of bad) {
      const err = await createPending(t, baseInput(a.id, over)).catch((e) => e);
      expect([why, err instanceof OrderBusinessError && err.code]).toEqual([why, 'invalid_input']);
    }
    await nothing();
    const [vn, done] = [await seedOrder(t, { user: a.id, status: 'pending' }), await seedOrder(t, { user: a.id, status: 'confirmed', method: 'cod' })];
    const before = await countRows(t, 'order_status_history');
    for (const [id, code] of [[vn.id, 'not_confirmable'], [done.id, 'not_confirmable'], [randomUUID(), 'order_not_found'], ['không-phải-uuid', 'order_not_found']] as const) {
      const err = await t.tx.run((tx) => t.ord.confirmCod(id, tx)).catch((e) => e);
      expect([err instanceof OrderBusinessError && err.code]).toEqual([code]);
    }
    expect([(await orderOf(t, vn.id)).status, (await orderOf(t, done.id)).status, await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')]).toEqual(['pending', 'confirmed', before, 0]);
    expect(await pgCode(insertRaw(t, a.id, { grand: 310001 }))).toBe('23514');
    expect(await pgCode(insertRaw(t, a.id, { items: 100000, discount: 130000, shipping: 30000, grand: 0 }))).toBe('23514');
    expect(await pgCode(insertRaw(t, a.id, { method: 'vnpay', expires: null, grand: 310000 }))).toBe('23514');
  });

  it('ORD-TC-20261006-120227953: countOpenOrders đếm đúng (COD pending và confirmed tính, shipped, paid, cancelled không; người khác không lẫn) dùng chỉ mục một phần; getSummary trả đúng bốn khóa; cod_open giảm sau khi đơn sang shipped', async () => {
    const { a, b } = await people(t);
    const c = await seedUser(t);
    const mk = (user: string, status: 'pending' | 'confirmed' | 'paid' | 'shipped' | 'cancelled', method: 'vnpay' | 'cod') => seedOrder(t, { user, status, method });
    await mk(a.id, 'pending', 'vnpay'); await mk(a.id, 'pending', 'vnpay'); await mk(a.id, 'paid', 'vnpay'); const cod1 = await mk(a.id, 'confirmed', 'cod'); await mk(a.id, 'pending', 'cod'); await mk(a.id, 'shipped', 'cod'); await mk(a.id, 'cancelled', 'vnpay');
    for (let i = 0; i < 4; i++) await mk(b.id, 'pending', 'vnpay');
    expect(await t.ord.countOpenOrders(a.id)).toEqual({ online_pending: 2, cod_open: 2 });
    expect(await t.ord.countOpenOrders(c.id)).toEqual({ online_pending: 0, cod_open: 0 });
    expect(await t.ord.countOpenOrders(b.id)).toEqual({ online_pending: 4, cod_open: 0 });
    const sum = await seedOrder(t, { user: a.id, status: 'confirmed', method: 'cod', items: [{ price: 220000, qty: 1 }], shipping: 30000 });
    expect(await t.ord.countOpenOrders(a.id)).toEqual({ online_pending: 2, cod_open: 3 });
    expect(await t.ord.getSummary(sum.id)).toEqual({ code: sum.code, status: 'confirmed', grand_total: 250000, payment_method: 'cod' });
    expect(await t.ord.getSummary(randomUUID())).toBeNull();
    await q(t, `UPDATE orders SET status = 'shipped', tracking_number = 'VN1' WHERE id = '${cod1.id}'`);
    expect(await t.ord.countOpenOrders(a.id)).toEqual({ online_pending: 2, cod_open: 2 }); // cod_open giảm đúng 1 khi đơn COD sang shipped
    const plan = await t.prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL enable_seqscan = off`; return tx.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN ${countOpenSql(a.id)}`); });
    expect(JSON.stringify(plan)).toContain('orders_open_self_idx'); // không quét cả bảng (chỉ mục một phần mới của đợt bán hộ, chỉ đơn khách tự đặt)
  });
});

