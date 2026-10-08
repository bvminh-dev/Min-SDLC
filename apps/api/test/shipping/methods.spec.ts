import { randomUUID } from 'node:crypto';
import { AuditService, DomainError, type SessionContext } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { call, countOf, createShpApp, pgCode, q, race, seedMethod, seedShipment, shpAudits, who, type ShpApp } from '../support/shp';

// Quản trị phương thức vận chuyển (SHP-REQ-20261006-101103755): tạo, sửa, bật, tắt, trần 20, khóa lạc quan, bậc D chung bộ đếm đọc và ghi.
const session = (id: string): SessionContext => ({ user_id: id, role: 'admin', email_verified: true });
const BASE = { name: 'Giao tiêu chuẩn', base_fee: 30000, rule: { free_over: 500000, surcharge: 20000, surcharge_cities: ['Hà Giang', 'Cao Bằng'] } };

describe('SHP quản trị phương thức vận chuyển', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });
  const methodAudits = () => shpAudits(t, undefined, 'shipping.method.%');

  it('SHP-TC-20261006-102133000: admin tạo phương thức Giao tiêu chuẩn với phí, ngưỡng miễn phí và phụ thu; một dòng audit cùng giao dịch, ép lỗi audit thì không tạo', async () => {
    const admin = await who(t, 'admin', 'a1@shop.vn');
    await seedMethod(t, { name: 'Giao nhanh' }); await seedMethod(t, { name: 'Giao hỏa tốc' });
    t.clock.advance(1000);
    const r = await call(t, 'post', '/admin/shipping/methods', { cookie: admin.cookie, body: BASE });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Giao tiêu chuẩn', is_active: true, version: 1, base_fee: 30000, rule: BASE.rule });
    expect(r.body.rule.surcharge_cities).toHaveLength(2);
    const listed = await call(t, 'get', '/admin/shipping/methods', { cookie: admin.cookie });
    expect([listed.body.total, listed.body.items[0].id]).toEqual([3, r.body.id]); // mới nhất trước
    const audits = await methodAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', action: 'shipping.method.create', target_id: r.body.id, before: null });
    expect(audits[0].after).toMatchObject({ name: 'Giao tiêu chuẩn', base_fee: 30000 });
    // ép lỗi audit: giao dịch rollback, không có phương thức mới
    jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit lỗi'));
    const bad = await call(t, 'post', '/admin/shipping/methods', { cookie: admin.cookie, body: { ...BASE, name: 'Giao chậm' } });
    expect(bad.status).toBe(500);
    expect(await countOf(t, 'shipping_methods')).toBe(3);
    expect(await countOf(t, 'shipping_methods', `name = 'Giao chậm'`)).toBe(0);
  });

  it('SHP-TC-20261006-102133028: admin sửa phí cơ bản của Giao nhanh kèm version đúng; vận đơn đã tạo không đổi và quote ngay sau đó dùng phí mới', async () => {
    const admin = await who(t, 'admin', 'a1@shop.vn');
    const m = await seedMethod(t, { name: 'Giao nhanh', fee: 50000, version: 3 });
    await seedShipment(t, { status: 'shipped', method: m });
    const before = await countOf(t, 'shipments', `shipping_method_id = '${m}'`);
    t.clock.advance(1000);
    const r = await call(t, 'patch', `/admin/shipping/methods/${m}`, { cookie: admin.cookie, body: { base_fee: 55000, version: 3 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ base_fee: 55000, version: 4 });
    expect(Date.parse(r.body.updated_at)).toBeGreaterThan(Date.parse(r.body.created_at));
    const a = await methodAudits();
    expect(a).toHaveLength(1);
    expect([a[0].before.base_fee, a[0].after.base_fee, a[0].action]).toEqual([50000, 55000, 'shipping.method.update']);
    expect(await countOf(t, 'shipments', `shipping_method_id = '${m}'`)).toBe(before);
    const c1 = await who(t, 'customer', 'c1@x.vn');
    const quote = await call(t, 'post', '/shipping/quote', { cookie: c1.cookie, body: { method_id: m, city: 'Hà Nội', subtotal: 100000 } });
    expect([quote.status, quote.body.fee]).toEqual([200, 55000]);
  });

  it('SHP-TC-20261006-102133054: admin tắt rồi bật lại Giao nhanh, khách thấy và không thấy tương ứng; version tăng 1 mỗi lần; đúng hai dòng audit', async () => {
    const admin = await who(t, 'admin', 'a1@shop.vn'), c1 = await who(t, 'customer', 'c1@x.vn');
    const m = await seedMethod(t, { name: 'Giao nhanh', version: 4 });
    const names = async () => (await call(t, 'get', '/shipping/methods', { cookie: c1.cookie })).body.items.map((i: { name: string }) => i.name);
    expect(await names()).toEqual(['Giao nhanh']);
    const off = await call(t, 'post', `/admin/shipping/methods/${m}/disable`, { cookie: admin.cookie, body: { version: 4 } });
    expect([off.status, off.body.is_active, off.body.version]).toEqual([200, false, 5]);
    expect(await names()).toEqual([]);
    t.clock.advance(1000); // audit sắp theo created_at (đồng hồ giả đứng yên trong một mili giây)
    const on = await call(t, 'post', `/admin/shipping/methods/${m}/enable`, { cookie: admin.cookie, body: { version: 5 } });
    expect([on.status, on.body.is_active, on.body.version]).toEqual([200, true, 6]);
    expect(await names()).toEqual(['Giao nhanh']);
    expect((await methodAudits()).map((a) => a.action)).toEqual(['shipping.method.disable', 'shipping.method.enable']);
  });

  it('SHP-TC-20261006-102133082 (SB-05, SB-07, T4): customer, staff và guest không quản lý được phương thức; quyền (403) đứng trước schema; không đổi dữ liệu, không audit', async () => {
    const [c1, s1] = [await who(t, 'customer', 'c1@x.vn'), await who(t, 'staff', 's1@shop.vn')];
    const m = await seedMethod(t, { name: 'Giao nhanh', fee: 50000 });
    const calls = (cookie?: string) => Promise.all([
      call(t, 'post', '/admin/shipping/methods', { cookie, body: BASE }),
      call(t, 'patch', `/admin/shipping/methods/${m}`, { cookie, body: { base_fee: 1, version: 1 } }),
      call(t, 'post', `/admin/shipping/methods/${m}/disable`, { cookie, body: { version: 1 } }),
      call(t, 'post', `/admin/shipping/methods/${m}/enable`, { cookie, body: { version: 1 } }),
      call(t, 'get', '/admin/shipping/methods', { cookie }),
    ]);
    expect((await calls(undefined)).map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    for (const who of [c1, s1]) expect((await calls(who.cookie)).map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect((await call(t, 'post', '/admin/shipping/methods', { cookie: s1.cookie, body: { name: 1, base_fee: 'x', extra: true } })).status).toBe(403); // body sai của staff vẫn 403, không phải 400
    const [row] = await q<{ base_fee: string; is_active: boolean }>(t, `SELECT base_fee::text, is_active FROM shipping_methods WHERE id = '${m}'`);
    expect([row.base_fee, row.is_active, await countOf(t, 'shipping_methods'), (await methodAudits()).length]).toEqual(['50000', true, 1, 0]);
  });

  it('SHP-TC-20261006-102133111 (SB-11, T6, T14): tạo phương thức với dữ liệu sai bị từ chối ở biên API; CHECK ở CSDL; HTML không bị biến đổi và không vào log', async () => {
    const admin = await who(t, 'admin', 'a1@shop.vn');
    await seedMethod(t, { name: 'Giao nhanh' });
    const post = (body: unknown) => call(t, 'post', '/admin/shipping/methods', { cookie: admin.cookie, body });
    const rule = (r: object) => ({ name: 'Mới', base_fee: 1000, rule: r });
    const bads: [string, unknown][] = [
      ['name', { ...BASE, name: '' }], ['name', { ...BASE, name: 'a'.repeat(81) }], ['base_fee', { ...BASE, base_fee: -1 }], ['base_fee', { ...BASE, base_fee: 30000.5 }],
      ['base_fee', { ...BASE, base_fee: '30000' }], ['base_fee', { ...BASE, base_fee: 1000001 }], ['rule.surcharge_cities', rule({ surcharge: 20000, surcharge_cities: [] })],
      ['rule.surcharge', rule({ surcharge: 500001, surcharge_cities: ['A'] })], ['rule.free_over', rule({ free_over: -5 })], ['rule.free_over', rule({ free_over: 10000000001 })],
      ['rule.surcharge_cities', rule({ surcharge: 1, surcharge_cities: Array.from({ length: 64 }, (_, i) => `T${i}`) })], ['is_active', { ...BASE, is_active: false }], ['version', { ...BASE, version: 7 }],
    ];
    for (const [field, body] of bads) {
      const r = await post(body);
      expect([field, r.status, r.body.type]).toEqual([field, 400, 'urn:ecom:error:validation-failed']);
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    }
    expect(await countOf(t, 'shipping_methods')).toBe(1);
    expect((await post({ name: 'Ngưỡng cao', base_fee: 1, rule: { free_over: 10000000000 } })).status).toBe(201); // biên trên hợp lệ
    expect((await post({ ...BASE, name: 'giao nhanh' })).status).toBe(409); // khác hoa thường với "Giao nhanh"
    expect((await post({ ...BASE, name: 'giao nhanh' })).body.type).toBe('urn:ecom:error:shipping-method-name-taken');
    const html = '<img src=x onerror=alert(1)>';
    const ok = await post({ name: html, base_fee: 1000 });
    expect([ok.status, ok.body.name]).toEqual([201, html]);
    expect((await call(t, 'get', '/admin/shipping/methods', { cookie: admin.cookie })).body.items.map((i: { name: string }) => i.name)).toContain(html);
    expect(t.logs.lines.join('\n')).not.toContain('onerror');
    expect(await pgCode(q(t, `INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('Âm', -1, '{}'::jsonb)`))).toBe('23514'); // CHECK base_fee
    expect(await pgCode(q(t, `INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('Quá', 1000001, '{}'::jsonb)`))).toBe('23514');
    expect(await pgCode(q(t, `INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('M', 1, '{}'::jsonb)`))).toBe('23514'); // tên 1 ký tự
    expect(await pgCode(q(t, `INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('Mảng', 1, '[]'::jsonb)`))).toBe('23514'); // rule không phải đối tượng
    expect(await pgCode(q(t, `INSERT INTO shipping_methods (name, base_fee, rule) VALUES ('  GIAO NHANH ', 1, '{}'::jsonb)`))).toBe('23505'); // unique lower(btrim(name))
  });

  it('SHP-TC-20261006-102133136 (SB-30, T24): hai admin sửa cùng phương thức, người sau gặp 409 version-conflict; thiếu version là 400', async () => {
    const [a1, a2] = [await who(t, 'admin', 'a1@shop.vn'), await who(t, 'admin', 'a2@shop.vn')];
    const m = await seedMethod(t, { name: 'Giao nhanh', fee: 50000, version: 3 });
    const patch = (cookie: string, body: unknown) => call(t, 'patch', `/admin/shipping/methods/${m}`, { cookie, body });
    const r2 = await patch(a2.cookie, { base_fee: 60000, version: 3 });
    expect([r2.status, r2.body.version]).toEqual([200, 4]);
    const r1 = await patch(a1.cookie, { base_fee: 45000, version: 3 });
    expect([r1.status, r1.body.type]).toEqual([409, 'urn:ecom:error:version-conflict']);
    expect((await q<{ base_fee: string }>(t, `SELECT base_fee::text FROM shipping_methods WHERE id = '${m}'`))[0].base_fee).toBe('60000');
    expect((await methodAudits()).filter((a) => a.action === 'shipping.method.update')).toHaveLength(1);
    expect((await patch(a1.cookie, { base_fee: 45000 })).status).toBe(400); // version bắt buộc
    expect((await patch(a1.cookie, { base_fee: 45000, version: 2147483648 })).status).toBe(400); // vượt int32
    expect((await patch(a1.cookie, { base_fee: 45000, version: 2147483647 })).body.type).toBe('urn:ecom:error:version-conflict'); // biên hợp lệ
    await seedMethod(t, { name: 'Giao hoa toc' });
    const dup = await patch(a1.cookie, { name: 'GIAO HOA TOC', version: 4 }); // sửa thành tên của phương thức khác (khác hoa thường)
    expect([dup.status, dup.body.type]).toEqual([409, 'urn:ecom:error:shipping-method-name-taken']);
    expect((await q<{ version: number }>(t, `SELECT version FROM shipping_methods WHERE id = '${m}'`))[0].version).toBe(4);
    expect((await patch(a1.cookie, { version: 4 })).status).toBe(400); // sửa rỗng: không đổi gì
    expect((await call(t, 'patch', '/admin/shipping/methods/not-a-uuid', { cookie: a1.cookie, body: { base_fee: 1, version: 1 } })).status).toBe(404);
    expect((await call(t, 'patch', `/admin/shipping/methods/${randomUUID()}`, { cookie: a1.cookie, body: { base_fee: 1, version: 1 } })).status).toBe(404);
  });

  it('SHP-TC-20261006-102133162 (SB-30, T24): phương thức thứ 21 bị từ chối kể cả khi hai admin tạo cùng lúc ở vị trí 20 (50 vòng); đủ 20 vẫn sửa được', async () => {
    const [a1, a2] = [await who(t, 'admin', 'a1@shop.vn'), await who(t, 'admin', 'a2@shop.vn')];
    for (let i = 0; i < 19; i++) await seedMethod(t, { name: `Có sẵn ${i}`, active: i >= 5 });
    for (let round = 0; round < 50; round++) {
      await q(t, `DELETE FROM shipping_methods WHERE name LIKE 'Đua %'`);
      const res = await race(
        () => t.methods.create(session(a1.id), { name: `Đua A${round}`, base_fee: 1000, rule: { free_over: null, surcharge: 0, surcharge_cities: [] } }).then(() => 'ok', (e) => (e as DomainError).code),
        () => t.methods.create(session(a2.id), { name: `Đua B${round}`, base_fee: 1000, rule: { free_over: null, surcharge: 0, surcharge_cities: [] } }).then(() => 'ok', (e) => (e as DomainError).code),
      );
      expect(res.slice().sort()).toEqual(['ok', 'too-many-methods']);
      expect(await countOf(t, 'shipping_methods')).toBe(20); // không bao giờ 21
    }
    const over = await call(t, 'post', '/admin/shipping/methods', { cookie: a1.cookie, body: { ...BASE, name: 'Thứ hai mươi mốt' } });
    expect([over.status, over.body.type]).toEqual([409, 'urn:ecom:error:too-many-methods']);
    const [{ id, version }] = await q<{ id: string; version: number }>(t, `SELECT id, version FROM shipping_methods ORDER BY created_at LIMIT 1`);
    const edit = await call(t, 'patch', `/admin/shipping/methods/${id}`, { cookie: a1.cookie, body: { base_fee: 777, version } });
    expect([edit.status, edit.body.base_fee]).toEqual([200, 777]);
  }, 120_000);

  it('SHP-TC-20261006-102133186: giá trị biên của tên, phí cơ bản; bật lại phương thức đang bật là 409 method-state-unchanged (không do version), không audit mới', async () => {
    const admin = await who(t, 'admin', 'a1@shop.vn');
    const post = (body: unknown) => call(t, 'post', '/admin/shipping/methods', { cookie: admin.cookie, body });
    const ab = await post({ name: 'Ab', base_fee: 0 });
    expect([ab.status, ab.body.name, ab.body.base_fee]).toEqual([201, 'Ab', 0]);
    expect((await post({ name: 'x'.repeat(80), base_fee: 1000000 })).status).toBe(201);
    expect((await post({ name: 'Xy', base_fee: 1000001 })).status).toBe(400);
    expect((await post({ name: 'A', base_fee: 1 })).status).toBe(400);
    expect((await post({ name: '  ', base_fee: 1 })).status).toBe(400);
    const audits = (await methodAudits()).length;
    const again = await call(t, 'post', `/admin/shipping/methods/${ab.body.id}/enable`, { cookie: admin.cookie, body: { version: 1 } });
    expect([again.status, again.body.type]).toEqual([409, 'urn:ecom:error:method-state-unchanged']);
    expect([(await q<{ version: number }>(t, `SELECT version FROM shipping_methods WHERE id = '${ab.body.id}'`))[0].version, (await methodAudits()).length]).toEqual([1, audits]);
    // tắt rồi tắt lại với version cũ: trạng thái được kiểm trước version
    await call(t, 'post', `/admin/shipping/methods/${ab.body.id}/disable`, { cookie: admin.cookie, body: { version: 1 } });
    const twice = await call(t, 'post', `/admin/shipping/methods/${ab.body.id}/disable`, { cookie: admin.cookie, body: { version: 1 } });
    expect(twice.body.type).toBe('urn:ecom:error:method-state-unchanged');
    const stale = await call(t, 'post', `/admin/shipping/methods/${ab.body.id}/enable`, { cookie: admin.cookie, body: { version: 1 } });
    expect(stale.body.type).toBe('urn:ecom:error:version-conflict');
  });

  it('SHP-TC-20261006-130000002 (SB-14 bậc D, T25): quản trị phương thức bị giới hạn 30 yêu cầu mỗi phút mỗi người, đọc và ghi chung bộ đếm; 429 không để lại audit; qua cửa sổ thì 200', async () => {
    const [a1, a2] = [await who(t, 'admin', 'a1@shop.vn'), await who(t, 'admin', 'a2@shop.vn')];
    const m = await seedMethod(t, { name: 'Giao nhanh', fee: 50000 });
    for (let i = 0; i < 20; i++) expect((await call(t, 'get', '/admin/shipping/methods', { cookie: a1.cookie })).status).toBe(200);
    for (let i = 0; i < 10; i++) expect([200, 409]).toContain((await call(t, 'post', `/admin/shipping/methods/${m}/disable`, { cookie: a1.cookie, body: { version: 1 } })).status);
    const audits = (await methodAudits()).length;
    const [{ version }] = await q<{ version: number }>(t, `SELECT version FROM shipping_methods WHERE id = '${m}'`);
    const limited = await call(t, 'patch', `/admin/shipping/methods/${m}`, { cookie: a1.cookie, body: { base_fee: 9, version } });
    expect([limited.status, limited.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect([(await q<{ base_fee: string; version: number }>(t, `SELECT base_fee::text, version FROM shipping_methods WHERE id = '${m}'`))[0], (await methodAudits()).length]).toEqual([{ base_fee: '50000', version }, audits]);
    expect((await call(t, 'get', '/admin/shipping/methods', { cookie: a2.cookie })).status).toBe(200); // bộ đếm theo từng người
    t.clock.advance(61_000);
    expect((await call(t, 'patch', `/admin/shipping/methods/${m}`, { cookie: a1.cookie, body: { base_fee: 9, version } })).status).toBe(200);
  });
});
