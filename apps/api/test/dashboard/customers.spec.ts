import { bulkUsers, createDshApp, DASH, get, MIN, people, reset, seedUser, withTimeout, later, type DshApp, type People } from '../support/dsh';
import { q } from '../support/auth';

// DSH-REQ-20261006-105125901 (ô khách hàng): nguồn là UserApi (USR gọi AUTH) thật trên PostgreSQL thật.
describe('DSH khách hàng (DSH-REQ-20261006-105125901)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const customers = (qs = '?from=2026-10-01&to=2026-10-06', cookie: string | undefined = p.admin.cookie) => get(t, cookie, `${DASH.customers}${qs}`);
  // `people` đã tạo 1 customer, 1 staff, 2 admin: các test tính phần dư đó.

  it('DSH-TC-20261006-110330483: tổng khách, khách bị khóa và khách mới trong khoảng (staff và admin không tính)', async () => {
    await bulkUsers(t, { n: 1163, locked: 15, createdAt: new Date('2026-06-01T03:00:00Z') }); // 1.163 + 1 khách của `people` = 1.164 trước khoảng
    await bulkUsers(t, { n: 36, createdAt: new Date('2026-10-03T03:00:00Z') }); // + 36 trong khoảng
    await bulkUsers(t, { role: 'staff', n: 3, createdAt: new Date('2026-10-02T03:00:00Z') });
    await bulkUsers(t, { role: 'admin', n: 0, createdAt: new Date('2026-10-02T03:00:00Z') });
    await t.prisma.$executeRaw`UPDATE users SET created_at = ${new Date('2026-10-05T03:00:00Z')}::timestamptz WHERE email = 'khach@shop.vn'`; // khách của `people` cũng là khách mới: 36 + 1 = 37
    const r = await customers();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ from: '2026-10-01', to: '2026-10-06', as_of: '2026-10-06T03:00:00Z', total: 1200, locked: 15, new_in_range: 37 });
    const [{ staff }] = await q<{ staff: number }>(t, `SELECT count(*)::int AS staff FROM users WHERE role <> 'customer'`);
    expect(staff).toBe(2 + 1 + 3); // 2 admin + 1 staff của `people` + 3 staff hàng loạt: không ai trong số đó được đếm
  });

  it('DSH-TC-20261006-110330511: staff và customer nhận 403, chưa đăng nhập 401, USR được gọi 0 lần; phản hồi của admin chỉ có đúng các khóa số đếm', async () => {
    const spy = jest.spyOn(t.usr, 'countCustomers');
    for (const w of [p.staff, p.customer]) { const r = await customers('', w.cookie); expect([r.status, r.text.includes('total')]).toEqual([403, false]); }
    expect((await get(t, undefined, DASH.customers)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    const ok = await customers('');
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(['as_of', 'from', 'locked', 'new_in_range', 'to', 'total']);
    expect(ok.text).not.toMatch(/@|email|phone|full_name|Người Dùng/);
  });

  it('DSH-TC-20261006-110330539: ngày kết thúc sau hôm nay nhận 400 ở số khách, USR được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.usr, 'countCustomers');
    const r = await customers('?to=2026-10-07');
    expect([r.status, r.body.type, r.body.errors[0].field]).toEqual([400, 'urn:ecom:error:invalid-parameter', 'to']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110330567: USR quá hạn trả 503 nguồn USR, không phải số 0', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.usr, 'countCustomers').mockImplementation(() => later(1500, { total: 0, locked: 0, new_in_range: 0 }));
    const r = await customers();
    expect([r.status, r.body.source, r.body.type]).toEqual([503, 'USR', 'urn:ecom:error:dashboard-source-unavailable']);
    expect(r.text).not.toContain('total');
  });

  it('DSH-TC-20261006-110330595: hệ thống mới chưa có customer thì ba số bằng 0', async () => {
    await t.prisma.$executeRaw`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'customer')`;
    await t.prisma.$executeRaw`DELETE FROM users WHERE role = 'customer'`;
    const r = await customers();
    expect(r.body).toMatchObject({ total: 0, locked: 0, new_in_range: 0 });
  });

  it('DSH-TC-20261006-110330625: khách tạo đúng 00:00 giờ Việt Nam thuộc ngày mới', async () => {
    await t.prisma.$executeRaw`UPDATE users SET created_at = ${new Date('2026-09-01T03:00:00Z')}::timestamptz WHERE role = 'customer'`;
    const k = await seedUser(t, { email: 'k@shop.vn', createdAt: new Date('2026-10-05T17:00:00Z') });
    expect(k.id).toBeTruthy();
    expect((await customers('?from=2026-10-05&to=2026-10-05')).body.new_in_range).toBe(0);
    expect((await customers('?from=2026-10-06&to=2026-10-06')).body.new_in_range).toBe(1);
  });

  it('DSH-TC-20261006-110330652: đổi role customer sang staff làm total giảm 1 sau khi hết bộ nhớ đệm 60 giây', async () => {
    await bulkUsers(t, { n: 1199, createdAt: new Date('2026-06-01T03:00:00Z') });
    const spy = jest.spyOn(t.usr, 'countCustomers');
    expect((await customers()).body.total).toBe(1200);
    await t.prisma.$executeRaw`UPDATE users SET role = 'staff' WHERE email = 'khach@shop.vn'`;
    t.clock.advance(30_000);
    expect((await customers()).body.total).toBe(1200); // còn trong hạn đệm
    t.clock.advance(31_000);
    expect((await customers()).body.total).toBe(1199);
    expect([spy.mock.calls.length, MIN]).toEqual([2, 60_000]);
  });
});
