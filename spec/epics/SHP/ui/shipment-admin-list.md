---
screen: shipment-admin-list
epic: SHP
status: draft
covers: [SHP-REQ-20261006-101103927]
roles: [staff, admin]
---
# Vận đơn (staff và admin xem hàng đợi, lọc, tìm)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một khối, hàng tab trạng thái phía trên, ô tìm theo mã đơn hoặc mã vận đơn, phân trang 20 vận đơn). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng dữ liệu (khuyên dùng, đã chọn)** | Mã đơn, mã vận đơn, phương thức, trạng thái, ngày tạo cùng một hàng | Tab trạng thái và ô tìm đứng trên bảng; hàng bấm để mở chi tiết | Bố cục dày, hợp màn làm việc cả ngày của nhân viên kho; dưới `sm` thành danh sách dòng |
| B. Bảng kanban theo trạng thái | Cột pending, shipped, failed | Nhìn cả luồng vận đơn | Kanban gợi kéo thả để đổi trạng thái, mà mỗi chuyển cần nhập (mã vận đơn, lý do); loại |
| C. Danh sách và panel chi tiết hai cột | Chọn vận đơn bên trái, thao tác bên phải | Xử lý nhanh không rời trang | Hai cột cộng sidebar làm danh sách chật dưới 1600px; panel chứa hộp thoại nhập liệu nặng |

Lý do chọn A: việc chính là tìm các vận đơn đang chờ bàn giao hoặc đang giao rồi mở xử lý; thứ để so sánh giữa các vận đơn là trạng thái, ngày tạo và mã. Bảng không có cột hành động nào đổi dữ liệu: mọi thao tác nằm ở màn chi tiết (`shipment-admin-detail`) vì mỗi thao tác cần nhập thêm (mã vận đơn, lý do).

```
Thanh header:  ☰  Vận chuyển › Vận đơn                                     🔔  (T)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Chờ bàn giao  Đang giao  Đã giao  Giao thất bại  Đã hoàn  Đã hủy         │
│ [Tìm theo: Mã đơn ▾] [ Nhập mã đơn hoặc mã vận đơn          ]   Sắp xếp: Mới nhất ▾ │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Mã đơn         Mã vận đơn     Phương thức      Trạng thái       Ngày tạo            │
│ 7K3M9Q2XH4TB   GHN12345678    Giao tiêu chuẩn  (Đang giao)      06/10 09:05          │
│ 5FQ2H8B7C1ZD   —              Giao nhanh       (Chờ bàn giao)   06/10 08:40          │
│ 2N6R4T8W0KLA   VTP99887766    Giao nhanh       (Giao thất bại)  05/10 14:02          │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 45 vận đơn                                        ‹ 1 2 3 ›        │
└──────────────────────────────────────────────────────────────────────────────────┘
Hàng bấm được mở chi tiết vận đơn của đơn đó. Không cột email, tên, điện thoại, địa chỉ (SB-08).
```

Dưới `@4xl` ẩn cột Phương thức và Ngày tạo; dưới `sm` thành danh sách dòng theo `list-row.md`. Mã đơn và mã vận đơn dùng `font-mono`; giá trị trống là `—`.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | 20 dòng, tổng ở chân, tab và ô tìm giữ giá trị đang dùng; nhãn trạng thái đọc rõ không chỉ bằng màu | SHP-REQ-20261006-101103927 |
| đang tải | Khung chờ đúng hình hàng bảng; đổi lọc, tìm hay trang thì giữ dữ liệu cũ mờ đi | SHP-REQ-20261006-101103927 |
| rỗng | "Chưa có vận đơn nào." một dòng chữ mờ (hệ thống chưa có vận đơn) | SHP-REQ-20261006-101103927 |
| rỗng do tìm hoặc lọc | "Không có vận đơn nào khớp." kèm nút "Xoá lọc"; tìm không khớp, hoặc trang quá cuối khi đúng 20 vận đơn, đều vào đây | SHP-REQ-20261006-101103927 |
| lỗi | Banner "Không tải được danh sách vận đơn." kèm "Thử lại"; lỗi bộ lọc không hợp lệ (400) cũng vào đây | SHP-REQ-20261006-101103927 |
| hết phiên | 401: hộp thoại phiên đã hết hạn, nút về đăng nhập | SHP-REQ-20261006-101103927 |
| không có quyền | Customer mở màn này (403): trang lỗi "Bạn không có quyền xem trang này" kèm nút về trang chủ | SHP-REQ-20261006-101103927 |
| trạng thái vận đơn | Badge trạng thái hiện tại của vận đơn trên mỗi dòng | SHP-REQ-20261006-101103927 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| shp-shipment-admin-list-status-filter | Hàng tab lọc trạng thái | staff, admin | Chọn một trạng thái hoặc Tất cả | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-search-by | Danh sách chọn Mã đơn hoặc Mã vận đơn | staff, admin | Chọn trường tìm | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-search | Ô tìm (khớp chính xác, không tìm theo email hay điện thoại) | staff, admin | Nhập mã rồi tìm | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-sort | Danh sách chọn Mới nhất hoặc Cũ nhất | staff, admin | Đổi thứ tự | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc hoặc tìm) | staff, admin | Gỡ lọc và từ khoá | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-row | Hàng vận đơn | staff, admin | Bấm để mở chi tiết | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-order-code | Mã đơn (font-mono) | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-tracking | Mã vận đơn hoặc `—` | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-method | Tên phương thức vận chuyển | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-status-badge | Badge trạng thái vận đơn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-created-at | Ngày tạo | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-summary | Dòng "1 tới 20 trong 45 vận đơn" | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-pagination | Phân trang ‹ 1 2 3 › (ẩn khi một trang) | staff, admin | Sang trang khác | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-loading | Khung chờ | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-empty | Vùng rỗng, chưa có vận đơn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-empty-filtered | Vùng rỗng do tìm hoặc lọc | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-error | Banner lỗi | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-retry | Nút Thử lại | staff, admin | Tải lại danh sách | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-session-expired | Hộp thoại phiên đã hết hạn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-forbidden | Trang không có quyền (customer) | staff, admin | - | SHP-REQ-20261006-101103927 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn này không có nút đổi trạng thái: bàn giao, sửa mã, giao xong, thất bại, hoàn hàng đều ở `shipment-admin-detail`. Staff và admin dùng chung màn vì cùng quyền xem trong ma trận; không phần tử nào chỉ dành cho một role.
- Mặc định tab "Tất cả" và sắp mới nhất trước theo API (SHP-REQ-20261006-101103927 BR6, BR7, [NEEDS CLARIFICATION] chưa được người dùng xác nhận). Gợi ý vận hành: mở sẵn tab "Chờ bàn giao" kèm "Cũ nhất", để chưa làm vì requirement không nói.
- "Không có quyền" ghi role `staff, admin` vì check-ui chỉ nhận role của màn; người thấy trạng thái này thật ra là customer (ghi ở questions.md, mục D).
- Ô tìm khớp chính xác (không tìm theo email, điện thoại), nên placeholder nói rõ là mã đơn hoặc mã vận đơn.
