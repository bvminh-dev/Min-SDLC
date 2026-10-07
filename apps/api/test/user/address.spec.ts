import { truncateAll } from '../support/db';
import { addressRows, call, createUsrApp, defaultsOf, liveCount, seedAddress, seedAddresses, userWithSession, VALID_ADDRESS, type UsrApp } from '../support/usr';
import { q } from '../support/auth';

const ADDRESS_KEYS = ['city', 'created_at', 'district', 'id', 'is_default', 'line1', 'phone', 'receiver', 'updated_at', 'ward'];
const DAY = 24 * 3600_000;

describe('USR sổ địa chỉ giao hàng (USR-REQ-20261006-101003767, 855, 941, 4028)', () => {
  let t: UsrApp;
  let T0: Date;
  beforeAll(async () => { t = await createUsrApp(); T0 = t.clock.now(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); t.clock.set(T0); });

  const customer = (email = 'u1@shop.vn') => userWithSession(t, { email });
  const list = (cookie?: string) => call(t, 'get', '/me/addresses', { cookie });
  const add = (cookie: string | undefined, body: unknown = VALID_ADDRESS, o: Parameters<typeof call>[3] = {}) => call(t, 'post', '/me/addresses', { cookie, body, ...o });
  const edit = (cookie: string | undefined, id: string, body: unknown, o: Parameters<typeof call>[3] = {}) => call(t, 'patch', `/me/addresses/${id}`, { cookie, body, ...o });
  const del = (cookie: string | undefined, id: string, o: Parameters<typeof call>[3] = {}) => call(t, 'delete', `/me/addresses/${id}`, { cookie, ...o });
  const strip = (b: Record<string, unknown>) => { const { trace_id: _t, ...rest } = b; return rest; };
  const ago = (ms: number) => new Date(T0.getTime() - ms);
  const NOBODY = '99999999-9999-4999-8999-999999999999';

  it('USR-TC-20261006-102053743: danh sách địa chỉ có mặc định trước, rồi mới tạo nhất trước', async () => {
    const u1 = await customer();
    const a1 = await seedAddress(t, u1.id, { isDefault: true, createdAt: ago(5 * DAY), receiver: 'A1' });
    const a2 = await seedAddress(t, u1.id, { createdAt: ago(1 * DAY), receiver: 'A2' });
    const a3 = await seedAddress(t, u1.id, { createdAt: ago(3 * DAY), receiver: 'A3' });
    const r = await list(u1.cookie);
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: any) => x.id)).toEqual([a1, a2, a3]);
    for (const item of r.body.items) expect(Object.keys(item).sort()).toEqual(ADDRESS_KEYS);
    expect(r.body.items.filter((x: any) => x.is_default)).toHaveLength(1);
    expect(r.headers['cache-control']).toContain('no-store');
    // cùng thời điểm tạo: id giảm dần làm khóa thứ ba (ổn định)
    const u2 = await customer('u2@shop.vn');
    const same = [await seedAddress(t, u2.id, { createdAt: ago(DAY) }), await seedAddress(t, u2.id, { createdAt: ago(DAY) }), await seedAddress(t, u2.id, { createdAt: ago(DAY) })];
    expect((await list(u2.cookie)).body.items.map((x: any) => x.id)).toEqual([...same].sort().reverse());
  });

  it('USR-TC-20261006-102053767: danh sách địa chỉ từ chối guest, staff, admin và tham số lạ', async () => {
    const u1 = await customer();
    const u2 = await customer('u2@shop.vn');
    await seedAddress(t, u1.id, { isDefault: true, receiver: 'Của u1' });
    await seedAddress(t, u2.id, { isDefault: true, receiver: 'Của u2 bí mật' });
    const guest = await list();
    expect(guest.status).toBe(401);
    expect(JSON.stringify(guest.body)).not.toContain('items');
    for (const role of ['staff', 'admin'] as const) {
      const p = await userWithSession(t, { email: `${role}@shop.vn`, role });
      const r = await list(p.cookie);
      expect([role, r.status, r.body.type]).toEqual([role, 403, 'urn:ecom:error:forbidden']);
    }
    const lure = await list(u1.cookie).query({ user_id: u2.id });
    expect(lure.status).toBe(400);
    expect(JSON.stringify(lure.body)).not.toContain('bí mật');
  });

  it('USR-TC-20261006-102053791: danh sách rỗng, đủ 10 địa chỉ không lẫn người khác, địa chỉ đã xóa không hiện; CHK đọc qua giao diện nội bộ', async () => {
    const u1 = await customer();
    expect((await list(u1.cookie)).body).toEqual({ items: [] });
    const u2 = await customer('u2@shop.vn');
    const mine = await seedAddresses(t, u1.id, 10);
    const theirs = await seedAddresses(t, u2.id, 4);
    const r = await list(u1.cookie);
    expect(r.body.items).toHaveLength(10);
    expect(r.body.items.map((x: any) => x.id).sort()).toEqual([...mine].sort());
    expect(r.body.items.some((x: any) => theirs.includes(x.id))).toBe(false);
    expect(r.body.items.every((x: any) => !('user_id' in x))).toBe(true);
    const gone = await seedAddress(t, u2.id, { deletedAt: ago(DAY) });
    expect((await list(u2.cookie)).body.items.map((x: any) => x.id)).not.toContain(gone);

    // giao diện nội bộ cho CHK (architecture.md): trả đúng dạng, null khi của người khác, đã xóa hoặc sai định dạng
    const [one] = await t.addressSvc.listAddresses(u1.id);
    expect(Object.keys(one).sort()).toEqual(['city', 'district', 'id', 'is_default', 'line1', 'phone', 'receiver', 'updated_at', 'ward']);
    expect(await t.addressSvc.getAddress(u1.id, mine[0])).toMatchObject({ id: mine[0] });
    expect(await t.addressSvc.getAddress(u1.id, theirs[0])).toBeNull();
    expect(await t.addressSvc.getAddress(u2.id, gone)).toBeNull();
    expect(await t.addressSvc.getAddress(u1.id, 'abc')).toBeNull();
    expect(await t.addressSvc.getAddress(u1.id, NOBODY)).toBeNull();
  });

  it('USR-TC-20261006-102053816: địa chỉ đầu tiên luôn mặc định; địa chỉ sau với is_default chuyển mặc định', async () => {
    const u1 = await customer();
    const first = await add(u1.cookie, { ...VALID_ADDRESS, is_default: false });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ receiver: 'Nguyễn An', phone: '0901234567', is_default: true });
    expect(Object.keys(first.body).sort()).toEqual(ADDRESS_KEYS);
    expect((await list(u1.cookie)).body.items).toHaveLength(1);
    const second = await add(u1.cookie, { ...VALID_ADDRESS, receiver: 'Trần Bình', is_default: true });
    expect([second.status, second.body.is_default]).toEqual([201, true]);
    const rows = await addressRows(t, u1.id); // cùng thời điểm đồng hồ giả: tra theo id, không theo thứ tự
    expect([rows.find((r) => r.id === first.body.id)!.is_default, rows.find((r) => r.id === second.body.id)!.is_default]).toEqual([false, true]);
    expect(await defaultsOf(t, u1.id)).toEqual([second.body.id]);
    const third = await add(u1.cookie, { ...VALID_ADDRESS, receiver: 'Ba' }); // không gửi is_default: không đổi mặc định
    expect([third.status, third.body.is_default]).toEqual([201, false]);
    expect(await defaultsOf(t, u1.id)).toEqual([second.body.id]);
  });

  it('USR-TC-20261006-102053842: thêm địa chỉ sai dữ liệu, đủ 10, trường lạ và role không phép', async () => {
    const u1 = await customer();
    const u2 = await customer('u2@shop.vn');
    const { city: _c, ...noCity } = VALID_ADDRESS;
    const cases: [unknown, string, string][] = [
      [noCity, 'city', 'required'], [{ ...VALID_ADDRESS, phone: '0123456789' }, 'phone', 'invalid_phone'], [{ ...VALID_ADDRESS, receiver: '   ' }, 'receiver', 'required'],
    ];
    for (const [body, field, code] of cases) {
      const r = await add(u1.cookie, body);
      expect([field, r.status, r.body.errors]).toEqual([field, 400, [{ field, code }]]);
    }
    expect(await liveCount(t, u1.id)).toBe(0);
    await seedAddresses(t, u1.id, 10);
    const full = await add(u1.cookie);
    expect([full.status, full.body.type, full.body.code]).toEqual([409, 'urn:ecom:error:address-limit-reached', 'address_limit_reached']);
    expect(await liveCount(t, u1.id)).toBe(10);
    const before2 = await liveCount(t, u2.id);
    for (const [k, v] of [['user_id', u2.id], ['id', NOBODY], ['created_at', 'x'], ['deleted_at', 'x'], ['updated_at', 'x']] as const) {
      const r = await add(u2.cookie, { ...VALID_ADDRESS, [k]: v });
      expect([k, r.status, r.body.errors?.[0]?.code]).toEqual([k, 400, 'unknown_field']);
    }
    expect(await liveCount(t, u2.id)).toBe(before2);
    const staff = await userWithSession(t, { email: 's1@shop.vn', role: 'staff' });
    expect((await add(staff.cookie)).status).toBe(403);
    expect((await q(t, `SELECT 1 FROM addresses WHERE user_id = '${staff.id}'`))).toHaveLength(0);
  });

  it('USR-TC-20261006-102053867: thêm địa chỉ thiếu phiên hoặc CSRF không ghi gì', async () => {
    const u1 = await customer();
    expect((await add(undefined)).status).toBe(401);
    for (const origin of ['https://evil.example', null]) {
      const r = await add(u1.cookie, VALID_ADDRESS, { origin });
      expect([String(origin), r.status, r.body.type]).toEqual([String(origin), 403, 'urn:ecom:error:csrf_failed']);
    }
    expect((await add(u1.cookie, 'x=1', { contentType: 'text/plain' })).status).toBe(415);
    expect(await liveCount(t, u1.id)).toBe(0);
  });

  it('USR-TC-20261006-102053892: hai request thêm đồng thời khi đang có 9 địa chỉ, đúng một thành công (20 vòng)', async () => {
    const u1 = await customer();
    await seedAddresses(t, u1.id, 9);
    for (let round = 0; round < 20; round++) {
      const rs = await Promise.all([add(u1.cookie), add(u1.cookie)]);
      expect([round, rs.map((r) => r.status).sort()]).toEqual([round, [201, 409]]);
      expect(rs.find((r) => r.status === 409)!.body.type).toBe('urn:ecom:error:address-limit-reached');
      expect([round, await liveCount(t, u1.id)]).toEqual([round, 10]);
      await t.prisma.$executeRaw`DELETE FROM addresses WHERE id = ${rs.find((r) => r.status === 201)!.body.id}::uuid`; // dọn về 9
    }
  }, 120_000);

  it('USR-TC-20261006-102053919: biên độ dài, chuẩn hóa số điện thoại và chuỗi giống HTML', async () => {
    const u1 = await customer();
    const long = await add(u1.cookie, { ...VALID_ADDRESS, receiver: 'r'.repeat(100), line1: 'l'.repeat(200) });
    expect(long.status).toBe(201);
    const tooLong = await add(u1.cookie, { ...VALID_ADDRESS, receiver: 'r'.repeat(101) });
    expect([tooLong.status, tooLong.body.errors]).toEqual([400, [{ field: 'receiver', code: 'too_long' }]]);
    expect((await add(u1.cookie, { ...VALID_ADDRESS, line1: 'l'.repeat(201) })).body.errors).toEqual([{ field: 'line1', code: 'too_long' }]);
    const intl = await add(u1.cookie, { ...VALID_ADDRESS, phone: '+84 912 345 678' });
    expect([intl.status, intl.body.phone]).toEqual([201, '0912345678']);
    const html = '<img src=x onerror=alert(1)>';
    const x = await add(u1.cookie, { ...VALID_ADDRESS, line1: html });
    expect(x.status).toBe(201);
    expect(x.body.line1).toBe(html); // lưu nguyên, không lọc HTML ở đầu vào
    expect((await list(u1.cookie)).body.items.some((i: any) => i.line1 === html)).toBe(true);
    expect((await add(u1.cookie, { ...VALID_ADDRESS, ward: 'Phường\u0000X' })).body.errors?.[0]).toEqual({ field: 'ward', code: 'invalid_format' });
  });

  it('USR-TC-20261006-102053943: hai request cùng is_default đồng thời chỉ để lại một mặc định (20 vòng)', async () => {
    const u1 = await customer();
    await seedAddresses(t, u1.id, 3);
    for (let round = 0; round < 20; round++) {
      const rs = await Promise.all([add(u1.cookie, { ...VALID_ADDRESS, is_default: true }), add(u1.cookie, { ...VALID_ADDRESS, is_default: true })]);
      expect([round, rs.map((r) => r.status)]).toEqual([round, [201, 201]]);
      expect([round, await defaultsOf(t, u1.id)]).toEqual([round, expect.arrayContaining([expect.any(String)])]);
      expect([round, (await defaultsOf(t, u1.id)).length]).toEqual([round, 1]);
      await t.prisma.$executeRaw`DELETE FROM addresses WHERE id IN (${rs[0].body.id}::uuid, ${rs[1].body.id}::uuid)`;
      await t.prisma.$executeRaw`UPDATE addresses SET is_default = true WHERE id = (SELECT id FROM addresses WHERE user_id = ${u1.id}::uuid ORDER BY created_at LIMIT 1)`;
    }
  }, 120_000);

  it('USR-TC-20261006-102053968: sửa một phần địa chỉ và đặt địa chỉ khác làm mặc định; updated_at chỉ đổi khi nội dung đổi', async () => {
    const u1 = await customer();
    const a1 = await seedAddress(t, u1.id, { isDefault: true, createdAt: ago(2 * DAY), line1: '1 A' });
    const a2 = await seedAddress(t, u1.id, { createdAt: ago(1 * DAY), line1: '10 Hai Bà Trưng', receiver: 'B', ward: 'W', district: 'D', city: 'C' });
    const before = (await addressRows(t, u1.id)).find((r) => r.id === a2)!;
    t.clock.advance(600_000); // 10 phút: đủ để updated_at khác nhau, chưa quá hạn trượt 30 phút của phiên
    const r = await edit(u1.cookie, a2, { line1: '45 Nguyễn Huệ', phone: '0987654321' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: a2, line1: '45 Nguyễn Huệ', phone: '0987654321', receiver: 'B', ward: 'W', district: 'D', city: 'C', is_default: false });
    expect(new Date(r.body.updated_at).getTime()).toBeGreaterThan(before.updated_at.getTime());
    const rows = await addressRows(t, u1.id);
    expect(rows.find((x) => x.id === a1)).toMatchObject({ is_default: true, updated_at: ago(2 * DAY) });

    const upd2 = rows.find((x) => x.id === a2)!.updated_at;
    t.clock.advance(600_000); // 10 phút: đủ để updated_at khác nhau, chưa quá hạn trượt 30 phút của phiên
    const d = await edit(u1.cookie, a2, { is_default: true });
    expect([d.status, d.body.is_default]).toEqual([200, true]);
    const after = await addressRows(t, u1.id);
    expect(after.map((x) => [x.id, x.is_default])).toEqual([[a1, false], [a2, true]]);
    expect(after.find((x) => x.id === a1)!.updated_at.getTime()).toBe(ago(2 * DAY).getTime()); // đổi mặc định không đổi nội dung (CHK dựa vào updated_at)
    expect(after.find((x) => x.id === a2)!.updated_at.getTime()).toBe(upd2.getTime());
  });

  // review USR (đột biến lọt): `contentChanged = true` vô điều kiện không làm test nào đỏ vì mọi PATCH của test trên đều đổi giá trị thật.
  it('review USR (USR-TC-20261006-102053968): sửa với giá trị y hệt (kể cả điện thoại viết khác dạng) không đổi updated_at; đổi district sang null thì đổi', async () => {
    const u1 = await customer();
    await seedAddress(t, u1.id, { isDefault: true, createdAt: ago(2 * DAY) });
    const a2 = await seedAddress(t, u1.id, { createdAt: ago(1 * DAY), line1: '10 Hai Bà Trưng', receiver: 'B', ward: 'W', district: 'D', city: 'C', phone: '0901234567' });
    t.clock.advance(600_000);
    const same = await edit(u1.cookie, a2, { line1: '10 Hai Bà Trưng', receiver: 'B', district: 'D', phone: '+84 901.234.567' });
    expect(same.status).toBe(200);
    expect((await addressRows(t, u1.id)).find((x) => x.id === a2)!.updated_at.getTime()).toBe(ago(1 * DAY).getTime());
    t.clock.advance(600_000);
    expect((await edit(u1.cookie, a2, { district: null })).status).toBe(200);
    expect((await addressRows(t, u1.id)).find((x) => x.id === a2)).toMatchObject({ district: null, updated_at: new Date(T0.getTime() + 1_200_000) });
  });

  it('USR-TC-20261006-102053992: sửa địa chỉ của người khác, không tồn tại, sai định dạng hay đã xóa cùng 404 cùng nội dung', async () => {
    const u1 = await customer();
    const u2 = await customer('u2@shop.vn');
    const gone = await seedAddress(t, u1.id, { deletedAt: ago(DAY) });
    const b1 = await seedAddress(t, u2.id, { isDefault: true, receiver: 'Của u2' });
    const bodies: Record<string, unknown>[] = [];
    for (const id of [b1, NOBODY, 'abc', gone]) {
      const r = await edit(u1.cookie, id, { city: 'Hà Nội' });
      expect([id, r.status, r.body.type]).toEqual([id, 404, 'urn:ecom:error:not-found']);
      bodies.push(strip(r.body));
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]); // chỉ trace_id khác
    expect((await addressRows(t, u2.id))[0]).toMatchObject({ receiver: 'Của u2' });
    expect((await q(t, `SELECT city FROM addresses WHERE id = '${b1}'`))[0].city).toBe('TP. Hồ Chí Minh');
  });

  it('USR-TC-20261006-102054018: sửa địa chỉ vi phạm luật mặc định, dữ liệu sai hoặc trường lạ', async () => {
    const u1 = await customer();
    const u2 = await customer('u2@shop.vn');
    const a1 = await seedAddress(t, u1.id, { isDefault: true });
    const off = await edit(u1.cookie, a1, { is_default: false });
    expect([off.status, off.body.type, off.body.code, off.body.errors]).toEqual([400, 'urn:ecom:error:cannot-unset-default', 'cannot_unset_default', [{ field: 'is_default', code: 'cannot_unset_default' }]]);
    expect(await defaultsOf(t, u1.id)).toEqual([a1]);
    const mixed = await edit(u1.cookie, a1, { city: 'Đà Nẵng', is_default: false }); // bị từ chối trước khi ghi: không ghi một phần
    expect(mixed.status).toBe(400);
    expect((await q(t, `SELECT city FROM addresses WHERE id = '${a1}'`))[0].city).toBe('TP. Hồ Chí Minh');
    const bad = await edit(u1.cookie, a1, { phone: '12345' });
    expect([bad.status, bad.body.errors]).toEqual([400, [{ field: 'phone', code: 'invalid_phone' }]]);
    expect((await edit(u1.cookie, a1, {})).status).toBe(400);
    const owner = await edit(u1.cookie, a1, { user_id: u2.id });
    expect([owner.status, owner.body.errors?.[0]?.code]).toEqual([400, 'unknown_field']);
    expect((await q(t, `SELECT user_id::text AS u FROM addresses WHERE id = '${a1}'`))[0].u).toBe(u1.id);
  });

  it('USR-TC-20261006-102054043: sửa địa chỉ thiếu CSRF hoặc sai role', async () => {
    const u1 = await customer();
    const a1 = await seedAddress(t, u1.id, { isDefault: true });
    for (const origin of ['https://evil.example', null]) {
      const r = await edit(u1.cookie, a1, { city: 'Hà Nội' }, { origin });
      expect([String(origin), r.status, r.body.type]).toEqual([String(origin), 403, 'urn:ecom:error:csrf_failed']);
    }
    expect((await edit(u1.cookie, a1, 'city=Hà Nội', { contentType: 'text/plain' })).status).toBe(415);
    expect((await edit(undefined, a1, { city: 'Hà Nội' })).status).toBe(401);
    const admin = await userWithSession(t, { email: 'ad@shop.vn', role: 'admin' });
    expect((await edit(admin.cookie, a1, { city: 'Hà Nội' })).status).toBe(403);
    expect((await q(t, `SELECT city FROM addresses WHERE id = '${a1}'`))[0].city).toBe('TP. Hồ Chí Minh');
  });

  it('USR-TC-20261006-102054073: đặt lại mặc định, bỏ mặc định ở địa chỉ không mặc định, đua mặc định (20 vòng)', async () => {
    const u1 = await customer();
    const [a1, a2, a3] = await seedAddresses(t, u1.id, 3);
    const upd = (await addressRows(t, u1.id)).map((r) => r.updated_at.getTime());
    t.clock.advance(600_000); // 10 phút: đủ để updated_at khác nhau, chưa quá hạn trượt 30 phút của phiên
    expect((await edit(u1.cookie, a1, { is_default: true })).status).toBe(200);
    expect((await edit(u1.cookie, a2, { is_default: false })).status).toBe(200);
    expect((await addressRows(t, u1.id)).map((r) => [r.is_default, r.updated_at.getTime()])).toEqual([[true, upd[0]], [false, upd[1]], [false, upd[2]]]); // không đổi gì, kể cả updated_at
    for (let round = 0; round < 20; round++) {
      const rs = await Promise.all([edit(u1.cookie, a2, { is_default: true }), edit(u1.cookie, a3, { is_default: true })]);
      expect([round, rs.map((r) => r.status)]).toEqual([round, [200, 200]]);
      expect([round, (await defaultsOf(t, u1.id)).length]).toEqual([round, 1]); // không bao giờ 0 hay 2
    }
    await del(u1.cookie, a3);
    expect((await edit(u1.cookie, a3, { city: 'X' })).status).toBe(404); // đã xóa
  }, 120_000);

  it('USR-TC-20261006-102054099: xóa địa chỉ thường và xóa mặc định chuyển mặc định cho địa chỉ mới nhất còn lại', async () => {
    const u1 = await customer();
    const a1 = await seedAddress(t, u1.id, { isDefault: true, createdAt: ago(10 * DAY) });
    const a2 = await seedAddress(t, u1.id, { createdAt: ago(5 * DAY) });
    const a3 = await seedAddress(t, u1.id, { createdAt: ago(7 * DAY) });
    const r = await del(u1.cookie, a2);
    expect([r.status, r.text]).toEqual([204, '']);
    expect((await list(u1.cookie)).body.items.map((x: any) => [x.id, x.is_default])).toEqual([[a1, true], [a3, false]]);

    const u2 = await customer('u2@shop.vn');
    const b1 = await seedAddress(t, u2.id, { isDefault: true, createdAt: ago(10 * DAY) });
    await seedAddress(t, u2.id, { createdAt: ago(7 * DAY) });
    const b4 = await seedAddress(t, u2.id, { createdAt: ago(6 * DAY) });
    expect((await del(u2.cookie, b1)).status).toBe(204);
    expect(await defaultsOf(t, u2.id)).toEqual([b4]); // mới tạo nhất còn lại
    const rows = await addressRows(t, u2.id);
    expect(rows.find((x) => x.id === b1)).toMatchObject({ is_default: false });
    expect(rows.find((x) => x.id === b1)!.deleted_at).not.toBeNull(); // xóa mềm
  });

  it('USR-TC-20261006-102054124: xóa địa chỉ của người khác, xóa hai lần, thiếu CSRF hay sai role', async () => {
    const u1 = await customer();
    const u2 = await customer('u2@shop.vn');
    const a1 = await seedAddress(t, u1.id, { isDefault: true });
    const a2 = await seedAddress(t, u1.id);
    const b1 = await seedAddress(t, u2.id, { isDefault: true });
    const bodies: Record<string, unknown>[] = [];
    for (const id of [b1, NOBODY, 'abc']) { const r = await del(u1.cookie, id); expect([id, r.status]).toEqual([id, 404]); bodies.push(strip(r.body)); }
    bodies.forEach((b) => expect(b).toEqual(bodies[0]));
    expect(await liveCount(t, u2.id)).toBe(1);
    expect((await del(u1.cookie, a2)).status).toBe(204);
    expect((await del(u1.cookie, a2)).status).toBe(404); // xóa lần hai
    for (const origin of ['https://evil.example', null]) {
      const r = await del(u1.cookie, a1, { origin });
      expect([String(origin), r.status, r.body.type]).toEqual([String(origin), 403, 'urn:ecom:error:csrf_failed']);
    }
    expect((await call(t, 'delete', `/me/addresses/${a1}`, { cookie: u1.cookie, body: 'x', contentType: 'text/plain' })).status).toBe(415);
    expect((await del(undefined, a1)).status).toBe(401);
    const staff = await userWithSession(t, { email: 's1@shop.vn', role: 'staff' });
    expect((await del(staff.cookie, a1)).status).toBe(403);
    expect(await liveCount(t, u1.id)).toBe(1);
  });

  it('USR-TC-20261006-102054149: xóa địa chỉ cuối, giới hạn 10 tính theo địa chỉ chưa xóa, xóa đồng thời (20 vòng)', async () => {
    const u1 = await customer();
    const [only] = await seedAddresses(t, u1.id, 1);
    expect((await del(u1.cookie, only)).status).toBe(204);
    expect((await list(u1.cookie)).body.items).toEqual([]);
    const fresh = await add(u1.cookie);
    expect([fresh.status, fresh.body.is_default]).toEqual([201, true]); // sổ rỗng: địa chỉ mới lại tự thành mặc định

    const u2 = await customer('u2@shop.vn');
    const ten = await seedAddresses(t, u2.id, 10);
    expect((await del(u2.cookie, ten[4])).status).toBe(204);
    expect((await add(u2.cookie)).status).toBe(201); // địa chỉ đã xóa không tính vào 10
    expect((await add(u2.cookie)).status).toBe(409);

    const u3 = await customer('u3@shop.vn');
    for (let round = 0; round < 20; round++) {
      const [a1, a2] = await seedAddresses(t, u3.id, 2);
      const rs = await Promise.all([del(u3.cookie, a1), del(u3.cookie, a2)]);
      expect([round, rs.map((r) => r.status)]).toEqual([round, [204, 204]]);
      expect([round, await liveCount(t, u3.id), (await defaultsOf(t, u3.id)).length]).toEqual([round, 0, 0]);
      expect((await q(t, `SELECT 1 FROM addresses WHERE user_id = '${u3.id}' AND is_default AND deleted_at IS NOT NULL`))).toHaveLength(0); // CHECK không bị vi phạm
    }
  }, 120_000);

  it('USR-TC-20261006-102054173: job dọn xóa cứng địa chỉ đã xóa mềm quá 30 ngày, giữ địa chỉ dưới 30 ngày', async () => {
    const u1 = await customer();
    const live = await seedAddress(t, u1.id, { isDefault: true });
    const x1 = await seedAddress(t, u1.id, { deletedAt: ago(31 * DAY), createdAt: ago(40 * DAY) });
    const x2 = await seedAddress(t, u1.id, { deletedAt: ago(29 * DAY), createdAt: ago(40 * DAY) });
    expect(await t.jobs.runOnce('usr.purge-deleted-addresses')).toBe('ran');
    const rows = await addressRows(t, u1.id);
    expect(rows.map((r) => r.id).sort()).toEqual([live, x2].sort());
    expect(rows.find((r) => r.id === x2)!.deleted_at).not.toBeNull();
    expect(rows.some((r) => r.id === x1)).toBe(false);
    expect((await list(u1.cookie)).body.items.map((x: any) => x.id)).toEqual([live]);
    expect(await t.addressSvc.purgeDeleted()).toBe(0); // idempotent
  });

  it('USR-TC-20261006-102054520: thêm và sửa địa chỉ không có quận, huyện; CHK đọc được district null', async () => {
    const u1 = await customer();
    const { district: _d, ...noDistrict } = VALID_ADDRESS;
    const r = await add(u1.cookie, noDistrict);
    expect([r.status, r.body.district]).toEqual([201, null]);
    expect((await list(u1.cookie)).body.items[0].district).toBeNull();
    expect((await addressRows(t, u1.id))[0].district).toBeNull(); // NULL trong CSDL
    expect((await t.addressSvc.getAddress(u1.id, r.body.id))!.district).toBeNull();
    expect((await t.addressSvc.listAddresses(u1.id))[0].district).toBeNull();

    const a1 = await seedAddress(t, u1.id, { district: 'Quận 1', ward: 'Bến Nghé' });
    for (const district of ['', null, '   ']) {
      await t.prisma.$executeRaw`UPDATE addresses SET district = 'Quận 1' WHERE id = ${a1}::uuid`;
      const e = await edit(u1.cookie, a1, { district });
      expect([String(district), e.status, e.body.district, e.body.ward, e.body.city]).toEqual([String(district), 200, null, 'Bến Nghé', 'TP. Hồ Chí Minh']);
    }
    const { ward: _w, ...noWard } = VALID_ADDRESS;
    const { line1: _l, ...noLine } = VALID_ADDRESS;
    expect((await add(u1.cookie, noWard)).body.errors).toEqual([{ field: 'ward', code: 'required' }]);
    expect((await add(u1.cookie, noLine)).body.errors).toEqual([{ field: 'line1', code: 'required' }]);
  });

  it('USR-TC-20261006-102054595: ghi sổ địa chỉ lần thứ 121 trong một phút bị 429 (thêm, sửa, xóa chung một bộ đếm), mở lại sau cửa sổ', async () => {
    const u1 = await customer();
    let ids = await seedAddresses(t, u1.id, 3);
    let n = 0;
    const must = (r: { status: number; text: string; body: any }, want: number) => { n++; if (r.status !== want) throw new Error(`yêu cầu ${n}: ${r.status} ${r.text}`); return r; };
    for (let i = 0; i < 60; i++) must(await edit(u1.cookie, ids[0], { line1: `Số ${i}` }), 200);
    for (let i = 0; i < 30; i++) {
      must(await del(u1.cookie, ids[1]), 204);
      const created = must(await add(u1.cookie), 201);
      ids = [ids[0], created.body.id, ids[2]];
    }
    expect(n).toBe(120);
    expect(await liveCount(t, u1.id)).toBe(3);
    const limited = await add(u1.cookie);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(await liveCount(t, u1.id)).toBe(3);
    t.clock.advance(61_000);
    expect((await add(u1.cookie)).status).toBe(201);
  }, 120_000);
});
