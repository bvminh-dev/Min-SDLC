-- PRD-DB-20261006-095502781 (Migration 1 đến 3): bảng của module catalog (categories, products, product_images, product_review_ratings).
-- Thứ tự giữa module: platform, auth, user, catalog. Không có khóa ngoại sang bảng module khác, không có dữ liệu mồi.
-- Prisma không biểu diễn extension, CHECK, regex, chỉ mục một phần, GIN trigram, unique hoãn được: các phần đó viết tay ở cuối.
-- Rollback (chỉ an toàn khi chưa có dữ liệu thật): DROP TABLE "product_review_ratings", "product_images", "products", "categories"; DROP TYPE "image_type", "product_status";
--   DROP EXTENSION "pg_trgm", "unaccent"; sau đó chỉ tiến (forward-only).

-- Extension tìm kiếm (ADR-019): pg_trgm cho khớp con bằng GIN; unaccent cài sẵn (chuẩn hóa bỏ dấu do ứng dụng làm khi ghi `search_text`, vì unaccent không IMMUTABLE nên không dùng trong chỉ mục).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;


-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "image_type" AS ENUM ('jpeg', 'png', 'webp');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parent_id" UUID,
    "depth" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "price" BIGINT NOT NULL,
    "status" "product_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(6),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "search_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" "image_type" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_review_ratings" (
    "review_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_review_ratings_pkey" PRIMARY KEY ("review_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_status_category_id_published_at_id_idx" ON "products"("status", "category_id", "published_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "products_status_price_id_idx" ON "products"("status", "price", "id");

-- CreateIndex
CREATE INDEX "products_updated_at_id_idx" ON "products"("updated_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storage_key_key" ON "product_images"("storage_key");

-- CreateIndex
-- unique (product_id, position) hoãn được (đồng thời là chỉ mục (product_id, position) của PRD-DB): đổi thứ tự ảnh trong một câu UPDATE, thêm ở phần dưới

-- CreateIndex
CREATE INDEX "product_review_ratings_product_id_idx" ON "product_review_ratings"("product_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_review_ratings" ADD CONSTRAINT "product_review_ratings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc và chỉ mục ngoài Prisma
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT "categories_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "categories_depth_range" CHECK (depth BETWEEN 1 AND 3),
  ADD CONSTRAINT "categories_depth_root" CHECK ((parent_id IS NULL) = (depth = 1));
-- tên duy nhất trong cùng cha, không phân biệt hoa thường (danh mục gốc có chỉ mục riêng vì NULL không bằng NULL)
CREATE UNIQUE INDEX "categories_parent_name_key" ON "categories" ("parent_id", lower(name)) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX "categories_root_name_key" ON "categories" (lower(name)) WHERE parent_id IS NULL;

ALTER TABLE "products"
  ADD CONSTRAINT "products_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT "products_sku_format" CHECK (sku ~ '^[A-Z0-9_-]{3,40}$'),
  ADD CONSTRAINT "products_description_len" CHECK (description IS NULL OR length(description) <= 5000),
  ADD CONSTRAINT "products_price_range" CHECK (price BETWEEN 1 AND 1000000000),
  ADD CONSTRAINT "products_active_has_published_at" CHECK (status <> 'active' OR published_at IS NOT NULL),
  ADD CONSTRAINT "products_rating_count_nonneg" CHECK (rating_count >= 0),
  ADD CONSTRAINT "products_rating_sum_nonneg" CHECK (rating_sum >= 0);
-- tìm kiếm khớp con theo tên và sku đã chuẩn hóa (ADR-019)
CREATE INDEX "products_search_text_trgm_idx" ON "products" USING GIN ("search_text" gin_trgm_ops);

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_size_positive" CHECK (width > 0 AND height > 0),
  ADD CONSTRAINT "product_images_bytes_range" CHECK (bytes BETWEEN 1 AND 5242880),
  ADD CONSTRAINT "product_images_position_range" CHECK (position BETWEEN 1 AND 8);
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_position_key" UNIQUE ("product_id", "position") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "product_review_ratings"
  ADD CONSTRAINT "product_review_ratings_rating_range" CHECK (rating BETWEEN 1 AND 5);
