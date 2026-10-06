---
screen: order-admin-list
epic: ORD
status: draft
covers: [ORD-REQ-20261006-092320743, ORD-REQ-20261006-092320790]
roles: [staff, admin]
---
# Quản lý đơn hàng (staff và admin xem, lọc, tìm)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một khối với hàng tab trạng thái và ô tìm mã đơn). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng dữ liệu (khuyên dùng, đã chọn)** | Mã đơn, ngày, trạng thái, thanh toán, tổng trên cùng một hàng | Tab trạng thái và ô tìm mã đơn đứng trên bảng | Bố cục dày, hợp màn làm việc cả ngày; dưới `sm` thành danh sách dòng |
| B. Danh sách và panel chi tiết hai cột | Chọn đơn bên trái, xem chi tiết bên phải | Xem nhanh không rời trang | Cần gọi chi tiết cho từng dòng; hai cột cộng sidebar làm danh sách chật (dưới 1600px) |
| C. Bảng kanban theo trạng thái | Cột theo trạng thái | Nhìn cả luồng đơn | Kanban gợi kéo thả để đổi trạng thái, mà staff không đổi được trạng thái ở ORD; loại |

Lý do chọn A: việc chính là tìm đơn theo mã hoặc trạng thái rồi mở xem; thứ để so sánh là trạng thái, ngày tạo, trạng thái thanh toán và tổng tiền (ORD-REQ-20261006-092320743 BR5). Không có thao tác trên dòng nào (staff chỉ xem), nên không có cột hành động, không có chọn nhiều dòng.

```
Thanh header:  ☰  Đơn hàng                                                 🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Chờ xử lý  Đã xác nhận  Đã thanh toán  Đang giao  Đã giao  Đã hủy  ...  │
│ [ Tìm theo mã đơn                              ]                                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Mã đơn         Ngày tạo        Trạng thái    Thanh toán          Sản phẩm   Tổng │
│ 7K3M9Q2XH4TB    06/10 09:00     (Đã TT)       VNPay · Thành công       3  350.000 đ │
│ 5FQ2H8B7C1ZD    03/10 21:14     (Đã hủy)      COD · Chưa thu           1   90.000 đ │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 45 đơn                                            ‹ 1 2 3 ›        │
└──────────────────────────────────────────────────────────────────────────────────┘
Hàng bấm được mở chi tiết đơn. Không cột email, tên khách, điện thoại, địa chỉ (SB-08). Không nút Hủy hay Đã giao ở màn này.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | 20 dòng mới nhất trước, tổng số đơn ở chân, tab và ô tìm giữ giá trị đang dùng | ORD-REQ-20261006-092320743 |
| đang tải | Khung chờ đúng hình hàng bảng; đổi lọc, tìm hay trang thì giữ dữ liệu cũ | ORD-REQ-20261006-092320743 |
| rỗng | "Chưa có đơn hàng nào." một dòng chữ mờ (hệ thống chưa có đơn) | ORD-REQ-20261006-092320743 |
| rỗng do tìm hoặc lọc | "Không có đơn nào khớp." kèm nút "Xoá lọc"; tìm mã không khớp hoặc nhập email (không khớp theo email) đều vào đây; trang 2 khi đúng 20 đơn cũng rỗng | ORD-REQ-20261006-092320743 |
| lỗi | Banner "Không tải được danh sách đơn." kèm "Thử lại"; lỗi bộ lọc không hợp lệ (400) cũng vào đây | ORD-REQ-20261006-092320743 |
| không có quyền | Customer mở màn này (403) thấy trang lỗi "Bạn không có quyền xem trang này" kèm nút về Đơn hàng của tôi; chưa đăng nhập (401) thì về đăng nhập | ORD-REQ-20261006-092320743 |
| trạng thái đơn | Badge trạng thái hiện tại; nhãn đọc rõ không chỉ bằng màu | ORD-REQ-20261006-092320790 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-admin-list-status-filter | Hàng tab lọc trạng thái | staff, admin | Chọn một trạng thái hoặc Tất cả | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-search | Ô tìm theo mã đơn (placeholder nói rõ mã đơn, không nhắc email) | staff, admin | Nhập mã đơn rồi tìm | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc hoặc tìm) | staff, admin | Gỡ lọc và từ khoá | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-row | Hàng đơn | staff, admin | Bấm để mở chi tiết đơn | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-code | Mã đơn (font-mono) | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-created-at | Ngày tạo | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-payment | Phương thức và trạng thái thanh toán | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-item-count | Số mặt hàng | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-total | Tổng tiền, căn phải | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-status-badge | Badge trạng thái đơn | staff, admin | - | ORD-REQ-20261006-092320790 |
| ord-order-admin-list-summary | Dòng "1 tới 20 trong 45 đơn" | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-pagination | Phân trang ‹ 1 2 3 › (ẩn khi một trang) | staff, admin | Sang trang khác | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-loading | Khung chờ | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-empty | Vùng rỗng, chưa có đơn | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-empty-filtered | Vùng rỗng do tìm hoặc lọc | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-error | Banner lỗi | staff, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-retry | Nút Thử lại | staff, admin | Tải lại danh sách | ORD-REQ-20261006-092320743 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn này **không có** nút hủy, nút đánh dấu giao hay bất kỳ thao tác đổi đơn nào: staff chỉ xem (ORD-REQ-20261006-092320743 BR9); đánh dấu giao thuộc epic SHP. Admin hủy từ trang chi tiết (xem `order-detail`), không hủy ngay trên danh sách.
- Sắp xếp mới nhất trước là mặc định chưa được người dùng xác nhận (ORD-REQ-20261006-092320743 BR6, [NEEDS CLARIFICATION]); cột Ngày tạo không có sắp xếp tự chọn vì requirement không có. Ô tìm so khớp chính xác mã đơn (BR7, mặc định).
- Hai role dùng chung màn vì cùng quyền xem trong ma trận; không phần tử nào chỉ dành cho một role.
- Số cột là 6: Mã đơn, Ngày tạo, Trạng thái, Thanh toán, Sản phẩm, Tổng; dưới `@4xl` ẩn cột Sản phẩm và Ngày tạo, dưới `sm` thành danh sách dòng theo `list-row.md`.
- Cột tiền dùng `tabular-nums`, giá trị trống là `—` theo evon.
