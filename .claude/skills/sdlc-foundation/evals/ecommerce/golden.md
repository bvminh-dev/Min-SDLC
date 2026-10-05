# Golden: nền cho ecommerce (14 epic)

## MUST
- G1. `roles.md` có ít nhất: guest, customer, staff, admin. (Roadmap ngầm cần staff/admin: Stock in/out/adjustment, Create coupon, Admin moderation, Admin Dashboard.)
- G2. Entity cho các danh từ chính: User, Address, Product, Category, StockItem, Reservation, Cart, CartItem, Coupon, Order, OrderItem, Payment, Shipment, Notification, Review. Mỗi entity một epic sở hữu.
- G3. Entity có vòng đời có trạng thái liệt kê: Order, Payment, Shipment, Reservation, Coupon (tối thiểu).
- G4. Event do producer duy nhất phát; NTF là consumer của các sự kiện Order/Payment/Shipment/Auth, không phải producer của chúng.
- G5. Bảng module không có vòng phụ thuộc (script kiểm) và AUTH/PRJ không phụ thuộc vào epic nghiệp vụ.
- G6. 6 mối quan tâm cắt ngang trỏ về ADR có phương án đã loại và hệ quả.
- G7. Quyết định công nghệ chưa có người trả lời thì ADR là `proposed` kèm `[OPEN]`, không `accepted`.
- G8. Security baseline có dòng cho: hash mật khẩu và khóa tài khoản, quản lý phiên/token, kiểm quyền phía server (không tin client), xác thực chữ ký webhook thanh toán, idempotency khi thanh toán, không lưu dữ liệu thẻ, kiểm tra loại và kích thước file upload (avatar, ảnh review), log sự kiện bảo mật không chứa bí mật.
- G9. Mỗi dòng SB-nn có cách kiểm chạy được.
- G10. Constitution có nguyên tắc về spec-trước-code và thay đổi spec đi qua impact.

## SHOULD
- G11. Nêu rõ quyết định về tiền (kiểu dữ liệu, làm tròn) và múi giờ/thời gian.
- G12. Nêu chiến lược tính nhất quán giữa Inventory, Order, Payment (giao dịch hay sự kiện bù trừ).
