import { randomUUID } from 'node:crypto';
import { call } from '../support/usr';
import { count, createNtfApp, emit, mkUser, notesOf, q, seedMail, seedNote, truncateAll, type NtfApp } from '../support/ntf';
import { race } from '../support/ord';

// Đọc và đánh dấu thông báo của chính mình (NTF-REQ-20261006-103209256, -103209345): PostgreSQL thật, phiên thật của AUTH, đồng hồ giả cho giới hạn tần suất.
const MIN = 60_000;
const NIL = '00000000-0000-4000-8000-000000000000';
describe('NTF API đọc và đánh dấu đã đọc', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); jest.restoreAllMocks(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); alignWindow(); });
  /** Đồng hồ về giây thứ 1 của cửa sổ cố định kế tiếp: N lần gọi nằm trọn một cửa sổ (bộ đếm tần suất dùng cửa sổ cố định). */
  const alignWindow = (seconds = 60): void => t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / (seconds * 1000)) * seconds * 1000 + 1000));
  /** `n` thông báo tạo cách nhau 1 phút, mới nhất ở cuối, trong 30 ngày gần đây. */
  const seedMany = async (userId: string, n: number, status: (i: number) => 'unread' | 'read', o: { type?: (i: number) => string } = {}) => {
    const base = Date.now() - n * MIN - 3600_000, ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await seedNote(t, userId, { status: status(i), at: new Date(base + i * MIN), type: o.type?.(i), title: `Tiêu đề ${i}` }));
    return ids;
  };

  // ---- NTF-REQ-20261006-103209256
  it('NTF-TC-20261006-104301925: đếm chưa đọc rồi đánh dấu một thông báo đã đọc; dòng email_deliveries không được tính', async () => {
    const u1 = await mkUser(t);
    const [n1, n2, n3] = await seedMany(u1.id, 3, () => 'unread');
    await seedMail(t, u1.id);
    const c1 = await call(t, 'get', '/notifications/unread-count', { cookie: u1.cookie });
    expect([c1.status, c1.body]).toEqual([200, { unread_count: 3 }]);
    const r = await call(t, 'post', `/notifications/${n1}/read`, { cookie: u1.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ notification: { id: n1, status: 'read' }, unread_count: 2 });
    expect(r.body.notification.read_at).not.toBeNull();
    expect((await call(t, 'get', '/notifications/unread-count', { cookie: u1.cookie })).body).toEqual({ unread_count: 2 });
    const rows = await q<{ id: string; status: string; read_at: Date | null }>(t, `SELECT id, status::text AS status, read_at FROM notifications WHERE user_id = '${u1.id}'`);
    expect(Object.fromEntries(rows.map((x) => [x.id, [x.status, x.read_at !== null]]))).toEqual({ [n1]: ['read', true], [n2]: ['unread', false], [n3]: ['unread', false] });
  });

  it('NTF-TC-20261006-104302026: đánh dấu tất cả đã đọc không body; chỉ thông báo của người gọi', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    await seedMany(u1.id, 5, () => 'unread'); await seedNote(t, u1.id, { status: 'read' }); await seedNote(t, u1.id, { status: 'read' });
    await seedMany(u2.id, 4, () => 'unread');
    const r = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie });
    expect([r.status, r.body]).toEqual([200, { updated: 5, unread_count: 0 }]);
    expect(await count(t, 'notifications', `user_id = '${u1.id}' AND status = 'read'`)).toBe(7);
    expect(await count(t, 'notifications', `user_id = '${u2.id}' AND status = 'unread'`)).toBe(4);
  });

  it('NTF-TC-20261006-104302157 (T1, SB-06): đánh dấu thông báo của người khác, id không tồn tại, id sai dạng đều 404 cùng nội dung và cùng một dãy câu SQL (REV-NTF-11); thông báo của người khác vẫn unread', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    const [nX] = await seedMany(u2.id, 1, () => 'unread');
    const rs = [await call(t, 'post', `/notifications/${nX}/read`, { cookie: u1.cookie }), await call(t, 'post', `/notifications/${NIL}/read`, { cookie: u1.cookie }), await call(t, 'post', '/notifications/abc/read', { cookie: u1.cookie })];
    for (const r of rs) {
      expect(r.status).toBe(404);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    }
    const strip = (r: (typeof rs)[number]) => JSON.stringify({ ...r.body, trace_id: undefined });
    expect(new Set(rs.map(strip)).size).toBe(1);
    expect(new Set(rs.map((r) => r.text.length)).size).toBe(1);
    expect(rs[0].body).toMatchObject({ type: 'urn:ecom:error:not-found', status: 404 });
    expect(await q(t, `SELECT status::text AS s, read_at FROM notifications WHERE id = '${nX}'`)).toEqual([{ s: 'unread', read_at: null }]);
    // REV-NTF-11: cùng dãy câu SQL (không còn ngưỡng thời gian): ghi văn bản và thứ tự mọi lời gọi truy vấn của ứng dụng cho từng nhánh 404; ba nhánh chạy ĐÚNG cùng một dãy nên không nhánh nào làm ít việc hơn
    const textOf = (a: unknown): string => (Array.isArray(a) ? a.join('?') : typeof a === 'string' ? a : String((a as { sql?: string; strings?: string[] }).sql ?? (a as { strings?: string[] }).strings?.join('?')));
    const trace = async (id: string): Promise<string[]> => {
      const seen: string[] = [];
      for (const m of ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'] as const) {
        const orig = (t.prisma as any)[m].bind(t.prisma);
        jest.spyOn(t.prisma as any, m).mockImplementation((...a: unknown[]) => { seen.push(`${m}: ${textOf(a[0]).replace(/\s+/g, ' ').trim()}`); return orig(...a); });
      }
      const r = await call(t, 'post', `/notifications/${id}/read`, { cookie: u1.cookie });
      jest.restoreAllMocks();
      expect(r.status).toBe(404);
      return seen;
    };
    await trace(NIL); // lượt khởi động (làm nóng phiên); không so
    const [other, none, bad] = [await trace(nX), await trace(NIL), await trace('abc')];
    expect(other.length).toBeGreaterThanOrEqual(2);
    expect(other.some((x) => /UPDATE notifications/.test(x)) && other.some((x) => /SELECT .* FROM notifications/.test(x))).toBe(true);
    expect(none).toEqual(other);
    expect(bad).toEqual(other);
  }, 60_000);

  it('NTF-TC-20261006-104302228: không có phiên (hoặc phiên đã thu hồi) bị 401 problem+json kèm trace_id ở cả hai endpoint; dữ liệu không đổi', async () => {
    const u1 = await mkUser(t);
    await seedMany(u1.id, 2, () => 'unread');
    const sid = u1.cookie.slice('sid='.length);
    await q(t, `UPDATE sessions SET status = 'revoked', revoked_at = now(), revoked_reason = 'logout' WHERE token_hash IS NOT NULL`);
    for (const cookie of [undefined, u1.cookie, `sid=${sid.slice(0, -1)}x`]) {
      for (const [m, p] of [['get', '/notifications/unread-count'], ['post', '/notifications/read-all']] as const) {
        const r = await call(t, m, p, { cookie });
        expect([m, p, r.status]).toEqual([m, p, 401]);
        expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
        expect(r.body.trace_id).toBeTruthy();
      }
    }
    expect(await count(t, 'notifications', `status = 'read'`)).toBe(0);
  });

  it('NTF-TC-20261006-104302303 (T13, SB-13): read-all từ Origin lạ, thiếu Origin hoặc Content-Type sai bị từ chối theo cơ chế CSRF của platform; từ Origin cho phép thì 200', async () => {
    const u1 = await mkUser(t);
    await seedMany(u1.id, 3, () => 'unread');
    const a = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, origin: 'https://evil.test' });
    const b = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, origin: null });
    const c = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: '{}', contentType: 'text/plain' });
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(a.body).toMatchObject({ type: 'urn:ecom:error:csrf_failed' });
    expect([403, 415]).toContain(c.status);
    expect(await count(t, 'notifications', `status = 'unread'`)).toBe(3);
    expect((await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: {} })).status).toBe(200);
    // đánh dấu một thông báo cũng đòi Origin hợp lệ
    const [n] = await seedMany(u1.id, 1, () => 'unread');
    expect((await call(t, 'post', `/notifications/${n}/read`, { cookie: u1.cookie, origin: 'https://evil.test' })).status).toBe(403);
    expect(await count(t, 'notifications', `id = '${n}' AND status = 'unread'`)).toBe(1);
  });

  it('NTF-TC-20261006-104302379 (SB-11): up_to sai dạng (hôm qua, 2026-13-45, thiếu múi giờ, ngày không có thật) hoặc trường lạ user_id bị 400; không thông báo nào đổi', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    await seedMany(u1.id, 3, () => 'unread');
    for (const body of [{ up_to: 'hôm qua' }, { up_to: '2026-13-45' }, { up_to: '2026-10-06T09:05:00' }, { up_to: '2026-02-31T00:00:00Z' }, { up_to: 5 }, { up_to: null }, { user_id: u2.id }, { up_to: new Date().toISOString(), channel: 'email' }, JSON.parse('{"__proto__": {"x": 1}}')]) { // fixed-clock: ví dụ của TC (dạng và biên của up_to), không so với đồng hồ nào
      const r = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body });
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    }
    const raw = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: '{"__proto__":{"user_id":"x"},"up_to":"2026-10-06T09:05:00Z"}' }); // fixed-clock: ví dụ của TC (dạng và biên của up_to), không so với đồng hồ nào
    expect(raw.status).toBe(400);
    expect(await count(t, 'notifications', `status = 'read'`)).toBe(0);
  });

  it('NTF-TC-20261006-104302461: đánh dấu lại thông báo đã đọc trả 200, giữ nguyên read_at và unread_count', async () => {
    const u1 = await mkUser(t);
    const read9 = new Date(Date.now() - 3600_000);
    const n1 = await seedNote(t, u1.id, { status: 'read', readAt: read9, at: new Date(Date.now() - 7200_000) });
    await seedNote(t, u1.id);
    const r = await call(t, 'post', `/notifications/${n1}/read`, { cookie: u1.cookie });
    expect(r.status).toBe(200);
    expect(new Date(r.body.notification.read_at).getTime()).toBe(read9.getTime());
    expect(r.body.unread_count).toBe(1);
    expect((await q<{ read_at: Date }>(t, `SELECT read_at FROM notifications WHERE id = '${n1}'`))[0].read_at.getTime()).toBe(read9.getTime());
  });

  it('NTF-TC-20261006-104302542: read-all với up_to chỉ đổi thông báo tạo trước mốc (kể cả đúng bằng mốc); up_to ở tương lai bị kẹp về lúc nhận yêu cầu', async () => {
    const u1 = await mkUser(t);
    const base = Date.now() - 3600_000;
    const early = [0, 1, 2].map((i) => new Date(base + i * 1000));
    for (const at of early) await seedNote(t, u1.id, { at });
    const late = await seedNote(t, u1.id, { at: new Date(base + 10 * MIN) });
    const r1 = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: { up_to: new Date(base + 5 * MIN).toISOString() } });
    expect([r1.status, r1.body]).toEqual([200, { updated: 3, unread_count: 1 }]);
    expect(await count(t, 'notifications', `id = '${late}' AND status = 'unread'`)).toBe(1);
    const ahead = await seedNote(t, u1.id, { at: new Date(Date.now() + 86_400_000) }); // tạo SAU lúc nhận yêu cầu (đồng hồ CSDL lệch tương lai): up_to bị kẹp nên vẫn chưa đọc
    const r2 = await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: { up_to: new Date(Date.now() + 365 * 86_400_000).toISOString() } });
    expect(r2.body).toEqual({ updated: 1, unread_count: 1 });
    expect(await count(t, 'notifications', `id = '${ahead}' AND status = 'unread'`)).toBe(1);
    await q(t, `DELETE FROM notifications WHERE id = '${ahead}'`);
    // biên: created_at đúng bằng up_to cũng được đổi
    const at = new Date(Date.now() - 1800_000);
    const edge = await seedNote(t, u1.id, { at });
    expect((await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: { up_to: at.toISOString() } })).body.updated).toBe(1);
    expect(await count(t, 'notifications', `id = '${edge}' AND status = 'read'`)).toBe(1);
    // năm 0000 và 1900 là hợp lệ về dạng nhưng trước mọi thông báo: không lỗi 500, không đổi gì
    const fresh = await seedNote(t, u1.id);
    for (const up_to of ['0000-01-01T00:00:00Z', '1900-01-01T00:00:00+07:00']) expect((await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie, body: { up_to } })).body).toEqual({ updated: 0, unread_count: 1 }); // fixed-clock: ví dụ của TC (dạng và biên của up_to), không so với đồng hồ nào
    expect(fresh).toBeTruthy();
  });

  it('NTF-TC-20261006-104302615: hai yêu cầu đánh dấu đồng thời cùng một thông báo (20 vòng) đều 200; read_at là của yêu cầu thắng, không bị ghi đè', async () => {
    const u1 = await mkUser(t);
    for (let i = 0; i < 20; i++) {
      const [n] = await seedMany(u1.id, 1, () => 'unread');
      const [a, b] = await race(() => call(t, 'post', `/notifications/${n}/read`, { cookie: u1.cookie }), () => call(t, 'post', `/notifications/${n}/read`, { cookie: u1.cookie }));
      expect([a.status, b.status]).toEqual([200, 200]);
      const stored = (await q<{ read_at: Date; updated_at: Date }>(t, `SELECT read_at, updated_at FROM notifications WHERE id = '${n}'`))[0];
      const seen = [a.body.notification.read_at, b.body.notification.read_at];
      expect(seen.every((x: string) => new Date(x).getTime() === stored.read_at.getTime())).toBe(true); // cả hai phản hồi nêu cùng một read_at: của yêu cầu thắng
      expect(a.body.notification.status).toBe('read');
      if (i % 5 === 0) alignWindow(); // 20 vòng gồm 40 yêu cầu trong cửa sổ 120/phút
    }
  }, 60_000);

  it('NTF-TC-20261006-104302702: số chưa đọc đúng 100 (số thật, không cắt ở 99); read-all khi không còn gì trả updated 0; người không có thông báo cũng 200', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    await q(t, `INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key, created_at) SELECT '${u1.id}', 'order_created', 't', 'b', gen_random_uuid(), 'k' || g, now() - (g || ' minutes')::interval FROM generate_series(1, 100) g`);
    expect((await call(t, 'get', '/notifications/unread-count', { cookie: u1.cookie })).body).toEqual({ unread_count: 100 });
    expect((await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie })).body).toEqual({ updated: 100, unread_count: 0 });
    expect((await call(t, 'post', '/notifications/read-all', { cookie: u1.cookie })).body).toEqual({ updated: 0, unread_count: 0 });
    expect((await call(t, 'post', '/notifications/read-all', { cookie: u2.cookie })).body).toEqual({ updated: 0, unread_count: 0 });
  });

  // ---- NTF-REQ-20261006-103209345
  it('NTF-TC-20261006-104302787: trang đầu của 25 thông báo mới nhất trước; không user_id, event_id, data, trạng thái email; email_deliveries không được tính', async () => {
    const u1 = await mkUser(t);
    const ids = await seedMany(u1.id, 25, (i) => (i >= 15 ? 'unread' : 'read')); // 10 unread (mới nhất), 15 read
    for (let i = 0; i < 5; i++) await seedMail(t, u1.id);
    const r = await call(t, 'get', '/notifications', { cookie: u1.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, limit: 20, total: 25, unread_count: 10 });
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual([...ids].reverse().slice(0, 20));
    for (const item of r.body.items) expect(Object.keys(item).sort()).toEqual(['body', 'created_at', 'id', 'link', 'read_at', 'status', 'title', 'type']);
    expect(Object.keys(r.body).sort()).toEqual(['items', 'limit', 'page', 'total', 'unread_count']);
  });

  it('NTF-TC-20261006-104302866: lọc chưa đọc trang 2 với limit 5; total theo bộ lọc, unread_count toàn bộ; lọc theo type', async () => {
    const u1 = await mkUser(t);
    const ids = await seedMany(u1.id, 25, (i) => (i >= 15 ? 'unread' : 'read'), { type: (i) => (i % 5 === 0 ? 'order_shipped' : 'order_created') });
    const r = await call(t, 'get', '/notifications?status=unread&limit=5&page=2', { cookie: u1.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 2, limit: 5, total: 10, unread_count: 10 });
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual(ids.slice(15).reverse().slice(5, 10));
    expect(r.body.items.every((x: { status: string }) => x.status === 'unread')).toBe(true);
    const typed = await call(t, 'get', '/notifications?type=order_shipped', { cookie: u1.cookie });
    expect(typed.body).toMatchObject({ total: 5, unread_count: 10 });
    expect(typed.body.items.every((x: { type: string }) => x.type === 'order_shipped')).toBe(true);
    const both = await call(t, 'get', '/notifications?type=order_shipped&status=read&limit=100', { cookie: u1.cookie });
    expect(both.body.total).toBe(3); // thứ tự 0, 5, 10 là read; 15 và 20 là unread
  });

  it('NTF-TC-20261006-104302943 (SB-11, T12): limit 101, 0, page 0, status archived, type foo bị 400 problem+json nêu đúng tham số; limit 100 và type order_expired hợp lệ', async () => {
    const u1 = await mkUser(t);
    await seedMany(u1.id, 2, () => 'unread');
    for (const [qs, field] of [['limit=101', 'limit'], ['limit=0', 'limit'], ['page=0', 'page'], ['status=archived', 'status'], ['type=foo', 'type'], ['limit=abc', 'limit'], ['page=-1', 'page']] as const) {
      const r = await call(t, 'get', `/notifications?${qs}`, { cookie: u1.cookie });
      expect([qs, r.status]).toEqual([qs, 400]);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
      expect(r.body.trace_id).toBeTruthy();
      expect(r.body.items).toBeUndefined();
    }
    expect((await call(t, 'get', '/notifications?limit=100', { cookie: u1.cookie })).status).toBe(200);
    expect((await call(t, 'get', '/notifications?type=order_expired', { cookie: u1.cookie })).status).toBe(200);
  });

  it('NTF-TC-20261006-104303037 (T1): không phiên bị 401; user_id hay channel làm tham số bị 400, không lộ thông báo hay email của người khác; admin cũng chỉ thấy của mình', async () => {
    const [u1, u2, adm] = [await mkUser(t), await mkUser(t), await mkUser(t, { role: 'admin' })];
    await seedMany(u2.id, 3, () => 'unread'); await seedMail(t, u2.id);
    await seedNote(t, adm.id, { title: 'Của admin' });
    const anon = await call(t, 'get', '/notifications');
    expect([anon.status, anon.body.items]).toEqual([401, undefined]);
    for (const qs of [`user_id=${u2.id}`, 'channel=email']) {
      const r = await call(t, 'get', `/notifications?${qs}`, { cookie: u1.cookie });
      expect([qs, r.status]).toEqual([qs, 400]);
      expect(r.text).not.toContain('Tiêu đề');
    }
    const asAdmin = await call(t, 'get', `/notifications?user_id=${u2.id}`, { cookie: adm.cookie });
    expect(asAdmin.status).toBe(400);
    expect((await call(t, 'get', '/notifications', { cookie: adm.cookie })).body.items.map((x: { title: string }) => x.title)).toEqual(['Của admin']);
  });

  it('NTF-TC-20261006-104303133 (SB-14 bậc C, T12): yêu cầu thứ 121 trong một phút nhận 429 kèm Retry-After dương (chung bộ đếm bốn endpoint); người khác vẫn 200; sau cửa sổ lại 200', async () => {
    const [u1, u2] = [await mkUser(t), await mkUser(t)];
    alignWindow();
    const calls: [('get' | 'post'), string][] = [['get', '/notifications'], ['get', '/notifications/unread-count'], ['post', '/notifications/read-all'], ['post', `/notifications/${NIL}/read`]];
    for (let i = 0; i < 120; i++) expect([200, 404]).toContain((await call(t, calls[i % 4][0], calls[i % 4][1], { cookie: u1.cookie })).status);
    const limited = await call(t, 'get', '/notifications', { cookie: u1.cookie });
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(limited.body).toMatchObject({ type: 'urn:ecom:error:rate-limited' });
    const retry = Number(limited.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect((await call(t, 'get', '/notifications', { cookie: u2.cookie })).status).toBe(200);
    t.clock.advance(61_000);
    expect((await call(t, 'get', '/notifications', { cookie: u1.cookie })).status).toBe(200);
  }, 120_000);

  it('NTF-TC-20261006-104303212 (BR4, BR6): thông báo quá 180 ngày không xuất hiện kể cả khi job dọn chưa chạy; trang vượt cuối rỗng với total đúng', async () => {
    const u1 = await mkUser(t);
    const DAY = 86_400_000;
    for (let i = 0; i < 25; i++) await seedNote(t, u1.id, { at: new Date(Date.now() - (5 + i) * DAY) }); // 25 thông báo cách đây 5 đến 29 ngày, đều trong 180 ngày
    await seedNote(t, u1.id, { at: new Date(Date.now() - 181 * DAY), title: 'cũ' });
    const nNew = await seedNote(t, u1.id, { at: new Date(Date.now() - 179 * DAY), title: 'mới' });
    const r1 = await call(t, 'get', '/notifications?page=3&limit=20', { cookie: u1.cookie });
    expect([r1.status, r1.body.items, r1.body.total]).toEqual([200, [], 26]);
    const r2 = await call(t, 'get', '/notifications?limit=100', { cookie: u1.cookie });
    expect(r2.body.items).toHaveLength(26);
    expect(r2.body.items.map((x: { title: string }) => x.title)).not.toContain('cũ');
    expect(r2.body.items.at(-1).id).toBe(nNew); // n_new là phần tử cuối theo thứ tự mới nhất trước (cũ nhất trong 180 ngày)
    expect(r2.body.unread_count).toBe(26); // số chưa đọc cũng chỉ đếm trong thời hạn lưu
    expect(await call(t, 'post', `/notifications/${(await q<{ id: string }>(t, `SELECT id FROM notifications WHERE title = 'cũ'`))[0].id}/read`, { cookie: u1.cookie }).then((r) => r.status)).toBe(404);
    // thứ tự ổn định khi trùng created_at (id giảm dần)
    const same = new Date(Date.now() - MIN);
    const [x, y] = [await seedNote(t, u1.id, { at: same }), await seedNote(t, u1.id, { at: same })];
    const r3 = await call(t, 'get', '/notifications?limit=2', { cookie: u1.cookie });
    expect(r3.body.items.map((i: { id: string }) => i.id)).toEqual([x, y].sort().reverse());
    expect((await call(t, 'get', '/notifications?limit=2', { cookie: u1.cookie })).body.items.map((i: { id: string }) => i.id)).toEqual(r3.body.items.map((i: { id: string }) => i.id));
  });

  it('NTF-TC-20261006-104303290 (T10): customer không bao giờ thấy low_stock hay refund_failed (total không đếm, lọc type cũng rỗng); staff có low_stock không có refund_failed; admin có cả hai', async () => {
    const [c1, s1, a1] = [await mkUser(t), await mkUser(t, { role: 'staff' }), await mkUser(t, { role: 'admin' })];
    await emit(t, 'LowStockDetected', { product_id: randomUUID(), product_name: 'Áo', on_hand: 1, available: 1, threshold: 5 });
    await emit(t, 'RefundFailed', { refund_id: randomUUID(), payment_id: randomUUID(), order_id: randomUUID(), order_code: '7K3M9Q2XH4TB', user_id: c1.id, amount: 1, reason: 'order_cancelled', failure_reason: 'x' });
    const types = async (u: { cookie: string }) => (await call(t, 'get', '/notifications?limit=100', { cookie: u.cookie })).body;
    const [bc, bs, ba] = [await types(c1), await types(s1), await types(a1)];
    expect([bc.items, bc.total]).toEqual([[], 0]);
    expect(bs.items.map((i: { type: string }) => i.type)).toEqual(['low_stock']);
    expect(ba.items.map((i: { type: string }) => i.type).sort()).toEqual(['low_stock', 'refund_failed']);
    const filtered = await call(t, 'get', '/notifications?type=low_stock', { cookie: c1.cookie });
    expect([filtered.status, filtered.body.items, filtered.body.total]).toEqual([200, [], 0]);
    expect((await notesOf(t, c1.id)).length).toBe(0);
  });
});
