import request from 'supertest';
import { ErrorRegistry, errorRegistry } from '../../src/modules/platform';
import { FixtureController } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/app';

const CUST = '11111111-1111-4111-8111-111111111111:customer';
const OTHER = '22222222-2222-4222-8222-222222222222:customer';
const PROBLEM = /^application\/problem\+json/;

describe('Lỗi chuẩn problem+json (PRJ-REQ-20261006-095422820)', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '100000' } }); });
  afterAll(() => t.close());
  const http = () => request(t.app.getHttpServer());

  it('PRJ-TC-20261006-100125091: lỗi kiểm dữ liệu có dạng problem+json, trace_id bằng X-Request-Id, không lặp giá trị', async () => {
    const r = await http().get('/api/v1/fx/items?limit=500').set('x-test-user', CUST);
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toMatch(PROBLEM);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:validation-failed', status: 400, trace_id: r.headers['x-request-id'] });
    expect(r.body.title).toBeTruthy();
    expect(r.body.errors).toContainEqual({ field: 'limit', code: 'too_big' });
    expect(JSON.stringify(r.body)).not.toContain('500');
  });

  it('PRJ-TC-20261006-100125114: exception lạ trả 500 internal-error không lộ chi tiết; log có stack và correlation_id bằng trace_id', async () => {
    t.logs.clear();
    const r = await http().get('/api/v1/fx/boom');
    expect(r.status).toBe(500);
    expect(r.headers['content-type']).toMatch(PROBLEM);
    expect(r.body.type).toBe('urn:ecom:error:internal-error');
    const raw = JSON.stringify(r.body);
    expect(raw).not.toMatch(/TypeError|secret detail|\/srv\/app|stack/);
    const err = t.logs.records.find((l) => l.level === 'error' && l.err);
    expect(err?.correlation_id).toBe(r.body.trace_id);
    expect(err?.err.stack).toContain('TypeError');
  });

  it('PRJ-TC-20261006-100125396: lỗi 500 có stack trong log nhưng không trong phản hồi (một dòng error kèm stack)', async () => {
    t.logs.clear();
    const r = await http().get('/api/v1/fx/boom');
    const errors = t.logs.records.filter((l) => l.level === 'error' && l.msg !== 'request');
    expect(errors).toHaveLength(1);
    expect(errors[0].err.stack).toMatch(/at /);
    expect(r.text).not.toMatch(/at .*\.ts/);
  });

  it('PRJ-TC-20261006-100125161: 404 của tài nguyên người khác giống hệt tài nguyên không tồn tại, chỉ trace_id khác', async () => {
    const a = await http().get('/api/v1/fx/resource/theirs').set('x-test-user', CUST);
    const b = await http().get('/api/v1/fx/resource/missing').set('x-test-user', OTHER);
    expect(a.status).toBe(404);
    const strip = ({ trace_id: _t, ...rest }: Record<string, unknown>) => rest;
    expect(strip(a.body)).toEqual(strip(b.body));
    expect(a.body.trace_id).not.toBe(b.body.trace_id);
    expect(a.body.detail).toBeTruthy();
  });

  it('PRJ-TC-20261006-100125184: JSON hỏng trả 400 validation-failed dạng problem+json', async () => {
    const r = await http().post('/api/v1/fx/echo').set('Content-Type', 'application/json').send('{"a":');
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toMatch(PROBLEM);
    expect(r.body.type).toBe('urn:ecom:error:validation-failed');
    expect(r.text).not.toMatch(/<html|SyntaxError/i);
  });

  it('PRJ-TC-20261006-100125208: Accept text/html vẫn nhận 404 problem+json', async () => {
    const r = await http().get('/api/v1/khong-ton-tai').set('Accept', 'text/html');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(PROBLEM);
    expect(r.body.type).toBe('urn:ecom:error:not-found');
  });

  it('PRJ-TC-20261006-100125232: lỗi 401 từ guard cũng là problem+json có trace_id', async () => {
    const r = await http().get('/api/v1/fx/admin-only');
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toMatch(PROBLEM);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:unauthenticated', trace_id: r.headers['x-request-id'] });
  });

  it('PRJ-TC-20261006-100125256: mã lỗi miền chưa đăng ký trả 500 và log nêu mã; test quét sổ mã bắt mã trùng', async () => {
    t.logs.clear();
    const r = await http().get('/api/v1/fx/unregistered');
    expect(r.status).toBe(500);
    expect(r.body.type).toBe('urn:ecom:error:internal-error');
    expect(t.logs.records.some((l) => l.level === 'error' && String(l.msg).includes('ma-chua-dang-ky'))).toBe(true);
    const reg = new ErrorRegistry();
    reg.register({ code: 'dup-code', status: 409, title: 'a' });
    reg.register({ code: 'dup-code', status: 400, title: 'a' });
    expect(reg.audit().join('\n')).toContain('dup-code');
    expect(errorRegistry.audit()).toEqual([]); // sổ thật sạch (kèm fixture-teapot đã đăng ký)
    const domain = await http().get('/api/v1/fx/domain');
    expect(domain.body).toMatchObject({ type: 'urn:ecom:error:fixture-teapot', status: 409 });
  });

  it('PRJ-TC-20261006-100125280: 429 có thân rate-limited và Retry-After là số nguyên dương', async () => {
    const lim = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '1' } });
    try {
      await request(lim.app.getHttpServer()).get('/api/v1/fx/public-c');
      const r = await request(lim.app.getHttpServer()).get('/api/v1/fx/public-c');
      expect(r.status).toBe(429);
      expect(r.body.type).toBe('urn:ecom:error:rate-limited');
      expect(/^[1-9]\d*$/.test(r.headers['retry-after'])).toBe(true);
    } finally { await lim.close(); }
  });
});

describe('Log có cấu trúc và che dữ liệu (PRJ-REQ-20261006-095422908)', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '100000' } }); });
  afterAll(() => t.close());
  const http = () => request(t.app.getHttpServer());

  it('PRJ-TC-20261006-100125304: log một request thành công là đúng một dòng JSON đủ trường, không Authorization, Cookie hay thân', async () => {
    t.logs.clear();
    const r = await http().get('/api/v1/fx/items').set('x-test-user', CUST).set('Authorization', 'Bearer abc').set('Cookie', 'sid=xyz');
    expect(r.status).toBe(200);
    expect(t.logs.lines).toHaveLength(1);
    const l = JSON.parse(t.logs.lines[0]);
    expect(l).toMatchObject({ level: 'info', correlation_id: r.headers['x-request-id'], method: 'GET', route: '/api/v1/fx/items', status: 200, user_id: CUST.split(':')[0], module: 'http', env: 'dev' });
    expect(Number.isNaN(Date.parse(l.time))).toBe(false);
    expect(l.time).toMatch(/Z$/);
    expect(l.duration_ms).toBeGreaterThanOrEqual(0);
    expect(l.msg).toBe('request');
    expect(t.logs.lines[0]).not.toMatch(/Bearer|sid=xyz|authorization|cookie/i);
  });

  it('PRJ-TC-20261006-100125350: bộ che dữ liệu nhạy cảm, mọi trường nhạy cảm là [REDACTED], trường khác giữ nguyên, kể cả lồng sâu', () => {
    t.logs.clear();
    t.logger.info('probe', {
      email: 'a@b.c', phone: '0900', password: 'pw', address: 'x', token: 't', card_number: '4111', access_token: 'z',
      keep: 'giu-nguyen', shipping_address: { receiver: 'A', line: 'x' }, nested: { deeper: [{ cvv: '123', ok: 1 }] },
    });
    const l = t.logs.records[0];
    for (const k of ['email', 'phone', 'password', 'address', 'token', 'card_number', 'access_token']) expect(l[k]).toBe('[REDACTED]');
    expect(l.shipping_address).toBe('[REDACTED]');
    expect(l.nested.deeper[0]).toEqual({ cvv: '[REDACTED]', ok: 1 });
    expect(l.keep).toBe('giu-nguyen');
    expect(t.logs.lines[0]).not.toMatch(/a@b\.c|4111|"pw"/);
  });

  it('SB-18: err.message, thuộc tính lỗi (kể cả lồng), cause và msg tự do không làm lọt mật khẩu, Bearer, số thẻ, URL có userinfo vào log', async () => {
    t.logs.clear();
    const r = await http().get('/api/v1/fx/boom-leak');
    expect(r.status).toBe(500);
    t.logger.warn('thử msg với Bearer zzz.yyy.xxx và password=pw-in-msg', { note: 'thẻ 5500 0000 0000 0004', list: ['https://u:pw-in-url@h.example/x', { deep: 'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==' }] }); // scan-secrets:allow giá trị giả của test
    const raw = t.logs.lines.join('\n');
    for (const leak of ['Pa55w0rdXyz', 'abc.def-ghi', 'hunter2', '4111', 'cause-secret', 'prop-secret-token', 'nested-pw', 'zzz.yyy', 'pw-in-msg', '5500 0000', 'pw-in-url', 'QWxhZGRpbjpv']) expect([leak, raw.includes(leak)]).toEqual([leak, false]);
    const err = t.logs.records.find((l) => l.level === 'error' && l.err)!;
    expect(err.err.type).toBe('Error');
    expect(err.err.stack).toMatch(/at /); // stack vẫn có để tìm lỗi
    expect(err.err.message).toContain('[REDACTED]');
    expect(err.correlation_id).toBe(r.body.trace_id);
    // giá trị không nhạy cảm giữ nguyên: số 17 chữ số kiểu mã (không qua Luhn), UUID
    t.logs.clear();
    t.logger.info('mã 20261006-100124068 và 11111111-1111-4111-8111-111111111111');
    expect(t.logs.records[0].msg).toBe('mã 20261006-100124068 và 11111111-1111-4111-8111-111111111111');
  });

  it('SB-18: tên trường pwd, pass, pan, apiKey, sessionId, jwt bị che theo tên', () => {
    t.logs.clear();
    t.logger.info('probe', { pwd: 'a', pass: 'b', pan: 'c', apiKey: 'd', sessionId: 'e', jwt: 'f', passenger: 'giu', nested: { api_key: 'g' } });
    expect(t.logs.records[0]).toMatchObject({ pwd: '[REDACTED]', pass: '[REDACTED]', pan: '[REDACTED]', apiKey: '[REDACTED]', sessionId: '[REDACTED]', jwt: '[REDACTED]', passenger: 'giu', nested: { api_key: '[REDACTED]' } });
  });

  it('PRJ-TC-20261006-100125447: header Authorization và Cookie không vào log', async () => {
    t.logs.clear();
    t.logger.info('probe headers', { headers: { authorization: 'Bearer abc', cookie: 'sid=xyz', 'set-cookie': 'sid=1', accept: 'x' } });
    const l = t.logs.records[0];
    expect(l.headers).toEqual({ authorization: '[REDACTED]', cookie: '[REDACTED]', 'set-cookie': '[REDACTED]', accept: 'x' });
  });

  it('PRJ-TC-20261006-100125471: log dùng route dạng mẫu, không có mã đơn và không có query string', async () => {
    t.logs.clear();
    await http().get('/api/v1/fx/orders/7K3M9Q2XH4TB?status=paid').set('x-test-user', CUST);
    const l = t.logs.records.find((r) => r.msg === 'request')!;
    expect(l.route).toBe('/api/v1/fx/orders/{code}');
    expect(t.logs.lines.join('')).not.toMatch(/7K3M9Q2XH4TB|status=paid/);
  });

  it('PRJ-TC-20261006-100125541: LOG_LEVEL=warn lọc info nhưng giữ 401 và 403', async () => {
    const w = await createTestApp({ controllers: [FixtureController], env: { LOG_LEVEL: 'warn', RATE_LIMIT_PER_MINUTE: '100000' } });
    try {
      const h = () => request(w.app.getHttpServer());
      await h().get('/api/v1/fx/open'); // 200
      expect(w.logs.lines).toHaveLength(0);
      await h().get('/api/v1/fx/admin-only'); // 401
      await h().get('/api/v1/fx/admin-only').set('x-test-user', CUST); // 403
      expect(w.logs.records.map((l) => [l.level, l.status])).toEqual([['warn', 401], ['warn', 403]]);
    } finally { await w.close(); }
  });
});
