import request from 'supertest';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { auditRoutes, routeIds, PrismaService } from '../../src/modules/platform';
import { BadController, FixtureController, fixtureState } from '../support/fixtures';
import { createTestApp, ORIGIN, type TestApp } from '../support/app';
import { newPrisma, testDbUrl, truncateAll } from '../support/db';

const CUST = '11111111-1111-4111-8111-111111111111:customer';
const OTHER = '22222222-2222-4222-8222-222222222222:customer';
const ADMIN = '33333333-3333-4333-8333-333333333333:admin';
const PROBLEM = /^application\/problem\+json/;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('API chung (PRJ-REQ-20261006-095422650)', () => {
  let t: TestApp;
  beforeAll(async () => {
    const p = newPrisma();
    await p.$executeRaw`CREATE TABLE IF NOT EXISTS test_idem_records (id serial PRIMARY KEY, qty int NOT NULL)`;
    await p.$disconnect();
    t = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '100000' } });
  });
  afterAll(() => t.close());
  const http = () => request(t.app.getHttpServer());

  it('PRJ-TC-20261006-100124463: health liveness công khai, thân đúng {"status":"ok"} và có X-Request-Id', async () => {
    const r = await http().get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
    expect(r.headers['x-request-id']).toMatch(UUID4);
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('PRJ-TC-20261006-100124486: phân trang mặc định page=1, limit=20, 20 phần tử, total=25', async () => {
    fixtureState.listTotal = 25;
    const r = await http().get('/api/v1/fx/items').set('x-test-user', CUST);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, limit: 20, total: 25 });
    expect(r.body.items).toHaveLength(20);
  });

  it.each([['limit', 'limit=500'], ['limit', 'limit=0'], ['page', 'page=0'], ['page', 'page=-1'], ['limit', 'limit=abc']])(
    'PRJ-TC-20261006-100124510: tham số phân trang ngoài miền %s bị từ chối (%s)',
    async (field, qs) => {
      const r = await http().get(`/api/v1/fx/items?${qs}`).set('x-test-user', CUST);
      expect(r.status).toBe(400);
      expect(r.headers['content-type']).toMatch(PROBLEM);
      expect(r.body.type).toBe('urn:ecom:error:validation-failed');
      expect(r.body.errors.map((e: { field: string }) => e.field)).toContain(field);
      expect(r.body.items).toBeUndefined();
    },
  );

  it('PRJ-TC-20261006-100124533: trường lạ user_id/role ở query và body bị từ chối 400', async () => {
    const q = await http().get('/api/v1/fx/items?user_id=abc').set('x-test-user', CUST);
    expect(q.status).toBe(400);
    expect(q.body.errors).toContainEqual({ field: 'user_id', code: 'unrecognized_keys' });
    const b = await http().post('/api/v1/fx/items').set('x-test-user', CUST).send({ name: 'a', user_id: 'x', role: 'admin' });
    expect(b.status).toBe(400);
    expect(b.body.errors.map((e: { field: string }) => e.field)).toEqual(expect.arrayContaining(['user_id', 'role']));
    expect(JSON.stringify(b.body)).not.toContain('admin');
  });

  it('PRJ-TC-20261006-100124556: mặc định từ chối, guest 401, customer gọi endpoint admin 403, @Public 200', async () => {
    expect((await http().get('/api/v1/fx/admin-only')).status).toBe(401);
    expect((await http().get('/api/v1/fx/admin-only').set('x-test-user', CUST)).status).toBe(403);
    expect((await http().get('/api/v1/fx/admin-only').set('x-test-user', ADMIN)).status).toBe(200);
    expect((await http().get('/api/v1/fx/open')).status).toBe(200);
  });

  it('PRJ-TC-20261006-100124579: test quét route liệt kê endpoint thiếu quyền hoặc schema; route thật sạch', async () => {
    const bad = await createTestApp({ controllers: [BadController] });
    try {
      const v = auditRoutes(bad.app);
      expect(v).toHaveLength(3);
      expect(v.join('\n')).toContain('GET /api/v1/bad/no-auth: thiếu khai báo quyền');
      expect(v.join('\n')).toContain('GET /api/v1/bad/no-schema: thiếu schema kiểm');
      expect(v.join('\n')).toContain('ipn-no-verifier: @SystemEndpoint thiếu verifier'); // đồng thời kiểm PRJ-TC-20261006-110200111
    } finally { await bad.close(); }
    expect(auditRoutes(t.app)).toEqual([]);
  });

  it('SB-14, SB-33: test quét route chạy trên AppModule thật; thêm route không khai quyền hoặc schema, hoặc thiếu guard toàn cục, thì báo đỏ', async () => {
    const real = await createTestApp({ imports: [AppModule] });
    try {
      expect(auditRoutes(real.app)).toEqual([]); // mọi route của ứng dụng thật (health...) đã khai đủ
      expect(routeIds(real.app)).toEqual(expect.arrayContaining(['GET /api/v1/health', 'GET /api/v1/health/ready'])); // quét thấy route thật, không phải rỗng
    } finally { await real.close(); }
    // route mới ở một module của ứng dụng mà không khai: CI đỏ
    const withBad = await createTestApp({ imports: [AppModule], controllers: [BadController] });
    try {
      const v = auditRoutes(withBad.app);
      expect(v.join('\n')).toContain('GET /api/v1/bad/no-auth: thiếu khai báo quyền');
      expect(v.join('\n')).toContain('GET /api/v1/bad/no-schema: thiếu schema kiểm');
      expect(v).toHaveLength(3);
    } finally { await withBad.close(); }
    // ứng dụng không nạp PlatformModule: không có giới hạn tần suất, CSRF, guard quyền, schema, bộ lọc lỗi
    const bare = await Test.createTestingModule({ imports: [DiscoveryModule], controllers: [FixtureController] }).useMocker(() => ({})).compile();
    const bareApp = bare.createNestApplication({ logger: false });
    try {
      await bareApp.init();
      const v = auditRoutes(bareApp);
      for (const g of ['RateLimitGuard', 'CsrfGuard', 'AuthGuard', 'ValidationInterceptor', 'ProblemFilter']) expect(v.join('\n')).toContain(`ứng dụng thiếu ${g} toàn cục`);
    } finally { await bareApp.close(); }
  });

  it('PRJ-TC-20261006-100124603: CSRF, POST có cookie từ nguồn lạ hoặc thiếu Origin bị 403, nguồn hợp lệ qua, GET không bị kiểm', async () => {
    const post = (origin?: string, referer?: string) => {
      let r = http().post('/api/v1/fx/state').set('x-test-user', CUST).set('Cookie', 'sid=abc');
      if (origin) r = r.set('Origin', origin);
      if (referer) r = r.set('Referer', referer);
      return r.send({ name: 'x' });
    };
    const evil = await post('https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.body.type).toBe('urn:ecom:error:csrf_failed');
    expect((await post()).status).toBe(403);
    expect((await post(ORIGIN)).status).toBe(201);
    expect((await post(undefined, `${ORIGIN}/page`)).status).toBe(201); // Referer thay Origin khi thiếu Origin
    expect((await http().post('/api/v1/fx/state').set('x-test-user', CUST).send({ name: 'x' })).status).toBe(201); // không cookie, không Origin (máy gọi máy): không kiểm
    expect((await http().get('/api/v1/fx/open').set('Cookie', 'sid=abc').set('Origin', 'https://evil.example')).status).toBe(200);
  });

  it('PRJ-TC-20261006-100124603: CSRF áp cho cả PUT, PATCH và DELETE có cookie (nguồn lạ 403, nguồn hợp lệ qua)', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      const send = (origin: string) => http()[method]('/api/v1/fx/state').set('x-test-user', CUST).set('Cookie', 'sid=abc').set('Origin', origin).send(method === 'delete' ? undefined : { name: 'x' });
      expect([method, (await send('https://evil.example')).status]).toEqual([method, 403]);
      expect([method, (await send(ORIGIN)).status]).toEqual([method, 200]);
    }
  });

  it('PRJ-TC-20261006-100124556: route không khai quyền bị từ chối khi chạy thật (mặc định từ chối), guest cũng như customer', async () => {
    const bad = await createTestApp({ controllers: [BadController] });
    try {
      const get = (u?: string) => { const r = request(bad.app.getHttpServer()).get('/api/v1/bad/no-auth'); return u ? r.set('x-test-user', u) : r; };
      expect((await get()).status).toBe(403);
      expect((await get(CUST)).status).toBe(403);
      expect((await get(ADMIN)).status).toBe(403);
    } finally { await bad.close(); }
  });

  it('PRJ-TC-20261006-100124463: HSTS có ở staging và prod, không có ở dev; X-Powered-By tắt ở mọi môi trường', async () => {
    const staging = await createTestApp({ controllers: [FixtureController], env: { APP_ENV: 'staging', DATABASE_URL: `${testDbUrl()}?sslmode=require`, RETENTION_DATABASE_URL: `${testDbUrl()}?sslmode=require`, STORAGE_ENDPOINT: 'https://s3.example.test', STORAGE_ACCESS_KEY: 'ak-test-value', STORAGE_SECRET_KEY: 'sk-test-value' } }); // staging cần đủ biến kho ảnh của USR (ConfigVar.requiredOutsideDev)
    try {
      const r = await request(staging.app.getHttpServer()).get('/api/v1/health');
      expect(r.headers['strict-transport-security']).toBe('max-age=31536000');
      expect(r.headers['x-powered-by']).toBeUndefined();
    } finally { await staging.close(); }
    expect((await http().get('/api/v1/health')).headers['strict-transport-security']).toBeUndefined();
  });

  it('PRJ-TC-20261006-100124626: CORS, nguồn lạ không nhận Allow-Origin, nguồn hợp lệ nhận đúng nguồn kèm credentials, không bao giờ *', async () => {
    const evil = await http().options('/api/v1/fx/open').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const evilGet = await http().get('/api/v1/fx/open').set('Origin', 'https://evil.example');
    expect(evilGet.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await http().options('/api/v1/fx/open').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const okGet = await http().get('/api/v1/fx/open').set('Origin', ORIGIN);
    expect(okGet.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('PRJ-TC-20261006-100124650: vượt giới hạn tần suất bậc C mặc định nhận 429 kèm Retry-After, hết phút lại qua, client khác không bị ảnh hưởng', async () => {
    const lim = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '3' } });
    try {
      const hit = (u: string) => request(lim.app.getHttpServer()).get('/api/v1/fx/limited-c').set('x-test-user', u);
      for (let i = 0; i < 3; i++) expect((await hit(CUST)).status).toBe(200);
      lim.clock.advance(10_000);
      const over = await hit(CUST);
      expect(over.status).toBe(429);
      expect(over.body.type).toBe('urn:ecom:error:rate-limited');
      expect(over.headers['content-type']).toMatch(PROBLEM);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number.isInteger(Number(over.headers['retry-after']))).toBe(true);
      expect((await hit(OTHER)).status).toBe(200);
      lim.clock.advance(61_000);
      expect((await hit(CUST)).status).toBe(200);
    } finally { await lim.close(); }
  });

  it('PRJ-TC-20261006-100124673: X-Request-Id không hợp lệ bị thay bằng UUID v4, giá trị hợp lệ được giữ, giá trị lạ không vào log', async () => {
    for (const bad of ['x', 'a'.repeat(200)]) {
      t.logs.clear();
      const r = await http().get('/api/v1/health').set('X-Request-Id', bad);
      expect(r.headers['x-request-id']).toMatch(UUID4);
      expect(t.logs.lines.join('')).not.toContain(bad);
    }
    expect((await http().get('/api/v1/health').set('X-Request-Id', 'abc-12345678')).headers['x-request-id']).toBe('abc-12345678');
    // giá trị có xuống dòng: Node từ chối gửi header như vậy nên kiểm ở mức hàm
    const { resolveCorrelationId } = await import('../../src/modules/platform/http/app-setup');
    expect(resolveCorrelationId('abc-1234\nforged log line')).toMatch(UUID4);
    expect(resolveCorrelationId('abc-1234\r\n')).toMatch(UUID4);
  });

  it('PRJ-TC-20261006-100124695: limit=100 hợp lệ trả 20 bản ghi, page=2 trả items rỗng và total=20', async () => {
    fixtureState.listTotal = 20;
    try {
      const a = await http().get('/api/v1/fx/items?limit=100').set('x-test-user', ADMIN);
      expect(a.status).toBe(200);
      expect(a.body.items).toHaveLength(20);
      const b = await http().get('/api/v1/fx/items?page=2').set('x-test-user', ADMIN);
      expect(b.status).toBe(200);
      expect(b.body).toMatchObject({ items: [], total: 20, page: 2 });
    } finally { fixtureState.listTotal = 25; }
  });

  it('PRJ-TC-20261006-100124743: đường dẫn ngoài /api/v1 trả 404 problem+json không nêu route nội bộ', async () => {
    for (const path of ['/api/v2/orders', '/orders']) {
      const r = await http().get(path);
      expect(r.status).toBe(404);
      expect(r.headers['content-type']).toMatch(PROBLEM);
      expect(r.body.type).toBe('urn:ecom:error:not-found');
      expect(JSON.stringify(r.body)).not.toContain('orders');
    }
  });

  it('PRJ-TC-20261006-100124768: body đúng 1 MB xử lý, vượt 1 MB trả 413, text/plain trả 415', async () => {
    const make = (bytes: number) => { const pad = bytes - '{"name":""}'.length; return `{"name":"${'a'.repeat(pad)}"}`; };
    const ok = make(1_048_576);
    expect(Buffer.byteLength(ok)).toBe(1_048_576);
    const a = await http().post('/api/v1/fx/echo').set('Content-Type', 'application/json').send(ok);
    expect(a.status).toBe(201);
    const big = make(1_048_577);
    expect(Buffer.byteLength(big)).toBe(1_048_577);
    const b = await http().post('/api/v1/fx/echo').set('Content-Type', 'application/json').send(big);
    expect(b.status).toBe(413);
    expect(b.body.type).toBe('urn:ecom:error:payload-too-large');
    const c = await http().post('/api/v1/fx/echo').set('Content-Type', 'text/plain').send('hello');
    expect(c.status).toBe(415);
    expect(c.body.type).toBe('urn:ecom:error:unsupported-media-type');
  });

  it('PRJ-TC-20261006-100124815: health không bị giới hạn tần suất (1000 yêu cầu trong một phút, không có 429)', async () => {
    let tooMany = 0;
    for (let i = 0; i < 1000; i++) if ((await http().get('/api/v1/health')).status === 429) tooMany++;
    expect(tooMany).toBe(0);
  }, 120_000);
});

describe('Giới hạn tần suất theo IP (PRJ-REQ-20261006-095422650 BR9)', () => {
  const run = async (hops: string) => {
    const t = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '3', TRUST_PROXY_HOPS: hops } });
    return t;
  };

  it('PRJ-TC-20261006-100124838: X-Forwarded-For chỉ được tin ở proxy đã cấu hình', async () => {
    const t0 = await run('0');
    try {
      const hit = (xff: string) => request(t0.app.getHttpServer()).get('/api/v1/fx/public-c').set('X-Forwarded-For', xff);
      for (let i = 0; i < 3; i++) await hit('1.2.3.4');
      // 0 hop: header bị bỏ qua, đổi giá trị mỗi lần vẫn bị 429 theo IP kết nối
      expect((await hit('1.2.3.4')).status).toBe(429);
      expect((await hit('8.8.8.8')).status).toBe(429);
    } finally { await t0.close(); }
    const t1 = await run('1');
    try {
      const hit = (xff: string) => request(t1.app.getHttpServer()).get('/api/v1/fx/public-c').set('X-Forwarded-For', xff);
      // 1 hop: lấy phần tử phải nhất (do proxy tin cậy thêm); phần client tự gửi ở bên trái bị bỏ qua
      for (let i = 0; i < 3; i++) await hit(`10.0.0.${i}, 5.5.5.5`);
      expect((await hit('10.0.0.99, 5.5.5.5')).status).toBe(429);
      expect((await hit('10.0.0.1, 6.6.6.6')).status).toBe(200);
    } finally { await t1.close(); }
  });
});

describe('Bậc B đếm chung giữa instance và endpoint hệ thống', () => {
  it('PRJ-TC-20261006-110200110: bậc B đếm chung qua PostgreSQL giữa hai instance, bậc C đếm riêng từng instance', async () => {
    const p = newPrisma();
    await truncateAll(p);
    await p.$disconnect();
    const a = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '3' } });
    const b = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '3' } });
    b.clock.set(a.clock.now()); // cùng cửa sổ
    try {
      const callB = (t: TestApp) => request(t.app.getHttpServer()).get('/api/v1/fx/limited-b').set('x-test-user', CUST);
      for (let i = 0; i < 3; i++) expect((await callB(a)).status).toBe(200);
      for (let i = 0; i < 2; i++) expect((await callB(b)).status).toBe(200);
      const sixth = await callB(b);
      expect(sixth.status).toBe(429);
      expect(sixth.body.type).toBe('urn:ecom:error:rate-limited');
      expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
      expect((await request(a.app.getHttpServer()).get('/api/v1/fx/limited-c').set('x-test-user', CUST)).status).toBe(200);
      // bậc C: bộ nhớ từng instance, mỗi instance cho qua tối đa 3 (tổng 6 > giới hạn 3, chấp nhận)
      const callC = (t: TestApp) => request(t.app.getHttpServer()).get('/api/v1/fx/public-c');
      let ok = 0;
      for (const t of [a, b]) for (let i = 0; i < 3; i++) if ((await callC(t)).status === 200) ok++;
      expect(ok).toBe(6);
    } finally { await a.close(); await b.close(); }
  });

  it('PRJ-TC-20261006-110200111: endpoint hệ thống, chữ ký sai bị từ chối theo định dạng cổng, đúng thì không bị kiểm CSRF, quét route bắt thiếu verifier', async () => {
    const t = await createTestApp({ controllers: [FixtureController, BadController] });
    try {
      const before = fixtureState.ipnHandled;
      const wrong = await request(t.app.getHttpServer()).post('/api/v1/fx/ipn').set('Origin', 'https://evil.example').set('x-sign', 'bad').send({ ref: 'A1' });
      expect(wrong.status).toBe(200);
      expect(wrong.body).toEqual({ RspCode: '97', Message: 'Invalid signature' }); // không phải problem+json
      expect(wrong.headers['content-type']).toMatch(/^application\/json/);
      expect(fixtureState.ipnHandled).toBe(before);
      const good = await request(t.app.getHttpServer()).post('/api/v1/fx/ipn').set('Origin', 'https://evil.example').set('Cookie', 'sid=abc').set('x-sign', 'good').send({ ref: 'A1' });
      expect(good.body).toEqual({ RspCode: '00', Message: 'Confirm Success' }); // miễn CSRF dù có cookie và Origin lạ
      expect(fixtureState.ipnHandled).toBe(before + 1);
      // lỗi bất ngờ ở IPN: định dạng cổng, không lộ stack hay SQL
      const crash = await request(t.app.getHttpServer()).post('/api/v1/fx/ipn-crash').send({});
      expect(crash.body).toEqual({ RspCode: '99', Message: 'Unknown error' });
      expect(JSON.stringify(crash.body)).not.toMatch(/select|secret|stack/i);
      expect(t.logs.records.some((r) => r.level === 'error' && r.correlation_id === crash.headers['x-request-id'])).toBe(true);
      expect(auditRoutes(t.app).join('\n')).toContain('@SystemEndpoint thiếu verifier');
      // bậc E vẫn áp (đếm trong PostgreSQL): mặc định 300 mỗi phút theo IP; đã dùng 3 yêu cầu ở trên
      const p = t.app.get(PrismaService);
      await p.$executeRaw`TRUNCATE rate_limit_counters`;
      let last = 0;
      for (let i = 0; i < 301; i++) last = (await request(t.app.getHttpServer()).post('/api/v1/fx/ipn').set('x-sign', 'good').send({ ref: 'A1' })).status;
      expect(last).toBe(429);
    } finally { await t.close(); }
  });
});

describe('Idempotency-Key (ADR-017, SB-40)', () => {
  let t: TestApp;
  let prisma: PrismaService;
  const count = async () => Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM test_idem_records`)[0].n);
  beforeAll(async () => {
    t = await createTestApp({ controllers: [FixtureController] });
    prisma = t.app.get(PrismaService);
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS test_idem_records (id serial PRIMARY KEY, qty int NOT NULL)`;
  });
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE idempotency_keys, test_idem_records`;
  });
  afterAll(() => t.close());
  const post = (key: string | undefined, body: unknown, user = CUST) => {
    let r = request(t.app.getHttpServer()).post('/api/v1/fx/idem').set('x-test-user', user);
    if (key !== undefined) r = r.set('Idempotency-Key', key);
    return r.send(body as object);
  };

  it('PRJ-TC-20261006-110200108: phát lại cùng khóa, 422 khi khác nội dung, 400 idempotency-key-required khi thiếu hoặc sai mẫu, 5xx không lưu', async () => {
    const first = await post('key-12345678', { qty: 1 });
    expect(first.status).toBe(201);
    const again = await post('key-12345678', { qty: 1 });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await count()).toBe(1);

    const reused = await post('key-12345678', { qty: 2 });
    expect(reused.status).toBe(422);
    expect(reused.body.type).toBe('urn:ecom:error:idempotency-key-reused');
    expect(await count()).toBe(1);

    for (const bad of [undefined, 'abc123', 'has space1234']) {
      const r = await post(bad, { qty: 3 });
      expect(r.status).toBe(400);
      expect(r.body.type).toBe('urn:ecom:error:idempotency-key-required');
    }
    expect(await count()).toBe(1);

    const eight = await post('abcd1234', { qty: 4 });
    expect(eight.status).toBe(201);
    expect(await count()).toBe(2);

    // 5xx không được lưu: giao dịch rollback nên gửi lại cùng khóa chạy bình thường
    const boom = await post('crash-key-1', { qty: -1 });
    expect(boom.status).toBe(500);
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM idempotency_keys WHERE key = 'crash-key-1'`;
    expect(Number(rows[0].n)).toBe(0);
    expect((await post('crash-key-1', { qty: 5 })).status).toBe(201);
  });

  it('PRJ-TC-20261006-110200108: biên độ dài khóa: 7 ký tự và 65 ký tự bị 400, 8 và 64 ký tự được nhận', async () => {
    for (const [len, status] of [[7, 400], [8, 201], [64, 201], [65, 400]] as const) {
      const r = await post(`k${'x'.repeat(len - 1)}`.replace(/x/g, () => 'a'), { qty: 100 + len });
      expect([len, r.status]).toEqual([len, status]);
      if (status === 400) expect(r.body.type).toBe('urn:ecom:error:idempotency-key-required');
    }
  });

  it('PRJ-TC-20261006-110200109: hai yêu cầu đồng thời cùng khóa chạy đúng một lần, hai người dùng cùng chuỗi khóa độc lập', async () => {
    const [a, b] = await Promise.all([post('same-key-1234', { qty: 7 }), post('same-key-1234', { qty: 7 })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    expect([a.headers['idempotent-replayed'], b.headers['idempotent-replayed']].filter(Boolean)).toEqual(['true']);
    expect(await count()).toBe(1);
    const other = await post('same-key-1234', { qty: 9 }, OTHER); // người khác, cùng chuỗi khóa, khác thân
    expect(other.status).toBe(201);
    expect(other.body.qty).toBe(9);
    expect(await count()).toBe(2);
  });

  it('PRJ-TC-20261006-110200109: SB-40, T27: hai người dùng cùng Idempotency-Key và cùng scope không thấy phản hồi của nhau; mỗi người phát lại đúng bản của mình', async () => {
    const a1 = await post('shared-key-0001', { qty: 11 }, CUST);
    const b1 = await post('shared-key-0001', { qty: 22 }, OTHER);
    expect([a1.status, b1.status]).toEqual([201, 201]);
    expect(a1.body.qty).toBe(11);
    expect(b1.body.qty).toBe(22);
    expect(a1.body.id).not.toBe(b1.body.id);
    for (let i = 0; i < 3; i++) { // phát lại xen kẽ: mỗi người luôn nhận bản của chính mình, không bao giờ 422 vì hash của người kia
      const a2 = await post('shared-key-0001', { qty: 11 }, CUST);
      const b2 = await post('shared-key-0001', { qty: 22 }, OTHER);
      expect([a2.status, a2.body, a2.headers['idempotent-replayed']]).toEqual([201, a1.body, 'true']);
      expect([b2.status, b2.body, b2.headers['idempotent-replayed']]).toEqual([201, b1.body, 'true']);
    }
    // nội dung của người này gửi dưới khóa của người kia không mượn được phản hồi: B gửi thân của A thì 422 (khóa của B gắn với thân của B)
    expect((await post('shared-key-0001', { qty: 11 }, OTHER)).status).toBe(422);
    expect(await count()).toBe(2);
  });
});

describe('zod bắt buộc cho mọi route', () => {
  it('schema thân sai kiểu trả validation-failed không lặp giá trị', async () => {
    const t = await createTestApp({ controllers: [FixtureController] });
    try {
      const r = await request(t.app.getHttpServer()).post('/api/v1/fx/items').set('x-test-user', CUST).send({ name: 12345 });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain('12345');
      expect(z.string().safeParse('x').success).toBe(true);
    } finally { await t.close(); }
  });
});

describe('Thứ tự kiểm của nền và CSRF khi không có cookie (PRJ-REQ-20261006-095422650 BR5, BR6)', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({ controllers: [FixtureController], env: { RATE_LIMIT_PER_MINUTE: '100000' } }); });
  afterAll(() => t.close());
  const http = () => request(t.app.getHttpServer());

  it('PRJ-TC-20261006-100124603: CSRF không cookie, Origin lạ bị 403 csrf_failed (đăng nhập CSRF), Origin hợp lệ và không Origin qua', async () => {
    const post = (origin?: string) => {
      const r = http().post('/api/v1/fx/state').set('x-test-user', CUST);
      return (origin ? r.set('Origin', origin) : r).send({ name: 'x' });
    };
    const evil = await post('https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.body.type).toBe('urn:ecom:error:csrf_failed');
    expect((await post()).status).toBe(201); // không cookie, không Origin (máy gọi máy): không có gì để CSRF
    expect((await post(ORIGIN)).status).toBe(201);
  });

  it('PRJ-TC-20261006-180338418: thứ tự kiểm của nền, 415 rồi 429 rồi CSRF 403 rồi 401 rồi role 403 rồi schema 400', async () => {
    await t.app.get(PrismaService).$executeRaw`TRUNCATE rate_limit_counters`;
    const nextWindow = () => t.clock.advance(61_000);
    const post = (o: { user?: string; origin?: string; body?: unknown; text?: boolean } = {}) => {
      let r = http().post('/api/v1/fx/ordered');
      if (o.user) r = r.set('x-test-user', o.user);
      if (o.origin) r = r.set('Origin', o.origin);
      return o.text ? r.set('Content-Type', 'text/plain').send('name=x') : r.send(o.body ?? { name: 'x' });
    };
    // 415 trước giới hạn tần suất: ba lần liên tiếp vẫn 415, không lần nào bị 429 và không tiêu tốn lượt đếm
    for (let i = 0; i < 3; i++) expect([i, (await post({ origin: 'https://evil.example', text: true })).status]).toEqual([i, 415]);
    // CSRF trước xác thực: không phiên, Origin lạ là 403 chứ không phải 401; lần hai cùng cửa sổ là 429 dù Origin lạ và không phiên (429 trước CSRF)
    const csrf = await post({ origin: 'https://evil.example' });
    expect(csrf.status).toBe(403);
    expect(csrf.body.type).toBe('urn:ecom:error:csrf_failed');
    const limited = await post({ origin: 'https://evil.example' });
    expect(limited.status).toBe(429);
    expect(limited.body.type).toBe('urn:ecom:error:rate-limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    // xác thực, role, schema, thành công: mỗi lần ở một cửa sổ mới
    const steps: [string, Parameters<typeof post>[0], number, string?][] = [
      ['không phiên', { origin: ORIGIN }, 401, 'unauthenticated'],
      ['customer gọi endpoint admin', { user: CUST, origin: ORIGIN }, 403, 'forbidden'],
      ['admin, trường lạ', { user: ADMIN, origin: ORIGIN, body: { name: 'x', extra: 1 } }, 400, 'validation-failed'],
      ['admin, body đúng', { user: ADMIN, origin: ORIGIN }, 201],
    ];
    for (const [label, o, status, code] of steps) {
      nextWindow();
      const r = await post(o);
      expect([label, r.status]).toEqual([label, status]);
      if (code) expect([label, r.body.type]).toEqual([label, `urn:ecom:error:${code}`]);
    }
  });
});
