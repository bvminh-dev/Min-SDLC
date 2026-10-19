import { randomUUID } from 'node:crypto';
import { CODE, OID, count, createNtfApp, emit, logsOf, mailsOf, mkUser, notesOf, q, truncateAll, type NtfApp, type NtfUser } from '../support/ntf';

// Thông báo cho customer theo loại event: đơn tạo và xác nhận (NTF-REQ-20261006-103208641), thanh toán thành công (-103208725), vận chuyển (-103208812), đã giao (-103208902),
// thanh toán thất bại, hủy, hết hạn, hoàn tiền (-103208992). PostgreSQL thật, AUTH thật, bộ chuyển thư giả; so khớp chuỗi đúng từng ký tự.
describe('NTF thông báo theo loại event', () => {
  let t: NtfApp;
  let u1: NtfUser;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); jest.restoreAllMocks();
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    u1 = await mkUser(t, { email: 'u1@shop.vn' });
  });
  const created = (extra: Record<string, unknown> = {}) => ({ order_id: OID, order_code: CODE, user_id: u1.id, grand_total: 350000, payment_method: 'cod', payment_expires_at: null, ...extra });
  const shipped = (extra: Record<string, unknown> = {}) => ({ order_id: OID, order_code: CODE, user_id: u1.id, tracking_number: 'VTP12345678', ...extra });
  const base = (extra: Record<string, unknown> = {}) => ({ order_id: OID, order_code: CODE, user_id: u1.id, ...extra });
  const bodies = async () => (await notesOf(t, u1.id)).map((n) => n.body);
  const sendAll = () => t.email.sendDue({ now: new Date(Date.now() + 5000) });
  /** Chuỗi có mặt ở bất kỳ nơi nào người dùng hay nhân viên thấy được: thông báo, dữ liệu email, thân thư gửi SES, log. */
  async function seen(needle: string | RegExp): Promise<boolean> {
    const hay = [JSON.stringify(await q(t, 'SELECT * FROM notifications')), JSON.stringify(await q(t, 'SELECT * FROM email_deliveries')), JSON.stringify(t.mail.calls.map((c) => c.msg)), t.logs.lines.join('\n')].join('\n');
    return typeof needle === 'string' ? hay.includes(needle) : needle.test(hay);
  }
  const countLevel = (level: 'warn' | 'error') => t.logs.records.filter((r) => r.level === level).length;

  // ---- NTF-REQ-20261006-103208641
  it('NTF-TC-20261006-104223757: đơn COD tạo thông báo có mã đơn, liên kết trỏ tới đơn, dữ liệu chỉ có order_id, không nhắc hạn; email đi qua job với cùng nội dung', async () => {
    await emit(t, 'OrderCreated', created({ items: [{ product_id: randomUUID(), quantity: 1 }] }));
    await sendAll();
    const [n] = await notesOf(t, u1.id);
    expect(n).toMatchObject({ type: 'order_created', title: 'Đã nhận đơn hàng', body: 'Đơn #7K3M9Q2XH4TB đã được tạo. Tổng tiền 350.000 đ.', link: '/orders/7K3M9Q2XH4TB', data: { order_id: OID } });
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'order_created', delivery_status: 'sent' }]);
    expect(t.mail.msgs[0].subject).toBe('Đã nhận đơn hàng');
    expect(t.mail.msgs[0].text).toContain('350.000 đ');
    expect(t.mail.msgs[0].text).toContain('https://shop.example/orders/7K3M9Q2XH4TB');
    expect(n.body).not.toContain('Vui lòng thanh toán trước');
  });

  it('NTF-TC-20261006-104223817 (K-01): đơn online nhắc hạn thanh toán lấy nguyên từ payment_expires_at (giờ Việt Nam); các ca hạn đã qua, sai dạng, COD có hạn bỏ câu nhắc; order_code thiếu hoặc sai dùng câu chung', async () => {
    t.clock.set(new Date('2026-10-06T10:00:00Z')); // fixed-clock: ví dụ của TC cố định 10:00Z; prepare đọc Clock (đã giả) nên mọi nguồn thời gian của ca này là đồng hồ giả
    const expected = 'Đơn #7K3M9Q2XH4TB đã được tạo. Tổng tiền 350.000 đ. Vui lòng thanh toán trước 06/10/2026 17:15 (giờ Việt Nam).';
    await emit(t, 'OrderCreated', created({ payment_method: 'vnpay', payment_expires_at: '2026-10-06T10:15:00Z' })); // fixed-clock: ví dụ của TC, prepare đọc Clock đã giả
    const [n] = await notesOf(t, u1.id);
    expect([n.body, n.link]).toEqual([expected, '/orders/7K3M9Q2XH4TB']);
    await t.email.sendDue({ now: new Date('2026-10-06T10:01:00Z') }); // fixed-clock: cùng mốc của TC
    expect(t.mail.msgs[0].text).toContain('Vui lòng thanh toán trước 06/10/2026 17:15 (giờ Việt Nam).');
    expect(countLevel('warn')).toBe(0);
    for (const [extra, warns] of [[{ payment_method: 'vnpay', payment_expires_at: '2026-10-06T09:59:00Z' }, 1], [{ payment_method: 'vnpay', payment_expires_at: 'không phải ngày' }, 1], [{ payment_method: 'cod', payment_expires_at: '2026-10-06T10:15:00Z' }, 0], [{ payment_method: 'vnpay', payment_expires_at: null }, 1]] as const) { // fixed-clock: ví dụ của TC, prepare đọc Clock đã giả
      t.logs.clear();
      await emit(t, 'OrderCreated', created(extra));
      const last = (await notesOf(t, u1.id)).at(-1)!;
      expect(last.body).toBe('Đơn #7K3M9Q2XH4TB đã được tạo. Tổng tiền 350.000 đ.');
      expect(countLevel('warn')).toBe(warns);
      expect(await seen('không phải ngày')).toBe(false); // không ghi giá trị
    }
    for (const code of [undefined, 'abc']) {
      t.logs.clear();
      await emit(t, 'OrderCreated', created({ order_code: code }));
      const last = (await notesOf(t, u1.id)).at(-1)!;
      expect([last.body, last.link]).toEqual(['Đơn hàng của bạn đã được tạo. Tổng tiền 350.000 đ.', '/orders']);
      expect(countLevel('warn')).toBe(1);
    }
    expect(await seen(/\babc\b/)).toBe(false); // `\b`: log chứa uuid ngẫu nhiên (event_id, correlation_id) có thể chứa chuỗi `abc` thập lục phân nên tìm chuỗi trần đỏ chập chờn (REV-REV-13)
  });

  it('NTF-TC-20261006-104223876: OrderConfirmed của đơn COD chỉ tạo thông báo trong ứng dụng (không email)', async () => {
    const before = await count(t, 'notifications');
    await emit(t, 'OrderConfirmed', { order_id: OID, order_code: '8N4P0R3YJ5UC', user_id: u1.id, confirmed_at: new Date().toISOString() });
    expect(await count(t, 'notifications')).toBe(before + 1);
    expect((await notesOf(t, u1.id))[0]).toMatchObject({ type: 'order_confirmed', title: 'Đơn hàng đã được xác nhận', body: 'Đơn hàng của bạn đã được xác nhận và sẽ sớm được chuẩn bị giao.', link: '/orders/8N4P0R3YJ5UC' });
    expect(await count(t, 'email_deliveries')).toBe(0);
  });

  it('NTF-TC-20261006-104223940: grand_total không hợp lệ (-1, số thực, chuỗi, null, thiếu) làm event bị bỏ qua: không dòng nào, đúng 1 log error có order_id, không email hay họ tên, handler không ném', async () => {
    const cases: Record<string, unknown>[] = [{ grand_total: -1 }, { grand_total: 350000.5 }, { grand_total: '350000' }, { grand_total: null }, { grand_total: undefined }];
    for (const extra of cases) {
      await truncateAll(t.prisma); t.logs.clear(); u1 = await mkUser(t, { email: 'u1@shop.vn', name: 'Họ Tên Thật' });
      await expect(emit(t, 'OrderCreated', created(extra))).resolves.toBeTruthy();
      expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
      const errs = t.logs.records.filter((r) => r.level === 'error');
      expect(errs).toHaveLength(1);
      expect(errs[0]).toMatchObject({ order_id: OID, correlation_id: 'test-corr', event_type: 'OrderCreated' });
      expect(countLevel('warn')).toBe(0);
      expect(await seen(/@|Họ Tên Thật/)).toBe(false);
    }
  });

  it('NTF-TC-20261006-104224006: số tiền 0, 1.000.000.000 và 2.147.483.648 hiển thị đủ (không ký hiệu khoa học, không tràn 32 bit)', async () => {
    for (const amount of [0, 1_000_000_000, 2_147_483_648]) await emit(t, 'OrderCreated', created({ grand_total: amount }));
    expect((await bodies()).map((b) => b.replace(/^.*Tổng tiền /, ''))).toEqual(['0 đ.', '1.000.000.000 đ.', '2.147.483.648 đ.']);
  });

  it('NTF-TC-20261006-104224069: đơn COD sinh hai thông báo (order_created rồi order_confirmed) nhưng đúng một email; SES nhận đúng 1 yêu cầu', async () => {
    await emit(t, 'OrderCreated', created());
    await new Promise((r) => setTimeout(r, 30));
    await emit(t, 'OrderConfirmed', base({ confirmed_at: new Date().toISOString() }));
    expect((await notesOf(t, u1.id)).map((n) => n.type)).toEqual(['order_created', 'order_confirmed']);
    expect((await mailsOf(t, u1.id)).map((m) => m.type)).toEqual(['order_created']);
    await sendAll();
    expect(t.mail.calls).toHaveLength(1);
  });

  // ---- NTF-REQ-20261006-103208725
  it('NTF-TC-20261006-104224135: PaymentSucceeded tạo thông báo và email với mã đơn; khóa tự nhiên payment_succeeded:<payment_id>; COD và order_code thiếu', async () => {
    const p1 = randomUUID();
    const pay = (extra: Record<string, unknown> = {}) => ({ payment_id: p1, order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, method: 'vnpay', paid_at: new Date().toISOString(), ...extra });
    await emit(t, 'PaymentSucceeded', pay());
    expect((await notesOf(t, u1.id))[0]).toMatchObject({ type: 'payment_succeeded', title: 'Thanh toán thành công', body: 'Chúng tôi đã nhận 350.000 đ cho đơn #7K3M9Q2XH4TB.', link: '/orders/7K3M9Q2XH4TB', dedupe_key: `payment_succeeded:${p1}` });
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'payment_succeeded', delivery_status: 'pending', dedupe_key: `payment_succeeded:${p1}` }]);
    const p2 = randomUUID();
    await emit(t, 'PaymentSucceeded', pay({ payment_id: p2, method: 'cod', order_code: undefined }));
    expect((await notesOf(t, u1.id)).at(-1)).toMatchObject({ body: 'Chúng tôi đã nhận 350.000 đ cho đơn hàng của bạn.', link: '/orders' });
  });

  it('NTF-TC-20261006-104224202: amount không hợp lệ (0, âm, chuỗi, số thực, thiếu) làm event bị bỏ qua, đúng 1 log error nêu payment_id', async () => {
    for (const amount of [0, -50000, '350000', 350000.5, undefined]) {
      t.logs.clear();
      const p = randomUUID();
      await emit(t, 'PaymentSucceeded', { payment_id: p, order_id: OID, order_code: CODE, user_id: u1.id, amount, method: 'vnpay' });
      expect(t.logs.records.filter((r) => r.level === 'error')).toMatchObject([{ payment_id: p, event_type: 'PaymentSucceeded' }]);
    }
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([0, 0]);
  });

  it('NTF-TC-20261006-104224270: PaymentSucceeded của cùng payment_id đến lại với event_id khác vẫn đúng một thông báo và một email (khóa tự nhiên)', async () => {
    const p1 = randomUUID();
    const pay = { payment_id: p1, order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, method: 'vnpay' };
    await emit(t, 'PaymentSucceeded', pay, randomUUID());
    await emit(t, 'PaymentSucceeded', pay, randomUUID());
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([1, 1]);
    expect(await count(t, 'processed_events')).toBe(2); // ProcessedEvent không chặn (event_id khác): khóa tự nhiên là lớp thứ hai
  });

  it('NTF-TC-20261006-104224334 (V-13): NTF không có handler cho OrderPaid (tổng thông báo của đơn vẫn 1); PaymentSucceeded amount 1 hiển thị "1 đ"', async () => {
    expect(t.evts.consumersFor('OrderPaid').filter((s) => s.consumer === 'NTF')).toEqual([]);
    await emit(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, method: 'vnpay' });
    await emit(t, 'OrderPaid', { order_id: OID, paid_at: new Date().toISOString() });
    expect(await count(t, 'notifications', `data ->> 'order_id' = '${OID}'`)).toBe(1);
    expect(await count(t, 'email_deliveries')).toBe(1);
    await truncateAll(t.prisma); u1 = await mkUser(t);
    await emit(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 1, method: 'vnpay' });
    expect(await bodies()).toEqual(['Chúng tôi đã nhận 1 đ cho đơn #7K3M9Q2XH4TB.']);
  });

  // ---- NTF-REQ-20261006-103208812
  it('NTF-TC-20261006-104224398: OrderShipped có mã vận đơn hợp lệ', async () => {
    await emit(t, 'OrderShipped', shipped());
    expect((await notesOf(t, u1.id))[0]).toMatchObject({ type: 'order_shipped', title: 'Đơn hàng đang được giao', body: 'Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển. Mã vận đơn: VTP12345678.', link: '/orders/7K3M9Q2XH4TB' });
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'order_shipped', delivery_status: 'pending' }]);
  });

  it('NTF-TC-20261006-104224463: ShipmentFailed ánh xạ cố định bốn mã lý do sang câu; mỗi lần có thông báo và email pending', async () => {
    const table: [string, string][] = [['customer_unreachable', 'Chưa liên lạc được với bạn.'], ['refused', 'Đơn hàng đã bị từ chối nhận.'], ['wrong_address', 'Địa chỉ giao hàng chưa chính xác.'], ['damaged', 'Hàng bị hư hại trong lúc vận chuyển.']];
    for (const [reason] of table) await emit(t, 'ShipmentFailed', base({ shipment_id: randomUUID(), reason }));
    const notes = await notesOf(t, u1.id);
    expect(notes.map((n) => n.body)).toEqual(table.map(([, s]) => `Đơn vị vận chuyển chưa giao được đơn hàng của bạn. ${s}`));
    expect(notes.every((n) => n.type === 'shipment_failed' && n.title === 'Giao hàng chưa thành công')).toBe(true);
    expect((await mailsOf(t, u1.id)).map((m) => [m.type, m.delivery_status])).toEqual(table.map(() => ['shipment_failed', 'pending']));
  });

  it('NTF-TC-20261006-104224530 (T4): mã vận đơn chứa thẻ script không vào thông báo, thân email hay log; thông báo vẫn tạo; đúng 1 log warn có mã event và order_id', async () => {
    for (const tracking of ['<script>alert(1)</script>', 'VTP-1234"><img>', '']) {
      await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); u1 = await mkUser(t, { email: 'u1@shop.vn' });
      const eid = await emit(t, 'OrderShipped', shipped({ tracking_number: tracking }));
      expect(await bodies()).toEqual(['Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.']);
      await sendAll();
      expect(await seen(/script|<img|VTP-1234/)).toBe(false);
      const warns = t.logs.records.filter((r) => r.level === 'warn');
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatchObject({ event_id: eid, event_type: 'OrderShipped' });
    }
  });

  it('NTF-TC-20261006-104224598 (T4, T18): lý do giao thất bại là văn bản tự do không bao giờ hiển thị cho khách (thông báo, email SES, log)', async () => {
    for (const reason of ['Khách bảo đừng giao nữa', '<b>x</b>']) await emit(t, 'ShipmentFailed', base({ shipment_id: randomUUID(), reason }));
    expect((await bodies()).every((b) => b.endsWith('Vui lòng liên hệ cửa hàng để biết thêm.'))).toBe(true);
    await sendAll();
    expect(t.mail.calls).toHaveLength(2);
    expect(await seen(/đừng giao|<b>/)).toBe(false);
  });

  it('NTF-TC-20261006-104224668: mã vận đơn đúng 8 và đúng 30 ký tự được chèn đầy đủ', async () => {
    await emit(t, 'OrderShipped', shipped({ tracking_number: 'AB-12345' }));
    await emit(t, 'OrderShipped', shipped({ tracking_number: 'ABCDEFGHIJ-0123456789-ABCDEFGH' }));
    await emit(t, 'OrderShipped', shipped({ tracking_number: 'A'.repeat(30) }));
    expect((await bodies()).map((b) => b.replace(/^.*Mã vận đơn: /, ''))).toEqual(['AB-12345.', 'ABCDEFGHIJ-0123456789-ABCDEFGH.', `${'A'.repeat(30)}.`]);
  });

  it('NTF-TC-20261006-104224734: mã vận đơn 31 ký tự bị bỏ (log warn) và ShipmentFailed thiếu reason dùng câu mặc định', async () => {
    await emit(t, 'OrderShipped', shipped({ tracking_number: 'A'.repeat(31) }));
    expect(countLevel('warn')).toBe(1);
    await emit(t, 'ShipmentFailed', base({ shipment_id: randomUUID() }));
    expect(await bodies()).toEqual(['Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.', 'Đơn vị vận chuyển chưa giao được đơn hàng của bạn. Vui lòng liên hệ cửa hàng để biết thêm.']);
  });

  it('NTF-TC-20261006-122758583 (M-03, R-15): OrderReturned tạo thông báo và email đơn hoàn về cho chủ đơn; chưa xác minh thì email skipped unverified', async () => {
    const e9 = randomUUID();
    await emit(t, 'OrderReturned', base(), e9);
    expect((await notesOf(t, u1.id))[0]).toMatchObject({ channel: 'in_app', type: 'order_returned', title: 'Đơn hàng đã hoàn về', body: 'Đơn hàng của bạn đã được hoàn về cửa hàng.', link: '/orders/7K3M9Q2XH4TB', status: 'unread', dedupe_key: `order_returned:${e9}` });
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'order_returned', delivery_status: 'pending', data: { order_code: CODE } }]);
    expect(Object.keys((await mailsOf(t, u1.id))[0].data)).toEqual(['order_code']);
    expect(await q(t, `SELECT 1 FROM processed_events WHERE consumer = 'NTF' AND event_id = '${e9}'`)).toHaveLength(1);
    await sendAll();
    expect(t.mail.calls.map((c) => c.msg.to)).toEqual(['u1@shop.vn']);
    const u2 = await mkUser(t, { verified: false });
    await emit(t, 'OrderReturned', base({ user_id: u2.id }));
    await sendAll();
    expect((await mailsOf(t, u2.id)).map((m) => [m.delivery_status, m.delivery_reason])).toEqual([['skipped', 'unverified']]);
    expect((await notesOf(t, u2.id)).map((n) => n.type)).toEqual(['order_returned']);
    expect(t.mail.calls).toHaveLength(1);
  });

  it('NTF-TC-20261006-122759638: OrderReturned có người nhận không tồn tại thì không tạo gì, đúng 1 log warn nêu mã event và user_id; AUTH lỗi tạm thời thì handler ném để relay giao lại', async () => {
    const ghost = randomUUID();
    await emit(t, 'OrderReturned', base({ user_id: ghost }));
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([0, 0]);
    const w = logsOf(t, 'warn');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ event_type: 'OrderReturned', user_id: ghost });
    expect(await seen('@')).toBe(false);
    jest.spyOn(t.api, 'getUserContact').mockRejectedValueOnce(new Error('timeout'));
    await expect(emit(t, 'OrderReturned', base())).rejects.toThrow('timeout');
    expect([await count(t, 'notifications'), await count(t, 'processed_events')]).toEqual([0, 0]);
  });

  it('NTF-TC-20261006-122800705: OrderReturned có order_code sai dạng dùng liên kết chung /orders; giao lại không tạo trùng; 1 log warn không ghi giá trị', async () => {
    const e11 = randomUUID();
    await emit(t, 'OrderReturned', base({ order_code: 'abc' }), e11);
    await emit(t, 'OrderReturned', base({ order_code: 'abc' }), e11);
    expect(await notesOf(t, u1.id)).toMatchObject([{ type: 'order_returned', link: '/orders', body: 'Đơn hàng của bạn đã được hoàn về cửa hàng.' }]);
    expect([await count(t, 'email_deliveries'), await count(t, 'processed_events', `event_id = '${e11}'`)]).toEqual([1, 1]);
    expect(countLevel('warn')).toBe(1);
    expect(await seen(/\babc\b/)).toBe(false);
  });

  // ---- NTF-REQ-20261006-103208902
  it('NTF-TC-20261006-104224802: OrderDelivered tạo thông báo và email', async () => {
    await emit(t, 'OrderDelivered', base({ delivered_at: new Date().toISOString() }));
    expect((await notesOf(t, u1.id))[0]).toMatchObject({ type: 'order_delivered', title: 'Đơn hàng đã được giao', body: 'Đơn hàng của bạn đã được giao thành công. Cảm ơn bạn đã mua sắm.', link: '/orders/7K3M9Q2XH4TB' });
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'order_delivered', delivery_status: 'pending' }]);
  });

  it('NTF-TC-20261006-104224870: OrderDelivered thiếu hoặc sai order_id, thiếu user_id bị bỏ qua: đúng 1 log error có correlation_id, handler không ném', async () => {
    const cases: Record<string, unknown>[] = [{ user_id: u1.id }, { order_id: 'abc', user_id: u1.id }, { order_id: OID }];
    for (const payload of cases) {
      t.logs.clear();
      await expect(emit(t, 'OrderDelivered', { ...payload, delivered_at: new Date().toISOString() })).resolves.toBeTruthy();
      expect(t.logs.records.filter((r) => r.level === 'error')).toMatchObject([{ correlation_id: 'test-corr', event_type: 'OrderDelivered' }]);
    }
    expect(await count(t, 'notifications')).toBe(0);
  });

  it('NTF-TC-20261006-104224940 (BR6): delivered_at sai dạng không làm hỏng; người nhận đang khóa vẫn nhận thông báo và dòng email theo quy tắc gửi chung', async () => {
    const locked = await mkUser(t, { status: 'locked', email: 'locked@shop.vn' });
    await emit(t, 'OrderDelivered', base({ user_id: locked.id, delivered_at: 'không phải ngày' }));
    expect((await notesOf(t, locked.id)).map((n) => n.type)).toEqual(['order_delivered']);
    expect(await mailsOf(t, locked.id)).toMatchObject([{ type: 'order_delivered', delivery_status: 'pending' }]);
    await sendAll();
    expect(t.mail.msgs.map((m) => m.to)).toEqual(['locked@shop.vn']); // không bị chặn riêng vì khóa
  });

  it('NTF-TC-20261006-104225009: đơn COD nhận hai thông báo khác loại sau khi giao (order_delivered rồi payment_succeeded), khóa chống trùng khác nhau', async () => {
    const code = '8N4P0R3YJ5UC', p2 = randomUUID();
    await emit(t, 'OrderDelivered', base({ order_code: code, delivered_at: new Date().toISOString() }));
    await emit(t, 'PaymentSucceeded', { payment_id: p2, order_id: OID, order_code: code, user_id: u1.id, amount: 380000, method: 'cod', paid_at: new Date().toISOString() });
    const notes = await notesOf(t, u1.id);
    expect(notes.map((n) => n.type)).toEqual(['order_delivered', 'payment_succeeded']);
    expect(notes[1].body).toBe('Chúng tôi đã nhận 380.000 đ cho đơn #8N4P0R3YJ5UC.');
    expect(notes[0].dedupe_key).toMatch(/^order_delivered:/);
    expect(notes[1].dedupe_key).toBe(`payment_succeeded:${p2}`);
  });

  // ---- NTF-REQ-20261006-103208992
  it('NTF-TC-20261006-104225075 (T18): PaymentFailed lần 2 chỉ trong ứng dụng; không lộ mã lý do hay thông điệp của cổng (bốn mã và văn bản cổng cho cùng nội dung)', async () => {
    for (const reason of ['cancelled_by_user', 'declined', 'timeout', 'other', 'VNPay 24: Giao dịch bị hủy']) await emit(t, 'PaymentFailed', base({ payment_id: randomUUID(), reason, attempt_no: 2, is_final: false }));
    const notes = await notesOf(t, u1.id);
    expect(notes).toHaveLength(5);
    expect(notes.every((n) => n.type === 'payment_failed' && n.title === 'Thanh toán chưa thành công' && n.body === 'Thanh toán lần 2 chưa thành công. Bạn có thể thử lại từ trang đơn hàng.')).toBe(true);
    expect(await count(t, 'email_deliveries')).toBe(0);
    expect(await seen(/cancelled_by_user|declined|timeout|VNPay/)).toBe(false);
  });

  it('NTF-TC-20261006-104225139: OrderCancelled của đơn đã thanh toán nêu hoàn tiền, không hiển thị lý do (reason customer_request, admin, payment_failed cùng câu); was_paid false bỏ câu hoàn tiền', async () => {
    for (const reason of ['customer_request', 'admin', 'payment_failed']) await emit(t, 'OrderCancelled', base({ reason, was_paid: true }));
    await emit(t, 'OrderCancelled', base({ reason: 'customer_request', was_paid: false }));
    const notes = await notesOf(t, u1.id);
    expect(notes.slice(0, 3).every((n) => n.type === 'order_cancelled' && n.title === 'Đơn hàng đã bị hủy' && n.body === 'Đơn hàng của bạn đã bị hủy. Số tiền đã thanh toán sẽ được hoàn lại.')).toBe(true);
    expect(notes[3].body).toBe('Đơn hàng của bạn đã bị hủy.');
    expect(await count(t, 'email_deliveries')).toBe(4);
    await sendAll();
    expect(await seen(/customer_request|payment_failed/)).toBe(false);
  });

  it('NTF-TC-20261006-104225207: RefundSucceeded tạo thông báo cho chủ đơn theo user_id của payload; khóa refund_succeeded:<refund_id>; mọi reason cùng câu chữ', async () => {
    const r1 = randomUUID();
    const refund = (extra: Record<string, unknown> = {}) => ({ refund_id: r1, payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, reason: 'order_cancelled', ...extra });
    await emit(t, 'RefundSucceeded', refund());
    expect((await notesOf(t, u1.id))[0]).toMatchObject({ type: 'refund_succeeded', title: 'Hoàn tiền thành công', body: 'Chúng tôi đã hoàn 350.000 đ cho bạn.', link: '/orders/7K3M9Q2XH4TB', dedupe_key: `refund_succeeded:${r1}` });
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'refund_succeeded', delivery_status: 'pending' }]);
    for (const reason of ['late_payment', 'duplicate_payment', 'admin_manual']) await emit(t, 'RefundSucceeded', refund({ refund_id: randomUUID(), reason }));
    expect((await bodies()).every((b) => b === 'Chúng tôi đã hoàn 350.000 đ cho bạn.')).toBe(true);
    expect(await seen(/late_payment|duplicate_payment|admin_manual|order_cancelled/)).toBe(false);
  });

  it('NTF-TC-20261006-104225276: RefundSucceeded có người nhận không tồn tại (1 log warn) hoặc amount sai (-1, "abc": 1 log error nêu refund_id) thì không tạo gì', async () => {
    const r9 = randomUUID();
    await emit(t, 'RefundSucceeded', { refund_id: r9, payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: randomUUID(), amount: 350000, reason: 'order_cancelled' });
    expect(logsOf(t, 'warn')).toMatchObject([{ event_type: 'RefundSucceeded' }]);
    for (const amount of [-1, 'abc']) {
      t.logs.clear();
      const rid = randomUUID();
      await emit(t, 'RefundSucceeded', { refund_id: rid, payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount, reason: 'order_cancelled' });
      expect(t.logs.records.filter((r) => r.level === 'error')).toMatchObject([{ refund_id: rid }]);
    }
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([0, 0]);
  });

  it('NTF-TC-20261006-104225336: was_paid không phải boolean (chuỗi, số, thiếu) thì bỏ câu hoàn tiền và ghi log warn', async () => {
    for (const was_paid of ['yes', 1, undefined]) {
      t.logs.clear();
      await emit(t, 'OrderCancelled', base({ reason: 'customer_request', was_paid }));
      expect((await notesOf(t, u1.id)).at(-1)!.body).toBe('Đơn hàng của bạn đã bị hủy.');
      expect(countLevel('warn')).toBe(1);
    }
  });

  it('NTF-TC-20261006-104225404 (T4, T18): lý do hủy chứa mã HTML không vào thông báo, dữ liệu email, thân thư (chữ thuần lẫn HTML) hay log', async () => {
    await emit(t, 'OrderCancelled', base({ reason: '<img src=x onerror=alert(1)>', was_paid: false }));
    await sendAll();
    expect(await bodies()).toEqual(['Đơn hàng của bạn đã bị hủy.']);
    expect(t.mail.calls).toHaveLength(1);
    expect(await seen(/<img|onerror/)).toBe(false);
  });

  it('NTF-TC-20261006-104225469 (K-03, M-06): PaymentFailed không tự so attempt_no với số lượt tối đa; thiếu attempt_no hay is_final dùng câu mặc định; chuỗi thất bại hết lượt rồi hủy đơn', async () => {
    const f = (extra: Record<string, unknown>, order = OID) => emit(t, 'PaymentFailed', { payment_id: randomUUID(), order_id: order, order_code: CODE, user_id: u1.id, ...extra });
    const retry = 'Bạn có thể thử lại từ trang đơn hàng.';
    // (A) thiếu attempt_no hoặc attempt_no = 0
    await f({ is_final: false }); await f({ attempt_no: 0, is_final: false });
    expect((await bodies()).slice(0, 2)).toEqual([`Thanh toán chưa thành công. ${retry}`, `Thanh toán chưa thành công. ${retry}`]);
    // (B) hết lượt rồi OrderCancelled
    const o2 = randomUUID();
    await f({ attempt_no: 3, is_final: true }, o2);
    await emit(t, 'OrderCancelled', { order_id: o2, order_code: CODE, user_id: u1.id, reason: 'payment_failed', was_paid: false });
    const forO2 = (await notesOf(t, u1.id)).filter((n) => n.data.order_id === o2);
    expect(forO2.map((n) => [n.type, n.body])).toEqual([['payment_failed', 'Thanh toán lần 3 chưa thành công và đã hết lượt thử. Đơn hàng sẽ bị hủy.'], ['order_cancelled', 'Đơn hàng của bạn đã bị hủy.']]);
    // (C) thiếu is_final hoặc is_final dạng chuỗi: câu mời thử lại và 1 log warn mỗi lần
    for (const extra of [{ attempt_no: 1 }, { attempt_no: 1, is_final: 'true' }]) {
      t.logs.clear();
      await f(extra);
      expect((await bodies()).at(-1)).toBe(`Thanh toán lần 1 chưa thành công. ${retry}`);
      expect(countLevel('warn')).toBe(1);
    }
    // PAY_MAX_ATTEMPTS = 5: attempt_no 3 chưa cuối vẫn mời thử lại; attempt_no 5 cuối dùng câu hết lượt
    await f({ attempt_no: 3, is_final: false, reason: 'timeout' }); await f({ attempt_no: 5, is_final: true });
    expect((await bodies()).slice(-2)).toEqual([`Thanh toán lần 3 chưa thành công. ${retry}`, 'Thanh toán lần 5 chưa thành công và đã hết lượt thử. Đơn hàng sẽ bị hủy.']);
  });

  it('NTF-TC-20261006-122801753 (M-04, R-02): đơn paid bị hệ thống hủy do stock_commit_failed rồi hoàn late_payment: hai thông báo độc lập (kể cả đảo thứ tự giao) không lộ mã lý do', async () => {
    const [e12, e13] = [randomUUID(), randomUUID()];
    const cancel = base({ reason: 'stock_commit_failed', was_paid: true });
    const refund = { refund_id: randomUUID(), payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, reason: 'late_payment' };
    await emit(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, method: 'vnpay' });
    await emit(t, 'OrderCancelled', cancel, e12); await emit(t, 'RefundSucceeded', refund, e13);
    const notes = await notesOf(t, u1.id);
    expect(notes.map((n) => n.type)).toEqual(['payment_succeeded', 'order_cancelled', 'refund_succeeded']);
    expect(notes[1].body).toBe('Đơn hàng của bạn đã bị hủy. Số tiền đã thanh toán sẽ được hoàn lại.');
    expect(notes[2].body).toBe('Chúng tôi đã hoàn 350.000 đ cho bạn.');
    expect((await mailsOf(t, u1.id)).map((m) => m.type).sort()).toEqual(['order_cancelled', 'payment_succeeded', 'refund_succeeded']);
    await sendAll();
    expect(await seen(/stock_commit_failed|late_payment/)).toBe(false);
    await truncateAll(t.prisma); u1 = await mkUser(t); // đảo thứ tự giao: vẫn đủ hai thông báo
    await emit(t, 'RefundSucceeded', { ...refund, user_id: u1.id }); await emit(t, 'OrderCancelled', { ...cancel, user_id: u1.id });
    expect((await notesOf(t, u1.id)).map((n) => n.type).sort()).toEqual(['order_cancelled', 'refund_succeeded']);
  });

  it('NTF-TC-20261006-140547263 (R-19): OrderExpired tạo thông báo order_expired chỉ trong ứng dụng (không email); không người dùng nào khác có thông báo', async () => {
    const other = await mkUser(t), e20 = randomUUID();
    await emit(t, 'OrderExpired', base(), e20);
    expect(await notesOf(t, u1.id)).toMatchObject([{ type: 'order_expired', channel: 'in_app', status: 'unread', title: 'Đơn hàng đã hết hạn thanh toán', body: 'Đơn #7K3M9Q2XH4TB đã quá hạn thanh toán nên không còn hiệu lực. Bạn có thể đặt lại đơn mới.', link: '/orders/7K3M9Q2XH4TB', dedupe_key: `order_expired:${e20}` }]);
    expect([await count(t, 'email_deliveries'), await count(t, 'processed_events', `consumer = 'NTF' AND event_id = '${e20}'`), (await notesOf(t, other.id)).length]).toEqual([0, 1, 0]);
    expect((await q<{ e: string }>(t, `SELECT unnest(enum_range(NULL::email_type))::text AS e`)).map((r) => r.e)).not.toContain('order_expired'); // enum email_type không có order_expired
  });

  it('NTF-TC-20261006-140547355: OrderExpired có người nhận không tồn tại (1 log warn) hoặc order_id sai dạng (1 log error, không ghi giá trị) thì không tạo gì, không giao lại; AUTH lỗi tạm thời thì ném', async () => {
    const ghost = randomUUID();
    await emit(t, 'OrderExpired', base({ user_id: ghost }), randomUUID());
    expect(logsOf(t, 'warn')).toMatchObject([{ event_type: 'OrderExpired', user_id: ghost }]);
    t.logs.clear();
    await emit(t, 'OrderExpired', base({ order_id: 'abc' }), randomUUID());
    expect(t.logs.records.filter((r) => r.level === 'error')).toHaveLength(1);
    expect(await seen('"abc"')).toBe(false);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
    jest.spyOn(t.api, 'getUserContact').mockRejectedValueOnce(new Error('timeout'));
    await expect(emit(t, 'OrderExpired', base())).rejects.toThrow();
    expect(await count(t, 'notifications')).toBe(0);
  });

  it('NTF-TC-20261006-140547444: OrderExpired có order_code sai dạng dùng câu và liên kết chung; giao lại không tạo trùng; không email; 1 log warn không ghi giá trị', async () => {
    const e23 = randomUUID();
    await emit(t, 'OrderExpired', base({ order_code: 'abc' }), e23); await emit(t, 'OrderExpired', base({ order_code: 'abc' }), e23);
    expect(await notesOf(t, u1.id)).toMatchObject([{ type: 'order_expired', link: '/orders', body: 'Đơn hàng của bạn đã quá hạn thanh toán nên không còn hiệu lực. Bạn có thể đặt lại đơn mới.' }]);
    expect([await count(t, 'email_deliveries'), await count(t, 'processed_events', `event_id = '${e23}'`)]).toEqual([0, 1]);
    expect(countLevel('warn')).toBe(1);
    expect(await seen(/\babc\b/)).toBe(false);
  });

  it('NTF-TC-20261006-140547532 (K-02): khách thanh toán muộn sau khi đơn hết hạn nhận ba thông báo độc lập (order_expired, payment_succeeded, refund_succeeded) và hai email; không lộ reason', async () => {
    await emit(t, 'OrderExpired', base(), randomUUID());
    await emit(t, 'PaymentSucceeded', { payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, method: 'vnpay', paid_at: new Date().toISOString() }, randomUUID());
    await emit(t, 'RefundSucceeded', { refund_id: randomUUID(), payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, reason: 'order_expired' }, randomUUID());
    const notes = await notesOf(t, u1.id);
    expect(notes.map((n) => n.type)).toEqual(['order_expired', 'payment_succeeded', 'refund_succeeded']);
    expect(notes[2].body).toBe('Chúng tôi đã hoàn 350.000 đ cho bạn.');
    expect((await mailsOf(t, u1.id)).map((m) => [m.type, m.delivery_status])).toEqual([['payment_succeeded', 'pending'], ['refund_succeeded', 'pending']]);
    expect(JSON.stringify([notes[1], notes[2], (await mailsOf(t, u1.id)).map((m) => m.data)])).not.toContain('order_expired"');
    expect(notes[1].body + notes[2].body + JSON.stringify(await mailsOf(t, u1.id))).not.toMatch(/order_expired/);
  });

  // ---- Đơn hộ (ADR-026) và mã đơn mới (ADR-024)
  it('NTF-TC-20261015-092750240: event đơn hộ không có user_id bỏ qua êm (SKIP): không thông báo, không email, không gọi AUTH, không log error, SKIP của platform không ghi ProcessedEvent (như recipient-not-found); giao lại không xử lý; đơn hộ có user_id thì thông báo như thường, mã mới HDyymmdd-NNNNN giữ nguyên trong nội dung', async () => {
    const spy = jest.spyOn(t.api, 'getUserContact');
    const o9 = randomUUID(), code9 = 'HD261015-00003';
    const e1 = await emit(t, 'OrderCreated', { order_id: o9, order_code: code9, user_id: null, source: 'facebook', created_by: randomUUID(), grand_total: 480000, payment_method: 'cod', payment_expires_at: null });
    const e2 = await emit(t, 'OrderConfirmed', { order_id: o9, order_code: code9, user_id: null, confirmed_at: new Date().toISOString() });
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([0, 0]);
    expect(spy).not.toHaveBeenCalled();
    expect(t.logs.records.filter((r) => r.level === 'error' || r.level === 'warn')).toEqual([]);
    expect([e1, e2]).toHaveLength(2); // SKIP ở `prepare`: không ProcessedEvent (platform), giao lại chỉ chạy lại `prepare` rẻ, không tác dụng phụ
    expect(await count(t, 'processed_events', `consumer = 'NTF'`)).toBe(0);
    await emit(t, 'OrderCreated', { order_id: o9, order_code: code9, user_id: null, grand_total: 480000, payment_method: 'cod' }, e1); // bus giao lại
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([0, 0]);
    const o10 = randomUUID(), code10 = 'HD261015-00004';
    await emit(t, 'OrderCreated', { order_id: o10, order_code: code10, user_id: u1.id, source: 'hotline', created_by: randomUUID(), grand_total: 150000, payment_method: 'cash', payment_expires_at: null });
    expect(await notesOf(t, u1.id)).toMatchObject([{ type: 'order_created', body: `Đơn #${code10} đã được tạo. Tổng tiền 150.000 đ.`, link: `/orders/${code10}` }]);
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'order_created', delivery_status: 'pending', data: { order_code: code10 } }]);
    await sendAll();
    expect(t.mail.msgs[0].text).toContain(`https://shop.example/orders/${code10}`);
    expect(t.logs.records.filter((r) => r.level === 'error')).toEqual([]);
  });
});
