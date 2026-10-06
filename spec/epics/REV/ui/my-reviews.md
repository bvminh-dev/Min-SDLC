---
screen: my-reviews
epic: REV
status: draft
covers: [REV-REQ-20261006-103135655, REV-REQ-20261006-103135385, REV-REQ-20261006-103135477]
roles: [customer]
---
# Đánh giá của tôi

Trang `/me/reviews` trong khu tài khoản của customer: liệt kê mọi đánh giá của mình theo trạng thái, sửa và xóa. **Báo trước theo skill evon:** phần cửa hàng phía người mua chưa được dạy; trang theo mẫu danh sách có bộ lọc. Cổng hỏi `U1` đến `U3` được trả lời bằng phương án khuyến nghị (mặc định). Chỉ wireframe ASCII.

## Wireframe
Phương án đã chọn: **A** (danh sách thẻ một cột, bộ lọc trạng thái dạng chip phía trên). **Đây là lựa chọn mặc định**, chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Thẻ một cột với chip trạng thái (khuyên dùng, đã chọn)** | Mỗi đánh giá một thẻ có badge trạng thái, lý do (nếu bị từ chối hoặc ẩn) và nút Sửa, Xóa | Lý do hiện ngay trong thẻ | Dài hơn bảng khi nhiều đánh giá |
| B. Bảng dữ liệu | Nhiều dòng một lượt nhìn | Gọn | Nội dung bình luận dài bị cắt, lý do khó đọc trên màn hẹp |
| C. Hai tab Chờ duyệt / Đã đăng | Tách theo việc | Ít chip | Bỏ trạng thái bị từ chối và bị ẩn khỏi tầm nhìn |

Lý do chọn A: người dùng cần hiểu "vì sao đánh giá của tôi không hiện" nên lý do kiểm duyệt phải nằm cạnh badge.

```
Thanh header:  ☰  Tài khoản › Đánh giá của tôi                                      (T)
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] [Chờ duyệt] [Đã đăng] [Bị từ chối] [Bị ẩn]                           │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ [ảnh SP] Áo thun cổ tròn                       (Chờ duyệt)   06/10/2026   │ │
│ │ ★★★★☆  Vải mát, đúng size.   [ảnh][ảnh]                                   │ │
│ │                                                       [Sửa]  [Xóa]        │ │  <- chờ duyệt: Sửa và Xóa (rút đánh giá)
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ [ảnh SP] Tất cổ cao                            (Đã đăng)     05/10/2026   │ │
│ │ ★★★★★  Rất êm.                                    [Sửa]  [Xóa]           │ │  <- đã đăng: Sửa và Xóa
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ [ảnh SP] Mũ lưỡi trai                          (Bị từ chối)  04/10/2026   │ │
│ │ ★☆☆☆☆  ...        Lý do: Chứa số điện thoại liên hệ          [Xóa]        │ │  <- bị từ chối/bị ẩn: kèm lý do, không Sửa, có Xóa để viết lại
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                     [‹ Trước]  Trang 1 / 2  [Sau ›]           │
└──────────────────────────────────────────────────────────────────────────────┘

Hộp thoại Xóa đánh giá:
┌ Xóa đánh giá "Tất cổ cao"? ──────────────────────────────┐
│ Đánh giá sẽ biến mất khỏi trang sản phẩm và không thể khôi │
│ phục. Bạn có thể viết đánh giá mới sau đó.                 │
│                               [Giữ lại]  [Xóa đánh giá]    │
└────────────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Các thẻ đánh giá mới nhất trước, mỗi thẻ có badge trạng thái (chữ, không chỉ màu) | REV-REQ-20261006-103135655 | rev-my-reviews-list |
| đang tải | Khung chờ ba thẻ | REV-REQ-20261006-103135655 | rev-my-reviews-loading |
| rỗng | "Bạn chưa viết đánh giá nào" kèm liên kết về Đơn hàng của tôi | REV-REQ-20261006-103135655 | rev-my-reviews-empty |
| rỗng sau lọc | "Không có đánh giá nào ở trạng thái này" kèm nút Xem tất cả | REV-REQ-20261006-103135655 | rev-my-reviews-empty-filter |
| lỗi | Banner "Không tải được đánh giá của bạn." kèm Thử lại; hết phiên (401) về đăng nhập; không có quyền (403) báo "Không có quyền" | REV-REQ-20261006-103135655 | rev-my-reviews-error |
| bị từ chối hoặc bị ẩn | Thẻ hiện "Lý do: ..." (văn bản thường, escape); không có nút Sửa; có nút Xóa (xóa xong viết lại được, E-22) | REV-REQ-20261006-103135655 | rev-my-reviews-item-reason |
| sản phẩm đã ngừng bán | Thẻ vẫn hiện tên sản phẩm, có chú thích "Sản phẩm đã ngừng bán"; nút theo trạng thái đánh giá | REV-REQ-20261006-103135655 | rev-my-reviews-item-product |
| chờ duyệt | Badge "Chờ duyệt"; có nút Sửa và nút Xóa (rút đánh giá chờ duyệt) | REV-REQ-20261006-103135385 | rev-my-reviews-item-edit |
| đã đăng | Badge "Đã đăng"; có Sửa và Xóa; khi `edit_requires_review` = true, cạnh nút Sửa có chú thích "Sửa sẽ đưa đánh giá về chờ duyệt" | REV-REQ-20261006-103135477 | rev-my-reviews-item-delete |
| hộp thoại xóa | Hộp thoại xác nhận có nút Giữ lại và Xóa đánh giá; không đóng khi bấm ra ngoài | REV-REQ-20261006-103135477 | rev-my-reviews-delete-dialog |
| đang xóa | Nút Xóa đánh giá khóa kèm vòng xoay | REV-REQ-20261006-103135477 | rev-my-reviews-delete-confirm |
| xóa thành công | Hộp thoại đóng, thẻ biến mất, thông báo "Đã xóa đánh giá" | REV-REQ-20261006-103135477 | rev-my-reviews-delete-success |
| xóa không được | Báo lỗi trong hộp thoại: 404 "Đánh giá không còn tồn tại" (đã bị xóa) có nút Tải lại; 5xx "Không xóa được, thử lại" | REV-REQ-20261006-103135477 | rev-my-reviews-delete-error |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| rev-my-reviews-filter-status | Nhóm chip lọc trạng thái (Tất cả, Chờ duyệt, Đã đăng, Bị từ chối, Bị ẩn) | customer | Đổi `status`, về trang 1 | REV-REQ-20261006-103135655 |
| rev-my-reviews-filter-clear | Nút Xem tất cả trong trạng thái rỗng sau lọc | customer | Bỏ lọc | REV-REQ-20261006-103135655 |
| rev-my-reviews-list | Danh sách thẻ đánh giá | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item | Một thẻ đánh giá | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-product | Tên và ảnh sản phẩm | customer | Mở trang sản phẩm | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-status | Badge trạng thái đánh giá | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-rating | Số sao | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-comment | Nội dung bình luận | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-images | Dải ảnh đính kèm | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-reason | Lý do kiểm duyệt (chỉ khi bị từ chối hoặc ẩn) | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-item-edit | Nút Sửa (chỉ khi chờ duyệt hoặc đã đăng) | customer | Mở form sửa | REV-REQ-20261006-103135385 |
| rev-my-reviews-item-delete | Nút Xóa (mọi trạng thái trong danh sách: chờ duyệt, đã đăng, bị từ chối, bị ẩn) | customer | Mở hộp thoại xóa | REV-REQ-20261006-103135477 |
| rev-my-reviews-delete-dialog | Hộp thoại xác nhận xóa | customer | - | REV-REQ-20261006-103135477 |
| rev-my-reviews-delete-confirm | Nút Xóa đánh giá | customer | Gửi yêu cầu xóa | REV-REQ-20261006-103135477 |
| rev-my-reviews-delete-dismiss | Nút Giữ lại | customer | Đóng hộp thoại, không xóa | REV-REQ-20261006-103135477 |
| rev-my-reviews-delete-error | Vùng lỗi trong hộp thoại (404, 5xx) | customer | - | REV-REQ-20261006-103135477 |
| rev-my-reviews-delete-reload | Nút Tải lại danh sách trong lỗi 404 | customer | Tải lại danh sách | REV-REQ-20261006-103135477 |
| rev-my-reviews-delete-success | Thông báo "Đã xóa đánh giá" | customer | - | REV-REQ-20261006-103135477 |
| rev-my-reviews-page-prev | Nút Trước | customer | Về trang trước | REV-REQ-20261006-103135655 |
| rev-my-reviews-page-next | Nút Sau | customer | Sang trang sau | REV-REQ-20261006-103135655 |
| rev-my-reviews-loading | Khung chờ | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-empty | Khối chưa có đánh giá | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-empty-filter | Khối rỗng sau lọc | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-error | Banner lỗi | customer | - | REV-REQ-20261006-103135655 |
| rev-my-reviews-retry | Nút Thử lại | customer | Tải lại | REV-REQ-20261006-103135655 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Nút Sửa, Xóa hiện theo `can_edit`, `can_delete` của API (REV-REQ-20261006-103135655 BR5); việc kiểm quyền thật ở server. Theo vòng đời nền (E-22) xóa được ở mọi trạng thái; đánh giá bị từ chối hoặc bị ẩn không sửa được, khách xóa rồi viết lại. Nội dung hộp thoại xóa nhắc "Bạn có thể viết đánh giá mới sau đó".
- Chú thích "Sửa sẽ đưa đánh giá về chờ duyệt" hiện theo `edit_requires_review` (bật `REVIEW_PRE_MODERATION`), để khách biết đánh giá sẽ biến khỏi trang sản phẩm tới khi được duyệt lại (REV-REQ-20261006-103135385 BR6).
- Lý do kiểm duyệt hiển thị cho chủ là mặc định ([OPEN] ở REV-REQ-20261006-103135655); là văn bản thường, escape (SB-12).
- Hộp thoại xóa không có ô nhập nên bấm ra ngoài đóng được, nhưng thao tác xóa không hoàn tác nên vẫn có bước xác nhận.
- Không dựng màn "Chờ đánh giá" (liệt kê sản phẩm đã mua chưa đánh giá): requirement chưa có endpoint liệt kê, chỉ có kiểm điều kiện theo từng sản phẩm.
- Không viết code giao diện; dựng thật là việc của `implement`.
