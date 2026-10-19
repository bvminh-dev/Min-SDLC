-- SHP-DB-20261006-101603015 mục Migration 8 (đợt bán hàng hộ, ADR-024, SB-08 (d), SB-45): bước MỞ RỘNG, tương thích ngược một phiên bản (PRJ-REQ-20261006-095422563 BR4).
-- (1) Khuôn `order_code` nhận cả hai: mã 12 ký tự của đơn cũ và `HDyymmdd-NNNNN` của đơn từ ADR-024. Nới ràng buộc nên dòng cũ vẫn hợp lệ, bản ứng dụng cũ vẫn chèn được mã 12 ký tự.
-- (2) `created_by`: bản chụp id người tạo đơn lúc tạo vận đơn (NULL, không FK vì `users` ngoài cột Phụ thuộc của SHP, không backfill: vận đơn cũ và đơn khách tự đặt để NULL, sale không thấy chúng);
--     chỉ để lọc danh sách của sale. Không có trigger bất biến cho cột này: SHP chỉ điền lúc tạo, admin đổi người tạo ở ORD thì SHP đối chiếu lại qua `getShipmentDisplay`.
-- Chỉ mục: bảng nhỏ ở v1 và migration chạy trong một giao dịch nên không CONCURRENTLY (cùng cách với `orders_created_by_idx` của ORD).
-- Rollback: bỏ chỉ mục, cột `created_by`, rồi trả CHECK về khuôn 12 ký tự khi không còn dòng `HD...` (forward-only sau đó).

ALTER TABLE "shipments" DROP CONSTRAINT "shipments_order_code_format",
  ADD CONSTRAINT "shipments_order_code_format" CHECK (order_code ~ '^([0-9A-HJKMNP-TV-Z]{12}|HD[0-9]{6}-[0-9]{5})$');

ALTER TABLE "shipments" ADD COLUMN "created_by" UUID;

CREATE INDEX "shipments_created_by_created_at_id_idx" ON "shipments" ("created_by", "created_at" DESC, "id" DESC) WHERE "created_by" IS NOT NULL;
