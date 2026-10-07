import { truncateAll } from '../support/db';
import { createUsrApp, call, setProfile, userWithSession, ME_KEYS, type UsrApp } from '../support/usr';
import { ORIGIN } from '../support/app';
import { q } from '../support/auth';

describe('USR hồ sơ cá nhân: xem và sửa (USR-REQ-20261006-101003419, 101003504)', () => {
  let t: UsrApp;
  let T0: Date; // mốc của đồng hồ giả, lấy từ chính đồng hồ (không ghi ngày cố định trong test)
  beforeAll(async () => { t = await createUsrApp(); T0 = t.clock.now(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); t.clock.set(T0); });

  const meOf = (cookie: string) => call(t, 'get', '/me', { cookie });
  const patch = (cookie: string, body: unknown, o: Parameters<typeof call>[3] = {}) => call(t, 'patch', '/me', { cookie, body, ...o });

  it('USR-TC-20261006-102053219: customer xem hồ sơ của mình, không lộ băm mật khẩu; staff thấy hồ sơ của chính mình', async () => {
    const u1 = await userWithSession(t, { email: 'an@shop.vn', name: 'Nguyễn An' });
    await setProfile(t, u1.id, { phone: '0901234567' });
    const s1 = await userWithSession(t, { email: 's1@shop.vn', role: 'staff', name: 'Staff Một' });
    const r = await meOf(u1.cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: u1.id, email: 'an@shop.vn', full_name: 'Nguyễn An', phone: '0901234567', avatar_url: null, email_verified: true, role: 'customer' });
    expect(Object.keys(r.body).sort()).toEqual(ME_KEYS); // so khớp tập khóa chính xác: bắt trường thừa như password_hash, failed_login_count, locked_reason
    expect(r.headers['cache-control']).toContain('no-store');
    const s = await meOf(s1.cookie);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ id: s1.id, role: 'staff', email: 's1@shop.vn' });
    expect(JSON.stringify(s.body)).not.toContain('an@shop.vn');
  });

  it('USR-TC-20261006-102053246: hồ sơ từ chối khi không có phiên, phiên quá hạn, hoặc kèm tham số chọn người khác', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn', name: 'Người Một' });
    const u2 = await userWithSession(t, { email: 'u2@shop.vn', name: 'Người Hai' });
    const guest = await call(t, 'get', '/me');
    expect(guest.status).toBe(401);
    expect(guest.headers['content-type']).toContain('application/problem+json');
    expect(guest.body.trace_id).toBeTruthy();
    expect(Object.keys(guest.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']); // không có trường hồ sơ nào

    t.clock.advance(31 * 60_000); // quá hạn trượt 30 phút không thao tác
    const expired = await meOf(u1.cookie);
    expect(expired.status).toBe(401);
    expect(JSON.stringify(expired.body)).not.toContain('u1@shop.vn');

    t.clock.set(T0);
    const other = await meOf(u1.cookie).query({ user_id: u2.id });
    expect(other.status).toBe(400);
    expect(JSON.stringify(other.body)).not.toMatch(/u2@shop\.vn|Người Hai/);
    expect((await meOf(u1.cookie).query({ id: u2.id })).status).toBe(400);
  });

  it('USR-TC-20261006-102053272: tài khoản mới chưa xác minh xem được hồ sơ; tài khoản bị khóa nhận 401 bằng cookie cũ', async () => {
    const u3 = await userWithSession(t, { email: 'u3@shop.vn', verified: false });
    const r = await meOf(u3.cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ email_verified: false, phone: null, avatar_url: null });

    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    expect((await meOf(u1.cookie)).status).toBe(200);
    const admin = await userWithSession(t, { email: 'ad@shop.vn', role: 'admin' });
    expect((await call(t, 'post', `/admin/users/${u1.id}/lock`, { cookie: admin.cookie, body: {} })).status).toBe(200); // khóa bằng endpoint của AUTH: thu hồi mọi phiên
    const locked = await meOf(u1.cookie);
    expect(locked.status).toBe(401);
    expect(Object.keys(locked.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
  });

  it('USR-TC-20261006-102053297: sửa họ tên và điện thoại, chuẩn hóa giá trị, không ghi PII vào log', async () => {
    const u1 = await userWithSession(t, { email: 'an@shop.vn', name: 'Nguyễn An' });
    t.logs.clear();
    const a = await patch(u1.cookie, { full_name: '  Nguyễn Văn An ', phone: '+84 901.234.567' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ full_name: 'Nguyễn Văn An', phone: '0901234567' });
    expect(Object.keys(a.body).sort()).toEqual(ME_KEYS);
    expect((await meOf(u1.cookie)).body).toMatchObject({ full_name: 'Nguyễn Văn An', phone: '0901234567' });
    const b = await patch(u1.cookie, { full_name: 'An' });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ full_name: 'An', phone: '0901234567' }); // một phần: chỉ trường có mặt mới đổi
    const log = t.logs.lines.join('\n');
    for (const pii of ['0901234567', 'Nguyễn Văn An', 'an@shop.vn']) expect([pii, log.includes(pii)]).toEqual([pii, false]);
    const rec = t.logs.records.find((l) => l.route === '/api/v1/me' && l.status === 200 && l.user_id === u1.id);
    expect(rec?.correlation_id).toBe(a.headers['x-request-id']); // dấu vết: user_id và id yêu cầu (trace_id của lỗi)
  });

  it('USR-TC-20261006-102053322: sửa hồ sơ chặn trường lạ, dữ liệu sai và request thiếu CSRF', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn', name: 'Nguyễn An' });
    const before = (await q(t, `SELECT role::text AS role, email::text AS email, avatar_url, email_verified_at IS NOT NULL AS v FROM users WHERE id = '${u1.id}'`))[0];
    const attempts: [string, unknown][] = [
      ['role', 'admin'], ['email', 'x@shop.vn'], ['avatar_url', 'https://evil.example/a.png'], ['user_id', u1.id],
      ['email_verified_at', '2020-01-01T00:00:00Z'], ['password', 'Hacked-Password-1'], ['id', u1.id],
    ];
    for (const [k, v] of attempts) {
      const r = await patch(u1.cookie, { [k]: v });
      expect([k, r.status, r.body.errors?.[0]?.code]).toEqual([k, 400, 'unknown_field']);
    }
    expect((await q(t, `SELECT role::text AS role, email::text AS email, avatar_url, email_verified_at IS NOT NULL AS v FROM users WHERE id = '${u1.id}'`))[0]).toEqual(before);

    const blank = await patch(u1.cookie, { full_name: '   ' });
    expect([blank.status, blank.body.errors]).toEqual([400, [{ field: 'full_name', code: 'required' }]]);
    const phone = await patch(u1.cookie, { phone: '12345' });
    expect([phone.status, phone.body.errors]).toEqual([400, [{ field: 'phone', code: 'invalid_phone' }]]);
    expect((await patch(u1.cookie, {})).status).toBe(400);
    expect((await patch(u1.cookie, { full_name: 'Tên mới', phone: '12345' })).status).toBe(400);
    expect((await meOf(u1.cookie)).body).toMatchObject({ full_name: 'Nguyễn An', phone: null }); // không trường nào được ghi, kể cả trường hợp lệ đi kèm trường sai

    const evil = await patch(u1.cookie, { full_name: 'Hack' }, { origin: 'https://evil.example' });
    expect([evil.status, evil.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    const noOrigin = await patch(u1.cookie, { full_name: 'Hack' }, { origin: null });
    expect([noOrigin.status, noOrigin.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    expect((await patch(u1.cookie, 'full_name=Hack', { contentType: 'text/plain' })).status).toBe(415);
    expect((await patch('', { full_name: 'Hack' })).status).toBe(401);
    expect((await meOf(u1.cookie)).body.full_name).toBe('Nguyễn An');
  });

  it('USR-TC-20261006-102053348: sửa hồ sơ ở giá trị biên và lưu chuỗi giống HTML (tầng API; DOM kiểm ở E2E)', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const ok100 = await patch(u1.cookie, { full_name: 'a'.repeat(100) });
    expect(ok100.status).toBe(200);
    const over = await patch(u1.cookie, { full_name: 'a'.repeat(101) });
    expect([over.status, over.body.errors]).toEqual([400, [{ field: 'full_name', code: 'too_long' }]]);
    expect((await meOf(u1.cookie)).body.full_name).toBe('a'.repeat(100));

    await patch(u1.cookie, { phone: '0901234567' });
    const cleared = await patch(u1.cookie, { phone: null });
    expect([cleared.status, cleared.body.phone]).toEqual([200, null]);
    for (const bad of ['0201234567', '090123456']) {
      const r = await patch(u1.cookie, { phone: bad });
      expect([bad, r.status, r.body.errors?.[0]?.code]).toEqual([bad, 400, 'invalid_phone']);
    }
    expect((await patch(u1.cookie, { phone: '' })).body.phone).toBeNull(); // chuỗi rỗng cũng xóa số
    expect((await patch(u1.cookie, { phone: '098-123 4567' })).body.phone).toBe('0981234567');

    const html = '<script>alert(1)</script>';
    const x = await patch(u1.cookie, { full_name: html });
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('application/json');
    expect(x.text).toContain(JSON.stringify(html).slice(1, -1)); // thân JSON chứa chuỗi thô, không bị lọc hay mã hóa HTML ở server
    expect((await patch(u1.cookie, { full_name: 'Tên\u0007lạ' })).body.errors?.[0]?.code).toBe('invalid_format'); // ký tự điều khiển bị từ chối
    expect((await patch(u1.cookie, { full_name: 'Tên' + 'é'.repeat(2) })).status).toBe(200); // NFC trước khi đếm độ dài
  });

  it('USR-TC-20261006-102054570: sửa hồ sơ lần thứ 121 trong một phút bị 429, mở lại sau cửa sổ, không ảnh hưởng người khác', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const u2 = await userWithSession(t, { email: 'u2@shop.vn' });
    for (let i = 1; i <= 120; i++) {
      const r = await patch(u1.cookie, { full_name: `Tên ${i}` });
      if (r.status !== 200) throw new Error(`lần ${i}: ${r.status}`);
    }
    const limited = await patch(u1.cookie, { full_name: 'Hack' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.type).toBe('urn:ecom:error:rate-limited');
    expect((await meOf(u1.cookie)).body.full_name).toBe('Tên 120');
    t.clock.advance(61_000);
    expect((await patch(u1.cookie, { full_name: 'Sau cửa sổ' })).status).toBe(200);
    t.clock.set(T0);
    for (let i = 0; i < 120; i++) await patch(u1.cookie, { full_name: 'X' }); // làm u1 bị giới hạn lại trong cửa sổ đầu
    expect((await patch(u1.cookie, { full_name: 'X' })).status).toBe(429);
    expect((await patch(u2.cookie, { full_name: 'Của u2' })).status).toBe(200); // khóa đếm theo người dùng, không theo IP
    expect(ORIGIN).toBeTruthy();
  });
});
