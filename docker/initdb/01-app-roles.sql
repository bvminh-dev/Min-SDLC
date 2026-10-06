-- Vai trò CSDL của ứng dụng (PRJ-DB mục 12, PRJ-SEC T19). Chạy một lần bằng superuser, chạy lại an toàn:
--   dev: docker compose mount vào docker-entrypoint-initdb.d (CSDL mới); CI và test: psql -f hoặc globalSetup.
-- Migration chạy bằng superuser/chủ bảng (MIGRATE_DATABASE_URL); ứng dụng chạy bằng ecom_app (DATABASE_URL),
-- chỉ job dọn của platform dùng ecom_retention (RETENTION_DATABASE_URL). Mật khẩu dưới đây chỉ dùng local: prod đặt mật khẩu riêng ở kho bí mật của host.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN CREATE ROLE app_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_retention') THEN CREATE ROLE app_retention NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecom_app') THEN
    CREATE ROLE ecom_app LOGIN PASSWORD 'ecom_app' NOSUPERUSER NOCREATEDB NOCREATEROLE IN ROLE app_runtime;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecom_retention') THEN
    CREATE ROLE ecom_retention LOGIN PASSWORD 'ecom_retention' NOSUPERUSER NOCREATEDB NOCREATEROLE IN ROLE app_retention;
  END IF;
END
$$;
