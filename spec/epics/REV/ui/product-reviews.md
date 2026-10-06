---
screen: product-reviews
epic: REV
status: draft
covers: [REV-REQ-20261006-103135566, REV-REQ-20261006-103135296]
roles: [guest, customer, staff, admin]
---
# Đánh giá của sản phẩm (danh sách công khai)

Trang con của sản phẩm (`/products/{id}/reviews`), mở từ dòng "★ 4,5 (10 đánh giá)" ở chi tiết sản phẩm của PRD. **Báo trước theo skill evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua; trang này vẫn làm theo mẫu danh sách có bộ lọc và `timeline`, kết quả có thể chưa đẹp bằng màn trong app. Chạy tự động nên các cổng hỏi của `U1` đến `U3` (brief, chọn wireframe) được trả lời bằng phương án khuyến nghị và ghi là mặc định. Ở phase này chỉ có wireframe ASCII trong tài liệu, không dựng HTML hay chạy probe.

## Wireframe
Phương án đã chọn: **A** (cột trái tóm tắt và bộ lọc dính, cột phải danh sách đánh giá). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Tóm tắt bên trái, danh sách bên phải (khuyên dùng, đã chọn)** | Điểm trung bình, phân bố sao và nút Viết đánh giá luôn thấy khi cuộn danh sách | Lọc theo sao đặt ngay cạnh phân bố | Cần khung từ 70rem; hẹp hơn thì một cột, tóm tắt ở trên |
| B. Một cột: tóm tắt trên, danh sách dưới | Tóm tắt rồi tới từng đánh giá | Đơn giản nhất | Tóm tắt trôi mất khi cuộn dài |
| C. Tab Tất cả / Có ảnh / Theo sao | Mỗi tab một danh sách | Xem nhanh đánh giá có ảnh | Chưa có yêu cầu lọc "có ảnh"; thêm trạng thái ngoài requirement |

Lý do chọn A: người đọc muốn thấy điểm tổng và phân bố cùng lúc với nội dung từng đánh giá để so; nút viết đánh giá nằm ở khối tóm tắt vì chỉ khách đủ điều kiện mới có.

```
Thanh header:  ☰  Cửa hàng › Áo thun cổ tròn › Đánh giá                          (T)
┌────────────────────────────────────────────────────────────────────────────────┐
│ ┌ Tóm tắt ─────────────────────┐   Sắp xếp [Mới nhất ▾]   Lọc [Tất cả sao ▾]   │
│ │  4,3  ★★★★☆   25 đánh giá    │ ┌────────────────────────────────────────────┐ │
│ │  5★ ████████████  13         │ │ ★★★★★  An N.  ✓ Đã mua hàng   07/10/2026   │ │
│ │  4★ ██████         8         │ │ Đã dùng một tháng, vẫn tốt. (Đã chỉnh sửa) │ │
│ │  3★ ██             2         │ │ [ảnh][ảnh][ảnh]                            │ │
│ │  2★ █              1         │ ├────────────────────────────────────────────┤ │
│ │  1★ █              1         │ │ ★★★★☆  Bình L.  ✓ Đã mua hàng  06/10/2026  │ │
│ │ [ Viết đánh giá ]            │ │ Vải mát, đúng size.                        │ │
│ │  (khách đủ điều kiện)        │ ├────────────────────────────────────────────┤ │
│ │  hoặc: lý do chưa đánh giá   │ │ ...                                        │ │
│ │  hoặc: Đăng nhập để đánh giá │ └────────────────────────────────────────────┘ │
│ └──────────────────────────────┘              [‹ Trước]  Trang 1 / 2  [Sau ›]   │
└────────────────────────────────────────────────────────────────────────────────┘
```

Thứ tự danh sách theo `sort` của API (REV-REQ-20261006-103135566 BR5). Tên người viết đã che sẵn từ server ("An N."), giao diện không tự cắt. Nội dung bình luận luôn là văn bản thường, escape (SB-12), xuống dòng giữ nguyên.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Khối tóm tắt đủ điểm, số đánh giá, năm hàng phân bố; danh sách các đánh giá kèm nhãn Đã mua hàng | REV-REQ-20261006-103135566 | rev-product-reviews-list |
| đang tải | Khung chờ đúng hình khối tóm tắt và 3 dòng đánh giá | REV-REQ-20261006-103135566 | rev-product-reviews-loading |
| rỗng | Khối căn giữa "Sản phẩm chưa có đánh giá", tóm tắt hiện "Chưa có đánh giá" (không hiện 0 sao) | REV-REQ-20261006-103135566 | rev-product-reviews-empty |
| rỗng sau lọc | "Không có đánh giá nào cho mức sao này" kèm nút Xóa bộ lọc; tóm tắt vẫn đúng theo mọi đánh giá | REV-REQ-20261006-103135566 | rev-product-reviews-empty-filter |
| lỗi | Banner "Không tải được đánh giá." kèm Thử lại (lỗi mạng, 5xx, 429 có chữ "thử lại sau ít phút") | REV-REQ-20261006-103135566 | rev-product-reviews-error |
| không tìm thấy | Khối "404", "Không tìm thấy sản phẩm", nút về danh sách sản phẩm; cùng giao diện cho sản phẩm không tồn tại và đã ngừng bán | REV-REQ-20261006-103135566 | rev-product-reviews-notfound |
| trang vượt cuối | Danh sách rỗng ở trang quá cuối: tự đưa về trang cuối có dữ liệu | REV-REQ-20261006-103135566 | rev-product-reviews-list |
| đã chỉnh sửa | Dòng đánh giá có nhãn "Đã chỉnh sửa" khi `edited_at` khác `null` | REV-REQ-20261006-103135566 | rev-product-reviews-item-edited |
| nhãn đã mua hàng | Mỗi đánh giá có nhãn "Đã mua hàng" kèm biểu tượng, đọc rõ không chỉ bằng màu (`verified_purchase` của danh sách công khai) | REV-REQ-20261006-103135566 | rev-product-reviews-item-verified |
| khách đủ điều kiện | Nút đặc "Viết đánh giá" ở khối tóm tắt (chỉ customer đủ điều kiện) | REV-REQ-20261006-103135296 | rev-product-reviews-write-button |
| khách chưa đủ điều kiện | Dòng giải thích theo mã: `not_purchased` "Chỉ đánh giá được sản phẩm đã mua"; `not_delivered` "Bạn có thể đánh giá sau khi nhận hàng"; `window_expired` "Đã quá 90 ngày kể từ khi nhận hàng"; `already_reviewed` "Bạn đã đánh giá sản phẩm này" kèm liên kết Đánh giá của tôi | REV-REQ-20261006-103135296 | rev-product-reviews-ineligible-reason |
| chưa đăng nhập | Khách (guest) thấy "Đăng nhập để viết đánh giá" thay cho nút; vẫn đọc được mọi đánh giá | REV-REQ-20261006-103135566 | rev-product-reviews-login-prompt |
| staff, admin | Không có nút viết và không có lý do chưa đánh giá (không phải khách mua); đọc như guest | REV-REQ-20261006-103135566 | rev-product-reviews-list |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| rev-product-reviews-summary | Khối tóm tắt (điểm, số đánh giá, phân bố) | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-avg | Điểm trung bình một chữ số thập phân | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-count | Tổng số đánh giá | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-distribution | Năm hàng phân bố theo sao | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-sort | Ô chọn sắp xếp (Mới nhất, Điểm cao, Điểm thấp) | guest, customer, staff, admin | Đổi `sort`, về trang 1 | REV-REQ-20261006-103135566 |
| rev-product-reviews-filter-rating | Ô chọn lọc theo sao (Tất cả, 5 đến 1) | guest, customer, staff, admin | Đổi `rating`, về trang 1 | REV-REQ-20261006-103135566 |
| rev-product-reviews-filter-clear | Nút Xóa bộ lọc | guest, customer, staff, admin | Bỏ lọc sao | REV-REQ-20261006-103135566 |
| rev-product-reviews-list | Danh sách đánh giá | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item | Một đánh giá | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-rating | Số sao của một đánh giá (có chữ "4 trên 5 sao") | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-reviewer | Tên hiển thị đã che và ảnh đại diện | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-comment | Nội dung bình luận (văn bản thường) | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-images | Dải ảnh đính kèm | guest, customer, staff, admin | Bấm ảnh để xem lớn | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-date | Ngày đăng | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-edited | Nhãn "Đã chỉnh sửa" (chỉ khi có `edited_at`) | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-item-verified | Nhãn "Đã mua hàng" | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-page-prev | Nút Trước | guest, customer, staff, admin | Về trang trước | REV-REQ-20261006-103135566 |
| rev-product-reviews-page-next | Nút Sau | guest, customer, staff, admin | Sang trang sau | REV-REQ-20261006-103135566 |
| rev-product-reviews-write-button | Nút Viết đánh giá | customer | Mở form viết đánh giá | REV-REQ-20261006-103135296 |
| rev-product-reviews-ineligible-reason | Dòng lý do chưa đánh giá được | customer | - | REV-REQ-20261006-103135296 |
| rev-product-reviews-login-prompt | Dòng "Đăng nhập để viết đánh giá" | guest | Mở trang đăng nhập | REV-REQ-20261006-103135566 |
| rev-product-reviews-loading | Khung chờ | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-empty | Khối chưa có đánh giá | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-empty-filter | Khối không có đánh giá cho mức lọc | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-error | Banner lỗi | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |
| rev-product-reviews-retry | Nút Thử lại | guest, customer, staff, admin | Tải lại | REV-REQ-20261006-103135566 |
| rev-product-reviews-notfound | Khối "Không tìm thấy sản phẩm" (404) | guest, customer, staff, admin | - | REV-REQ-20261006-103135566 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn dùng chung bốn role chỉ để đọc. Nút Viết đánh giá và dòng lý do chỉ dành cho customer (REV-REQ-20261006-103135296 chỉ cho customer); guest có dòng đăng nhập; staff, admin không có gì thêm.
- Nút Viết đánh giá hiện theo `eligible` của `GET /api/v1/products/{id}/review-eligibility`; server vẫn kiểm lại khi tạo (có thể 409 nếu điều kiện đổi giữa lúc xem và lúc gửi).
- Điểm sao luôn có chữ thay thế ("4 trên 5 sao") cho người dùng đọc màn hình; màu không phải tín hiệu duy nhất (nhãn Đã mua hàng có chữ và biểu tượng).
- Bộ lọc `rating` và `sort` nên nằm trong URL để chia sẻ được (mặc định giao diện, việc nối là của implement).
- Điểm trên trang này (`summary` của REV) có thể lệch ngắn hạn với "★ 4,5" ở chi tiết sản phẩm (PRD giữ bản riêng qua event); trang này luôn theo REV.
- Không viết code giao diện; dựng thật là việc của `implement`.
