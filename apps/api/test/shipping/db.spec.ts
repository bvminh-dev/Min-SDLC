import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { createShpApp, histOf, pgCode, q, seedMethod, seedOrderFor, seedShipment, type ShpApp } from '../support/shp';

// Ràng buộc ở CSDL của SHP (SHP-DB-20261006-101603015, Migration 2 và 3): từng CHECK, unique, khóa ngoại, ON DELETE RESTRICT và cột identity; mỗi ràng buộc có một ca bị từ chối (SB-24, SB-32).
const DB = 'SHP-DB-20261006-101603015';

describe('SHP ràng buộc CSDL', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); });
  const sql = (s: string) => pgCode(q(t, s));

  it(`SHP-TC-20261006-102133602 SHP-TC-20261006-102133480 ${DB} Migration 2: shipments: CHECK mã vận đơn (định dạng, chỉ từ lúc bàn giao), tiền thu hộ không âm, delivered phải có delivered_at; unique mã và một vận đơn còn hiệu lực mỗi đơn`, async () => {
    const m = await seedMethod(t);
    const o = await seedOrderFor(t, { status: 'paid' }), o2 = await seedOrderFor(t, { status: 'paid' });
    const ins = (order: string, cols: string, vals: string) => `INSERT INTO shipments (order_id, shipping_method_id, ${cols}) VALUES ('${order}', '${m}', ${vals})`;
    expect(await sql(ins(o.id, 'cod_amount', '-1'))).toBe('23514'); // shipments_cod_nonneg
    expect(await sql(ins(o.id, 'status, tracking_number', `'shipped', 'abc'`))).toBe('23514'); // shipments_tracking_format
    expect(await sql(ins(o.id, 'status, tracking_number', `'shipped', 'GHN1234567'||'8'||'x'||repeat('Y', 30)`))).toBe('23514'); // quá 30 ký tự
    expect(await sql(ins(o.id, 'status, tracking_number', `'shipped', 'ghn12345678'`))).toBe('23514'); // chữ thường không khớp mẫu
    expect(await sql(ins(o.id, 'status', `'shipped'`))).toBe('23514'); // shipments_tracking_status: shipped phải có mã
    expect(await sql(ins(o.id, 'status, tracking_number', `'pending', 'GHN12345678'`))).toBe('23514'); // pending không có mã
    expect(await sql(ins(o.id, 'status, tracking_number', `'cancelled', 'GHN12345678'`))).toBe('23514'); // cancelled không có mã
    expect(await sql(ins(o.id, 'status, tracking_number', `'delivered', 'GHN12345678'`))).toBe('23514'); // shipments_delivered_at
    expect(await sql(ins(o.id, 'status, tracking_number, delivered_at', `'delivered', 'GHN12345678', now()`))).toBe('ok');
    expect(await sql(ins(o.id, 'status', `'pending'`))).toBe('23505'); // shipments_order_active_key: một vận đơn còn hiệu lực mỗi đơn
    expect(await sql(ins(o2.id, 'status, tracking_number', `'shipped', 'GHN12345678'`))).toBe('23505'); // shipments_tracking_number_key
    expect(await sql(ins(o2.id, 'status, tracking_number', `'shipped', 'GHN12345679'`))).toBe('ok');
    expect(await sql(ins(o2.id, 'status', `'cancelled'`))).toBe('ok'); // nhiều dòng cancelled cùng đơn được phép
    expect(await sql(ins(o2.id, 'status', `'cancelled'`))).toBe('ok');
  });

  it(`SHP-TC-20261006-102147397 ${DB} Migration 2: shipment_status_history: lý do và ghi chú chỉ ở dòng failed, ghi chú tối đa 300 ký tự; seq là identity (không ghi tay)`, async () => {
    const v = await seedShipment(t, { status: 'shipped' });
    const h = (cols: string, vals: string) => `INSERT INTO shipment_status_history (shipment_id, ${cols}) VALUES ('${v.id}', ${vals})`;
    expect(await sql(h('event, status, reason_code', `'status_changed', 'shipped', 'other'`))).toBe('23514'); // shipment_status_history_reason_scope
    expect(await sql(h('event, status, note', `'status_changed', 'shipped', 'x'`))).toBe('23514'); // note_scope
    expect(await sql(h('event, status, note', `'status_changed', 'failed', repeat('x', 301)`))).toBe('23514');
    expect(await sql(h('event, status, note', `'status_changed', 'failed', repeat('x', 300)`))).toBe('ok');
    expect(await sql(h('event, status, reason_code, note', `'status_changed', 'failed', 'wrong_address', 'ghi chú'`))).toBe('ok');
    expect(await sql(h('event, status, seq', `'status_changed', 'failed', 1`))).toBe('428C9'); // GENERATED ALWAYS
    expect(await sql(h('event, status', `'giao_lai', 'failed'`))).toBe('22P02'); // enum shipment_history_event
    expect(await sql(h('event, status, reason_code', `'status_changed', 'failed', 'lost'`))).toBe('22P02'); // enum shipment_fail_reason
    const seqs = (await histOf(t, v.id)).map((x) => Number(x.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it(`SHP-TC-20261006-102133480 ${DB} Migration 2: khóa ngoại (order, phương thức, vận đơn) và ON DELETE RESTRICT: không có đơn hay phương thức hay vận đơn thì không chèn được; đã có vận đơn thì không xóa được đơn, phương thức hay vận đơn`, async () => {
    const m = await seedMethod(t);
    const o = await seedOrderFor(t, { status: 'paid' });
    expect(await sql(`INSERT INTO shipments (order_id, shipping_method_id) VALUES ('${randomUUID()}', '${m}')`)).toBe('23503'); // shipments_order_id_fkey
    expect(await sql(`INSERT INTO shipments (order_id, shipping_method_id) VALUES ('${o.id}', '${randomUUID()}')`)).toBe('23503'); // shipments_shipping_method_id_fkey
    expect(await sql(`INSERT INTO shipment_status_history (shipment_id, event, status) VALUES ('${randomUUID()}', 'status_changed', 'pending')`)).toBe('23503'); // shipment_status_history_shipment_id_fkey
    const v = await seedShipment(t, { status: 'pending' });
    expect(await sql(`DELETE FROM orders WHERE id = '${v.order.id}'`)).toBe('23503'); // ON DELETE RESTRICT (không CASCADE)
    expect(await sql(`DELETE FROM shipping_methods WHERE id = '${v.method}'`)).toBe('23503');
    expect(await sql(`DELETE FROM shipments WHERE id = '${v.id}'`)).toBe('23503'); // lịch sử còn trỏ tới vận đơn
    expect((await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM shipments WHERE id = '${v.id}'`))[0].n).toBe(1);
    const bare = await seedShipment(t, { status: 'pending', noHistory: true, bareOrder: true }); // không còn lịch sử giữ lại: chỉ khóa ngoại của chính vận đơn chặn
    expect(await sql(`DELETE FROM orders WHERE id = '${bare.order.id}'`)).toBe('23503');
    expect(await sql(`DELETE FROM shipping_methods WHERE id = '${bare.method}'`)).toBe('23503');
  });

  it(`SHP-TC-20261006-102133111 ${DB} Migration 2: shipping_methods: CHECK tên, phí cơ bản, rule là đối tượng; tên duy nhất không phân biệt hoa thường và khoảng trắng đầu cuối`, async () => {
    const ins = (name: string, fee: number, rule: string) => `INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('${name}', ${fee}, '${rule}'::jsonb)`;
    expect(await sql(ins('M', 1, '{}'))).toBe('23514'); // shipping_methods_name_len
    expect(await sql(ins(' M ', 1, '{}'))).toBe('23514'); // đếm sau btrim
    expect(await sql(ins(`${'x'.repeat(81)}`, 1, '{}'))).toBe('23514');
    expect(await sql(ins('Giao nhanh', -1, '{}'))).toBe('23514'); // base_fee_range
    expect(await sql(ins('Giao nhanh', 1000001, '{}'))).toBe('23514');
    expect(await sql(ins('Giao nhanh', 1, '[]'))).toBe('23514'); // rule_object
    expect(await sql(ins('Giao nhanh', 1, '"x"'))).toBe('23514');
    expect(await sql(ins('Giao nhanh', 1000000, '{}'))).toBe('ok');
    expect(await sql(ins('GIAO NHANH', 1, '{}'))).toBe('23505'); // shipping_methods_name_key
    expect(await sql(ins('  giao nhanh  ', 1, '{}'))).toBe('23505');
    expect(await sql(ins('Giao nhanh 2', 0, '{}'))).toBe('ok');
  });
});
