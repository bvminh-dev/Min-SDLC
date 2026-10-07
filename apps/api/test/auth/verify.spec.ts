import { PASSWORD, createAuthApp, get, http, login, post, q, seedToken, seedUser, sleep, type AuthApp } from '../support/auth';
import { ORIGIN } from '../support/app';
import { waitFor } from '../support/boot';
import { PrismaService, TransactionService } from '../../src/modules/platform';
import { truncateAll } from '../support/db';

const until = (cond: () => boolean) => waitFor(cond, 5000, 20);
const sameProblem = (rows: { body: any }[]) => {
  const pick = (b: any) => ({ type: b.type, title: b.title, detail: b.detail, status: b.status });
  for (const r of rows) expect(pick(r.body)).toEqual(pick(rows[0].body));
};

describe('Xác minh email và gửi lại (AUTH-REQ-20261006-095515665, AUTH-REQ-20261006-095515702)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.clock.set(new Date('2026-10-06T10:00:00.000Z')); });
  const userOf = (email: string) => q<{ email_verified_at: Date | null }>(t, `SELECT email_verified_at FROM users WHERE email = '${email}'::citext`).then((r) => r[0]);

  it('AUTH-TC-20261006-100640975: xác minh thành công bằng token từ event; chỉ token mới ghi được email_verified_at', async () => {
    expect((await post(t, '/auth/register', { email: 'u1@shop.vn', password: PASSWORD, full_name: 'U1' })).status).toBe(202);
    await until(() => t.mails.length === 1);
    const T = t.mails[0].token;
    t.clock.advance(5_000);
    const v = await post(t, '/auth/verify-email', { token: T }); // không cookie
    expect(v.status).toBe(200);
    expect(v.body).toEqual({ verified: true });
    expect((await userOf('u1@shop.vn')).email_verified_at?.toISOString()).toBe(t.clock.now().toISOString());
    expect(await q(t, "SELECT status, used_at FROM email_verification_tokens")).toEqual([{ status: 'used', used_at: t.clock.now() }]);
    expect((await q(t, "SELECT type FROM outbox_events WHERE type = 'EmailVerified'"))).toHaveLength(1);

    // token khác còn issued của user chuyển expired
    const u2 = await seedUser(t, { verified: false });
    await seedToken(t, 'verify', u2.id, { status: 'expired' });
    const b = await seedToken(t, 'verify', u2.id);
    expect((await post(t, '/auth/verify-email', { token: b })).status).toBe(200);
    expect(await q(t, `SELECT status FROM email_verification_tokens WHERE user_id = '${u2.id}' ORDER BY status::text`)).toEqual([{ status: 'expired' }, { status: 'used' }]); // không còn token issued nào (mỗi user tối đa một token sống)

    // không có đường nào khác ghi email_verified_at
    const u3 = await seedUser(t, { verified: false, email: 'u3@shop.vn' });
    const cookie = await login(t, u3);
    const targets: [string, string, string?][] = [
      ['post', '/auth/register'], ['post', '/auth/login'], ['post', '/auth/verify-email'], ['post', '/auth/verify-email/resend'], ['post', '/auth/logout'],
      ['post', '/auth/password/forgot'], ['post', '/auth/password/reset'], ['post', `/admin/users/${u3.id}/lock`], ['post', `/admin/users/${u3.id}/unlock`],
    ];
    for (const [, path] of targets) {
      for (const body of [{ email_verified_at: '2026-01-01T00:00:00Z' }, { email_verified: true }]) {
        const r = await post(t, path, body, { cookie });
        expect([path, r.status >= 400 && r.status < 500]).toEqual([path, true]);
      }
    }
    for (const body of [{ email_verified_at: '2026-01-01T00:00:00Z' }, { email_verified: true }]) {
      const r = await http(t).patch(`/api/v1/admin/users/${u3.id}/role`).set('Origin', ORIGIN).set('Cookie', cookie).set('Content-Type', 'application/json').send(JSON.stringify(body));
      expect(r.status >= 400 && r.status < 500).toBe(true);
    }
    expect((await userOf('u3@shop.vn')).email_verified_at).toBeNull();
  });

  it('AUTH-TC-20261006-100641021: token sai, đã dùng, quá hạn cùng một lỗi 400; thiếu hoặc sai dạng bị chặn ở schema (không truy vấn bảng token); 429 sau 30 lần', async () => {
    const u = await seedUser(t, { verified: false });
    const used = await seedToken(t, 'verify', u.id, { status: 'used' });
    const expired = await seedToken(t, 'verify', u.id, { status: 'expired' });
    const rows = [];
    for (const tok of ['x'.repeat(43), used, expired]) rows.push(await post(t, '/auth/verify-email', { token: tok }, { ip: '10.1.0.1' }));
    expect(rows.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(rows[0].body.type).toBe('urn:ecom:error:invalid_or_expired_token');
    sameProblem(rows);
    expect((await userOf(u.email)).email_verified_at).toBeNull();

    const spyQuery = jest.spyOn(t.app.get(PrismaService), '$queryRaw');
    const spyExec = jest.spyOn(t.app.get(PrismaService), '$executeRaw');
    const spyTx = jest.spyOn(t.app.get(TransactionService), 'run');
    try {
      for (const body of [{}, { token: 'x' }]) expect((await post(t, '/auth/verify-email', body, { ip: '10.1.0.2' })).status).toBe(400);
      const tableTouched = [...spyQuery.mock.calls, ...spyExec.mock.calls].some(([s]: any[]) => String(Array.isArray(s) ? s.join('') : s?.sql ?? s).includes('email_verification_tokens'));
      expect(tableTouched).toBe(false);
      expect(spyTx).not.toHaveBeenCalled();
    } finally { spyQuery.mockRestore(); spyExec.mockRestore(); spyTx.mockRestore(); }

    for (let i = 0; i < 30; i++) await post(t, '/auth/verify-email', { token: 'y'.repeat(43) }, { ip: '10.1.0.9' });
    const over = await post(t, '/auth/verify-email', { token: 'y'.repeat(43) }, { ip: '10.1.0.9' });
    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('AUTH-TC-20261006-100641066: dùng đồng thời chỉ một thắng; ranh giới hạn 1 giây; token của người khác; mở lại link cũ; GET không tiêu thụ token', async () => {
    const u = await seedUser(t, { verified: false });
    const T = await seedToken(t, 'verify', u.id);
    const both = await Promise.all([post(t, '/auth/verify-email', { token: T }, { ip: '10.2.0.1' }), post(t, '/auth/verify-email', { token: T }, { ip: '10.2.0.2' })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'EmailVerified'")).toHaveLength(1);

    const a = await seedUser(t, { verified: false }), b = await seedUser(t, { verified: false });
    const near = await seedToken(t, 'verify', a.id, { expiresAt: new Date(t.clock.now().getTime() + 1000) });
    const past = await seedToken(t, 'verify', b.id, { expiresAt: new Date(t.clock.now().getTime() - 1000) });
    expect((await post(t, '/auth/verify-email', { token: near }, { ip: '10.2.0.3' })).status).toBe(200);
    expect((await post(t, '/auth/verify-email', { token: past }, { ip: '10.2.0.4' })).status).toBe(400);

    const u1 = await seedUser(t, { verified: false }), u2 = await seedUser(t, { verified: false });
    const T1 = await seedToken(t, 'verify', u1.id);
    const c2 = await login(t, u2);
    expect((await post(t, '/auth/verify-email', { token: T1 }, { cookie: c2, ip: '10.2.0.5' })).status).toBe(200);
    expect((await userOf(u1.email)).email_verified_at).not.toBeNull();
    expect((await userOf(u2.email)).email_verified_at).toBeNull();
    expect((await get(t, '/auth/session', c2)).body.user.email_verified).toBe(false); // phiên u2 không đổi
    expect((await post(t, '/auth/verify-email', { token: T1 }, { ip: '10.2.0.6' })).status).toBe(400); // mở lại link cũ

    const u3 = await seedUser(t, { verified: false });
    const T3 = await seedToken(t, 'verify', u3.id);
    const g = await get(t, `/auth/verify-email?token=${T3}`);
    expect([404, 405]).toContain(g.status);
    expect(await q(t, `SELECT status FROM email_verification_tokens WHERE user_id = '${u3.id}'`)).toEqual([{ status: 'issued' }]);
  });

  it('AUTH-TC-20261006-100641110: customer chưa xác minh gửi lại: token cũ hết hiệu lực, token mới 24 giờ, đúng một event (không qua outbox)', async () => {
    const u = await seedUser(t, { verified: false });
    const T1 = await seedToken(t, 'verify', u.id, { createdAt: new Date(t.clock.now().getTime() - 70_000) });
    const cookie = await login(t, u);
    const r = await post(t, '/auth/verify-email/resend', undefined, { cookie });
    expect(r.status).toBe(202);
    expect(r.body.resend_available_at).toBe(new Date(t.clock.now().getTime() + 60_000).toISOString());
    await until(() => t.mails.length === 1);
    const toks = await q<any>(t, `SELECT status, expires_at, created_at FROM email_verification_tokens WHERE user_id = '${u.id}' ORDER BY created_at`);
    expect(toks.map((x) => x.status)).toEqual(['expired', 'issued']);
    expect(toks[1].expires_at.getTime() - toks[1].created_at.getTime()).toBe(24 * 3600_000);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'EmailVerificationRequested' OR payload::text LIKE '%token%'")).toHaveLength(0);
    expect((await post(t, '/auth/verify-email', { token: T1 })).status).toBe(400);
    expect((await post(t, '/auth/verify-email', { token: t.mails[0].token })).status).toBe(200);
  });

  it('AUTH-TC-20261006-100641154: gửi lại bị từ chối: đã xác minh 409, chưa đăng nhập hoặc hết phiên 401, quá nhanh 429, Origin lạ hoặc thiếu 403', async () => {
    const ver = await seedUser(t, { verified: true });
    const cv = await login(t, ver);
    const r409 = await post(t, '/auth/verify-email/resend', undefined, { cookie: cv });
    expect(r409.status).toBe(409);
    expect(r409.body.type).toBe('urn:ecom:error:already_verified');
    expect(await q(t, "SELECT 1 FROM email_verification_tokens")).toHaveLength(0);
    expect(t.mails).toHaveLength(0);

    expect((await post(t, '/auth/verify-email/resend', undefined)).status).toBe(401);
    const old = await login(t, await seedUser(t, { verified: false }));
    t.clock.advance(31 * 60_000);
    const expired = await post(t, '/auth/verify-email/resend', undefined, { cookie: old });
    expect(expired.status).toBe(401);
    expect(expired.body.type).toBe('urn:ecom:error:session_expired');

    const u = await seedUser(t, { verified: false });
    await seedToken(t, 'verify', u.id, { createdAt: new Date(t.clock.now().getTime() - 20_000) });
    const cu = await login(t, u);
    const fast = await post(t, '/auth/verify-email/resend', undefined, { cookie: cu });
    expect(fast.status).toBe(429);
    expect(Number(fast.headers['retry-after'])).toBe(40);
    expect(await q(t, `SELECT status FROM email_verification_tokens WHERE user_id = '${u.id}'`)).toEqual([{ status: 'issued' }]);
    expect(t.mails).toHaveLength(0);

    t.clock.advance(61_000);
    const cu2 = await login(t, u);
    for (const origin of ['https://evil.example', null]) {
      const r = await post(t, '/auth/verify-email/resend', undefined, { cookie: cu2, origin });
      expect([origin, r.status, r.body.type]).toEqual([origin, 403, 'urn:ecom:error:csrf_failed']);
    }
    expect(await q(t, `SELECT 1 FROM email_verification_tokens WHERE user_id = '${u.id}'`)).toHaveLength(1);
  });

  it('AUTH-TC-20261006-100641199: gửi lại hai lần sát nhau, quá 5 lần trong giờ rồi hết cửa sổ, link cũ sau khi gửi lại, staff bị 403', async () => {
    const u = await seedUser(t, { verified: false });
    let cookie = await login(t, u);
    const pair = await Promise.all([post(t, '/auth/verify-email/resend', undefined, { cookie }), post(t, '/auth/verify-email/resend', undefined, { cookie })]);
    expect(pair.map((r) => r.status).sort()).toEqual([202, 429]);
    await sleep(100);
    expect(t.mails).toHaveLength(1);
    const T1 = t.mails[0].token;

    for (let i = 0; i < 4; i++) { t.clock.advance(61_000); cookie = await login(t, u); expect((await post(t, '/auth/verify-email/resend', undefined, { cookie })).status).toBe(202); }
    t.clock.advance(61_000); cookie = await login(t, u);
    expect((await post(t, '/auth/verify-email/resend', undefined, { cookie })).status).toBe(429); // lần thứ 6 trong giờ
    t.clock.advance(3_600_000); cookie = await login(t, u);
    expect((await post(t, '/auth/verify-email/resend', undefined, { cookie })).status).toBe(202); // hết cửa sổ một giờ
    await until(() => t.mails.length === 6);
    const T2 = t.mails[5].token;
    expect((await post(t, '/auth/verify-email', { token: T1 })).status).toBe(400); // link cũ
    expect((await post(t, '/auth/verify-email', { token: T2 })).status).toBe(200);

    const staff = await seedUser(t, { role: 'staff', verified: false });
    expect((await post(t, '/auth/verify-email/resend', undefined, { cookie: await login(t, staff) })).status).toBe(403);
  });
});
