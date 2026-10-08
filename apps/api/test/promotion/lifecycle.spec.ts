import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { type EventEnvelope } from '../../src/modules/platform';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';
import { ORIGIN } from '../support/app';
import { actor, call, cancelled, confirmed, countOf, couponOf, createPrmApp, deliver, eventsOf, expiredOrder, paid, q, redemptionOfOrder, relay, reserve, rid, seedCoupon, seedRedemption, snapshotTables, type PrmApp } from '../support/prm';

// Vòng đời lượt coupon theo event (PRM-REQ-20261006-101036470): tiêu thụ ở OrderConfirmed và PaymentSucceeded, nhả ở OrderCancelled và OrderExpired, idempotent theo event_id (ProcessedEvent) và theo trạng thái lượt.
// ORD, PAY chưa có code nên event dựng theo đúng phong bì và payload của spec/domain/events.md; consumer của PRM là consumer thật đăng ký qua outbox.
describe('PRM tiêu thụ và nhả lượt theo event', () => {
  let t: PrmApp;
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });
  const counts = async (code: string) => { const c = await couponOf(t, code); return [c.consumed_count, c.reserved_count, c.status]; };
  const warns = () => t.logs.records.filter((r) => r.level === 'warn');

  it('PRM-TC-20261006-101938311: giữ lượt rồi PaymentSucceeded: reserved amount 30000 rồi consumed (consumed_at có giá trị, reserved 0, consumed 1), đúng một CouponRedeemed {coupon_id, order_id, amount} cùng giao dịch; amount lấy từ lượt, không từ payload của event', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10' });
    const order = rid(), user = rid();
    expect(await reserve(t, { code: 'SALE10', order_id: order, user_id: user, items_subtotal: 300000 })).toMatchObject({ ok: true, amount: 30000 });
    expect([(await redemptionOfOrder(t, order)).status, (await redemptionOfOrder(t, order)).amount, ...(await counts('SALE10'))]).toEqual(['reserved', '30000', 0, 1, 'active']);
    await deliver(t, 'PaymentSucceeded', { ...paid(order, user), amount: 999 }); // 270000 trong thực tế: cố ý sai để thấy PRM không dùng nó
    const r = await redemptionOfOrder(t, order);
    expect([r.status, r.consumed_at !== null, r.amount, ...(await counts('SALE10'))]).toEqual(['consumed', true, '30000', 1, 0, 'active']);
    const ev = await eventsOf(t, 'CouponRedeemed');
    expect(ev).toHaveLength(1);
    expect([ev[0].payload, ev[0].aggregate_id]).toEqual([{ coupon_id: id, order_id: order, amount: 30000 }, r.id]);
  });

  it('PRM-TC-20261006-101938352: nhả lượt khi đơn hết hạn hoặc bị hủy (OrderExpired, OrderCancelled customer_request, payment_failed): ba lượt released, reserved 0, consumed không đổi, không CouponRedeemed; CheckoutExpired không có handler', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', reserved: 3 });
    const [a, b, c] = [await seedRedemption(t, id), await seedRedemption(t, id), await seedRedemption(t, id)];
    await deliver(t, 'OrderExpired', expiredOrder(a.order));
    await deliver(t, 'OrderCancelled', cancelled(b.order, { reason: 'customer_request' }));
    await deliver(t, 'OrderCancelled', cancelled(c.order, { reason: 'payment_failed' }));
    for (const o of [a, b, c]) { const r = await redemptionOfOrder(t, o.order); expect([r.status, r.released_at !== null]).toEqual(['released', true]); }
    expect(await counts('SALE10')).toEqual([0, 0, 'active']);
    await deliver(t, 'OrderExpired', expiredOrder(a.order)); // event khác event_id cho lượt đã nhả: bỏ qua theo trạng thái lượt, không trả hai lần
    await deliver(t, 'OrderCancelled', cancelled(b.order));
    expect(await counts('SALE10')).toEqual([0, 0, 'active']);
    expect(await eventsOf(t)).toHaveLength(0);
    // CheckoutExpired {checkout_id, user_id, cart_id} không có consumer của PRM (V-11): phiên chưa có Order nên chưa có lượt
    const before = await snapshotTables(t);
    expect(t.events.consumersFor('CheckoutExpired').filter((s) => s.consumer === 'promotion')).toHaveLength(0);
    await deliver(t, 'CheckoutExpired', { checkout_id: rid(), user_id: rid(), cart_id: rid() });
    expect(await snapshotTables(t)).toBe(before);
    expect(['OrderReturned', 'ShipmentReturned', 'ShipmentFailed', 'OrderDelivered', 'OrderPaid'].flatMap((e) => t.events.consumersFor(e).filter((s) => s.consumer === 'promotion'))).toHaveLength(0); // PRM chỉ nhận bốn event
  });

  it('PRM-TC-20261006-101938390: PaymentSucceeded về trễ sau khi lượt đã released bị bỏ qua: lượt vẫn released, consumed không đổi, không CouponRedeemed, một dòng log cảnh báo nêu order_id và lý do, handler không ném lỗi', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', consumed: 3, usageLimit: 10 });
    const red = await seedRedemption(t, id, { status: 'released' });
    await deliver(t, 'PaymentSucceeded', paid(red.order, red.user));
    expect([(await redemptionOfOrder(t, red.order)).status, ...(await counts('SALE10'))]).toEqual(['released', 3, 0, 'active']);
    expect(await eventsOf(t, 'CouponRedeemed')).toHaveLength(0);
    const w = warns().filter((r) => r.order_id === red.order);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ event_type: 'PaymentSucceeded', reason: expect.stringContaining('released') });
    expect(JSON.stringify(w[0])).not.toContain('"amount"'); // không ghi payload
  });

  it('PRM-TC-20261006-101938430: event của đơn không dùng coupon bị bỏ qua (PaymentSucceeded, OrderConfirmed, OrderCancelled, OrderExpired): không lỗi, hai bảng không đổi, không event; payload sai hình dạng bị bỏ qua có log, không đoán', async () => {
    await seedCoupon(t, { code: 'SALE10', reserved: 1 });
    const before = await snapshotTables(t);
    const order = rid();
    for (const [type, payload] of [['PaymentSucceeded', paid(order)], ['OrderConfirmed', confirmed(order)], ['OrderCancelled', cancelled(order)], ['OrderExpired', expiredOrder(order)]] as const) await deliver(t, type, payload);
    for (const type of ['PaymentSucceeded', 'OrderConfirmed', 'OrderCancelled', 'OrderExpired']) { await deliver(t, type, {}); await deliver(t, type, { order_id: 'not-a-uuid' }); await deliver(t, type, { order_id: 5 }); }
    expect(await snapshotTables(t)).toBe(before);
    expect(await eventsOf(t)).toHaveLength(0);
    expect(t.logs.records.filter((r) => String(r.msg ?? r.message).includes('bỏ qua event của coupon')).length).toBeGreaterThanOrEqual(16);
  });

  it('PRM-TC-20261006-101938512: PaymentSucceeded giao hai lần liên tiếp, một lần song song và một event khác event_id cho cùng đơn: consumed_count 1, đúng một CouponRedeemed', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', reserved: 1 });
    const red = await seedRedemption(t, id, { amount: 30000 });
    const same = rid();
    await deliver(t, 'PaymentSucceeded', paid(red.order, red.user), same);
    await deliver(t, 'PaymentSucceeded', paid(red.order, red.user), same);
    await Promise.all([deliver(t, 'PaymentSucceeded', paid(red.order, red.user), same), deliver(t, 'PaymentSucceeded', paid(red.order, red.user), same)]);
    await deliver(t, 'PaymentSucceeded', paid(red.order, red.user), rid()); // event khác, cùng đơn: bỏ qua theo trạng thái lượt
    expect(await counts('SALE10')).toEqual([1, 0, 'active']);
    expect((await redemptionOfOrder(t, red.order)).status).toBe('consumed');
    expect(await eventsOf(t, 'CouponRedeemed')).toHaveLength(1);
    expect(await countOf(t, 'processed_events', `consumer = 'promotion'`)).toBe(2); // event_id đầu và event khác
  });

  it('PRM-TC-20261006-101938552: đơn đã thanh toán bị hủy trước khi giao trả lượt consumed (consumed_count 0, consumed_at giữ, released_at có); stock_commit_failed do hệ thống cũng trả; giao lại cùng event_id không giảm lần hai; không CouponRedeemed mới', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', consumed: 2, usageLimit: 100 });
    const [a, b] = [await seedRedemption(t, id, { status: 'consumed' }), await seedRedemption(t, id, { status: 'consumed' })];
    const eid = rid();
    await deliver(t, 'OrderCancelled', cancelled(a.order, { reason: 'customer_request', was_paid: true }), eid);
    const r = await redemptionOfOrder(t, a.order);
    expect([r.status, r.consumed_at !== null, r.released_at !== null, ...(await counts('SALE10'))]).toEqual(['released', true, true, 1, 0, 'active']);
    await deliver(t, 'OrderCancelled', cancelled(a.order, { reason: 'customer_request', was_paid: true }), eid); // giao lại cùng event_id
    expect((await counts('SALE10'))[0]).toBe(1);
    await deliver(t, 'OrderCancelled', cancelled(b.order, { reason: 'stock_commit_failed', was_paid: true })); // PRM không đọc reason
    expect(await counts('SALE10')).toEqual([0, 0, 'active']);
    expect(await eventsOf(t)).toHaveLength(0);
  });

  it('PRM-TC-20261006-101938589: PaymentSucceeded và OrderCancelled đến đồng thời (100 lần, cả hai thứ tự cam kết): lượt luôn kết thúc released, hai đếm về 0, không quá một CouponRedeemed, đếm khớp số dòng, không bế tắc', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', usageLimit: 100 });
    const dead = async () => Number((await q<{ d: string }>(t, `SELECT deadlocks::text AS d FROM pg_stat_database WHERE datname = current_database()`))[0].d);
    const d0 = await dead();
    const outcomes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      for (const sql of ['DELETE FROM coupon_redemptions', 'DELETE FROM outbox_events', 'DELETE FROM processed_events', "UPDATE coupons SET reserved_count = 0, consumed_count = 0, status = 'active'"]) await q(t, sql);
      const red = await seedRedemption(t, id, { status: 'reserved' });
      await q(t, `UPDATE coupons SET reserved_count = 1 WHERE id = '${id}'`);
      const order = red.order;
      await Promise.all(i % 2 ? [deliver(t, 'PaymentSucceeded', paid(order, red.user)), deliver(t, 'OrderCancelled', cancelled(order, { was_paid: true }))] : [deliver(t, 'OrderCancelled', cancelled(order, { was_paid: true })), deliver(t, 'PaymentSucceeded', paid(order, red.user))]);
      const r = await redemptionOfOrder(t, order);
      expect([i, r.status]).toEqual([i, 'released']);
      expect([i, ...(await counts('SALE10'))]).toEqual([i, 0, 0, 'active']);
      const n = (await eventsOf(t, 'CouponRedeemed')).length;
      expect([i, n <= 1]).toEqual([i, true]);
      outcomes.add(String(n));
      const sums = (await q<{ c: number; r: number }>(t, `SELECT count(*) FILTER (WHERE status = 'consumed')::int AS c, count(*) FILTER (WHERE status = 'reserved')::int AS r FROM coupon_redemptions`))[0];
      expect([i, sums.c, sums.r]).toEqual([i, 0, 0]);
    }
    expect([...outcomes].sort()).toEqual(['0', '1']); // quan sát được cả hai kết cục (hủy thắng trước, thanh toán thắng trước)
    expect(await dead()).toBe(d0); // không bế tắc (thứ tự khóa: lượt trước, coupon sau)
  }, 120_000);

  it('PRM-TC-20261006-101938628: đơn COD tiêu thụ lượt ngay ở OrderConfirmed (consumed, CouponRedeemed đúng một lần); thu tiền lúc giao (OrderDelivered, PaymentSucceeded cod) không đổi gì và có log bỏ qua; OrderConfirmed giao lại cùng event_id không tiêu thụ lần hai', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10' });
    const order = rid(), user = rid(), eid = rid();
    await reserve(t, { code: 'SALE10', order_id: order, user_id: user });
    await deliver(t, 'OrderConfirmed', confirmed(order, user), eid);
    const r = await redemptionOfOrder(t, order);
    expect([r.status, r.consumed_at !== null, ...(await counts('SALE10'))]).toEqual(['consumed', true, 1, 0, 'active']);
    expect((await eventsOf(t, 'CouponRedeemed')).map((e) => e.payload)).toEqual([{ coupon_id: id, order_id: order, amount: 30000 }]);
    await t.jobs.expireOnce(); // ba ngày sau: job hết hạn chạy, không đụng lượt đã tiêu thụ
    t.logs.clear();
    await deliver(t, 'PaymentSucceeded', { ...paid(order, user), method: 'cod' });
    expect([(await redemptionOfOrder(t, order)).status, ...(await counts('SALE10'))]).toEqual(['consumed', 1, 0, 'active']);
    expect(await eventsOf(t, 'CouponRedeemed')).toHaveLength(1);
    expect(t.logs.records.some((l) => l.order_id === order && String(l.reason).includes('consumed'))).toBe(true);
    await deliver(t, 'OrderConfirmed', confirmed(order, user), eid);
    expect([(await counts('SALE10'))[0], (await eventsOf(t, 'CouponRedeemed')).length]).toEqual([1, 1]);
  });

  it('PRM-TC-20261006-101938666: nhả lượt của coupon đã bị xóa mềm: lượt released, reserved giảm 1, coupon vẫn deleted, không lỗi', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', reserved: 1, status: 'deleted' });
    const red = await seedRedemption(t, id);
    await deliver(t, 'OrderCancelled', cancelled(red.order));
    expect([(await redemptionOfOrder(t, red.order)).status, ...(await counts('SALE10'))]).toEqual(['released', 0, 0, 'deleted']);
  });

  it('PRM-TC-20261006-113100101: hủy đơn COD đã xác nhận trả lượt và đưa coupon hết lượt về active (cùng giao dịch); evaluate và reserve của khách khác thành công; giao lại không giảm lần hai; coupon deleted giữ deleted nhưng consumed vẫn giảm', async () => {
    const { id } = await seedCoupon(t, { code: 'FLASH1', usageLimit: 2, consumed: 2, status: 'exhausted' });
    const [o11, o12] = [await seedRedemption(t, id, { status: 'consumed' }), await seedRedemption(t, id, { status: 'consumed' })];
    const eid = rid();
    await deliver(t, 'OrderCancelled', cancelled(o11.order, { reason: 'customer_request', was_paid: false }), eid);
    expect(await counts('FLASH1')).toEqual([1, 0, 'active']);
    expect(await t.prm.evaluate({ code: 'FLASH1', user_id: rid(), items_subtotal: 300000 })).toMatchObject({ ok: true });
    expect(await reserve(t, { code: 'FLASH1' })).toMatchObject({ ok: true });
    expect(await counts('FLASH1')).toEqual([1, 1, 'active']);
    await deliver(t, 'OrderCancelled', cancelled(o11.order, {}), eid);
    expect((await counts('FLASH1'))[0]).toBe(1);
    expect(await eventsOf(t, 'CouponRedeemed')).toHaveLength(0);
    await q(t, `UPDATE coupons SET status = 'deleted', deleted_at = now() WHERE id = '${id}'`);
    await deliver(t, 'OrderCancelled', cancelled(o12.order));
    expect(await counts('FLASH1')).toEqual([0, 1, 'deleted']);
  });

  it('PRM-TC-20261006-113100202: đơn đã giao hoặc hoàn về không trả lượt: PRM không có handler cho OrderDelivered, ShipmentFailed, ShipmentReturned và OrderReturned; hai lượt vẫn consumed, consumed_count vẫn 2', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', consumed: 2 });
    const [o14, o15] = [await seedRedemption(t, id, { status: 'consumed' }), await seedRedemption(t, id, { status: 'consumed' })];
    const before = await snapshotTables(t);
    await deliver(t, 'OrderDelivered', { order_id: o14.order, order_code: 'ORD-14', user_id: o14.user });
    await deliver(t, 'ShipmentFailed', { order_id: o15.order, shipment_id: rid() });
    await deliver(t, 'ShipmentReturned', { order_id: o15.order, shipment_id: rid(), restockable: true });
    await deliver(t, 'OrderReturned', { order_id: o15.order, order_code: 'ORD-15', user_id: o15.user });
    expect(await snapshotTables(t)).toBe(before);
    expect(await counts('SALE10')).toEqual([2, 0, 'active']);
    expect((await redemptionOfOrder(t, o14.order)).status + (await redemptionOfOrder(t, o15.order)).status).toBe('consumedconsumed');
  });

  it('PRM-TC-20261006-113100404: giết tiến trình (SIGKILL thật) ngay sau cam kết tiêu thụ thì CouponRedeemed vẫn nằm trong outbox (đúng một dòng, chưa phát) và relay giao ít nhất một lần với event_id cố định; PaymentSucceeded giao lại cùng event_id không tiêu thụ lần hai', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', reserved: 1 });
    const red = await seedRedemption(t, id, { amount: 30000 });
    const eid = randomUUID();
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/prm-then-die.ts', 'consume', red.order, eid], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const [code, signal] = await new Promise<[number | null, string | null]>((r) => child.on('exit', (c, s) => r([c, s])));
    expect([code, signal, out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect([(await redemptionOfOrder(t, red.order)).status, ...(await counts('SALE10'))]).toEqual(['consumed', 1, 0, 'active']); // commit đã xong trước khi chết
    const rows = await q<{ id: string; payload: any; dispatched_at: Date | null }>(t, `SELECT id, payload, dispatched_at FROM outbox_events WHERE type = 'CouponRedeemed'`);
    expect(rows.map((r) => [r.payload, r.dispatched_at])).toEqual([[{ coupon_id: id, order_id: red.order, amount: 30000 }, null]]);
    const got: EventEnvelope[] = [], handler = async (_tx: unknown, e: EventEnvelope) => { got.push(e); };
    t.events.subscribe('sink-redeemed', 'CouponRedeemed', handler);
    await relay(t); // khởi động lại: relay chạy, kể cả chạy lặp
    expect(got.map((e) => e.event_id)).toEqual([rows[0].id]);
    await deliver(t, 'PaymentSucceeded', { ...paid(red.order, red.user), payment_id: eid }, eid); // PAY giao lại cùng event_id
    expect([(await counts('SALE10'))[0], (await eventsOf(t, 'CouponRedeemed')).length]).toEqual([1, 1]);
  }, 90_000);

  it('PRM-TC-20261006-130100606: OrderCancelled stock_commit_failed do hệ thống trả lượt consumed của đơn paid: released, consumed 0, FLASH1 về active, không CouponRedeemed mới; cùng event_id giao lại thì bỏ qua nhờ ProcessedEvent', async () => {
    const { id } = await seedCoupon(t, { code: 'FLASH1', usageLimit: 1, consumed: 1, status: 'exhausted' });
    const red = await seedRedemption(t, id, { status: 'consumed', amount: 30000 });
    const eid = rid();
    await deliver(t, 'OrderCancelled', cancelled(red.order, { reason: 'stock_commit_failed', was_paid: true }), eid);
    const r = await redemptionOfOrder(t, red.order);
    expect([r.status, r.consumed_at !== null, r.released_at !== null, ...(await counts('FLASH1'))]).toEqual(['released', true, true, 0, 0, 'active']);
    await deliver(t, 'OrderCancelled', cancelled(red.order, { reason: 'stock_commit_failed', was_paid: true }), eid);
    expect([...(await counts('FLASH1')), (await eventsOf(t, 'CouponRedeemed')).length]).toEqual([0, 0, 'active', 0]);
    expect(await countOf(t, 'processed_events', `consumer = 'promotion' AND event_id = '${eid}'`)).toBe(1);
  });

  it('PRM-DB-20261006-101036519 mục 5 và 6 (test tải hỗn hợp): 60 đơn chạy lẫn giữ, xác nhận, hủy, hết hạn, sửa và tắt/bật song song: mọi bất biến của sổ đúng (đếm bằng số dòng lượt, consumed + reserved <= usage_limit, không bế tắc), job đối soát không báo lệch', async () => {
    const { id } = await seedCoupon(t, { code: 'MIXED10', usageLimit: 40, perUser: 3 });
    const dead = async () => Number((await q<{ d: string }>(t, `SELECT deadlocks::text AS d FROM pg_stat_database WHERE datname = current_database()`))[0].d);
    const d0 = await dead();
    const users = Array.from({ length: 12 }, () => rid());
    const orders = Array.from({ length: 60 }, (_v, i) => ({ order: rid(), user: users[i % users.length] }));
    const live = new Map<string, boolean>();
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const ops = orders.map(async (o, i) => {
      const r = await reserve(t, { code: 'MIXED10', order_id: o.order, user_id: o.user });
      if (!r.ok) return;
      live.set(o.order, true);
      await new Promise((res) => setTimeout(res, rnd(15)));
      const pick = i % 5;
      if (pick === 0) await deliver(t, 'OrderConfirmed', confirmed(o.order, o.user));
      else if (pick === 1) { await deliver(t, 'PaymentSucceeded', paid(o.order, o.user)); if (i % 2) await deliver(t, 'OrderCancelled', cancelled(o.order, { was_paid: true })); }
      else if (pick === 2) await Promise.all([deliver(t, 'OrderCancelled', cancelled(o.order)), deliver(t, 'PaymentSucceeded', paid(o.order, o.user))]);
      else if (pick === 3) await deliver(t, 'OrderExpired', expiredOrder(o.order));
    });
    const boss = await actor(t, 'admin');
    const admin = (async () => { // tắt, bật và sửa coupon qua API thật trong lúc đó (khóa dòng coupon chung với reserve và handler); 409 invalid_transition là bình thường
      for (let k = 0; k < 6; k++) {
        await call(t, 'post', `/admin/coupons/${id}/disable`, { cookie: boss.cookie }); await new Promise((res) => setTimeout(res, rnd(10)));
        await call(t, 'post', `/admin/coupons/${id}/enable`, { cookie: boss.cookie });
        const cur = (await call(t, 'get', `/admin/coupons/${id}`, { cookie: boss.cookie })).body;
        await call(t, 'patch', `/admin/coupons/${id}`, { cookie: boss.cookie, body: { version: cur.version, value: 10 + k } });
      }
    })();
    await Promise.all([...ops, admin, t.jobs.expireOnce(), t.jobs.reconcileOnce()]);
    const c = await couponOf(t, 'MIXED10');
    const sums = (await q<{ c: number; r: number }>(t, `SELECT count(*) FILTER (WHERE status = 'consumed')::int AS c, count(*) FILTER (WHERE status = 'reserved')::int AS r FROM coupon_redemptions`))[0];
    expect([c.consumed_count, c.reserved_count]).toEqual([sums.c, sums.r]); // sổ khớp bộ đếm
    expect(c.consumed_count + c.reserved_count).toBeLessThanOrEqual(c.usage_limit);
    expect((await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM (SELECT user_id FROM coupon_redemptions WHERE status IN ('reserved','consumed') GROUP BY user_id HAVING count(*) > 3) x`))[0].n).toBe(0); // per_user_limit không bị vượt
    expect(await dead()).toBe(d0);
    t.logs.clear();
    expect(await t.jobs.reconcileOnce()).toEqual({ mismatched: 0 });
    expect(t.logs.records.filter((r) => r.level === 'error')).toHaveLength(0);
    expect((await eventsOf(t, 'CouponRedeemed')).length).toBe(sums.c + (await countOf(t, 'coupon_redemptions', `status = 'released' AND consumed_at IS NOT NULL`)));
    expect(live.size).toBeGreaterThan(10);
  }, 120_000);

  it('PRM-TC-20261007-144433185 (PRM-DB-20261006-101036519 mục 8, job đối soát): bộ đếm lệch số dòng lượt thì chỉ ghi log error kèm coupon_id, KHÔNG tự sửa; bộ đếm khớp thì không log; trần số dòng báo mỗi lần chạy', async () => {
    const ok = await seedCoupon(t, { code: 'RECON1', usageLimit: 5, consumed: 1, reserved: 1 });
    await seedRedemption(t, ok.id, { status: 'consumed' }); await seedRedemption(t, ok.id, { status: 'reserved' });
    expect(await t.jobs.reconcileOnce()).toEqual({ mismatched: 0 });
    expect(t.logs.records.filter((r) => r.level === 'error')).toHaveLength(0);
    const bad = await seedCoupon(t, { code: 'RECON2', usageLimit: 5, consumed: 3, reserved: 0 }); // không có dòng lượt nào
    expect(await t.jobs.reconcileOnce()).toEqual({ mismatched: 1 });
    const errs = t.logs.records.filter((r) => r.level === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ coupon_id: bad.id, consumed_count: 3, consumed: 0 });
    expect(await counts('RECON2')).toEqual([3, 0, 'active']); // không tự sửa
  });
});
