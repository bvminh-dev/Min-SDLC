-- ORD-DB-20261006-092703753 (đợt bán hộ 2026-10-15, Lần 1 bước 1 đến 4): nguồn đơn, bộ đếm mã đơn theo ngày (ADR-024), cột mới của `orders` và `order_items`, `user_id` rỗng được.
-- Bước MỞ RỘNG, tương thích ngược: mọi cột mới NULL được hoặc có DEFAULT (`source_id` mặc định là nguồn `website` có id cố định, nên bản ứng dụng cũ INSERT không có cột vẫn thành đơn `website`).
-- Rollback (chỉ an toàn khi chưa có đơn hộ): bỏ CHECK, cột, hai bảng, hai trigger và hàm của order_sources; sau đó chỉ tiến (forward-only).

-- CreateTable
CREATE TABLE "order_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_code_counters" (
    "day" DATE NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "order_code_counters_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_sources_code_key" ON "order_sources"("code");
CREATE INDEX "order_sources_is_active_position_name_idx" ON "order_sources"("is_active", "position", "name");

-- Ràng buộc và trigger ngoài Prisma
ALTER TABLE "order_sources"
  ADD CONSTRAINT "order_sources_code_format" CHECK (code ~ '^[a-z0-9_]{2,32}$'),
  ADD CONSTRAINT "order_sources_name_len" CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  ADD CONSTRAINT "order_sources_system_active" CHECK (NOT is_system OR is_active),
  ADD CONSTRAINT "order_sources_position_range" CHECK ("position" BETWEEN 0 AND 999);
-- bộ đếm: số thứ 100000 trong ngày vi phạm CHECK, ORD đổi lỗi đó thành `order_code_exhausted`
ALTER TABLE "order_code_counters" ADD CONSTRAINT "order_code_counters_last_range" CHECK ("last" BETWEEN 1 AND 99999);

-- `code` và `is_system` không đổi sau khi tạo; v1 chỉ tắt, không xóa nguồn (nguồn đã gắn đơn không được xóa, entities.md)
CREATE FUNCTION order_sources_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_sources cannot be deleted (only deactivated)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'order_sources.code and is_system are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "order_sources_no_change_identity" BEFORE UPDATE ON "order_sources" FOR EACH ROW EXECUTE FUNCTION order_sources_guard();
CREATE TRIGGER "order_sources_no_delete" BEFORE DELETE ON "order_sources" FOR EACH ROW EXECUTE FUNCTION order_sources_guard();

-- Dữ liệu mồi: `website` (id cố định, nguồn hệ thống cho đơn khách tự đặt), rồi ba nguồn do admin quản lý
INSERT INTO "order_sources" ("id", "code", "name", "is_system") VALUES ('00000000-0000-4000-8000-000000000001', 'website', 'Website', true);
INSERT INTO "order_sources" ("code", "name") VALUES ('facebook', 'Facebook'), ('tiktok', 'TikTok'), ('hotline', 'Hotline');

-- AlterTable orders
ALTER TABLE "orders" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "orders"
  ADD COLUMN "source_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "customer_snapshot" JSONB,
  ADD COLUMN "note" TEXT;
-- AlterTable order_items
ALTER TABLE "order_items" ADD COLUMN "note" TEXT, ADD COLUMN "cost_snapshot" BIGINT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "order_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK mới khớp đơn cũ (created_by, customer_snapshot, note NULL; user_id có; mã 12 ký tự)
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_code_format" CHECK (code ~ '^(HD[0-9]{6}-[0-9]{5}|[0-9A-HJKMNP-TV-Z]{12})$'),
  ADD CONSTRAINT "orders_note_len" CHECK (note IS NULL OR char_length(note) <= 1000),
  ADD CONSTRAINT "orders_ho_snapshot" CHECK ((created_by IS NULL) = (customer_snapshot IS NULL)),
  ADD CONSTRAINT "orders_has_owner" CHECK (user_id IS NOT NULL OR created_by IS NOT NULL),
  ADD CONSTRAINT "orders_note_only_ho" CHECK (created_by IS NOT NULL OR note IS NULL);
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_note_len" CHECK (note IS NULL OR char_length(note) <= 500),
  ADD CONSTRAINT "order_items_cost_nonneg" CHECK (cost_snapshot IS NULL OR cost_snapshot >= 0);

-- Chỉ mục mới (bảng nhỏ ở v1 nên không CONCURRENTLY; migration chạy trong một giao dịch)
CREATE INDEX "orders_source_id_created_at_id_idx" ON "orders"("source_id", "created_at" DESC, "id" DESC);
CREATE INDEX "orders_created_by_idx" ON "orders" (created_by, created_at DESC, id DESC) WHERE created_by IS NOT NULL;
-- countOpenOrders chỉ đếm đơn khách tự đặt (đơn hộ không tính vào giới hạn đơn mở, SB-33); chỉ mục cũ `orders_open_idx` bỏ ở Lần 2 (bước thu hẹp)
CREATE INDEX "orders_open_self_idx" ON "orders" (user_id, payment_method) WHERE status IN ('pending', 'confirmed') AND created_by IS NULL;
