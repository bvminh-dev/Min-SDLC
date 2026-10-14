import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { freshClock, createReview, createRevApp, eligible, revCount, seedOrderItem, seedProduct, seedReview, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
const DAY = 86_400_000;

describe('REV mua có xác minh (REV-REQ-20261006-103135296)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const elig = (cookie: string | undefined, p: string) => call(t, 'get', `/products/${p}/review-eligibility`, { cookie });
  const prod = (name?: string) => seedProduct(t, { category: w.cat, name });

  it(`REV-TC-20261006-104525433 khách đã nhận hàng được báo đủ điều kiện và đánh giá gắn đúng dòng đơn, hiển thị đã mua hàng`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const e = await elig(w.a.cookie, w.p1);
    expect([e.status, e.body]).toEqual([200, { eligible: true, reason: null }]);
    expect(e.headers['cache-control']).toBe('no-store');
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 5 });
    expect(r.status).toBe(201);
    expect((await call(t, 'get', '/me/reviews', { cookie: w.a.cookie })).body.items).toHaveLength(1);
    const row = (await t.prisma.$queryRaw<{ order_item_id: string }[]>`SELECT order_item_id FROM reviews WHERE id = ${r.body.id}::uuid`)[0];
    expect(row.order_item_id).toBe(d.item);
    await t.prisma.$executeRaw`UPDATE reviews SET status = 'published', published_at = now() WHERE id = ${r.body.id}::uuid`;
    const pub = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect(pub.body.items[0].verified_purchase).toBe(true);
  });

  it(`REV-TC-20261006-104525491 ${SEC} T5: chưa mua, đơn chưa giao, đơn đã hủy và đơn của người khác đều không cho đánh giá`, async () => {
    const [p2, p3, p4, p6, p7, p8, p9, p10, p11] = [await prod(), await prod(), await prod(), await prod(), await prod(), await prod(), await prod(), await prod(), await prod()];
    await seedOrderItem(t, w.a.id, p3, { status: 'shipped' });
    await seedOrderItem(t, w.a.id, p4, { status: 'cancelled' });
    await seedOrderItem(t, w.b.id, p6, { status: 'delivered' });
    for (const [p, st] of [[p7, 'pending'], [p8, 'confirmed'], [p9, 'paid']] as const) await seedOrderItem(t, w.a.id, p, { status: st });
    await seedOrderItem(t, w.a.id, p10, { status: 'expired' });
    await seedOrderItem(t, w.a.id, p11, { status: 'returned' });
    const want: [string, string][] = [[p2, 'not_purchased'], [p3, 'not_delivered'], [p4, 'not_purchased'], [p6, 'not_purchased'], [p7, 'not_delivered'], [p8, 'not_delivered'], [p9, 'not_delivered'], [p10, 'not_purchased'], [p11, 'not_purchased']];
    for (const [p, reason] of want) {
      expect([p, (await elig(w.a.cookie, p)).body]).toEqual([p, { eligible: false, reason }]);
      const r = await createReview(t, w.a.cookie, p, { rating: 5 });
      expect([p, r.status, r.body.code]).toEqual([p, 409, reason]);
    }
    expect(await revCount(t)).toBe(0);
    await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
    await seedOrderItem(t, w.a.id, p3, { status: 'delivered', daysAgo: 1 }); // sau khi nhận hàng: đủ điều kiện (đơn chưa giao còn lại không cản)
    expect((await elig(w.a.cookie, p3)).body).toEqual({ eligible: true, reason: null });
  });

  it(`REV-TC-20261006-104525553 ${SEC} T5: đơn giao 91 ngày trước bị từ chối window_expired`, async () => {
    const p5 = await prod();
    await seedOrderItem(t, w.a.id, p5, { deliveredAt: new Date(t.clock.now().getTime() - 91 * DAY) });
    expect((await elig(w.a.cookie, p5)).body).toEqual({ eligible: false, reason: 'window_expired' });
    const r = await createReview(t, w.a.cookie, p5, { rating: 5 });
    expect([r.status, r.body.code]).toEqual([409, 'window_expired']);
    expect(await revCount(t)).toBe(0);
  });

  it(`REV-TC-20261006-104525611 guest 401, staff và admin 403 khi hỏi điều kiện đánh giá; sản phẩm không tồn tại hoặc archived 404`, async () => {
    await eligible(t, w.a, w.p1);
    const [g, s, d] = [await elig(undefined, w.p1), await elig(w.staff.cookie, w.p1), await elig(w.admin.cookie, w.p1)];
    expect([g.status, s.status, d.status]).toEqual([401, 403, 403]);
    expect(JSON.stringify([s.body, d.body])).not.toMatch(/order|đơn/i);
    const pa = await seedProduct(t, { category: w.cat, status: 'archived' });
    const pd = await seedProduct(t, { category: w.cat, status: 'draft' });
    const bodies = [];
    for (const id of [randomUUID(), pa, pd, 'abc']) { const r = await elig(w.a.cookie, id); expect([id, r.status]).toEqual([id, 404]); const { trace_id: _t, ...rest } = r.body; bodies.push(rest); }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it(`REV-TC-20261006-104525678 ngưỡng đúng 90 ngày được nhận, quá một giây bị từ chối`, async () => {
    const [p7, p8] = [await prod(), await prod()];
    const now = t.clock.now().getTime();
    await seedOrderItem(t, w.a.id, p7, { deliveredAt: new Date(now - 90 * DAY) });
    await seedOrderItem(t, w.a.id, p8, { deliveredAt: new Date(now - 90 * DAY - 1000) });
    expect((await createReview(t, w.a.cookie, p7, { rating: 5 })).status).toBe(201);
    const r = await createReview(t, w.a.cookie, p8, { rating: 5 });
    expect([r.status, r.body.code]).toEqual([409, 'window_expired']);
    // cùng một thời điểm UTC bất kể múi giờ của tiến trình
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try { expect((await elig(w.a.cookie, p8)).body.reason).toBe('window_expired'); } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  });

  it(`REV-TC-20261006-104525730 hai dòng đơn cùng sản phẩm chọn dòng đã giao gần nhất còn trong cửa sổ`, async () => {
    const p8 = await prod();
    const now = t.clock.now().getTime();
    const y = await seedOrderItem(t, w.a.id, p8, { deliveredAt: new Date(now - 10 * DAY) }); // dựng Y trước X: không dựa vào thứ tự chèn
    await seedOrderItem(t, w.a.id, p8, { deliveredAt: new Date(now - 91 * DAY) });
    const r = await createReview(t, w.a.cookie, p8, { rating: 4 });
    expect(r.status).toBe(201);
    expect((await t.prisma.$queryRaw<{ order_item_id: string }[]>`SELECT order_item_id FROM reviews WHERE id = ${r.body.id}::uuid`)[0].order_item_id).toBe(y.item);
    expect((await elig(w.a.cookie, p8)).body).toEqual({ eligible: false, reason: 'already_reviewed' }); // một đánh giá mỗi sản phẩm
    // nhiều dòng trong cửa sổ: chọn dòng giao gần nhất
    const p9 = await prod();
    await seedOrderItem(t, w.b.id, p9, { deliveredAt: new Date(now - 30 * DAY) });
    const near = await seedOrderItem(t, w.b.id, p9, { deliveredAt: new Date(now - 2 * DAY) });
    await seedOrderItem(t, w.b.id, p9, { deliveredAt: new Date(now - 60 * DAY) });
    const rb = await createReview(t, w.b.cookie, p9, { rating: 4 });
    expect((await t.prisma.$queryRaw<{ order_item_id: string }[]>`SELECT order_item_id FROM reviews WHERE id = ${rb.body.id}::uuid`)[0].order_item_id).toBe(near.item);
  });

  it(`REV-TC-20261006-104525777 đánh giá bị ẩn vẫn giữ chỗ nên khách bị báo already_reviewed (ưu tiên trước mọi mã khác)`, async () => {
    const p9 = await prod();
    const d = await seedOrderItem(t, w.a.id, p9, { daysAgo: 20 });
    await seedReview(t, { user: w.a.id, product: p9, status: 'hidden', orderItem: d.item, moderatedBy: w.admin.id });
    expect((await elig(w.a.cookie, p9)).body).toEqual({ eligible: false, reason: 'already_reviewed' });
    const r = await createReview(t, w.a.cookie, p9, { rating: 4 });
    expect([r.status, r.body.code]).toEqual([409, 'already_reviewed']);
    // already_reviewed đứng trước window_expired
    await t.prisma.$executeRaw`UPDATE orders SET delivered_at = now() - interval '200 days' WHERE id = ${d.order.id}::uuid`;
    expect((await elig(w.a.cookie, p9)).body.reason).toBe('already_reviewed');
  });
  it(`REV-TC-20261013-223014373 ${SEC} đơn hoàn trả hoặc hủy SAU khi đã đánh giá không gỡ đánh giá: vẫn hiện nhãn Đã mua hàng và giữ chỗ already_reviewed (v1, BR9); xóa rồi thì not_purchased`, async () => {
    for (const status of ['returned', 'cancelled'] as const) {
      const p = await prod(`Hàng ${status}`);
      const d = await seedOrderItem(t, w.a.id, p, { daysAgo: 20 });
      const r = await seedReview(t, { user: w.a.id, product: p, status: 'published', orderItem: d.item, rating: 4 });
      // ORD v1 coi `delivered` là trạng thái cuối nên tình huống này dựng bằng sửa thẳng CSDL (CHECK `orders_delivered_at`, `orders_cancel_pair` và `orders_tracking_status`: `delivered_at` chỉ có ở đơn `delivered`, đơn `cancelled` phải có lý do, vai trò hủy và không có mã vận đơn)
      await t.prisma.$executeRaw`UPDATE orders SET status = ${status}::order_status, delivered_at = NULL, tracking_number = CASE WHEN ${status} = 'cancelled' THEN NULL ELSE tracking_number END, cancel_reason = ${status === 'cancelled' ? 'customer_request' : null}::order_cancel_reason, cancelled_by_role = ${status === 'cancelled' ? 'customer' : null}::order_actor_role WHERE id = ${d.order.id}::uuid`;
      const pub = await call(t, 'get', `/products/${p}/reviews`);
      expect([status, pub.status, pub.body.items.map((i: any) => [i.id, i.verified_purchase]), pub.body.summary.count]).toEqual([status, 200, [[r, true]], 1]);
      expect([status, (await elig(w.a.cookie, p)).body]).toEqual([status, { eligible: false, reason: 'already_reviewed' }]);
      const again = await createReview(t, w.a.cookie, p, { rating: 5 });
      expect([status, again.status, again.body.code]).toEqual([status, 409, 'already_reviewed']);
      expect((await call(t, 'delete', `/reviews/${r}`, { cookie: w.a.cookie })).status).toBe(204);
      expect((await call(t, 'get', `/products/${p}/reviews`)).body.items).toEqual([]);
      expect([status, (await elig(w.a.cookie, p)).body]).toEqual([status, { eligible: false, reason: 'not_purchased' }]); // đơn không còn `delivered`
    }
  });
});
