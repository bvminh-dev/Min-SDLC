import { createAuthApp, seedUser, type AuthApp } from '../support/auth';
import { truncateAll } from '../support/db';
import { bulkUsers } from '../support/dsh';

// Sửa nền AUTH kèm epic DSH (DSH-REQ-20261006-105125901, DSH-API mục Giao tiếp giữa module): `AuthApi.countCustomerStats(range)` cho `UserApi.countCustomers`.
describe('AUTH sửa nền cho DSH: countCustomerStats', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });
  const RANGE = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-07T00:00:00Z') };

  it('AUTH-TC-20261013-232524562 và DSH-TC-20261006-110330483 (nền AUTH): tổng khách, khách khóa và khách mới trong [from, to) trong MỘT câu truy vấn; staff và admin không tính', async () => {
    await seedUser(t, { email: 'a@shop.vn', createdAt: new Date('2026-09-01T00:00:00Z') });
    await seedUser(t, { email: 'b@shop.vn', createdAt: new Date('2026-10-01T00:00:00Z'), status: 'locked', lockedReason: 'admin' }); // đúng `from`: gồm
    await seedUser(t, { email: 'c@shop.vn', createdAt: new Date('2026-10-06T23:59:59Z') });
    await seedUser(t, { email: 'd@shop.vn', createdAt: new Date('2026-10-07T00:00:00Z') }); // đúng `to`: loại
    await seedUser(t, { email: 's@shop.vn', role: 'staff', createdAt: new Date('2026-10-02T00:00:00Z') });
    await seedUser(t, { email: 'm@shop.vn', role: 'admin', createdAt: new Date('2026-10-02T00:00:00Z') });
    const spy = jest.spyOn(t.prisma, '$queryRaw');
    expect(await t.api.countCustomerStats(RANGE)).toEqual({ total: 4, locked: 1, new_in_range: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await t.api.countCustomers()).toBe(4); // hàm cũ giữ nguyên
    spy.mockRestore();
  });

  it('AUTH-TC-20261013-232524562 và DSH-TC-20261006-110330595 (nền AUTH): hệ thống chưa có customer thì ba số bằng 0; khoảng sai ném RangeError, lỗi CSDL được ném nguyên (không trả 0 thay số thật)', async () => {
    await seedUser(t, { email: 'm@shop.vn', role: 'admin' });
    expect(await t.api.countCustomerStats(RANGE)).toEqual({ total: 0, locked: 0, new_in_range: 0 });
    for (const bad of [{ from: RANGE.to, to: RANGE.from }, { from: new Date('x'), to: RANGE.to }, { from: new Date('0000-12-31T00:00:00Z'), to: RANGE.to }, { from: RANGE.from, to: new Date('10000-01-01T00:00:00Z') }, null, {}]) await expect(t.api.countCustomerStats(bad as never)).rejects.toBeInstanceOf(RangeError);
    const spy = jest.spyOn(t.prisma, '$queryRaw').mockRejectedValueOnce(new Error('CSDL chết'));
    await expect(t.api.countCustomerStats(RANGE)).rejects.toThrow('CSDL chết');
    spy.mockRestore();
  });

  it('DSH-TC-20261006-110330483 (nền AUTH): đếm 1.200 khách bằng một lần gọi, đúng số khóa', async () => {
    await bulkUsers(t, { n: 1200, locked: 15, createdAt: new Date('2026-10-03T00:00:00Z') });
    expect(await t.api.countCustomerStats(RANGE)).toEqual({ total: 1200, locked: 15, new_in_range: 1200 });
  });
});
