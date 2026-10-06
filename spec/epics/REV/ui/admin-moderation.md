---
screen: admin-moderation
epic: REV
status: draft
covers: [REV-REQ-20261006-103135744, REV-REQ-20261006-103135835, REV-REQ-20261006-103135477]
roles: [admin]
---
# Kiểm duyệt đánh giá (quản trị)

Trang `/admin/reviews`: hàng đợi chờ duyệt và danh sách đánh giá theo trạng thái. Phía quản trị là màn trong app nên theo mẫu danh sách có bộ lọc của skill (không thuộc nhóm "chưa được dạy"). Chạy tự động nên các cổng hỏi của `U1` đến `U3` được trả lời bằng phương án khuyến nghị (mặc định). Chỉ wireframe ASCII.

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu có tab trạng thái, nút thao tác ở cuối dòng). **Đây là lựa chọn mặc định**, chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng với tab trạng thái (khuyên dùng, đã chọn)** | Tab Chờ duyệt mở sẵn kèm số đếm; mỗi dòng có nút thao tác phù hợp trạng thái | Xử lý nhanh nhiều dòng liên tiếp | Nội dung dài bị cắt trong ô (xem đầy đủ ở dòng mở rộng) |
| B. Hai khung: danh sách bên trái, chi tiết bên phải | Đọc đầy đủ nội dung và ảnh rồi mới quyết | Đọc kỹ | Mỗi đánh giá hai lần bấm; chậm hơn khi hàng đợi dài |
| C. Thẻ như trang công khai | Thấy y như người đọc sẽ thấy | Sát thực tế | Không so được nhiều dòng, thao tác lẫn trong thẻ |

Lý do chọn A: kiểm duyệt là việc lặp lại nhiều lần; bảng cho phép quét nhanh và thao tác cuối dòng, dòng mở rộng cho phép đọc đầy đủ khi cần.

```
Thanh header:  ☰  Quản trị › Đánh giá                                                (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Chờ duyệt (3)] [Đã đăng] [Bị từ chối] [Bị ẩn]     Sản phẩm [mã ____]  Sao [Tất cả ▾]│
│ ┌───────────────┬─────────────┬────────┬──────────────────────┬────────┬─────────┐ │
│ │ Sản phẩm      │ Người viết  │ Sao    │ Nội dung             │ Ngày   │ Thao tác│ │
│ ├───────────────┼─────────────┼────────┼──────────────────────┼────────┼─────────┤ │
│ │ Áo thun       │ An N.       │ ★★★★☆  │ Vải mát, đúng size…  │ 09:00  │[Duyệt]  │ │ <- chờ duyệt: Duyệt, Từ chối, Xóa
│ │               │             │        │ [ảnh][ảnh]           │        │[Từ chối]│ │
│ │               │             │        │                      │        │[Xóa]    │ │
│ │ Tất cổ cao    │ Bình L.     │ ★★★★★  │ Rất êm.              │ 05/10  │[Ẩn]     │ │ <- đã đăng: Ẩn, Xóa
│ │               │             │        │                      │        │[Xóa]    │ │
│ │ Mũ lưỡi trai  │ Chi P.      │ ★☆☆☆☆  │ Lý do: lời lẽ xúc phạm│ 04/10  │[Bỏ ẩn]  │ │ <- bị ẩn: Bỏ ẩn, Xóa; bị từ chối: chỉ Xóa
│ │               │             │        │                      │        │[Xóa]    │ │
│ └───────────────┴─────────────┴────────┴──────────────────────┴────────┴─────────┘ │
│                                         [‹ Trước]  Trang 1 / 1  [Sau ›]              │
└──────────────────────────────────────────────────────────────────────────────────┘

Hộp thoại Từ chối (tương tự hộp thoại Ẩn; có ô nhập nên không đóng khi bấm ra ngoài):
┌ Từ chối đánh giá của An N.? ─────────────────────────────────┐
│ Lý do (bắt buộc, 1 đến 500 ký tự), khách sẽ thấy lý do này    │
│ [                                                           ] │
│   <lỗi: "Vui lòng nhập lý do">                       0 / 500  │
│                                 [Giữ nguyên]  [Từ chối]       │
└───────────────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Bảng các đánh giá của tab đang chọn; tab Chờ duyệt cũ nhất trước, các tab khác mới nhất trước; tab Chờ duyệt có số đếm | REV-REQ-20261006-103135744 | rev-admin-moderation-list |
| đang tải | Khung chờ năm dòng | REV-REQ-20261006-103135744 | rev-admin-moderation-loading |
| hàng đợi trống | "Không có đánh giá nào chờ duyệt", số đếm 0 | REV-REQ-20261006-103135744 | rev-admin-moderation-empty |
| rỗng sau lọc | "Không có đánh giá nào khớp bộ lọc" kèm nút Xóa bộ lọc | REV-REQ-20261006-103135744 | rev-admin-moderation-empty-filter |
| lỗi | Banner "Không tải được danh sách." kèm Thử lại; hết phiên (401) về đăng nhập; không có quyền (403) báo "Không có quyền" (staff hay customer không vào được trang) | REV-REQ-20261006-103135744 | rev-admin-moderation-error |
| duyệt thành công | Dòng biến khỏi hàng đợi, số đếm giảm 1, thông báo "Đã duyệt đánh giá" | REV-REQ-20261006-103135835 | rev-admin-moderation-action-success |
| hộp thoại từ chối | Hộp thoại có ô lý do (bắt buộc), nút Giữ nguyên và Từ chối | REV-REQ-20261006-103135835 | rev-admin-moderation-reject-dialog |
| hộp thoại ẩn | Hộp thoại có ô lý do (bắt buộc), nút Giữ nguyên và Ẩn | REV-REQ-20261006-103135835 | rev-admin-moderation-hide-dialog |
| thiếu lý do | Lỗi dưới ô lý do "Vui lòng nhập lý do" (rỗng hoặc toàn khoảng trắng) hoặc "Tối đa 500 ký tự"; không gọi API khi rỗng | REV-REQ-20261006-103135835 | rev-admin-moderation-reason-error |
| thao tác không được | Báo lỗi trong hộp thoại hoặc thanh trên bảng: 409 "Đánh giá đã được xử lý hoặc không còn ở trạng thái này" kèm Tải lại danh sách (hai admin thao tác cùng lúc); 404 "Đánh giá không còn tồn tại"; 5xx "Không thực hiện được, thử lại" | REV-REQ-20261006-103135835 | rev-admin-moderation-action-error |
| đang xử lý | Nút của thao tác khóa kèm vòng xoay | REV-REQ-20261006-103135835 | rev-admin-moderation-reject-confirm |
| hộp thoại xóa | Hộp thoại xác nhận xóa đánh giá (mọi trạng thái trừ đã xóa), nút Giữ nguyên và Xóa đánh giá; không có ô nhập | REV-REQ-20261006-103135477 | rev-admin-moderation-delete-dialog |
| bỏ ẩn thành công | Bấm Bỏ ẩn ở dòng bị ẩn (không hộp thoại, không cần lý do): dòng biến khỏi tab Bị ẩn, thông báo "Đã bỏ ẩn đánh giá" | REV-REQ-20261006-103135835 | rev-admin-moderation-row-unhide |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| rev-admin-moderation-tabs | Nhóm tab trạng thái (Chờ duyệt, Đã đăng, Bị từ chối, Bị ẩn) | admin | Đổi `status`, về trang 1 | REV-REQ-20261006-103135744 |
| rev-admin-moderation-pending-count | Số đánh giá chờ duyệt trên tab | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-filter-product | Ô lọc theo mã sản phẩm | admin | Nhập mã sản phẩm để lọc | REV-REQ-20261006-103135744 |
| rev-admin-moderation-filter-rating | Ô chọn lọc theo sao | admin | Đổi `rating` | REV-REQ-20261006-103135744 |
| rev-admin-moderation-filter-clear | Nút Xóa bộ lọc | admin | Bỏ lọc sản phẩm và sao | REV-REQ-20261006-103135744 |
| rev-admin-moderation-list | Bảng đánh giá | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row | Một dòng đánh giá | admin | Bấm để mở rộng nội dung đầy đủ | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-product | Tên sản phẩm của dòng | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-reviewer | Tên người viết đã che | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-rating | Số sao của dòng | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-comment | Nội dung bình luận (cắt, mở rộng đủ) | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-images | Dải ảnh đính kèm | admin | Bấm ảnh để xem lớn | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-reason | Lý do kiểm duyệt đã ghi (tab bị từ chối, bị ẩn) | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-row-approve | Nút Duyệt (chỉ dòng chờ duyệt) | admin | Duyệt đánh giá | REV-REQ-20261006-103135835 |
| rev-admin-moderation-row-reject | Nút Từ chối (chỉ dòng chờ duyệt) | admin | Mở hộp thoại từ chối | REV-REQ-20261006-103135835 |
| rev-admin-moderation-row-hide | Nút Ẩn (chỉ dòng đã đăng) | admin | Mở hộp thoại ẩn | REV-REQ-20261006-103135835 |
| rev-admin-moderation-row-unhide | Nút Bỏ ẩn (chỉ dòng bị ẩn) | admin | Bỏ ẩn đánh giá | REV-REQ-20261006-103135835 |
| rev-admin-moderation-row-delete | Nút Xóa (mọi dòng: chờ duyệt, đã đăng, bị từ chối, bị ẩn) | admin | Mở hộp thoại xóa | REV-REQ-20261006-103135477 |
| rev-admin-moderation-reject-dialog | Hộp thoại từ chối | admin | - | REV-REQ-20261006-103135835 |
| rev-admin-moderation-reject-reason | Ô lý do từ chối (1 đến 500 ký tự) | admin | Nhập lý do | REV-REQ-20261006-103135835 |
| rev-admin-moderation-reject-confirm | Nút Từ chối trong hộp thoại | admin | Gửi từ chối | REV-REQ-20261006-103135835 |
| rev-admin-moderation-reject-dismiss | Nút Giữ nguyên trong hộp thoại từ chối | admin | Đóng, không từ chối | REV-REQ-20261006-103135835 |
| rev-admin-moderation-hide-dialog | Hộp thoại ẩn | admin | - | REV-REQ-20261006-103135835 |
| rev-admin-moderation-hide-reason | Ô lý do ẩn (1 đến 500 ký tự) | admin | Nhập lý do | REV-REQ-20261006-103135835 |
| rev-admin-moderation-hide-confirm | Nút Ẩn trong hộp thoại | admin | Gửi ẩn | REV-REQ-20261006-103135835 |
| rev-admin-moderation-hide-dismiss | Nút Giữ nguyên trong hộp thoại ẩn | admin | Đóng, không ẩn | REV-REQ-20261006-103135835 |
| rev-admin-moderation-reason-error | Lỗi dưới ô lý do (thiếu, quá dài) | admin | - | REV-REQ-20261006-103135835 |
| rev-admin-moderation-delete-dialog | Hộp thoại xóa | admin | - | REV-REQ-20261006-103135477 |
| rev-admin-moderation-delete-confirm | Nút Xóa đánh giá | admin | Gửi xóa | REV-REQ-20261006-103135477 |
| rev-admin-moderation-delete-dismiss | Nút Giữ nguyên trong hộp thoại xóa | admin | Đóng, không xóa | REV-REQ-20261006-103135477 |
| rev-admin-moderation-action-error | Vùng lỗi thao tác (409, 404, 5xx) | admin | - | REV-REQ-20261006-103135835 |
| rev-admin-moderation-action-reload | Nút Tải lại danh sách trong lỗi 409 hoặc 404 | admin | Tải lại danh sách | REV-REQ-20261006-103135835 |
| rev-admin-moderation-action-success | Thông báo thao tác thành công | admin | - | REV-REQ-20261006-103135835 |
| rev-admin-moderation-page-prev | Nút Trước | admin | Về trang trước | REV-REQ-20261006-103135744 |
| rev-admin-moderation-page-next | Nút Sau | admin | Sang trang sau | REV-REQ-20261006-103135744 |
| rev-admin-moderation-loading | Khung chờ | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-empty | Khối hàng đợi trống | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-empty-filter | Khối rỗng sau lọc | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-error | Banner lỗi | admin | - | REV-REQ-20261006-103135744 |
| rev-admin-moderation-retry | Nút Thử lại | admin | Tải lại | REV-REQ-20261006-103135744 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn chỉ dành cho admin: staff không có quyền kiểm duyệt (`roles.md`), nên menu không hiện mục này cho staff và vào thẳng bằng địa chỉ thì nhận "Không có quyền".
- Ô lọc theo sản phẩm nhận mã (uuid); chưa có ô tìm theo tên vì requirement chỉ có `product_id` ([OPEN] cải thiện sau).
- Nút theo trạng thái (E-22): Duyệt và Từ chối ở dòng chờ duyệt; Ẩn ở dòng đã đăng; Bỏ ẩn ở dòng bị ẩn; Xóa ở mọi dòng; dòng bị từ chối (trạng thái cuối) chỉ có Xóa.
- Hộp thoại Từ chối và Ẩn có ô nhập nên bấm ra ngoài không đóng (luật `I20` của evon). Hộp thoại Xóa không có ô nhập nhưng không hoàn tác nên vẫn có bước xác nhận.
- Lý do từ chối, ẩn hiển thị cho khách chủ đánh giá; ô lý do nhắc điều đó để admin viết cho người đọc.
- Tên người viết đã che theo cùng quy tắc công khai; không hiển thị email hay điện thoại (REV-REQ-20261006-103135744 BR5).
- Không viết code giao diện; dựng thật là việc của `implement`.
