import { spawn } from 'node:child_process';
import { JobRunner, type EventEnvelope } from '../../src/modules/platform';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';
import { ORIGIN } from '../support/app';
import { actor, call, couponOf, createPrmApp, deliver, eventsOf, paid, q, redemptionsOf, relay, reserve, rid, seedCoupon, seedRedemption, type PrmApp } from '../support/prm';

// Hạn dùng (PRM-REQ-20261006-101036424): kiểm theo giờ CSDL ngay khi dùng (không chờ job), job hết hạn mỗi phút phát CouponExpired đúng một lần mỗi coupon.
// Mốc thời gian là tương đối so với giờ CSDL (fixture tính từ `now()`), ranh giới mili giây thử bằng tham số `now` của dịch vụ (đường chạy thật dùng `now()` của CSDL).
describe('PRM hết hạn coupon', () => {
  let t: PrmApp;
  beforeAll(async () => { t = await createPrmApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });
  const expiresAt = async (code: string): Promise<Date> => (await couponOf(t, code)).expires_at;
  const at = (d: Date, ms: number) => new Date(d.getTime() + ms);

  it('PRM-TC-20261006-101037572: còn hạn một giây trước expires_at (evaluate thành công), job chạy sau hạn chuyển sang expired và ghi đúng một CouponExpired cùng giao dịch (coupon_id của SALE10)', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', expiresInSec: 3600 });
    const x = await expiresAt('SALE10');
    expect(await t.evaluator.evaluate({ code: 'SALE10', user_id: rid(), items_subtotal: 300000 }, { now: at(x, -1000) })).toMatchObject({ ok: true });
    expect(await t.jobs.expireOnce({ now: at(x, -1) })).toEqual({ coupons: 0, batches: 0 }); // 1 mili giây trước hạn thì không chạm
    expect(await t.jobs.expireOnce({ now: x })).toEqual({ coupons: 1, batches: 1 }); // đúng lúc hết hạn (expires_at <= giờ máy chủ) thì chuyển
    expect(await t.jobs.expireOnce({ now: at(x, 30_000) })).toEqual({ coupons: 0, batches: 0 }); // lần chạy lúc +30 giây không phát lại
    expect((await couponOf(t, 'SALE10')).status).toBe('expired');
    const ev = await eventsOf(t, 'CouponExpired');
    expect(ev).toHaveLength(1);
    expect([ev[0].aggregate_id, ev[0].payload]).toEqual([id, { coupon_id: id }]);
  });

  it('PRM-TC-20261006-101037596: đúng thời điểm hết hạn và sau đó evaluate đều là coupon_expired (bằng hoặc sau expires_at); PATCH khi chưa qua job là 409 coupon_not_editable; sau job enable, disable là invalid_transition còn xóa là 204', async () => {
    await seedCoupon(t, { code: 'SALE10', expiresInSec: 3600 });
    const x = await expiresAt('SALE10');
    const ev = (now: Date) => t.evaluator.evaluate({ code: 'SALE10', user_id: rid(), items_subtotal: 300000 }, { now });
    expect(await ev(at(x, -1))).toMatchObject({ ok: true }); // 1 mili giây trước hạn
    expect(await ev(x)).toEqual({ ok: false, reason: 'coupon_expired' }); // đúng lúc hết hạn
    expect(await ev(at(x, 1000))).toEqual({ ok: false, reason: 'coupon_expired' });
    // quá hạn thật theo giờ CSDL
    const late = await seedCoupon(t, { code: 'LATE10', expiresInSec: -1 });
    const admin = await actor(t, 'admin');
    const patch = await call(t, 'patch', `/admin/coupons/${late.id}`, { cookie: admin.cookie, body: { version: 1, value: 5 } });
    expect([patch.status, patch.body.code]).toEqual([409, 'coupon_not_editable']);
    expect(await t.jobs.expireOnce()).toMatchObject({ coupons: 1 });
    const act = (what: string) => call(t, 'post', `/admin/coupons/${late.id}/${what}`, { cookie: admin.cookie });
    expect([(await act('enable')).body.code, (await act('disable')).body.code]).toEqual(['invalid_transition', 'invalid_transition']);
    expect((await call(t, 'delete', `/admin/coupons/${late.id}`, { cookie: admin.cookie })).status).toBe(204);
    expect((await couponOf(t, 'LATE10')).status).toBe('deleted');
  });

  it('PRM-TC-20261006-101037619: job chưa chạy nhưng coupon quá hạn 5 phút vẫn bị evaluate và reserve từ chối coupon_expired; trạng thái đã lưu vẫn active, không đổi đếm, không có lượt', async () => {
    await seedCoupon(t, { code: 'SALE10', expiresInSec: -300 }); // job nền không chạy trong test (JobRunner.start không được gọi)
    expect(await t.prm.evaluate({ code: 'SALE10', user_id: rid(), items_subtotal: 300000 })).toEqual({ ok: false, reason: 'coupon_expired' });
    expect(await reserve(t, { code: 'SALE10' })).toEqual({ ok: false, reason: 'coupon_expired' });
    expect(await couponOf(t, 'SALE10')).toMatchObject({ status: 'active', reserved_count: 0 });
    expect(await q(t, 'SELECT 1 FROM coupon_redemptions')).toHaveLength(0);
  });

  it('PRM-TC-20261007-144433030: coupon disabled đã quá hạn 5 phút: evaluate và reserve trả coupon_not_found giống hệt mã không tồn tại (không lộ mã có thật mà đang tắt), evaluate tính một lần sai; sau lượt job đổi sang expired thì evaluate trả coupon_expired (PRM-REQ-20261006-101036327 BR4, PRM-REQ-20261006-101036424 BR4)', async () => {
    const { id } = await seedCoupon(t, { code: 'OLD10', status: 'disabled', expiresInSec: -300 });
    const u = rid();
    const ev = (code: string) => t.prm.evaluate({ code, user_id: u, items_subtotal: 300000 });
    const wrong = async () => (await q<{ c: number }>(t, `SELECT coalesce(sum(count), 0)::int AS c FROM rate_limit_counters WHERE bucket = 'ctr:prm:notfound:${u}'`))[0].c;
    const none = await ev('NOPE1234');
    expect(none).toEqual({ ok: false, reason: 'coupon_not_found' });
    expect(await ev('OLD10')).toEqual(none); // cùng lý do, cùng hình dạng
    expect(await wrong()).toBe(2); // mỗi lần tính một lần sai
    expect(await reserve(t, { code: 'OLD10' })).toEqual({ ok: false, reason: 'coupon_not_found' });
    expect(await couponOf(t, 'OLD10')).toMatchObject({ status: 'disabled', reserved_count: 0 });
    expect(await q(t, 'SELECT 1 FROM coupon_redemptions')).toHaveLength(0);
    expect(await t.jobs.expireOnce()).toEqual({ coupons: 1, batches: 1 });
    expect(await couponOf(t, 'OLD10')).toMatchObject({ status: 'expired' });
    expect((await eventsOf(t, 'CouponExpired')).map((e) => e.aggregate_id)).toEqual([id]);
    expect(await ev('OLD10')).toEqual({ ok: false, reason: 'coupon_expired' });
    expect(await wrong()).toBe(2); // coupon_expired không phải lần sai: lượt đã `take` được hoàn lại
  });

  it('PRM-TC-20261006-101037642: job chạy ba lần: A (active quá hạn) và B (disabled quá hạn 1 ngày) thành expired với đúng một CouponExpired mỗi coupon, C (exhausted) không đổi; hai instance và 100 coupon cùng lúc vẫn một event mỗi coupon', async () => {
    const A = await seedCoupon(t, { code: 'CPNA', expiresInSec: -60 }), B = await seedCoupon(t, { code: 'CPNB', status: 'disabled', expiresInSec: -86400 }), C = await seedCoupon(t, { code: 'CPNC', status: 'exhausted', usageLimit: 1, consumed: 1, expiresInSec: -60 });
    expect(await t.jobs.expireOnce()).toMatchObject({ coupons: 2 });
    expect(await t.jobs.expireOnce()).toEqual({ coupons: 0, batches: 0 });
    expect(await t.jobs.expireOnce()).toEqual({ coupons: 0, batches: 0 });
    expect((await eventsOf(t, 'CouponExpired')).map((e) => e.payload.coupon_id).sort()).toEqual([A.id, B.id].sort());
    expect([(await couponOf(t, 'CPNA')).status, (await couponOf(t, 'CPNB')).status, (await couponOf(t, C.code)).status]).toEqual(['expired', 'expired', 'exhausted']);
    // hai instance chạy job cùng lúc trên 100 coupon quá hạn: mỗi coupon đúng một event (khóa tư vấn của JobRunner và SKIP LOCKED theo lô)
    await truncateAll(t.prisma);
    for (let i = 0; i < 100; i++) await seedCoupon(t, { code: `RUSH${String(i).padStart(3, '0')}`, expiresInSec: -30 });
    const b = await createPrmApp();
    try {
      const results = await Promise.all([t.jobs.expireOnce({ batch: 7 }), b.jobs.expireOnce({ batch: 7 }), t.runner.runOnce('promotion.expire-coupons'), b.runner.runOnce('promotion.expire-coupons')]);
      expect(results.slice(0, 2).reduce((n, r) => n + (r as { coupons: number }).coupons, 0)).toBeLessThanOrEqual(100);
    } finally { await b.close(); }
    const ev = await eventsOf(t, 'CouponExpired');
    expect(ev).toHaveLength(100);
    expect(new Set(ev.map((e) => e.aggregate_id)).size).toBe(100);
    expect(await q(t, `SELECT 1 FROM coupons WHERE status <> 'expired'`)).toHaveLength(0);
  }, 60_000);

  it('PRM-TC-20261007-144433343 và PRM-TC-20261006-101037642 (giới hạn lô và hạn thời gian, SB-34): lô tối đa `batch` coupon mỗi giao dịch, hết hạn thời gian thì không nhận lô mới, tín hiệu hủy dừng job; job đăng ký chu kỳ mỗi phút với hạn nhỏ hơn chu kỳ', async () => {
    for (let i = 0; i < 5; i++) await seedCoupon(t, { code: `BATCH${i}`, expiresInSec: -30 });
    expect(await t.jobs.expireOnce({ batch: 2, budgetMs: 0 })).toEqual({ coupons: 0, batches: 0 }); // hết hạn thời gian ngay từ đầu
    const ac = new AbortController();
    ac.abort();
    expect(await t.jobs.expireOnce({ batch: 2, signal: ac.signal })).toEqual({ coupons: 0, batches: 0 });
    expect(await q(t, `SELECT 1 FROM coupons WHERE status = 'expired'`)).toHaveLength(0);
    expect(await t.jobs.expireOnce({ batch: 2 })).toEqual({ coupons: 5, batches: 3 }); // 2 + 2 + 1: mỗi lô tối đa 2
    const jobs = (t.app.get(JobRunner) as unknown as { jobs: Map<string, { every: number; timeoutMs?: number; module: string }> }).jobs;
    const [exp, rec] = [jobs.get('promotion.expire-coupons'), jobs.get('promotion.reconcile')];
    expect([exp?.every, exp?.module, (exp?.timeoutMs ?? Infinity) < (exp?.every ?? 0)]).toEqual([60_000, 'promotion', true]);
    expect([rec?.every, rec?.module]).toEqual([24 * 3600_000, 'promotion']);
    expect(await t.runner.runOnce('promotion.expire-coupons')).toBe('ran');
  });

  it('PRM-TC-20261007-144433343 và PRM-TC-20261006-101037642 (SKIP LOCKED, SB-34): job không chờ coupon đang bị giao dịch khác khóa mà bỏ qua nó và xử lý các coupon còn lại; coupon bị khóa được xử lý ở lượt sau khi nhả khóa', async () => {
    const a = await seedCoupon(t, { code: 'LOCKA', expiresInSec: -60 });
    await seedCoupon(t, { code: 'FREEB', expiresInSec: -60 });
    let during: unknown;
    await t.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${a.id}::uuid FOR UPDATE`; // một handler hay admin đang giữ dòng này
      during = await Promise.race([t.jobs.expireOnce(), new Promise((res) => setTimeout(() => res('bị chặn chờ khóa'), 3000))]);
    });
    expect(during).toEqual({ coupons: 1, batches: 1 }); // chỉ FREEB; không treo chờ LOCKA
    expect([(await couponOf(t, 'LOCKA')).status, (await couponOf(t, 'FREEB')).status]).toEqual(['active', 'expired']);
    expect(await t.jobs.expireOnce()).toEqual({ coupons: 1, batches: 1 }); // lượt sau
    expect((await couponOf(t, 'LOCKA')).status).toBe('expired');
    expect((await eventsOf(t, 'CouponExpired')).map((e) => e.aggregate_id).sort()).toEqual([a.id, (await couponOf(t, 'FREEB')).id].sort());
  });

  it('PRM-TC-20261006-101037666: lượt đã giữ trước hạn vẫn được tiêu thụ sau khi coupon hết hạn: lượt thành consumed, phát CouponRedeemed amount 30000, coupon vẫn expired', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', reserved: 1, expiresInSec: -300 });
    const red = await seedRedemption(t, id, { amount: 30000 });
    expect(await t.jobs.expireOnce()).toMatchObject({ coupons: 1 });
    expect((await couponOf(t, 'SALE10')).status).toBe('expired');
    await deliver(t, 'PaymentSucceeded', paid(red.order, red.user));
    const r = (await redemptionsOf(t, id))[0];
    expect([r.status, r.consumed_at !== null]).toEqual(['consumed', true]);
    expect(await couponOf(t, 'SALE10')).toMatchObject({ status: 'expired', consumed_count: 1, reserved_count: 0 });
    const ev = await eventsOf(t, 'CouponRedeemed');
    expect(ev.map((e) => e.payload)).toEqual([{ coupon_id: id, order_id: red.order, amount: 30000 }]);
  });

  it('PRM-TC-20261006-113100404: giết tiến trình (SIGKILL thật) ngay sau cam kết của job hết hạn thì CouponExpired vẫn nằm trong outbox và relay giao sau khởi động lại; giao lại cùng event_id bị bỏ qua', async () => {
    const { id } = await seedCoupon(t, { code: 'SALE10', expiresInSec: -60 });
    const spawnChild = (args: string[]) => spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/prm-then-die.ts', ...args], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const run = async (args: string[]) => {
      const child = spawnChild(args);
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      const [code, signal] = await new Promise<[number | null, string | null]>((r) => child.on('exit', (c, s) => r([c, s])));
      return { code, signal, out };
    };
    const died = await run(['expire']);
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect((await couponOf(t, 'SALE10')).status).toBe('expired'); // commit đã xong trước khi chết
    const rows = await q<{ id: string; aggregate_id: string; dispatched_at: Date | null }>(t, `SELECT id, aggregate_id, dispatched_at FROM outbox_events WHERE type = 'CouponExpired'`);
    expect(rows.map((r) => [r.aggregate_id, r.dispatched_at])).toEqual([[id, null]]); // đúng một event, chưa phát
    const got: EventEnvelope[] = [], handler = async (_tx: unknown, e: EventEnvelope) => { got.push(e); };
    t.events.subscribe('sink-expired', 'CouponExpired', handler); // chưa consumer nào ở events.md; consumer giả của test
    await relay(t);
    expect(got.map((e) => [e.event_id, (e.payload as { coupon_id: string }).coupon_id])).toEqual([[rows[0].id, id]]);
    expect(await t.events.deliver({ consumer: 'sink-expired', handler }, got[0])).toBe('skipped');
  }, 90_000);
});
