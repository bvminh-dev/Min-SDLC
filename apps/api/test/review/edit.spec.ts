import { randomUUID } from 'node:crypto';
import { TransactionService } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { freshClock, createRevApp, eligible, imageRows, moderate, patchReview, preModeration, productRating, q, relayAll, revAudits, revOutbox, revTypes, reviewRow, seedOrderItem, seedProduct, seedReview, snapshot, world, call, type RevApp, type World } from '../support/rev';
import { race } from '../support/ord';

const SEC = 'REV-SEC-20261006-103618395';
const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };

describe('REV sửa đánh giá (REV-REQ-20261006-103135385)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });

  it(`REV-TC-20261006-104525824 sửa đánh giá pending đổi tại chỗ và bỏ hết ảnh; ảnh cũ thành mồ côi, không phát event`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r1 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending', rating: 3, comment: 'Tạm được', orderItem: d.item, images: 2 });
    const created = (await reviewRow(t, r1)).created_at;
    const r = await patchReview(t, w.a.cookie, r1, { rating: 4, comment: 'Dùng vài hôm thấy ổn', image_ids: [] });
    expect([r.status, r.body.status, r.body.rating, r.body.comment, r.body.images, r.body.edited_at]).toEqual([200, 'pending', 4, 'Dùng vài hôm thấy ổn', [], null]);
    expect(await revTypes(t)).toEqual([]);
    const imgs = await imageRows(t);
    expect(imgs).toHaveLength(2);
    expect(imgs.every((x) => x.review_id === null && x.position === null && x.orphaned_at !== null)).toBe(true);
    const row = await reviewRow(t, r1);
    expect([row.rating, row.comment, row.created_at]).toEqual([4, 'Dùng vài hôm thấy ổn', created]); // vị trí ở hàng đợi không đổi
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it(`REV-TC-20261006-104525890 tắt kiểm duyệt trước: sửa bình luận đánh giá published giữ published, đặt edited_at, hiện nhãn đã chỉnh sửa`, async () => {
    preModeration(t, false);
    const d = await eligible(t, w.a, w.p1);
    const publishedAt = new Date(t.clock.now().getTime() - 3600_000);
    const r2 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 5, comment: 'Tốt', orderItem: d.item, publishedAt, createdAt: publishedAt });
    const at = t.clock.now();
    const r = await patchReview(t, w.a.cookie, r2, { comment: 'Đã dùng một tháng, vẫn tốt' });
    expect([r.status, r.body.status, r.body.rating, r.body.comment, r.body.edited_at]).toEqual([200, 'published', 5, 'Đã dùng một tháng, vẫn tốt', at.toISOString()]);
    const list = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect([list.body.items[0].comment, list.body.items[0].edited_at, list.body.items[0].published_at]).toEqual(['Đã dùng một tháng, vẫn tốt', at.toISOString(), publishedAt.toISOString()]);
    expect(await revTypes(t)).toEqual([]); // điểm không đổi: không có ReviewRatingChanged
  });

  it(`REV-TC-20261006-104525946 ${SEC} T1, T2: sửa đánh giá của người khác và đánh giá không tồn tại cùng trả 404`, async () => {
    const db = await eligible(t, w.b, w.p1);
    const r3 = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', orderItem: db.item, comment: 'gốc' });
    await eligible(t, w.a, w.p1);
    const bodies = [];
    for (const id of [r3, randomUUID(), 'abc']) {
      const x = await patchReview(t, w.a.cookie, id, { comment: 'x' });
      expect([id === r3 ? 'other' : id.length, x.status]).toEqual([id === r3 ? 'other' : id.length, 404]);
      bodies.push(strip(x.body));
    }
    expect(bodies[1]).toEqual(bodies[0]); expect(bodies[2]).toEqual(bodies[0]);
    const row = await reviewRow(t, r3);
    expect([row.comment, row.edited_at]).toEqual(['gốc', null]);
  });

  it(`REV-TC-20261006-104526003 ${SEC} T12: sửa đánh giá hidden hoặc rejected bị 409, đánh giá deleted bị 404`, async () => {
    const mk = async (status: 'hidden' | 'rejected' | 'deleted') => {
      const p = await seedProduct2(status);
      const d = await eligible(t, w.a, p);
      return seedReview(t, { user: w.a.id, product: p, status, orderItem: d.item, moderatedBy: w.admin.id });
    };
    const [r4, r4b, r5] = [await mk('hidden'), await mk('rejected'), await mk('deleted')];
    const before = await snapshot(t);
    const [x, y, z] = [await patchReview(t, w.a.cookie, r4, { comment: 'sửa' }), await patchReview(t, w.a.cookie, r4b, { comment: 'sửa' }), await patchReview(t, w.a.cookie, r5, { comment: 'sửa' })];
    expect([x.status, x.body.code, y.status, y.body.code, z.status]).toEqual([409, 'review_not_editable', 409, 'review_not_editable', 404]);
    expect((await q<any>(t, `SELECT status::text AS s FROM reviews WHERE id IN ('${r4}','${r4b}','${r5}') ORDER BY s`)).map((r) => r.s)).toEqual(['deleted', 'hidden', 'rejected']);
    expect(await snapshot(t)).toEqual(before);
    expect(await revTypes(t)).toEqual([]);
  });
  const seedProduct2 = async (name: string) => seedProduct(t, { category: w.cat, name: `P-${name}` });

  it(`REV-TC-20261006-104526059 ${SEC} T4: sửa với trường lạ, điểm sai hay body rỗng bị 400 và không đổi gì`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r6 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 4, orderItem: d.item });
    const before = await reviewRow(t, r6);
    const other = await seedReview2();
    const x1 = await patchReview(t, w.a.cookie, r6, { product_id: other });
    const x2 = await patchReview(t, w.a.cookie, r6, { status: 'hidden' });
    const x3 = await patchReview(t, w.a.cookie, r6, { rating: 6 });
    const x4 = await patchReview(t, w.a.cookie, r6, {});
    const x5 = await patchReview(t, w.a.cookie, r6, { user_id: w.b.id });
    expect([x1.status, x1.body.errors[0].code, x2.status, x2.body.errors[0].code, x3.status, x3.body.errors[0], x4.status, x5.body.errors[0].code]).toEqual([400, 'unknown_field', 400, 'unknown_field', 400, { field: 'rating', code: 'invalid_rating' }, 400, 'unknown_field']);
    expect((await patchReview(t, w.a.cookie, r6, { rating: null })).body.errors[0]).toEqual({ field: 'rating', code: 'required' });
    expect(await reviewRow(t, r6)).toEqual(before);
    async function seedReview2() { return randomUUID(); }
  });

  it(`REV-TC-20261006-104526113 guest 401, staff và admin 403 khi sửa đánh giá (admin không sửa nội dung)`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r7 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', orderItem: d.item, comment: 'gốc' });
    const [g, s, a] = [await patchReview(t, undefined, r7, { comment: 'sửa hộ' }), await patchReview(t, w.staff.cookie, r7, { comment: 'sửa hộ' }), await patchReview(t, w.admin.cookie, r7, { comment: 'sửa hộ' })];
    expect([g.status, s.status, a.status]).toEqual([401, 403, 403]);
    expect((await reviewRow(t, r7)).comment).toBe('gốc');
  });

  it(`REV-TC-20261006-104526165 gửi giá trị giống hệt hiện tại trả 200 và không đổi gì (không edited_at, không updated_at, không event)`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const t0 = new Date(t.clock.now().getTime() - 3600_000);
    const r8 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 4, comment: 'OK', orderItem: d.item, createdAt: t0 });
    const before = await reviewRow(t, r8);
    for (const body of [{ rating: 4, comment: 'OK' }, { comment: '  OK  ' }, { rating: 4 }]) {
      const r = await patchReview(t, w.a.cookie, r8, body);
      expect([JSON.stringify(body), r.status, r.body.rating, r.body.comment, r.body.edited_at]).toEqual([JSON.stringify(body), 200, 4, 'OK', null]);
    }
    expect(await reviewRow(t, r8)).toEqual(before);
    expect(await revTypes(t)).toEqual([]);
    expect(await revAudits(t)).toEqual([]);
  });

  it(`REV-TC-20261006-104526228 ${SEC} T12: sửa chạy sau khi admin vừa ẩn thì bị từ chối; chiều ngược lại nhất quán (khóa dòng)`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r9 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 4, comment: 'gốc', orderItem: d.item });
    // G1 (admin ẩn) giữ khóa dòng, G2 (chủ sửa) chờ
    let release!: () => void; const hold = new Promise<void>((r) => { release = r; });
    let locked!: () => void; const gotLock = new Promise<void>((r) => { locked = r; });
    const g1 = t.app.get(TransactionService).run(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM reviews WHERE id = ${r9}::uuid FOR UPDATE`;
      locked(); await hold;
      await tx.$executeRaw`UPDATE reviews SET status = 'hidden', moderation_reason = 'x', published_at = published_at WHERE id = ${r9}::uuid`;
    });
    await gotLock;
    const g2 = patchReview(t, w.a.cookie, r9, { comment: 'đổi' }).then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    release(); await g1;
    const res = await g2;
    expect([res.status, res.body.code]).toEqual([409, 'review_not_editable']);
    const row = await reviewRow(t, r9);
    expect([row.status, row.comment]).toEqual(['hidden', 'gốc']);
    // chiều ngược lại và đua thật qua HTTP: cả hai thứ tự đều nhất quán
    for (let i = 0; i < 20; i++) {
      await t.prisma.$executeRaw`UPDATE reviews SET status = 'published', comment = 'gốc', moderation_reason = NULL WHERE id = ${r9}::uuid`;
      await t.prisma.$executeRaw`DELETE FROM outbox_events`; await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
      preModeration(t, false);
      const [h, e] = await race(() => moderate(t, w.admin.cookie, r9, 'hide', { reason: 'xấu' }), () => patchReview(t, w.a.cookie, r9, { comment: `đổi ${i}` }));
      const fin = await reviewRow(t, r9);
      expect([i, h.status, fin.status]).toEqual([i, 200, 'hidden']);
      expect([i, e.status === 200 ? fin.comment === `đổi ${i}` : (e.status === 409 && fin.comment === 'gốc')]).toEqual([i, true]);
      expect((await revTypes(t, r9)).filter((x) => x === 'ReviewHidden')).toHaveLength(1);
      jest.restoreAllMocks();
    }
  }, 120_000);

  it(`REV-TC-20261006-140000001 ${SEC} T13: bật kiểm duyệt trước thì sửa đánh giá published đưa về pending, biến khỏi công khai, duyệt lại mới hiện`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const published = new Date(t.clock.now().getTime() - 86_400_000);
    const r2 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 5, comment: 'Tốt', orderItem: d.item, publishedAt: published, createdAt: published, moderatedBy: w.admin.id });
    expect((await call(t, 'get', `/me/reviews/${r2}`, { cookie: w.a.cookie })).body.edit_requires_review).toBe(true);
    const r = await patchReview(t, w.a.cookie, r2, { comment: 'Nội dung mới sau khi được duyệt' });
    expect([r.status, r.body.status, r.body.comment, r.body.edited_at]).toEqual([200, 'pending', 'Nội dung mới sau khi được duyệt', t.clock.now().toISOString()]);
    expect((await reviewRow(t, r2)).published_at).toEqual(published);
    const pub = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect([pub.body.items, pub.body.summary.count]).toEqual([[], 0]);
    const mine = await call(t, 'get', `/me/reviews/${r2}`, { cookie: w.a.cookie });
    expect([mine.body.status, mine.body.can_delete, mine.body.edit_requires_review]).toEqual(['pending', true, false]);
    const q1 = await call(t, 'get', '/admin/reviews', { cookie: w.admin.cookie });
    expect(q1.body.items.map((i: any) => i.id)).toEqual([r2]);
    const evs = await revOutbox(t, r2);
    expect(evs.map((e) => [e.type, e.payload])).toEqual([['ReviewUnpublished', { review_id: r2, product_id: w.p1, rating: 5 }]]);
    const ap = await moderate(t, w.admin.cookie, r2, 'approve');
    expect([ap.status, ap.body.status]).toEqual([200, 'published']);
    expect((await revOutbox(t, r2)).map((e) => [e.type, e.payload.rating])).toEqual([['ReviewUnpublished', 5], ['ReviewPublished', 5]]);
    const again = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect([again.body.items[0].comment, again.body.items[0].edited_at]).toEqual(['Nội dung mới sau khi được duyệt', t.clock.now().toISOString()]);
  });

  it(`REV-TC-20261006-140000002 ${SEC} T16: tắt kiểm duyệt trước thì sửa điểm đánh giá published phát ReviewRatingChanged một lần qua outbox`, async () => {
    preModeration(t, false);
    const d = await eligible(t, w.a, w.p1);
    const d2 = await eligible(t, w.b, w.p1);
    const r2b = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 5, orderItem: d.item });
    await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', rating: 3, orderItem: d2.item });
    const r = await patchReview(t, w.a.cookie, r2b, { rating: 3 });
    expect([r.status, r.body.status, r.body.rating]).toEqual([200, 'published', 3]);
    const list = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect(list.body.summary).toEqual({ count: 2, avg: 3, distribution: { 1: 0, 2: 0, 3: 2, 4: 0, 5: 0 } });
    expect((await revOutbox(t, r2b)).map((e) => [e.type, e.payload])).toEqual([['ReviewRatingChanged', { review_id: r2b, product_id: w.p1, old_rating: 5, new_rating: 3 }]]);
    const edited = (await reviewRow(t, r2b)).edited_at;
    const again = await patchReview(t, w.a.cookie, r2b, { rating: 3 });
    expect([again.status, (await reviewRow(t, r2b)).edited_at]).toEqual([200, edited]);
    expect(await revTypes(t, r2b)).toEqual(['ReviewRatingChanged']);
  });

  it(`REV-TC-20261006-140000007 ${SEC} T16: bản sửa của đánh giá published bị từ chối thì ReviewUnpublished đã phát nên điểm của PRD không lệch`, async () => {
    const d14 = await eligible(t, w.a, w.p1);
    const p2 = await seedProduct(t, { category: w.cat });
    const d15 = await seedOrderItem(t, w.a.id, p2);
    const p3 = await seedProduct(t, { category: w.cat });
    const d16 = await seedOrderItem(t, w.a.id, p3);
    const r14 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 4, orderItem: d14.item });
    const r15 = await seedReview(t, { user: w.a.id, product: p2, status: 'published', rating: 5, orderItem: d15.item });
    const r16 = await seedReview(t, { user: w.a.id, product: p3, status: 'pending', rating: 3, orderItem: d16.item });
    // PRD đã đếm hai đánh giá published (qua ReviewPublished thật của REV, relay thật)
    for (const [id, p, rating] of [[r14, w.p1, 4], [r15, p2, 5]] as const) {
      await t.prisma.$executeRaw`INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at) VALUES (gen_random_uuid(), 'ReviewPublished', 'review', ${id}, ${JSON.stringify({ review_id: id, product_id: p, rating })}::jsonb, 'seed', clock_timestamp())`;
    }
    await relayAll(t);
    expect(await productRating(t, w.p1)).toEqual({ rating_count: 1, rating_sum: 4 });
    const e1 = await patchReview(t, w.a.cookie, r14, { rating: 2, comment: 'Đổi ý, hàng bị phai màu' });
    expect([e1.status, e1.body.status, e1.body.rating]).toEqual([200, 'pending', 2]);
    const tail = (await revOutbox(t, r14)).slice(-1)[0];
    expect([tail.type, tail.payload]).toEqual(['ReviewUnpublished', { review_id: r14, product_id: w.p1, rating: 4 }]); // điểm của bản đã đăng, không phải 2
    await relayAll(t);
    expect(await productRating(t, w.p1)).toEqual({ rating_count: 0, rating_sum: 0 }); // PRD thôi tính điểm cũ khi bản sửa chờ duyệt
    const rj = await moderate(t, w.admin.cookie, r14, 'reject', { reason: 'Chứa thông tin không đúng sự thật' });
    expect([rj.status, rj.body.status]).toEqual([200, 'rejected']);
    expect((await revOutbox(t, r14)).map((e) => [e.type, e.payload.rating])).toEqual([['ReviewPublished', 4], ['ReviewUnpublished', 4]]);
    await relayAll(t);
    expect(await productRating(t, w.p1)).toEqual({ rating_count: 0, rating_sum: 0 });
    // R15: sửa rồi duyệt lại
    await patchReview(t, w.a.cookie, r15, { comment: 'đổi' });
    await moderate(t, w.admin.cookie, r15, 'approve');
    expect((await revOutbox(t, r15)).map((e) => [e.type, e.payload.rating])).toEqual([['ReviewPublished', 5], ['ReviewUnpublished', 5], ['ReviewPublished', 5]]);
    // pending chưa từng published: sửa không phát ReviewUnpublished
    await patchReview(t, w.a.cookie, r16, { rating: 4 });
    expect(await revTypes(t, r16)).toEqual([]);
    await relayAll(t);
    expect(await productRating(t, p2)).toEqual({ rating_count: 1, rating_sum: 5 });
  });
});
