-- SHP-DB-20261006-101603015 (đồng bộ review SHP, quyết định 4): thêm `shipments.order_code`, bản chụp BẤT BIẾN của mã đơn lúc tạo vận đơn, để danh sách vận đơn không phải hỏi ORD từng dòng (N+1).
-- Bước MỞ RỘNG theo PRJ-REQ-20261006-095422563 BR4 (migration tương thích ngược một phiên bản): cột NULL được, bản ứng dụng cũ vẫn chèn được. Bước thu hẹp `SET NOT NULL` là migration sau
-- (kèm dòng `-- contract-step: 20261008000100_shipping_order_code`), chỉ chạy khi mọi instance đã ghi `order_code` lúc tạo vận đơn.
-- Dữ liệu có sẵn: backfill bằng một câu UPDATE nối `orders` (chạy bằng vai trò migration, một lần, nguyên tử với việc thêm cột; mã ứng dụng SHP vẫn không SELECT `orders`, SB-35). Mã đơn không bao giờ đổi
-- ở ORD, nên bản chụp không lệch. Dòng nào không có đơn (không xảy ra: khóa ngoại RESTRICT) giữ NULL.
-- Rollback (an toàn vì cột chỉ là bản sao): bỏ trigger shipments_order_code_immutable, hàm shipments_order_code_guard, ràng buộc khuôn shipments_order_code_format rồi cột order_code; sau đó chỉ tiến (forward-only).

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "order_code" TEXT;

-- Backfill từ ORD cho dữ liệu có sẵn
UPDATE "shipments" s SET "order_code" = o."code" FROM "orders" o WHERE o."id" = s."order_id" AND s."order_code" IS NULL;

-- Ràng buộc ngoài Prisma: khuôn mã đơn của ORD (Crockford base32 hoa, 12 ký tự, bỏ I, L, O, U; NULL qua được ở bước mở rộng).
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_code_format" CHECK (order_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$');

-- Bất biến: đã có mã thì không đổi được (UPDATE đổi sang giá trị khác bị chặn cho mọi vai trò; điền lần đầu từ NULL vẫn được, dùng cho backfill).
CREATE FUNCTION shipments_order_code_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.order_code IS NOT NULL AND NEW.order_code IS DISTINCT FROM OLD.order_code THEN
    RAISE EXCEPTION 'shipments.order_code is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "shipments_order_code_immutable"
  BEFORE UPDATE OF "order_code" ON "shipments"
  FOR EACH ROW EXECUTE FUNCTION shipments_order_code_guard();
