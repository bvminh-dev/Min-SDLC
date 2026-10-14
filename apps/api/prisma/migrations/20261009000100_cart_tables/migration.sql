-- CRT-DB-20261006-103824563 (Migration 1 đến 3): bảng của module cart (carts, cart_items) cùng enum cart_status.
-- Thứ tự giữa module: sau PRD (products) và SHP (shipping_methods). Khóa ngoại chỉ tới bảng của CRT, `products` (PRD) và `shipping_methods` (SHP); `user_id` và `converted_order_id` là cột trơn (AUTH, ORD không nằm trong Phụ thuộc của CRT, A-03).
-- Không có dữ liệu mồi. Tiền là bigint (đồng VND), tiền KHÔNG lưu ở `carts` (dẫn xuất từ PRD, PRM, SHP, SB-23); `cart_items.unit_price` chỉ là giá lúc thêm để báo giá đã đổi.
-- Rollback (chỉ an toàn khi chưa có giỏ thật): DROP TABLE "cart_items", "carts"; DROP TYPE "cart_status"; sau đó chỉ tiến (forward-only).


-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('active', 'converted', 'abandoned');

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "cart_status" NOT NULL DEFAULT 'active',
    "coupon_code" TEXT,
    "shipping_method_id" UUID,
    "shipping_city" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "unavailable_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cart_items_product_id_idx" ON "cart_items"("product_id");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_created_at_id_idx" ON "cart_items"("cart_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_product_id_key" ON "cart_items"("cart_id", "product_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc và chỉ mục ngoài Prisma
-- carts: mã giảm giá 1..50 ký tự; thành phố 1..50 ký tự; phương thức và thành phố cùng có hoặc cùng không (không lưu nửa lựa chọn); `converted` khi và chỉ khi có `converted_order_id`; `version` từ 1.
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_coupon_code_len" CHECK (coupon_code IS NULL OR char_length(coupon_code) BETWEEN 1 AND 50),
  ADD CONSTRAINT "carts_shipping_city_len" CHECK (shipping_city IS NULL OR char_length(shipping_city) BETWEEN 1 AND 50),
  ADD CONSTRAINT "carts_shipping_pair" CHECK ((shipping_method_id IS NULL) = (shipping_city IS NULL)),
  ADD CONSTRAINT "carts_converted_order" CHECK ((status = 'converted') = (converted_order_id IS NOT NULL)),
  ADD CONSTRAINT "carts_version_min" CHECK (version >= 1);
-- một giỏ active mỗi người dùng (T9: hai yêu cầu thêm đầu tiên cùng lúc chỉ ra một giỏ); giỏ converted, abandoned không giới hạn số lượng
CREATE UNIQUE INDEX "carts_user_active_key" ON "carts" (user_id) WHERE status = 'active';
-- job cart.abandon: giỏ active cũ nhất trước
CREATE INDEX "carts_active_last_activity_idx" ON "carts" (last_activity_at) WHERE status = 'active';

-- cart_items: số lượng 1..99 và giá lúc thêm 1..1.000.000.000 (khoảng giá của PRD) kể cả khi ghi SQL trực tiếp (T3); lý do không còn bán chỉ là product_archived.
-- Trần 50 dòng mỗi giỏ không biểu diễn được bằng CHECK một dòng: kiểm trong giao dịch dưới khóa dòng giỏ (CRT-DB, quyết định không thêm trigger ở v1).
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_range" CHECK (quantity BETWEEN 1 AND 99),
  ADD CONSTRAINT "cart_items_unit_price_range" CHECK (unit_price BETWEEN 1 AND 1000000000),
  ADD CONSTRAINT "cart_items_unavailable_reason" CHECK (unavailable_reason IS NULL OR unavailable_reason = 'product_archived');
