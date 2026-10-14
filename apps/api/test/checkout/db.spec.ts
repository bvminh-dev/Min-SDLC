import { randomUUID } from 'node:crypto';
import { createChkApp, q, resetChk, seedMethod, shopper, world, type ChkApp, type World } from '../support/chk';
import { pgCode, seedOrder } from '../support/ord';

// Lược đồ CHK-DB-20261006-105800565 (bảng checkout_sessions): CHECK, unique một phần, khóa ngoại và chỉ mục, kiểm bằng SQL trực tiếp trên PostgreSQL thật (lớp thứ hai sau mã ứng dụng, SB-24, SB-25).
const DB = 'CHK-DB-20261006-105800565';
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); });

interface Fx { user: string; cart: string; address: string; order: string }
/** Ràng buộc kiểm trên dữ liệu có thật: người dùng, giỏ, địa chỉ, đơn (`user_id` của phiên không có khóa ngoại). */
async function fx(email: string): Promise<Fx> {
  const s = await shopper(t, w, { email });
  const o = await seedOrder(t, { user: s.u.id, status: 'pending', method: 'cod' });
  return { user: s.u.id, cart: s.cart, address: s.a1, order: o.id };
}
const sess = (f: Partial<Fx> & { user: string; cart: string }, o: { status?: string; order?: string | null; completed?: boolean; coupon?: string | null; address?: string | null; method?: string | null } = {}) => {
  const status = o.status ?? 'open';
  const order = o.order === undefined ? null : o.order;
  const completedAt = o.completed === undefined ? (status === 'completed' ? 'now()' : 'NULL') : o.completed ? 'now()' : 'NULL';
  return q(t, `INSERT INTO checkout_sessions (user_id, cart_id, address_id, shipping_method_id, order_id, coupon_code, status, completed_at, expires_at)
    VALUES ('${f.user}', '${f.cart}', ${o.address === undefined ? 'NULL' : o.address === null ? 'NULL' : `'${o.address}'`}, ${o.method ? `'${o.method}'` : 'NULL'}, ${order ? `'${order}'` : 'NULL'}, ${o.coupon === undefined || o.coupon === null ? 'NULL' : `'${o.coupon}'`}, '${status}', ${completedAt}, now() + interval '30 minutes') RETURNING id`);
};

describe(`CHK lược đồ checkout_sessions (${DB})`, () => {
  it(`CHK-TC-20261006-110703196 ${DB} (migration 1, 2): enum checkout_status đúng bốn giá trị, checkout_payment_method đúng hai; bảng có đủ cột, user_id KHÔNG có khóa ngoại, khóa ngoại chỉ tới carts, addresses, shipping_methods, orders`, async () => {
    expect((await q<{ r: string }>(t, 'SELECT enum_range(NULL::checkout_status)::text AS r'))[0].r).toBe('{open,completed,expired,cancelled}');
    expect((await q<{ r: string }>(t, 'SELECT enum_range(NULL::checkout_payment_method)::text AS r'))[0].r).toBe('{vnpay,cod}');
    const cols = (await q<{ column_name: string; is_nullable: string }>(t, "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'checkout_sessions' ORDER BY ordinal_position")).map((c) => [c.column_name, c.is_nullable]);
    expect(cols).toEqual([['id', 'NO'], ['user_id', 'NO'], ['cart_id', 'NO'], ['address_id', 'YES'], ['shipping_method_id', 'YES'], ['order_id', 'YES'], ['payment_method', 'YES'], ['coupon_code', 'YES'], ['address_snapshot', 'YES'], ['price_snapshot', 'YES'],
      ['status', 'NO'], ['expires_at', 'NO'], ['last_activity_at', 'NO'], ['created_at', 'NO'], ['updated_at', 'NO'], ['completed_at', 'YES']]);
    const fks = await q<{ col: string; ref: string; del: string }>(t, `
      SELECT a.attname AS col, c.confrelid::regclass::text AS ref, c.confdeltype::text AS del FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = 'checkout_sessions'::regclass AND c.contype = 'f' ORDER BY a.attname`);
    expect(fks).toEqual([{ col: 'address_id', ref: 'addresses', del: 'n' }, { col: 'cart_id', ref: 'carts', del: 'r' }, { col: 'order_id', ref: 'orders', del: 'r' }, { col: 'shipping_method_id', ref: 'shipping_methods', del: 'n' }]);
  });

  it(`CHK-TC-20261006-110703196 ${DB} (SB-24): CHECK completed khi và chỉ khi có order_id và completed_at; open, expired, cancelled không có order_id`, async () => {
    const f = await fx('a@shop.vn');
    expect(await pgCode(sess(f, { status: 'completed', order: null }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'completed', order: f.order, completed: false }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'open', order: f.order }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'cancelled', order: f.order }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'expired', order: f.order }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'open', completed: true }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'completed', order: f.order }))).toBe('ok');
    expect(await pgCode(sess(f, { status: 'expired' }))).toBe('ok');
  });

  it(`CHK-TC-20261006-110700801 ${DB} (SB-25, T5): unique một phần: một phiên open mỗi người, một phiên completed mỗi giỏ, một phiên mỗi đơn`, async () => {
    const a = await fx('a@shop.vn'), b = await fx('b@shop.vn');
    expect(await pgCode(sess(a))).toBe('ok');
    expect(await pgCode(sess(a))).toBe('23505'); // phiên open thứ hai của cùng người
    expect(await pgCode(sess(a, { status: 'cancelled' }))).toBe('ok'); // đã đóng thì không giới hạn
    expect(await pgCode(sess(a, { status: 'expired' }))).toBe('ok');
    expect(await pgCode(sess(b, { status: 'completed', order: b.order }))).toBe('ok');
    const o2 = (await seedOrder(t, { user: b.user, status: 'pending', method: 'cod' })).id;
    expect(await pgCode(sess(b, { status: 'completed', order: o2 }))).toBe('23505'); // phiên completed thứ hai của cùng giỏ
    const c = await fx('c@shop.vn');
    expect(await pgCode(sess(c, { status: 'completed', order: b.order }))).toBe('23505'); // cùng một đơn cho hai phiên
    expect(await pgCode(sess(c, { status: 'completed', order: c.order }))).toBe('ok');
  });

  it(`CHK-TC-20261006-110701818 ${DB}: coupon_code 1..50 ký tự (rỗng và 51 ký tự bị CHECK)`, async () => {
    const f = await fx('a@shop.vn');
    expect(await pgCode(sess(f, { status: 'cancelled', coupon: '' }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'cancelled', coupon: 'A'.repeat(51) }))).toBe('23514');
    expect(await pgCode(sess(f, { status: 'cancelled', coupon: 'A'.repeat(50) }))).toBe('ok');
  });

  it(`CHK-TC-20261006-110701117 ${DB} (E-06): khóa ngoại: xóa giỏ hay đơn có phiên tham chiếu bị từ chối (RESTRICT); xóa cứng địa chỉ và phương thức vận chuyển đặt cột của phiên về NULL (SET NULL)`, async () => {
    const f = await fx('a@shop.vn');
    const method = await seedMethod(t, {});
    const [row] = await sess(f, { address: f.address, method }) as { id: string }[];
    await q(t, `DELETE FROM addresses WHERE id = '${f.address}'`);
    await q(t, `DELETE FROM shipping_methods WHERE id = '${method}'`);
    expect((await q<{ address_id: string | null; shipping_method_id: string | null }>(t, `SELECT address_id, shipping_method_id FROM checkout_sessions WHERE id = '${row.id}'`))[0]).toEqual({ address_id: null, shipping_method_id: null });
    expect(await pgCode(q(t, `DELETE FROM carts WHERE id = '${f.cart}'`))).toBe('23503');
    expect(await pgCode(sess(f, { status: 'completed', order: f.order }))).toBe('ok');
    expect(await pgCode(q(t, `DELETE FROM orders WHERE id = '${f.order}'`))).toBe('23503');
    expect(await pgCode(sess({ user: randomUUID(), cart: randomUUID() }))).toBe('23503'); // giỏ không có
  });

  it(`CHK-TC-20261006-110703691 CHK-TC-20261006-110703926 ${DB} (mục 7, 8): chỉ mục một phần cho job hết hạn (expires_at WHERE status = open) và job xóa bản chụp (updated_at WHERE address_snapshot IS NOT NULL AND status <> open), unique một phần đúng điều kiện`, async () => {
    const defs = Object.fromEntries((await q<{ indexname: string; indexdef: string }>(t, "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'checkout_sessions'")).map((r) => [r.indexname, r.indexdef]));
    expect(defs['checkout_sessions_open_expiry_idx']).toMatch(/\(expires_at\) WHERE \(status = 'open'::checkout_status\)/);
    expect(defs['checkout_sessions_snapshot_purge_idx']).toMatch(/\(updated_at\) WHERE \(\(address_snapshot IS NOT NULL\) AND \(status <> 'open'::checkout_status\)\)/);
    expect(defs['checkout_sessions_user_open_key']).toMatch(/UNIQUE INDEX .*\(user_id\) WHERE \(status = 'open'::checkout_status\)/);
    expect(defs['checkout_sessions_cart_completed_key']).toMatch(/UNIQUE INDEX .*\(cart_id\) WHERE \(status = 'completed'::checkout_status\)/);
    expect(defs['checkout_sessions_order_key']).toMatch(/UNIQUE INDEX .*\(order_id\) WHERE \(order_id IS NOT NULL\)/);
    expect(Object.values(defs).some((d) => /\(user_id, created_at DESC\)/.test(d))).toBe(true);
  });
});
