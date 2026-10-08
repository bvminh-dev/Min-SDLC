import { truncateAll } from '../support/db';
import { actor, auditCount, auditOf, call, countOf, couponOf, createPrmApp, eventsOf, q, resetLimits, type PrmApp } from '../support/prm';

// Tạo coupon qua API quản trị (PRM-REQ-20261006-101036201): PostgreSQL thật, phiên thật của AUTH, đồng hồ giả đặt về giờ thật.
describe('PRM tạo coupon (admin)', () => {
  let t: PrmApp;
  let admin: { id: string; cookie: string };
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); admin = await actor(t, 'admin'); });
  const future = (sec = 7 * 86400) => new Date(t.clock.now().getTime() + sec * 1000).toISOString();
  let calls = 0;
  const create = async (body: unknown, cookie = admin.cookie) => { if (++calls % 20 === 0) await resetLimits(t); return call(t, 'post', '/admin/coupons', { cookie, body }); }; // bậc D 30 mỗi phút mỗi người: dọn bộ đếm giữa chừng ở test gọi nhiều
  const base = (over: Record<string, unknown> = {}) => ({ code: 'SALE10', type: 'percentage', value: 10, expires_at: future(), usage_limit: 100, ...over });

  it('PRM-TC-20261006-101036592: tạo percentage với mã có khoảng trắng và chữ thường: 201, code SALE10, active, đếm 0, version 1, một dòng audit, không event; fixed thiếu trường tùy chọn có mặc định', async () => {
    const r = await create({ code: ' sale10 ', type: 'percentage', value: 10, min_order_value: 200000, max_discount: 50000, expires_at: future(), usage_limit: 100 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: 'SALE10', type: 'percentage', value: 10, min_order_value: 200000, max_discount: 50000, usage_limit: 100, per_user_limit: null, consumed_count: 0, reserved_count: 0, remaining: 100, status: 'active', version: 1 });
    expect(Object.keys(r.body)).not.toEqual(expect.arrayContaining(['deleted_at', 'created_by']));
    expect(await countOf(t, 'coupons')).toBe(1);
    const a = await auditOf(t, 'promotion.coupon.create');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', target_id: r.body.id, after: { code: 'SALE10', type: 'percentage', value: 10, usage_limit: 100 } });
    expect(await eventsOf(t)).toHaveLength(0);
    const f = await create({ code: 'FIX50K', type: 'fixed', value: 50000, expires_at: future(), usage_limit: 1 });
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({ min_order_value: 0, max_discount: null, per_user_limit: null, remaining: 1 });
    expect((await couponOf(t, 'FIX50K')).deleted_at).toBeNull();
  });

  it('PRM-TC-20261006-101036615: mã trùng (kể cả khác hoa thường và mã đã xóa mềm) là 409 code_taken, không thêm dòng và không thêm audit', async () => {
    expect((await create(base())).status).toBe(201);
    const old = await create(base({ code: 'OLD99' }));
    await q(t, `UPDATE coupons SET status = 'deleted', deleted_at = now() WHERE id = '${old.body.id}'`);
    const audits = await auditCount(t);
    for (const code of ['sale10', 'old99']) {
      const r = await create(base({ code }));
      expect([r.status, r.body.type, r.body.code]).toEqual([409, 'urn:ecom:error:code_taken', 'code_taken']);
      expect(r.body.trace_id).toBeTruthy();
    }
    expect([await countOf(t, 'coupons'), await auditCount(t)]).toEqual([2, audits]);
  });

  it('PRM-TC-20261006-101036639: value ngoài 1..100, số thực hay chuỗi bị 400 nêu trường value; CSDL cũng chặn (CHECK nhiều cột)', async () => {
    for (const value of [101, 0, 10.5, '10', -5, null]) {
      const r = await create(base({ value }));
      expect([String(value), r.status, r.body.errors?.map((e: any) => e.field)]).toEqual([String(value), 400, ['value']]);
    }
    expect(await countOf(t, 'coupons')).toBe(0);
    const ins = (type: string, value: number, extra = 'NULL') => q(t, `INSERT INTO coupons (code, type, value, max_discount, expires_at, usage_limit, created_by) VALUES ('RAW${Math.random().toString(36).slice(2, 7).toUpperCase()}', '${type}', ${value}, ${extra}, now() + interval '1 day', 5, gen_random_uuid())`);
    await expect(ins('percentage', 101)).rejects.toThrow(/coupons_value_by_type|check constraint/);
    await expect(ins('percentage', 0)).rejects.toThrow(/check constraint/);
    await expect(ins('fixed', 1_000_000_001)).rejects.toThrow(/check constraint/);
    await expect(ins('fixed', 1, '1')).rejects.toThrow(/coupons_max_discount_percentage_only|check constraint/); // max_discount chỉ cho percentage
  });

  it('PRM-TC-20261006-101036662: staff, customer và người chưa đăng nhập không tạo được coupon (403, 403, 401); header X-Role giả của client vô tác dụng; admin gửi cùng body thì 201', async () => {
    const staff = await actor(t, 'staff'), customer = await actor(t, 'customer');
    const body = base({ code: 'ROLE1' });
    expect((await create(body, staff.cookie)).status).toBe(403);
    expect((await create(body, customer.cookie)).status).toBe(403);
    expect((await call(t, 'post', '/admin/coupons', { body }).set('X-Role', 'admin')).status).toBe(401);
    expect((await call(t, 'post', '/admin/coupons', { cookie: staff.cookie, body }).set('X-Role', 'admin')).status).toBe(403);
    expect(await countOf(t, 'coupons')).toBe(0);
    expect((await create(body)).status).toBe(201);
  });

  it('PRM-TC-20261006-101036686: fixed có max_discount, thiếu expires_at, thiếu usage_limit, hạn quá khứ và trường lạ (status, consumed_count) đều 400 đúng trường, không tạo gì', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [base({ type: 'fixed', value: 50000, max_discount: 10000 }), 'max_discount'],
      [{ ...base(), expires_at: undefined }, 'expires_at'],
      [{ ...base(), usage_limit: undefined }, 'usage_limit'],
      [base({ expires_at: new Date(t.clock.now().getTime() - 3600_000).toISOString() }), 'expires_at'],
      [base({ status: 'disabled' }), 'status'],
      [base({ consumed_count: 5 }), 'consumed_count'],
      [base({ reserved_count: 5 }), 'reserved_count'],
      [base({ expires_at: '2026-02-30T10:00:00Z' }), 'expires_at'], // ngày không có thật
      [base({ expires_at: '2030-01-01T10:00:00' }), 'expires_at'], // thiếu múi giờ
    ];
    for (const [body, field] of cases) {
      const r = await create(body);
      expect([field, r.status, r.body.errors?.map((e: any) => e.field)]).toEqual([field, 400, [field]]);
    }
    expect(await countOf(t, 'coupons')).toBe(0);
  });

  it('PRM-TC-20261006-101036709: giá trị biên của mã (4 và 20 ký tự), giá trị, số lượt và hạn (cách giờ máy chủ 1 giây tạo được, đúng giờ máy chủ thì 400)', async () => {
    const now = t.clock.now().getTime();
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect((await create(base({ code: 'AB-1' }))).status).toBe(201);
    expect((await create(base({ code: 'A'.repeat(20) }))).status).toBe(201);
    for (const code of ['ABC', 'A'.repeat(21), 'SALE 10', 'SALE#10', '', 'ÁO-MỚI1']) expect([code, (await create(base({ code }))).status]).toEqual([code, 400]);
    expect((await create(base({ code: 'PCT100', value: 100, usage_limit: 1_000_000 }))).status).toBe(201);
    expect((await create(base({ code: 'PCT1', value: 1, usage_limit: 1 }))).status).toBe(201);
    expect((await create(base({ code: 'FIXMAX', type: 'fixed', value: 1_000_000_000 }))).status).toBe(201);
    expect((await create(base({ code: 'FIXOVER', type: 'fixed', value: 1_000_000_001 }))).body.errors[0].field).toBe('value');
    expect((await create(base({ code: 'LIMOVER', usage_limit: 1_000_001 }))).body.errors[0].field).toBe('usage_limit');
    expect((await create(base({ code: 'MINMAX', min_order_value: 1_000_000_000 }))).status).toBe(201);
    expect((await create(base({ code: 'MINOVER', min_order_value: 1_000_000_001 }))).body.errors[0].field).toBe('min_order_value');
    expect((await create(base({ code: 'MAXOVER', max_discount: 1_000_000_001 }))).body.errors[0].field).toBe('max_discount');
    expect((await create(base({ code: 'EXP1S', expires_at: at(1000) }))).status).toBe(201);
    const same = await create(base({ code: 'EXP0S', expires_at: at(0) }));
    expect([same.status, same.body.errors[0].field]).toEqual([400, 'expires_at']); // bằng đúng giờ máy chủ là chưa "sau"
    // Unicode: `ß`, `ı`, `ſ` và ligature `ﬁ` đổi sang chữ hoa A-Z nên phải bị khuôn ASCII chặn TRƯỚC khi đổi hoa (không lọt thành mã khác)
    for (const code of ['straße', 'ıııı1', 'ſale10', 'ﬁnal10']) expect([code, (await create(base({ code }))).status]).toEqual([code, 400]);
    expect(await countOf(t, 'coupons', `code IN ('STRASSE', 'IIII1', 'SALE10', 'FINAL10')`)).toBe(0);
  });

  it('PRM-TC-20261006-101036732: hai admin tạo cùng mã FLASH1 đồng thời (50 lần): đúng một 201, một 409 code_taken, một dòng coupons và một dòng audit', async () => {
    for (let i = 0; i < 50; i++) {
      await truncateAll(t.prisma);
      admin = await actor(t, 'admin'); const second = await actor(t, 'admin', 'admin2@shop.vn');
      const rs = await Promise.all([create(base({ code: 'FLASH1' }), admin.cookie), create(base({ code: 'FLASH1' }), second.cookie)]);
      expect([i, rs.map((r) => r.status).sort()]).toEqual([i, [201, 409]]);
      expect(rs.find((r) => r.status === 409)!.body.code).toBe('code_taken');
      expect([await countOf(t, 'coupons', `code = 'FLASH1'`), (await auditOf(t, 'promotion.coupon.create')).length]).toEqual([1, 1]);
    }
  }, 180_000);

  it('PRM-TC-20261006-130100101: per_user_limit hợp lệ (1, 1000000, nhỏ hơn hay lớn hơn usage_limit), bỏ trống là null, ngoài khoảng (0, -1, 2.5, 1000001, "abc") là 400 nêu per_user_limit; CHECK chặn 0', async () => {
    const once = await create(base({ code: 'ONCE10', per_user_limit: 1 }));
    expect([once.status, once.body.per_user_limit, once.body.version]).toEqual([201, 1, 1]);
    expect((await auditOf(t, 'promotion.coupon.create')).find((a) => a.after.code === 'ONCE10')!.after.per_user_limit).toBe(1);
    expect((await create(base({ code: 'NOLIM10' }))).body.per_user_limit).toBeNull();
    expect((await create(base({ code: 'NULLIM10', per_user_limit: null }))).body.per_user_limit).toBeNull();
    expect((await create(base({ code: 'MAXLIM10', per_user_limit: 1_000_000 }))).status).toBe(201);
    expect((await create(base({ code: 'WIDE10', usage_limit: 5, per_user_limit: 10 }))).status).toBe(201); // không bắt buộc nhỏ hơn usage_limit
    const before = await countOf(t, 'coupons');
    for (const v of [0, -1, 2.5, 1_000_001, 'abc']) {
      const r = await create(base({ code: 'BADLIM', per_user_limit: v }));
      expect([String(v), r.status, r.body.errors.map((e: any) => e.field)]).toEqual([String(v), 400, ['per_user_limit']]);
    }
    expect(await countOf(t, 'coupons')).toBe(before);
    await expect(q(t, `INSERT INTO coupons (code, type, value, expires_at, usage_limit, per_user_limit, created_by) VALUES ('RAWLIM', 'fixed', 5, now() + interval '1 day', 5, 0, gen_random_uuid())`)).rejects.toThrow(/check constraint/);
  });

  it('PRM-TC-20261006-101036592 (bổ sung SB-11): chuỗi JSON chứa nửa cặp thay thế lẻ, NUL và ký tự điều khiển ở mọi trường chữ là 400, không phải 500; thân không phải JSON object hay trường lạ cũng 400', async () => {
    for (const raw of ['{"code":"\\ud800","type":"fixed","value":5,"expires_at":"2099-01-01T00:00:00Z","usage_limit":1}', '{"code":"AB\\u0000CD","type":"fixed","value":5,"expires_at":"2099-01-01T00:00:00Z","usage_limit":1}',
      '{"code":"ABCD","type":"fi\\ud800xed","value":5,"expires_at":"2099-01-01T00:00:00Z","usage_limit":1}', '{"code":"ABCD","type":"fixed","value":5,"expires_at":"20\\ud80099","usage_limit":1}']) {
      expect([raw, (await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body: raw })).status]).toEqual([raw, 400]);
    }
    for (const body of ['[]', '"x"', 'null', '{"code":"ABCD"']) expect([body, (await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body })).status]).toEqual([body, 400]);
    expect(await countOf(t, 'coupons')).toBe(0);
  });

  it('PRM-TC-20261006-101036662 (bổ sung SB-13): thiếu hoặc lạ Origin khi có cookie phiên là 403 csrf_failed, không tạo gì; Content-Type khác application/json là 415', async () => {
    const body = base({ code: 'CSRF1' });
    expect((await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body, origin: null })).body.type).toBe('urn:ecom:error:csrf_failed');
    expect((await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(t, 'post', '/admin/coupons', { cookie: admin.cookie, body: JSON.stringify(body), contentType: 'text/plain' })).status).toBe(415);
    expect(await countOf(t, 'coupons')).toBe(0);
  });
});
