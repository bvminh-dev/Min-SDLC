# Bẫy nằm trong roadmap

| # | Bẫy | Đạt khi |
|---|---|---|
| F1 | **Reserve trước Create order** (CHK liệt kê Reserve stock rồi Create order) trong khi giữ hàng cần gắn với một đơn | Vòng đời Order có trạng thái đầu (ví dụ pending) tạo trước, Reservation tham chiếu Order; nêu rõ trong entities/ADR |
| F2 | **Vòng phụ thuộc ORD ↔ PAY ↔ CHK**: thanh toán cần đơn, đơn cần biết đã thanh toán | Phá vòng bằng sự kiện (PaymentSucceeded → ORD cập nhật), không để module gọi lẫn nhau. Script bắt nếu còn vòng |
| F3 | **Ba nơi cùng "Validate stock"** (INV Prevent overselling, CRT Validate stock, CHK Validate stock) và hai nơi "Apply discount/coupon" (CRT, PRM, CHK) | Nêu epic sở hữu quy tắc (INV cho tồn kho, PRM cho giảm giá), các epic khác gọi chứ không tự cài lại |
| F4 | **Role ngầm**: roadmap không ghi staff/admin nhưng nhiều mục con cần | roles.md có staff, admin kèm mô tả; không bỏ sót |
| F5 | **Quyết định công nghệ không có trong roadmap** (stack, DB, cổng thanh toán) | ADR proposed + [OPEN], không tự chốt |
