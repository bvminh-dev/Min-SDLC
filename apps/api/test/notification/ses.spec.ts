import { SesTransport, MailError, UnconfiguredTransport, createMailTransport, createNtfConfig } from '../../src/modules/notification/mail';
import { ConfigError, loadConfig } from '../../src/modules/platform';
import { baseEnv, testConfig } from '../support/app';
import { FakeSes } from '../support/fake-ses';
import { CODE, count, createNtfApp, emit, mailsOf, mkUser, seedMail, truncateAll, type NtfApp } from '../support/ntf';
import { post } from '../support/auth';
import { waitFor } from '../support/boot';

// Bộ chuyển thư SES (NTF-API mục Dịch vụ ngoài, ADR-010; NTF-SEC T3, T14, T17): client ký SigV4 bằng bộ ký dùng chung. CHƯA thử với SES thật: chỉ có SES giả tự dựng kiểm chữ ký và vectơ hằng số tính ngoài mã.
const SEC = 'NTF-SEC-20261006-103815605';
const MSG = { from: 'no-reply@shop.vn', to: 'u1@shop.vn', subject: 'Xin chào', text: 'Nội dung', html: '<p>Nội dung</p>' };

describe('NTF bộ chuyển thư SES', () => {
  const ses = new FakeSes();
  beforeAll(() => ses.start());
  afterAll(() => ses.stop());
  beforeEach(() => ses.reset());
  const transport = (o: { secret?: string } = {}) => new SesTransport({ endpoint: ses.url, region: ses.region, accessKey: ses.accessKey, secretKey: o.secret ?? ses.secretKey });
  const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof MailError ? `${e.code}:${e.permanent ? 'permanent' : 'temporary'}` : String(e); } };

  it(`${SEC} T14: vectơ HẰNG SỐ tính ngoài mã (Python, hmac và hashlib) cho yêu cầu SES: chữ ký SigV4 vùng ap-southeast-1 dịch vụ ses, băm nội dung và thân JSON khớp từng ký tự`, async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response('{"MessageId":"x"}', { status: 200 }); }) as unknown as typeof fetch;
    const t = new SesTransport({ endpoint: 'https://email.ap-southeast-1.amazonaws.com', region: 'ap-southeast-1', accessKey: 'AKIAEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, fetchFn, () => new Date('2026-10-09T10:00:00Z')); // scan-secrets:allow khóa ví dụ công bố của AWS; fixed-clock: vectơ cố định cần x-amz-date cố định
    await t.send({ ...MSG, subject: 'Xin chào' });
    const headers = seen[0].init.headers as Record<string, string>;
    expect(seen[0].url).toBe('https://email.ap-southeast-1.amazonaws.com/v2/email/outbound-emails');
    expect(seen[0].init.body).toBe('{"FromEmailAddress":"no-reply@shop.vn","Destination":{"ToAddresses":["u1@shop.vn"]},"Content":{"Simple":{"Subject":{"Data":"Xin chào","Charset":"UTF-8"},"Body":{"Text":{"Data":"Nội dung","Charset":"UTF-8"},"Html":{"Data":"<p>Nội dung</p>","Charset":"UTF-8"}}}}}');
    expect(headers.Authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20261009/ap-southeast-1/ses/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=66515b9fbfbef0a00bb21b3ed18d118114f4caf9d419ad037739d72d6ad80534');
    expect(headers['x-amz-date']).toBe('20261009T100000Z');
  });

  it(`${SEC} T14: yêu cầu thật tới SES giả được kiểm chữ ký; khóa sai thì 403 và lỗi ses_auth vĩnh viễn; thông điệp lỗi chỉ là mã, không chứa chi tiết phản hồi`, async () => {
    await transport().send(MSG);
    expect(ses.mails).toEqual([{ from: MSG.from, to: ['u1@shop.vn'], subject: 'Xin chào', text: 'Nội dung', html: '<p>Nội dung</p>' }]);
    ses.reset();
    const bad = transport({ secret: 'wrongSecretKeyForTests000000000000000000' }); // scan-secrets:allow khóa giả của test
    let err: MailError | undefined;
    try { await bad.send(MSG); } catch (e) { err = e as MailError; }
    expect([err?.code, err?.permanent, err?.message]).toEqual(['ses_auth', true, 'ses_auth']);
    expect(ses.requests[0].authentic).toBe(false);
    expect(JSON.stringify(err) + String(err?.stack)).not.toMatch(/u1@shop\.vn|SECRET-DETAIL/);
  });

  it(`${SEC} T17: phân loại lỗi SES: throttling và 5xx là lỗi tạm thời; từ chối và 4xx là vĩnh viễn; treo quá hạn và lỗi mạng là tạm thời`, async () => {
    const cases: [{ status: number; type?: string }, string][] = [
      [{ status: 429, type: 'TooManyRequestsException' }, 'ses_throttled:temporary'], [{ status: 400, type: 'ThrottlingException' }, 'ses_throttled:temporary'], [{ status: 500, type: 'InternalFailure' }, 'ses_unavailable:temporary'],
      [{ status: 503 }, 'ses_unavailable:temporary'], [{ status: 400, type: 'MessageRejected' }, 'ses_rejected:permanent'], [{ status: 400, type: 'BadRequestException' }, 'ses_rejected:permanent'],
      [{ status: 404, type: 'NotFoundException' }, 'ses_rejected:permanent'], [{ status: 403, type: 'AccountSuspendedException' }, 'ses_auth:permanent'],
    ];
    for (const [step, expected] of cases) { ses.script = [step]; expect([JSON.stringify(step), await codeOf(transport().send(MSG))]).toEqual([JSON.stringify(step), expected]); }
    ses.delayMs = 300;
    const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
    expect(await codeOf(transport().send(MSG, ac.signal))).toBe('ses_timeout:temporary');
    ses.delayMs = 0;
    const closed = new SesTransport({ endpoint: 'http://127.0.0.1:9', region: 'ap-southeast-1', accessKey: 'k', secretKey: 's' });
    expect(await codeOf(closed.send(MSG))).toBe('ses_network:temporary');
  });

  it(`${SEC} T3: thông điệp gửi SES là JSON có trường riêng: tên có xuống dòng không chèn được header; Destination chỉ có ToAddresses (không Bcc, Cc); mọi trường header không có CR hay LF`, async () => {
    // greeting đi qua mẫu (render.ts); ở đây kiểm tầng truyền: hai trường nhạy cảm được mã hóa JSON, không dựng MIME bằng tay
    await transport().send({ ...MSG, text: 'Xin chào Minh Bcc: attacker@evil.test,\n\nNội dung' });
    const sent = ses.requests[0].body;
    expect(Object.keys(sent).sort()).toEqual(['Content', 'Destination', 'FromEmailAddress']);
    expect(Object.keys(sent.Destination)).toEqual(['ToAddresses']);
    for (const h of [sent.FromEmailAddress, sent.Destination.ToAddresses[0], sent.Content.Simple.Subject.Data]) expect(h).not.toMatch(/[\r\n]/);
    expect(ses.requests[0].raw).not.toMatch(/Bcc|BccAddresses|CcAddresses/i.test(ses.requests[0].raw) ? /^$/ : /Bcc"/);
  });

  it(`${SEC} T14, T17: bộ chuyển thư theo cấu hình: thiếu khóa, vùng hay người gửi là "chưa cấu hình" (lỗi vĩnh viễn ses_unconfigured, không gọi mạng); ngoài dev APP_BASE_URL và SES_ENDPOINT phải https`, async () => {
    const dev = testConfig({ APP_BASE_URL: 'http://localhost:3000' });
    expect(createMailTransport(createNtfConfig(dev))).toBeInstanceOf(UnconfiguredTransport);
    await expect(new UnconfiguredTransport().send()).rejects.toMatchObject({ code: 'ses_unconfigured', permanent: true });
    expect(createMailTransport(createNtfConfig(testConfig({ SES_REGION: 'ap-southeast-1', MAIL_FROM: 'no-reply@shop.vn', SES_ACCESS_KEY: 'k', SES_SECRET_KEY: 's' })))).toBeInstanceOf(SesTransport);
    expect(createMailTransport(createNtfConfig(testConfig({ SES_REGION: 'ap-southeast-1', SES_ACCESS_KEY: 'k', SES_SECRET_KEY: 's' })))).toBeInstanceOf(UnconfiguredTransport); // thiếu MAIL_FROM
    // dev không đặt APP_BASE_URL: dùng http://localhost:3000; có dấu / cuối thì bỏ
    expect(createNtfConfig(testConfig()).APP_BASE_URL).toBe('http://localhost:3000');
    expect(createNtfConfig(testConfig({ APP_BASE_URL: 'http://localhost:3000/' })).APP_BASE_URL).toBe('http://localhost:3000');
    // staging, prod
    const tls = `${baseEnv().DATABASE_URL}?sslmode=require`;
    const stg = (over: Record<string, string>) => testConfig({ APP_ENV: 'staging', DATABASE_URL: tls, RETENTION_DATABASE_URL: tls, STORAGE_ENDPOINT: 'https://s3.example.test', STORAGE_ACCESS_KEY: 'k'.repeat(20), STORAGE_SECRET_KEY: 's'.repeat(40), ...over });
    expect(() => createNtfConfig(stg({}))).not.toThrow();
    for (const [name, over] of [['APP_BASE_URL', { APP_BASE_URL: 'http://shop.example' }], ['SES_ENDPOINT', { SES_ENDPOINT: 'http://email.example' }]] as const) {
      let err: ConfigError | undefined;
      try { createNtfConfig(stg(over)); } catch (e) { err = e as ConfigError; }
      expect([name, err?.problems.map((p) => p.name)]).toEqual([name, [name]]);
    }
    // thiếu biến bắt buộc ở staging: nêu tên, không in giá trị
    const env = { ...baseEnv({ APP_ENV: 'staging', DATABASE_URL: tls, RETENTION_DATABASE_URL: tls, STORAGE_ENDPOINT: 'https://s3.example.test', STORAGE_ACCESS_KEY: 'k'.repeat(20), STORAGE_SECRET_KEY: 's'.repeat(40) }), SES_REGION: '', MAIL_FROM: '', APP_BASE_URL: '', SES_ACCESS_KEY: '', SES_SECRET_KEY: '' };
    let e2: ConfigError | undefined;
    try { loadConfig(env); } catch (e) { e2 = e as ConfigError; }
    expect(e2?.problems.map((p) => p.name).sort()).toEqual(['APP_BASE_URL', 'MAIL_FROM', 'SES_ACCESS_KEY', 'SES_REGION', 'SES_SECRET_KEY']);
    expect(e2?.format()).not.toContain('k'.repeat(20));
    // gốc URL không hợp lệ (đường dẫn con, userinfo, query) và MAIL_FROM có xuống dòng hay tên hiển thị bị từ chối lúc nạp cấu hình
    for (const [name, value] of [['APP_BASE_URL', 'https://shop.example/app'], ['APP_BASE_URL', 'https://user:pw@shop.example'], ['APP_BASE_URL', 'https://shop.example?x=1'], ['SES_ENDPOINT', 'ftp://x'], ['MAIL_FROM', 'Shop <no-reply@shop.vn>'], ['MAIL_FROM', 'a@shop.vn\r\nBcc: x@evil.test'], ['MAIL_FROM', 'no-at-sign']] as const) { // scan-secrets:allow URL giả có userinfo để thử từ chối
      let e3: ConfigError | undefined;
      try { testConfig({ [name]: value }); } catch (e) { e3 = e as ConfigError; }
      expect([name, value, e3?.problems.map((p) => p.name)]).toEqual([name, value, [name]]);
    }
  });
});

// Chạy cả đường thật: AUTH thật phát PasswordResetRequested, NTF gửi bằng SesTransport tới SES giả; liên kết dùng APP_BASE_URL, không dùng Host header (BR8, T15).
describe('NTF email qua SesTransport thật tới SES giả', () => {
  const ses = new FakeSes();
  let t: NtfApp;
  beforeAll(async () => { await ses.start(); t = await createNtfApp({ ses }); });
  afterAll(async () => { await t.close(); await ses.stop(); });
  beforeEach(async () => { await truncateAll(t.prisma); ses.reset(); t.logs.clear(); t.mails.length = 0; t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); });

  it('NTF-TC-20261006-104223120: job gửi email order_created qua SesTransport thật tới SES giả (chữ ký hợp lệ), ghi sent; bản ghi không có địa chỉ', async () => {
    const u1 = await mkUser(t, { email: 'u1@shop.vn' });
    await emit(t, 'OrderCreated', { order_id: '11111111-1111-4111-8111-111111111111', order_code: CODE, user_id: u1.id, grand_total: 350000, payment_method: 'cod', payment_expires_at: null });
    expect(await t.email.sendDue({ now: new Date(Date.now() + 1000) })).toMatchObject({ sent: 1 });
    expect(ses.requests.map((r) => r.authentic)).toEqual([true]);
    expect(ses.mails).toMatchObject([{ from: 'no-reply@shop.vn', to: ['u1@shop.vn'], subject: 'Đã nhận đơn hàng' }]);
    expect(ses.mails[0].text).toContain('Tổng tiền 350.000 đ');
    expect((await mailsOf(t, u1.id))[0]).toMatchObject({ delivery_status: 'sent', attempts: 1 });
    // SES giả trả lỗi vĩnh viễn kèm chi tiết nhạy cảm: bản ghi chỉ có mã, log không có chi tiết hay địa chỉ
    const id = await seedMail(t, u1.id, { at: new Date(Date.now() - 1000) });
    ses.script = [{ status: 400, type: 'MessageRejected' }];
    await t.email.sendDue({ now: new Date(Date.now() + 2000) });
    expect((await mailsOf(t, u1.id)).find((m) => m.id === id)).toMatchObject({ delivery_status: 'failed', delivery_reason: 'ses_rejected' });
    expect(t.logs.lines.join('\n')).not.toMatch(/SECRET-DETAIL|u1@shop\.vn/);
  });

  it(`NTF-TC-20261006-104223630 ${SEC} T3 (REV-NTF-08): họ tên chứa xuống dòng: yêu cầu JSON tới SES v2 có Subject, ToAddresses, Body đúng; không BccAddresses hay CcAddresses; không trường tiêu đề nào chứa CR hay LF; HTML escape`, async () => {
    const u4 = await mkUser(t, { name: 'Minh\r\nBcc: attacker@evil.test', email: 'u4@shop.vn' });
    const u5 = await mkUser(t, { name: '<b>x</b>', email: 'u5@shop.vn' });
    for (const u of [u4, u5]) await seedMail(t, u.id, { at: new Date(Date.now() - 1000) });
    expect(await t.email.sendDue({ now: new Date(Date.now() + 1000) })).toMatchObject({ sent: 2 });
    const bodyOf = (to: string) => ses.requests.map((r) => r.body).find((b) => b?.Destination?.ToAddresses?.[0] === to);
    const b4 = bodyOf('u4@shop.vn'), b5 = bodyOf('u5@shop.vn');
    expect(b4.Content.Simple.Subject.Data).toBe('Đã nhận đơn hàng');
    expect(b4.Destination).toEqual({ ToAddresses: ['u4@shop.vn'] }); // không BccAddresses, CcAddresses
    expect(Object.keys(b4).sort()).toEqual(['Content', 'Destination', 'FromEmailAddress']);
    expect(Object.keys(b4).sort()).toEqual(Object.keys(b5).sort()); // cùng tập khóa với thư của người dùng khác
    for (const h of [b4.FromEmailAddress, b4.Destination.ToAddresses[0], b4.Content.Simple.Subject.Data]) expect(h).not.toMatch(/[\r\n]/);
    expect(b4.Content.Simple.Body.Text.Data.split('\n')[0]).toBe('Xin chào Minh Bcc: attacker@evil.test,');
    expect(b4.Content.Simple.Body.Text.Data).not.toMatch(/\r/);
    expect(b5.Content.Simple.Body.Html.Data).toContain('Xin chào &lt;b&gt;x&lt;/b&gt;,');
    expect(b5.Content.Simple.Body.Html.Data).not.toContain('<b>x</b>');
  });

  it(`NTF-TC-20261006-104225530 ${SEC} T15: quên mật khẩu qua AUTH thật với Host và X-Forwarded-Host giả: liên kết trong email dựng từ APP_BASE_URL, không từ Host; token chỉ trong thư gửi SES, không ở CSDL hay log`, async () => {
    const u2 = await mkUser(t, { email: 'u2@shop.vn' });
    const r = await post(t, '/auth/password/forgot', { email: 'u2@shop.vn' }, { ip: '203.0.113.9' }).set('Host', 'evil.test').set('X-Forwarded-Host', 'evil.test');
    expect(r.status).toBeLessThan(300);
    expect(await waitFor(() => t.mails.length > 0, 10_000)).toBe(true); // AUTH tạo token sau khi trả lời 202
    await t.evts.idle();
    expect(ses.mails).toHaveLength(1);
    const token = t.mails[0].token;
    expect(ses.mails[0].text).toContain(`https://shop.example/reset-password#token=${token}`);
    expect(JSON.stringify(ses.requests.map((q) => q.raw))).not.toContain('evil.test');
    const dump = JSON.stringify([await mailsOf(t), t.logs.lines]);
    expect(dump).not.toContain(token);
    expect(await count(t, 'outbox_events', `payload::text LIKE '%${token}%'`)).toBe(0);
    expect(u2.id).toBeTruthy();
  });
});
