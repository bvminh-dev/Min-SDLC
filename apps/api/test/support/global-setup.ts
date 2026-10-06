import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { DB_BASE, ROLES_SQL, TEST_DB, adminQuery, migrateDeploy, testDbUrl } from './db';

// Dựng CSDL test sạch từ migration (BR11) trước mọi bộ test.
export default async function globalSetup(): Promise<void> {
  const probe = new Client({ connectionString: `${DB_BASE}/postgres`, connectionTimeoutMillis: 3000 });
  try {
    await probe.connect();
    await probe.end();
  } catch {
    throw new Error('Không kết nối được PostgreSQL test. Chạy `docker compose up -d db` ở gốc repo (cổng 5433).');
  }
  await adminQuery(readFileSync(ROLES_SQL, 'utf8')); // vai trò ứng dụng (cấp cụm, tạo một lần, chạy lại an toàn)
  await adminQuery(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await adminQuery(`CREATE DATABASE ${TEST_DB}`);
  const r = migrateDeploy(testDbUrl());
  if (r.status !== 0) throw new Error(`prisma migrate deploy lỗi:\n${r.out}`);
}
