import { NOW0, createAuthApp, get, http, login, post, seedUser, type AuthApp } from '../support/auth';
import { ORIGIN } from '../support/app';
import { truncateAll } from '../support/db';

// Chuỗi biên (SB-11) và bậc D của quản trị người dùng (SB-14): sửa sau review AUTH đợt "bán hàng hộ" (không có TC riêng).
describe('AUTH chuỗi biên: NUL, email Kelvin, giới hạn tần suất quản trị', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.mails.length = 0; t.clock.set(new Date(NOW0)); });
  const asAdmin = async () => { const u = await seedUser(t, { role: 'admin', email: `adm${Math.random().toString(36).slice(2, 8)}@shop.vn` }); return { ...u, cookie: await login(t, u) }; };
  const NUL = '\u0000';

  it('NUL ở login.email, register.full_name, admin.q, lock.reason trả 400 validation-failed (không 500)', async () => {
    const a = await asAdmin();
    const u = await seedUser(t, { email: 'u1@shop.vn' });
    const rs = [
      await post(t, '/auth/login', { email: `u1${NUL}@shop.vn`, password: 'x' }),
      await post(t, '/auth/register', { email: 'n1@shop.vn', password: 'Correct-Horse-9', full_name: `An${NUL}` }),
      await get(t, `/admin/users?q=ab${NUL}cd`, a.cookie),
      await post(t, `/admin/users/${u.id}/lock`, { reason: `x${NUL}` }, { cookie: a.cookie }),
    ];
    expect(rs.map((r) => [r.status, r.body.type])).toEqual(rs.map(() => [400, 'urn:ecom:error:validation-failed']));
  });

  it('email có ký hiệu Kelvin (U+212A) không đăng nhập được vào tài khoản `kim@` (citext gấp Kelvin thành k); chữ hoa ASCII vẫn vào', async () => {
    const k = await seedUser(t, { email: 'kim@shop.vn' });
    const bad = await post(t, '/auth/login', { email: 'Kim@shop.vn', password: k.password });
    expect([bad.status, bad.body.type]).toEqual([401, 'urn:ecom:error:invalid_credentials']);
    expect((await post(t, '/auth/login', { email: ' KIM@shop.vn ', password: k.password })).status).toBe(200);
  });

  it('bốn endpoint quản trị người dùng chung bậc D 30 mỗi phút mỗi quản trị: lần 31 là 429 kèm Retry-After, quản trị khác không bị ảnh hưởng', async () => {
    const a = await asAdmin();
    const b = await asAdmin();
    const hit = (c: string) => get(t, '/admin/users', c);
    const rs = await Promise.all(Array.from({ length: 31 }, () => hit(a.cookie)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(30);
    const over = rs.find((r) => r.status === 429)!;
    expect([over.body.type, Number(over.headers['retry-after']) > 0]).toEqual(['urn:ecom:error:rate-limited', true]);
    const unlock = await http(t).post(`/api/v1/admin/users/${b.id}/unlock`).set('Origin', ORIGIN).set('Cookie', a.cookie); // chung bộ đếm với list
    expect(unlock.status).toBe(429);
    expect((await hit(b.cookie)).status).toBe(200);
  });
});
