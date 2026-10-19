-- PRD-DB-20261006-095502781 mục Migration 6 (đợt bán hàng hộ 2026-10-15): thêm `products.cost_price` (giá vốn, SB-42: chỉ admin đọc và ghi).
-- Tương thích ngược: cột NULL được, không giá trị mặc định (PostgreSQL không viết lại bảng); mã cũ không đụng cột này, dòng cũ nhận NULL. Triển khai: migration trước, mã mới sau.
-- Rollback: bỏ ràng buộc products_cost_price_check rồi bỏ cột cost_price (mất giá vốn đã nhập, chỉ làm khi chưa dùng thật; sau đó chỉ tiến).

-- AlterTable
ALTER TABLE "products" ADD COLUMN "cost_price" BIGINT;

-- Ràng buộc ngoài Prisma: giá vốn 0..1.000.000.000 hoặc NULL (chưa có giá vốn).
ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_check" CHECK (cost_price IS NULL OR cost_price BETWEEN 0 AND 1000000000);
