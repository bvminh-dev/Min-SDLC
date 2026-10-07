-- USR-DB-20261006-101342348 (Migration 1 đến 3): bảng addresses của module user. Thứ tự giữa module: platform, auth (users), rồi user.
-- Prisma không biểu diễn CHECK, regex và chỉ mục một phần nên các phần đó viết tay ở cuối. Không có dữ liệu mồi; không đụng bảng users.
-- Rollback (chỉ an toàn khi chưa có người dùng thật vì mất dữ liệu cá nhân): DROP TABLE "addresses"; sau đó chỉ tiến.

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "receiver" TEXT NOT NULL,
    "phone" CHAR(10) NOT NULL,
    "line1" TEXT NOT NULL,
    "ward" TEXT NOT NULL,
    "district" TEXT,
    "city" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc và chỉ mục ngoài Prisma
ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_receiver_len" CHECK (length(receiver) BETWEEN 1 AND 100),
  ADD CONSTRAINT "addresses_phone_format" CHECK (phone ~ '^0[35789][0-9]{8}$'),
  ADD CONSTRAINT "addresses_line1_len" CHECK (length(line1) BETWEEN 1 AND 200),
  ADD CONSTRAINT "addresses_ward_len" CHECK (length(ward) BETWEEN 1 AND 100),
  ADD CONSTRAINT "addresses_city_len" CHECK (length(city) BETWEEN 1 AND 100),
  ADD CONSTRAINT "addresses_district_len" CHECK (district IS NULL OR length(district) BETWEEN 1 AND 100),
  ADD CONSTRAINT "addresses_default_not_deleted" CHECK (NOT (is_default AND deleted_at IS NOT NULL));
-- tối đa một địa chỉ mặc định chưa xóa mỗi người (lưới an toàn sau khóa tư vấn theo người dùng)
CREATE UNIQUE INDEX "addresses_one_default_idx" ON "addresses" ("user_id") WHERE is_default AND deleted_at IS NULL;
-- danh sách và chọn mặc định kế tiếp
CREATE INDEX "addresses_user_live_idx" ON "addresses" ("user_id", "created_at" DESC, "id" DESC) WHERE deleted_at IS NULL;
-- job xóa cứng sau 30 ngày
CREATE INDEX "addresses_deleted_at_idx" ON "addresses" ("deleted_at") WHERE deleted_at IS NOT NULL;
