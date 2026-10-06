---
screen: admin-category
epic: PRD
status: draft
covers: [PRD-REQ-20261006-095502484, PRD-REQ-20261006-095502507, PRD-REQ-20261006-095502529]
roles: [admin]
---
# Quản lý danh mục

## Wireframe
Phương án đã chọn: **A** (cây danh mục thụt lề một cột, mỗi dòng có nút Sửa, Xóa, Thêm con; hộp thoại cho thêm, sửa, xóa). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Cây thụt lề và hộp thoại (khuyên dùng, đã chọn)** | Thấy cả ba cấp, thao tác ngay trên dòng | Thêm con ngay dưới dòng cha | Chuyển nhánh phải chọn cha mới trong hộp thoại, không kéo thả |
| B. Hai cột: cây trái, biểu mẫu chi tiết phải | Chọn một nút rồi sửa ở bên phải | Có chỗ cho nhiều trường | Cây chỉ có tên và cha nên biểu mẫu gần như trống |
| C. Kéo thả để chuyển nhánh | Kéo dòng sang cha mới | Trực quan | Dễ thả nhầm, khó cho bàn phím và điện thoại, lỗi vòng và quá 3 cấp khó giải thích |

Lý do chọn A: danh mục chỉ có tên và nhánh cha, tối đa ba cấp; cây thụt lề với thao tác trên dòng là đủ và đơn giản nhất.

```
Header:  ☰  Danh mục                                              [ + Thêm danh mục gốc ]
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ▾ Thời trang                                   6 sản phẩm   [+ Con] [Sửa] [Xóa]      │
│     ▾ Áo                                       4 sản phẩm   [+ Con] [Sửa] [Xóa]      │
│         Áo thun                                1 sản phẩm   [Sửa] [Xóa]   (cấp 3, hết) │
│     ▸ Quần                                     2 sản phẩm   [+ Con] [Sửa] [Xóa]      │
│ ▸ Phụ kiện                                     0 sản phẩm   [+ Con] [Sửa] [Xóa]      │
└──────────────────────────────────────────────────────────────────────────────────────┘
Hộp thoại Thêm hoặc Sửa:   Tên * [____________]   Danh mục cha [ (gốc) ▾ ]   (Hủy) (Lưu)
Hộp thoại Xóa:             "Xóa danh mục Phụ kiện? Không thể khôi phục."       (Hủy) (Xóa)
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Cây thụt lề, cha trước con, anh em theo tên, số sản phẩm đang bán cạnh tên | PRD-REQ-20261006-095502484 | prd-admin-category-tree |
| đang tải | Khung chờ đúng hình 6 dòng cây | PRD-REQ-20261006-095502484 | prd-admin-category-loading |
| rỗng | "Chưa có danh mục nào." kèm nút Thêm danh mục gốc | PRD-REQ-20261006-095502484 | prd-admin-category-empty |
| lỗi | Banner "Không tải được danh mục." kèm nút "Thử lại" | PRD-REQ-20261006-095502484 | prd-admin-category-error |
| hết phiên hoặc không có quyền | 401 chuyển về đăng nhập; 403 (staff vào trang) hiện "Bạn không có quyền" và không hiện cây | PRD-REQ-20261006-095502507 | prd-admin-category-error |
| trùng tên | Chữ đỏ trong hộp thoại: "Đã có danh mục tên này trong cùng danh mục cha" (409) | PRD-REQ-20261006-095502507 | prd-admin-category-name-error |
| tên không hợp lệ | Chữ đỏ: tên rỗng hoặc quá 100 ký tự (400) | PRD-REQ-20261006-095502507 | prd-admin-category-name-error |
| vòng hoặc quá sâu | Chữ đỏ ở ô danh mục cha: "Không thể chuyển vào nhánh con của chính nó" hoặc "Tối đa 3 cấp" (409) | PRD-REQ-20261006-095502507 | prd-admin-category-parent-error |
| không xóa được | Hộp thoại xóa hiện lý do: "Còn danh mục con" và hoặc "Còn sản phẩm" (409, kể cả sản phẩm đã lưu trữ); nút Xóa tắt | PRD-REQ-20261006-095502529 | prd-admin-category-delete-error |
| đã bị xóa ở nơi khác | Hộp thoại hiện "Danh mục không còn tồn tại" (404) rồi tải lại cây | PRD-REQ-20261006-095502529 | prd-admin-category-delete-error |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prd-admin-category-tree | Cây danh mục | admin | Mở, thu gọn nhánh | PRD-REQ-20261006-095502484 |
| prd-admin-category-row | Một dòng danh mục | admin | - | PRD-REQ-20261006-095502484 |
| prd-admin-category-product-count | Số sản phẩm đang bán cạnh tên | admin | - | PRD-REQ-20261006-095502484 |
| prd-admin-category-create-root | Nút Thêm danh mục gốc | admin | Mở hộp thoại thêm | PRD-REQ-20261006-095502507 |
| prd-admin-category-create-child | Nút Thêm con (ẩn ở cấp 3) | admin | Mở hộp thoại thêm, cha là dòng này | PRD-REQ-20261006-095502507 |
| prd-admin-category-edit | Nút Sửa | admin | Mở hộp thoại sửa tên và danh mục cha | PRD-REQ-20261006-095502507 |
| prd-admin-category-name | Ô tên trong hộp thoại (tối đa 100 ký tự) | admin | Nhập tên | PRD-REQ-20261006-095502507 |
| prd-admin-category-parent | Ô chọn danh mục cha trong hộp thoại | admin | Chọn cha hoặc gốc | PRD-REQ-20261006-095502507 |
| prd-admin-category-save | Nút Lưu trong hộp thoại | admin | Tạo hoặc cập nhật danh mục | PRD-REQ-20261006-095502507 |
| prd-admin-category-cancel | Nút Hủy trong hộp thoại | admin | Đóng hộp thoại | PRD-REQ-20261006-095502507 |
| prd-admin-category-name-error | Chữ lỗi dưới ô tên | admin | - | PRD-REQ-20261006-095502507 |
| prd-admin-category-parent-error | Chữ lỗi dưới ô danh mục cha | admin | - | PRD-REQ-20261006-095502507 |
| prd-admin-category-delete | Nút Xóa | admin | Mở hộp thoại xác nhận | PRD-REQ-20261006-095502529 |
| prd-admin-category-delete-confirm | Nút xác nhận Xóa (đỏ nền mờ, nói rõ không khôi phục) | admin | Xóa danh mục | PRD-REQ-20261006-095502529 |
| prd-admin-category-delete-cancel | Nút Hủy trong hộp thoại xóa | admin | Đóng hộp thoại | PRD-REQ-20261006-095502529 |
| prd-admin-category-delete-error | Vùng lý do không xóa được hoặc không còn tồn tại | admin | - | PRD-REQ-20261006-095502529 |
| prd-admin-category-loading | Khung chờ | admin | - | PRD-REQ-20261006-095502484 |
| prd-admin-category-empty | Vùng rỗng | admin | - | PRD-REQ-20261006-095502484 |
| prd-admin-category-error | Banner lỗi (lỗi tải, hết phiên, không có quyền) | admin | - | PRD-REQ-20261006-095502484 |
| prd-admin-category-retry | Nút Thử lại | admin | Tải lại | PRD-REQ-20261006-095502484 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Audit (câu 2 của evon):** chưa có codebase; theo mặc định evon (flat, Tailwind, `references/tokens.css`), thư viện UI chưa chốt (questions.md câu 10). Cây theo mẫu `components/tree.md`, hộp thoại theo `layouts/overlay.md`.
- Xóa là việc nguy hiểm (mất dữ liệu, không khôi phục): nút và hộp xác nhận đỏ nền mờ theo luật chủ dự án số 1, 2, 3. Giao diện nêu lý do khi danh mục còn con hoặc sản phẩm; server vẫn kiểm lại.
- Không có kéo thả (loại phương án C): chuyển nhánh làm bằng ô chọn danh mục cha trong hộp thoại Sửa; ô này loại trừ chính nó và hậu duệ, và loại cha khiến nhánh vượt 3 cấp (server vẫn kiểm).
- Số "sản phẩm" cạnh tên là số sản phẩm đang bán (gồm nhánh con), khớp PRD-REQ-20261006-095502484 BR3; vì vậy một danh mục có thể hiện 0 sản phẩm mà vẫn không xóa được (còn sản phẩm nháp hoặc đã lưu trữ), hộp xóa nói rõ lý do.
- Không viết code giao diện; dựng thật là việc của `implement`.
