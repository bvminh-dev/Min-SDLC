import { addItem, activeCart, buyer, call, createCrtApp, getCart, itemsOf, product, putShipping, q, resetCrt, seedCart, seedMethod, setQty, sku, type CrtApp } from '../support/crt';

// Trần tạm tính 10.000.000.000 của giỏ (CRT-REQ-20261006-103226537 BR3, BR9; CRT-REQ-20261006-103226562 BR10; SHP-REQ-20261006-101103806 BR1). PRD, INV, SHP chạy thật trên PostgreSQL thật.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(() => resetCrt(t));
afterEach(() => jest.restoreAllMocks());

const BIG = 1_000_000_000;
const CAP = 10_000_000_000;
/** `n` sản phẩm giá 1.000.000.000 còn nhiều hàng. */
const many = async (n: number, price: number): Promise<string[]> => { const out: string[] = []; for (let i = 0; i < n; i++) out.push(await sku(t, price, 1000)); return out; }; // tuần tự: danh mục dựng chung
const bigProducts = (n: number) => many(n, BIG);

describe('CRT trần tạm tính của giỏ', () => {
  it('CRT-TC-20261013-205743594: thêm hay tăng số lượng làm tạm tính vượt 10.000.000.000 bị 409 cart-limit-exceeded, đúng trần thì được, giữ nguyên hay giảm luôn được', async () => {
    const u = await buyer(t);
    const nine = await bigProducts(9);
    const [p10, p11] = [await sku(t, BIG, 1000), await sku(t, 1, 1000)];
    const { cart, items } = await seedCart(t, u.id, { lines: nine.map((product) => ({ product })) });
    const ok = await addItem(t, u, p10, 1);
    expect(ok.status).toBe(201);
    const version = (await activeCart(t, u.id))!.version;
    const over = await addItem(t, u, p11, 1);
    expect([over.status, over.body.type, over.body.max_subtotal]).toEqual([409, 'urn:ecom:error:cart-limit-exceeded', CAP]);
    expect([(await itemsOf(t, cart)).length, (await activeCart(t, u.id))!.version]).toEqual([10, version]);
    const inc = await setQty(t, u, items[0], 2);
    expect([inc.status, inc.body.type]).toEqual([409, 'urn:ecom:error:cart-limit-exceeded']);
    expect([(await itemsOf(t, cart))[0].quantity, (await activeCart(t, u.id))!.version]).toEqual([1, version]);
    expect((await setQty(t, u, items[0], 1)).status).toBe(200); // giữ nguyên không phải thao tác tăng
    expect((await call(t, 'delete', `/cart/items/${items[1]}`, { cookie: u.cookie })).status).toBe(204);
    expect((await addItem(t, u, p11, 1)).status).toBe(201); // dưới trần thì được
  });

  it('CRT-TC-20261013-205743594: gộp vào dòng có sẵn cũng tính trần: dòng đã có trong giỏ không bị đếm hai lần, tăng số lượng dòng đó vượt trần bị 409', async () => {
    const u = await buyer(t);
    const [a, b] = [await sku(t, BIG, 1000), await sku(t, BIG, 1000)];
    await seedCart(t, u.id, { lines: [{ product: a, quantity: 5 }, { product: b, quantity: 4 }] }); // 9 tỷ
    expect((await addItem(t, u, a, 1)).status).toBe(200); // gộp: 6 + 4 = 10 tỷ đúng trần (dòng a không đếm hai lần)
    const over = await addItem(t, u, b, 1);
    expect([over.status, over.body.type]).toEqual([409, 'urn:ecom:error:cart-limit-exceeded']);
  });

  it('CRT-TC-20261013-205743594: dòng ngừng bán không tính vào trần', async () => {
    const u = await buyer(t);
    const gone = await product(t, { price: BIG, status: 'archived' });
    const live = await bigProducts(9);
    const extra = await sku(t, BIG, 1000);
    await seedCart(t, u.id, { lines: [{ product: gone, quantity: 99, reason: 'product_archived' }, ...live.map((product) => ({ product }))] });
    expect((await addItem(t, u, extra, 1)).status).toBe(201);
  });

  it('CRT-TC-20261013-205743712: giá tăng làm giỏ vượt trần thì xem giỏ báo shipping.error cart_limit_exceeded (không service_unavailable), chặn thanh toán, không hỏi SHP; chọn vận chuyển 409; bớt hàng thì hết báo', async () => {
    const u = await buyer(t);
    const eleven = await many(11, 900_000_000); // 9.900.000.000: dưới trần
    const m = await seedMethod(t, {});
    const { items } = await seedCart(t, u.id, { lines: eleven.map((product) => ({ product })), method: m, city: 'Hà Nội' });
    expect((await getCart(t, u)).body.shipping.fee).not.toBeNull();
    await q(t, `UPDATE products SET price = ${BIG}, updated_at = now() WHERE id IN (${eleven.map((p) => `'${p}'`).join(',')})`); // admin tăng giá: 11.000.000.000
    const quote = jest.spyOn(t.shp, 'quote');
    const v = await getCart(t, u);
    expect(v.status).toBe(200);
    expect(v.body.subtotal).toBe(11 * BIG);
    expect(v.body.shipping).toEqual({ method_id: m, city: 'Hà Nội', fee: null, error: 'cart_limit_exceeded' });
    expect(v.body.checkout_blockers).toEqual(['cart_limit_exceeded']);
    expect(v.body.can_checkout).toBe(false);
    const put = await putShipping(t, u, m, 'Hà Nội');
    expect([put.status, put.body.type, put.body.max_subtotal]).toEqual([409, 'urn:ecom:error:cart-limit-exceeded', CAP]);
    expect(quote).not.toHaveBeenCalled();
    expect((await activeCart(t, u.id))!.shipping_method_id).toBe(m);
    expect((await call(t, 'delete', `/cart/items/${items[0]}`, { cookie: u.cookie })).status).toBe(204); // còn 10 dòng: đúng trần
    const ok = await getCart(t, u);
    expect([ok.body.shipping.error, ok.body.checkout_blockers, typeof ok.body.shipping.fee]).toEqual([undefined, [], 'number']);
  });

  it('CRT-TC-20261013-205743812: CartApi.lockForCheckout ném cart-limit-exceeded khi tạm tính vượt trần (snapshotForCheckout chỉ đọc nên vẫn trả, can_checkout false), dưới trần thì trả bình thường', async () => {
    const u = await buyer(t);
    const eleven = await many(11, 900_000_000);
    await seedCart(t, u.id, { lines: eleven.map((product) => ({ product })) });
    expect(await t.cart.snapshotForCheckout(u.id)).toMatchObject({ ok: true, items_subtotal: 11 * 900_000_000 });
    expect(await t.tx.run((tx) => t.cart.lockForCheckout(u.id, tx))).toMatchObject({ ok: true, items_subtotal: 11 * 900_000_000 });
    await q(t, `UPDATE products SET price = ${BIG}, updated_at = now() WHERE id IN (${eleven.map((p) => `'${p}'`).join(',')})`);
    expect(await t.cart.snapshotForCheckout(u.id)).toMatchObject({ ok: true, items_subtotal: 11 * BIG, can_checkout: false });
    await expect(t.tx.run((tx) => t.cart.lockForCheckout(u.id, tx))).rejects.toMatchObject({ code: 'cart-limit-exceeded' });
  });
});
