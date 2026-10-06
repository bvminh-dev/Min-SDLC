---
screen: inventory-list
epic: INV
status: draft
covers: [INV-REQ-20261006-101122435, INV-REQ-20261006-101122611]
roles: [staff, admin]
---
# Tồn kho (danh sách, tab Tồn thấp)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một khối với hai tab Tất cả / Tồn thấp, ô tìm và bộ lọc ngừng bán). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này (việc đó thuộc implement).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng dữ liệu (khuyên dùng, đã chọn)** | Tên, sku, Đang có, Đang giữ, Còn bán được và ngưỡng trên cùng một hàng | Hai tab đứng trên bảng; tồn thấp là một tab chứ không phải trang riêng | Dày thông tin, hợp màn làm việc cả ngày; dưới `sm` thành danh sách dòng |
| B. Thẻ tóm tắt cộng bảng | Ba thẻ số (tổng sản phẩm, tồn thấp, hết hàng) rồi bảng | Thấy toàn cảnh ngay | Cần thêm endpoint thống kê mà requirement không có; thuộc DSH, loại |
| C. Danh sách hai cột với panel chi tiết | Chọn sản phẩm bên trái, thao tác bên phải | Nhập, xuất không rời trang | Hai cột cộng sidebar làm danh sách chật; nhiều hộp thoại trong panel khó dùng bàn phím |

Lý do chọn A: việc chính là tìm sản phẩm nào sắp hết hoặc cần nhập, rồi mở chi tiết để thao tác; thứ để so sánh là Còn bán được so với ngưỡng (INV-REQ-20261006-101122435 BR2, INV-REQ-20261006-101122611 BR2). Màn không có thao tác ghi nên không có cột hành động hay chọn nhiều dòng.

```
Thanh header:  ☰  Tồn kho                                                    🔔  (A)
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả]  Tồn thấp (7)                                                              │
│ [ Tìm theo tên hoặc sku              ]   Ngừng bán: [Tất cả ▾]   Sắp xếp: [Mới nhất ▾]│
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Sản phẩm                  Sku        Đang có  Đang giữ  Còn bán  Ngưỡng              │
│ Áo thun cotton            AT-001          50        8       42       5               │
│ Tất cổ cao                TC-014          12       12        0       5  (Tồn thấp)   │
│ Quần jean (ngừng bán)     QJ-007           9        0        9       5  (Ngừng bán)  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 25 sản phẩm                                          ‹ 1 2 ›          │
└─────────────────────────────────────────────────────────────────────────────────────┘
Hàng bấm được mở chi tiết tồn kho. Tab Tồn thấp bỏ ô Ngừng bán (luôn loại sản phẩm ngừng bán) và sắp Còn bán tăng dần.
```

## Trạng thái
Testid của vùng trạng thái nằm trong bảng Phần tử bên dưới (nêu trong ngoặc).

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Tối đa 20 dòng, mới nhất trước (hoặc Còn bán tăng dần khi chọn sắp xếp đó), dòng tổng số ở chân, tab, ô tìm và bộ lọc giữ giá trị đang dùng; số căn phải, `tabular-nums` (`inv-inventory-list-row`) | INV-REQ-20261006-101122435 |
| đang tải | Khung chờ đúng hình hàng bảng; đổi tab, lọc hay trang thì giữ dữ liệu cũ mờ đi (`inv-inventory-list-loading`) | INV-REQ-20261006-101122435 |
| rỗng | "Chưa có sản phẩm nào có bản ghi kho." một dòng chữ mờ kèm câu "Bản ghi kho tạo khi sản phẩm được công bố." (`inv-inventory-list-empty`) | INV-REQ-20261006-101122435 |
| rỗng do tìm hoặc lọc | "Không có sản phẩm nào khớp." kèm nút "Xoá lọc"; trang quá cuối (200, rỗng) cũng vào đây (`inv-inventory-list-empty-filtered`) | INV-REQ-20261006-101122435 |
| rỗng tồn thấp | Ở tab Tồn thấp: "Không có sản phẩm nào tồn thấp." (`inv-inventory-list-empty-low-stock`) | INV-REQ-20261006-101122611 |
| lỗi | Banner "Không tải được danh sách tồn kho." kèm "Thử lại"; lỗi tham số (400) cũng vào đây; quá giới hạn tần suất (429, bậc D của SB-14) hiện "Thao tác quá nhanh, thử lại sau N giây" theo `Retry-After` trong cùng banner; chưa đăng nhập (401) thì về đăng nhập (`inv-inventory-list-error`) | INV-REQ-20261006-101122435 |
| không có quyền | Customer mở màn này (403) thấy trang lỗi chung của web "Bạn không có quyền xem trang này"; trang đó thuộc khung ứng dụng chung (epic PRJ, chưa có màn nên không có testid ở đây) | INV-REQ-20261006-101122435 |
| tồn thấp | Dòng có Còn bán nhỏ hơn hoặc bằng ngưỡng hiện badge "Tồn thấp", chữ và biểu tượng, không chỉ bằng màu (`inv-inventory-list-low-badge`) | INV-REQ-20261006-101122611 |
| ngừng bán | Dòng của sản phẩm ngừng bán hiện badge "Ngừng bán" (`inv-inventory-list-archived-badge`) | INV-REQ-20261006-101122435 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| inv-inventory-list-tab-all | Tab Tất cả | staff, admin | Xem mọi bản ghi kho | INV-REQ-20261006-101122435 |
| inv-inventory-list-tab-low-stock | Tab Tồn thấp kèm số lượng | staff, admin | Chỉ xem sản phẩm tồn thấp | INV-REQ-20261006-101122611 |
| inv-inventory-list-search | Ô tìm theo tên hoặc sku | staff, admin | Nhập từ khóa rồi tìm (1 đến 100 ký tự) | INV-REQ-20261006-101122435 |
| inv-inventory-list-archived-filter | Bộ lọc Ngừng bán (Tất cả, Chỉ ngừng bán, Chỉ đang bán) | staff, admin | Chọn một giá trị | INV-REQ-20261006-101122435 |
| inv-inventory-list-sort | Chọn sắp xếp (Mới nhất, Còn bán tăng dần) | staff, admin | Đổi thứ tự | INV-REQ-20261006-101122435 |
| inv-inventory-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc hoặc tìm) | staff, admin | Gỡ lọc và từ khóa | INV-REQ-20261006-101122435 |
| inv-inventory-list-row | Hàng sản phẩm | staff, admin | Bấm để mở chi tiết tồn kho | INV-REQ-20261006-101122435 |
| inv-inventory-list-name | Tên sản phẩm | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-sku | Sku (font-mono) | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-on-hand | Số đang có, căn phải | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-reserved | Số đang giữ, căn phải | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-available | Số còn bán được, căn phải | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-threshold | Ngưỡng tồn thấp, căn phải | staff, admin | - | INV-REQ-20261006-101122611 |
| inv-inventory-list-low-badge | Badge Tồn thấp | staff, admin | - | INV-REQ-20261006-101122611 |
| inv-inventory-list-archived-badge | Badge Ngừng bán | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-summary | Dòng "1 tới 20 trong 25 sản phẩm" | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-pagination | Phân trang ‹ 1 2 › (ẩn khi một trang) | staff, admin | Sang trang khác | INV-REQ-20261006-101122435 |
| inv-inventory-list-loading | Khung chờ | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-empty | Vùng rỗng, chưa có bản ghi kho | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-empty-filtered | Vùng rỗng do tìm hoặc lọc | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-empty-low-stock | Vùng rỗng của tab Tồn thấp | staff, admin | - | INV-REQ-20261006-101122611 |
| inv-inventory-list-error | Banner lỗi | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-list-retry | Nút Thử lại | staff, admin | Tải lại danh sách | INV-REQ-20261006-101122435 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn này **không có** thao tác ghi; nhập, xuất, điều chỉnh và đổi ngưỡng nằm ở `inventory-detail` để mỗi thao tác có ngữ cảnh đầy đủ của một sản phẩm (số đang có, đang giữ) và `Idempotency-Key` gắn với một hộp thoại.
- Hai role dùng chung màn vì cùng quyền trong ma trận; không phần tử nào chỉ dành cho một role.
- Số cột là 6 (Sản phẩm, Sku, Đang có, Đang giữ, Còn bán, Ngưỡng); dưới `@4xl` ẩn cột Đang giữ và Ngưỡng, dưới `sm` thành danh sách dòng theo `list-row.md`. Giá trị trống là `—`.
- Tab Tồn thấp gọi endpoint riêng (INV-REQ-20261006-101122611 BR7), nên tìm kiếm và lọc ngừng bán chỉ có ở tab Tất cả.
- Sắp xếp mặc định "Mới nhất" (cập nhật gần nhất trước) là mặc định chưa được người dùng xác nhận (INV-REQ-20261006-101122435 [OPEN]).
- Số lượng chính xác chỉ hiện ở màn quản trị này; không dùng lại cho trang sản phẩm của khách (T10 trong INV-SEC).
