import { alignWindow, call, createChkApp, noTrace, placeShown, q, ready, relayAll, resetChk, shopper, world, type ChkApp, type World } from '../support/chk';
import { BlockCache } from '../../src/modules/dashboard/cache.service';
import { RefundService } from '../../src/modules/payment/refund.service';
import { initiate, ipn, ipnQuery, payOfOrder, refund, who } from '../support/pay';

// Luồng THẬT (không fixture đơn, thanh toán): CHK đặt hàng, PAY nhận IPN ký đúng của cổng giả và hoàn tiền qua cổng giả, ORD cập nhật qua event, rồi dashboard của admin khớp từng con số
// (DSH-REQ-20261006-105125714, DSH-REQ-20261006-105125811, DSH-REQ-20261006-105126458, DSH-SEC-20261006-105535103 T5). Ứng dụng THẬT (AppModule), PostgreSQL thật, cổng VNPay là FakeGateway.
describe('DSH luồng thật: đặt hàng, thanh toán, hoàn tiền rồi xem dashboard (DSH-SEC-20261006-105535103 T5)', () => {
  let t: ChkApp;
  let w: World;
  beforeAll(async () => { t = await createChkApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await resetChk(t); w = await world(t); alignWindow(t); });
  const admin = () => who(t, 'admin', 'admin@shop.vn');

  /** Đặt một đơn qua CHK (P1 x 2 + P2 x 1 = 350000 + vận chuyển 30000 = 380000, không mã giảm giá). */
  const place = async (pay: 'vnpay' | 'cod', email: string) => {
    const s = await shopper(t, w, { email });
    const id = await ready(t, s, w, { pay, coupon: null });
    const r = await placeShown(t, s, id);
    expect(r.status).toBe(201);
    await relayAll(t);
    const orderId = (await q<{ id: string }>(t, `SELECT id FROM orders WHERE code = '${r.body.order.code}'`))[0].id;
    return { s, code: r.body.order.code as string, orderId };
  };
  const pay = async (o: { s: { u: { cookie: string } }; orderId: string }) => {
    const row = await payOfOrder(t, o.orderId);
    const init = await initiate(t, o.s.u.cookie, row.id);
    expect(init.status).toBe(200);
    const ref = (await q<{ txn_ref: string }>(t, `SELECT txn_ref FROM payment_attempts WHERE payment_id = '${row.id}' ORDER BY attempt_no DESC LIMIT 1`))[0].txn_ref;
    expect((await ipn(t, ipnQuery({ txnRef: ref, amount: 380000, txNo: String(14_000_000 + Math.floor(Math.random() * 999_999)) }))).body.RspCode).toBe('00');
    await relayAll(t);
    return row.id;
  };

  it('DSH-SEC-20261006-105535103 T5: hai đơn VNPay (một đơn hoàn tiền thủ công), một đơn COD chưa thu, một đơn VNPay chưa trả: doanh thu, đơn, sản phẩm, khách, đơn gần đây khớp', async () => {
    const o1 = await place('vnpay', 'a@shop.vn');
    const o2 = await place('vnpay', 'b@shop.vn');
    await place('cod', 'c@shop.vn');
    await place('vnpay', 'd@shop.vn');
    await pay(o1);
    const p2 = await pay(o2);
    const a = await admin();
    const before = await call(t, 'get', '/admin/dashboard/revenue', { cookie: a.cookie });
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ gross: 760000, refunded: 0, net: 760000, payment_count: 2, failed_refund_count: 0 });
    expect((await refund(t, a.cookie, p2, 'Khách trả hàng lỗi, đã nhận lại')).status).toBeLessThan(300);
    await t.app.get(RefundService).idle(); // PAY trả 202 rồi gọi cổng giả sau commit: chờ lệnh hoàn xong
    await relayAll(t);
    t.app.get(BlockCache).clear(); // sau khi PAY hoàn tiền: bỏ đệm 60 giây của lần xem trước
    const rev = await call(t, 'get', '/admin/dashboard/revenue', { cookie: a.cookie });
    expect(noTrace(rev.body)).toMatchObject({ gross: 760000, refunded: 380000, net: 380000, payment_count: 2, failed_refund_count: 0 });
    const net = await q<{ s: string }>(t, `SELECT sum(amount)::text AS s FROM payments WHERE status = 'succeeded'`);
    expect(Number(net[0].s)).toBe(rev.body.net); // bất biến BR3: net toàn thời gian bằng tổng Payment succeeded (chỉ đơn 1)
    const ord = await call(t, 'get', '/admin/dashboard/orders', { cookie: a.cookie });
    expect(ord.body).toMatchObject({ total: 4, effective: 4, by_status: { pending: 1, confirmed: 1, paid: 2, shipped: 0, delivered: 0, returned: 0, cancelled: 0, expired: 0 } });
    const rep = await call(t, 'get', '/admin/reports/revenue', { cookie: a.cookie });
    expect(rep.body.totals).toEqual({ gross: 760000, refunded: 380000, net: 380000, payment_count: 2 });
    expect(rep.body.by_method.vnpay.net + rep.body.by_method.cod.net).toBe(rep.body.totals.net);
    expect(rep.body.buckets.reduce((s: number, b: { net: number }) => s + b.net, 0)).toBe(380000);
    const prods = await call(t, 'get', '/admin/reports/products', { cookie: a.cookie });
    expect(prods.body.items.map((i: { product_id: string; units_sold: number; items_amount: number }) => [i.product_id, i.units_sold, i.items_amount])).toEqual([[w.p1, 2, 300000], [w.p2, 1, 50000]]); // chỉ đơn 1: đơn đã hoàn tiền (refunded) không tính
    expect(prods.body.items.map((i: { name: string }) => i.name)).toEqual(['Áo thun cotton', 'Tất cổ cao']);
    const cus = await call(t, 'get', '/admin/dashboard/customers', { cookie: a.cookie });
    expect(cus.body).toMatchObject({ total: 4, locked: 0, new_in_range: 4 });
    const recent = await call(t, 'get', '/admin/dashboard/recent-orders', { cookie: a.cookie });
    expect(recent.body.items).toHaveLength(4);
    expect(recent.body.items.map((i: { payment_method: string }) => i.payment_method).sort()).toEqual(['cod', 'vnpay', 'vnpay', 'vnpay']);
    expect(recent.body.items.every((i: { grand_total: number }) => i.grand_total === 380000)).toBe(true);
    expect(JSON.stringify(recent.body)).not.toMatch(/@shop\.vn|Nguyễn An|0901111111|Nguyễn Huệ/);
    const low = await call(t, 'get', '/admin/dashboard/low-stock', { cookie: a.cookie });
    expect(low.body.count).toBe(1); // 4 đơn giữ 8 áo thun trong kho 10: còn 2 <= ngưỡng 5; tất cổ cao còn 6
    expect(low.body.items[0]).toMatchObject({ product_id: w.p1, name: 'Áo thun cotton', available: 2 });
    const pr = await call(t, 'get', '/admin/dashboard/products', { cookie: a.cookie });
    expect(pr.body).toMatchObject({ total: 2, by_status: { active: 2, draft: 0, archived: 0 } });
  });
});
