import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { JobRunner } from '../../src/modules/platform';
import { ORIGIN } from '../support/app';
import { API_DIR, testDbUrl } from '../support/db';
import {
  addItem, buyer, call, cartCount, cartsOf, createCrtApp, deliver, getCart, itemsOf, processed, q, race, resetCrt, seedCart, setQty, sku, type CrtApp,
} from '../support/crt';

// REQ ...103226614 (vòng đời giỏ theo event và job dọn giỏ bỏ dở): consumer `cart` của outbox, job `cart.abandon`; PostgreSQL thật, đua song song thật, tiến trình con bị SIGKILL.
let t: CrtApp;
beforeAll(async () => { t = await createCrtApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetCrt(t); t.logs.clear(); });
afterEach(() => jest.restoreAllMocks());

const DAY = 86_400_000;
const ago = (ms: number): Date => new Date(Date.now() - ms);
const completed = (cart: string, order: string, checkout = randomUUID()) => ({ checkout_id: checkout, cart_id: cart, order_id: order });
const logsOf = (code: string) => t.logs.records.filter((r) => r.code === code);

describe('CRT consumer CheckoutCompleted (CRT-REQ-20261006-103226614 BR1)', () => {
  it('CRT-TC-20261006-104454824: CheckoutCompleted chuyển giỏ sang converted kèm converted_order_id và processed_events; xem giỏ thấy giỏ trống; thêm sản phẩm tạo giỏ mới', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10), p2 = await sku(t, 100000, 10);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1 }, { product: p2 }] });
    const e1 = randomUUID(), o1 = randomUUID();
    await deliver(t, 'CheckoutCompleted', completed(cart, o1), e1);
    const [c1] = await cartsOf(t, u.id);
    expect(c1).toMatchObject({ id: cart, status: 'converted', converted_order_id: o1 });
    expect(await processed(t, e1)).toHaveLength(1);
    const g = await getCart(t, u);
    expect([g.body.cart_id, g.body.items]).toEqual([null, []]);
    const a = await addItem(t, u, p1, 1);
    expect(a.status).toBe(201);
    const carts = await cartsOf(t, u.id);
    expect(carts.map((c) => c.status)).toEqual(['converted', 'active']);
    expect(carts[1].id).not.toBe(cart);
    expect(await q(t, `SELECT id FROM outbox_events WHERE type LIKE 'Cart%'`)).toEqual([]); // CRT không phát event nào
  });

  it('CRT-TC-20261006-104454936: event cho giỏ không có hoặc đã converted là no-op có log (cart_id và lý do), không lỗi, converted_order_id giữ nguyên', async () => {
    const u = await buyer(t);
    const { cart } = await seedCart(t, u.id, { status: 'converted', lines: [{ product: await sku(t) }] });
    const o1 = (await cartsOf(t, u.id))[0].converted_order_id;
    const cx = randomUUID();
    const before = JSON.stringify(await cartsOf(t, u.id));
    await deliver(t, 'CheckoutCompleted', completed(cx, randomUUID()));
    await deliver(t, 'CheckoutCompleted', completed(cart, randomUUID()));
    expect(JSON.stringify(await cartsOf(t, u.id))).toBe(before);
    expect((await cartsOf(t, u.id))[0].converted_order_id).toBe(o1);
    expect(logsOf('cart-not-active').map((r) => r.cart_id)).toEqual([cx, cart]);
    // payload sai hình dạng: bỏ qua có log, không ném, không ghi payload; giỏ abandoned cũng không đổi
    const ab = await seedCart(t, (await buyer(t)).id, { status: 'abandoned' });
    await deliver(t, 'CheckoutCompleted', { cart_id: 'x', order_id: 5, secret: 'KHONG-GHI-LOG' });
    await deliver(t, 'CheckoutCompleted', completed(ab.cart, randomUUID()));
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${ab.cart}'`))[0].status).toBe('abandoned');
    expect(logsOf('event-malformed')).toHaveLength(1);
    expect(t.logs.lines.join('')).not.toContain('KHONG-GHI-LOG');
  });

  it('CRT-TC-20261006-104455293: giao lại cùng event_id và event_id khác không đổi gì thêm: E1 lần hai bị bỏ qua nhờ processed_events, E2 bị bỏ qua nhờ điều kiện status active', async () => {
    const u = await buyer(t);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: await sku(t) }] });
    const e1 = randomUUID(), e2 = randomUUID(), o1 = randomUUID();
    await deliver(t, 'CheckoutCompleted', completed(cart, o1), e1);
    const first = (await cartsOf(t, u.id))[0];
    expect(first).toMatchObject({ status: 'converted', converted_order_id: o1 });
    await deliver(t, 'CheckoutCompleted', completed(cart, o1), e1); // outbox giao lại
    await deliver(t, 'CheckoutCompleted', completed(cart, o1), e2);
    const last = (await cartsOf(t, u.id))[0];
    expect([last.status, last.converted_order_id, last.updated_at.getTime()]).toEqual(['converted', o1, first.updated_at.getTime()]);
    expect((await processed(t)).map((p) => p.event_id).sort()).toEqual([e1, e2].sort()); // mỗi event_id đúng một dòng
    expect(logsOf('cart-not-active')).toHaveLength(1); // E2 (E1 lần hai bị platform bỏ qua ở `deliver` trước khi tới handler của CRT, không log)
  });

  it('CRT-TC-20261006-113000110: CheckoutCompleted của đơn COD chuyển giỏ sang converted như đơn vnpay (CRT không đọc payment_method) và không phát event nào', async () => {
    const a = await buyer(t), b = await buyer(t);
    const p1 = await sku(t);
    const c1 = await seedCart(t, a.id, { lines: [{ product: p1 }, { product: await sku(t) }] }), c2 = await seedCart(t, b.id, { lines: [{ product: p1 }] });
    const o1 = randomUUID(), o2 = randomUUID();
    await deliver(t, 'CheckoutCompleted', { ...completed(c1.cart, o1), payment_method: 'cod' }, randomUUID());
    await deliver(t, 'CheckoutCompleted', { ...completed(c2.cart, o2), payment_method: 'vnpay' }, randomUUID());
    expect((await cartsOf(t, a.id))[0]).toMatchObject({ status: 'converted', converted_order_id: o1 });
    expect((await cartsOf(t, b.id))[0]).toMatchObject({ status: 'converted', converted_order_id: o2 });
    expect(await q(t, 'SELECT id FROM outbox_events')).toEqual([]);
  });

  it('CRT-TC-20261006-113000220: tiến trình chết giữa nhận event và commit thì cả processed_events lẫn UPDATE đều không có; giao lại thì giỏ converted đúng một lần; giao lại lần nữa không đổi gì', async () => {
    const u = await buyer(t);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: await sku(t) }] });
    const e1 = randomUUID(), o1 = randomUUID();
    const died = await new Promise<{ code: number | null; signal: string | null; out: string }>((res) => {
      const c = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/cart-then-die.ts', e1, cart, o1], {
        cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('exit', (code, signal) => res({ code, signal, out }));
    });
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect((await cartsOf(t, u.id))[0]).toMatchObject({ status: 'active', converted_order_id: null });
    expect(await processed(t, e1)).toEqual([]); // cả hai cùng không commit
    await deliver(t, 'CheckoutCompleted', completed(cart, o1), e1); // outbox giao lại
    const after = (await cartsOf(t, u.id))[0];
    expect(after).toMatchObject({ status: 'converted', converted_order_id: o1 });
    expect(await processed(t, e1)).toHaveLength(1);
    await deliver(t, 'CheckoutCompleted', completed(cart, o1), e1); // chết trước khi đánh dấu dispatched_at: giao lại lần nữa
    expect((await cartsOf(t, u.id))[0].updated_at.getTime()).toBe(after.updated_at.getTime());
    expect(await processed(t, e1)).toHaveLength(1);
  }, 120_000);
});

describe('CRT consumer ProductArchived (CRT-REQ-20261006-103226614 BR2)', () => {
  it('CRT-TC-20261006-104454878: ProductArchived đánh dấu dòng ở mọi giỏ active (quantity không đổi), không đụng giỏ converted; xem giỏ thấy unavailable và tạm tính không tính dòng đó', async () => {
    const a = await buyer(t), b = await buyer(t), d = await buyer(t);
    const p1 = await sku(t, 100000, 10), p2 = await sku(t, 50000, 10);
    const ca = await seedCart(t, a.id, { lines: [{ product: p1, quantity: 2 }, { product: p2 }] }), cb = await seedCart(t, b.id, { lines: [{ product: p1 }] });
    const cd = await seedCart(t, d.id, { status: 'converted', lines: [{ product: p1, quantity: 4 }] });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p1}::uuid`;
    const e = randomUUID();
    await deliver(t, 'ProductArchived', { product_id: p1 }, e);
    const ia = await itemsOf(t, ca.cart);
    expect(ia.map((i) => [i.product_id, i.quantity, i.unavailable_reason])).toEqual([[p1, 2, 'product_archived'], [p2, 1, null]]);
    expect((await itemsOf(t, cb.cart))[0].unavailable_reason).toBe('product_archived');
    expect((await itemsOf(t, cd.cart))[0]).toMatchObject({ quantity: 4, unavailable_reason: null });
    expect(await processed(t, e)).toHaveLength(1);
    const g = await getCart(t, a);
    expect(g.body.items[0].availability).toEqual({ status: 'unavailable' });
    expect(g.body).toMatchObject({ subtotal: 50000, item_count: 3 });
    await deliver(t, 'ProductArchived', { product_id: p1 }, e); // giao lại: không đổi gì
    expect((await itemsOf(t, ca.cart)).map((i) => i.quantity)).toEqual([2, 1]);
  });

  it('CRT-TC-20261006-104455032: mất ProductArchived (handler chưa chạy) vẫn không tính dòng ngừng bán vì xem giỏ kiểm lại với PRD', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 10), p2 = await sku(t, 50000, 10);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: p1 }, { product: p2 }] });
    await t.prisma.$executeRaw`UPDATE products SET status = 'archived' WHERE id = ${p1}::uuid`; // không có event nào được xử lý
    expect((await itemsOf(t, cart))[0].unavailable_reason).toBeNull();
    const g = await getCart(t, u);
    expect(g.body.items[0].availability).toEqual({ status: 'unavailable' });
    expect(g.body.subtotal).toBe(50000);
  });

  it('CRT-TC-20261006-104454878: ProductArchived chia lô 1000 dòng mỗi câu: 2500 giỏ cùng một sản phẩm đều được đánh dấu, mọi giỏ khác không bị đụng; payload sai hình dạng bị bỏ qua có log', async () => {
    const p1 = await sku(t), p2 = await sku(t);
    await t.prisma.$executeRaw`
      WITH c AS (INSERT INTO carts (user_id) SELECT gen_random_uuid() FROM generate_series(1, 2500) RETURNING id)
      INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) SELECT id, ${p1}::uuid, 1, 100000 FROM c`;
    const keep = await seedCart(t, (await buyer(t)).id, { lines: [{ product: p2 }] });
    await deliver(t, 'ProductArchived', { product_id: 'khong-phai-uuid' });
    expect(logsOf('event-malformed')).toHaveLength(1);
    await deliver(t, 'ProductArchived', { product_id: p1 });
    expect(await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM cart_items WHERE product_id = '${p1}' AND unavailable_reason = 'product_archived'`)).toEqual([{ n: 2500 }]);
    expect((await itemsOf(t, keep.cart))[0].unavailable_reason).toBeNull();
    expect(logsOf('cart-items-archived').map((r) => r.items)).toEqual([2500]);
  }, 60_000);
});

describe('CRT job cart.abandon (CRT-REQ-20261006-103226614 BR3 đến BR8)', () => {
  it('CRT-TC-20261006-104455112: mốc 30 ngày: giỏ cách 30 ngày trừ 1 phút vẫn active, cách 30 ngày cộng 1 phút thì abandoned; chạy qua bộ lập lịch của platform (job cart.abandon), chạy lại không đổi thêm', async () => {
    const [u4, u5] = [await buyer(t), await buyer(t)];
    const p1 = await sku(t);
    await seedCart(t, u4.id, { lines: [{ product: p1 }], lastActivityAt: ago(30 * DAY - 60_000) });
    await seedCart(t, u5.id, { lines: [{ product: p1 }], lastActivityAt: ago(30 * DAY + 60_000) });
    expect(await t.app.get(JobRunner).runOnce('cart.abandon')).toBe('ran');
    expect((await cartsOf(t, u4.id))[0].status).toBe('active');
    expect((await cartsOf(t, u5.id))[0].status).toBe('abandoned');
    expect((await t.jobs.abandonOnce()).carts).toBe(0);
    expect(logsOf('cart-abandon').map((r) => r.carts)).toEqual([1, 0]); // mỗi lượt ghi số giỏ đã đánh dấu (BR8)
    // giỏ abandoned không còn truy cập được: xem là giỏ trống, thêm kế tiếp tạo giỏ mới
    expect((await getCart(t, u5)).body.cart_id).toBeNull();
    expect((await addItem(t, u5, p1, 1)).status).toBe(201);
    expect((await cartsOf(t, u5.id)).map((c) => c.status)).toEqual(['abandoned', 'active']);
  });

  it('CRT-TC-20261006-104455174: chỉ xem giỏ và huy hiệu không làm giỏ còn hoạt động: last_activity_at không đổi sau các lần xem, rồi giỏ 31 ngày thành abandoned', async () => {
    const u = await buyer(t);
    const old = ago(31 * DAY);
    const { cart } = await seedCart(t, u.id, { lines: [{ product: await sku(t) }], lastActivityAt: old });
    for (let i = 0; i < 3; i++) { await getCart(t, u); await call(t, 'get', '/cart/summary', { cookie: u.cookie }); }
    expect((await cartsOf(t, u.id))[0].last_activity_at.getTime()).toBe(old.getTime());
    await t.jobs.abandonOnce();
    expect((await q<{ status: string; last_activity_at: Date }>(t, `SELECT status::text AS status, last_activity_at FROM carts WHERE id = '${cart}'`))[0]).toMatchObject({ status: 'abandoned', last_activity_at: old });
  });

  it('CRT-TC-20261006-104455235: job và thao tác của khách đua nhau không để lại trạng thái nửa vời: C7 active với số lượng mới, hoặc abandoned và PATCH 404 (lặp 50 lần)', async () => {
    const p1 = await sku(t, 100000, 1000);
    const seen = { customerWon: 0, jobWon: 0 };
    for (let i = 0; i < 50; i++) {
      const u = await buyer(t);
      const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1 }], lastActivityAt: ago(30 * DAY + 60_000) });
      const [, patch] = await race(() => t.jobs.abandonOnce(), () => setQty(t, u, items[0], 2));
      const row = (await q<{ status: string; last_activity_at: Date }>(t, `SELECT status::text AS status, last_activity_at FROM carts WHERE id = '${cart}'`))[0];
      const qty = (await itemsOf(t, cart))[0].quantity;
      if (row.status === 'active') { expect([i, patch.status, qty]).toEqual([i, 200, 2]); expect(row.last_activity_at.getTime()).toBeGreaterThan(Date.now() - 60_000); seen.customerWon++; }
      else { expect([i, row.status, patch.status, qty]).toEqual([i, 'abandoned', 404, 1]); seen.jobWon++; } // không bao giờ abandoned mà dòng đã đổi
    }
    expect(seen.customerWon + seen.jobWon).toBe(50);
  }, 120_000);

  it('CRT-TC-20261006-104455235: job đánh dấu bỏ dở đúng giữa lúc khách đọc dòng và lúc khóa giỏ (xác định, không nhờ đua): PATCH nhận 404, dòng không đổi, giỏ abandoned; thao tác kế tiếp tạo giỏ mới', async () => {
    const u = await buyer(t);
    const p1 = await sku(t, 100000, 100);
    const { cart, items } = await seedCart(t, u.id, { lines: [{ product: p1, quantity: 1 }], lastActivityAt: ago(31 * DAY) });
    const real = t.catalog.getForCart.bind(t.catalog);
    jest.spyOn(t.catalog, 'getForCart').mockImplementationOnce(async (ids) => { await t.jobs.abandonOnce(); return real(ids); }); // sau findItem, trước giao dịch ghi
    const r = await setQty(t, u, items[0], 2);
    expect([r.status, r.body.type]).toEqual([404, 'urn:ecom:error:cart-item-not-found']);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${cart}'`))[0].status).toBe('abandoned');
    expect((await itemsOf(t, cart))[0].quantity).toBe(1);
    expect((await addItem(t, u, p1, 1)).status).toBe(201); // giỏ mới, không phải giỏ đã bỏ dở
    expect((await cartsOf(t, u.id)).map((c) => c.status)).toEqual(['abandoned', 'active']);
  });

  it('CRT-TC-20261006-113000330: hai bản job chạy cùng lúc (hai instance, khóa tư vấn và SKIP LOCKED) không xử lý trùng: 2500 giỏ cũ abandoned, 10 giỏ mới còn active, tổng log bằng 2500 (lô 1000)', async () => {
    const t2 = await createCrtApp();
    try {
      await t.prisma.$executeRaw`INSERT INTO carts (user_id, last_activity_at) SELECT gen_random_uuid(), now() - interval '30 days' - interval '1 minute' FROM generate_series(1, 2500)`;
      await t.prisma.$executeRaw`INSERT INTO carts (user_id, last_activity_at) SELECT gen_random_uuid(), now() - interval '29 days' FROM generate_series(1, 10)`;
      const results = await Promise.all([t.app.get(JobRunner).runOnce('cart.abandon'), t2.app.get(JobRunner).runOnce('cart.abandon')]);
      expect(results.every((r) => r === 'ran' || r === 'skipped')).toBe(true);
      expect(results).toContain('ran');
      // chạy tiếp bằng gọi thẳng song song (không qua khóa tư vấn): chỉ SKIP LOCKED chặn xử lý trùng
      await Promise.all([t.jobs.abandonOnce(), t2.jobs.abandonOnce()]);
      expect(await q<{ status: string; n: number }>(t, `SELECT status::text AS status, count(*)::int AS n FROM carts GROUP BY status ORDER BY status`)).toEqual([{ status: 'abandoned', n: 2500 }, { status: 'active', n: 10 }]);
      const total = (x: CrtApp) => x.logs.records.filter((r) => r.code === 'cart-abandon').reduce((s, r) => s + r.carts, 0);
      expect(total(t) + total(t2)).toBe(2500);
      const maxBatches = Math.max(...[...t.logs.records, ...t2.logs.records].filter((r) => r.code === 'cart-abandon').map((r) => r.batches));
      expect(maxBatches).toBeLessThanOrEqual(3); // 2500 giỏ chia lô 1000: tối đa 3 lô một lượt
    } finally { await t2.close(); }
  }, 120_000);

  it('CRT-TC-20261006-113000330: giỏ đang bị giữ khóa (khách hay CHK) được job bỏ qua, job không chờ khóa: lượt này đánh dấu các giỏ còn lại, lượt sau (hết khóa) đánh dấu nốt giỏ đó', async () => {
    await t.prisma.$executeRaw`INSERT INTO carts (user_id, last_activity_at) SELECT gen_random_uuid(), now() - interval '40 days' FROM generate_series(1, 5)`;
    const held = await t.tx.run(async (tx) => {
      const [c] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE status = 'active' ORDER BY id LIMIT 1 FOR UPDATE`;
      // job chạy bằng kết nối khác khi giao dịch này còn giữ khóa dòng: thiếu SKIP LOCKED thì chờ mãi (bế tắc giữa test và job), nên có hạn 5 giây để đỏ rõ ràng
      const run = await Promise.race([t.jobs.abandonOnce(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('job chờ khóa dòng giỏ (thiếu SKIP LOCKED)')), 5000))]);
      return { id: c.id, run };
    });
    expect(held.run).toEqual({ carts: 4, batches: 1 });
    expect(await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${held.id}'`)).toEqual([{ status: 'active' }]);
    expect(await t.jobs.abandonOnce()).toEqual({ carts: 1, batches: 1 });
    expect(await cartCount(t, `status = 'abandoned'`)).toBe(5);
  }, 30_000);

  it('CRT-TC-20261006-113000330 CRT-TC-20261013-211638383: giới hạn lô và hạn thời gian của job: lô nhỏ chia nhỏ giao dịch, hạn 0 hoặc đã hủy thì không làm gì (đóng khi không chắc), lượt sau làm tiếp', async () => {
    await t.prisma.$executeRaw`INSERT INTO carts (user_id, last_activity_at) SELECT gen_random_uuid(), now() - interval '40 days' FROM generate_series(1, 250)`;
    const ac = new AbortController(); ac.abort();
    expect(await t.jobs.abandonOnce({ signal: ac.signal })).toEqual({ carts: 0, batches: 0 });
    expect(await t.jobs.abandonOnce({ budgetMs: 0 })).toEqual({ carts: 0, batches: 0 });
    expect(await t.jobs.abandonOnce({ batch: 100 })).toEqual({ carts: 250, batches: 3 });
    expect(await cartCount(t, `status = 'abandoned'`)).toBe(250);
    // mốc giờ CSDL giả lập: `now` trong quá khứ thì chưa giỏ nào đủ 30 ngày
    await t.prisma.$executeRaw`INSERT INTO carts (user_id, last_activity_at) VALUES (gen_random_uuid(), now() - interval '10 days')`;
    expect(await t.jobs.abandonOnce({ now: new Date(Date.now() + 15 * DAY) })).toEqual({ carts: 0, batches: 0 }); // giỏ 10 ngày, mốc giả 25 ngày tuổi
    expect(await t.jobs.abandonOnce({ now: new Date(Date.now() + 21 * DAY) })).toEqual({ carts: 1, batches: 1 });
  });
});
