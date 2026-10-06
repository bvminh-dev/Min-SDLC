import { Client } from 'pg';
import request from 'supertest';
import { AppLogger, AuditService, PrismaService, RetentionService, TransactionService, runWithCorrelation } from '../../src/modules/platform';
import { FixtureController } from '../support/fixtures';
import { FakeClock, LogCapture, createTestApp, testConfig } from '../support/app';
import { newPrisma, roleDbUrl, testDbUrl, truncateAll } from '../support/db';

const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';

function stack(now?: Date, env: Record<string, string> = {}) {
  const config = testConfig(env);
  const prisma = new PrismaService(config);
  const logs = new LogCapture();
  const logger = AppLogger.create({ level: 'info', env: 'dev', destination: logs });
  const clock = new FakeClock(now);
  const transactions = new TransactionService(prisma, config, logger);
  const audit = new AuditService(prisma, clock, logger);
  const retention = new RetentionService(prisma, clock, config, logger);
  return { config, prisma, logs, clock, transactions, audit, retention };
}
const rows = <T = Record<string, any>>(p: PrismaService, q: TemplateStringsArray) => p.$queryRaw<T[]>(q);

describe('Audit log (PRJ-REQ-20261006-095422908)', () => {
  const s = stack();
  beforeAll(async () => { await s.prisma.$executeRaw`CREATE TABLE IF NOT EXISTS test_orders (id int PRIMARY KEY, status text NOT NULL)`; });
  afterAll(() => s.prisma.$disconnect());
  beforeEach(async () => {
    await truncateAll(s.prisma);
    await s.prisma.$executeRaw`TRUNCATE test_orders`;
    await s.prisma.$executeRaw`INSERT INTO test_orders VALUES (1, 'paid')`;
    s.logs.clear();
  });

  it('PRJ-TC-20261006-100125327: audit khi admin hủy đơn nằm cùng giao dịch với việc đổi trạng thái, đúng một bản ghi đủ trường', async () => {
    const t = await createTestApp({ controllers: [FixtureController] });
    try {
      const r = await request(t.app.getHttpServer()).post('/api/v1/fx/cancel').set('x-test-user', `${ADMIN_ID}:admin`).send({ id: 1, reason: 'khách đổi ý' });
      expect(r.status).toBe(201);
      const a = await rows(s.prisma, Prisma_`SELECT * FROM audit_logs`);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ actor_id: ADMIN_ID, actor_role: 'admin', action: 'order.cancel', target_type: 'order', target_id: '1', correlation_id: r.headers['x-request-id'], reason: 'khách đổi ý' });
      expect(a[0].before).toEqual({ status: 'paid' });
      expect(a[0].after).toEqual({ status: 'cancelled' });
      expect((await rows(s.prisma, Prisma_`SELECT status FROM test_orders`))[0].status).toBe('cancelled');
    } finally { await t.close(); }
    // cùng giao dịch: thao tác sau audit lỗi thì audit cũng không còn
    await expect(s.transactions.run(async (tx) => {
      await s.audit.record(tx, { actor_id: ADMIN_ID, actor_role: 'admin', action: 'x', target_type: 'order', target_id: '9' });
      throw new Error('hỏng sau audit');
    })).rejects.toThrow();
    expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs WHERE target_id = '9'`)).toHaveLength(0);
  });

  it('PRJ-TC-20261006-100125373: audit lỗi làm thao tác rollback, đơn giữ nguyên trạng thái, client nhận lỗi chuẩn, log có dòng error', async () => {
    const t = await createTestApp({ controllers: [FixtureController] });
    try {
      const r = await request(t.app.getHttpServer()).post('/api/v1/fx/cancel').set('x-test-user', `${ADMIN_ID}:admin`).send({ id: 1, reason: 'x'.repeat(501) }); // vi phạm CHECK reason <= 500
      expect(r.status).toBe(500);
      expect(r.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(r.body.type).toBe('urn:ecom:error:internal-error');
      expect((await rows(s.prisma, Prisma_`SELECT status FROM test_orders`))[0].status).toBe('paid');
      expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs`)).toHaveLength(0);
      expect(t.logs.records.some((l) => l.level === 'error')).toBe(true);
    } finally { await t.close(); }
  });

  it('PRJ-TC-20261006-100125420: tài khoản ứng dụng (ecom_app) chỉ INSERT và SELECT audit; UPDATE, DELETE, TRUNCATE và cờ app.audit_purge đều bị từ chối', async () => {
    await s.audit.record(s.prisma, { actor_id: ADMIN_ID, actor_role: 'admin', action: 'a', target_type: 't', target_id: '1' });
    const app = new Client({ connectionString: roleDbUrl('ecom_app') });
    await app.connect();
    try {
      expect((await app.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n).toBe(1);
      await app.query(`INSERT INTO audit_logs (actor_role, action, target_type, target_id, correlation_id) VALUES ('system', 'b', 't', '2', 'c1')`);
      await expect(app.query(`UPDATE audit_logs SET action = 'sửa'`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`DELETE FROM audit_logs`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`TRUNCATE audit_logs`)).rejects.toThrow(/permission denied/);
      // đường cũ: đặt cờ rồi DELETE từ phiên bất kỳ không còn tác dụng
      await app.query(`SET app.audit_purge = 'on'`);
      await expect(app.query(`DELETE FROM audit_logs`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`SET ROLE app_retention`)).rejects.toThrow(/permission denied/); // không tự nâng vai trò
    } finally { await app.end(); }
    expect((await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs`))).toHaveLength(2);
  });

  it('SB-32: trigger chặn UPDATE, DELETE, TRUNCATE kể cả với superuser và vai trò có quyền bảng nhưng không phải app_retention; cờ app.audit_purge vô hiệu', async () => {
    await s.audit.record(s.prisma, { actor_id: ADMIN_ID, actor_role: 'admin', action: 'a', target_type: 't', target_id: '1' });
    const su = new Client({ connectionString: testDbUrl() });
    await su.connect();
    try {
      await expect(su.query(`TRUNCATE audit_logs`)).rejects.toThrow(/append-only/);
      await expect(su.query(`TRUNCATE audit_logs, outbox_events`)).rejects.toThrow(/append-only/);
      await expect(su.query(`UPDATE audit_logs SET action = 'sửa'`)).rejects.toThrow(/append-only/);
      // vai trò thường được cấp DELETE ở mức bảng vẫn bị trigger chặn, đặt cờ cũng vậy
      await su.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zz_deleter') THEN CREATE ROLE zz_deleter LOGIN PASSWORD 'zz_deleter'; END IF; END $$`);
      await su.query(`GRANT SELECT, DELETE ON audit_logs TO zz_deleter`);
      const u = new URL(testDbUrl()); u.username = 'zz_deleter'; u.password = 'zz_deleter';
      const d = new Client({ connectionString: u.toString() });
      await d.connect();
      try {
        await d.query(`SET app.audit_purge = 'on'`);
        await expect(d.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
      } finally { await d.end(); await su.query(`REVOKE ALL ON audit_logs FROM zz_deleter`); await su.query(`DROP ROLE zz_deleter`); }
    } finally { await su.end(); }
    expect((await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs`))).toHaveLength(1);
  });

  it('PRJ-DB mục 12: vai trò job dọn (ecom_retention) chỉ SELECT và DELETE audit; INSERT, UPDATE bị từ chối; UPDATE vẫn bị trigger chặn khi có quyền', async () => {
    await s.audit.record(s.prisma, { actor_id: ADMIN_ID, actor_role: 'admin', action: 'a', target_type: 't', target_id: '1' });
    const job = new Client({ connectionString: roleDbUrl('ecom_retention') });
    await job.connect();
    try {
      await expect(job.query(`INSERT INTO audit_logs (actor_role, action, target_type, target_id, correlation_id) VALUES ('system', 'b', 't', '2', 'c1')`)).rejects.toThrow(/permission denied/);
      await expect(job.query(`UPDATE audit_logs SET action = 'sửa'`)).rejects.toThrow(/permission denied/);
      await expect(job.query(`TRUNCATE audit_logs`)).rejects.toThrow(/permission denied/);
      await expect(job.query(`DELETE FROM outbox_events`)).rejects.toThrow(/permission denied/); // chỉ audit_logs
      expect((await job.query(`DELETE FROM audit_logs`)).rowCount).toBe(1);
    } finally { await job.end(); }
  });

  it('PRJ-TC-20261006-100125494: job dọn audit giữ bản 11 tháng, xóa bản 13 tháng, log ghi số đã xóa là 1', async () => {
    const now = s.clock.now();
    const mk = (months: number) => new Date(now.getTime() - months * 30.5 * 86_400_000);
    for (const [m, id] of [[13, 'old'], [11, 'new']] as const) {
      await s.prisma.$executeRaw`INSERT INTO audit_logs (actor_role, action, target_type, target_id, correlation_id, created_at) VALUES ('system', 'x', 't', ${id}, 'c', ${mk(m)}::timestamptz)`;
    }
    const counts = await s.retention.run(now);
    expect(counts.audit_logs).toBe(1);
    expect((await rows(s.prisma, Prisma_`SELECT target_id FROM audit_logs`)).map((r) => r.target_id)).toEqual(['new']);
    expect(s.logs.records.find((l) => l.msg === 'retention đã xóa' && l.table === 'audit_logs')?.deleted).toBe(1);
  });

  it('job dọn audit dùng kết nối riêng RETENTION_DATABASE_URL (ecom_retention); ứng dụng chạy bằng ecom_app mà thiếu kết nối đó thì không xóa được', async () => {
    const old = new Date(s.clock.now().getTime() - 400 * 86_400_000);
    await s.prisma.$executeRaw`INSERT INTO audit_logs (actor_role, action, target_type, target_id, correlation_id, created_at) VALUES ('system', 'x', 't', 'old', 'c', ${old}::timestamptz)`;
    const noJobRole = stack(undefined, { DATABASE_URL: roleDbUrl('ecom_app') });
    try {
      await expect(noJobRole.retention.run(s.clock.now())).rejects.toThrow(/permission denied/);
      expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs`)).toHaveLength(1);
    } finally { await noJobRole.prisma.$disconnect(); }
    const withJobRole = stack(undefined, { DATABASE_URL: roleDbUrl('ecom_app'), RETENTION_DATABASE_URL: roleDbUrl('ecom_retention') });
    try {
      expect((await withJobRole.retention.run(s.clock.now())).audit_logs).toBe(1);
      expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs`)).toHaveLength(0);
    } finally { await withJobRole.prisma.$disconnect(); }
  });

  it('PRJ-TC-20261006-110200112: audit của tác nhân hệ thống (actor_id rỗng), ba lần xem dashboard gộp một dòng mỗi phút, hai lần tra cứu khách có hai dòng', async () => {
    await s.audit.record(s.prisma, { actor_role: 'system', action: 'refund.auto', target_type: 'payment', target_id: 'p1' });
    const sys = (await rows(s.prisma, Prisma_`SELECT actor_id, actor_role FROM audit_logs`))[0];
    expect(sys).toEqual({ actor_id: null, actor_role: 'system' });
    await expect(s.audit.record(s.prisma, { actor_role: 'admin', action: 'x', target_type: 't', target_id: '1' })).rejects.toThrow(); // CHECK: người dùng phải có actor_id

    await truncateAll(s.prisma);
    for (let i = 0; i < 3; i++) { await s.audit.record(s.prisma, { actor_id: ADMIN_ID, actor_role: 'admin', action: 'dashboard.view', target_type: 'dashboard', target_id: 'main' }, { coalesce: { key: 'dashboard.view', window: 60 } }); s.clock.advance(10_000); }
    expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs WHERE action = 'dashboard.view'`)).toHaveLength(1);
    s.clock.advance(61_000); // sang phút kế tiếp: lần xem thứ tư ghi dòng mới
    await s.audit.record(s.prisma, { actor_id: ADMIN_ID, actor_role: 'admin', action: 'dashboard.view', target_type: 'dashboard', target_id: 'main' }, { coalesce: { window: 60 } });
    expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs WHERE action = 'dashboard.view'`)).toHaveLength(2);

    for (let i = 0; i < 2; i++) await s.audit.record(s.prisma, { actor_id: STAFF_ID, actor_role: 'staff', action: 'user.lookup', target_type: 'user', target_id: 'u1' });
    expect(await rows(s.prisma, Prisma_`SELECT 1 FROM audit_logs WHERE action = 'user.lookup'`)).toHaveLength(2);
  });

  it('PRJ-TC-20261006-110200113: audit không chứa dữ liệu cá nhân, before và after đi qua bộ che, thao tác vẫn thành công', async () => {
    await runWithCorrelation('corr-audit-1', () => s.audit.record(s.prisma, {
      actor_id: ADMIN_ID, actor_role: 'admin', action: 'user.update', target_type: 'user', target_id: 'u1',
      before: { email: 'a@b.c', phone: '0900000000', address: '1 Lê Lợi', password: 'pw', status: 'active', nested: { shipping_address: 'x' } },
      after: { email: 'd@e.f', phone: '0911111111', address: '2 Lê Lợi', password: 'pw2', status: 'active' },
    }));
    const [a] = await rows(s.prisma, Prisma_`SELECT before, after, correlation_id FROM audit_logs`);
    expect(a.correlation_id).toBe('corr-audit-1');
    for (const side of [a.before, a.after]) {
      expect(side.email).toBe('[REDACTED]'); expect(side.phone).toBe('[REDACTED]'); expect(side.address).toBe('[REDACTED]'); expect(side.password).toBe('[REDACTED]');
      expect(side.status).toBe('active');
    }
    expect(JSON.stringify(a)).not.toMatch(/a@b\.c|0900000000|Lê Lợi|pw2?"/);
  });
});

// thẻ gắn kiểu cho $queryRaw: giữ nguyên TemplateStringsArray
function Prisma_(strings: TemplateStringsArray): TemplateStringsArray { return strings; }
void newPrisma;
