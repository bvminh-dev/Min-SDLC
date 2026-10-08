-- SHP-DB-20261006-101603015 (Migration 1 đến 4): bảng của module shipping (shipping_methods, shipments, shipment_status_history) cùng 3 enum.
-- Thứ tự giữa module: platform, auth, user, catalog, inventory, promotion, order, shipping. Khóa ngoại chỉ tới bảng của SHP và `orders` (ORD, ràng buộc toàn vẹn; SHP không SELECT `orders`, SB-35).
-- Không có dữ liệu mồi (đã chốt: không seed phương thức mặc định; trước đơn đầu tiên admin tạo ít nhất một phương thức bật).
-- Rollback (chỉ an toàn khi chưa có vận đơn thật): DROP TRIGGER shipment_status_history_append_only, DROP FUNCTION shipment_status_history_guard;
--   DROP TABLE "shipment_status_history", "shipments", "shipping_methods"; DROP TYPE "shipment_fail_reason", "shipment_history_event", "shipment_status"; sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('pending', 'shipped', 'delivered', 'failed', 'returned', 'cancelled');

-- CreateEnum
CREATE TYPE "shipment_history_event" AS ENUM ('status_changed', 'tracking_changed');

-- CreateEnum
CREATE TYPE "shipment_fail_reason" AS ENUM ('customer_unreachable', 'refused', 'wrong_address', 'damaged', 'other');

-- CreateTable
CREATE TABLE "shipping_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "base_fee" BIGINT NOT NULL,
    "rule" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "shipping_method_id" UUID NOT NULL,
    "status" "shipment_status" NOT NULL DEFAULT 'pending',
    "tracking_number" TEXT,
    "cod_amount" BIGINT NOT NULL DEFAULT 0,
    "shipped_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "shipment_id" UUID NOT NULL,
    "event" "shipment_history_event" NOT NULL,
    "status" "shipment_status" NOT NULL,
    "tracking_number" TEXT,
    "reason_code" "shipment_fail_reason",
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "shipment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_methods_created_at_id_idx" ON "shipping_methods"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "shipments_status_created_at_id_idx" ON "shipments"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "shipments_created_at_id_idx" ON "shipments"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_status_history_seq_key" ON "shipment_status_history"("seq");

-- CreateIndex
CREATE INDEX "shipment_status_history_shipment_id_seq_idx" ON "shipment_status_history"("shipment_id", "seq");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc và chỉ mục ngoài Prisma
-- shipping_methods: tên 2..80 ký tự sau trim, duy nhất không phân biệt hoa thường; phí cơ bản số nguyên đồng 0..1.000.000; `rule` là đối tượng JSON (cấu trúc do schema zod ở biên API kiểm, E-15).
ALTER TABLE "shipping_methods"
  ADD CONSTRAINT "shipping_methods_name_len" CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  ADD CONSTRAINT "shipping_methods_base_fee_range" CHECK (base_fee BETWEEN 0 AND 1000000),
  ADD CONSTRAINT "shipping_methods_rule_object" CHECK (jsonb_typeof(rule) = 'object');
CREATE UNIQUE INDEX "shipping_methods_name_key" ON "shipping_methods" (lower(btrim(name)));
-- danh sách của customer: chỉ phương thức bật, rẻ nhất trước, cùng phí thì theo tên không phân biệt hoa thường
CREATE INDEX "shipping_methods_active_fee_name_idx" ON "shipping_methods" (is_active, base_fee, lower(name));

-- shipments: mã vận đơn chỉ có từ lúc bàn giao (pending và cancelled không có mã, vận đơn đã bàn giao không bao giờ sang cancelled), định dạng và duy nhất ở CSDL (T8);
-- tối đa một vận đơn còn hiệu lực mỗi đơn (T18); tiền thu hộ không âm; `delivered` phải có `delivered_at`.
ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_tracking_format" CHECK (tracking_number ~ '^[A-Z0-9-]{8,30}$'),
  ADD CONSTRAINT "shipments_tracking_status" CHECK ((status IN ('pending', 'cancelled')) = (tracking_number IS NULL)),
  ADD CONSTRAINT "shipments_cod_nonneg" CHECK (cod_amount >= 0),
  ADD CONSTRAINT "shipments_delivered_at" CHECK (status <> 'delivered' OR delivered_at IS NOT NULL);
CREATE UNIQUE INDEX "shipments_tracking_number_key" ON "shipments" (tracking_number) WHERE tracking_number IS NOT NULL;
CREATE UNIQUE INDEX "shipments_order_active_key" ON "shipments" (order_id) WHERE status <> 'cancelled';

-- shipment_status_history: lý do và ghi chú chỉ ở dòng `failed`, ghi chú tối đa 300 ký tự.
ALTER TABLE "shipment_status_history"
  ADD CONSTRAINT "shipment_status_history_reason_scope" CHECK (reason_code IS NULL OR status = 'failed'),
  ADD CONSTRAINT "shipment_status_history_note_scope" CHECK (note IS NULL OR (status = 'failed' AND char_length(note) <= 300));

-- Lịch sử chỉ thêm (SB-32, T13): trigger chặn UPDATE, DELETE cho mọi vai trò, cộng thu quyền của vai trò ứng dụng (UPDATE, DELETE, TRUNCATE).
CREATE FUNCTION shipment_status_history_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shipment_status_history is append-only (%)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "shipment_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "shipment_status_history"
  FOR EACH ROW EXECUTE FUNCTION shipment_status_history_guard();
REVOKE UPDATE, DELETE, TRUNCATE ON "shipment_status_history" FROM PUBLIC, app_runtime;
