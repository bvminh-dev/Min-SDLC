---
screen: product-detail
epic: PRD
status: draft
covers: [PRD-REQ-20261006-095502676, PRD-REQ-20261006-095502739]
roles: [guest, customer, staff, admin]
---
# Chi tiết sản phẩm

## Wireframe
Phương án đã chọn: **A** (thư viện ảnh bên trái, thông tin và mô tả bên phải, breadcrumb trên cùng). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hai cột: ảnh trái, thông tin phải (khuyên dùng, đã chọn)** | Ảnh lớn, tên, giá, điểm cạnh nhau | Chọn ảnh nhỏ đổi ảnh lớn | Dưới `md` xếp một cột, mô tả bị đẩy xuống |
| B. Một cột dài, ảnh vuốt ngang | Cuộn dọc mọi thứ | Hợp điện thoại | Trên máy tính lãng phí chiều ngang |
| C. Ảnh rộng toàn chiều ngang rồi thông tin | Ảnh là trọng tâm | Ấn tượng thị giác | Giá và nút mua trôi xuống dưới màn đầu |

Lý do chọn A: khách cần so ảnh với giá và điểm trong một cái nhìn; mô tả dài nằm dưới không cản việc quyết định.

```
Thời trang  ›  Áo  ›  Áo thun cotton                                   <- breadcrumb
┌────────────────────────────┬─────────────────────────────────────────────┐
│ ┌────────────────────────┐ │ Áo thun cotton                              │
│ │      ảnh lớn           │ │ Mã: AT-001                                  │
│ │                        │ │ 150.000 đ                                   │
│ └────────────────────────┘ │ ★ 4,5 (10 đánh giá)    (hoặc: Chưa có đánh giá)│
│ [ảnh][ảnh][ảnh]            │ Còn hàng   (hoặc: Hết hàng)                 │
│ Danh mục: Áo                                │
│                            │ [ Thêm vào giỏ ]  <- thuộc CRT, chưa vẽ ở PRD│
├────────────────────────────┴─────────────────────────────────────────────┤
│ Mô tả                                                                    │
│ Văn bản thường, xuống dòng giữ nguyên, đã escape.                         │
└──────────────────────────────────────────────────────────────────────────┘
Dưới md: một cột; ảnh lớn vuốt ngang, thumbnail dưới ảnh.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Đủ ảnh, tên, mã, giá, danh mục, điểm, mô tả | PRD-REQ-20261006-095502676 | prd-product-detail-name |
| đang tải | Khung chờ đúng hình (ảnh lớn, ba dòng chữ, khối mô tả) | PRD-REQ-20261006-095502676 | prd-product-detail-loading |
| không tìm thấy | "Không tìm thấy sản phẩm." kèm liên kết "Về danh sách sản phẩm"; dùng chung cho draft, archived, không tồn tại, id sai (cùng một 404) | PRD-REQ-20261006-095502676 | prd-product-detail-not-found |
| lỗi | Banner "Không tải được sản phẩm." kèm nút "Thử lại" (503) | PRD-REQ-20261006-095502676 | prd-product-detail-error |
| chưa có đánh giá | Dòng "Chưa có đánh giá", không hiện 0 sao | PRD-REQ-20261006-095502739 | prd-product-detail-rating-empty |
| có đánh giá | "★ 4,5 (10 đánh giá)" | PRD-REQ-20261006-095502739 | prd-product-detail-rating |
| không có mô tả | Ẩn vùng mô tả | PRD-REQ-20261006-095502676 | prd-product-detail-description |
| còn hàng | Nhãn "Còn hàng" (INV trả `in_stock` = true) | PRD-REQ-20261006-095502676 | prd-product-detail-stock |
| hết hàng | Nhãn "Hết hàng" (`in_stock` = false), không hiện số tồn | PRD-REQ-20261006-095502676 | prd-product-detail-stock |
| không biết tồn kho | INV lỗi hoặc quá thời gian: ẩn nhãn, phần còn lại hiện bình thường | PRD-REQ-20261006-095502676 | prd-product-detail-name |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prd-product-detail-breadcrumb | Breadcrumb danh mục cha tới danh mục chứa sản phẩm | guest, customer, staff, admin | Bấm một cấp để về danh sách của cấp đó | PRD-REQ-20261006-095502676 |
| prd-product-detail-gallery | Ảnh lớn | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-thumbnail | Ảnh nhỏ | guest, customer, staff, admin | Bấm đổi ảnh lớn | PRD-REQ-20261006-095502676 |
| prd-product-detail-name | Tên sản phẩm (đã escape) | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-sku | Mã sku | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-price | Giá hiện hành | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-category | Danh mục | guest, customer, staff, admin | Bấm để về danh sách danh mục | PRD-REQ-20261006-095502676 |
| prd-product-detail-stock | Nhãn còn hàng hoặc hết hàng (chỉ hai giá trị, không số lượng) | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-rating | Điểm sao và số đánh giá | guest, customer, staff, admin | - | PRD-REQ-20261006-095502739 |
| prd-product-detail-rating-empty | Dòng chưa có đánh giá | guest, customer, staff, admin | - | PRD-REQ-20261006-095502739 |
| prd-product-detail-description | Mô tả (đã escape) | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-loading | Khung chờ | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-not-found | Vùng không tìm thấy | guest, customer, staff, admin | Bấm Về danh sách sản phẩm | PRD-REQ-20261006-095502676 |
| prd-product-detail-error | Banner lỗi | guest, customer, staff, admin | - | PRD-REQ-20261006-095502676 |
| prd-product-detail-retry | Nút Thử lại | guest, customer, staff, admin | Tải lại | PRD-REQ-20261006-095502676 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** cửa hàng online phía người mua chưa được dạy; màn dựng theo mẫu mô tả thông tin (description-list) và thư viện ảnh, kết quả có thể chưa đẹp.
- Nút Thêm vào giỏ không thuộc PRD (CRT); chỗ để trống trong wireframe chỉ để giữ bố cục, CRT thêm testid khi có spec.
- Nhãn còn hàng, hết hàng (K-12, SB-37): web gọi `GET /inventory/availability?product_ids=` của INV, chỉ nhận `in_stock`; PRD không trả và không đọc tồn kho. INV lỗi thì ẩn nhãn, không báo lỗi.
- Chữ ký 404 của màn: cùng một giao diện cho mọi nguyên nhân (không cho biết sản phẩm có tồn tại hay không), khớp PRD-REQ-20261006-095502676 BR2.
- Giá hiển thị là giá hiện hành, không phải giá chốt khi thanh toán (PRD-REQ-20261006-095502676 BR6); không viết "giá cuối" ở màn này.
- Mô tả giữ xuống dòng, không render HTML (SB-12). Mô tả rỗng thì ẩn cả tiêu đề "Mô tả".
- Không viết code giao diện; dựng thật là việc của `implement`.
