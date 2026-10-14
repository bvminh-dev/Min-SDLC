import { call } from '../support/usr';
import { CODE, OID, count, createNtfApp, emit, logsOf, mailsOf, mkUser, notesOf, q, seedMail, truncateAll, type NtfApp } from '../support/ntf';
import { race } from '../support/ord';

// Gửi email qua SES (NTF-REQ-20261006-103208551): job thường, email chứa bí mật, hạn mức, thử lại, header. Bộ chuyển thư giả ghi mọi lời gọi kèm đồng hồ giả.
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde'; // 43 ký tự hợp lệ; scan-secrets:allow token giả của test
const MIN = 60_000;

/** Mọi dòng của mọi bảng ở dạng văn bản (đúng ý "dump dữ liệu toàn CSDL" của TC, không cần pg_dump ngoài): để tìm chuỗi bí mật. */
async function dumpDb(t: NtfApp): Promise<string> {
  const tables = await q<{ table_name: string }>(t, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  const out: string[] = [];
  for (const { table_name } of tables) out.push(...(await q<{ r: string }>(t, `SELECT x::text AS r FROM "${table_name}" x`)).map((r) => r.r));
  return out.join('\n');
}

describe('NTF gửi email qua SES', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); jest.restoreAllMocks();
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    t.email.timeoutMs = 10_000; t.email.sleep = async (ms) => { t.clock.advance(ms); };
  });
  const T0 = () => t.clock.now();
  const tick = (offsetMs = 0) => { t.clock.set(new Date(T0().getTime() + offsetMs)); return t.email.sendDue(); };
  const token = (userId: string, type: 'PasswordResetRequested' | 'EmailVerificationRequested', extra: Record<string, unknown> = {}) => {
    t.evts.publishAfterCommit({ type, aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, token_ref: TOKEN, expires_at: new Date(T0().getTime() + 30 * MIN).toISOString(), ...extra } });
    return t.evts.idle();
  };

  it('NTF-TC-20261006-104223120 (BR1, BR2): job gửi email order_created qua SES, ghi sent; không cột chữ nào của dòng chứa địa chỉ email', async () => {
    const u1 = await mkUser(t, { email: 'u1@shop.vn' });
    const id = await seedMail(t, u1.id, { data: { order_code: CODE, amount: 350000 } });
    expect(await tick()).toMatchObject({ picked: 1, sent: 1 });
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0]).toMatchObject({ to: 'u1@shop.vn', from: 'no-reply@shop.vn', subject: 'Đã nhận đơn hàng' });
    expect(t.mail.msgs[0].text).toContain('Tổng tiền 350.000 đ');
    const [m] = await mailsOf(t, u1.id);
    expect(m).toMatchObject({ id, delivery_status: 'sent', attempts: 1, next_attempt_at: null });
    expect(m.sent_at).not.toBeNull();
    const cols = await q<{ r: string }>(t, `SELECT x::text AS r FROM email_deliveries x`);
    expect(cols.join()).not.toContain('u1@shop.vn');
  });

  it('NTF-TC-20261006-104223184 (T2, SB-26): email đặt lại mật khẩu gửi ngay trong handler; token chỉ ở bộ nhớ, không ở bất kỳ bảng nào (kể cả outbox_events) hay log', async () => {
    const u2 = await mkUser(t, { email: 'u2@shop.vn' });
    await token(u2.id, 'PasswordResetRequested');
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0].text).toContain(`https://shop.example/reset-password#token=${TOKEN}`);
    expect(t.mail.msgs[0].html).toContain(`https://shop.example/reset-password#token=${TOKEN}`);
    const [m] = await mailsOf(t, u2.id);
    expect(m).toMatchObject({ type: 'password_reset', delivery_status: 'sent', data: {}, next_attempt_at: null, attempts: 1 });
    expect([await count(t, 'notifications'), await count(t, 'outbox_events')]).toEqual([0, 0]);
    expect(await dumpDb(t)).not.toContain(TOKEN);
    expect(t.logs.lines.join('\n')).not.toContain(TOKEN);
    expect(t.mails.map((x) => x.token)).toEqual([TOKEN]); // hộp thư của test (bộ nhớ) có token: bằng chứng event đã đi qua handler
  });

  it('NTF-TC-20261006-104223250 (T17, SB-34): SES throttling ba lần thử lúc t0, +1 phút, +6 phút rồi failed ses_throttled; không lần thứ 4; đúng 1 log error không có địa chỉ; SES treo quá hạn là lỗi tạm thời', async () => {
    const u1 = await mkUser(t, { email: 'u1@shop.vn' });
    const id = await seedMail(t, u1.id);
    const t0 = T0().getTime();
    t.mail.failAll('ses_throttled');
    await tick(0);
    expect(await mailsOf(t, u1.id)).toMatchObject([{ id, delivery_status: 'pending', attempts: 1, next_attempt_at: new Date(t0 + MIN) }]);
    await tick(MIN);
    expect(await mailsOf(t, u1.id)).toMatchObject([{ delivery_status: 'pending', attempts: 2, next_attempt_at: new Date(t0 + 6 * MIN) }]);
    await tick(5 * MIN);
    expect(await mailsOf(t, u1.id)).toMatchObject([{ delivery_status: 'failed', attempts: 3, delivery_reason: 'ses_throttled', next_attempt_at: null }]);
    await tick(MIN); await tick(13 * MIN);
    expect(t.mail.calls.map((c) => c.at.getTime())).toEqual([t0, t0 + MIN, t0 + 6 * MIN]);
    expect(logsOf(t, 'error')).toHaveLength(1);
    expect(t.logs.lines.join('\n')).not.toMatch(/@/);
    // SES treo: hạn gọi tính là lỗi tạm thời và tăng attempts
    t.mail.reset(); t.mail.script = ['hang']; t.email.timeoutMs = 50;
    const id2 = await seedMail(t, u1.id, { at: T0() });
    await t.email.sendDue();
    expect(await mailsOf(t, u1.id)).toMatchObject([{}, { id: id2, delivery_status: 'pending', attempts: 1, delivery_reason: 'ses_timeout' }]);
  });

  it('NTF-TC-20261006-104223313: lỗi vĩnh viễn của SES làm bản ghi failed ngay sau 1 lần gọi, không hẹn thử lại', async () => {
    const u1 = await mkUser(t);
    await seedMail(t, u1.id);
    t.mail.failAll('ses_rejected', true);
    await tick();
    expect(await mailsOf(t, u1.id)).toMatchObject([{ delivery_status: 'failed', attempts: 1, delivery_reason: 'ses_rejected', next_attempt_at: null }]);
    await tick(10 * MIN);
    expect(t.mail.calls).toHaveLength(1);
  });

  it('NTF-TC-20261006-104223377 (T11, SB-26): địa chỉ chưa xác minh không nhận email giao dịch (skipped unverified) nhưng thông báo trong ứng dụng còn; email xác minh vẫn gửi', async () => {
    const u3 = await mkUser(t, { verified: false, email: 'u3@shop.vn' });
    await emit(t, 'OrderCreated', { order_id: OID, order_code: CODE, user_id: u3.id, grand_total: 100000, payment_method: 'cod', payment_expires_at: null });
    await token(u3.id, 'EmailVerificationRequested');
    await tick(1000);
    const mails = await mailsOf(t, u3.id);
    expect(mails.map((m) => [m.type, m.delivery_status, m.delivery_reason])).toEqual(expect.arrayContaining([['order_created', 'skipped', 'unverified'], ['email_verification', 'sent', null]]));
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0].subject).toBe('Xác minh email của bạn');
    expect((await notesOf(t, u3.id)).map((n) => [n.type, n.status])).toEqual([['order_created', 'unread']]);
    const r = await call(t, 'get', '/notifications', { cookie: u3.cookie });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
  });

  it('NTF-TC-20261006-104223436 (T2, T17): email đặt lại thất bại ba lần trong handler (0, 2, 5 giây) thành failed và không bao giờ được job gửi lại; token không ở CSDL hay log; bản ghi kẹt quá 5 phút thành failed lost', async () => {
    const u2 = await mkUser(t);
    const t0 = T0().getTime();
    t.mail.failAll('ses_throttled');
    await token(u2.id, 'PasswordResetRequested');
    expect(t.mail.calls.map((c) => c.at.getTime() - t0)).toEqual([0, 2000, 7000]);
    expect(await mailsOf(t, u2.id)).toMatchObject([{ type: 'password_reset', delivery_status: 'failed', delivery_reason: 'ses_throttled', attempts: 3, data: {} }]);
    for (let m = 1; m <= 30; m++) await tick(MIN); // job mỗi phút từ 10:01 tới 10:30
    expect(t.mail.calls).toHaveLength(3);
    expect(await dumpDb(t)).not.toContain(TOKEN);
    expect(t.logs.lines.join('\n')).not.toContain(TOKEN);
    // ca phụ: dòng bí mật còn pending quá 5 phút (tiến trình chết giữa chừng) bị job quét đổi sang failed lost, không bao giờ được gửi
    t.mail.reset(); t.mail.fallback = null;
    const lost = await seedMail(t, u2.id, { type: 'password_reset', at: new Date(T0().getTime() - 6 * MIN) });
    const fresh = await seedMail(t, u2.id, { type: 'email_verification', at: new Date(T0().getTime() - 4 * MIN) });
    expect(await t.email.failLost()).toBe(1);
    await tick(MIN);
    const rows = Object.fromEntries((await mailsOf(t, u2.id)).map((m) => [m.id, m]));
    expect(rows[lost]).toMatchObject({ delivery_status: 'failed', delivery_reason: 'lost' });
    expect(rows[fresh]).toMatchObject({ delivery_status: 'pending' });
    expect(t.mail.calls).toHaveLength(0);
  });

  it('NTF-TC-20261006-104223500 (T5, SB-14 bậc E): email thường thứ 31 trong 24 giờ bị bỏ qua rate_capped; 1 log warn; biên cửa sổ trượt 24 giờ', async () => {
    const u1 = await mkUser(t);
    const now = T0();
    for (let i = 0; i < 29; i++) await seedMail(t, u1.id, { status: 'sent', sentAt: new Date(now.getTime() - 3600_000 - i * 1000), at: new Date(now.getTime() - 3600_000) });
    const [p1, p2] = [await seedMail(t, u1.id, { at: new Date(now.getTime() - 2000) }), await seedMail(t, u1.id, { at: new Date(now.getTime() - 1000) })];
    expect(await tick()).toMatchObject({ sent: 1, skipped: 1 });
    expect(t.mail.calls).toHaveLength(1);
    const rows = Object.fromEntries((await mailsOf(t, u1.id)).map((m) => [m.id, m]));
    expect([rows[p1].delivery_status, rows[p2].delivery_status, rows[p2].delivery_reason]).toEqual(['sent', 'skipped', 'rate_capped']);
    expect(logsOf(t, 'warn').filter((r) => r.code === 'email-rate-capped')).toHaveLength(1);
    // biên: một trong 29 dòng sent cách đây 24 giờ 1 giây thì chỉ còn 28 trong cửa sổ và cả hai dòng pending đều được gửi
    await truncateAll(t.prisma); t.mail.reset(); t.logs.clear();
    const u2 = await mkUser(t);
    await seedMail(t, u2.id, { status: 'sent', sentAt: new Date(T0().getTime() - 24 * 3600_000 - 1000) });
    for (let i = 0; i < 28; i++) await seedMail(t, u2.id, { status: 'sent', sentAt: new Date(T0().getTime() - 3600_000) });
    await seedMail(t, u2.id, { at: new Date(T0().getTime() - 2000) }); await seedMail(t, u2.id, { at: new Date(T0().getTime() - 1000) });
    expect(await tick()).toMatchObject({ sent: 2, skipped: 0 });
    // email xác minh, đặt lại không tính vào 30 email thường
    expect(await count(t, 'email_deliveries', `user_id = '${u2.id}' AND delivery_status = 'sent'`)).toBe(31);
  });

  it('NTF-TC-20261006-104223567 (T5): email đặt lại thứ 11 trong 60 phút bị bỏ qua rate_capped, SES không được gọi, token không ở CSDL; sau khi dòng cũ nhất lùi quá 60 phút thì gửi lại; tách biệt hạn mức 30 email thường', async () => {
    const u2 = await mkUser(t);
    const now = T0().getTime();
    const types = ['password_reset', 'password_reset', 'password_reset', 'password_reset', 'password_reset', 'password_reset', 'password_reset', 'email_verification', 'email_verification', 'email_verification'];
    const ids: string[] = [];
    for (const [i, type] of types.entries()) ids.push(await seedMail(t, u2.id, { type, status: 'sent', sentAt: new Date(now - (59 - i) * MIN), at: new Date(now - 59 * MIN) }));
    await token(u2.id, 'PasswordResetRequested');
    expect(t.mail.calls).toHaveLength(0);
    const rows = await mailsOf(t, u2.id);
    expect(rows.filter((m) => m.delivery_status === 'skipped')).toMatchObject([{ type: 'password_reset', delivery_reason: 'rate_capped', data: {} }]);
    expect(await dumpDb(t)).not.toContain(TOKEN);
    t.clock.advance(2 * MIN); // dòng sent cũ nhất (59 phút trước) lùi quá 60 phút
    await token(u2.id, 'PasswordResetRequested');
    expect(t.mail.calls).toHaveLength(1);
    // 10 email xác minh, đặt lại không làm u2 chạm trần 30 email thường
    await seedMail(t, u2.id);
    expect(await tick(MIN)).toMatchObject({ sent: 1 });
    expect(ids).toHaveLength(10);
  });

  it('NTF-TC-20261006-104223630 (T3, SB-11, SB-12): họ tên chứa xuống dòng không chèn được header; lời chào bỏ xuống dòng và cắt 50 ký tự; HTML escape', async () => {
    const u4 = await mkUser(t, { name: 'Minh\r\nBcc: attacker@evil.test', email: 'u4@shop.vn' });
    const u5 = await mkUser(t, { name: '<b>x</b>', email: 'u5@shop.vn' });
    const u6 = await mkUser(t, { name: 'Nguyễn'.repeat(12), email: 'u6@shop.vn' });
    const u7 = await mkUser(t, { name: 'Minh\u0001\u0007\u007F\u0085x', email: 'u7@shop.vn' }); // ký tự điều khiển không phải khoảng trắng (không bị `\s` bắt) cũng thành khoảng trắng
    for (const u of [u4, u5, u6, u7]) await seedMail(t, u.id);
    expect(await tick()).toMatchObject({ sent: 4 });
    expect(t.mail.msgs.find((m) => m.to === 'u7@shop.vn')!.text.split('\n')[0]).toBe('Xin chào Minh x,');
    const by = (to: string) => t.mail.msgs.find((m) => m.to === to)!;
    const m4 = by('u4@shop.vn');
    expect(m4.subject).toBe('Đã nhận đơn hàng');
    expect(m4.to).toBe('u4@shop.vn');
    for (const h of [m4.subject, m4.from, m4.to]) expect(h).not.toMatch(/[\r\n]/);
    expect(Object.keys(m4).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']); // không có trường Bcc hay Cc, cùng tập khóa với thư của người khác
    expect(Object.keys(by('u5@shop.vn')).sort()).toEqual(Object.keys(m4).sort());
    expect(m4.text.split('\n')[0]).toBe('Xin chào Minh Bcc: attacker@evil.test,');
    expect(m4.text).not.toMatch(/\r/);
    expect(by('u5@shop.vn').html).toContain('Xin chào &lt;b&gt;x&lt;/b&gt;,');
    expect(by('u5@shop.vn').html).not.toContain('<b>x</b>');
    expect([...by('u6@shop.vn').text.split('\n')[0].slice('Xin chào '.length, -1)]).toHaveLength(50);
  });

  it('NTF-TC-20261006-104223696 (T17): hai job chạy song song (20 vòng, SES chậm 500 ms) chỉ gửi một lần; tiến trình còn lại nhận 0 dòng', async () => {
    const u1 = await mkUser(t);
    for (let i = 0; i < 20; i++) {
      t.mail.reset(); t.mail.delayMs = 500;
      const id = await seedMail(t, u1.id, { at: new Date(T0().getTime() - 1000) });
      const [a, b] = await race(() => t.email.sendDue(), () => t.email.sendDue());
      expect([a.picked + b.picked, a.sent + b.sent]).toEqual([1, 1]);
      expect(t.mail.calls).toHaveLength(1);
      expect((await mailsOf(t, u1.id)).find((m) => m.id === id)).toMatchObject({ delivery_status: 'sent', attempts: 1 });
    }
  }, 60_000);
});
