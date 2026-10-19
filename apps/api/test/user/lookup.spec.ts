import { createHash } from 'node:crypto';
import { AuditService } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { auditRows, call, createUsrApp, seedAddress, setProfile, userWithSession, type UsrApp } from '../support/usr';
import { q, seedUser } from '../support/auth';
import { maskEmail, maskPhone } from '../../src/modules/user/policy';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const MASKED_KEYS = ['created_at', 'email', 'email_verified', 'full_name', 'id', 'phone', 'status'];
const FULL_KEYS = [...MASKED_KEYS, 'addresses', 'avatar_url'].sort();
const NOBODY = '99999999-9999-4999-8999-999999999999';

describe('USR nhân viên và admin tra cứu hồ sơ khách (USR-REQ-20261006-101004117)', () => {
  let t: UsrApp;
  let T0: Date;
  beforeAll(async () => { t = await createUsrApp(); T0 = t.clock.now(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); t.clock.set(T0); });

  const byEmail = (cookie: string | undefined, email?: string, extra: Record<string, string> = {}) => call(t, 'get', '/admin/customers', { cookie }).query({ ...(email === undefined ? {} : { email }), ...extra });
  const byId = (cookie: string | undefined, id: string) => call(t, 'get', `/admin/customers/${id}`, { cookie });
  const staff = (email = 's1@shop.vn') => userWithSession(t, { email, role: 'staff' });
  const admin = (email = 'ad1@shop.vn') => userWithSession(t, { email, role: 'admin' });
  /** Khách của các ca: an.nguyen@shop.vn, hai địa chỉ (một đã xóa mềm không tính), một ảnh. */
  const anCustomer = async () => {
    const c = await seedUser(t, { email: 'an.nguyen@shop.vn', name: 'Nguyễn An' });
    await setProfile(t, c.id, { phone: '0901234567', avatar_url: `${t.fake.url}/${t.fake.bucket}/avatars/a1.webp` });
    await seedAddress(t, c.id, { isDefault: true, receiver: 'Nguyễn An', line1: '12 Lê Lợi' });
    await seedAddress(t, c.id, { receiver: 'Trần Bình', line1: '45 Nguyễn Huệ' });
    await seedAddress(t, c.id, { receiver: 'Đã Xóa', deletedAt: T0 });
    return c;
  };

  it('USR-TC-20261006-102054198: staff tra cứu theo email nhận hồ sơ che và để lại audit mức masked', async () => {
    const s1 = await staff();
    const c = await anCustomer();
    t.logs.clear();
    const r = await byEmail(s1.cookie, 'An.Nguyen@Shop.vn');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: c.id, email: 'an***@shop.vn', phone: '090****567', full_name: 'Nguyễn An', email_verified: true, status: 'active' });
    expect(Object.keys(r.body).sort()).toEqual(MASKED_KEYS); // không addresses, avatar_url, locked_reason, password_hash
    expect(r.headers['cache-control']).toContain('no-store');
    const audit = await auditRows(t, 'usr.customer_lookup');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: s1.id, actor_role: 'staff', target_type: 'customer', target_id: c.id, after: { found: true, mask: 'masked', by: 'email' } });
    const log = t.logs.lines.join('\n').toLowerCase(); // kể cả dạng mã hóa URL (%40) và khác hoa thường: query không bao giờ vào log (route mẫu thôi)
    for (const pii of ['an.nguyen', 'an%40', '0901234567', 'nguyễn an']) expect([pii, log.includes(pii)]).toEqual([pii, false]);
    expect(t.logs.records.some((l) => l.route === '/api/v1/admin/customers' && l.status === 200)).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/an\.nguyen@shop\.vn|0901234567/i);
  });

  it('USR-TC-20261006-102054222: admin tra cứu theo id nhận hồ sơ đầy đủ kèm địa chỉ và audit mức full; lỗi ghi audit thì 500 và không trả dữ liệu khách', async () => {
    const ad = await admin();
    const c = await anCustomer();
    const r = await byId(ad.cookie, c.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: c.id, email: 'an.nguyen@shop.vn', phone: '0901234567', full_name: 'Nguyễn An' });
    expect(r.body.avatar_url).toContain('avatars/a1.webp');
    expect(Object.keys(r.body).sort()).toEqual(FULL_KEYS);
    expect(r.body.addresses).toHaveLength(2); // địa chỉ đã xóa mềm không nằm trong đó
    for (const a of r.body.addresses) expect(Object.keys(a).sort()).toEqual(['city', 'created_at', 'district', 'id', 'is_default', 'line1', 'phone', 'receiver', 'updated_at', 'ward']);
    expect(r.text).not.toMatch(/password_hash|failed_login|locked_reason/);
    const audit = await auditRows(t, 'usr.customer_lookup');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: ad.id, actor_role: 'admin', target_id: c.id, after: { found: true, mask: 'full', by: 'id' } });
    // admin tra theo email cũng đầy đủ (E2E của admin dùng đường này)
    const e = await byEmail(ad.cookie, 'an.nguyen@shop.vn');
    expect([e.status, e.body.email, e.body.addresses.length]).toEqual([200, 'an.nguyen@shop.vn', 2]);

    const spy = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('ghi audit hỏng'));
    try {
      const failed = await byId(ad.cookie, c.id);
      expect(failed.status).toBe(500);
      expect(failed.text).not.toMatch(/an\.nguyen|0901234567|Lê Lợi/); // ghi trước khi trả: không audit được thì không có dữ liệu
    } finally { spy.mockRestore(); }
  });

  it('USR-TC-20261006-102054247: id hoặc email không phải customer hay không tồn tại cùng 404 và có audit', async () => {
    const s1 = await staff();
    const s2 = await userWithSession(t, { email: 's2@shop.vn', role: 'staff' });
    const ad = await admin();
    const bodies: Record<string, unknown>[] = [];
    for (const email of [s2.email, ad.email, 'ghost@shop.vn']) {
      const r = await byEmail(s1.cookie, email);
      expect([email, r.status, r.body.type]).toEqual([email, 404, 'urn:ecom:error:not-found']);
      bodies.push(r.body);
    }
    const bad = await byId(ad.cookie, 'abc');
    expect(bad.status).toBe(404);
    bodies.push(bad.body);
    const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };
    for (const b of bodies) expect(strip(b)).toEqual(strip(bodies[0]));
    const audit = await auditRows(t, 'usr.customer_lookup');
    expect(audit.map((a) => a.actor_role).sort()).toEqual(['admin', 'staff', 'staff', 'staff']);
    for (const a of audit) expect(a.after).toMatchObject({ found: false });
    expect(audit.map((a) => a.target_id).sort()).toEqual([sha(s2.email), sha(ad.email), sha('ghost@shop.vn'), sha('abc')].sort()); // chỉ ghi băm của đầu vào
    expect(JSON.stringify(audit)).not.toMatch(/ghost@shop\.vn|s2@shop\.vn|ad1@shop\.vn/);
  });

  it('USR-TC-20261006-102054271: customer và guest không tra cứu được; tham số sai bị 400 và không ghi audit', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const c = await anCustomer();
    const s1 = await staff();
    expect((await byEmail(u1.cookie, 'an.nguyen@shop.vn')).status).toBe(403);
    expect((await byId(u1.cookie, c.id)).status).toBe(403);
    expect((await byEmail(undefined, 'an.nguyen@shop.vn')).status).toBe(401);
    const denied = await byEmail(u1.cookie, 'an.nguyen@shop.vn');
    expect(JSON.stringify(denied.body)).not.toContain('Nguyễn An');
    for (const [email, extra] of [['an', {}], [undefined, {}], ['an.nguyen@shop.vn', { id: c.id }], ['an.nguyen@shop.vn', { q: 'an' }], ['an.nguyen@shop.vn', { page: '1' }], ['', {}]] as const) {
      const r = await byEmail(s1.cookie, email, extra as Record<string, string>);
      expect([String(email), JSON.stringify(extra), r.status]).toEqual([String(email), JSON.stringify(extra), 400]);
    }
    expect(await auditRows(t, 'usr.customer_lookup')).toHaveLength(0); // bị từ chối trước khi đọc dữ liệu
  });

  it('USR-TC-20261006-102054297: tra cứu thứ 31 trong một phút bị 429, hai endpoint chung một bộ đếm; mở lại sau cửa sổ', async () => {
    const s1 = await staff();
    const ad = await admin();
    await anCustomer();
    for (let i = 0; i < 30; i++) {
      const r = await byEmail(s1.cookie, i % 2 ? 'an.nguyen@shop.vn' : 'ghost@shop.vn'); // kết quả bất kỳ
      if (![200, 404].includes(r.status)) throw new Error(`lần ${i + 1}: ${r.status}`);
    }
    const limited = await byEmail(s1.cookie, 'an.nguyen@shop.vn');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(JSON.stringify(limited.body)).not.toContain('Nguyễn An');
    for (let i = 0; i < 15; i++) { await byEmail(ad.cookie, 'ghost@shop.vn'); await byId(ad.cookie, NOBODY); }
    expect((await byId(ad.cookie, NOBODY)).status).toBe(429); // 30 lần chung cho /admin/customers và /admin/customers/{id}
    expect((await byEmail(s1.cookie, 'ghost@shop.vn')).status).toBe(429); // giới hạn theo người dùng: s1 vẫn bị
    t.clock.advance(61_000);
    expect((await byEmail(s1.cookie, 'an.nguyen@shop.vn')).status).toBe(200);
  });

  it('USR-TC-20261006-102054322: che email ngắn, điện thoại rỗng, khách đang khóa, email có ký tự đại diện', async () => {
    const s1 = await staff();
    const a = await seedUser(t, { email: 'a@shop.vn', name: 'A' });
    const r = await byEmail(s1.cookie, 'a@shop.vn');
    expect([r.status, r.body.email, r.body.phone]).toEqual([200, 'a***@shop.vn', null]);
    const lockedUser = await seedUser(t, { email: 'khoa@shop.vn', status: 'locked', lockedReason: 'admin' });
    const l = await byEmail(s1.cookie, 'khoa@shop.vn');
    expect([l.status, l.body.status]).toEqual([200, 'locked']);
    expect(Object.keys(l.body).sort()).toEqual(MASKED_KEYS); // không có lý do khóa
    expect(l.text).not.toMatch(/locked_reason|locked_until|admin"/);
    await seedUser(t, { email: 'an.nguyen@shop.vn' });
    for (const email of ['an.nguyen@shop.vn%', 'an.nguyen@shop', 'an.nguyen@sh_p.vn', 'an.nguyen@%', '%@shop.vn', 'an%']) {
      const n = await byEmail(s1.cookie, email);
      expect([email, n.status]).toEqual([email, email === 'an%' ? 400 : 404]); // `an%` không có dạng email; còn lại 404, không khớp tiền tố hay ký tự đại diện
    }
    expect(a.id).not.toBe(lockedUser.id);
    expect(maskEmail('ab@x.vn')).toBe('ab***@x.vn');
    expect(maskEmail('abc.def@x.vn')).toBe('ab***@x.vn');
    expect(maskPhone('0901234567')).toBe('090****567');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('')).toBeNull();
  });

  it('USR-TC-20261006-102054545: staff tra cứu khách theo id bị 403 trước mọi truy vấn User và không có audit; admin tra được', async () => {
    const s1 = await staff();
    const ad = await admin();
    const c = await anCustomer();
    const spyId = jest.spyOn(t.api, 'findCustomerById');
    const spyEmail = jest.spyOn(t.api, 'findCustomerByEmail');
    try {
      const rs = await Promise.all([byId(s1.cookie, c.id), byId(s1.cookie, 'abc'), byId(s1.cookie, NOBODY)]);
      for (const r of rs) expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);
      const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };
      expect(strip(rs[1].body)).toEqual(strip(rs[0].body)); // không tách được "tồn tại" khỏi "không tồn tại"
      expect(strip(rs[2].body)).toEqual(strip(rs[0].body));
      expect(JSON.stringify(rs[0].body)).not.toContain('Nguyễn An');
      expect(spyId).not.toHaveBeenCalled(); // 403 trước khi có bất kỳ truy vấn User nào
      expect(spyEmail).not.toHaveBeenCalled();
    } finally { spyId.mockRestore(); spyEmail.mockRestore(); }
    expect(await auditRows(t, 'usr.customer_lookup')).toHaveLength(0);
    const full = await byId(ad.cookie, c.id);
    expect([full.status, full.body.addresses.length]).toEqual([200, 2]);
    expect((await auditRows(t, 'usr.customer_lookup'))).toHaveLength(1);
    expect((await auditRows(t, 'usr.customer_lookup'))[0].after).toMatchObject({ mask: 'full' });
    expect((await q(t, `SELECT 1 FROM audit_logs WHERE actor_id = '${s1.id}'`))).toHaveLength(0);
  });

  it('admin lọc danh sách khách theo một phần email; staff nhận 403; q quá dài hoặc có NUL nhận 400', async () => {
    const ad = await admin();
    const s1 = await staff();
    await anCustomer();
    await seedUser(t, { email: 'binh@shop.vn', name: 'Trần Bình' });
    const search = (cookie: string | undefined, qs: string) => call(t, 'get', `/admin/customers/search${qs}`, { cookie });
    const ok = await search(ad.cookie, '?q=nguyen');
    expect(ok.status).toBe(200);
    expect(ok.body.items.map((x: any) => x.email)).toEqual(['an.nguyen@shop.vn']);
    expect(Object.keys(ok.body.items[0]).sort()).toEqual(MASKED_KEYS);
    expect((await search(ad.cookie, '')).body.items).toHaveLength(2);
    expect(ok.body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect((await search(ad.cookie, '?page=2')).body).toMatchObject({ items: [], total: 2, page: 2 });
    expect((await search(ad.cookie, '?page=0')).status).toBe(400);
    expect((await search(s1.cookie, '?q=nguyen')).status).toBe(403);
    expect((await search(ad.cookie, `?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await search(ad.cookie, '?q=a%00b')).status).toBe(400);
  });
});
