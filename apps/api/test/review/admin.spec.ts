import { randomUUID } from 'node:crypto';
import { seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { freshClock, createRevApp, moderate, seedProduct, seedReview, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
const MIN = 60_000;

describe('REV hàng đợi kiểm duyệt của admin (REV-REQ-20261006-103135744)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const queue = (cookie: string | undefined, qs = '') => call(t, 'get', `/admin/reviews${qs}`, { cookie });
  const base = () => new Date(t.clock.now().getTime() - 6 * 3600_000);
  /** Đánh giá của một khách mới cho P1 (hoặc `product`) tại `at`. */
  async function mk(status: 'pending' | 'published' | 'rejected' | 'hidden' | 'deleted', at: Date, o: { rating?: number; product?: string; name?: string } = {}): Promise<string> {
    const u = await seedUser(t, { email: `k${randomUUID().slice(0, 8)}@shop.vn`, name: o.name ?? 'Nguyễn Văn An' });
    return seedReview(t, { user: u.id, product: o.product ?? w.p1, status, rating: o.rating ?? 5, createdAt: at, moderatedBy: w.admin.id });
  }

  it(`REV-TC-20261006-104527652 hàng đợi mặc định xếp cũ nhất trước và có pending_count; có reviewer.user_id, tên sản phẩm, không email hay điện thoại`, async () => {
    const b = base();
    const [r1, r2, r3] = [await mk('pending', new Date(b.getTime())), await mk('pending', new Date(b.getTime() + 5 * MIN)), await mk('pending', new Date(b.getTime() + 10 * MIN))];
    for (let i = 0; i < 5; i++) await mk('published', b);
    const r = await queue(w.admin.cookie);
    expect([r.status, r.body.items.map((i: any) => i.id), r.body.total, r.body.pending_count, r.headers['cache-control']]).toEqual([200, [r1, r2, r3], 3, 3, 'no-store']);
    const it = r.body.items[0];
    expect([typeof it.reviewer.user_id, it.reviewer.display_name, it.product, it.status]).toEqual(['string', 'An N.', { id: w.p1, name: 'Áo thun cổ tròn' }, 'pending']);
    expect(Object.keys(it).sort()).toEqual(['comment', 'created_at', 'edited_at', 'id', 'images', 'moderated_at', 'moderation_reason', 'product', 'rating', 'reviewer', 'status']);
    expect(JSON.stringify(r.body)).not.toMatch(/@shop\.vn|phone|email|order_item_id/);
  });

  it(`REV-TC-20261006-104527717 lọc đánh giá published theo điểm 1 xếp mới nhất trước; pending_count không đổi theo bộ lọc`, async () => {
    const b = base();
    const ones: string[] = [];
    for (let i = 0; i < 4; i++) ones.push(await mk('published', new Date(b.getTime() + i * 10 * MIN), { rating: 1 }));
    for (let i = 0; i < 5; i++) await mk('published', b, { rating: 3 });
    await mk('pending', b); await mk('pending', b);
    const r = await queue(w.admin.cookie, '?status=published&rating=1');
    expect([r.body.items.map((i: any) => i.id), r.body.total, r.body.pending_count]).toEqual([[...ones].reverse(), 4, 2]);
    const prod = await seedProduct(t, { category: w.cat });
    await mk('published', b, { rating: 1, product: prod });
    expect((await queue(w.admin.cookie, `?status=published&rating=1&product_id=${prod}`)).body.total).toBe(1);
  });

  it(`REV-TC-20261006-104527768 ${SEC} T3: staff, customer (kể cả chủ đánh giá pending) 403 và guest 401 không xem được hàng đợi`, async () => {
    await mk('pending', base());
    const [s, a, g] = [await queue(w.staff.cookie), await queue(w.a.cookie), await queue(undefined)];
    expect([s.status, a.status, g.status]).toEqual([403, 403, 401]);
    for (const r of [s, a, g]) expect([r.body.items, r.body.pending_count]).toEqual([undefined, undefined]);
  });

  it(`REV-TC-20261006-104527829 tham số sai bị 400 gồm status deleted, product_id abc, limit 101, email, rating 0`, async () => {
    for (const qs of ['?status=deleted', '?product_id=abc', '?limit=101', '?email=a@b.vn', '?rating=0', '?status=zzz', '?page=0']) {
      const r = await queue(w.admin.cookie, qs);
      expect([qs, r.status, r.body.items]).toEqual([qs, 400, undefined]);
    }
  });

  it(`REV-TC-20261006-104527875 hàng đợi trống trả danh sách rỗng và pending_count 0`, async () => {
    const r = await queue(w.admin.cookie);
    expect([r.status, r.body]).toEqual([200, { items: [], page: 1, limit: 20, total: 0, pending_count: 0 }]);
  });

  it(`REV-TC-20261006-104527917 ${SEC} T17: đúng 21 đánh giá pending thì trang 2 có 1 mục mới nhất; trang quá cuối rỗng`, async () => {
    const b = base();
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push(await mk('pending', new Date(b.getTime() + i * MIN)));
    const r = await queue(w.admin.cookie, '?page=2&limit=20');
    expect([r.status, r.body.items.map((x: any) => x.id), r.body.total, r.body.pending_count]).toEqual([200, [ids[20]], 21, 21]);
    expect((await queue(w.admin.cookie, '?page=9007199254740991&limit=100')).body.items).toEqual([]);
  }, 120_000);

  it(`REV-TC-20261006-104527955 đánh giá vừa được admin khác duyệt biến khỏi hàng đợi khi tải lại và hiện ở status=published`, async () => {
    const b = base();
    const [r1, r2] = [await mk('pending', b), await mk('pending', new Date(b.getTime() + MIN))];
    expect((await queue(w.admin.cookie)).body.items).toHaveLength(2);
    const e = await seedUser(t, { email: 'e@shop.vn', role: 'admin' });
    const cookie = (await seedSession(t, e.id)).cookie;
    expect((await moderate(t, cookie, r1, 'approve')).status).toBe(200);
    const again = await queue(w.admin.cookie);
    expect([again.body.items.map((i: any) => i.id), again.body.pending_count]).toEqual([[r2], 1]);
    expect((await queue(w.admin.cookie, '?status=published')).body.items.map((i: any) => i.id)).toEqual([r1]);
  });
});
