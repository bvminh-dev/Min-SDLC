import request from 'supertest';
import { DomainError, TransactionService, PrismaService } from '../../src/modules/platform';
import { AppLogger } from '../../src/modules/platform';
import { FixtureController } from '../support/fixtures';
import { LogCapture, createTestApp, testConfig } from '../support/app';
import { bootApp, freePort } from '../support/boot';
import { DB_BASE, newPrisma, testDbUrl } from '../support/db';
import { DbProxy } from '../support/proxy';

const CUST = '11111111-1111-4111-8111-111111111111:customer';

function makeTx(retries = '3') {
  const config = testConfig({ DB_TRANSACTION_RETRIES: retries });
  const prisma = new PrismaService(config);
  const logs = new LogCapture();
  const tx = new TransactionService(prisma, config, AppLogger.create({ level: 'info', env: 'dev', destination: logs }));
  return { prisma, tx, logs };
}

describe('Giao dịch (PRJ-REQ-20261006-095422563 BR5)', () => {
  const p = newPrisma();
  beforeAll(async () => {
    await p.$executeRaw`DROP TABLE IF EXISTS tx_a, tx_b, tx_lock`;
    await p.$executeRaw`CREATE TABLE tx_a (id serial PRIMARY KEY, v text)`;
    await p.$executeRaw`CREATE TABLE tx_b (id serial PRIMARY KEY, v int CHECK (v > 0))`;
    await p.$executeRaw`CREATE TABLE tx_lock (id int PRIMARY KEY, n int)`;
    await p.$executeRaw`INSERT INTO tx_lock VALUES (1, 0), (2, 0)`;
  });
  afterAll(() => p.$disconnect());
  beforeEach(async () => { await p.$executeRaw`TRUNCATE tx_a, tx_b`; });

  it('PRJ-TC-20261006-100124253: giao dịch hai bảng rollback khi dòng thứ hai vi phạm ràng buộc, bảng A không đổi', async () => {
    const { prisma, tx } = makeTx();
    try {
      await prisma.$executeRaw`INSERT INTO tx_a (v) VALUES ('đã có từ trước')`;
      await expect(tx.run(async (t) => {
        await t.$executeRaw`INSERT INTO tx_a (v) VALUES ('đổi trạng thái đơn')`;
        await t.$executeRaw`INSERT INTO tx_b (v) VALUES (-1)`; // vi phạm CHECK
      })).rejects.toBeDefined();
      const a = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM tx_a`;
      const b = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM tx_b`;
      expect(Number(a[0].n)).toBe(1); // bằng số dòng ban đầu
      expect(Number(b[0].n)).toBe(0);
    } finally { await prisma.$disconnect(); }
  });

  it('PRJ-TC-20261006-100124391: deadlock thật được thử lại và cả hai thành công; ca luôn lỗi 40P01 chạy đúng 4 lần rồi ném internal-error, dữ liệu không nửa chừng', async () => {
    const { prisma, tx, logs } = makeTx();
    try {
      // Deadlock thật: hai giao dịch khóa hai dòng theo thứ tự ngược nhau.
      let ready = 0;
      const bothLocked = new Promise<void>((res) => { const t = setInterval(() => { if (ready >= 2) { clearInterval(t); res(); } }, 5); });
      const runs = { a: 0, b: 0 };
      const worker = (name: 'a' | 'b', first: number, second: number) => tx.run(async (t) => {
        runs[name]++;
        await t.$queryRaw`SELECT n FROM tx_lock WHERE id = ${first} FOR UPDATE`;
        if (runs[name] === 1) { ready++; await bothLocked; }
        await t.$queryRaw`SELECT n FROM tx_lock WHERE id = ${second} FOR UPDATE`;
        await t.$executeRaw`UPDATE tx_lock SET n = n + 1 WHERE id IN (1, 2)`;
        return name;
      });
      const res = await Promise.all([worker('a', 1, 2), worker('b', 2, 1)]);
      expect(res.sort()).toEqual(['a', 'b']);
      expect(runs.a + runs.b).toBeGreaterThanOrEqual(3); // ít nhất một bên bị hủy và thử lại
      expect(logs.records.some((l) => l.level === 'warn' && String(l.msg).includes('40P01'))).toBe(true);
      const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT n FROM tx_lock ORDER BY id`;
      expect(rows.map((r) => r.n)).toEqual([2, 2]);

      // Ca luôn lỗi: đúng 4 lần chạy (1 + 3 thử lại), rollback, lỗi miền internal-error.
      let calls = 0;
      const err = await tx.run(async (t) => {
        calls++;
        await t.$executeRaw`INSERT INTO tx_a (v) VALUES ('nửa chừng')`;
        throw Object.assign(new Error('deadlock detected'), { code: 'P2034' });
      }).catch((e) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('internal-error');
      expect(calls).toBe(4);
      const a = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM tx_a`;
      expect(Number(a[0].n)).toBe(0);
    } finally { await prisma.$disconnect(); }
  }, 30_000);
});

describe('statement_timeout (SB-31, PRJ-DB mục 9)', () => {
  it('câu lệnh treo quá hạn bị CSDL hủy, không giữ pool', async () => {
    const prisma = new PrismaService(testConfig({ DB_STATEMENT_TIMEOUT_MS: '500' }));
    try {
      const t0 = Date.now();
      await expect(prisma.$queryRaw`SELECT pg_sleep(5)`).rejects.toBeDefined();
      expect(Date.now() - t0).toBeLessThan(3000);
      expect((await prisma.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`)[0].statement_timeout).toBe('500ms');
    } finally { await prisma.$disconnect(); }
  });
});

describe('Mất CSDL (PRJ-REQ-20261006-095422563 BR8)', () => {
  const proxy = new DbProxy();
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const http = () => request(t.app.getHttpServer());
  const LEAK = /127\.0\.0\.1|ecom:ecom|postgresql|localhost|Prisma|ECONN/i;
  beforeAll(async () => {
    await proxy.start();
    const url = `postgresql://ecom:ecom@127.0.0.1:${proxy.port}/ecom_test`;
    t = await createTestApp({ controllers: [FixtureController], env: { DATABASE_URL: url, RATE_LIMIT_PER_MINUTE: '1000' } });
  });
  afterAll(() => t.close().catch(() => undefined));

  it('PRJ-TC-20261006-100124322: mất CSDL khi đang chạy, readiness 503 và endpoint cần CSDL trả 503 problem+json, tiến trình vẫn sống, liveness 200', async () => {
    expect((await http().get('/api/v1/health/ready')).status).toBe(200); // đang tốt
    await proxy.stop(); // CSDL bị ngắt
    const ready = await http().get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.headers['content-type']).toMatch(/^application\/problem\+json/);
    const db = await http().get('/api/v1/fx/limited-b').set('x-test-user', CUST); // bậc B đếm trong PostgreSQL
    expect(db.status).toBe(503);
    expect(db.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(db.body.type).toBe('urn:ecom:error:service-unavailable');
    expect((await http().get('/api/v1/health')).status).toBe(200);
    expect(t.logs.records.some((l) => l.level === 'error' && l.msg === 'request thất bại')).toBe(true);
  }, 60_000);

  it('PRJ-TC-20261006-100124791: readiness 503 khi CSDL mất, liveness vẫn 200, thân không lộ chuỗi kết nối hay lỗi CSDL', async () => {
    const ready = await http().get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.type).toBe('urn:ecom:error:service-unavailable');
    expect(ready.text).not.toMatch(LEAK);
    expect((await http().get('/api/v1/health')).body).toEqual({ status: 'ok' });
  }, 30_000);

  it('PRJ-TC-20261006-100125137: CSDL không kết nối trả 503 service-unavailable, thân không chứa chuỗi kết nối hay tên máy', async () => {
    const r = await http().get('/api/v1/fx/limited-b').set('x-test-user', CUST);
    expect(r.status).toBe(503);
    expect(r.body.type).toBe('urn:ecom:error:service-unavailable');
    expect(r.text).not.toMatch(LEAK);
  }, 30_000);

  it('PRJ-TC-20261006-100124299: khởi động khi CSDL không kết nối được thử lại có giới hạn rồi thoát mã khác 0, không lộ mật khẩu hay chuỗi kết nối', async () => {
    const port = await freePort(); // không ai lắng nghe
    const url = `postgresql://ecom:s3cr3t@127.0.0.1:${port}/ecom_none`;
    const t0 = Date.now();
    const b = bootApp({ APP_ENV: 'dev', DATABASE_URL: url, CORS_ALLOWED_ORIGINS: 'http://localhost:3801', DB_CONNECT_RETRY_SECONDS: '3', PORT: String(await freePort()) });
    const code = await b.exited;
    const secs = (Date.now() - t0) / 1000;
    expect(code).not.toBe(0);
    expect(secs).toBeGreaterThanOrEqual(3); // đã thử lại tới hạn
    expect(secs).toBeLessThan(40);
    const all = b.stdout() + b.stderr();
    expect(all).toContain('thử lại');
    expect(all).not.toContain('s3cr3t');
    expect(all).not.toContain(url);
    expect(all).not.toContain(String(port));
  }, 60_000);

  it('nền: DB_BASE trỏ tới PostgreSQL thật của docker compose', () => {
    expect(DB_BASE).toMatch(/^postgresql:\/\//);
    expect(testDbUrl()).toContain('ecom_test');
  });
});
