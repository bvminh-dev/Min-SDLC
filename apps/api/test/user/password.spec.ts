import { AuditService } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { createUsrApp, call, userWithSession, type UsrApp } from '../support/usr';
import { outboxTypes, post, q, seedSession, seedUser } from '../support/auth';

const OLD = 'Old-Password-1';
const NEW = 'New-Password-22';
const WRONG = 'Wrong-Password-1';

describe('USR đổi mật khẩu (USR-REQ-20261006-101003591)', () => {
  let t: UsrApp;
  let T0: Date;
  beforeAll(async () => { t = await createUsrApp(); T0 = t.clock.now(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); t.clock.set(T0); });

  const change = (cookie: string | undefined, current: string, next: string, o: Parameters<typeof call>[3] = {}) =>
    call(t, 'put', '/me/password', { cookie, body: { current_password: current, new_password: next }, ...o });
  const cookieOf = (r: { headers: Record<string, any> }): string => String(r.headers['set-cookie'][0]).split(';')[0];
  const counter = async (key: string) => (await q<{ c: number }>(t, `SELECT coalesce(sum(count), 0)::int AS c FROM rate_limit_counters WHERE bucket = 'ctr:${key}'`))[0].c;
  const wrongs = (id: string) => counter(`usr:pwchange:${id}`);
  const calls = (id: string) => counter(`usr:pwchange:hour:${id}`);
  const loginStatus = async (email: string, password: string) => (await post(t, '/auth/login', { email, password }, { ip: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })).status;
  const user = (o: Parameters<typeof userWithSession>[1] = {}) => userWithSession(t, { email: 'u1@shop.vn', password: OLD, ...o });

  it('USR-TC-20261006-102053373: đổi mật khẩu thu hồi mọi phiên, cấp phiên mới và phát PasswordChanged, một giao dịch', async () => {
    const u1 = await user();
    const b = await seedSession(t, u1.id);
    const r = await change(u1.cookie, OLD, NEW);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, revoked_sessions: 1 }); // không có csrf_token (ADR-016)
    const setCookie = String(r.headers['set-cookie'][0]);
    expect(setCookie).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(setCookie).toContain(attr);
    expect(cookieOf(r)).not.toBe(u1.cookie);

    expect((await call(t, 'get', '/me', { cookie: u1.cookie })).status).toBe(401);
    expect((await call(t, 'get', '/me', { cookie: b.cookie })).status).toBe(401);
    const oldLogin = await post(t, '/auth/login', { email: u1.email, password: OLD });
    expect([oldLogin.status, oldLogin.body.type]).toEqual([401, 'urn:ecom:error:invalid_credentials']);
    expect(await loginStatus(u1.email, NEW)).toBe(200);
    expect((await call(t, 'get', '/me', { cookie: cookieOf(r) })).status).toBe(200);

    const sessions = await q<{ id: string; status: string; revoked_reason: string | null }>(t, `SELECT id, status, revoked_reason FROM sessions WHERE user_id = '${u1.id}'`);
    expect(sessions.find((s) => s.id === u1.sessionId)).toMatchObject({ status: 'revoked', revoked_reason: 'replaced' });
    expect(sessions.find((s) => s.id === b.id)).toMatchObject({ status: 'revoked', revoked_reason: 'password_changed' });
    const types = await outboxTypes(t);
    expect(types.filter((x) => x === 'PasswordChanged')).toHaveLength(1);
    expect(types.filter((x) => x === 'SessionRevoked')).toHaveLength(2);
    const audit = await q<{ actor_id: string; actor_role: string; action: string; after: any }>(t, `SELECT actor_id, actor_role, action, after FROM audit_logs WHERE action = 'auth.password_change'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: u1.id, actor_role: 'customer', after: { revoked_others: 1, revoked_total: 2 } });

    const s1 = await userWithSession(t, { email: 's1@shop.vn', role: 'staff', password: OLD });
    expect((await change(s1.cookie, OLD, NEW)).status).toBe(200); // staff như customer
  });

  it('USR-TC-20261006-102053373: ép lỗi giữa giao dịch thì băm, phiên, outbox và audit cùng không đổi', async () => {
    const u1 = await user();
    const before = (await q<{ password_hash: string }>(t, `SELECT password_hash FROM users WHERE id = '${u1.id}'`))[0].password_hash;
    const spy = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit hỏng'));
    try {
      const r = await change(u1.cookie, OLD, NEW);
      expect(r.status).toBe(500);
    } finally { spy.mockRestore(); }
    expect((await q<{ password_hash: string }>(t, `SELECT password_hash FROM users WHERE id = '${u1.id}'`))[0].password_hash).toBe(before);
    expect((await q(t, `SELECT 1 FROM sessions WHERE user_id = '${u1.id}' AND status = 'active'`))).toHaveLength(1);
    expect(await outboxTypes(t)).toEqual([]);
    expect((await change(u1.cookie, OLD, NEW)).status).toBe(200); // lần sau bình thường
  });

  it('USR-TC-20261006-102053397: mật khẩu hiện tại sai tăng bộ đếm; sai lần thứ sáu bị 429 kể cả khi đúng, không khóa tài khoản; mở lại sau cửa sổ 15 phút', async () => {
    const u1 = await user();
    for (let i = 1; i <= 5; i++) {
      const r = await change(u1.cookie, WRONG, NEW);
      expect([i, r.status, r.body.errors?.[0]]).toEqual([i, 400, { field: 'current_password', code: 'incorrect' }]);
      t.clock.advance(30_000); // năm lần trong vài phút
    }
    expect(await wrongs(u1.id)).toBe(5);
    expect(await loginStatus(u1.email, OLD)).toBe(200); // mật khẩu và phiên không đổi
    const limited = await change(u1.cookie, OLD, NEW); // đúng nhưng đã sai 5 lần
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.type).toBe('urn:ecom:error:rate-limited');
    expect((await q(t, `SELECT status::text AS s, failed_login_count AS f FROM users WHERE id = '${u1.id}'`))[0]).toEqual({ s: 'active', f: 0 }); // không khóa, tách khỏi bộ đếm đăng nhập
    expect(await loginStatus(u1.email, OLD)).toBe(200);
    t.clock.advance(16 * 60_000);
    const ok = await change(u1.cookie, OLD, NEW);
    expect(ok.status).toBe(200);
  });

  it('USR-TC-20261006-102053423: mật khẩu mới vi phạm chính sách không tăng bộ đếm sai', async () => {
    const u1 = await user({ email: 'an@shop.vn' });
    for (const [pw, code] of [['short', 'too_short'], ['AN@shop.vn', 'same_as_email'], ['password123456', 'too_common']] as const) {
      const r = await change(u1.cookie, OLD, pw);
      expect([pw, r.status, r.body.errors]).toEqual([pw, 400, [{ field: 'new_password', code }]]);
    }
    expect(await wrongs(u1.id)).toBe(0);
    for (let i = 1; i <= 5; i++) expect([i, (await change(u1.cookie, WRONG, NEW)).status]).toEqual([i, 400]); // ba lỗi chính sách không tính vào 5 lần
    expect((await change(u1.cookie, OLD, NEW)).status).toBe(429);
  });

  it('USR-TC-20261006-102053447: đổi mật khẩu thiếu phiên hoặc thiếu CSRF không đổi gì và không tăng bộ đếm', async () => {
    const u1 = await user();
    expect((await change(undefined, OLD, NEW)).status).toBe(401);
    for (const o of [{ origin: 'https://evil.example' }, { origin: null }]) {
      const r = await change(u1.cookie, OLD, NEW, o);
      expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    }
    expect((await change(u1.cookie, OLD, NEW, { contentType: 'text/plain', body: `current_password=${OLD}` })).status).toBe(415);
    expect(await wrongs(u1.id)).toBe(0);
    expect(await calls(u1.id)).toBe(0); // chưa chạm AuthApi
    expect(await loginStatus(u1.email, OLD)).toBe(200);
  });

  it('USR-TC-20261006-102053472: mật khẩu cũ và mới không lọt vào log, audit hay phản hồi', async () => {
    const u1 = await user();
    t.logs.clear();
    const ok = await change(u1.cookie, OLD, NEW);
    const bad = await change(cookieOf(ok), WRONG, NEW);
    expect([ok.status, bad.status]).toEqual([200, 400]);
    const audit = JSON.stringify(await q(t, 'SELECT row_to_json(a) AS j FROM audit_logs a'));
    const outbox = JSON.stringify(await q(t, 'SELECT row_to_json(o) AS j FROM outbox_events o'));
    const surfaces: Record<string, string> = { log: t.logs.lines.join('\n'), audit, outbox, ok: ok.text, bad: bad.text };
    for (const secret of [OLD, NEW, WRONG]) for (const [name, text] of Object.entries(surfaces)) expect([secret, name, text.includes(secret)]).toEqual([secret, name, false]);
    expect(Object.keys(bad.body.errors[0]).sort()).toEqual(['code', 'field']); // chỉ có field và code, không lặp giá trị
  });

  it('USR-TC-20261006-102053496: mật khẩu mới ở biên độ dài (10, 128, 129) và trùng mật khẩu hiện tại', async () => {
    const u1 = await user();
    const p10 = 'Abcdefg-12';
    const p128 = 'Zq7-Lm'.repeat(22).slice(0, 128);
    const p129 = 'Xr9-Nk'.repeat(22).slice(0, 129);
    const r10 = await change(u1.cookie, OLD, p10);
    expect(r10.status).toBe(200);
    const r128 = await change(cookieOf(r10), p10, p128);
    expect(r128.status).toBe(200);
    const r129 = await change(cookieOf(r128), p128, p129);
    expect([r129.status, r129.body.errors]).toEqual([400, [{ field: 'new_password', code: 'too_long' }]]);
    expect(await loginStatus(u1.email, p128)).toBe(200); // vẫn là mật khẩu 128 ký tự

    const u2 = await user({ email: 'u2@shop.vn' });
    const same = await change(u2.cookie, OLD, OLD);
    expect([same.status, same.body.errors]).toEqual([400, [{ field: 'new_password', code: 'same_as_current' }]]);
    expect(await wrongs(u2.id)).toBe(0);
    expect(await loginStatus(u2.email, OLD)).toBe(200);
  });

  it('USR-TC-20261006-102053521: bốn lần sai rồi đúng thì bộ đếm về 0 (lần sai kế tiếp tính là lần 1)', async () => {
    const u1 = await user();
    for (let i = 0; i < 4; i++) expect((await change(u1.cookie, WRONG, NEW)).status).toBe(400);
    const ok = await change(u1.cookie, OLD, NEW);
    expect(ok.status).toBe(200);
    expect(await wrongs(u1.id)).toBe(0); // bị xóa, khác với cửa sổ trượt
    // Bốn lần sai nữa rồi đúng vẫn thành công: không cộng dồn với bốn lần trước (nếu không về 0 thì đã là 8 lần sai và bị 429).
    // TC (đã sửa theo mã): dùng 4 lần sai thay 5 để tách hai giới hạn; 5 sai rồi đúng là tổng 11 lần gọi trong một giờ, vượt trần 10 lần mỗi giờ nên 429 không còn chứng minh "về 0".
    let cookie = cookieOf(ok);
    for (let i = 0; i < 4; i++) { const r = await change(cookie, WRONG, 'Third-Password-33'); expect([i, r.status]).toEqual([i, 400]); }
    expect(await wrongs(u1.id)).toBe(4);
    const again = await change(cookie, NEW, 'Third-Password-33');
    expect(again.status).toBe(200);
    cookie = cookieOf(again);
    expect(await wrongs(u1.id)).toBe(0);
    expect(await calls(u1.id)).toBe(10); // đúng trần 10 lần mỗi giờ
    const eleventh = await change(cookie, WRONG, NEW);
    expect(eleventh.status).toBe(429); // trần theo giờ áp cho mọi kết quả
  });

  it('USR-TC-20261006-102053545: hai request đổi mật khẩu đồng thời chỉ một cái thành công (20 vòng)', async () => {
    for (let round = 0; round < 20; round++) {
      const u = await seedUser(t, { email: `race${round}@shop.vn`, password: OLD });
      const a = await seedSession(t, u.id), b = await seedSession(t, u.id);
      const [ra, rb] = await Promise.all([change(a.cookie, OLD, 'New-Password-A1'), change(b.cookie, OLD, 'New-Password-B2')]);
      const ok = [ra, rb].filter((r) => r.status === 200);
      const lost = [ra, rb].filter((r) => r.status !== 200);
      expect([round, ok.length, lost.length]).toEqual([round, 1, 1]);
      expect([round, lost[0].status === 400 || lost[0].status === 401]).toEqual([round, true]);
      if (lost[0].status === 400) expect(lost[0].body.errors).toEqual([{ field: 'current_password', code: 'incorrect' }]);
      expect((await q(t, `SELECT 1 FROM sessions WHERE user_id = '${u.id}' AND status = 'active'`))).toHaveLength(1); // còn đúng một phiên active (phiên mới của request thắng)
      const won = ra.status === 200 ? 'New-Password-A1' : 'New-Password-B2';
      expect(await loginStatus(u.email, won)).toBe(200);
      expect(await loginStatus(u.email, ra.status === 200 ? 'New-Password-B2' : 'New-Password-A1')).toBe(401);
      expect((await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM outbox_events WHERE type = 'PasswordChanged' AND aggregate_id = '${u.id}'`))[0].n).toBe(1);
    }
  }, 120_000);
});
