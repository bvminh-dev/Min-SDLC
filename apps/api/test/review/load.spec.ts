import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { freshClock, createReview, createRevApp, deleteReview, moderate, patchReview, preModeration, productRating, q, relayAll, revCount, revOutbox, seedOrderItem, seedProduct, seedReview, uploadImage, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
const year = () => new Date(Date.now() + 365 * 86_400_000);

describe('REV tải hỗn hợp: bảo toàn điểm ở PRD, giới hạn tần suất nguyên tử, không bế tắc kết nối', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  async function customers(n: number, product: string) {
    const out: { id: string; cookie: string }[] = [];
    for (let i = 0; i < n; i++) {
      const u = await seedUser(t, { email: `c${i}@shop.vn`, name: `Khách ${i}` });
      await seedOrderItem(t, u.id, product, { daysAgo: 5 });
      out.push({ id: u.id, cookie: (await seedSession(t, u.id, { expiresAt: year(), absoluteExpiresAt: year() })).cookie });
    }
    return out;
  }

  /** PRD (consumer thật qua relay) khớp với `summary` của REV: số lượng và tổng điểm của đánh giá published. */
  async function expectConserved(product: string): Promise<void> {
    await relayAll(t);
    const [truth] = await q<{ n: number; s: number }>(t, `SELECT count(*)::int AS n, COALESCE(sum(rating), 0)::int AS s FROM reviews WHERE product_id = '${product}' AND status = 'published'`);
    expect(await productRating(t, product)).toEqual({ rating_count: truth.n, rating_sum: truth.s });
    const pub = await call(t, 'get', `/products/${product}/reviews?limit=100`);
    expect([pub.body.summary.count, pub.body.total]).toEqual([truth.n, truth.n]);
    expect((await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM outbox_events WHERE dispatched_at IS NULL AND type LIKE 'Review%'`))[0].n).toBe(0);
  }

  async function mixed(preMod: boolean): Promise<void> {
    const restore = preModeration(t, preMod);
    const users = await customers(12, w.p1);
    const adminOps = async (id: string) => {
      const action = (['approve', 'hide', 'unhide', 'reject'] as const)[randomInt(4)];
      return moderate(t, w.admin.cookie, id, action, action === 'hide' || action === 'reject' ? { reason: 'lý do' } : {});
    };
    const lives = async (u: { id: string }) => (await q<{ id: string }>(t, `SELECT id FROM reviews WHERE user_id = '${u.id}' AND product_id = '${w.p1}' AND status <> 'deleted'`))[0]?.id;
    await Promise.all(users.map(async (u) => {
      for (let step = 0; step < 8; step++) {
        const id = await lives(u);
        const op = randomInt(6);
        if (!id || op === 0) await createReview(t, u.cookie, w.p1, { rating: randomInt(1, 6) });
        else if (op === 1) await patchReview(t, u.cookie, id, { rating: randomInt(1, 6) });
        else if (op === 2) await patchReview(t, u.cookie, id, { comment: `lần ${step}` });
        else if (op === 3 || op === 4) await adminOps(id);
        else if (randomInt(3) === 0) await deleteReview(t, u.cookie, id);
        if (step % 3 === 0) await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
      }
    }));
    await Promise.all(users.map(async (u) => { const id = await lives(u); if (id) await adminOps(id); })); // thêm một lượt kiểm duyệt cuối
    expect(await revCount(t)).toBeGreaterThan(0);
    // mỗi review: thứ tự event theo aggregate hợp lệ (Published, rồi Unpublished/Hidden/Deleted xen kẽ đúng trạng thái)
    const events = await revOutbox(t);
    expect(new Set(events.map((e) => e.type)).size).toBeGreaterThanOrEqual(3); // tải thật sự trộn nhiều loại thao tác
    const by = new Map<string, string[]>();
    for (const e of events) by.set(e.aggregate_id, [...(by.get(e.aggregate_id) ?? []), e.type]);
    for (const [id, types] of by) {
      let counted = false;
      for (const type of types) {
        if (type === 'ReviewPublished') { expect([id, counted]).toEqual([id, false]); counted = true; }
        else if (type === 'ReviewRatingChanged') expect([id, counted]).toEqual([id, true]);
        else { expect([id, type, counted]).toEqual([id, type, type === 'ReviewDeleted' ? counted : true]); counted = false; } // Unpublished, Hidden chỉ khi đang tính; Deleted thì thôi tính
      }
    }
    await expectConserved(w.p1);
    restore();
  }

  it(`${SEC} T16: tắt kiểm duyệt trước, tải hỗn hợp tạo, sửa điểm, ẩn, bỏ ẩn, xóa: điểm của PRD bằng điểm của REV`, async () => { await mixed(false); }, 180_000);
  it(`${SEC} T13, T16: bật kiểm duyệt trước, tải hỗn hợp tạo, sửa (về pending), duyệt, từ chối, ẩn, xóa: điểm của PRD bằng điểm của REV`, async () => { await mixed(true); }, 180_000);

  it(`${SEC} T6, T9 (SB-14): giới hạn tần suất đếm nguyên tử: 14 yêu cầu tạo song song của một người chỉ có đúng 10 qua`, async () => {
    const products: string[] = [];
    for (let i = 0; i < 14; i++) { const p = await seedProduct(t, { category: w.cat }); products.push(p); await seedOrderItem(t, w.a.id, p); }
    const rs = await Promise.all(products.map((p) => createReview(t, w.a.cookie, p, { rating: 5 })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(10);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(4);
    expect(await revCount(t, `user_id = '${w.a.id}'`)).toBe(10);
  });

  it(`REV-TC-20261006-104524095 mở rộng ${SEC} T6, T9 (SB-14): sửa tối đa 30 lần và tải ảnh tối đa 20 lần mỗi giờ mỗi người; lần vượt bị 429 kèm Retry-After, cửa sổ mới thì qua`, async () => {
    const d = await seedOrderItem(t, w.a.id, w.p1);
    const r = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending', rating: 1, orderItem: d.item });
    const edit = (n: number) => patchReview(t, w.a.cookie, r, { rating: (n % 5) + 1 });
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await edit(i + 1)).status);
    expect([codes.filter((c) => c === 200).length, codes[30]]).toEqual([30, 429]);
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const ups: number[] = [];
    for (let i = 0; i < 21; i++) ups.push((await uploadImage(t, w.a.cookie, tiny)).status);
    expect([ups.filter((c) => c === 201).length, ups[20]]).toEqual([20, 429]);
    const over = await uploadImage(t, w.a.cookie, tiny);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    t.clock.advance(3601_000);
    expect([(await edit(2)).status, (await uploadImage(t, w.a.cookie, tiny)).status]).toEqual([200, 201]);
    expect((await uploadImage(t, w.b.cookie, tiny)).status).toBe(201); // người khác không bị ảnh hưởng
  });

  it(`${SEC} T9 (SB-31): pool kết nối nhỏ (2) không bế tắc khi 24 yêu cầu tạo và 24 yêu cầu duyệt chạy song song`, async () => {
    const small = await createRevApp({ poolMax: 2, env: { REVIEW_PRE_MODERATION: 'true' } });
    try {
      await truncateAll(small.prisma);
      const ww = await world(small);
      const us: { id: string; cookie: string }[] = [];
      for (let i = 0; i < 24; i++) {
        const u = await seedUser(small, { email: `p${i}@shop.vn`, name: `Khách ${i}` });
        await seedOrderItem(small, u.id, ww.p1);
        us.push({ id: u.id, cookie: (await seedSession(small, u.id, { expiresAt: year(), absoluteExpiresAt: year() })).cookie });
      }
      const started = Date.now();
      const created = await Promise.all(us.map((u) => createReview(small, u.cookie, ww.p1, { rating: 4 })));
      expect(created.map((r) => r.status)).toEqual(Array(24).fill(201));
      const approved = await Promise.all(created.map((r) => moderate(small, ww.admin.cookie, r.body.id, 'approve')));
      expect(approved.map((r) => r.status)).toEqual(Array(24).fill(200));
      const list = await Promise.all(Array.from({ length: 24 }, () => call(small, 'get', `/products/${ww.p1}/reviews`)));
      expect(list.every((r) => r.status === 200 && r.body.summary.count === 24)).toBe(true);
      expect(Date.now() - started).toBeLessThan(60_000);
    } finally { await small.close(); }
  }, 120_000);
});
