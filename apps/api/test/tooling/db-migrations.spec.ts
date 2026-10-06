import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import { createTestApp } from '../support/app';
import { API_DIR, PRISMA_BIN, adminQuery, migrateDeploy, migrateDeployAsync, testDbUrl, withTempDb } from '../support/db';
import { run } from '../support/sh';

/** Bản sao tạm của thư mục prisma/ để thử migration mà không đụng repo. */
function copyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ecom-prisma-'));
  cpSync(join(API_DIR, 'prisma'), join(dir, 'prisma'), { recursive: true });
  cpSync(join(API_DIR, 'prisma.config.ts'), join(dir, 'prisma.config.ts'));
  symlinkSync(join(API_DIR, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}
const migrationsCount = () => readdirSync(join(API_DIR, 'prisma/migrations')).filter((n) => /^\d/.test(n)).length;
async function q<T = any>(url: string, sql: string): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(sql)).rows; } finally { await c.end(); }
}

describe('Migration (PRJ-REQ-20261006-095422563 BR3, BR4)', () => {
  it('PRJ-TC-20261006-100124230: áp toàn bộ migration trên CSDL trống, đủ dòng _prisma_migrations không dòng lỗi, mọi bảng của platform tồn tại', async () => {
    await withTempDb(async (url) => {
      const r = migrateDeploy(url);
      expect(r.status).toBe(0);
      const rows = await q(url, 'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name');
      expect(rows).toHaveLength(migrationsCount());
      expect(rows.every((m) => m.finished_at && !m.rolled_back_at)).toBe(true);
      const tables = (await q(url, `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map((t) => t.tablename);
      expect(tables).toEqual(expect.arrayContaining(['audit_logs', 'outbox_events', 'processed_events', 'idempotency_keys', 'rate_limit_counters']));
      expect((await q(url, `SELECT relpersistence FROM pg_class WHERE relname = 'rate_limit_counters'`))[0].relpersistence).toBe('u'); // UNLOGGED
    });
  }, 60_000);

  it('PRJ-TC-20261006-100124276: migration lỗi giữa chừng rollback toàn bộ, lệnh thoát mã khác 0, bản cũ vẫn trả readiness 200', async () => {
    await withTempDb(async (url) => {
      expect(migrateDeploy(url).status).toBe(0); // CSDL đã ở phiên bản trước
      const dir = copyProject();
      const bad = join(dir, 'prisma/migrations/20269999000000_broken');
      mkdirSync(bad);
      writeFileSync(join(bad, 'migration.sql'), 'CREATE TABLE half_table (id int);\nSELEKT nonsense FROM nowhere;\n');
      const r = migrateDeploy(url, dir);
      expect(r.status).not.toBe(0);
      expect((await q(url, `SELECT 1 FROM pg_tables WHERE tablename = 'half_table'`))).toHaveLength(0); // không bảng nửa vời
      expect((await q(url, `SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'audit_logs'`))[0].n).toBe(1);
      const t = await createTestApp({ env: { DATABASE_URL: url } }); // "bản cũ" vẫn phục vụ
      try { expect((await request(t.app.getHttpServer()).get('/api/v1/health/ready')).status).toBe(200); } finally { await t.close(); }
    });
  }, 90_000);

  it('PRJ-TC-20261006-100124369: hai instance cùng áp migration, mỗi migration ghi đúng một lần, một bên chờ rồi thoát mã 0, không lỗi trùng khóa', async () => {
    await withTempDb(async (url) => {
      const go = () => new Promise<{ code: number | null; out: string }>((res) => {
        const c = spawn(PRISMA_BIN, ['migrate', 'deploy'], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: url } });
        let out = '';
        c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
        c.on('exit', (code) => res({ code, out }));
      });
      const [a, b] = await Promise.all([go(), go()]);
      expect([a.code, b.code]).toEqual([0, 0]);
      expect(`${a.out}${b.out}`).not.toMatch(/duplicate key|already exists/i);
      const rows = await q(url, 'SELECT migration_name, count(*)::int AS n FROM _prisma_migrations GROUP BY migration_name');
      expect(rows).toHaveLength(migrationsCount());
      expect(rows.every((r) => r.n === 1)).toBe(true);
    });
  }, 90_000);

  it('PRJ-TC-20261006-100124438: quên tạo migration thì kiểm lệch schema thoát mã khác 0; thêm migration thì thoát mã 0', async () => {
    await withTempDb(async (shadow) => {
      const dir = copyProject();
      const env = { ...process.env, SHADOW_DATABASE_URL: shadow, DATABASE_URL: shadow };
      const check = () => run(process.execPath, [join(API_DIR, 'scripts/check-migrations.mjs')], { cwd: dir, env });
      expect(check().status).toBe(0); // đang khớp
      const schema = join(dir, 'prisma/schema/platform.prisma');
      writeFileSync(schema, readFileSync(schema, 'utf8').replace('  reason        String?\n', '  reason        String?\n  note          String?\n'));
      const drift = check();
      expect(drift.status).toBe(2);
      expect(drift.stderr).toMatch(/lệch/);
      expect(drift.stderr).toContain('note');
      const m = join(dir, 'prisma/migrations/20269999000001_audit_note');
      mkdirSync(m);
      writeFileSync(join(m, 'migration.sql'), 'ALTER TABLE "audit_logs" ADD COLUMN "note" TEXT;\n');
      expect(check().status).toBe(0);
    });
  }, 90_000);

  it('PRJ-TC-20261006-120200106: migration mở rộng tương thích ngược với bản cũ; migration xóa cột đang dùng bị CI từ chối và yêu cầu tách hai bước', async () => {
    await withTempDb(async (url) => {
      const dir = copyProject();
      const m1 = join(dir, 'prisma/migrations/20269999000010_notes');
      mkdirSync(m1);
      writeFileSync(join(m1, 'migration.sql'), 'CREATE TABLE "notes" ("id" SERIAL PRIMARY KEY, "body" TEXT NOT NULL);\n');
      expect(migrateDeploy(url, dir).status).toBe(0); // bản N-1
      const oldAppSmoke = async (c: Client) => { await c.query(`INSERT INTO notes (body) VALUES ('x')`); return (await c.query('SELECT body FROM notes LIMIT 1')).rows[0].body; };
      const app = new Client({ connectionString: url });
      await app.connect();
      try {
        expect(await oldAppSmoke(app)).toBe('x');
        // bản N chỉ thêm cột cho phép NULL, trong lúc bản N-1 vẫn ghi liên tục
        const m2 = join(dir, 'prisma/migrations/20269999000011_notes_note');
        mkdirSync(m2);
        writeFileSync(join(m2, 'migration.sql'), 'ALTER TABLE "notes" ADD COLUMN "note" TEXT;\n');
        let stop = false, maxMs = 0, errors = 0, writes = 0;
        const writer = (async () => {
          while (!stop) {
            const t = Date.now();
            try { await app.query(`INSERT INTO notes (body) VALUES ('live')`); writes++; } catch { errors++; }
            maxMs = Math.max(maxMs, Date.now() - t);
            await new Promise((r) => setTimeout(r, 15));
          }
        })();
        const t0 = Date.now();
        expect((await migrateDeployAsync(url, dir)).status).toBe(0);
        const deployMs = Date.now() - t0;
        stop = true; await writer;
        expect(errors).toBe(0);
        expect(maxMs).toBeLessThan(1000); // không khóa bảng quá 1 giây
        expect(writes).toBeGreaterThan(5);
        expect(deployMs).toBeLessThan(60_000);
        expect(await oldAppSmoke(app)).toBe('x'); // smoke của bản cũ trên CSDL đã migrate
      } finally { await app.end(); }

      // CI tương thích ngược
      const compat = (sql: string) => {
        const f = join(dir, `c-${Math.random()}.sql`);
        writeFileSync(f, sql);
        return run(process.execPath, [join(API_DIR, 'scripts/check-migration-compat.mjs'), '--files', f]);
      };
      expect(compat('ALTER TABLE "notes" ADD COLUMN "note" TEXT;\n').status).toBe(0);
      const drop = compat('ALTER TABLE "notes" DROP COLUMN "body";\n');
      expect(drop.status).toBe(1);
      expect(drop.stderr).toMatch(/DROP COLUMN.*hai bước/);
      expect(compat('ALTER TABLE "notes" ADD COLUMN "x" INT NOT NULL;\n').status).toBe(1); // bản cũ INSERT sẽ lỗi
      expect(compat('ALTER TABLE "notes" ADD COLUMN "x" INT NOT NULL DEFAULT 0;\n').status).toBe(0);
      expect(compat('-- contract-step: 20269999000011_notes_note\nALTER TABLE "notes" DROP COLUMN "body";\n').status).toBe(0); // bước thu hẹp có chủ đích
    });
    expect(existsSync(join(API_DIR, 'prisma/migrations'))).toBe(true);
    void adminQuery; void testDbUrl;
  }, 120_000);
});
