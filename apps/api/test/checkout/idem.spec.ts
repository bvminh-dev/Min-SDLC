import { spawn } from 'node:child_process';
import { Client } from 'pg';
import { API_DIR, roleDbUrl, testDbUrl } from '../support/db';
import { ORIGIN } from '../support/app';
import { SECRET, TMN } from '../support/pay';
import {
  auditsOf, countOf, create, createChkApp, customer, holdsOf, idemRows, noTrace, onHandOf, ordersOf, outboxOf, pickPayment, pickShipping, place, q, ready, relayAll, reservedCount, reservedOf, resetChk, seedCart, seedCoupon,
  sessionRow, shopper, tally, view, world, type ChkApp, type Seeded, type World,
} from '../support/chk';
import { sku, type CrtApp } from '../support/crt';

// Idempotency-Key (REQ ...105052272 BR13), audit (BR14) và outbox cùng giao dịch (BR7, SB-27): PostgreSQL thật; tiến trình con bị SIGKILL.
let t: ChkApp;
let w: World;
beforeAll(async () => { t = await createChkApp(); });
afterAll(() => t.close());
beforeEach(async () => { await resetChk(t); w = await world(t); await seedCoupon(t, { code: 'SALE10', type: 'percentage', value: 10, min: 200000 }); });
afterEach(() => jest.restoreAllMocks());
const body = (n = 345000, v = 7) => ({ expected_grand_total: n, cart_version: v });
async function full(o: { pay?: 'cod' | 'vnpay'; email?: string; coupon?: string | null; lines?: { product: string; quantity?: number }[] } = {}): Promise<{ s: Seeded; id: string }> {
  const s = await shopper(t, w, { email: o.email, lines: o.lines });
  return { s, id: await ready(t, s, w, { pay: o.pay ?? 'vnpay', coupon: o.coupon === undefined ? 'SALE10' : o.coupon }) };
}

describe('CHK Idempotency-Key khi đặt hàng (CHK-REQ-20261006-105052272 BR13, SB-40)', () => {
  it('CHK-TC-20261006-120840748: thiếu, sai định dạng ("a b") hay quá ngắn ("x") Idempotency-Key: cùng 400 idempotency-key-required, không tạo gì (kể cả AuditLog, OutboxEvent, IdempotencyKey); gọi lại với khóa hợp lệ thì 201 (ba lần trước không đốt khóa)', async () => {
    const { s, id } = await full();
    const before = await tally(t);
    const rs = [await place(t, s.u, id, body(), { key: null }), await place(t, s.u, id, body(), { key: 'a b' }), await place(t, s.u, id, body(), { key: 'x' })];
    for (const r of rs) { expect(r.status).toBe(400); expect(r.body.type).toBe('urn:ecom:error:idempotency-key-required'); }
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[1].body));
    expect(noTrace(rs[0].body)).toEqual(noTrace(rs[2].body));
    expect(await tally(t)).toEqual(before);
    expect([await reservedOf(t, w.p1), (await sessionRow(t, id)).status]).toEqual([0, 'open']);
    expect((await place(t, s.u, id, body(), { key: '4f1c2b7a-9d3e-4a60-8c15-0b7e2d9a6f31' })).status).toBe(201); // scan-secrets:allow khóa Idempotency-Key giả của test
  });

  it('CHK-TC-20261006-120848703: gửi lại cùng khóa K1 cùng nội dung: 200 replayed true cùng order.code, next và payment_deadline, không thêm gì; K1 với expected_grand_total khác: 422 idempotency-key-reused; khách B dùng K1 cho phiên của B được xử lý như yêu cầu mới; IdempotencyKey của A hết hạn sau 24 giờ', async () => {
    t.clock.set(new Date()); // IdempotencyService ghi hạn theo đồng hồ ứng dụng: đưa về giờ thật để so với giờ CSDL
    const { s, id } = await full();
    const first = await place(t, s.u, id, body(), { key: 'key-k1-aaaaaaaa' });
    expect(first.status).toBe(201);
    const after = await tally(t);
    const again = await place(t, s.u, id, body(), { key: 'key-k1-aaaaaaaa' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await tally(t)).toEqual(after);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([2, 1]);
    const reused = await place(t, s.u, id, body(363000), { key: 'key-k1-aaaaaaaa' });
    expect([reused.status, reused.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    expect(await tally(t)).toEqual(after);
    const b = await full({ email: 'b@shop.vn', pay: 'cod' });
    const mine = await place(t, b.s.u, b.id, body(), { key: 'key-k1-aaaaaaaa' });
    expect(mine.status).toBe(201);
    expect(mine.body.order.code).not.toBe(first.body.order.code);
    const [{ ms }] = await q<{ ms: number }>(t, 'SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms');
    const mineRow = (await idemRows(t)).find((r) => r.user_id === s.u.id)!;
    expect(mineRow.scope).toBe('checkout.place_order');
    expect(Math.abs(mineRow.expires_at.getTime() - (ms + 24 * 3600_000))).toBeLessThan(5000);
  });

  it('CHK-TC-20261006-120848703 (khóa gắn với phiên): cùng khóa, cùng body, khác phiên là yêu cầu khác (request_hash gồm tham số đường dẫn): 422 idempotency-key-reused', async () => {
    const { s, id } = await full();
    expect((await place(t, s.u, id, body(), { key: 'key-path-aaaaa' })).status).toBe(201);
    const r = await place(t, s.u, '2f6c1c0e-9a7b-4c11-8d1e-6a8e5f1a2b3c', body(), { key: 'key-path-aaaaa' });
    expect([r.status, r.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
  });
});

describe('CHK ghi AuditLog cùng giao dịch (CHK-REQ-20261006-105052272 BR14, SB-19)', () => {
  it('CHK-TC-20261006-120856566: đặt thành công ghi đúng một AuditLog (customer, checkout.place_order, order, after {order_code, grand_total 180000, cod}, correlation_id của yêu cầu) không chứa tên, điện thoại, địa chỉ; lần đặt bị 409 không để lại dòng nào; UPDATE và DELETE audit bị trigger chặn', async () => {
    const { s, id } = await full({ pay: 'cod', coupon: null, lines: [{ product: w.p1, quantity: 1 }] });
    const r = await place(t, s.u, id, body(180000));
    expect(r.status).toBe(201);
    const [o] = await ordersOf(t, s.u.id);
    const rows = await auditsOf(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: s.u.id, actor_role: 'customer', action: 'checkout.place_order', target_type: 'order', target_id: o.id, after: { order_code: o.code, grand_total: 180000, payment_method: 'cod' } });
    expect(rows[0].correlation_id).toBe((await outboxOf(t, 'CheckoutCompleted'))[0].correlation_id);
    expect(rows[0].correlation_id).not.toBe('none');
    const dump = JSON.stringify(await q(t, 'SELECT * FROM audit_logs WHERE action = \'checkout.place_order\''));
    for (const pii of ['Nguyễn An', '0901111111', '45 Nguyễn Huệ']) expect(dump).not.toContain(pii);
    // lần đặt thất bại: giỏ mới có P2 hết hàng, không thêm dòng audit
    await relayAll(t, 3);
    const p3 = await sku(t as unknown as CrtApp, 60000, 0, { name: 'Hết hàng' });
    await seedCart(t as never, s.u.id, { lines: [{ product: p3, quantity: 1 }], version: 2 });
    const id2 = (await create(t, s.u)).body.id;
    await pickShipping(t, s.u, id2, w.sm1); await pickPayment(t, s.u, id2, 'cod');
    const v = (await view(t, s.u, id2)).body;
    const bad = await place(t, s.u, id2, body(v.grand_total, 2));
    expect([bad.status, bad.body.type]).toEqual([409, 'urn:ecom:error:insufficient-stock']);
    expect(await auditsOf(t)).toHaveLength(1);
    const app = new Client({ connectionString: roleDbUrl('ecom_app') });
    await app.connect();
    try {
      await expect(app.query(`UPDATE audit_logs SET action = 'sửa' WHERE action = 'checkout.place_order'`)).rejects.toThrow(/append-only|permission denied/);
      await expect(app.query(`DELETE FROM audit_logs WHERE action = 'checkout.place_order'`)).rejects.toThrow(/append-only|permission denied/);
    } finally { await app.end(); }
    expect(await auditsOf(t)).toHaveLength(1);
  });
});

describe('CHK ghi event bền cùng giao dịch (SB-27, CHK-SEC T14, T15)', () => {
  const child = (mode: 'after-commit' | 'before-commit', user: string, session: string, key: string, expected: number, version: number) => new Promise<{ code: number | null; signal: string | null; out: string }>((res) => {
    const c = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/chk-then-die.ts', mode, user, session, key, String(expected), String(version)], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN, VNPAY_TMN_CODE: TMN, VNPAY_HASH_SECRET: SECRET, VNPAY_RETURN_URL: 'https://shop.example/orders/{order_code}/payment' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('exit', (code, signal) => res({ code, signal, out }));
  });

  it('CHK-TC-20261006-120905422: tiến trình bị SIGKILL ngay sau cam kết, trước khi relay phát: Order pending, hai reservation held, phiên completed và CheckoutCompleted (dispatched_at rỗng) vẫn nằm trong outbox, giỏ còn active; đặt lại bằng phiên khác 409 cart-already-ordered; sau relay CRT chuyển giỏ converted, PAY tạo một Payment; relay lần hai (và giao trùng) không đổi gì', async () => {
    const { s, id } = await full({ pay: 'vnpay' });
    const died = await child('after-commit', s.u.id, id, 'die-after-commit-1', 345000, 7);
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    const [o] = await ordersOf(t, s.u.id);
    expect(o.status).toBe('pending');
    expect((await holdsOf(t, o.id)).map((h) => h.status)).toEqual(['held', 'held']);
    expect((await sessionRow(t, id)).status).toBe('completed');
    const cc = await outboxOf(t, 'CheckoutCompleted');
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({ aggregate_id: id, dispatched_at: null, payload: { checkout_id: id, cart_id: s.cart, order_id: o.id } });
    expect(cc[0].correlation_id).toBeTruthy();
    expect(cc[0].occurred_at).toBeInstanceOf(Date);
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('active');
    // trong lúc event chưa giao: đặt lại cùng giỏ bằng phiên khác bị chặn
    const [o2] = await q<{ id: string }>(t, `INSERT INTO checkout_sessions (user_id, cart_id, address_id, shipping_method_id, payment_method, address_snapshot, expires_at)
      VALUES ('${s.u.id}', '${s.cart}', '${s.a1}', '${w.sm1}', 'cod', (SELECT address_snapshot FROM checkout_sessions WHERE id = '${id}'), now() + interval '30 minutes') RETURNING id`);
    const re = await place(t, s.u, o2.id, body());
    expect([re.status, re.body.type]).toEqual([409, 'urn:ecom:error:cart-already-ordered']);
    await relayAll(t, 1);
    expect((await outboxOf(t, 'CheckoutCompleted'))[0].dispatched_at).not.toBeNull();
    expect((await outboxOf(t, 'OrderCreated'))[0].dispatched_at).not.toBeNull();
    expect((await q<{ status: string }>(t, `SELECT status::text AS status FROM carts WHERE id = '${s.cart}'`))[0].status).toBe('converted');
    await relayAll(t, 3);
    expect(await q(t, `SELECT status::text AS status FROM payments WHERE order_id = '${o.id}'`)).toEqual([{ status: 'pending' }]);
    expect(await countOf(t, 'processed_events', `consumer = 'cart' AND event_id = '${cc[0].id}'`)).toBe(1);
    await t.prisma.$executeRaw`UPDATE outbox_events SET dispatched_at = NULL, next_attempt_at = now() WHERE id = ${cc[0].id}::uuid`;
    await relayAll(t, 2); // giao trùng cùng event_id
    expect(await countOf(t, 'processed_events', `consumer = 'cart' AND event_id = '${cc[0].id}'`)).toBe(1);
    expect([await countOf(t, 'orders'), await countOf(t, 'payments')]).toEqual([1, 1]);
  }, 120_000);

  it('CHK-TC-20261006-110703029 (SIGKILL giữa giao dịch, SB-27): chết sau khi INV và PRM đã giữ hàng và lượt coupon, trước khi cam kết: không có Order, reservation, lượt coupon, outbox, audit hay khóa idempotency; reserved về giá trị cũ; phiên open; đặt lại thì 201', async () => {
    const { s, id } = await full({ pay: 'cod' });
    const before = await tally(t);
    const died = await child('before-commit', s.u.id, id, 'die-before-commit-1', 345000, 7);
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect(await tally(t)).toEqual(before);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2), await reservedCount(t, 'SALE10'), await onHandOf(t, w.p1)]).toEqual([0, 0, 0, 10]);
    expect((await sessionRow(t, id)).status).toBe('open');
    expect((await place(t, s.u, id, body(), { key: 'die-before-commit-1' })).status).toBe(201); // scan-secrets:allow khóa Idempotency-Key giả của test
    expect(customer).toBeDefined();
  }, 120_000);
});
