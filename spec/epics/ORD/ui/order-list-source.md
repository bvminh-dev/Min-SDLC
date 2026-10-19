---
screen: order-list-source
epic: ORD
status: approved
covers: [ORD-REQ-20261006-092320743, ORD-REQ-20261015-092748678]
roles: [staff, sale, admin]
---
# Danh sách đơn quản trị: bộ lọc nguồn, người tạo và cột nguồn, người tạo

Màn này BỔ SUNG cho `order-admin-list` (đã duyệt, staff và admin; tab trạng thái, ô tìm mã, bảng 6 cột): thêm bộ lọc nguồn, bộ lọc người tạo, hai cột mới và bản dành cho sale. Khi dựng, hai tài liệu là MỘT trang `/admin/orders` (cùng bảng, cùng phân trang); `order-admin-list` không được sửa ở đợt này nên phần mới đứng riêng ở đây và dùng testid riêng. Việc gộp thành một tài liệu để lại cho lần duyệt sau.

## Wireframe
Phương án đã chọn: **A** (giữ bảng của `order-admin-list`, thêm một hàng bộ lọc dưới tab trạng thái và hai cột). **Mặc định** của skill, tự chọn theo hướng dẫn "không dừng chờ"; nhất quán với `order-admin-list` và dùng lại `Pager`, `OrderList`.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Thêm hàng lọc và hai cột (đã chọn)** | Nguồn và người tạo nằm ngay trên cùng một hàng với mã đơn | Hai ô chọn dưới tab trạng thái | Bảng thêm 2 cột; dưới `@4xl` ẩn cột Người tạo, dưới `sm` thành danh sách dòng |
| B. Ngăn lọc bên cạnh | Bộ lọc ở cột trái | Nhiều bộ lọc cùng lúc | Chỉ có ba bộ lọc, chiếm chỗ vô ích; chật dưới 1600px |
| C. Lọc bằng ô tìm kiểu `nguồn:facebook` | Một ô cho mọi thứ | Gọn | Khó phát hiện, dễ gõ sai mã nguồn |

```
Thanh header:  ☰  Đơn hàng                                                 🔔
┌──────────────────────────────────────────────────────────────────────────────────┐
│ (sale) Đang xem: đơn do bạn tạo                                                  │  <- chỉ sale
│ [Tất cả] Chờ xử lý  Đã xác nhận  Đã thanh toán  Đang giao  Đã giao ...            │
│ [ Tìm theo mã đơn           ]  [Nguồn: Tất cả ▾]  [Người tạo: Tất cả ▾]  Xoá lọc  │  <- Người tạo chỉ staff, admin
├──────────────────────────────────────────────────────────────────────────────────┤
│ Mã đơn          Ngày tạo   Trạng thái  Thanh toán        Nguồn      Người tạo  Tổng │
│ HD261015-00003  15/10 09:00 (Đã xác nhận) Tiền mặt · Chờ   Facebook   Trần Thu  480.000 đ │
│ HD261015-00002  15/10 08:40 (Đã xác nhận) COD · Chưa thu    Hotline    Lê Minh   250.000 đ │
│ 7K3M9Q2XH4TB    06/10 09:00 (Đã TT)    VNPay · Thành công  Website    —         350.000 đ │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 45 đơn                                            ‹ 1 2 3 ›        │
└──────────────────────────────────────────────────────────────────────────────────┘
Ô Nguồn liệt kê cả nguồn đã tắt (có chú thích "đã tắt") để lọc đơn cũ. Cột Người tạo hiện — với đơn khách tự đặt.
Không cột tên khách, điện thoại, địa chỉ, ghi chú, giá vốn (SB-08, SB-42).
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Hai cột Nguồn và Người tạo (— với đơn khách tự đặt) trên mọi dòng; mã đơn hiện cả hai dạng | ORD-REQ-20261006-092320743 | ord-order-list-source-cell |
| đang lọc | Ô Nguồn và Người tạo giữ giá trị đang dùng, Xoá lọc hiện | ORD-REQ-20261006-092320743 | ord-order-list-source-clear |
| đang tải | Khung chờ đúng hình hàng bảng; đổi lọc thì giữ dữ liệu cũ mờ đi; ô Nguồn có khung chờ khi danh mục đang tải | ORD-REQ-20261015-092748678 | ord-order-list-source-loading |
| rỗng do lọc | "Không có đơn nào khớp." kèm Xoá lọc (cũng là kết quả khi sale tìm mã đơn của người khác) | ORD-REQ-20261006-092320743 | ord-order-list-source-empty |
| lỗi | Banner "Không tải được danh sách đơn." kèm Thử lại; 400 (nguồn hay người tạo không hợp lệ) và 429 bậc D cũng vào đây | ORD-REQ-20261006-092320743 | ord-order-list-source-error |
| lỗi danh mục nguồn | Ô Nguồn hiện "Không tải được danh sách nguồn" kèm Thử lại; danh sách đơn vẫn dùng được, chỉ không lọc theo nguồn | ORD-REQ-20261015-092748678 | ord-order-list-source-filter-error |
| phạm vi của sale | Sale thấy dòng "Đang xem: đơn do bạn tạo"; không có ô Người tạo; tổng số chỉ tính đơn của sale | ORD-REQ-20261006-092320743 | ord-order-list-source-scope-note |
| không có quyền | Customer mở màn (403): trang "Bạn không có quyền xem trang này"; chưa đăng nhập (401) về đăng nhập | ORD-REQ-20261006-092320743 | - |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-list-source-filter-source | Ô chọn Nguồn (nguồn đang bật rồi nguồn đã tắt kèm chú thích, lấy từ `GET /order-sources?include_inactive=true`) | staff, admin | Chọn một nguồn hoặc Tất cả | ORD-REQ-20261015-092748678 |
| ord-order-list-source-filter-source-sale | Ô chọn Nguồn của sale (chỉ nguồn đang bật, lấy từ `GET /order-sources`) | sale | Chọn một nguồn hoặc Tất cả | ORD-REQ-20261006-092320743 |
| ord-order-list-source-filter-creator | Ô chọn Người tạo (nhân viên đã tạo đơn hộ, lấy từ các đơn đã tải hoặc danh sách người tạo) | staff, admin | Chọn một người tạo hoặc Tất cả | ORD-REQ-20261006-092320743 |
| ord-order-list-source-clear | Nút Xoá lọc (chỉ khi đang lọc) | staff, sale, admin | Gỡ lọc nguồn, người tạo, từ khoá | ORD-REQ-20261006-092320743 |
| ord-order-list-source-search | Ô tìm theo mã đơn (cả hai dạng mã; sale chỉ khớp trong đơn của mình) | staff, sale, admin | Nhập mã đơn rồi tìm | ORD-REQ-20261006-092320743 |
| ord-order-list-source-row | Hàng đơn của bảng (cùng bảng với `order-admin-list`) | staff, sale, admin | Bấm để mở chi tiết đơn | ORD-REQ-20261006-092320743 |
| ord-order-list-source-code | Mã đơn của một dòng (font-mono, hai dạng mã) | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-summary | Dòng "1 tới 20 trong 45 đơn" (với sale chỉ tính đơn của sale) | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-cell | Ô nguồn của một dòng (tên nguồn) | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-creator-cell | Ô người tạo của một dòng (tên nhân viên hoặc —) | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-scope-note | Dòng "Đang xem: đơn do bạn tạo" | sale | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-loading | Khung chờ | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-empty | Vùng rỗng do lọc | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-error | Banner lỗi | staff, sale, admin | - | ORD-REQ-20261006-092320743 |
| ord-order-list-source-retry | Nút Thử lại | staff, sale, admin | Tải lại danh sách | ORD-REQ-20261006-092320743 |
| ord-order-list-source-filter-error | Lỗi tải danh mục nguồn ở ô Nguồn | staff, sale, admin | - | ORD-REQ-20261015-092748678 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Bộ lọc nguồn và người tạo kết hợp AND với tab trạng thái và ô tìm mã (ORD-REQ-20261006-092320743 BR12); chọn nguồn gửi `source`, chọn người tạo gửi `created_by`. Sale không có ô Người tạo vì API từ chối `created_by` của sale (400) và danh sách luôn giới hạn ở chính sale.
- Nguồn đã tắt vẫn lọc được (BR11) nên ô Nguồn của staff, admin lấy cả nguồn tắt qua `include_inactive=true`; sale chỉ cần nguồn đang bật.
- Cột Người tạo hiện tên nhân viên (không phải dữ liệu cá nhân của khách); không hiện tên khách, điện thoại, địa chỉ, ghi chú hay giá vốn (SB-08, SB-42).
- Sale không có nút hủy hay thao tác nào trên danh sách (chỉ đọc).
- Không viết code giao diện ở phase này.
