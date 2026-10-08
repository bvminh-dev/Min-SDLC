import { randomUUID } from 'node:crypto';
import { PlatformModule, TransactionService, type Tx } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { CatalogModule } from '../../src/modules/catalog/catalog.module';
import { InventoryApi, InventoryModule } from '../../src/modules/inventory';
import { JobsService } from '../../src/modules/inventory/jobs.service';
import { OrderApi, OrderModule } from '../../src/modules/order';
import { PromotionApi, PromotionModule } from '../../src/modules/promotion';
import { createAuthApp, q } from '../support/auth';
import { truncateAll } from '../support/db';
import { call, deliver, orderOf, outboxOf, who } from '../support/ord';
import { relay, seedStock, stockOf, reservationsOf, type InvApp } from '../support/inv';
import { couponOf, redemptionOfOrder, seedCoupon } from '../support/prm';

// Liên module thật (REV-ORD-13): ORD cùng INV, PRM trong một ứng dụng, relay outbox thật. Hủy hay hết hạn đơn nhả hàng và coupon ĐÚNG MỘT LẦN dù hủy lần hai, event giao lặp, PaymentSucceeded đến muộn.
describe('ORD với INV và PRM qua relay thật', () => {
  let t: InvApp & { ord: OrderApi; prm: PromotionApi };
  beforeAll(async () => {
    const base = await createAuthApp({ imports: [PlatformModule, AuthModule, CatalogModule, InventoryModule, PromotionModule, OrderModule], controllers: [], env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16' } });
    base.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    t = Object.assign(base, { inv: base.app.get(InventoryApi), jobs: base.app.get(JobsService), tx: base.app.get(TransactionService), cat: '', ord: base.app.get(OrderApi), prm: base.app.get(PromotionApi) }) as never;
  });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.cat = ''; t.clock.advance(61_000); });

  /** Như CHK: tạo đơn, giữ hàng và giữ coupon trong MỘT giao dịch. */
  async function place(method: 'vnpay' | 'cod', userId: string, product: string, coupon: string) {
    const expires = method === 'vnpay' ? new Date((await q<{ d: Date }>(t, `SELECT clock_timestamp() + interval '15 minutes' AS d`))[0].d) : null;
    return t.tx.run(async (tx: Tx) => {
      const o = await t.ord.createPending({
        user_id: userId, items: [{ product_id: product, name_snapshot: 'Áo thun', unit_price: 100000, quantity: 2 }], items_total: 200000, discount: 20000, shipping_fee: 30000, grand_total: 210000,
        shipping_address: { receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', city: 'TP.HCM' }, shipping_method_id: randomUUID(), payment_method: method, payment_expires_at: expires,
      }, tx);
      expect((await t.inv.reserve(o.order_id, [{ product_id: product, quantity: 2 }], expires, tx)).ok).toBe(true);
      expect((await t.prm.reserve({ order_id: o.order_id, user_id: userId, code: coupon, items_subtotal: 200000 }, tx)).ok).toBe(true);
      if (method === 'cod') await t.ord.confirmCod(o.order_id, tx);
      return o;
    });
  }
  const count = async (type: string, order: string) => (await outboxOf(t, order)).filter((e) => e.type === type).length;

  it('REV-ORD-13 (hồi quy của reviewer): khách hủy đơn vnpay pending: kho nhả và coupon nhả đúng một lần; hủy lần hai là 409; relay chạy lại và event giao lặp không nhả lần hai', async () => {
    const u = await who(t, 'customer', 'a@x.vn');
    const { product } = await seedStock(t, { on_hand: 10 });
    const c = await seedCoupon(t, { value: 10 });
    const o = await place('vnpay', u.id, product, c.code);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 10, reserved: 2 });
    expect((await couponOf(t, c.code)).reserved_count).toBe(1);
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: u.cookie, body: { reason: 'đặt nhầm' } })).status).toBe(200);
    await relay(t, 3);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 10, reserved: 0 });
    expect((await reservationsOf(t, o.order_id)).map((r) => r.status)).toEqual(['released']);
    expect([(await couponOf(t, c.code)).reserved_count, (await couponOf(t, c.code)).consumed_count, (await redemptionOfOrder(t, o.order_id)).status]).toEqual([0, 0, 'released']);
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: u.cookie, body: {} })).status).toBe(409);
    const ev = (await outboxOf(t, o.order_id)).find((e) => e.type === 'OrderCancelled')!;
    await deliver(t, 'OrderCancelled', ev.payload, ev.id); // giao lặp cùng event_id
    await deliver(t, 'OrderCancelled', ev.payload); // và event mới cùng nội dung (PAY phát lại)
    await relay(t, 2);
    expect(await count('OrderCancelled', o.order_id)).toBe(1);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 10, reserved: 0 });
    expect((await couponOf(t, c.code)).reserved_count).toBe(0);
  }, 90_000);

  it('REV-ORD-13b (hồi quy của reviewer): hết hạn giữ hàng: INV phát StockReservationExpired, ORD sang expired và phát OrderExpired, PRM nhả coupon; PaymentSucceeded đến muộn không đưa đơn về paid; nhả đúng một lần', async () => {
    const u = await who(t, 'customer', 'b@x.vn');
    const { product } = await seedStock(t, { on_hand: 10 });
    const c = await seedCoupon(t, { value: 10 });
    const o = await place('vnpay', u.id, product, c.code);
    await q(t, `UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = '${o.order_id}'`);
    expect(await t.jobs.expireOnce()).toEqual({ orders: 1, batches: 1 });
    await relay(t, 6);
    expect((await orderOf(t, o.order_id)).status).toBe('expired');
    expect(await count('OrderExpired', o.order_id)).toBe(1);
    expect([(await stockOf(t, product)).reserved, (await couponOf(t, c.code)).reserved_count, (await redemptionOfOrder(t, o.order_id)).status]).toEqual([0, 0, 'released']);
    await deliver(t, 'PaymentSucceeded', { order_id: o.order_id, payment_id: randomUUID() });
    await deliver(t, 'StockCommitFailed', { order_id: o.order_id, reason: 'reservation_expired' });
    await relay(t, 2);
    expect(await orderOf(t, o.order_id)).toMatchObject({ status: 'expired', payment_status: 'succeeded' });
    expect(await count('OrderCancelled', o.order_id)).toBe(0);
    expect(await expireTwice()).toEqual({ orders: 0, batches: 0 });
    async function expireTwice() { return t.jobs.expireOnce(); }
  }, 90_000);

  it('REV-ORD-13c (hồi quy của reviewer): đơn COD xác nhận: INV chốt kho và PRM tiêu thụ coupon tại OrderConfirmed; admin hủy đơn confirmed hoàn kho (on_hand về 10) và hoàn lượt coupon đã tiêu thụ đúng một lần', async () => {
    const u = await who(t, 'customer', 'c@x.vn'), admin = await who(t, 'admin', 'ad@x.vn');
    const { product } = await seedStock(t, { on_hand: 10 });
    const c = await seedCoupon(t, { value: 10 });
    const o = await place('cod', u.id, product, c.code);
    await relay(t, 3);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 8, reserved: 0 });
    expect([(await couponOf(t, c.code)).consumed_count, (await couponOf(t, c.code)).reserved_count]).toEqual([1, 0]);
    expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: admin.cookie, body: {} })).status).toBe(200);
    await relay(t, 3);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 10, reserved: 0 });
    expect([(await couponOf(t, c.code)).consumed_count, (await redemptionOfOrder(t, o.order_id)).status]).toEqual([0, 'released']);
    await relay(t, 2);
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 10, reserved: 0 });
    expect(await count('OrderConfirmed', o.order_id)).toBe(1);
    expect(await count('OrderCancelled', o.order_id)).toBe(1);
  }, 90_000);
});
