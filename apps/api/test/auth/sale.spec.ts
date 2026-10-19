import { Controller, Get } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Action, AuditService, Roles, Validate, auditPermissions, type AuditEntry, type Tx } from '../../src/modules/platform';
import { PlatformModule } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth';
import { NOW0, createAuthApp, get, http, login, post, q, seedSession, seedUser, type AuthApp } from '../support/auth';
import { StubOrdController, ProbeController } from '../support/probe';
import { ORIGIN } from '../support/app';
import { truncateAll } from '../support/db';

// Role `sale` (đợt bán hộ 2026-10-15): AUTH-REQ-20261006-095515956 (đổi role), ...918 (kiểm quyền), ...774 (đăng xuất), ...808 (phiên).

/** Endpoint thử cho kiểm lệch ma trận (AUTH-TC-20261015-092750167): một khai đúng, một khai thừa `sale` so với ma trận. */
@Controller('probe-sale')
class SaleMatrixProbe {
  @Get('ok') @Action('Thử đúng') @Roles('staff', 'admin') @Validate({})
  ok() { return { ok: true }; }

  @Get('wide') @Action('Thử thừa sale') @Roles('sale', 'staff', 'admin') @Validate({})
  wide() { return { ok: true }; }
}
const PROBE_MATRIX = [
  '| Hành động | Requirement | guest | customer | staff | sale | admin | system |', '|---|---|---|---|---|---|---|---|',
  '| Thử đúng | AUTH-REQ-20261006-095515918 | - | - | Y | - | Y | - |',
  '| Thử thừa sale | AUTH-REQ-20261006-095515918 | - | - | Y | - | Y | - |',
].join('\n');

describe('Role sale: đổi role, kiểm quyền, đăng xuất, phiên', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' }, imports: [PlatformModule, AuthModule], controllers: [ProbeController, StubOrdController, SaleMatrixProbe] }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.set(new Date(NOW0)); });

  const patchRole = (id: string, cookie: string | undefined, body: unknown, origin: string | null = ORIGIN) => {
    let r = http(t).patch(`/api/v1/admin/users/${id}/role`).set('Content-Type', 'application/json');
    if (origin) r = r.set('Origin', origin);
    if (cookie) r = r.set('Cookie', cookie);
    return r.send(JSON.stringify(body));
  };
  const as = async (role: 'customer' | 'staff' | 'sale' | 'admin', email?: string) => { const u = await seedUser(t, { role, email }); return { ...u, cookie: await login(t, u) }; };
  const roleOf = async (id: string) => (await q<{ role: string }>(t, `SELECT role FROM users WHERE id = '${id}'`))[0].role;
  const audits = (action: string) => q<any>(t, `SELECT actor_id, actor_role, target_id, before, after FROM audit_logs WHERE action = '${action}' ORDER BY created_at`);
  /** Ép hai giao dịch CHỒNG NHAU (như admin.spec): thiếu khóa tập admin thì cả hai cùng commit và test đỏ. */
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
  const ddl = (sql: string) => t.prisma.$executeRaw(Prisma.raw(sql)); // SQL cố định của test, không có đầu vào người dùng
  /**
   * Giả giá trị role ngoài tập hợp lệ (enum không cho gài trực tiếp): đổi cột tạm sang text trong thân hàm rồi trả lại. Đổi kiểu cột làm hỏng kế hoạch câu lệnh đã đệm
   * của kết nối cũ ("cached plan must not change result type"), nên thân hàm chạy trên một ứng dụng mới (kết nối mới) dựng sau khi đổi cột.
   */
  const withForeignRole = async (userId: string, fn: (app: AuthApp) => Promise<void>) => {
    await ddl('ALTER TABLE users ALTER COLUMN role DROP DEFAULT');
    await ddl('ALTER TABLE users ALTER COLUMN role TYPE text USING role::text');
    try {
      await ddl(`UPDATE users SET role = 'superuser' WHERE id = '${userId}'`);
      const app = await createAuthApp({ env: { TRUST_PROXY_HOPS: '1' }, imports: [PlatformModule, AuthModule], controllers: [ProbeController, StubOrdController] });
      try { await fn(app); } finally { await app.close(); }
    } finally {
      await ddl(`UPDATE users SET role = 'customer' WHERE id = '${userId}'`);
      await ddl('ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role');
      await ddl("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer'");
    }
  };

  it('AUTH-TC-20261015-092750047: admin gán role sale cho customer, đổi qua lại giữa các role, role mới có hiệu lực từ request kế tiếp', async () => {
    const a1 = await as('admin', 'a1@shop.vn');
    for (let i = 0; i < 3; i++) await seedUser(t, { role: 'sale', email: `s${i}@shop.vn` });
    for (let i = 0; i < 40; i++) await seedUser(t, { email: `c${i}@shop.vn` });
    const u2 = await as('customer', 'u2@shop.vn');
    const r = await patchRole(u2.id, a1.cookie, { role: 'sale' });
    expect([r.status, r.body]).toEqual([200, { id: u2.id, role: 'sale' }]);
    expect(await roleOf(u2.id)).toBe('sale');
    const a = await audits('user.change_role');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: a1.id, actor_role: 'admin', target_id: u2.id, before: { role: 'customer' }, after: { role: 'sale' } });

    // role đọc lại từ CSDL ở request kế tiếp: cùng phiên, không phải đăng nhập lại
    expect((await get(t, '/order-sources', u2.cookie)).status).toBe(200);
    for (const path of ['/admin/users', '/orders']) {
      const x = await get(t, path, u2.cookie);
      expect([path, x.status, x.body.type]).toEqual([path, 403, 'urn:ecom:error:forbidden']);
    }
    const list = await get(t, '/admin/users?role=sale', a1.cookie);
    expect([list.status, list.body.total, list.body.items.map((i: any) => i.email).includes('u2@shop.vn')]).toEqual([200, 4, true]);

    const a2 = await as('admin', 'a2@shop.vn');
    for (const [by, to] of [[a1, 'staff'], [a1, 'customer'], [a1, 'admin'], [a2, 'sale']] as const) {
      expect([to, (await patchRole(u2.id, by.cookie, { role: to })).status]).toEqual([to, 200]); // mọi cặp role đều hợp lệ
      expect(await roleOf(u2.id)).toBe(to);
    }
    expect(await audits('user.change_role')).toHaveLength(5);
  });

  it('AUTH-TC-20261015-092750085: đổi role bị từ chối với giá trị ngoài tập, sale không tự đổi role, sale và staff không gọi quản trị người dùng', async () => {
    const a1 = await as('admin', 'a1@shop.vn');
    const u2 = await seedUser(t, { email: 'u2@shop.vn' });
    const s1 = await as('sale', 's1@shop.vn');
    const t1 = await as('staff', 't1@shop.vn');
    for (const bad of ['superuser', 'system', 'guest', 'Sale', '']) {
      const r = await patchRole(u2.id, a1.cookie, { role: bad });
      expect([bad, r.status, r.body.type]).toEqual([bad, 400, 'urn:ecom:error:validation-failed']);
    }
    expect(await roleOf(u2.id)).toBe('customer');
    expect(await audits('user.change_role')).toHaveLength(0);

    const self = await patchRole(s1.id, s1.cookie, { role: 'admin' }); // tự nâng quyền
    expect([self.status, self.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);
    expect((await get(t, '/admin/users', s1.cookie)).status).toBe(403);
    expect((await patchRole(u2.id, t1.cookie, { role: 'sale' })).status).toBe(403);
    expect([await roleOf(s1.id), await roleOf(u2.id)]).toEqual(['sale', 'customer']);

    const own = await patchRole(a1.id, a1.cookie, { role: 'sale' });
    expect([own.status, own.body.type]).toEqual([403, 'urn:ecom:error:cannot_change_own_role']);
    expect((await patchRole(u2.id, a1.cookie, { role: 'sale' })).status).toBe(200);
    const same = await patchRole(u2.id, a1.cookie, { role: 'sale' });
    expect([same.status, same.body.type]).toEqual([409, 'urn:ecom:error:role_unchanged']);
    expect(await audits('user.change_role')).toHaveLength(1); // chỉ lần đổi thành công
    expect((await patchRole(u2.id, undefined, { role: 'sale' })).status).toBe(401);
  });

  it('AUTH-TC-20261015-092750130: hạ admin cuối thành sale bị chặn bằng last_admin; hạ một sale không làm mất dòng người dùng', async () => {
    const a1 = await as('admin', 'a1@shop.vn'), a2 = await as('admin', 'a2@shop.vn');
    const s1 = await as('sale', 's1@shop.vn');
    expect((await patchRole(a2.id, a1.cookie, { role: 'sale' })).status).toBe(200); // còn a1 là admin active
    expect((await get(t, '/admin/users', a2.cookie)).status).toBe(403);
    expect((await get(t, '/order-sources', a2.cookie)).status).toBe(200);
    const last = await patchRole(a1.id, a2.cookie, { role: 'customer' }); // a2 không còn là admin
    expect(last.status).toBe(403);
    expect(await q(t, "SELECT 1 FROM users WHERE role = 'admin' AND status = 'active'")).toHaveLength(1); // không bao giờ về 0 admin

    await t.prisma.$executeRaw`UPDATE users SET role = 'admin' WHERE id = ${a2.id}::uuid`;
    const spy = overlap();
    const res = await Promise.all([patchRole(a2.id, a1.cookie, { role: 'sale' }), patchRole(a1.id, a2.cookie, { role: 'sale' })]);
    spy.mockRestore();
    expect(res.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(res.map((r) => r.status).filter((s) => s === 403 || s === 409)).toHaveLength(1);
    expect(await q(t, "SELECT 1 FROM users WHERE role = 'admin' AND status = 'active'")).toHaveLength(1);

    // hạ sale về customer: mất quyền sale từ request kế tiếp, dòng người dùng (khóa của created_by) còn nguyên
    const admin = (await q<{ id: string }>(t, "SELECT id FROM users WHERE role = 'admin'"))[0].id;
    const adminCookie = admin === a1.id ? a1.cookie : a2.cookie;
    expect((await get(t, '/order-sources', s1.cookie)).status).toBe(200);
    expect((await patchRole(s1.id, adminCookie, { role: 'customer' })).status).toBe(200);
    expect((await get(t, '/order-sources', s1.cookie)).status).toBe(403);
    expect(await q(t, `SELECT 1 FROM users WHERE id = '${s1.id}'`)).toHaveLength(1);
  });

  it('AUTH-TC-20261015-092750167: kiểm quyền với role sale: chỉ vào endpoint có khai sale, mặc định từ chối, lệch ma trận có cột sale', async () => {
    const s1 = await as('sale', 's1@shop.vn');
    for (const path of ['/order-sources', '/admin/orders']) expect([path, (await get(t, path, s1.cookie)).status]).toEqual([path, 200]);
    for (const path of ['/admin/users', '/orders']) expect([path, (await get(t, path, s1.cookie)).status]).toEqual([path, 403]);
    const cancel = await post(t, '/orders/ABC-1/cancel', {}, { cookie: s1.cookie }); // customer, admin
    expect([cancel.status, cancel.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);
    const staffOnly = await get(t, '/probe/staff', s1.cookie); // @Roles('staff', 'admin'): không tự cho sale
    expect([staffOnly.status, staffOnly.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);

    // kiểm lệch ma trận báo endpoint khai thừa sale ở cột sale, và không báo endpoint khai đúng
    const out = auditPermissions(t.app, PROBE_MATRIX, { scope: (id) => id.includes('/probe-sale/') });
    expect(out).toEqual(['GET /api/v1/probe-sale/wide: code cho [admin, sale, staff] nhưng ma trận (Thử thừa sale) cho [admin, staff]']);
    // hàng `Sale <việc>` của cùng requirement gộp vào hàng `<Việc>`: cho sale thì hết lệch
    const merged = `${PROBE_MATRIX}\n| Sale thử thừa sale | AUTH-REQ-20261006-095515918 | - | - | - | own | - | - |`;
    expect(auditPermissions(t.app, merged, { scope: (id) => id.includes('/probe-sale/'), epic: 'AUTH', exempt: ['Thử đúng'] })).toEqual([]);

    // role lạ trong CSDL: guard từ chối (đóng khi không chắc), không cấp role nào
    const u = await seedUser(t, { email: 'odd@shop.vn' });
    const sess = await seedSession(t, u.id);
    await withForeignRole(u.id, async (app) => {
      for (const path of ['/order-sources', '/auth/session', '/admin/users', '/orders']) {
        const r = await get(app, path, sess.cookie);
        expect([path, r.status, r.body.type]).toEqual([path, 403, 'urn:ecom:error:forbidden']);
      }
    });
  });

  it('AUTH-TC-20261015-095530439: sale đăng xuất như mọi role: thu hồi phiên hiện tại, cookie cũ nhận 401, thiếu Origin nhận 403', async () => {
    const s1 = await seedUser(t, { role: 'sale', email: 's1@shop.vn' });
    const lastId = async () => (await q<{ id: string }>(t, `SELECT id FROM sessions WHERE user_id = '${s1.id}' ORDER BY created_at DESC LIMIT 1`))[0].id;
    const A = await login(t, s1); const idA = await lastId();
    t.clock.advance(1000); // hai phiên khác mốc tạo để lastId phân biệt được
    const B = await login(t, s1); const idB = await lastId();
    const status = async (id: string) => (await q<{ status: string; revoked_reason: string | null }>(t, `SELECT status, revoked_reason FROM sessions WHERE id = '${id}'`))[0];
    expect((await post(t, '/auth/logout', undefined, { cookie: A })).status).toBe(204);
    expect(await status(idA)).toEqual({ status: 'revoked', revoked_reason: 'logout' });
    expect(await q(t, `SELECT 1 FROM outbox_events WHERE type = 'SessionRevoked' AND aggregate_id = '${idA}'`)).toHaveLength(1); // aggregate_id là id phiên
    expect((await status(idB)).status).toBe('active');
    const old = await get(t, '/auth/session', A);
    expect([old.status, old.body.type]).toEqual([401, 'urn:ecom:error:unauthenticated']);
    const noOrigin = await post(t, '/auth/logout', undefined, { cookie: B, origin: null });
    expect([noOrigin.status, noOrigin.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect((await status(idB)).status).toBe('active');
    // đăng nhập của sale ghi được audit (CHECK actor_role của audit_logs có `sale`)
    expect(await audits('auth.login')).toMatchObject([{ actor_role: 'sale' }, { actor_role: 'sale' }]);
  });

  it('AUTH-TC-20261015-095530480: phiên của sale: GET /auth/session trả role sale, role đổi có hiệu lực ngay, mười phiên, khóa và role lạ bị từ chối', async () => {
    const a1 = await as('admin', 'a1@shop.vn');
    const u1 = await seedUser(t, { email: 'u1@shop.vn' });
    const cookie = await login(t, u1);
    expect((await patchRole(u1.id, a1.cookie, { role: 'sale' })).status).toBe(200);
    const s1 = await get(t, '/auth/session', cookie);
    expect([s1.status, s1.body.user.role]).toEqual([200, 'sale']);
    expect(Object.keys(s1.body).sort()).toEqual(['absolute_expires_at', 'idle_expires_at', 'user']);
    t.clock.advance(5 * 60_000);
    const s2 = await get(t, '/auth/session', cookie);
    expect(s2.body.idle_expires_at).toBe(s1.body.idle_expires_at); // endpoint không gia hạn

    // phiên thứ 11 đẩy phiên cũ nhất ra như mọi role
    await t.prisma.$executeRaw`DELETE FROM sessions WHERE user_id = ${u1.id}::uuid`;
    const base = t.clock.now().getTime();
    const seeded: Awaited<ReturnType<typeof seedSession>>[] = [];
    for (let i = 0; i < 10; i++) seeded.push(await seedSession(t, u1.id, { createdAt: new Date(base - (20 - i) * 1000) }));
    await login(t, u1);
    expect(await q(t, `SELECT 1 FROM sessions WHERE user_id = '${u1.id}' AND status = 'active'`)).toHaveLength(10);
    expect(await q(t, `SELECT 1 FROM sessions WHERE id = '${seeded[0].id}' AND status = 'revoked' AND revoked_reason = 'replaced'`)).toHaveLength(1);

    // khóa: 401; role lạ: guard từ chối, không cấp role nào
    await withForeignRole(u1.id, async (app) => {
      app.clock.set(t.clock.now());
      const r = await get(app, '/order-sources', seeded[9].cookie);
      expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);
    });
    await t.prisma.$executeRaw`UPDATE users SET status = 'locked', locked_reason = 'admin' WHERE id = ${u1.id}::uuid`;
    expect((await get(t, '/auth/session', seeded[9].cookie)).status).toBe(401);
  });
});
