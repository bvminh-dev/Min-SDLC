---
screen: notification-list
epic: NTF
status: draft
covers: [NTF-REQ-20261006-103209345, NTF-REQ-20261006-103209256]
roles: [customer, staff, admin]
---
# Thông báo của tôi (trang lịch sử thông báo)

## Wireframe
Phương án đã chọn: **A** (danh sách dòng một cột, hàng tab Tất cả / Chưa đọc / Đã đọc phía trên, nút "Đánh dấu tất cả đã đọc" ở đầu trang, phân trang 20 thông báo). **Đây là lựa chọn mặc định** của skill (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Danh sách dòng (khuyên dùng, đã chọn)** | Chấm chưa đọc, tiêu đề, một dòng nội dung và thời gian trên cùng một dòng, mới nhất trên cùng | Tab trạng thái là bộ lọc chính; bấm dòng mở nơi liên quan và đánh dấu đã đọc | Không nhóm theo ngày (API không trả nhóm; sắp mới nhất trước đã đủ cho 180 ngày gần nhất) |
| B. Nhóm theo ngày (Hôm nay, Hôm qua, Cũ hơn) | Tiêu đề nhóm rồi các dòng | Dễ quét theo thời gian | Phân trang cắt ngang nhóm; cần dựng nhóm ở client từ `created_at` |
| C. Hai cột: danh sách bên trái, nội dung đầy đủ bên phải | Chọn dòng để xem nội dung | Hợp nội dung dài | Nội dung tối đa 500 ký tự, một dòng đủ; hai cột nặng trên điện thoại 375px |

Lý do chọn A: việc người dùng đến màn này làm là tìm lại một thông báo và biết cái nào chưa đọc; nội dung ngắn (tối đa 500 ký tự) nên không cần cột đọc riêng, và dòng gọn đọc tốt cả ở 375px.

```
Thanh header:  ☰  Thông báo                                              🔔 3  (T)
┌──────────────────────────────────────────────────────────────────────────┐
│ [Tất cả]  Chưa đọc (3)  Đã đọc          Loại: [Tất cả ▾]  [Đánh dấu tất cả đã đọc] │
├──────────────────────────────────────────────────────────────────────────┤
│ ●  Đơn hàng đang được giao                                  06/10 16:30   │  <- chưa đọc: chấm, tiêu đề đậm
│    Đơn hàng của bạn đã được bàn giao... Mã vận đơn: VTP12345678.  [Đã đọc] │
│ ●  Thanh toán thành công                                    06/10 09:05   │
│    Chúng tôi đã nhận 350.000 đ cho đơn hàng của bạn.                      │
│    Đã nhận đơn hàng                                         05/10 21:14   │  <- đã đọc: không chấm, chữ thường
│    Đơn hàng của bạn đã được tạo. Tổng tiền 350.000 đ.                     │
├──────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 25 thông báo                                ‹ 1 2 ›        │
└──────────────────────────────────────────────────────────────────────────┘
Dưới sm: tab thành nút "Chưa đọc · 3" mở danh sách; nút Đánh dấu tất cả thành mục trong menu "⋯"; dòng hai tầng (tiêu đề và giờ trên, nội dung dưới).
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | 20 dòng mới nhất trước, tab đang chọn gạch chân, tổng số ở chân, phân trang khi từ 2 trang; số chưa đọc ở tab và ở chuông | NTF-REQ-20261006-103209345 |
| chưa đọc và đã đọc | Dòng chưa đọc có chấm màu nhấn, tiêu đề đậm và nút "Đã đọc"; dòng đã đọc không chấm, chữ thường; nhãn đọc rõ không chỉ bằng màu (chấm kèm chữ ẩn "Chưa đọc" cho trình đọc màn hình) | NTF-REQ-20261006-103209256 |
| đang tải | Khung chờ đúng hình 5 dòng (chấm, tiêu đề, giờ, nội dung); đổi tab hay trang thì giữ dữ liệu cũ | NTF-REQ-20261006-103209345 |
| rỗng | "Bạn chưa có thông báo nào." một dòng chữ mờ (chưa có thông báo nào trong 180 ngày) | NTF-REQ-20261006-103209345 |
| rỗng do lọc | "Không có thông báo nào ở bộ lọc này." kèm nút "Xoá lọc"; cũng là trang trống khi đúng 20 thông báo mà vào trang 2 | NTF-REQ-20261006-103209345 |
| lỗi | Banner lỗi "Không tải được thông báo." kèm nút "Thử lại"; lỗi bộ lọc không hợp lệ (400) và quá giới hạn 120 yêu cầu mỗi phút (429, kèm "Thử lại sau ít giây") cũng vào đây | NTF-REQ-20261006-103209345 |
| đánh dấu thất bại | Toast lỗi "Không đánh dấu được, thử lại." khi một thao tác đánh dấu (một hoặc tất cả) lỗi; dòng giữ nguyên trạng thái chưa đọc | NTF-REQ-20261006-103209256 |
| hết phiên | Phiên hết hạn (401): chuyển về đăng nhập, không hiện thông báo nào | NTF-REQ-20261006-103209345 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ntf-notification-list-status-filter | Hàng tab Tất cả, Chưa đọc, Đã đọc (dropdown dưới sm) | customer, staff, admin | Chọn một trạng thái | NTF-REQ-20261006-103209345 |
| ntf-notification-list-type-filter | Ô chọn loại thông báo | customer, staff, admin | Chọn một loại hoặc Tất cả | NTF-REQ-20261006-103209345 |
| ntf-notification-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc) | customer, staff, admin | Về Tất cả | NTF-REQ-20261006-103209345 |
| ntf-notification-list-row | Dòng thông báo | customer, staff, admin | Bấm để mở nơi liên quan (nếu có link) và đánh dấu đã đọc | NTF-REQ-20261006-103209345 |
| ntf-notification-list-title | Tiêu đề trên dòng | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-body | Nội dung ngắn trên dòng (văn bản thuần, đã escape) | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-created-at | Thời điểm tạo | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-unread-dot | Chấm chưa đọc trên dòng | customer, staff, admin | - | NTF-REQ-20261006-103209256 |
| ntf-notification-list-mark-read | Nút Đã đọc trên dòng chưa đọc | customer, staff, admin | Đánh dấu một thông báo đã đọc | NTF-REQ-20261006-103209256 |
| ntf-notification-list-mark-all-read | Nút Đánh dấu tất cả đã đọc (khóa khi không có chưa đọc) | customer, staff, admin | Đánh dấu mọi thông báo chưa đọc đã đọc | NTF-REQ-20261006-103209256 |
| ntf-notification-list-unread-count | Số chưa đọc ở đầu trang (hiện "99+" khi lớn hơn 99) | customer, staff, admin | - | NTF-REQ-20261006-103209256 |
| ntf-notification-list-summary | Dòng "1 tới 20 trong 25 thông báo" | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-pagination | Phân trang ‹ 1 2 › (ẩn khi một trang) | customer, staff, admin | Sang trang khác | NTF-REQ-20261006-103209345 |
| ntf-notification-list-loading | Khung chờ | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-empty | Vùng rỗng, chưa có thông báo | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-empty-filtered | Vùng rỗng do lọc | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-error | Banner lỗi | customer, staff, admin | - | NTF-REQ-20261006-103209345 |
| ntf-notification-list-retry | Nút Thử lại | customer, staff, admin | Tải lại danh sách | NTF-REQ-20261006-103209345 |
| ntf-notification-list-toast-error | Toast lỗi đánh dấu | customer, staff, admin | - | NTF-REQ-20261006-103209256 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** màn dành cho người mua (customer) thuộc nhóm cửa hàng online mà skill chưa được dạy; màn vẫn làm theo mẫu "Danh sách có bộ lọc" và "Danh sách rỗng" của evon, kết quả có thể chưa đẹp bằng màn trong app. Staff và admin dùng cùng màn.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json`, nên không có token, component hay phong cách có sẵn; stack web theo ADR-002 (Next.js), thư viện UI và CSS chưa có ADR. Mặc định theo evon: flat (hướng A), Tailwind và `references/tokens.css`, copy tiếng Việt theo spec. Cần chốt thư viện UI khi chạy PRJ (Project setup).
- **Brief (U1, nguồn: đọc spec):** cửa hàng online; người dùng là customer, staff, admin đã đăng nhập; việc chính: biết cái gì mới và mở đúng đơn hay màn liên quan; nền tảng: cả điện thoại (375px) và máy tính.
- **Danh sách màn (U2, mặc định đã xác nhận thay người dùng):** `notification-list` (customer, staff, admin; NTF-REQ-20261006-103209345, NTF-REQ-20261006-103209256) và `notification-bell` (khung thả xuống ở thanh header; cùng hai requirement). Chín requirement còn lại là event hoặc job nội bộ do tác nhân `system`, không có màn (xem questions.md, mục C).
- Mở một dòng: nếu `link` có giá trị thì điều hướng tới đó rồi đánh dấu đã đọc (gọi POST read trước, lỗi thì vẫn điều hướng và hiện toast); nếu `link` là null (ví dụ `welcome`) thì chỉ đánh dấu đã đọc, không điều hướng.
- Tab "Chưa đọc (n)" dùng `unread_count` từ API (số toàn bộ, không theo bộ lọc `type`).
- Nhãn loại (ô lọc): Đơn hàng, Thanh toán, Vận chuyển, Hoàn tiền, Tài khoản, Tồn kho (chỉ staff và admin), mỗi nhãn ánh xạ tới một hoặc nhiều giá trị `type` ("Vận chuyển" gồm `order_shipped`, `shipment_failed`, `order_delivered`, `order_returned`; `order_returned` thêm ở nền đợt 2, M-03); ô lọc customer không có "Tồn kho". [OPEN] gom nhóm hay lọc theo từng `type` của API.
- Sắp mới nhất trước và 20 thông báo mỗi trang cố định, không có ô chọn số dòng.
- Giờ hiển thị theo giờ Việt Nam; trong 24 giờ gần nhất có thể hiện "x giờ trước" kèm giờ đầy đủ ở thuộc tính title. Nội dung là văn bản thuần, giao diện escape (SB-12).
- Không viết code giao diện; dựng thật là việc của `implement`.
