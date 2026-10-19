import { randomUUID } from 'node:crypto';
import { EventsService, runWithCorrelation, type EventEnvelope } from '../../src/modules/platform';
import { seedSession } from '../support/auth';
import { truncateAll } from '../support/db';
import { auditsOf, baseInput, call, countRows, createOrdApp, createPending, deliver, historyOf, insertRaw, orderOf, outboxOf, people, pgCode, q, seedOrder, who, type OrdApp, type Status } from '../support/ord';
import { reasonText } from '../../../web/lib/order';

// Thăm dò của reviewer độc lập (REV-ORD-nn trong spec/epics/ORD/review.md): ca người implement chưa nghĩ tới, giữ lại làm hồi quy. PostgreSQL thật, giao dịch song song thật.
describe('ORD ca của reviewer', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); });

  /** Giao event với payload tùy ý (kể cả rỗng, không phải đối tượng): mô phỏng bên phát sai hình dạng; relay giao lại tới hết lượt thử nếu handler ném lỗi. */
  const deliverRaw = async (type: string, payload: unknown): Promise<void> => {
    const events = t.app.get(EventsService);
    const env = { event_id: randomUUID(), type, aggregate_type: 'x', aggregate_id: randomUUID(), payload, occurred_at: new Date().toISOString(), correlation_id: 'test-corr' } as unknown as EventEnvelope;
    await runWithCorrelation(env.correlation_id, async () => { for (const sub of events.consumersFor(type)) await events.deliver(sub, env); });
  };

  it('REV-ORD-01 (hồi quy của reviewer): tìm theo mã đơn có ký tự NUL ở danh sách quản trị là 400 (không phải 500); tham số mã chứa ký tự điều khiển bị từ chối, mã bình thường vẫn tìm được', async () => {
    const { admin } = await people(t);
    const o = await seedOrder(t, { user: (await who(t, 'customer', 'c@x.vn')).id, code: '7K3M9Q2XH4TB' });
    for (const bad of ['%00', '7K3M%009Q2XH4TB', '%0A', '%1F', '%7F']) {
      const r = await call(t, 'get', `/admin/orders?code=${bad}`, { cookie: admin.cookie });
      expect([bad, r.status, r.body.type]).toEqual([bad, 400, 'urn:ecom:error:validation-failed']);
    }
    const ok = await call(t, 'get', `/admin/orders?code=${o.code.toLowerCase()}`, { cookie: admin.cookie });
    expect([ok.status, ok.body.total]).toEqual([200, 1]);
  });

  it('REV-ORD-02 (hồi quy của reviewer): createPending với ký tự NUL ở tên sản phẩm hay trường địa chỉ là lỗi nghiệp vụ invalid_input (không phải lỗi CSDL thô), không ghi dòng nào; nửa cặp thay thế lẻ và hạn ngoài miền ngày cũng vậy', async () => {
    const { a } = await people(t);
    const cases: [string, (i: any) => void][] = [
      ['NUL ở tên', (i) => { i.items[0].name_snapshot = 'a\u0000b'; }], ['NUL ở receiver', (i) => { i.shipping_address.receiver = 'a\u0000b'; }], ['NUL ở line1', (i) => { i.shipping_address.line1 = 'x\u0000'; }],
      ['nửa cặp thay thế ở tên', (i) => { i.items[0].name_snapshot = 'a\ud800b'; }], ['hạn năm 275760', (i) => { i.payment_expires_at = new Date(8.64e15); }],
    ];
    for (const [name, mut] of cases) {
      const input = baseInput(a.id); mut(input);
      const err = await createPending(t, input).then(() => null, (e) => e);
      expect([name, err?.name, err?.code]).toEqual([name, 'OrderBusinessError', 'invalid_input']);
    }
    expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'order_status_history'), await countRows(t, 'outbox_events')]).toEqual([0, 0, 0, 0]);
    expect((await createPending(t, baseInput(a.id, { shipping_address: { receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi\nTầng 3', ward: 'Bến Nghé', district: 'Quận 1', city: 'TP.HCM' } }))).code).toMatch(/^HD[0-9]{6}-[0-9]{5}$/); // xuống dòng vẫn hợp lệ; mã mới HDyymmdd-NNNNN (ORD-TC-20261015-092748827)
  });

  it('REV-ORD-03 (hồi quy của reviewer): getOrderSeries với khoảng khổng lồ theo giờ bị từ chối ngay bằng RangeError (không chạy tới hạn thời gian của câu lệnh), khoảng vừa đủ 1000 mốc vẫn chạy; khoảng ngoài miền ngày của countByStatus và getTopProducts là RangeError', async () => {
    const day = 86_400_000, hour = 3_600_000;
    const t0 = Date.now();
    await expect(t.ord.getOrderSeries({ from: new Date('0001-01-01T00:00:00Z'), to: new Date('9999-12-31T00:00:00Z') }, 'hour')).rejects.toBeInstanceOf(RangeError);
    await expect(t.ord.getOrderSeries({ from: new Date(0), to: new Date(8.64e15) }, 'month')).rejects.toBeInstanceOf(RangeError);
    await expect(t.ord.getOrderSeries({ from: new Date(0), to: new Date(1001 * hour) }, 'hour')).rejects.toBeInstanceOf(RangeError);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(await t.ord.getOrderSeries({ from: new Date(0), to: new Date(1000 * day) }, 'day')).toHaveLength(1000);
    expect(await t.ord.getOrderSeries({ from: new Date(0), to: new Date(1000 * hour) }, 'hour')).toHaveLength(1000);
    expect(await t.ord.getOrderSeries({ from: new Date('1970-01-01T00:00:00Z'), to: new Date('2026-01-01T00:00:00Z') }, 'month')).toHaveLength(672);
    await expect(t.ord.countByStatus({ from: new Date(-8.64e15), to: new Date(8.64e15) })).rejects.toBeInstanceOf(RangeError);
    await expect(t.ord.getTopProducts({ from: new Date(0), to: new Date(8.64e15) }, 'amount', 5)).rejects.toBeInstanceOf(RangeError);
  });

  it('REV-ORD-04 (hồi quy của reviewer): lý do hủy nhiều dòng (xuống dòng, tab) được nhận và hiện đủ ở lịch sử; ký tự điều khiển khác (NUL) vẫn bị từ chối 400; lý do 500 ký tự biểu tượng (2 đơn vị UTF-16) nhận, 501 bị từ chối', async () => {
    const { a, admin } = await people(t);
    const mk = (user: string) => seedOrder(t, { user, status: 'paid' });
    const o1 = await mk(a.id), o2 = await mk(a.id), o3 = await mk(a.id), o4 = await mk(a.id);
    const post = (code: string, reason: string) => call(t, 'post', `/orders/${code}/cancel`, { cookie: a.cookie, body: { reason } });
    for (const bad of ['a\u0000b', 'a\u0007b']) expect((await post(o1.code, bad)).status).toBe(400);
    expect((await post(o2.code, '😀'.repeat(501))).status).toBe(400);
    expect((await post(o3.code, '😀'.repeat(500))).status).toBe(200);
    expect((await post(o4.code, 'dòng 1\r\ndòng 2\tcột')).status).toBe(200);
    const h = await call(t, 'get', `/orders/${o4.code}/status-history`, { cookie: admin.cookie });
    expect(h.body.items.at(-1)).toMatchObject({ status: 'cancelled', reason: 'dòng 1\r\ndòng 2\tcột' });
    expect((await historyOf(t, o3.id)).at(-1)?.reason).toBe('😀'.repeat(500));
  });

  it('REV-ORD-05 (hồi quy của reviewer): event hỏng (payload rỗng, ngày ngoài miền) không ném lỗi cho relay (không giao lại tới hết lượt thử), không đổi đơn, vẫn ghi ProcessedEvent; PaymentSucceeded có paid_at ngoài miền dùng giờ ORD', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', code: '5C7D9F1G3H5J' });
    for (const payload of [null, [], 'x', { order_id: o.id, paid_at: '-000001-01-01T00:00:00Z' }, { order_id: o.id, paid_at: new Date(8.64e15).toISOString() }]) {
      await expect(deliverRaw('PaymentSucceeded', payload)).resolves.toBeUndefined();
    }
    const row = await orderOf(t, o.id);
    expect([row.status, row.payment_status]).toEqual(['paid', 'succeeded']); // hai event có order_id hợp lệ: paid_at lỗi thì dùng giờ của ORD, vẫn chuyển
    expect(row.paid_at?.toISOString()).toBe(t.clock.now().toISOString());
    expect(await countRows(t, 'processed_events', `consumer = 'order'`)).toBe(5);
    await expect(deliver(t, 'ShipmentShipped', { order_id: o.id, tracking_number: 'VN1' })).resolves.toBeUndefined();
    await expect(deliverRaw('ShipmentDelivered', null)).resolves.toBeUndefined();
  });

  it('REV-ORD-06 (hồi quy của reviewer, web): lý do là khóa của Object.prototype (__proto__, constructor, toString) hiện nguyên văn như mọi lý do khác thay vì làm vỡ hay làm trống dòng lịch sử; lý do thường và mã hệ thống đổi nhãn như cũ', () => {
    for (const r of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect([r, typeof reasonText('cancelled', r, false)]).toEqual([r, 'string']);
      expect(reasonText('cancelled', r, false)).toBe(r);
      expect(reasonText('shipped', r, true)).toBe(r);
    }
    expect(reasonText('cancelled', 'payment_failed', false)).toBe('Thanh toán thất bại');
    expect(reasonText('shipped', 'refused', true)).toBe('từ chối nhận');
    expect(reasonText('cancelled', 'đặt nhầm', false)).toBe('đặt nhầm');
    expect(reasonText('paid', 'payment_failed', false)).toBe('payment_failed');
  });

  // Máy trạng thái: mỗi event của PAY, INV, SHP trên mỗi trạng thái đơn cho đúng kết quả của bảng chuyển (ORD-DB mục Giao dịch và khóa), một event đúng khi và chỉ khi chuyển hợp lệ, giao lại bằng event_id mới không chuyển lần hai.
  const STATUSES: Status[] = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned'];
  type Ev = { type: string; payload: (o: string) => Record<string, unknown> };
  const EVENTS: Ev[] = [
    { type: 'PaymentSucceeded', payload: (o) => ({ order_id: o, payment_id: randomUUID() }) },
    { type: 'PaymentFailed', payload: (o) => ({ order_id: o, is_final: true, attempt_no: 3 }) },
    { type: 'PaymentFailed', payload: (o) => ({ order_id: o, is_final: false, attempt_no: 1 }) },
    { type: 'PaymentExpired', payload: (o) => ({ order_id: o }) },
    { type: 'PaymentRefunded', payload: (o) => ({ order_id: o }) },
    { type: 'StockReservationExpired', payload: (o) => ({ order_id: o }) },
    { type: 'StockCommitFailed', payload: (o) => ({ order_id: o, reason: 'reservation_expired' }) },
    { type: 'ShipmentShipped', payload: (o) => ({ order_id: o, shipment_id: randomUUID(), tracking_number: 'VN999' }) },
    { type: 'ShipmentTrackingChanged', payload: (o) => ({ order_id: o, shipment_id: randomUUID(), tracking_number: 'VN555' }) },
    { type: 'ShipmentDelivered', payload: (o) => ({ order_id: o, shipment_id: randomUUID() }) },
    { type: 'ShipmentFailed', payload: (o) => ({ order_id: o, shipment_id: randomUUID(), reason: 'refused' }) },
    { type: 'ShipmentReturned', payload: (o) => ({ order_id: o, shipment_id: randomUUID(), restockable: true }) },
  ];
  /** Kết quả mong đợi theo bảng chuyển: trạng thái mới, event phát, số dòng lịch sử thêm. */
  const expectNext = (status: Status, method: 'vnpay' | 'cod', ev: Ev, o: string): { status: Status; events: string[]; hist: number } => {
    const stay = { status, events: [] as string[], hist: 0 };
    const p = ev.payload(o);
    switch (ev.type) {
      case 'PaymentSucceeded': return method === 'vnpay' && status === 'pending' ? { status: 'paid', events: ['OrderPaid'], hist: 1 } : stay;
      case 'PaymentFailed': return p.is_final === true && status === 'pending' ? { status: 'cancelled', events: ['OrderCancelled'], hist: 1 } : stay;
      case 'StockReservationExpired': return status === 'pending' ? { status: 'expired', events: ['OrderExpired'], hist: 1 } : stay;
      case 'StockCommitFailed': return status === 'pending' || status === 'paid' ? { status: 'cancelled', events: ['OrderCancelled'], hist: 1 } : stay;
      case 'ShipmentShipped': return status === 'paid' || status === 'confirmed' ? { status: 'shipped', events: ['OrderShipped'], hist: 1 } : stay;
      case 'ShipmentDelivered': return status === 'shipped' ? { status: 'delivered', events: ['OrderDelivered'], hist: 1 } : stay;
      case 'ShipmentReturned': return status === 'shipped' ? { status: 'returned', events: ['OrderReturned'], hist: 1 } : stay;
      case 'ShipmentFailed': return status === 'shipped' ? { ...stay, hist: 1 } : stay;
      default: return stay;
    }
  };

  it('REV-ORD-07 (hồi quy của reviewer): ma trận 8 trạng thái x 2 phương thức x 12 event: trạng thái mới, event phát và dòng lịch sử đúng bảng chuyển; giao lại bằng event_id mới không chuyển lần hai; chuỗi lịch sử luôn liền mạch', async () => {
    const { a } = await people(t);
    const bad: string[] = [];
    for (const method of ['vnpay', 'cod'] as const) {
      for (const status of STATUSES) {
        if (status === 'confirmed' && method === 'vnpay') continue; // đơn vnpay không có confirmed (CHECK ở fixture không cấm, nhưng không có trong vòng đời)
        if (status === 'paid' && method === 'cod') continue; // COD không có paid
        for (const ev of EVENTS) {
          const o = await seedOrder(t, { user: a.id, status, method });
          const hBefore = (await historyOf(t, o.id)).length;
          const exp = expectNext(status, method, ev, o.id);
          await deliver(t, ev.type, ev.payload(o.id));
          const row = await orderOf(t, o.id);
          const types = (await outboxOf(t, o.id)).map((e) => e.type);
          const hist = (await historyOf(t, o.id)).length - hBefore;
          if (row.status !== exp.status || JSON.stringify(types) !== JSON.stringify(exp.events) || hist !== exp.hist) bad.push(`${method}/${status}/${ev.type}: got ${row.status} ${types} +${hist}; want ${exp.status} ${exp.events} +${exp.hist}`);
          // lần hai (event_id mới) trên trạng thái mới: bảng chuyển cho kết quả của trạng thái mới, không phát lại event của lần một
          const exp2 = expectNext(exp.status, method, ev, o.id);
          await deliver(t, ev.type, ev.payload(o.id));
          const types2 = (await outboxOf(t, o.id)).map((e) => e.type);
          const row2 = await orderOf(t, o.id);
          if (row2.status !== exp2.status || JSON.stringify(types2) !== JSON.stringify([...exp.events, ...exp2.events])) bad.push(`lần hai ${method}/${status}/${ev.type}: got ${row2.status} ${types2}`);
          const chain = await historyOf(t, o.id);
          for (let i = 1; i < chain.length; i++) if (chain[i].from_status !== chain[i - 1].to_status) bad.push(`chuỗi đứt ${method}/${status}/${ev.type} ở ${i}`);
          if (chain.at(-1)?.to_status !== row2.status) bad.push(`dòng cuối lịch sử khác status ${method}/${status}/${ev.type}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 300_000);

  // Hai chuyển đua nhau: khóa dòng xếp thứ tự, đúng một bên thắng, event phát khớp bên thắng, không bế tắc.
  const rounds = 12;
  const evs = async (order: string) => (await outboxOf(t, order)).map((e) => e.type).sort();
  const sessionOf = (u: { id: string }) => ({ user_id: u.id, role: 'customer' as const, email_verified: true, display_name: 'x' });

  it('REV-ORD-08 (hồi quy của reviewer): PaymentSucceeded đua StockReservationExpired trên đơn vnpay pending: đúng một trong OrderPaid hoặc OrderExpired, payment_status luôn succeeded, lịch sử hai dòng khớp status', async () => {
    const { a } = await people(t);
    const seen = new Set<string>();
    for (let i = 0; i < rounds; i++) {
      const o = await seedOrder(t, { user: a.id, status: 'pending' });
      await Promise.all([deliver(t, 'PaymentSucceeded', { order_id: o.id, payment_id: randomUUID() }), deliver(t, 'StockReservationExpired', { order_id: o.id })]);
      const row = await orderOf(t, o.id), h = await historyOf(t, o.id), e = await evs(o.id);
      seen.add(row.status);
      expect([['paid', ['OrderPaid']], ['expired', ['OrderExpired']]]).toContainEqual([row.status, e]);
      expect([row.payment_status, h.length, h.at(-1)?.to_status]).toEqual(['succeeded', 2, row.status]);
    }
  }, 120_000);

  it('REV-ORD-09 (hồi quy của reviewer): khách hủy đua PaymentSucceeded và StockCommitFailed (hai id) trên đơn vnpay pending: cuối cùng luôn cancelled, đúng một OrderCancelled (was_paid đúng với việc có OrderPaid), một audit, lịch sử không trùng chuyển', async () => {
    const { a } = await people(t);
    for (let i = 0; i < rounds; i++) {
      const o = await seedOrder(t, { user: a.id, status: 'pending' });
      await Promise.all([t.cancels.cancel(sessionOf(a) as never, o.code, 'x').catch(() => 'rejected'), deliver(t, 'PaymentSucceeded', { order_id: o.id, payment_id: randomUUID() }), deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_expired' }), deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_released' })]);
      const row = await orderOf(t, o.id), e = await outboxOf(t, o.id), h = await historyOf(t, o.id);
      expect(row.status).toBe('cancelled');
      const cancels = e.filter((x) => x.type === 'OrderCancelled');
      expect(cancels).toHaveLength(1);
      expect(cancels[0].payload.was_paid).toBe(e.some((x) => x.type === 'OrderPaid'));
      expect(await countRows(t, 'audit_logs', `target_id = '${o.id}' AND action = 'order.cancel'`)).toBe(1);
      expect(new Set(h.map((x) => x.to_status)).size).toBe(h.length);
      expect(h.at(-1)?.to_status).toBe('cancelled');
    }
  }, 120_000);

  it('REV-ORD-10 (hồi quy của reviewer): đơn paid: hủy đua lockForHandoff (SHP) và đua ShipmentShipped: lock thắng thì hủy 409 và ShipmentShipped vào được, hủy thắng thì lock lỗi not_lockable; không bao giờ vừa hủy vừa giao; mỗi đơn đúng một trong OrderCancelled hoặc OrderShipped', async () => {
    const { a } = await people(t);
    const wins = { lock: 0, cancel: 0 };
    for (let i = 0; i < rounds; i++) {
      const o = await seedOrder(t, { user: a.id, status: 'paid' });
      const [lock, cancel] = await Promise.all([
        t.tx.run((tx) => t.ord.lockForHandoff(o.id, tx)).then(() => 'locked' as const, (e) => (e as { code?: string }).code ?? 'error'),
        t.cancels.cancel(sessionOf(a) as never, o.code, undefined).then(() => 'cancelled' as const, (e) => (e as { code?: string }).code ?? (e as { name?: string }).name ?? 'error'),
      ]);
      expect([lock === 'locked', cancel === 'cancelled']).not.toEqual([true, true]);
      expect([lock === 'locked', cancel === 'cancelled']).not.toEqual([false, false]);
      if (lock === 'locked') wins.lock++; else wins.cancel++;
      await deliver(t, 'ShipmentShipped', { order_id: o.id, shipment_id: randomUUID(), tracking_number: `VN${i}` });
      const row = await orderOf(t, o.id), e = await evs(o.id);
      if (lock === 'locked') { expect(row.status).toBe('shipped'); expect(e).toEqual(['OrderShipped']); expect(row.handoff_locked_at).not.toBeNull(); }
      else { expect(row.status).toBe('cancelled'); expect(e).toEqual(['OrderCancelled']); }
    }
    expect(wins.lock + wins.cancel).toBe(rounds);
  }, 120_000);

  it('REV-ORD-11 (hồi quy của reviewer): hai yêu cầu hủy giống nhau cùng lúc của khách và admin: đúng một 200 và một 409, một OrderCancelled; bốn lời gọi song song thêm hủy hệ thống không tạo OrderCancelled thứ hai', async () => {
    const { a, admin } = await people(t);
    for (let i = 0; i < rounds; i++) {
      const o = await seedOrder(t, { user: a.id, status: i % 2 ? 'paid' : 'pending' });
      const res = await Promise.all([
        t.cancels.cancel(sessionOf(a) as never, o.code, undefined).then(() => 200, (e) => (e as { status?: number }).status ?? 0),
        t.cancels.cancel({ user_id: admin.id, role: 'admin', email_verified: true, display_name: 'ad' } as never, o.code, 'x').then(() => 200, (e) => (e as { status?: number }).status ?? 0),
        deliver(t, 'StockCommitFailed', { order_id: o.id, reason: 'reservation_missing' }).then(() => 0),
        deliver(t, 'PaymentFailed', { order_id: o.id, is_final: true }).then(() => 0),
      ]);
      expect(res.slice(0, 2).filter((s) => s === 200).length).toBeLessThanOrEqual(1);
      expect((await evs(o.id)).filter((x) => x === 'OrderCancelled')).toHaveLength(1);
      expect(await countRows(t, 'audit_logs', `target_id = '${o.id}' AND action = 'order.cancel'`)).toBe(1);
    }
  }, 120_000);

  it('REV-ORD-12 ORD-TC-20261007-182433463 (hồi quy của reviewer): thứ tự kiểm của hủy đơn: guest không Origin là 401, guest Origin lạ là 403 csrf_failed, customer thiếu Origin là 403, staff là 403 forbidden, customer đơn người khác là 404 y như đơn không có, đúng người 200; không một lần nào đổi đơn khi bị từ chối', async () => {
    const { a, b, staff, admin } = await people(t);
    const o = await seedOrder(t, { user: b.id, status: 'paid' });
    const req = (cookie: string | undefined, origin?: string | null, code = o.code) => call(t, 'post', `/orders/${code}/cancel`, { cookie, origin, body: {} });
    const out = async (r: Promise<{ status: number; body: { type?: string } }>) => { const x = await r; return [x.status, x.body.type]; };
    expect(await out(req(undefined, null))).toEqual([401, 'urn:ecom:error:unauthenticated']);
    expect(await out(req(undefined, 'https://evil.example'))).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect(await out(req(a.cookie, null))).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect(await out(req(a.cookie, 'https://evil.example'))).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect(await out(req(staff.cookie))).toEqual([403, 'urn:ecom:error:forbidden']);
    const gone = new Date(t.clock.now().getTime() - 1000), old = new Date(t.clock.now().getTime() - 3600_000);
    const expired = (await seedSession(t, a.id, { createdAt: old, lastSeenAt: old, expiresAt: gone, absoluteExpiresAt: gone })).cookie; // phiên quá hạn: Origin lạ thì 403 trước 401, Origin hợp lệ thì 401 session_expired
    expect(await out(req(expired, 'https://evil.example'))).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect(await out(req(expired))).toEqual([401, 'urn:ecom:error:session_expired']);
    const x = await req(a.cookie), y = await req(a.cookie, undefined, '9X9X9X9X9X9X');
    const strip = ({ trace_id: _t, ...r }: Record<string, unknown>) => r;
    expect([x.status, y.status, JSON.stringify(strip(x.body)) === JSON.stringify(strip(y.body))]).toEqual([404, 404, true]);
    expect((await orderOf(t, o.id)).status).toBe('paid');
    expect(await outboxOf(t, o.id)).toEqual([]);
    expect((await req(admin.cookie)).status).toBe(200);
    expect((await call(t, 'get', `/orders/${o.code}`, { cookie: a.cookie })).status).toBe(404);
  });

  // ---- Lỗ hổng test do đột biến của reviewer lộ ra (xem review.md, mục Kiểm đột biến): mỗi ca dưới đây đỏ khi gài đột biến tương ứng. ----
  const PAY = ['pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded'] as const;
  type Pay = (typeof PAY)[number];
  /** Cột Từ của bảng cho phép `payment_status` (ORD-DB mục Giao dịch và khóa 3). */
  const FROM: Record<string, readonly Pay[]> = { PaymentSucceeded: ['pending', 'processing', 'failed', 'cancelled'], PaymentFailed: ['pending', 'processing', 'failed'], PaymentExpired: ['pending', 'processing', 'failed'], PaymentRefunded: ['succeeded'] };
  const TO: Record<string, Pay> = { PaymentSucceeded: 'succeeded', PaymentFailed: 'failed', PaymentExpired: 'expired', PaymentRefunded: 'refunded' };

  it('REV-ORD-15 (hồi quy của reviewer): bảng cho phép payment_status: mỗi event của PAY từ mỗi trạng thái thanh toán chỉ đổi khi trạng thái hiện tại thuộc cột Từ, ở đơn vnpay đã giao (status không đổi); PaymentFailed không có is_final đúng true thì không hủy đơn pending', async () => {
    const { a } = await people(t);
    const bad: string[] = [];
    for (const [type, to] of Object.entries(TO)) for (const from of PAY) {
      const o = await seedOrder(t, { user: a.id, status: 'delivered', method: 'vnpay', payment: from });
      const before = t.logs.records.filter((r) => r.code === 'transition-rejected').length;
      await deliver(t, type, { order_id: o.id, payment_id: randomUUID(), is_final: false });
      const row = await orderOf(t, o.id);
      const want = FROM[type].includes(from) ? to : from;
      const logged = t.logs.records.filter((r) => r.code === 'transition-rejected').length - before;
      if (type !== 'PaymentSucceeded' && logged !== (FROM[type].includes(from) ? 0 : 1)) bad.push(`${type} từ ${from}: ${logged} log từ chối (PaymentFailed lần hai khi ORD giữ failed là bình thường, không log)`);
      if (row.payment_status !== want || row.status !== 'delivered') bad.push(`${type} từ ${from}: got ${row.payment_status}/${row.status}, want ${want}/delivered`);
    }
    expect(bad).toEqual([]);
    for (const isFinal of [undefined, 'true', 1, null, 'yes']) {
      const o = await seedOrder(t, { user: a.id, status: 'pending' });
      await deliver(t, 'PaymentFailed', { order_id: o.id, ...(isFinal === undefined ? {} : { is_final: isFinal }) });
      expect([String(isFinal), (await orderOf(t, o.id)).status, (await orderOf(t, o.id)).payment_status]).toEqual([String(isFinal), 'pending', 'failed']);
    }
  }, 120_000);

  it('REV-ORD-16 (hồi quy của reviewer): hủy đơn tự đặt payment_status theo CASE (pending, processing, failed thành cancelled; các trạng thái khác giữ nguyên); event OrderCancelled mang user_id của CHỦ ĐƠN (admin hủy cũng vậy) và was_paid theo status (COD confirmed đã ghi nhận thu vẫn false)', async () => {
    const { a, admin } = await people(t);
    for (const p of PAY) {
      const o = await seedOrder(t, { user: a.id, status: 'pending', method: 'vnpay', payment: p });
      expect((await call(t, 'post', `/orders/${o.code}/cancel`, { cookie: a.cookie, body: {} })).status).toBe(200);
      expect([p, (await orderOf(t, o.id)).payment_status]).toEqual([p, ['pending', 'processing', 'failed'].includes(p) ? 'cancelled' : p]);
    }
    const cod = await seedOrder(t, { user: a.id, status: 'confirmed', method: 'cod', payment: 'succeeded' });
    expect((await call(t, 'post', `/orders/${cod.code}/cancel`, { cookie: admin.cookie, body: { reason: 'x' } })).status).toBe(200);
    const ev = (await outboxOf(t, cod.id)).find((e) => e.type === 'OrderCancelled')!;
    expect(ev.payload).toMatchObject({ order_id: cod.id, order_code: cod.code, user_id: a.id, reason: 'admin', was_paid: false });
    expect((await auditsOf(t, cod.id))[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin' });
    const paid = await seedOrder(t, { user: a.id, status: 'paid' });
    await call(t, 'post', `/orders/${paid.code}/cancel`, { cookie: admin.cookie, body: {} });
    expect((await outboxOf(t, paid.id)).find((e) => e.type === 'OrderCancelled')!.payload).toMatchObject({ user_id: a.id, reason: 'admin', was_paid: true });
  }, 60_000);

  it('REV-ORD-17 ORD-TC-20261007-182432982 (hồi quy của reviewer): createPending bác đầu vào sai bằng invalid_input (không lỗi CSDL thô, không ghi gì): uuid sai ở user_id, product_id, shipping_method_id; chuỗi toàn khoảng trắng; số không an toàn, vượt int32, thập phân; thiếu hay thừa khóa địa chỉ', async () => {
    const { a } = await people(t);
    const cases: [string, (i: any) => void][] = [
      ['user_id không uuid', (i) => { i.user_id = 'x'; }], ['product_id không uuid', (i) => { i.items[0].product_id = 'x'; }], ['shipping_method_id không uuid', (i) => { i.shipping_method_id = 'x'; }],
      ['tên toàn khoảng trắng', (i) => { i.items[0].name_snapshot = '   '; }], ['receiver toàn khoảng trắng', (i) => { i.shipping_address.receiver = ' \t '; }], ['địa chỉ thiếu city', (i) => { delete i.shipping_address.city; }],
      ['địa chỉ thiếu district', (i) => { delete i.shipping_address.district; }], ['district không phải chuỗi hay null', (i) => { i.shipping_address.district = 5; }], ['địa chỉ thừa khóa lạ', (i) => { i.shipping_address.country = 'VN'; }], ['district nửa cặp thay thế lẻ', (i) => { i.shipping_address.district = 'a\uD83D'; }], ['line1 chứa NUL', (i) => { i.shipping_address.line1 = 'a\u0000b'; }], ['ward nửa cặp thay thế lẻ', (i) => { i.shipping_address.ward = 'a\uD83D'; }],
      ['phone dài 501 ký tự', (i) => { i.shipping_address.phone = '0'.repeat(501); }], ['địa chỉ null', (i) => { i.shipping_address = null; }], ['đơn giá không an toàn', (i) => { i.items = [{ ...i.items[0], unit_price: 2 ** 53, quantity: 1 }]; i.items_total = 2 ** 53; i.grand_total = 2 ** 53 + 30000; }],
      ['quantity vượt int32', (i) => { i.items = [{ ...i.items[0], unit_price: 1, quantity: 2 ** 31 }]; i.items_total = 2 ** 31; i.grand_total = 2 ** 31 + 30000; }], ['quantity 0', (i) => { i.items[0].quantity = 0; }], ['quantity thập phân', (i) => { i.items[0].quantity = 1.5; }], ['đơn giá âm', (i) => { i.items[0].unit_price = -1; }],
      ['phương thức lạ', (i) => { i.payment_method = 'momo'; }], ['không có dòng hàng', (i) => { i.items = []; }], ['đầu vào rỗng', (i) => { Object.keys(i).forEach((k) => delete i[k]); }],
    ];
    for (const [name, mut] of cases) {
      const input = baseInput(a.id); mut(input);
      const err = await createPending(t, input).then(() => null, (e) => e);
      expect([name, err?.name, err?.code]).toEqual([name, 'OrderBusinessError', 'invalid_input']);
    }
    for (const bad of ['x', '', null, undefined, 5]) {
      expect(await t.tx.run((tx) => t.ord.confirmCod(bad as never, tx)).then(() => 'ok', (e) => e.code)).toBe('order_not_found');
      expect(await t.tx.run((tx) => t.ord.lockForHandoff(bad as never, tx)).then(() => 'ok', (e) => e.code)).toBe('order_not_found');
    }
    expect([await countRows(t, 'orders'), await countRows(t, 'order_items'), await countRows(t, 'outbox_events')]).toEqual([0, 0, 0]);
    const ok = await createPending(t, baseInput(a.id)); // đúng năm khóa thì nhận
    expect(Object.keys((await q<{ shipping_address: object }>(t, `SELECT shipping_address FROM orders WHERE id = '${ok.order_id}'`))[0].shipping_address).sort()).toEqual(['city', 'district', 'line1', 'phone', 'receiver', 'ward']);
  });

  it('REV-ORD-18 ORD-TC-20261007-182433278 (hồi quy của reviewer): CHECK và unique của CSDL (lớp hai): tiền thành phần không âm, mã vận đơn chỉ từ shipped, cặp hủy, confirmed_at, số lượng và đơn giá dòng hàng, (order_id, position) duy nhất; xóa người dùng còn đơn bị chặn', async () => {
    const { a } = await people(t);
    expect(await pgCode(insertRaw(t, a.id, { items: 100000, discount: -50000, shipping: 30000, grand: 180000 }))).toBe('23514'); // công thức đúng, thành phần âm
    expect(await pgCode(insertRaw(t, a.id, { tracking: 'VN1', status: 'pending' }))).toBe('23514');
    expect(await pgCode(insertRaw(t, a.id, { status: 'cancelled' }))).toBe('23514'); // cancelled thiếu cặp lý do
    expect(await pgCode(insertRaw(t, a.id, { status: 'confirmed' }))).toBe('23514'); // confirmed thiếu confirmed_at
    expect(await pgCode(insertRaw(t, a.id, { status: 'pending' }))).toBe('ok');
    const o = await seedOrder(t, { user: a.id, status: 'paid' });
    const item = (qty: number, price: number, pos: number) => t.prisma.$executeRaw`INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, position) VALUES (${o.id}::uuid, ${randomUUID()}::uuid, 'x', ${price}, ${qty}, ${pos})`;
    expect(await pgCode(item(0, 1000, 9))).toBe('23514');
    expect(await pgCode(item(1, -1, 9))).toBe('23514');
    expect(await pgCode(item(1, 1000, 0))).toBe('23514');
    expect(await pgCode(item(1, 1000, 1))).toBe('23505'); // vị trí 1 đã có
    expect(await pgCode(item(1, 1000, 9))).toBe('ok');
    expect(await pgCode(t.prisma.$executeRaw`DELETE FROM users WHERE id = ${a.id}::uuid`)).toBe('23503');
  });

  it('REV-ORD-19 (hồi quy của reviewer): giao diện đọc nội bộ: mã không phân biệt hoa thường, đơn người khác không lộ, biên from của countByStatus, thống kê doanh thu và sản phẩm bán chạy chỉ tính payment_status succeeded, thứ tự theo quantity hay amount; đối số không phải uuid cho null hoặc rỗng, không ném lỗi', async () => {
    const { a, b } = await people(t);
    const [P, Q] = [randomUUID(), randomUUID()];
    const range = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') };
    const mk = (o: Parameters<typeof seedOrder>[1]) => seedOrder(t, { createdAt: new Date('2026-10-02T00:00:00Z'), method: 'cod', ...o });
    const mine = await mk({ user: a.id, status: 'delivered', code: '7K3M9Q2XH4TB', payment: 'succeeded', paidAt: new Date('2026-10-02T00:00:00Z'), items: [{ product: P, price: 10, qty: 3 }, { product: Q, price: 100, qty: 1 }] });
    await mk({ user: b.id, status: 'delivered', payment: 'succeeded', paidAt: new Date('2026-10-02T00:00:00Z'), items: [{ product: P, price: 10, qty: 1 }] });
    await mk({ user: a.id, status: 'delivered', payment: 'refunded', paidAt: new Date('2026-10-03T00:00:00Z'), items: [{ product: P, price: 10, qty: 50 }] }); // đã hoàn tiền: không tính
    await mk({ user: a.id, status: 'pending', payment: 'pending', createdAt: range.from }); // đúng mốc from: tính
    await mk({ user: a.id, status: 'pending', payment: 'pending', createdAt: range.to }); // đúng mốc to: không tính
    expect((await t.ord.findByCode('7k3m9q2xh4tb'))?.order_id).toBe(mine.id);
    expect((await t.ord.findOwned('7k3m9q2xh4tb', a.id))?.order_id).toBe(mine.id);
    expect(await t.ord.findOwned(mine.code, b.id)).toBeNull();
    const refunded = (await q<{ id: string }>(t, `SELECT id FROM orders WHERE user_id = '${a.id}' AND payment_status = 'refunded'`)).map((r) => r.id);
    expect((await t.ord.getDeliveredItems(a.id, P)).map((r) => r.order_id).sort()).toEqual([mine.id, ...refunded].sort()); // cùng delivered_at: thứ tự giữa hai đơn không xác định, chỉ kiểm tập hợp (không có đơn của b)
    expect((await t.ord.getDeliveredItems(b.id, Q))).toEqual([]);
    expect((await t.ord.countByStatus(range)).pending).toBe(1);
    const series = await t.ord.getOrderSeries(range, 'day');
    expect(series.reduce((s, r) => s + r.paid_orders, 0)).toBe(2); // hai đơn succeeded, không tính đơn refunded
    expect((await t.ord.getTopProducts(range, 'quantity', 5)).map((r) => [r.product_id, r.quantity])).toEqual([[P, 4], [Q, 1]]);
    expect((await t.ord.getTopProducts(range, 'amount', 5)).map((r) => [r.product_id, r.amount])).toEqual([[Q, 100], [P, 40]]);
    for (const bad of ['x', '', null, undefined, 5] as never[]) {
      expect([await t.ord.getSummary(bad), await t.ord.findForPayment(bad), await t.ord.findForShipment(bad), await t.ord.getRecipient(bad), await t.ord.findByCode(bad), await t.ord.findOwned(bad, a.id), await t.ord.findOwned(mine.code, bad)]).toEqual([null, null, null, null, null, null, null]);
      expect([await t.ord.countOpenOrders(bad), await t.ord.getDeliveredItems(bad, P), await t.ord.getDeliveredItems(a.id, bad)]).toEqual([{ online_pending: 0, cod_open: 0 }, [], []]);
    }
  });

  it('REV-ORD-20 ORD-TC-20261007-182433278 (hồi quy của reviewer): chi tiết đơn: dòng hàng theo position (không theo tên), returned còn mã vận đơn; lý do hủy được cắt khoảng trắng hai đầu, toàn khoảng trắng coi như không có; mã vận đơn 100 ký tự nhận, 101 bỏ; ShipmentTrackingChanged vẫn cập nhật đơn returned', async () => {
    const { a } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'returned', method: 'cod', items: [{ name: 'Zeta', price: 1000, qty: 1 }, { name: 'Alpha', price: 2000, qty: 1 }, { name: 'Mu', price: 3000, qty: 1 }] });
    const d = await call(t, 'get', `/orders/${o.code}`, { cookie: a.cookie });
    expect(d.body.items.map((i: { name: string }) => i.name)).toEqual(['Zeta', 'Alpha', 'Mu']);
    expect(d.body.tracking_number).toBe('VN123456');
    await deliver(t, 'ShipmentTrackingChanged', { order_id: o.id, shipment_id: randomUUID(), tracking_number: 'VN-MOI' });
    expect((await orderOf(t, o.id)).tracking_number).toBe('VN-MOI');
    await deliver(t, 'ShipmentTrackingChanged', { order_id: o.id, shipment_id: randomUUID(), tracking_number: 'T'.repeat(101) });
    expect((await orderOf(t, o.id)).tracking_number).toBe('VN-MOI');
    await deliver(t, 'ShipmentTrackingChanged', { order_id: o.id, shipment_id: randomUUID(), tracking_number: 'T'.repeat(100) });
    expect((await orderOf(t, o.id)).tracking_number).toBe('T'.repeat(100));
    const c1 = await seedOrder(t, { user: a.id, status: 'paid' }), c2 = await seedOrder(t, { user: a.id, status: 'paid' });
    expect((await call(t, 'post', `/orders/${c1.code}/cancel`, { cookie: a.cookie, body: { reason: '  đặt nhầm \n ' } })).status).toBe(200);
    expect((await call(t, 'post', `/orders/${c2.code}/cancel`, { cookie: a.cookie, body: { reason: '   \t ' } })).status).toBe(200);
    expect([(await historyOf(t, c1.id)).at(-1)?.reason, (await historyOf(t, c2.id)).at(-1)?.reason]).toEqual(['đặt nhầm', null]);
  });

  it('REV-ORD-21 (hồi quy của reviewer): giới hạn bậc C của từng route đọc (danh sách của mình, chi tiết, lịch sử): lần thứ 121 trong một phút là 429 kèm Retry-After, mỗi route một bộ đếm, mỗi người một bộ đếm; hủy đơn (bậc B) lần thứ 11 là 429', async () => {
    const { a, b } = await people(t);
    const o = await seedOrder(t, { user: a.id, status: 'pending', code: '7K3M9Q2XH4TB' });
    for (const path of ['/orders', `/orders/${o.code}`, `/orders/${o.code}/status-history`]) {
      for (let i = 0; i < 120; i++) { const r = await call(t, 'get', path, { cookie: a.cookie }); if (r.status !== 200) throw new Error(`${path} lần ${i + 1}: ${r.status}`); }
      const r = await call(t, 'get', path, { cookie: a.cookie });
      expect([path, r.status, r.body.type, Number(r.headers['retry-after']) > 0]).toEqual([path, 429, 'urn:ecom:error:rate-limited', true]);
    }
    expect((await call(t, 'get', '/orders', { cookie: b.cookie })).status).toBe(200); // người khác không bị chung bộ đếm
    for (let i = 0; i < 10; i++) expect((await call(t, 'post', '/orders/9X9X9X9X9X9X/cancel', { cookie: b.cookie, body: {} })).status).toBe(404);
    expect((await call(t, 'post', '/orders/9X9X9X9X9X9X/cancel', { cookie: b.cookie, body: {} })).status).toBe(429);
  }, 120_000);

  it('REV-ORD-22 (hồi quy của reviewer): 30 đơn COD tạo rồi xác nhận trong cùng giao dịch: outbox luôn là OrderCreated rồi OrderConfirmed theo (occurred_at, id) và dòng lịch sử theo seq; đột biến ghi outbox bằng now() (cùng thời điểm, uuid ngẫu nhiên) lọt khi chỉ thử một đơn (xác suất qua 1/2), 30 đơn thì 1/2^30', async () => {
    const { a } = await people(t);
    for (let i = 0; i < 30; i++) {
      const r = await t.tx.run(async (tx) => { const c = await t.ord.createPending(baseInput(a.id, { payment_method: 'cod', payment_expires_at: null }), tx); await t.ord.confirmCod(c.order_id, tx); return c; });
      expect([i, (await outboxOf(t, r.order_id)).map((e) => e.type)]).toEqual([i, ['OrderCreated', 'OrderConfirmed']]);
      expect((await historyOf(t, r.order_id)).map((h) => h.to_status)).toEqual(['pending', 'confirmed']);
    }
  }, 120_000);
});
