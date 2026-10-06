#!/usr/bin/env node
// Job smoke của CI (PRJ-TC-20261006-100124068): dựng từ .env.example, chạy `pnpm dev`, chờ health của api và trang chủ web.
// Cần PostgreSQL local theo README (docker compose up -d db). Dùng cổng ngẫu nhiên nếu API_PORT/WEB_PORT không đặt.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';

const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const apiPort = Number(process.env.API_PORT ?? (await freePort()));
const webPort = Number(process.env.WEB_PORT ?? (await freePort()));
const env = { ...process.env };
for (const l of readFileSync('.env.example', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in env)) env[m[1]] = m[2];
}
env.PORT = String(apiPort);
env.WEB_PORT = String(webPort);
env.CORS_ALLOWED_ORIGINS = `http://localhost:${webPort}`;

const t0 = Date.now();
const child = spawn('pnpm', ['dev'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* đã thoát */ } };
const poll = async (url, ok) => {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(url); if (await ok(r)) return true; } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};
try {
  const apiOk = await poll(`http://127.0.0.1:${apiPort}/api/v1/health`, async (r) => r.status === 200 && (await r.json()).status === 'ok');
  const webOk = await poll(`http://127.0.0.1:${webPort}/`, async (r) => r.status === 200);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!apiOk || !webOk) { process.stderr.write(`smoke: FAIL api=${apiOk} web=${webOk}\n${log.slice(-3000)}\n`); process.exitCode = 1; }
  else process.stdout.write(`smoke: OK api=${apiPort} web=${webPort} sau ${secs}s\n`);
} finally { stop(); }
setTimeout(() => process.exit(process.exitCode ?? 0), 500);
