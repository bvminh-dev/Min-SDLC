import request from 'supertest';
import { PrismaService, RateLimitService } from '../../src/modules/platform';
import { FixtureController } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/app';

const CUST = '11111111-1111-4111-8111-111111111111:customer';
const OTHER = '22222222-2222-4222-8222-222222222222:customer';
const THIRD = '44444444-4444-4444-8444-444444444444:customer';
const ADMIN = '33333333-3333-4333-8333-333333333333:admin';

describe('Giới hạn tần suất: bậc A, bậc D, khóa tùy chỉnh (PRJ-REQ-20261006-095422650 BR7)', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({ controllers: [FixtureController] }); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.app.get(PrismaService).$executeRaw`TRUNCATE rate_limit_counters`; });
  const get = (app: TestApp, path: string, user?: string) => {
    const r = request(app.app.getHttpServer()).get(path);
    return user ? r.set('x-test-user', user) : r;
  };

  it('PRJ-TC-20261006-160720924: bậc A chặn đúng ở lần thứ 4, tách theo người dùng và theo IP, hết cửa sổ thì qua lại', async () => {
    for (let i = 1; i <= 3; i++) expect([i, (await get(t, '/api/v1/fx/limited-a', CUST)).status]).toEqual([i, 200]); // lần 1..3 qua (không chặn sớm)
    const over = await get(t, '/api/v1/fx/limited-a', CUST);
    expect(over.status).toBe(429);
    expect(over.body.type).toBe('urn:ecom:error:rate-limited');
    const retry = Number(over.headers['retry-after']);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect((await get(t, '/api/v1/fx/limited-a', OTHER)).status).toBe(200); // người dùng khác đếm riêng
    for (let i = 0; i < 3; i++) expect((await get(t, '/api/v1/fx/limited-a')).status).toBe(200); // guest: theo IP
    expect((await get(t, '/api/v1/fx/limited-a')).status).toBe(429);
    t.clock.advance(61_000);
    expect((await get(t, '/api/v1/fx/limited-a', CUST)).status).toBe(200);
  });

  // review USR (đột biến lọt): "mọi route không khai group chung một bộ đếm" làm xanh toàn bộ test trước đó
  it('review USR (PRJ-TC-20261006-160720924): cùng group chung một bộ đếm theo người dùng; route không khai group có bộ đếm riêng', async () => {
    expect((await get(t, '/api/v1/fx/limited-g1', CUST)).status).toBe(200);
    expect((await get(t, '/api/v1/fx/limited-g2', CUST)).status).toBe(200);
    expect((await get(t, '/api/v1/fx/limited-g1', CUST)).status).toBe(200);
    expect((await get(t, '/api/v1/fx/limited-g2', CUST)).status).toBe(429); // lần thứ 4 của cả nhóm
    expect((await get(t, '/api/v1/fx/limited-g1', OTHER)).status).toBe(200); // người khác đếm riêng
    for (let i = 0; i < 3; i++) expect([i, (await get(t, '/api/v1/fx/limited-h', CUST)).status]).toEqual([i, 200]); // không bị nhóm hay route khác ăn mất lượt
    expect((await get(t, '/api/v1/fx/limited-h', CUST)).status).toBe(429);
    for (let i = 0; i < 5; i++) expect([i, (await get(t, '/api/v1/fx/limited-b', CUST)).status]).toEqual([i, 200]); // route khác cùng bậc: bộ đếm riêng
  });

  it('PRJ-TC-20261006-160721024: bậc D với cửa sổ 10 giây đếm chung giữa hai instance và sang cửa sổ mới sau 11 giây', async () => {
    const b = await createTestApp({ controllers: [FixtureController] });
    b.clock.set(t.clock.now()); // cùng cửa sổ
    try {
      expect((await get(t, '/api/v1/fx/limited-d', ADMIN)).status).toBe(200);
      expect((await get(b, '/api/v1/fx/limited-d', ADMIN)).status).toBe(200);
      const over = await get(b, '/api/v1/fx/limited-d', ADMIN);
      expect(over.status).toBe(429);
      expect(over.body.type).toBe('urn:ecom:error:rate-limited');
      expect(Number(over.headers['retry-after'])).toBeLessThanOrEqual(10); // cửa sổ do endpoint khai, không phải 60
      expect((await get(t, '/api/v1/fx/limited-d', ADMIN)).status).toBe(429); // instance 1 cũng thấy
      t.clock.advance(11_000);
      b.clock.advance(11_000);
      expect((await get(t, '/api/v1/fx/limited-d', ADMIN)).status).toBe(200);
    } finally { await b.close(); }
  });

  it('PRJ-TC-20261006-160721116: khóa tùy chỉnh `key` đếm chung cho cùng khóa dù khác người dùng, tách khi khác khóa', async () => {
    expect((await get(t, '/api/v1/fx/limited-key?account=a', CUST)).status).toBe(200);
    expect((await get(t, '/api/v1/fx/limited-key?account=a', OTHER)).status).toBe(200);
    const over = await get(t, '/api/v1/fx/limited-key?account=a', THIRD);
    expect(over.status).toBe(429);
    expect(over.body.type).toBe('urn:ecom:error:rate-limited');
    expect((await get(t, '/api/v1/fx/limited-key?account=b', CUST)).status).toBe(200); // khóa khác, đếm riêng
    expect((await get(t, '/api/v1/fx/limited-a', CUST)).status).toBe(200); // route khác, không đếm chung
  });
});

describe('RateLimitService.check, hitCounter, reset (PRJ-API: Giao tiếp giữa module)', () => {
  let t: TestApp;
  let svc: RateLimitService;
  beforeAll(async () => { t = await createTestApp({ controllers: [FixtureController] }); svc = t.app.get(RateLimitService); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.app.get(PrismaService).$executeRaw`TRUNCATE rate_limit_counters`; });
  const get = (path: string, user: string) => request(t.app.getHttpServer()).get(path).set('x-test-user', user);
  const rows = (key: string) => t.app.get(PrismaService).$queryRaw<{ count: number }[]>`SELECT count FROM rate_limit_counters WHERE bucket = ${`ctr:${key}`}`;

  it('PRJ-TC-20261006-160721210: check không tăng, hitCounter tăng và trả số mới, reset xóa', async () => {
    const key = 'login:fail:a@x';
    expect(await svc.check(key, 3, 60)).toMatchObject({ allowed: true });
    expect(await rows(key)).toEqual([]); // check không tạo bộ đếm
    expect(await svc.hitCounter(key, 60)).toBe(1);
    expect(await svc.hitCounter(key, 60)).toBe(2);
    expect(await svc.check(key, 3, 60)).toMatchObject({ allowed: true }); // 2 < 3
    expect(await svc.hitCounter(key, 60)).toBe(3);
    const full = await svc.check(key, 3, 60);
    expect(full.allowed).toBe(false); // 3 >= 3
    expect(Number.isInteger(full.retryAfter)).toBe(true);
    expect(full.retryAfter).toBeGreaterThanOrEqual(1);
    expect(full.retryAfter).toBeLessThanOrEqual(60);
    for (let i = 0; i < 5; i++) await svc.check(key, 3, 60);
    expect((await rows(key))[0].count).toBe(3); // check lặp lại không đổi số đếm
    expect(await svc.hitCounter(key, 60)).toBe(4);
    await svc.reset(key);
    expect(await svc.check(key, 3, 60)).toMatchObject({ allowed: true });
    expect(await svc.hitCounter(key, 60)).toBe(1);
  });

  it('PRJ-TC-20261006-160721307: ngưỡng 0, cửa sổ mới, khóa độc lập, reset khi chưa có, không đụng khóa của @RateLimit', async () => {
    expect((await svc.check('zero', 0, 60)).allowed).toBe(false); // chưa đếm lần nào vẫn chặn
    await svc.hitCounter('k1', 60);
    await svc.hitCounter('k2', 60);
    await svc.reset('k2');
    expect((await rows('k1'))[0].count).toBe(1); // reset k2 không xóa k1
    expect(await rows('k2')).toEqual([]);
    await expect(svc.reset('chua-tung-dem')).resolves.toBeUndefined();
    t.clock.advance(61_000);
    expect((await svc.check('k1', 1, 60)).allowed).toBe(true); // sang cửa sổ mới, bộ đếm về 0
    expect(await svc.hitCounter('k1', 60)).toBe(1);
    // khóa trùng chuỗi với bucket của @RateLimit không va chạm (tiền tố `ctr:`)
    expect((await get('/api/v1/fx/limited-a', CUST)).status).toBe(200);
    expect(await svc.hitCounter('A:/fx/limited-a:u:11111111-1111-4111-8111-111111111111', 60)).toBe(1);
    expect((await get('/api/v1/fx/limited-a', CUST)).status).toBe(200);
    expect((await get('/api/v1/fx/limited-a', CUST)).status).toBe(200);
    expect((await get('/api/v1/fx/limited-a', CUST)).status).toBe(429); // đúng 3 lần của @RateLimit, hitCounter không cộng thêm
  });

});
