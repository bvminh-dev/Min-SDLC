---
screen: notification-bell
epic: NTF
status: draft
covers: [NTF-REQ-20261006-103209256, NTF-REQ-20261006-103209345]
roles: [customer, staff, admin]
---
# Chuông thông báo (khung thả xuống ở thanh header)

## Wireframe
Phương án đã chọn: **A** (nút chuông kèm huy hiệu số chưa đọc; bấm mở khung thả xuống 5 thông báo mới nhất, nút "Đánh dấu tất cả đã đọc" và liên kết "Xem tất cả"). **Đây là lựa chọn mặc định** của skill (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Chuông và khung thả xuống (khuyên dùng, đã chọn)** | Số chưa đọc trên chuông; 5 thông báo mới nhất trong khung | Xem nhanh không rời trang; sang màn đầy đủ qua "Xem tất cả" | Khung nhỏ, chỉ 5 dòng; trên điện thoại khung phủ gần hết chiều ngang |
| B. Chuông bấm đi thẳng tới trang `notification-list` | Chỉ huy hiệu số | Ít thành phần nhất | Mỗi lần xem phải rời trang đang làm |
| C. Ngăn kéo bên phải (drawer) | Danh sách dài hơn, cuộn được | Xem nhiều thông báo mà không rời trang | Nặng hơn cho việc chỉ muốn biết có tin mới; che nội dung trang |

Lý do chọn A: người dùng muốn biết có tin mới và mở nhanh cái liên quan trong lúc đang làm việc khác (khách xem đơn, staff xử lý kho); 5 thông báo là đủ, phần còn lại ở trang đầy đủ.

```
Thanh header:  ☰  Cửa hàng                                         🔔 [3]  (T)
                                                                  ┌──────────────────────────────┐
                                                                  │ Thông báo      [Đánh dấu tất cả đã đọc] │
                                                                  ├──────────────────────────────┤
                                                                  │ ● Đơn hàng đang được giao    │
                                                                  │   ... Mã vận đơn: VTP12345678. 16:30 │
                                                                  │ ● Thanh toán thành công      │
                                                                  │   Đã nhận 350.000 đ            09:05 │
                                                                  │   Đã nhận đơn hàng           │
                                                                  │   Tổng tiền 350.000 đ       21:14 │
                                                                  ├──────────────────────────────┤
                                                                  │ Xem tất cả thông báo →       │
                                                                  └──────────────────────────────┘
Dưới sm: khung rộng gần kín chiều ngang màn hình, bám dưới thanh header; chạm ngoài khung hoặc phím Esc để đóng.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Huy hiệu số chưa đọc trên chuông (ẩn khi 0, "99+" khi lớn hơn 99); khung có tối đa 5 dòng mới nhất, dòng chưa đọc có chấm và tiêu đề đậm | NTF-REQ-20261006-103209345 |
| chưa đọc và đã đọc | Số trên huy hiệu giảm khi đánh dấu; nút "Đánh dấu tất cả đã đọc" khóa khi không còn chưa đọc | NTF-REQ-20261006-103209256 |
| đang tải | Khung chờ 3 dòng trong khung thả xuống; huy hiệu giữ số cũ | NTF-REQ-20261006-103209345 |
| rỗng | "Chưa có thông báo nào." trong khung, chuông không huy hiệu | NTF-REQ-20261006-103209345 |
| lỗi | Dòng lỗi "Không tải được thông báo." kèm nút "Thử lại" trong khung; lỗi đếm chưa đọc thì giấu huy hiệu, không chặn chuông; 429 hiện "Thử lại sau ít giây" | NTF-REQ-20261006-103209345 |
| hết phiên | Phiên hết hạn (401): chuông biến mất, chuyển về đăng nhập khi thao tác tiếp | NTF-REQ-20261006-103209345 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ntf-notification-bell-trigger | Nút chuông trên header | customer, staff, admin | Mở hoặc đóng khung thả xuống | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-badge | Huy hiệu số chưa đọc (ẩn khi 0, "99+" khi lớn hơn 99) | customer, staff, admin | - | NTF-REQ-20261006-103209256 |
| ntf-notification-bell-panel | Khung thả xuống | customer, staff, admin | Đóng bằng Esc hoặc chạm ngoài | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-row | Dòng thông báo trong khung | customer, staff, admin | Bấm để mở nơi liên quan và đánh dấu đã đọc | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-unread-dot | Chấm chưa đọc trên dòng | customer, staff, admin | - | NTF-REQ-20261006-103209256 |
| ntf-notification-bell-mark-all-read | Nút Đánh dấu tất cả đã đọc | customer, staff, admin | Đánh dấu mọi thông báo chưa đọc đã đọc | NTF-REQ-20261006-103209256 |
| ntf-notification-bell-view-all | Liên kết Xem tất cả thông báo | customer, staff, admin | Mở trang `notification-list` | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-loading | Khung chờ | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-empty | Vùng rỗng | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-error | Dòng lỗi trong khung | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-bell-retry | Nút Thử lại | customer, staff, admin | Tải lại 5 thông báo | NTF-REQ-20261006-103209345 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** chuông nằm trên thanh header của cả giao diện người mua (nhóm skill chưa được dạy) lẫn trang quản trị; khung thả xuống theo mẫu menu và popover của evon, kết quả có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json`, nên không có token, component hay phong cách có sẵn; stack web theo ADR-002 (Next.js), thư viện UI chưa có ADR. Mặc định theo evon: flat, Tailwind và `references/tokens.css`.
- **Brief (U1, nguồn: đọc spec):** mọi người dùng đã đăng nhập; việc chính: biết có tin mới và mở nhanh; hiện ở mọi trang có header.
- Nguồn dữ liệu: huy hiệu lấy từ `GET /api/v1/notifications/unread-count`; khung lấy `GET /api/v1/notifications?limit=5` khi mở. Làm mới huy hiệu mỗi 60 giây khi tab đang mở (mặc định; chưa có kênh đẩy thời gian thực như WebSocket hay SSE, [OPEN] xem questions.md), tức 1 yêu cầu mỗi phút, xa dưới hạn mức 120 yêu cầu mỗi phút (SB-14).
- Mở một dòng như màn `notification-list`: có `link` thì điều hướng và đánh dấu đã đọc; không có thì chỉ đánh dấu.
- Khung chỉ hiện thông báo mới nhất, không lọc; muốn lọc phải sang `notification-list`.
- Không viết code giao diện; dựng thật là việc của `implement`.
