import type { ClientConfig } from 'pg';

/** Đổi DATABASE_URL (kiểu Prisma) sang cấu hình pg; dùng cho kết nối riêng giữ khóa tư vấn (ngoài pool Prisma). */
export function toPgConfig(databaseUrl: string): ClientConfig {
  const u = new URL(databaseUrl);
  const mode = u.searchParams.get('sslmode');
  const ssl = u.searchParams.get('ssl') === 'true' || (mode !== null && mode !== 'disable' && mode !== 'prefer');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: ssl ? { rejectUnauthorized: mode === 'verify-ca' || mode === 'verify-full' } : false,
    connectionTimeoutMillis: 5000,
  };
}

/** Thêm tham số kết nối cho Prisma từ cấu hình: kích thước pool (DB_POOL_MAX) và statement_timeout (SB-31, PRJ-DB mục 9). */
export function prismaUrl(databaseUrl: string, poolMax: number, statementTimeoutMs: number): string {
  const u = new URL(databaseUrl);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(poolMax));
  if (!u.searchParams.has('options')) u.searchParams.set('options', `-c statement_timeout=${statementTimeoutMs}`);
  return u.toString();
}
