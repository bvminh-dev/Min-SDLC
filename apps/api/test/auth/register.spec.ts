import { spawn } from 'node:child_process';
import { PASSWORD, createAuthApp, http, post, q, seedSession, seedUser, medianMs, type AuthApp } from '../support/auth';
import { API_DIR, newPrisma, testDbUrl, truncateAll } from '../support/db';
import { waitFor } from '../support/boot';
import { ORIGIN } from '../support/app';

const EMAIL = 'new@shop.vn';
const until = (cond: () => boolean) => waitFor(cond, 5000, 20);

describe('Đăng ký (AUTH-REQ-20261006-095515620)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.logs.clear(); });

  it('AUTH-TC-20261006-100640840: đăng ký thành công, email chuẩn hóa, băm argon2id, không tự đăng nhập, không lộ bí mật ở log', async () => {
    const r = await post(t, '/auth/register', { email: '  New@Shop.vn ', password: PASSWORD, full_name: 'Nguyễn An' });
    expect(r.status).toBe(202);
    expect(Object.keys(r.body)).toEqual(['message']);
    expect(r.headers['set-cookie']).toBeUndefined();
    await until(() => t.mails.length === 1);

    const [u] = await q(t, 'SELECT id, email::text AS email, password_hash, status, role, email_verified_at FROM users');
    expect(u).toMatchObject({ email: EMAIL, status: 'active', role: 'customer', email_verified_at: null });
    expect(u.password_hash).not.toContain(PASSWORD);
    expect(u.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const [tok] = await q(t, 'SELECT status, expires_at, created_at FROM email_verification_tokens');
    expect(tok.status).toBe('issued');
    expect(tok.expires_at.getTime() - tok.created_at.getTime()).toBe(24 * 3600_000);
    expect(await q(t, 'SELECT 1 FROM sessions')).toHaveLength(0);
    const ob = await q(t, 'SELECT type, payload, correlation_id, occurred_at, id FROM outbox_events');
    expect(ob.map((o: any) => o.type)).toEqual(['UserRegistered']);
    expect(ob[0].id && ob[0].occurred_at && ob[0].correlation_id).toBeTruthy();
    const token = t.mails[0].token;
    expect(JSON.stringify(ob)).not.toContain(token); // token thô không vào outbox (K-14)
    expect(t.mails[0]).toMatchObject({ type: 'EmailVerificationRequested', user_id: u.id });
    const logs = t.logs.lines.join('\n');
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(token);

    const l = await post(t, '/auth/login', { email: EMAIL, password: PASSWORD });
    expect(l.status).toBe(200);
    expect(l.body.user).toMatchObject({ role: 'customer', email_verified: false });

    // SB-01: salt riêng mỗi người (review AUTH: đột biến salt cố định từng lọt): cùng mật khẩu, hai người, hai phần salt khác nhau
    expect((await post(t, '/auth/register', { email: 'salt2@shop.vn', password: PASSWORD, full_name: 'B' }, { ip: '10.9.8.8' })).status).toBe(202);
    const hashes = await q<{ password_hash: string }>(t, 'SELECT password_hash FROM users ORDER BY created_at, email');
    expect(hashes).toHaveLength(2);
    expect(new Set(hashes.map((h) => h.password_hash.split('$')[4])).size).toBe(2);
  });

  it('AUTH-TC-20261006-100640887: đăng ký bị từ chối đúng mã từng trường; email đã có không lộ (cùng thân, header, độ trễ); trường lạ; giới hạn IP; Origin lạ; kiểu nội dung sai', async () => {
    const bad = async (body: object, field: string, code: string) => {
      const r = await post(t, '/auth/register', body, { ip: '10.9.9.1' });
      expect([body, r.status]).toEqual([body, 400]);
      expect(r.body.type).toBe('urn:ecom:error:validation-failed');
      expect(r.body.errors).toEqual(expect.arrayContaining([{ field, code }]));
    };
    const ok = { email: 'a@shop.vn', password: PASSWORD, full_name: 'An' };
    await bad({ ...ok, email: 'abc' }, 'email', 'invalid_format');
    await bad({ ...ok, password: 'Abcdefg12' }, 'password', 'too_short');
    await bad({ ...ok, email: 'abc.def@shop.vn', password: 'abc.def@shop.vn' }, 'password', 'same_as_email');
    await bad({ ...ok, password: 'password1234' }, 'password', 'too_common');
    await bad({ email: 'a@shop.vn', password: PASSWORD }, 'full_name', 'required');
    expect(await q(t, 'SELECT 1 FROM users')).toHaveLength(0);
    expect(await q(t, 'SELECT 1 FROM outbox_events')).toHaveLength(0);

    await seedUser(t, { email: 'a@shop.vn' });
    const dup = await post(t, '/auth/register', { ...ok, email: 'A@Shop.vn' }, { ip: '10.9.9.2' });
    const fresh = await post(t, '/auth/register', { ...ok, email: 'fresh@shop.vn' }, { ip: '10.9.9.3' });
    expect([dup.status, fresh.status]).toEqual([202, 202]);
    expect(dup.body).toEqual(fresh.body);
    const strip = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => !['date', 'x-request-id'].includes(k)));
    expect(strip(dup.headers)).toEqual(strip(fresh.headers));
    expect(dup.headers['set-cookie']).toBeUndefined();
    expect(await q(t, "SELECT 1 FROM users WHERE email = 'a@shop.vn'::citext")).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM email_verification_tokens")).toHaveLength(1); // chỉ của fresh
    expect((await q(t, 'SELECT payload FROM outbox_events')).map((o: any) => o.payload.email)).toEqual(['fresh@shop.vn']);

    const role = await post(t, '/auth/register', { ...ok, email: 'r@shop.vn', role: 'admin' }, { ip: '10.9.9.4' });
    expect(role.status).toBe(400);
    expect(role.body.errors).toEqual(expect.arrayContaining([{ field: 'role', code: 'unknown_field' }]));
    expect(await q(t, "SELECT 1 FROM users WHERE email = 'r@shop.vn'::citext")).toHaveLength(0);

    for (let i = 0; i < 10; i++) expect((await post(t, '/auth/register', { ...ok, email: `rl${i}@shop.vn` }, { ip: '10.8.8.8' })).status).toBe(202);
    const limited = await post(t, '/auth/register', { ...ok, email: 'rl-over@shop.vn' }, { ip: '10.8.8.8' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(await q(t, "SELECT 1 FROM users WHERE email = 'rl-over@shop.vn'::citext")).toHaveLength(0);

    const evil = await post(t, '/auth/register', { ...ok, email: 'e@shop.vn' }, { origin: 'https://evil.example', ip: '10.7.7.1' });
    expect(evil.status).toBe(403);
    expect(evil.body.type).toBe('urn:ecom:error:csrf_failed');
    const plain = await http(t).post('/api/v1/auth/register').set('Origin', ORIGIN).set('Content-Type', 'text/plain').set('X-Forwarded-For', '10.7.7.2').send(JSON.stringify({ ...ok, email: 'p@shop.vn' }));
    expect(plain.status).toBe(415);
    expect(await q(t, "SELECT 1 FROM users WHERE email IN ('e@shop.vn', 'p@shop.vn')")).toHaveLength(0);

    // độ trễ không phân biệt hai nhánh: chênh lệch trung vị dưới 30% trên 30 lần đo mỗi nhánh (vì luôn băm trước khi tra email)
    const known = await medianMs(30, (i) => post(t, '/auth/register', { ...ok, email: 'a@shop.vn' }, { ip: `10.6.0.${i + 1}` }));
    const unknown = await medianMs(30, (i) => post(t, '/auth/register', { ...ok, email: `t${i}@shop.vn` }, { ip: `10.6.1.${i + 1}` }));
    expect(Math.abs(known - unknown) / Math.max(known, unknown)).toBeLessThan(0.3);
  }, 90_000);

  it('AUTH-TC-20261006-100640931: đăng ký đồng thời, ranh giới độ dài, họ tên trắng, không đụng phiên có sẵn, HTML trong họ tên, tiến trình chết giữa commit và relay', async () => {
    const both = await Promise.all([1, 2].map((i) => post(t, '/auth/register', { email: 'race@shop.vn', password: PASSWORD, full_name: 'Race' }, { ip: `10.5.0.${i}` })));
    expect(both.map((r) => r.status)).toEqual([202, 202]);
    expect(both[0].body).toEqual(both[1].body);
    expect(await q(t, "SELECT 1 FROM users WHERE email = 'race@shop.vn'::citext")).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'UserRegistered'")).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM email_verification_tokens WHERE status = 'issued'")).toHaveLength(1);

    const pw = (n: number) => `${'Ab1-'.repeat(40)}`.slice(0, n);
    const reg = (email: string, password: string, ip: string, name = 'An') => post(t, '/auth/register', { email, password, full_name: name }, { ip });
    expect((await reg('l10@shop.vn', pw(10), '10.5.1.1')).status).toBe(202);
    expect((await reg('l128@shop.vn', pw(128), '10.5.1.2')).status).toBe(202);
    const long = await reg('l129@shop.vn', pw(129), '10.5.1.3');
    expect(long.status).toBe(400);
    expect(long.body.errors).toEqual(expect.arrayContaining([{ field: 'password', code: 'too_long' }]));
    const dom = `${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(57)}.com`;
    const email254 = `${'a'.repeat(64)}@${dom}`;
    expect(email254).toHaveLength(254);
    expect((await reg(email254, PASSWORD, '10.5.1.4')).status).toBe(202);

    const blank = await reg('blank@shop.vn', PASSWORD, '10.5.1.5', '   ');
    expect(blank.status).toBe(400);
    expect(['required', 'too_short']).toContain(blank.body.errors.find((e: any) => e.field === 'full_name').code);
    expect(await q(t, "SELECT 1 FROM users WHERE email = 'blank@shop.vn'::citext")).toHaveLength(0);

    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const s1 = await seedSession(t, u1.id);
    const other = await post(t, '/auth/register', { email: 'n2@shop.vn', password: PASSWORD, full_name: 'N2' }, { cookie: s1.cookie, ip: '10.5.1.6' });
    expect(other.status).toBe(202);
    expect(other.headers['set-cookie']).toBeUndefined();
    expect(await q(t, `SELECT status FROM sessions WHERE id = '${s1.id}'::uuid`)).toEqual([{ status: 'active' }]);
    expect(await q(t, "SELECT 1 FROM outbox_events WHERE type = 'SessionRevoked'")).toHaveLength(0);

    const xss = '<script>alert(1)</script>';
    expect((await reg('xss@shop.vn', PASSWORD, '10.5.1.7', xss)).status).toBe(202);
    expect(await q(t, "SELECT full_name FROM users WHERE email = 'xss@shop.vn'::citext")).toEqual([{ full_name: xss }]); // lưu chuỗi thường; escape khi hiển thị ở web (E2E)
  }, 60_000);

  it('AUTH-TC-20261006-100640931: tiến trình chết (SIGKILL) ngay sau commit đăng ký: UserRegistered vẫn giao đúng một lần qua relay, không có event token', async () => {
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/register-then-die.ts'], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const [code, signal] = await new Promise<[number | null, string | null]>((r) => child.on('exit', (c, s) => r([c, s])));
    expect(signal).toBe('SIGKILL');
    expect(out).not.toContain('SURVIVED');
    const p = newPrisma();
    try {
      expect(await p.$queryRaw`SELECT 1 FROM users WHERE email = 'crash@shop.vn'::citext`).toHaveLength(1);
      const rows = await p.$queryRaw<{ type: string; dispatched_at: Date | null; payload: unknown }[]>`SELECT type, dispatched_at, payload FROM outbox_events`;
      expect(rows.map((r) => [r.type, r.dispatched_at])).toEqual([['UserRegistered', null]]);
      expect(code).toBeNull();
    } finally { await p.$disconnect(); }
    const seen: string[] = [];
    t.events.subscribe('NTF-stub', 'UserRegistered', async (_tx, e) => { seen.push(e.event_id); });
    await t.relay.runOnce(new Date(Date.now() + 1000));
    await t.relay.runOnce(new Date(Date.now() + 120_000));
    expect(seen).toHaveLength(1); // đúng một lần
    expect(t.mails).toHaveLength(0); // EmailVerificationRequested không phát (best-effort, không qua outbox)
    expect(JSON.stringify(await q(t, 'SELECT payload FROM outbox_events'))).not.toMatch(/token/i);
  }, 60_000);
});
