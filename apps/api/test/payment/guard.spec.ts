import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import * as paymentIndex from '../../src/modules/payment';
import { PaymentApi } from '../../src/modules/payment';
import { PAY_VARS } from '../../src/modules/payment/config';
import { ConfigError, auditPermissions, auditRoutes, errorRegistry, loadConfig, parseMatrix, routeIds } from '../../src/modules/platform';
import { OrderApi } from '../../src/modules/order';
import { API_DIR, REPO_ROOT, testDbUrl, truncateAll } from '../support/db';
import { bootApp, freePort, portOpen, waitFor } from '../support/boot';
import { createAuthApp, type AuthApp } from '../support/auth';
import { call, createPayApp, initiate, ipn, ipnQuery, payRow, people, seedPayment, snapshot, TMN, SECRET, type PayApp } from '../support/pay';
import { insertOrder } from '../support/order-fixture';

// Kiểm quyền, ranh giới, mã lỗi, giao diện nội bộ và cấu hình bí mật của PAY (PAY-SEC T3, T4, T7, T9, T12, T21; SB-05, SB-07, SB-15, SB-16, SB-35).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const ARCH = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
const SRC = resolve(API_DIR, 'src/modules/payment');
const PAY_SCOPE = (id: string) => /\s\/api\/v1\/(admin\/)?(payments|refunds|webhooks\/vnpay)(\/|$)/.test(id);
// Năm hàng không có endpoint HTTP: tạo, ghi nhận thành công online, thất bại và đối soát, đóng thanh toán, hoàn tiền tự động (event, job; tác nhân system).
const INTERNAL = [
  'Tạo thanh toán khi đơn được tạo (event OrderCreated, không có endpoint)', 'Ghi nhận thanh toán online thành công (kết quả webhook, không có endpoint riêng)',
  'Ghi nhận thanh toán thất bại, đếm lượt thử, đối soát quá thời gian (hệ thống, không có endpoint)', 'Đóng thanh toán khi đơn hết hạn hoặc bị hủy (event, không có endpoint)',
  'Hoàn tiền tự động (hủy đơn đã thanh toán, thanh toán muộn, thanh toán trùng; hệ thống, không có endpoint)',
];
const opts = { scope: PAY_SCOPE, epic: 'PAY', exempt: INTERNAL };
const SEC = 'PAY-SEC-20261006-103701420';
const TLS_URL = 'postgresql://u:pw-not-printed@db.example:5432/app?sslmode=require'; // scan-secrets:allow giá trị giả của test
const STORAGE = { STORAGE_ENDPOINT: 'https://s3.example.test', STORAGE_ACCESS_KEY: 'k'.repeat(20), STORAGE_SECRET_KEY: 's'.repeat(40) };
const PAY_ENV = { VNPAY_TMN_CODE: 'MERCHANT1', VNPAY_PAY_URL: 'https://pay.vnpayment.vn/paymentv2/vpcpay.html', VNPAY_API_URL: 'https://pay.vnpayment.vn/merchant_webapi/api/transaction', VNPAY_RETURN_URL: 'https://shop.example/orders/{order_code}/payment' };
// NTF (ADR-007): ngoài dev bắt buộc SES_REGION, MAIL_FROM, APP_BASE_URL (https), SES_ACCESS_KEY, SES_SECRET_KEY: giá trị giả đủ để chỉ còn biến của PAY là thứ thiếu
const NTF_ENV = { SES_REGION: 'ap-southeast-1', MAIL_FROM: 'no-reply@shop.example', APP_BASE_URL: 'https://shop.example', SES_ACCESS_KEY: 'a'.repeat(20), SES_SECRET_KEY: 'b'.repeat(40) };
const prod = { APP_ENV: 'prod', DATABASE_URL: TLS_URL, RETENTION_DATABASE_URL: TLS_URL, CORS_ALLOWED_ORIGINS: 'https://shop.example', ...STORAGE, ...NTF_ENV, ...PAY_ENV };
const problems = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ConfigError) return e; throw e; } throw new Error('không ném ConfigError'); };

describe('PAY kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`PAY-TC-20261006-130000100 ${SEC} T5, T9 (SB-05): danh sách route của PAY đúng 11 route của PAY-API; không có đường HTTP nào để nhận event, giả kết quả quay về của cổng, đổi trạng thái hay sửa lịch sử`, async () => {
    expect(routeIds(t.app).filter(PAY_SCOPE).sort()).toEqual([
      'GET /api/v1/admin/payments', 'GET /api/v1/admin/payments/:id', 'GET /api/v1/admin/refunds', 'GET /api/v1/payments', 'GET /api/v1/payments/:id', 'GET /api/v1/webhooks/vnpay/ipn',
      'POST /api/v1/payments/:id/cod-collect', 'POST /api/v1/payments/:id/initiate', 'POST /api/v1/payments/:id/refunds', 'POST /api/v1/payments/:id/retry', 'POST /api/v1/refunds/:id/retry',
    ].sort());
    expect(routeIds(t.app).filter((id) => /payment|refund/i.test(id) && /event|return|callback|succeed|fail|expire|cancel|createFrom|dispatch|internal|revenue/i.test(id))).toEqual([]);
    const { a, staff, admin } = await people(t as PayApp);
    const pay = await seedPayment(t, { user: a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    const before = await snapshot(t);
    const attempts: [string, string, unknown][] = [
      ['post', '/payments/events', { type: 'OrderCancelled', order_id: pay.order.id }], ['post', '/events', { type: 'PaymentSucceeded', order_id: pay.order.id }], ['post', '/webhooks/vnpay/events', {}],
      ['post', '/webhooks/vnpay/ipn', {}], ['get', `/payments/return?vnp_ResponseCode=00&vnp_TxnRef=${pay.attempts[0].txnRef}`, undefined], ['get', `/webhooks/vnpay/return?vnp_ResponseCode=00`, undefined],
      ['patch', `/payments/${pay.id}`, { status: 'succeeded' }], ['put', `/payments/${pay.id}`, { status: 'succeeded' }], ['delete', `/payments/${pay.id}`, undefined], ['post', `/payments/${pay.id}/succeed`, {}],
      ['post', `/payments/${pay.id}/cancel`, {}], ['post', `/payments/${pay.id}/expire`, {}], ['post', '/payments', { order_id: pay.order.id, amount: 1 }], ['post', `/payments/${pay.id}/refunds/auto`, {}],
      ['delete', '/admin/payments/' + pay.id, undefined], ['patch', `/admin/payments/${pay.id}/webhook-logs`, {}], ['delete', '/admin/webhook-logs', undefined], ['post', '/admin/payments', {}],
    ];
    for (const who of [undefined, a.cookie, staff.cookie, admin.cookie]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie: who, body });
      expect([m, p, [400, 401, 403, 404, 405].includes(r.status)]).toEqual([m, p, true]); // không route (404), guard chặn (401, 403) hay schema chặn (400): không bao giờ 2xx
      if (who && !p.startsWith('/payments/return')) expect([404, 405]).toContain(r.status); // `return` khớp `GET /payments/:id` (id lạ): customer bị schema query đóng chặn 400, staff và admin 403
    }
    expect(await snapshot(t)).toEqual(before);
    expect((await payRow(t, pay.id)).status).toBe('processing');
  });

  it(`PAY-TC-20261006-104538738 PAY-TC-20261006-104540482 ${SEC} T3, T4, T7 (SB-05, SB-07): mọi route của PAY khai quyền, schema và @Action khớp ma trận; AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng`, () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('PAY-REQ-')).map((r) => r.action).sort()).toEqual([
      'Bắt đầu thanh toán online qua VNPay', ...INTERNAL, 'Ghi nhận đã thu tiền COD', 'Hoàn tiền thủ công toàn phần', 'Nhận webhook IPN của VNPay (cổng gọi, xác thực bằng chữ ký)', 'Thử lại hoàn tiền thất bại', 'Thử lại thanh toán online',
      'Xem chi tiết thanh toán (mã giao dịch cổng, lượt thử, webhook, hoàn tiền)', 'Xem chi tiết thanh toán của mình', 'Xem danh sách hoàn tiền (hàng đợi hoàn tiền thất bại)', 'Xem danh sách mọi thanh toán (lọc trạng thái, phương thức, mã đơn)',
      'Xem danh sách thanh toán của mình',
    ].sort());
    for (const r of parseMatrix(MATRIX).filter((x) => INTERNAL.includes(x.action))) expect([r.guest, r.customer, r.staff, r.admin]).toEqual(['-', '-', '-', '-']); // chỉ tác nhân system (hoặc guest ở IPN)
    // hoàn tiền chỉ admin: ma trận rộng hơn code (cho staff) thì lệch
    const widened = MATRIX.replace(/^(\| Hoàn tiền thủ công toàn phần \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('POST /api/v1/payments/:id/refunds: code cho [admin] nhưng ma trận (Hoàn tiền thủ công toàn phần) cho [admin, staff]');
    // ghi nhận thu COD của customer: ma trận cho customer thì lệch
    const cust = MATRIX.replace(/^(\| Ghi nhận đã thu tiền COD \|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(auditPermissions(t.app, cust, opts).join('\n')).toContain('POST /api/v1/payments/:id/cod-collect: code cho [admin, staff] nhưng ma trận (Ghi nhận đã thu tiền COD) cho [admin, customer, staff]');
    // IPN: ma trận không cho guest thì lệch (code khai @Public)
    const noGuest = MATRIX.replace(/^(\| Nhận webhook IPN của VNPay \(cổng gọi, xác thực bằng chữ ký\) \|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(auditPermissions(t.app, noGuest, opts).join('\n')).toContain('code khai @Public nhưng ma trận không cho guest');
    expect(auditPermissions(t.app, MATRIX.replace('| Thử lại thanh toán online |', '| Thử lại |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'PAY', exempt: INTERNAL }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(11);
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it(`PAY-TC-20261006-104538804 ${SEC} T21: sổ mã lỗi có đủ mười bảy mã của PAY-API đúng status (không trùng, không sai dạng); mọi mã DomainError trong mã PAY đều có trong sổ hoặc là mã nền; hai mã idempotency do platform đăng ký`, () => {
    const spec = readFileSync(resolve(REPO_ROOT, 'spec/epics/PAY/design/PAY-API-20261006-103701335.md'), 'utf8');
    const line = spec.split('\n').find((l) => l.startsWith('Sổ mã lỗi PAY')) ?? '';
    const own = line.split('mã dùng chung của platform')[0];
    const declared = [...own.matchAll(/`([a-z-]+)` (\d{3})/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(declared).toHaveLength(17);
    for (const [code, status] of declared) expect([code, errorRegistry.get(code)?.status]).toEqual([code, status]);
    expect(errorRegistry.get('idempotency-key-required')?.status).toBe(400);
    expect(errorRegistry.get('idempotency-key-reused')?.status).toBe(422);
    expect(errorRegistry.audit()).toEqual([]);
    const used = new Set<string>();
    for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts'))) for (const m of readFileSync(resolve(SRC, f), 'utf8').matchAll(/DomainError\('([a-z0-9_-]+)'/g)) used.add(m[1]);
    const base = new Set(['validation-failed', 'unauthenticated', 'forbidden', 'csrf_failed', 'not-found', 'rate-limited', 'internal-error', 'service-unavailable', 'idempotency-key-required', 'idempotency-key-reused']);
    const known = new Set([...declared.map(([c]) => c), ...base]);
    expect([...used].filter((c) => !known.has(c))).toEqual([]); // không mã lỗi nào ngoài spec (L: mã trong code phải có trong spec)
    const literals = new Set<string>();
    for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts') && n !== 'errors.ts')) for (const m of readFileSync(resolve(SRC, f), 'utf8').matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)+)'/g)) literals.add(m[1]);
    expect([...declared.map(([c]) => c)].filter((c) => !literals.has(c))).toEqual([]); // mã khai mà mã không dùng cũng là lệch
  });

  it(`PAY-TC-20261006-104539001 ${SEC}: giao diện nội bộ khớp bảng Giao diện module (PaymentApi.getRevenue, countFailedRefunds; OrderApi.findForPayment); điểm vào công khai chỉ phơi PaymentModule và PaymentApi; PAY chỉ gọi đúng findForPayment của ORD và không đọc bảng của module khác (SB-35)`, async () => {
    expect(ARCH).toMatch(/\| PAY \| ORD \| `OrderApi\.findForPayment` \(đọc\) \| không \|/);
    expect(ARCH).toMatch(/\| DSH \| PAY \| `PaymentApi\.getRevenue\(\{ from, to \}, bucket\?\)`[^|]*`PaymentApi\.countFailedRefunds\(\)`[^|]*\(chỉ đọc;/);
    expect(PaymentApi.name).toBe('PaymentApi');
    expect(Object.getOwnPropertyNames(PaymentApi.prototype).filter((n) => n !== 'constructor' && !/^(floor|next|key)$/.test(n)).sort()).toEqual(['countFailedRefunds', 'getRevenue']);
    expect(PaymentApi.prototype.countFailedRefunds.length).toBe(0); // không tx
    expect(PaymentApi.prototype.getRevenue.length).toBe(2); // (range, bucket?)
    expect(Object.keys(paymentIndex).sort()).toEqual(['PaymentApi', 'PaymentModule']);
    // chữ ký ORD: findForPayment(orderId) trả đúng sáu trường, null (không ném) với id sai hay đơn không thấy
    const ord = t.app.get(OrderApi);
    const u = (await people(t as PayApp)).a;
    const o = await insertOrder(t.prisma, t.clock.now(), { user: u.id, status: 'pending', method: 'vnpay' });
    const r = await ord.findForPayment(o.id);
    expect(Object.keys(r ?? {}).sort()).toEqual(['code', 'grand_total', 'order_id', 'payment_expires_at', 'payment_method', 'status', 'user_id']);
    expect(r).toMatchObject({ order_id: o.id, code: o.code, user_id: u.id, status: 'pending', payment_method: 'vnpay', grand_total: 380000 });
    expect(await ord.findForPayment('khong-phai-uuid')).toBeNull();
    expect(await ord.findForPayment('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(OrderApi.prototype.findForPayment.length).toBe(1);
    // mã PAY: mọi hàm gọi trên OrderApi đều là findForPayment; không SELECT bảng của module khác
    const calls = new Set<string>();
    for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(resolve(SRC, f), 'utf8');
      for (const m of text.matchAll(/\borders\.(\w+)\(/g)) calls.add(m[1]);
      expect([f, /\b(FROM|JOIN|UPDATE|INTO)\s+"?(orders|order_items|order_status_history|users|stock_|products|coupons|shipments|shipping_)/i.test(text)]).toEqual([f, false]);
    }
    expect([...calls]).toEqual(['findForPayment']);
  });

  it(`PAY-TC-20261007-085337388 ${SEC} T12 (SB-15, SB-16): production thiếu VNPAY_HASH_SECRET thì cấu hình bị từ chối, tiến trình dừng khi khởi động nêu tên biến (không in giá trị) và không mở cổng; giá trị giữ chỗ, ngắn hay thiếu ở staging cũng bị từ chối; không có khóa mặc định nào`, async () => {
    const names = (x: ConfigError) => [...new Set(x.problems.map((p) => p.name))]; // thiếu: báo "bắt buộc ở prod" và "quá ngắn" (một tên, hai lý do)
    const e = problems(() => loadConfig(prod));
    expect(names(e)).toEqual(['VNPAY_HASH_SECRET']);
    expect(e.format()).toContain('VNPAY_HASH_SECRET');
    const strong = 'q3Z8k2Mx9R7wE5tY4uI1oP6aS0dFgHjKmNbVcXz';
    expect(() => loadConfig({ ...prod, VNPAY_HASH_SECRET: strong })).not.toThrow(); // đối chứng: đủ biến thì qua
    for (const bad of ['changeme-changeme-changeme-changeme-1', 'test-key-1234567890123456789012345678', 'short-secret-1', 'x'.repeat(40), '   ']) {
      const x = problems(() => loadConfig({ ...prod, VNPAY_HASH_SECRET: bad }));
      expect(names(x)).toEqual(['VNPAY_HASH_SECRET']);
      expect(x.format()).not.toContain(bad.trim() || 'khong-co');
    }
    expect(names(problems(() => loadConfig({ ...prod, APP_ENV: 'staging' })))).toEqual(['VNPAY_HASH_SECRET']);
    for (const name of ['VNPAY_TMN_CODE', 'VNPAY_RETURN_URL']) { const { [name]: _gone, ...rest } = { ...prod, VNPAY_HASH_SECRET: strong } as Record<string, string>; expect(names(problems(() => loadConfig(rest)))).toEqual([name]); }
    expect(() => loadConfig({ APP_ENV: 'dev', DATABASE_URL: 'postgresql://u:pw@localhost:5433/x', CORS_ALLOWED_ORIGINS: 'http://localhost:3000' })).not.toThrow(); // dev chạy được khi chưa cấu hình cổng (PAY đóng, xem test dưới)
    expect(PAY_VARS.VNPAY_HASH_SECRET).toMatchObject({ sensitive: true, default: '', secretRules: true, requiredOutsideDev: true });
    expect(PAY_VARS.PAY_MAX_ATTEMPTS.default).toBe('3');
    // tiến trình thật: dừng trước khi nghe cổng, nêu tên biến, không in giá trị của bất kỳ bí mật nào
    const port = await freePort();
    const b = bootApp({ ...prod, PORT: String(port), STORAGE_SECRET_KEY: 'storage-secret-should-never-print-0123456789' }); // scan-secrets:allow giá trị giả của test
    const code = await b.exited;
    expect(code).not.toBe(0);
    expect(b.stderr()).toContain('VNPAY_HASH_SECRET');
    expect(b.stderr()).not.toContain('storage-secret-should-never-print');
    expect(b.stdout()).not.toContain('đã lắng nghe');
    expect(await portOpen(port)).toBe(false);
    // đối chứng ở dev: đặt đủ biến thì ứng dụng lên bình thường
    const port2 = await freePort();
    const ok = bootApp({ APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: 'http://localhost:3000', PORT: String(port2), VNPAY_TMN_CODE: TMN, VNPAY_HASH_SECRET: SECRET, VNPAY_RETURN_URL: 'https://shop.example/orders/{order_code}/payment' });
    try { expect(await waitFor(() => portOpen(port2))).toBe(true); expect(ok.stdout()).not.toContain(SECRET); } finally { ok.kill(); await ok.exited; }
  }, 120_000);
});

describe('PAY đóng khi chưa cấu hình khóa ký (dev)', () => {
  let t: PayApp;
  beforeAll(async () => { t = await createPayApp({ env: { VNPAY_HASH_SECRET: '' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });
  it(`PAY-TC-20261007-085337388 ${SEC} T12 (SB-16): khóa ký rỗng thì không ký được đường dẫn (503) và mọi IPN bị từ chối 97 kể cả khi ký bằng chuỗi rỗng; không dùng khóa mặc định`, async () => {
    const { a } = await people(t);
    const pay = await seedPayment(t, { user: a.id, status: 'pending' });
    const r = await initiate(t, a.cookie, pay.id);
    expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
    expect(await payRow(t, pay.id)).toMatchObject({ status: 'pending', attempt_no: 0 }); // rollback cả lượt thử
    const proc = await seedPayment(t, { user: a.id, status: 'processing', attemptNo: 1, attempts: 'auto' });
    for (const secret of ['', 'test', SECRET]) expect((await ipn(t, ipnQuery({ txnRef: proc.attempts[0].txnRef, amount: 350000, secret }))).body.RspCode).toBe('97');
    expect((await payRow(t, proc.id)).status).toBe('processing');
  });
});
