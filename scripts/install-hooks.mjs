// Chạy khi `pnpm install` (prepare): bật hook trước commit quét bí mật (PRJ-REQ-20261006-095422475 BR6, SB-15).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('.git') || process.env.CI) process.exit(0);
const cur = spawnSync('git', ['config', '--local', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim();
if (!cur) spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
