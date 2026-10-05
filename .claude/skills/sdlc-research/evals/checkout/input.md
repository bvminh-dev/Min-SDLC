# Ca: epic 08 Checkout

## Epic từ roadmap
Select shipping address · Select shipping method · Select payment method · Apply coupon · Review order · Validate price · Validate stock · Reserve stock · Create order

## Ghi chú nghiệp vụ từ stakeholder
- Khách có thể nhập **nhiều mã giảm giá** trong cùng một đơn.
- Cho phép **khách vãng lai (guest)** đặt hàng không cần đăng nhập.
- Kho được giữ cho đơn **đến khi thanh toán thành công**.

## Fixture: spec đã có (chép vào `spec/` trước khi chạy)

### spec/permissions-matrix.md
```
| Hành động | Requirement | guest | customer | staff | admin |
|---|---|---|---|---|---|
| Xem sản phẩm | PRD-REQ-20261001-090000001 | Y | Y | Y | Y |
| Thêm vào giỏ | CRT-REQ-20261001-090000002 | - | Y | - | - |
| Đặt hàng | (chưa có) | - | Y | - | - |
```

### PRM-REQ-20261001-090000003 (approved)
Một đơn hàng áp dụng **tối đa 1 coupon**. Coupon có `minimum order value` và `usage limit`.

### INV-REQ-20261001-090000004 (approved)
Reserve stock giữ hàng **tối đa 15 phút**. Quá hạn thì tự release và phát event `StockReleased`.

### CRT-REQ-20261001-090000002 (approved)
Giá của sản phẩm trong giỏ được **chụp lại lúc thêm vào giỏ**. Subtotal tính từ giá đã chụp.

### Danh sách epic đã có spec (xem thêm fixture/spec/ — còn có spec AUTH, USR không liệt kê ở đây)
AUTH, USR, PRD, INV, CRT, PRM (chưa có: PAY, SHP, ORD, NTF)
