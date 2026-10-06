# Đề xuất sửa nền (tổng hợp 14 epic)

Trạng thái: **đề xuất, chờ người duyệt**. Không file nào trong `spec/` được sửa bởi tài liệu này. Nền hiện tại (`architecture.md`, `security-baseline.md`, `constitution.md`, `roadmap.md`, `domain/*`) đều `approved`, nên mọi thay đổi đi qua `sdlc-impact` rồi `sdlc-foundation` (P2).

Nguồn: mục "Nền cần sửa" của 14 epic (`/tmp/ecom/foundation-raw.md`), bài học L8 và `spec/epics/ORD/questions.md` (mục B), các `[OPEN]` ở `ORD-API`, `ORD-SEC`. Đã loại những gì nền có sẵn: ADR-001..010, SB-01..26, P1..P7.

Cách đọc:
- Mức ưu tiên: **CHẶN** (nhiều epic không duyệt được nếu thiếu, hoặc hai epic mâu thuẫn nhau), **NÊN** (một đến hai epic cần, có mặc định an toàn), **SAU** (có thể để sau v1, hoặc chỉ ghi nhận).
- Mỗi đề xuất có mã (E, V, A, S, R, C, ADR, K) để người duyệt trả lời "đồng ý E-12, sửa V-04".
- Cột "Epic" là các epic cần thay đổi đó (đã gộp những epic cùng đề nghị).
- Mã SB mới đánh tiếp từ SB-27, người sửa tự gán số.
- Giá trị số (hạn, giới hạn) là mặc định do epic đề xuất, đã hợp nhất; đổi được ở tech-design.

Số liệu tổng hợp: xem mục 7 (87 đề xuất: 24 CHẶN, 56 NÊN, 7 SAU).

---

## 1. Mâu thuẫn giữa các epic (nền phải phân xử)

| Mã | Mâu thuẫn | Epic | Phương án khuyến nghị | Sửa ở |
| --- | --- | --- | --- | --- |
| K-01 | **Ai giữ đồng hồ.** ADR-009: INV giữ đồng hồ hạn giữ hàng 15 phút. Nhưng PAY có hạn đường dẫn thanh toán 10 phút và 3 lượt thử (muốn thêm hạn giữ để đủ 3 lượt); CHK có phiên 30 phút; ORD chỉ hết hạn nhờ StockReservationExpired. Không ai nói hạn thanh toán của Order là gì và PAY lấy ở đâu. | INV, PAY, ORD, CHK | Giữ nguyên ADR-009 (15 phút), không kéo dài. INV là bên **duy nhất chạy** job hết hạn đơn. Hằng số `RESERVATION_TTL` nằm trong cấu hình (ADR-007), CHK truyền cùng một `expires_at` cho `INV.reserve` và `ORD.createPending`. Order lưu bản sao `payment_expires_at` (chỉ đọc, để PAY và giao diện đếm ngược). Hạn đường dẫn PAY (10 phút) luôn nhỏ hơn hoặc bằng `payment_expires_at`; lượt thử cuối không vượt hạn đó. Phiên checkout và giỏ là đồng hồ của chính CHK, CRT (không liên quan hàng). | E-12, A-06 |
| K-02 | **Đua giữa thanh toán và hết hạn.** PaymentSucceeded đến sau (hoặc cùng lúc) khi reservation đã `expired` hoặc đơn `expired`/`cancelled`. Nền không nói ai thắng; PAY đề xuất event `StockCommitFailed`, ORD chỉ cần no-op. | INV, PAY, ORD | Quy tắc "một giao dịch thắng": INV xử lý PaymentSucceeded bằng `UPDATE ... WHERE status='held'` trên cùng dòng reservation với job hết hạn (khóa dòng). Thua thì INV phát `StockCommitFailed`; ORD không đổi đơn đã đóng (no-op có log); PAY tạo Refund `late_payment` gắn giao dịch cổng (tiền thu muộn hoặc trùng cũng vậy, `duplicate_payment`). Không có "commit muộn" dù còn tồn. | E-19, V-04 |
| K-03 | **Vòng đời Order thiếu chuyển trạng thái.** ORD là consumer của ShipmentFailed, ShipmentReturned nhưng Order không có chuyển; PaymentFailed hết lượt chưa có cờ; đơn COD `pending -> confirmed` không có event; admin hủy đơn paid chưa nêu. | ORD, SHP, PAY, CHK | (a) COD: CHK gọi `ORD.confirmCod` **trực tiếp trong giao dịch đặt hàng** (không qua event; INV đã giữ hàng bằng lời gọi `reserve`). (b) PaymentFailed mang `is_final`; chỉ `is_final=true` mới `pending -> cancelled`. (c) ShipmentFailed: Order giữ `shipped`, chỉ ghi lịch sử; ShipmentReturned: thêm `shipped -> returned` (cuối). Đơn đã thu tiền rồi hoàn về: hoàn thủ công do admin (`admin_manual`) ở v1. (d) Admin hủy `paid` cũng kích hoạt hoàn tiền tự động như khách. **Cần người xác nhận mục (c).** | E-18, V-05, S-05 |
| K-04 | **Vòng đời Payment/Refund thiếu chuyển.** PAY cần `processing -> expired`, `failed -> expired/cancelled`, `failed -> succeeded` (webhook muộn khi đơn còn `pending`), Refund `failed -> requested` (tự thử lại 3 lần). `failed` hiện như không thoát được. | PAY, ORD | Chấp nhận toàn bộ bộ chuyển PAY đề xuất (E-19). Payment đã đóng (`expired`, `cancelled`) nhận thanh toán muộn thì không đổi trạng thái, chỉ tạo Refund. `Order.payment_status` = trạng thái Payment mới nhất; hủy đơn thì ORD tự đặt, **không** thêm event `PaymentCancelled`. | E-19 |
| K-05 | **Reservation: một đơn nhiều dòng nhưng event có một `reservation_id`.** INV đề xuất bỏ trường hoặc thêm entity đầu phiếu. ShipmentReturned không có chuyển cho reservation. | INV, CHK, ORD | Bỏ `reservation_id` khỏi mọi event của INV, khóa theo `order_id` (một đơn một lượt giữ, unique `(stock_item_id, order_id)`). Không thêm `StockReservationGroup` (thừa). ShipmentReturned: reservation giữ `committed`, INV ghi StockMovement `return`; không thêm trạng thái `returned`. | V-03, E-08, E-20 |
| K-06 | **CheckoutSession - Cart: nền ghi 1-1**, nhưng CHK và CRT cùng nói một giỏ có nhiều phiên liên tiếp (phiên `expired`/`cancelled` rồi thử lại). | CHK, CRT | Đổi thành `N-1 Cart`. Ràng buộc: một phiên `open` mỗi người, một phiên `completed` mỗi giỏ (unique một phần). `CheckoutSession - Order` giữ 1-1 nhưng `order_id` rỗng tới khi `completed`. | E-10 |
| K-07 | **Ai lưu lựa chọn coupon, phương thức vận chuyển, địa chỉ, và tiền nằm ở đâu.** CRT thêm `coupon_code`, `shipping_method_id`, `shipping_city` vào Cart; CHK thêm `coupon_code`, `shipping_method_id`, `price_snapshot` vào CheckoutSession; nền ghi `subtotal/discount/shipping_fee/total` ở Cart. SB-23: tiền do server tính lại. | CRT, CHK, ORD | Tiền **không** lưu ở Cart và CheckoutSession (dẫn xuất, `price_snapshot` chỉ để chẩn đoán); nguồn sự thật tiền là Order (bản chụp lúc đặt) và Payment. Cart giữ lựa chọn tạm (coupon, phương thức, thành phố) cho trang giỏ; CHK sao chép sang phiên khi tạo phiên, từ đó phiên là nguồn. Order thêm `shipping_method_id`, địa chỉ là bản chụp. | E-09, E-10, E-12 |
| K-08 | **Payload event thiếu để consumer tự làm việc.** NTF cần `user_id`, `order_code` ở gần như mọi event đơn/thanh toán/vận đơn; PAY cần `payment_method`; hoàn tiền thiếu `order_id`; LowStockDetected thiếu `available`. NTF đề xuất thêm bảng chiếu `NotificationRecipientRef` thay vì sửa payload. | NTF, PAY, ORD, SHP, INV | Quy tắc chung (V-01): event mang `order_id`, `order_code`, `user_id` khi liên quan đơn; còn lại consumer **gọi giao diện đọc** của module chủ (không nhồi payload). Bỏ `NotificationRecipientRef`. OrderPaid/OrderConfirmed **không** thêm `shipping_method_id` (SHP dùng `ORD.findForShipment`). | V-01, V-02, V-05, E-16 |
| K-09 | **Consumers khai nhưng không dùng, và ngược lại.** Thừa: INV ở OrderCreated, DSH ở 5 event, NTF ở OrderPaid, REV ở OrderDelivered, CHK ở StockReserved/Released, INV+PRM ở CheckoutExpired. Thiếu: PAY ở OrderDelivered (thu COD), ORD ở tracking, PRM ở OrderConfirmed. P7 coi consumer là phụ thuộc. | INV, DSH, NTF, REV, CHK, PAY, PRM, SHP | Quy tắc: consumer chỉ khai khi có handler; event không ai nhận ghi `-`. Bỏ các consumer thừa; PAY nhận **OrderDelivered** (không thêm ShipmentDelivered); thêm ShipmentTrackingChanged. DSH v1 dùng giao diện đọc (ADR-020), không nhận event. | V-02, V-03, V-10, V-11, V-13 |
| K-10 | **COD: lúc nào tiêu thụ coupon.** PRM mặc định tiêu thụ coupon khi PaymentSucceeded lúc giao xong (COD giữ lượt vô hạn); INV chốt kho lúc `confirmed`. PRM đề xuất `consumed -> released` nếu hủy đơn. | PRM, ORD, INV | Đối xứng với kho: coupon `reserved -> consumed` tại **OrderConfirmed (COD)** hoặc PaymentSucceeded (online); hủy trước khi giao thì `consumed -> released` (trả lượt, `Coupon exhausted -> active`). Tránh lượt COD kẹt vô hạn. **Cần người xác nhận.** | E-23, V-15 |
| K-11 | **Điểm đánh giá trung bình.** REV muốn event mang đủ `rating`, `ReviewDeleted`, `ReviewRatingChanged` để PRD khỏi lưu bản chiếu; PRD đề xuất bảng chiếu `ProductReviewRating` theo `review_id`. | REV, PRD | Làm cả hai: payload mang `rating` (rẻ), PRD giữ `ProductReviewRating(review_id, product_id, rating, counted)` để cập nhật `rating_count/rating_sum` **idempotent** (event trùng hoặc lệch thứ tự không làm sai số). Thêm ReviewDeleted, ReviewRatingChanged. | E-07, V-12 |
| K-12 | **PRD không thấy tồn kho** (INV phụ thuộc PRD, không được gọi ngược) nhưng trang sản phẩm cần "còn hàng/hết hàng". | PRD, INV, CRT | Không thêm event, không đọc ngược. INV phơi endpoint công khai theo lô `GET /inventory/availability?product_ids=` chỉ trả `in_stock` (bool), web ghép ở lớp giao diện; không lộ số chính xác (S-16). | A-02, S-16 |
| K-13 | **Dữ liệu cá nhân của staff.** SB-08 chỉ cho chủ và admin; ORD mặc định staff không thấy địa chỉ; SHP cần staff thấy người nhận khi bàn giao; USR cho staff tra cứu khách bản che. | ORD, SHP, USR, DSH | Viết lại SB-08 thành ba ngoại lệ có giới hạn (S-04). ORD giữ mặc định staff không thấy; SHP là nơi staff thấy người nhận, chỉ khi Shipment `pending/shipped/failed`. | S-04, R-02 |
| K-14 | **Raw token đi qua event nhưng ADR outbox sẽ lưu event xuống CSDL.** `token_ref` của EmailVerificationRequested, PasswordResetRequested là token thô; SB-03, SB-26 cấm lưu bản rõ. Outbox sẽ vô tình lưu token thô. | AUTH, NTF | Hai event mang token **không đi outbox**: phát in-process sau commit, best-effort (mất thì khách bấm gửi lại, AUTH đã chấp nhận). Event khác (UserLocked, PasswordChanged) đi outbox. Ghi rõ `token_ref` là token thô chỉ trong bộ nhớ, không log. | V-14, ADR-011 |
| K-15 | **Cột Phụ thuộc sai so với thực tế dùng.** PRM khai PRD nhưng không dùng; NTF khai USR nhưng không gọi (lại cần AUTH `getUserContact`, `listActiveUserIdsByRole`); SHP khai USR nhưng người nhận lấy từ bản chụp của Order; CHK đọc `email_verified`; hầu hết epic cần guard AUTH và `platform` nhưng không khai (check-tech-design báo lỗi nếu khai PRJ). | PRM, NTF, SHP, CHK, tất cả | Chuyển guard và `platform` thành mối quan tâm cắt ngang (A-01), `email_verified` nằm trong session context. Sửa cột Phụ thuộc theo A-03. | A-01, A-03 |
| K-16 | **Audit đọc hay chỉ ghi.** SB-07 liệt kê "dashboard" trong thao tác phải audit; ORD hỏi staff xem đơn người khác; USR tra cứu khách; SHP staff xem người nhận. | DSH, ORD, USR, SHP | Audit **mọi thao tác thay đổi** và **mọi truy cập dữ liệu cá nhân của người khác** (USR tra cứu khách, SHP xem người nhận). Xem dashboard: giữ chữ SB-07 (ghi 1 dòng, gộp theo 1 lần mỗi phút mỗi người). Xem đơn của ORD (staff, admin): không audit (mặc định ORD, vì không lộ dữ liệu cá nhân với staff). | S-03 |

---

## 2. Đề xuất theo file nền

### 2.1 `spec/domain/entities.md`

Entity mới và thuộc tính:

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| E-01 | Thêm quy ước đầu file: mọi entity có `id, created_at, updated_at` (không liệt kê lại từng dòng); `deleted_at` nếu xóa mềm; `version` (số nguyên, khóa lạc quan) cho entity admin sửa: Product, Coupon, ShippingMethod, StockItem, Cart, Payment, Shipment. | tất cả | NÊN |
| E-02 | Thêm entity **AuditLog** (Epic PRJ): `actor_id` (rỗng nếu hệ thống), `actor_role` (kể cả `system`), `action`, `target_type`, `target_id`, `before`, `after`, `reason`, `correlation_id`, `created_at`; vòng đời `-`; chỉ thêm (trigger chặn UPDATE, DELETE), giữ 12 tháng (ADR-008). Sửa dòng 10: "Epic DSH và PRJ không sở hữu entity" thành chỉ DSH. | PRJ, PRD, INV, PRM, REV, DSH, ORD, PAY, AUTH, USR, SHP, CHK | CHẶN |
| E-03 | Thêm **OutboxEvent** (Epic PRJ): `id` (= event_id uuid), `type`, `aggregate_type`, `aggregate_id`, `payload`, `occurred_at`, `dispatched_at`, `attempts`, `next_attempt_at`; và **ProcessedEvent** (`consumer`, `event_id`, `processed_at`, unique cặp đầu). Vòng đời `-`. Điều kiện: duyệt ADR-011. | PRJ + mọi producer/consumer | CHẶN |
| E-04 | Thêm **IdempotencyKey** (Epic PRJ): `scope`, `key`, `user_id`, `request_hash`, `response`, `expires_at` (24 giờ), unique `(scope, user_id, key)`. Điều kiện: ADR-017. INV bỏ `idempotency_key, request_hash, response` khỏi StockMovement. | PRJ, INV, CHK, PAY, REV | NÊN |
| E-05 | **User**: thêm `failed_login_count`, `last_failed_login_at`, `locked_until`, `locked_reason` (`too_many_attempts` hoặc `admin`). **Session**: thêm `last_seen_at`, `absolute_expires_at` (7 ngày), `revoked_at`, `revoked_reason` (`logout, password_changed, admin_lock, replaced`); `expires_at` là hạn trượt 30 phút. Hai Token: thêm `used_at`. `phone`, `avatar_url` do USR đặt qua giao diện nội bộ của AUTH. | AUTH, USR | NÊN |
| E-06 | **Address**: thêm `line1` (số nhà, tên đường, bắt buộc để giao được), `deleted_at`; `district` cho phép rỗng (hoặc bỏ nếu SHP dùng hai cấp). Đơn lưu bản chụp địa chỉ gồm `line1`. | USR, CHK, ORD, SHP | CHẶN |
| E-07 | **Product**: thêm `published_at`, `version`, `rating_count`, `rating_sum` (PRD cập nhật từ event REV); thay `images` bằng entity **ProductImage** (`product_id, storage_key, position` 1..8, `width, height, bytes`); thêm **ProductReviewRating** (`review_id`, `product_id`, `rating`, `counted`); **Category** thêm `depth`. Chưa thêm `slug` cho Product. | PRD, REV | NÊN |
| E-08 | **StockItem**: thêm `low_stock_notified` (cờ cạnh xuống), `archived_at`, `version`. **StockMovement**: thêm `on_hand_after`, `note`, `ref_type`, `ref_id`; `quantity` có dấu; `actor_id` cho phép rỗng; liệt kê `type`: `in, out, adjust, sale, restock, return`. **StockReservation**: `expires_at` cho phép rỗng (COD), unique `(stock_item_id, order_id)`, sửa chú thích "chỉ trừ kho thật khi committed". | INV | NÊN |
| E-09 | **Cart**: bỏ `subtotal, discount, shipping_fee, total` khỏi Thuộc tính (dẫn xuất, tính lại mỗi lần xem); thêm `coupon_code`, `shipping_method_id`, `shipping_city`, `version`, `last_activity_at`, `converted_order_id`; quy tắc một giỏ `active` mỗi người; thêm quan hệ `N-1 ShippingMethod`. **CartItem**: thêm `unavailable_reason`; `unit_price` chỉ để báo giá đổi, không dùng tính tiền. | CRT | NÊN |
| E-10 | **CheckoutSession**: quan hệ `1-1 Cart` thành `N-1 Cart`; `1-1 Order` giữ nhưng `order_id` rỗng tới khi hoàn tất; thêm `coupon_code`, `address_snapshot`, `price_snapshot` (chỉ chẩn đoán), `expires_at`, `last_activity_at`, `completed_at`; `address_id`, `shipping_method_id` cho phép rỗng; ràng buộc: một `open` mỗi người, một `completed` mỗi giỏ. Vòng đời `open -> cancelled`: sửa điều kiện thành "khách rời checkout, hoặc mở phiên cho giỏ khác, hoặc giỏ không còn hiện hành" (giá/kho đổi thì **không** tự hủy, khách xác nhận lại); `open -> expired`: 30 phút không thao tác ghi. | CHK, CRT | CHẶN |
| E-11 | **Coupon**: thêm `status`, `consumed_count`, `reserved_count` (bộ đếm nguyên tử, SB-25), `version`, `deleted_at`, `created_by`; `per_user_limit` (SAU nếu chưa chốt câu 6 của PRM). **CouponRedemption**: thêm `reserved_at, consumed_at, released_at`; `order_id` unique (một đơn một lượt). | PRM | NÊN |
| E-12 | **Order**: thêm `shipping_method_id` (CHK ghi, SHP đọc); `shipping_address` là bản chụp (receiver, phone, line1, ward, city); `tracking_number` (bản sao, cập nhật từ ShipmentTrackingChanged); `cancel_reason` (mã) và `cancelled_by_role`; `confirmed_at`, `paid_at` (bằng `Payment.paid_at`, kể cả COD lúc thu), `delivered_at`; `payment_expires_at` (K-01). Định nghĩa `payment_status` = trạng thái Payment mới nhất. | ORD, CHK, SHP, PAY, REV, DSH | CHẶN |
| E-13 | Thêm **OrderStatusHistory** (Epic ORD): `order_id, from_status, to_status, actor_id, actor_role, reason, created_at`; chỉ thêm. ORD-DB đang ghi Entity `Order` kèm `[OPEN]`. | ORD | NÊN |
| E-14 | **Payment**: thêm `order_code`, `user_id` (bản sao kiểm sở hữu), `expires_at`, `paid_at`, `version`; `provider_ref` = `vnp_TransactionNo` của giao dịch thành công. Thêm entity **PaymentAttempt** (`payment_id, attempt_no, txn_ref, status, reason, gateway_code, provider_txn_no, expires_at, resolved_at`; Payment 1-N) và **PaymentWebhookLog** (chỉ thêm, giữ 12 tháng). **Refund**: thêm `attempt_id`, `reason` (`order_cancelled, order_expired, late_payment, duplicate_payment, admin_manual`), `note`, `requested_by`, `failure_reason`, `auto_attempt_no`, `next_retry_at`, `resolved_at`. | PAY, DSH | NÊN |
| E-15 | **ShippingMethod**: thêm `is_active`, `version`, định nghĩa `rule` (`free_over, surcharge, surcharge_cities`). **Shipment**: thêm `cod_amount, shipped_at, delivered_at, version`; thêm entity **ShipmentStatusHistory** (`event, status, tracking_number, reason_code, note`, chỉ thêm); quy tắc một vận đơn còn hiệu lực mỗi đơn. | SHP | NÊN |
| E-16 | **Notification** chỉ còn kênh trong ứng dụng: thêm `title, link, data, event_id`, `dedupe_key` (unique `user_id, dedupe_key`); vòng đời `unread -> read` chỉ cho `in_app`. Tách entity **EmailDelivery** (`user_id, type, delivery_status` pending/sent/failed/skipped, `delivery_reason, attempts, next_attempt_at, sent_at`). **Không** thêm NotificationRecipientRef (K-08). | NTF | NÊN |
| E-17 | **Review**: thêm `moderation_reason, moderated_by, moderated_at, published_at, edited_at, deleted_at, deleted_by_role`; thay `images` bằng **ReviewImage** (`review_id, user_id, storage_key, position` 1..5, `width, height, bytes, orphaned_at`). | REV | NÊN |

Vòng đời chi tiết (thêm vào bảng chuyển trạng thái):

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| E-18 | **Order**: thêm `shipped -> returned` (nhận ShipmentReturned, trạng thái cuối); `paid -> cancelled` và `confirmed -> cancelled` ghi rõ cả admin; `pending -> cancelled` điều kiện "PaymentFailed `is_final` hoặc khách/admin hủy"; `pending -> confirmed` (COD) điều kiện "CHK gọi ORD.confirmCod trong giao dịch đặt hàng". ShipmentFailed không đổi trạng thái Order (chỉ lịch sử). | ORD, SHP, CHK, PAY | CHẶN |
| E-19 | **Payment**: thêm `processing -> expired`, `failed -> expired`, `processing -> cancelled`, `failed -> cancelled`, `failed -> succeeded` (webhook muộn khi đơn còn `pending`); ghi `failed` không phải trạng thái cuối. Payment đóng nhận thanh toán muộn/trùng: không đổi trạng thái, tạo Refund. **Refund**: thêm `failed -> requested` (tự thử lại tối đa 3 lần hoặc admin thử lại). | PAY, ORD | CHẶN |
| E-20 | **StockReservation**: xác nhận `committed -> released` chỉ trước khi giao; ShipmentReturned không đổi trạng thái (ghi StockMovement `return`). | INV | NÊN |
| E-21 | **Cart**: `active -> abandoned` điều kiện "30 ngày không có thao tác sửa của khách (xem giỏ không tính)"; `active -> converted` do CheckoutCompleted, cả COD. | CRT | NÊN |
| E-22 | **Review**: thêm `pending -> deleted`, `rejected -> deleted`, `hidden -> deleted`, `hidden -> published`; ghi `rejected` là cuối; sửa đánh giá đã đăng giữ `published` (về `pending` chỉ khi bật `REVIEW_PRE_MODERATION`). | REV | NÊN |
| E-23 | **Coupon**: thêm `expired -> deleted`, `exhausted -> deleted`, `disabled -> expired`, `exhausted -> active`; **CouponRedemption**: thêm `consumed -> released` (K-10). | PRM | NÊN |
| E-24 | Xác nhận không đổi (ghi vào cột Điều kiện để khỏi hỏi lại): Product `archived` là cuối (khôi phục để SAU); Shipment không có `failed -> shipped` và `shipped -> cancelled` (giao lại để SAU, kèm sdlc-impact trên ORD, INV). | PRD, SHP | SAU |

### 2.2 `spec/domain/events.md`

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| V-01 | Thêm đoạn **phong bì chung** đầu file: mọi event có `event_id` (uuid), `occurred_at`, `correlation_id`; consumer chống trùng theo `event_id`. Quy tắc định danh: event liên quan đơn mang `order_id`, `order_code`, `user_id` (thêm vào OrderConfirmed, OrderCancelled, OrderShipped, OrderDelivered, PaymentSucceeded, PaymentFailed, ShipmentFailed, RefundSucceeded, RefundFailed). | NTF, PAY, ORD, SHP, AUTH | CHẶN |
| V-02 | **OrderCreated**: thêm `order_code`, `payment_method`, `payment_expires_at` (rỗng nếu COD); bỏ INV và DSH khỏi Consumers (INV giữ hàng bằng `reserve` trực tiếp). | ORD, PAY, NTF, CHK, INV, DSH | CHẶN |
| V-03 | **StockReserved, StockReleased, StockCommitted, StockReservationExpired**: bỏ `reservation_id` (dùng `order_id`); StockReserved và StockReleased bỏ CHK khỏi Consumers (chỉ ghi log) nên Consumers `-`; StockCommitted bỏ DSH nên `-`. | INV, CHK, DSH | CHẶN |
| V-04 | Thêm event **StockCommitFailed** (Producer INV; Consumers PAY, ORD; `order_id`, `reason`; Phát khi `-`). Khi PaymentSucceeded đến mà reservation không còn `held` (K-02): PAY hoàn tiền, ORD no-op. | INV, PAY, ORD | CHẶN |
| V-05 | **PaymentFailed**: thêm `is_final`. **PaymentSucceeded**: thêm `method`, `paid_at`. **RefundSucceeded/RefundFailed**: thêm `order_id`, `amount`; RefundFailed bỏ DSH (admin nhận cảnh báo qua NTF). Giữ PaymentRefunded không thêm `amount` (chỉ cần khi DSH chuyển sang read model, SAU). | PAY, ORD, NTF, DSH | CHẶN |
| V-06 | Chuẩn hóa `reason` thành mã cố định, ghi trong cột Payload: UserLocked (`too_many_attempts, admin`); ShipmentFailed (`customer_unreachable, refused, wrong_address, damaged, other`); OrderCancelled (`customer_request, admin, payment_failed`); Refund (xem E-14); StockReleased (`order_cancelled, order_expired`). | AUTH, SHP, ORD, PAY, INV, NTF | NÊN |
| V-07 | **LowStockDetected**: thêm `available`, `product_name`; Phát khi ghi rõ (cột là `-` nhưng mô tả điều kiện: `available` hạ xuống bằng hoặc dưới ngưỡng, theo cờ `low_stock_notified`, chỉ phát lúc đi xuống); Consumers NTF (bỏ DSH). | INV, NTF, DSH | NÊN |
| V-08 | **ShipmentReturned**: thêm `restockable` (bool). INV lấy dòng hàng từ chính StockReservation của `order_id`, nên không cần danh sách hàng trong payload. | SHP, INV | NÊN |
| V-09 | Thêm event **ShipmentTrackingChanged** (Producer SHP; Consumers ORD; `shipment_id, order_id, tracking_number`; Phát khi `-`); ORD cập nhật bản sao `tracking_number`. | SHP, ORD | NÊN |
| V-10 | Thêm PAY vào Consumers của **OrderDelivered** (COD thu tiền tự động, `pending -> succeeded`); không thêm vào ShipmentDelivered. Nếu staff còn nút ghi nhận thu COD thì đó chỉ là đường dự phòng, dùng cùng chuyển trạng thái. | PAY, SHP | NÊN |
| V-11 | **CheckoutExpired**: bỏ `order_id`, thêm `user_id`, `cart_id`; Consumers `-` (ADR-009: phiên hết hạn chưa có Order). **CheckoutCompleted**: ghi rõ phát cho cả `vnpay` và COD, mang `cart_id`, `order_id`. | CHK, INV, PRM, CRT | NÊN |
| V-12 | Review: thêm **ReviewDeleted** (REV; PRD; `review_id, product_id, rating`; Phát khi `Review:deleted`) và **ReviewRatingChanged** (REV; PRD; `review_id, product_id, old_rating, new_rating`; `-`); **ReviewHidden** thêm `rating`; ghi ReviewPublished cũng phát khi `hidden -> published`. | REV, PRD | NÊN |
| V-13 | Bỏ consumer thừa còn lại: NTF khỏi OrderPaid; REV khỏi OrderDelivered (REV hỏi `ORD` trực tiếp); DSH khỏi CouponRedeemed. Ghi quy tắc đầu file: "consumer chỉ khai khi có handler". | NTF, REV, DSH | NÊN |
| V-14 | Ghi chú cho EmailVerificationRequested, PasswordResetRequested: `token_ref` là token thô, chỉ đi trong bộ nhớ, **không** qua outbox, không log (K-14). | AUTH, NTF | CHẶN |
| V-15 | Thêm PRM vào Consumers của **OrderConfirmed** (tiêu thụ coupon đơn COD, K-10); `CouponRedeemed` phát khi `consumed` ở OrderConfirmed hoặc PaymentSucceeded. | PRM, ORD | NÊN |
| V-16 | Ghi nhận, chưa làm v1: UserRoleChanged, UserUnlocked (AUTH, NTF nếu cần), CartAbandoned (CRT), ProductPriceChanged (PRD, CRT), ShipmentCancelled, CouponReleased; nếu DSH chuyển sang read model: thêm DSH vào PaymentSucceeded, PaymentRefunded (+`amount`), OrderPaid, OrderCancelled, OrderExpired. | AUTH, CRT, PRD, SHP, PRM, DSH | SAU |

### 2.3 `spec/architecture.md` (ngoài ADR mới, xem mục 3)

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| A-01 | Thêm vào "Mối quan tâm cắt ngang" dòng **Nền tảng dùng chung (platform, PRJ)**: guard phiên và role, `email_verified` trong session context, audit, giới hạn tần suất, CSRF/CORS, `problem+json`, giao dịch, job nền, outbox, kho object, log che dữ liệu. Module không cần khai PRJ hay AUTH ở cột Phụ thuộc cho phần này; guard là interface ở platform, AUTH cung cấp triển khai (đảo phụ thuộc, ADR-012). | AUTH, PRJ, PRD, INV, CRT, PRM, SHP, USR, NTF, REV, DSH, PAY, CHK | CHẶN |
| A-02 | Thêm bảng **Giao diện module (gọi đồng bộ)**, chiều gọi phải khớp cột Phụ thuộc; tên là chỉ định, chữ ký chốt ở tech-design (bảng bên dưới). | CHK, CRT, PRM, INV, SHP, ORD, PAY, NTF, DSH, REV, USR | CHẶN |
| A-03 | Sửa cột Phụ thuộc: PRM bỏ PRD (giữ nếu sau này coupon theo sản phẩm); NTF bỏ USR, giữ AUTH (`getUserContact`, `listActiveUserIdsByRole`); SHP bỏ USR nếu người nhận lấy từ bản chụp Order; DSH ghi đường "số khách": `USR.countCustomers` gọi AUTH (giữ nguyên bảng). | PRM, NTF, SHP, DSH | NÊN |
| A-04 | Ghi chiều gọi ngược chiều event là hợp lệ vì có phụ thuộc: PAY gọi ORD, SHP gọi ORD (giao diện đọc đơn); ORD không gọi PAY, SHP. | PAY, SHP, ORD | NÊN |
| A-05 | Bổ sung ADR-005 (điều khoản vận hành: đường dẫn thanh toán 10 phút, 3 lượt thử, tự thử lại hoàn tiền 3 lần, đối soát bằng API truy vấn của cổng, hoàn tiền tự động theo trạng thái Payment); ADR-006 (IPN là ngoại lệ `problem+json`, trả JSON `RspCode`); ADR-008 (nhật ký webhook giữ 12 tháng). | PAY | NÊN |
| A-06 | Làm rõ ADR-009 qua sdlc-impact (không đổi quyết định): hạn 15 phút do INV chạy; Order có `payment_expires_at` chỉ đọc; hạn PAY nhỏ hơn hoặc bằng hạn đó (K-01). Nếu người muốn đủ 3 lượt thử trong hạn dài hơn thì đổi ADR-009 và ADR-004 (ca `reservation-ttl`). | INV, PAY, ORD, CHK | NÊN |
| A-07 | Ghi chú cho roadmap (không sửa file): "Reserve stock" đứng trước "Create order" nhưng theo ADR-009 thực tế là tạo Order rồi giữ hàng; "Validate price/stock", "Reserve stock" là bước trong giao dịch đặt hàng, không phải màn hay endpoint riêng. | CHK | SAU |

Bảng giao diện module đề xuất cho A-02 (chiều: bên gọi đến bên được gọi; `tx` = nhận kết nối giao dịch của bên gọi):

| Gọi | Đến | Phương thức (chỉ định) | tx |
| --- | --- | --- | --- |
| CHK | CRT | `snapshotForCheckout`, `lockForCheckout` | có |
| CHK | USR | `listAddresses`, `getAddress` | không |
| CHK | PRM | `evaluate`, `reserve` | có |
| CHK | INV | `reserve` | có |
| CHK | SHP | `listActiveMethods`, `quote` | không |
| CHK | ORD | `createPending`, `confirmCod`, `countOpenOrders`, `getSummary` | có |
| CRT | PRD, INV, PRM, SHP | `getForCart`, `getAvailability`, `evaluate`, `quote` (đọc theo lô) | không |
| PAY | ORD | `findForPayment` (đọc) | không |
| SHP | ORD | `findForShipment`, `findByCode`, `findOwned`, `getRecipient` | không |
| REV | ORD | `getDeliveredItems` (đọc) | không |
| NTF | AUTH | `getUserContact`, `listActiveUserIdsByRole` | không |
| USR | AUTH | `updateProfile` (phone, avatar_url) | không |
| DSH | ORD, PAY, PRD, INV, USR | phương thức tổng hợp chỉ đọc (ADR-020) | không |
| Web | INV | `GET /inventory/availability` công khai (K-12) | - |

### 2.4 `spec/security-baseline.md`

Sửa SB hiện có và SB mới:

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| S-01 | **SB-14** mở rộng thành giới hạn tần suất cho mọi endpoint, theo bậc (bảng sau mục này); kèm "chỉ tin `X-Forwarded-For` từ proxy đã cấu hình". Epic liên quan chuyển thành `*`. Kiểm bằng test. | AUTH, USR, PRM, CRT, CHK, PRD, ORD, SHP, REV, INV, DSH, PAY, NTF | CHẶN |
| S-02 | SB mới **phát event bền và consumer idempotent**: event ghi cùng giao dịch với thay đổi trạng thái (ADR-011), consumer chống trùng theo `event_id`; kiểm bằng test (giết tiến trình giữa commit và phát). | ORD, SHP, PAY, INV, PRD, REV, AUTH, NTF, CHK, CRT, PRM, PRJ | CHẶN |
| S-03 | **SB-19** mở rộng: liệt kê thao tác audit (đăng nhập, đổi mật khẩu, đổi role, mở/khóa tài khoản, thao tác admin, hủy/hoàn tiền kể cả tự động, thu COD, thao tác kho, kiểm duyệt đánh giá, cấu hình vận chuyển/coupon/sản phẩm, tra cứu hồ sơ khách, xem dashboard theo K-16); bất biến chỉ thêm, giữ 12 tháng, ghi cùng giao dịch; Epic liên quan thêm PRJ, PRD, PRM, REV, USR, SHP, DSH, CHK. **SB-07**: ghi "thao tác kho" gồm nhập, xuất, điều chỉnh, đổi ngưỡng; thêm SHP, USR vào Epic liên quan. | PRJ, PRD, PRM, REV, USR, SHP, DSH, CHK, INV, PAY, ORD | CHẶN |
| S-04 | **SB-08** viết lại thành ba ngoại lệ staff: (a) tra cứu khách: email, điện thoại bản che, không địa chỉ, có audit (USR); (b) bàn giao: người nhận, điện thoại, địa chỉ đầy đủ chỉ khi Shipment `pending/shipped/failed` (SHP); (c) màn đơn (ORD): staff không thấy trường cá nhân. Ngoài ra: log, nội dung thông báo, dashboard không chứa dữ liệu cá nhân; tên hiển thị đã che được phép công khai (REV). Epic liên quan thêm SHP, DSH, NTF, REV, PAY. | USR, SHP, ORD, DSH, NTF, REV | CHẶN |
| S-05 | **SB-24**: admin hủy đơn paid cũng hoàn tiền tự động; hoàn do thanh toán muộn/trùng là tự động của hệ thống, có audit. **SB-22**: thêm lớp danh sách IP của cổng (cấu hình, mặc định tắt) và so số tiền webhook với số đơn. | PAY, ORD | NÊN |
| S-06 | Xác thực: **SB-02** mở rộng sang đăng ký và quên mật khẩu (phản hồi không lộ email tồn tại); **SB-04** nêu rõ hạn tuyệt đối 7 ngày, hạn trượt chỉ ghi mỗi phút, đăng nhập tạo phiên mới (chống session fixation); **SB-03, SB-26**: token chỉ có trong liên kết gửi đi, không lưu, không log; email giao dịch chỉ gửi tới địa chỉ đã xác minh (ngoại lệ: chính email xác minh). Thêm NTF vào Epic liên quan. | AUTH, NTF, CHK | NÊN |
| S-07 | SB mới (AUTH): token trong URL đặt ở fragment, không vào log/Referer; `next` chỉ nhận đường dẫn tương đối nội bộ (chống open redirect); luôn còn ít nhất một admin; đổi role/khóa admin cuối bị chặn. | AUTH, USR | NÊN |
| S-08 | **SB-10** mở rộng: thêm ảnh sản phẩm; giới hạn điểm ảnh (chặn bom giải nén), re-encode, bỏ EXIF, khóa tệp ngẫu nhiên; Epic liên quan thêm PRD (USR, REV đã có). Chi tiết số ở ADR-018. | PRD, USR, REV | NÊN |
| S-09 | SB mới **khóa lạc quan**: sửa entity cấu hình có `version`, ghi đè lệch thì trả 409. | PRD, PRM, SHP, INV, CRT | NÊN |
| S-10 | SB mới **giao dịch ngắn**: không giữ giao dịch hoặc khóa khi gọi hệ thống ngoài; hạn câu lệnh, giới hạn pool; thứ tự khóa cố định (ADR-012). | CHK, PAY, PRJ, INV | NÊN |
| S-11 | SB mới **bảng lịch sử chỉ thêm**: StockMovement, OrderStatusHistory, ShipmentStatusHistory, PaymentWebhookLog, AuditLog có trigger chặn UPDATE, DELETE. **SB-25** thêm bất biến `0 <= reserved <= on_hand` kiểm bằng CHECK ở CSDL. | INV, ORD, SHP, PAY, PRJ | NÊN |
| S-12 | SB mới **giới hạn tài nguyên mỗi người**: số địa chỉ (đếm rồi chèn nguyên tử, luôn đúng một địa chỉ mặc định), số đơn đang mở (chống chiếm hàng bằng đơn ảo), số lượt coupon mỗi người. | USR, CHK, INV, PRM | NÊN |
| S-13 | SB mới **tác vụ nền**: hạn gọi và giới hạn thử lại; nội dung thông báo và email chỉ từ mẫu cố định; hạn mức email theo người nhận. | NTF, PAY, PRJ | NÊN |
| S-14 | SB mới **ranh giới module**: module không đọc bảng của module khác; kiểm bằng script CI (lint ranh giới, kiểm lệch migration). **SB-23** thêm DSH: số tiền ở báo cáo chỉ lấy từ PAY. | PRJ, DSH | NÊN |
| S-15 | SB mới: chỉ khách có đơn `delivered` (trong cửa sổ quy định) mới tạo đánh giá, kiểm lại ở server mỗi lần tạo. | REV | NÊN |
| S-16 | SB mới: không lộ số tồn kho chính xác cho khách (chỉ "còn/hết", hoặc số khi thiếu và nhỏ hơn 99); thao tác sửa giỏ nguyên tử (unique một phần cho giỏ `active`, khóa dòng, cộng số lượng có điều kiện), cùng họ SB-25. | CRT, PRD, INV | NÊN |
| S-17 | Cập nhật cột "Epic liên quan" (không cần SB mới): SB-06 thêm SHP; SB-12 thêm NTF, SHP; SB-13 thêm NTF (POST đánh dấu đã đọc); SB-15, SB-18 thêm NTF; SB-11, SB-05, SB-13 đang `*`, giữ. | SHP, NTF | NÊN |
| S-18 | SB mới (SAU): dữ liệu cá nhân đã xóa mềm phải bị xóa cứng sau 30 ngày (ADR-022). | USR | SAU |

Bảng bậc cho S-01 (số là mặc định epic đề xuất; bậc A theo tài khoản và IP, còn lại theo người dùng hoặc IP):

| Bậc | Endpoint | Giá trị mặc định |
| --- | --- | --- |
| A Xác thực và dò | đăng nhập, đăng ký, gửi lại/xác minh email, quên/đặt lại mật khẩu | số do AUTH chốt (khóa tạm theo SB-02) |
| A | mã giảm giá (PRM, CRT, CHK) | 10 lần sai mỗi 10 phút mỗi người; CRT 10 lần gọi mỗi phút |
| A | đổi mật khẩu | 5 lần sai mỗi 15 phút, 10 lần mỗi giờ |
| B Ghi của khách | tạo phiên checkout, đặt hàng | 10 mỗi phút, 5 mỗi phút |
| B | tạo, sửa đánh giá, tải ảnh review, tải avatar | 10, 30, 20 mỗi giờ; avatar 10 mỗi giờ |
| C Đọc công khai tốn tài nguyên | duyệt, tìm sản phẩm, tra cứu đơn theo mã, báo phí, danh sách đánh giá | 120 mỗi phút mỗi IP; trần kích thước trang/lô |
| D Quản trị, tổng hợp | danh sách tồn, lịch sử kho, dashboard, tra cứu khách | 30 mỗi phút mỗi người |
| E Hệ thống | IPN cổng thanh toán; thanh toán, hoàn tiền; email theo người nhận | chữ ký bắt buộc, danh sách IP tùy chọn; hạn mức do PAY, NTF chốt |

### 2.5 `spec/domain/roles.md`

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| R-01 | Thêm role `system` (cổng thanh toán gọi webhook, job nền, handler event, CI): không đăng nhập; được dùng trong `roles:` của requirement và ma trận quyền. Hiện PRJ phải dùng `admin` giữ chỗ. (Kit tương ứng: KT-02.) | PRJ, PAY, INV, NTF, DSH, SHP | CHẶN |
| R-02 | **staff**: liệt kê rõ (xem đơn; bàn giao và cập nhật kết quả giao ở SHP; nhập, xuất, điều chỉnh, đổi ngưỡng tồn; ghi nhận thu COD và xem thanh toán, hoàn tiền nhưng không hoàn tiền; tra cứu khách bản che theo email chính xác; xem sản phẩm ở trang quản trị chỉ đọc; nhận cảnh báo tồn thấp). Không: hủy đơn, cấu hình phương thức và phí vận chuyển, coupon, doanh thu, tổng số khách hay số đơn tổng hợp, kiểm duyệt đánh giá, sổ địa chỉ. | ORD, SHP, INV, PAY, USR, PRD, NTF, DSH, REV | NÊN |
| R-03 | **admin**: kiểm duyệt đánh giá gồm duyệt, từ chối, ẩn, xóa (không sửa nội dung); xem khách đầy đủ kèm địa chỉ; nhận cảnh báo hoàn tiền thất bại; thêm cách **tạo admin đầu tiên** (lệnh seed dùng biến môi trường, không có đường đăng ký admin qua API) và bảo vệ admin cuối (S-07). | REV, USR, NTF, AUTH | NÊN |
| R-04 | **customer**: giỏ và checkout (chưa xác minh email vẫn dùng giỏ, phải xác minh mới đặt hàng, SB-26); đánh giá chỉ với sản phẩm đã nhận hàng. guest, staff, admin không có giỏ và không đặt hộ ở v1 (một tài khoản một role, chưa có giỏ khách vãng lai). | CRT, CHK, REV | NÊN |

### 2.6 `spec/constitution.md` và `spec/roadmap.md`

| Mã | Thay đổi cụ thể | Epic | Ưu |
| --- | --- | --- | --- |
| C-01 | **P7** bổ sung: phụ thuộc cắt ngang của `platform` không cần khai; bảng giao diện module (A-02) là hợp đồng; event khai Consumer phải có handler. | tất cả | NÊN |
| C-02 | Thêm **P8**: epic không được `approved` khi còn `[OPEN]` trỏ vào nền chưa sửa (kiểm bằng script). Lý do: 14 epic cùng ghi `[OPEN]` giống nhau mà không có cổng chặn. | tất cả | NÊN |

`roadmap.md`: không sửa (xem A-07 chỉ để ghi chú).

---

## 3. ADR mới cần quyết

Quy ước: câu hỏi, phương án, khuyến nghị theo ADR-001 (modular monolith, in-process bus, một CSDL), ADR-003 (PostgreSQL), ADR-004 (session và cookie), ADR-007 (cấu hình qua env). Tránh thêm Redis ở v1.

### ADR-011 Phát event bền (outbox) và phong bì event (CHẶN)
- Câu hỏi: bus in-process (ADR-001) mất event nếu tiến trình chết giữa commit và phát: đơn paid hủy mà không hoàn tiền, đơn `pending` không bao giờ `expired`, giỏ không `converted`, điểm đánh giá lệch. Nêu bởi 13 trong 14 epic.
- Phương án: A outbox (ghi OutboxEvent cùng giao dịch, job chuyển phát, at-least-once, consumer chống trùng bằng ProcessedEvent); B phát đồng bộ trong giao dịch (handler chạy chung giao dịch, consumer lỗi làm hỏng producer); C giữ nguyên và đối soát từng cặp bằng job.
- Khuyến nghị: **A**. Thứ tự theo `aggregate_id`; giữ 14 ngày sau khi phát; relay là một job của ADR-013; phong bì V-01. Ngoại lệ: hai event mang token thô (K-14) phát in-process sau commit, best-effort.
- Epic: PRJ và mọi producer/consumer.

### ADR-012 Giao diện module, truyền giao dịch, guard platform (CHẶN)
- Câu hỏi: CHK gọi 6 module trong một giao dịch đặt hàng; truyền kết nối giao dịch thế nào, thứ tự khóa, guard AUTH sống ở đâu.
- Phương án: A service công khai của module nhận `tx` (Prisma transaction client) làm tham số; B mỗi module tự mở giao dịch rồi bù trừ (saga); C giao dịch ngầm qua ngữ cảnh bất đồng bộ (CLS).
- Khuyến nghị: **A** (khớp ADR-001, ADR-003). Thứ tự khóa cố định: CheckoutSession, Cart, Order, StockItem theo id tăng dần, Coupon. Không gọi hệ thống ngoài trong giao dịch. Guard là interface `SessionContext {user_id, role, email_verified}` ở platform, AUTH triển khai. Bảng A-02 là hợp đồng.
- Epic: CHK, CRT, PRM, INV, SHP, ORD, PAY, PRJ, AUTH.

### ADR-013 Job nền chung (CHẶN)
- Câu hỏi: INV mỗi phút và đối soát đêm, CHK hết hạn phiên mỗi 5 phút, CRT mỗi giờ, PRM hết hạn, PAY thử lại và đối soát, NTF gửi email, dọn ảnh mồ côi, relay outbox: lập lịch và chạy một bản duy nhất thế nào khi nhiều instance.
- Phương án: A bộ lập lịch trong ứng dụng (`@nestjs/schedule`) cộng khóa `pg_try_advisory_lock` hoặc `FOR UPDATE SKIP LOCKED` theo lô; B hàng đợi trên PostgreSQL (pg-boss); C cron của host gọi endpoint nội bộ; D BullMQ cộng Redis.
- Khuyến nghị: **A** (không thêm hạ tầng). Mỗi job idempotent, có hạn thời gian và giới hạn thử lại (S-13); ADR ghi bảng job (tên, chu kỳ, module). Lên B khi cần hàng đợi email lớn.
- Epic: INV, CHK, CRT, PRM, PAY, NTF, PRJ, USR, REV.

### ADR-021 Audit log: entity và cách ghi (CHẶN)
- Câu hỏi: SB-19, ADR-008 nói lưu CSDL 12 tháng nhưng không entity nào sở hữu; module ghi bằng đường nào.
- Phương án: A `AuditService.record()` của platform gọi đồng bộ trong giao dịch của thao tác; B phát event rồi ghi (qua outbox, có thể trễ).
- Khuyến nghị: **A** (audit không được mất, SB-19). Entity AuditLog (E-02), chỉ thêm, chỉ admin đọc. Phạm vi audit theo K-16, S-03.
- Epic: PRJ và 11 epic ghi audit.

### ADR-014 Kho đếm giới hạn tần suất (NÊN)
- Câu hỏi: nhiều instance thì đếm ở đâu.
- Phương án: A Redis; B bảng PostgreSQL (cửa sổ cố định, UNLOGGED); C bộ nhớ từng instance.
- Khuyến nghị: **B cho bậc A và B** (chính xác, khóa tài khoản đã ở CSDL), **C cho bậc C** (đọc công khai, xấp xỉ chấp nhận được). Ghi `ponytail`: đổi sang Redis khi quá vài instance hoặc khi DB bị ảnh hưởng. `X-Forwarded-For` chỉ tin proxy cấu hình qua env.
- Epic: PRJ, AUTH và mọi endpoint.

### ADR-015 Băm mật khẩu (NÊN)
- Câu hỏi: thuật toán và tham số cho SB-01 (hiện chỉ nói "chuyên dụng").
- Phương án: A argon2id; B bcrypt cost 12; C scrypt.
- Khuyến nghị: **A** (m=19 MiB, t=2, p=1 theo OWASP, tham số trong cấu hình), tự băm lại khi tham số đổi; không pepper ở v1. Token đặt lại, xác minh, phiên: SHA-256 (token ngẫu nhiên 256 bit, không cần chậm).
- Epic: AUTH, USR.

### ADR-016 Chống CSRF (NÊN)
- Câu hỏi: SB-13 yêu cầu chống CSRF nhưng chưa chọn cơ chế.
- Phương án: A kiểm `Origin`/`Referer` theo danh sách cho phép, cộng SameSite=Lax (ADR-004), chỉ nhận `application/json`; B token đồng bộ (double-submit).
- Khuyến nghị: **A**; web (Next.js, ADR-002) và API phải cùng site để Lax có tác dụng. B nếu khác site. IPN của cổng là ngoại lệ (chữ ký).
- Epic: PRJ, AUTH, NTF và mọi POST.

### ADR-017 Idempotency-Key (NÊN)
- Câu hỏi: thao tác ghi quan trọng bị gửi lại (đặt hàng, tạo thanh toán, hoàn tiền, nhập, xuất, điều chỉnh kho, tạo đánh giá).
- Phương án: A bảng chung ở platform (E-04, giữ 24 giờ, so `request_hash`); B mỗi module tự (INV đề xuất cột trong StockMovement); C chỉ dựa vào ràng buộc duy nhất.
- Khuyến nghị: **A** cho endpoint HTTP của khách và admin; luồng hệ thống (event, job) dùng ràng buộc duy nhất. Header `Idempotency-Key` bắt buộc ở danh sách endpoint của ADR.
- Epic: INV, CHK, PAY, REV, PRJ.

### ADR-018 Bổ sung ADR-010: ảnh và truy cập (NÊN)
- Câu hỏi: ADR-010 chỉ nêu avatar và ảnh review; thiếu ảnh sản phẩm, kích thước điểm ảnh, chính sách truy cập, dọn mồ côi.
- Phương án: truy cập A công khai theo khóa ngẫu nhiên qua CDN, B URL ký hạn ngắn.
- Khuyến nghị: bổ sung ảnh sản phẩm (tối đa 5 MB, tối đa 8 ảnh); giới hạn đầu vào 25 megapixel; cạnh dài sau xử lý 1600 px (avatar 512 px); bỏ EXIF; khóa ngẫu nhiên; truy cập **A** (nội dung vốn công khai); job dọn ảnh chưa gắn quá 24 giờ và ảnh của đánh giá đã xóa; `REVIEW_PRE_MODERATION` vào danh sách cấu hình ADR-007.
- Epic: PRD, USR, REV.

### ADR-019 Tìm kiếm sản phẩm (NÊN)
- Phương án: A PostgreSQL (`pg_trgm`, `unaccent`); B Meilisearch hoặc OpenSearch.
- Khuyến nghị: **A** (ADR-003), xem lại khi số sản phẩm lớn. Epic: PRD.

### ADR-020 Giao diện đọc cho tổng hợp và cache (NÊN)
- Câu hỏi: DSH tổng hợp từ 5 module mà không đọc bảng chéo (P7).
- Phương án: A phương thức đọc của module chủ (một truy vấn, nhận khoảng UTC, trả số nguyên VND, không trả trường cá nhân); B read model theo event; C đọc bảng trực tiếp (cấm).
- Khuyến nghị: **A** cộng cache bộ nhớ 60 giây; B chỉ khi chậm. Số tiền chỉ lấy từ PAY (S-14).
- Epic: DSH, ORD, PAY, PRD, INV, USR.

### ADR-022 Thời hạn lưu dữ liệu (NÊN)
- Câu hỏi: nhiều epic cần hạn lưu nhưng không có bảng chung.
- Khuyến nghị: bảng trong ADR: audit 12 tháng (ADR-008), webhook log 12 tháng, outbox đã phát 14 ngày, idempotency 24 giờ, địa chỉ xóa mềm 30 ngày rồi xóa cứng, các hạn còn lại do epic chốt. Job dọn theo ADR-013.
- Epic: USR, PAY, PRJ.

### ADR-023 Định danh `type` của lỗi (NÊN)
- Phương án: A URN `urn:ecom:error:<code>` (không cần tên miền); B URL. Khuyến nghị: **A**; ghi IPN là ngoại lệ (cổng đòi `RspCode`). Epic: PRJ, ORD, PAY.

### ADR-024 Email bounce, complaint của SES (SAU, bắt buộc trước go-live)
- Phương án: A webhook SNS có xác thực chữ ký cộng danh sách chặn địa chỉ; B bỏ qua. Khuyến nghị: **A** trước khi chạy thật (giữ danh tiếng gửi). Epic: NTF.

### ADR-025 Triển khai migration (SAU)
- Bổ sung ADR-003: migrate lúc deploy không lúc khởi động; thay đổi tương thích ngược một phiên bản; CI kiểm lệch. Epic: PRJ.

### ADR-026 Tích hợp hãng vận chuyển (SAU)
- v1 nhập tay (không ADR). Chỉ làm khi cần theo dõi tự động (GHN, GHTK). Epic: SHP.

---

## 4. Thiếu sót của chính kit (bài học cho retro)

Chưa sửa; chuyển sang `sdlc-retro` rồi `sdlc-improve-kit`. L1..L7 từ bài học ORD đã có, ở đây chỉ nêu bằng chứng mới và điểm thêm.

| Mã | Thiếu sót | Bằng chứng | Nơi sửa đề nghị |
| --- | --- | --- | --- |
| KT-01 | `check-spec` chặn `links` tới ID chưa có; cần trường `depends_epics` (L2). | CHK, PAY, SHP, CRT, INV không khai được liên kết sang epic khác. | `sdlc-research/scripts/check-spec.mjs` |
| KT-02 | Tác nhân hệ thống (cổng thanh toán, job, handler) không phải role nên không có chỗ trong `roles:`; PRJ dùng `admin` giữ chỗ. | PRJ, PAY, INV, NTF, DSH đều đề nghị. | `roles.md` (R-01) và `check-spec` chấp nhận `system` |
| KT-03 | `check-tech-design` thiếu `proposed_entities` (L1), và tương tự cho event, chuyển trạng thái, ADR đề xuất; hiện phải khai entity giả kèm `[OPEN]`. | PAY, SHP, REV, PRD, PRJ, NTF, INV. | `check-tech-design.mjs` |
| KT-04 | `check-tech-design` coi `depends_on: [PRJ]` là lỗi vì PRJ không có trong cột Phụ thuộc; guard AUTH cũng không khai được. | PRJ, PRD, SHP, NTF, INV. | `check-tech-design.mjs` (nhận `platform` ngầm, sau A-01) |
| KT-05 | `check-ui` không buộc trạng thái màn hình có testid (hết phiên, không có quyền, khách chưa đăng nhập) nên E2E không kiểm được (L3). | ORD ui, và mọi màn có trạng thái guest. | `check-ui.mjs` |
| KT-06 | **Không có cổng "nền" trước khi chạy song song.** Bài học L8 của ORD đã nói nền thiếu, nhưng 13 epic khác chạy tiếp và mỗi epic tự khám phá lại cùng lỗ hổng: outbox (13 epic), guard và `platform` (khoảng 12), AuditLog (khoảng 9), job nền (6), `[OPEN]` nền giống nhau. | mục 1, 3 của tài liệu này. | `sdlc-research/SKILL.md`: sau epic thử đầu, nếu retro có loại `spec` thì dừng epic khác tới khi sdlc-foundation sửa; thêm P8 (C-02) |
| KT-07 | `sdlc-foundation` dựng nền quá mỏng: entity thiếu thuộc tính vòng đời, thời gian, `version`; event payload chỉ có id; Consumers khai không có handler; thiếu bảng giao diện module; không có ADR cho các mối quan tâm cắt ngang mặc định. | mục 2.1, 2.2, 2.3. | `sdlc-foundation/SKILL.md`: checklist ADR chuẩn (outbox, job, rate limit, băm mật khẩu, CSRF, idempotency, storage, audit, tìm kiếm, tổng hợp, retention); kiểm "consumer có handler" và "payload đủ danh tính" |
| KT-08 | File dùng chung bị nhiều tác nhân ghi song song (`permissions-matrix.md`, `testids.md`) nên epic phải để hàng ở `/tmp/ecom/<EPIC>-matrix-rows.md` rồi gộp tay. | CHK, CRT. | Kit: mỗi epic một mảnh ma trận và testid, script gộp |
| KT-09 | Mục "Nền cần sửa" của mỗi epic là văn xuôi tự do, phải trích tay và khử trùng lặp. | `/tmp/ecom/foundation-raw.md`. | `questions.md` dùng dòng có cấu trúc `file \| thay đổi \| ưu tiên \| epic`; script gom tự động thành tài liệu như file này |
| KT-10 | Bảng DB ép cột Entity tồn tại; quy ước `[OPEN]` chỉ ở văn bản nên không script nào đếm được số `[OPEN]` nền còn lại. | `[OPEN]` ở ORD-API, ORD-DB, ORD-SEC chỉ là chữ trong văn bản. | `check-spec`, `check-tech-design`: đếm `[OPEN]` và báo ở đầu ra (phục vụ P8) |
| KT-11 | L4 đến L7 (ghi chú wireframe ASCII, requirement thắng luật evon, thông báo hook, cảnh báo requirement `draft`) chưa áp. | `spec/lessons/2026-10-06-ORD.md`. | Giữ nguyên theo bài học ORD |

---

## 5. Thứ tự áp dụng đề nghị

1. Người quyết các điểm trong mục 6, trả lời theo mã.
2. Chạy `sdlc-impact` cho từng đề xuất CHẶN, rồi `sdlc-foundation` sửa nền theo thứ tự: ADR-011, 012, 013, 021 (và A-01, A-02) trước; sau đó entities (E-02, E-03, E-06, E-10, E-12, E-18, E-19), events (V-01 đến V-05, V-14), SB-08/14/19, role `system`.
3. Sau khi nền `approved` lại: rà từng epic để đưa các mục NÊN vào, bỏ `[OPEN]` đã giải quyết.
4. Mục SAU ghi vào backlog, không chặn duyệt.

## 6. Quyết định cần người (theo thứ tự quan trọng)

1. **ADR-011 (outbox)** và cách xử lý event mang token thô (K-14): quyết A, cùng ngoại lệ best-effort cho hai event token.
2. **ADR-012 và A-01, A-02**: guard là interface ở platform; truyền `tx` giữa module trong giao dịch đặt hàng; thứ tự khóa; bảng giao diện module.
3. **Vòng đời Order/Payment/Reservation và đồng hồ** (K-01 đến K-05): giữ 15 phút, Order `returned`, COD xác nhận bằng lời gọi trực tiếp, StockCommitFailed, quy tắc "một giao dịch thắng".
4. **Audit và dữ liệu cá nhân** (E-02, K-13, K-16): AuditLog thuộc PRJ ghi đồng bộ; xem dashboard có audit hay không; ba ngoại lệ staff của SB-08.
5. **Hạ tầng không thêm Redis**: job nền trong ứng dụng cộng advisory lock (ADR-013); kho rate limit PostgreSQL cộng bộ nhớ (ADR-014).
6. Phụ: thời điểm tiêu thụ coupon COD (K-10), mô hình thông báo `EmailDelivery` (E-16), băm mật khẩu argon2id (ADR-015), CSRF bằng Origin (ADR-016).

## 7. Số liệu

| Nhóm | CHẶN | NÊN | SAU | Tổng |
| --- | --- | --- | --- | --- |
| entities.md (E) | 7 | 16 | 1 | 24 |
| events.md (V) | 6 | 9 | 1 | 16 |
| architecture.md không ADR (A) | 2 | 4 | 1 | 7 |
| security-baseline.md (S) | 4 | 13 | 1 | 18 |
| roles.md (R) | 1 | 3 | 0 | 4 |
| constitution.md (C) | 0 | 2 | 0 | 2 |
| ADR mới (011..026) | 4 | 9 | 3 | 16 |
| **Cộng** | **24** | **56** | **7** | **87** |

Ngoài ra: 16 mâu thuẫn giữa epic (K-01..K-16, mục 1) và 11 thiếu sót của kit (KT-01..KT-11, mục 4).
