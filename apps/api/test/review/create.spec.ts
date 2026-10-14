import { randomUUID } from 'node:crypto';
import { truncateAll } from '../support/db';
import { freshClock, createReview, createRevApp, eligible, failingTrigger, key, preModeration, q, revAudits, revCount, revOutbox, revTypes, reviewRow, reviewsOf, seedOrderItem, seedProduct, seedReview, snapshot, world, call, type RevApp, type World } from '../support/rev';
import { race } from '../support/ord';

const SEC = 'REV-SEC-20261006-103618395';

describe('REV tạo đánh giá (REV-REQ-20261006-103134939, ...135029, ...135117, ...135296)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });

  it(`REV-TC-20261006-104523767 bật kiểm duyệt trước: đánh giá vào pending, chưa hiện công khai, không phát event`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: 'Vải mát, đúng size' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', rating: 4, comment: 'Vải mát, đúng size', images: [], edited_at: null, product_id: w.p1 });
    expect(Object.keys(r.body)).not.toEqual(expect.arrayContaining(['user_id', 'order_item_id']));
    expect(r.headers['cache-control']).toBe('no-store');
    const row = await reviewRow(t, r.body.id);
    expect([row.status, row.published_at, row.order_item_id, row.user_id]).toEqual(['pending', null, d.item, w.a.id]);
    expect(await revCount(t)).toBe(1);
    expect(await revTypes(t)).toEqual([]);
    const pub = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect([pub.body.items, pub.body.summary.count]).toEqual([[], 0]);
    const mine = await call(t, 'get', '/me/reviews', { cookie: w.a.cookie });
    expect(mine.body.items.map((i: any) => i.status)).toEqual(['pending']);
  });

  it(`REV-TC-20261006-104523823 tắt kiểm duyệt trước: published ngay và ReviewPublished vào outbox cùng giao dịch`, async () => {
    preModeration(t, false);
    await eligible(t, w.a, w.p1);
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 5 });
    expect([r.status, r.body.status, r.body.comment]).toEqual([201, 'published', null]);
    const ev = await revOutbox(t);
    expect(ev).toHaveLength(1);
    expect([ev[0].type, ev[0].aggregate_type, ev[0].aggregate_id, ev[0].payload]).toEqual(['ReviewPublished', 'review', r.body.id, { review_id: r.body.id, product_id: w.p1, rating: 5 }]);
    expect(ev[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev[0].correlation_id).toBeTruthy();
    expect(ev[0].occurred_at).toBeInstanceOf(Date);
    const row = await reviewRow(t, r.body.id);
    expect(row.published_at).not.toBeNull();
    const pub = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect([pub.body.items.length, pub.body.summary.count, pub.body.summary.avg]).toEqual([1, 1, 5]);
    // rollback: outbox lỗi thì không còn dòng review nào (cùng giao dịch)
    await truncateAll(t.prisma); w = await world(t); await eligible(t, w.a, w.p1);
    await failingTrigger(t, 'outbox_events', async () => {
      const bad = await createReview(t, w.a.cookie, w.p1, { rating: 5 });
      expect(bad.status).toBe(500);
      expect(await revCount(t)).toBe(0);
    }, "NEW.type = 'ReviewPublished'");
  });

  it(`REV-TC-20261006-104523878 ${SEC} T6: tạo lần hai khi đã có đánh giá chưa xóa bị 409 already_reviewed (kể cả rejected, hidden)`, async () => {
    await eligible(t, w.a, w.p1);
    const first = await createReview(t, w.a.cookie, w.p1, { rating: 3 });
    expect(first.status).toBe(201);
    const second = await createReview(t, w.a.cookie, w.p1, { rating: 2 });
    expect([second.status, second.body.code, second.body.type]).toEqual([409, 'already_reviewed', 'urn:ecom:error:review-conflict']);
    expect(second.headers['content-type']).toContain('application/problem+json');
    expect(second.body.trace_id).toBeTruthy();
    expect((await reviewRow(t, first.body.id)).rating).toBe(3);
    expect(await revCount(t)).toBe(1);
    for (const st of ['rejected', 'hidden'] as const) {
      await q(t, `UPDATE reviews SET status = '${st}', moderation_reason = 'x' ${st === 'hidden' ? ", published_at = now()" : ''} WHERE id = '${first.body.id}'`);
      const again = await createReview(t, w.a.cookie, w.p1, { rating: 1 });
      expect([st, again.status, again.body.code]).toEqual([st, 409, 'already_reviewed']);
    }
  });

  it(`REV-TC-20261006-104523936 guest 401, staff và admin 403 khi tạo đánh giá`, async () => {
    const before = await snapshot(t);
    const [g, s, d] = [await createReview(t, undefined, w.p1, { rating: 5 }), await createReview(t, w.staff.cookie, w.p1, { rating: 5 }), await createReview(t, w.admin.cookie, w.p1, { rating: 5 })];
    expect([g.status, s.status, d.status]).toEqual([401, 403, 403]);
    expect(JSON.stringify([s.body, d.body])).not.toMatch(/mua|đơn|order/i); // 403 của staff không nêu lý do mua hàng
    expect(await snapshot(t)).toEqual(before);
  });

  it(`REV-TC-20261006-104523993 ${SEC} T4: trường lạ user_id, status, order_item_id bị từ chối unknown_field`, async () => {
    await eligible(t, w.a, w.p1);
    const ob = await eligible(t, w.b, w.p1);
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 5, user_id: w.b.id, status: 'published', order_item_id: ob.item });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual([{ field: 'user_id', code: 'unknown_field' }, { field: 'status', code: 'unknown_field' }, { field: 'order_item_id', code: 'unknown_field' }]);
    expect(await revCount(t)).toBe(0);
    for (const extra of [{ user_id: w.b.id }, { status: 'published' }, { order_item_id: ob.item }, { moderated_by: w.admin.id }]) {
      expect((await createReview(t, w.a.cookie, w.p1, { rating: 5, ...extra })).status).toBe(400);
    }
    const proto = await createReview(t, w.a.cookie, w.p1, JSON.parse('{"rating":5,"__proto__":{"status":"published"}}'));
    expect([proto.status, proto.body.errors?.[0]?.code]).toEqual([400, 'unknown_field']);
    const roleHeader = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { headers: { 'X-Role': 'admin', 'X-User-Id': w.b.id } }); // header giả bị bỏ qua, quyền theo phiên
    expect(roleHeader.status).toBe(201);
    expect((await reviewsOf(t, w.a.id, w.p1)).length).toBe(1);
    expect(await revCount(t, `user_id = '${w.b.id}'`)).toBe(0);
  });

  it(`REV-TC-20261006-104524045 sản phẩm không tồn tại hoặc archived cùng trả 404`, async () => {
    const pa = await seedProduct(t, { category: w.cat, status: 'archived' });
    await seedOrderItem(t, w.a.id, pa);
    const bodies = [];
    for (const id of [randomUUID(), pa, 'abc']) {
      const r = await createReview(t, w.a.cookie, id, { rating: 5 });
      expect(r.status).toBe(404);
      const { trace_id: _t, ...rest } = r.body;
      bodies.push(rest);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(await revCount(t)).toBe(0);
    expect(await revTypes(t)).toEqual([]);
  });

  it(`REV-TC-20261006-104524095 ${SEC} T6: lần tạo thứ 11 trong một giờ bị 429 kèm Retry-After; người khác không bị ảnh hưởng`, async () => {
    t.clock.set(new Date(Math.floor(Date.now() / 7_200_000) * 7_200_000 + 1000)); // đầu một cửa sổ hai giờ: còn đúng 3599 giây tới hết giờ hiện tại nếu cửa sổ là 1 giờ
    const products: string[] = [];
    for (let i = 0; i < 11; i++) { const p = await seedProduct(t, { category: w.cat }); products.push(p); await seedOrderItem(t, w.a.id, p); }
    await eligible(t, w.b, w.p1);
    for (let i = 0; i < 10; i++) expect((await createReview(t, w.a.cookie, products[i], { rating: 5 })).status).toBe(201);
    const r = await createReview(t, w.a.cookie, products[10], { rating: 5 });
    expect(r.status).toBe(429);
    const ra = Number(r.headers['retry-after']);
    expect([Number.isInteger(ra), ra >= 3590, ra <= 3600]).toEqual([true, true, true]); // cửa sổ cố định đúng 1 giờ (không phải 2 giờ)
    expect(await revCount(t, `product_id = '${products[10]}'`)).toBe(0);
    expect((await createReview(t, w.b.cookie, w.p1, { rating: 5 })).status).toBe(201);
    t.clock.advance(61 * 60_000);
    expect((await createReview(t, w.a.cookie, products[10], { rating: 5 })).status).toBe(201);
  });

  it(`REV-TC-20261006-104524159 sau khi xóa đánh giá cũ, khách viết lại được và bản cũ giữ nguyên (deleted không giữ chỗ)`, async () => {
    const d = await eligible(t, w.a, w.p1, 20);
    const old = await seedReview(t, { user: w.a.id, product: w.p1, status: 'deleted', orderItem: d.item, rating: 2 });
    const before = (await reviewRow(t, old)).deleted_at;
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 3 });
    expect([r.status, r.body.status]).toEqual([201, 'pending']);
    expect(r.body.id).not.toBe(old);
    const rows = await reviewsOf(t, w.a.id, w.p1);
    expect(rows.map((x: any) => x.status).sort()).toEqual(['deleted', 'pending']);
    expect(rows.every((x: any) => x.order_item_id === d.item)).toBe(true);
    expect((await reviewRow(t, old)).deleted_at).toEqual(before);
  });

  it(`REV-TC-20261006-104524227 ${SEC} T6: hai yêu cầu tạo đồng thời khác khóa chỉ một thành công (50 vòng)`, async () => {
    preModeration(t, false);
    const d = await eligible(t, w.a, w.p1);
    for (let i = 0; i < 50; i++) {
      await truncateAllReviews();
      const [x, y] = await race(() => createReview(t, w.a.cookie, w.p1, { rating: 5 }), () => createReview(t, w.a.cookie, w.p1, { rating: 5 }));
      const codes = [x, y].map((r) => (r.status === 201 ? '201' : `${r.status}:${r.body.code}`)).sort();
      expect([i, ...codes]).toEqual([i, '201', '409:already_reviewed']);
      expect(await revCount(t, `user_id = '${w.a.id}' AND product_id = '${w.p1}' AND status <> 'deleted'`)).toBe(1);
      expect(await revTypes(t)).toEqual(['ReviewPublished']);
      t.clock.advance(1); // cửa sổ đếm của giới hạn tần suất (10 mỗi giờ) không bị chạm: rào mới mỗi vòng
      await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
    }
    expect(d.item).toBeTruthy();
    async function truncateAllReviews() { await t.prisma.$executeRaw`DELETE FROM outbox_events`; await t.prisma.$executeRaw`DELETE FROM idempotency_keys`; await t.prisma.$executeRaw`DELETE FROM review_images`; await t.prisma.$executeRaw`DELETE FROM reviews`; }
  });

  it(`REV-TC-20261006-104524289 sản phẩm vừa archived thì không đánh giá mới nhưng đánh giá cũ vẫn còn ở danh sách của chủ`, async () => {
    const p2 = await seedProduct(t, { category: w.cat, name: 'Tất cổ cao' });
    await eligible(t, w.a, w.p1); await seedOrderItem(t, w.a.id, p2);
    const r2 = await seedReview(t, { user: w.a.id, product: p2, status: 'published' });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id IN (${w.p1}::uuid, ${p2}::uuid)`;
    expect((await createReview(t, w.a.cookie, w.p1, { rating: 5 })).status).toBe(404);
    const mine = await call(t, 'get', '/me/reviews', { cookie: w.a.cookie });
    expect(mine.body.items).toHaveLength(1);
    expect([mine.body.items[0].id, mine.body.items[0].product.name, mine.body.items[0].status]).toEqual([r2, 'Tất cổ cao', 'published']);
    expect((await call(t, 'get', `/products/${p2}/reviews`)).status).toBe(404);
  });

  it(`REV-TC-20261006-104524335 ${SEC} T18: nội dung bình luận không xuất hiện trong log ứng dụng`, async () => {
    await eligible(t, w.a, w.p1);
    const secret = 'SECRET-COMMENT-7731 0901234567';
    const ok = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: secret });
    expect(ok.status).toBe(201);
    const bad = await createReview(t, w.a.cookie, w.p1, { rating: 9, comment: secret });
    expect(bad.status).toBe(400);
    const dump = t.logs.lines.join('\n');
    expect(dump).not.toContain('SECRET-COMMENT-7731');
    expect(dump).not.toContain('0901234567');
    expect(t.logs.records.every((l) => !('comment' in l))).toBe(true);
    const made = t.logs.records.filter((l) => l.code === 'review-created');
    expect(made).toHaveLength(1);
    expect([made[0].review_id, made[0].status, made[0].comment_length, typeof made[0].correlation_id, made[0].module]).toEqual([ok.body.id, 'pending', [...secret].length, 'string', 'review']); // chỉ review_id, trạng thái, độ dài, correlation_id
  });

  it(`REV-TC-20261006-104524423 các giá trị điểm sai bị từ chối với errors theo trường rating`, async () => {
    await eligible(t, w.a, w.p1);
    const before = await snapshot(t);
    for (const [v, code] of [[0, 'invalid_rating'], [6, 'invalid_rating'], [-1, 'invalid_rating'], [4.5, 'invalid_rating'], ['5', 'invalid_rating'], [true, 'invalid_rating'], [[5], 'invalid_rating'], [null, 'required']] as const) {
      const r = await createReview(t, w.a.cookie, w.p1, { rating: v });
      expect([String(v), r.status, r.body.errors?.[0]]).toEqual([String(v), 400, { field: 'rating', code }]);
      expect(JSON.stringify(r.body)).not.toContain('4.5');
    }
    const missing = await createReview(t, w.a.cookie, w.p1, { comment: 'x' });
    expect([missing.status, missing.body.errors[0]]).toEqual([400, { field: 'rating', code: 'required' }]);
    expect(await snapshot(t)).toEqual(before);
    await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`; // bậc B 10 lần mỗi giờ tính cả lần bị từ chối: bắt đầu bộ đếm mới cho nhóm sau
    for (const bad of [Number.MAX_SAFE_INTEGER, 1e308, 2 ** 31]) expect((await createReview(t, w.a.cookie, w.p1, { rating: bad })).status).toBe(400);
  });

  it(`REV-TC-20261006-104524600 bình luận được cắt khoảng trắng hai đầu, giữ xuống dòng bên trong, chuẩn hóa NFC`, async () => {
    const p2 = await seedProduct(t, { category: w.cat }); const p3 = await seedProduct(t, { category: w.cat });
    for (const p of [w.p1, p2, p3]) await seedOrderItem(t, w.a.id, p);
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: '  Vải mát, đúng size.\nGiao nhanh.  ' });
    expect([r.status, r.body.comment, (await reviewRow(t, r.body.id)).comment]).toEqual([201, 'Vải mát, đúng size.\nGiao nhanh.', 'Vải mát, đúng size.\nGiao nhanh.']);
    const none = await createReview(t, w.a.cookie, p2, { rating: 4 });
    expect([none.status, none.body.comment]).toEqual([201, null]);
    const nfc = await createReview(t, w.a.cookie, p3, { rating: 4, comment: 'é' });
    expect([nfc.body.comment, (await reviewRow(t, nfc.body.id)).comment]).toEqual(['é', 'é']);
  });

  it(`REV-TC-20261006-104524655 bình luận quá dài, ký tự điều khiển, nửa cặp thay thế lẻ và sai kiểu bị từ chối`, async () => {
    await eligible(t, w.a, w.p1);
    const cases: [unknown, string][] = [['a'.repeat(2001), 'too_long'], ['ok\u0000', 'invalid_characters'], ['ok\u0007', 'invalid_characters'], ['ok\u007f', 'invalid_characters'], [123, 'invalid_type'], [['a'], 'invalid_type'], [{ a: 1 }, 'invalid_type'], [true, 'invalid_type']];
    for (const [v, code] of cases) {
      const r = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: v });
      expect([JSON.stringify(v).slice(0, 20), r.status, r.body.errors?.[0]]).toEqual([JSON.stringify(v).slice(0, 20), 400, { field: 'comment', code }]);
    }
    await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
    const lone = await createReview(t, w.a.cookie, w.p1, '{"rating":4,"comment":"x\\ud800"}', { contentType: 'application/json' }); // JSON thô với nửa cặp thay thế lẻ (UTF-16 hỏng): 400, không 500
    expect([lone.status, lone.body.type]).toEqual([400, expect.stringMatching(/^urn:ecom:error:/)]);
    const nul = await createReview(t, w.a.cookie, w.p1, '{"rating":4,"comment":"x\\u0000"}', { contentType: 'application/json' });
    expect(nul.status).toBe(400);
    expect(await revCount(t)).toBe(0);
    const ok = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: 'dòng 1\n\tdòng 2' }); // xuống dòng và tab hợp lệ
    expect(ok.status).toBe(201);
  });

  it(`REV-TC-20261006-104524722 đúng 2000 ký tự hợp lệ, 2000 emoji hợp lệ, chuỗi toàn khoảng trắng thành null`, async () => {
    const [p2, p3] = [await seedProduct(t, { category: w.cat }), await seedProduct(t, { category: w.cat })];
    for (const p of [w.p1, p2, p3]) await seedOrderItem(t, w.a.id, p);
    const r1 = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: 'a'.repeat(2000) });
    const r2 = await createReview(t, w.a.cookie, p2, { rating: 4, comment: '😀'.repeat(2000) });
    const r3 = await createReview(t, w.a.cookie, p3, { rating: 4, comment: '   \n  ' });
    expect([r1.status, r2.status, r3.status, r3.body.comment]).toEqual([201, 201, 201, null]);
    const lens = await q<{ n: number }>(t, `SELECT char_length(comment) AS n FROM reviews WHERE id IN ('${r1.body.id}', '${r2.body.id}') ORDER BY created_at`);
    expect(lens.map((x) => x.n)).toEqual([2000, 2000]);
    expect((await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: 'a'.repeat(2001) })).status).toBe(400);
  });

  it(`REV-TC-20261006-104524795 ${SEC} T7: bình luận chứa HTML được lưu nguyên, API trả chuỗi thô, không cho đoán kiểu`, async () => {
    preModeration(t, false);
    await eligible(t, w.a, w.p1);
    const html = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 4, comment: html });
    expect([r.status, r.body.comment]).toEqual([201, html]);
    const list = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect(list.body.items[0].comment).toBe(html);
    expect(list.headers['content-type']).toContain('application/json');
    expect(list.headers['x-content-type-options']).toBe('nosniff');
  });

  it(`REV-TC-20261006-140000004 ${SEC} T6: Idempotency-Key bắt buộc, gửi lại cùng khóa trả phản hồi cũ, khác nội dung bị 422, khóa gắn người dùng`, async () => {
    preModeration(t, false);
    const d = await eligible(t, w.a, w.p1);
    await eligible(t, w.b, w.p1);
    const before = await snapshot(t);
    const none = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: null });
    expect([none.status, none.body.type]).toEqual([400, 'urn:ecom:error:idempotency-key-required']);
    for (const k of ['abc1234', 'khoa co dau cach!', 'a'.repeat(65), 'abcd123$']) expect([k, (await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: k })).status]).toEqual([k, 400]);
    expect(await snapshot(t)).toEqual(before);
    const short = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: 'abcd1234' });
    expect(short.status).toBe(201); // đúng 8 ký tự qua
    await t.prisma.$executeRaw`DELETE FROM reviews`; await t.prisma.$executeRaw`DELETE FROM outbox_events`; await t.prisma.$executeRaw`DELETE FROM idempotency_keys`;
    const long = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: 'k'.repeat(64) });
    expect(long.status).toBe(201); // đúng 64 ký tự qua
    await t.prisma.$executeRaw`DELETE FROM reviews`; await t.prisma.$executeRaw`DELETE FROM outbox_events`; await t.prisma.$executeRaw`DELETE FROM idempotency_keys`;
    const K1 = key();
    const first = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: K1 });
    const replay = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: K1 });
    const other = await createReview(t, w.a.cookie, w.p1, { rating: 4 }, { key: K1 });
    expect([first.status, replay.status, other.status]).toEqual([201, 201, 422]);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(other.body.type).toBe('urn:ecom:error:idempotency-key-reused');
    expect(await revCount(t, `user_id = '${w.a.id}' AND status <> 'deleted'`)).toBe(1);
    expect(await revTypes(t)).toEqual(['ReviewPublished']);
    const sameKeyB = await createReview(t, w.b.cookie, w.p1, { rating: 3 }, { key: K1 }); // khóa gắn user_id: B không nhận phản hồi của A
    expect([sameKeyB.status, sameKeyB.body.id === first.body.id]).toEqual([201, false]);
    // khóa hết hạn sau 24 giờ: gửi lại khi đánh giá còn chưa xóa trả 409, không còn phản hồi cũ
    t.clock.advance(25 * 3600_000);
    const expired = await createReview(t, w.a.cookie, w.p1, { rating: 5 }, { key: K1 });
    expect([expired.status, expired.body.code]).toEqual([409, 'already_reviewed']);
    expect(d.item).toBeTruthy();
    expect(await revAudits(t)).toEqual([]);
  });
});
