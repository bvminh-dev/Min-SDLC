import { UserApi } from '../../src/modules/user';
import { createAuthApp, seedUser, type AuthApp } from '../support/auth';
import { truncateAll } from '../support/db';
import { UserModule } from '../../src/modules/user';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { PlatformModule } from '../../src/modules/platform';

// Sửa nền USR kèm epic DSH (DSH-REQ-20261006-105125901 BR4): `UserApi.countCustomers(range)` gọi AUTH, chỉ trả số đếm.
describe('USR sửa nền cho DSH: UserApi.countCustomers', () => {
  let t: AuthApp;
  let usr: UserApi;
  beforeAll(async () => { t = await createAuthApp({ imports: [PlatformModule, AuthModule, UserModule], controllers: [] }); usr = t.app.get(UserApi); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });

  it('DSH-TC-20261006-110330483 (nền USR): countCustomers(range) gọi AUTH một lần và trả đúng ba số đếm, không trường cá nhân', async () => {
    await seedUser(t, { email: 'a@shop.vn', createdAt: new Date('2026-10-02T00:00:00Z') });
    await seedUser(t, { email: 'b@shop.vn', status: 'locked', lockedReason: 'admin', createdAt: new Date('2026-09-02T00:00:00Z') });
    const spy = jest.spyOn(t.api, 'countCustomerStats');
    const r = await usr.countCustomers({ from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-07T00:00:00Z') });
    expect(r).toEqual({ total: 2, locked: 1, new_in_range: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toMatch(/@|email|name/);
    expect(Object.getOwnPropertyNames(UserApi.prototype).filter((n) => n !== 'constructor')).toEqual(['countCustomers', 'lookupForSale', 'suggestForSale', 'isCustomer', 'unmaskPhone']); // hai hàm sau cho SAL (đợt bán hộ, USR-REQ-20261006-101004117 BR9); không hàm nào khác trả dữ liệu cá nhân cho DSH
    expect(UserApi.prototype.countCustomers.length).toBe(1);
  });
});
