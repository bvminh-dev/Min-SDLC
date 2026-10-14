import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';
import { ORIGIN } from '../support/app';
import { EventsService, OutboxRelay, type EventEnvelope } from '../../src/modules/platform';
import { seedSession, seedUser } from '../support/auth';
import { freshClock, createRevApp, eligible, failingTrigger, moderate, patchReview, q, revAudits, revOutbox, revTypes, reviewRow, seedOrderItem, seedReview, snapshot, world, call, type RevApp, type World } from '../support/rev';
import { race } from '../support/ord';

const SEC = 'REV-SEC-20261006-103618395';
const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };

describe('REV kiểm duyệt (REV-REQ-20261006-103135835, ...135744)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const pending = async (user = w.a, rating = 4, product = w.p1) => {
    const d = await seedOrderItem(t, user.id, product, { daysAgo: 12 });
    return seedReview(t, { user: user.id, product, status: 'pending', rating, orderItem: d.item });
  };

  it(`REV-TC-20261006-104527996 ${SEC} T14: duyệt đánh giá pending thành published, phát ReviewPublished và ghi audit cùng giao dịch`, async () => {
    const r1 = await pending(w.a, 4);
    const x = await moderate(t, w.admin.cookie, r1, 'approve');
    expect([x.status, x.body]).toEqual([200, { id: r1, status: 'published' }]);
    const row = await reviewRow(t, r1);
    expect([row.status, row.published_at !== null, row.moderated_by, row.moderated_at !== null]).toEqual(['published', true, w.admin.id, true]);
    expect((await revOutbox(t, r1)).map((e) => [e.type, e.payload])).toEqual([['ReviewPublished', { review_id: r1, product_id: w.p1, rating: 4 }]]);
    const au = await revAudits(t, r1);
    expect(au).toHaveLength(1);
    expect([au[0].actor_id, au[0].actor_role, au[0].action, au[0].before.status, au[0].after.status, au[0].before.product_id, au[0].created_at instanceof Date]).toEqual([w.admin.id, 'admin', 'review.approve', 'pending', 'published', w.p1, true]);
    expect((await call(t, 'get', `/products/${w.p1}/reviews`)).body.items.map((i: any) => i.id)).toEqual([r1]);
    // ép lỗi audit: R vẫn pending và không event
    const r2 = await pending(w.b, 3);
    await failingTrigger(t, 'audit_logs', async () => { expect((await moderate(t, w.admin.cookie, r2, 'approve')).status).toBe(500); });
    expect([(await reviewRow(t, r2)).status, await revTypes(t, r2)]).toEqual(['pending', []]);
  });

  it(`REV-TC-20261006-104528036 từ chối đánh giá pending kèm lý do, không phát event, chủ thấy lý do`, async () => {
    const r2 = await pending(w.a);
    const x = await moderate(t, w.admin.cookie, r2, 'reject', { reason: 'Chứa số điện thoại liên hệ' });
    expect([x.status, x.body]).toEqual([200, { id: r2, status: 'rejected' }]);
    expect((await reviewRow(t, r2)).moderation_reason).toBe('Chứa số điện thoại liên hệ');
    expect(await revTypes(t)).toEqual([]);
    const au = await revAudits(t, r2);
    expect([au.length, au[0].action, au[0].reason, au[0].after.status]).toEqual([1, 'review.reject', 'Chứa số điện thoại liên hệ', 'rejected']);
    const mine = await call(t, 'get', `/me/reviews/${r2}`, { cookie: w.a.cookie });
    expect([mine.body.moderation_reason, mine.body.can_edit, mine.body.status]).toEqual(['Chứa số điện thoại liên hệ', false, 'rejected']);
  });

  it(`REV-TC-20261006-104528071 ẩn đánh giá published phát ReviewHidden (có rating) và biến khỏi danh sách công khai, summary tính lại`, async () => {
    const [d3, d5] = [await eligible(t, w.a, w.p1), await eligible(t, w.b, w.p1)];
    const r3 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', rating: 1, orderItem: d3.item });
    await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', rating: 5, orderItem: d5.item });
    const x = await moderate(t, w.admin.cookie, r3, 'hide', { reason: 'Lời lẽ xúc phạm' });
    expect([x.status, x.body]).toEqual([200, { id: r3, status: 'hidden' }]);
    expect((await revOutbox(t, r3)).map((e) => [e.type, e.payload])).toEqual([['ReviewHidden', { review_id: r3, product_id: w.p1, rating: 1 }]]);
    const pub = await call(t, 'get', `/products/${w.p1}/reviews`);
    expect([pub.body.items.map((i: any) => i.rating), pub.body.summary.count, pub.body.summary.avg]).toEqual([[5], 1, 5]);
    const au = await revAudits(t, r3);
    expect([au.length, au[0].action, au[0].reason, au[0].before.status, au[0].after.status]).toEqual([1, 'review.hide', 'Lời lẽ xúc phạm', 'published', 'hidden']);
  });

  it(`REV-TC-20261006-104528104 ${SEC} T12: duyệt, từ chối hoặc bỏ ẩn sai trạng thái bị 409 invalid_review_state, không event, không audit`, async () => {
    const [d4, d4b, dp] = [await eligible(t, w.a, w.p1), await eligible(t, w.b, w.p1), await eligible(t, w.c, w.p1)];
    const r4 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'published', orderItem: d4.item });
    const r4b = await seedReview(t, { user: w.b.id, product: w.p1, status: 'hidden', orderItem: d4b.item, moderatedBy: w.admin.id });
    const rp = await seedReview(t, { user: w.c.id, product: w.p1, status: 'pending', orderItem: dp.item });
    const before = await snapshot(t);
    const calls: [string, string, string, unknown][] = [[r4, 'approve', 'published', {}], [r4, 'reject', 'published', { reason: 'x' }], [r4, 'unhide', 'published', {}], [r4b, 'approve', 'hidden', {}], [r4b, 'hide', 'hidden', { reason: 'x' }], [rp, 'hide', 'pending', { reason: 'x' }], [rp, 'unhide', 'pending', {}]];
    for (const [id, action, , body] of calls) {
      const r = await moderate(t, w.admin.cookie, id, action as 'approve', body);
      expect([id, action, r.status, r.body.code]).toEqual([id, action, 409, 'invalid_review_state']);
    }
    expect(await snapshot(t)).toEqual(before);
    expect((await q<any>(t, `SELECT status::text AS s FROM reviews WHERE id IN ('${r4}','${r4b}','${rp}') ORDER BY s`)).map((x) => x.s)).toEqual(['hidden', 'pending', 'published']);
  });

  it(`REV-TC-20261006-104528138 lý do rỗng, toàn khoảng trắng hoặc 501 ký tự bị 400 và đánh giá không đổi`, async () => {
    const r5 = await pending(w.a);
    const d = await eligible(t, w.b, w.p1);
    const r5b = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published', orderItem: d.item });
    const before = await snapshot(t);
    const out: [string, string][] = [];
    for (const reason of ['', '   ', 'a'.repeat(501)]) { const r = await moderate(t, w.admin.cookie, r5, 'reject', { reason }); out.push([String(r.status), `${r.body.errors?.[0]?.field}:${r.body.errors?.[0]?.code}`]); }
    const missing = await moderate(t, w.admin.cookie, r5b, 'hide', {});
    out.push([String(missing.status), `${missing.body.errors?.[0]?.field}:${missing.body.errors?.[0]?.code}`]);
    expect(out).toEqual([['400', 'reason:required'], ['400', 'reason:required'], ['400', 'reason:too_long'], ['400', 'reason:required']]);
    const extra = await moderate(t, w.admin.cookie, r5, 'reject', { reason: 'ok', status: 'published' });
    expect(extra.body.errors[0]).toEqual({ field: 'status', code: 'unknown_field' });
    expect((await moderate(t, w.admin.cookie, r5, 'reject', { reason: 'a\u0000b' })).status).toBe(400);
    expect(await snapshot(t)).toEqual(before);
    expect([(await reviewRow(t, r5)).status, (await reviewRow(t, r5b)).status]).toEqual(['pending', 'published']);
  });

  it(`REV-TC-20261006-104528170 ${SEC} T3: customer chủ đánh giá, staff và guest không duyệt được (kể cả reject, hide, unhide)`, async () => {
    const r6 = await pending(w.a);
    const d = await eligible(t, w.b, w.p1);
    const r6b = await seedReview(t, { user: w.b.id, product: w.p1, status: 'hidden', orderItem: d.item, moderatedBy: w.admin.id });
    const before = await snapshot(t);
    for (const [id, action, body] of [[r6, 'approve', {}], [r6, 'reject', { reason: 'x' }], [r6, 'hide', { reason: 'x' }], [r6b, 'unhide', {}]] as const) {
      const [a, s, g] = [await moderate(t, w.a.cookie, id, action, body), await moderate(t, w.staff.cookie, id, action, body), await moderate(t, undefined, id, action, body)];
      expect([action, a.status, s.status, g.status]).toEqual([action, 403, 403, 401]);
    }
    expect(await snapshot(t)).toEqual(before);
  });

  it(`REV-TC-20261006-104528202 duyệt đánh giá đã xóa hoặc không tồn tại trả 404 cùng thân`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r7 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'deleted', orderItem: d.item });
    const before = await snapshot(t);
    const bodies = [];
    for (const id of [r7, randomUUID(), 'abc']) { const r = await moderate(t, w.admin.cookie, id, 'approve'); expect([id.length, r.status]).toEqual([id.length, 404]); bodies.push(JSON.stringify(strip(r.body))); }
    expect(new Set(bodies).size).toBe(1);
    expect(await snapshot(t)).toEqual(before);
  });

  it(`REV-TC-20261006-104528234 ${SEC} T15: duyệt thiếu Origin hoặc sai Origin bị 403 csrf_failed, sai Content-Type bị 415`, async () => {
    const r8 = await pending(w.a);
    const bad = await moderate(t, w.admin.cookie, r8, 'approve', {}, { origin: 'https://evil.example' });
    const none = await moderate(t, w.admin.cookie, r8, 'approve', {}, { origin: null });
    const ct = await moderate(t, w.admin.cookie, r8, 'approve', {}, { contentType: 'text/plain' });
    expect([bad.status, bad.body.type, none.status, none.body.type, ct.status]).toEqual([403, 'urn:ecom:error:csrf_failed', 403, 'urn:ecom:error:csrf_failed', 415]);
    expect((await reviewRow(t, r8)).status).toBe('pending');
    const ok = await moderate(t, w.admin.cookie, r8, 'approve', {}, { origin: ORIGIN });
    expect([ok.status, (await reviewRow(t, r8)).status]).toEqual([200, 'published']);
  });

  it(`REV-TC-20261006-104528265 ${SEC} T12, T14: hai admin cùng duyệt một đánh giá chỉ một lần thành công (50 vòng)`, async () => {
    const e = await seedUser(t, { email: 'e@shop.vn', role: 'admin' });
    const ecookie = (await seedSession(t, e.id, { expiresAt: new Date(Date.now() + 86_400_000 * 30), absoluteExpiresAt: new Date(Date.now() + 86_400_000 * 30) })).cookie;
    for (let i = 0; i < 50; i++) {
      await t.prisma.$executeRaw`DELETE FROM outbox_events`; await t.prisma.$executeRaw`DELETE FROM audit_logs`; await t.prisma.$executeRaw`DELETE FROM reviews`; await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
      const r9 = await pending(w.a);
      const [x, y] = await race(() => moderate(t, w.admin.cookie, r9, 'approve'), () => moderate(t, ecookie, r9, 'approve'));
      expect([i, [x.status, y.status].sort(), [x, y].find((r) => r.status === 409)?.body.code]).toEqual([i, [200, 409], 'invalid_review_state']);
      expect([i, await revTypes(t, r9), (await revAudits(t, r9)).length]).toEqual([i, ['ReviewPublished'], 1]);
    }
  }, 180_000);

  it(`REV-TC-20261006-104528296 ${SEC} T12: chủ vừa sửa điểm trước khi duyệt thì event mang điểm mới`, async () => {
    const r10 = await pending(w.a, 3);
    const p = await patchReview(t, w.a.cookie, r10, { rating: 5 });
    expect(p.status).toBe(200);
    const x = await moderate(t, w.admin.cookie, r10, 'approve');
    expect(x.status).toBe(200);
    expect((await reviewRow(t, r10)).rating).toBe(5);
    expect((await revOutbox(t, r10)).map((e) => [e.type, e.payload.rating])).toEqual([['ReviewPublished', 5]]);
    expect((await call(t, 'get', `/products/${w.p1}/reviews`)).body.items[0].rating).toBe(5);
  });

  it(`REV-TC-20261006-104528328 ${SEC} T14, T18: lý do đúng 500 ký tự hợp lệ; audit và log không chứa nội dung bình luận`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const r11 = await seedReview(t, { user: w.a.id, product: w.p1, status: 'pending', comment: 'SECRET-COMMENT-9914', orderItem: d.item });
    const x = await moderate(t, w.admin.cookie, r11, 'reject', { reason: 'b'.repeat(500) });
    expect(x.status).toBe(200);
    expect((await reviewRow(t, r11)).moderation_reason).toHaveLength(500);
    expect(JSON.stringify(await revAudits(t, r11))).not.toContain('SECRET-COMMENT-9914');
    expect(t.logs.lines.join('\n')).not.toContain('SECRET-COMMENT-9914');
    const logged = t.logs.records.filter((l) => l.code === 'review-moderated');
    expect([logged.length, logged[0].review_id, logged[0].action, logged[0].status, logged[0].reason_length]).toEqual([1, r11, 'reject', 'rejected', 500]);
    expect(t.logs.lines.join('\n')).not.toContain('b'.repeat(40)); // lý do không vào log
    expect((await moderate(t, w.admin.cookie, r11, 'reject', { reason: 'b'.repeat(501) })).status).toBe(400);
  });

  it(`REV-TC-20261006-140000003 ${SEC} T14: admin bỏ ẩn đánh giá hidden về published, xóa lý do, phát ReviewPublished và ghi audit; bỏ ẩn lần hai 409`, async () => {
    const d = await eligible(t, w.a, w.p1);
    const first = new Date(t.clock.now().getTime() - 5 * 86_400_000);
    const r3b = await seedReview(t, { user: w.a.id, product: w.p1, status: 'hidden', rating: 1, orderItem: d.item, reason: 'Lời lẽ xúc phạm', moderatedBy: w.admin.id, publishedAt: first });
    const x = await moderate(t, w.admin.cookie, r3b, 'unhide');
    expect([x.status, x.body]).toEqual([200, { id: r3b, status: 'published' }]);
    const row = await reviewRow(t, r3b);
    expect([row.moderation_reason, row.published_at]).toEqual([null, first]);
    expect((await call(t, 'get', `/products/${w.p1}/reviews`)).body.summary).toMatchObject({ count: 1, avg: 1 });
    expect((await revOutbox(t, r3b)).map((e) => [e.type, e.payload])).toEqual([['ReviewPublished', { review_id: r3b, product_id: w.p1, rating: 1 }]]);
    const au = await revAudits(t, r3b);
    expect([au.length, au[0].action, au[0].before.status, au[0].after.status]).toEqual([1, 'review.unhide', 'hidden', 'published']);
    expect(JSON.stringify(au)).not.toContain('Rất tốt');
    const again = await moderate(t, w.admin.cookie, r3b, 'unhide');
    expect([again.status, again.body.code]).toEqual([409, 'invalid_review_state']);
    expect([await revTypes(t, r3b), (await revAudits(t, r3b)).length]).toEqual([['ReviewPublished'], 1]);
  });

  it(`REV-TC-20261006-140000005 ${SEC} T16, T21: giết tiến trình giữa commit và phát thì event vẫn còn trong outbox và được giao một lần có hiệu lực`, async () => {
    const r12 = await pending(w.a, 4);
    const child = (args: string[]) => new Promise<{ code: number | null; signal: string | null; out: string }>((res) => {
      const c = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/rev-then-die.ts', ...args], {
        cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('exit', (code, signal) => res({ code, signal, out }));
    });
    const died = await child(['approve', r12, w.admin.id]);
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect((await reviewRow(t, r12)).status).toBe('published'); // commit đã xong trước khi chết
    const rows = await revOutbox(t, r12);
    expect(rows.map((r) => [r.type, r.payload, r.dispatched_at])).toEqual([['ReviewPublished', { review_id: r12, product_id: w.p1, rating: 4 }, null]]);
    // consumer giả của PRD ghi lại event_id đã nhận; relay giao at-least-once, chống trùng theo event_id
    const seen: string[] = [];
    t.app.get(EventsService).subscribe('prd-fake', 'ReviewPublished', async (_tx, ev: EventEnvelope) => { seen.push(ev.event_id); });
    const relay = t.app.get(OutboxRelay);
    await relay.runOnce(new Date(Date.now() + 1000));
    expect(seen).toEqual([rows[0].id]);
    expect((await revOutbox(t, r12))[0].dispatched_at).not.toBeNull();
    await t.prisma.$executeRaw`UPDATE outbox_events SET dispatched_at = NULL, next_attempt_at = now() WHERE id = ${rows[0].id}::uuid`; // chết sau khi giao mà trước khi đánh dấu: giao lại cùng event_id
    await relay.runOnce(new Date(Date.now() + 5000));
    expect(seen).toEqual([rows[0].id]); // ProcessedEvent: chỉ xử lý một lần theo event_id
    // R13: ép lỗi ghi audit trong cùng giao dịch: R13 vẫn pending và không có dòng outbox cho R13
    const r13 = await pending(w.b, 2);
    await failingTrigger(t, 'audit_logs', async () => { expect((await moderate(t, w.admin.cookie, r13, 'approve')).status).toBe(500); });
    expect([(await reviewRow(t, r13)).status, (await revOutbox(t, r13)).length]).toEqual(['pending', 0]);
    // REV không có endpoint nhận hay phát event (T21)
    for (const path of ['/events', '/reviews/events', '/internal/events']) expect([404]).toContain((await call(t, 'post', path, { cookie: w.admin.cookie, body: { type: 'ReviewPublished' } })).status);
  }, 120_000);
});
