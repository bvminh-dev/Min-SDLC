# Kết quả chạy eval foundation (2026-10-05), ecommerce 14 epic

| | Lần 1 | Lần 2 (sau khi thêm cột "Phát khi" + bảng chuyển trạng thái kiểm cứng) |
|---|---|---|
| Script | qua | qua |
| Entity / Event / ADR / SB | 22 / 16 / 8 / 24 | 22 / 34 / 10 / 25 |
| Event có trạng thái tương ứng trong vòng đời | **không** (StockReleased, PaymentFailed, OrderCancelled thiếu trạng thái) | có, 52 dòng chuyển trạng thái gồm nhánh lỗi/hủy/hết hạn |
| Reservation gắn với Order (bẫy F1) | không | có (N-1 Order; Order bắt đầu ở pending; ADR-009) |
| Phá vòng ORD-PAY bằng event (F2) | có | có |
| Role staff riêng (G1) | gộp admin, [OPEN] | gộp admin, [OPEN] |
| Quyết định công nghệ ghi accepted | không | không (10 ADR đều proposed + [OPEN]) |

Hạn chế: mỗi bản chạy một lần, không có đối chứng prompt trần (khác eval research), chấm bằng đọc file và grep.
Mẫu đầu ra lần 2 nằm ở `ecommerce/sample-output/` để tham chiếu.
