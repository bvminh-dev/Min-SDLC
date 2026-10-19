---
screen: admin-product-import
epic: PRD
status: approved
covers: [PRD-REQ-20261015-092431191, PRD-REQ-20261015-092431230]
roles: [admin]
---
# Import sản phẩm từ Excel hoặc CSV

## Wireframe
Phương án đã chọn: **A** (một trang, ba vùng theo thứ tự: chọn tệp, xem trước kết quả, xác nhận). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (người dùng đã giao tự chọn phương án đơn giản nhất, nhất quán với màn đang có).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một trang ba vùng (khuyên dùng, đã chọn)** | Chọn tệp ở trên, bảng kết quả ngay dưới, nút xác nhận dính ở dưới | Hai bước `dry_run` rồi xác nhận nằm trên cùng một trang, không mất tệp | Trang dài khi nhiều dòng (bảng cuộn trong khung) |
| B. Trình hướng dẫn 3 bước (chọn, xem trước, kết quả) | Mỗi bước một màn | Dễ cho người mới | Chậm với admin nạp hàng ngày, phải giữ tệp qua các bước |
| C. Hộp thoại trên danh sách sản phẩm | Không đổi trang | Gọn | Bảng kết quả hàng nghìn dòng không vừa hộp thoại |

Lý do chọn A: ADR-025 là hợp đồng hai bước trên một tệp; admin cần thấy bảng lỗi từng dòng cạnh nút xác nhận để quyết định.

```
‹ Sản phẩm      Import sản phẩm                                   [ Tải tệp mẫu ]
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. Chọn tệp       [ Chọn tệp .xlsx hoặc .csv ]  hang-moi.xlsx (1,2 MB)       │
│    Tối đa 5 MB và 2000 dòng. Cột: Mã hàng, Tên hàng, Nhóm hàng, Giá bán,      │
│    Giá vốn. ĐVT và Tồn kho được bỏ qua.                  [ Xem trước ]        │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2. Xem trước (chưa ghi gì)                                                   │
│    Tạo mới 1.180 · Cập nhật 40 (12 đổi giá) · Không đổi 770 · Lỗi 10          │
│    Bỏ qua các cột: ĐVT, Tồn kho            [x] Chỉ hiện dòng lỗi              │
│ ┌─────┬─────────┬──────────┬───────────────────────────────────────────────┐ │
│ │Dòng │ Mã hàng │ Kết quả  │ Chi tiết                                      │ │
│ │ 3   │ AT-101  │ Lỗi      │ Nhóm hàng: không tìm thấy "Đồ chơi"           │ │
│ │ 4   │ AT-102  │ Lỗi      │ Giá bán: không phải số nguyên                 │ │
│ │ 7   │ AT-001  │ Cập nhật │ Giá bán 150.000 → 160.000                     │ │
│ └─────┴─────────┴──────────┴───────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│ 3. Dòng lỗi sẽ bị bỏ, các dòng còn lại được ghi. Sản phẩm mới ở trạng thái   │
│    Nháp, cần thêm ảnh rồi mới công bố.          [ Xác nhận import 1.220 dòng ]│
└──────────────────────────────────────────────────────────────────────────────┘
Sau khi xác nhận: vùng 2 đổi thành "Kết quả import" (cùng bảng, số liệu thật) kèm nút "Import tệp khác".
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| chưa chọn tệp | Chỉ vùng 1; nút Xem trước vô hiệu; chưa có vùng 2 và 3 | PRD-REQ-20261015-092431191 | prd-admin-product-import-file |
| đã chọn tệp | Hiện tên và kích thước tệp; nút Xem trước bật; kiểm phía trình duyệt phần mở rộng và 5 MB (báo sớm, server vẫn kiểm lại) | PRD-REQ-20261015-092431191 | prd-admin-product-import-file-name |
| đang kiểm tra | Nút Xem trước đang chạy, khung chờ ở vùng 2; không thao tác tiếp được | PRD-REQ-20261015-092431191 | prd-admin-product-import-loading |
| xem trước có dữ liệu | Vùng 2 có tóm tắt (tạo, cập nhật, không đổi, lỗi), các cột bị bỏ qua, bảng từng dòng; nút Xác nhận bật kèm số dòng sẽ ghi | PRD-REQ-20261015-092431191 | prd-admin-product-import-summary |
| xem trước có dòng lỗi | Dòng lỗi tô đỏ kèm mã và lý do từng ô (nhiều lỗi một dòng liệt kê hết); có ô chọn "Chỉ hiện dòng lỗi"; dòng nhắc "Dòng lỗi sẽ bị bỏ" | PRD-REQ-20261015-092431191 | prd-admin-product-import-row-error |
| không có dòng hợp lệ | Mọi dòng lỗi hoặc tệp 0 dòng: nút Xác nhận vô hiệu, nêu lý do | PRD-REQ-20261015-092431191 | prd-admin-product-import-no-valid |
| tệp bị từ chối | Banner đỏ theo `reason` của 400: sai loại (chỉ .xlsx, .csv), quá 5 MB, quá 2000 dòng, có macro, nén bất thường, thiếu cột (liệt kê cột thiếu), tệp hỏng; không có bảng kết quả | PRD-REQ-20261015-092431191 | prd-admin-product-import-file-error |
| đang ghi | Sau khi xác nhận: nút Xác nhận đang chạy và vô hiệu, không chọn lại tệp; dùng một `Idempotency-Key` cho lần xác nhận, bấm lại hay thử lại sau lỗi mạng dùng lại đúng khóa đó | PRD-REQ-20261015-092431191 | prd-admin-product-import-writing |
| hoàn tất | Vùng 2 thành "Kết quả import" với số liệu thật và bảng từng dòng (dòng lỗi giữ lại để sửa tệp); nút "Import tệp khác" và liên kết về danh sách sản phẩm | PRD-REQ-20261015-092431191 | prd-admin-product-import-result |
| giới hạn tần suất | 429: banner "Bạn thao tác quá nhanh, thử lại sau" kèm thời gian từ `Retry-After` | PRD-REQ-20261015-092431191 | prd-admin-product-import-error |
| lỗi | Banner "Không import được." kèm nút "Thử lại" (5xx, 503 mất kết nối: nói rõ chưa dòng nào được ghi); khóa 422 `idempotency-key-reused` bắt chọn lại tệp | PRD-REQ-20261015-092431191 | prd-admin-product-import-error |
| hết phiên hoặc không có quyền | 401 chuyển về đăng nhập; 403 hiện "Bạn không có quyền" và không có vùng chọn tệp | PRD-REQ-20261015-092431191 | prd-admin-product-import-error |
| tải mẫu lỗi | Không tải được tệp mẫu: chữ lỗi cạnh liên kết, trang vẫn dùng được | PRD-REQ-20261015-092431230 | prd-admin-product-import-template-error |

## Phần tử
Màn chỉ dành cho admin; staff và sale không thấy mục menu và bị 403 nếu vào đường dẫn.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prd-admin-product-import-template | Liên kết Tải tệp mẫu (.xlsx) | admin | Tải `mau-import-san-pham.xlsx` | PRD-REQ-20261015-092431230 |
| prd-admin-product-import-template-error | Chữ lỗi khi không tải được tệp mẫu | admin | - | PRD-REQ-20261015-092431230 |
| prd-admin-product-import-file | Ô chọn tệp (.xlsx, .csv) | admin | Chọn một tệp | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-file-name | Dòng tên và kích thước tệp đã chọn | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-file-error | Banner lỗi tệp bị từ chối (kèm lý do) | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-preview | Nút Xem trước (gửi `dry_run=true`) | admin | Kiểm tra tệp, không ghi | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-loading | Khung chờ khi đang kiểm tra | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-summary | Dòng tóm tắt: tạo, cập nhật, không đổi, lỗi | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-ignored-columns | Dòng các cột bị bỏ qua (ĐVT, Tồn kho, cột lạ) | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-errors-only | Ô chọn "Chỉ hiện dòng lỗi" | admin | Lọc bảng theo dòng lỗi | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-report | Bảng báo cáo từng dòng (số dòng, mã hàng, kết quả, chi tiết) | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-row | Một dòng của báo cáo | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-row-error | Chữ lỗi của dòng (mã và lý do, một hoặc nhiều lỗi) | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-no-valid | Dòng "Không có dòng hợp lệ để ghi" | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-confirm | Nút Xác nhận import (gửi `dry_run=false`, kèm số dòng sẽ ghi) | admin | Ghi các dòng hợp lệ | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-writing | Trạng thái đang ghi | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-result | Vùng Kết quả import sau khi ghi (số liệu thật, bảng từng dòng) | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-again | Nút Import tệp khác | admin | Về trạng thái chưa chọn tệp | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-error | Banner lỗi (429, 5xx, hết phiên, không có quyền) | admin | - | PRD-REQ-20261015-092431191 |
| prd-admin-product-import-retry | Nút Thử lại | admin | Gửi lại với cùng tệp và cùng `Idempotency-Key` | PRD-REQ-20261015-092431191 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Audit (câu 2 của evon):** chưa tải lại codebase; theo mặc định evon (flat, Tailwind, `references/tokens.css`) như các màn PRD khác. Bố cục theo mẫu tải tệp (`components/file-upload.md`) và bảng dữ liệu của evon; nhất quán với `admin-product-list` và `admin-product-edit`.
- **Việc nguy hiểm:** đổi giá hàng loạt sai là rủi ro (ADR-025), nên bước Xem trước là bắt buộc về giao diện: nút Xác nhận chỉ bật sau khi có kết quả xem trước của đúng tệp đang chọn; đổi tệp thì xóa kết quả xem trước và vô hiệu nút Xác nhận. Số dòng đổi giá hiện ngay ở dòng tóm tắt và ở cột Chi tiết (giá cũ và mới). Không dùng hộp thoại thứ hai (bước Xem trước đã là bước xác nhận).
- Cột Chi tiết hiển thị giá vốn: màn chỉ admin thấy; staff và sale không có đường vào (SB-42).
- Tên hàng, nhóm hàng, mã hàng trong bảng là văn bản đã escape, không bao giờ diễn giải công thức hay HTML (SB-12, SB-43). Tên tệp hiển thị đã escape.
- Mã lỗi hiển thị bằng câu tiếng Việt theo `code` (ví dụ `category_not_found` thành `Nhóm hàng: không tìm thấy "…"`); mã thô để trong thuộc tính cho nhà phát triển.
- Sản phẩm mới từ import là Nháp, không ảnh: màn nhắc admin thêm ảnh ở `admin-product-edit` rồi công bố (PRD-REQ-20261006-095502613).
- Không viết code giao diện; dựng thật là việc của `implement`.
