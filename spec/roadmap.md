---
status: approved
---

# Roadmap: ecommerce

Mỗi hàng là một epic. Cột Mã là tiền tố ID dùng khắp spec.

| STT | Mã   | Epic               | Mục con                                                                                                                                                                         |
| --- | ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | PRJ  | Project prepare    | Project setup; Database setup; API structure; Environment configuration; Error handling; Logging                                                                                |
| 02  | AUTH | Auth               | Register; Login; Logout; Session / Token; Forgot password; Reset password; Role & permission                                                                                    |
| 03  | USR  | User Management    | User profile; Edit profile; Change password; Upload avatar; Address                                                                                                             |
| 04  | PRD  | Product & Category | Category; Product; Product information; Product discovery                                                                                                                       |
| 05  | INV  | Inventory          | Stock quantity; Stock in; Stock out; Stock adjustment; Stock reservation; Low stock warning; Inventory history; Prevent overselling                                             |
| 06  | CRT  | Shopping Cart      | Add product; Update quantity; Remove product; Clear cart; Calculate subtotal; Apply discount; Calculate shipping fee; Calculate total; Validate stock                           |
| 07  | PRM  | Promotion          | Create coupon; Edit coupon; Delete coupon; Enable / Disable coupon; Percentage discount; Fixed amount discount; Minimum order value; Maximum discount; Expiry date; Usage limit |
| 08  | CHK  | Checkout           | Select shipping address; Select shipping method; Select payment method; Apply coupon; Review order; Validate price; Validate stock; Reserve stock; Create order                 |
| 09  | ORD  | Order Management   | Order listing; Order detail; Order status; Order history; Cancel order                                                                                                          |
| 10  | PAY  | Payment            | Create payment; Payment processing; Payment success; Payment failed; Payment callback / webhook; Payment retry; Refund; Payment history                                         |
| 11  | SHP  | Shipping           | Shipping method; Shipping fee; Create shipment; Tracking number; Shipping status; Shipping history                                                                              |
| 12  | NTF  | Notification       | In-app notification; Email notification; Order created; Payment successful; Order shipped; Order delivered; Password reset; Read / Unread; Notification history                 |
| 13  | REV  | Product Review     | Create review; Rating; Comment; Upload images; Edit review; Delete review; Verified purchase; Admin moderation                                                                  |
| 14  | DSH  | Admin Dashboard    | Total revenue; Total orders; Total customers; Total products; Low stock products; Recent orders; Revenue report; Order report; Product report                                   |

## Nguồn khảo sát

- Yêu cầu của người dùng (ý tưởng sản phẩm ecommerce) và tài liệu `DECISIONS-ecommerce.md`.
- Khảo sát sản phẩm tương tự **chưa kiểm chứng**: dựa trên kiến thức chung về cửa hàng trực tuyến, chưa đối chiếu sản phẩm cụ thể nào.

## Giả định và câu hỏi mở

Giả định:
- Thị trường Việt Nam, tiền tệ VND.
- Đội nhỏ.
- Chỉ web; không có app di động.
- Một cửa hàng; không có sàn nhiều người bán.
- Thanh toán bằng VNPay và COD.

Ghi chú A-07: trong roadmap "Reserve stock" đứng trước "Create order", nhưng theo ADR-009 thực tế tạo Order `pending` rồi mới giữ hàng. "Validate price" / "Validate stock" và "Reserve stock" là các bước trong giao dịch đặt hàng, không phải màn hình hay endpoint riêng.
