-- REV-DB-20261006-103618216 (Migration 1 đến 2): bảng của module review (reviews, review_images) cùng hai enum (review_status, review_actor_role).
-- Thứ tự giữa module: sau AUTH (users), PRD (products), ORD (order_items). Khóa ngoại chỉ tới bảng của REV và ba bảng đó (cột Phụ thuộc của REV, SB-35), ON DELETE RESTRICT.
-- Chỉ mục duy nhất một phần và chỉ mục một phần theo status là SQL thô (Prisma không biểu diễn được). Không có dữ liệu mồi.
-- Rollback (chỉ an toàn khi chưa có đánh giá thật): DROP TABLE "review_images", "reviews"; DROP TYPE "review_actor_role", "review_status"; sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('pending', 'published', 'rejected', 'hidden', 'deleted');

-- CreateEnum
CREATE TYPE "review_actor_role" AS ENUM ('customer', 'admin');

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'pending',
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "moderation_reason" TEXT,
    "moderated_by" UUID,
    "moderated_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "edited_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_role" "review_actor_role",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "reviews_comment_len" CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 2000),
    CONSTRAINT "reviews_moderation_reason_len" CHECK ("moderation_reason" IS NULL OR char_length("moderation_reason") BETWEEN 1 AND 500),
    CONSTRAINT "reviews_deleted_consistent" CHECK (("status" = 'deleted') = ("deleted_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "review_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "review_id" UUID,
    "position" SMALLINT,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "orphaned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_images_position_range" CHECK ("position" BETWEEN 1 AND 5),
    CONSTRAINT "review_images_attached_consistent" CHECK (("review_id" IS NULL) = ("position" IS NULL)),
    CONSTRAINT "review_images_storage_key_shape" CHECK ("storage_key" ~ '^reviews/[0-9a-f-]{36}\.webp$'),
    CONSTRAINT "review_images_width_range" CHECK ("width" > 0 AND "width" <= 1600),
    CONSTRAINT "review_images_height_range" CHECK ("height" > 0 AND "height" <= 1600),
    CONSTRAINT "review_images_bytes_positive" CHECK ("bytes" > 0)
);

-- CreateIndex
CREATE INDEX "reviews_user_id_created_at_id_idx" ON "reviews"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "reviews_status_created_at_id_idx" ON "reviews"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "reviews_status_product_id_created_at_idx" ON "reviews"("status", "product_id", "created_at" DESC);

-- Chỉ mục duy nhất một phần (SQL thô): mỗi dòng đơn và mỗi (người dùng, sản phẩm) chỉ có một đánh giá chưa xóa; `deleted` nhường chỗ.
CREATE UNIQUE INDEX "reviews_order_item_live_key" ON "reviews" ("order_item_id") WHERE "status" <> 'deleted';
CREATE UNIQUE INDEX "reviews_user_product_live_key" ON "reviews" ("user_id", "product_id") WHERE "status" <> 'deleted';

-- Chỉ mục một phần cho danh sách công khai và `summary` (SQL thô).
CREATE INDEX "reviews_public_list_idx" ON "reviews" ("product_id", "published_at" DESC, "id" DESC) WHERE "status" = 'published';
CREATE INDEX "reviews_public_rating_idx" ON "reviews" ("product_id", "rating") WHERE "status" = 'published';

-- CreateIndex
CREATE UNIQUE INDEX "review_images_storage_key_key" ON "review_images"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "review_images_review_id_position_key" ON "review_images"("review_id", "position");

-- CreateIndex
CREATE INDEX "review_images_review_id_idx" ON "review_images"("review_id");

-- Chỉ mục cho job dọn ảnh chưa gắn (SQL thô, theo biểu thức).
CREATE INDEX "review_images_sweep_idx" ON "review_images" ((COALESCE("orphaned_at", "created_at"))) WHERE "review_id" IS NULL;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
