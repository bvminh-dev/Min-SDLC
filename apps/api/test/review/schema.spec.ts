import { randomUUID } from 'node:crypto';
import { seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { createRevApp, q, seedImageRow, seedOrderItem, seedProduct, seedReview, world, type RevApp, type World } from '../support/rev';

const DB = 'REV-DB-20261006-103618216';
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { const x = e as { meta?: { code?: unknown } }; return String(x.meta?.code ?? e); } };

describe(`REV lược đồ dữ liệu (${DB}): CHECK, duy nhất một phần, khóa ngoại RESTRICT`, () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); w = await world(t); });
  const ins = (o: { user: string; product: string; item: string; status?: string; rating?: number; comment?: string | null; reason?: string | null; deletedAt?: Date | null }) => t.prisma.$executeRaw`
    INSERT INTO reviews (user_id, product_id, order_item_id, status, rating, comment, moderation_reason, deleted_at)
    VALUES (${o.user}::uuid, ${o.product}::uuid, ${o.item}::uuid, ${o.status ?? 'pending'}::review_status, ${o.rating ?? 5}, ${o.comment === undefined ? null : o.comment}, ${o.reason ?? null}, ${o.deletedAt ?? null}::timestamptz)`;

  it(`REV-TC-20261006-104524423 REV-TC-20261006-104524655 REV-TC-20261006-104528138 ${DB} CHECK của reviews: điểm 1 đến 5, bình luận 1 đến 2000 ký tự, lý do 1 đến 500, deleted đi cùng deleted_at`, async () => {
    const d = await seedOrderItem(t, w.a.id, w.p1);
    const base = { user: w.a.id, product: w.p1, item: d.item };
    const out: Record<string, string> = {};
    for (const rating of [0, 6, -1]) out[`rating ${rating}`] = await code(ins({ ...base, rating }));
    out.comment0 = await code(ins({ ...base, comment: '' }));
    out.comment2001 = await code(ins({ ...base, comment: 'a'.repeat(2001) }));
    out.reason0 = await code(ins({ ...base, status: 'rejected', reason: '' }));
    out.reason501 = await code(ins({ ...base, status: 'rejected', reason: 'b'.repeat(501) }));
    out.deletedNoAt = await code(ins({ ...base, status: 'deleted' }));
    out.atNoDeleted = await code(ins({ ...base, status: 'pending', deletedAt: new Date() }));
    expect(Object.values(out).every((c) => c === '23514')).toBe(true);
    expect(await code(ins({ ...base, rating: 1, comment: 'a'.repeat(2000) }))).toBe('ok');
  });

  it(`REV-TC-20261006-104524159 REV-TC-20261006-104524227 ${DB} unique một phần: một đánh giá chưa xóa mỗi dòng đơn và mỗi (người dùng, sản phẩm); deleted nhường chỗ`, async () => {
    const d = await seedOrderItem(t, w.a.id, w.p1);
    const d2 = await seedOrderItem(t, w.a.id, w.p1);
    const base = { user: w.a.id, product: w.p1 };
    expect(await code(ins({ ...base, item: d.item }))).toBe('ok');
    expect(await code(ins({ ...base, item: d.item, status: 'hidden' }))).toBe('23505'); // cùng dòng đơn
    expect(await code(ins({ ...base, item: d2.item }))).toBe('23505'); // cùng (người dùng, sản phẩm), dòng đơn khác
    await t.prisma.$executeRaw`UPDATE reviews SET status = 'deleted', deleted_at = now()`;
    expect(await code(ins({ ...base, item: d.item }))).toBe('ok'); // chỗ được nhường
    expect(await code(ins({ ...base, item: d2.item, status: 'deleted', deletedAt: new Date() }))).toBe('ok'); // nhiều dòng deleted
    const idx = await q<{ indexname: string; indexdef: string }>(t, `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('reviews','review_images')`);
    const def = (n: string) => idx.find((i) => i.indexname === n)?.indexdef ?? '';
    expect(def('reviews_public_list_idx')).toContain("status = 'published'");
    expect(def('reviews_public_rating_idx')).toContain("status = 'published'");
    expect(def('review_images_sweep_idx')).toContain('COALESCE');
    expect(def('reviews_user_product_live_key')).toContain('UNIQUE');
  });

  it(`REV-TC-20261006-104526283 ${DB} khóa ngoại ON DELETE RESTRICT: không xóa được người dùng, sản phẩm, dòng đơn, đánh giá đang được tham chiếu`, async () => {
    const d = await seedOrderItem(t, w.a.id, w.p1);
    const r = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', orderItem: d.item, moderatedBy: w.admin.id, images: 1 });
    expect(await code(t.prisma.$executeRaw`DELETE FROM users WHERE id = ${w.a.id}::uuid`)).toBe('23503');
    expect(await code(t.prisma.$executeRaw`DELETE FROM users WHERE id = ${w.admin.id}::uuid`)).toBe('23503'); // moderated_by
    expect(await code(t.prisma.$executeRaw`DELETE FROM products WHERE id = ${w.p1}::uuid`)).toBe('23503');
    expect(await code(t.prisma.$executeRaw`DELETE FROM order_items WHERE id = ${d.item}::uuid`)).toBe('23503');
    expect(await code(t.prisma.$executeRaw`DELETE FROM reviews WHERE id = ${r}::uuid`)).toBe('23503'); // còn ảnh gắn
    // đánh giá KHÔNG có ảnh: khóa ngoại của chính reviews phải RESTRICT (không dựa vào khóa RESTRICT của review_images)
    const p2 = await seedProduct(t, { category: w.cat });
    const d2 = await seedOrderItem(t, w.c.id, p2);
    await seedReview(t, { user: w.c.id, product: p2, status: 'published', orderItem: d2.item });
    expect(await code(t.prisma.$executeRaw`DELETE FROM products WHERE id = ${p2}::uuid`)).toBe('23503');
    // người dùng chỉ có đánh giá (không đơn, không phiên): khóa ngoại user_id của reviews phải RESTRICT, không CASCADE (dòng đơn của người khác chỉ để thỏa khóa ngoại)
    const p3 = await seedProduct(t, { category: w.cat });
    const d3 = await seedOrderItem(t, w.a.id, p3);
    const lone = await seedUser(t, { email: 'lone@shop.vn' });
    await seedReview(t, { user: lone.id, product: p3, status: 'published', orderItem: d3.item });
    expect(await code(t.prisma.$executeRaw`DELETE FROM users WHERE id = ${lone.id}::uuid`)).toBe('23503');
    expect(await code(t.prisma.$executeRaw`DELETE FROM order_items WHERE id = ${d2.item}::uuid`)).toBe('23503');
    const free = await seedOrderItem(t, w.b.id, w.p1);
    expect(await code(ins({ user: randomUUID(), product: w.p1, item: free.item }))).toBe('23503');
    expect(await code(ins({ user: w.b.id, product: randomUUID(), item: free.item }))).toBe('23503');
    expect(await code(ins({ user: w.b.id, product: w.p1, item: randomUUID() }))).toBe('23503');
  });

  it(`REV-TC-20261006-104524858 REV-TC-20261006-104525257 REV-TC-20261006-104525035 ${DB} review_images: position 1 đến 5, review_id và position đi cùng nhau, khóa kho đúng dạng reviews/<uuid>.webp, kích thước <= 1600, bytes > 0, khóa duy nhất`, async () => {
    const d = await seedOrderItem(t, w.a.id, w.p1);
    const r = await seedReview(t, { user: w.a.id, product: w.p1, orderItem: d.item });
    const img = (o: { review?: string | null; pos?: number | null; key?: string; width?: number; height?: number; bytes?: number }) => t.prisma.$executeRaw`
      INSERT INTO review_images (user_id, review_id, position, storage_key, width, height, bytes)
      VALUES (${w.a.id}::uuid, ${o.review === undefined ? null : o.review}::uuid, ${o.pos === undefined ? null : o.pos}, ${o.key ?? `reviews/${randomUUID()}.webp`}, ${o.width ?? 100}, ${o.height ?? 100}, ${o.bytes ?? 10})`;
    const bad: [string, Promise<unknown>][] = [
      ['pos0', img({ review: r, pos: 0 })], ['pos6', img({ review: r, pos: 6 })], ['reviewNoPos', img({ review: r })], ['posNoReview', img({ pos: 1 })],
      ['keyBare', img({ key: 'reviews/x.webp' })], ['keyUpper', img({ key: `reviews/${randomUUID().toUpperCase()}.webp` })], ['keyJpg', img({ key: `reviews/${randomUUID()}.jpg` })],
      ['keyTraversal', img({ key: `reviews/../${randomUUID()}.webp` })], ['keyOtherPrefix', img({ key: `avatars/${randomUUID()}.webp` })],
      ['w0', img({ width: 0 })], ['w1601', img({ width: 1601 })], ['h0', img({ height: 0 })], ['h1601', img({ height: 1601 })], ['bytes0', img({ bytes: 0 })],
    ];
    for (const [name, p] of bad) expect([name, await code(p)]).toEqual([name, '23514']);
    const k = `reviews/${randomUUID()}.webp`;
    expect(await code(img({ key: k, width: 1600, height: 1600 }))).toBe('ok');
    expect(await code(img({ key: k }))).toBe('23505');
    expect(await code(img({ review: r, pos: 1 }))).toBe('ok');
    expect(await code(img({ review: r, pos: 1 }))).toBe('23505');
    expect(await code(img({ review: randomUUID(), pos: 2 }))).toBe('23503');
    expect(await seedImageRow(t, w.a.id, null, null)).toBeTruthy();
    expect(await seedProduct(t, { category: w.cat })).toBeTruthy();
  });
});
