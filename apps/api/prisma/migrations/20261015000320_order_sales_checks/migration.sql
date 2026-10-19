-- ORD-DB-20261006-092703753 (đợt bán hộ 2026-10-15, Lần 1 bước 5): CHECK dùng giá trị enum mới (`cash`, `bank_transfer`) nên ở migration SAU 20261015000300_order_sales_enums.
-- Chỉ đơn hộ (`created_by` có giá trị) mới có `cash`, `bank_transfer`. Đơn cũ đều là vnpay hoặc cod nên CHECK khớp.

ALTER TABLE "orders" ADD CONSTRAINT "orders_ho_payment_method" CHECK (payment_method IN ('vnpay', 'cod') OR created_by IS NOT NULL);
