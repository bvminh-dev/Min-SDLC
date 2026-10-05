# Bẫy: skill phải nêu ra, không được tự chọn

| # | Bẫy | Mâu thuẫn giữa | Đạt khi |
|---|---|---|---|
| T1 | "Nhiều mã giảm giá" | Ghi chú stakeholder vs PRM-REQ-...003 (tối đa 1 coupon, đã approved) | Ghi vào Xung đột, trích ID PRM, hỏi ai quyết định. **Không** sửa file PRM đã approved |
| T2 | "Cho guest đặt hàng" | Ghi chú stakeholder vs ma trận quyền (guest bị chặn ở Thêm vào giỏ và Đặt hàng) | Nêu xung đột, hỏi; không tự đổi ma trận. Nếu đề xuất đổi thì ghi vào mục Thay đổi chờ duyệt |
| T3 | "Giữ kho đến khi thanh toán xong" | Ghi chú vs INV-REQ-...004 (tối đa 15 phút) | Nêu xung đột; nêu hệ quả (thanh toán chậm hơn 15 phút thì sao) |
| T4 | Giá thay đổi sau khi vào giỏ | CRT chụp giá lúc thêm; Checkout có "Validate price" | Phát hiện khoảng trống (thuộc G2) và hỏi hoặc đề xuất rõ |

## Chấm
Mỗi bẫy: `phát hiện` (nêu ở Xung đột/câu hỏi) / `bỏ qua` / `chọn bừa` (viết requirement theo một bên mà không nêu). `chọn bừa` nặng hơn `bỏ qua`.

# Bẫy ẩn (brief KHÔNG nhắc; chỉ lộ ra khi đọc spec đã có)

| # | Bẫy | Nằm ở | Đạt khi |
|---|---|---|---|
| H1 | **Vòng phụ thuộc thứ tự**: roadmap ghi Reserve stock rồi mới Create order, nhưng INV-REQ-...005 bắt buộc reserve phải có `order_id` của đơn pending | INV-REQ-20261001-090000005 | Nêu rõ thứ tự phải là tạo đơn pending trước rồi reserve (hoặc đề xuất đổi INV), và ghi ảnh hưởng tới INV/ORD. Viết flow "reserve rồi tạo đơn" mà không nêu là rớt |
| H2 | **Phiên 10 phút vs thanh toán**: phiên hết hạn sau 10 phút không thao tác, nên khách đi qua cổng thanh toán ngoài >10 phút sẽ mất phiên giữa chừng | AUTH-REQ-20261001-090000006 | Có kịch bản xử lý hết phiên giữa checkout (kết quả thanh toán, giữ/hủy reservation, giữ giỏ) |
| H3 | **Staff đặt hộ**: USR-REQ-...007 cho staff thực hiện "Đặt hàng", nhưng ma trận ghi staff `-` | USR-REQ-20261001-090000007 | Nêu mâu thuẫn ma trận ↔ USR-REQ ở Xung đột; không âm thầm để staff `-` hay tự đổi thành `Y` |

## Chấm bẫy ẩn
`phát hiện` (nêu rõ, trích ID) / `bỏ qua` (không nhắc) / `chọn bừa` (viết theo một bên không nêu). Bẫy ẩn là phần phân biệt skill với prompt trần.
