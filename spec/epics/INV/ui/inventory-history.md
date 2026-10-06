---
screen: inventory-history
epic: INV
status: draft
covers: [INV-REQ-20261006-101122637]
roles: [staff, admin]
---
# Lịch sử biến động kho của một sản phẩm

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu có bộ lọc loại và khoảng thời gian). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng dữ liệu (khuyên dùng, đã chọn)** | Thời gian, loại, thay đổi, còn lại, lý do, người làm, tham chiếu trên một hàng | Bộ lọc loại và khoảng ngày đứng trên bảng | Hợp việc đối chiếu số liệu theo dòng; dưới `sm` thành danh sách dòng |
| B. Dòng thời gian dọc (timeline) | Mỗi biến động là một nút trên trục | Đọc như câu chuyện | Mẫu `timeline.md` của evon đặt mới nhất ở trên nhưng khó so cột số; 20 dòng mỗi trang làm trục rất dài; khó so `on_hand_after` giữa các dòng |
| C. Biểu đồ đường tồn kho theo ngày | Xu hướng | Thấy toàn cảnh | Requirement chỉ đòi bảng; biểu đồ thuộc báo cáo của DSH; loại |

Lý do chọn A: việc chính là đối chiếu khi số liệu lệch, cần so `Thay đổi` và `Còn lại` giữa các dòng liền nhau (INV-REQ-20261006-101122637 BR6). Thứ tự mới nhất trước theo requirement (BR2), trùng với mặc định của bảng trong evon.

```
Thanh header:  ☰  Tồn kho › Áo thun cotton › Lịch sử                                 🔔  (T)
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ← Quay lại chi tiết tồn kho                                                         │
│ Loại: [Tất cả ▾]   Từ: [2026-10-01]   Đến: [2026-10-07]   [Lọc]  [Xoá lọc]          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Thời gian       Loại        Thay đổi  Còn lại  Lý do / Ghi chú         Người   Đơn    │
│ 06/10 09:05     Bán            -2       48     -                       Hệ thống 7K3M… │
│ 06/10 09:00     Nhập kho      +40       50     Nhập từ NCC · PN-0912   Lan T.   -     │
│ 05/10 16:20     Điều chỉnh     -3       10     Kiểm kê: thiếu 3 hộp    Minh P.  -     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 5 dòng                                               ‹ 1 ›            │
└─────────────────────────────────────────────────────────────────────────────────────┘
Chỉ đọc: không có nút sửa hay xóa dòng nào. Số Thay đổi có dấu cộng hoặc trừ, căn phải.
```

## Trạng thái
Testid của vùng trạng thái nằm trong bảng Phần tử bên dưới (nêu trong ngoặc).

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Tối đa 20 dòng mới nhất trước, tổng số dòng ở chân, bộ lọc giữ giá trị đang dùng (`inv-inventory-history-row`) | INV-REQ-20261006-101122637 |
| đang tải | Khung chờ đúng hình hàng bảng; đổi lọc hay trang thì giữ dữ liệu cũ mờ đi (`inv-inventory-history-loading`) | INV-REQ-20261006-101122637 |
| rỗng | "Sản phẩm này chưa có biến động kho nào." (`inv-inventory-history-empty`) | INV-REQ-20261006-101122637 |
| rỗng do lọc | "Không có biến động nào khớp." kèm nút "Xoá lọc"; trang quá cuối (200, rỗng) cũng vào đây (`inv-inventory-history-empty-filtered`) | INV-REQ-20261006-101122637 |
| lỗi | Banner "Không tải được lịch sử kho." kèm "Thử lại"; lỗi tham số (400, ví dụ Từ sau Đến, khoảng quá 366 ngày) hiện thông báo đó trong cùng banner; quá giới hạn tần suất (429) hiện "Thao tác quá nhanh, thử lại sau N giây" trong cùng banner; chưa đăng nhập (401) về đăng nhập (`inv-inventory-history-error`) | INV-REQ-20261006-101122637 |
| không tìm thấy | Khối căn giữa: "404" mờ, "Không tìm thấy bản ghi kho", nút "Về danh sách tồn kho" (`inv-inventory-history-not-found`) | INV-REQ-20261006-101122637 |
| không có quyền | Customer mở màn này (403) thấy trang lỗi chung của web (khung ứng dụng chung, epic PRJ), không có testid ở đây | INV-REQ-20261006-101122637 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| inv-inventory-history-back | Liên kết Quay lại chi tiết tồn kho | staff, admin | Về chi tiết tồn kho | INV-REQ-20261006-101122637 |
| inv-inventory-history-type-filter | Bộ lọc loại (chọn nhiều: Nhập kho, Xuất kho, Điều chỉnh, Bán, Hoàn nhả, Hoàn về) | staff, admin | Chọn một hoặc nhiều loại | INV-REQ-20261006-101122637 |
| inv-inventory-history-from | Ô ngày bắt đầu | staff, admin | Chọn ngày (tính cả ngày này) | INV-REQ-20261006-101122637 |
| inv-inventory-history-to | Ô ngày kết thúc | staff, admin | Chọn ngày (không tính ngày này) | INV-REQ-20261006-101122637 |
| inv-inventory-history-apply | Nút Lọc | staff, admin | Áp bộ lọc | INV-REQ-20261006-101122637 |
| inv-inventory-history-clear-filter | Nút Xoá lọc | staff, admin | Gỡ mọi bộ lọc | INV-REQ-20261006-101122637 |
| inv-inventory-history-row | Hàng biến động | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-time | Thời gian | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-type | Nhãn loại biến động (chữ, không chỉ màu) | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-quantity | Số thay đổi có dấu, căn phải | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-on-hand-after | Số còn lại sau biến động, căn phải | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-reason | Lý do và ghi chú | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-actor | Người thao tác (hoặc Hệ thống) | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-ref | Mã đơn hoặc vận đơn tham chiếu | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-summary | Dòng "1 tới 20 trong 5 dòng" | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-pagination | Phân trang (ẩn khi một trang) | staff, admin | Sang trang khác | INV-REQ-20261006-101122637 |
| inv-inventory-history-loading | Khung chờ | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-empty | Vùng rỗng, chưa có biến động | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-empty-filtered | Vùng rỗng do lọc | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-error | Banner lỗi | staff, admin | - | INV-REQ-20261006-101122637 |
| inv-inventory-history-retry | Nút Thử lại | staff, admin | Tải lại lịch sử | INV-REQ-20261006-101122637 |
| inv-inventory-history-not-found | Khối không tìm thấy | staff, admin | - | INV-REQ-20261006-101122637 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn chỉ đọc: không có nút sửa, xóa hay thêm dòng (INV-REQ-20261006-101122637 BR5); dòng `sale`, `restock`, `return` do hệ thống ghi (`actor.id` rỗng, `name` = `system`), hiển thị Người là "Hệ thống". Dòng do staff, admin thao tác hiện `actor.name`; khi `actor.name` rỗng (INV chưa có đường lấy tên hiển thị: `AUTH.getDisplayNames` của nền chỉ có cho REV, R-10 chờ người quyết; questions.md "Nền còn thiếu") hiện `actor.id` rút gọn. Hàng hoàn về không bán lại được (`restockable` = false) không tạo dòng lịch sử nên không hiện ở đây.
- Tên nhãn loại: `in` Nhập kho, `out` Xuất kho, `adjust` Điều chỉnh, `sale` Bán, `restock` Hoàn nhả (đơn bị hủy sau khi trừ kho), `return` Hoàn về (hàng giao thất bại quay về kho).
- **Lệch với mẫu evon:** mẫu `timeline.md` đặt mới nhất ở trên và cho phép dạng timeline; màn này dùng bảng vì cần so cột số, vẫn mới nhất ở trên nên không mâu thuẫn requirement.
- Ngày lọc gửi lên theo giờ UTC, hiển thị theo múi giờ của trình duyệt; khoảng tối đa 366 ngày được kiểm cả ở giao diện lẫn server.
- Cột Đơn hiện mã đơn khi có (đã rút gọn); không liên kết sang màn đơn vì INV không phụ thuộc ORD (liên kết ở màn là việc của khung web, [OPEN] ghi ở questions.md).
