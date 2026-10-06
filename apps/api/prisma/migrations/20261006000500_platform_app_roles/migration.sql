-- PRJ-DB mục 12, PRJ-SEC T19, SB-32: ứng dụng chỉ INSERT và SELECT trên audit_logs; không TRUNCATE; chỉ vai trò dọn xóa được.
-- Chạy bằng chủ bảng (superuser ở dev/test). Hai vai trò nhóm tạo ở đây nếu chưa có; vai trò đăng nhập gắn vào chúng do vận hành
-- (dev/test: docker/initdb/01-app-roles.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN CREATE ROLE app_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_retention') THEN CREATE ROLE app_retention NOLOGIN; END IF;
END
$$;

-- Quyền mặc định cho bảng của mọi module (kể cả bảng tạo sau); bảng chỉ thêm phải REVOKE rõ ràng ở migration của nó (như audit_logs dưới đây).
GRANT USAGE ON SCHEMA public TO app_runtime, app_retention;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
-- Ứng dụng không đụng bảng lịch sử migration (không có ở CSDL shadow của prisma migrate diff, nên kiểm tồn tại).
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN REVOKE ALL ON "_prisma_migrations" FROM app_runtime; END IF;
END
$$;

-- audit_logs: ứng dụng chỉ INSERT và SELECT; job dọn chỉ SELECT và DELETE.
REVOKE ALL ON "audit_logs" FROM PUBLIC, app_runtime, app_retention;
GRANT SELECT, INSERT ON "audit_logs" TO app_runtime;
GRANT SELECT, DELETE ON "audit_logs" TO app_retention;

-- Bỏ đường `app.audit_purge` (mọi phiên tự đặt được): DELETE chỉ qua khi phiên đăng nhập là thành viên app_retention.
-- UPDATE và TRUNCATE luôn bị chặn.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_has_role(session_user, 'app_retention', 'member') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (%)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();
