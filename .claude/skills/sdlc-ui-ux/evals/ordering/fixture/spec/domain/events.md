---
status: draft
---
# Domain event

Mỗi event có đúng một bên phát (Producer). Consumers là danh sách mã epic cách nhau bởi dấu phẩy, hoặc `-`.
Phát khi: `Entity:trạng_thái` mà event được phát ra khi entity chuyển sang trạng thái đó (trạng thái phải có trong "Vòng đời chi tiết" của `entities.md`), hoặc `-` nếu không gắn với đổi trạng thái.

Các mục con của NTF như "Order created", "Payment successful", "Order shipped", "Order delivered", "Password reset" là event của epic khác; NTF chỉ nhận.

| Event | Entity | Producer | Consumers | Payload | Phát khi |
|---|---|---|---|---|---|
| UserRegistered | User | AUTH | NTF | user_id, email | User:active |
| UserLocked | User | AUTH | NTF | user_id, reason | User:locked |
| EmailVerificationRequested | EmailVerificationToken | AUTH | NTF | user_id, token_ref, expires_at | EmailVerificationToken:issued |
| EmailVerified | User | AUTH | - | user_id, verified_at | - |
| PasswordResetRequested | PasswordResetToken | AUTH | NTF | user_id, token_ref, expires_at | PasswordResetToken:issued |
| PasswordChanged | User | AUTH | NTF | user_id, changed_at | - |
| SessionRevoked | Session | AUTH | - | session_id, user_id, reason | Session:revoked |
| ProductActivated | Product | PRD | INV | product_id | Product:active |
| ProductArchived | Product | PRD | CRT, INV | product_id | Product:archived |
| StockReserved | StockReservation | INV | CHK | reservation_id, order_id, items, expires_at | StockReservation:held |
| StockCommitted | StockReservation | INV | DSH | reservation_id, order_id | StockReservation:committed |
| StockReleased | StockReservation | INV | CHK | reservation_id, order_id, reason | StockReservation:released |
| StockReservationExpired | StockReservation | INV | ORD | reservation_id, order_id | StockReservation:expired |
| LowStockDetected | StockItem | INV | NTF, DSH | product_id, on_hand, threshold | - |
| CouponExpired | Coupon | PRM | - | coupon_id | Coupon:expired |
| CouponRedeemed | CouponRedemption | PRM | DSH | coupon_id, order_id, amount | CouponRedemption:consumed |
| CheckoutCompleted | CheckoutSession | CHK | CRT | checkout_id, cart_id, order_id | CheckoutSession:completed |
| CheckoutExpired | CheckoutSession | CHK | INV, PRM | checkout_id, order_id | CheckoutSession:expired |
| OrderCreated | Order | ORD | NTF, PAY, INV, DSH | order_id, user_id, grand_total, items | Order:pending |
| OrderPaid | Order | ORD | SHP, NTF | order_id, paid_at | Order:paid |
| OrderConfirmed | Order | ORD | SHP, NTF, INV | order_id, confirmed_at | Order:confirmed |
| OrderCancelled | Order | ORD | INV, PAY, PRM, SHP, NTF | order_id, reason, was_paid | Order:cancelled |
| OrderExpired | Order | ORD | INV, PAY, PRM | order_id | Order:expired |
| OrderShipped | Order | ORD | NTF | order_id, tracking_number | Order:shipped |
| OrderDelivered | Order | ORD | NTF, REV | order_id, delivered_at | Order:delivered |
| PaymentSucceeded | Payment | PAY | ORD, INV, PRM, NTF | payment_id, order_id, amount | Payment:succeeded |
| PaymentFailed | Payment | PAY | ORD, NTF | payment_id, order_id, reason, attempt_no | Payment:failed |
| PaymentExpired | Payment | PAY | ORD | payment_id, order_id | Payment:expired |
| PaymentRefunded | Payment | PAY | ORD | payment_id, order_id | Payment:refunded |
| RefundSucceeded | Refund | PAY | NTF | refund_id, payment_id, amount | Refund:succeeded |
| RefundFailed | Refund | PAY | NTF, DSH | refund_id, payment_id, reason | Refund:failed |
| ShipmentShipped | Shipment | SHP | ORD | shipment_id, order_id, tracking_number | Shipment:shipped |
| ShipmentDelivered | Shipment | SHP | ORD | shipment_id, order_id | Shipment:delivered |
| ShipmentFailed | Shipment | SHP | ORD, NTF | shipment_id, order_id, reason | Shipment:failed |
| ShipmentReturned | Shipment | SHP | INV, ORD | shipment_id, order_id | Shipment:returned |
| ReviewPublished | Review | REV | PRD | review_id, product_id, rating | Review:published |
| ReviewHidden | Review | REV | PRD | review_id, product_id | Review:hidden |
