import { randomUUID } from 'node:crypto';
import { seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { maskName } from '../../src/modules/review/deps.service';
import { freshClock, createRevApp, eligible, imageRows, seedImageRow, seedProduct, seedReview, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };
const MIN = 60_000;

describe('REV xem đánh giá công khai (REV-REQ-20261006-103135566, ...135029 BR3)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const list = (p: string, qs = '', cookie?: string) => call(t, 'get', `/products/${p}/reviews${qs}`, { cookie });
  /** n đánh giá published của P với điểm cho trước, mỗi cái một khách riêng, published_at tăng dần mỗi phút. */
  async function many(p: string, ratings: number[], o: { start?: Date; comment?: (i: number) => string } = {}): Promise<string[]> {
    const ids: string[] = [];
    const start = o.start ?? new Date(t.clock.now().getTime() - ratings.length * MIN - 3600_000);
    for (const [i, rating] of ratings.entries()) {
      const u = await seedUser(t, { email: `u${i}-${randomUUID().slice(0, 6)}@shop.vn`, name: `Khách Số ${i}` });
      const at = new Date(start.getTime() + i * MIN);
      ids.push(await seedReview(t, { user: u.id, product: p, status: 'published', rating, comment: o.comment ? o.comment(i) : `bình luận ${i}`, createdAt: at, publishedAt: at }));
    }
    return ids;
  }

  it(`REV-TC-20261006-104524378 tổng hợp điểm từ ba đánh giá published cho avg 3.7 và phân bố đúng; pending không tính`, async () => {
    await many(w.p1, [5, 4, 2]);
    for (const i of [1, 2]) { const u = await seedUser(t, { email: `pe${i}@shop.vn` }); await seedReview(t, { user: u.id, product: w.p1, status: 'pending', rating: 1 }); }
    const r = await list(w.p1);
    expect(r.body.summary).toEqual({ count: 3, avg: 3.7, distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 } });
    expect([r.body.total, r.body.items.length]).toEqual([3, 3]);
  });

  it(`REV-TC-20261006-104524472 biên điểm 1 và 5 hợp lệ và làm tròn nửa lên ở avg 4.5, 1.5, 4.3, 3.8`, async () => {
    const [p4, p5, p6, p7] = [await seedProduct(t, { category: w.cat }), await seedProduct(t, { category: w.cat }), await seedProduct(t, { category: w.cat }), await seedProduct(t, { category: w.cat })];
    await many(p4, [4, 5]); await many(p5, [1, 2]); await many(p6, [4, 4, 5]); await many(p7, [5, 4, 4, 2]);
    expect((await list(p4)).body.summary.avg).toBe(4.5);
    expect((await list(p5)).body.summary.avg).toBe(1.5);
    expect((await list(p6)).body.summary.avg).toBe(4.3);
    expect((await list(p7)).body.summary.avg).toBe(3.8); // 15 / 4 = 3.75 làm tròn nửa lên
    const exact = await seedProduct(t, { category: w.cat });
    await many(exact, [1, 1, 1, 1, 1, 1, 1, 1, 1, 2]); // 11 / 10 = 1.1 (không sai số số thực)
    expect((await list(exact)).body.summary.avg).toBe(1.1);
    const e2 = await seedProduct(t, { category: w.cat });
    await many(e2, [2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3]); // 50 / 20 = 2.5
    expect((await list(e2)).body.summary.avg).toBe(2.5);
  });

  it(`REV-TC-20261006-104524515 sản phẩm chưa có đánh giá published cho avg null và phân bố toàn 0 (đủ năm khóa)`, async () => {
    const p3 = await seedProduct(t, { category: w.cat });
    const [u1, u2] = [await seedUser(t, { email: 'x1@shop.vn' }), await seedUser(t, { email: 'x2@shop.vn' })];
    await seedReview(t, { user: u1.id, product: p3, status: 'pending', rating: 5 });
    await seedReview(t, { user: u2.id, product: p3, status: 'hidden', rating: 5 });
    const r = await list(p3);
    expect(r.body.summary).toEqual({ count: 0, avg: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    expect([r.body.items, r.body.total]).toEqual([[], 0]);
    expect(r.body.summary.avg).not.toBe(0);
  });

  it(`REV-TC-20261006-104526681 ${SEC} T11: danh sách công khai phân trang 20 mục và loại hết đánh giá chưa published`, async () => {
    await many(w.p1, Array.from({ length: 25 }, (_, i) => (i % 5) + 1));
    for (const st of ['pending', 'pending', 'pending', 'rejected', 'rejected', 'hidden', 'hidden', 'deleted', 'deleted'] as const) {
      const u = await seedUser(t, { email: `o${randomUUID().slice(0, 8)}@shop.vn` });
      await seedReview(t, { user: u.id, product: w.p1, status: st, rating: 1, comment: `ẩn ${st}`, moderatedBy: w.admin.id });
    }
    const r = await list(w.p1);
    expect([r.status, r.body.items.length, r.body.total, r.body.page, r.body.limit, r.body.summary.count]).toEqual([200, 20, 25, 1, 20, 25]);
    const times = r.body.items.map((i: any) => i.published_at);
    expect(times).toEqual([...times].sort().reverse());
    expect(JSON.stringify(r.body)).not.toMatch(/user_id|order_item_id|moderation_reason|"status"|ẩn (pending|rejected|hidden|deleted)/);
    const p2 = await list(w.p1, '?page=2');
    expect(p2.body.items).toHaveLength(5);
    expect(new Set([...r.body.items, ...p2.body.items].map((i: any) => i.id)).size).toBe(25);
    for (const i of r.body.items) expect(Object.keys(i).sort()).toEqual(['comment', 'edited_at', 'id', 'images', 'published_at', 'rating', 'reviewer', 'verified_purchase']);
  });

  it(`REV-TC-20261006-104526741 lọc theo số sao và sắp xếp điểm cao, điểm thấp (cùng điểm thì mới nhất trước)`, async () => {
    const [a, b, c, d] = await many(w.p1, [5, 4, 4, 2]);
    const ids = async (qs: string) => (await list(w.p1, qs)).body;
    const f = await ids('?rating=4');
    expect([f.items.map((i: any) => i.id), f.total, f.summary.count]).toEqual([[c, b], 2, 4]);
    expect((await ids('?sort=highest')).items.map((i: any) => i.id)).toEqual([a, c, b, d]);
    expect((await ids('?sort=lowest')).items.map((i: any) => i.id)).toEqual([d, c, b, a]);
    expect((await ids('?sort=newest')).items.map((i: any) => i.id)).toEqual([d, c, b, a]);
  });

  it(`REV-TC-20261006-104526797 sản phẩm không tồn tại, archived, draft hoặc id sai định dạng cùng 404, không rò số đánh giá`, async () => {
    const [pa, pd] = [await seedProduct(t, { category: w.cat, status: 'archived' }), await seedProduct(t, { category: w.cat, status: 'draft' })];
    await many(pa, [5, 5]);
    const bodies = [];
    for (const id of [randomUUID(), pa, pd, 'abc']) { const r = await list(id); expect([id, r.status]).toEqual([id, 404]); bodies.push(JSON.stringify(strip(r.body))); }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/summary|total|count/);
  });

  it(`REV-TC-20261006-104526852 ${SEC} T17: tham số sai bị 400 gồm limit 101, page 0, rating 6, sort lạ, user_id; limit 100 và 1 hợp lệ`, async () => {
    await many(w.p1, [5]);
    const out: Record<string, number> = {};
    for (const qs of ['?limit=101', '?page=0', '?rating=6', '?rating=0', '?rating=4.5', '?sort=random', `?user_id=${randomUUID()}`, '?limit=abc', '?page=-1', '?page=1&page=2', "?sort=newest'--", '?limit=1%27']) {
      const r = await list(w.p1, qs);
      out[qs] = r.status;
      expect([qs, r.body.items]).toEqual([qs, undefined]);
    }
    expect(Object.values(out).every((s) => s === 400)).toBe(true);
    expect((await list(w.p1, '?limit=101')).body.errors[0]).toMatchObject({ field: 'limit' });
    expect([(await list(w.p1, '?limit=100')).status, (await list(w.p1, '?limit=1')).status]).toEqual([200, 200]);
  });

  it(`REV-TC-20261006-104526911 sản phẩm chưa có đánh giá trả danh sách rỗng và summary 0`, async () => {
    const p2 = await seedProduct(t, { category: w.cat });
    const r = await list(p2);
    expect([r.status, r.body]).toEqual([200, { items: [], page: 1, limit: 20, total: 0, summary: { count: 0, avg: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } } }]);
  });

  it(`REV-TC-20261006-104526974 ${SEC} T17: trang vượt quá trang cuối trả 200 với danh sách rỗng, kể cả page cực lớn (không đẩy số lớn vào CSDL)`, async () => {
    await many(w.p1, Array.from({ length: 25 }, () => 5));
    const p3 = await list(w.p1, '?page=3&limit=20');
    expect([p3.status, p3.body.items, p3.body.total]).toEqual([200, [], 25]);
    expect((await list(w.p1, '?page=2&limit=20')).body.items).toHaveLength(5);
    for (const page of ['9007199254740991', '99999999999999']) { const r = await list(w.p1, `?page=${page}&limit=100`); expect([page, r.status, r.body.items]).toEqual([page, 200, []]); }
    expect((await list(w.p1, '?page=9007199254740992')).status).toBe(400); // ngoài số nguyên an toàn
  });

  it(`REV-TC-20261006-104527032 ${SEC} T10, T11: đánh giá pending của chính tác giả không có ở danh sách công khai; tên được che, không lộ user_id, email, ảnh không có EXIF`, async () => {
    const [da, db, dc] = [await eligible(t, w.a, w.p1), await eligible(t, w.b, w.p1), await eligible(t, w.c, w.p1)];
    const ra = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending', orderItem: da.item });
    await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', orderItem: db.item, comment: 'của B', images: 1 });
    await seedReview(t, { user: w.c.id, product: w.p1, status: 'published', orderItem: dc.item, comment: 'của C' });
    const mine = await list(w.p1, '', w.a.cookie); // chính A: được xử lý như guest
    expect(mine.body.items.map((i: any) => i.comment).sort()).toEqual(['của B', 'của C']);
    const names = Object.fromEntries(mine.body.items.map((i: any) => [i.comment, i.reviewer.display_name]));
    expect(names).toEqual({ 'của B': 'Lê', 'của C': 'Ngọc T.' });
    await t.prisma.$executeRaw`UPDATE reviews SET status = 'published', published_at = now() WHERE id = ${ra}::uuid`;
    const after = await list(w.p1, '', w.a.cookie);
    expect(after.body.items.find((i: any) => i.id === ra).reviewer.display_name).toBe('An N.');
    const dump = JSON.stringify(after.body);
    for (const leak of [w.a.id, w.b.id, w.a.email, 'order_item_id', 'user_id', 'Nguyễn Văn An', 'moderation']) expect(dump).not.toContain(leak);
    expect(after.body.items.every((i: any) => i.reviewer.avatar_url === null)).toBe(true);
    // quy tắc che và ca thiếu họ tên (AUTH có CHECK họ tên không rỗng nên thử ở hàm che)
    expect([maskName('Nguyễn Văn An'), maskName('Lê'), maskName(''), maskName('   '), maskName(null), maskName('  trần  thị  mai '), maskName('Đặng\nVăn Bình'), maskName('😀 Hạnh')]).toEqual(['An N.', 'Lê', 'Khách hàng', 'Khách hàng', 'Khách hàng', 'mai T.', 'Bình Đ.', 'Hạnh 😀.']);
    expect((await imageRows(t)).length).toBe(1);
  });

  it(`REV-TC-20261006-104527123 ${SEC} T17: yêu cầu thứ 121 trong một phút bị giới hạn tần suất 429: guest đếm theo IP, người dùng đã đăng nhập đếm theo người dùng (bộ đếm riêng); IP khác và người khác không bị ảnh hưởng`, async () => {
    for (let i = 0; i < 120; i++) { const r = await list(w.p1, '', undefined); if (r.status !== 200) throw new Error(`lần ${i + 1}: ${r.status}`); }
    const over = await call(t, 'get', `/products/${w.p1}/reviews`, { ip: undefined });
    expect(over.status).toBe(429);
    const ra = Number(over.headers['retry-after']);
    expect([ra > 0, ra <= 60]).toEqual([true, true]);
    expect((await list(w.p1, '', w.a.cookie)).status).toBe(200); // customer A (cùng IP, có phiên) đếm riêng theo người dùng, không dính bộ đếm IP của guest
    t.clock.advance(61_000);
    expect((await list(w.p1)).status).toBe(200);
    const other = await call(t, 'get', `/products/${w.p1}/reviews`, { ip: '203.0.113.9' });
    expect(other.status).toBe(200);
    // người dùng đã đăng nhập: 120 yêu cầu qua (lần trên của A đã sang cửa sổ cũ), yêu cầu 121 bị 429 dù đổi IP; B cùng IP với A và guest cùng IP không bị ảnh hưởng
    t.clock.advance(61_000);
    for (let i = 0; i < 120; i++) { const r = await list(w.p1, '', w.a.cookie); if (r.status !== 200) throw new Error(`A lần ${i + 1}: ${r.status}`); }
    const aOver = await call(t, 'get', `/products/${w.p1}/reviews`, { cookie: w.a.cookie, ip: '203.0.113.77' });
    expect(aOver.status).toBe(429);
    expect((await list(w.p1, '', w.b.cookie)).status).toBe(200);
    expect((await list(w.p1)).status).toBe(200);
  }, 120_000);

  it(`${SEC} T10: ảnh công khai theo thứ tự position và không lộ id ảnh`, async () => {
    const [a] = await many(w.p1, [5]);
    await t.prisma.$executeRaw`DELETE FROM review_images`;
    const u = (await t.prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM reviews WHERE id = ${a}::uuid`)[0].user_id;
    await seedImageRow(t, u, a, 2); await seedImageRow(t, u, a, 1);
    const r = await list(w.p1);
    expect(r.body.items[0].images).toHaveLength(2);
    for (const im of r.body.items[0].images) expect(Object.keys(im).sort()).toEqual(['height', 'url', 'width']);
  });
});
