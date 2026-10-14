import { randomUUID } from 'node:crypto';
import { sha256Hex, signV4 } from '../../src/modules/platform';
import { AuthApi } from '../../src/modules/auth';
import { renderEmail } from '../../src/modules/notification/render';
import { waitFor } from '../support/boot';
import { call } from '../support/usr';
import { CODE, OID, count, createNtfApp, emit, logsOf, mailsOf, mkUser, notesOf, processedOf, q, seedMail, seedNote, truncateAll, type NtfApp } from '../support/ntf';

// Thăm dò của reviewer độc lập (review NTF; mỗi ca Pnn là một thăm dò, phát hiện nằm ở review.md): chỗ spec đòi mà bộ test của implement chưa đo hoặc đo chưa đủ. PostgreSQL thật, đồng hồ giả như các bộ khác của NTF.
const SEC = 'REV-NTF';

/** Mọi dòng của mọi bảng ở dạng văn bản: để tìm chuỗi bí mật. */
async function dumpDb(t: NtfApp): Promise<string> {
  const tables = await q<{ table_name: string }>(t, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  const out: string[] = [];
  for (const { table_name } of tables) out.push(...(await q<{ r: string }>(t, `SELECT x::text AS r FROM "${table_name}" x`)).map((r) => r.r));
  return out.join('\n');
}

describe('NTF review: thăm dò độc lập', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); jest.restoreAllMocks();
    t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    t.email.timeoutMs = 10_000; t.email.sleep = async (ms) => { t.clock.advance(ms); };
  });

  // ---- REV-NTF-P01: hạn mức 30 mỗi 24 giờ khi hai lượt gửi chạy SONG SONG (NTF-DB mục Giao dịch và khóa 5: "khóa advisory bảo đảm hai job không cùng thấy dưới ngưỡng")
  it(`${SEC}-P01 (SB-14 bậc E, T5): hai sendDue song song cho cùng một người nhận đang ở 29 email đã gửi không vượt 30 email trong 24 giờ`, async () => {
    const u = await mkUser(t, { email: 'cap@shop.vn' });
    for (let i = 0; i < 29; i++) await seedMail(t, u.id, { status: 'sent', at: new Date(t.clock.now().getTime() - 3600_000 - i * 1000) });
    for (let i = 0; i < 6; i++) await seedMail(t, u.id, { at: new Date(t.clock.now().getTime() - 60_000 + i * 1000) });
    t.mail.delayMs = 150; // SES chậm: khe giữa nhận việc và ghi `sent` đủ rộng để hai lượt cùng thấy 29
    await Promise.all([t.email.sendDue({ batch: 3 }), t.email.sendDue({ batch: 3 })]);
    const sent = await count(t, 'email_deliveries', `user_id = '${u.id}' AND delivery_status = 'sent' AND sent_at > now() - interval '24 hours'`);
    expect(sent).toBeLessThanOrEqual(30);
    expect(t.mail.calls.length).toBeLessThanOrEqual(1);
  }, 60_000);

  // ---- REV-NTF-P02: dòng email đã dùng hết 3 lượt mà vẫn `pending` (tiến trình chết sau mỗi lần thuê) không được làm kẹt cả hàng đợi
  it(`${SEC}-P02 (SB-34): dòng pending đã thuê 3 lần (attempts = 3, tiến trình chết trước khi ghi kết quả) bị đóng failed, không làm job ném lỗi hay chặn các dòng sau nó`, async () => {
    const u = await mkUser(t, { email: 'poison@shop.vn' });
    const stuck = await seedMail(t, u.id, { attempts: 3, at: new Date(t.clock.now().getTime() - 3600_000) });
    const next = await seedMail(t, u.id, { at: new Date(t.clock.now().getTime() - 60_000) });
    await expect(t.email.sendDue()).resolves.toBeDefined();
    const rows = Object.fromEntries((await mailsOf(t, u.id)).map((m) => [m.id, m]));
    expect(rows[stuck].delivery_status).toBe('failed');
    expect(rows[next].delivery_status).toBe('sent');
  });

  // ---- REV-NTF-P03: một dòng lỗi không làm hỏng cả lượt
  it(`${SEC}-P03 (SB-34): lỗi bất ngờ ở một dòng (CSDL từ chối cập nhật) không bỏ rơi các dòng còn lại của lượt`, async () => {
    const a = await mkUser(t, { email: 'a3@shop.vn' }), b = await mkUser(t, { email: 'b3@shop.vn' });
    const first = await seedMail(t, a.id, { at: new Date(t.clock.now().getTime() - 120_000) });
    const second = await seedMail(t, b.id, { at: new Date(t.clock.now().getTime() - 60_000) });
    // CHECK tạm: dòng đầu không ghi được kết quả `sent` (mô phỏng lỗi CSDL ở một dòng)
    await q(t, `ALTER TABLE email_deliveries ADD CONSTRAINT rev_poison CHECK (id <> '${first}' OR delivery_status <> 'sent')`);
    try {
      await t.email.sendDue().catch(() => undefined);
    } finally { await q(t, 'ALTER TABLE email_deliveries DROP CONSTRAINT rev_poison'); }
    const rows = Object.fromEntries((await mailsOf(t)).map((m) => [m.id, m]));
    expect(rows[second].delivery_status).toBe('sent');
  });

  // ---- REV-NTF-P04: đúng một lần
  it(`${SEC}-P04 (SB-27, T8): cùng event_id giao đồng thời 6 lần, rồi giao lại sau cùng: đúng một thông báo, một email, một dòng processed_events`, async () => {
    const u = await mkUser(t, { email: 'once@shop.vn' });
    const payload = { order_id: OID, order_code: CODE, user_id: u.id, tracking_number: 'VTP12345678' };
    const eid = randomUUID();
    await Promise.all(Array.from({ length: 6 }, () => emit(t, 'OrderShipped', payload, eid)));
    await emit(t, 'OrderShipped', payload, eid);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), (await processedOf(t)).filter((p) => p.consumer === 'NTF').length]).toEqual([1, 1, 1]);
  });

  it(`${SEC}-P05 (SB-27, SB-31): AUTH lỗi tạm thời ở pha prepare thì không để lại dấu vết; giao lại thành công đúng một lần; lỗi ở pha ghi giữa chừng rollback cả processed_events`, async () => {
    const u = await mkUser(t, { email: 'retry@shop.vn' });
    const payload = { order_id: OID, order_code: CODE, user_id: u.id };
    const eid = randomUUID();
    const auth = t.app.get(AuthApi);
    const spy = jest.spyOn(auth, 'getUserContact').mockRejectedValueOnce(new Error('auth down'));
    await expect(emit(t, 'OrderDelivered', payload, eid)).rejects.toThrow('auth down');
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
    spy.mockRestore();
    // lỗi ở pha ghi: CHECK tạm làm INSERT email_deliveries thất bại sau khi thông báo đã chèn trong cùng giao dịch
    await q(t, `ALTER TABLE email_deliveries ADD CONSTRAINT rev_fail CHECK (false) NOT VALID`);
    try { await expect(emit(t, 'OrderDelivered', payload, eid)).rejects.toBeDefined(); } finally { await q(t, 'ALTER TABLE email_deliveries DROP CONSTRAINT rev_fail'); }
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([0, 0, 0]);
    await emit(t, 'OrderDelivered', payload, eid);
    await emit(t, 'OrderDelivered', payload, eid);
    expect([await count(t, 'notifications'), await count(t, 'email_deliveries'), await count(t, 'processed_events')]).toEqual([1, 1, 1]);
  });

  // ---- REV-NTF-P06: người nhận
  it(`${SEC}-P06 (T9, T10): RefundFailed báo đúng admin đang hoạt động (không báo chủ đơn, staff, admin bị khóa); LowStockDetected báo staff và admin đang hoạt động, không báo customer`, async () => {
    const owner = await mkUser(t), staff = await mkUser(t, { role: 'staff' }), admin = await mkUser(t, { role: 'admin' }), lockedAdmin = await mkUser(t, { role: 'admin', status: 'locked' });
    await emit(t, 'RefundFailed', { refund_id: randomUUID(), payment_id: randomUUID(), order_id: OID, order_code: CODE, user_id: owner.id, amount: 1000, reason: 'order_cancelled', failure_reason: 'gateway-declined' });
    expect((await notesOf(t)).map((n) => n.user_id)).toEqual([admin.id]);
    await emit(t, 'LowStockDetected', { product_id: randomUUID(), product_name: 'Áo', on_hand: 1, available: 1, threshold: 5 });
    const by = (id: string) => notesOf(t, id).then((r) => r.map((n) => n.type));
    expect([await by(owner.id), await by(staff.id), await by(admin.id), await by(lockedAdmin.id)]).toEqual([[], ['low_stock'], ['refund_failed', 'low_stock'], []]);
  });

  // ---- REV-NTF-P07: nội dung độc hại
  it(`${SEC}-P07 (T3, T4, SB-12): họ tên có HTML, nháy và CRLF không thoát được khỏi lời chào: tiêu đề sạch, không có dòng header mới, HTML được escape`, () => {
    const evil = '<img src=x onerror=alert(1)>"\'&\r\nBcc: attacker@evil.example\r\nSubject: hacked';
    const m = renderEmail('order_shipped', { order_code: CODE, tracking_number: 'VTP12345678' }, { fullName: evil, baseUrl: 'https://shop.example' });
    expect(m.subject).toBe('Đơn hàng đang được giao');
    expect(m.html).not.toMatch(/<img|onerror=alert\(1\)>/);
    expect(m.html).toContain('&lt;img');
    expect(m.text.split('\n')[0]).not.toMatch(/[\r\n]/);
    expect(m.text).not.toMatch(/\r|^Bcc:/m);
    expect(m.html).not.toMatch(/\r|\n/);
  });

  // ---- REV-NTF-P10: IDOR và đếm
  it(`${SEC}-P10 (SB-06): người khác (kể cả admin) không đọc, không đánh dấu, không đếm thông báo của customer; đua hai read-all không làm unread_count âm hay sai`, async () => {
    const [a, b, admin] = [await mkUser(t), await mkUser(t), await mkUser(t, { role: 'admin' })];
    for (let i = 0; i < 4; i++) await emit(t, 'OrderDelivered', { order_id: OID, order_code: CODE, user_id: a.id });
    const mine = (await notesOf(t, a.id))[0];
    for (const who of [b, admin]) {
      expect((await call(t, 'post', `/notifications/${mine.id}/read`, { cookie: who.cookie })).status).toBe(404);
      expect((await call(t, 'get', '/notifications', { cookie: who.cookie })).body).toMatchObject({ items: [], total: 0, unread_count: 0 });
      expect((await call(t, 'post', '/notifications/read-all', { cookie: who.cookie })).body).toEqual({ updated: 0, unread_count: 0 });
    }
    expect(await count(t, 'notifications', `user_id = '${a.id}' AND status = 'unread'`)).toBe(4);
    const rs = await Promise.all([call(t, 'post', '/notifications/read-all', { cookie: a.cookie }), call(t, 'post', '/notifications/read-all', { cookie: a.cookie })]);
    expect(rs.map((r) => r.body.updated).sort()).toEqual([0, 4]);
    expect(rs.every((r) => r.body.unread_count === 0)).toBe(true);
  });

  // ---- REV-NTF-P11: bí mật không vào log; log user_id
  it(`${SEC}-P11 (SB-03, SB-18, SB-26): quên mật khẩu và xác minh email chạy tới SES giả lỗi vĩnh viễn: token không xuất hiện ở log (mọi mức) hay bảng nào; log không có email người nhận`, async () => {
    const u = await mkUser(t, { email: 'secret-user@shop.vn' });
    t.mail.failAll('ses_rejected', true);
    await call(t, 'post', '/auth/password/forgot', { body: { email: 'secret-user@shop.vn' }, ip: '203.0.113.9' });
    expect(await waitFor(() => t.mails.length > 0, 10_000)).toBe(true);
    await t.evts.idle();
    const sent = t.mail.msgs[0]?.text ?? '';
    expect(sent).toContain('/reset-password#token=');
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent)![1];
    const dump = await dumpDb(t);
    expect(dump).not.toContain(token);
    expect(t.logs.lines.join('\n')).not.toContain(token);
    expect(t.logs.lines.join('\n')).not.toContain('secret-user@shop.vn');
    expect(logsOf(t, 'error').length).toBeGreaterThan(0);
    void u;
  });

  // ---- REV-NTF-P13..: lỗ hổng test do đột biến của reviewer (mutate.mjs) chỉ ra
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde'; // 43 ký tự hợp lệ; scan-secrets:allow token giả của test
  const secretMail = (userId: string, type: 'PasswordResetRequested' | 'EmailVerificationRequested') => {
    t.evts.publishAfterCommit({ type, aggregate_type: 'user', aggregate_id: userId, payload: { user_id: userId, token_ref: TOKEN, expires_at: new Date(t.clock.now().getTime() + 30 * 60_000).toISOString() } });
    return t.evts.idle();
  };

  it(`${SEC}-P13 (BR6): failLost chỉ đổi email chứa bí mật; email thường pending quá 5 phút không bị đổi thành failed lost`, async () => {
    const u = await mkUser(t, { email: 'lost@shop.vn' });
    const old = new Date(t.clock.now().getTime() - 30 * 60_000);
    const normal = await seedMail(t, u.id, { at: old, next: new Date(t.clock.now().getTime() + 60_000) });
    const secret = await seedMail(t, u.id, { type: 'password_reset', at: old });
    expect(await t.email.failLost()).toBe(1);
    const rows = Object.fromEntries((await mailsOf(t, u.id)).map((m) => [m.id, m]));
    expect([rows[normal].delivery_status, rows[secret].delivery_status, rows[secret].delivery_reason]).toEqual(['pending', 'failed', 'lost']);
  });

  it(`${SEC}-P14 (BR6, T17): email bí mật gặp lỗi vĩnh viễn (từ chối) chỉ gọi SES một lần rồi failed; lỗi tạm thời gọi đủ ba lần`, async () => {
    const u = await mkUser(t, { email: 'perm@shop.vn' });
    t.mail.failAll('ses_rejected', true);
    await secretMail(u.id, 'PasswordResetRequested');
    expect(t.mail.calls).toHaveLength(1);
    expect((await mailsOf(t, u.id)).map((m) => [m.delivery_status, m.delivery_reason, m.attempts])).toEqual([['failed', 'ses_rejected', 1]]);
    t.mail.reset(); t.mail.failAll('ses_unavailable', false);
    await secretMail(u.id, 'EmailVerificationRequested');
    expect(t.mail.calls).toHaveLength(3);
  });

  it(`${SEC}-P15 (BR4, T5): hạn mức email bí mật đếm cả dòng đang gửi dở (pending dưới 5 phút) nên mười yêu cầu dồn dập không cùng lọt dưới ngưỡng; email bí mật đã gửi không tính vào 30 email thường`, async () => {
    const u = await mkUser(t, { email: 'burst@shop.vn' });
    for (let i = 0; i < 10; i++) await seedMail(t, u.id, { type: 'password_reset', status: 'pending', at: new Date(t.clock.now().getTime() - 60_000) });
    await secretMail(u.id, 'PasswordResetRequested');
    expect(t.mail.calls).toHaveLength(0);
    expect((await mailsOf(t, u.id)).filter((m) => m.delivery_reason === 'rate_capped')).toHaveLength(1);
    const v = await mkUser(t, { email: 'mixed@shop.vn' });
    for (let i = 0; i < 12; i++) await seedMail(t, v.id, { type: 'password_reset', status: 'sent', sentAt: new Date(t.clock.now().getTime() - 120_000 - i * 1000) });
    for (let i = 0; i < 20; i++) await seedMail(t, v.id, { status: 'sent', sentAt: new Date(t.clock.now().getTime() - 3600_000 - i * 1000) });
    await seedMail(t, v.id, { at: new Date(t.clock.now().getTime() - 1000) });
    expect(await t.email.sendDue()).toMatchObject({ sent: 1, skipped: 0 });
  });

  it(`${SEC}-P16 (NTF-DB 4): dòng đã đổi sang trạng thái cuối trong lúc đang gọi SES (tiến trình khác) không bị ghi đè và không làm lượt ném lỗi`, async () => {
    const u = await mkUser(t, { email: 'race@shop.vn' });
    const id = await seedMail(t, u.id);
    jest.spyOn(t.mail, 'send').mockImplementationOnce(async () => { await q(t, `UPDATE email_deliveries SET delivery_status = 'skipped', delivery_reason = 'manual', next_attempt_at = NULL WHERE id = '${id}'`); });
    await expect(t.email.sendDue()).resolves.toMatchObject({ picked: 1, deferred: 0 });
    expect((await mailsOf(t, u.id)).map((m) => [m.delivery_status, m.delivery_reason])).toEqual([['skipped', 'manual']]);
    expect(logsOf(t, 'error').filter((l) => l.code === 'email-row-failed')).toEqual([]); // câu UPDATE có điều kiện `pending` không chạm dòng đã cuối, không để trigger SB-24 ném lỗi
  });

  it(`${SEC}-P17 (T4, SB-12): dữ liệu email_deliveries bị sửa tay (mã vận đơn, mã đơn có thẻ HTML) bị bỏ khi dựng thư, không chèn nguyên vào thân; nửa cặp thay thế lẻ trong tên sản phẩm bị bỏ`, async () => {
    const u = await mkUser(t, { email: 'tamper@shop.vn' });
    await seedMail(t, u.id, { type: 'order_shipped', data: { order_code: '<script>x</script>', tracking_number: '"><img src=x>' } });
    await t.email.sendDue();
    const m = t.mail.msgs[0];
    expect(m.text + m.html).not.toMatch(/<script|<img|"><img/);
    expect(m.text).not.toContain('Mã vận đơn');
    const staff = await mkUser(t, { role: 'staff' });
    await emit(t, 'LowStockDetected', { product_id: randomUUID(), product_name: 'Áo\ud800 thun\udc00', on_hand: 1, available: 1, threshold: 5 });
    const [n] = await notesOf(t, staff.id);
    expect(n.body).toBe('Sản phẩm Áo thun có tồn kho thấp: còn 1, ngưỡng cảnh báo 5.');
  });

  it(`${SEC}-P18 (T15, SB-11): CHECK link của CSDL từ chối dấu hỏi, dấu thăng, khoảng trắng và dấu hai chấm (chỉ chữ, số, gạch chéo, gạch dưới, gạch nối). Còn mở (chờ spec NTF-DB): //intranet không chấm vẫn qua CHECK, lớp web safeLink chặn`, async () => {
    const u = await mkUser(t);
    for (const link of ['/orders?next=//evil', '/orders#x', '/a b', '/a:b', '//evil.test', 'orders', 'javascript:alert(1)']) {
      await expect(seedNote(t, u.id, { link })).rejects.toBeDefined();
    }
    await expect(seedNote(t, u.id, { link: '/admin/inventory' })).resolves.toBeDefined();
  });

  // ---- REV-NTF-P12: vectơ SigV4 do AWS công bố (không phải vectơ tự tính)
  it(`${SEC}-P12 (T14): chữ ký SigV4 khớp hai vectơ của bộ kiểm thử CÔNG BỐ của AWS (get-vanilla, post-vanilla)`, () => {
    const base = { host: 'example.amazonaws.com', path: '/', headers: { 'x-amz-date': '20150830T123600Z' }, payloadHash: sha256Hex(''), amzDate: '20150830T123600Z', region: 'us-east-1', service: 'service', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }; // scan-secrets:allow khóa ví dụ công bố của AWS
    expect(signV4({ method: 'GET', ...base }).signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
    expect(signV4({ method: 'POST', ...base }).signature).toBe('5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b');
  });
});
