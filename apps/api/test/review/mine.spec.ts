import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { freshClock, createRevApp, preModeration, seedOrderItem, seedProduct, seedReview, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };
const MIN = 60_000;

describe('REV xem đánh giá của tôi (REV-REQ-20261006-103135655)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const mine = (cookie: string | undefined, qs = '') => call(t, 'get', `/me/reviews${qs}`, { cookie });
  /** Một đánh giá của `who` cho một sản phẩm mới (mỗi (khách, sản phẩm) một đánh giá chưa xóa) tại `at`. */
  async function mk(who: { id: string }, status: 'pending' | 'published' | 'rejected' | 'hidden' | 'deleted', at: Date, o: { name?: string; reason?: string; rating?: number; images?: number } = {}): Promise<{ id: string; product: string }> {
    const product = await seedProduct(t, { category: w.cat, name: o.name ?? `SP ${randomUUID().slice(0, 4)}`, images: 1 });
    const item = await seedOrderItem(t, who.id, product, { daysAgo: 30 });
    const id = await seedReview(t, { user: who.id, product, status, orderItem: item.item, createdAt: at, reason: o.reason, moderatedBy: w.admin.id, rating: o.rating, images: o.images });
    return { id, product };
  }
  const base = () => new Date(t.clock.now().getTime() - 6 * 3600_000);

  it(`REV-TC-20261006-104527184 danh sách của tôi hiện đủ trạng thái, lý do kiểm duyệt và cờ sửa, xóa, edit_requires_review`, async () => {
    const b = base();
    const r1 = await mk(w.a, 'pending', new Date(b.getTime()));
    const r2 = await mk(w.a, 'published', new Date(b.getTime() + 5 * MIN));
    const r3 = await mk(w.a, 'rejected', new Date(b.getTime() + 10 * MIN), { reason: 'Chứa thông tin liên hệ' });
    const r4 = await mk(w.a, 'hidden', new Date(b.getTime() + 15 * MIN), { reason: 'Lời lẽ xúc phạm' });
    await mk(w.a, 'deleted', new Date(b.getTime() + 20 * MIN));
    await mk(w.b, 'published', b);
    const r = await mine(w.a.cookie);
    expect([r.status, r.headers['cache-control'], r.body.total, r.body.page, r.body.limit]).toEqual([200, 'no-store', 4, 1, 20]);
    expect(r.body.items.map((i: any) => i.id)).toEqual([r4.id, r3.id, r2.id, r1.id]);
    const by = Object.fromEntries(r.body.items.map((i: any) => [i.id, i]));
    expect([by[r3.id].moderation_reason, by[r4.id].moderation_reason, 'moderation_reason' in by[r1.id], 'moderation_reason' in by[r2.id]]).toEqual(['Chứa thông tin liên hệ', 'Lời lẽ xúc phạm', false, false]);
    expect([by[r1.id].can_edit, by[r2.id].can_edit, by[r3.id].can_edit, by[r4.id].can_edit]).toEqual([true, true, false, false]);
    expect(r.body.items.every((i: any) => i.can_delete === true)).toBe(true);
    expect([by[r2.id].edit_requires_review, by[r1.id].edit_requires_review, by[r3.id].edit_requires_review, by[r4.id].edit_requires_review]).toEqual([true, false, false, false]);
    expect(by[r2.id].product).toMatchObject({ id: r2.product, status: 'active' });
    expect(JSON.stringify(r.body)).not.toMatch(/user_id|order_item_id/);
    const off = preModeration(t, false);
    expect((await mine(w.a.cookie)).body.items.find((i: any) => i.id === r2.id).edit_requires_review).toBe(false);
    off();
  });

  it(`REV-TC-20261006-104527235 lọc theo trạng thái published chỉ trả đánh giá đã đăng`, async () => {
    const b = base();
    const r1 = await mk(w.a, 'pending', b); const r2 = await mk(w.a, 'published', new Date(b.getTime() + MIN));
    expect((await mine(w.a.cookie, '?status=published')).body).toMatchObject({ total: 1, items: [{ id: r2.id }] });
    expect((await mine(w.a.cookie, '?status=pending')).body.items.map((i: any) => i.id)).toEqual([r1.id]);
    expect((await mine(w.a.cookie, '?status=hidden')).body).toMatchObject({ total: 0, items: [] });
  });

  it(`REV-TC-20261006-104527298 ${SEC} T1, T2: xem chi tiết đánh giá của người khác, đã xóa hoặc id sai định dạng cùng trả 404 cùng thân`, async () => {
    const r9 = await mk(w.b, 'published', base()); const r5 = await mk(w.a, 'deleted', base());
    const bodies = [];
    for (const id of [r9.id, r5.id, randomUUID(), 'abc']) { const r = await call(t, 'get', `/me/reviews/${id}`, { cookie: w.a.cookie }); expect([id, r.status]).toEqual([id, 404]); bodies.push(JSON.stringify(strip(r.body))); }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('Rất tốt');
    const own = await mk(w.a, 'published', base());
    const ok = await call(t, 'get', `/me/reviews/${own.id}`, { cookie: w.a.cookie });
    expect([ok.status, ok.body.id, ok.headers['cache-control']]).toEqual([200, own.id, 'no-store']);
  });

  it(`REV-TC-20261006-104527360 guest 401, staff và admin 403 khi xem đánh giá của tôi`, async () => {
    await mk(w.a, 'published', base());
    const [g, s, d] = [await mine(undefined), await mine(w.staff.cookie), await mine(w.admin.cookie)];
    expect([g.status, s.status, d.status]).toEqual([401, 403, 403]);
    expect([g.body.items, s.body.items, d.body.items]).toEqual([undefined, undefined, undefined]);
    const one = await mk(w.a, 'published', base());
    expect([(await call(t, 'get', `/me/reviews/${one.id}`, { cookie: w.staff.cookie })).status, (await call(t, 'get', `/me/reviews/${one.id}`)).status]).toEqual([403, 401]);
  });

  it(`REV-TC-20261006-104527404 ${SEC} T1: tham số sai: status deleted, limit 0 và user_id của người khác bị 400`, async () => {
    for (let i = 0; i < 3; i++) await mk(w.b, 'published', base());
    for (const qs of ['?status=deleted', '?limit=0', `?user_id=${w.b.id}`, '?status=abc', '?page=0', '?status=pending&status=published']) {
      const r = await mine(w.a.cookie, qs);
      expect([qs, r.status, r.body.items]).toEqual([qs, 400, undefined]);
    }
  });

  it(`REV-TC-20261006-104527469 khách chưa viết đánh giá nào nhận danh sách rỗng`, async () => {
    const r = await mine(w.a.cookie);
    expect([r.status, r.body]).toEqual([200, { items: [], page: 1, limit: 20, total: 0 }]);
  });

  it(`REV-TC-20261006-104527537 sản phẩm đã archived vẫn hiện tên trong danh sách của chủ, can_edit và can_delete theo trạng thái đánh giá`, async () => {
    const r1 = await mk(w.a, 'published', base(), { name: 'Áo thun cổ tròn' });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${r1.product}::uuid`;
    const l = await mine(w.a.cookie);
    const one = await call(t, 'get', `/me/reviews/${r1.id}`, { cookie: w.a.cookie });
    for (const item of [l.body.items[0], one.body]) expect([item.product.name, item.product.status, item.can_edit, item.can_delete]).toEqual(['Áo thun cổ tròn', 'archived', true, true]);
    expect((await call(t, 'get', `/products/${r1.product}/reviews`)).status).toBe(404);
  });

  it(`REV-TC-20261006-104527598 ${SEC} T17: đúng 21 đánh giá thì trang 2 chỉ có 1 mục cũ nhất; trang quá cuối rỗng`, async () => {
    const b = base();
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push((await mk(w.a, 'published', new Date(b.getTime() + i * MIN))).id);
    const p2 = await mine(w.a.cookie, '?page=2&limit=20');
    expect([p2.status, p2.body.items.map((x: any) => x.id), p2.body.total, p2.body.page, p2.body.limit]).toEqual([200, [ids[0]], 21, 2, 20]);
    expect((await mine(w.a.cookie, '?page=3&limit=20')).body.items).toEqual([]);
    expect((await mine(w.a.cookie, '?page=9007199254740991&limit=100')).body.items).toEqual([]);
  }, 120_000);
});
