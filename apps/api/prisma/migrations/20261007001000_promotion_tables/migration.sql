-- PRM-DB-20261006-101036519 (Migration 1 đến 3): bảng của module promotion (coupons, coupon_redemptions).
-- Thứ tự giữa module: platform, auth, user, catalog, inventory, promotion. Khóa ngoại chỉ trỏ vào bảng của PRM (PRM không phụ thuộc module nào);
-- `order_id`, `user_id`, `created_by` là cột trơn (ranh giới module, SB-35). Không có dữ liệu mồi.
-- Prisma không biểu diễn CHECK nhiều cột, chỉ mục một phần, text_pattern_ops: các phần đó viết tay ở cuối.
-- Rollback (chỉ an toàn khi chưa có dữ liệu thật): DROP TABLE "coupon_redemptions", "coupons"; DROP TYPE "redemption_status", "coupon_status", "coupon_type";
--   sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "coupon_type" AS ENUM ('percentage', 'fixed');

-- CreateEnum
CREATE TYPE "coupon_status" AS ENUM ('active', 'disabled', 'expired', 'exhausted', 'deleted');

-- CreateEnum
CREATE TYPE "redemption_status" AS ENUM ('reserved', 'consumed', 'released');

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "type" "coupon_type" NOT NULL,
    "value" BIGINT NOT NULL,
    "min_order_value" BIGINT NOT NULL DEFAULT 0,
    "max_discount" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "usage_limit" INTEGER NOT NULL,
    "per_user_limit" INTEGER,
    "consumed_count" INTEGER NOT NULL DEFAULT 0,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "status" "coupon_status" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coupon_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "redemption_status" NOT NULL DEFAULT 'reserved',
    "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_status_created_at_id_idx" ON "coupons"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_status_idx" ON "coupon_redemptions"("coupon_id", "status");

-- CreateIndex
CREATE INDEX "coupon_redemptions_user_id_reserved_at_idx" ON "coupon_redemptions"("user_id", "reserved_at" DESC);

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc và chỉ mục ngoài Prisma
-- coupons: tiền là số nguyên VND (bigint); giá trị theo loại và `max_discount` chỉ cho percentage biểu diễn bằng CHECK nhiều cột (T8, SB-11);
-- consumed_count + reserved_count <= usage_limit là bất biến chống dùng vượt lượt (SB-25, PRM-REQ-20261006-101036447 BR1).
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_code_format" CHECK (code ~ '^[A-Z0-9_-]{4,20}$'),
  ADD CONSTRAINT "coupons_value_by_type" CHECK ((type = 'percentage' AND value BETWEEN 1 AND 100) OR (type = 'fixed' AND value BETWEEN 1 AND 1000000000)),
  ADD CONSTRAINT "coupons_min_order_range" CHECK (min_order_value BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "coupons_max_discount_percentage_only" CHECK (max_discount IS NULL OR (type = 'percentage' AND max_discount BETWEEN 1 AND 1000000000)),
  ADD CONSTRAINT "coupons_usage_limit_range" CHECK (usage_limit BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "coupons_per_user_limit_range" CHECK (per_user_limit IS NULL OR per_user_limit BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "coupons_counts_nonneg" CHECK (consumed_count >= 0 AND reserved_count >= 0),
  ADD CONSTRAINT "coupons_used_le_limit" CHECK (consumed_count + reserved_count <= usage_limit),
  ADD CONSTRAINT "coupons_version_positive" CHECK (version >= 1),
  ADD CONSTRAINT "coupons_deleted_pair" CHECK ((status = 'deleted') = (deleted_at IS NOT NULL));
-- tìm theo tiền tố mã ở danh sách quản trị (LIKE 'abc%'); một phần (bỏ coupon đã xóa mềm, danh sách không bao giờ trả chúng) để Prisma không đòi biểu diễn text_pattern_ops
CREATE INDEX "coupons_code_prefix_idx" ON "coupons" (code text_pattern_ops) WHERE status <> 'deleted';
-- job hết hạn chỉ chạm coupon còn có thể hết hạn
CREATE INDEX "coupons_expiry_idx" ON "coupons" (expires_at) WHERE status IN ('active', 'disabled');

-- coupon_redemptions: một đơn một lượt (unique order_id ở trên); amount là tiền giảm cố định lúc giữ.
ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_amount_range" CHECK (amount BETWEEN 1 AND 1000000000),
  ADD CONSTRAINT "coupon_redemptions_consumed_has_time" CHECK (status <> 'consumed' OR consumed_at IS NOT NULL),
  ADD CONSTRAINT "coupon_redemptions_released_pair" CHECK ((status = 'released') = (released_at IS NOT NULL)),
  ADD CONSTRAINT "coupon_redemptions_reserved_clean" CHECK (status <> 'reserved' OR (consumed_at IS NULL AND released_at IS NULL));
-- đếm `per_user_limit` (chỉ lượt đang chiếm chỗ)
CREATE INDEX "coupon_redemptions_active_user_idx" ON "coupon_redemptions" (coupon_id, user_id) WHERE status IN ('reserved', 'consumed');
