---
screen: admin-product-list
epic: PRD
status: draft
covers: [PRD-REQ-20261006-095502655, PRD-REQ-20261006-095502550]
roles: [staff, admin]
---
# Quản lý sản phẩm (danh sách quản trị)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu nhiều cột, hàng tab trạng thái phía trên, ô tìm và lọc danh mục). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng nhiều cột (khuyên dùng, đã chọn)** | Mã, tên, giá, trạng thái, ngày cập nhật cùng một hàng | Tab trạng thái là bộ lọc chính | Dưới `sm` bảng thành danh sách hai tầng |
| B. Lưới thẻ có ảnh | Ảnh sản phẩm nổi bật | Dễ nhận mặt hàng | Khó so giá, trạng thái, nhiều cuộn khi hàng trăm sản phẩm |
| C. Danh sách dòng gọn | Chỉ tên và trạng thái | Nhẹ | Thiếu giá và mã, phải mở từng sản phẩm |

Lý do chọn A: màn làm việc cả ngày của staff và admin, cần so sánh nhiều sản phẩm theo mã, giá, trạng thái.

```
Header:  ☰  Sản phẩm                                              [ + Tạo sản phẩm ]   (admin)
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Nháp  Đang bán  Đã lưu trữ         [ Tìm tên hoặc mã sku... ]  Danh mục [▾]  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Mã      Tên               Danh mục  Giá        Trạng thái   Cập nhật         Mở       │
│ AT-001  Áo thun cotton    Áo        150.000 đ  (Đang bán)   06/10/2026 09:00  Sửa      │
│ AT-002  Áo thun cổ tim    Áo        160.000 đ  (Nháp)       05/10/2026 17:20  Sửa      │
│ QJ-010  Quần jean         Quần      320.000 đ  (Đã lưu trữ) 01/10/2026 08:02  Xem      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 25 sản phẩm                                              ‹ 1 2 ›        │
└──────────────────────────────────────────────────────────────────────────────────────┘
Staff thấy cột Mở là "Xem" và không có nút Tạo. Dưới sm: tab thành nút "Trạng thái: Tất cả · 25"; mỗi hàng hai tầng.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | 20 hàng mới cập nhật trước, tab đang chọn gạch chân, tổng ở chân, phân trang khi từ 2 trang | PRD-REQ-20261006-095502655 | prd-admin-product-list-row |
| đang tải | Khung chờ đúng hình 6 hàng; đổi tab hay trang thì giữ dữ liệu cũ | PRD-REQ-20261006-095502655 | prd-admin-product-list-loading |
| rỗng | "Chưa có sản phẩm nào." kèm nút Tạo sản phẩm (chỉ admin) | PRD-REQ-20261006-095502655 | prd-admin-product-list-empty |
| rỗng do lọc | "Không có sản phẩm phù hợp." kèm nút "Xóa bộ lọc"; cũng là trang trống khi đúng 20 sản phẩm mà vào trang 2 | PRD-REQ-20261006-095502655 | prd-admin-product-list-empty-filtered |
| lỗi | Banner "Không tải được danh sách sản phẩm." kèm nút "Thử lại"; lỗi bộ lọc không hợp lệ (400) cũng vào đây | PRD-REQ-20261006-095502655 | prd-admin-product-list-error |
| hết phiên | Phiên hết hạn (401): chuyển về đăng nhập, không hiện sản phẩm nào | PRD-REQ-20261006-095502655 | prd-admin-product-list-error |
| không có quyền | Customer vào trang này (403): hiện "Bạn không có quyền xem trang này", không hiện sản phẩm | PRD-REQ-20261006-095502655 | prd-admin-product-list-error |
| badge trạng thái | Nhãn "Nháp", "Đang bán", "Đã lưu trữ", đọc rõ không chỉ bằng màu | PRD-REQ-20261006-095502655 | prd-admin-product-list-status-badge |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prd-admin-product-list-status-filter | Hàng tab lọc trạng thái (dropdown dưới sm) | staff, admin | Chọn Tất cả, Nháp, Đang bán, Đã lưu trữ | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-category-filter | Ô chọn danh mục (gồm danh mục con) | staff, admin | Lọc theo danh mục | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-search | Ô tìm theo tên hoặc mã sku | staff, admin | Gõ từ khóa | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-clear-filter | Nút Xóa bộ lọc (chỉ khi đang lọc hoặc tìm) | staff, admin | Về Tất cả | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-create | Nút Tạo sản phẩm | admin | Mở màn tạo sản phẩm nháp | PRD-REQ-20261006-095502550 |
| prd-admin-product-list-row | Hàng sản phẩm | staff, admin | Bấm để mở chi tiết (admin sửa được, staff chỉ xem) | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-sku | Mã sku | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-name | Tên sản phẩm (đã escape) | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-price | Giá | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-status-badge | Badge trạng thái | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-updated-at | Ngày cập nhật | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-summary | Dòng "1 tới 20 trong 25 sản phẩm" | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-pagination | Phân trang ‹ 1 2 › (ẩn khi một trang) | staff, admin | Sang trang khác | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-loading | Khung chờ | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-empty | Vùng rỗng, chưa có sản phẩm | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-empty-filtered | Vùng rỗng do lọc | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-error | Banner lỗi (lỗi tải, hết phiên, không có quyền) | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-list-retry | Nút Thử lại | staff, admin | Tải lại danh sách | PRD-REQ-20261006-095502655 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Audit (câu 2 của evon):** chưa có codebase, nên theo mặc định evon (flat, Tailwind, `references/tokens.css`); thư viện UI chưa chốt (questions.md câu 10).
- Mẫu theo evon "Bảng dữ liệu" có tab trạng thái; dưới `sm` thành nút dropdown có nhãn "Trạng thái:" (luật chủ dự án số 7).
- Staff chỉ xem: không có nút Tạo, cột Mở ghi "Xem" (PRD-REQ-20261006-095502655 BR1). Quyền kiểm lại ở server, giao diện chỉ ẩn nút.
- Ô tìm khớp tên và sku giống tìm kiếm công khai (PRD-REQ-20261006-095502718 BR3) nhưng ở đây thấy cả nháp và đã lưu trữ.
- Màn không có hành động hàng loạt; công bố và ngừng bán nằm ở `admin-product-edit`.
- Không viết code giao diện; dựng thật là việc của `implement`.
