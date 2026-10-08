-- INV-DB-20261006-101122740 (Migration 1 đến 3): bảng của module inventory (stock_items, stock_movements, stock_reservations).
-- Thứ tự giữa module: platform, auth, user, catalog, inventory. Khóa ngoại chỉ tới bảng của INV và `products` của PRD (INV phụ thuộc PRD);
-- `order_id`, `actor_id`, `ref_id` là cột trơn (ranh giới module, SB-35). Không có dữ liệu mồi (bản ghi kho tạo khi nhận ProductActivated hoặc job đối soát).
-- Prisma không biểu diễn CHECK, chỉ mục một phần, trigger: các phần đó viết tay ở cuối.
-- Rollback (chỉ an toàn khi chưa có dữ liệu thật): DROP TABLE "stock_movements", "stock_reservations", "stock_items"; DROP TRIGGER/FUNCTION stock_movements_guard;
--   DROP TYPE "movement_type", "movement_ref", "reservation_status"; sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('in', 'out', 'adjust', 'sale', 'restock', 'return');

-- CreateEnum
CREATE TYPE "movement_ref" AS ENUM ('order', 'shipment');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('held', 'committed', 'released', 'expired');

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "low_stock_notified" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stock_item_id" UUID NOT NULL,
    "type" "movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "on_hand_after" INTEGER NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "actor_id" UUID,
    "actor_name" TEXT,
    "ref_type" "movement_ref",
    "ref_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stock_item_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_product_id_key" ON "stock_items"("product_id");

-- CreateIndex
CREATE INDEX "stock_items_updated_at_id_idx" ON "stock_items"("updated_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_stock_item_id_created_at_id_idx" ON "stock_movements"("stock_item_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_stock_item_id_order_id_key" ON "stock_reservations"("stock_item_id", "order_id");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc và chỉ mục ngoài Prisma
-- stock_items: on_hand <= 2.000.000.000 là trần dự phòng của kiểu integer (trần nghiệp vụ 10.000.000 do tầng ứng dụng giữ); reserved <= on_hand là bất biến chống bán vượt (SB-25).
ALTER TABLE "stock_items"
  ADD CONSTRAINT "stock_items_on_hand_range" CHECK (on_hand BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "stock_items_reserved_nonneg" CHECK (reserved >= 0),
  ADD CONSTRAINT "stock_items_reserved_le_on_hand" CHECK (reserved <= on_hand),
  ADD CONSTRAINT "stock_items_threshold_range" CHECK (low_stock_threshold BETWEEN 0 AND 1000000),
  ADD CONSTRAINT "stock_items_version_positive" CHECK (version >= 1);
-- danh sách tồn thấp và getLowStockSummary: sắp theo available, bỏ sản phẩm ngừng bán
CREATE INDEX "stock_items_available_idx" ON "stock_items" ((on_hand - reserved)) WHERE archived_at IS NULL;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_nonzero" CHECK (quantity <> 0),
  ADD CONSTRAINT "stock_movements_sign_in" CHECK (type NOT IN ('in', 'restock', 'return') OR quantity > 0),
  ADD CONSTRAINT "stock_movements_sign_out" CHECK (type NOT IN ('out', 'sale') OR quantity < 0),
  ADD CONSTRAINT "stock_movements_on_hand_after_nonneg" CHECK (on_hand_after >= 0),
  ADD CONSTRAINT "stock_movements_reason_enum" CHECK (reason IN ('purchase', 'transfer_in', 'damaged', 'lost', 'internal_use', 'other')),
  ADD CONSTRAINT "stock_movements_note_len" CHECK (length(note) <= 200),
  ADD CONSTRAINT "stock_movements_actor_name_len" CHECK (length(actor_name) <= 200),
  ADD CONSTRAINT "stock_movements_actor_name_needs_actor" CHECK (actor_id IS NOT NULL OR actor_name IS NULL),
  ADD CONSTRAINT "stock_movements_ref_pair" CHECK ((ref_type IS NULL) = (ref_id IS NULL));
-- idempotent cho sale, restock, return theo đơn hoặc vận đơn (ON CONFLICT DO NOTHING ở mã)
CREATE UNIQUE INDEX "stock_movements_ref_key" ON "stock_movements" ("stock_item_id", "type", "ref_type", "ref_id") WHERE ref_id IS NOT NULL;

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_quantity_range" CHECK (quantity BETWEEN 1 AND 100000),
  ADD CONSTRAINT "stock_reservations_expired_has_deadline" CHECK (status <> 'expired' OR expires_at IS NOT NULL);
-- job hết hạn (expires_at rỗng là COD, không hạn) và đối soát
CREATE INDEX "stock_reservations_expiry_idx" ON "stock_reservations" (expires_at) WHERE status = 'held' AND expires_at IS NOT NULL;
CREATE INDEX "stock_reservations_held_item_idx" ON "stock_reservations" (stock_item_id) WHERE status = 'held';

-- Lịch sử kho chỉ thêm (SB-32, INV-REQ ...637 BR5): trigger chặn UPDATE, DELETE cho mọi vai trò, cộng thu quyền của vai trò ứng dụng.
CREATE FUNCTION stock_movements_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (%)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "stock_movements_append_only"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_guard();
REVOKE UPDATE, DELETE, TRUNCATE ON "stock_movements" FROM PUBLIC, app_runtime;
