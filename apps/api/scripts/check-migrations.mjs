#!/usr/bin/env node
// CI (PRJ-REQ-20261006-095422563 BR3, PRJ-SEC T12): schema Prisma phải khớp thư mục migration (không lệch).
// Cần SHADOW_DATABASE_URL (CSDL trống dùng để dựng lại migration). Chạy từ thư mục apps/api (hoặc bản sao có prisma/).
import { spawnSync } from 'node:child_process';

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) { process.stderr.write('check-migrations: thiếu SHADOW_DATABASE_URL\n'); process.exit(1); }
const r = spawnSync('node_modules/.bin/prisma', [
  'migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema',
  '--shadow-database-url', shadow, '--exit-code',
], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? shadow } });
if (r.status === 0) { process.stdout.write('check-migrations: schema khớp migration\n'); process.exit(0); }
if (r.status === 2) {
  process.stderr.write(`check-migrations: schema Prisma lệch thư mục migration (quên tạo migration?)\n${r.stdout}\n`);
  process.exit(2);
}
process.stderr.write(`check-migrations: lỗi chạy prisma\n${r.stdout}${r.stderr}\n`);
process.exit(1);
