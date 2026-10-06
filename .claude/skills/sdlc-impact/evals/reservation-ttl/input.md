# Ca: đổi thời hạn giữ hàng 15 → 30 phút

## Thay đổi
- ID: `INV-REQ-20261001-090000004` (Giữ hàng tạm).
- Đổi gì: BR1 từ "tối đa 15 phút" thành "tối đa 30 phút".
- Vì sao: khách thanh toán qua cổng ngoài (chuyển khoản, 3DS) thường quá 15 phút nên đơn bị hủy oan.

## Fixture
`fixture/spec/` (13 tài liệu, đều `approved`). Epic chưa có spec: PAY, SHP, ORD, NTF.
