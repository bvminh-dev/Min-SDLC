import { randomUUID } from 'node:crypto';
import { TransactionService, runWithCorrelation, type EventEnvelope } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { call, count, createPrdApp, productRow, seedCategory, seedProduct, type PrdApp } from '../support/prd';
import { q } from '../support/auth';

describe('PRD điểm đánh giá: consumer `catalog` của event REV qua outbox (PRD-REQ-20261006-095502739)', () => {
  let t: PrdApp;
  let cat: string, p1: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.logs.clear();
    cat = await seedCategory(t, 'Áo');
    p1 = await seedProduct(t, { category: cat, ratingCount: 2, ratingSum: 9, images: 1 });
  });
  const R = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const bumped = () => new Date(Date.now() + 10_000 + (bumped.n += 130_000));
  bumped.n = 0;
  /** Phát event vào outbox (như REV) rồi chạy relay thật của platform. */
  const emit = async (type: string, payload: Record<string, unknown>): Promise<string> => {
    const id = await runWithCorrelation('rev-corr', () => t.app.get(TransactionService).run((tx) => t.events.publish(tx, { type, aggregate_type: 'review', aggregate_id: String(payload.review_id), payload })));
    await t.relay.runOnce(bumped());
    return id;
  };
  const rating = async (id = p1) => { const r = await productRow(t, id); return [r.rating_count, r.rating_sum]; };
  const proj = (review: string) => q<{ rating: number; counted: boolean }>(t, `SELECT rating, counted FROM product_review_ratings WHERE review_id = '${review}'`);
  const seedReview = (review: string, product: string, rating_: number, counted: boolean) => t.prisma.$executeRaw`INSERT INTO product_review_ratings (review_id, product_id, rating, counted) VALUES (${review}::uuid, ${product}::uuid, ${rating_}, ${counted})`;
  const processed = () => count(t, 'processed_events', "consumer = 'catalog'");
  const shown = async () => { const d = (await call(t, 'get', `/products/${p1}`)).body, l = (await call(t, 'get', '/products')).body.items[0]; return [d.rating_avg, d.rating_count, l.rating_avg, l.rating_count]; };

  it('PRD-TC-20261006-100356165: ReviewPublished tăng điểm (avg 3,7), ReviewHidden giảm lại (avg 4,5); bản chiếu đúng; mỗi event một dòng ProcessedEvent', async () => {
    await emit('ReviewPublished', { review_id: R(9), product_id: p1, rating: 2 });
    expect(await rating()).toEqual([3, 11]);
    expect(await proj(R(9))).toEqual([{ rating: 2, counted: true }]);
    expect(await shown()).toEqual([3.7, 3, 3.7, 3]);
    await emit('ReviewHidden', { review_id: R(9), product_id: p1, rating: 2 });
    expect(await rating()).toEqual([2, 9]);
    expect(await proj(R(9))).toEqual([{ rating: 2, counted: false }]);
    expect(await shown()).toEqual([4.5, 2, 4.5, 2]);
    expect(await processed()).toBe(2);
  });

  it('PRD-TC-20261006-100356189: event lạ bị bỏ qua có log (sản phẩm không có, review chưa thấy, rating ngoài 1..5); không có endpoint HTTP ghi điểm', async () => {
    const P404 = randomUUID();
    await emit('ReviewPublished', { review_id: R(1), product_id: P404, rating: 4 });
    for (const type of ['ReviewHidden', 'ReviewUnpublished', 'ReviewDeleted']) await emit(type, { review_id: R(77), product_id: p1, rating: 5 });
    await emit('ReviewRatingChanged', { review_id: R(77), product_id: p1, old_rating: 1, new_rating: 5 });
    for (const bad of [7, 0, 4.5, '5', null]) await emit('ReviewPublished', { review_id: R(2), product_id: p1, rating: bad });
    await emit('ReviewPublished', { review_id: 'không-phải-uuid', product_id: p1, rating: 5 });
    await emit('ReviewPublished', { review_id: R(3), product_id: 'không-phải-uuid', rating: 5 });
    expect(await rating()).toEqual([2, 9]);
    expect(await count(t, 'product_review_ratings')).toBe(0);
    const warns = t.logs.records.filter((l) => l.msg?.includes('bỏ qua event điểm đánh giá'));
    expect(warns.length).toBe(12);
    expect(JSON.stringify(warns)).not.toContain('payload');
    // không có HTTP nào ghi điểm
    const a = await call(t, 'post', `/products/${p1}/ratings`, { body: { rating: 5 } }), b = await call(t, 'put', `/products/${p1}`, { body: { rating_avg: 5 } });
    expect([[404, 405].includes(a.status), [404, 405].includes(b.status)]).toEqual([true, true]);
    expect(await rating()).toEqual([2, 9]);
  });

  it('PRD-TC-20261006-100356212: giao trùng không đổi (ProcessedEvent chặn cùng event_id, counted chặn event_id khác); review duy nhất bị ẩn cho avg null; hai event song song cộng đúng 2 (20 lần)', async () => {
    await seedReview(R(9), p1, 4, true); await t.prisma.$executeRaw`UPDATE products SET rating_count = 3, rating_sum = 13 WHERE id = ${p1}::uuid`;
    const env = (id: string, type: string, payload: Record<string, unknown>): EventEnvelope => ({ event_id: id, type, aggregate_type: 'review', aggregate_id: String(payload.review_id), payload, occurred_at: new Date().toISOString(), correlation_id: 'c' });
    const sub = (type: string) => t.events.consumersFor(type).find((s) => s.consumer === 'catalog')!;
    const same = env(randomUUID(), 'ReviewPublished', { review_id: R(9), product_id: p1, rating: 4 });
    expect([await t.events.deliver(sub('ReviewPublished'), same), await t.events.deliver(sub('ReviewPublished'), same)]).toEqual(['processed', 'skipped']); // cùng event_id
    expect(await rating()).toEqual([3, 13]);
    expect(await t.events.deliver(sub('ReviewPublished'), env(randomUUID(), 'ReviewPublished', { review_id: R(9), product_id: p1, rating: 4 }))).toBe('processed'); // event_id khác, review_id đã tính
    expect(await rating()).toEqual([3, 13]);
    expect(await count(t, 'processed_events', "consumer = 'catalog'")).toBe(2);
    // review duy nhất của P2 bị ẩn: count 0, avg null (không NaN, không 0)
    const p2 = await seedProduct(t, { category: cat, ratingCount: 1, ratingSum: 5 });
    await seedReview(R(1), p2, 5, true);
    await emit('ReviewHidden', { review_id: R(1), product_id: p2, rating: 5 });
    expect(await rating(p2)).toEqual([0, 0]);
    expect((await call(t, 'get', `/products/${p2}`)).body).toMatchObject({ rating_count: 0, rating_avg: null });
    // hai ReviewPublished khác nhau của cùng sản phẩm xử lý song song
    for (let i = 0; i < 20; i++) {
      const p = await seedProduct(t, { category: cat });
      await Promise.all([10, 11].map((k) => t.events.deliver(sub('ReviewPublished'), env(randomUUID(), 'ReviewPublished', { review_id: R(1000 + i * 2 + k), product_id: p, rating: k === 10 ? 5 : 3 }))));
      expect(await rating(p)).toEqual([2, 8]);
    }
  }, 60_000);

  it('PRD-TC-20261006-120604121: ReviewRatingChanged đổi tổng khi đang tính (avg 4,7), ReviewDeleted trừ theo điểm đã lưu (avg 4,5); bản chiếu counted = false', async () => {
    await t.prisma.$executeRaw`UPDATE products SET rating_count = 3, rating_sum = 11 WHERE id = ${p1}::uuid`;
    await seedReview(R(9), p1, 2, true); await seedReview(R(4), p1, 5, true);
    await emit('ReviewRatingChanged', { review_id: R(9), product_id: p1, old_rating: 2, new_rating: 5 });
    expect(await rating()).toEqual([3, 14]);
    expect(await shown()).toEqual([4.7, 3, 4.7, 3]);
    await emit('ReviewDeleted', { review_id: R(4), product_id: p1, rating: 99 }); // payload lệch: trừ theo điểm đã lưu (5), không theo payload
    expect(await rating()).toEqual([2, 9]);
    expect(await proj(R(4))).toEqual([{ rating: 5, counted: false }]);
    expect(await proj(R(9))).toEqual([{ rating: 5, counted: true }]);
    expect(await shown()).toEqual([4.5, 2, 4.5, 2]);
    expect(await processed()).toBe(2);
    // đang ẩn: chỉ cập nhật điểm đã lưu, tổng không đổi
    await emit('ReviewRatingChanged', { review_id: R(4), product_id: p1, old_rating: 5, new_rating: 1 });
    expect([await rating(), await proj(R(4))]).toEqual([[2, 9], [{ rating: 1, counted: false }]]);
  });

  it('PRD-TC-20261006-120604215: review hết ẩn được tính lại; ẩn hoặc xóa lặp không trừ hai lần, không số âm; cùng event_id hai lần chỉ một dòng ProcessedEvent', async () => {
    await seedReview(R(3), p1, 4, false);
    await emit('ReviewPublished', { review_id: R(3), product_id: p1, rating: 4 });
    expect([await rating(), (await proj(R(3)))[0].counted]).toEqual([[3, 13], true]);
    await emit('ReviewHidden', { review_id: R(3), product_id: p1, rating: 4 });
    expect(await rating()).toEqual([2, 9]);
    await emit('ReviewHidden', { review_id: R(3), product_id: p1, rating: 4 });
    await emit('ReviewDeleted', { review_id: R(3), product_id: p1, rating: 4 });
    expect(await rating()).toEqual([2, 9]);
    const row = await productRow(t, p1);
    expect(row.rating_count).toBeGreaterThanOrEqual(0);
    expect(row.rating_sum).toBeGreaterThanOrEqual(0);
    const id = randomUUID();
    const sub = t.events.consumersFor('ReviewHidden').find((s) => s.consumer === 'catalog')!;
    const ev: EventEnvelope = { event_id: id, type: 'ReviewHidden', aggregate_type: 'review', aggregate_id: R(3), payload: { review_id: R(3), product_id: p1, rating: 4 }, occurred_at: new Date().toISOString(), correlation_id: 'c' };
    await t.events.deliver(sub, ev); await t.events.deliver(sub, ev);
    expect(await count(t, 'processed_events', `event_id = '${id}'`)).toBe(1);
    expect(await rating()).toEqual([2, 9]);
  });

  it('PRD-TC-20261006-130100111: ReviewUnpublished trừ điểm cũ (lặp không trừ lại), ReviewPublished duyệt bản sửa cộng điểm mới 5; bản sửa bị từ chối thì giữ điểm đã trừ; review lạ là no-op có log', async () => {
    await t.prisma.$executeRaw`UPDATE products SET rating_count = 3, rating_sum = 11 WHERE id = ${p1}::uuid`;
    await seedReview(R(9), p1, 2, true);
    await emit('ReviewUnpublished', { review_id: R(9), product_id: p1, rating: 2 });
    expect(await rating()).toEqual([2, 9]);
    expect(await shown()).toEqual([4.5, 2, 4.5, 2]);
    expect(await proj(R(9))).toEqual([{ rating: 2, counted: false }]);
    await emit('ReviewUnpublished', { review_id: R(9), product_id: p1, rating: 2 }); // event_id khác
    expect(await rating()).toEqual([2, 9]);
    t.logs.clear();
    await emit('ReviewUnpublished', { review_id: R(77), product_id: p1, rating: 2 });
    expect(t.logs.records.some((l) => l.msg?.includes('bỏ qua event điểm đánh giá'))).toBe(true);
    expect(await rating()).toEqual([2, 9]); // bản sửa bị từ chối: không có ReviewPublished
    await emit('ReviewPublished', { review_id: R(9), product_id: p1, rating: 5 });
    expect(await rating()).toEqual([3, 14]);
    expect(await proj(R(9))).toEqual([{ rating: 5, counted: true }]);
    expect(await shown()).toEqual([4.7, 3, 4.7, 3]);
  });
});
