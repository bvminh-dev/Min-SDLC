import { NOW0, PASSWORD, createAuthApp, get, http, login, post, q, seedSession, seedToken, seedUser, type AuthApp } from '../support/auth';
import { ORIGIN } from '../support/app';
import { truncateAll } from '../support/db';

const T0 = new Date(NOW0.getTime() - 3600_000); // 1 giờ trước NOW0 (giờ thật lúc nạp), không mốc ngày cố định
const min = (n: number) => n * 60_000;

describe('Đăng xuất và phiên (AUTH-REQ-20261006-095515774, AUTH-REQ-20261006-095515808)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.clock.set(T0); });
  const probe = (cookie: string) => get(t, '/probe/any', cookie);
  const sess = async (id: string) => (await q<any>(t, `SELECT status, revoked_reason, expires_at, last_seen_at FROM sessions WHERE id = '${id}'`))[0];
  const idOf = async (cookie: string) => (await q<{ id: string }>(t, `SELECT id FROM sessions WHERE token_hash = encode(sha256('${cookie.slice(4)}'::bytea), 'hex')`))[0].id;

  it('AUTH-TC-20261006-100641421: đăng xuất thu hồi phiên hiện tại (một SessionRevoked), xóa cookie, giữ phiên thiết bị khác', async () => {
    const u = await seedUser(t);
    const A = await login(t, u), B = await login(t, u);
    const r = await post(t, '/auth/logout', undefined, { cookie: A });
    expect(r.status).toBe(204);
    expect(String(r.headers['set-cookie'][0])).toMatch(/^sid=;.*Max-Age=0/);
    expect(await sess(await idOf(A))).toMatchObject({ status: 'revoked', revoked_reason: 'logout' });
    expect(await q(t, "SELECT payload FROM outbox_events WHERE type = 'SessionRevoked'")).toHaveLength(1);
    expect(await sess(await idOf(B))).toMatchObject({ status: 'active' });
    expect((await get(t, '/auth/session', B)).status).toBe(200);
  });

  it('AUTH-TC-20261006-100641463: đăng xuất bị từ chối: phiên đã thu hồi 401, Origin lạ hoặc thiếu 403 (phiên còn), cookie cũ không dùng lại được', async () => {
    const u = await seedUser(t);
    const A = await login(t, u), B = await login(t, u);
    await post(t, '/auth/logout', undefined, { cookie: B });
    const before = await q(t, 'SELECT count(*)::int AS n FROM outbox_events');
    const guest = await post(t, '/auth/logout', undefined, { cookie: B });
    expect(guest.status).toBe(401);
    expect(guest.body.type).toBe('urn:ecom:error:unauthenticated');
    expect(await q(t, 'SELECT count(*)::int AS n FROM outbox_events')).toEqual(before);

    for (const origin of [null, 'https://evil.example']) {
      const r = await post(t, '/auth/logout', undefined, { cookie: A, origin });
      expect([origin, r.status, r.body.type]).toEqual([origin, 403, 'urn:ecom:error:csrf_failed']);
    }
    expect((await sess(await idOf(A))).status).toBe('active');
    await post(t, '/auth/logout', undefined, { cookie: A });
    expect((await get(t, '/auth/session', A)).status).toBe(401);
  });

  it('AUTH-TC-20261006-100641507: đăng xuất hai lần song song chỉ một thắng, phiên quá hạn 401, staff và admin cùng hành vi', async () => {
    const u = await seedUser(t);
    const A = await login(t, u);
    const pair = await Promise.all([post(t, '/auth/logout', undefined, { cookie: A }), post(t, '/auth/logout', undefined, { cookie: A })]);
    expect(pair.map((r) => r.status).sort()).toEqual([204, 401]);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'SessionRevoked'")).toHaveLength(1);

    const idle = await login(t, u);
    t.clock.advance(min(31));
    const expired = await post(t, '/auth/logout', undefined, { cookie: idle });
    expect(expired.status).toBe(401);
    expect(expired.body.type).toBe('urn:ecom:error:session_expired');

    for (const role of ['staff', 'admin'] as const) {
      const su = await seedUser(t, { role });
      const c = await login(t, su);
      expect((await post(t, '/auth/logout', undefined, { cookie: c })).status).toBe(204);
      expect((await sess(await idOf(c))).status).toBe('revoked');
    }
  });

  it('AUTH-TC-20261006-100641551: hạn trượt đẩy theo thao tác (mỗi phút ghi một lần) và GET /auth/session không gia hạn', async () => {
    const u = await seedUser(t);
    const c = await login(t, u);
    const id = await idOf(c);
    t.clock.advance(min(20));
    expect((await probe(c)).status).toBe(200);
    t.clock.advance(min(25));
    expect((await probe(c)).status).toBe(200);
    expect((await sess(id)).expires_at.toISOString()).toBe(new Date(t.clock.now().getTime() + min(30)).toISOString());

    const s1 = await get(t, '/auth/session', c);
    expect(s1.status).toBe(200);
    expect(s1.body.user).toMatchObject({ id: u.id, email: u.email, role: 'customer', email_verified: true });
    expect(JSON.stringify(s1.body)).not.toContain('csrf_token');
    t.clock.advance(min(5));
    const s2 = await get(t, '/auth/session', c);
    expect(s2.body.idle_expires_at).toBe(s1.body.idle_expires_at); // không gia hạn
    expect(s2.body.absolute_expires_at).toBe(new Date(T0.getTime() + 7 * 24 * 3600_000).toISOString());
    expect((await sess(id)).expires_at.toISOString()).toBe(s1.body.idle_expires_at);
  });

  it('AUTH-TC-20261006-100641551: job dọn đánh dấu phiên quá hạn, xóa bản ghi đóng quá 30 ngày, không đụng phiên còn hạn (hợp lệ luôn kiểm lúc đọc, không phụ thuộc job)', async () => {
    const u = await seedUser(t);
    const live = await seedSession(t, u.id);
    const stale = await seedSession(t, u.id, { createdAt: new Date(T0.getTime() - 3 * 3600_000) });
    const old = await seedSession(t, u.id, { createdAt: new Date(T0.getTime() - 40 * 24 * 3600_000) });
    await t.prisma.$executeRaw`UPDATE sessions SET status = 'revoked', revoked_at = ${new Date(T0.getTime() - 35 * 24 * 3600_000)}::timestamptz, revoked_reason = 'logout' WHERE id = ${old.id}::uuid`;
    expect((await probe(stale.cookie)).body.type).toBe('urn:ecom:error:session_expired'); // chưa chạy job vẫn bị từ chối
    const r = await t.cleanup.run();
    expect(r).toMatchObject({ expired: 1, deleted: 1 });
    expect((await sess(stale.id)).status).toBe('expired');
    expect([(await probe(stale.cookie)).status, (await probe(stale.cookie)).body.type]).toEqual([401, 'urn:ecom:error:session_expired']); // sau job dọn vẫn session_expired, không đổi thành unauthenticated (review AUTH)
    expect(await q(t, `SELECT 1 FROM sessions WHERE id = '${old.id}'`)).toHaveLength(0);
    expect((await sess(live.id)).status).toBe('active');
    expect((await probe(live.cookie)).status).toBe(200);
  });

  it('AUTH-TC-20261006-100641595: phiên bị từ chối: hết hạn trượt, hết hạn tuyệt đối dù có thao tác, cookie sửa hoặc đã thu hồi, Origin lạ, kiểu nội dung sai', async () => {
    const u = await seedUser(t);
    const idle = await login(t, u);
    t.clock.advance(min(31));
    const r1 = await probe(idle);
    expect([r1.status, r1.body.type]).toEqual([401, 'urn:ecom:error:session_expired']); // chưa chạy job dọn

    t.clock.set(T0);
    const abs = await login(t, u);
    for (let elapsed = 0; elapsed < 7 * 24 * 60 - 40; elapsed += 20) { t.clock.advance(min(20)); if ((await probe(abs)).status !== 200) throw new Error(`phiên chết sớm ở phút ${elapsed}`); }
    t.clock.set(new Date(T0.getTime() + 7 * 24 * 3600_000 + 3600_000));
    const r2 = await probe(abs);
    expect([r2.status, r2.body.type]).toEqual([401, 'urn:ecom:error:session_expired']); // đã thao tác ngay trước đó vẫn hết hạn tuyệt đối

    t.clock.set(T0);
    const c = await login(t, u);
    const tampered = `${c.slice(0, -1)}${c.endsWith('A') ? 'B' : 'A'}`;
    const r3 = await probe(tampered);
    expect([r3.status, r3.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']);
    await post(t, '/auth/logout', undefined, { cookie: c });
    expect((await probe(c)).body.type).toBe('urn:ecom:error:unauthenticated');

    const live = await login(t, u);
    const evil = await post(t, '/probe/state', {}, { cookie: live, origin: 'https://evil.example' });
    expect([evil.status, evil.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    const plain = await http(t).post('/api/v1/probe/state').set('Cookie', live).set('Origin', ORIGIN).set('Content-Type', 'text/plain').send('{}');
    expect(plain.status).toBe(415);
    expect((await post(t, '/probe/state', {}, { cookie: live })).status).toBe(200);
  }, 60_000);

  it('AUTH-TC-20261006-100641639: đặt lại mật khẩu thu hồi mọi phiên, khóa user và đổi role có hiệu lực ngay, ranh giới hạn trượt, tối đa 10 phiên (kể cả đăng nhập song song)', async () => {
    const u = await seedUser(t, { email: 'u1@shop.vn', verified: true });
    const A = await login(t, u), B = await login(t, u);
    const T = await seedToken(t, 'reset', u.id);
    expect((await post(t, '/auth/password/reset', { token: T, new_password: 'New-Pass-67890' })).status).toBe(200);
    expect(await q(t, "SELECT revoked_reason FROM sessions WHERE status = 'revoked'")).toEqual([{ revoked_reason: 'password_changed' }, { revoked_reason: 'password_changed' }]);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'SessionRevoked'")).toHaveLength(2);
    expect([(await probe(A)).status, (await probe(B)).status]).toEqual([401, 401]);

    const admin = await seedUser(t, { role: 'admin' });
    const ca = await login(t, admin);
    const v = await seedUser(t, { email: 'victim@shop.vn' });
    const cv = await login(t, v);
    expect((await post(t, `/admin/users/${v.id}/lock`, {}, { cookie: ca })).status).toBe(200);
    expect((await probe(cv)).status).toBe(401);

    const w = await seedUser(t, { email: 'w@shop.vn' });
    const cw = await login(t, w);
    expect((await get(t, '/auth/session', cw)).body.user.role).toBe('customer');
    expect((await http(t).patch(`/api/v1/admin/users/${w.id}/role`).set('Cookie', ca).set('Origin', ORIGIN).set('Content-Type', 'application/json').send(JSON.stringify({ role: 'staff' }))).status).toBe(200);
    expect((await get(t, '/auth/session', cw)).body.user.role).toBe('staff'); // cùng phiên, không đăng nhập lại

    const z = await seedUser(t, { email: 'z@shop.vn' });
    const cz = await login(t, z);
    t.clock.advance(29 * 60_000 + 59_000);
    expect((await probe(cz)).status).toBe(200);
    t.clock.advance(30 * 60_000 + 1_000);
    expect((await probe(cz)).status).toBe(401);

    // 10 phiên còn hạn tạo từ T0-1h mỗi 5 phút; đăng nhập thứ 11 lúc T0+30 phút thay phiên cũ nhất
    t.clock.set(new Date(T0.getTime() + 30 * 60_000));
    const m = await seedUser(t, { email: 'multi@shop.vn' });
    const seeded = [];
    for (let i = 0; i < 10; i++) {
      seeded.push(await seedSession(t, m.id, { createdAt: new Date(T0.getTime() - 3600_000 + i * 5 * 60_000), lastSeenAt: new Date(T0.getTime() + 20 * 60_000), expiresAt: new Date(T0.getTime() + 50 * 60_000) }));
    }
    const active = async () => (await q<{ id: string }>(t, `SELECT id FROM sessions WHERE user_id = '${m.id}' AND status = 'active'`)).length;
    expect(await active()).toBe(10);
    const eleventh = await login(t, m);
    expect(await active()).toBe(10);
    expect(await sess(seeded[0].id)).toMatchObject({ status: 'revoked', revoked_reason: 'replaced' });
    expect(await q(t, "SELECT payload FROM outbox_events WHERE type = 'SessionRevoked' AND payload->>'session_id' = '" + seeded[0].id + "'")).toHaveLength(1);
    const gone = await probe(seeded[0].cookie);
    expect([gone.status, gone.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']);
    for (const s of [...seeded.slice(1), { cookie: eleventh }]) expect((await probe(s.cookie)).status).toBe(200);

    const before = (await q(t, "SELECT 1 FROM outbox_events WHERE type = 'SessionRevoked'")).length;
    const par = await Promise.all([1, 2].map((i) => post(t, '/auth/login', { email: m.email, password: PASSWORD }, { ip: `10.7.9.${i}` })));
    expect(par.map((r) => r.status)).toEqual([200, 200]);
    expect(await active()).toBe(10); // khóa dòng users: hai đăng nhập đồng thời không vượt 10
    expect(await sess(seeded[1].id)).toMatchObject({ status: 'revoked', revoked_reason: 'replaced' });
    expect(await sess(seeded[2].id)).toMatchObject({ status: 'revoked', revoked_reason: 'replaced' });
    expect((await q(t, "SELECT 1 FROM outbox_events WHERE type = 'SessionRevoked'")).length - before).toBe(2);
  }, 60_000);
  it('review AUTH: phiên đang mở của user bị khóa tạm (5 lần sai) không dùng được ngay, kể cả sau khi hết 15 phút cho tới khi đăng nhập lại (T20: locked coi như không có phiên)', async () => {
    const u = await seedUser(t);
    const c = await login(t, u);
    expect((await get(t, '/auth/session', c)).status).toBe(200);
    for (let i = 0; i < 5; i++) await post(t, '/auth/login', { email: u.email, password: `bad-${i}` }, { ip: `10.4.0.${i + 1}` });
    expect((await q<any>(t, `SELECT status FROM users WHERE id = '${u.id}'`))[0].status).toBe('locked');
    expect((await get(t, '/auth/session', c)).status).toBe(401);
    expect((await probe(c)).status).toBe(401);
  });
});
