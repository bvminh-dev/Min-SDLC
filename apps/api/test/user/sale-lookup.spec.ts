import { createHash } from 'node:crypto';
import { AuditService } from '../../src/modules/platform';
import { UserApi } from '../../src/modules/user';
import { q, seedUser } from '../support/auth';
import { auditRows, call, createUsrApp, setProfile, userWithSession, type UsrApp } from '../support/usr';
import { truncateAll } from '../support/db';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// Đợt bán hộ: USR-REQ-20261006-101004117 BR9 (UserApi.lookupForSale, UserApi.isCustomer) và AuthApi.findCustomersByPhone (chỉ mục users_phone_idx).
describe('USR giao diện tra khách cho sale (USR-REQ-20261006-101004117 BR9)', () => {
  let t: UsrApp;
  let usr: UserApi;
  beforeAll(async () => { t = await createUsrApp(); usr = t.app.get(UserApi); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); });

  const customer = async (email: string, name: string, phone: string | null) => { const c = await seedUser(t, { email, name }); if (phone) await setProfile(t, c.id, { phone }); return c; };

  it('sale tự phục vụ như staff: xem và sửa hồ sơ, đổi mật khẩu 200; sổ địa chỉ vẫn chỉ customer (403)', async () => {
    const sl = await userWithSession(t, { email: 'sl2@shop.vn', role: 'sale', password: 'Correct-Horse-9' });
    const me = await call(t, 'get', '/me', { cookie: sl.cookie });
    expect([me.status, me.body.role]).toEqual([200, 'sale']);
    expect((await call(t, 'patch', '/me', { cookie: sl.cookie, body: { full_name: 'Sale Mới' } })).status).toBe(200);
    expect((await call(t, 'get', '/me/addresses', { cookie: sl.cookie })).status).toBe(403);
    // đổi mật khẩu thu hồi phiên cũ nên đặt cuối
    expect((await call(t, 'put', '/me/password', { cookie: sl.cookie, body: { current_password: 'Correct-Horse-9', new_password: 'Another-Horse-77' } })).status).toBe(200); // scan-secrets:allow (mật khẩu giả của test)
  });

  it('USR-TC-20261015-094057672: sale không gọi được hai endpoint tra cứu khách của USR', async () => {
    const sl1 = await userWithSession(t, { email: 'sl1@shop.vn', role: 'sale' });
    const st = await userWithSession(t, { email: 'st1@shop.vn', role: 'staff' });
    const c1 = await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    for (const [path, query] of [['/admin/customers', { email: 'an.nguyen@shop.vn' }], [`/admin/customers/${c1.id}`, {}]] as const) {
      const r = await call(t, 'get', path, { cookie: sl1.cookie }).query(query);
      expect([path, r.status, r.body.type]).toEqual([path, 403, 'urn:ecom:error:forbidden']);
      expect(JSON.stringify(r.body)).not.toContain('Nguyễn An'); // không có dữ liệu khách
    }
    expect(await auditRows(t, 'usr.customer_lookup')).toHaveLength(0);
    const ok = await call(t, 'get', '/admin/customers', { cookie: st.cookie }).query({ email: 'an.nguyen@shop.vn' }); // hành vi cũ của staff
    expect([ok.status, ok.body.email]).toEqual([200, 'an***@shop.vn']);
  });

  it('USR-TC-20261015-094057707: UserApi.lookupForSale trả bản che tối đa 5 và ghi audit', async () => {
    const s1 = await seedUser(t, { email: 's1@shop.vn', role: 'sale' });
    const c1 = await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    for (let i = 0; i < 6; i++) await customer(`dup${i}@shop.vn`, `Trùng ${i}`, '0944444444');
    await customer('staff.phone@shop.vn', 'Nhân viên', '0955555555'); // role khác không bao giờ vào kết quả
    await t.prisma.$executeRaw`UPDATE users SET role = 'staff' WHERE email = 'staff.phone@shop.vn'::citext`;
    const actor = { actor_id: s1.id, actor_role: 'sale' as const };

    const one = await usr.lookupForSale(actor, { phone: '0901234567' });
    expect(one.items).toEqual([{ id: c1.id, full_name: 'Nguyễn An', email: 'an***@shop.vn', phone: '090****567', status: 'active' }]); // không email_verified, địa chỉ
    expect((await usr.lookupForSale(actor, { phone: '0944444444' })).items).toHaveLength(5);
    expect((await usr.lookupForSale(actor, { phone: '0955555555' })).items).toEqual([]); // staff: cùng nội dung như không tồn tại
    expect((await usr.lookupForSale(actor, { phone: '0966666666' })).items).toEqual([]);
    expect((await usr.lookupForSale(actor, { phone: '+84 901 234 567' })).items.map((i) => i.id)).toEqual([c1.id]); // chuẩn hóa như hồ sơ
    expect((await usr.lookupForSale(actor, { email: 'An.Nguyen@Shop.vn' })).items.map((i) => i.id)).toEqual([c1.id]);

    const a = await auditRows(t, 'usr.customer_lookup');
    expect(a).toHaveLength(6); // một dòng mỗi lần gọi (6 lần gọi hợp lệ)
    const by = (key: string) => a.filter((r) => r.target_id === sha(key)); // đồng hồ giả: các dòng cùng created_at nên không dựa vào thứ tự
    expect(by('0901234567')).toHaveLength(2); // lần đầu và lần +84 đã chuẩn hóa
    expect(by('0901234567')[0]).toMatchObject({ actor_id: s1.id, actor_role: 'sale', target_type: 'customer', after: { by: 'phone', found: 1, mask: 'masked' } });
    expect(by('0944444444')[0]).toMatchObject({ after: { found: 5 } });
    expect(by('an.nguyen@shop.vn')[0]).toMatchObject({ after: { by: 'email', found: 1 } });
    expect(JSON.stringify(a)).not.toContain('0901234567'); // khóa tra chỉ ở dạng băm

    // đúng một khóa: thiếu hoặc thừa là 400 validation-failed, không audit
    const before = (await auditRows(t, 'usr.customer_lookup')).length;
    for (const key of [{}, { phone: '0901234567', email: 'an.nguyen@shop.vn' }, { phone: '' }]) {
      await expect(usr.lookupForSale(actor, key)).rejects.toMatchObject({ code: 'validation-failed' });
    }
    expect((await auditRows(t, 'usr.customer_lookup')).length).toBe(before);

    // chuỗi biên: NUL, nửa cặp thay thế lẻ, email ngoài ASCII (Kelvin U+212A thành `k` ở toLowerCase và ở citext) là 400, không 500, không khớp khách `kim@`, không audit
    await customer('kim@shop.vn', 'Kim', '0977777777');
    for (const key of [{ phone: '09\u000011' }, { email: 'a\u0000b@shop.vn' }, { email: '\u212Aim@shop.vn' }, { email: `a${String.fromCharCode(0xd800)}@shop.vn` }]) {
      await expect(usr.lookupForSale(actor, key)).rejects.toMatchObject({ code: 'validation-failed' });
    }
    expect((await usr.lookupForSale(actor, { email: 'KIM@shop.vn' })).items).toHaveLength(1); // chữ hoa ASCII vẫn chuẩn hóa
    expect((await auditRows(t, 'usr.customer_lookup')).length).toBe(before + 1);

    // audit ghi TRƯỚC khi trả; lỗi ghi audit thì ném lỗi và không trả dữ liệu
    const spy = jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('audit hỏng'));
    await expect(usr.lookupForSale(actor, { phone: '0901234567' })).rejects.toThrow('audit hỏng');
    spy.mockRestore();
    expect((await auditRows(t, 'usr.customer_lookup')).length).toBe(before + 1);

    // admin cũng gọi được với actor_role admin
    const ad = await seedUser(t, { email: 'ad@shop.vn', role: 'admin' });
    await usr.lookupForSale({ actor_id: ad.id, actor_role: 'admin' }, { phone: '0901234567' });
    expect((await auditRows(t, 'usr.customer_lookup')).filter((r) => r.actor_role === 'admin')).toHaveLength(1);
  });

  it('AuthApi.findCustomersByPhone (thêm ngoài TC, giao diện AUTH cho SAL): khớp chính xác, chỉ role customer, có chỉ mục users_phone_idx', async () => {
    const c1 = await customer('a@shop.vn', 'A', '0901234567');
    await customer('b@shop.vn', 'B', '0901234568');
    const api = t.api;
    expect((await api.findCustomersByPhone('0901234567')).map((u) => u.id)).toEqual([c1.id]);
    expect(await api.findCustomersByPhone('090123456')).toEqual([]); // không khớp tiền tố
    expect(await api.findCustomersByPhone('')).toEqual([]);
    for (let i = 0; i < 25; i++) await customer(`m${i}@shop.vn`, `M${i}`, '0977777777');
    expect(await api.findCustomersByPhone('0977777777', 100)).toHaveLength(20); // trần 20
    expect(await api.findCustomersByPhone('0977777777', 3)).toHaveLength(3);
    // mới nhất trước (created_at DESC), cùng created_at thì theo id; trần cắt khách CŨ
    const o = await seedUser(t, { email: 'o@shop.vn', name: 'O', createdAt: new Date('2026-10-01T00:00:00Z') });
    const n = await seedUser(t, { email: 'n@shop.vn', name: 'N', createdAt: new Date('2026-10-02T00:00:00Z') });
    await setProfile(t, o.id, { phone: '0966666666' }); await setProfile(t, n.id, { phone: '0966666666' });
    expect((await api.findCustomersByPhone('0966666666')).map((u) => u.id)).toEqual([n.id, o.id]);
    expect((await api.findCustomersByPhone('0966666666', 1)).map((u) => u.id)).toEqual([n.id]);
    const same = new Date('2026-10-03T00:00:00Z');
    const t1 = await seedUser(t, { email: 't1@shop.vn', name: 'T1', createdAt: same });
    const t2 = await seedUser(t, { email: 't2@shop.vn', name: 'T2', createdAt: same });
    await setProfile(t, t1.id, { phone: '0966666667' }); await setProfile(t, t2.id, { phone: '0966666667' });
    expect((await api.findCustomersByPhone('0966666667')).map((u) => u.id)).toEqual([t1.id, t2.id].sort());
    const idx = await q<{ indexdef: string }>(t, "SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_phone_idx'");
    expect(idx[0].indexdef).toContain('(phone)');
  });

  it('USR-TC-20261015-094057743: UserApi.isCustomer chỉ đúng với customer', async () => {
    const c1 = await customer('c1@shop.vn', 'C1', null);
    const st = await seedUser(t, { email: 'st@shop.vn', role: 'staff' });
    const ad = await seedUser(t, { email: 'ad@shop.vn', role: 'admin' });
    const sl = await seedUser(t, { email: 'sl@shop.vn', role: 'sale' });
    const locked = await seedUser(t, { email: 'lk@shop.vn', status: 'locked', lockedReason: 'admin' });
    const cases: [string, string, boolean][] = [
      ['customer', c1.id, true], ['customer đang khóa', locked.id, true], ['staff', st.id, false], ['admin', ad.id, false], ['sale', sl.id, false],
      ['uuid không tồn tại', '99999999-9999-4999-8999-999999999999', false], ['chuỗi abc', 'abc', false], ['rỗng', '', false],
    ];
    for (const [name, id, want] of cases) expect([name, await usr.isCustomer(id)]).toEqual([name, want]);
    expect(await usr.isCustomer(undefined as unknown as string)).toBe(false); // không ném lỗi với đầu vào sai kiểu
  });
});

