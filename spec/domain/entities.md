---
status: approved
---

# Entity

Cột Quan hệ: danh sách cách nhau bởi `;`, mỗi mục dạng `<1|N>-<1|N> <Entity>` (bội số từ entity này sang entity kia).
Cột Vòng đời: **đường chính** của các trạng thái nối bằng `->`, hoặc `-` nếu không có. Nhánh lỗi, hủy, hết hạn nằm ở bảng "Vòng đời chi tiết" bên dưới.

Epic DSH (Admin Dashboard) và PRJ không sở hữu entity: DSH chỉ đọc (read model) từ entity của epic khác.
Entity có vòng đời mặc định có thuộc tính `status` (trạng thái hiện tại), không liệt kê lại ở cột Thuộc tính.
`Order.payment_status` là bản sao chỉ-đọc của trạng thái Payment, ORD cập nhật khi nhận event của PAY (PaymentSucceeded, PaymentFailed, PaymentRefunded); ORD không gọi PAY.
Hồ sơ người dùng (profile, avatar) là thuộc tính của User; AUTH sở hữu User, USR sở hữu thao tác sửa hồ sơ và Address.

| Entity                 | Epic | Khóa | Thuộc tính chính                                                                                                  | Quan hệ                                                                  | Vòng đời                                |
| ---------------------- | ---- | ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| User                   | AUTH | id   | email, email_verified_at, password_hash, role, full_name, phone, avatar_url                                       | 1-N Address; 1-N Session; 1-N Order; 1-N Notification                    | active -> locked                        |
| Session                | AUTH | id   | user_id, token_hash, expires_at                                                                                   | N-1 User                                                                 | active -> revoked                       |
| PasswordResetToken     | AUTH | id   | user_id, token_hash, expires_at                                                                                   | N-1 User                                                                 | issued -> used                          |
| EmailVerificationToken | AUTH | id   | user_id, token_hash, expires_at                                                                                   | N-1 User                                                                 | issued -> used                          |
| Address                | USR  | id   | user_id, receiver, phone, ward, district, city, is_default                                                        | N-1 User                                                                 | -                                       |
| Category               | PRD  | id   | name, slug, parent_id                                                                                             | 1-N Product; N-1 Category                                                | -                                       |
| Product                | PRD  | id   | category_id, name, sku, description, price, images                                                                | N-1 Category; 1-1 StockItem; 1-N Review                                  | draft -> active -> archived             |
| StockItem              | INV  | id   | product_id, on_hand, reserved, low_stock_threshold                                                                | 1-1 Product; 1-N StockMovement; 1-N StockReservation                     | -                                       |
| StockMovement          | INV  | id   | stock_item_id, type, quantity, reason, actor_id, created_at                                                       | N-1 StockItem                                                            | -                                       |
| StockReservation       | INV  | id   | stock_item_id, order_id, quantity, expires_at                                                                     | N-1 StockItem; N-1 Order                                                 | held -> committed                       |
| Cart                   | CRT  | id   | user_id, subtotal, discount, shipping_fee, total                                                                  | N-1 User; 1-N CartItem                                                   | active -> converted                     |
| CartItem               | CRT  | id   | cart_id, product_id, quantity, unit_price                                                                         | N-1 Cart; N-1 Product                                                    | -                                       |
| Coupon                 | PRM  | id   | code, type, value, min_order_value, max_discount, expires_at, usage_limit                                         | 1-N CouponRedemption                                                     | active -> disabled                      |
| CouponRedemption       | PRM  | id   | coupon_id, order_id, user_id, amount                                                                              | N-1 Coupon; N-1 Order; N-1 User                                          | reserved -> consumed                    |
| CheckoutSession        | CHK  | id   | user_id, cart_id, address_id, shipping_method_id, payment_method, price_snapshot                                  | N-1 User; 1-1 Cart; N-1 Address; N-1 ShippingMethod; 1-1 Order           | open -> completed                       |
| Order                  | ORD  | id   | user_id, code, items_total, discount, shipping_fee, grand_total, shipping_address, payment_method, payment_status | N-1 User; 1-N OrderItem; 1-N Payment; 1-N Shipment; 1-N StockReservation | pending -> paid -> shipped -> delivered |
| OrderItem              | ORD  | id   | order_id, product_id, name_snapshot, unit_price, quantity                                                         | N-1 Order; N-1 Product                                                   | -                                       |
| Payment                | PAY  | id   | order_id, amount, method, provider_ref, attempt_no                                                                | N-1 Order; 1-N Refund                                                    | pending -> processing -> succeeded      |
| Refund                 | PAY  | id   | payment_id, amount, reason                                                                                        | N-1 Payment                                                              | requested -> succeeded                  |
| ShippingMethod         | SHP  | id   | name, base_fee, rule                                                                                              | 1-N Shipment                                                             | -                                       |
| Shipment               | SHP  | id   | order_id, shipping_method_id, tracking_number                                                                     | N-1 Order; N-1 ShippingMethod                                            | pending -> shipped -> delivered         |
| Notification           | NTF  | id   | user_id, channel, type, body, read_at                                                                             | N-1 User                                                                 | unread -> read                          |
| Review                 | REV  | id   | user_id, product_id, order_item_id, rating, comment, images                                                       | N-1 User; N-1 Product; N-1 OrderItem                                     | pending -> published                    |

## Vòng đời chi tiết

Bảng chuyển trạng thái **đầy đủ**, gồm cả nhánh lỗi, hủy, hết hạn. Mọi trạng thái trong cột Vòng đời ở bảng trên phải có ở đây,
và mọi entity có vòng đời phải có dòng ở đây. Event ở `events.md` tham chiếu trạng thái trong bảng này (cột "Phát khi").

| Entity                 | Từ         | Sang       | Điều kiện                                                                                                       |
| ---------------------- | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| User                   | active     | locked     | Quá số lần đăng nhập sai hoặc admin khóa                                                                        |
| User                   | locked     | active     | Admin mở khóa hoặc hết thời gian khóa                                                                           |
| Session                | active     | revoked    | Đăng xuất, đổi mật khẩu hoặc admin thu hồi                                                                      |
| Session                | active     | expired    | Quá hạn phiên                                                                                                   |
| PasswordResetToken     | issued     | used       | Đặt lại mật khẩu thành công                                                                                     |
| PasswordResetToken     | issued     | expired    | Quá hạn token                                                                                                   |
| EmailVerificationToken | issued     | used       | Khách bấm link xác minh, ghi email_verified_at                                                                  |
| EmailVerificationToken | issued     | expired    | Quá hạn token, khách yêu cầu gửi lại                                                                            |
| Product                | draft      | active     | Admin công bố                                                                                                   |
| Product                | active     | archived   | Admin ngừng bán                                                                                                 |
| Product                | draft      | archived   | Admin hủy bản nháp                                                                                              |
| StockReservation       | held       | committed  | Thanh toán online thành công hoặc đơn COD được xác nhận, trừ kho thật                                           |
| StockReservation       | held       | released   | Đơn bị hủy trước khi thanh toán (gồm khi thanh toán thất bại hết lượt thử: ORD hủy đơn rồi phát OrderCancelled) |
| StockReservation       | committed  | released   | Đơn đã trừ kho (paid hoặc confirmed) bị hủy trước khi giao: hoàn lại on_hand                                    |
| StockReservation       | held       | expired    | Quá hạn giữ hàng mà chưa thanh toán (INV là bên giữ đồng hồ, xem ADR-009)                                       |
| Cart                   | active     | converted  | Checkout tạo đơn thành công                                                                                     |
| Cart                   | active     | abandoned  | Không hoạt động quá hạn                                                                                         |
| Coupon                 | active     | disabled   | Admin tắt                                                                                                       |
| Coupon                 | disabled   | active     | Admin bật lại                                                                                                   |
| Coupon                 | active     | expired    | Quá ngày hết hạn                                                                                                |
| Coupon                 | active     | exhausted  | Hết lượt dùng                                                                                                   |
| Coupon                 | active     | deleted    | Admin xóa (xóa mềm)                                                                                             |
| Coupon                 | disabled   | deleted    | Admin xóa (xóa mềm)                                                                                             |
| CouponRedemption       | reserved   | consumed   | Đơn thanh toán thành công                                                                                       |
| CouponRedemption       | reserved   | released   | Đơn hủy, hết hạn hoặc thanh toán thất bại                                                                       |
| CheckoutSession        | open       | completed  | Tạo đơn thành công                                                                                              |
| CheckoutSession        | open       | expired    | Quá hạn phiên checkout                                                                                          |
| CheckoutSession        | open       | cancelled  | Khách rời checkout hoặc giá/kho không còn hợp lệ                                                                |
| Order                  | pending    | paid       | Payment succeeded                                                                                               |
| Order                  | pending    | confirmed  | Đơn COD: giữ hàng thành công, không chờ thanh toán                                                              |
| Order                  | pending    | cancelled  | Khách hoặc admin hủy trước khi thanh toán, hoặc thanh toán thất bại hết lượt thử (ORD nhận PaymentFailed)       |
| Order                  | pending    | expired    | ORD nhận StockReservationExpired (hạn giữ hàng 15 phút, thanh toán online)                                      |
| Order                  | paid       | cancelled  | Hủy trước khi giao, kích hoạt hoàn tiền                                                                         |
| Order                  | confirmed  | cancelled  | Hủy đơn COD trước khi giao, không cần hoàn tiền                                                                 |
| Order                  | paid       | shipped    | Shipment shipped (SHP phát ShipmentShipped; nhân viên thao tác ở epic SHP, ORD không tự chuyển)                 |
| Order                  | confirmed  | shipped    | Shipment shipped                                                                                                |
| Order                  | shipped    | delivered  | Shipment delivered                                                                                              |
| Payment                | pending    | processing | Gửi yêu cầu tới cổng thanh toán                                                                                 |
| Payment                | processing | succeeded  | Callback/webhook xác nhận thành công                                                                            |
| Payment                | processing | failed     | Callback/webhook báo lỗi hoặc timeout                                                                           |
| Payment                | failed     | processing | Khách thử lại (payment retry)                                                                                   |
| Payment                | pending    | succeeded  | Đơn COD: giao thành công và thu tiền (không qua processing)                                                     |
| Payment                | pending    | expired    | Quá hạn thanh toán                                                                                              |
| Payment                | pending    | cancelled  | Đơn bị hủy                                                                                                      |
| Payment                | succeeded  | refunded   | Hoàn tiền toàn phần thành công                                                                                  |
| Refund                 | requested  | succeeded  | Cổng thanh toán xác nhận hoàn                                                                                   |
| Refund                 | requested  | failed     | Cổng thanh toán từ chối hoặc lỗi                                                                                |
| Shipment               | pending    | shipped    | Bàn giao cho đơn vị vận chuyển                                                                                  |
| Shipment               | pending    | cancelled  | Đơn bị hủy trước khi bàn giao                                                                                   |
| Shipment               | shipped    | delivered  | Giao thành công                                                                                                 |
| Shipment               | shipped    | failed     | Giao thất bại                                                                                                   |
| Shipment               | failed     | returned   | Hàng hoàn về kho                                                                                                |
| Notification           | unread     | read       | Người dùng mở                                                                                                   |
| Review                 | pending    | published  | Admin duyệt (hoặc tự động nếu không bật kiểm duyệt)                                                             |
| Review                 | pending    | rejected   | Admin từ chối                                                                                                   |
| Review                 | published  | hidden     | Admin ẩn                                                                                                        |
| Review                 | published  | deleted    | Chủ review hoặc admin xóa                                                                                       |
