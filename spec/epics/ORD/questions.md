# Câu hỏi còn mở của epic ORD (sdlc-research)

Chạy tự động nên không hỏi trực tiếp. Quyết định nghiệp vụ người dùng đã trả lời (hủy đơn, staff chỉ xem, lịch sử, phân trang, 404) đã áp vào requirement. Dưới đây là phần chưa có câu trả lời. Mọi file spec vẫn `draft`.

## A. Cần người quyết ở phạm vi ORD
1. Staff/admin sắp xếp danh sách thế nào? Mặc định đã dùng: mới nhất trước (ORD-REQ-20261006-092320743 BR6).
2. Ô tìm mã đơn khớp chính xác hay một phần? Mặc định: chính xác, không phân biệt hoa thường (BR7).
3. Lịch sử trạng thái hiển thị cũ nhất trước hay mới nhất trước? Mặc định: cũ nhất trước (ORD-REQ-20261006-092320812 BR7).
4. Staff/admin xem đơn của người khác có cần ghi audit không? Mặc định: không (ORD-REQ-20261006-092320743 BR8).

## B. Cần sửa nền (qua sdlc-foundation hoặc sdlc-impact, không sửa trong epic này)
5. SB-08 chỉ cho chủ đơn và admin xem địa chỉ/điện thoại, nhưng staff (kho/CSKH) có thể cần địa chỉ giao. Mặc định: staff không thấy (ORD-REQ-20261006-092320768).
6. `entities.md`: thêm entity lưu lịch sử chuyển trạng thái đơn (đề xuất `OrderStatusHistory`).
7. `entities.md`: Order thiếu thuộc tính cho mã vận đơn (OrderShipped mang `tracking_number`) và thiếu trường lý do hủy.
8. Vòng đời Order thiếu chuyển cho ShipmentFailed và ShipmentReturned dù ORD là consumer trong `events.md`.
9. Không có event/cơ chế đưa đơn COD `pending -> confirmed` ở ORD (StockReserved chỉ có consumer CHK).
10. SB-24 chỉ nói hoàn tiền tự động khi khách hủy đơn paid; admin hủy đơn paid chưa được nêu.
11. `roles.md` ghi staff "xem và cập nhật đơn"; ở ORD staff chỉ xem, thao tác cập nhật thuộc SHP.

## C. Phụ thuộc epic chưa có spec (PAY, SHP, CHK)
12. PAY: quy tắc hoàn tiền đơn paid bị hủy, hoàn tiền thất bại, tiền thu trễ sau khi đơn bị hủy/hết hạn, số lượt thử tối đa và cách báo lượt cuối của PaymentFailed.
13. CHK: cách ORD nhận lệnh tạo đơn (CHK phụ thuộc ORD trực tiếp theo `architecture.md`) và cách đơn COD vào `confirmed`.
14. SHP: nội dung ShipmentFailed/ShipmentReturned đối với trạng thái đơn.
