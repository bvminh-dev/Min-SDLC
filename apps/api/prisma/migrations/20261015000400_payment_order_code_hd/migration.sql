-- PAY: mã đơn mới HDyymmdd-NNNNN (ADR-024) cùng mã cũ 12 ký tự Crockford. Đổi CHECK `payments_order_code_format`, không đổi dữ liệu.
ALTER TABLE "payments" DROP CONSTRAINT "payments_order_code_format";
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_code_format" CHECK (order_code ~ '^(HD[0-9]{6}-[0-9]{5}|[0-9A-HJKMNP-TV-Z]{12})$');
