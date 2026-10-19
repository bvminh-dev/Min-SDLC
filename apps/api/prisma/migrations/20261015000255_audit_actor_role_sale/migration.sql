-- Đợt bán hộ 2026-10-15: audit_logs.actor_role là TEXT có CHECK; role `sale` phải ghi được audit (đơn hộ, tra khách, đăng nhập).
-- Chỉ nới CHECK (thêm một giá trị), không đổi dữ liệu cũ. Rollback: dựng lại CHECK không có 'sale' sau khi không còn dòng nào mang `sale`.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_role_check";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_role_check" CHECK ("actor_role" IN ('guest', 'customer', 'staff', 'sale', 'admin', 'system'));
