// Chạy prisma bằng tài khoản migration: MIGRATE_DATABASE_URL (superuser/chủ bảng) nếu có, ngược lại DATABASE_URL.
// Ứng dụng chạy bằng vai trò hạn chế (ecom_app) nên không thể dùng DATABASE_URL để đổi lược đồ (PRJ-DB mục 12).
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
if (env.MIGRATE_DATABASE_URL) env.DATABASE_URL = env.MIGRATE_DATABASE_URL;
const r = spawnSync('prisma', process.argv.slice(2), { stdio: 'inherit', env, shell: false });
process.exit(r.status ?? 1);
