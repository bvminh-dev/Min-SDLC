import { hashPassword } from '../../src/modules/auth/crypto';
import { PASSWORD, createAuthApp, get, post, q, seedSession, seedUser, type AuthApp } from '../support/auth';
import { truncateAll } from '../support/db';

describe('Đăng nhập (AUTH-REQ-20261006-095515738)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.logs.clear(); t.clock.set(new Date('2026-10-06T10:00:00.000Z')); });
  const attempt = (email: string, password: string, ip = '10.0.0.1') => post(t, '/auth/login', { email, password }, { ip });
  const userRow = async (email: string) => (await q<any>(t, `SELECT status, failed_login_count, locked_reason, locked_until, password_hash FROM users WHERE email = '${email}'::citext`))[0];

  it('AUTH-TC-20261006-100641243: đăng nhập thành công customer và staff; cookie đúng thuộc tính; audit cùng giao dịch; cookie đặt sẵn bị bỏ (chống session fixation)', async () => {
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const r = await attempt('  U1@Shop.VN ', PASSWORD);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: u1.id, role: 'customer', email: 'u1@shop.vn' });
    expect(JSON.stringify(r.body)).not.toContain('csrf_token');
    const cookie = String(r.headers['set-cookie'][0]);
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(cookie).toContain(attr);
    expect(cookie).not.toMatch(/Max-Age|Expires/i); // cookie phiên
    expect(await q(t, `SELECT status FROM sessions WHERE user_id = '${u1.id}'`)).toEqual([{ status: 'active' }]);
    expect((await userRow('u1@shop.vn')).failed_login_count).toBe(0);
    const audit = await q<any>(t, "SELECT actor_id, actor_role, action, after FROM audit_logs WHERE action = 'auth.login'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: u1.id, actor_role: 'customer' });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);

    const staff = await seedUser(t, { email: 's1@shop.vn', role: 'staff' });
    expect((await attempt(staff.email, PASSWORD)).body.user.role).toBe('staff');

    const X = 'X'.repeat(43);
    const fixed = await post(t, '/auth/login', { email: u1.email, password: PASSWORD }, { cookie: `sid=${X}`, ip: '10.0.0.2' });
    expect(fixed.status).toBe(200);
    const fresh = String(fixed.headers['set-cookie'][0]).split(';')[0];
    expect(fresh).not.toBe(`sid=${X}`);
    expect(await q(t, "SELECT count(*)::int AS n FROM sessions WHERE token_hash = encode(sha256('" + X + "'::bytea), 'hex')")).toEqual([{ n: 0 }]);
    expect((await get(t, '/auth/session', `sid=${X}`)).status).toBe(401);

    // đăng nhập CSRF (AUTH-SEC T8): trang khác gửi đăng nhập từ trình duyệt (có Origin lạ, chưa có cookie) bị chặn trước khi đặt cookie
    const evil = await post(t, '/auth/login', { email: u1.email, password: PASSWORD }, { origin: 'https://evil.example', ip: '10.0.0.3' });
    expect([evil.status, evil.body.type, evil.headers['set-cookie']]).toEqual([403, 'urn:ecom:error:csrf_failed', undefined]);
    expect((await userRow('u1@shop.vn')).failed_login_count).toBe(0);
  });

  it('AUTH-TC-20261006-100641289: mọi thất bại cùng 401 và cùng thân (không phân biệt được email lạ, sai mật khẩu, khóa tạm, khóa admin), độ trễ cùng bậc; thiếu trường 400; 11 lần mỗi phút thì 429', async () => {
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const unknown = await attempt('none@shop.vn', 'bad', '10.1.0.1');
    const wrong = await attempt(u1.email, 'bad', '10.1.0.2');
    for (const r of [unknown, wrong]) {
      expect(r.status).toBe(401);
      expect(r.body.type).toBe('urn:ecom:error:invalid_credentials');
    }
    const shape = (b: any) => ({ type: b.type, title: b.title, detail: b.detail, status: b.status });
    expect(shape(unknown.body)).toEqual(shape(wrong.body));
    expect(unknown.headers['set-cookie']).toBeUndefined();
    expect(await q(t, 'SELECT 1 FROM sessions')).toHaveLength(0);

    // khóa tạm đúng ở lần sai thứ 5 (không sớm, không muộn), rồi mật khẩu ĐÚNG vẫn 401 chung
    const lk = await seedUser(t, { email: 'lk@shop.vn' });
    for (let i = 0; i < 4; i++) await attempt(lk.email, `bad-${i}`, `10.1.1.${i + 1}`);
    expect(await userRow(lk.email)).toMatchObject({ status: 'active', failed_login_count: 4 });
    await attempt(lk.email, 'bad-4', '10.1.1.5');
    expect(await userRow(lk.email)).toMatchObject({ status: 'locked', failed_login_count: 5, locked_reason: 'too_many_attempts' });
    const locked = await attempt(lk.email, PASSWORD, '10.1.1.9');
    expect(locked.status).toBe(401);
    expect(shape(locked.body)).toEqual(shape(wrong.body));
    expect((await userRow(lk.email)).status).toBe('locked');

    const adm = await seedUser(t, { email: 'locked@shop.vn', status: 'locked', lockedReason: 'admin' });
    const byAdmin = await attempt(adm.email, PASSWORD, '10.1.1.10');
    expect(byAdmin.status).toBe(401);
    expect(shape(byAdmin.body)).toEqual(shape(wrong.body));

    expect((await post(t, '/auth/login', { password: 'x' }, { ip: '10.1.2.1' })).status).toBe(400);
    expect((await post(t, '/auth/login', { email: 'a@shop.vn' }, { ip: '10.1.2.2' })).status).toBe(400);

    for (let i = 0; i < 10; i++) await attempt(`ghost${i}@shop.vn`, 'bad', '10.1.3.1');
    const victim = await seedUser(t, { email: 'victim@shop.vn' });
    const limited = await attempt(victim.email, 'bad', '10.1.3.1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await userRow(victim.email)).failed_login_count).toBe(0);

    // độ trễ: trung vị của 30 lần mỗi nhánh chênh nhau dưới 30% (băm giả khi email không có).
    // Hai nhánh đo XEN KẼ (không đo hết nhánh này rồi mới sang nhánh kia) để tải máy trôi theo thời gian ảnh hưởng đều cả hai (review USR: bản tuần tự đỏ một lần ở 0,325 khi máy nặng).
    const pool = await Promise.all(Array.from({ length: 30 }, (_, i) => seedUser(t, { email: `m${i}@shop.vn` })));
    const timed = async (fn: () => Promise<unknown>) => { const s0 = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - s0) / 1e6; };
    const knownMs: number[] = [], ghostMs: number[] = [];
    for (let i = 0; i < 30; i++) {
      knownMs.push(await timed(() => attempt(pool[i].email, 'bad', `10.2.0.${i + 1}`)));
      ghostMs.push(await timed(() => attempt(`nobody${i}@shop.vn`, 'bad', `10.2.1.${i + 1}`)));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const known = median(knownMs), ghost = median(ghostMs);
    expect(Math.abs(known - ghost) / Math.max(known, ghost)).toBeLessThan(0.3);
    expect(t.logs.lines.join('\n')).not.toContain('nobody0@shop.vn'); // email lạ không vào log (REQ-738 BR7)
  }, 60_000);

  it('AUTH-TC-20261006-100641333: bộ đếm sai nguyên tử và về 0 khi đúng, hết khóa tạm, thay phiên của request, chuẩn hóa email, băm lại khi tham số đổi', async () => {
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    for (let i = 0; i < 4; i++) await attempt(u1.email, 'bad', `10.3.0.${i + 1}`);
    expect((await userRow(u1.email)).failed_login_count).toBe(4);
    expect((await attempt(u1.email, PASSWORD, '10.3.0.9')).status).toBe(200);
    expect((await userRow(u1.email)).failed_login_count).toBe(0);
    await attempt(u1.email, 'bad', '10.3.0.10');
    expect(await userRow(u1.email)).toMatchObject({ failed_login_count: 1, status: 'active' });

    // 10 yêu cầu sai song song: khóa đúng một lần, một UserLocked, một audit hệ thống, không mất lần đếm
    const u2 = await seedUser(t, { email: 'u2@shop.vn' });
    const par = await Promise.all(Array.from({ length: 10 }, (_, i) => attempt(u2.email, `bad-${i}`, `10.3.1.${i + 1}`)));
    expect(par.every((r) => r.status === 401)).toBe(true);
    expect(await userRow(u2.email)).toMatchObject({ status: 'locked', locked_reason: 'too_many_attempts', failed_login_count: 10 });
    expect(await q(t, "SELECT payload FROM outbox_events WHERE type = 'UserLocked'")).toEqual([{ payload: { user_id: u2.id, reason: 'too_many_attempts' } }]);
    expect(await q(t, "SELECT actor_id, actor_role FROM audit_logs WHERE action = 'user.lock_temporary'")).toEqual([{ actor_id: null, actor_role: 'system' }]);

    // đúng 15 phút sau thì tự mở
    t.clock.advance(15 * 60_000);
    expect((await attempt(u2.email, PASSWORD, '10.3.2.1')).status).toBe(200);
    expect(await userRow(u2.email)).toMatchObject({ status: 'active', locked_reason: null, locked_until: null });

    // đếm lại từ 1 khi lần sai trước đã quá 15 phút
    const u4 = await seedUser(t, { email: 'u4@shop.vn' });
    for (let i = 0; i < 4; i++) await attempt(u4.email, 'bad', `10.3.4.${i + 1}`);
    t.clock.advance(15 * 60_000 + 1000);
    await attempt(u4.email, 'bad', '10.3.4.9');
    expect(await userRow(u4.email)).toMatchObject({ failed_login_count: 1, status: 'active' });

    // phiên cũ của request bị thay
    t.clock.set(new Date('2026-10-06T12:00:00.000Z'));
    const a = await seedUser(t, { email: 'a@shop.vn' }), b = await seedUser(t, { email: 'b@shop.vn' });
    const sa = await seedSession(t, a.id);
    const r = await post(t, '/auth/login', { email: b.email, password: PASSWORD }, { cookie: sa.cookie, ip: '10.3.5.1' });
    expect(r.status).toBe(200);
    expect(await q(t, `SELECT status, revoked_reason FROM sessions WHERE id = '${sa.id}'`)).toEqual([{ status: 'revoked', revoked_reason: 'replaced' }]);
    expect(await q(t, `SELECT payload FROM outbox_events WHERE type = 'SessionRevoked'`)).toEqual([{ payload: { session_id: sa.id, user_id: a.id, reason: 'replaced' } }]);
    const fresh = await q<any>(t, `SELECT id FROM sessions WHERE user_id = '${b.id}'`);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(sa.id);

    // chuẩn hóa email
    const c = await seedUser(t, { email: 'u1x@shop.vn' });
    expect((await attempt('  U1X@Shop.VN ', PASSWORD, '10.3.6.1')).body.user.id).toBe(c.id);

    // băm lại khi tham số đổi (SB-01): sai không đổi băm; đúng thì băm mới mang tham số hiện hành; vẫn đăng nhập được
    const oldHash = await hashPassword(PASSWORD, { memory: 12288, passes: 2, parallelism: 1 });
    const old = await seedUser(t, { email: 'old@shop.vn', hash: oldHash });
    await attempt(old.email, 'bad', '10.3.7.1');
    expect((await userRow(old.email)).password_hash).toBe(oldHash);
    expect((await attempt(old.email, PASSWORD, '10.3.7.2')).status).toBe(200);
    const fresh2 = (await userRow(old.email)).password_hash as string;
    expect(fresh2).not.toBe(oldHash);
    expect(fresh2).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await attempt(old.email, PASSWORD, '10.3.7.3')).status).toBe(200);
  }, 60_000);
});
