import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { REPO_ROOT } from './db';

const onPath = (cmd: string): string | undefined =>
  (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, cmd)).find((f) => { try { accessSync(f, constants.X_OK); return true; } catch { return false; } });
/** PATH tối thiểu cho `env -i`: thư mục của Node đang chạy test, thư mục của pnpm lấy từ PATH hiện tại, rồi hệ thống. Không cứng đường dẫn máy nào. */
export const cleanPath = (): string => {
  const pnpm = onPath('pnpm');
  return [dirname(process.execPath), ...(pnpm ? [dirname(pnpm)] : []), '/usr/bin', '/bin'].join(delimiter);
};
export interface Run { status: number | null; out: string; stdout: string; stderr: string }
export function run(cmd: string, args: string[], o: SpawnSyncOptions & { input?: string } = {}): Run {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', ...o });
  const stdout = String(r.stdout ?? ''), stderr = String(r.stderr ?? '');
  return { status: r.status, out: stdout + stderr, stdout, stderr };
}
/** Chạy script công cụ của repo bằng chính Node đang chạy test. */
export const runScript = (script: string, args: string[] = [], o: SpawnSyncOptions & { input?: string } = {}) =>
  run(process.execPath, [join(REPO_ROOT, script), ...args], o);
