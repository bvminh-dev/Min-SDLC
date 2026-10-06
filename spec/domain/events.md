---
status: approved
---

# Domain event

Mỗi event có đúng một bên phát (Producer). Consumers là danh sách mã epic cách nhau bởi dấu phẩy, hoặc `-`.
Phát khi: `Entity:trạng_thái` mà event được phát ra khi entity chuyển sang trạng thái đó (trạng thái phải có trong "Vòng đời chi tiết" của `entities.md`), hoặc `-` nếu không gắn với đổi trạng thái.

**Phong bì chung**: mọi event có `event_id` (uuid), `occurred_at`, `correlation_id` ngoài các trường ở cột Payload. Event đi qua outbox (ADR-011, OutboxEvent): ghi cùng giao dịch với thay đổi trạng thái, giao ít nhất một lần; consumer chống trùng theo `event_id` (ProcessedEvent). Ngoại lệ: EmailVerificationRequested, PasswordResetRequested phát in-process sau commit, best-effort.
**Quy tắc định danh**: event liên quan đơn luôn có `order_id`. Các event mà NTF nhận mang thêm `order_code`, `user_id` (ghi ở cột Payload); thông tin còn lại consumer **gọi giao diện đọc** của module chủ, không nhồi vào payload.
**Quy tắc consumer**: consumer chỉ khai khi có handler; event không ai nhận ghi `-`. Handler nào cũng idempotent (nhận lại event đã xử lý thì không làm gì).
`reason` là mã cố định, liệt kê ở cột Payload.

Các mục con của NTF như "Order created", "Payment successful", "Order shipped", "Order delivered", "Password reset" là event của epic khác; NTF chỉ nhận.

| Event | Entity | Producer | Consumers | Payload | Phát khi |
| --- | --- | --- | --- | --- | --- |
| UserRegistered | User | AUTH | NTF | user_id, email | User:active |
| UserLocked | User | AUTH | NTF | user_id, reason (too_many_attempts, admin) | User:locked |
| EmailVerificationRequested | EmailVerificationToken | AUTH | NTF | user_id, token_ref (token thô, chỉ trong bộ nhớ, không qua outbox, không log), expires_at | EmailVerificationToken:issued |
| EmailVerified | User | AUTH | - | user_id, verified_at | - |
| PasswordResetRequested | PasswordResetToken | AUTH | NTF | user_id, token_ref (token thô, chỉ trong bộ nhớ, không qua outbox, không log), expires_at | PasswordResetToken:issued |
| PasswordChanged | User | AUTH | NTF | user_id, changed_at | - |
| SessionRevoked | Session | AUTH | - | session_id, user_id, reason | Session:revoked |
| ProductActivated | Product | PRD | INV | product_id | Product:active |
| ProductArchived | Product | PRD | CRT, INV | product_id | Product:archived |
| StockReserved | StockReservation | INV | - | order_id, items, expires_at | StockReservation:held |
| StockCommitted | StockReservation | INV | - | order_id | StockReservation:committed |
| StockCommitFailed | StockReservation | INV | PAY, ORD | order_id, reason (reservation_expired, reservation_released) | - |
| StockReleased | StockReservation | INV | - | order_id, reason (order_cancelled) | StockReservation:released |
| StockReservationExpired | StockReservation | INV | ORD | order_id | StockReservation:expired |
| LowStockDetected | StockItem | INV | NTF | product_id, product_name, on_hand, available, threshold | - |
| CouponExpired | Coupon | PRM | - | coupon_id | Coupon:expired |
| CouponRedeemed | CouponRedemption | PRM | - | coupon_id, order_id, amount | CouponRedemption:consumed |
| CheckoutCompleted | CheckoutSession | CHK | CRT | checkout_id, cart_id, order_id | CheckoutSession:completed |
| CheckoutExpired | CheckoutSession | CHK | - | checkout_id, user_id, cart_id | CheckoutSession:expired |
| OrderCreated | Order | ORD | NTF, PAY | order_id, order_code, user_id, grand_total, payment_method, payment_expires_at (rỗng nếu COD), items | Order:pending |
| OrderPaid | Order | ORD | SHP | order_id, paid_at | Order:paid |
| OrderConfirmed | Order | ORD | SHP, NTF, INV, PRM | order_id, order_code, user_id, confirmed_at | Order:confirmed |
| OrderCancelled | Order | ORD | INV, PAY, PRM, SHP, NTF | order_id, order_code, user_id, reason (customer_request, admin, payment_failed, stock_commit_failed), was_paid | Order:cancelled |
| OrderExpired | Order | ORD | PAY, PRM | order_id | Order:expired |
| OrderShipped | Order | ORD | NTF | order_id, order_code, user_id, tracking_number | Order:shipped |
| OrderDelivered | Order | ORD | NTF, PAY | order_id, order_code, user_id, delivered_at | Order:delivered |
| OrderReturned | Order | ORD | PAY, NTF | order_id, order_code, user_id | Order:returned |
| PaymentSucceeded | Payment | PAY | ORD, INV, PRM, NTF | payment_id, order_id, order_code, user_id, amount, method, paid_at | Payment:succeeded |
| PaymentFailed | Payment | PAY | ORD, NTF | payment_id, order_id, order_code, user_id, reason (declined, timeout, cancelled_by_user, other), attempt_no, is_final | Payment:failed |
| PaymentExpired | Payment | PAY | ORD | payment_id, order_id | Payment:expired |
| PaymentRefunded | Payment | PAY | ORD | payment_id, order_id | Payment:refunded |
| RefundSucceeded | Refund | PAY | NTF | refund_id, payment_id, order_id, order_code, user_id, amount, reason (order_cancelled, order_expired, late_payment, duplicate_payment, admin_manual) | Refund:succeeded |
| RefundFailed | Refund | PAY | NTF | refund_id, payment_id, order_id, order_code, user_id, amount, reason (mã như RefundSucceeded), failure_reason | Refund:failed |
| ShipmentShipped | Shipment | SHP | ORD | shipment_id, order_id, tracking_number | Shipment:shipped |
| ShipmentTrackingChanged | Shipment | SHP | ORD | shipment_id, order_id, tracking_number | - |
| ShipmentDelivered | Shipment | SHP | ORD | shipment_id, order_id | Shipment:delivered |
| ShipmentFailed | Shipment | SHP | ORD, NTF | shipment_id, order_id, order_code, user_id, reason (customer_unreachable, refused, wrong_address, damaged, other) | Shipment:failed |
| ShipmentReturned | Shipment | SHP | INV, ORD | shipment_id, order_id, restockable | Shipment:returned |
| ReviewPublished | Review | REV | PRD | review_id, product_id, rating | Review:published |
| ReviewHidden | Review | REV | PRD | review_id, product_id, rating | Review:hidden |
| ReviewDeleted | Review | REV | PRD | review_id, product_id, rating | Review:deleted |
| ReviewRatingChanged | Review | REV | PRD | review_id, product_id, old_rating, new_rating | - |

## Ghi chú xử lý

- **Một giao dịch thắng (K-02)**: INV xử lý PaymentSucceeded bằng `UPDATE ... WHERE status = 'held'` trên cùng dòng reservation với job hết hạn. Thua (reservation đã `expired` hoặc `released`) thì INV phát StockCommitFailed; PAY tạo Refund `late_payment`; ORD: đơn đã đóng (`cancelled`, `expired`) thì no-op có log; đơn `pending` (StockCommitFailed tới trước PaymentSucceeded, hai event độc lập qua outbox) hoặc `paid` (PaymentSucceeded tới trước) thì tự hủy do hệ thống (`pending -> cancelled` hoặc `paid -> cancelled`, `cancel_reason` = `stock_commit_failed`, `cancelled_by_role` = `system`) và phát OrderCancelled `reason = stock_commit_failed`, `was_paid = true`; PAY nhận OrderCancelled này không tạo thêm Refund vì đã có `late_payment` (idempotent theo giao dịch cổng). Reservation đã `committed` (đơn COD thu tiền lúc giao, hoặc event trùng) là no-op, không phải lỗi.
- **COD (K-03, K-10)**: CHK gọi `ORD.confirmCod` trực tiếp trong giao dịch đặt hàng (không qua event), ORD phát OrderConfirmed; INV chốt kho và PRM tiêu thụ coupon tại OrderConfirmed. Khi giao xong ORD phát OrderDelivered, PAY thu tiền tự động (`pending -> succeeded`, cùng chuyển trạng thái với nút ghi nhận thu COD của staff nếu còn dùng như đường dự phòng); PaymentSucceeded của COD không còn việc cho INV, PRM (đã xử lý), nên handler bỏ qua.
- **PaymentFailed `is_final`**: `is_final = attempt_no >= PAY_MAX_ATTEMPTS` (cấu hình ADR-007, mặc định 3; không có hằng số 3 cố định). Chỉ `is_final = true` mới làm Order `pending -> cancelled` (reason `payment_failed`). `reason` là mã cố định (`declined`, `timeout`, `cancelled_by_user`, `other`) để NTF chọn câu chữ; mã chi tiết của cổng chỉ nằm ở PaymentAttempt (`gateway_code`, `reason`), không đi qua event. ORD không có chuyển cho ShipmentFailed (chỉ ghi lịch sử).
- **LowStockDetected**: phát khi `available` hạ xuống bằng hoặc dưới ngưỡng, theo cờ `low_stock_notified` (chỉ phát lúc đi xuống, cột "Phát khi" là `-` vì StockItem không có vòng đời).
- **CouponRedeemed**: phát khi redemption `consumed`, tại OrderConfirmed (COD) hoặc PaymentSucceeded (online).
- **ReviewPublished** cũng phát khi `hidden -> published`. PRD giữ `ProductReviewRating` theo `review_id` để cập nhật `rating_count`, `rating_sum` idempotent (event trùng hoặc lệch thứ tự không làm sai số).
- **OrderReturned**: ORD phát khi `shipped -> returned` (nhận ShipmentReturned). PAY đóng Payment COD còn `pending` thành `cancelled` (chuyển đã có trong `entities.md`); Payment đã `succeeded` (đã thu tiền) giữ nguyên, hoàn tiền là thủ công `admin_manual` ở v1. NTF báo khách đơn đã hoàn về. DSH dùng giao diện đọc, không nhận event. Không dùng ShipmentReturned cho PAY để PAY không phụ thuộc trạng thái vận đơn.
- **UserRegistered**: NTF chỉ tạo thông báo chào mừng trong ứng dụng (`in_app`), không gửi email trước khi địa chỉ được xác minh (SB-26); email xác minh đi bằng EmailVerificationRequested.
- **ShipmentReturned**: INV lấy dòng hàng từ StockReservation của `order_id`, nên payload không có danh sách hàng; INV ghi StockMovement `return` (nhập lại kho nếu `restockable`).
- **Event token thô**: `token_ref` của EmailVerificationRequested, PasswordResetRequested là token thô, chỉ đi trong bộ nhớ, không vào outbox, không log (SB-03, SB-26); mất thì khách bấm gửi lại. UserLocked, PasswordChanged đi outbox như thường.
- **DSH** v1 dùng giao diện đọc của module chủ (ADR-020), không nhận event nên không có trong cột Consumers. Event ghi nhận nhưng chưa làm ở v1 (backlog): UserRoleChanged, UserUnlocked, CartAbandoned, ProductPriceChanged, ShipmentCancelled, CouponReleased.

## Nhật ký thay đổi nền

- 2026-10-06 | V-01, K-08 | Thêm phong bì chung (event_id, occurred_at, correlation_id), quy tắc định danh; thêm order_code, user_id vào OrderConfirmed, OrderCancelled, OrderShipped, OrderDelivered, PaymentSucceeded, PaymentFailed, ShipmentFailed, RefundSucceeded, RefundFailed | lý do: NTF cần user_id, order_code ở gần như mọi event đơn, thanh toán, vận đơn mà không có | giải pháp: event mang danh tính tối thiểu, phần còn lại consumer gọi giao diện đọc; loại bảng chiếu NotificationRecipientRef; OrderPaid, OrderConfirmed không thêm shipping_method_id (SHP dùng ORD.findForShipment)
- 2026-10-06 | V-02, K-01, K-09 | OrderCreated thêm order_code, payment_method, payment_expires_at; bỏ INV, DSH khỏi Consumers | lý do: PAY cần phương thức và hạn, NTF cần mã đơn; INV giữ hàng bằng lời gọi reserve trực tiếp, DSH không có handler | giải pháp: giữ hạn 15 phút do INV chạy (ADR-009), payment_expires_at chỉ là bản sao; loại event để INV giữ hàng
- 2026-10-06 | V-03, K-05, K-09 | StockReserved, StockCommitted, StockReleased, StockReservationExpired bỏ reservation_id (dùng order_id); StockReserved, StockReleased, StockCommitted có Consumers `-` | lý do: một đơn nhiều dòng nhưng event có một reservation_id; CHK, DSH khai mà không có handler | giải pháp: khóa theo order_id, không thêm StockReservationGroup; ghi log thay vì consumer
- 2026-10-06 | V-04, K-02 | Thêm StockCommitFailed (INV; PAY, ORD) | lý do: PaymentSucceeded đến sau khi reservation đã expired/released, nền không nói ai thắng | giải pháp: quy tắc một giao dịch thắng bằng khóa dòng; PAY hoàn tiền late_payment, ORD no-op; loại "commit muộn" dù còn tồn. Mã reason (reservation_expired, reservation_released) là chỉ định, chốt ở tech-design
- 2026-10-06 | V-05, K-03 | PaymentFailed thêm is_final; PaymentSucceeded thêm method, paid_at; RefundSucceeded, RefundFailed thêm order_id, amount, bỏ DSH khỏi RefundFailed | lý do: ORD không phân biệt hết lượt thử, PAY cần method, hoàn tiền thiếu đơn | giải pháp: chỉ is_final = true hủy đơn; admin nhận cảnh báo hoàn tiền thất bại qua NTF; PaymentRefunded không thêm amount (chỉ cần khi DSH chuyển read model, SAU)
- 2026-10-06 | V-06 | Chuẩn hóa reason thành mã cố định ở cột Payload (UserLocked, ShipmentFailed, OrderCancelled, Refund, StockReleased) | lý do: AUTH, SHP, ORD, PAY, INV, NTF dùng chuỗi tự do nên NTF không ánh xạ được mẫu | giải pháp: liệt kê mã theo FOUNDATION-CHANGES V-06 và E-14
- 2026-10-06 | V-07, K-09 | LowStockDetected thêm available, product_name, bỏ DSH, ghi điều kiện phát | lý do: NTF thiếu dữ liệu để soạn tin; DSH không có handler | giải pháp: phát khi đi xuống theo cờ low_stock_notified, ghi ở phần Ghi chú vì cột Phát khi là `-`
- 2026-10-06 | V-08, K-05 | ShipmentReturned thêm restockable | lý do: INV cần biết nhập lại kho hay không | giải pháp: INV lấy dòng hàng từ reservation của order_id, không nhồi danh sách hàng vào payload
- 2026-10-06 | V-09, K-09 | Thêm ShipmentTrackingChanged (SHP; ORD) | lý do: ORD giữ bản sao tracking_number nhưng không có event cập nhật | giải pháp: event riêng không gắn đổi trạng thái; ORD cập nhật bản sao
- 2026-10-06 | V-10, K-09 | Thêm PAY vào Consumers của OrderDelivered | lý do: COD thu tiền khi giao nhưng PAY không biết đã giao | giải pháp: PAY nhận OrderDelivered (loại thêm ShipmentDelivered để giữ ORD là nguồn trạng thái đơn); nút thu COD của staff chỉ là đường dự phòng dùng cùng chuyển trạng thái
- 2026-10-06 | V-11, K-09 | CheckoutExpired bỏ order_id, thêm user_id, cart_id, Consumers `-`; CheckoutCompleted ghi rõ phát cho cả vnpay và COD | lý do: phiên hết hạn chưa có Order (ADR-009), INV, PRM khai thừa | giải pháp: bỏ consumer thừa; CheckoutCompleted mang cart_id, order_id
- 2026-10-06 | V-12, K-11 | Thêm ReviewDeleted, ReviewRatingChanged; ReviewHidden thêm rating; ghi ReviewPublished cũng phát khi hidden -> published | lý do: PRD cần cập nhật điểm trung bình khi xóa, sửa điểm, ẩn | giải pháp: payload mang rating (rẻ) cộng bản chiếu ProductReviewRating idempotent; loại chỉ dựa bản chiếu hoặc chỉ dựa payload
- 2026-10-06 | V-13, K-09 | Bỏ NTF khỏi OrderPaid, REV khỏi OrderDelivered, DSH khỏi CouponRedeemed; ghi quy tắc "consumer chỉ khai khi có handler" | lý do: P7 coi consumer là phụ thuộc nhưng nhiều consumer không có handler | giải pháp: NTF dùng PaymentSucceeded, REV hỏi ORD.getDeliveredItems trực tiếp, DSH dùng giao diện đọc (ADR-020)
- 2026-10-06 | V-14, K-14 | Ghi chú token_ref của EmailVerificationRequested, PasswordResetRequested là token thô, không qua outbox, không log | lý do: ADR-011 lưu event xuống CSDL sẽ vô tình lưu token thô, trái SB-03, SB-26 | giải pháp: hai event phát in-process sau commit, best-effort (mất thì khách bấm gửi lại); loại băm token trong payload vì NTF cần liên kết thô để gửi
- 2026-10-06 | V-15, K-10 | Thêm PRM vào Consumers của OrderConfirmed; CouponRedeemed phát khi consumed ở OrderConfirmed hoặc PaymentSucceeded | lý do: đơn COD cần tiêu thụ coupon đối xứng với kho, tránh lượt COD kẹt vô hạn | giải pháp: coupon reserved -> consumed tại OrderConfirmed (COD); loại tiêu thụ khi giao xong
- 2026-10-06 | M-03, R-15 | Thêm event OrderReturned (ORD; PAY, NTF; Phát khi Order:returned) và ghi chú xử lý; Payment `pending -> cancelled` thêm điều kiện đơn COD hoàn về | lý do: ORD, PAY, NTF, DSH gặp `shipped -> returned` không có event nên Payment COD `pending` không bao giờ đóng, khách không được báo | giải pháp: ORD phát OrderReturned (nguồn trạng thái đơn); loại PAY nhận ShipmentReturned vì PAY phụ thuộc trạng thái vận đơn; đơn đã thu tiền hoàn về giữ hoàn thủ công admin_manual
- 2026-10-06 | M-04, R-02 | OrderCancelled.reason thêm `stock_commit_failed`; sửa Ghi chú xử lý "ORD không đổi đơn đã đóng" thành: đơn đã đóng thì no-op, đơn `paid` thì tự hủy do hệ thống | lý do: PaymentSucceeded tới trước StockReservationExpired làm đơn `paid`, PAY hoàn `late_payment`, đơn kẹt `paid` dù tiền đã hoàn (ORD, INV, PAY) | giải pháp: thêm `paid -> cancelled` do hệ thống ở entities.md; PAY không hoàn lần hai vì đã có Refund `late_payment`; loại no-op chờ admin xử lý (đơn kẹt)
- 2026-10-06 | M-05, R-16 | StockReleased.reason chỉ còn `order_cancelled` (bỏ `order_expired`) | lý do: INV chỉ phát `order_cancelled`; đơn hết hạn đi đường StockReservationExpired, không phát StockReleased (INV) | giải pháp: bỏ mã thừa; loại thêm phát StockReleased cho đơn hết hạn (trùng StockReservationExpired)
- 2026-10-06 | M-06, R-06, R-18 | PaymentFailed.reason là mã cố định (declined, timeout, cancelled_by_user, other); ghi `is_final = attempt_no >= PAY_MAX_ATTEMPTS` | lý do: PAY dùng hằng số cấu hình còn nền ghi cố định "3 lượt"; NTF cần mã để chọn câu chữ, không dùng văn bản cổng (PAY, NTF, ORD) | giải pháp: mã chi tiết của cổng chỉ ở PaymentAttempt, không qua event; loại để `reason` là chuỗi tự do
- 2026-10-06 | M-11, R-21 | Ghi ở Ghi chú xử lý: NTF xử lý UserRegistered chỉ bằng thông báo in_app, không email | lý do: AUTH ghi email chào mừng mâu thuẫn SB-26 (email giao dịch chỉ tới địa chỉ đã xác minh) (AUTH, NTF) | giải pháp: chào mừng chỉ trong ứng dụng khớp NTF câu 2; AUTH gỡ ghi chú email chào mừng; loại gửi email chào mừng sau xác minh (v1 không cần)
- 2026-10-06 | M-04, R-02 (làm rõ đợt 2b) | Order `pending -> cancelled` thêm điều kiện hệ thống khi nhận StockCommitFailed trước PaymentSucceeded | lý do: ORD tự phát hiện hai event đi độc lập qua outbox nên StockCommitFailed có thể tới khi đơn còn `pending`; nền chỉ có `paid -> cancelled` nên ORD no-op rồi đơn kẹt `paid` dù tiền đã hoàn | giải pháp: ORD hủy đơn ở cả `pending` và `paid` do hệ thống, PaymentSucceeded tới sau thì PAY hoàn `late_payment`; loại phương án bắt thứ tự phát event vì outbox không bảo đảm thứ tự giữa hai aggregate
