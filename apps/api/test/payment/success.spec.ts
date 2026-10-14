import { spawn } from 'node:child_process';
import { truncateAll, API_DIR, testDbUrl } from '../support/db';
import {
  attemptsOf, collect, countOf, createPayApp, deliver, drain, failingInsert, ipn, ipnQuery, MINUTE, ORIGIN, orderRow, payAudits, payOutbox, payRow, people, q, race, refundsOf, seedPayment, SECRET, snapshot, TMN, type PayApp,
} from '../support/pay';
import { EventsService, OutboxRelay } from '../../src/modules/platform';
import { PaymentCore } from '../../src/modules/payment/core.service';
import { TRANSITIONS } from '../../src/modules/payment/config';

// Ghi nhận thanh toán thành công (PAY-REQ-20261006-103110597): online (webhook, đối soát), COD tự động (OrderDelivered) và ghi nhận tay của staff, admin; đúng một PaymentSucceeded.
describe('PAY ghi nhận thanh toán thành công', () => {
  let t: PayApp;
  let p: Awaited<ReturnType<typeof people>>;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); }); // nhả lời gọi cổng đang treo để afterAll không kẹt khi một khẳng định đỏ giữa chừng
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.gw.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); p = await people(t); });
  const delivered = (o: { id: string; code: string; user: string }, at = new Date(), eventId?: string) => deliver(t, 'OrderDelivered', { order_id: o.id, order_code: o.code, user_id: o.user, delivered_at: at.toISOString() }, eventId);

  it('PAY-TC-20261006-104539326 (SB-27): webhook thành công đưa Payment online sang succeeded và phát đúng một PaymentSucceeded ghi cùng giao dịch (lỗi ghi outbox thì Payment không đổi); sau relay đơn sang paid', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const ref = pay.attempts[0].txnRef;
    // outbox lỗi: cả giao dịch rollback (không có Payment succeeded thiếu OutboxEvent), cổng nhận 99 để gọi lại
    const bad = await failingInsert(t, 'outbox_events', () => ipn(t, ipnQuery({ txnRef: ref, amount: 350000 })));
    expect(bad.body.RspCode).toBe('99');
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', paid_at: null });
    expect((await attemptsOf(t, pay.id))[0].status).toBe('processing');
    expect(await countOf(t, 'payment_webhook_logs')).toBe(0); // nhật ký cùng giao dịch cũng rollback
    expect(await payOutbox(t)).toEqual([]);
    const now = t.clock.now();
    expect((await ipn(t, ipnQuery({ txnRef: ref, amount: 350000, txNo: '14012345' }))).body.RspCode).toBe('00'); // cổng gọi lại
    const row = await payRow(t, pay.id);
    expect(row).toMatchObject({ status: 'succeeded', provider_ref: '14012345', version: 1 });
    expect(row.paid_at?.toISOString()).toBe(now.toISOString());
    const ev = await payOutbox(t);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'PaymentSucceeded', aggregate_type: 'payment', aggregate_id: pay.id, dispatched_at: null });
    expect(ev[0].payload).toEqual({ payment_id: pay.id, order_id: pay.order.id, order_code: pay.order.code, user_id: p.a.id, amount: 350000, method: 'vnpay', paid_at: now.toISOString() });
    expect((await orderRow(t, pay.order.id)).status).toBe('pending');
    await drain(t);
    expect(await orderRow(t, pay.order.id)).toMatchObject({ status: 'paid', payment_status: 'succeeded' });
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1); // đúng một lần
  });

  it('PAY-TC-20261006-104539326 (bẫy đột biến, SB-27): ghi event PaymentSucceeded lỗi thì cả giao dịch rollback (RspCode 99, Payment và lượt thử giữ nguyên, không có event), không nuốt lỗi', async () => {
    const pay = await seedPayment(t, { status: 'processing', attemptNo: 1, attempts: 'auto' });
    jest.spyOn(t.app.get(EventsService), 'publish').mockRejectedValueOnce(new Error('outbox hỏng'));
    const r = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, txNo: '14055001' }));
    expect([r.status, r.body.RspCode]).toEqual([200, '99']);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing', provider_ref: null, paid_at: null });
    expect((await attemptsOf(t, pay.id))[0].status).toBe('processing');
    expect(await payOutbox(t, 'PaymentSucceeded')).toEqual([]);
  });

  it('PAY-TC-20261006-104539164 (bẫy đột biến, SB-24): `PaymentCore.move` không chuyển từ trạng thái ngoài bảng TRANSITIONS: trả null, Payment và outbox không đổi (không dựa vào trigger của CSDL)', async () => {
    const core = t.app.get(PaymentCore);
    const all = ['pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded'] as const;
    for (const status of all) {
      const pay = await seedPayment(t, { status, attemptNo: status === 'pending' ? 0 : 1, attempts: status === 'pending' ? [] : 'auto' });
      for (const [name, tr] of Object.entries(TRANSITIONS)) {
        if ((tr.from as readonly string[]).includes(status)) continue;
        const moved = await t.tx.run(async (tx) => { const row = await core.lockById(tx, pay.id); return core.move(tx, row!, name as keyof typeof TRANSITIONS); });
        expect([status, name, moved]).toEqual([status, name, null]);
      }
      expect((await payRow(t, pay.id)).status).toBe(status);
    }
    expect(await payOutbox(t)).toEqual([]);
  });

  it('PAY-TC-20261006-104539358: staff ghi nhận tay thu COD khi OrderDelivered chưa được xử lý: succeeded, một PaymentSucceeded, audit có staff và ghi chú; OrderDelivered tới sau thì bỏ qua', async () => {
    const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const r = await collect(t, p.staff.cookie, pay.id, { collected_amount: 180000, note: 'phiếu GHN-778' });
    expect([r.status, r.body.status, r.body.payment_id]).toEqual([200, 'succeeded', pay.id]);
    const row = await payRow(t, pay.id);
    expect(row).toMatchObject({ status: 'succeeded', provider_ref: null });
    expect(r.body.paid_at).toBe(row.paid_at?.toISOString());
    const ev = await payOutbox(t, 'PaymentSucceeded');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ payment_id: pay.id, order_id: pay.order.id, amount: 180000, method: 'cod' });
    const a = await payAudits(t, pay.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: p.staff.id, actor_role: 'staff', action: 'payment.cod.collect', target_type: 'payment', reason: 'phiếu GHN-778' });
    expect(a[0].after).toMatchObject({ amount: 180000, note: 'phiếu GHN-778' });
    await delivered(pay.order); // handler thấy Payment đã succeeded: bỏ qua
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect(await payAudits(t, pay.id)).toHaveLength(1);
    expect((await payRow(t, pay.id)).paid_at).toEqual(row.paid_at);
  });

  it('PAY-TC-20261006-104539390 (T7, SB-05, SB-07): customer 403 và guest 401 không ghi nhận được thu COD; staff ghi nhận Payment online thì 409 payment-not-cod; không PaymentSucceeded, không audit', async () => {
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const online = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto', orderStatus: 'delivered' });
    const before = await snapshot(t);
    const c = await collect(t, p.a.cookie, cod.id, { collected_amount: 180000 }), g = await collect(t, undefined, cod.id, { collected_amount: 180000 }), s = await collect(t, p.staff.cookie, online.id, { collected_amount: 350000 });
    expect([c.status, g.status, s.status]).toEqual([403, 401, 409]);
    expect(s.body.type).toBe('urn:ecom:error:payment-not-cod');
    expect(await payRow(t, cod.id)).toMatchObject({ status: 'pending' });
    expect(await payRow(t, online.id)).toMatchObject({ status: 'processing' });
    expect(await snapshot(t)).toEqual(before);
  });

  it('PAY-TC-20261006-104539422: thu COD khi đơn chưa giao (409 order-not-delivered), sai số tiền (422 amount-mismatch), dữ liệu sai kiểu hoặc ghi chú 201 ký tự (400); Payment vẫn pending, không event, không audit', async () => {
    const shipped = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'shipped' });
    const ok = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const before = await snapshot(t);
    const r1 = await collect(t, p.staff.cookie, shipped.id, { collected_amount: 180000 });
    const r2 = await collect(t, p.staff.cookie, ok.id, { collected_amount: 170000 });
    expect([r1.status, r1.body.type]).toEqual([409, 'urn:ecom:error:order-not-delivered']);
    expect([r2.status, r2.body.type]).toEqual([422, 'urn:ecom:error:amount-mismatch']);
    const bads: unknown[] = [{ collected_amount: -1 }, { collected_amount: 180000.5 }, { collected_amount: '180000' }, { collected_amount: 0 }, { collected_amount: null }, {}, { collected_amount: 180000, note: 'x'.repeat(201) },
      { collected_amount: 180000, note: '' }, { collected_amount: 180000, note: 'a\u0000b' }, { collected_amount: 180000, status: 'succeeded' }, { collected_amount: 180000, amount: 1 }];
    for (const body of bads) { const r = await collect(t, p.staff.cookie, ok.id, JSON.stringify(body)); expect([JSON.stringify(body), r.status, r.body.type]).toEqual([JSON.stringify(body), 400, 'urn:ecom:error:validation-failed']); }
    const huge = await collect(t, p.staff.cookie, ok.id, '{"collected_amount":99999999999999999999999}'); // vượt số nguyên an toàn của JSON: không bao giờ khớp số tiền
    expect([422, 400]).toContain(huge.status);
    const edge = await collect(t, p.staff.cookie, ok.id, { collected_amount: 180000, note: 'x'.repeat(200) });
    expect(edge.status).toBe(200); // ghi chú đúng 200 ký tự được chấp nhận
    expect(before.slice(0, 3)).toEqual([2, 0, 0]);
    expect((await payAudits(t)).length).toBe(1);
  });

  it('PAY-TC-20261006-104539456: ghi nhận thu COD lần hai bị từ chối 409 payment-already-succeeded; vẫn một PaymentSucceeded, paid_at không đổi', async () => {
    const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    expect((await collect(t, p.staff.cookie, pay.id, { collected_amount: 180000 })).status).toBe(200);
    const paid = (await payRow(t, pay.id)).paid_at;
    t.clock.advance(5 * MINUTE);
    const again = await collect(t, p.admin.cookie, pay.id, { collected_amount: 180000 });
    expect([again.status, again.body.type]).toEqual([409, 'urn:ecom:error:payment-already-succeeded']);
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect((await payRow(t, pay.id)).paid_at).toEqual(paid);
    expect(await payAudits(t, pay.id)).toHaveLength(1);
  });

  it('PAY-TC-20261006-104539456 (bẫy đột biến, SB-24): thu COD cho Payment COD đã đóng (cancelled, expired) dù đơn ở trạng thái delivered bị từ chối 409 order-not-delivered, không PaymentSucceeded', async () => {
    for (const status of ['cancelled', 'expired'] as const) {
      const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status, orderStatus: 'delivered' });
      const r = await collect(t, p.staff.cookie, pay.id, { collected_amount: 180000 });
      expect([status, r.status, r.body.type]).toEqual([status, 409, 'urn:ecom:error:order-not-delivered']);
      expect((await payRow(t, pay.id)).status).toBe(status);
    }
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(0);
  });

  it('PAY-TC-20261006-104539489 (T4, SB-24): hai nhân viên ghi nhận thu COD cùng lúc, chạy chồng với handler OrderDelivered (20 vòng): đúng một bên thắng, đúng một PaymentSucceeded và một bản ghi audit', async () => {
    for (let i = 0; i < 20; i++) {
      const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
      const body = { collected_amount: 180000 };
      const [[a, b], d] = await Promise.all([race(() => collect(t, p.staff.cookie, pay.id, body), () => collect(t, p.admin.cookie, pay.id, body)), race(() => delivered(pay.order).then(() => 'ok'), () => Promise.resolve('x')).then(([x]) => x)]);
      const manual = [a.status, b.status].sort();
      if (manual[0] === 200) expect(manual).toEqual([200, 409]); else expect(manual).toEqual([409, 409]); // handler thắng thì cả hai lần ghi nhận tay 409
      expect(d).toBe('ok');
      expect((await payOutbox(t, 'PaymentSucceeded')).filter((e) => e.payload.payment_id === pay.id)).toHaveLength(1);
      expect(await payAudits(t, pay.id)).toHaveLength(1);
      expect((await payRow(t, pay.id)).status).toBe('succeeded');
    }
  }, 120_000);

  it('PAY-TC-20261006-104539522: webhook thành công về cho Payment đã failed do timeout khi đơn còn pending: failed sang succeeded, một PaymentSucceeded, không Refund', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'failed', attemptNo: 1, attempts: [{ no: 1, status: 'failed', reason: 'timeout' }] });
    const r = await ipn(t, ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, txNo: '14012777' }));
    expect(r.body.RspCode).toBe('00');
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded', provider_ref: '14012777' });
    expect((await attemptsOf(t, pay.id))[0]).toMatchObject({ status: 'succeeded', reason: null, provider_txn_no: '14012777' });
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect(await refundsOf(t, pay.id)).toEqual([]);
  });

  it('PAY-TC-20261006-113000100: OrderDelivered thu tiền COD tự động: Payment succeeded (không qua processing, không lượt thử), paid_at = delivered_at, một PaymentSucceeded, audit system, ProcessedEvent', async () => {
    const pay = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const at = new Date(t.clock.now().getTime() - 3600_000);
    const eid = '11111111-1111-4111-8111-111111111111';
    await delivered(pay.order, at, eid);
    const row = await payRow(t, pay.id);
    expect(row).toMatchObject({ status: 'succeeded', provider_ref: null, version: 1 });
    expect(row.paid_at?.toISOString()).toBe(at.toISOString());
    expect(await attemptsOf(t, pay.id)).toEqual([]);
    const ev = await payOutbox(t);
    expect(ev.map((e) => e.type)).toEqual(['PaymentSucceeded']);
    expect(ev[0].payload).toEqual({ payment_id: pay.id, order_id: pay.order.id, order_code: pay.order.code, user_id: p.a.id, amount: 180000, method: 'cod', paid_at: at.toISOString() });
    expect(await payAudits(t, pay.id)).toMatchObject([{ actor_id: null, actor_role: 'system', action: 'payment.cod.collect', target_type: 'payment', after: { amount: 180000 } }]);
    expect(await countOf(t, 'processed_events', `consumer = 'payment' AND event_id = '${eid}'`)).toBe(1);
    // ORD đã giao: PaymentSucceeded của COD chỉ cập nhật payment_status của đơn (đơn không đổi trạng thái)
    await drain(t);
    expect(await orderRow(t, pay.order.id)).toMatchObject({ status: 'delivered', payment_status: 'succeeded' });
  });

  it('PAY-TC-20261006-113000200: OrderDelivered lặp hoặc không áp dụng (online, đã đóng) thì không đổi gì: một PaymentSucceeded, một audit, paid_at cũ; mỗi lần bỏ qua có log thông tin', async () => {
    const cod = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'pending', orderStatus: 'delivered' });
    const online = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const closed = await seedPayment(t, { user: p.a.id, method: 'cod', status: 'cancelled', orderStatus: 'cancelled' });
    const onlinePending = await seedPayment(t, { user: p.a.id, status: 'pending' }); // online chưa bắt đầu: OrderDelivered không phải việc của nó
    const eid = '22222222-2222-4222-8222-222222222222';
    await delivered(cod.order, new Date(), eid);
    const paid = (await payRow(t, cod.id)).paid_at;
    t.logs.clear();
    await delivered(cod.order, new Date(Date.now() + 99_999), eid); // cùng event_id: ProcessedEvent chặn
    await delivered(cod.order, new Date(Date.now() + 99_999)); // khác event_id: trạng thái chặn
    await delivered(online.order);
    await delivered(closed.order);
    await delivered(onlinePending.order);
    expect(await payRow(t, onlinePending.id)).toMatchObject({ status: 'pending' });
    expect((await payRow(t, cod.id)).paid_at).toEqual(paid);
    expect(await payOutbox(t, 'PaymentSucceeded')).toHaveLength(1);
    expect(await payAudits(t)).toHaveLength(1);
    expect(await payRow(t, online.id)).toMatchObject({ status: 'processing' });
    expect(await payRow(t, closed.id)).toMatchObject({ status: 'cancelled' });
    const skips = t.logs.records.filter((r) => r.code === 'payment-not-collectable' && r.level === 'info');
    expect(skips.map((r) => r.order_code).sort()).toEqual([cod.order.code, online.order.code, closed.order.code, onlinePending.order.code].sort());
    await expect(deliver(t, 'OrderDelivered', { order_id: '00000000-0000-4000-8000-000000000000' })).resolves.toBeUndefined(); // đơn không có Payment: bỏ qua có cảnh báo
    expect(t.logs.records.some((r) => r.level === 'warn' && r.code === 'payment-none')).toBe(true);
  });

  it('PAY-TC-20261006-113000250 (SB-27, T15): tiến trình bị SIGKILL ngay sau commit thì Payment succeeded và PaymentSucceeded vẫn nằm trong outbox, được giao sau khởi động lại (ORD sang paid); giao lặp cùng event_id không đổi thêm gì; lỗi trước commit thì không có cả hai', async () => {
    const pay = await seedPayment(t, { user: p.a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const query = ipnQuery({ txnRef: pay.attempts[0].txnRef, amount: 350000, txNo: '14012888' });
    const child = (arg: string, env: Record<string, string> = {}) => new Promise<{ code: number | null; signal: string | null; out: string }>((res) => {
      const c = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/pay-then-die.ts', arg], {
        cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN, VNPAY_TMN_CODE: TMN, VNPAY_HASH_SECRET: SECRET, VNPAY_RETURN_URL: 'https://shop.example/orders/{order_code}/payment', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('exit', (code, signal) => res({ code, signal, out }));
    });
    // dừng TRƯỚC commit: giao dịch rollback nên không có cả Payment succeeded lẫn OutboxEvent; cổng gọi lại IPN
    await failingInsert(t, 'outbox_events', async () => { expect((await ipn(t, query)).body.RspCode).toBe('99'); });
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'processing' });
    expect(await payOutbox(t)).toEqual([]);
    const died = await child(JSON.stringify(query));
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'succeeded', provider_ref: '14012888' }); // commit đã xong trước khi chết
    const rows = await payOutbox(t);
    expect(rows.map((r) => [r.type, r.dispatched_at])).toEqual([['PaymentSucceeded', null]]); // cùng giao dịch: không có succeeded mà thiếu OutboxEvent
    const relay = t.app.get(OutboxRelay);
    await relay.runOnce(new Date(Date.now() + 1000)); // khởi động lại: relay giao; consumer ORD thật đặt đơn sang paid
    expect(await orderRow(t, pay.order.id)).toMatchObject({ status: 'paid', payment_status: 'succeeded' });
    expect((await payOutbox(t))[0].dispatched_at).not.toBeNull();
    const hist = await countOf(t, 'order_status_history', `order_id = '${pay.order.id}' AND to_status = 'paid'`);
    // chết sau khi giao mà trước khi đánh dấu dispatched_at: giao lại cùng event_id
    await t.prisma.$executeRaw`UPDATE outbox_events SET dispatched_at = NULL, next_attempt_at = now() WHERE id = ${rows[0].id}::uuid`;
    await relay.runOnce(new Date(Date.now() + 5000));
    expect(await countOf(t, 'order_status_history', `order_id = '${pay.order.id}' AND to_status = 'paid'`)).toBe(hist); // consumer chống trùng theo event_id
    expect(await countOf(t, 'processed_events', `consumer = 'order' AND event_id = '${rows[0].id}'`)).toBe(1);
    // không Payment succeeded nào thiếu PaymentSucceeded tương ứng
    expect(await q(t, `SELECT p.id FROM payments p LEFT JOIN outbox_events o ON o.aggregate_id = p.id::text AND o.type = 'PaymentSucceeded' WHERE p.status = 'succeeded' AND o.id IS NULL`)).toEqual([]);
  }, 120_000);
});
