# Nền còn thiếu sau lần sửa nền 2026-10-06

Trạng thái: **đề xuất, chờ người duyệt**. Không file nào trong `spec/` được sửa bởi tài liệu này.
Nguồn: mục `## Nền còn thiếu sau lần sửa 2026-10-06` ở cuối `spec/epics/<EPIC>/questions.md` của 14 epic, đối chiếu với nền hiện tại (`entities.md`, `events.md`, `roles.md`, `architecture.md`, `security-baseline.md`, `constitution.md`) và `FOUNDATION-CHANGES.md` (đề xuất gốc, 87 mục đã áp dụng phần lớn). Mục nào nền đã có thì không nêu lại.

Cách đọc:
- Ưu tiên: **CHẶN** (hai nơi mâu thuẫn làm dữ liệu hoặc tiền sai, hoặc epic không thể duyệt), **NÊN** (một đến vài epic cần, có mặc định an toàn), **SAU** (backlog, không chặn duyệt).
- Loại: **MÂU THUẪN** (hai nơi nói khác nhau) hoặc **THIẾU** (nền chưa có).
- Mã `R-xx` để người duyệt trả lời ("đồng ý R-02, sửa R-31"). Số trong ngoặc là mặc định epic đề xuất, đổi được ở tech-design.
- Theo P8 mọi `[OPEN]` trỏ vào nền chưa sửa chặn epic được `approved`; sửa xong mục nào thì epic gỡ `[OPEN]` tương ứng.

Số liệu: xem mục 9 (52 mục: 3 CHẶN, 38 NÊN, 11 SAU; 11 mục là MÂU THUẪN).

---

## 0. Mâu thuẫn thật còn lại (các epic tự phát hiện)

| Mã | Hai nơi nói khác nhau | Phân xử đề xuất | Sửa ở |
| --- | --- | --- | --- |
| M-01 | Bảng Giao diện module chỉ có `USR -> AUTH: updateProfile (phone, avatar_url)`; AUTH-API, USR-API, DSH-API dùng thêm `full_name`, `getUser`, `changePassword`, `findCustomerById`, `findCustomerByEmail`, `listAvatarUrlsInUse`, `countCustomers`; AUTH-API còn ghi "đề xuất, chưa là hợp đồng" (AUTH, USR, DSH) | Thêm các hàng vào bảng, hợp đồng thật | R-25 |
| M-02 | Chữ ký INV `reserve(order_id, items, expires_at, tx)` đã khớp ở CHK-API, CHK-REQ, INV-REQ, nhưng INV questions câu 16 và CHK questions ("Việc cần ở epic khác" mục 3) còn ghi `payment_method` (lỗi thời). Thật sự còn lệch: PRM `reserve` chưa có `tx` ở PRM-API; `evaluate(count_attempt)` CRT, CHK đề nghị và PRM chấp nhận nhưng nền chưa có; `createPending(payment_expires_at)` | Ghi chữ ký vào bảng để hết lệch; dọn `[OPEN]` lỗi thời ở hai questions | R-29 |
| M-03 | `entities.md` có `Order shipped -> returned` (E-18) nhưng `events.md` không có event cho chuyển này: PAY không biết nên Payment COD `pending` không bao giờ đóng; NTF không báo khách; DSH ghi "bảy trạng thái" (ORD, PAY, NTF, DSH) | Thêm OrderReturned | R-15 |
| M-04 | Ghi chú xử lý nói ORD "không đổi đơn đã đóng" khi nhận StockCommitFailed, nhưng đơn `paid` chưa đóng: PaymentSucceeded tới trước StockReservationExpired thì đơn thành `paid`, PAY hoàn `late_payment`, đơn kẹt `paid` dù tiền đã hoàn (ORD, INV, PAY) | Thêm `paid -> cancelled` do hệ thống | R-02 |
| M-05 | StockReleased ghi `reason` gồm `order_expired`, nhưng INV chỉ phát `order_cancelled` (đơn hết hạn đi đường StockReservationExpired, không phát StockReleased) | Bỏ `order_expired` khỏi StockReleased | R-16 |
| M-06 | Hết lượt thanh toán: ADR-005, E-19 ghi cố định "tối đa 3 lượt"; PAY dùng `is_final = attempt_no >= PAY_MAX_ATTEMPTS` (cấu hình); `Payment.attempt_no` tối đa chưa ghi ở `entities.md`; PaymentFailed `reason` chưa là mã (NTF cần để chọn câu chữ) (PAY, NTF, ORD) | Hằng số cấu hình mặc định 3, `reason` là mã | R-06, R-18 |
| M-07 | SB-33 yêu cầu "số lượt dùng coupon mỗi người" (Epic liên quan có PRM) nhưng `Coupon` không có `per_user_limit` (E-11 để SAU) nên PRM không làm | Thêm thuộc tính hoặc bỏ phần coupon khỏi SB-33 | R-01 |
| M-08 | Cột Phụ thuộc của AUTH ghi PRJ, của ORD ghi AUTH, nhưng mối quan tâm cắt ngang (A-01) nói không cần khai; AUTH-API khai `depends_on: []`; ORD chỉ có khóa ngoại tới `users`, không gọi AUTH | Đổi theo thực tế hoặc giữ có chủ đích | R-30 |
| M-09 | ADR-014 để bậc D, E "chốt ở tech-design" nhưng mỗi epic chọn khác: DSH bậc D bộ nhớ từng instance; PRJ tạm chọn PostgreSQL cho D, E; PAY đề xuất PostgreSQL cho bậc E | Gán kho đếm trong ADR | R-31 |
| M-10 | SB-19, ADR-021 ghi audit "cùng giao dịch với thao tác" và liệt kê "xem dashboard", nhưng xem dashboard là thao tác đọc không có giao dịch ghi; DSH chọn lỗi audit không chặn việc xem | Nền nói rõ cho thao tác chỉ đọc | R-43 |
| M-11 | Events: UserRegistered có consumer NTF; AUTH ghi email chào mừng mâu thuẫn SB-26 (email giao dịch chỉ tới địa chỉ đã xác minh). NTF câu 2 đã chọn chào mừng chỉ trong ứng dụng (không email) nên SB-26 không bị vi phạm | Ghi rõ "chỉ in_app" ở nền; AUTH gỡ ghi chú | R-21 |
| M-12 | **Chỉ cần sửa epic**: AUTH-API còn ghi `changePassword` thu hồi "các phiên khác", trong khi SB-03, USR-REQ-20261006-101003591 BR4 và `Session.revoked_reason` (`replaced`, `password_changed`) là thu hồi **mọi** phiên, phiên của request `replaced`, cấp phiên mới | Sửa AUTH-API theo SB-03 | epic AUTH |
| M-13 | **Chỉ cần sửa epic**: DSH-REQ-20261006-105125811 ghi "bảy trạng thái" (ORD có tám, thêm `returned`) và báo cáo theo `created_at` "vì ORD không có `paid_at`" (nay có) | Sửa DSH theo ORD | epic DSH |

---

## 1. `spec/domain/entities.md`

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-01 | Coupon thêm `per_user_limit` (số nguyên, rỗng = không giới hạn; CouponRedemption đếm theo `user_id` ở `consumed` và `reserved`). Nếu không muốn v1: bỏ "số lượt dùng coupon mỗi người" khỏi SB-33 | PRM, CHK | NÊN | MÂU THUẪN |
| R-02 | Vòng đời Order thêm `paid -> cancelled`, điều kiện: "ORD nhận StockCommitFailed (hệ thống, `cancelled_by_role` = `system`, `cancel_reason` = `stock_commit_failed`); PAY đã hoàn `late_payment`". Thêm giá trị vào `cancel_reason` và `OrderCancelled.reason` (`events.md`). Phương án còn lại: giữ no-op và ghi rõ đơn kẹt `paid` chờ admin xử lý | ORD, INV, PAY | CHẶN | MÂU THUẪN |
| R-03 | Ràng buộc: Order có `grand_total > 0` ở v1 (CHK chặn đơn 0 đồng, PAY không tạo Payment 0 đồng). Nếu cần đơn 0 đồng (coupon 100% cộng miễn phí vận chuyển): thêm `pending -> paid` điều kiện "tổng 0, ORD tự chuyển", Payment không tạo | CHK, PAY, PRM, ORD | NÊN | THIẾU |
| R-04 | Vòng đời Order: ghi điều kiện `paid/confirmed -> cancelled` chỉ khi Shipment còn `pending`, hoặc đổi ORD khóa đơn khi SHP bắt đầu bàn giao (cửa sổ giữa SHP bàn giao và ORD nhận ShipmentShipped vẫn hủy được; kèm sdlc-impact) | SHP, ORD | NÊN | THIẾU |
| R-05 | Ghi chú dưới bảng cho entity chỉ thêm cần thứ tự (OrderStatusHistory, ShipmentStatusHistory): cột kỹ thuật `seq` (identity) là khóa thứ tự ghi. Xác nhận cách hiểu "ShipmentFailed chỉ ghi lịch sử" = một dòng OrderStatusHistory có `from_status = to_status = shipped`, `reason` là mã giao thất bại (nới CHECK), hoặc chỉ log | ORD, SHP | NÊN | THIẾU |
| R-06 | **Payment**: ghi `attempt_no` tối đa = `PAY_MAX_ATTEMPTS` (mặc định 3, cấu hình ADR-007). **PaymentAttempt**: thêm `create_date` (vnp_CreateDate, để dựng lại đường dẫn khi bấm lặp). **Refund**: thêm `gateway_request_id` (cấp mới mỗi lần vào `requested`) | PAY, ORD | NÊN | MÂU THUẪN |
| R-07 | **EmailDelivery**: thêm `event_id`, `dedupe_key`, `data` (chống trùng, dựng thư không cần cột nội dung); unique `(user_id, type, dedupe_key)` theo NTF-DB | NTF | NÊN | THIẾU |
| R-08 | Vòng đời chi tiết AUTH ghi điều kiện đang dùng thật: `PasswordResetToken issued -> expired` khi có yêu cầu quên mật khẩu mới; `EmailVerificationToken issued -> expired` khi xác minh thành công làm các token còn lại hết hiệu lực; `Session active -> revoked` lý do hệ thống ghi `admin_lock` (khóa admin) | AUTH | NÊN | THIẾU |
| R-09 | Ghi chú ngoại lệ: bảng hạ tầng tạm của platform (ví dụ `rate_limit_counters` UNLOGGED) không phải entity, không cần dòng ở bảng này | PRJ | NÊN | THIẾU |
| R-10 | Lịch sử kho cần tên người thao tác: chọn một trong (a) StockMovement thêm `actor_name` (bản chụp), (b) AUTH có `getDisplayNames(user_ids)` dùng chung với R-27 (INV khai thêm AUTH ở cột Phụ thuộc), (c) chỉ hiện `actor.id`. Tạm thời INV để `actor.name` rỗng | INV, AUTH | NÊN | THIẾU |
| R-11 | StockItem/StockMovement: ghi rõ ShipmentReturned với `restockable = false`: INV không đổi `on_hand`, không ghi StockMovement, chỉ log và audit (mặc định INV) | INV, SHP | NÊN | THIẾU |
| R-12 | Address: chốt `city` là danh mục chuẩn hóa hay nhập tự do (ảnh hưởng `ShippingMethod.rule.surcharge_cities`); mặc định nhập tự do, so khớp không phân biệt hoa thường và dấu | SHP, USR, CHK | SAU | THIẾU |
| R-13 | Product: thêm `slug` và chuyển `archived -> draft/active` (khôi phục) khi cần; hiện để SAU (E-24) | PRD | SAU | THIẾU |
| R-14 | Quyết chủ sở hữu "sửa email" (đòi xác minh lại, thu hồi phiên): AUTH hay USR; ngoài roadmap | USR, AUTH | SAU | THIẾU |

---

## 2. `spec/domain/events.md`

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-15 | Thêm event **OrderReturned** (Producer ORD; Consumers PAY, NTF; payload `order_id, order_code, user_id`; Phát khi `Order:returned`). PAY đóng Payment COD `pending -> cancelled` (chuyển đã có). DSH vẫn dùng giao diện đọc. Phương án khác: PAY nhận ShipmentReturned (làm PAY phụ thuộc trạng thái vận đơn, không khuyến nghị) | ORD, PAY, NTF, DSH | CHẶN | MÂU THUẪN |
| R-16 | StockReleased: sửa `reason` thành `order_cancelled` duy nhất (bỏ `order_expired`; đơn hết hạn đi StockReservationExpired) | INV | NÊN | MÂU THUẪN |
| R-17 | StockCommitFailed: chốt `reason` thành mã cố định (`reservation_expired`, `reservation_released`) và thêm `reservation_missing` cho PaymentSucceeded của đơn không có reservation (hiện INV chỉ log nên PAY không hoàn tiền) | INV, PAY, ORD | NÊN | THIẾU |
| R-18 | PaymentFailed: ghi `reason` là mã cố định (ví dụ `declined`, `timeout`, `cancelled_by_user`, `other`), không phải văn bản của cổng; mã chi tiết cổng chỉ ở PaymentAttempt | PAY, NTF | NÊN | THIẾU |
| R-19 | Quyết có thêm NTF vào Consumers của OrderExpired (khách biết đơn quá hạn) hay không; ShipmentReturned không cần nếu chọn R-15 | NTF | NÊN | THIẾU |
| R-20 | Thêm event cho `Review published -> pending` (bật `REVIEW_PRE_MODERATION`): **ReviewUnpublished** (REV; PRD; `review_id, product_id, rating`; Phát khi `Review:pending` từ `published`) hoặc cho ReviewHidden phát cả ở chuyển này. Nếu không, bản sửa bị từ chối làm điểm PRD lệch vĩnh viễn | REV, PRD | NÊN | THIẾU |
| R-21 | UserRegistered: ghi ở Ghi chú xử lý "NTF chỉ tạo thông báo trong ứng dụng, không gửi email" (khớp NTF câu 2, SB-26) | AUTH, NTF | NÊN | MÂU THUẪN |
| R-22 | PasswordChanged: "Phát khi" ghi `PasswordResetToken:used` nếu muốn script kiểm (USR đổi mật khẩu cũng phát event này nhưng không đổi entity AUTH); hiện `-` | AUTH, USR | SAU | THIẾU |
| R-23 | Backlog (đã ghi ở Ghi chú, giữ): ProductPriceChanged (giỏ chưa được báo giá đổi), CartAbandoned (chỉ khi DSH, NTF muốn) | PRD, CRT | SAU | THIẾU |
| R-24 | Lời mời đánh giá sau OrderDelivered: REV hay NTF làm (mặc định không bên nào) | NTF, REV | SAU | THIẾU |

---

## 3. `spec/architecture.md`

### 3a. Cột Phụ thuộc và bảng Giao diện module

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-25 | Thay hàng `USR \| AUTH` bằng: `updateProfile (full_name, phone, avatar_url)`, `getUser`, `changePassword` (kiểm mật khẩu cũ, thu hồi mọi phiên, phiên request `replaced`, cấp phiên mới, phát PasswordChanged, giới hạn bậc A), `findCustomerById`, `findCustomerByEmail` (chỉ role customer), `listAvatarUrlsInUse`, `countCustomers` (DSH lấy qua USR); không `tx` | AUTH, USR, DSH | CHẶN | MÂU THUẪN |
| R-26 | Thêm hàng `INV \| PRD`: đọc theo lô `getSummaries(product_ids)` (name, sku), `searchProductIds(q, limit <= 200)`, liệt kê `product_id` của sản phẩm `active` (đối soát, tạo bù); không `tx` | INV, PRD | NÊN | THIẾU |
| R-27 | Thêm hàng `REV \| PRD`: trạng thái `active`, tên, ảnh đại diện theo danh sách id; `REV \| AUTH`: tên hiển thị, ảnh đại diện theo danh sách `user_id` (`getDisplayNames`, dùng chung với R-10); cả hai chỉ đọc, không `tx` | REV, PRD, AUTH | NÊN | THIẾU |
| R-28 | Tách hàng `DSH \| ORD, PAY, PRD, INV, USR` thành tên chỉ định: ORD `countByStatus, getOrderSeries, listRecent, getTopProducts`; PAY `getRevenue, countFailedRefunds`; PRD `countByStatus`; INV `getLowStockSummary(limit)`; USR `countCustomers`. Năm epic bên được gọi chưa có requirement cho các phương thức này (qua sdlc-impact); PAY xác nhận cách DSH tính `refunded` (bỏ Refund `late_payment`, `duplicate_payment`) | DSH, ORD, PAY, PRD, INV, USR | NÊN | THIẾU |
| R-29 | Ghi chữ ký vào cột Phương thức để khỏi lệch lại: `INV.reserve(order_id, items, expires_at, tx)`; `ORD.createPending(..., payment_expires_at, tx)`; `PRM.evaluate(..., count_attempt = true)` (false khi kiểm lại mã đã lưu, không tính lượt sai); `PRM.reserve(..., tx)` | CHK, CRT, INV, ORD, PRM | NÊN | MÂU THUẪN |
| R-30 | Cột Phụ thuộc: AUTH `PRJ` thành `-`. ORD `AUTH`: bỏ AUTH và đổi hai khóa ngoại (`orders.user_id`, `order_status_history.actor_id`) thành cột trơn, hoặc giữ AUTH có chủ đích (khóa ngoại) và ghi vào Ghi chú cột Phụ thuộc | AUTH, ORD | NÊN | MÂU THUẪN |

### 3b. ADR

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-31 | **ADR-014**: gán kho đếm: bậc E (thanh toán, hoàn tiền, IPN) PostgreSQL (tiền cần chính xác); bậc D: PostgreSQL cho đồng nhất, hoặc bộ nhớ từng instance (DSH đã chọn, quản trị ít người). Ghi hợp đồng đếm theo kết quả: `check`, `hit` (chỉ tăng khi sai), `reset` (xóa khi thành công), dùng cho đổi mật khẩu (`usr:pwchange:<user_id>`), chỉ cần giao diện ở PRJ-API | PRJ, DSH, PAY, USR, AUTH | NÊN | MÂU THUẪN |
| R-32 | **ADR-017**: thêm định dạng khóa (8 đến 64 ký tự `[A-Za-z0-9_-]`), lỗi thiếu khóa 400 `idempotency-key-required`, cùng khóa khác nội dung 422 `idempotency-key-reused` | CHK, INV, PAY, REV, PRJ | NÊN | THIẾU |
| R-33 | **ADR-022**: thêm hàng hạn lưu: ProcessedEvent 30 ngày (PRJ), bản chụp địa chỉ của phiên checkout đã đóng 30 ngày (CHK), giỏ `converted`/`abandoned` (CRT, chưa có số), Review `deleted` xóa mềm không hạn và ảnh mồ côi dọn sau 24 giờ (REV, người duyệt đổi được) | PRJ, CHK, CRT, REV | NÊN | THIẾU |
| R-34 | **ADR-013**: hàng "dọn dữ liệu quá hạn theo ADR-022" ghi thêm USR (`usr.purge-deleted-addresses`, địa chỉ xóa mềm 30 ngày là bảng của USR, SB-35) | USR, PRJ | NÊN | THIẾU |
| R-35 | **ADR-011**: ghi số lần thử và khoảng chờ mặc định của relay outbox (PRJ chốt); thêm cảnh báo vận hành (log `error` và chỉ báo) cho OutboxEvent kẹt hết giới hạn thử lại (ảnh hưởng đơn online khách không có chỗ trả tiền, PAY-REQ-20261006-103110331 BR7) | PRJ, PAY, SHP | NÊN | THIẾU |
| R-36 | **ADR-007**: liệt kê biến cấu hình: `DASHBOARD_CACHE_TTL_SECONDS`, `DASHBOARD_SOURCE_TIMEOUT_MS`, `DASHBOARD_RATE_LIMIT_PER_MINUTE` (DSH), `SES_REGION`, `MAIL_FROM`, `APP_BASE_URL` (NTF), `PAY_MAX_ATTEMPTS` (PAY) | DSH, NTF, PAY, PRJ | NÊN | THIẾU |
| R-37 | ADR mới (SAU, bắt buộc trước go-live với bounce): xử lý bounce và complaint của SES (webhook SNS có xác thực chữ ký, danh sách chặn địa chỉ); kênh đẩy thời gian thực cho huy hiệu chuông nếu thay polling 60 giây | NTF | SAU | THIẾU |
| R-38 | ADR-025 triển khai migration tương thích ngược, ADR-026 tích hợp hãng vận chuyển (GHN, GHTK; v1 nhập tay); gán chủ cho trang lỗi chung và khung web | PRJ, SHP | SAU | THIẾU |

---

## 4. `spec/security-baseline.md`

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-39 | **SB-02**: ghi ngưỡng khóa tạm AUTH đã chốt ở AUTH-DB (số lần sai, cửa sổ, thời gian khóa) thay cho "giới hạn số lần đăng nhập sai" chung chung | AUTH | NÊN | THIẾU |
| R-40 | **SB-14 bậc A**: ghi số AUTH đã chốt: đăng nhập 10 mỗi phút mỗi IP; đăng ký 10 mỗi giờ mỗi IP; xác minh 30 mỗi giờ mỗi IP; gửi lại xác minh 60 giây và 5 mỗi giờ mỗi người; quên mật khẩu 20 mỗi giờ mỗi IP và 5 mỗi giờ mỗi email; đặt lại 10 mỗi giờ mỗi IP | AUTH | NÊN | THIẾU |
| R-41 | **SB-14 bậc B, C**: bậc B thêm chọn địa chỉ, vận chuyển, thanh toán ở checkout (60 mỗi phút), hủy đơn (10 mỗi phút), sửa hồ sơ, ghi sổ địa chỉ, ghi giỏ (120 mỗi phút) và dòng chung "ghi của khách khác". Bậc C thêm đọc của người đã đăng nhập (hồ sơ, sổ địa chỉ, giỏ, thông báo: 120 mỗi phút mỗi người) | CHK, ORD, USR, CRT, NTF | NÊN | THIẾU |
| R-42 | **SB-14 bậc D, E**: bậc D thêm endpoint quản trị coupon (PRM) và danh sách sản phẩm quản trị (PRD), 30 mỗi phút mỗi người; bậc E ghi số email theo người nhận (30 mỗi 24 giờ, 10 mỗi giờ, NTF) và kho đếm theo R-31 | PRM, PRD, NTF, PAY | NÊN | THIẾU |
| R-43 | **SB-19, ADR-021**: (a) với thao tác chỉ đọc (xem dashboard) ghi audit lỗi thì chặn hay chỉ log `error` (DSH chọn không chặn); (b) liệt kê "đặt hàng" (`checkout.place_order`) hoặc bỏ nếu coi là thừa; (c) job hết hạn và handler event của `system` có audit hay không (PRM chọn không) | DSH, CHK, PRM | NÊN | MÂU THUẪN |
| R-44 | SB mới: nguồn tổng hợp lỗi thì trả 503, không trả 0 hay "không có dữ liệu" (DSH-SEC T11; Kiểm bằng test) | DSH | NÊN | THIẾU |
| R-45 | **SB-25**: thêm "kiểm hạn dùng và lượt dùng trực tiếp theo giờ máy chủ trong câu `UPDATE` khi dùng, không dựa vào job" (PRM-SEC T10) | PRM | NÊN | THIẾU |
| R-46 | **SB-30**: nói rõ "tồn kho" là ghi đè `on_hand` bằng điều chỉnh có `version` (đổi ngưỡng có hay không); giỏ: khóa lạc quan là `version` dùng ở checkout (`cart-changed`), thao tác giỏ nguyên tử theo SB-38 không bắt client gửi `version` | INV, CRT | NÊN | THIẾU |
| R-47 | SB mới (nhóm Toàn vẹn dữ liệu): header `Idempotency-Key` bắt buộc ở danh sách endpoint của ADR-017, so `request_hash`, giữ 24 giờ; Kiểm bằng test (INV-SEC T4, PRJ-SEC T27 đang ghi SB `-`) | INV, PRJ, CHK, PAY, REV | NÊN | THIẾU |
| R-48 | **SB-35**: xác nhận phạm vi kiểm gồm quét tên bảng của module khác trong SQL thô (PRJ-REQ-20261006-095422475 BR11) | PRJ | SAU | THIẾU |
| R-49 | SB mới: dữ liệu cá nhân đã xóa mềm phải xóa cứng sau 30 ngày (S-18); USR-SEC T20 (giả mạo số điện thoại, người nhận, không OTP) ghi là rủi ro chấp nhận, kiểm bằng review | USR | SAU | THIẾU |

---

## 5. `spec/domain/roles.md`

Không còn mục thiếu bắt buộc: role `system`, staff, admin, customer đã áp dụng đầy đủ.

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-50 | staff nhập, xuất, điều chỉnh kho: có giới hạn chênh lệch hoặc hai người duyệt (chống che thất thoát) hay không; hiện staff và admin như nhau | INV | SAU | THIẾU |

## 6. `spec/constitution.md`

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-51 | **P8**: định nghĩa nhãn để script đếm (ví dụ `[OPEN-NỀN]` cho câu hỏi trỏ vào nền chưa sửa, `[OPEN]` thường cho quyết định nghiệp vụ). P8 ghi "kiểm bằng script" nhưng script chưa có (KT-10) và `questions.md` đang trộn hai loại `[OPEN]` | tất cả | NÊN | THIẾU |

## 7. Ngoài sáu file nền (để khỏi sót)

| Mã | Thay đổi cụ thể | Epic | Ưu | Loại |
| --- | --- | --- | --- | --- |
| R-52 | `spec/permissions-matrix.md` đã gộp cột `system` và dòng của 14 epic; còn thiếu hàng `POST /api/v1/admin/reviews/{id}/unhide` (admin) và `system` cho job dọn ảnh mồ côi (REV-REQ-20261006-103135207 BR8; USR, PRD tương tự); ghi vào bảng Thay đổi | REV, USR, PRD | NÊN | THIẾU |

Việc chỉ ở epic (không phải nền): sửa AUTH-API (M-12), DSH-REQ (M-13); dọn `[OPEN]` lỗi thời ở INV câu 16, CHK ("Việc cần ở epic khác" mục 3), ORD mục 8 (`getForPayment` không còn xuất hiện trong thiết kế nào); ORD thêm liên kết "Theo dõi vận chuyển" (đã có `ord-order-detail-tracking-link`, SHP câu 20d cần đóng); NTF xin ID requirement cho AUTH `getUserContact`, `listActiveUserIdsByRole` và PRJ (`SES_REGION`, `MAIL_FROM`, `APP_BASE_URL`); PAY, SHP đối chiếu `cod_amount` với `amount` Payment; ORD, PAY, PRD, INV, USR viết requirement cho giao diện đọc của DSH (R-28); INV viết requirement `getAvailability` cho PRD, CRT link tới.

## 8. Việc cần người quyết (tối đa 10)

1. **R-02**: đơn `paid` nhận StockCommitFailed: tự hủy do hệ thống (khuyến nghị, tiền đã hoàn) hay no-op chờ admin.
2. **R-15**: thêm OrderReturned (khuyến nghị) hay để PAY nhận ShipmentReturned; có báo khách đơn hoàn về không.
3. **R-25 đến R-27, R-10**: duyệt bộ phương thức AUTH, PRD cho USR, REV, INV; tên người thao tác trong lịch sử kho lấy qua AUTH, cột `actor_name`, hay chỉ `actor.id`.
4. **R-31**: kho đếm bậc D (PostgreSQL hay bộ nhớ) và bậc E (PostgreSQL).
5. **R-01**: thêm `per_user_limit` ở v1 hay bỏ coupon khỏi SB-33.
6. **R-03**: đơn 0 đồng ở v1: chặn (mặc định hiện tại) hay thêm đường sang `paid`.
7. **R-30**: bỏ AUTH khỏi Phụ thuộc của ORD (khóa ngoại thành cột trơn) hay giữ có chủ đích.
8. **R-43**: audit cho thao tác chỉ đọc có chặn khi lỗi không; có audit "đặt hàng" và hành động của `system` không.
9. **R-20**: thêm ReviewUnpublished hay chấp nhận lệch điểm khi bản sửa bị từ chối; cùng R-17 (`reservation_missing`) và R-18 (mã `reason` của PaymentFailed).
10. Gói nghiệp vụ: R-04 (khóa hủy đơn khi SHP bàn giao), R-05 (ShipmentFailed ghi lịch sử hay chỉ log), R-11 (`restockable` suy ra hay nhân viên chọn), R-19 và R-24 (NTF báo OrderExpired, mời đánh giá), R-12 (`city` chuẩn hóa).

## 9. Số liệu

| Nhóm | CHẶN | NÊN | SAU | Tổng | Trong đó MÂU THUẪN |
| --- | --- | --- | --- | --- | --- |
| entities.md (R-01..R-14) | 1 | 10 | 3 | 14 | 3 |
| events.md (R-15..R-24) | 1 | 6 | 3 | 10 | 3 |
| architecture.md, bảng và Phụ thuộc (R-25..R-30) | 1 | 5 | 0 | 6 | 3 |
| architecture.md, ADR (R-31..R-38) | 0 | 6 | 2 | 8 | 1 |
| security-baseline.md (R-39..R-49) | 0 | 9 | 2 | 11 | 1 |
| roles.md (R-50) | 0 | 0 | 1 | 1 | 0 |
| constitution.md (R-51) | 0 | 1 | 0 | 1 | 0 |
| Ngoài nền (R-52) | 0 | 1 | 0 | 1 | 0 |
| **Cộng** | **3** | **38** | **11** | **52** | **11** |

Mâu thuẫn ở mục 0: 13 (11 cần sửa nền, M-12 và M-13 chỉ sửa ở epic).
