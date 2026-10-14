import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { OBJECT_STORAGE } from '../../src/modules/platform';
import { RATE_LIMIT } from '../../src/modules/platform/http/rate-limit';
import { LIMITS } from '../../src/modules/review/config';
import { AdminReviewController, ReviewController } from '../../src/modules/review/review.controller';
import {
  call, createReview, createRevApp, deleteReview, eligible, freshClock, imageRows, patchReview, preModeration, q, revCount, reviewRow, seedImageRow, seedOrderItem, seedProduct, seedReview, uploadImage, world, type RevApp, type World,
} from '../support/rev';

// Ca của lượt review độc lập (REV-REV-01 đến REV-REV-10): mỗi ca đóng một đột biến do reviewer gài mà bộ test của implement để lọt (xem review.md, Kết quả sau sửa).
const SEC = 'REV-SEC-20261006-103618395';
const DB = 'REV-DB-20261006-103618216';
const H = 3_600_000;
const message = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { const x = e as { meta?: { code?: unknown; message?: unknown } }; return `${x.meta?.code ?? ''} ${x.meta?.message ?? e}`; } };

describe('REV review độc lập: ca đóng các đột biến lọt', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const upload = async (file: Buffer) => { const r = await uploadImage(t, w.a.cookie, file); expect(r.status).toBe(201); return r.body as { image_id: string; url: string; width: number; height: number }; };
  const solid = (width: number, height: number, c: string) => sharp({ create: { width, height, channels: 3, background: c } }).png().toBuffer();

  it(`REV-REV-01 REV-TC-20261006-104524045 ${SEC} T11 (SB-06): sản phẩm draft cũng trả 404 khi tạo và khi hỏi điều kiện, như archived và không tồn tại (cùng nội dung)`, async () => {
    const draft = await seedProduct(t, { category: w.cat, status: 'draft' });
    await seedOrderItem(t, w.a.id, draft);
    const ghost = randomUUID();
    const strip = (b: Record<string, unknown>) => JSON.stringify({ ...b, trace_id: undefined });
    const c = await createReview(t, w.a.cookie, draft, { rating: 5 });
    const g = await createReview(t, w.a.cookie, ghost, { rating: 5 });
    expect([c.status, g.status, strip(c.body) === strip(g.body)]).toEqual([404, 404, true]);
    const e = await call(t, 'get', `/products/${draft}/review-eligibility`, { cookie: w.a.cookie });
    expect(e.status).toBe(404);
    expect(await q(t, 'SELECT id FROM reviews')).toHaveLength(0);
  });

  it(`REV-REV-02 REV-TC-20261006-104525777 ${SEC} T6: sau khi xóa đánh giá, hỏi điều kiện báo đủ điều kiện (đánh giá deleted không giữ chỗ), rồi tạo lại được`, async () => {
    await eligible(t, w.a, w.p1);
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 4 });
    expect(r.status).toBe(201);
    expect((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie })).body).toEqual({ eligible: false, reason: 'already_reviewed' });
    expect((await deleteReview(t, w.a.cookie, r.body.id)).status).toBe(204);
    expect((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie })).body).toEqual({ eligible: true, reason: null });
    expect((await createReview(t, w.a.cookie, w.p1, { rating: 3 })).status).toBe(201);
  });

  it(`REV-REV-03 ${SEC} T20: thứ tự ảnh theo image_ids ở tạo, ở danh sách của tôi, ở danh sách công khai; đổi thứ tự khi sửa là thay đổi thật`, async () => {
    const restore = preModeration(t, false);
    try {
      await eligible(t, w.a, w.p1);
      const [x, y, z] = [await upload(await solid(40, 30, '#f00')), await upload(await solid(50, 30, '#0f0')), await upload(await solid(60, 30, '#00f'))];
      const r = await createReview(t, w.a.cookie, w.p1, { rating: 5, image_ids: [z.image_id, x.image_id, y.image_id] });
      expect(r.status).toBe(201);
      expect(r.body.images.map((i: { id: string }) => i.id)).toEqual([z.image_id, x.image_id, y.image_id]);
      const mine = await call(t, 'get', `/me/reviews/${r.body.id}`, { cookie: w.a.cookie });
      expect(mine.body.images.map((i: { url: string }) => i.url)).toEqual([z.url, x.url, y.url]);
      const pub = await call(t, 'get', `/products/${w.p1}/reviews`);
      expect(pub.body.items[0].images.map((i: { url: string }) => i.url)).toEqual([z.url, x.url, y.url]);
      const sw = await patchReview(t, w.a.cookie, r.body.id, { image_ids: [x.image_id, y.image_id, z.image_id] }); // cùng tập, khác thứ tự: phải ghi
      expect(sw.status).toBe(200);
      expect(sw.body.images.map((i: { id: string }) => i.id)).toEqual([x.image_id, y.image_id, z.image_id]);
      expect((await imageRows(t, `review_id = '${r.body.id}'`)).sort((a, b) => a.position! - b.position!).map((i) => [i.id, i.position])).toEqual([[x.image_id, 1], [y.image_id, 2], [z.image_id, 3]]);
      expect((await call(t, 'get', `/products/${w.p1}/reviews`)).body.items[0].images.map((i: { url: string }) => i.url)).toEqual([x.url, y.url, z.url]);
      // thứ tự theo `position`, không theo thứ tự ghi vật lý của dòng: dòng ảnh ghi theo thứ tự 3, 1, 2
      const own = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published' });
      const third = await seedImageRow(t, w.b.id, own, 3, 0), first = await seedImageRow(t, w.b.id, own, 1, 0), second = await seedImageRow(t, w.b.id, own, 2, 0);
      const pub2 = await call(t, 'get', `/products/${w.p1}/reviews`);
      const imgs = pub2.body.items.find((i: { id: string }) => i.id === own).images.map((i: { url: string }) => i.url.slice(i.url.indexOf('reviews/')));
      expect(imgs).toEqual([first.key, second.key, third.key]);
    } finally { restore(); }
  });

  it(`REV-REV-04 ${SEC} T6 (SB-40): cùng Idempotency-Key cho SẢN PHẨM KHÁC là yêu cầu khác: 422 idempotency-key-reused, không trả phản hồi của sản phẩm trước, không tạo đánh giá`, async () => {
    const p2 = await seedProduct(t, { category: w.cat });
    await eligible(t, w.a, w.p1);
    await seedOrderItem(t, w.a.id, p2);
    const key = randomUUID();
    const first = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key });
    expect(first.status).toBe(201);
    const other = await createReview(t, w.a.cookie, p2, { rating: 5 }, { key });
    expect([other.status, other.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    expect(await q<{ product_id: string }>(t, `SELECT product_id FROM reviews WHERE user_id = '${w.a.id}'`)).toEqual([{ product_id: w.p1 }]);
    const again = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key }); // đúng yêu cầu cũ vẫn nhận lại phản hồi cũ
    expect([again.status, again.headers['idempotent-replayed'], again.body.id]).toEqual([201, 'true', first.body.id]);
  });

  it(`REV-REV-05 ${SEC} T6, T17 (SB-14): MỌI route của REV khai @RateLimit đúng bậc, hạn mức, cửa sổ và nhóm đếm (bỏ khai là rơi về bậc C mặc định 120 mỗi phút)`, () => {
    const meta = (ctl: { prototype: object }, m: string) => Reflect.getMetadata(RATE_LIMIT, (ctl.prototype as Record<string, unknown>)[m] as object);
    const want: [typeof ReviewController | typeof AdminReviewController, string, unknown][] = [
      [ReviewController, 'create', LIMITS.create], [ReviewController, 'eligibility', LIMITS.eligibility], [ReviewController, 'upload', LIMITS.upload], [ReviewController, 'edit', LIMITS.edit],
      [ReviewController, 'remove', LIMITS.remove], [ReviewController, 'publicList', LIMITS.publicRead], [ReviewController, 'mine', LIMITS.mine], [ReviewController, 'mineOne', LIMITS.mine],
      [AdminReviewController, 'list', LIMITS.admin], [AdminReviewController, 'approve', LIMITS.admin], [AdminReviewController, 'reject', LIMITS.admin], [AdminReviewController, 'hide', LIMITS.admin], [AdminReviewController, 'unhide', LIMITS.admin],
    ];
    const all = (c: { prototype: object }) => Object.getOwnPropertyNames(c.prototype).filter((n) => n !== 'constructor');
    expect([...all(ReviewController), ...all(AdminReviewController)].sort()).toEqual(want.map(([, m]) => m).sort()); // không có route mới mà chưa khai bậc
    for (const [c, m, limits] of want) expect([m, meta(c, m)]).toEqual([m, limits]);
    expect(LIMITS).toMatchObject({ create: { tier: 'B', limit: 10, windowSeconds: 3600 }, edit: { tier: 'B', limit: 30 }, upload: { tier: 'B', limit: 20 }, publicRead: { tier: 'C', limit: 120, windowSeconds: 60 } });
  });

  it(`REV-REV-06 ${SEC} T9 (SB-34): job dọn xóa dòng ảnh chỉ khi VẪN chưa gắn và vẫn quá hạn: ảnh được gắn vào đánh giá giữa lúc chọn và lúc xóa không bị xóa dòng`, async () => {
    const review = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending' });
    const img = await seedImageRow(t, w.a.id, null, null, 30 * H);
    const storage = t.app.get(OBJECT_STORAGE);
    const del = storage.delete.bind(storage);
    jest.spyOn(storage, 'delete').mockImplementation(async (...args: unknown[]) => {
      await del(String(args[0]));
      await q(t, `UPDATE review_images SET review_id = '${review}', position = 1 WHERE id = '${img.id}'`); // người dùng gắn ảnh đúng lúc job đang xóa object
    });
    const r = await t.images.sweep();
    expect(r.removed).toBe(0);
    expect((await imageRows(t, `id = '${img.id}'`)).map((x) => [x.review_id, x.position])).toEqual([[review, 1]]);
  });

  it(`REV-REV-07 ${SEC} T8 (SB-10): ảnh có EXIF orientation được xoay trước khi bỏ metadata (100 x 50 orientation 6 thành 50 x 100)`, async () => {
    const jpg = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#336699' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(jpg).metadata()).orientation).toBe(6);
    const r = await upload(jpg);
    expect([r.width, r.height]).toEqual([50, 100]);
    const rows = await imageRows(t, `id = '${r.image_id}'`);
    expect([rows[0].width, rows[0].height]).toEqual([50, 100]);
  });

  it(`REV-REV-08 REV-TC-20261006-104524981 ${SEC} T8, T19 (SB-10): tệp mở đầu FF D8 nhưng byte thứ ba không phải FF không phải JPEG: reason type (không phải corrupt)`, async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.alloc(200, 0x41)]);
    const r = await uploadImage(t, w.a.cookie, fake);
    expect([r.status, r.body.code, r.body.reason]).toEqual([400, 'image_invalid', 'type']);
    expect(await imageRows(t)).toHaveLength(0);
  });

  it(`REV-REV-09 ${SEC} T9 (ADR-022): hạn 24 giờ của ảnh chưa gắn tính từ orphaned_at khi có: ảnh cũ vừa gỡ khỏi đánh giá không bị job dọn và gắn lại được; ảnh gỡ quá 24 giờ thì bị dọn và không gắn lại được`, async () => {
    const recent = await seedImageRow(t, w.a.id, null, null, 40 * H, { orphanedAgeMs: 1 * H }); // tải lên 40 giờ trước, vừa gỡ khỏi đánh giá 1 giờ trước
    const stale = await seedImageRow(t, w.a.id, null, null, 40 * H, { orphanedAgeMs: 25 * H });
    await eligible(t, w.a, w.p1);
    expect((await t.images.sweep()).removed).toBe(1);
    expect((await imageRows(t)).map((x) => x.id)).toEqual([recent.id]);
    expect(t.fake.keys('reviews/')).toEqual([recent.key]); // object của ảnh vừa gỡ còn nguyên: job không xóa object trước rồi mới thấy dòng chưa quá hạn
    const late = await createReview(t, w.a.cookie, w.p1, { rating: 4, image_ids: [stale.id] });
    expect([late.status, late.body.errors?.[0]?.code]).toEqual([400, 'invalid_image']);
    const ok = await createReview(t, w.a.cookie, w.p1, { rating: 4, image_ids: [recent.id] });
    expect([ok.status, ok.body.images?.length]).toEqual([201, 1]);
  });

  it(`REV-REV-10 ${DB} ${SEC} T1 (SB-06): khóa ngoại RESTRICT: không xóa được admin đã kiểm duyệt (reviews.moderated_by) hay người dùng chỉ có ảnh tải lên (review_images.user_id)`, async () => {
    const mod = await seedUser(t, { email: 'mod@shop.vn', role: 'admin', name: 'Kiểm Duyệt' });
    await seedReview(t, { user: w.a.id, product: w.p1, status: 'rejected', moderatedBy: mod.id });
    const modOut = await message(t.prisma.$executeRaw`DELETE FROM users WHERE id = ${mod.id}::uuid`);
    expect(modOut).toMatch(/^23503 .*reviews_moderated_by_fkey/s);
    const only = await seedUser(t, { email: 'img@shop.vn', name: 'Chỉ ảnh' });
    await seedImageRow(t, only.id, null, null, 0);
    const imgOut = await message(t.prisma.$executeRaw`DELETE FROM users WHERE id = ${only.id}::uuid`);
    expect(imgOut).toMatch(/^23503 .*review_images_user_id_fkey/s);
    expect(await q(t, `SELECT id FROM users WHERE id IN ('${mod.id}', '${only.id}')`)).toHaveLength(2);
  });

  it(`REV-REV-11 REV-TC-20261013-223014272 ${SEC} T13 (REV-REQ-20261006-103135296 BR3): khách có đơn đã giao quá 90 ngày và đơn MỚI đang giao thì được báo not_delivered (bước 4 đứng trước bước 5), đơn mới giao xong thì đánh giá được và gắn với dòng của đơn mới`, async () => {
    await seedOrderItem(t, w.a.id, w.p1, { daysAgo: 100 });
    expect((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie })).body).toEqual({ eligible: false, reason: 'window_expired' }); // đối chứng: bỏ đơn mới đang giao thì window_expired
    await seedOrderItem(t, w.a.id, w.p1, { status: 'shipped' });
    expect((await call(t, 'get', `/products/${w.p1}/review-eligibility`, { cookie: w.a.cookie })).body).toEqual({ eligible: false, reason: 'not_delivered' });
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 5 });
    expect([r.status, r.body.code]).toEqual([409, 'not_delivered']);
    expect(await revCount(t, `user_id = '${w.a.id}'`)).toBe(0);
    for (const st of ['pending', 'confirmed', 'paid'] as const) { // đơn mới ở bất kỳ trạng thái chưa giao nào cho cùng kết quả (thử trên sản phẩm riêng, mỗi sản phẩm một đơn cũ 100 ngày cộng một đơn mới)
      const p = await seedProduct(t, { category: w.cat });
      await seedOrderItem(t, w.a.id, p, { daysAgo: 100 });
      await seedOrderItem(t, w.a.id, p, { status: st });
      expect([st, (await call(t, 'get', `/products/${p}/review-eligibility`, { cookie: w.a.cookie })).body.reason]).toEqual([st, 'not_delivered']);
    }
    for (const st of ['cancelled', 'returned', 'expired'] as const) { // đơn mới hủy, hoàn hay hết hạn thì chỉ còn đơn 100 ngày: window_expired
      const p = await seedProduct(t, { category: w.cat });
      await seedOrderItem(t, w.a.id, p, { daysAgo: 100 });
      await seedOrderItem(t, w.a.id, p, { status: st });
      expect([st, (await call(t, 'get', `/products/${p}/review-eligibility`, { cookie: w.a.cookie })).body.reason]).toEqual([st, 'window_expired']);
    }
    const delivered = await seedOrderItem(t, w.a.id, w.p1, { daysAgo: 2 });
    const ok = await createReview(t, w.a.cookie, w.p1, { rating: 5 });
    expect(ok.status).toBe(201);
    expect((await reviewRow(t, ok.body.id)).order_item_id).toBe(delivered.item);
  });
});
