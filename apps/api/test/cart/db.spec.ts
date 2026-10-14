import { randomUUID } from 'node:crypto';
import { createCrtApp, product, q, resetCrt, seedCart, seedMethod, sku, type CrtApp } from '../support/crt';

// Ràng buộc của CRT-DB-20261006-103824563 kiểm bằng SQL trực tiếp, bỏ qua CartService (T3, T9): CHECK, unique một phần, khóa ngoại, cascade; mỗi ràng buộc có đột biến ở scripts/mutations-crt.json.
const DB = 'CRT-DB-20261006-103824563';
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));

/** Lỗi SQLSTATE và tên ràng buộc của một câu lệnh bị từ chối. */
async function reject(sql: Promise<unknown>): Promise<{ code: string; message: string }> {
  try { await sql; } catch (e) { const m = (e as { meta?: { code?: string; message?: string } }).meta; return { code: m?.code ?? 'none', message: m?.message ?? String(e) }; }
  return { code: 'accepted', message: '' };
}
const newCart = async (status = 'active', order: string | null = null): Promise<string> =>
  (await t.prisma.$queryRaw<{ id: string }[]>`INSERT INTO carts (user_id, status, converted_order_id) VALUES (${randomUUID()}::uuid, ${status}::cart_status, ${order}::uuid) RETURNING id`)[0].id;

describe(`CRT-DB ${DB}: CHECK của cart_items (CRT-TC-20261006-104451335, CRT-TC-20261006-104451178)`, () => {
  it.each([[0], [-1], [100], [1000000]])('số lượng %i bị CHECK cart_items_quantity_range từ chối kể cả khi ghi SQL trực tiếp', async (qty) => {
    const cart = await newCart(), p = await product(t);
    const r = await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart}::uuid, ${p}::uuid, ${qty}, 1000)`);
    expect([qty, r.code, r.message]).toEqual([qty, '23514', expect.stringContaining('cart_items_quantity_range')]);
  });
  it.each([[1, 'accepted'], [99, 'accepted']])('số lượng biên %i được nhận', async (qty, ok) => {
    const cart = await newCart(), p = await product(t);
    expect((await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart}::uuid, ${p}::uuid, ${qty}, 1000)`)).code).toBe(ok);
  });
  it.each([[0], [-5], [1_000_000_001]])('giá lúc thêm %i bị CHECK cart_items_unit_price_range từ chối; 1 và 1.000.000.000 được nhận', async (price) => {
    const cart = await newCart(), p = await product(t);
    const r = await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart}::uuid, ${p}::uuid, 1, ${price})`);
    expect([price, r.code, r.message]).toEqual([price, '23514', expect.stringContaining('cart_items_unit_price_range')]);
    for (const ok of [1, 1_000_000_000]) {
      const c2 = await newCart(), p2 = await product(t);
      expect((await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${c2}::uuid, ${p2}::uuid, 1, ${ok})`)).code).toBe('accepted');
    }
  });
  it('lý do không còn bán chỉ là product_archived (CHECK cart_items_unavailable_reason)', async () => {
    const cart = await newCart(), p = await product(t);
    const bad = await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unavailable_reason) VALUES (${cart}::uuid, ${p}::uuid, 1, 1000, 'sold_out')`);
    expect([bad.code, bad.message]).toEqual(['23514', expect.stringContaining('cart_items_unavailable_reason')]);
    expect((await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unavailable_reason) VALUES (${cart}::uuid, ${p}::uuid, 1, 1000, 'product_archived')`)).code).toBe('accepted');
  });
  it('unique(cart_id, product_id): một dòng mỗi sản phẩm trong một giỏ (gộp số lượng, không nhân đôi dòng)', async () => {
    const cart = await newCart(), p = await product(t);
    await t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart}::uuid, ${p}::uuid, 1, 1000)`;
    const r = await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart}::uuid, ${p}::uuid, 1, 1000)`);
    expect([r.code, r.message]).toEqual(['23505', expect.stringContaining('Key (cart_id, product_id)')]); // Prisma raw chỉ đưa cột của chỉ mục, không đưa tên ràng buộc
  });
  it('khóa ngoại: dòng phải trỏ tới giỏ và sản phẩm có thật; xóa sản phẩm bị RESTRICT; xóa giỏ kéo theo dòng (CASCADE)', async () => {
    const cart = await newCart(), p = await product(t, { images: 0 });
    for (const [c, pr] of [[randomUUID(), p], [cart, randomUUID()]]) {
      const r = await reject(t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${c}::uuid, ${pr}::uuid, 1, 1000)`);
      expect(r.code).toBe('23503');
    }
    await t.prisma.$executeRaw`INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart}::uuid, ${p}::uuid, 1, 1000)`;
    const del = await reject(t.prisma.$executeRaw`DELETE FROM products WHERE id = ${p}::uuid`);
    expect([del.code, del.message]).toEqual(['23503', expect.stringContaining('cart_items_product_id_fkey')]);
    await t.prisma.$executeRaw`DELETE FROM carts WHERE id = ${cart}::uuid`;
    expect((await q<{ n: number }>(t, 'SELECT count(*)::int AS n FROM cart_items'))[0].n).toBe(0);
  });
});

describe(`CRT-DB ${DB}: carts (CRT-TC-20261006-104451453, CRT-TC-20261006-104451389)`, () => {
  it('chỉ một giỏ active mỗi người dùng (unique một phần); giỏ converted và abandoned không giới hạn số lượng', async () => {
    const user = randomUUID();
    await t.prisma.$executeRaw`INSERT INTO carts (user_id) VALUES (${user}::uuid)`;
    const r = await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id) VALUES (${user}::uuid)`);
    expect([r.code, r.message]).toEqual(['23505', expect.stringContaining('Key (user_id)')]);
    for (const status of ['abandoned', 'abandoned', 'converted', 'converted']) {
      const order = status === 'converted' ? randomUUID() : null;
      expect((await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id, status, converted_order_id) VALUES (${user}::uuid, ${status}::cart_status, ${order}::uuid)`)).code).toBe('accepted');
    }
    await t.prisma.$executeRaw`UPDATE carts SET status = 'abandoned' WHERE user_id = ${user}::uuid AND status = 'active'`;
    expect((await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id) VALUES (${user}::uuid)`)).code).toBe('accepted'); // hết active thì tạo được giỏ mới
  });
  it('converted khi và chỉ khi có converted_order_id (CHECK carts_converted_order)', async () => {
    const a = await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id, status) VALUES (${randomUUID()}::uuid, 'converted')`);
    const b = await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id, status, converted_order_id) VALUES (${randomUUID()}::uuid, 'active', ${randomUUID()}::uuid)`);
    for (const r of [a, b]) expect([r.code, r.message]).toEqual(['23514', expect.stringContaining('carts_converted_order')]);
  });
  it('mã giảm giá 1..50 ký tự, thành phố 1..50 ký tự, phương thức và thành phố cùng có hoặc cùng không, version từ 1', async () => {
    const m = await seedMethod(t);
    const rows: [string, Promise<unknown>][] = [
      ['carts_coupon_code_len', t.prisma.$executeRaw`INSERT INTO carts (user_id, coupon_code) VALUES (${randomUUID()}::uuid, '')`],
      ['carts_coupon_code_len', t.prisma.$executeRaw`INSERT INTO carts (user_id, coupon_code) VALUES (${randomUUID()}::uuid, ${'A'.repeat(51)})`],
      ['carts_shipping_city_len', t.prisma.$executeRaw`INSERT INTO carts (user_id, shipping_method_id, shipping_city) VALUES (${randomUUID()}::uuid, ${m}::uuid, ${'X'.repeat(51)})`],
      ['carts_shipping_pair', t.prisma.$executeRaw`INSERT INTO carts (user_id, shipping_method_id) VALUES (${randomUUID()}::uuid, ${m}::uuid)`],
      ['carts_shipping_pair', t.prisma.$executeRaw`INSERT INTO carts (user_id, shipping_city) VALUES (${randomUUID()}::uuid, 'Hà Nội')`],
      ['carts_version_min', t.prisma.$executeRaw`INSERT INTO carts (user_id, version) VALUES (${randomUUID()}::uuid, 0)`],
    ];
    for (const [name, sql] of rows) { const r = await reject(sql); expect([name, r.code, r.message]).toEqual([name, '23514', expect.stringContaining(name)]); }
    expect((await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id, coupon_code, shipping_method_id, shipping_city) VALUES (${randomUUID()}::uuid, ${'A'.repeat(50)}, ${m}::uuid, ${'X'.repeat(50)})`)).code).toBe('accepted');
  });
  it('phương thức vận chuyển phải có thật và không bị xóa khi giỏ đang dùng (khóa ngoại RESTRICT)', async () => {
    const m = await seedMethod(t);
    const r = await reject(t.prisma.$executeRaw`INSERT INTO carts (user_id, shipping_method_id, shipping_city) VALUES (${randomUUID()}::uuid, ${randomUUID()}::uuid, 'Hà Nội')`);
    expect(r.code).toBe('23503');
    await t.prisma.$executeRaw`INSERT INTO carts (user_id, shipping_method_id, shipping_city) VALUES (${randomUUID()}::uuid, ${m}::uuid, 'Hà Nội')`;
    const del = await reject(t.prisma.$executeRaw`DELETE FROM shipping_methods WHERE id = ${m}::uuid`);
    expect([del.code, del.message]).toEqual(['23503', expect.stringContaining('carts_shipping_method_id_fkey')]);
  });
  it('user_id và converted_order_id là cột trơn (không khóa ngoại tới AUTH, ORD, đúng ranh giới module A-03); tiền không có cột nào trong carts', async () => {
    const fks = await q<{ ref: string }>(t, `SELECT confrelid::regclass::text AS ref FROM pg_constraint WHERE conrelid IN ('carts'::regclass, 'cart_items'::regclass) AND contype = 'f' ORDER BY 1`);
    expect(fks.map((f) => f.ref)).toEqual(['carts', 'products', 'shipping_methods']);
    const cols = (await q<{ column_name: string }>(t, `SELECT column_name FROM information_schema.columns WHERE table_name = 'carts'`)).map((c) => c.column_name);
    for (const c of ['subtotal', 'discount', 'shipping_fee', 'total']) expect(cols).not.toContain(c);
    expect(await sku(t)).toBeTruthy();
    expect((await seedCart(t, randomUUID(), { lines: [] })).cart).toBeTruthy();
  });
});
