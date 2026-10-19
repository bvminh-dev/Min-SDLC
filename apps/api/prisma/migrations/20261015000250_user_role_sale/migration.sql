-- AUTH-DB-20261006-100006037 (mục 6, đợt bán hộ 2026-10-15): thêm role `sale`. Migration riêng, KHÔNG câu nào khác dùng `'sale'`
-- (PostgreSQL không cho dùng giá trị enum mới trong cùng giao dịch tạo nó). Không đổi cột, không khóa bảng `users`.
-- Rollback: PostgreSQL không có DROP VALUE; giữ giá trị trong enum (vô hại), đưa người dùng `sale` về role khác bằng đổi role (forward-only).
ALTER TYPE "user_role" ADD VALUE 'sale';
