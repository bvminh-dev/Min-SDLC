// `pnpm test` ở apps/api: chạy Jest (công cụ test duy nhất của v1, PRJ-REQ-20261006-095422475 BR7).
// Test tích hợp cần PostgreSQL thật: `docker compose up -d db` (xem README).
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, [new URL('../node_modules/jest/bin/jest.js', import.meta.url).pathname, '--config', 'jest.config.js', ...process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'))], {
  stdio: 'inherit',
  env: { ...process.env, APP_ENV: process.env.APP_ENV ?? 'dev' },
});
process.exit(r.status ?? 1);
