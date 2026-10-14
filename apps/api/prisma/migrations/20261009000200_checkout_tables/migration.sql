-- CHK-DB-20261006-105800565 (Migration 1 đến 3): bảng của module checkout (checkout_sessions) cùng enum checkout_status, checkout_payment_method.
-- Thứ tự giữa module: sau CRT (carts), USR (addresses), SHP (shipping_methods), ORD (orders). Khóa ngoại chỉ tới bảng của CHK và bốn bảng đó; `user_id` là cột trơn (AUTH không nằm trong Phụ thuộc của CHK, A-03).
-- Không có dữ liệu mồi. CHK KHÔNG lưu tiền như nguồn sự thật (SB-23): `price_snapshot` chỉ để chẩn đoán; dòng hàng luôn đọc từ CRT.
-- Rollback (chỉ an toàn khi chưa có phiên `completed`, tức chưa có đơn thật): DROP TABLE "checkout_sessions"; DROP TYPE "checkout_payment_method"; DROP TYPE "checkout_status"; sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "checkout_status" AS ENUM ('open', 'completed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "checkout_payment_method" AS ENUM ('vnpay', 'cod');

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "address_id" UUID,
    "shipping_method_id" UUID,
    "order_id" UUID,
    "payment_method" "checkout_payment_method",
    "coupon_code" TEXT,
    "address_snapshot" JSONB,
    "price_snapshot" JSONB,
    "status" "checkout_status" NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_sessions_user_id_created_at_idx" ON "checkout_sessions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "checkout_sessions_cart_id_idx" ON "checkout_sessions"("cart_id");

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Ràng buộc và chỉ mục ngoài Prisma
-- checkout_sessions: mã giảm giá 1..50 ký tự (cùng `carts_coupon_code_len`); `completed` khi và chỉ khi có đơn (`order_id`) và có `completed_at` (bất biến CHK-DB, SB-24).
ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_coupon_code_len" CHECK (coupon_code IS NULL OR char_length(coupon_code) BETWEEN 1 AND 50),
  ADD CONSTRAINT "checkout_sessions_completed_order" CHECK ((status = 'completed') = (order_id IS NOT NULL)),
  ADD CONSTRAINT "checkout_sessions_completed_at" CHECK ((status = 'completed') = (completed_at IS NOT NULL));
-- một phiên `open` mỗi người dùng (hai yêu cầu tạo phiên cùng lúc chỉ ra một phiên, T5)
CREATE UNIQUE INDEX "checkout_sessions_user_open_key" ON "checkout_sessions" (user_id) WHERE status = 'open';
-- một phiên `completed` mỗi giỏ (một đơn mỗi giỏ, kể cả khi CheckoutCompleted chưa tới CRT, T5, T15)
CREATE UNIQUE INDEX "checkout_sessions_cart_completed_key" ON "checkout_sessions" (cart_id) WHERE status = 'completed';
-- một phiên mỗi đơn
CREATE UNIQUE INDEX "checkout_sessions_order_key" ON "checkout_sessions" (order_id) WHERE order_id IS NOT NULL;
-- job hết hạn phiên: phiên `open` sắp hết hạn trước
CREATE INDEX "checkout_sessions_open_expiry_idx" ON "checkout_sessions" (expires_at) WHERE status = 'open';
-- job xóa bản chụp địa chỉ của phiên đã đóng (SB-08)
CREATE INDEX "checkout_sessions_snapshot_purge_idx" ON "checkout_sessions" (updated_at) WHERE address_snapshot IS NOT NULL AND status <> 'open';
