import { randomUUID } from 'node:crypto';
import { OutboxRelay, TransactionService } from '../../src/modules/platform';
import { backoffMs } from '../../src/modules/platform/events/outbox-relay';
import { CODE, OID, count, createNtfApp, emit, logsOf, mailsOf, mkUser, notesOf, processedOf, q, seedMail, seedNote, truncateAll, viaOutbox, type NtfApp } from '../support/ntf';
import { failingInsert, pgCode, race } from '../support/ord';

// Đường ống chung của NTF (NTF-REQ-20261006-103208460): nhận event, người nhận, chống trùng, rollback, giao lại, hạn lưu. PostgreSQL thật, AUTH thật, bộ chuyển thư giả.
describe('NTF đường ống xử lý event', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); jest.restoreAllMocks(); });
  const created = (user: string, extra: Record<string, unknown> = {}) => ({ order_id: OID, order_code: CODE, user_id: user, grand_total: 350000, payment_method: 'cod', payment_expires_at: null, ...extra });

  it('NTF-TC-20261006-104222533: OrderCreated của customer tạo thông báo trong ứng dụng, bản ghi email chờ gửi và ProcessedEvent; không dòng cho người khác', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    const spy = jest.spyOn(t.api, 'getUserContact');
    const e1 = randomUUID();
    const t0 = Date.now();
    await emit(t, 'OrderCreated', created(u1.id), e1);
    expect(Date.now() - t0).toBeLessThan(5000);
    const notes = await notesOf(t);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: u1.id, channel: 'in_app', type: 'order_created', status: 'unread', read_at: null, event_id: e1, dedupe_key: `order_created:${e1}` });
    const mails = await mailsOf(t);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ user_id: u1.id, type: 'order_created', delivery_status: 'pending', attempts: 0, event_id: e1, data: { order_code: CODE, amount: 350000 } });
    expect(mails[0].next_attempt_at!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await processedOf(t)).toEqual([{ consumer: 'NTF', event_id: e1 }]);
    expect((await notesOf(t, u2.id)).length + (await mailsOf(t, u2.id)).length).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1); // chỉ hỏi AUTH một lần; không có module ORD hay PAY trong ứng dụng, không bảng chiếu người nhận
  });

  it('NTF-TC-20261006-104222599 (T9): OrderShipped dùng user_id của payload, không theo đơn; không bảng chiếu người nhận, không lời gọi ngoài AUTH', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    const spy = jest.spyOn(t.api, 'getUserContact');
    await emit(t, 'OrderShipped', { order_id: OID, order_code: CODE, user_id: u1.id, tracking_number: 'VTP12345678' });
    expect((await notesOf(t, u1.id)).map((n) => n.type)).toEqual(['order_shipped']);
    expect(await notesOf(t, u2.id)).toEqual([]);
    await emit(t, 'OrderShipped', { order_id: OID, order_code: CODE, user_id: u2.id, tracking_number: 'VTP12345678' }); // cùng order_id, người nhận đi theo payload
    expect((await notesOf(t, u2.id)).map((n) => n.type)).toEqual(['order_shipped']);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([u1.id, u2.id]);
    expect((await q<{ table_name: string }>(t, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ~ '(recipient|projection|order_ref|payment_ref)'`))).toEqual([]);
  });

  it('NTF-TC-20261006-104222664 (T7): OrderCreated có user_id không tồn tại bị bỏ qua; đúng 1 log warn có mã event và user_id, không email, không họ tên; không lỗi cho bus', async () => {
    await mkUser(t, { name: 'Nguyen Van A', email: 'nguyen.van.a@shop.vn' });
    const ghost = randomUUID(), eid = randomUUID();
    await expect(emit(t, 'OrderCreated', created(ghost, { order_id: randomUUID() }), eid)).resolves.toBe(eid);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
    const warns = t.logs.records.filter((r) => r.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ code: 'recipient-not-found', event_type: 'OrderCreated', event_id: eid, user_id: ghost, correlation_id: 'test-corr' });
    const all = t.logs.lines.join('\n');
    expect(all).not.toMatch(/@/);
    expect(all).not.toContain('Nguyen Van A');
    expect(t.logs.records.filter((r) => r.level === 'error')).toEqual([]);
  });

  it('NTF-TC-20261006-104222732 (SB-34, ADR-011): AUTH lỗi tạm thời thì relay giao lại theo lịch 5 giây nhân đôi tới 10 phút, đúng 10 lần giao; AUTH phục hồi ở lần 3 thì đúng 1 thông báo', async () => {
    const u1 = await mkUser(t);
    const relay = t.app.get(OutboxRelay);
    const T0 = new Date(Date.now() + 86_400_000); // mốc tương lai tương đối: next_attempt_at mặc định của outbox là now() của CSDL
    const payload = { order_id: OID, order_code: CODE, user_id: u1.id, tracking_number: 'VTP12345678' };
    // (A) lỗi hai lần rồi phục hồi: giao ở t0, t0 + 5, t0 + 15
    const spyA = jest.spyOn(t.api, 'getUserContact').mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new Error('timeout'));
    const idA = await viaOutbox(t, 'OrderShipped', payload, T0);
    expect(await count(t, 'notifications')).toBe(0);
    for (const s of [5, 15]) await relay.runOnce(new Date(T0.getTime() + s * 1000));
    expect(spyA).toHaveBeenCalledTimes(3);
    expect((await notesOf(t)).map((n) => [n.type, n.event_id])).toEqual([['order_shipped', idA]]);
    expect(await processedOf(t)).toEqual([{ consumer: 'NTF', event_id: idA }]);
    await relay.runOnce(new Date(T0.getTime() + 35_000)); // không có lần giao thứ 4
    expect(spyA).toHaveBeenCalledTimes(3);
    // (B) AUTH không bao giờ phục hồi: 10 lần giao
    await truncateAll(t.prisma); t.logs.clear(); jest.restoreAllMocks();
    const u2 = await mkUser(t);
    const spyB = jest.spyOn(t.api, 'getUserContact').mockRejectedValue(new Error('timeout'));
    const idB = await viaOutbox(t, 'OrderShipped', { ...payload, user_id: u2.id }, T0);
    const at = [0]; for (let a = 1; a < 10; a++) at.push(at[a - 1] + backoffMs(a) / 1000);
    expect(at).toEqual([0, 5, 15, 35, 75, 155, 315, 635, 1235, 1835]);
    for (const s of at.slice(1)) await relay.runOnce(new Date(T0.getTime() + s * 1000));
    await relay.runOnce(new Date(T0.getTime() + 4_000_000)); // lượt thứ 11 không giao
    expect(spyB).toHaveBeenCalledTimes(10);
    expect([await count(t, 'notifications'), await count(t, 'processed_events')]).toEqual([0, 0]);
    const errs = t.logs.records.filter((r) => r.level === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ event_id: idB });
    expect(await relay.stuckCount()).toBe(1);
  });

  it('NTF-TC-20261006-104222796 (BR7, SB-27): lỗi CSDL ở câu INSERT email_deliveries rollback cả notifications và processed_events; giao lại cùng event_id tạo đủ đúng một bộ', async () => {
    const u1 = await mkUser(t);
    const e5 = randomUUID();
    await expect(failingInsert(t, 'email_deliveries', () => emit(t, 'OrderCreated', created(u1.id, { grand_total: 200000 }), e5))).rejects.toThrow();
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
    await emit(t, 'OrderCreated', created(u1.id, { grand_total: 200000 }), e5);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events', `consumer = 'NTF' AND event_id = '${e5}'`)]).toEqual([1, 1, 1]);
  });

  it('NTF-TC-20261006-104222863 (T8, SB-27): giao lại cùng event_id và hai tiến trình song song (20 vòng) không tạo trùng; hai event khác event_id cùng payment_id vẫn một dòng', async () => {
    const u1 = await mkUser(t);
    const e1 = randomUUID();
    await emit(t, 'OrderCreated', created(u1.id), e1);
    await emit(t, 'OrderCreated', created(u1.id), e1); // (A) giao lại
    expect([await count(t, 'notifications', `event_id = '${e1}'`), await count(t, 'email_deliveries', `event_id = '${e1}'`), await count(t, 'processed_events')]).toEqual([1, 1, 1]);
    for (let i = 0; i < 20; i++) { // (B) hai tiến trình cùng event
      const e2 = randomUUID();
      const res = await race(() => emit(t, 'OrderCreated', created(u1.id), e2).then(() => 'ok', (e) => String(e)), () => emit(t, 'OrderCreated', created(u1.id), e2).then(() => 'ok', (e) => String(e)));
      expect(res).toEqual(['ok', 'ok']);
      expect([await count(t, 'notifications', `event_id = '${e2}'`), await count(t, 'email_deliveries', `event_id = '${e2}'`), await count(t, 'processed_events', `event_id = '${e2}'`)]).toEqual([1, 1, 1]);
    }
    const pid = randomUUID();
    const pay = { payment_id: pid, order_id: OID, order_code: CODE, user_id: u1.id, amount: 350000, method: 'vnpay', paid_at: new Date().toISOString() };
    const res2 = await race(() => emit(t, 'PaymentSucceeded', pay).then(() => 'ok', (e) => String(e)), () => emit(t, 'PaymentSucceeded', pay).then(() => 'ok', (e) => String(e))); // event_id khác nhau
    expect(res2).toEqual(['ok', 'ok']);
    expect([await count(t, 'notifications', `dedupe_key = 'payment_succeeded:${pid}'`), await count(t, 'email_deliveries', `dedupe_key = 'payment_succeeded:${pid}'`)]).toEqual([1, 1]);
    // chốt chặn ở CSDL: chèn thẳng dòng thứ hai cùng (user_id, dedupe_key) bị unique từ chối
    expect(await pgCode(q(t, `INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key) VALUES ('${u1.id}', 'payment_succeeded', 't', 'b', '${randomUUID()}', 'payment_succeeded:${pid}')`))).toBe('23505');
  }, 120_000);

  it('NTF-TC-20261006-104222929: hai PaymentFailed khác event của cùng đơn tạo hai thông báo payment_failed (khóa chống trùng khác nhau), không email; giao lại e3 vẫn 2 dòng', async () => {
    const u1 = await mkUser(t);
    const [e3, e4] = [randomUUID(), randomUUID()];
    const base = { payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: u1.id, is_final: false };
    await emit(t, 'PaymentFailed', { ...base, attempt_no: 1 }, e3);
    await emit(t, 'PaymentFailed', { ...base, attempt_no: 2 }, e4);
    await emit(t, 'PaymentFailed', { ...base, attempt_no: 1 }, e3);
    const notes = await notesOf(t, u1.id);
    expect(notes.map((n) => [n.type, n.body, n.dedupe_key])).toEqual([
      ['payment_failed', 'Thanh toán lần 1 chưa thành công. Bạn có thể thử lại từ trang đơn hàng.', `payment_failed:${e3}`],
      ['payment_failed', 'Thanh toán lần 2 chưa thành công. Bạn có thể thử lại từ trang đơn hàng.', `payment_failed:${e4}`],
    ]);
    expect(await count(t, 'email_deliveries')).toBe(0);
  });

  it('NTF-TC-20261006-104222999 (ADR-022): hàm dọn xóa đúng thông báo quá 180 ngày và email quá 90 ngày theo lô 1000, mỗi lô một giao dịch; ghi log số đã xóa; lần hai xóa 0', async () => {
    const u1 = await mkUser(t);
    const DAY = 86_400_000, now = Date.now();
    const n1 = await seedNote(t, u1.id, { at: new Date(now - 180 * DAY - 60_000) }), n2 = await seedNote(t, u1.id, { at: new Date(now - 179 * DAY) });
    const m1 = await seedMail(t, u1.id, { at: new Date(now - 91 * DAY), status: 'sent' }), m2 = await seedMail(t, u1.id, { at: new Date(now - 89 * DAY), status: 'sent' });
    expect(await t.cleaner.run()).toEqual({ notifications: 1, email_deliveries: 1 });
    expect((await notesOf(t)).map((n) => n.id)).toEqual([n2]);
    expect((await mailsOf(t)).map((m) => m.id)).toEqual([m2]);
    expect([n1, m1].every((id) => id !== n2 && id !== m2)).toBe(true);
    const logs = logsOf(t, 'info').filter((r) => r.code === 'notification-cleanup');
    expect(logs[0]).toMatchObject({ notifications: 1, deliveries: 1 });
    expect(await t.cleaner.run()).toEqual({ notifications: 0, email_deliveries: 0 });
    expect(logsOf(t, 'info').filter((r) => r.code === 'notification-cleanup')[1]).toMatchObject({ notifications: 0, deliveries: 0 });
    // hơn một lô: 2.500 thông báo và 2.500 email quá hạn xóa theo lô 1000, mỗi lô một giao dịch
    await q(t, `INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key, created_at) SELECT '${u1.id}', 'order_created', 't', 'b', gen_random_uuid(), 'old:' || g, now() - interval '200 days' FROM generate_series(1, 2500) g`);
    await q(t, `INSERT INTO email_deliveries (user_id, type, event_id, dedupe_key, created_at, delivery_status) SELECT '${u1.id}', 'order_created', gen_random_uuid(), 'old:' || g, now() - interval '100 days', 'failed' FROM generate_series(1, 2500) g`);
    const spy = jest.spyOn(t.app.get(TransactionService), 'run');
    expect(await t.cleaner.run()).toEqual({ notifications: 2500, email_deliveries: 2500 });
    expect(spy).toHaveBeenCalledTimes(6); // 3 lô mỗi bảng (1000, 1000, 500), mỗi lô một giao dịch
    expect(await count(t, 'notifications')).toBe(1);
    // dọn theo mốc "bây giờ" tùy ý và lượt bị hủy dừng sớm (SB-34)
    const ac = new AbortController(); ac.abort();
    await seedNote(t, u1.id, { at: new Date(now - 300 * DAY) });
    expect(await t.cleaner.run({ signal: ac.signal })).toEqual({ notifications: 0, email_deliveries: 0 });
    expect((await t.cleaner.run({ now: new Date(now + 10 * DAY) })).notifications).toBe(2); // n2 (179 ngày) quá 180 ngày sau 10 ngày nữa
  }, 120_000);

  it('NTF-TC-20261006-104223060 (T15): liên kết không bao giờ lấy từ dữ liệu event; CHECK ở CSDL từ chối link ngoài hay `//host`', async () => {
    const u1 = await mkUser(t);
    await emit(t, 'OrderCreated', { ...created(u1.id), link: 'https://evil.test/phish', redirect: '//evil.test', url: 'https://evil.test' });
    const [n] = await notesOf(t, u1.id);
    expect(n.link).toBe(`/orders/${CODE}`);
    expect(await t.email.sendDue({ now: new Date(Date.now() + 1000) })).toMatchObject({ sent: 1 });
    expect(t.mail.msgs[0].text).toContain(`${'https://shop.example'}/orders/${CODE}`);
    expect(t.mail.msgs[0].html).toContain(`href="https://shop.example/orders/${CODE}"`);
    const dump = JSON.stringify([await notesOf(t), await mailsOf(t), t.mail.msgs, t.logs.lines]);
    expect(dump).not.toContain('evil.test');
    for (const bad of ['https://evil.test', '//evil.test', '//intranet', '//2130706433', '///', '/orders?next=//evil', 'javascript:alert(1)', '/a b', '/orders/../x']) {
      expect([bad, await pgCode(q(t, `INSERT INTO notifications (user_id, type, title, body, link, event_id, dedupe_key) VALUES ('${u1.id}', 'order_created', 't', 'b', '${bad}', '${randomUUID()}', '${randomUUID()}')`))]).toEqual([bad, '23514']);
    }
  });
});
