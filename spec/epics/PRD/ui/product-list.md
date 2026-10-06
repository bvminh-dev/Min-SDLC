---
screen: product-list
epic: PRD
status: draft
covers: [PRD-REQ-20261006-095502484, PRD-REQ-20261006-095502697, PRD-REQ-20261006-095502718, PRD-REQ-20261006-095502739]
roles: [guest, customer, staff, admin]
---
# Danh sách sản phẩm (duyệt theo danh mục, tìm kiếm, lọc giá)

## Wireframe
Phương án đã chọn: **A** (cây danh mục ở cột trái, lưới thẻ sản phẩm bên phải, thanh tìm và sắp xếp phía trên). **Đây là lựa chọn mặc định** của skill (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Cột danh mục trái và lưới thẻ (khuyên dùng, đã chọn)** | Danh mục luôn thấy, lưới thẻ chiếm phần lớn màn | Chọn danh mục đổi lưới; thanh tìm và sắp xếp ở trên | Dưới `md` cột danh mục thành nút mở ngăn kéo, tốn một thao tác |
| B. Thanh danh mục ngang trên cùng, lưới bên dưới | Danh mục ở hàng tab trên | Nhiều chỗ cho lưới hơn | Cây ba cấp không vừa một hàng ngang |
| C. Danh sách dòng một cột (ảnh nhỏ, tên, giá) | Mỗi sản phẩm một dòng | Dễ so giá | Kém hấp dẫn cho hàng cần nhìn ảnh, nhiều cuộn |

Lý do chọn A: khách đến để tìm một món trong cây ba cấp; cần thấy được nhánh đang đứng và nhìn ảnh để chọn, nên cây bên cạnh và thẻ có ảnh hợp nhất.

```
Header:  Logo   [ Tìm sản phẩm theo tên hoặc mã sku...        ] (Tìm)        Đăng nhập
┌───────────────┬──────────────────────────────────────────────────────────────────────┐
│ Danh mục      │ Áo (30 sản phẩm)                       Giá: [ từ ] - [ đến ] (Lọc)  │
│ ▾ Thời trang  │                                        Sắp xếp: [ Mới nhất ▾ ]       │
│    Áo (30)    ├──────────────────────────────────────────────────────────────────────┤
│     Áo thun 5 │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                          │
│    Quần (2)   │ │  ảnh   │ │  ảnh   │ │  ảnh   │ │  ảnh   │   <- thẻ bấm mở chi tiết  │
│ ▸ Phụ kiện    │ │Áo thun │ │Áo sơ mi│ │Áo khoác│ │Áo len  │                          │
│               │ │150.000đ│ │220.000đ│ │450.000đ│ │180.000đ│                          │
│               │ │★ 4,5(10)│ │Chưa có │ │★ 4,0(3)│ │★ 5,0(1)│                          │
│               │ │Còn hàng│ │Hết hàng│ │Còn hàng│ │Còn hàng│                          │
│               │ └────────┘ └────────┘ └────────┘ └────────┘                          │
├───────────────┴──────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 30 sản phẩm                                          ‹ 1 2 ›          │
└──────────────────────────────────────────────────────────────────────────────────────┘
Dưới md: cột danh mục thành nút "Danh mục" mở ngăn kéo; lưới 2 cột; hàng lọc giá và sắp xếp xuống một nút "Bộ lọc" mở panel.
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện, lấy từ Given/When/Then của requirement. Cột testid là phần tử mà E2E kiểm.

| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Lưới 20 thẻ, tổng số ở chân, phân trang khi từ 2 trang, danh mục đang chọn tô nền nhẹ | PRD-REQ-20261006-095502697 | prd-product-list-card |
| đang tải | Khung chờ đúng hình 8 thẻ; đổi trang hay bộ lọc thì giữ dữ liệu cũ mờ đi | PRD-REQ-20261006-095502697 | prd-product-list-loading |
| rỗng | "Chưa có sản phẩm nào đang bán." một dòng chữ mờ (không có sản phẩm nào, không lọc) | PRD-REQ-20261006-095502697 | prd-product-list-empty |
| rỗng do lọc hoặc tìm | "Không tìm thấy sản phẩm phù hợp." kèm nút "Xóa bộ lọc"; cũng là trang trống khi đúng 20 sản phẩm mà vào trang 2 | PRD-REQ-20261006-095502718 | prd-product-list-empty-filtered |
| lỗi | Banner "Không tải được danh sách sản phẩm." kèm nút "Thử lại"; lỗi bộ lọc không hợp lệ (400) cũng vào đây | PRD-REQ-20261006-095502697 | prd-product-list-error |
| quá nhiều yêu cầu | Banner "Bạn thao tác quá nhanh, thử lại sau ít giây." (429), nút bộ lọc tạm khóa theo thời gian chờ | PRD-REQ-20261006-095502697 | prd-product-list-rate-limited |
| cây danh mục lỗi | Khối danh mục hiện "Không tải được danh mục" kèm nút Thử lại, lưới vẫn dùng được | PRD-REQ-20261006-095502484 | prd-product-list-category-error |
| cây danh mục rỗng | "Chưa có danh mục." ở cột trái | PRD-REQ-20261006-095502484 | prd-product-list-category-empty |
| điểm đánh giá | Thẻ hiện "★ 4,5 (10)"; chưa có đánh giá thì hiện "Chưa có đánh giá", không hiện 0 sao | PRD-REQ-20261006-095502739 | prd-product-list-card-rating |
| còn hàng, hết hàng | Thẻ hiện "Còn hàng" hoặc "Hết hàng" theo `in_stock` của INV (một lời gọi theo lô cho các `id` của trang); INV lỗi thì thẻ không hiện nhãn, lưới vẫn đủ | PRD-REQ-20261006-095502697 | prd-product-list-card-stock |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prd-product-list-category-tree | Cây danh mục (ngăn kéo dưới md) | guest, customer, staff, admin | Mở và thu gọn nhánh | PRD-REQ-20261006-095502484 |
| prd-product-list-category-item | Một danh mục trong cây | guest, customer, staff, admin | Bấm để lọc theo danh mục | PRD-REQ-20261006-095502484 |
| prd-product-list-category-count | Số sản phẩm đang bán cạnh tên danh mục | guest, customer, staff, admin | - | PRD-REQ-20261006-095502484 |
| prd-product-list-category-error | Khối lỗi cây danh mục | guest, customer, staff, admin | - | PRD-REQ-20261006-095502484 |
| prd-product-list-category-empty | Vùng cây danh mục rỗng | guest, customer, staff, admin | - | PRD-REQ-20261006-095502484 |
| prd-product-list-search-input | Ô tìm theo tên hoặc mã sku (tối đa 100 ký tự) | guest, customer, staff, admin | Gõ từ khóa | PRD-REQ-20261006-095502718 |
| prd-product-list-search-submit | Nút Tìm | guest, customer, staff, admin | Chạy tìm kiếm | PRD-REQ-20261006-095502718 |
| prd-product-list-min-price | Ô giá từ | guest, customer, staff, admin | Nhập số nguyên đồng | PRD-REQ-20261006-095502697 |
| prd-product-list-max-price | Ô giá đến | guest, customer, staff, admin | Nhập số nguyên đồng | PRD-REQ-20261006-095502697 |
| prd-product-list-apply-price | Nút Lọc giá | guest, customer, staff, admin | Áp khoảng giá | PRD-REQ-20261006-095502697 |
| prd-product-list-sort | Ô chọn sắp xếp (Mới nhất, Giá tăng, Giá giảm, Liên quan khi có từ khóa) | guest, customer, staff, admin | Chọn kiểu sắp xếp | PRD-REQ-20261006-095502697 |
| prd-product-list-clear-filter | Nút Xóa bộ lọc (chỉ khi đang lọc hoặc tìm) | guest, customer, staff, admin | Về danh sách mặc định | PRD-REQ-20261006-095502718 |
| prd-product-list-card | Thẻ sản phẩm | guest, customer, staff, admin | Bấm để mở chi tiết | PRD-REQ-20261006-095502697 |
| prd-product-list-card-image | Ảnh đại diện trên thẻ | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-card-name | Tên sản phẩm (văn bản đã escape) | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-card-price | Giá, định dạng nghìn, đơn vị đ | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-card-rating | Điểm sao và số đánh giá | guest, customer, staff, admin | - | PRD-REQ-20261006-095502739 |
| prd-product-list-card-stock | Nhãn còn hàng hoặc hết hàng trên thẻ (không số lượng) | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-summary | Dòng "1 tới 20 trong 30 sản phẩm" | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-pagination | Phân trang ‹ 1 2 › (ẩn khi một trang) | guest, customer, staff, admin | Sang trang khác | PRD-REQ-20261006-095502697 |
| prd-product-list-loading | Khung chờ | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-empty | Vùng rỗng, chưa có sản phẩm | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-empty-filtered | Vùng rỗng do tìm hoặc lọc | guest, customer, staff, admin | - | PRD-REQ-20261006-095502718 |
| prd-product-list-error | Banner lỗi | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |
| prd-product-list-retry | Nút Thử lại | guest, customer, staff, admin | Tải lại danh sách | PRD-REQ-20261006-095502697 |
| prd-product-list-rate-limited | Banner quá nhiều yêu cầu | guest, customer, staff, admin | - | PRD-REQ-20261006-095502697 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua (trang lướt chọn hàng); màn này vẫn làm theo mẫu danh sách có bộ lọc và danh sách rỗng của evon, kết quả có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json`, không có token hay component sẵn; stack web theo ADR-002 (Next.js), thư viện UI và CSS chưa có ADR (questions.md câu 10). Mặc định theo evon: flat, Tailwind và `references/tokens.css`, copy tiếng Việt.
- **Brief (U1, nguồn: đọc spec):** cửa hàng online; người dùng là khách chưa hoặc đã đăng nhập; việc chính: tìm đúng sản phẩm và biết giá; dùng nhiều trên điện thoại (375px).
- **Danh sách màn (U2, mặc định đã xác nhận thay người dùng):** `product-list` (cả bốn role, PRD-REQ-20261006-095502484, PRD-REQ-20261006-095502697, PRD-REQ-20261006-095502718, PRD-REQ-20261006-095502739), `product-detail` (cả bốn role, PRD-REQ-20261006-095502676, PRD-REQ-20261006-095502739), `admin-product-list` (staff, admin, PRD-REQ-20261006-095502655, PRD-REQ-20261006-095502550), `admin-product-edit` (staff xem, admin sửa, PRD-REQ-20261006-095502550 tới PRD-REQ-20261006-095502655), `admin-category` (admin, PRD-REQ-20261006-095502484, PRD-REQ-20261006-095502507, PRD-REQ-20261006-095502529). Không có requirement nào thuần hệ thống thiếu màn: PRD-REQ-20261006-095502739 (event từ REV) chỉ có phần hiển thị điểm, đặt ở `product-list` và `product-detail`.
- Kết quả tìm kiếm dùng lại màn này (ô tìm đặt ở header); khi có từ khóa, tiêu đề đổi thành "Kết quả cho ..." và sắp xếp mặc định là Liên quan. Tìm kiếm và duyệt là hai endpoint khác nhau nhưng một màn.
- 20 sản phẩm mỗi trang cố định, không có ô chọn số dòng mỗi trang. Không có ô lọc theo điểm đánh giá hay theo còn hàng. Nhãn còn hàng, hết hàng ghép ở web từ endpoint công khai của INV (K-12, SB-37, chỉ `in_stock`); PRD không đọc tồn kho. Nút Thêm vào giỏ thuộc epic CRT, chưa vẽ ở đây.
- Mọi chữ do người dùng nhập (từ khóa, tên, mô tả) hiển thị dạng văn bản đã escape (SB-12).
- Không viết code giao diện; dựng thật là việc của `implement`.
