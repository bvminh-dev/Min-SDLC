import { spawnSync } from 'node:child_process';
import { runSeed } from '../../src/seed';
import { API_DIR, newPrisma, testDbUrl } from '../support/db';

describe('Seed (PRJ-REQ-20261006-095422563 BR9)', () => {
  it('PRJ-TC-20261006-100124346: seed bị từ chối ở prod và staging (thoát mã khác 0, không ghi gì), ở dev chạy được', async () => {
    const p = newPrisma();
    const count = async () => Number((await p.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM audit_logs) + (SELECT count(*) FROM outbox_events) + (SELECT count(*) FROM idempotency_keys) AS n`)[0].n);
    try {
      const before = await count();
      let ran = 0;
      const seeder = async () => { ran++; };
      for (const appEnv of ['prod', 'staging']) {
        expect(await runSeed({ APP_ENV: appEnv, DATABASE_URL: testDbUrl() }, [seeder])).toBe(1);
        const r = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/seed.ts'], {
          cwd: API_DIR, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', APP_ENV: appEnv, DATABASE_URL: testDbUrl() },
        });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('seed bị từ chối');
      }
      expect(ran).toBe(0);
      expect(await count()).toBe(before);
      // đối chứng: dev chạy được
      expect(await runSeed({ APP_ENV: 'dev', DATABASE_URL: testDbUrl() }, [seeder])).toBe(0);
      expect(ran).toBe(1);
      const dev = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/seed.ts'], {
        cwd: API_DIR, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl() },
      });
      expect(dev.status).toBe(0);
    } finally { await p.$disconnect(); }
  }, 60_000);
});
