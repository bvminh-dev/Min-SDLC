import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AuthApi } from '../../src/modules/auth';
import { CatalogApi } from '../../src/modules/catalog';
import { OrderApi } from '../../src/modules/order';
import { OBJECT_STORAGE } from '../../src/modules/platform';
import { OBJECT_SWEEP_MAX } from '../../src/modules/review/config';
import { testDbUrl, truncateAll } from '../support/db';
import {
  call, createReview, createRevApp, deleteReview, eligible, freshClock, imageRows, moderate, revCount, seedImageRow, seedProduct, seedReview, world, type RevApp, type World,
} from '../support/rev';

// Hai job dọn ảnh của REV (REV-DB mục 8), các bậc giới hạn tần suất của REV-DB mục 10 và lỗi 503 khi module khác không trả lời (REV-API, mã `service-unavailable`). PostgreSQL thật, kho S3 giả trong tiến trình.
const SEC = 'REV-SEC-20261006-103618395';
const H = 3600_000;
const IMAGES_JOB = 'rev.sweep-orphan-images';
const OBJECTS_JOB = 'rev.sweep-orphan-objects';
const textOf = (a: unknown): string => (Array.isArray(a) ? a.join('?') : String((a as { sql?: string }).sql ?? ''));
const newKey = (): string => `reviews/${randomUUID()}.webp`;

describe('REV hai job dọn ảnh (REV-REQ-20261006-103135207 BR8, REV-DB mục 8)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const seedObject = (key: string, ageMs: number): void => t.fake.seed(key, Buffer.from('x'), new Date(t.clock.now().getTime() - ageMs));

  it(`REV-TC-20261013-223014474 ${SEC} T9 (SB-34): ${IMAGES_JOB} chạy một bản duy nhất nhờ khóa advisory, xóa object trước rồi dòng, giới hạn lô 100, hạn thời gian, idempotent`, async () => {
    const reg = (t.jobs as any).jobs as Map<string, { every: number }>;
    expect(reg.get(IMAGES_JOB)?.every).toBe(3_600_000);
    const old = [];
    for (let i = 0; i < 250; i++) old.push(await seedImageRow(t, w.a.id, null, null, 25 * H));
    const young = await seedImageRow(t, w.a.id, null, null, 23 * H);
    const review = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published' });
    const kept = await seedImageRow(t, w.b.id, review, 1, 40 * H); // ảnh ĐANG gắn: quá 24 giờ tuổi nhưng không bao giờ bị dọn

    // một bản duy nhất trên cụm: kết nối khác (instance thứ hai) đang giữ khóa advisory của job thì lượt này `skipped`, không đụng gì
    const other = new Client({ connectionString: testDbUrl() });
    await other.connect();
    try {
      await other.query('SELECT pg_advisory_lock(hashtext($1))', [IMAGES_JOB]);
      expect(await t.jobs.runOnce(IMAGES_JOB)).toBe('skipped');
      expect([await imageRows(t).then((r) => r.length), t.fake.keys('reviews/').length]).toEqual([252, 252]);
      await other.query('SELECT pg_advisory_unlock(hashtext($1))', [IMAGES_JOB]);
    } finally { await other.end(); }

    // giới hạn lô: mỗi câu chọn lấy tối đa 100 dòng; xóa object TRƯỚC (dòng của ảnh còn nguyên lúc object bị xóa), rồi mới xóa dòng
    const sizes: number[] = [];
    const origQuery = t.prisma.$queryRaw.bind(t.prisma);
    jest.spyOn(t.prisma as any, '$queryRaw').mockImplementation(async (...a: unknown[]) => {
      const r = await (origQuery as any)(...a);
      if (/FROM review_images\s+WHERE review_id IS NULL AND COALESCE/.test(textOf(a[0]))) sizes.push((r as unknown[]).length);
      return r;
    });
    const storage = t.app.get(OBJECT_STORAGE);
    const del = storage.delete.bind(storage);
    const rowsAtDelete: number[] = [];
    jest.spyOn(storage, 'delete').mockImplementation(async (...args: unknown[]) => {
      const key = String(args[0]);
      rowsAtDelete.push((await imageRows(t, `storage_key = '${key}'`)).length);
      await del(key);
    });
    expect(await t.jobs.runOnce(IMAGES_JOB)).toBe('ran');
    jest.restoreAllMocks();
    expect(sizes.filter((n) => n > 0)).toEqual([100, 100, 50]);
    expect(rowsAtDelete).toHaveLength(250);
    expect(rowsAtDelete.every((n) => n === 1)).toBe(true); // lúc xóa object, dòng còn đó: object trước, dòng sau
    expect((await imageRows(t)).map((r) => r.id).sort()).toEqual([young.id, kept.id].sort());
    expect(t.fake.keys('reviews/').sort()).toEqual([young.key, kept.key].sort());
    expect(old.length).toBe(250);

    // kho lỗi khi xóa object: dòng giữ cho lượt sau (không có dòng nào mất mà object còn), job báo lỗi; lượt sau xóa nốt
    const stuck = await seedImageRow(t, w.a.id, null, null, 30 * H);
    t.fake.failDelete = 500;
    await expect(t.images.sweep()).rejects.toThrow(/không xóa được/);
    expect(await imageRows(t, `id = '${stuck.id}'`)).toHaveLength(1);
    expect(t.fake.keys('reviews/')).toContain(stuck.key);
    t.fake.failDelete = null;

    // hạn thời gian: xóa chậm và hạn 1 ms thì lượt dừng sau lô đang làm, phần còn lại để lượt sau
    for (let i = 0; i < 25; i++) await seedImageRow(t, w.a.id, null, null, 30 * H);
    jest.spyOn(storage, 'delete').mockImplementation(async (...args: unknown[]) => { await new Promise((r) => setTimeout(r, 5)); await del(String(args[0])); });
    const first = await t.images.sweep({ batch: 10, budgetMs: 1 });
    jest.restoreAllMocks();
    expect(first).toEqual({ removed: 10, failed: 0 });
    expect(await imageRows(t, 'review_id IS NULL AND created_at < now() - interval \'24 hours\'')).toHaveLength(16);
    expect((await t.images.sweep()).removed).toBe(16);

    // idempotent: không còn gì quá hạn thì không lỗi, không đổi gì
    const before = [(await imageRows(t)).length, t.fake.keys('reviews/').length];
    expect(await t.images.sweep()).toEqual({ removed: 0, failed: 0 });
    expect(await t.jobs.runOnce(IMAGES_JOB)).toBe('ran');
    expect([(await imageRows(t)).length, t.fake.keys('reviews/').length]).toEqual(before);
  }, 180_000);

  it(`REV-TC-20261013-223014571 ${SEC} T9 (SB-34, REV-REV-16): ${OBJECTS_JOB} xóa object ở kho không có dòng quá 24 giờ, trần 500 mỗi lượt, đóng khi không chắc, không phụ thuộc URL công khai`, async () => {
    const reg = (t.jobs as any).jobs as Map<string, { every: number }>;
    expect(reg.get(OBJECTS_JOB)?.every).toBe(3_600_000);
    const o1 = newKey(), o2 = newKey();
    seedObject(o1, 25 * H); // tiến trình chết giữa ghi kho và INSERT
    seedObject(o2, 23 * H); // chưa quá 24 giờ: có thể đang được tải lên
    const review = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published' });
    const o3 = await seedImageRow(t, w.a.id, review, 1, 40 * H); // đang gắn
    const o4 = await seedImageRow(t, w.b.id, null, null, 40 * H); // có dòng chưa gắn: việc của job ảnh, không phải job này
    seedObject('reviews/note.txt', 40 * H); // không đúng dạng khóa của REV
    seedObject('products/x.webp', 40 * H); // ngoài tiền tố
    expect(await t.images.sweepObjects()).toEqual({ removed: 1, failed: 0 });
    expect(t.fake.keys('reviews/').sort()).toEqual([o2, o3.key, o4.key, 'reviews/note.txt'].sort());
    expect(t.fake.keys('products/')).toContain('products/x.webp'); // ngoài tiền tố: không đụng
    seedObject(newKey(), 30 * H);
    expect(await t.jobs.runOnce(OBJECTS_JOB)).toBe('ran'); // qua JobRunner

    // đổi URL công khai hay không ánh xạ được khóa từ URL: tham chiếu là `storage_key` nên ảnh đang dùng không bị coi là mồ côi
    const storage = t.app.get(OBJECT_STORAGE);
    jest.spyOn(storage, 'urlFor').mockImplementation((...a: unknown[]) => `https://cdn-moi.example/${String(a[0])}`);
    jest.spyOn(storage, 'keyOf').mockImplementation(() => null);
    seedObject(newKey(), 30 * H);
    expect((await t.images.sweepObjects()).removed).toBe(1);
    jest.restoreAllMocks();
    expect(t.fake.keys('reviews/')).toEqual(expect.arrayContaining([o3.key, o4.key]));

    // một object lỗi không chặn các object còn lại; job báo lỗi sau lượt, lượt sau xóa nốt
    const bad = [newKey(), newKey(), newKey()];
    for (const k of bad) seedObject(k, 30 * H);
    const del = storage.delete.bind(storage);
    let calls = 0;
    jest.spyOn(storage, 'delete').mockImplementation(async (...args: unknown[]) => { if (++calls === 1) throw new Error('kho lỗi'); await del(String(args[0])); });
    await expect(t.images.sweepObjects()).rejects.toThrow(/1 object không xóa được/);
    jest.restoreAllMocks();
    expect(t.fake.keys('reviews/').filter((k) => bad.includes(k))).toHaveLength(1);
    expect((await t.images.sweepObjects()).removed).toBe(1);

    // trần 500 mỗi lượt (giới hạn lô): 600 object quá hạn cần ba lượt
    for (let i = 0; i < 600; i++) seedObject(newKey(), 26 * H);
    expect(OBJECT_SWEEP_MAX).toBe(500);
    expect((await t.images.sweepObjects()).removed).toBe(500);
    expect((await t.images.sweepObjects()).removed).toBe(100);
    expect(await t.images.sweepObjects()).toEqual({ removed: 0, failed: 0 }); // idempotent
    expect(t.fake.keys('reviews/')).toEqual(expect.arrayContaining([o3.key, o4.key, o2]));
  }, 180_000);

  it(`REV-TC-20261013-223014571 ${SEC} T9 (SB-34): ${OBJECTS_JOB} đóng khi không chắc: bảng review_images rỗng hay không khóa nào có trong kho thì không xóa object nào và báo lỗi`, async () => {
    for (let i = 0; i < 3; i++) seedObject(newKey(), 30 * H);
    const keys = t.fake.keys('reviews/');
    await expect(t.images.sweepObjects()).rejects.toThrow(/bảng review_images rỗng/); // sai CSDL: không có tham chiếu nào
    expect(t.fake.keys('reviews/')).toEqual(keys);
    expect(await t.jobs.runOnce(OBJECTS_JOB)).toBe('failed');
    const noObject = await seedImageRow(t, w.a.id, null, null, 40 * H, { noObject: true }); // có dòng nhưng object không có trong kho: nghi sai bucket hay endpoint
    expect(noObject.key).toBeTruthy();
    await expect(t.images.sweepObjects()).rejects.toThrow(/không khóa nào của review_images có trong kho/);
    expect(t.fake.keys('reviews/')).toEqual(keys);
    const present = await seedImageRow(t, w.b.id, null, null, 40 * H); // một khóa có thật trong kho: nguồn tham chiếu khớp kho, các object khác là mồ côi thật
    expect((await t.images.sweepObjects()).removed).toBe(3);
    expect(t.fake.keys('reviews/')).toEqual([present.key]);
  });
});

describe('REV bậc giới hạn tần suất và lỗi 503 (REV-DB mục 10, REV-API)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });

  it(`REV-TC-20261013-223014665 ${SEC} T6 (SB-14): xóa đánh giá bậc B 30 lần mỗi giờ mỗi người: lần thứ 31 bị 429, người khác không bị ảnh hưởng, cửa sổ mới thì qua`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < 31; i++) { const p = await seedProduct(t, { category: w.cat }); ids.push(await seedReview(t, { user: w.a.id, product: p, status: 'published' })); }
    const mine = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published' });
    const codes: number[] = [];
    for (let i = 0; i < 30; i++) codes.push((await deleteReview(t, w.a.cookie, ids[i])).status);
    expect(codes).toEqual(Array(30).fill(204));
    const over = await deleteReview(t, w.a.cookie, ids[30]);
    expect(over.status).toBe(429);
    const ra = Number(over.headers['retry-after']);
    expect([ra > 0, ra <= 3600]).toEqual([true, true]);
    expect(await revCount(t, `id = '${ids[30]}' AND status <> 'deleted'`)).toBe(1);
    expect((await deleteReview(t, w.b.cookie, mine)).status).toBe(204);
    t.clock.advance(3601_000);
    expect((await deleteReview(t, w.a.cookie, ids[30])).status).toBe(204);
  }, 120_000);

  it(`REV-TC-20261013-223014766 ${SEC} T17 (SB-14): danh sách và chi tiết đánh giá của tôi chung một bộ đếm bậc C 120 mỗi phút theo người dùng`, async () => {
    const r = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published' });
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) statuses.push((await call(t, 'get', '/me/reviews', { cookie: w.a.cookie })).status, (await call(t, 'get', `/me/reviews/${r}`, { cookie: w.a.cookie })).status);
    expect(statuses).toEqual(Array(120).fill(200));
    const [l, d] = [await call(t, 'get', '/me/reviews', { cookie: w.a.cookie }), await call(t, 'get', `/me/reviews/${r}`, { cookie: w.a.cookie })];
    expect([l.status, d.status]).toEqual([429, 429]);
    const ra = Number(l.headers['retry-after']);
    expect([ra > 0, ra <= 60]).toEqual([true, true]);
    expect((await call(t, 'get', '/me/reviews', { cookie: w.b.cookie })).status).toBe(200); // người khác (bộ đếm theo người dùng)
    t.clock.advance(61_000);
    expect((await call(t, 'get', '/me/reviews', { cookie: w.a.cookie })).status).toBe(200);
  }, 120_000);

  it(`REV-TC-20261013-223014868 ${SEC} T3 (SB-14): hàng đợi và bốn thao tác kiểm duyệt chung một bộ đếm bậc D 60 mỗi phút của admin`, async () => {
    const r = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending' });
    const first: number[] = [];
    for (let i = 0; i < 30; i++) first.push((await call(t, 'get', '/admin/reviews', { cookie: w.admin.cookie })).status, (await moderate(t, w.admin.cookie, r, 'approve')).status);
    expect(first.filter((s) => s === 429)).toEqual([]);
    expect(first.slice(0, 2)).toEqual([200, 200]);
    expect(new Set(first.slice(2).filter((_, i) => i % 2 === 1))).toEqual(new Set([409])); // approve lần sau: đánh giá đã `published`
    const [list, act] = [await call(t, 'get', '/admin/reviews', { cookie: w.admin.cookie }), await moderate(t, w.admin.cookie, r, 'approve')];
    expect([list.status, act.status]).toEqual([429, 429]);
    const ra = Number(list.headers['retry-after']);
    expect([ra > 0, ra <= 60]).toEqual([true, true]);
    t.clock.advance(61_000);
    expect((await call(t, 'get', '/admin/reviews', { cookie: w.admin.cookie })).status).toBe(200);
  }, 120_000);

  it(`REV-TC-20261013-223014967 ${SEC} T6 (SB-14): review-eligibility bậc C 120 mỗi phút theo người dùng; lần thứ 121 bị 429`, async () => {
    await eligible(t, w.a, w.p1);
    const ok: number[] = [];
    for (let i = 0; i < 120; i++) ok.push((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie })).status);
    expect(ok).toEqual(Array(120).fill(200));
    const over = await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie });
    expect(over.status).toBe(429);
    const ra = Number(over.headers['retry-after']);
    expect([ra > 0, ra <= 60]).toEqual([true, true]);
    expect((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.b.cookie })).status).toBe(200);
    t.clock.advance(61_000);
    expect((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie })).status).toBe(200);
  }, 120_000);

  it(`REV-TC-20261013-223015066 ${SEC} T19 (SB-20, SB-31): PRD, ORD hay AUTH không trả lời hoặc lỗi thì 503 service-unavailable (problem+json, không lộ chi tiết), không tạo gì; hồi phục thì tạo được`, async () => {
    await eligible(t, w.a, w.p1);
    await seedReview(t, { user: w.c.id, product: w.p1, status: 'published' });
    const catalog = t.app.get(CatalogApi), orders = t.app.get(OrderApi), auth = t.app.get(AuthApi);
    const check = (r: { status: number; body: any; headers: Record<string, any> }) => {
      expect([r.status, r.headers['content-type']]).toEqual([503, expect.stringContaining('application/problem+json')]);
      expect(r.body).toMatchObject({ type: 'urn:ecom:error:service-unavailable', status: 503 });
      expect(Object.keys(r.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
      expect(JSON.stringify(r.body)).not.toMatch(/CatalogApi|OrderApi|AuthApi|Error:|dependency|SECRET-DETAIL/);
      expect(t.logs.lines.join('\n')).toContain(r.body.trace_id);
    };
    const eligibility = () => call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie });
    // chỉ MỘT bên hỏng mỗi lần
    jest.spyOn(catalog, 'getSummaries').mockRejectedValue(new Error('SECRET-DETAIL prd'));
    check(await createReview(t, w.a.cookie, w.p1, { rating: 5 }));
    check(await eligibility());
    jest.restoreAllMocks();
    jest.spyOn(orders, 'getDeliveredItems').mockRejectedValue(new Error('SECRET-DETAIL ord'));
    check(await createReview(t, w.a.cookie, w.p1, { rating: 5 }));
    jest.restoreAllMocks();
    jest.spyOn(orders, 'hasUndeliveredItems').mockRejectedValue(new Error('SECRET-DETAIL ord2'));
    check(await eligibility());
    jest.restoreAllMocks();
    jest.spyOn(auth, 'getDisplayNames').mockRejectedValue(new Error('SECRET-DETAIL auth'));
    check(await call(t, 'get', `/products/${w.p1}/reviews`));
    jest.restoreAllMocks();
    expect(await revCount(t, `user_id = '${w.a.id}'`)).toBe(0); // không tạo gì
    // quá hạn 2 giây (treo): cũng 503
    jest.spyOn(orders, 'getDeliveredItems').mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    check(await createReview(t, w.a.cookie, w.p1, { rating: 5 }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(Date.now() - started).toBeLessThan(10_000);
    jest.restoreAllMocks();
    const ok = await createReview(t, w.a.cookie, w.p1, { rating: 5 });
    expect(ok.status).toBe(201);
  }, 120_000);
});
