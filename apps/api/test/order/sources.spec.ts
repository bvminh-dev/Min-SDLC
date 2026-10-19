import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { baseHo, createHo, ho, resetSources, sourceId } from '../support/ho';
import { call, countRows, createOrdApp, pgCode, who, type OrdApp } from '../support/ord';

// Danh mục nguồn đơn (ORD-REQ-20261015-092748678): admin thêm, sửa, tắt; sale chọn; staff lọc; nguồn hệ thống website được bảo vệ ở cả ứng dụng lẫn CSDL (SB-45, SB-32).
describe('ORD danh mục nguồn đơn', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); await resetSources(t); t.logs.clear(); t.clock.advance(61_000); });
  const audits = (action: string) => q<{ actor_id: string; actor_role: string; before: any; after: any; target_id: string }>(t, `SELECT actor_id, actor_role, before, after, target_id FROM audit_logs WHERE action = '${action}' ORDER BY created_at, id`);
  const post = (cookie: string | undefined, body: unknown, o: { origin?: string | null } = {}) => call(t, 'post', '/admin/order-sources', { cookie, body, ...o });
  const problem = (r: { status: number; body: any }, status: number, code: string) => expect([r.status, r.body.type]).toEqual([status, `urn:ecom:error:${code}`]);

  it('ORD-TC-20261015-092749114 ORD-REQ-20261015-092748678: admin thêm nguồn zalo, tắt tiktok (12 đơn vẫn lọc được); sale chỉ thấy nguồn đang bật, staff lấy cả nguồn tắt; listSources khớp hai endpoint; mỗi thay đổi một audit', async () => {
    const { s1, staff, admin } = await ho(t);
    const tiktok = await sourceId(t, 'tiktok');
    for (let i = 0; i < 12; i++) await createHo(t, baseHo(s1.id, { source_code: 'tiktok' }));
    await createHo(t, baseHo(s1.id)); // một đơn facebook
    const created = await post(admin.cookie, { code: 'zalo', name: 'Zalo OA', position: 4 });
    expect([created.status, created.body]).toMatchObject([201, { code: 'zalo', name: 'Zalo OA', position: 4, is_active: true, is_system: false }]);
    const au = await audits('order_source.created');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', target_id: created.body.id });
    const forSale = async () => (await call(t, 'get', '/order-sources', { cookie: s1.cookie })).body.items.map((i: { code: string }) => i.code);
    expect(await forSale()).toEqual(['facebook', 'hotline', 'tiktok', 'website', 'zalo']); // position rồi name: zalo ở cuối
    const off = await call(t, 'patch', `/admin/order-sources/${tiktok}`, { cookie: admin.cookie, body: { is_active: false } });
    expect([off.status, off.body.is_active]).toEqual([200, false]);
    const up = await audits('order_source.updated');
    expect(up).toHaveLength(1);
    expect([up[0].before, up[0].after]).toEqual([{ is_active: true }, { is_active: false }]);
    expect(await forSale()).not.toContain('tiktok');
    expect((await call(t, 'get', '/admin/order-sources', { cookie: admin.cookie })).body.items.map((i: { code: string }) => i.code)).toContain('tiktok');
    const withOff = await call(t, 'get', '/order-sources?include_inactive=true', { cookie: staff.cookie });
    expect(withOff.body.items.find((i: { code: string }) => i.code === 'tiktok')).toMatchObject({ is_active: false });
    const filtered = await call(t, 'get', '/admin/orders?source=tiktok', { cookie: staff.cookie });
    expect([filtered.status, filtered.body.total]).toEqual([200, 12]); // nguồn đã tắt vẫn lọc được
    expect(filtered.body.items.every((i: { source: { code: string; name: string } }) => i.source.code === 'tiktok' && i.source.name === 'TikTok')).toBe(true);
    expect(await t.ord.listSources()).toEqual((await call(t, 'get', '/order-sources', { cookie: s1.cookie })).body.items);
    expect(await t.ord.listSources({ include_inactive: true })).toEqual(withOff.body.items);
  });

  it('ORD-TC-20261015-092749156: quản trị nguồn bị từ chối: sai quyền (403), không phiên (401), Origin lạ (403 csrf_failed), thân sai (400), trùng mã (409), id sai hoặc không có (404); không đổi gì, không audit', async () => {
    const { s1, staff, admin } = await ho(t);
    const before = await countRows(t, 'order_sources');
    const ok = { code: 'zalo', name: 'Zalo' };
    problem(await post(s1.cookie, ok), 403, 'forbidden');
    problem(await post(staff.cookie, ok), 403, 'forbidden');
    problem(await post(undefined, ok, { origin: null }), 401, 'unauthenticated');
    problem(await post(admin.cookie, ok, { origin: 'https://evil.example' }), 403, 'csrf_failed');
    problem(await post(admin.cookie, { ...ok, code: 'facebook' }), 409, 'order-source-code-taken');
    const bad: Record<string, unknown>[] = [{ code: 'Zalo' }, { code: 'a' }, { code: 'zalo!' }, { name: '   ' }, { name: 'x'.repeat(61) }, { position: 1000 }, { is_system: true }, { is_active: false }];
    for (const o of bad) problem(await post(admin.cookie, { ...ok, ...o }), 400, 'validation-failed');
    expect([await countRows(t, 'order_sources'), await countRows(t, 'audit_logs')]).toEqual([before, 0]);
    problem(await call(t, 'get', '/order-sources?include_inactive=true', { cookie: s1.cookie }), 400, 'validation-failed');
    problem(await call(t, 'get', '/admin/order-sources?x=1', { cookie: admin.cookie }), 400, 'validation-failed');
    const id = await sourceId(t, 'facebook');
    problem(await call(t, 'patch', `/admin/order-sources/${id}`, { cookie: admin.cookie, body: {} }), 400, 'validation-failed');
    problem(await call(t, 'patch', `/admin/order-sources/${id}`, { cookie: admin.cookie, body: { code: 'x' } }), 400, 'validation-failed');
    problem(await call(t, 'patch', `/admin/order-sources/${id}`, { cookie: admin.cookie, body: { name: 'F', is_system: true } }), 400, 'validation-failed');
    problem(await call(t, 'patch', '/admin/order-sources/abc', { cookie: admin.cookie, body: { name: 'F' } }), 404, 'not-found');
    problem(await call(t, 'patch', '/admin/order-sources/00000000-0000-4000-8000-0000000000ff', { cookie: admin.cookie, body: { name: 'F' } }), 404, 'not-found');
    problem(await call(t, 'patch', `/admin/order-sources/${id}`, { cookie: s1.cookie, body: { name: 'F' } }), 403, 'forbidden');
    expect(await audits('order_source.updated').then((r) => r.length)).toBe(0);
    expect((await q<{ name: string }>(t, `SELECT name FROM order_sources WHERE id = '${id}'`))[0].name).toBe('Facebook');
  });

  it('ORD-TC-20261015-092749194: nguồn hệ thống website không tắt (409 order-source-protected), đổi tên được, không đổi mã hay xóa ở CSDL (trigger, CHECK)', async () => {
    const { admin } = await ho(t);
    const web = await sourceId(t, 'website');
    problem(await call(t, 'patch', `/admin/order-sources/${web}`, { cookie: admin.cookie, body: { is_active: false } }), 409, 'order-source-protected');
    expect([(await q<{ is_active: boolean }>(t, `SELECT is_active FROM order_sources WHERE id = '${web}'`))[0].is_active, (await audits('order_source.updated')).length]).toEqual([true, 0]);
    const renamed = await call(t, 'patch', `/admin/order-sources/${web}`, { cookie: admin.cookie, body: { name: 'Cửa hàng trực tuyến', position: 0 } });
    expect([renamed.status, renamed.body.name, renamed.body.code]).toEqual([200, 'Cửa hàng trực tuyến', 'website']);
    await post(admin.cookie, { code: 'zalo', name: 'Zalo' }); // nguồn chưa gắn đơn cũng không xóa được
    const sql = ["UPDATE order_sources SET code = 'web2' WHERE code = 'website'", "UPDATE order_sources SET is_system = false WHERE code = 'website'", "UPDATE order_sources SET is_active = false WHERE code = 'website'",
      "DELETE FROM order_sources WHERE code = 'facebook'", "DELETE FROM order_sources WHERE code = 'zalo'"];
    const codes: string[] = [];
    for (const s of sql) codes.push(await pgCode(q(t, s)));
    expect(codes).toEqual(['23000', '23000', '23514', '23000', '23000']);
    expect(await countRows(t, 'order_sources', `code IN ('website', 'facebook', 'zalo')`)).toBe(3);
  });

  it('ORD-TC-20261015-092749232: trần 50 nguồn: hai yêu cầu song song chỉ một thành công, nguồn thứ 51 và thêm sau khi tắt đều bị từ chối, tên 60 ký tự emoji là biên', async () => {
    const { admin } = await ho(t);
    const admin2 = await who(t, 'admin', 'admin2@shop.vn');
    await q(t, `INSERT INTO order_sources (code, name) SELECT 'src_' || g, 'Nguồn ' || g FROM generate_series(1, 45) g`); // 4 + 45 = 49
    const [x, y] = await Promise.all([post(admin.cookie, { code: 'new_a', name: 'A' }), post(admin2.cookie, { code: 'new_b', name: 'B' })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    problem(x.status === 409 ? x : y, 409, 'order-source-limit');
    expect(await countRows(t, 'order_sources')).toBe(50);
    // xác định: giữ khóa tư vấn của danh mục ở một giao dịch khác thì yêu cầu thêm nguồn phải chờ (không chỉ trông vào đua ngẫu nhiên)
    let release: () => void = () => undefined, held: () => void = () => undefined;
    const gate = new Promise<void>((res) => { release = res; }), reached = new Promise<void>((res) => { held = res; });
    const holder = t.tx.run(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('order_sources'))`; held(); await gate; });
    await reached;
    let done = false;
    const waiting = post(admin.cookie, { code: 'new_w', name: 'W' }).then((r) => { done = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false);
    release(); await holder;
    problem(await waiting, 409, 'order-source-limit');
    problem(await post(admin.cookie, { code: 'new_c', name: 'C' }), 409, 'order-source-limit');
    await call(t, 'patch', `/admin/order-sources/${await sourceId(t, 'src_1')}`, { cookie: admin.cookie, body: { is_active: false } });
    problem(await post(admin.cookie, { code: 'new_d', name: 'D' }), 409, 'order-source-limit'); // tắt không giảm số nguồn
    await resetSources(t);
    expect((await post(admin.cookie, { code: 'emoji', name: '😀'.repeat(60) })).status).toBe(201);
    problem(await post(admin.cookie, { code: 'emoji2', name: '😀'.repeat(61) }), 400, 'validation-failed');
  });

  it('ORD-TC-20261015-092749269: bật lại nguồn, thứ tự theo position rồi name ổn định, mã của nguồn đã tắt không tái dùng', async () => {
    const { s1, admin } = await ho(t);
    const zalo = (await post(admin.cookie, { code: 'zalo', name: 'Zalo' })).body.id;
    await call(t, 'patch', `/admin/order-sources/${zalo}`, { cookie: admin.cookie, body: { is_active: false } });
    expect((await call(t, 'get', '/order-sources', { cookie: s1.cookie })).body.items.map((i: { code: string }) => i.code)).not.toContain('zalo');
    const on = await call(t, 'patch', `/admin/order-sources/${zalo}`, { cookie: admin.cookie, body: { is_active: true } });
    expect([on.status, on.body.is_active]).toEqual([200, true]);
    const [one, two] = [await call(t, 'get', '/order-sources', { cookie: s1.cookie }), await call(t, 'get', '/order-sources', { cookie: s1.cookie })];
    expect(one.body.items.map((i: { name: string }) => i.name)).toEqual(['Facebook', 'Hotline', 'TikTok', 'Website', 'Zalo']); // Facebook trước Hotline cùng position 0
    expect(two.body).toEqual(one.body);
    await call(t, 'patch', `/admin/order-sources/${zalo}`, { cookie: admin.cookie, body: { is_active: false } });
    problem(await post(admin.cookie, { code: 'zalo', name: 'Zalo mới' }), 409, 'order-source-code-taken');
  });

  it('ORD-TC-20261015-094427428: giới hạn tần suất của danh mục nguồn đơn: đọc bậc C, quản trị bậc D, vượt thì 429 kèm Retry-After, bộ đếm riêng từng người, chờ xong gọi lại được', async () => {
    const { s1, staff, admin } = await ho(t);
    let hit = 0, status = 200, last: { headers: Record<string, string>; body: any } | undefined;
    for (; status !== 429 && hit < 200; hit++) { const r = await call(t, 'get', '/order-sources', { cookie: s1.cookie }); status = r.status; last = r; }
    expect([status, hit]).toEqual([429, 121]); // bậc C: 120 mỗi phút, lần thứ 121 bị chặn
    expect(last?.body.type).toBe('urn:ecom:error:rate-limited');
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);
    expect([(await call(t, 'get', '/order-sources', { cookie: staff.cookie })).status, (await call(t, 'get', '/order-sources', { cookie: admin.cookie })).status]).toEqual([200, 200]);
    const before = await countRows(t, 'order_sources');
    let made = 0, blocked: { headers: Record<string, string>; body: any } | undefined;
    for (let i = 0; i < 40 && !blocked; i++) { const r = await post(admin.cookie, { code: `lim_${i}`, name: `Giới hạn ${i}` }); if (r.status === 429) blocked = r; else { expect(r.status).toBe(201); made++; } }
    expect(blocked?.body.type).toBe('urn:ecom:error:rate-limited');
    expect(made).toBeLessThanOrEqual(30); // bậc D: 30 mỗi phút (đếm chung các yêu cầu đã tới route này)
    expect(Number(blocked?.headers['retry-after'])).toBeGreaterThan(0);
    expect([await countRows(t, 'order_sources'), await countRows(t, 'audit_logs', `action = 'order_source.created'`)]).toEqual([before + made, made]); // yêu cầu bị chặn không tạo nguồn, không audit
    t.clock.advance(Number(blocked?.headers['retry-after']) * 1000 + 1000);
    expect([(await post(admin.cookie, { code: 'after_wait', name: 'Sau khi chờ' })).status, (await call(t, 'get', '/order-sources', { cookie: s1.cookie })).status]).toEqual([201, 200]);
  });
});
