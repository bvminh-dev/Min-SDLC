---
status: approved
---

# Entity

Cột Quan hệ: danh sách cách nhau bởi `;`, mỗi mục dạng `<1|N>-<1|N> <Entity>` (bội số từ entity này sang entity kia).
Cột Vòng đời: **đường chính** của các trạng thái nối bằng `->`, hoặc `-` nếu không có. Nhánh lỗi, hủy, hết hạn nằm ở bảng "Vòng đời chi tiết" bên dưới.

Quy ước chung (áp cho mọi entity, không liệt kê lại từng dòng):
- Mọi entity có `id`, `created_at`, `updated_at`. Entity **chỉ thêm** (AuditLog, StockMovement, OrderStatusHistory, ShipmentStatusHistory, PaymentWebhookLog) không có `updated_at`.
- `deleted_at` chỉ có ở entity xóa mềm, được ghi tường minh ở cột Thuộc tính.
- `version` (số nguyên, khóa lạc quan, ghi lệch trả 409) có ở entity admin sửa: Product, Coupon, ShippingMethod, StockItem, Cart, Payment, Shipment.
- Entity có vòng đời mặc định có thuộc tính `status` (trạng thái hiện tại), không liệt kê lại ở cột Thuộc tính.

Epic DSH không sở hữu entity: DSH chỉ đọc qua giao diện đọc của module chủ (ADR-020). Epic PRJ sở hữu entity nền tảng dùng chung: AuditLog, OutboxEvent, ProcessedEvent, IdempotencyKey.
`Order.payment_status` là bản sao chỉ-đọc của **trạng thái Payment mới nhất**; ORD cập nhật khi nhận event của PAY (PaymentSucceeded, PaymentFailed, PaymentExpired, PaymentRefunded); khi ORD hủy đơn thì ORD tự đặt `payment_status` (không có event PaymentCancelled); ORD không gọi PAY.
Hồ sơ người dùng (profile, avatar) là thuộc tính của User; AUTH sở hữu User, USR sở hữu thao tác sửa hồ sơ và Address (USR đặt `phone`, `avatar_url` qua giao diện nội bộ của AUTH).
**Tiền**: nguồn sự thật là Order (bản chụp lúc đặt) và Payment. Cart và CheckoutSession không lưu tiền (dẫn xuất, tính lại mỗi lần xem); `price_snapshot` của CheckoutSession chỉ để chẩn đoán (SB-23).
**Đồng hồ** (ADR-009): INV là bên duy nhất chạy job hết hạn đơn. `RESERVATION_TTL` (15 phút) nằm trong cấu hình (ADR-007); CHK truyền cùng một `expires_at` cho `INV.reserve` và `ORD.createPending`; `Order.payment_expires_at` là bản sao chỉ đọc. Hạn đường dẫn thanh toán của PAY (10 phút) luôn nhỏ hơn hoặc bằng `payment_expires_at`. Phiên checkout và giỏ là đồng hồ riêng của CHK, CRT.

| Entity | Epic | Khóa | Thuộc tính chính | Quan hệ | Vòng đời |
| --- | --- | --- | --- | --- | --- |
| User | AUTH | id | email, email_verified_at, password_hash, role, full_name, phone, avatar_url, failed_login_count, last_failed_login_at, locked_until, locked_reason (too_many_attempts hoặc admin) | 1-N Address; 1-N Session; 1-N Order; 1-N Notification | active -> locked |
| Session | AUTH | id | user_id, token_hash, expires_at (hạn trượt 30 phút), absolute_expires_at (7 ngày), last_seen_at, revoked_at, revoked_reason (logout, password_changed, admin_lock, replaced) | N-1 User | active -> revoked |
| PasswordResetToken | AUTH | id | user_id, token_hash, expires_at, used_at | N-1 User | issued -> used |
| EmailVerificationToken | AUTH | id | user_id, token_hash, expires_at, used_at | N-1 User | issued -> used |
| Address | USR | id | user_id, receiver, phone, line1 (số nhà, tên đường), ward, district (cho phép rỗng), city, is_default, deleted_at | N-1 User | - |
| Category | PRD | id | name, slug, parent_id, depth | 1-N Product; N-1 Category | - |
| Product | PRD | id | category_id, name, sku, description, price, published_at, rating_count, rating_sum | N-1 Category; 1-1 StockItem; 1-N Review; 1-N ProductImage; 1-N ProductReviewRating | draft -> active -> archived |
| ProductImage | PRD | id | product_id, storage_key, position (1..8), width, height, bytes | N-1 Product | - |
| ProductReviewRating | PRD | id | review_id, product_id, rating, counted (bản chiếu để cập nhật rating_count, rating_sum idempotent) | N-1 Product | - |
| StockItem | INV | id | product_id, on_hand, reserved, low_stock_threshold, low_stock_notified, archived_at | 1-1 Product; 1-N StockMovement; 1-N StockReservation | - |
| StockMovement | INV | id | stock_item_id, type (in, out, adjust, sale, restock, return), quantity (có dấu), on_hand_after, reason, note, ref_type, ref_id, actor_id (cho phép rỗng) | N-1 StockItem | - |
| StockReservation | INV | id | stock_item_id, order_id, quantity, expires_at (rỗng nếu COD) | N-1 StockItem; N-1 Order | held -> committed |
| Cart | CRT | id | user_id, coupon_code, shipping_method_id, shipping_city, last_activity_at, converted_order_id | N-1 User; 1-N CartItem; N-1 ShippingMethod | active -> converted |
| CartItem | CRT | id | cart_id, product_id, quantity, unit_price (chỉ để báo giá đổi, không dùng tính tiền), unavailable_reason | N-1 Cart; N-1 Product | - |
| Coupon | PRM | id | code, type, value, min_order_value, max_discount, expires_at, usage_limit, per_user_limit (số nguyên, rỗng = không giới hạn), consumed_count, reserved_count, created_by, deleted_at | 1-N CouponRedemption | active -> disabled |
| CouponRedemption | PRM | id | coupon_id, order_id (duy nhất), user_id, amount, reserved_at, consumed_at, released_at | N-1 Coupon; N-1 Order; N-1 User | reserved -> consumed |
| CheckoutSession | CHK | id | user_id, cart_id, address_id (cho phép rỗng), shipping_method_id (cho phép rỗng), payment_method, coupon_code, address_snapshot, price_snapshot (chỉ chẩn đoán), order_id (rỗng tới khi completed), expires_at, last_activity_at, completed_at | N-1 User; N-1 Cart; N-1 Address; N-1 ShippingMethod; 1-1 Order | open -> completed |
| Order | ORD | id | user_id, code, items_total, discount, shipping_fee, grand_total, shipping_address (bản chụp: receiver, phone, line1, ward, city), shipping_method_id, payment_method, payment_status, payment_expires_at (rỗng nếu COD), tracking_number (bản sao), cancel_reason (customer_request, admin, payment_failed, stock_commit_failed), cancelled_by_role (customer, admin, system), confirmed_at, paid_at, delivered_at | N-1 User; 1-N OrderItem; 1-N Payment; 1-N Shipment; 1-N StockReservation; 1-N OrderStatusHistory; N-1 ShippingMethod | pending -> paid -> shipped -> delivered |
| OrderItem | ORD | id | order_id, product_id, name_snapshot, unit_price, quantity | N-1 Order; N-1 Product | - |
| OrderStatusHistory | ORD | id | order_id, from_status, to_status, actor_id, actor_role, reason | N-1 Order | - |
| Payment | PAY | id | order_id, order_code, user_id, amount, method, provider_ref (vnp_TransactionNo của giao dịch thành công), attempt_no (tối đa `PAY_MAX_ATTEMPTS`, mặc định 3, cấu hình ADR-007), expires_at, paid_at | N-1 Order; 1-N Refund; 1-N PaymentAttempt | pending -> processing -> succeeded |
| PaymentAttempt | PAY | id | payment_id, attempt_no, txn_ref, create_date (vnp_CreateDate, để dựng lại đường dẫn khi bấm lặp), status, reason, gateway_code, provider_txn_no, expires_at, resolved_at | N-1 Payment | - |
| PaymentWebhookLog | PAY | id | payment_id (rỗng nếu không khớp), txn_ref, payload (đã che), signature_valid, result | N-1 Payment | - |
| Refund | PAY | id | payment_id, attempt_id, gateway_request_id (cấp mới mỗi lần vào `requested`), amount, reason (order_cancelled, order_expired, late_payment, duplicate_payment, admin_manual), note, requested_by, failure_reason, auto_attempt_no, next_retry_at, resolved_at | N-1 Payment; N-1 PaymentAttempt | requested -> succeeded |
| ShippingMethod | SHP | id | name, base_fee, rule (free_over, surcharge, surcharge_cities), is_active | 1-N Shipment; 1-N Order | - |
| Shipment | SHP | id | order_id, shipping_method_id, tracking_number, cod_amount, shipped_at, delivered_at | N-1 Order; N-1 ShippingMethod; 1-N ShipmentStatusHistory | pending -> shipped -> delivered |
| ShipmentStatusHistory | SHP | id | shipment_id, event, status, tracking_number, reason_code, note | N-1 Shipment | - |
| Notification | NTF | id | user_id, channel (chỉ in_app), type, title, body, link, data, event_id, dedupe_key, read_at | N-1 User | unread -> read |
| EmailDelivery | NTF | id | user_id, type, delivery_status (pending, sent, failed, skipped), delivery_reason, attempts, next_attempt_at, sent_at | N-1 User | - |
| Review | REV | id | user_id, product_id, order_item_id, rating, comment, moderation_reason, moderated_by, moderated_at, published_at, edited_at, deleted_at, deleted_by_role | N-1 User; N-1 Product; N-1 OrderItem; 1-N ReviewImage | pending -> published |
| ReviewImage | REV | id | review_id, user_id, storage_key, position (1..5), width, height, bytes, orphaned_at | N-1 Review; N-1 User | - |
| AuditLog | PRJ | id | actor_id (rỗng nếu hệ thống), actor_role (gồm system), action, target_type, target_id, before, after, reason, correlation_id | - | - |
| OutboxEvent | PRJ | id | type, aggregate_type, aggregate_id, payload, occurred_at, dispatched_at, attempts, next_attempt_at (id chính là event_id) | - | - |
| ProcessedEvent | PRJ | id | consumer, event_id, processed_at (duy nhất theo cặp consumer, event_id) | - | - |
| IdempotencyKey | PRJ | id | scope, key, user_id, request_hash, response, expires_at (24 giờ; duy nhất theo scope, user_id, key) | N-1 User | - |

## Ràng buộc toàn vẹn

- Một người có đúng một giỏ `active` (unique một phần). Một phiên checkout `open` mỗi người; một phiên `completed` mỗi giỏ (unique một phần). `CheckoutSession - Cart` là N-1: một giỏ có nhiều phiên nối tiếp (phiên `expired`/`cancelled` rồi thử lại).
- `StockReservation` duy nhất theo `(stock_item_id, order_id)`: một đơn một lượt giữ, event của INV khóa theo `order_id` (không có `reservation_id`). `0 <= reserved <= on_hand` (SB-25).
- `CouponRedemption.order_id` duy nhất: một đơn một lượt dùng coupon. `Coupon.per_user_limit` đếm theo `CouponRedemption.user_id` ở trạng thái `reserved` và `consumed` (`released` không tính); kiểm và giữ lượt trong cùng giao dịch khóa dòng Coupon (SB-25, SB-33).
- Một vận đơn còn hiệu lực mỗi đơn (Shipment không `cancelled` hoặc `returned`).
- `Notification` duy nhất theo `(user_id, dedupe_key)`.
- Bảng chỉ thêm (AuditLog, StockMovement, OrderStatusHistory, ShipmentStatusHistory, PaymentWebhookLog) có trigger chặn UPDATE, DELETE. AuditLog, PaymentWebhookLog giữ 12 tháng (ADR-008); OutboxEvent đã phát giữ 14 ngày; IdempotencyKey 24 giờ.
- Địa chỉ: đúng một địa chỉ mặc định mỗi người. `Order.shipping_address`, `CheckoutSession.address_snapshot` là bản chụp, không tham chiếu `Address`.


## Vòng đời chi tiết

Bảng chuyển trạng thái **đầy đủ**, gồm cả nhánh lỗi, hủy, hết hạn. Mọi trạng thái trong cột Vòng đời ở bảng trên phải có ở đây,
và mọi entity có vòng đời phải có dòng ở đây. Event ở `events.md` tham chiếu trạng thái trong bảng này (cột "Phát khi").

Quy tắc "một giao dịch thắng" (đua thanh toán và hết hạn): INV xử lý PaymentSucceeded bằng `UPDATE ... WHERE status = 'held'` trên cùng dòng StockReservation với job hết hạn (khóa dòng); bên nào cập nhật được trước thì thắng. Bên thua: INV phát StockCommitFailed; PAY tạo Refund `late_payment` gắn giao dịch cổng (tiền trùng thì `duplicate_payment`); ORD nhận StockCommitFailed thì không đổi đơn đã đóng (`cancelled`, `expired`, no-op có log), còn đơn `paid` (PaymentSucceeded tới trước khi reservation hết hạn) thì ORD tự hủy do hệ thống (`paid -> cancelled`, `cancel_reason` = `stock_commit_failed`, `cancelled_by_role` = `system`) để đơn không kẹt `paid` dù tiền đã hoàn. Không có "commit muộn" dù còn tồn. Payment đã đóng (`expired`, `cancelled`) nhận thanh toán muộn hoặc trùng thì không đổi trạng thái, chỉ tạo Refund.

| Entity | Từ | Sang | Điều kiện |
| --- | --- | --- | --- |
| User | active | locked | Quá số lần đăng nhập sai hoặc admin khóa |
| User | locked | active | Admin mở khóa hoặc hết thời gian khóa |
| Session | active | revoked | Đăng xuất, đổi mật khẩu, thay bằng phiên mới hoặc admin thu hồi |
| Session | active | expired | Quá hạn trượt hoặc hạn tuyệt đối |
| PasswordResetToken | issued | used | Đặt lại mật khẩu thành công |
| PasswordResetToken | issued | expired | Quá hạn token |
| EmailVerificationToken | issued | used | Khách bấm link xác minh, ghi email_verified_at |
| EmailVerificationToken | issued | expired | Quá hạn token, khách yêu cầu gửi lại |
| Product | draft | active | Admin công bố |
| Product | active | archived | Admin ngừng bán (trạng thái cuối, chưa có khôi phục ở v1) |
| Product | draft | archived | Admin hủy bản nháp |
| StockReservation | held | committed | Thanh toán online thành công (PaymentSucceeded, theo quy tắc một giao dịch thắng) hoặc đơn COD được xác nhận (OrderConfirmed), trừ kho thật |
| StockReservation | held | released | Đơn bị hủy trước khi thanh toán (gồm khi thanh toán thất bại hết lượt thử: ORD hủy đơn rồi phát OrderCancelled) |
| StockReservation | committed | released | Đơn đã trừ kho (paid hoặc confirmed) bị hủy trước khi giao: hoàn lại on_hand. Chỉ trước khi giao; ShipmentReturned không đổi trạng thái (INV ghi StockMovement return) |
| StockReservation | held | expired | Quá hạn giữ hàng mà chưa thanh toán (INV là bên duy nhất giữ đồng hồ và chạy job, xem ADR-009) |
| Cart | active | converted | CheckoutCompleted (checkout tạo đơn thành công, cả vnpay và COD) |
| Cart | active | abandoned | 30 ngày không có thao tác sửa của khách (xem giỏ không tính) |
| Coupon | active | disabled | Admin tắt |
| Coupon | disabled | active | Admin bật lại |
| Coupon | active | expired | Quá ngày hết hạn |
| Coupon | disabled | expired | Quá ngày hết hạn khi đang tắt |
| Coupon | active | exhausted | Hết lượt dùng |
| Coupon | exhausted | active | Một lượt được trả lại (CouponRedemption consumed -> released) |
| Coupon | active | deleted | Admin xóa (xóa mềm) |
| Coupon | disabled | deleted | Admin xóa (xóa mềm) |
| Coupon | expired | deleted | Admin xóa (xóa mềm) |
| Coupon | exhausted | deleted | Admin xóa (xóa mềm) |
| CouponRedemption | reserved | consumed | Đơn COD được xác nhận (OrderConfirmed) hoặc thanh toán online thành công (PaymentSucceeded) |
| CouponRedemption | reserved | released | Đơn hủy, hết hạn hoặc thanh toán thất bại |
| CouponRedemption | consumed | released | Đơn hủy trước khi giao: trả lượt, Coupon exhausted -> active nếu cần |
| CheckoutSession | open | completed | Tạo đơn thành công |
| CheckoutSession | open | expired | 30 phút không có thao tác ghi |
| CheckoutSession | open | cancelled | Khách rời checkout, hoặc mở phiên cho giỏ khác, hoặc giỏ không còn hiện hành (giá hoặc kho đổi thì không tự hủy, khách xác nhận lại) |
| Order | pending | paid | Payment succeeded |
| Order | pending | confirmed | Đơn COD: CHK gọi ORD.confirmCod trong giao dịch đặt hàng (INV đã giữ hàng bằng lời gọi reserve), không chờ thanh toán |
| Order | pending | cancelled | Khách hoặc admin hủy trước khi thanh toán; hoặc ORD nhận PaymentFailed có is_final = true (hết lượt thử); hoặc hệ thống: ORD nhận StockCommitFailed khi đơn còn `pending` (event đến trước PaymentSucceeded, vì hai event đi độc lập qua outbox: `cancelled_by_role` = `system`, `cancel_reason` = `stock_commit_failed`). PaymentSucceeded đến sau cho đơn đã `cancelled` thì Payment đóng và PAY tạo Refund `late_payment` (một giao dịch thắng) |
| Order | pending | expired | ORD nhận StockReservationExpired (hạn giữ hàng 15 phút, thanh toán online) |
| Order | paid | cancelled | Khách hoặc admin hủy trước khi giao, kích hoạt hoàn tiền tự động |
| Order | paid | cancelled | Hệ thống: ORD nhận StockCommitFailed khi đơn đã `paid` (`cancelled_by_role` = `system`, `cancel_reason` = `stock_commit_failed`); PAY đã hoàn `late_payment` nên PAY không tạo thêm Refund khi nhận OrderCancelled của đơn này; INV không có gì để trả (reservation đã `expired` hoặc `released`) |
| Order | confirmed | cancelled | Khách hoặc admin hủy đơn COD trước khi giao, không cần hoàn tiền |
| Order | paid | shipped | Shipment shipped (SHP phát ShipmentShipped; nhân viên thao tác ở epic SHP, ORD không tự chuyển) |
| Order | confirmed | shipped | Shipment shipped |
| Order | shipped | delivered | Shipment delivered |
| Order | shipped | returned | ORD nhận ShipmentReturned (trạng thái cuối), phát OrderReturned để PAY đóng Payment COD `pending` và NTF báo khách. ShipmentFailed không đổi trạng thái Order (chỉ ghi lịch sử). Đơn đã thu tiền rồi hoàn về: admin hoàn tiền thủ công (admin_manual) ở v1 |
| Payment | pending | processing | Gửi yêu cầu tới cổng thanh toán |
| Payment | processing | succeeded | Callback/webhook xác nhận thành công |
| Payment | processing | failed | Callback/webhook báo lỗi hoặc timeout |
| Payment | processing | expired | Quá hạn đường dẫn thanh toán khi chưa có kết quả |
| Payment | processing | cancelled | Đơn bị hủy khi đang xử lý |
| Payment | failed | processing | Khách thử lại (payment retry) |
| Payment | failed | succeeded | Webhook thành công đến muộn khi đơn còn pending |
| Payment | failed | expired | Quá hạn thanh toán sau khi thất bại (failed không phải trạng thái cuối) |
| Payment | failed | cancelled | Đơn bị hủy sau khi thất bại |
| Payment | pending | succeeded | Đơn COD: giao thành công và thu tiền (ORD phát OrderDelivered, PAY nhận; không qua processing) |
| Payment | pending | expired | Quá hạn thanh toán |
| Payment | pending | cancelled | Đơn bị hủy, hoặc đơn COD hoàn về (`Order:returned`, PAY nhận OrderReturned, Payment COD chưa thu tiền) |
| Payment | succeeded | refunded | Hoàn tiền toàn phần thành công |
| Refund | requested | succeeded | Cổng thanh toán xác nhận hoàn |
| Refund | requested | failed | Cổng thanh toán từ chối hoặc lỗi |
| Refund | failed | requested | Tự thử lại tối đa 3 lần hoặc admin thử lại |
| Shipment | pending | shipped | Bàn giao cho đơn vị vận chuyển |
| Shipment | pending | cancelled | Đơn bị hủy trước khi bàn giao |
| Shipment | shipped | delivered | Giao thành công |
| Shipment | shipped | failed | Giao thất bại |
| Shipment | failed | returned | Hàng hoàn về kho |
| Notification | unread | read | Người dùng mở (chỉ kênh in_app) |
| Review | pending | published | Admin duyệt (hoặc tự động nếu không bật REVIEW_PRE_MODERATION) |
| Review | pending | rejected | Admin từ chối (trạng thái cuối, ngoài xóa) |
| Review | pending | deleted | Chủ review hoặc admin xóa |
| Review | rejected | deleted | Chủ review hoặc admin xóa |
| Review | published | pending | Chủ review sửa nội dung khi bật REVIEW_PRE_MODERATION (tắt thì giữ published) |
| Review | published | hidden | Admin ẩn |
| Review | hidden | published | Admin bỏ ẩn |
| Review | published | deleted | Chủ review hoặc admin xóa |
| Review | hidden | deleted | Chủ review hoặc admin xóa |

## Nhật ký thay đổi nền

- 2026-10-06 | E-01 | Thêm quy ước chung đầu file: `id, created_at, updated_at` mọi entity, `deleted_at` khi xóa mềm, `version` cho entity admin sửa | lý do: 14 epic lặp lại cùng bộ cột và không thống nhất khóa lạc quan | giải pháp: một đoạn quy ước thay vì liệt kê từng dòng; loại phương án ghi `version` vào cột của từng entity vì lặp
- 2026-10-06 | E-02, K-16 | Thêm AuditLog (PRJ, chỉ thêm, giữ 12 tháng); sửa câu "DSH và PRJ không sở hữu entity" thành chỉ DSH | lý do: SB-19, ADR-008 nói lưu CSDL 12 tháng nhưng không entity nào sở hữu; 12 epic ghi audit | giải pháp: entity thuộc PRJ, ghi đồng bộ cùng giao dịch (ADR-021 phương án A); loại phương án ghi qua event/outbox vì có thể trễ và mất audit
- 2026-10-06 | E-03 | Thêm OutboxEvent và ProcessedEvent (PRJ) | lý do: bus in-process mất event khi tiến trình chết giữa commit và phát, 13 epic nêu | giải pháp: outbox cùng giao dịch, consumer chống trùng bằng ProcessedEvent (ADR-011 A); loại phát đồng bộ trong giao dịch và đối soát từng cặp. OutboxEvent không chỉ thêm hoàn toàn vì cột dispatched_at, attempts được cập nhật
- 2026-10-06 | E-04 | Thêm IdempotencyKey (PRJ) | lý do: đặt hàng, thanh toán, hoàn tiền, kho, đánh giá bị gửi lại; INV muốn cột riêng trong StockMovement | giải pháp: bảng chung ở platform giữ 24 giờ (ADR-017 A); StockMovement không có cột idempotency; loại cột riêng từng module
- 2026-10-06 | E-05 | User thêm đếm đăng nhập sai và khóa; Session thêm hạn trượt, hạn tuyệt đối, thu hồi; hai Token thêm used_at | lý do: AUTH cần khóa tạm, hạn phiên 7 ngày và thu hồi có lý do; USR cần chỗ ghi phone, avatar | giải pháp: thêm cột, USR ghi phone/avatar_url qua giao diện nội bộ của AUTH để giữ một epic sở hữu User; loại phương án chuyển phone sang entity của USR
- 2026-10-06 | E-06 | Address thêm line1, deleted_at, district cho phép rỗng | lý do: USR, CHK, ORD, SHP không giao được nếu thiếu số nhà, tên đường | giải pháp: thêm line1 bắt buộc và xóa mềm; giữ district cho phép rỗng; đơn lưu bản chụp có line1
- 2026-10-06 | E-07, K-11 | Product thêm published_at, rating_count, rating_sum; thay images bằng ProductImage; thêm ProductReviewRating; Category thêm depth | lý do: PRD, REV cần điểm trung bình không tính lại và ảnh có thứ tự, kích thước | giải pháp: làm cả payload mang rating (V-12) lẫn bản chiếu theo review_id để cập nhật idempotent; loại tính trung bình bằng truy vấn trực tiếp bảng Review (vi phạm ranh giới module). Chưa thêm slug cho Product
- 2026-10-06 | E-08, K-05 | StockItem thêm low_stock_notified, archived_at; StockMovement thêm on_hand_after, note, ref_type, ref_id, type có dấu, actor_id rỗng được; StockReservation expires_at rỗng cho COD, unique theo (stock_item_id, order_id) | lý do: INV cần cờ cạnh xuống, sổ kho có số dư sau, đơn COD giữ không hạn; một đơn nhiều dòng nhưng event có một reservation_id | giải pháp: khóa theo order_id, không thêm entity đầu phiếu StockReservationGroup (thừa)
- 2026-10-06 | E-09, K-07 | Cart bỏ subtotal, discount, shipping_fee, total; thêm coupon_code, shipping_method_id, shipping_city, last_activity_at, converted_order_id; CartItem thêm unavailable_reason | lý do: CRT, CHK cùng lưu tiền, trái SB-23 (server tính lại) | giải pháp: tiền dẫn xuất, nguồn sự thật là Order và Payment; Cart giữ lựa chọn tạm, CHK sao chép sang phiên khi tạo phiên rồi phiên là nguồn
- 2026-10-06 | E-10, K-06, K-07 | CheckoutSession quan hệ Cart đổi từ 1-1 sang N-1; thêm coupon_code, address_snapshot, expires_at, last_activity_at, completed_at; address_id, shipping_method_id, order_id cho phép rỗng; sửa điều kiện open -> cancelled | lý do: CHK, CRT cùng nói một giỏ có nhiều phiên liên tiếp (expired/cancelled rồi thử lại) | giải pháp: N-1 kèm unique một phần (một open mỗi người, một completed mỗi giỏ); giá/kho đổi không tự hủy, khách xác nhận lại; loại tự hủy khi giá đổi vì khách mất phiên vô cớ
- 2026-10-06 | E-11, K-10 | Coupon thêm consumed_count, reserved_count, created_by, deleted_at; CouponRedemption thêm reserved_at, consumed_at, released_at, order_id duy nhất | lý do: PRM cần bộ đếm nguyên tử (SB-25) và một đơn một lượt | giải pháp: thêm cột; per_user_limit chưa thêm (SAU nếu chưa chốt câu 6 của PRM)
- 2026-10-06 | E-12, K-01, K-07 | Order thêm shipping_method_id, payment_expires_at, tracking_number, cancel_reason, cancelled_by_role, confirmed_at, paid_at, delivered_at; shipping_address là bản chụp; định nghĩa payment_status = trạng thái Payment mới nhất | lý do: ai giữ đồng hồ thanh toán, SHP cần phương thức, PAY, giao diện cần đếm ngược | giải pháp: giữ ADR-009 (15 phút, INV chạy job), Order lưu bản sao chỉ đọc payment_expires_at, hạn PAY không vượt hạn đó; loại kéo dài hạn giữ để đủ 3 lượt thử
- 2026-10-06 | E-13 | Thêm OrderStatusHistory (ORD, chỉ thêm) | lý do: ORD-DB ghi lịch sử nhưng chưa có entity (dùng Order kèm OPEN) | giải pháp: entity riêng thuộc ORD, trigger chặn UPDATE, DELETE
- 2026-10-06 | E-14, K-04 | Payment thêm order_code, user_id, expires_at, paid_at; thêm PaymentAttempt, PaymentWebhookLog; Refund thêm attempt_id, reason (mã), note, requested_by, failure_reason, auto_attempt_no, next_retry_at, resolved_at | lý do: PAY có nhiều lượt thử, cần nhật ký webhook và tự thử lại hoàn tiền | giải pháp: Payment 1-N PaymentAttempt, webhook log chỉ thêm giữ 12 tháng; giá trị status của PaymentAttempt và cột chi tiết của PaymentWebhookLog chốt ở tech-design
- 2026-10-06 | E-15 | ShippingMethod thêm is_active, định nghĩa rule; Shipment thêm cod_amount, shipped_at, delivered_at; thêm ShipmentStatusHistory | lý do: SHP cần vận hành phương thức, thu COD và lịch sử bàn giao | giải pháp: một vận đơn còn hiệu lực mỗi đơn (ràng buộc); lịch sử chỉ thêm
- 2026-10-06 | E-16, K-08 | Notification chỉ còn kênh in_app, thêm title, link, data, event_id, dedupe_key; tách EmailDelivery | lý do: NTF trộn thông báo trong app và email, thiếu chống trùng | giải pháp: unique (user_id, dedupe_key); EmailDelivery riêng với delivery_status; không thêm NotificationRecipientRef, consumer gọi giao diện đọc của AUTH
- 2026-10-06 | E-17 | Review thêm trường kiểm duyệt, published_at, edited_at, deleted_at, deleted_by_role; thay images bằng ReviewImage | lý do: REV cần dấu vết kiểm duyệt và dọn ảnh mồ côi | giải pháp: ReviewImage có position 1..5, orphaned_at để job dọn (ADR-018)
- 2026-10-06 | E-18, K-03 | Order: thêm shipped -> returned; ghi cả admin ở paid/confirmed -> cancelled; pending -> cancelled chỉ khi PaymentFailed is_final; pending -> confirmed bởi CHK gọi ORD.confirmCod | lý do: ORD là consumer của ShipmentFailed, ShipmentReturned nhưng Order không có chuyển; COD pending -> confirmed không rõ ai gây | giải pháp: COD gọi trực tiếp trong giao dịch đặt hàng (không qua event); ShipmentFailed chỉ ghi lịch sử; hoàn đơn đã thu tiền là thủ công admin_manual ở v1 (mục c cần người xác nhận, đã duyệt theo khuyến nghị); admin hủy paid cũng hoàn tự động
- 2026-10-06 | E-19, K-02, K-04 | Payment: thêm processing -> expired, failed -> expired, processing -> cancelled, failed -> cancelled, failed -> succeeded; Refund: thêm failed -> requested | lý do: PAY có đường không thoát khỏi failed; đua thanh toán và hết hạn chưa có người thắng | giải pháp: chấp nhận bộ chuyển PAY đề xuất; Payment đóng nhận tiền muộn/trùng không đổi trạng thái, chỉ tạo Refund; quy tắc một giao dịch thắng ghi đầu bảng chuyển; không thêm event PaymentCancelled
- 2026-10-06 | E-20, K-05 | StockReservation: committed -> released chỉ trước khi giao; ShipmentReturned không đổi trạng thái | lý do: ShipmentReturned không có chuyển cho reservation | giải pháp: giữ committed, INV ghi StockMovement return; loại thêm trạng thái returned (thừa)
- 2026-10-06 | E-21 | Cart: abandoned sau 30 ngày không có thao tác sửa; converted do CheckoutCompleted cả COD | lý do: CRT cần điều kiện chính xác | giải pháp: xem giỏ không tính hoạt động
- 2026-10-06 | E-22 | Review: thêm pending/rejected/hidden -> deleted, hidden -> published, published -> pending (chỉ khi bật REVIEW_PRE_MODERATION); rejected là cuối | lý do: REV cần xóa ở mọi trạng thái và bỏ ẩn | giải pháp: sửa đánh giá đã đăng giữ published khi tắt kiểm duyệt trước
- 2026-10-06 | E-23, K-10 | Coupon: thêm expired/exhausted -> deleted, disabled -> expired, exhausted -> active; CouponRedemption: thêm consumed -> released | lý do: coupon COD giữ lượt vô hạn nếu chỉ tiêu thụ khi giao xong | giải pháp: đối xứng với kho, tiêu thụ tại OrderConfirmed (COD) hoặc PaymentSucceeded, hủy trước khi giao thì trả lượt (mục cần người xác nhận, đã duyệt theo khuyến nghị); loại giữ lượt tới khi giao
- 2026-10-06 | M-03, R-15 | Order `shipped -> returned` phát OrderReturned; Payment `pending -> cancelled` thêm điều kiện đơn COD hoàn về | lý do: Payment COD `pending` không bao giờ đóng khi đơn hoàn về, PAY không biết (ORD, PAY, NTF, DSH) | giải pháp: PAY nhận OrderReturned (chuyển Payment đã có); loại PAY nhận ShipmentReturned (phụ thuộc trạng thái vận đơn)
- 2026-10-06 | M-04, R-02 | Order thêm `paid -> cancelled` do hệ thống khi nhận StockCommitFailed; `cancel_reason` thêm `stock_commit_failed`, `cancelled_by_role` liệt kê (customer, admin, system); sửa quy tắc một giao dịch thắng | lý do: đơn `paid` mà reservation đã hết hạn, PAY hoàn `late_payment`, đơn kẹt `paid` dù tiền đã hoàn (ORD, INV, PAY) | giải pháp: ORD tự hủy, PAY không hoàn lần hai, INV không có gì để trả; loại giữ no-op chờ admin xử lý
- 2026-10-06 | M-06, R-06 | Payment.attempt_no tối đa `PAY_MAX_ATTEMPTS` (mặc định 3); PaymentAttempt thêm create_date; Refund thêm gateway_request_id | lý do: nền ghi cố định "3 lượt" còn PAY dùng cấu hình; PAY cần dựng lại đường dẫn khi bấm lặp và khóa yêu cầu hoàn mỗi lần thử (PAY, ORD) | giải pháp: hằng số cấu hình ADR-007; gateway_request_id cấp mới mỗi lần vào `requested`; loại cố định 3
- 2026-10-06 | M-07, R-01 | Coupon thêm per_user_limit; ràng buộc đếm CouponRedemption theo user_id ở reserved và consumed | lý do: SB-33 yêu cầu số lượt dùng mỗi người nhưng Coupon không có thuộc tính nên PRM không làm (PRM, CHK) | giải pháp: thêm cột (rỗng = không giới hạn), kiểm cùng giao dịch khóa dòng Coupon; loại bỏ phần coupon khỏi SB-33
- 2026-10-06 | M-04, R-02 (làm rõ đợt 2b) | Order `pending -> cancelled` thêm điều kiện hệ thống khi nhận StockCommitFailed trước PaymentSucceeded | lý do: ORD tự phát hiện hai event đi độc lập qua outbox nên StockCommitFailed có thể tới khi đơn còn `pending`; nền chỉ có `paid -> cancelled` nên ORD no-op rồi đơn kẹt `paid` dù tiền đã hoàn | giải pháp: ORD hủy đơn ở cả `pending` và `paid` do hệ thống, PaymentSucceeded tới sau thì PAY hoàn `late_payment`; loại phương án bắt thứ tự phát event vì outbox không bảo đảm thứ tự giữa hai aggregate
