import { DomainError, RateLimitService } from '../../src/modules/platform';
import { createAuthApp, get, outboxTypes, post, q, seedSession, seedUser, type AuthApp } from '../support/auth';
import { truncateAll } from '../support/db';

const T0 = new Date('2026-10-06T10:00:00.000Z');
const OLD = 'Old-Password-1';
const NEW = 'New-Password-22';
const STRANGER = '99999999-9999-4999-8999-999999999999';

describe('Giao diện đồng bộ của AUTH cho USR, NTF, REV (AUTH-API, Giao tiếp giữa module; architecture.md, bảng Giao diện module)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(T0); });

  /** Chờ promise bị từ chối bằng DomainError có mã `code`; trả lỗi để soi `options`. */
  const domain = async (p: Promise<unknown>, code: string): Promise<DomainError> => {
    const e = await p.then(() => null, (x) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return e as DomainError;
  };
  const sessions = (userId: string) => q<{ id: string; status: string; revoked_reason: string | null }>(t, `SELECT id, status, revoked_reason FROM sessions WHERE user_id = '${userId}' ORDER BY created_at, id`);
  const hashOf = async (userId: string) => (await q<{ password_hash: string }>(t, `SELECT password_hash FROM users WHERE id = '${userId}'`))[0].password_hash;
  const counter = async (key: string) => (await q<{ count: number }>(t, `SELECT coalesce(sum(count), 0)::int AS count FROM rate_limit_counters WHERE bucket = 'ctr:${key}'`))[0].count;
  const wrongCount = (userId: string) => counter(`usr:pwchange:${userId}`);
  const canLogin = async (u: { email: string }, password: string) => (await post(t, '/auth/login', { email: u.email, password })).status;

  describe('changePassword', () => {
    it('AUTH-TC-20261006-180336843: đổi mật khẩu thu hồi mọi phiên (phiên của request replaced, phiên khác password_changed), cấp phiên mới, phát event, audit, không lộ bí mật', async () => {
      const u1 = await seedUser(t, { email: 'u1@shop.vn', password: OLD });
      const s1 = await seedUser(t, { email: 's1@shop.vn', role: 'staff', password: OLD });
      const a = await seedSession(t, u1.id);
      const b = await seedSession(t, u1.id);
      const c = await seedSession(t, s1.id);
      const oldHash = await hashOf(u1.id);
      await t.app.get(RateLimitService).hitCounter(`usr:pwchange:${u1.id}`, 900); // một lần sai trước đó, thành công phải đặt về 0
      expect(await wrongCount(u1.id)).toBe(1);

      const r = await t.api.changePassword(u1.id, a.id, OLD, NEW, { ip: '10.0.0.7' });
      expect(r.revoked_others).toBe(1);
      expect(r.new_session.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.new_session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const rows = await sessions(u1.id);
      expect(rows.find((x) => x.id === b.id)).toMatchObject({ status: 'revoked', revoked_reason: 'password_changed' });
      expect(rows.find((x) => x.id === a.id)).toMatchObject({ status: 'revoked', revoked_reason: 'replaced' });
      const fresh = rows.filter((x) => x.status === 'active');
      expect(fresh.map((x) => x.id)).toEqual([r.new_session.id]);
      expect(await q(t, `SELECT 1 FROM sessions WHERE token_hash = '${r.new_session.token}'`)).toHaveLength(0); // chỉ lưu băm
      expect((await get(t, '/auth/session', `sid=${r.new_session.token}`)).status).toBe(200);
      expect((await get(t, '/auth/session', a.cookie)).status).toBe(401);
      expect((await get(t, '/auth/session', b.cookie)).status).toBe(401);
      expect((await sessions(s1.id))[0]).toMatchObject({ id: c.id, status: 'active', revoked_reason: null }); // người khác không đụng

      expect(await canLogin(u1, OLD)).toBe(401);
      expect(await canLogin(u1, NEW)).toBe(200);
      const newHash = await hashOf(u1.id);
      expect(newHash).toMatch(/^\$argon2id\$v=19\$/);
      expect(newHash.split('$')[4]).not.toBe(oldHash.split('$')[4]); // salt mới

      const outbox = await q<{ type: string; payload: any }>(t, `SELECT type, payload FROM outbox_events WHERE type IN ('PasswordChanged', 'SessionRevoked') ORDER BY type, payload::text`);
      expect(outbox.filter((e) => e.type === 'PasswordChanged')).toHaveLength(1);
      expect(outbox.filter((e) => e.type === 'SessionRevoked').map((e) => e.payload.reason).sort()).toEqual(['password_changed', 'replaced']);
      const audit = await q<{ action: string; actor_id: string; after: any }>(t, `SELECT action, actor_id, after FROM audit_logs WHERE action = 'auth.password_change'`);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_id: u1.id, after: { revoked_others: 1, ip: '10.0.0.7' } });
      expect(await wrongCount(u1.id)).toBe(0);

      const everything = JSON.stringify([await q(t, 'SELECT * FROM outbox_events'), await q(t, 'SELECT * FROM audit_logs')]) + t.logs.lines.join('\n');
      for (const secret of [OLD, NEW, r.new_session.token]) expect(everything).not.toContain(secret);

      // staff đổi như customer
      const sr = await t.api.changePassword(s1.id, c.id, OLD, NEW);
      expect(sr.revoked_others).toBe(0);
      expect((await sessions(s1.id)).map((x) => x.status).sort()).toEqual(['active', 'revoked']);
    });

    it('AUTH-TC-20261006-180337117: mật khẩu hiện tại sai, mật khẩu mới vi phạm chính sách, 5 lần sai mỗi 15 phút, 10 lần gọi mỗi giờ, người dùng không hợp lệ', async () => {
      const u1 = await seedUser(t, { email: 'an@shop.vn', password: OLD });
      const a = await seedSession(t, u1.id);
      const before = await hashOf(u1.id);
      const unchanged = async () => {
        expect(await hashOf(u1.id)).toBe(before);
        expect((await sessions(u1.id)).map((x) => x.status)).toEqual(['active']);
        expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'PasswordChanged'")).toHaveLength(0);
        expect(await q(t, "SELECT 1 FROM audit_logs WHERE action = 'auth.password_change'")).toHaveLength(0);
      };

      await domain(t.api.changePassword(u1.id, a.id, 'Sai-Mat-Khau-9', NEW), 'invalid_current_password');
      await unchanged();
      expect(await wrongCount(u1.id)).toBe(1);

      for (const [pw, code] of [['short', 'too_short'], ['an@shop.vn', 'same_as_email'], ['password123456', 'too_common']] as const) {
        const e = await domain(t.api.changePassword(u1.id, a.id, OLD, pw), 'validation-failed');
        expect(e.options.errors).toEqual([{ field: 'new_password', code }]);
      }
      await unchanged();
      expect(await wrongCount(u1.id)).toBe(1); // vi phạm chính sách không tăng bộ đếm sai

      for (let i = 0; i < 4; i++) await domain(t.api.changePassword(u1.id, a.id, 'Sai-Mat-Khau-9', NEW), 'invalid_current_password'); // tổng 5 lần sai
      const limited = await domain(t.api.changePassword(u1.id, a.id, OLD, NEW), 'rate-limited'); // lần thứ 6, current đúng
      expect(Number(limited.options.headers?.['Retry-After'])).toBeGreaterThanOrEqual(1);
      await unchanged();
      expect((await q<any>(t, `SELECT status FROM users WHERE id = '${u1.id}'`))[0].status).toBe('active'); // không khóa tài khoản
      expect(await canLogin(u1, OLD)).toBe(200);
      t.clock.advance(15 * 60_000 + 1000); // hết cửa sổ 15 phút
      expect((await t.api.changePassword(u1.id, (await sessions(u1.id)).find((x) => x.status === 'active')!.id, OLD, NEW)).revoked_others).toBeGreaterThanOrEqual(0);

      // 10 lần gọi mỗi giờ, mọi kết quả (kể cả thành công)
      const u2 = await seedUser(t, { email: 'u2@shop.vn', password: OLD });
      let pw = OLD;
      for (let i = 0; i < 10; i++) {
        const next = `Pass-${i}-Number-Long`;
        await t.api.changePassword(u2.id, STRANGER, pw, next);
        pw = next;
      }
      const hour = await domain(t.api.changePassword(u2.id, STRANGER, pw, 'Pass-final-Number'), 'rate-limited');
      expect(Number(hour.options.headers?.['Retry-After'])).toBeGreaterThanOrEqual(1);
      expect(await canLogin(u2, 'Pass-final-Number')).toBe(401);
      t.clock.advance(3600_000 + 1000);
      await t.api.changePassword(u2.id, STRANGER, pw, 'Pass-final-Number');
      expect(await canLogin(u2, 'Pass-final-Number')).toBe(200);

      // không tồn tại, bị khóa, id sai định dạng
      const locked = await seedUser(t, { email: 'lk@shop.vn', password: OLD, status: 'locked', lockedReason: 'admin' });
      await domain(t.api.changePassword(STRANGER, STRANGER, OLD, NEW), 'unauthenticated');
      await domain(t.api.changePassword(locked.id, STRANGER, OLD, NEW), 'unauthenticated');
      await domain(t.api.changePassword('abc', STRANGER, OLD, NEW), 'unauthenticated');
      expect(await hashOf(locked.id)).toMatch(/^\$argon2id\$/);
      expect(await canLogin(locked, NEW)).toBe(401);
    }, 60_000);

    it('AUTH-TC-20261006-180337381: biên độ dài 10 và 128 qua, 129 bị từ chối; năm lần thử cuối đúng đặt bộ đếm về 0; trùng mật khẩu cũ; hai lời gọi đồng thời chỉ một thành công', async () => {
      const mk = async (n: number) => seedUser(t, { email: `b${n}@shop.vn`, password: OLD });
      const [l128, l129] = [await mk(2), await mk(3)];
      const ten = 'Xy7-Qw2-Rt'; // đúng 10 ký tự
      expect(ten).toHaveLength(10);
      const b10 = await mk(4);
      await t.api.changePassword(b10.id, STRANGER, OLD, ten);
      expect(await canLogin(b10, ten)).toBe(200);
      const pw128 = `Aa1-${'x'.repeat(124)}`;
      expect(pw128).toHaveLength(128);
      await t.api.changePassword(l128.id, STRANGER, OLD, pw128);
      expect(await canLogin(l128, pw128)).toBe(200);
      const e = await domain(t.api.changePassword(l129.id, STRANGER, OLD, `${pw128}x`), 'validation-failed');
      expect(e.options.errors).toEqual([{ field: 'new_password', code: 'too_long' }]);
      expect(await canLogin(l129, OLD)).toBe(200);

      // sai 4 lần rồi đúng: bộ đếm về 0; lần sai kế tiếp tính là lần 1
      const u = await seedUser(t, { email: 'four@shop.vn', password: OLD });
      for (let i = 0; i < 4; i++) await domain(t.api.changePassword(u.id, STRANGER, 'Sai-Mat-Khau-9', NEW), 'invalid_current_password');
      expect(await wrongCount(u.id)).toBe(4);
      await t.api.changePassword(u.id, STRANGER, OLD, NEW);
      expect(await wrongCount(u.id)).toBe(0);
      await domain(t.api.changePassword(u.id, STRANGER, 'Sai-Mat-Khau-9', 'Another-Password-3'), 'invalid_current_password');
      expect(await wrongCount(u.id)).toBe(1);

      // new = current: same_as_current, bộ đếm sai không tăng
      const same = await seedUser(t, { email: 'same@shop.vn', password: OLD });
      const err = await domain(t.api.changePassword(same.id, STRANGER, OLD, OLD), 'validation-failed');
      expect(err.options.errors).toEqual([{ field: 'new_password', code: 'same_as_current' }]);
      expect(await wrongCount(same.id)).toBe(0);
      expect(await canLogin(same, OLD)).toBe(200);

      // hai lời gọi đúng đồng thời với cùng current
      const race = await seedUser(t, { email: 'race@shop.vn', password: OLD });
      const ra = await seedSession(t, race.id);
      const results = await Promise.allSettled([
        t.api.changePassword(race.id, ra.id, OLD, 'First-Password-11'),
        t.api.changePassword(race.id, ra.id, OLD, 'Second-Password-22'),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(bad).toHaveLength(1);
      expect((bad[0].reason as DomainError).code).toBe('invalid_current_password');
      expect(await q(t, `SELECT 1 FROM outbox_events WHERE type = 'PasswordChanged' AND payload->>'user_id' = '${race.id}'`)).toHaveLength(1);
      const winner = results[0].status === 'fulfilled' ? 'First-Password-11' : 'Second-Password-22';
      expect(await canLogin(race, winner)).toBe(200);
    }, 60_000);
  });

  describe('đọc cho NTF và REV', () => {
    it('AUTH-TC-20261006-180337643: getUserContact (đủ trường, null khi không có, không lộ băm) và listActiveUserIdsByRole (active, theo id, trần 200)', async () => {
      const u1 = await seedUser(t, { email: 'u1@shop.vn', name: 'An Nguyễn' });
      const u2 = await seedUser(t, { email: 'u2@shop.vn', verified: false });
      const s1 = await seedUser(t, { email: 's1@shop.vn', role: 'staff' });
      const s2 = await seedUser(t, { email: 's2@shop.vn', role: 'staff', status: 'locked', lockedReason: 'admin' });
      const a1 = await seedUser(t, { email: 'a1@shop.vn', role: 'admin' });

      expect(await t.api.getUserContact(u1.id)).toEqual({ user_id: u1.id, role: 'customer', status: 'active', email: 'u1@shop.vn', email_verified: true, full_name: 'An Nguyễn' });
      expect(await t.api.getUserContact(u2.id)).toMatchObject({ email_verified: false });
      expect(await t.api.getUserContact(s2.id)).toMatchObject({ role: 'staff', status: 'locked' });
      expect(await t.api.getUserContact(STRANGER)).toBeNull();
      expect(await t.api.getUserContact('khong-phai-uuid')).toBeNull();
      expect(JSON.stringify(await t.api.getUserContact(u1.id))).not.toMatch(/password|token|failed_login/);

      const ids = [s1.id, a1.id].sort();
      expect(await t.api.listActiveUserIdsByRole(['staff', 'admin'], 200)).toEqual(ids);
      expect(await t.api.listActiveUserIdsByRole(['staff', 'admin'], 1)).toEqual([ids[0]]);
      expect(await t.api.listActiveUserIdsByRole(['staff'])).toEqual([s1.id]);
      expect(await t.api.listActiveUserIdsByRole(['nobody' as any])).toEqual([]);
      expect(await t.api.listActiveUserIdsByRole([])).toEqual([]);

      await t.prisma.$executeRaw`
        INSERT INTO users (email, password_hash, full_name, created_at, updated_at)
        SELECT 'bulk' || g || '@shop.vn', 'x', 'Bulk', now(), now() FROM generate_series(1, 205) g`;
      expect(await t.api.listActiveUserIdsByRole(['customer'], 1000)).toHaveLength(200); // trần của limit
      expect(await t.api.listActiveUserIdsByRole(['customer'], 5)).toHaveLength(5);
    });

    it('AUTH-TC-20261006-180337910: getDisplayNames trả đúng dòng của id tồn tại, bỏ id lặp, lạ, sai định dạng; rỗng thì rỗng', async () => {
      const u1 = await seedUser(t, { email: 'u1@shop.vn', name: 'An Nguyễn' });
      const u2 = await seedUser(t, { email: 'u2@shop.vn', name: 'Bình' });
      await t.prisma.$executeRaw`UPDATE users SET avatar_url = 'avatars/a.jpg' WHERE id = ${u1.id}::uuid`;
      const rows = await t.api.getDisplayNames([u1.id, u2.id, u1.id, STRANGER, 'abc']);
      expect([...rows].sort((x, y) => x.user_id.localeCompare(y.user_id))).toEqual(
        [{ user_id: u1.id, display_name: 'An Nguyễn', avatar_url: 'avatars/a.jpg' }, { user_id: u2.id, display_name: 'Bình', avatar_url: null }].sort((x, y) => x.user_id.localeCompare(y.user_id)),
      );
      expect(JSON.stringify(rows)).not.toMatch(/email|role|password/);
      expect(await t.api.getDisplayNames([])).toEqual([]);
      expect(await t.api.getDisplayNames(['abc'])).toEqual([]);
    });
  });

  describe('hồ sơ cho USR', () => {
    it('AUTH-TC-20261006-180338166: updateProfile chỉ ghi ba cột và kiểm tên; getUser, findCustomerBy*, listAvatarUrlsInUse, countCustomers', async () => {
      const u1 = await seedUser(t, { email: 'u1@shop.vn' });
      const s1 = await seedUser(t, { email: 's1@shop.vn', role: 'staff' });
      await seedUser(t, { email: 'a1@shop.vn', role: 'admin' });
      const before = (await q<any>(t, `SELECT updated_at FROM users WHERE id = '${u1.id}'`))[0].updated_at as Date;
      t.clock.advance(60_000);

      const patched = await t.api.updateProfile(u1.id, { full_name: '  An Nguyễn  ', phone: '0901234567', avatar_url: 'avatars/x.jpg', role: 'admin', email: 'evil@x.vn' } as any);
      expect(patched).toMatchObject({ id: u1.id, email: 'u1@shop.vn', full_name: 'An Nguyễn', phone: '0901234567', avatar_url: 'avatars/x.jpg', role: 'customer', status: 'active' });
      const db = (await q<any>(t, `SELECT role, email::text AS email, updated_at FROM users WHERE id = '${u1.id}'`))[0];
      expect(db).toMatchObject({ role: 'customer', email: 'u1@shop.vn' });
      expect(db.updated_at.getTime()).toBeGreaterThan(before.getTime());

      expect(await t.api.updateProfile(u1.id, { phone: null })).toMatchObject({ phone: null, full_name: 'An Nguyễn', avatar_url: 'avatars/x.jpg' });
      expect(await t.api.updateProfile(u1.id, {})).toMatchObject({ phone: null, full_name: 'An Nguyễn', avatar_url: 'avatars/x.jpg' });
      for (const [name, code] of [['', 'required'], ['x'.repeat(101), 'too_long']] as const) {
        const e = await domain(t.api.updateProfile(u1.id, { full_name: name }), 'validation-failed');
        expect(e.options.errors).toEqual([{ field: 'full_name', code }]);
      }
      expect((await t.api.getUser(u1.id))?.full_name).toBe('An Nguyễn');
      await domain(t.api.updateProfile(STRANGER, { full_name: 'x' }), 'not-found');

      const view = await t.api.getUser(u1.id);
      expect(view).toEqual({ id: u1.id, email: 'u1@shop.vn', full_name: 'An Nguyễn', phone: null, avatar_url: 'avatars/x.jpg', role: 'customer', status: 'active', email_verified: true, created_at: expect.any(Date) });
      expect(await t.api.findCustomerById(u1.id)).toEqual(view);
      expect(await t.api.findCustomerById(s1.id)).toBeNull();
      expect(await t.api.findCustomerByEmail('U1@SHOP.vn')).toEqual(view);
      expect(await t.api.findCustomerByEmail('s1@shop.vn')).toBeNull();
      expect(await t.api.getUser('abc')).toBeNull();
      expect(await t.api.getUser(STRANGER)).toBeNull();
      expect(JSON.stringify([view, await t.api.getUser(s1.id)])).not.toMatch(/password|token|failed_login/);

      const u2 = await seedUser(t, { email: 'u2@shop.vn' });
      const u3 = await seedUser(t, { email: 'u3@shop.vn', status: 'locked', lockedReason: 'admin' });
      await t.api.updateProfile(u2.id, { avatar_url: 'avatars/x.jpg' });
      await t.api.updateProfile(u3.id, { avatar_url: 'avatars/y.jpg' });
      expect((await t.api.listAvatarUrlsInUse()).sort()).toEqual(['avatars/x.jpg', 'avatars/y.jpg']);
      expect(await t.api.countCustomers()).toBe(3); // u1, u2 và u3 bị khóa; không đếm staff, admin
      expect(await outboxTypes(t)).toEqual([]); // ghi hồ sơ không phát event của AUTH
    });
  });
});
