-- AUTH-DB-20261006-100006037 (đợt bán hộ 2026-10-15): chỉ mục cho AuthApi.findCustomersByPhone (tra khớp chính xác, số không duy nhất).
-- Chỉ thêm chỉ mục; rollback: DROP INDEX "users_phone_idx".
CREATE INDEX "users_phone_idx" ON "users"("phone");
