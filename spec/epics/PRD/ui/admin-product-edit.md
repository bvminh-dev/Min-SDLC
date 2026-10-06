---
screen: admin-product-edit
epic: PRD
status: draft
covers: [PRD-REQ-20261006-095502550, PRD-REQ-20261006-095502571, PRD-REQ-20261006-095502592, PRD-REQ-20261006-095502613, PRD-REQ-20261006-095502634, PRD-REQ-20261006-095502655]
roles: [staff, admin]
---
# Tạo và sửa sản phẩm (chi tiết quản trị)

## Wireframe
Phương án đã chọn: **A** (một trang hai khối: biểu mẫu thông tin bên trái, ảnh và trạng thái bên phải; thanh hành động dính ở trên). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một trang, biểu mẫu trái và ảnh phải (khuyên dùng, đã chọn)** | Mọi thứ trên một trang, nút Lưu và Công bố cố định ở trên | Sửa xong lưu một lần | Trang dài trên điện thoại |
| B. Nhiều bước (thông tin, ảnh, công bố) | Từng bước nhỏ | Dễ cho người mới | Chậm với admin dùng hằng ngày, sửa một giá phải đi qua bước |
| C. Sửa tại chỗ ngay trên danh sách | Không đổi trang | Nhanh với một ô | Không có chỗ cho ảnh và trạng thái, khó xử lý lỗi từng trường |

Lý do chọn A: admin sửa nhanh từng trường và quản lý ảnh trên cùng trang; công bố và ngừng bán cần thấy điều kiện ngay cạnh.

```
‹ Sản phẩm      Áo thun cotton  (Đang bán)         [ Lưu ]  [ Công bố ]  [ Ngừng bán ]   <- thanh trên cùng
┌─────────────────────────────────────────┬──────────────────────────────────────────┐
│ Tên *        [ Áo thun cotton         ]│ Ảnh (2 trên 8)                            │
│ Mã sku *     [ AT-001                 ]│ ┌────┐ ┌────┐  [ + Tải ảnh lên ]           │
│              (khóa khi đã đang bán)     │ │ảnh1│ │ảnh2│  ‹ › đổi thứ tự, 🗑 xóa      │
│ Danh mục *   [ Áo               ▾    ]│ └────┘ └────┘  Ảnh đầu là ảnh đại diện     │
│ Giá (đ) *    [ 150000                 ]│                                          │
│ Mô tả        [ nhiều dòng, tối đa 5000 ]│ Điều kiện công bố: ✔ Tên ✔ Mã ✔ Giá      │
│                                         │                   ✔ Danh mục ✔ Có ảnh    │
└─────────────────────────────────────────┴──────────────────────────────────────────┘
Banner khi lỗi: "Sản phẩm đã được người khác sửa, hãy tải lại."  (409 sai version)
Staff: mọi ô bị khóa, ẩn các nút Lưu, Công bố, Ngừng bán, Tải ảnh; có dòng "Bạn chỉ có quyền xem".
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| tạo mới | Biểu mẫu trống, chỉ có nút Lưu (tạo bản nháp); chưa có khối ảnh cho tới khi có sản phẩm | PRD-REQ-20261006-095502550 | prd-admin-product-edit-save |
| nháp | Biểu mẫu sửa được kể cả sku; nút Lưu, Công bố, Ngừng bán (đổi nhãn "Hủy nháp") | PRD-REQ-20261006-095502571 | prd-admin-product-edit-status-badge |
| đang bán | Biểu mẫu sửa được, sku bị khóa; nút Lưu và Ngừng bán, không còn Công bố; không xóa được ảnh cuối | PRD-REQ-20261006-095502571 | prd-admin-product-edit-sku |
| đã lưu trữ | Mọi ô khóa, ẩn mọi nút ghi, có dòng "Sản phẩm đã lưu trữ, không sửa được" | PRD-REQ-20261006-095502634 | prd-admin-product-edit-archived-note |
| chỉ xem (staff) | Mọi ô khóa, ẩn nút ghi, có dòng "Bạn chỉ có quyền xem" | PRD-REQ-20261006-095502655 | prd-admin-product-edit-readonly-note |
| đang tải | Khung chờ đúng hình biểu mẫu và khối ảnh | PRD-REQ-20261006-095502655 | prd-admin-product-edit-loading |
| không tìm thấy | "Không tìm thấy sản phẩm." (404) kèm liên kết về danh sách | PRD-REQ-20261006-095502655 | prd-admin-product-edit-not-found |
| lỗi | Banner "Không tải hoặc không lưu được." kèm nút "Thử lại" (lỗi tải, 5xx) | PRD-REQ-20261006-095502571 | prd-admin-product-edit-error |
| lỗi trường | Chữ đỏ dưới ô sai (tên rỗng, giá không hợp lệ, sku sai dạng, trùng sku 409, 400) | PRD-REQ-20261006-095502550 | prd-admin-product-edit-field-error |
| xung đột phiên bản | Banner "Sản phẩm đã được người khác sửa, hãy tải lại" kèm nút "Tải lại"; không mất chữ đã gõ cho tới khi bấm | PRD-REQ-20261006-095502571 | prd-admin-product-edit-conflict |
| không đủ điều kiện công bố | Danh sách trường thiếu (ví dụ "Cần ít nhất 1 ảnh") tô đỏ ở khối điều kiện (422) | PRD-REQ-20261006-095502613 | prd-admin-product-edit-publish-missing |
| ảnh lỗi | Chữ đỏ ở khối ảnh: sai loại, quá 5 MB, quá 25 megapixel, quá 8 ảnh, hoặc không xóa được ảnh cuối (400, 409) | PRD-REQ-20261006-095502592 | prd-admin-product-edit-image-error |
| hết phiên hoặc không có quyền | 401 chuyển về đăng nhập; 403 hiện "Bạn không có quyền" và không hiện dữ liệu | PRD-REQ-20261006-095502655 | prd-admin-product-edit-error |

## Phần tử
Biểu mẫu và nút ghi chỉ cho admin; staff chỉ thấy các phần tử có role staff.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prd-admin-product-edit-name | Ô tên (tối đa 200 ký tự) | admin | Nhập tên | PRD-REQ-20261006-095502571 |
| prd-admin-product-edit-sku | Ô mã sku (khóa khi đang bán) | admin | Nhập sku (chữ, số, dấu - và _) | PRD-REQ-20261006-095502550 |
| prd-admin-product-edit-category | Ô chọn danh mục | admin | Chọn danh mục | PRD-REQ-20261006-095502571 |
| prd-admin-product-edit-price | Ô giá, số nguyên đồng | admin | Nhập giá | PRD-REQ-20261006-095502571 |
| prd-admin-product-edit-description | Ô mô tả nhiều dòng (tối đa 5000 ký tự) | admin | Nhập mô tả | PRD-REQ-20261006-095502571 |
| prd-admin-product-edit-save | Nút Lưu (tạo bản nháp ở chế độ tạo mới, sửa ở chế độ sửa) | admin | Gửi biểu mẫu | PRD-REQ-20261006-095502571 |
| prd-admin-product-edit-status-badge | Badge trạng thái | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-view-fields | Vùng thông tin chỉ đọc (tên, sku, danh mục, giá, mô tả) | staff | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-readonly-note | Dòng "Bạn chỉ có quyền xem" | staff | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-archived-note | Dòng "Sản phẩm đã lưu trữ, không sửa được" | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-image-upload | Nút Tải ảnh lên (chọn tệp) | admin | Chọn một tệp ảnh | PRD-REQ-20261006-095502592 |
| prd-admin-product-edit-image-item | Một ảnh trong khối ảnh | admin | - | PRD-REQ-20261006-095502592 |
| prd-admin-product-edit-image-move | Nút đổi thứ tự (trái, phải) trên ảnh | admin | Đổi thứ tự, ảnh đầu là ảnh đại diện | PRD-REQ-20261006-095502592 |
| prd-admin-product-edit-image-delete | Nút xóa ảnh | admin | Xóa ảnh (không xóa được ảnh cuối của sản phẩm đang bán) | PRD-REQ-20261006-095502592 |
| prd-admin-product-edit-image-error | Chữ lỗi ở khối ảnh | admin | - | PRD-REQ-20261006-095502592 |
| prd-admin-product-edit-publish | Nút Công bố (chỉ khi nháp) | admin | Công bố sản phẩm | PRD-REQ-20261006-095502613 |
| prd-admin-product-edit-publish-missing | Khối điều kiện công bố, nêu trường còn thiếu | admin | - | PRD-REQ-20261006-095502613 |
| prd-admin-product-edit-archive | Nút Ngừng bán, nhãn Hủy nháp khi đang nháp | admin | Mở hộp xác nhận | PRD-REQ-20261006-095502634 |
| prd-admin-product-edit-archive-confirm | Nút xác nhận trong hộp thoại ngừng bán (đỏ nền mờ, nói rõ không hoàn tác) | admin | Ngừng bán hoặc hủy nháp | PRD-REQ-20261006-095502634 |
| prd-admin-product-edit-archive-cancel | Nút Hủy trong hộp thoại ngừng bán | admin | Đóng hộp thoại | PRD-REQ-20261006-095502634 |
| prd-admin-product-edit-field-error | Chữ lỗi dưới ô sai | admin | - | PRD-REQ-20261006-095502550 |
| prd-admin-product-edit-conflict | Banner xung đột phiên bản | admin | Bấm Tải lại | PRD-REQ-20261006-095502571 |
| prd-admin-product-edit-loading | Khung chờ | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-not-found | Vùng không tìm thấy | staff, admin | Bấm Về danh sách | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-error | Banner lỗi (lỗi tải, hết phiên, không có quyền) | staff, admin | - | PRD-REQ-20261006-095502655 |
| prd-admin-product-edit-retry | Nút Thử lại | staff, admin | Tải lại | PRD-REQ-20261006-095502655 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Audit (câu 2 của evon):** chưa có codebase; theo mặc định evon (flat, Tailwind, `references/tokens.css`), thư viện UI chưa chốt (questions.md câu 10). Bố cục theo mẫu biểu mẫu của evon (`layouts/form.md`) và tải tệp (`components/file-upload.md`).
- **Việc nguy hiểm:** Ngừng bán không hoàn tác được (trạng thái cuối) nên theo luật chủ dự án số 1 và 3 là nút đỏ nền mờ và hộp xác nhận đỏ, nói rõ "Không thể khôi phục".
- Nhãn: nháp "Nháp", active "Đang bán", archived "Đã lưu trữ". Màu badge theo bảng `M7` của evon.
- Nút Công bố vô hiệu kèm khối điều kiện khi thiếu; vẫn gọi server khi bấm vì server mới là nơi kiểm (nhận 422 thì hiện khối lỗi).
- Không mất chữ đã gõ khi gặp 409 sai phiên bản: banner cho phép chép lại trước khi Tải lại (PRD-REQ-20261006-095502571 BR5).
- Giá nhập là số nguyên, hiển thị định dạng nghìn và đơn vị đ cạnh ô; không có ô tiền tệ.
- Mô tả và tên hiển thị lại dạng văn bản thường đã escape (SB-12).
- Không viết code giao diện; dựng thật là việc của `implement`.
