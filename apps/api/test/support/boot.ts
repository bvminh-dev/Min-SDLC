import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { API_DIR } from './db';

export interface Boot { child: ChildProcess; stdout: () => string; stderr: () => string; exited: Promise<number | null>; kill: () => void }

export const freePort = (): Promise<number> =>
  new Promise((res) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });

/** Khởi động ứng dụng thật (main.ts) trong tiến trình con, môi trường chỉ gồm `env` (không kế thừa biến của người chạy test). */
export function bootApp(env: Record<string, string>): Boot {
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/main.ts'], {
    cwd: API_DIR,
    env: { PATH: process.env.PATH ?? '', ...env } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout!.on('data', (d) => { out += d; });
  child.stderr!.on('data', (d) => { err += d; });
  const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  return { child, stdout: () => out, stderr: () => err, exited, kill: () => child.kill('SIGKILL') };
}

export async function waitFor(cond: () => boolean | Promise<boolean>, ms = 30_000, step = 100): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, step)); }
  return false;
}

export async function portOpen(port: number): Promise<boolean> {
  try { await fetch(`http://127.0.0.1:${port}/api/v1/health`); return true; } catch { return false; }
}
