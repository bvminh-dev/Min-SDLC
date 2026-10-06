---
screen: admin-payment-detail
epic: PAY
status: draft
covers: [PAY-REQ-20261006-103110597, PAY-REQ-20261006-103111034, PAY-REQ-20261006-103111211]
roles: [staff, admin]
---
# Chi tiết thanh toán (đối soát, ghi nhận COD, hoàn tiền)

Staff và admin xem đầy đủ một thanh toán: lượt thử, nhật ký webhook, hoàn tiền. Hai hành động tiền: ghi nhận đã thu COD (staff và admin) và hoàn tiền thủ công, thử lại hoàn tiền (chỉ admin).

## Wireframe
Phương án đã chọn: **A** (trang chi tiết bản ghi: tóm tắt và hành động ở đầu trang, các khối đối soát bên dưới). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Đầu trang tóm tắt cộng hành động, bên dưới các khối đối soát (khuyên dùng, đã chọn)** | Trạng thái và hành động thấy ngay, lịch sử đối soát cuộn bên dưới | Hành động tiền nằm đúng chỗ với bản ghi, có hộp thoại xác nhận | Trang dài nếu nhiều lượt thử |
| B. Chia tab Tổng quan, Lượt thử, Webhook, Hoàn tiền | Một khối một lần | Trang ngắn | Nhân viên đối soát phải bấm nhiều tab để đối chiếu |
| C. Khung chi tiết bên phải của danh sách | Cạnh bảng | Không đổi trang | Hành động tiền cần trang đủ chỗ và xác nhận rõ |

```
Thanh header:  ☰  Quản trị › Thanh toán › #7K3M9Q2XH4TB                         🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Về danh sách                                                                   │
│ Thanh toán #7K3M9Q2XH4TB  (Đã thanh toán)  VNPay  350.000 đ                        │
│ [Ghi nhận đã thu COD]            [Hoàn tiền]                                      │  <- COD (dự phòng của thu tự động): staff, admin; Hoàn tiền: chỉ admin, chỉ khi succeeded và online
│                                                                                  │
│ ┌ Thông tin ───────────────────┐  ┌ Hoàn tiền ──────────────────────────────────┐ │
│ │ Mã giao dịch cổng 14012345    │  │ 06/10 11:00  350.000 đ  Thất bại (3/3) [Thử lại] │ │  <- Thử lại chỉ admin; cùng một dòng Refund
│ │ User id 5f0c…                 │  │                                              │ │
│ │ Hết hạn 09:15, thu lúc 09:08  │  └──────────────────────────────────────────────┘ │
│ └───────────────────────────────┘  ┌ Lượt thử ────────────────────────────────────┐ │
│ ┌ Nhật ký webhook ──────────────┐  │ Lượt 1  Thất bại  declined  (mã cổng 51)      │ │
│ │ 09:07  RspCode 00  xác nhận    │  │ Lượt 2  Thành công                            │ │
│ │ 09:07  RspCode 02  lặp         │  └────────────────────────────────────────────────┘ │
│ └────────────────────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────────────────┘

Hộp thoại Ghi nhận đã thu COD (có ô nhập nên không đóng khi bấm ra ngoài, luật I20 của evon):
┌ Ghi nhận đã thu COD cho đơn #A93K...? ────────────────────┐
│ Số tiền phải thu 180.000 đ                                  │
│ Số tiền đã thu [ 180000 ]   Ghi chú (tùy chọn, ≤ 200) [   ] │
│                              [Hủy]  [Xác nhận đã thu]        │
└─────────────────────────────────────────────────────────────┘

Hộp thoại Hoàn tiền (chỉ admin):
┌ Hoàn toàn phần 350.000 đ cho đơn #7K3M...? ───────────────┐
│ Hoàn tiền không thể hoàn tác và không đổi trạng thái đơn.   │
│ Lý do (bắt buộc, 5 đến 300 ký tự) [                       ] │
│                              [Hủy]  [Xác nhận hoàn tiền]     │
└─────────────────────────────────────────────────────────────┘
```

Hoàn tiền chỉ toàn phần (ADR-005), không có ô nhập số tiền. Thử lại hoàn tiền cũng qua một hộp thoại xác nhận ngắn (không có ô nhập).

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung chờ đúng hình các khối | PAY-REQ-20261006-103111211 |
| có dữ liệu | Đầu trang có mã đơn, badge trạng thái, phương thức, số tiền; các khối thông tin, lượt thử, nhật ký webhook, hoàn tiền | PAY-REQ-20261006-103111211 |
| không tìm thấy | "Không tìm thấy thanh toán" (404) kèm nút Về danh sách | PAY-REQ-20261006-103111211 |
| không có quyền | 403 (customer mở màn): "Bạn không có quyền xem trang này" | PAY-REQ-20261006-103111211 |
| hết phiên | 401: "Phiên đã hết hạn" kèm nút Đăng nhập | PAY-REQ-20261006-103111211 |
| lỗi | Banner "Không tải được thanh toán." kèm Thử lại (lỗi mạng hoặc 5xx) | PAY-REQ-20261006-103111211 |
| chưa có lượt thử, chưa có webhook | Khối lượt thử và nhật ký hiện "Chưa có" (Payment COD hoặc chưa bắt đầu) | PAY-REQ-20261006-103111211 |
| hoàn tiền thất bại | Dòng Refund `failed` hiện lý do mã và nút Thử lại (chỉ admin); staff không thấy nút | PAY-REQ-20261006-103111211 |
| nút COD ẩn | Nút Ghi nhận đã thu COD (đường dự phòng; PAY tự thu khi đơn giao xong) chỉ có khi Payment COD ở `pending`; ẩn với Payment online và khi đã `succeeded` | PAY-REQ-20261006-103110597 |
| nút hoàn tiền ẩn | Nút Hoàn tiền chỉ có với admin khi Payment online ở `succeeded` và chưa có Refund đang hoạt động; ẩn với staff, COD, Payment khác | PAY-REQ-20261006-103111034 |
| hộp thoại COD | Hộp thoại có ô số tiền (điền sẵn số phải thu) và ghi chú; nút Hủy và Xác nhận đã thu | PAY-REQ-20261006-103110597 |
| COD đang ghi | Nút Xác nhận khóa với vòng xoay, hai ô khóa | PAY-REQ-20261006-103110597 |
| COD thành công | Hộp thoại đóng, badge thành "Đã thanh toán", thông báo "Đã ghi nhận thu tiền" | PAY-REQ-20261006-103110597 |
| COD bị từ chối | Lỗi trong hộp thoại: 409 đơn chưa giao ("Đơn chưa được giao"), 409 đã ghi nhận, 409 không phải COD, 422 số tiền không khớp ("Số tiền phải đúng 180.000 đ"), 400 dữ liệu sai; 403 hoặc 401 khi hết quyền hoặc phiên | PAY-REQ-20261006-103110597 |
| hộp thoại hoàn tiền | Hộp thoại có ô lý do bắt buộc 5 đến 300 ký tự, cảnh báo không hoàn tác; nút Hủy và Xác nhận hoàn tiền | PAY-REQ-20261006-103111034 |
| đang hoàn tiền | Nút Xác nhận khóa với vòng xoay; ô lý do khóa; sau 202 hiện Refund `requested` "Đang xử lý" | PAY-REQ-20261006-103111034 |
| hoàn tiền thành công | Hộp thoại đóng, Refund `succeeded` trong khối Hoàn tiền, badge Payment thành "Đã hoàn tiền" | PAY-REQ-20261006-103111034 |
| hoàn tiền bị từ chối | Lỗi trong hộp thoại: 409 không hoàn được ở trạng thái này, 409 đang có hoàn tiền xử lý, 409 đã có hoàn tiền thất bại (dùng Thử lại), 422 COD chưa hỗ trợ hoàn, 400 lý do sai (rỗng, ngắn, dài), cổng từ chối hiện Refund `failed` kèm lý do chung | PAY-REQ-20261006-103111034 |
| thử lại hoàn tiền | Hộp thoại xác nhận ngắn; thành công đổi chính dòng Refund thất bại về `requested` (không thêm dòng mới); 409 `refund-in-progress` hiện "Đã có hoàn tiền đang xử lý" | PAY-REQ-20261006-103111034 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| pay-admin-payment-detail-back-link | Liên kết Về danh sách | staff, admin | Về danh sách thanh toán | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-order-code | Mã đơn | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-status-badge | Badge trạng thái thanh toán | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-method | Phương thức | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-amount | Số tiền | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-info | Khối thông tin (mã giao dịch cổng, user id, hạn, thời điểm thu) | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-attempt-list | Khối lượt thử | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-attempt-item | Một lượt thử: trạng thái, lý do, mã cổng | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-webhook-list | Khối nhật ký webhook | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-webhook-item | Một dòng nhật ký: thời điểm, RspCode, kết quả | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-refund-list | Khối hoàn tiền | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-refund-item | Một hoàn tiền: số tiền, lý do, trạng thái | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-refund-retry | Nút Thử lại của Refund thất bại | admin | Mở hộp thoại thử lại | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-retry-confirm | Nút Xác nhận thử lại hoàn tiền | admin | Gọi thử lại hoàn tiền | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-retry-dismiss | Nút Hủy trong hộp thoại thử lại | admin | Đóng hộp thoại | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-cod-button | Nút Ghi nhận đã thu COD | staff, admin | Mở hộp thoại thu COD | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-dialog | Hộp thoại ghi nhận thu COD | staff, admin | - | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-due | Dòng số tiền phải thu | staff, admin | - | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-amount | Ô số tiền đã thu | staff, admin | Nhập số tiền | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-note | Ô ghi chú (tối đa 200 ký tự) | staff, admin | Nhập ghi chú | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-confirm | Nút Xác nhận đã thu | staff, admin | Gửi ghi nhận thu COD | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-dismiss | Nút Hủy trong hộp thoại COD | staff, admin | Đóng hộp thoại | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-error | Vùng lỗi trong hộp thoại COD | staff, admin | - | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-cod-success | Thông báo "Đã ghi nhận thu tiền" | staff, admin | - | PAY-REQ-20261006-103110597 |
| pay-admin-payment-detail-refund-button | Nút Hoàn tiền | admin | Mở hộp thoại hoàn tiền | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-dialog | Hộp thoại hoàn tiền | admin | - | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-warning | Dòng cảnh báo không hoàn tác và không đổi trạng thái đơn | admin | - | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-reason | Ô lý do hoàn tiền (5 đến 300 ký tự) | admin | Nhập lý do | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-confirm | Nút Xác nhận hoàn tiền | admin | Gửi hoàn tiền | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-dismiss | Nút Hủy trong hộp thoại hoàn tiền | admin | Đóng hộp thoại | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-error | Vùng lỗi trong hộp thoại hoàn tiền | admin | - | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-refund-success | Thông báo hoàn tiền đã gửi hoặc thành công | admin | - | PAY-REQ-20261006-103111034 |
| pay-admin-payment-detail-loading | Khung chờ | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-error | Banner lỗi toàn màn | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-retry | Nút Thử lại tải trang | staff, admin | Tải lại thanh toán | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-notfound | Khối "Không tìm thấy thanh toán" (404) | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-forbidden | Thông báo không có quyền (403) | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-detail-session-expired | Thông báo hết phiên (401) | staff, admin | Đi tới đăng nhập | PAY-REQ-20261006-103111211 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Phần tử chỉ dành cho admin (hoàn tiền, thử lại hoàn tiền) ghi đúng role `admin`; staff không thấy chúng và API cũng trả 403 (PAY-REQ-20261006-103111034 BR1). Nút COD cho cả staff và admin (PAY-REQ-20261006-103110597 BR3).
- Hộp thoại có ô nhập (COD, hoàn tiền) không đóng khi bấm ra ngoài (luật `I20` của evon); hoàn tiền là thao tác không hoàn tác nên có xác nhận rõ và cảnh báo (PAY-REQ-20261006-103111034 BR7).
- Nút COD là đường dự phòng: PAY tự thu COD khi nhận OrderDelivered (PAY-REQ-20261006-103110597 BR3), nên nút chỉ cần khi event chưa xử lý.
- Ô số tiền COD điền sẵn số phải thu nhưng sửa được, vì server mới là nơi kiểm khớp (422); giao diện không tự coi là khớp.
- Không hiển thị tên, email, điện thoại khách; chỉ `user id` nội bộ (SB-08). Mã giao dịch cổng và mã lỗi gốc chỉ có ở màn này, không có ở màn của khách. Mọi chuỗi do người dùng nhập (ghi chú, lý do) hiển thị dạng văn bản đã escape (SB-12).
- Màn khác với luật evon: nhật ký webhook là danh sách thời gian cũ nhất trước (đối soát theo thứ tự xảy ra); không có lệch với requirement.
- Không viết code giao diện; dựng thật là việc của `implement`.
