import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AppLogger, Clock, ConfigService, auditPermissions, auditRoutes, configureApp, parseMatrix } from '../../src/modules/platform';
import { NOW0, createAuthApp, get, http, login, post, q, seedUser, type AuthApp } from '../support/auth';
import { FakeClock, ORIGIN, createTestApp, testConfig } from '../support/app';
import { UndeclaredProbeController } from '../support/probe';
import { REPO_ROOT, truncateAll } from '../support/db';

const MATRIX_PATH = resolve(REPO_ROOT, 'spec/permissions-matrix.md');
const AUTH_SCOPE = (id: string) => /\s\/api\/v1\/(auth|admin\/users)(\/|$)/.test(id);
const EXEMPT = ['Kiểm quyền endpoint theo role (mặc định từ chối)'];

describe('Kiểm quyền theo role (AUTH-REQ-20261006-095515918)', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.set(new Date(NOW0)); });
  const as = async (role: 'customer' | 'staff' | 'admin') => login(t, await seedUser(t, { role }));
  const patchRole = (id: string, cookie: string, role: string) => http(t).patch(`/api/v1/admin/users/${id}/role`).set('Cookie', cookie).set('Origin', ORIGIN).set('Content-Type', 'application/json').send(JSON.stringify({ role }));

  it('AUTH-TC-20261006-100641948: staff và admin qua kiểm role xem mọi đơn; admin qua kiểm role khi hủy đơn (stub ORD)', async () => {
    for (const role of ['staff', 'admin'] as const) {
      const r = await get(t, '/admin/orders', await as(role));
      expect([role, r.status]).toEqual([role, 200]);
    }
    const c = await post(t, '/orders/ABC-1/cancel', {}, { cookie: await as('admin') });
    expect(c.status).toBe(200); // qua kiểm role; kết quả sau đó theo ORD
  });

  it('AUTH-TC-20261006-100641994: guard từ chối đúng cách: 403 forbidden không lộ dữ liệu, guest 401, staff không hủy được đơn, trường role từ client không tự cấp quyền', async () => {
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const cookie = await login(t, u1);
    for (const path of ['/admin/orders', '/admin/users']) {
      const r = await get(t, path, cookie);
      expect([path, r.status, r.body.type]).toEqual([path, 403, 'urn:ecom:error:forbidden']);
      expect(Object.keys(r.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']); // không có dữ liệu, không có chi tiết nội bộ
    }
    const guest = await get(t, '/orders');
    expect([guest.status, guest.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']);
    expect((await post(t, '/orders/ABC-1/cancel', {}, { cookie: await as('staff') })).status).toBe(403);

    const bodies: [string, object][] = [
      ['/auth/register', { email: 'x@shop.vn', password: 'Correct-Horse-9', full_name: 'X', role: 'admin' }], ['/auth/login', { email: u1.email, password: u1.password, role: 'admin' }],
      ['/auth/verify-email', { token: 'x'.repeat(43), role: 'admin' }], ['/auth/verify-email/resend', { role: 'admin' }], ['/auth/logout', { role: 'admin' }],
      ['/auth/password/forgot', { email: u1.email, role: 'admin' }], ['/auth/password/reset', { token: 'x'.repeat(43), new_password: 'Correct-Horse-99', role: 'admin' }], // scan-secrets:allow mật khẩu thử
      [`/admin/users/${u1.id}/lock`, { role: 'admin' }], [`/admin/users/${u1.id}/unlock`, { role: 'admin' }],
    ];
    for (const [path, body] of bodies) {
      const r = await post(t, path, body, { cookie, ip: '10.9.0.1' });
      expect([path, r.status === 400 || r.status === 403]).toEqual([path, true]); // bị từ chối, không có 2xx
    }
    expect((await patchRole(u1.id, cookie, 'admin')).status).toBe(403);
    expect(await q(t, `SELECT role FROM users WHERE id = '${u1.id}'`)).toEqual([{ role: 'customer' }]);
  });

  it('AUTH-TC-20261006-100642038: endpoint không khai quyền bị 403 với admin và kiểm route báo; hạ quyền tức thì; phiên hết hạn 401; không có role system từ cookie; kiểm lệch ma trận báo và đóng khi hỏng', async () => {
    // endpoint không khai: 403 cả với admin; kiểm route báo đúng route đó; ứng dụng thật (AppModule) sạch
    const bad = await createTestApp({ imports: [AppModule], controllers: [UndeclaredProbeController] });
    try {
      const v = auditRoutes(bad.app);
      expect(v).toContain('GET /api/v1/probe-bad/undeclared: thiếu khai báo quyền (@Public, @Roles hoặc @SystemEndpoint)');
      expect(v).toHaveLength(2); // undeclared và empty
    } finally { await bad.close(); }
    const bare = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(testConfig()).overrideProvider(Clock).useValue(new FakeClock()).compile();
    const real = bare.createNestApplication({ bodyParser: false, logger: false });
    configureApp(real, { config: testConfig(), logger: AppLogger.create({ level: 'error', env: 'dev' }) });
    await real.init();
    try {
      expect(auditRoutes(real)).toEqual([]); // mọi route thật (health, auth, admin/users) đã khai quyền và schema
      const matrixMd = readFileSync(MATRIX_PATH, 'utf8');
      expect(auditPermissions(real, matrixMd, { scope: AUTH_SCOPE, epic: 'AUTH', exempt: EXEMPT })).toEqual([]);

      // kiểm lệch ma trận phải báo khi code khai sai: đổi một hàng của ma trận (gửi lại chỉ cho staff) thì báo lệch
      const tampered = matrixMd.replace(/^(\| Gửi lại email xác minh \|[^|]*\|)[^|]*\|[^|]*\|[^|]*\|/m, '$1 - | - | Y |');
      expect(tampered).not.toBe(matrixMd);
      expect(auditPermissions(real, tampered, { scope: AUTH_SCOPE, epic: 'AUTH', exempt: EXEMPT }).join('\n')).toContain('code cho [customer] nhưng ma trận (Gửi lại email xác minh) cho [staff]');
      // ma trận rỗng, hàng bị mất hoặc đổi tên: lỗi (không im lặng cho qua)
      expect(auditPermissions(real, '', { scope: AUTH_SCOPE })).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
      expect(auditPermissions(real, matrixMd.replace('| Khóa tài khoản người dùng |', '| Khóa người dùng |'), { scope: AUTH_SCOPE, epic: 'AUTH', exempt: EXEMPT }).join('\n')).toContain('không có trong permissions-matrix.md');
      expect(parseMatrix(matrixMd).filter((r) => r.requirement.startsWith('AUTH-REQ-'))).toHaveLength(13);
      // phạm vi rỗng (không route nào khớp) mà epic có hàng: báo hàng không có endpoint
      expect(auditPermissions(real, matrixMd, { scope: () => false, epic: 'AUTH', exempt: EXEMPT }).length).toBeGreaterThan(10);
    } finally { await real.close(); }

    const probeBad = await createAuthApp({ controllers: [UndeclaredProbeController] });
    try {
      const adminCookie = await login(probeBad, await seedUser(probeBad, { role: 'admin' }));
      for (const path of ['/probe-bad/undeclared', '/probe-bad/empty']) expect([path, (await get(probeBad, path, adminCookie)).status]).toEqual([path, 403]);
    } finally { await probeBad.close(); }

    // hạ quyền tức thì
    const a1 = await seedUser(t, { role: 'admin' }), a2 = await seedUser(t, { role: 'admin' });
    const c1 = await login(t, a1), c2 = await login(t, a2);
    expect((await get(t, '/admin/users', c1)).status).toBe(200);
    expect((await patchRole(a1.id, c2, 'customer')).status).toBe(200);
    expect((await get(t, '/admin/users', c1)).status).toBe(403);

    // phiên hết hạn: 401 session_expired, không phải 403
    const staff = await seedUser(t, { role: 'staff' });
    const cs = await login(t, staff);
    t.clock.advance(31 * 60_000);
    const exp = await get(t, '/probe/staff', cs);
    expect([exp.status, exp.body.type]).toEqual([401, 'urn:ecom:error:session_expired']);

    // tác nhân hệ thống: cookie phiên không bao giờ vào endpoint dành cho system, role system không tồn tại cho tài khoản
    t.clock.set(new Date(NOW0));
    const callers: Record<string, string | undefined> = { guest: undefined, customer: await as('customer'), staff: await as('staff'), admin: await as('admin') };
    for (const [who, cookie] of Object.entries(callers)) {
      const r = await post(t, '/probe/system', {}, { cookie, ip: '10.9.1.1' });
      expect([who, JSON.stringify(r.body)]).toEqual([who, JSON.stringify({ RspCode: '97', Message: 'Invalid signature' })]); // chữ ký sai: từ chối theo định dạng cổng, handler không chạy
      expect(r.body.reached).toBeUndefined();
    }
    expect(await q<{ r: string[] }>(t, "SELECT enum_range(NULL::user_role)::text AS r")).toEqual([{ r: '{customer,staff,admin}' }]);
    expect((await get(t, '/auth/session', callers.admin)).body.user.role).toBe('admin');
  });
});
