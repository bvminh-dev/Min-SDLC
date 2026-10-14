-- PAY-DB-20261006-103701241 (REV-PAY-13, REV-PAY-04): sửa tiếp migration 20261008000200_payment_tables (không sửa migration đã áp).
-- (1) Dữ liệu tiền không bao giờ bị xóa bởi ứng dụng: thu DELETE của vai trò ứng dụng trên `payments`, `payment_attempts`, `refunds` (khóa ngoại RESTRICT chặn xóa Payment có lượt thử, nhưng không chặn xóa Refund
--     hay lượt thử không có Refund). UPDATE giữ nguyên: ba bảng này đổi trạng thái theo vòng đời (không phải bảng chỉ thêm). `payment_webhook_logs` giữ DELETE cho job dọn quá 12 tháng (trigger là lớp chặn).
-- (2) `refunds.requested_at`: lúc Refund VÀO `requested` (tạo, thử lại tay, tự thử lại), để job đối soát hoàn tiền tính hạn 1 giờ đúng cho Refund được thử lại (`created_at` là lúc tạo dòng nên không dùng được).
--     Dòng cũ lấy `created_at` (không có dữ liệu chính xác hơn).
-- Rollback: bỏ cột `requested_at` và cấp lại DELETE (`GRANT DELETE ON ... TO app_runtime`); không mất dữ liệu tiền.

ALTER TABLE "refunds" ADD COLUMN "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp();
UPDATE "refunds" SET "requested_at" = "created_at";

REVOKE DELETE ON "payments", "payment_attempts", "refunds" FROM PUBLIC, app_runtime;
