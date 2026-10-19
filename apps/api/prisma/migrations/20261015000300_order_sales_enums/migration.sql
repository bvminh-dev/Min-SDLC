-- ORD-DB-20261006-092703753 (đợt bán hộ 2026-10-15, Lần 1 bước 5): giá trị enum mới ở migration RIÊNG, không dùng trong cùng migration (PostgreSQL không cho dùng giá trị enum
-- vừa thêm trong giao dịch tạo nó). CHECK dùng `cash`, `bank_transfer` nằm ở migration sau (20261015000320_order_sales_checks).
-- Bước MỞ RỘNG: bản ứng dụng cũ không biết ba giá trị này, chỉ chạy cùng dữ liệu cho tới khi SAL bắt đầu tạo đơn hộ.
-- Rollback: PostgreSQL không có DROP VALUE; giá trị thừa vô hại (forward-only).

ALTER TYPE "order_payment_method" ADD VALUE IF NOT EXISTS 'cash';
ALTER TYPE "order_payment_method" ADD VALUE IF NOT EXISTS 'bank_transfer';
ALTER TYPE "order_actor_role" ADD VALUE IF NOT EXISTS 'sale';
