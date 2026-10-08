import { AuditService, type AuditEntry, type Tx } from '../../src/modules/platform';
import { createAdmin } from '../../src/modules/auth/create-admin';
import { NOW0, PASSWORD, createAuthApp, get, http, login, post, q, seedSession, seedUser, type AuthApp } from '../support/auth';
import { ORIGIN } from '../support/app';
import { testDbUrl, truncateAll } from '../support/db';

describe('Quản trị người dùng (AUTH-REQ-20261006-095515956, AUTH-REQ-20261006-095515994)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.clock.set(new Date(NOW0)); });
  const asAdmin = async () => { const u = await seedUser(t, { role: 'admin', email: `adm${Math.random().toString(36).slice(2, 8)}@shop.vn` }); return { ...u, cookie: await login(t, u) }; };
  const patchRole = (id: string, cookie: string | undefined, body: unknown, origin: string | null = ORIGIN) => {
    let r = http(t).patch(`/api/v1/admin/users/${id}/role`).set('Content-Type', 'application/json');
    if (origin) r = r.set('Origin', origin);
    if (cookie) r = r.set('Cookie', cookie);
    return r.send(JSON.stringify(body));
  };
  const lock = (id: string, cookie: string | undefined, body: unknown = {}) => post(t, `/admin/users/${id}/lock`, body, { cookie });
  const unlock = (id: string, cookie: string | undefined) => post(t, `/admin/users/${id}/unlock`, undefined, { cookie });
  const row = async (id: string) => (await q<any>(t, `SELECT role, status, locked_reason, locked_until, failed_login_count FROM users WHERE id = '${id}'`))[0];
  /**
   * Ép hai giao dịch CHỒNG NHAU: người đến audit trước chờ người kia tối đa `ms` ms. Có khóa tập admin thì giao dịch thứ hai bị chặn ở khóa,
   * không bao giờ tới audit nên hết hạn chờ rồi chạy tiếp (một thành công); thiếu khóa thì cả hai tới đủ và cùng commit (test đỏ).
   */
  const overlap = (ms = 400) => {
    const original = AuditService.prototype.record;
    let waiting: (() => void) | null = null;
    return jest.spyOn(AuditService.prototype, 'record').mockImplementation(async function (this: AuditService, tx: Tx, e: AuditEntry, o?: any) {
      await new Promise<void>((resolve) => {
        if (waiting) { waiting(); resolve(); return; }
        const t0 = setTimeout(() => { waiting = null; resolve(); }, ms);
        waiting = () => { clearTimeout(t0); waiting = null; resolve(); };
      });
      return original.call(this, tx, e, o);
    });
  };
  const counts = async () => ({ audit: (await q(t, 'SELECT 1 FROM audit_logs')).length, outbox: (await q(t, 'SELECT 1 FROM outbox_events')).length });

  it('AUTH-TC-20261006-100642082: admin xem danh sách (mới nhất trước, đủ tổng, không lộ băm), tìm theo tiền tố email, đổi role có audit cùng giao dịch, không phát event', async () => {
    const base = new Date(NOW0.getTime() - 6 * 24 * 3600_000);
    const admin = await seedUser(t, { role: 'admin', email: 'a1@shop.vn', createdAt: base });
    const cookie = await login(t, admin);
    for (let i = 1; i <= 44; i++) await seedUser(t, { email: i === 1 ? 'an@shop.vn' : i === 2 ? 'AN@zeta.vn' : i === 3 ? 'banan@shop.vn' : i === 4 ? 'a_b@shop.vn' : i === 5 ? 'axb@shop.vn' : `c${i}@shop.vn`, createdAt: new Date(base.getTime() + i * 60_000), name: `Người ${i}` });
    const page1 = await get(t, '/admin/users?page=1', cookie);
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, limit: 20, total: 45 });
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.items[0].full_name).toBe('Người 44');
    const times = page1.body.items.map((i: any) => i.created_at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(Object.keys(page1.body.items[0]).sort()).toEqual(['created_at', 'email', 'email_verified', 'full_name', 'id', 'role', 'status']);
    expect(JSON.stringify(page1.body)).not.toMatch(/password|hash|token/i);

    const prefix = await get(t, '/admin/users?q=an@', cookie);
    expect(prefix.body.items.map((i: any) => i.email).sort()).toEqual(['an@shop.vn', 'an@zeta.vn']); // không phân biệt hoa thường, đúng tiền tố
    expect((await get(t, '/admin/users?q=a_b', cookie)).body.items.map((i: any) => i.email)).toEqual(['a_b@shop.vn']); // `_` không là ký tự đại diện
    expect((await get(t, '/admin/users?role=admin&status=active', cookie)).body.total).toBe(1);

    const u1 = (await q<{ id: string }>(t, "SELECT id FROM users WHERE email = 'an@shop.vn'::citext"))[0];
    const cu = await login(t, { email: 'an@shop.vn', password: PASSWORD });
    const before = await counts();
    const r = await patchRole(u1.id, cookie, { role: 'staff' });
    expect([r.status, r.body]).toEqual([200, { id: u1.id, role: 'staff' }]);
    expect((await row(u1.id)).role).toBe('staff');
    const audit = await q<any>(t, "SELECT actor_id, actor_role, target_type, target_id, before, after FROM audit_logs WHERE action = 'user.change_role'");
    expect(audit).toEqual([{ actor_id: admin.id, actor_role: 'admin', target_type: 'user', target_id: u1.id, before: { role: 'customer' }, after: { role: 'staff' } }]);
    expect((await counts()).outbox).toBe(before.outbox); // không phát event
    expect((await get(t, '/auth/session', cu)).body.user.role).toBe('staff');

    // audit lỗi thì đổi role bị đảo (cùng giao dịch)
    const spy = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit down'));
    try {
      expect((await patchRole(u1.id, cookie, { role: 'customer' })).status).toBe(500);
    } finally { spy.mockRestore(); }
    expect((await row(u1.id)).role).toBe('staff');
  });

  it('AUTH-TC-20261006-100642126: quản trị bị từ chối: role không đủ 403, chưa đăng nhập 401, tự đổi role 403, schema 400, không tồn tại 404 cùng nội dung, role không đổi 409 không audit', async () => {
    const staff = await seedUser(t, { role: 'staff' }), cust = await seedUser(t, { role: 'customer' });
    for (const u of [staff, cust]) {
      const c = await login(t, u);
      expect([(await get(t, '/admin/users', c)).status, (await patchRole(cust.id, c, { role: 'admin' })).status]).toEqual([403, 403]);
    }
    expect((await row(cust.id)).role).toBe('customer');
    expect((await get(t, '/admin/users')).status).toBe(401);
    const old = await login(t, await seedUser(t, { role: 'admin' }));
    t.clock.advance(31 * 60_000);
    expect((await get(t, '/admin/users', old)).status).toBe(401);

    t.clock.set(new Date(NOW0));
    const a1 = await asAdmin();
    const own = await patchRole(a1.id, a1.cookie, { role: 'staff' });
    expect([own.status, own.body.type]).toEqual([403, 'urn:ecom:error:cannot_change_own_role']);
    expect((await row(a1.id)).role).toBe('admin');
    expect((await patchRole(cust.id, a1.cookie, { role: 'superuser' })).status).toBe(400);
    expect((await patchRole(cust.id, a1.cookie, {})).status).toBe(400);
    for (const qs of ['limit=500', 'q=ab', 'role=boss', 'status=zzz', 'page=0', 'foo=1']) expect([qs, (await get(t, `/admin/users?${qs}`, a1.cookie)).status]).toEqual([qs, 400]);
    const missing = await patchRole('11111111-1111-4111-8111-111111111111', a1.cookie, { role: 'staff' });
    const bad = await patchRole('abc', a1.cookie, { role: 'staff' });
    expect([missing.status, bad.status]).toEqual([404, 404]);
    const shape = (b: any) => ({ type: b.type, title: b.title, detail: b.detail, status: b.status });
    expect(shape(missing.body)).toEqual(shape(bad.body));

    const s1 = await seedUser(t, { role: 'staff' });
    const before = await counts();
    const same = await patchRole(s1.id, a1.cookie, { role: 'staff' });
    expect([same.status, same.body.type]).toEqual([409, 'urn:ecom:error:role_unchanged']);
    expect(await counts()).toEqual(before); // không audit, không event
    const csrf = await patchRole(s1.id, a1.cookie, { role: 'admin' }, 'https://evil.example');
    expect([csrf.status, csrf.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect((await row(s1.id)).role).toBe('staff');
  });

  it('AUTH-TC-20261006-100642169: hai admin hạ nhau cùng lúc chỉ một thành công và luôn còn một admin; người bị hạ mất quyền ngay; phân trang trang cuối', async () => {
    const a1 = await asAdmin(), a2 = await asAdmin();
    const spy = overlap();
    const res = await Promise.all([patchRole(a2.id, a1.cookie, { role: 'customer' }), patchRole(a1.id, a2.cookie, { role: 'customer' })]);
    spy.mockRestore();
    expect(res.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(res.map((r) => r.status).filter((s) => s === 403 || s === 409)).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM users WHERE role = 'admin' AND status = 'active'")).toHaveLength(1);

    await truncateAll(t.prisma);
    const b1 = await asAdmin(), b2 = await asAdmin();
    expect((await patchRole(b2.id, b1.cookie, { role: 'staff' })).status).toBe(200);
    expect((await get(t, '/admin/users', b2.cookie)).status).toBe(403); // ngay sau đó, cùng phiên
    const last = await patchRole(b1.id, b2.cookie, { role: 'customer' });
    expect(last.status).toBe(403);
    expect((await row(b1.id)).role).toBe('admin');

    // admin cuối: tự hạ bị cấm; hạ qua admin khác thì còn một
    for (let i = 0; i < 43; i++) await seedUser(t, { email: `p${i}@shop.vn`, createdAt: new Date(Date.now() + i * 1000) });
    expect((await q(t, 'SELECT 1 FROM users')).length).toBe(45);
    const p3 = await get(t, '/admin/users?page=3&limit=20', b1.cookie), p4 = await get(t, '/admin/users?page=4&limit=20', b1.cookie);
    expect([p3.status, p3.body.items.length, p4.status, p4.body.items]).toEqual([200, 5, 200, []]);
  });

  it('AUTH-TC-20261006-100642169: lệnh tạo admin đầu tiên (SB-29): thiếu mật khẩu hoặc mật khẩu yếu thì từ chối, không có mật khẩu mặc định, email đã có thì không đổi gì', async () => {
    const argon = { memory: 19456, passes: 2, parallelism: 1 };
    const databaseUrl = testDbUrl();
    expect((await createAdmin({ databaseUrl, email: 'root@shop.vn', argon })).ok).toBe(false); // không mật khẩu mặc định
    expect((await createAdmin({ databaseUrl, email: 'root@shop.vn', password: 'password1234', argon })).ok).toBe(false); // mật khẩu yếu
    expect((await createAdmin({ databaseUrl, email: 'khong-phai-email', password: PASSWORD, argon })).ok).toBe(false);
    expect(await q(t, 'SELECT 1 FROM users')).toHaveLength(0);
    const ok = await createAdmin({ databaseUrl, email: 'Root@Shop.vn', password: PASSWORD, argon });
    expect(ok.ok).toBe(true);
    const [u] = await q<any>(t, "SELECT role, status, email::text AS email, password_hash, email_verified_at FROM users");
    expect(u).toMatchObject({ role: 'admin', status: 'active', email: 'root@shop.vn' });
    expect(u.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(u.email_verified_at).not.toBeNull();
    expect((await post(t, '/auth/login', { email: 'root@shop.vn', password: PASSWORD })).body.user.role).toBe('admin');
    const again = await createAdmin({ databaseUrl, email: 'root@shop.vn', password: 'Another-Pass-1234', argon }); // scan-secrets:allow mật khẩu thử
    expect(again.ok).toBe(false); // email đã có: không ghi đè mật khẩu
    expect((await post(t, '/auth/login', { email: 'root@shop.vn', password: PASSWORD }, { ip: '10.0.0.5' })).status).toBe(200);
    // không có đường đăng ký admin qua API: đăng ký không nhận role (TC ...640887) và role chỉ đổi qua admin
  });

  it('AUTH-TC-20261006-100642212: admin khóa (thu hồi mọi phiên, UserLocked, audit có lý do) và mở khóa (về active, đếm sai về 0, không event)', async () => {
    const a1 = await asAdmin();
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const s1 = await seedSession(t, u1.id), s2 = await seedSession(t, u1.id);
    const r = await lock(u1.id, a1.cookie, { reason: 'gian lận thanh toán' });
    expect([r.status, r.body]).toEqual([200, { id: u1.id, status: 'locked' }]);
    expect(await row(u1.id)).toMatchObject({ status: 'locked', locked_reason: 'admin', locked_until: null });
    expect(await q(t, `SELECT status, revoked_reason FROM sessions WHERE id IN ('${s1.id}', '${s2.id}')`)).toEqual([{ status: 'revoked', revoked_reason: 'admin_lock' }, { status: 'revoked', revoked_reason: 'admin_lock' }]);
    const types = (await q<{ type: string }>(t, 'SELECT type FROM outbox_events ORDER BY type')).map((o) => o.type);
    expect(types).toEqual(['SessionRevoked', 'SessionRevoked', 'UserLocked']);
    expect(await q(t, "SELECT payload FROM outbox_events WHERE type = 'UserLocked'")).toEqual([{ payload: { user_id: u1.id, reason: 'admin' } }]);
    const audit = await q<any>(t, "SELECT actor_id, actor_role, target_id, reason FROM audit_logs WHERE action = 'user.lock'");
    expect(audit).toEqual([{ actor_id: a1.id, actor_role: 'admin', target_id: u1.id, reason: 'gian lận thanh toán' }]);
    const denied = await post(t, '/auth/login', { email: u1.email, password: u1.password });
    expect([denied.status, denied.body.type]).toEqual([401, 'urn:ecom:error:invalid_credentials']);

    await t.prisma.$executeRaw`UPDATE users SET failed_login_count = 3 WHERE id = ${u1.id}::uuid`;
    const outboxBefore = (await counts()).outbox;
    const un = await unlock(u1.id, a1.cookie);
    expect([un.status, un.body]).toEqual([200, { id: u1.id, status: 'active' }]);
    expect(await row(u1.id)).toMatchObject({ status: 'active', failed_login_count: 0, locked_reason: null });
    expect(await q(t, "SELECT 1 FROM audit_logs WHERE action = 'user.unlock'")).toHaveLength(1);
    expect((await counts()).outbox).toBe(outboxBefore); // UserUnlocked ở backlog
    expect((await post(t, '/auth/login', { email: u1.email, password: u1.password }, { ip: '10.0.0.7' })).status).toBe(200);
  });

  it('AUTH-TC-20261006-100642255: khóa bị từ chối: không đủ quyền 403, chưa đăng nhập 401, tự khóa 403, đã khóa hoặc không khóa 409 (không audit, không event), id lạ 404, lý do quá dài 400', async () => {
    const a1 = await asAdmin();
    const u1 = await seedUser(t), u2 = await seedUser(t);
    for (const role of ['staff', 'customer'] as const) {
      const c = await login(t, await seedUser(t, { role }));
      expect([(await lock(u1.id, c)).status, (await unlock(u1.id, c)).status]).toEqual([403, 403]);
    }
    expect((await lock(u1.id, undefined)).status).toBe(401);
    const self = await lock(a1.id, a1.cookie);
    expect([self.status, self.body.type]).toEqual([403, 'urn:ecom:error:cannot_lock_self']);
    expect((await row(a1.id)).status).toBe('active');

    expect((await lock(u1.id, a1.cookie)).status).toBe(200);
    const before = await counts();
    const again = await lock(u1.id, a1.cookie);
    const notLocked = await unlock(u2.id, a1.cookie);
    expect([again.status, again.body.type, notLocked.status, notLocked.body.type]).toEqual([409, 'urn:ecom:error:already_locked', 409, 'urn:ecom:error:not_locked']);
    expect(await counts()).toEqual(before);

    expect((await lock('22222222-2222-4222-8222-222222222222', a1.cookie)).status).toBe(404);
    expect((await lock(u2.id, a1.cookie, { reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await lock(u2.id, a1.cookie, { reason: 'x'.repeat(200) })).status).toBe(200); // đúng 200 ký tự thì được
    expect((await row(u2.id)).status).toBe('locked');
  });

  it('AUTH-TC-20261006-100642300: hai admin khóa nhau cùng lúc chỉ một thành công; mở khóa khóa tạm; khóa chồng 409; hai yêu cầu khóa đồng thời chỉ một event', async () => {
    const a1 = await asAdmin(), a2 = await asAdmin();
    const spy = overlap();
    const res = await Promise.all([lock(a2.id, a1.cookie), lock(a1.id, a2.cookie)]);
    spy.mockRestore();
    expect(res.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM users WHERE role = 'admin' AND status = 'active'")).toHaveLength(1);

    await truncateAll(t.prisma);
    const b1 = await asAdmin();
    const tmp = await seedUser(t, { email: 'tmp@shop.vn', status: 'locked', lockedReason: 'too_many_attempts', lockedUntil: new Date(t.clock.now().getTime() + 8 * 60_000) });
    await t.prisma.$executeRaw`UPDATE users SET failed_login_count = 5 WHERE id = ${tmp.id}::uuid`;
    const lockedTwice = await lock(tmp.id, b1.cookie);
    expect([lockedTwice.status, lockedTwice.body.type]).toEqual([409, 'urn:ecom:error:already_locked']); // khóa tạm chưa hết cũng là locked
    expect((await unlock(tmp.id, b1.cookie)).status).toBe(200);
    expect(await row(tmp.id)).toMatchObject({ status: 'active', failed_login_count: 0, locked_until: null });
    expect((await post(t, '/auth/login', { email: tmp.email, password: PASSWORD }, { ip: '10.0.0.9' })).status).toBe(200);

    const u1 = await seedUser(t);
    const pair = await Promise.all([lock(u1.id, b1.cookie), lock(u1.id, b1.cookie)]);
    expect(pair.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await q(t, `SELECT 1 FROM outbox_events WHERE type = 'UserLocked' AND aggregate_id = '${u1.id}'`)).toHaveLength(1);
  });
});
