---
screen: shipment-admin-list
epic: SHP
status: approved
covers: [SHP-REQ-20261006-101103927]
roles: [staff, sale, admin]
---
# Vận đơn (staff, sale và admin xem hàng đợi, lọc, tìm)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một khối, hàng tab trạng thái phía trên, ô tìm theo mã đơn hoặc mã vận đơn, phân trang 20 vận đơn; thêm các cột Khách, Điện thoại, Địa chỉ, Sale tạo đơn theo SB-08 (d)). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng dữ liệu (khuyên dùng, đã chọn)** | Mã đơn, mã vận đơn, khách, điện thoại, địa chỉ, sale tạo đơn, phương thức, trạng thái, ngày tạo cùng một hàng | Tab trạng thái và ô tìm đứng trên bảng; hàng bấm để mở chi tiết | Bố cục dày, hợp màn làm việc cả ngày của nhân viên kho và sale; dưới `sm` thành danh sách dòng |
| B. Bảng kanban theo trạng thái | Cột pending, shipped, failed | Nhìn cả luồng vận đơn | Kanban gợi kéo thả để đổi trạng thái, mà mỗi chuyển cần nhập (mã vận đơn, lý do); loại |
| C. Danh sách và panel chi tiết hai cột | Chọn vận đơn bên trái, thao tác bên phải | Xử lý nhanh không rời trang | Hai cột cộng sidebar làm danh sách chật dưới 1600px; panel chứa hộp thoại nhập liệu nặng |

Lý do chọn A: việc chính là tìm các vận đơn đang chờ bàn giao hoặc đang giao rồi mở xử lý; thứ để so sánh giữa các vận đơn là trạng thái, ngày tạo và mã. Bảng không có cột hành động nào đổi dữ liệu: mọi thao tác nằm ở màn chi tiết (`shipment-admin-detail`) vì mỗi thao tác cần nhập thêm (mã vận đơn, lý do).

```
Thanh header:  ☰  Vận chuyển › Vận đơn                                                              🔔  (T)
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Chờ bàn giao  Đang giao  Đã giao  Giao thất bại  Đã hoàn  Đã hủy                                      │
│ [Tìm theo: Mã đơn ▾] [ Mã đơn (HD261015-00001 hoặc mã cũ) hoặc mã vận đơn ]   Sắp xếp: Mới nhất ▾              │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Mã đơn          Mã vận đơn   Khách         Điện thoại   Địa chỉ                    Sale      Phương thức  Trạng thái    Ngày tạo │
│ HD261015-00007  GHN12345678  Nguyễn Văn An 0901234567   12 Lê Lợi, Bến Nghé, TP.HCM Trần Thu  Giao tiêu chuẩn (Đang giao) 15/10 09:05 │
│ HD261015-00006  —            Đỗ Thị Dung   0987654321   9 Nguyễn Huệ, Bến Nghé, ...  —         Giao nhanh   (Chờ bàn giao) 15/10 08:40 │
│ 2N6R4T8W0KLA    VTP99887766  Lê Thị Bích   —            —                           —         Giao nhanh   (Đã giao)     05/10 14:02 │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 45 vận đơn                                                                  ‹ 1 2 3 ›          │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Staff, admin: hàng bấm được mở chi tiết vận đơn của đơn đó. Sale: chỉ thấy vận đơn của đơn mình tạo, hàng không bấm được (sale không có chi tiết ở v1).
Điện thoại và địa chỉ chỉ có khi vận đơn Chờ bàn giao, Đang giao, Giao thất bại; Đã giao, Đã hoàn, Đã hủy hiện `—` (SB-08 (d)). Không cột email.
```

Dưới `@4xl` ẩn cột Điện thoại, Địa chỉ, Phương thức và Ngày tạo; dưới `sm` thành danh sách dòng theo `list-row.md` (Khách và Sale tạo đơn giữ lại). Mã đơn (cả mã mới `HDyymmdd-NNNNN` lẫn mã 12 ký tự của đơn cũ) và mã vận đơn dùng `font-mono`; giá trị trống hoặc bị ẩn theo trạng thái là `—`. Địa chỉ dài cắt một dòng, đủ chữ ở `title`.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | 20 dòng kèm khách, điện thoại, địa chỉ, sale tạo đơn (điện thoại, địa chỉ chỉ khi vận đơn đang xử lý, còn lại `—`), tổng ở chân, tab và ô tìm giữ giá trị đang dùng; nhãn trạng thái đọc rõ không chỉ bằng màu | SHP-REQ-20261006-101103927 |
| đang tải | Khung chờ đúng hình hàng bảng; đổi lọc, tìm hay trang thì giữ dữ liệu cũ mờ đi | SHP-REQ-20261006-101103927 |
| rỗng | "Chưa có vận đơn nào." một dòng chữ mờ (hệ thống chưa có vận đơn; với sale: chưa có vận đơn của đơn do mình tạo) | SHP-REQ-20261006-101103927 |
| rỗng do tìm hoặc lọc | "Không có vận đơn nào khớp." kèm nút "Xoá lọc"; tìm không khớp, hoặc trang quá cuối khi đúng 20 vận đơn, đều vào đây | SHP-REQ-20261006-101103927 |
| lỗi | Banner "Không tải được danh sách vận đơn." kèm "Thử lại"; lỗi bộ lọc không hợp lệ (400), lỗi 500 (kể cả không ghi được audit hay không lấy được thông tin khách, không có trang một phần) cũng vào đây | SHP-REQ-20261006-101103927 |
| hết phiên | 401: hộp thoại phiên đã hết hạn, nút về đăng nhập | SHP-REQ-20261006-101103927 |
| không có quyền | Customer mở màn này (403): trang lỗi "Bạn không có quyền xem trang này" kèm nút về trang chủ | SHP-REQ-20261006-101103927 |
| trạng thái vận đơn | Badge trạng thái hiện tại của vận đơn trên mỗi dòng | SHP-REQ-20261006-101103927 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| shp-shipment-admin-list-status-filter | Hàng tab lọc trạng thái | staff, sale, admin | Chọn một trạng thái hoặc Tất cả | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-search-by | Danh sách chọn Mã đơn hoặc Mã vận đơn | staff, sale, admin | Chọn trường tìm | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-search | Ô tìm (khớp chính xác, không tìm theo email hay điện thoại) | staff, sale, admin | Nhập mã rồi tìm | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-sort | Danh sách chọn Mới nhất hoặc Cũ nhất | staff, sale, admin | Đổi thứ tự | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc hoặc tìm) | staff, sale, admin | Gỡ lọc và từ khoá | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-row | Hàng vận đơn | staff, sale, admin | Bấm để mở chi tiết (staff, admin; hàng của sale không bấm được) | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-order-code | Mã đơn `HDyymmdd-NNNNN` hoặc mã cũ 12 ký tự (font-mono) | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-customer-name | Tên khách (luôn có) | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-phone | Điện thoại hoặc `—` (vận đơn đã giao, hoàn, hủy) | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-address | Địa chỉ một dòng hoặc `—` (vận đơn đã giao, hoàn, hủy) | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-created-by-name | Tên sale tạo đơn hoặc `—` (đơn khách tự đặt) | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-tracking | Mã vận đơn hoặc `—` | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-method | Tên phương thức vận chuyển | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-status-badge | Badge trạng thái vận đơn | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-created-at | Ngày tạo | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-summary | Dòng "1 tới 20 trong 45 vận đơn" | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-pagination | Phân trang ‹ 1 2 3 › (ẩn khi một trang) | staff, sale, admin | Sang trang khác | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-loading | Khung chờ | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-empty | Vùng rỗng, chưa có vận đơn | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-empty-filtered | Vùng rỗng do tìm hoặc lọc | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-error | Banner lỗi | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-retry | Nút Thử lại | staff, sale, admin | Tải lại danh sách | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-session-expired | Hộp thoại phiên đã hết hạn | staff, sale, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-list-forbidden | Trang không có quyền (customer) | staff, sale, admin | - | SHP-REQ-20261006-101103927 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn này không có nút đổi trạng thái: bàn giao, sửa mã, giao xong, thất bại, hoàn hàng đều ở `shipment-admin-detail`. Staff, sale và admin dùng chung màn vì cùng được xem danh sách trong ma trận; sale chỉ thấy vận đơn của đơn mình tạo (server lọc, giao diện không có bộ lọc người tạo) và không mở được chi tiết nên hàng của sale không bấm được (mặc định chọn, chưa duyệt).
- Điện thoại và địa chỉ do server trả `null` khi vận đơn `delivered`, `returned`, `cancelled`; giao diện chỉ hiện `—`, không tự ẩn theo trạng thái (SHP-REQ-20261006-101103927 BR7, SB-08 (d)). Không hiện, không cho chép mọi giá trị này vào URL hay ghi log phía client.
- Mặc định tab "Tất cả" và sắp mới nhất trước theo API (SHP-REQ-20261006-101103927 BR6, BR7; đã chốt, người dùng ủy quyền 2026-10-06). Gợi ý vận hành: mở sẵn tab "Chờ bàn giao" kèm "Cũ nhất", để chưa làm vì requirement không nói.
- "Không có quyền" ghi role `staff, admin` vì check-ui chỉ nhận role của màn; người thấy trạng thái này thật ra là customer (ghi ở questions.md, mục D).
- Ô tìm khớp chính xác (không tìm theo email, điện thoại, tên khách), nên placeholder nói rõ là mã đơn (mã mới `HDyymmdd-NNNNN` hoặc mã cũ 12 ký tự) hoặc mã vận đơn.
