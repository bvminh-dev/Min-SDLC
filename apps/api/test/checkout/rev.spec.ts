import { ipn, ipnQuery, initiate, payOfOrder, attemptsOf } from '../support/pay';
import { activeCart, itemsOf, setQty } from '../support/crt';
import type { CrtApp } from '../support/crt';
import { AuditService } from '../../src/modules/platform';
import {
  call, countOf, create, createChkApp, dropCoupon, holdsOf, onHandOf, ordersOf, place, q, ready, redemptionsFor, reservedCount, reservedOf, outboxOf, resetChk, seedCoupon, sessionRow, setMethodActive, shopper,
  tally, view, world, relayAll, type ChkApp, type Seeded, type World,
} from '../support/chk';

// Ca của reviewer độc lập (REV-CHK-nn): lỗ hổng bằng chứng tìm thấy bằng thăm dò tay và đột biến; luồng cuối-cùng-đến-cuối giỏ -> checkout -> đơn -> VNPay (cổng giả) -> hủy.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => { jest.restoreAllMocks(); });
const body = (n = 345000, v = 7) => ({ expected_grand_total: n, cart_version: v });
async function full(o: { pay?: 'cod' | 'vnpay'; email?: string; coupon?: string | null } = {}): Promise<{ s: Seeded; id: string }> {
  const s = await shopper(t, w, { email: o.email });
  return { s, id: await ready(t, s, w, { pay: o.pay ?? 'cod', coupon: o.coupon === undefined ? 'SALE10' : o.coupon }) };
}

describe('REV-CHK luồng cuối-cùng-đến-cuối: giỏ -> checkout -> đơn -> VNPay (cổng giả) -> thanh toán -> hủy', () => {
  it('CHK-TC-20261006-110703231 (REV-CHK-10): đơn VNPay: tiền khớp từ phiên tới Payment và đơn; thanh toán xong đơn paid, hàng và lượt coupon chốt đúng một lần; hủy nhả đúng một lần (hàng, coupon), chạy lại job và relay không nhả thêm', async () => {
    const { s, id } = await full({ pay: 'vnpay' });
    const stock0 = [await onHandOf(t, w.p1), await onHandOf(t, w.p2)];
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.order.status, r.body.order.grand_total]).toEqual([201, 'pending', 345000]); // 350000 - 35000 + 30000
    const [o] = await ordersOf(t, s.u.id);
    await relayAll(t, 4);
    const pay = await payOfOrder(t, o.id);
    expect([pay.status, pay.amount, pay.order_code]).toEqual(['pending', '345000', o.code]); // PAY nhận OrderCreated: cùng số tiền, CHK không gọi PAY
    expect((await initiate(t, s.u.cookie, pay.id)).status).toBe(200);
    const [attempt] = await attemptsOf(t, pay.id);
    expect((await ipn(t, ipnQuery({ txnRef: attempt.txn_ref, amount: 345000 }))).body.RspCode).toBe('00');
    await relayAll(t, 6);
    expect((await ordersOf(t, s.u.id))[0].status).toBe('paid');
    expect((await holdsOf(t, o.id)).map((h) => [h.quantity, h.status]).sort()).toEqual([[1, 'committed'], [2, 'committed']]); // thứ tự dòng theo uuid ngẫu nhiên: so sau khi sắp
    expect((await redemptionsFor(t, 'SALE10')).map((x) => [x.status, x.amount])).toEqual([['consumed', '35000']]);
    expect([await onHandOf(t, w.p1), await onHandOf(t, w.p2), await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([stock0[0] - 2, stock0[1] - 1, 0, 0]);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${(await sessionRow(t, id)).cart_id}'`))[0].status).toBe('converted'); // CheckoutCompleted tới CRT
    // hủy đơn đã thanh toán: hàng và coupon trả đúng một lần
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: s.u.cookie, body: { reason: 'đổi ý' } })).status).toBe(200);
    await relayAll(t, 8);
    const moves = await countOf(t, 'stock_movements');
    expect((await holdsOf(t, o.id)).every((h) => h.status === 'released')).toBe(true);
    expect((await redemptionsFor(t, 'SALE10')).map((x) => x.status)).toEqual(['released']);
    expect([await onHandOf(t, w.p1), await onHandOf(t, w.p2), await reservedOf(t, w.p1), await reservedOf(t, w.p2), await reservedCount(t, 'SALE10')]).toEqual([stock0[0], stock0[1], 0, 0, 0]);
    await t.invJobs.expireOnce({ now: new Date(Date.now() + 3_600_000) });
    await relayAll(t, 4);
    expect(await countOf(t, 'stock_movements')).toBe(moves); // job hết hạn và relay chạy lại không nhả thêm
    expect([await onHandOf(t, w.p1), await onHandOf(t, w.p2)]).toEqual(stock0);
    expect((await redemptionsFor(t, 'SALE10')).map((x) => x.status)).toEqual(['released']);
  });
});

describe('REV-CHK thăm dò tay giữ lại', () => {
  it('CHK-TC-20261006-110701017 (REV-CHK-01): JSON nửa cặp thay thế lẻ, NUL, id lạ ở mọi đầu vào của CHK: 400 hay 404 thống nhất, không 5xx, không đổi dữ liệu', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const before = await tally(t);
    const raw = (method: 'put' | 'post', path: string, text: string) => call(t, method, path, { cookie: s.u.cookie, body: text });
    const out: [string, number, unknown][] = [];
    const cases: ['put' | 'post', string, string][] = [
      ['put', `/checkout/sessions/${id}/coupon`, '{"code":"\\ud800"}'], ['put', `/checkout/sessions/${id}/coupon`, '{"code":"SALE10\\udfff"}'], ['put', `/checkout/sessions/${id}/coupon`, '{"code":"A\\u0000B"}'],
      ['put', `/checkout/sessions/${id}/address`, '{"address_id":"\\ud800"}'], ['put', `/checkout/sessions/${id}/address`, '{"address_id":"\\u0000"}'],
      ['put', `/checkout/sessions/${id}/shipping-method`, '{"method_id":"\\ud83d"}'], ['put', `/checkout/sessions/${id}/payment-method`, '{"payment_method":"\\ud800"}'],
      ['post', `/checkout/sessions/${id}/place-order`, '{"expected_grand_total":345000,"cart_version":7,"x":"\\ud800"}'], ['post', `/checkout/sessions/${id}/place-order`, '{"expected_grand_total":345000,"cart_version":7,"__proto__":{"a":1}}'],
      ['post', '/checkout/sessions', '{"x":"\\ud800"}'], ['post', '/checkout/sessions', 'null'], ['post', '/checkout/sessions', '[]'],
      ['put', `/checkout/sessions/%00/coupon`, '{"code":"SALE10"}'], ['put', `/checkout/sessions/%ff/address`, '{"address_id":"x"}'], ['put', `/checkout/sessions/${id}%00/coupon`, '{"code":"SALE10"}'],
    ];
    for (const [m, p, b] of cases) { const r = await raw(m, p, b); out.push([`${m} ${p.replace(id, '<id>')} ${b}`, r.status, r.body?.type]); }
    expect(out.filter((x) => x[1] >= 500)).toEqual([]);
    expect(out.map((x) => x[1])).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400]); // khóa thừa, nửa cặp thay thế lẻ, NUL (kể cả ở id đường dẫn, từ nền SB-11): 400; id lạ thuần (không NUL) vẫn 404 chung (SB-06)
    expect(await tally(t)).toEqual(before);
  });

  it('CHK-SEC-20261006-105800857 (REV-CHK-02): sửa giỏ khi đang đặt: sửa chờ khóa giỏ, đơn mang đúng dòng đã xem', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const cart = await activeCart(t as unknown as CrtApp, s.u.id);
    const items = await itemsOf(t as unknown as CrtApp, cart!.id);
    const real = t.prm.reserve.bind(t.prm);
    let reached!: () => void; const at = new Promise<void>((res) => { reached = res; });
    jest.spyOn(t.prm, 'reserve').mockImplementation(async (...a) => { reached(); await new Promise((r) => setTimeout(r, 800)); return real(...a); });
    const placed = place(t, s.u, id, body()).then((r) => ({ r, at: Date.now() }));
    await at;
    const t0 = Date.now();
    const edit = await setQty(t as unknown as CrtApp, s.u, items[0].id as string, 5);
    const editedAt = Date.now();
    const p = await placed;
    expect([p.r.status, edit.status]).toEqual([201, 200]);
    expect(editedAt - t0).toBeGreaterThanOrEqual(600); // sửa giỏ chờ khóa dòng giỏ tới khi đặt hàng cam kết (CRT-REQ-20261006-103226562 BR6)
    expect(p.at).toBeLessThanOrEqual(editedAt);
    const [o] = await ordersOf(t, s.u.id);
    expect(await q(t, `SELECT product_id, quantity FROM order_items WHERE order_id = '${o.id}' ORDER BY position`)).toEqual([{ product_id: items[0].product_id, quantity: 2 }, { product_id: items[1].product_id, quantity: 1 }]); // đơn mang đúng dòng đã xem, không phải số lượng sửa sau
    expect(o.grand_total).toBe('345000');
  });
});

describe('REV-CHK lỗ hổng bằng chứng (đột biến của reviewer lọt bộ test của implement)', () => {
  it('CHK-TC-20261006-110703029 (REV-CHK-20): giao dịch đặt hàng hết lượt thử lại 40001: đã thử 1 + DB_TRANSACTION_RETRIES lần rồi 503 dependency-unavailable (không phải 500 internal-error), không đơn, không reservation, không lượt coupon', async () => {
    const { s, id } = await full({ pay: 'vnpay' });
    const spy = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValue(Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' }));
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:dependency-unavailable']);
    expect(spy).toHaveBeenCalledTimes(t.config.get<number>('DB_TRANSACTION_RETRIES') + 1);
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).status).toBe('open');
    spy.mockRestore();
    expect((await place(t, s.u, id, body())).status).toBe(201); // hết lỗi tạm thời thì đặt được, cùng phiên
  });

  it('CHK-TC-20261006-110702894 (REV-CHK-21): RESERVATION_TTL = 20: xem lại, chọn VNPay và đơn mang đúng 20 phút (hold_minutes, hạn Order và reservation)', async () => {
    const p = await createChkApp({ env: { RESERVATION_TTL: '20' } });
    try {
      await resetChk(p);
      const wp = await world(p);
      const s = await shopper(p, wp);
      const id = await ready(p, s, wp, { pay: 'vnpay', coupon: null });
      const v = (await view(p, s.u, id)).body;
      expect(v.payment_note).toEqual({ hold_minutes: 20, confirmed_immediately: false });
      const pm = await call(p, 'put', `/checkout/sessions/${id}/payment-method`, { cookie: s.u.cookie, body: { payment_method: 'vnpay' } });
      expect(pm.body.payment_note).toEqual({ hold_minutes: 20, confirmed_immediately: false });
      const r = await place(p, s.u, id, body(v.expected_grand_total, v.cart_version));
      expect(r.status).toBe(201);
      const [o] = await ordersOf(p, s.u.id);
      const [{ ahead }] = await q<{ ahead: number }>(p, `SELECT extract(epoch FROM (payment_expires_at - clock_timestamp()))::float8 AS ahead FROM orders WHERE id = '${o.id}'`);
      expect(ahead).toBeGreaterThan(19 * 60 + 30); // giờ CSDL + 20 phút (đồng hồ giả của ứng dụng không dính vào)
      expect(ahead).toBeLessThanOrEqual(20 * 60);
      expect((await holdsOf(p, o.id)).every((h) => h.expires_at!.getTime() === o.payment_expires_at!.getTime())).toBe(true);
    } finally { await p.close(); }
  }, 120_000);

  it('CHK-SEC-20261006-105800857 (REV-CHK-23): đặt hàng trả Cache-Control no-store ở 201, 200 phát lại và 409 (phản hồi có số tiền riêng của khách)', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const bad = await place(t, s.u, id, body(1));
    const ok = await place(t, s.u, id, body(), { key: 'rev-chk-23-key' });
    const again = await place(t, s.u, id, body(), { key: 'rev-chk-23-key' });
    expect([bad.status, ok.status, again.status]).toEqual([409, 201, 200]);
    expect([bad.headers['cache-control'], ok.headers['cache-control'], again.headers['cache-control']]).toEqual(['no-store', 'no-store', 'no-store']);
  });

  it('CHK-TC-20261006-110703334 (REV-CHK-25): thiếu đúng một mục không phải vận chuyển trong lúc mọi phương thức bị tắt: checkout-incomplete (không phải no-shipping-methods); bản chụp địa chỉ rỗng coi là địa chỉ đổi', async () => {
    const { s, id } = await full({ pay: 'cod', coupon: null });
    await q(t, `UPDATE checkout_sessions SET address_id = NULL, address_snapshot = NULL WHERE id = '${id}'`);
    await setMethodActive(t, w.sm1, false); await setMethodActive(t, w.sm2, false);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type, r.body.missing]).toEqual([409, 'urn:ecom:error:checkout-incomplete', ['address']]);
    await setMethodActive(t, w.sm1, true); await setMethodActive(t, w.sm2, true);
    await q(t, `UPDATE checkout_sessions SET address_id = (SELECT id FROM addresses WHERE user_id = '${s.u.id}' AND is_default) WHERE id = '${id}'`);
    const r2 = await place(t, s.u, id, body());
    expect([r2.status, r2.body.type]).toEqual([409, 'urn:ecom:error:address-changed']); // address_id có mà address_snapshot rỗng: không có gì để so, coi như đã đổi
  });

  it('CHK-TC-20261006-110703556 (REV-CHK-27): giỏ đã có đơn mà CheckoutCompleted chưa tới CRT: mở phiên lần nữa 409 cart-already-ordered, không có phiên open thứ hai', async () => {
    const { s, id } = await full({ pay: 'cod' });
    expect((await place(t, s.u, id, body())).status).toBe(201); // chưa relay: giỏ vẫn active
    const r = await create(t, s.u);
    expect([r.status, r.body.type]).toEqual([409, 'urn:ecom:error:cart-already-ordered']);
    expect((await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM checkout_sessions WHERE user_id = '${s.u.id}' AND status = 'open'`))[0].n).toBe(0);
  });

  it('CHK-TC-20261006-110703691 (REV-CHK-28): hết hạn hai lần (job và yêu cầu đua nhau): phiên chỉ đổi một lần, đúng một CheckoutExpired', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const row = await sessionRow(t, id);
    const first = await t.tx.run((tx) => t.sessions.expire(tx, { id, user_id: s.u.id, cart_id: row.cart_id }));
    const second = await t.tx.run((tx) => t.sessions.expire(tx, { id, user_id: s.u.id, cart_id: row.cart_id }));
    expect([first, second]).toEqual([true, false]);
    expect((await outboxOf(t, 'CheckoutExpired')).length).toBe(1);
  });

  it('CHK-TC-20261006-110702243 (REV-CHK-29): SHP quá hạn lúc ĐẶT: 503 dependency-unavailable, phiên GIỮ phương thức vận chuyển đã chọn (không bị coi là phương thức đã tắt), không đơn', async () => {
    const { s, id } = await full({ pay: 'cod' });
    t.chk.timeoutMs = 300;
    jest.spyOn(t.shp, 'quote').mockImplementation(() => new Promise((res) => setTimeout(() => res({ fee: 1, free_shipping: false }), 800)));
    const before = await tally(t);
    const r = await place(t, s.u, id, body());
    expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:dependency-unavailable']);
    expect(await tally(t)).toEqual(before);
    expect((await sessionRow(t, id)).shipping_method_id).toBe(w.sm1);
  });

  it('CHK-TC-20261006-110703759 (REV-CHK-30): đặt hàng trên phiên đã cancelled (hủy ở tab khác) hay đã expired chưa quá hạn: 409 checkout-session-closed kèm session_status, không Order, không event, không audit', async () => {
    const { s, id } = await full({ pay: 'cod' });
    for (const st of ['cancelled', 'expired']) {
      await q(t, `UPDATE checkout_sessions SET status = '${st}'::checkout_status WHERE id = '${id}'`);
      const before = await tally(t);
      const r = await place(t, s.u, id, body());
      expect([r.status, r.body.type, r.body.session_status]).toEqual([409, 'urn:ecom:error:checkout-session-closed', st]);
      expect(await tally(t)).toEqual(before);
    }
  });

  it('CHK-SEC-20261006-105800857 (REV-CHK-26): T18 (pool 2 kết nối): đặt hàng đang giữ khóa phiên và một kết nối, thao tác chọn của CÙNG khách giữ kết nối còn lại để chờ khóa: bộ chặn của CHK không bao được ca này; hậu quả được giới hạn bởi hạn 2 giây của lời gọi USR (đặt hàng 503, hoàn tác sạch, không treo, không đơn mồ côi), thao tác chọn vẫn xong', async () => {
    const p = await createChkApp({ env: { DB_POOL_MAX: '2' } });
    try {
      await resetChk(p);
      const wp = await world(p);
      const s = await shopper(p, wp);
      const sid = await ready(p, s, wp, { pay: 'cod', coupon: null });
      const real = p.chk.getAddress.bind(p.chk);
      let held!: () => void; const reached = new Promise<void>((res) => { held = res; });
      jest.spyOn(p.chk, 'getAddress').mockImplementation(async (...a) => { held(); await new Promise((r) => setTimeout(r, 600)); return real(...a); });
      const before = await tally(p);
      const t0 = Date.now();
      const placed = place(p, s.u, sid, body(380000)).then((r) => ({ r, ms: Date.now() - t0 }));
      await reached; // đặt hàng đã khóa dòng phiên, sắp cần kết nối thứ hai
      const chose = dropCoupon(p, s.u, sid); // lấy kết nối thứ hai rồi chờ khóa dòng phiên
      const [a, b] = await Promise.all([placed, chose]);
      expect(a.ms).toBeLessThan(6000); // không treo tới hạn giao dịch hay hạn pool
      expect(b.status).toBe(204);
      expect([201, 503]).toContain(a.r.status);
      if (a.r.status === 503) { expect(a.r.body.type).toBe('urn:ecom:error:dependency-unavailable'); expect(await tally(p)).toEqual(before); }
      expect((await sessionRow(p, sid)).status).toBe(a.r.status === 201 ? 'completed' : 'open');
    } finally { await p.close(); }
  }, 120_000);
});
