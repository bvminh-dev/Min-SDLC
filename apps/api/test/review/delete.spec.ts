import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { freshClock, createReview, createRevApp, deleteReview, eligible, imageRows, moderate, q, revAudits, revCount, revOutbox, revTypes, reviewRow, seedOrderItem, seedProduct, seedReview, world, call, failingTrigger, type RevApp, type World } from '../support/rev';
import { race } from '../support/ord';

const SEC = 'REV-SEC-20261006-103618395';
const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };

describe('REV xóa đánh giá (REV-REQ-20261006-103135477)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });

  it(`REV-TC-20261006-104526283 customer xóa đánh giá published của mình: 204, xóa mềm, ảnh mồ côi, ReviewDeleted cùng giao dịch, không audit, viết lại được`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r1 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 5, orderItem: d.item, images: 2 });
    const x = await deleteReview(t, w.a.cookie, r1);
    expect([x.status, x.text]).toEqual([204, '']);
    const row = await reviewRow(t, r1);
    expect([row.status, row.deleted_at !== null, row.deleted_by_role]).toEqual(['deleted', true, 'customer']);
    expect((await call(t, 'get', `/products/${w.p1}/reviews`)).body).toMatchObject({ items: [], summary: { count: 0, avg: null } });
    expect((await call(t, 'get', '/me/reviews', { cookie: w.a.cookie })).body.items).toEqual([]);
    const imgs = await imageRows(t);
    expect(imgs.every((i) => i.review_id === null && i.position === null && i.orphaned_at !== null)).toBe(true);
    expect((await revOutbox(t, r1)).map((e) => [e.type, e.payload])).toEqual([['ReviewDeleted', { review_id: r1, product_id: w.p1, rating: 5 }]]);
    expect(await revAudits(t)).toEqual([]);
    const again = await createReview(t, w.a.cookie, w.p1, { rating: 4 });
    expect(again.status).toBe(201);
  });

  it(`REV-TC-20261006-104526332 ${SEC} T14: admin xóa đánh giá vi phạm và ghi audit cùng giao dịch (không chứa nội dung bình luận)`, async () => {
    const d = await eligible(t, w.b, w.p1);
    const r2 = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', rating: 2, comment: 'SECRET-COMMENT-1234', orderItem: d.item });
    const x = await deleteReview(t, w.admin.cookie, r2);
    expect(x.status).toBe(204);
    const row = await reviewRow(t, r2);
    expect([row.status, row.deleted_by_role]).toEqual(['deleted', 'admin']);
    const audits = await revAudits(t, r2);
    expect(audits).toHaveLength(1);
    expect([audits[0].actor_id, audits[0].actor_role, audits[0].action, audits[0].target_type, audits[0].before.status, audits[0].after.status, audits[0].before.product_id]).toEqual([w.admin.id, 'admin', 'review.delete', 'review', 'published', 'deleted', w.p1]);
    expect(JSON.stringify(audits)).not.toContain('SECRET-COMMENT-1234');
    expect(audits[0].created_at).toBeInstanceOf(Date);
    expect((await revOutbox(t, r2)).map((e) => [e.type, e.payload])).toEqual([['ReviewDeleted', { review_id: r2, product_id: w.p1, rating: 2 }]]);
    // rollback: ép lỗi ghi audit thì đánh giá vẫn published và không có dòng outbox mới
    const d3 = await eligible(t, w.a, w.p1);
    const r3 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', orderItem: d3.item });
    await failingTrigger(t, 'audit_logs', async () => {
      const bad = await deleteReview(t, w.admin.cookie, r3);
      expect(bad.status).toBe(500);
    });
    expect((await reviewRow(t, r3)).status).toBe('published');
    expect(await revTypes(t, r3)).toEqual([]);
  });

  it(`REV-TC-20261006-104526385 ${SEC} T1: customer xóa đánh giá của người khác hoặc không tồn tại cùng trả 404 cùng thân`, async () => {
    const d = await eligible(t, w.b, w.p1);
    const r3 = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', orderItem: d.item });
    const bodies = [];
    for (const id of [r3, randomUUID(), 'abc']) { const x = await deleteReview(t, w.a.cookie, id); expect(x.status).toBe(404); bodies.push(strip(x.body)); }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect((await reviewRow(t, r3)).status).toBe('published');
    expect([await revTypes(t), await revAudits(t)]).toEqual([[], []]);
    const adminMissing = await deleteReview(t, w.admin.cookie, randomUUID());
    expect(adminMissing.status).toBe(404);
  });

  it(`REV-TC-20261006-104526433 xóa đánh giá pending hoặc rejected thành công, phát ReviewDeleted và nhường chỗ để viết lại`, async () => {
    const p5 = await seedProduct(t, { category: w.cat });
    const d4 = await eligible(t, w.a, w.p1);
    const d5 = await seedOrderItem(t, w.a.id, p5);
    const r4 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending', rating: 3, orderItem: d4.item });
    const r4b = await seedReview(t, { user: w.a.id, product: p5, status: 'rejected', rating: 2, orderItem: d5.item, moderatedBy: w.admin.id });
    expect([(await deleteReview(t, w.a.cookie, r4)).status, (await deleteReview(t, w.a.cookie, r4b)).status]).toEqual([204, 204]);
    for (const id of [r4, r4b]) { const row = await reviewRow(t, id); expect([row.status, row.deleted_by_role]).toEqual(['deleted', 'customer']); }
    expect((await call(t, 'get', '/me/reviews', { cookie: w.a.cookie })).body.items).toEqual([]);
    expect((await revOutbox(t)).map((e) => [e.type, e.payload.review_id, e.payload.rating]).sort()).toEqual([['ReviewDeleted', r4, 3], ['ReviewDeleted', r4b, 2]].sort());
    expect(await revAudits(t)).toEqual([]);
    expect([(await createReview(t, w.a.cookie, w.p1, { rating: 4 })).status, (await createReview(t, w.a.cookie, p5, { rating: 4 })).status]).toEqual([201, 201]);
  });

  it(`REV-TC-20261006-104526488 staff 403 và guest 401 khi xóa đánh giá`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r5 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', orderItem: d.item });
    const [s, g] = [await deleteReview(t, w.staff.cookie, r5), await deleteReview(t, undefined, r5)];
    expect([s.status, g.status]).toEqual([403, 401]);
    expect((await reviewRow(t, r5)).status).toBe('published');
  });

  it(`REV-TC-20261006-104526559 ${SEC} T12: bấm xóa hai lần đồng thời chỉ một lần thành công (50 vòng)`, async () => {
    const d = await eligible(t, w.a, w.p1);
    for (let i = 0; i < 50; i++) {
      await t.prisma.$executeRaw`DELETE FROM outbox_events`; await t.prisma.$executeRaw`DELETE FROM review_images`; await t.prisma.$executeRaw`DELETE FROM reviews`; await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
      const r6 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', orderItem: d.item, images: 1 });
      const [x, y] = await race(() => deleteReview(t, w.a.cookie, r6), () => deleteReview(t, w.a.cookie, r6));
      expect([i, [x.status, y.status].sort()]).toEqual([i, [204, 404]]);
      expect([i, await revTypes(t, r6)]).toEqual([i, ['ReviewDeleted']]);
      const imgs = await imageRows(t);
      expect([i, imgs.length, imgs[0].orphaned_at !== null]).toEqual([i, 1, true]);
      expect((await reviewRow(t, r6)).deleted_at).not.toBeNull();
    }
  }, 120_000);

  it(`REV-TC-20261006-104526616 đánh giá hidden xóa được, phát ReviewDeleted một lần, nhường chỗ; admin xóa ghi audit trạng thái trước hidden`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r7 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 3, orderItem: d.item });
    expect((await moderate(t, w.admin.cookie, r7, 'hide', { reason: 'xấu' })).status).toBe(200);
    expect((await revTypes(t, r7))).toEqual(['ReviewHidden']);
    const e = await deleteReview(t, w.admin.cookie, r7);
    const a = await deleteReview(t, w.a.cookie, r7);
    expect([e.status, a.status]).toEqual([204, 404]);
    const row = await reviewRow(t, r7);
    expect([row.status, row.deleted_by_role]).toEqual(['deleted', 'admin']);
    const del = (await revAudits(t, r7)).filter((x) => x.action === 'review.delete');
    expect(del).toHaveLength(1);
    expect(del[0].before.status).toBe('hidden');
    expect(await revTypes(t, r7)).toEqual(['ReviewHidden', 'ReviewDeleted']);
    expect((await createReview(t, w.a.cookie, w.p1, { rating: 4 })).status).toBe(201);
    expect(await revCount(t, `user_id = '${w.a.id}' AND status <> 'deleted'`)).toBe(1);
    expect(await q(t, 'SELECT 1')).toBeTruthy();
  });
});
