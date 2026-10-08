-- ORD-DB-20261006-092703753 (Migration 1 đến 3): bảng của module order (orders, order_items, order_status_history) cùng 5 enum.
-- Thứ tự giữa module: platform, auth, user, catalog, inventory, promotion, order. Khóa ngoại chỉ tới bảng của ORD và `users` của AUTH (ORD phụ thuộc AUTH);
-- `product_id`, `shipping_method_id` là cột trơn (ranh giới module, SB-35). Không có dữ liệu mồi.
-- Prisma không biểu diễn CHECK, chỉ mục một phần, trigger, cột identity `seq`: các phần đó viết tay (seq) hoặc ở cuối.
-- Rollback (chỉ an toàn khi chưa có đơn thật): DROP TRIGGER order_status_history_append_only, DROP FUNCTION order_status_history_guard;
--   DROP TABLE "order_status_history", "order_items", "orders"; DROP TYPE "order_actor_role", "order_cancel_reason", "order_payment_method", "order_payment_status", "order_status"; sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned');

-- CreateEnum
CREATE TYPE "order_payment_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "order_payment_method" AS ENUM ('vnpay', 'cod');

-- CreateEnum
CREATE TYPE "order_cancel_reason" AS ENUM ('customer_request', 'admin', 'payment_failed', 'stock_commit_failed');

-- CreateEnum
CREATE TYPE "order_actor_role" AS ENUM ('customer', 'admin', 'system');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending',
    "payment_status" "order_payment_status" NOT NULL DEFAULT 'pending',
    "items_total" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL,
    "shipping_fee" BIGINT NOT NULL,
    "grand_total" BIGINT NOT NULL,
    "shipping_address" JSONB NOT NULL,
    "shipping_method_id" UUID NOT NULL,
    "payment_method" "order_payment_method" NOT NULL,
    "payment_expires_at" TIMESTAMPTZ(6),
    "handoff_locked_at" TIMESTAMPTZ(6),
    "tracking_number" TEXT,
    "cancel_reason" "order_cancel_reason",
    "cancelled_by_role" "order_actor_role",
    "confirmed_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor_id" UUID,
    "actor_role" "order_actor_role" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "orders_user_id_status_created_at_id_idx" ON "orders"("user_id", "status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "orders_status_created_at_id_idx" ON "orders"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "orders_created_at_id_idx" ON "orders"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_position_key" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_history_seq_key" ON "order_status_history"("seq");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_seq_idx" ON "order_status_history"("order_id", "seq");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc và chỉ mục ngoài Prisma
-- orders: tiền là số nguyên đồng; grand_total > 0 (R-03, v1 không có đơn 0 đồng) và đúng công thức (SB-23, lớp hai sau kiểm của createPending).
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_money_nonneg" CHECK (items_total >= 0 AND discount >= 0 AND shipping_fee >= 0 AND grand_total >= 0),
  ADD CONSTRAINT "orders_grand_total_positive" CHECK (grand_total > 0),
  ADD CONSTRAINT "orders_grand_total_formula" CHECK (grand_total = items_total - discount + shipping_fee),
  -- hạn giữ hàng chỉ có ở đơn vnpay (bản sao chỉ đọc của hạn INV, K-01)
  ADD CONSTRAINT "orders_expiry_iff_vnpay" CHECK ((payment_method = 'vnpay') = (payment_expires_at IS NOT NULL)),
  -- cờ bàn giao do SHP đặt (R-04) vô nghĩa với đơn chưa thanh toán hoặc đã hết hạn
  ADD CONSTRAINT "orders_handoff_lock_status" CHECK (handoff_locked_at IS NULL OR status NOT IN ('pending', 'expired')),
  ADD CONSTRAINT "orders_tracking_status" CHECK (tracking_number IS NULL OR status IN ('shipped', 'delivered', 'returned')),
  ADD CONSTRAINT "orders_cancel_pair" CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL AND cancelled_by_role IS NOT NULL)),
  ADD CONSTRAINT "orders_confirmed_at" CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  ADD CONSTRAINT "orders_delivered_at" CHECK ((status = 'delivered') = (delivered_at IS NOT NULL));
-- doanh thu theo paid_at của DSH (M-13) và countOpenOrders (chỉ đơn đang mở)
CREATE INDEX "orders_paid_at_idx" ON "orders" (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX "orders_open_idx" ON "orders" (user_id, payment_method) WHERE status IN ('pending', 'confirmed');

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_unit_price_nonneg" CHECK (unit_price >= 0),
  ADD CONSTRAINT "order_items_quantity_positive" CHECK (quantity > 0),
  ADD CONSTRAINT "order_items_position_positive" CHECK (position > 0);

-- order_status_history: chỉ thêm. Dòng tự trỏ chỉ cho ShipmentFailed (shipped -> shipped, reason là mã giao thất bại).
ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_from_null_iff_pending" CHECK ((from_status IS NULL) = (to_status = 'pending')),
  ADD CONSTRAINT "order_status_history_self_loop" CHECK (from_status IS NULL OR from_status <> to_status OR to_status = 'shipped'),
  ADD CONSTRAINT "order_status_history_reason_scope" CHECK (reason IS NULL OR to_status = 'cancelled' OR (from_status = 'shipped' AND to_status = 'shipped')),
  ADD CONSTRAINT "order_status_history_reason_len" CHECK (reason IS NULL OR length(reason) <= 500);
-- vòng đời không quay lại trạng thái cũ: mỗi (đơn, trạng thái đích) đúng một dòng chuyển (lớp bảo vệ thứ hai của xử lý trùng, T8)
CREATE UNIQUE INDEX "order_status_history_transition_key" ON "order_status_history" (order_id, to_status) WHERE from_status IS DISTINCT FROM to_status;

-- Lịch sử chỉ thêm (SB-32, T11): trigger chặn UPDATE, DELETE cho mọi vai trò, cộng thu quyền của vai trò ứng dụng.
CREATE FUNCTION order_status_history_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order_status_history is append-only (%)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "order_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION order_status_history_guard();
REVOKE UPDATE, DELETE, TRUNCATE ON "order_status_history" FROM PUBLIC, app_runtime;
