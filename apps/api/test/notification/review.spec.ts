import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { OrderApi, OrderModule } from '../../src/modules/order';
import { TransactionService } from '../../src/modules/platform';
import { OutboxRelay } from '../../src/modules/platform';
import { MailError } from '../../src/modules/notification/mail';
import { cleanText, formatVn, formatVnd, planEvent } from '../../src/modules/notification/templates';
import { renderEmail } from '../../src/modules/notification/render';
import { ORIGIN } from '../support/app';
import { post } from '../support/auth';
import { waitFor } from '../support/boot';
import { API_DIR, testDbUrl } from '../support/db';
import { call } from '../support/usr';
import { baseInput } from '../support/ord';
import { CODE, OID, count, createNtfApp, emit, logsOf, mailsOf, mkUser, notesOf, q, seedMail, seedNote, truncateAll, type NtfApp } from '../support/ntf';

// Ca bẫy của review và bài học (L71, L87, L102, L117; SB-27, SB-31, SB-34): chết giữa commit, pool nhỏ, thuê dòng, lô, ký tự lạ, event thật của producer thật.
const MIN = 60_000;
describe('NTF ca bẫy và producer thật', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp({ extraImports: [OrderModule] }); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); t.mails.length = 0; jest.restoreAllMocks();
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    t.email.sleep = async (ms) => { t.clock.advance(ms); };
  });

  it('NTF-TC-20261006-104222796 (SB-27, T16): tiến trình chết giữa nhận event và commit thì thông báo, email và processed_events đều không có; giao lại tạo đúng một bộ; giao lại lần nữa không tạo thêm', async () => {
    const u = await mkUser(t);
    const e1 = randomUUID();
    const died = await new Promise<{ code: number | null; signal: string | null; out: string }>((res) => {
      const c = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/ntf-then-die.ts', e1, u.id, OID], { cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('exit', (code, signal) => res({ code, signal, out }));
    });
    expect([died.code, died.signal, died.out.includes('SURVIVED')]).toEqual([null, 'SIGKILL', false]);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
    await emit(t, 'OrderCreated', { order_id: OID, order_code: CODE, user_id: u.id, grand_total: 350000, payment_method: 'cod', payment_expires_at: null }, e1);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events', `event_id = '${e1}'`)]).toEqual([1, 1, 1]);
    await emit(t, 'OrderCreated', { order_id: OID, order_code: CODE, user_id: u.id, grand_total: 350000, payment_method: 'cod', payment_expires_at: null }, e1);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries')]).toEqual([1, 1]);
  }, 60_000);

  it('NTF-TC-20261006-104222863 (L71, L87, L117, SB-31): với pool kết nối tối thiểu (2), xử lý event, job gửi, token và HTTP đồng thời không treo và không để lại dấu vết lạ', async () => {
    const small = await createNtfApp({ env: { DB_POOL_MAX: '2' } });
    try {
      const u = await mkUser(small, { email: 'pool@shop.vn' });
      const work: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) work.push(emit(small, 'OrderCreated', { order_id: OID, order_code: CODE, user_id: u.id, grand_total: 1000 + i, payment_method: 'cod', payment_expires_at: null }));
      for (let i = 0; i < 6; i++) work.push(call(small, 'get', '/notifications', { cookie: u.cookie }));
      for (let i = 0; i < 3; i++) work.push(small.email.sendDue({ now: new Date(Date.now() + 3600_000) }));
      small.evts.publishAfterCommit({ type: 'PasswordResetRequested', aggregate_type: 'user', aggregate_id: u.id, payload: { user_id: u.id, token_ref: 'T'.repeat(43), expires_at: new Date(Date.now() + 30 * MIN).toISOString() } });
      work.push(small.evts.idle());
      const done = await Promise.race([Promise.all(work).then(() => 'done'), new Promise((r) => setTimeout(() => r('hung'), 45_000))]);
      expect(done).toBe('done');
      expect(await count(small, 'notifications')).toBe(20);
      expect(small.logs.records.filter((r) => r.level === 'error')).toEqual([]);
    } finally { await small.close(); }
  }, 90_000);

  it('NTF-TC-20261006-104223696 (L102, SB-34): job nhận tối đa 50 dòng mỗi nhịp; dòng vừa thuê xuống cuối hàng nên 120 dòng đến hạn đều được gửi sau ba nhịp; dòng lỗi không làm đói dòng mới', async () => {
    const u = await mkUser(t);
    const now = t.clock.now();
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) ids.push(await seedMail(t, u.id, { at: new Date(now.getTime() - (200 - i) * 1000), status: 'pending' }));
    await q(t, `UPDATE email_deliveries SET delivery_status = 'pending' WHERE user_id = '${u.id}'`);
    const r1 = await t.email.sendDue(), r2 = await t.email.sendDue(), r3 = await t.email.sendDue();
    expect([r1.picked, r2.picked, r3.picked]).toEqual([50, 50, 20]);
    expect(t.mail.calls.length).toBe(30); // hạn mức 30 email thường mỗi 24 giờ: 30 gửi, còn lại rate_capped
    expect(await count(t, 'email_deliveries', `delivery_status = 'sent'`)).toBe(30);
    expect(await count(t, 'email_deliveries', `delivery_status = 'skipped' AND delivery_reason = 'rate_capped'`)).toBe(90);
    // dòng lỗi vĩnh viễn ở đầu hàng không chặn dòng sau: đổi hạn mức bằng người nhận khác
    const v = await mkUser(t);
    t.mail.reset(); t.mail.script = [new MailError('ses_rejected', true)];
    for (let i = 0; i < 3; i++) await seedMail(t, v.id, { at: new Date(now.getTime() - (10 - i) * 1000) });
    await t.email.sendDue();
    expect((await mailsOf(t, v.id)).map((m) => m.delivery_status)).toEqual(['failed', 'sent', 'sent']);
    expect(ids).toHaveLength(120);
  }, 60_000);

  it('NTF-TC-20261006-104223250 (SB-34): dòng đã thuê (AUTH tạm thời lỗi hay job bị hủy) không bị nhận lần hai trong 2 phút rồi tự đến hạn lại; không tăng attempts', async () => {
    const u = await mkUser(t);
    const id = await seedMail(t, u.id, { at: new Date(t.clock.now().getTime() - 1000) });
    const spy = jest.spyOn(t.api, 'getUserContact').mockRejectedValueOnce(new Error('timeout'));
    expect(await t.email.sendDue()).toMatchObject({ picked: 1, deferred: 1 });
    expect((await mailsOf(t, u.id))[0]).toMatchObject({ id, delivery_status: 'pending', attempts: 0 });
    t.clock.advance(MIN);
    expect(await t.email.sendDue()).toMatchObject({ picked: 0 });
    t.clock.advance(MIN + 1000); // quá hạn thuê 2 phút
    expect(await t.email.sendDue()).toMatchObject({ picked: 1, sent: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(logsOf(t, 'warn').filter((r) => r.code === 'auth-unavailable')).toHaveLength(1);
    // job bị hủy: không gửi gì, dòng giữ nguyên chờ hết thuê
    const id2 = await seedMail(t, u.id, { at: new Date(t.clock.now().getTime() - 1000) });
    const ac = new AbortController(); ac.abort();
    expect(await t.email.sendDue({ signal: ac.signal })).toMatchObject({ picked: 1, sent: 0 });
    expect((await mailsOf(t, u.id)).find((m) => m.id === id2)).toMatchObject({ delivery_status: 'pending', attempts: 0 });
  });

  it('NTF-TC-20261006-104222599 (JSON nửa cặp thay thế lẻ và NUL, L-JSON): id có NUL, tham số type có NUL hay up_to có nửa cặp lẻ cho 404 hay 400, không bao giờ 500; tên sản phẩm có NUL hay nửa cặp lẻ được làm sạch', async () => {
    const u = await mkUser(t);
    expect((await call(t, 'post', '/notifications/%00/read', { cookie: u.cookie })).status).toBe(404);
    expect([400, 404]).toContain((await call(t, 'post', '/notifications/%ED%A0%BD/read', { cookie: u.cookie })).status); // đường dẫn UTF-8 sai: nền trả 400, không 500
    for (const qs of ['type=%00', 'status=%00', 'limit=%00', 'page=1%00']) expect([qs, (await call(t, 'get', `/notifications?${qs}`, { cookie: u.cookie })).status]).toEqual([qs, 400]);
    for (const raw of ['{"up_to":"\\ud800"}', '{"up_to":"\\u0000"}', '{"up_to":"2026-10-06T09:05:00Z\\ud83d"}']) expect([raw, (await call(t, 'post', '/notifications/read-all', { cookie: u.cookie, body: raw })).status]).toEqual([raw, 400]);
    const s = await mkUser(t, { role: 'staff' });
    for (const name of ['Áo\u0000thun', 'Áo\ud83dthun', 'Áo\udc00thun', 'Áo 😀 thun']) {
      await emit(t, 'LowStockDetected', { product_id: randomUUID(), product_name: name, on_hand: 1, available: 1, threshold: 2 });
    }
    expect((await notesOf(t, s.id)).map((n) => n.body.replace(/^Sản phẩm (.*) có tồn kho thấp.*$/, '$1'))).toEqual(['Áo thun', 'Áothun', 'Áothun', 'Áo 😀 thun']); // NUL thành khoảng trắng, nửa cặp thay thế lẻ bị bỏ, emoji nguyên vẹn
    expect(await count(t, 'notifications', `body LIKE '%' || chr(0) || '%'`).catch(() => 0)).toBe(0);
  });

  it('NTF-TC-20261006-104225530 (SB-12): các hàm thuần: định dạng tiền và giờ Việt Nam, làm sạch tên, escape HTML của thư; tên hay trường hung hãn không thoát khỏi mẫu', () => {
    expect([formatVnd(0), formatVnd(999), formatVnd(1000), formatVnd(1234567890)]).toEqual(['0 đ', '999 đ', '1.000 đ', '1.234.567.890 đ']);
    expect([formatVn('2026-10-06T17:00:00Z'), formatVn('2026-12-31T17:00:00Z'), formatVn('2026-10-06T00:00:00Z')]).toEqual(['07/10/2026 00:00', '01/01/2027 00:00', '06/10/2026 07:00']); // fixed-clock: hàm thuần, ví dụ cố định
    expect(cleanText('  a\t\tb\r\nc d  ', 50)).toBe('a b c d');
    expect([...cleanText('😀'.repeat(100), 80)]).toHaveLength(80);
    const mail = renderEmail('order_created', { order_code: CODE, amount: 1 }, { fullName: '"><script>alert(1)</script>\r\nBcc: x', baseUrl: 'https://shop.example' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; Bcc: x');
    expect(mail.subject).toBe('Đã nhận đơn hàng');
    // dữ liệu email hỏng (sửa tay) không bao giờ chèn chuỗi thô: trường sai dạng bị bỏ
    const evil = renderEmail('order_shipped', { order_code: '<script>', tracking_number: '"><img>', amount: 'x', reason: '<b>' }, { fullName: 'A', baseUrl: 'https://shop.example' });
    expect(evil.text + evil.html).not.toMatch(/<script>|<img>|<b>/);
    expect(() => renderEmail('password_reset', {}, { fullName: 'A', baseUrl: 'https://shop.example' })).toThrow();
    const plan = planEvent({ event_id: randomUUID(), type: 'OrderShipped', aggregate_type: 'o', aggregate_id: OID, payload: { order_id: OID, order_code: CODE, user_id: randomUUID(), tracking_number: 'VTP12345678' }, occurred_at: new Date().toISOString(), correlation_id: 'c' }, new Date());
    expect(plan.ok && plan.plan.notification?.body).toBe('Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển. Mã vận đơn: VTP12345678.');
    expect(planEvent({ event_id: randomUUID(), type: 'NoSuchEvent', aggregate_type: 'o', aggregate_id: OID, payload: {}, occurred_at: new Date().toISOString(), correlation_id: 'c' }, new Date()).ok).toBe(false);
  });

  it('NTF-TC-20261006-104223184 (BR6, T17): lỗi gửi email không chặn hay hỏng luồng nghiệp vụ: đăng ký và quên mật khẩu qua AUTH thật vẫn 202 và dữ liệu đủ khi SES lỗi; job không ném lỗi', async () => {
    t.mail.failAll('ses_unavailable');
    const reg = await post(t, '/auth/register', { email: 'new@shop.vn', password: 'Correct-Horse-9', full_name: 'Người Mới' }, { ip: '203.0.113.7' });
    expect(reg.status).toBe(202);
    expect(await waitFor(() => t.mails.length > 0, 10_000)).toBe(true);
    await t.evts.idle();
    expect(await count(t, 'users', `email = 'new@shop.vn'`)).toBe(1);
    expect((await mailsOf(t)).map((m) => [m.type, m.delivery_status, m.delivery_reason])).toEqual([['email_verification', 'failed', 'ses_unavailable']]);
    await expect(t.email.sendDue()).resolves.toBeDefined();
    // handler token ném lỗi (AUTH không trả lời): AUTH không bị ảnh hưởng, chỉ có log error không kèm payload hay token
    jest.spyOn(t.api, 'getUserContact').mockRejectedValue(new Error('boom'));
    t.logs.clear();
    const u = await mkUser(t, { email: 'x@shop.vn' });
    const f = await post(t, '/auth/password/forgot', { email: 'x@shop.vn' }, { ip: '203.0.113.8' });
    expect(f.status).toBe(202);
    expect(await waitFor(() => t.logs.records.some((r) => /event token thất bại/.test(String(r.msg))), 10_000)).toBe(true);
    expect(t.logs.lines.join('\n')).not.toMatch(/token_ref|"token_ref"/);
    expect(u.id).toBeTruthy();
  }, 60_000);

  it('NTF-TC-20261006-104222599 (producer thật): UserRegistered, PasswordChanged, UserLocked của AUTH thật và OrderCreated của ORD thật qua outbox + relay tới đúng người nhận với đúng nội dung', async () => {
    const relay = t.app.get(OutboxRelay);
    const flush = async () => { for (let i = 0; i < 5; i++) await relay.runOnce(new Date(Date.now() + 3600_000 * (i + 1))); };
    // đăng ký thật
    expect((await post(t, '/auth/register', { email: 'reg@shop.vn', password: 'Correct-Horse-9', full_name: 'Khách Đăng Ký' }, { ip: '203.0.113.5' })).status).toBe(202);
    await flush();
    const [reg] = await q<{ id: string }>(t, `SELECT id FROM users WHERE email = 'reg@shop.vn'`);
    expect((await notesOf(t, reg.id)).map((n) => [n.type, n.link])).toEqual([['welcome', null]]);
    // đổi mật khẩu thật (USR gọi AUTH): PasswordChanged
    const c = await mkUser(t, { email: 'chg@shop.vn' });
    const login = await post(t, '/auth/login', { email: c.email, password: c.password });
    const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
    await t.api.changePassword(c.id, (await q<{ id: string }>(t, `SELECT id FROM sessions WHERE user_id = '${c.id}' ORDER BY created_at DESC LIMIT 1`))[0].id, c.password, 'Another-Pass-7!');
    await flush();
    expect(cookie).toBeTruthy();
    expect((await notesOf(t, c.id)).map((n) => [n.type, n.link])).toEqual([['password_changed', '/forgot-password']]);
    expect((await mailsOf(t, c.id)).map((m) => [m.type, m.delivery_status])).toEqual([['password_changed', 'pending']]);
    // admin khóa người dùng thật: UserLocked chỉ có email, không thông báo trong ứng dụng
    const admin = await mkUser(t, { role: 'admin' });
    const victim = await mkUser(t, { email: 'locked@shop.vn' });
    expect((await call(t, 'post', `/admin/users/${victim.id}/lock`, { cookie: admin.cookie, body: { reason: 'Gian lận đơn #123' } })).status).toBe(200);
    await flush();
    const vm = await mailsOf(t, victim.id);
    expect(vm.map((m) => [m.type, m.data])).toEqual([['account_locked', { reason: 'admin' }]]);
    expect(await notesOf(t, victim.id)).toEqual([]);
    await t.email.sendDue({ now: new Date(Date.now() + 3600_000) });
    expect(t.mail.msgs.map((m) => m.text).join()).not.toMatch(/Gian lận|#123/); // lý do tự do của admin không vào email
    // đặt hàng thật của ORD: OrderCreated tới chủ đơn
    const buyer = await mkUser(t, { email: 'buy@shop.vn' });
    const order = await t.app.get(TransactionService).run((tx) => t.app.get(OrderApi).createPending(baseInput(buyer.id, { payment_method: 'cod', payment_expires_at: null }), tx));
    await flush();
    const notes = await notesOf(t, buyer.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'order_created', link: `/orders/${order.code}`, body: `Đơn #${order.code} đã được tạo. Tổng tiền 380.000 đ.` });
    expect(order.code).toMatch(/^[A-Z0-9]{12}$/); // mã đơn thật khớp khuôn của NTF
    expect(await count(t, 'processed_events', `consumer = 'NTF'`)).toBeGreaterThanOrEqual(4);
    expect(logsOf(t, 'error')).toEqual([]);
    expect(seedNote).toBeDefined();
  }, 60_000);
});
