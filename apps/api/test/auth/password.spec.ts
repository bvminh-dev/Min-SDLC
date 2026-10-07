import { createAuthApp, login, medianMs, post, q, seedToken, seedUser, type AuthApp } from '../support/auth';
import { truncateAll } from '../support/db';
import { waitFor } from '../support/boot';

const min = (n: number) => n * 60_000;
const until = (cond: () => boolean) => waitFor(cond, 5000, 20);
const GENERIC = 'Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.';

describe('Quên và đặt lại mật khẩu (AUTH-REQ-20261006-095515843, AUTH-REQ-20261006-095515881)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.logs.clear(); t.clock.set(new Date('2026-10-06T10:00:00.000Z')); });
  const forgot = async (email: string, ip = '10.0.0.1') => { const r = await post(t, '/auth/password/forgot', { email }, { ip }); await t.auth.idle(); await new Promise((res) => setTimeout(res, 40)); return r; }; // chờ việc sau phản hồi và event in-process
  const resetTokens = (userId: string) => q<any>(t, `SELECT status, token_hash, expires_at, created_at FROM password_reset_tokens WHERE user_id = '${userId}' ORDER BY created_at, status::text`);
  const userRow = async (email: string) => (await q<any>(t, `SELECT status, failed_login_count, locked_until, locked_reason FROM users WHERE email = '${email}'::citext`))[0];

  it('AUTH-TC-20261006-100641685: quên mật khẩu tạo token băm hạn 30 phút, phát đúng một PasswordResetRequested sau commit, không qua outbox', async () => {
    const u = await seedUser(t, { email: 'u1@shop.vn' });
    const r = await forgot('U1@Shop.vn');
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ message: GENERIC });
    await until(() => t.mails.length === 1);
    const [row] = await resetTokens(u.id);
    expect(row.status).toBe('issued');
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(min(30));
    expect(row.token_hash).not.toBe(t.mails[0].token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.mails[0]).toMatchObject({ type: 'PasswordResetRequested', user_id: u.id });
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'PasswordResetRequested' OR payload::text LIKE '%" + t.mails[0].token + "%'")).toHaveLength(0);
    expect(t.logs.lines.join('\n')).not.toContain(t.mails[0].token);
  });

  it('AUTH-TC-20261006-100641728: quên mật khẩu không phân biệt email có hay không (thân, độ trễ), email sai định dạng chỉ lỗi 400, 429 sau 20 lần, tài khoản admin khóa không có token', async () => {
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const known = await post(t, '/auth/password/forgot', { email: 'u1@shop.vn' }, { ip: '10.1.0.1' });
    const none = await post(t, '/auth/password/forgot', { email: 'none@shop.vn' }, { ip: '10.1.0.2' });
    await t.auth.idle();
    expect([known.status, none.status]).toEqual([202, 202]);
    expect(known.body).toEqual(none.body);
    expect(await q(t, 'SELECT 1 FROM password_reset_tokens')).toHaveLength(1);
    expect(t.mails).toHaveLength(1);
    expect(u1.id).toBeTruthy();

    const settle = () => t.auth.idle(); // việc sau phản hồi chạy ngoài khoảng đo
    const mk = await medianMs(30, (i) => post(t, '/auth/password/forgot', { email: 'u1@shop.vn' }, { ip: `10.1.1.${i + 1}` }), settle);
    const mn = await medianMs(30, (i) => post(t, '/auth/password/forgot', { email: `none${i}@shop.vn` }, { ip: `10.1.2.${i + 1}` }), settle);
    // YẾU: forgot trả lời trong ~1 ms nên 30% tương đối là nhiễu; ngưỡng thực dùng là 30% hoặc 2 ms tuyệt đối, cái nào lớn hơn (xem report.md, Lệch spec)
    expect(Math.abs(mk - mn)).toBeLessThan(Math.max(0.3 * Math.max(mk, mn), 2));

    for (const bad of ['', 'abc']) {
      const r = await post(t, '/auth/password/forgot', { email: bad }, { ip: '10.1.3.1' });
      expect(r.status).toBe(400);
      expect(r.body.errors.map((e: any) => e.field)).toEqual(['email']);
    }
    for (let i = 0; i < 20; i++) expect((await post(t, '/auth/password/forgot', { email: 'a@shop.vn' }, { ip: '10.1.4.1' })).status).toBe(202);
    const over = await post(t, '/auth/password/forgot', { email: 'a@shop.vn' }, { ip: '10.1.4.1' });
    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);

    const locked = await seedUser(t, { email: 'locked@shop.vn', status: 'locked', lockedReason: 'admin' });
    t.mails.length = 0;
    const r = await forgot('locked@shop.vn', '10.1.5.1');
    expect([r.status, r.body]).toEqual([202, { message: GENERIC }]);
    expect(await resetTokens(locked.id)).toHaveLength(0);
    expect(t.mails).toHaveLength(0);
  }, 60_000);

  it('AUTH-TC-20261006-100641772: yêu cầu lần hai thay token, giới hạn 5 mỗi giờ theo email vẫn 202, khóa tạm chưa hết hạn không có token', async () => {
    const u = await seedUser(t, { email: 'u1@shop.vn' });
    await forgot(u.email);
    const T1 = t.mails.at(-1)!.token;
    await forgot(u.email);
    await until(() => t.mails.length === 2);
    const T2 = t.mails.at(-1)!.token;
    expect((await resetTokens(u.id)).map((r) => r.status)).toEqual(['expired', 'issued']);
    expect((await post(t, '/auth/password/reset', { token: T1, new_password: 'New-Pass-67890' })).status).toBe(400);
    expect(T2).not.toBe(T1);

    for (let i = 0; i < 3; i++) await forgot(u.email); // tổng 5 yêu cầu
    expect(t.mails).toHaveLength(5);
    const sixth = await forgot(u.email);
    expect([sixth.status, sixth.body]).toEqual([202, { message: GENERIC }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(t.mails).toHaveLength(5); // không PasswordResetRequested thứ 6
    expect(await resetTokens(u.id)).toHaveLength(5);

    const lk = await seedUser(t, { email: 'lk@shop.vn', status: 'locked', lockedReason: 'too_many_attempts', lockedUntil: new Date(t.clock.now().getTime() + min(8)) });
    const n = t.mails.length;
    await forgot(lk.email, '10.2.0.9');
    expect(await resetTokens(lk.id)).toHaveLength(0);
    t.clock.advance(min(9)); // khóa hết hạn
    await forgot(lk.email, '10.2.0.9');
    expect(await resetTokens(lk.id)).toHaveLength(1);
    await until(() => t.mails.length === n + 1);
  });

  it('AUTH-TC-20261006-100641816: đặt lại mật khẩu thu hồi mọi phiên, ghi audit và event cùng giao dịch, không tự đăng nhập, log sạch bí mật', async () => {
    const u = await seedUser(t, { email: 'u1@shop.vn', password: 'Old-Pass-12345' });
    await login(t, u); await login(t, u);
    const T = await seedToken(t, 'reset', u.id);
    const r = await post(t, '/auth/password/reset', { token: T, new_password: 'New-Pass-67890' }, { ip: '10.3.0.1' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(await resetTokens(u.id)).toEqual([expect.objectContaining({ status: 'used' })]);
    expect(await q(t, "SELECT status, revoked_reason FROM sessions")).toEqual([{ status: 'revoked', revoked_reason: 'password_changed' }, { status: 'revoked', revoked_reason: 'password_changed' }]);
    const types = (await q<{ type: string }>(t, "SELECT type FROM outbox_events ORDER BY type")).map((o) => o.type);
    expect(types).toEqual(['PasswordChanged', 'SessionRevoked', 'SessionRevoked']);
    const audit = await q<any>(t, "SELECT actor_id, action, before, after, reason FROM audit_logs WHERE action = 'auth.password_reset'");
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(u.id);
    expect(JSON.stringify(audit)).not.toMatch(/Pass-|[A-Za-z0-9_-]{43}/);

    expect((await post(t, '/auth/login', { email: u.email, password: 'Old-Pass-12345' }, { ip: '10.3.0.2' })).status).toBe(401);
    expect((await post(t, '/auth/login', { email: u.email, password: 'New-Pass-67890' }, { ip: '10.3.0.3' })).status).toBe(200);
    const logs = t.logs.lines.join('\n');
    for (const secret of ['Old-Pass-12345', 'New-Pass-67890', T]) expect(logs).not.toContain(secret);
  });

  it('AUTH-TC-20261006-100641859: đặt lại bị từ chối: token sai, đã dùng, quá hạn, của user bị admin khóa (cùng 400); mật khẩu sai chính sách giữ token; thiếu trường; 429', async () => {
    const u = await seedUser(t, { email: 'u1@shop.vn' });
    const used = await seedToken(t, 'reset', u.id, { status: 'used' });
    const expired = await seedToken(t, 'reset', u.id, { status: 'expired' });
    const adm = await seedUser(t, { email: 'adm@shop.vn', status: 'locked', lockedReason: 'admin' });
    const lockedTok = await seedToken(t, 'reset', adm.id);
    const bodies = [];
    for (const token of ['x'.repeat(43), used, expired, lockedTok]) {
      const r = await post(t, '/auth/password/reset', { token, new_password: 'New-Pass-67890' }, { ip: '10.4.0.1' });
      expect([r.status, r.body.type]).toEqual([400, 'urn:ecom:error:invalid_or_expired_token']);
      bodies.push({ title: r.body.title, detail: r.body.detail });
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect(await resetTokens(adm.id)).toEqual([expect.objectContaining({ status: 'issued' })]);

    const T = await seedToken(t, 'reset', u.id);
    const short = await post(t, '/auth/password/reset', { token: T, new_password: 'Abcdefg12' }, { ip: '10.4.0.2' });
    expect([short.status, short.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']);
    expect(short.body.errors).toEqual([{ field: 'new_password', code: 'too_short' }]);
    const same = await post(t, '/auth/password/reset', { token: T, new_password: 'U1@Shop.VN  ' }, { ip: '10.4.0.2' });
    expect(same.status).toBe(400);
    expect(same.body.errors).toEqual([{ field: 'new_password', code: 'same_as_email' }]);
    expect((await resetTokens(u.id)).find((x) => x.status === 'issued')).toBeTruthy(); // token chưa bị tiêu thụ
    expect((await post(t, '/auth/password/reset', { token: T, new_password: 'New-Pass-67890' }, { ip: '10.4.0.2' })).status).toBe(200);

    expect((await post(t, '/auth/password/reset', { new_password: 'New-Pass-67890' }, { ip: '10.4.0.3' })).status).toBe(400);
    expect((await post(t, '/auth/password/reset', { token: T }, { ip: '10.4.0.3' })).status).toBe(400);
    for (let i = 0; i < 10; i++) await post(t, '/auth/password/reset', { token: 'z'.repeat(43), new_password: 'New-Pass-67890' }, { ip: '10.4.9.9' });
    const over = await post(t, '/auth/password/reset', { token: 'z'.repeat(43), new_password: 'New-Pass-67890' }, { ip: '10.4.9.9' });
    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('AUTH-TC-20261006-100641902: đặt lại: dùng đồng thời một thắng, khóa tạm không bị gỡ, user bị admin khóa không tiêu thụ token, ranh giới hạn token và độ dài mật khẩu', async () => {
    const u = await seedUser(t, { email: 'u1@shop.vn' });
    const T = await seedToken(t, 'reset', u.id);
    const both = await Promise.all([1, 2].map((i) => post(t, '/auth/password/reset', { token: T, new_password: 'New-Pass-67890' }, { ip: `10.5.0.${i}` })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'PasswordChanged'")).toHaveLength(1);

    const lockedUntil = new Date(t.clock.now().getTime() + min(8));
    const lk = await seedUser(t, { email: 'lk@shop.vn', status: 'locked', lockedReason: 'too_many_attempts', lockedUntil });
    await t.prisma.$executeRaw`UPDATE users SET failed_login_count = 5, last_failed_login_at = ${t.clock.now()}::timestamptz WHERE id = ${lk.id}::uuid`;
    const Tl = await seedToken(t, 'reset', lk.id);
    expect((await post(t, '/auth/password/reset', { token: Tl, new_password: 'Fresh-Pass-1234' }, { ip: '10.5.1.1' })).status).toBe(200);
    expect(await userRow(lk.email)).toMatchObject({ failed_login_count: 0, status: 'locked', locked_reason: 'too_many_attempts', locked_until: lockedUntil });
    expect((await post(t, '/auth/login', { email: lk.email, password: 'Fresh-Pass-1234' }, { ip: '10.5.1.2' })).status).toBe(401);
    t.clock.advance(min(9));
    expect((await post(t, '/auth/login', { email: lk.email, password: 'Fresh-Pass-1234' }, { ip: '10.5.1.3' })).status).toBe(200);
    expect((await userRow(lk.email)).status).toBe('active');

    const adm = await seedUser(t, { email: 'adm@shop.vn' });
    const Ta = await seedToken(t, 'reset', adm.id);
    await t.prisma.$executeRaw`UPDATE users SET status = 'locked', locked_reason = 'admin' WHERE id = ${adm.id}::uuid`; // khóa sau khi token đã phát hành
    const rA = await post(t, '/auth/password/reset', { token: Ta, new_password: 'Fresh-Pass-1234' }, { ip: '10.5.2.1' });
    expect([rA.status, rA.body.type]).toEqual([400, 'urn:ecom:error:invalid_or_expired_token']);
    expect(await resetTokens(adm.id)).toEqual([expect.objectContaining({ status: 'issued' })]);

    const a = await seedUser(t, { email: 'a@shop.vn' }), b = await seedUser(t, { email: 'b@shop.vn' });
    const near = await seedToken(t, 'reset', a.id, { expiresAt: new Date(t.clock.now().getTime() + 1000) });
    const past = await seedToken(t, 'reset', b.id, { expiresAt: new Date(t.clock.now().getTime() - 1000) });
    expect((await post(t, '/auth/password/reset', { token: near, new_password: 'Fresh-Pass-1234' }, { ip: '10.5.3.1' })).status).toBe(200);
    expect((await post(t, '/auth/password/reset', { token: past, new_password: 'Fresh-Pass-1234' }, { ip: '10.5.3.2' })).status).toBe(400);

    const c = await seedUser(t, { email: 'c@shop.vn' });
    const Tc = await seedToken(t, 'reset', c.id);
    const pw = (n: number) => 'Ab1-'.repeat(40).slice(0, n);
    const r129 = await post(t, '/auth/password/reset', { token: Tc, new_password: pw(129) }, { ip: '10.5.4.1' });
    expect([r129.status, r129.body.errors]).toEqual([400, [{ field: 'new_password', code: 'too_long' }]]);
    expect((await post(t, '/auth/password/reset', { token: Tc, new_password: pw(128) }, { ip: '10.5.4.2' })).status).toBe(200);
  });
});
