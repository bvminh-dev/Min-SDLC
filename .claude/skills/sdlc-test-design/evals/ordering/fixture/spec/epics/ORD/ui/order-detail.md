---
screen: order-detail
epic: ORD
status: draft
covers: [ORD-REQ-20261006-100000001, ORD-REQ-20261006-100000003]
roles: [customer]
---
# Chi tiết đơn của tôi

Brief (mặc định đã ok, chưa có người xác nhận): customer mở một đơn để xem trạng thái, từng dòng hàng, tổng tiền, trạng thái thanh toán, và hủy đơn khi còn được phép. So sánh bằng: trạng thái đơn và trạng thái thanh toán (đứng đầu), rồi dòng hàng và tổng tiền. Hành động cuối: hủy đơn (chỉ khi đơn pending, confirmed hoặc paid). Admin hủy đơn ở màn `order-manage`, không ở màn này.

## Wireframe
Phương án đã chọn: A (một cột: đầu trang có mã đơn và hai badge, bảng dòng hàng, khối tổng tiền, nút Hủy đơn ở cuối). Đây là phương án khuyến nghị được chọn mặc định vì không thể hỏi người dùng ở cổng chọn wireframe; chưa có người chọn.

Ba phương án đã cân: A một cột (chọn: nội dung ngắn, đọc từ trên xuống, hành động hủy nằm cuối là hành động hiếm và có hậu quả); B hai cột, tóm tắt bên phải (loại: ít thông tin để tóm tắt, thừa cột); C nút Hủy đơn dính đầu trang (loại: dễ bấm nhầm hành động không đảo ngược). Đánh đổi của A: nút Hủy đơn nằm xa tầm mắt trên đơn dài.

```
+--------------------------------------------------------------+
| < Đơn của tôi                                                |
| Đơn #ORD-1043   [Đã thanh toán]  [Thanh toán: thành công]    |
+--------------------------------------------------------------+
| Áo thun basic (M)        x2        300.000 đ                  |
| Giày chạy bộ (42)        x1        950.000 đ                  |
+--------------------------------------------------------------+
| Tổng tiền                                      1.250.000 đ   |
+--------------------------------------------------------------+
| [Hủy đơn]   (chỉ khi pending, confirmed, paid)               |
+--------------------------------------------------------------+
Hộp xác nhận hủy: "Hủy đơn này?" [Không] [Hủy đơn]
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện, lấy từ Given/When/Then của requirement. Bắt buộc có `lỗi`.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Mã đơn, badge trạng thái đơn, badge trạng thái thanh toán, dòng hàng, tổng tiền (BR2) | ORD-REQ-20261006-100000001 |
| không tìm thấy | Trang "Không tìm thấy đơn" kèm liên kết về Đơn của tôi; dùng chung cho đơn không tồn tại và đơn của người khác, không có chữ nào gợi ý đơn đó có thật (Luồng lỗi, 404) | ORD-REQ-20261006-100000001 |
| đang tải | Khung xám đúng hình khối chi tiết (chuẩn giao diện chung, không có trong Given/When/Then, xem báo cáo) | ORD-REQ-20261006-100000001 |
| lỗi | Banner "Không tải được đơn" kèm nút Thử lại (khác 404: lỗi mạng hoặc máy chủ) | ORD-REQ-20261006-100000001 |
| có thể hủy | Hiện nút Hủy đơn khi đơn pending, confirmed hoặc paid (BR1) | ORD-REQ-20261006-100000003 |
| không thể hủy | Đơn shipped hoặc sau đó: không hiện nút Hủy đơn, có dòng "Đơn đã giao cho vận chuyển, không thể hủy" | ORD-REQ-20261006-100000003 |
| hủy bị từ chối | Trong hộp xác nhận hiện banner lỗi nêu lý do do máy chủ trả về (ví dụ đơn vừa chuyển sang shipped), hộp vẫn mở (Luồng lỗi) | ORD-REQ-20261006-100000003 |
| đã hủy | Badge đổi thành Đã hủy; đơn đã thanh toán thì có dòng "Yêu cầu hoàn tiền đã được tạo" (Ca biên; việc hoàn tiền xử lý ở epic PAY, chưa có spec) | ORD-REQ-20261006-100000003 |

## Phần tử
testid dạng `<epic>-<màn>-<phần-tử>` (chữ thường, nối bằng `-`), duy nhất trong cả `spec/`.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-detail-back | Liên kết quay lại Đơn của tôi | customer | Bấm để về danh sách | ORD-REQ-20261006-100000001 |
| ord-order-detail-code | Mã đơn | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-status | Badge trạng thái đơn | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-payment-status | Badge trạng thái thanh toán | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-items | Vùng danh sách dòng hàng | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-item-row | Một dòng hàng (tên, số lượng, thành tiền) | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-total | Tổng tiền | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-loading | Vùng khung chờ khi đang tải | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-not-found | Vùng "Không tìm thấy đơn" | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-not-found-back | Liên kết về Đơn của tôi trong vùng không tìm thấy | customer | Bấm để về danh sách | ORD-REQ-20261006-100000001 |
| ord-order-detail-error | Banner lỗi tải | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-detail-retry | Nút Thử lại trong banner lỗi | customer | Bấm để tải lại | ORD-REQ-20261006-100000001 |
| ord-order-detail-cancel | Nút Hủy đơn (chỉ khi pending, confirmed, paid) | customer | Bấm để mở hộp xác nhận hủy | ORD-REQ-20261006-100000003 |
| ord-order-detail-cancel-blocked | Dòng giải thích không thể hủy | customer | - | ORD-REQ-20261006-100000003 |
| ord-order-detail-cancel-dialog | Hộp xác nhận hủy | customer | - | ORD-REQ-20261006-100000003 |
| ord-order-detail-cancel-confirm | Nút Hủy đơn trong hộp | customer | Bấm để gửi yêu cầu hủy | ORD-REQ-20261006-100000003 |
| ord-order-detail-cancel-dismiss | Nút Không trong hộp | customer | Bấm để đóng hộp | ORD-REQ-20261006-100000003 |
| ord-order-detail-cancel-error | Banner lý do hủy bị từ chối | customer | - | ORD-REQ-20261006-100000003 |
| ord-order-detail-refund-note | Dòng "Yêu cầu hoàn tiền đã được tạo" | customer | - | ORD-REQ-20261006-100000003 |
