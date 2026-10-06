---
screen: review-form
epic: REV
status: draft
covers: [REV-REQ-20261006-103134939, REV-REQ-20261006-103135029, REV-REQ-20261006-103135117, REV-REQ-20261006-103135207, REV-REQ-20261006-103135296, REV-REQ-20261006-103135385]
roles: [customer]
---
# Viết hoặc sửa đánh giá

Một form dùng cho hai chế độ: **viết mới** (`/products/{id}/reviews/new`, từ nút Viết đánh giá) và **sửa** (`/me/reviews/{id}/edit`, từ "Đánh giá của tôi"). Hai chế độ khác nhau ở nút gửi, tiêu đề và dữ liệu đổ sẵn. **Báo trước theo skill evon:** phần cửa hàng phía người mua chưa được dạy; form theo mẫu `layouts/form` của skill. Các cổng hỏi của `U1` đến `U3` được trả lời bằng phương án khuyến nghị (mặc định). Chỉ wireframe ASCII, không dựng HTML.

## Wireframe
Phương án đã chọn: **A** (một cột, form dài trong thẻ giữa trang). **Đây là lựa chọn mặc định**, chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một cột trong thẻ giữa trang (khuyên dùng, đã chọn)** | Sao, bình luận, ảnh nối nhau; nút gửi cuối thẻ | Hợp màn hẹp và màn rộng, một hướng đọc | Trang dài hơn khi có 5 ảnh |
| B. Hộp thoại trên trang sản phẩm | Viết ngay không rời trang | Nhanh | Form có ô nhập và tải ảnh nên hộp thoại không đóng khi bấm ra ngoài (luật `I20`), nặng cho màn nhỏ |
| C. Hai bước (chấm sao rồi viết) | Một việc mỗi bước | Nhẹ đầu | Thêm bước, ảnh và chữ bị đẩy sang bước hai |

Lý do chọn A: ba việc (điểm, chữ, ảnh) là một bản ghi, người viết muốn xem trước tổng thể; hộp thoại có ô nhập dễ mất dữ liệu.

```
Thanh header:  ☰  Cửa hàng › Áo thun cổ tròn › Viết đánh giá                         (T)
┌──────────────────────────────────────────────────────────────┐
│ Đánh giá "Áo thun cổ tròn"                       (✓ Đã mua hàng) │
│ Điểm của bạn *   ☆ ☆ ☆ ☆ ☆        (chọn từ 1 đến 5 sao)         │
│   <lỗi dưới nhóm sao: "Vui lòng chọn số sao">                   │
│ Nhận xét (không bắt buộc)                                       │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │                                                            │ │
│ └────────────────────────────────────────────────────────────┘ │
│   0 / 2000                                                      │
│ Ảnh (tối đa 5, mỗi ảnh ≤ 5 MB, JPEG PNG WebP)                   │
│ [ + Thêm ảnh ]  [ảnh ×] [ảnh ×] [đang tải ▒▒▒▒]  2 / 5          │
│ Đánh giá sẽ hiện sau khi quản trị viên duyệt.   (khi bật duyệt)  │
│                           [Hủy]   [Gửi đánh giá] (viết)          │
│                           [Hủy]   [Lưu thay đổi] (sửa)           │
└──────────────────────────────────────────────────────────────┘
```

Sao chọn bằng nhóm radio có nhãn "1 sao" đến "5 sao" (bàn phím và trình đọc màn hình dùng được), không bắt rê chuột. Ô nhận xét có bộ đếm ký tự theo code point.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| form trống (viết) | Chưa chọn sao, ô nhận xét trống, 0 / 2000, 0 / 5 ảnh, nút Gửi đánh giá | REV-REQ-20261006-103134939 | rev-review-form-submit |
| form đổ sẵn (sửa) | Đã điền sao, nhận xét, ảnh hiện tại; nút Lưu thay đổi; tiêu đề "Sửa đánh giá" | REV-REQ-20261006-103135385 | rev-review-form-save |
| đang tải | Khung chờ đúng hình form (chế độ sửa tải dữ liệu, chế độ viết kiểm điều kiện) | REV-REQ-20261006-103134939 | rev-review-form-loading |
| thiếu sao | Lỗi dưới nhóm sao "Vui lòng chọn số sao" khi gửi mà chưa chọn; không gọi API | REV-REQ-20261006-103135029 | rev-review-form-rating-error |
| sao không hợp lệ từ server | Server trả 400 `invalid_rating`: lỗi dưới nhóm sao "Điểm phải từ 1 đến 5" | REV-REQ-20261006-103135029 | rev-review-form-rating-error |
| nhận xét quá dài | Bộ đếm đỏ ở 2001 trở lên và lỗi "Tối đa 2000 ký tự"; nút gửi khóa | REV-REQ-20261006-103135117 | rev-review-form-comment-error |
| nhận xét có ký tự không hợp lệ | Server trả 400 `invalid_characters`: lỗi "Nhận xét có ký tự không hợp lệ" | REV-REQ-20261006-103135117 | rev-review-form-comment-error |
| đang tải ảnh | Ô ảnh có thanh tiến độ, nút gửi khóa tới khi xong | REV-REQ-20261006-103135207 | rev-review-form-image-uploading |
| ảnh lỗi | Ô ảnh báo theo `reason`: `type` "Chỉ nhận JPEG, PNG, WebP", `size` "Ảnh vượt 5 MB", `dimensions` "Ảnh quá lớn (tối đa 25 megapixel)", `corrupt` "Không đọc được ảnh"; ảnh lỗi không được thêm vào danh sách | REV-REQ-20261006-103135207 | rev-review-form-image-error |
| đủ 5 ảnh | Nút Thêm ảnh khóa, bộ đếm "5 / 5" | REV-REQ-20261006-103135207 | rev-review-form-image-count |
| đang gửi | Nút gửi khóa kèm vòng xoay; mọi ô khóa | REV-REQ-20261006-103134939 | rev-review-form-submit |
| gửi thành công chờ duyệt | Khối "Đã gửi đánh giá. Đánh giá sẽ hiện sau khi được duyệt." kèm liên kết Đánh giá của tôi | REV-REQ-20261006-103134939 | rev-review-form-success-pending |
| gửi thành công đã đăng | Khối "Đã đăng đánh giá của bạn." kèm liên kết về trang đánh giá sản phẩm (khi tắt kiểm duyệt trước) | REV-REQ-20261006-103134939 | rev-review-form-success-published |
| form sửa đánh giá đã đăng, bật kiểm duyệt trước | Dòng cảnh báo đầu form "Sau khi lưu, đánh giá sẽ về trạng thái chờ duyệt và tạm ẩn khỏi trang sản phẩm" khi `edit_requires_review` = true | REV-REQ-20261006-103135385 | rev-review-form-edit-notice |
| lưu thành công | Thông báo "Đã lưu thay đổi", quay về Đánh giá của tôi; nếu phản hồi có `status` = `pending` thì thêm chữ "Đánh giá sẽ hiện lại sau khi được duyệt" | REV-REQ-20261006-103135385 | rev-review-form-save-success |
| đã đánh giá rồi | Lỗi đầu form (409 `already_reviewed`): "Bạn đã đánh giá sản phẩm này" kèm liên kết Đánh giá của tôi; form khóa | REV-REQ-20261006-103134939 | rev-review-form-conflict |
| chưa đủ điều kiện | Lỗi đầu form (409 `not_purchased`, `not_delivered`, `window_expired`) với cùng chữ như ở trang đánh giá sản phẩm; form khóa | REV-REQ-20261006-103135296 | rev-review-form-ineligible |
| không sửa được | Lỗi đầu form (409 `review_not_editable`): "Đánh giá này không còn sửa được" kèm liên kết về Đánh giá của tôi | REV-REQ-20261006-103135385 | rev-review-form-not-editable |
| không tìm thấy | Khối "404" khi sản phẩm không tồn tại hoặc đã ngừng bán (viết), hoặc đánh giá không tồn tại, của người khác (sửa); cùng giao diện cho mọi trường hợp | REV-REQ-20261006-103134939 | rev-review-form-notfound |
| quá nhiều lần | Lỗi (429): "Bạn thao tác quá nhanh, thử lại sau" kèm số giây từ `Retry-After` | REV-REQ-20261006-103134939 | rev-review-form-ratelimit |
| lỗi | Banner "Không gửi được, thử lại." (lỗi mạng, 5xx); hết phiên (401) về đăng nhập, giữ nội dung đã nhập trong phiên trình duyệt; không có quyền (403) báo "Không có quyền" | REV-REQ-20261006-103134939 | rev-review-form-error |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| rev-review-form-product | Tên sản phẩm đang đánh giá | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-verified | Nhãn "Đã mua hàng" của người viết | customer | - | REV-REQ-20261006-103135296 |
| rev-review-form-rating | Nhóm radio chọn 1 đến 5 sao | customer | Chọn điểm | REV-REQ-20261006-103135029 |
| rev-review-form-rating-error | Lỗi dưới nhóm sao | customer | - | REV-REQ-20261006-103135029 |
| rev-review-form-comment | Ô nhận xét (nhiều dòng) | customer | Nhập nhận xét | REV-REQ-20261006-103135117 |
| rev-review-form-comment-counter | Bộ đếm ký tự x / 2000 | customer | - | REV-REQ-20261006-103135117 |
| rev-review-form-comment-error | Lỗi dưới ô nhận xét | customer | - | REV-REQ-20261006-103135117 |
| rev-review-form-image-input | Nút Thêm ảnh (chọn tệp) | customer | Chọn tệp ảnh để tải | REV-REQ-20261006-103135207 |
| rev-review-form-image-item | Một ảnh đã tải (hình nhỏ) | customer | - | REV-REQ-20261006-103135207 |
| rev-review-form-image-remove | Nút xóa một ảnh khỏi form | customer | Bỏ ảnh khỏi danh sách | REV-REQ-20261006-103135207 |
| rev-review-form-image-uploading | Thanh tiến độ tải ảnh | customer | - | REV-REQ-20261006-103135207 |
| rev-review-form-image-error | Lỗi tải ảnh | customer | - | REV-REQ-20261006-103135207 |
| rev-review-form-image-count | Bộ đếm ảnh x / 5 | customer | - | REV-REQ-20261006-103135207 |
| rev-review-form-moderation-notice | Dòng "Đánh giá sẽ hiện sau khi được duyệt" | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-edit-notice | Cảnh báo sửa sẽ đưa đánh giá về chờ duyệt (chế độ sửa, đánh giá đã đăng, bật kiểm duyệt trước) | customer | - | REV-REQ-20261006-103135385 |
| rev-review-form-submit | Nút Gửi đánh giá (chế độ viết) | customer | Tạo đánh giá | REV-REQ-20261006-103134939 |
| rev-review-form-save | Nút Lưu thay đổi (chế độ sửa) | customer | Sửa đánh giá | REV-REQ-20261006-103135385 |
| rev-review-form-cancel | Nút Hủy | customer | Rời form, bỏ thay đổi | REV-REQ-20261006-103134939 |
| rev-review-form-success-pending | Thông báo gửi xong, chờ duyệt | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-success-published | Thông báo đã đăng | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-save-success | Thông báo đã lưu thay đổi | customer | - | REV-REQ-20261006-103135385 |
| rev-review-form-conflict | Lỗi đã đánh giá rồi (409 `already_reviewed`) | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-ineligible | Lỗi chưa đủ điều kiện (409 theo mã) | customer | - | REV-REQ-20261006-103135296 |
| rev-review-form-not-editable | Lỗi không còn sửa được | customer | - | REV-REQ-20261006-103135385 |
| rev-review-form-notfound | Khối 404 | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-ratelimit | Lỗi quá nhiều lần (429) | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-loading | Khung chờ | customer | - | REV-REQ-20261006-103134939 |
| rev-review-form-error | Banner lỗi chung | customer | - | REV-REQ-20261006-103134939 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn chỉ dành cho customer; staff, admin, guest không tới được (server trả 403 hoặc 401, giao diện chuyển sang màn đăng nhập hoặc "không có quyền" của AUTH).
- Giới hạn trên form (5 ảnh, 5 MB, 2000 ký tự) chỉ để gợi ý sớm; server kiểm lại mọi giới hạn (REV-REQ-20261006-103135207, REV-REQ-20261006-103135117).
- Ảnh tải từng tệp qua `POST /api/v1/review-images` rồi gửi các `image_id` cùng form; bỏ một ảnh khỏi form chỉ bỏ khỏi danh sách `image_ids` (ảnh mồ côi do server dọn).
- Dòng "Đánh giá sẽ hiện sau khi được duyệt" chỉ hiện khi cấu hình bật duyệt trước; giao diện biết qua `status` của phản hồi tạo, nên dòng này hiện sau khi gửi (khối thành công) chứ không đoán trước. Phần tử `rev-review-form-moderation-notice` nằm trong khối thành công chờ duyệt.
- Sửa đánh giá `published` khi bật kiểm duyệt trước đưa đánh giá về `pending` (E-22, REV-REQ-20261006-103135385 BR6): giao diện báo trước bằng `rev-review-form-edit-notice` (theo `edit_requires_review` của `GET /api/v1/me/reviews/{id}`) và nhắc lại sau khi lưu. Khi tắt kiểm duyệt trước thì không có cảnh báo.
- Mỗi lần mở form viết sinh một `Idempotency-Key` mới và giữ nguyên khi gửi lại sau lỗi mạng (ADR-017), nên bấm đúp hay thử lại không tạo hai đánh giá.
- Nhận xét là văn bản thường; không có định dạng, không xem trước HTML.
- Không viết code giao diện; dựng thật là việc của `implement`.
