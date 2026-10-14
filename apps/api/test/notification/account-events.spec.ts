import { randomUUID } from 'node:crypto';
import { CODE, count, createNtfApp, emit, logsOf, mailsOf, mkUser, notesOf, q, truncateAll, type NtfApp, type NtfUser } from '../support/ntf';

// Thông báo tài khoản (NTF-REQ-20261006-103209078): hai event mang token thô phát in-process sau commit (không qua outbox), UserRegistered, PasswordChanged, UserLocked qua outbox.
const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde'; // 43 ký tự; scan-secrets:allow token giả của test
const MIN = 60_000;

describe('NTF thông báo tài khoản', () => {
  let t: NtfApp;
  let u1: NtfUser;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); t.mails.length = 0; jest.restoreAllMocks();
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    t.email.timeoutMs = 10_000; t.email.sleep = async (ms) => { t.clock.advance(ms); };
    u1 = await mkUser(t, { email: 'u1@shop.vn' });
  });
  const token = (userId: string, type: 'PasswordResetRequested' | 'EmailVerificationRequested', payload: Record<string, unknown> = {}) => {
    t.evts.publishAfterCommit({ type, aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, token_ref: T, expires_at: new Date(t.clock.now().getTime() + 30 * MIN).toISOString(), ...payload } });
    return t.evts.idle();
  };
  /** Mọi nơi KHÔNG phải thư gửi đi: các bảng của NTF, outbox và log (thư gửi SES hợp lệ chứa liên kết có token). */
  const stored = async () => [JSON.stringify(await q(t, 'SELECT * FROM notifications')), JSON.stringify(await q(t, 'SELECT * FROM email_deliveries')), JSON.stringify(await q(t, 'SELECT * FROM outbox_events')), t.logs.lines.join('\n')].join('\n');
  const everything = async () => [await stored(), JSON.stringify(t.mail.calls.map((c) => c.msg))].join('\n');
  const levelCount = (l: 'warn' | 'error') => t.logs.records.filter((r) => r.level === l).length;

  it('NTF-TC-20261006-104225530 (BR1, T2): email đặt lại có liên kết fragment và hạn theo giờ Việt Nam; không thông báo trong ứng dụng; data rỗng; token không ở CSDL hay log', async () => {
    t.clock.set(new Date('2026-10-06T09:30:00Z')); // fixed-clock: ví dụ của TC cố định 09:30Z, expires_at 10:00Z; prepare đọc Clock đã giả
    await token(u1.id, 'PasswordResetRequested', { expires_at: '2026-10-06T10:00:00Z' });
    expect(t.mail.calls).toHaveLength(1);
    const m = t.mail.msgs[0];
    expect(m).toMatchObject({ subject: 'Đặt lại mật khẩu', to: 'u1@shop.vn' });
    expect(m.text).toContain(`https://shop.example/reset-password#token=${T}`);
    expect(m.text).toContain('06/10/2026 17:00');
    expect(m.text).toContain('Nếu không phải bạn, hãy bỏ qua email này.');
    expect(m.text + m.html).not.toContain('?token=');
    expect(await count(t, 'notifications')).toBe(0);
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'password_reset', data: {} }]);
    expect(await stored()).not.toContain(T);
  });

  it('NTF-TC-20261006-104225595 (M-11, R-21): đăng ký tạo thông báo chào mừng (chỉ trong ứng dụng) và đúng một email xác minh; UserRegistered một mình không tạo email', async () => {
    const u2 = await mkUser(t, { verified: false, email: 'u2@shop.vn' });
    await emit(t, 'UserRegistered', { user_id: u2.id, email: 'u2@shop.vn' });
    expect(await mailsOf(t, u2.id)).toEqual([]); // UserRegistered giao một mình
    await token(u2.id, 'EmailVerificationRequested', { token_ref: T, expires_at: new Date(t.clock.now().getTime() + 24 * 60 * MIN).toISOString() });
    expect(await notesOf(t, u2.id)).toMatchObject([{ type: 'welcome', title: 'Chào mừng bạn đến với cửa hàng', body: 'Tài khoản của bạn đã được tạo. Hãy xác minh email để có thể đặt hàng.', link: null }]);
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0]).toMatchObject({ subject: 'Xác minh email của bạn', to: 'u2@shop.vn' });
    expect(t.mail.msgs[0].text).toContain(`https://shop.example/verify-email#token=${T}`);
    expect((await mailsOf(t, u2.id)).map((m) => [m.type, m.delivery_status])).toEqual([['email_verification', 'sent']]);
  });

  it('NTF-TC-20261006-104225660 (BR5, BR8): PasswordChanged tạo thông báo với giờ Việt Nam (qua ngày đúng) và bản ghi email', async () => {
    await emit(t, 'PasswordChanged', { user_id: u1.id, changed_at: '2026-10-06T09:30:00Z' }); // fixed-clock: ví dụ của TC, giờ Việt Nam tính từ chuỗi cố định
    await emit(t, 'PasswordChanged', { user_id: u1.id, changed_at: '2026-10-06T17:30:00Z' });
    const notes = await notesOf(t, u1.id);
    expect(notes[0]).toMatchObject({ type: 'password_changed', title: 'Mật khẩu đã được thay đổi', link: '/forgot-password' });
    expect(notes[0].body).toBe('Mật khẩu tài khoản của bạn vừa được đổi lúc 06/10/2026 16:30 (giờ Việt Nam). Nếu không phải bạn, hãy đặt lại mật khẩu ngay.');
    expect(notes[1].body).toContain('07/10/2026 00:30');
    expect(await mailsOf(t, u1.id)).toMatchObject([{ type: 'password_changed', delivery_status: 'pending' }, { type: 'password_changed' }]);
  });

  it('NTF-TC-20261006-104225728: UserLocked do đăng nhập sai gửi email account_locked, không có thông báo trong ứng dụng', async () => {
    const u3 = await mkUser(t, { email: 'u3@shop.vn' });
    await emit(t, 'UserLocked', { user_id: u3.id, reason: 'too_many_attempts' });
    expect(await count(t, 'notifications')).toBe(0);
    expect(await mailsOf(t, u3.id)).toMatchObject([{ type: 'account_locked', delivery_status: 'pending', data: { reason: 'too_many_attempts' } }]);
    await t.email.sendDue({ now: new Date(Date.now() + 1000) });
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0].subject).toBe('Tài khoản của bạn đã bị khóa');
    expect(t.mail.msgs[0].text).toContain('Tài khoản của bạn bị tạm khóa do đăng nhập sai nhiều lần và sẽ tự mở lại sau một thời gian ngắn.');
  });

  it('NTF-TC-20261006-104225796 (T7): token_ref sai dạng (3 ký tự, 200 ký tự) không gửi email và không bị log; biên 43 và 128 ký tự chấp nhận, 42 và 129 từ chối', async () => {
    for (const bad of ['abc', 'A'.repeat(200), 'A'.repeat(42), 'A'.repeat(129), `${'A'.repeat(42)}!`, 5]) {
      t.logs.clear();
      await token(u1.id, 'PasswordResetRequested', { token_ref: bad });
      expect(levelCount('error')).toBe(1);
      if (typeof bad === 'string') expect(t.logs.lines.join('\n')).not.toContain(bad);
    }
    expect([t.mail.calls.length, await count(t, 'email_deliveries')]).toEqual([0, 0]);
    for (const ok of ['A'.repeat(43), 'b'.repeat(128)]) await token(u1.id, 'PasswordResetRequested', { token_ref: ok });
    expect(t.mail.calls).toHaveLength(2);
  });

  it('NTF-TC-20261006-104225862: EmailVerificationRequested đã hết hạn lúc xử lý thì không gửi (log warn); thiếu hoặc sai expires_at thì log error; không dòng email nào', async () => {
    const u2 = await mkUser(t);
    await token(u2.id, 'EmailVerificationRequested', { expires_at: new Date(t.clock.now().getTime() - 5 * MIN).toISOString() });
    expect([levelCount('warn'), levelCount('error')]).toEqual([1, 0]);
    t.logs.clear();
    await token(u2.id, 'EmailVerificationRequested', { expires_at: undefined });
    await token(u2.id, 'EmailVerificationRequested', { expires_at: 'không phải ngày' });
    expect([levelCount('warn'), levelCount('error')]).toEqual([0, 2]);
    expect([t.mail.calls.length, await count(t, 'email_deliveries')]).toEqual([0, 0]);
  });

  it('NTF-TC-20261006-104225928 (T18): lý do khóa tự do của admin không vào email; mọi reason ngoài too_many_attempts dùng câu của admin', async () => {
    const u3 = await mkUser(t, { email: 'u3@shop.vn' });
    const sentence = 'Tài khoản của bạn đã bị quản trị viên khóa. Vui lòng liên hệ cửa hàng để biết thêm.';
    for (const payload of [{ reason: 'admin', lock_note: 'Gian lận đơn #123', reason_text: 'Gian lận đơn #123' }, { reason: 'something-else' }, {}]) await emit(t, 'UserLocked', { user_id: u3.id, ...payload });
    await t.email.sendDue({ now: new Date(Date.now() + 1000) });
    expect(t.mail.calls).toHaveLength(3);
    for (const m of t.mail.msgs) expect(m.text).toContain(sentence);
    expect((await mailsOf(t, u3.id)).map((m) => m.data)).toEqual([{ reason: 'admin' }, { reason: 'admin' }, { reason: 'admin' }]); // dữ liệu lưu chỉ có mã đã chuẩn hóa, không có giá trị lạ
    expect(await everything()).not.toMatch(/Gian lận|#123/);
  });

  it('NTF-TC-20261006-104225997 (SB-26): tài khoản chưa xác minh nhận email đặt lại mật khẩu nhưng email báo đổi mật khẩu bị bỏ qua unverified (thông báo trong ứng dụng vẫn có)', async () => {
    const u4 = await mkUser(t, { verified: false, email: 'u4@shop.vn' });
    await token(u4.id, 'PasswordResetRequested');
    await emit(t, 'PasswordChanged', { user_id: u4.id, changed_at: new Date().toISOString() });
    await t.email.sendDue({ now: new Date(Date.now() + 1000) });
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0].subject).toBe('Đặt lại mật khẩu');
    expect((await mailsOf(t, u4.id)).map((m) => [m.type, m.delivery_status, m.delivery_reason]).sort()).toEqual([['password_changed', 'skipped', 'unverified'], ['password_reset', 'sent', null]]);
    expect((await notesOf(t, u4.id)).map((n) => n.type)).toEqual(['password_changed']);
  });

  it('NTF-TC-20261006-104226068 (T9): email trong payload UserRegistered không được dùng, lưu hay log; địa chỉ gửi luôn hỏi AUTH lúc gửi', async () => {
    const u5 = await mkUser(t, { email: 'u5.moi@shop.vn', verified: false });
    await emit(t, 'UserRegistered', { user_id: u5.id, email: 'x@shop.vn' });
    await token(u5.id, 'EmailVerificationRequested');
    expect(t.mail.msgs.map((m) => m.to)).toEqual(['u5.moi@shop.vn']);
    expect((await notesOf(t, u5.id))[0].body).not.toContain('x@shop.vn');
    expect(await everything()).not.toContain('x@shop.vn');
  });

  it('NTF-TC-20261006-104226136: expires_at còn 1 giây vẫn gửi email xác minh (thân nêu hạn); đúng bằng lúc xử lý thì không gửi (log warn)', async () => {
    const u2 = await mkUser(t, { email: 'u2@shop.vn' });
    t.clock.set(new Date('2026-10-06T09:30:00Z')); // fixed-clock: ví dụ của TC cố định 09:30:00Z và expires_at 09:30:01Z
    await token(u2.id, 'EmailVerificationRequested', { expires_at: '2026-10-06T09:30:01Z' });
    expect(t.mail.calls).toHaveLength(1);
    expect(t.mail.msgs[0].text).toContain('06/10/2026 16:30');
    await token(u2.id, 'EmailVerificationRequested', { expires_at: '2026-10-06T09:30:00Z' }); // fixed-clock: ví dụ của TC, giờ Việt Nam tính từ chuỗi cố định
    expect(t.mail.calls).toHaveLength(1);
    expect(logsOf(t, 'warn').filter((r) => r.code === 'token-expired')).toHaveLength(1);
    expect(randomUUID()).toBeTruthy();
    expect(CODE).toBeTruthy();
  });
});
