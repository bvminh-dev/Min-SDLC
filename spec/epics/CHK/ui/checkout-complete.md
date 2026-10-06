---
screen: checkout-complete
epic: CHK
status: draft
covers: [CHK-REQ-20261006-105052127, CHK-REQ-20261006-105052272]
roles: [customer]
---
# Đặt hàng thành công: đơn COD đã xác nhận, đơn VNPay chờ thanh toán

## Wireframe
Phương án đã chọn: **A** (một thẻ kết quả: mã đơn, trạng thái, hạn thanh toán nếu có, một nút việc kế tiếp). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một thẻ kết quả, một nút chính theo phương thức (khuyên dùng, đã chọn)** | Mã đơn, trạng thái và việc kế tiếp ở giữa | VNPay: nút Thanh toán ngay kèm đếm ngược; COD: nút Xem đơn hàng | Ít chỗ cho thông tin phụ (liệt kê hàng nằm ở chi tiết đơn của ORD) |
| B. Tự chuyển ngay tới màn thanh toán của PAY, không có màn kết quả | Khách thấy màn PAY ngay | Ít một bước cho đơn VNPay | COD vẫn cần màn kết quả; lỗi chuyển trang khó giải thích |
| C. Trang cảm ơn dài kèm gợi ý mua thêm | Nội dung marketing ở dưới kết quả | Tăng bán thêm | Ngoài phạm vi CHK; làm loãng việc phải làm trong 15 phút của đơn VNPay |

Lý do chọn A: đơn VNPay chỉ có 15 phút giữ hàng (ADR-009) nên khách phải thấy hạn và nút Thanh toán ngay; đơn COD không có việc nào phải làm tiếp, chỉ cần xác nhận rõ (CHK-REQ-20261006-105052272 BR5, BR6).

```
VNPay (đơn pending)                               COD (đơn confirmed)
┌ Đã tạo đơn #7K3M9Q2XH4TB ─────────────────┐     ┌ Đặt hàng thành công #7K3M9Q2XH4TB ────────┐
│ Tổng cộng 345.000 đ          VNPay         │     │ Tổng cộng 180.000 đ        COD             │
│ Hàng được giữ tới 10:15 (còn 14:20)         │     │ Đơn đã xác nhận. Trả tiền khi nhận hàng.   │
│ [ Thanh toán ngay ]  [ Xem đơn hàng ]       │     │ [ Xem đơn hàng ]   [ Tiếp tục mua sắm ]    │
│ ⚠ Quá hạn mà chưa trả thì đơn tự hết hạn   │     └────────────────────────────────────────────┘
└────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang đặt | Khung chờ một thẻ kèm "Đang tạo đơn" (cùng lúc nút Đặt hàng ở màn `checkout` đang khóa) | CHK-REQ-20261006-105052272 | chk-checkout-complete-loading |
| đơn VNPay chờ thanh toán | Mã đơn, tổng, hạn giữ hàng với đếm ngược, nút Thanh toán ngay, cảnh báo quá hạn thì đơn hết hạn | CHK-REQ-20261006-105052127 | chk-checkout-complete-online |
| đơn COD đã xác nhận | Mã đơn, tổng, "Đơn đã xác nhận, trả tiền khi nhận hàng", không có đếm ngược hay nút thanh toán | CHK-REQ-20261006-105052272 | chk-checkout-complete-cod |
| đã đặt rồi (mở lại hoặc bấm đôi) | Cùng thẻ kết quả của đơn đã tạo, không tạo đơn thứ hai (phản hồi phát lại) | CHK-REQ-20261006-105052272 | chk-checkout-complete-replayed |
| lỗi | Banner "Không tải được kết quả đặt hàng, đơn của bạn có thể đã được tạo, xem trong danh sách đơn" kèm liên kết (lỗi 503 khi đọc kết quả phiên) | CHK-REQ-20261006-105052272 | chk-checkout-complete-error |
| hết phiên đăng nhập | "Phiên đăng nhập đã hết hạn" kèm liên kết Đăng nhập (401) | CHK-REQ-20261006-105052272 | chk-checkout-complete-login-expired |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| chk-checkout-complete-loading | Khung chờ | customer | - | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-order-code | Mã đơn (font-mono) | customer | - | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-total | Tổng cộng của đơn | customer | - | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-online | Khối đơn VNPay chờ thanh toán | customer | - | CHK-REQ-20261006-105052127 |
| chk-checkout-complete-deadline | Hạn giữ hàng và đếm ngược | customer | - | CHK-REQ-20261006-105052127 |
| chk-checkout-complete-pay-now | Nút Thanh toán ngay (sang màn `order-payment` của PAY) | customer | Mở màn thanh toán của đơn | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-expiry-warning | Cảnh báo quá hạn thì đơn tự hết hạn | customer | - | CHK-REQ-20261006-105052127 |
| chk-checkout-complete-cod | Khối đơn COD đã xác nhận | customer | - | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-replayed | Nhãn đơn đã được đặt trước đó | customer | - | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-view-order | Nút Xem đơn hàng (sang chi tiết đơn của ORD) | customer | Mở chi tiết đơn | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-continue-shopping | Nút Tiếp tục mua sắm | customer | Mở trang sản phẩm | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-error | Banner lỗi kèm liên kết tới danh sách đơn | customer | Mở danh sách đơn | CHK-REQ-20261006-105052272 |
| chk-checkout-complete-login-expired | Thông báo hết phiên đăng nhập kèm liên kết Đăng nhập | customer | Mở màn đăng nhập | CHK-REQ-20261006-105052272 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill chưa được dạy cho cửa hàng online phía người mua (kết quả đặt hàng); màn theo mẫu thẻ trạng thái, kết quả có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json`, mặc định flat và copy tiếng Việt; chỉ wireframe ASCII, không dựng HTML hay probe (việc của implement).
- Đồng hồ đếm ngược dùng `payment_deadline` = `payment_expires_at` của Order (CHK tính một lần, K-01); vẫn chỉ là **gợi ý** vì INV chạy job hết hạn thật (mỗi phút, thực tế 15:00 đến 16:10, CHK-REQ-20261006-105052127 BR3, BR10); màn thanh toán của PAY có đồng hồ riêng nhỏ hơn hoặc bằng hạn đó (đường dẫn 10 phút, ADR-009).
- Nút Thanh toán ngay chỉ chuyển sang màn `order-payment` của PAY; CHK không tạo Payment và không gọi cổng. Nếu PAY chưa tạo kịp Payment thì màn của PAY tự thử lại (PAY questions câu 27).
- Mở lại phiên đã `completed` (nút quay lại của trình duyệt, bấm đôi) hiện đúng thẻ kết quả của đơn đã tạo, không có nút đặt lại (CHK-REQ-20261006-105051681 BR9, CHK-REQ-20261006-105052272 BR4).
- Đơn đặt xong không còn sửa được ở đây; hủy đơn ở chi tiết đơn của ORD (ORD-REQ-20261006-092320834). Đơn VNPay hết hạn hay bị hủy thì giỏ đã mất hàng và khách phải thêm lại [OPEN] (xem questions.md).
- Mã đơn hiển thị dạng văn bản thường đã escape (SB-12); màn không hiện địa chỉ hay điện thoại (SB-08).
- Không viết code giao diện; dựng thật là việc của `implement`.
