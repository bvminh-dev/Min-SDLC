import { createHash } from 'node:crypto';
import { AuditService } from '../../src/modules/platform';
import { alignWindow, createSalApp, q, resetSal, salWorld, salesGet, seedUser, type SalApp, type SalWorld } from '../support/sal';

// SAL tra khách có sẵn theo điện thoại hoặc email, bản che (SAL-REQ-20261015-092710942): GET /sales/customers/lookup, gọi UserApi.lookupForSale của USR.
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const SEC = 'SAL-SEC-20261015-093121500';
const PATH = '/customers/lookup';

describe('SAL tra khách (bản che)', () => {
  let t: SalApp;
  let w: SalWorld;
  beforeAll(async () => { t = await createSalApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { jest.restoreAllMocks(); await resetSal(t); alignWindow(t); w = await salWorld(t); });
  const customer = async (email: string, name: string, phone: string | null, o: { at?: Date; status?: 'active' | 'locked' } = {}) => {
    const c = await seedUser(t, { email, name, createdAt: o.at, status: o.status });
    if (phone) await q(t, `UPDATE users SET phone = '${phone}' WHERE id = '${c.id}'`);
    return c;
  };
  const audits = () => q<any>(t, "SELECT actor_id, actor_role, target_id, after FROM audit_logs WHERE action = 'usr.customer_lookup' ORDER BY created_at");
  const lookup = (u: { cookie: string } | undefined, query: Record<string, string>) => salesGet(t, u, PATH, query);

  it(`SAL-TC-20261015-093910324 ${SEC} T6: tra theo điện thoại (+84 901 234 567) trả bản che đúng trường và ghi MỘT audit với khóa băm, không số gốc`, async () => {
    const c1 = await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    const r = await lookup(w.s1, { phone: '+84 901 234 567' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toEqual({ items: [{ id: c1.id, full_name: 'Nguyễn An', email: 'an***@shop.vn', phone: '090****567', status: 'active' }] });
    const a = await audits();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: w.s1.id, actor_role: 'sale', target_id: sha('0901234567'), after: { by: 'phone', found: 1, mask: 'masked' } });
    expect(JSON.stringify(a)).not.toContain('0901234567');
  });

  it('SAL-TC-20261015-093910356: hai khách cùng số điện thoại đều có trong kết quả, khách tạo sau đứng trước, mỗi khách bản che riêng', async () => {
    const old = await customer('a@shop.vn', 'Khách A', '0912345678', { at: new Date('2026-10-01T00:00:00Z') });
    const fresh = await customer('b@shop.vn', 'Khách B', '0912345678', { at: new Date('2026-10-02T00:00:00Z') });
    const r = await lookup(w.s1, { phone: '0912345678' });
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual([fresh.id, old.id]); // created_at giảm dần
    expect(r.body.items.map((x: { email: string }) => x.email)).toEqual(['b***@shop.vn', 'a***@shop.vn']);
  });

  it('SAL-TC-20261015-093910388: tra theo email không phân biệt hoa thường và khoảng trắng; audit kiểu khóa email', async () => {
    const c1 = await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    const r = await lookup(w.s1, { email: '  An.Nguyen@Shop.vn ' });
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual([c1.id]);
    expect((await audits())[0].after).toMatchObject({ by: 'email', found: 1 });
  });

  it(`SAL-TC-20261015-093910421 ${SEC} T7: số của staff, email của admin và số chưa ai dùng cho cùng kết quả rỗng, mỗi lần một audit số kết quả 0`, async () => {
    await q(t, `UPDATE users SET phone = '0955555555' WHERE id = '${w.st.id}'`);
    const out = [await lookup(w.s1, { phone: '0955555555' }), await lookup(w.s1, { email: 'ad1@shop.vn' }), await lookup(w.s1, { phone: '0999999999' })];
    expect(out.map((r) => [r.status, JSON.stringify(r.body)])).toEqual(Array(3).fill([200, '{"items":[]}']));
    const a = await audits();
    expect(a.map((x) => x.after.found)).toEqual([0, 0, 0]);
  });

  it(`SAL-TC-20261015-093910454 ${SEC} T1: customer, staff và guest không tra được: 403, 403, 401, không dữ liệu và không audit`, async () => {
    await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    const out = [await lookup(w.u1, { phone: '0901234567' }), await lookup(w.st, { phone: '0901234567' }), await lookup(undefined, { phone: '0901234567' })];
    expect(out.map((r) => r.status)).toEqual([403, 403, 401]);
    expect(JSON.stringify(out.map((r) => r.body))).not.toContain('Nguyễn An');
    expect(await audits()).toHaveLength(0);
  });

  it('SAL-TC-20261015-093910487: tham số sai hoặc thiếu thì 400 và không audit', async () => {
    await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    await customer('kim@shop.vn', 'Kim', null);
    const bad: Record<string, string>[] = [{}, { phone: '0901234567', email: 'an.nguyen@shop.vn' }, { phone: '12345' }, { phone: '0901234567', id: 'x' }, { phone: '0901234567', q: 'An' }, { email: 'an' }, { email: 'a\u0000n@shop.vn' }, { email: '\u212Aim@shop.vn' }]; // NUL và Kelvin (U+212A thành k ở toLowerCase và citext): 400, không 500, không khớp khách kim@
    for (const q2 of bad) {
      const r = await lookup(w.s1, q2);
      expect([JSON.stringify(q2), r.status, r.body.type]).toEqual([JSON.stringify(q2), 400, 'urn:ecom:error:validation-failed']);
    }
    expect(await audits()).toHaveLength(0);
  });

  it(`SAL-TC-20261015-093910521 ${SEC} T6: vượt 30 lần tra mỗi phút thì 429 kèm Retry-After, không dữ liệu, không audit mới`, async () => {
    for (let i = 0; i < 30; i++) expect((await lookup(w.s1, { phone: '0999999999' })).status).toBe(200);
    const r = await lookup(w.s1, { phone: '0999999999' });
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.body.items).toBeUndefined();
    expect(await audits()).toHaveLength(30);
  });

  it(`SAL-TC-20261015-093910553 ${SEC} T6: lỗi ghi audit thì 500 không chứa dữ liệu khách (đóng khi lỗi), log một dòng error, không audit`, async () => {
    await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValue(new Error('ghi audit lỗi'));
    const r = await lookup(w.s1, { phone: '0901234567' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/Nguyễn An|an\*\*\*|090/);
    expect(t.logs.lines.filter((l) => /"level":"error"/.test(l))).not.toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it('SAL-TC-20261015-093910594: khách không có điện thoại thì phone là null, email vẫn che', async () => {
    await customer('a@shop.vn', 'Khách A', null);
    const r = await lookup(w.s1, { email: 'a@shop.vn' });
    expect(r.body.items).toEqual([expect.objectContaining({ email: 'a***@shop.vn', phone: null })]);
  });

  it('SAL-TC-20261015-093910631: khách bị khóa vẫn hiện với trạng thái locked, không lý do khóa', async () => {
    await customer('lock@shop.vn', 'Khách khóa', '0922222222', { status: 'locked' });
    const r = await lookup(w.s1, { phone: '0922222222' });
    expect(r.body.items[0]).toMatchObject({ status: 'locked' });
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['email', 'full_name', 'id', 'phone', 'status']);
  });

  it('SAL-TC-20261015-093910668: bảy khách cùng số thì chỉ trả năm khách gần nhất (trần 5), mới nhất trước, không lỗi', async () => {
    const made: { id: string }[] = [];
    for (let i = 0; i < 7; i++) made.push(await customer(`k${i}@shop.vn`, `Khách ${i}`, '0933333333', { at: new Date(Date.UTC(2026, 9, 1 + i)) }));
    const r = await lookup(w.s1, { phone: '0933333333' });
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual([6, 5, 4, 3, 2].map((i) => made[i].id));
  });

  it('SAL-TC-20261015-093910702: tiền tố và ký tự đại diện không khớp (rỗng hoặc 400), không lần nào trả khách', async () => {
    await customer('an.nguyen@shop.vn', 'Nguyễn An', '0901234567');
    const cases: Record<string, string>[] = [{ phone: '090123456' }, { phone: '0901234567%' }, { email: 'an.nguyen@shop' }, { email: 'an.nguyen@shop.vn%' }];
    for (const q2 of cases) {
      const r = await lookup(w.s1, q2);
      expect([JSON.stringify(q2), [200, 400].includes(r.status), r.body.items ?? []]).toEqual([JSON.stringify(q2), true, []]);
    }
  });
});
