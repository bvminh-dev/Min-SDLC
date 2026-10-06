---
screen: address-list
epic: USR
status: draft
covers: [USR-REQ-20261006-101003767, USR-REQ-20261006-101003855, USR-REQ-20261006-101003941, USR-REQ-20261006-101004028]
roles: [customer]
---
# Sổ địa chỉ giao hàng (xem, đặt mặc định, xóa)

## Wireframe
Phương án đã chọn: **A** (danh sách thẻ một cột, mặc định ở đầu có nhãn, hành động trên từng thẻ, nút Thêm địa chỉ ở đầu). **Đây là lựa chọn mặc định** theo khuyến nghị của skill, chưa có người chọn (các cổng hỏi người dùng không dùng được khi chạy tự động).

| Phương án | Bố cục | Đánh đổi |
|---|---|---|
| **A. Danh sách thẻ một cột (khuyên dùng, đã chọn)** | Mỗi địa chỉ một thẻ: tên, điện thoại, địa chỉ, nhãn Mặc định; hành động Sửa, Đặt mặc định, Xóa | Đọc rõ cả địa chỉ dài trên 375px; tối đa 10 thẻ nên không cần phân trang |
| B. Bảng nhiều cột | Cột Người nhận, Điện thoại, Địa chỉ, Mặc định, hành động | Gọn trên màn rộng; địa chỉ dài bị cắt, hẹp phải đổi thành thẻ |
| C. Chọn một địa chỉ bằng radio rồi bấm Lưu | Một danh sách radio | Gần mô hình chọn khi thanh toán (thuộc CHK); ở sổ địa chỉ hành động Sửa và Xóa bị đẩy ra ngoài |

Lý do chọn A: ít địa chỉ (tối đa 10), nội dung dài và nhiều dòng, hành động theo từng bản ghi; thẻ đọc tốt hơn bảng và dùng được trên điện thoại.

```
Sổ địa chỉ                                         [ + Thêm địa chỉ ]
(banner: Bạn đã có 10 địa chỉ, xóa bớt để thêm mới)       <- chỉ khi đủ 10
┌───────────────────────────────────────────────────────┐
│ Nguyễn An · 0901234567                  (Mặc định)    │
│ 12 Lê Lợi, Bến Nghé, Quận 1, TP. Hồ Chí Minh          │
│                                    Sửa     Xóa        │
├───────────────────────────────────────────────────────┤
│ Trần Bình · 0987654321                                │
│ 45 Nguyễn Huệ, Bến Nghé, Quận 1, TP. Hồ Chí Minh      │
│                  Đặt làm mặc định     Sửa     Xóa     │
└───────────────────────────────────────────────────────┘
Hộp thoại Xóa (xác nhận, vì không hoàn tác):
┌ Xóa địa chỉ này? ─────────────────────────────────────┐
│ Trần Bình, 45 Nguyễn Huệ ... Các đơn đã đặt không đổi. │
│                                  [Giữ lại]  [Xóa]      │
└───────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung chờ đúng hình hai thẻ xám | USR-REQ-20261006-101003767 |
| có dữ liệu | Mặc định ở đầu có nhãn "Mặc định", các thẻ còn lại mới tạo nhất trước; tổng không quá 10 | USR-REQ-20261006-101003767 |
| rỗng | "Bạn chưa có địa chỉ nào." kèm nút "Thêm địa chỉ đầu tiên" | USR-REQ-20261006-101003767 |
| đủ 10 địa chỉ | Nút Thêm địa chỉ khóa kèm banner "Bạn đã có 10 địa chỉ, xóa bớt để thêm mới" | USR-REQ-20261006-101003855 |
| lỗi | Banner "Không tải được sổ địa chỉ" kèm nút Thử lại | USR-REQ-20261006-101003767 |
| hết phiên | 401: chuyển về đăng nhập (màn của AUTH) | USR-REQ-20261006-101003767 |
| không có quyền | Staff hay admin vào màn này (403): chuyển tới màn `access-denied` (AUTH), không dựng sổ địa chỉ | USR-REQ-20261006-101003767 |
| đang đặt mặc định | Nút "Đặt làm mặc định" của thẻ đó khóa, "Đang lưu..." | USR-REQ-20261006-101003941 |
| đặt mặc định xong | Nhãn "Mặc định" chuyển sang thẻ vừa chọn, thẻ đó lên đầu, toast "Đã đặt làm mặc định" | USR-REQ-20261006-101003941 |
| địa chỉ không còn | Toast lỗi "Địa chỉ này không còn tồn tại" (404) và làm mới danh sách | USR-REQ-20261006-101003941 |
| đang xóa | Hộp thoại khóa nút Xóa, "Đang xóa..." | USR-REQ-20261006-101004028 |
| xóa xong | Đóng hộp thoại, thẻ biến mất, toast "Đã xóa địa chỉ"; nếu thẻ bị xóa là mặc định thì thẻ mới tạo nhất còn lại hiện nhãn "Mặc định" | USR-REQ-20261006-101004028 |
| xóa bị từ chối | Toast lỗi "Địa chỉ này không còn tồn tại" (404 chung) và làm mới danh sách; lỗi 5xx: lỗi trong hộp thoại, thẻ giữ nguyên | USR-REQ-20261006-101004028 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| usr-address-list-loading | Khung chờ khi tải danh sách | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-row | Thẻ địa chỉ (có `data-id`) | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-receiver | Tên người nhận và điện thoại | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-text | Dòng địa chỉ đầy đủ | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-default-badge | Nhãn Mặc định | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-empty | Trạng thái rỗng | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-error | Banner lỗi tải | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-retry | Nút Thử lại | customer | Tải lại | USR-REQ-20261006-101003767 |
| usr-address-list-session-expired | Điểm đánh dấu chuyển về đăng nhập khi 401 | customer | - | USR-REQ-20261006-101003767 |
| usr-address-list-add | Nút Thêm địa chỉ | customer | Sang màn thêm | USR-REQ-20261006-101003855 |
| usr-address-list-limit-notice | Banner đã đủ 10 địa chỉ | customer | - | USR-REQ-20261006-101003855 |
| usr-address-list-edit | Nút Sửa của thẻ | customer | Sang màn sửa | USR-REQ-20261006-101003941 |
| usr-address-list-set-default | Nút Đặt làm mặc định (chỉ thẻ không mặc định) | customer | Đặt mặc định | USR-REQ-20261006-101003941 |
| usr-address-list-not-found | Toast Địa chỉ không còn tồn tại | customer | - | USR-REQ-20261006-101003941 |
| usr-address-list-default-toast | Toast Đã đặt làm mặc định | customer | - | USR-REQ-20261006-101003941 |
| usr-address-list-delete | Nút Xóa của thẻ | customer | Mở hộp thoại xóa | USR-REQ-20261006-101004028 |
| usr-address-list-delete-confirm | Nút Xóa trong hộp thoại | customer | Xác nhận xóa | USR-REQ-20261006-101004028 |
| usr-address-list-delete-cancel | Nút Giữ lại trong hộp thoại | customer | Đóng hộp thoại | USR-REQ-20261006-101004028 |
| usr-address-list-delete-error | Lỗi trong hộp thoại xóa | customer | - | USR-REQ-20261006-101004028 |
| usr-address-list-deleted-toast | Toast Đã xóa địa chỉ | customer | - | USR-REQ-20261006-101004028 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** phía người mua của cửa hàng online chưa được dạy; làm theo mẫu danh sách thẻ (`components/list-row.md`, `components/empty-state.md`).
- **Audit (câu 2 của evon):** chưa có codebase; Tailwind, flat, tiếng Việt theo mặc định.
- Hộp thoại xóa không có ô nhập nên đóng được khi bấm ra ngoài hoặc Esc (khác hộp thoại có ô nhập); nhãn "Mặc định" đọc rõ bằng chữ, không chỉ bằng màu. Xóa cần xác nhận vì không hoàn tác; hành động đặt mặc định không cần xác nhận vì đổi lại được.
- Điện thoại hiển thị đúng dạng chuẩn hóa từ server; người dùng không phải nhập lại. Chưa có nhập hàng loạt hay kéo thả sắp xếp.
- Màn chọn địa chỉ lúc đặt hàng thuộc CHK (CHK-REQ-20261006-105051095) dùng lại danh sách này; địa chỉ không có quận, huyện (`district` rỗng, E-06) thì dòng địa chỉ bỏ phần đó, không để dấu phẩy thừa.
- Khi ghi sổ địa chỉ bị giới hạn tần suất (429, mặc định 30 lần mỗi phút), giao diện dùng lại banner lỗi chung `usr-address-list-error` hoặc toast lỗi của thao tác, kèm thời gian chờ từ `Retry-After`.
- Không viết code giao diện; dựng thật là việc của `implement`.
