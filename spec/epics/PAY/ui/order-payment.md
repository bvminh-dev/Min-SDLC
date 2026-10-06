---
screen: order-payment
epic: PAY
status: draft
covers: [PAY-REQ-20261006-103110422, PAY-REQ-20261006-103110771, PAY-REQ-20261006-103111122]
roles: [customer]
---
# Thanh toán đơn hàng (bắt đầu, thử lại và xem kết quả)

Đường vào: CHK chuyển khách tới đây sau khi đặt đơn online, hoặc từ chi tiết đơn của ORD. Đường quay về từ VNPay cũng là màn này: màn **bỏ qua mọi tham số `vnp_*`** trên địa chỉ và chỉ đọc trạng thái từ `GET /payments/{id}` (PAY-REQ-20261006-103110422 BR7). **Lưu ý khác với luật evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua (trang thanh toán); màn này theo mẫu "trang chi tiết bản ghi" và trạng thái của evon, kết quả có thể chưa đẹp bằng màn quản trị.

## Wireframe
Phương án đã chọn: **A** (một thẻ trung tâm: số tiền, trạng thái, một nút hành động chính). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một thẻ trung tâm với nút hành động duy nhất (khuyên dùng, đã chọn)** | Số tiền và trạng thái ở giữa, đúng một nút chính theo trạng thái (Thanh toán, Thử lại, hoặc không có) | Khách luôn biết bước kế tiếp; ít nhầm nút | Ít chỗ cho thông tin phụ, danh sách lượt thử nằm dưới thẻ |
| B. Hai cột: tóm tắt đơn bên trái, thanh toán bên phải | Tóm tắt đơn cạnh nút thanh toán | Khách đối chiếu đơn khi trả | Phức tạp hơn; thông tin đơn đã có ở màn chi tiết đơn của ORD |
| C. Từng bước (đặt hàng, thanh toán, kết quả) | Một bước một lần | Rõ quy trình | Thêm một khung bước cho epic CHK chưa có spec; trùng với CHK |

Lý do chọn A: khách chỉ có tối đa 15 phút (hạn giữ hàng, ADR-009), nên màn phải ngắn gọn, một việc, kèm đồng hồ đếm ngược. Mọi nút gây tiền (Thanh toán, Thử lại) đều là nút duy nhất của màn tại một thời điểm.

```
Thanh header:  ☰  Đơn hàng › #7K3M9Q2XH4TB › Thanh toán                       🔔  (T)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Về đơn hàng                                                                    │
│                                                                                  │
│            ┌ Thanh toán đơn #7K3M9Q2XH4TB ─────────────────────────┐             │
│            │  350.000 đ        VNPay        (Chưa thanh toán)       │             │
│            │  Còn 12:40 để thanh toán            Lượt 0/3           │             │  <- đồng hồ tới expires_at; lượt đã thử
│            │                                                         │             │
│            │            [ Thanh toán qua VNPay ]                     │             │  <- nút chính duy nhất; Thử lại khi failed còn lượt
│            └─────────────────────────────────────────────────────────┘             │
│                                                                                  │
│            ┌ Các lượt thanh toán ──────────────┐   ┌ Hoàn tiền ────────────────┐    │
│            │ Lượt 1  Thất bại (bị từ chối)     │   │ 350.000 đ  Đã hoàn        │    │  <- chỉ khi có Refund
│            │ Lượt 2  Đang xử lý                │   └───────────────────────────┘    │
│            └───────────────────────────────────┘                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Nội dung theo trạng thái (cùng một thẻ, đổi chữ và nút): đang xử lý hiện "Đang xác nhận thanh toán với ngân hàng, vui lòng không đóng trang" và thăm dò `GET /payments/{id}` mỗi 3 giây (tối đa 10 phút); thất bại còn lượt hiện lý do (mã cố định đổi thành câu dễ hiểu, không hiện mã gốc của cổng) và nút Thử lại; hết lượt hoặc hết hạn hiện thông báo đơn sẽ bị hủy hoặc đã hết hạn và nút Về đơn hàng.

## Trạng thái
Mỗi trạng thái có vùng testid ở bảng Phần tử.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám đúng hình thẻ trung tâm (số tiền, hàng trạng thái, nút) | PAY-REQ-20261006-103111122 |
| chưa sẵn sàng | Khách tới trước khi PAY tạo Payment (danh sách theo `order_code` rỗng): "Đang chuẩn bị thanh toán..." tự thử lại sau 1 giây, tối đa 5 lần rồi chuyển sang lỗi | PAY-REQ-20261006-103110422 |
| sẵn sàng thanh toán | Payment `pending` online còn hạn: số tiền, đồng hồ đếm ngược, nút "Thanh toán qua VNPay" | PAY-REQ-20261006-103110422 |
| đang chuyển sang cổng | Nút khóa với vòng xoay, "Đang chuyển tới VNPay..." trong lúc gọi bắt đầu; bấm lặp không có tác dụng | PAY-REQ-20261006-103110422 |
| đang xử lý | Payment `processing`: "Đang xác nhận thanh toán..." kèm nút "Mở lại trang thanh toán" khi đường dẫn còn hạn (nhận lại đúng đường dẫn cũ) | PAY-REQ-20261006-103110422 |
| đang xử lý quá hạn | Đường dẫn đã hết hạn nhưng chưa có kết quả (409 `payment-in-progress`): "Ngân hàng chưa báo kết quả, hệ thống đang đối soát", không có nút thanh toán | PAY-REQ-20261006-103110422 |
| thanh toán thành công | Dấu tích, "Thanh toán thành công", số tiền; nút Về đơn hàng; không còn nút thanh toán | PAY-REQ-20261006-103111122 |
| thất bại còn lượt | Lý do bằng câu dễ hiểu, "Lượt 2/3" (số sau dấu gạch là `max_attempts` từ API, mặc định 3), nút Thử lại (`can_retry` true) | PAY-REQ-20261006-103110771 |
| thử lại đang gửi | Nút Thử lại khóa với vòng xoay; bấm lặp nhận lại cùng đường dẫn | PAY-REQ-20261006-103110771 |
| hết lượt thử | "Đã hết {max_attempts} lượt thanh toán. Đơn sẽ bị hủy." (`max_attempts` = `PAY_MAX_ATTEMPTS`, mặc định 3) (409 `attempts-exhausted`), không có nút thử lại | PAY-REQ-20261006-103110771 |
| hết hạn hoặc đơn đã đóng | "Đơn đã hết hạn thanh toán" hoặc "Đơn đã bị hủy" (409 `payment-expired`, `order-not-pending`, hoặc Payment `expired`, `cancelled`), nút Về đơn hàng | PAY-REQ-20261006-103110771 |
| số tiền ngoài khoảng | 422 `amount-out-of-range`: "Số tiền đơn không thanh toán được qua VNPay, vui lòng liên hệ cửa hàng", không có nút thanh toán | PAY-REQ-20261006-103110422 |
| đơn COD | "Thanh toán khi nhận hàng"; tiền được ghi nhận tự động khi đơn giao xong (PAY nhận OrderDelivered); không có nút thanh toán, đồng hồ hay lượt thử | PAY-REQ-20261006-103111122 |
| có hoàn tiền | Khối Hoàn tiền liệt kê từng Refund (số tiền, trạng thái đã hoàn, đang xử lý, chưa hoàn được); Refund thất bại hiện "Đang xử lý hoàn tiền, cửa hàng sẽ liên hệ" (không hiện mã lỗi) | PAY-REQ-20261006-103111122 |
| không tìm thấy | Khối "Không tìm thấy thanh toán" cùng giao diện cho Payment của người khác và không tồn tại (404), nút Về đơn hàng | PAY-REQ-20261006-103111122 |
| lỗi | Banner "Không tải được thông tin thanh toán." kèm Thử lại (lỗi mạng hoặc 5xx, và hết 5 lần chờ chuẩn bị) | PAY-REQ-20261006-103111122 |
| hết phiên | 401: thông báo "Phiên đã hết hạn" kèm nút Đăng nhập, quay lại đúng màn sau khi đăng nhập | PAY-REQ-20261006-103110422 |
| quá nhiều yêu cầu | 429: "Bạn thao tác quá nhanh, thử lại sau vài giây" kèm thời gian chờ từ `Retry-After` | PAY-REQ-20261006-103110422 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| pay-order-payment-back-link | Liên kết Về đơn hàng | customer | Mở chi tiết đơn của ORD | PAY-REQ-20261006-103111122 |
| pay-order-payment-summary | Thẻ tóm tắt: mã đơn, phương thức, trạng thái | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-amount | Số tiền cần thanh toán | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-status-badge | Badge trạng thái thanh toán (nhãn chữ, không chỉ màu) | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-countdown | Đồng hồ đếm ngược tới hạn thanh toán | customer | - | PAY-REQ-20261006-103110422 |
| pay-order-payment-attempts-count | Chữ "Lượt n/3" | customer | - | PAY-REQ-20261006-103110771 |
| pay-order-payment-pay-button | Nút Thanh toán qua VNPay | customer | Gọi bắt đầu thanh toán rồi chuyển tới trang cổng | PAY-REQ-20261006-103110422 |
| pay-order-payment-redirecting | Trạng thái đang chuyển tới cổng | customer | - | PAY-REQ-20261006-103110422 |
| pay-order-payment-preparing | Dòng "Đang chuẩn bị thanh toán" | customer | - | PAY-REQ-20261006-103110422 |
| pay-order-payment-processing | Vùng "Đang xác nhận thanh toán" | customer | - | PAY-REQ-20261006-103110422 |
| pay-order-payment-reopen-link | Nút Mở lại trang thanh toán | customer | Mở lại đúng đường dẫn cũ còn hạn | PAY-REQ-20261006-103110422 |
| pay-order-payment-reconciling | Dòng "Đang đối soát với ngân hàng" | customer | - | PAY-REQ-20261006-103110422 |
| pay-order-payment-success | Vùng thanh toán thành công | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-failed | Vùng thanh toán thất bại còn lượt | customer | - | PAY-REQ-20261006-103110771 |
| pay-order-payment-failed-reason | Lý do thất bại bằng câu dễ hiểu | customer | - | PAY-REQ-20261006-103110771 |
| pay-order-payment-retry-button | Nút Thử lại thanh toán | customer | Gọi thử lại rồi chuyển tới trang cổng | PAY-REQ-20261006-103110771 |
| pay-order-payment-exhausted | Vùng hết lượt thử | customer | - | PAY-REQ-20261006-103110771 |
| pay-order-payment-closed | Vùng hết hạn hoặc đơn đã đóng | customer | - | PAY-REQ-20261006-103110771 |
| pay-order-payment-amount-error | Vùng số tiền ngoài khoảng | customer | - | PAY-REQ-20261006-103110422 |
| pay-order-payment-cod-notice | Vùng đơn COD chưa thu tiền | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-attempt-list | Danh sách các lượt thử | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-attempt-item | Một lượt thử: số thứ tự, trạng thái, lý do | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-refund-list | Khối hoàn tiền | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-refund-item | Một hoàn tiền: số tiền, trạng thái | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-loading | Khung chờ | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-error | Banner lỗi toàn màn | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-error-retry | Nút Thử lại tải trang | customer | Tải lại thông tin thanh toán | PAY-REQ-20261006-103111122 |
| pay-order-payment-notfound | Khối "Không tìm thấy thanh toán" (404) | customer | - | PAY-REQ-20261006-103111122 |
| pay-order-payment-session-expired | Thông báo hết phiên (401) | customer | Đi tới đăng nhập | PAY-REQ-20261006-103110422 |
| pay-order-payment-ratelimited | Thông báo quá nhiều yêu cầu (429) | customer | - | PAY-REQ-20261006-103110422 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn **không bao giờ nhận số tiền hay trạng thái từ địa chỉ quay về của cổng**: đó là nơi kẻ xấu có thể thêm `vnp_ResponseCode=00` (PAY-SEC T5). Trạng thái chỉ đọc từ API.
- Chỉ có một nút gây tiền tại một thời điểm (Thanh toán hoặc Thử lại), khóa ngay khi bấm; server vẫn chặn lặp (PAY-REQ-20261006-103110422 BR6, PAY-REQ-20261006-103110771 BR5). Giao diện không tự thêm nút "thanh toán lại" khi đang xử lý.
- Lý do thất bại hiển thị là câu từ mã cố định (`cancelled_by_user`, `declined`, `timeout`, `other`, đúng `PaymentFailed.reason` của `events.md`); không bao giờ hiện mã gốc của cổng hay mã giao dịch (PAY-REQ-20261006-103111122 BR4).
- Đồng hồ đếm ngược lấy `expires_at` từ API (bản sao `payment_expires_at` của đơn, K-01); đây chỉ là gợi ý cho khách, hạn thật do INV quyết (15:00 đến 16:10) nên khi đồng hồ về 0 màn vẫn đọc lại trạng thái từ server, không tự báo hết hạn.
- Thông báo hoàn tiền của ORD trong hộp thoại hủy đơn ("xử lý riêng") nay có chỗ hiển thị kết quả ở khối Hoàn tiền của màn này; đề nghị ORD thêm liên kết "Xem thanh toán" ở `order-detail` (xem questions.md).
- Lệch với luật evon: không có; wireframe mặc định theo mẫu trang chi tiết. Không viết code giao diện; dựng thật là việc của `implement`.
