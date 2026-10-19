# Câu hỏi còn mở của epic ORD (sdlc-research)

Chạy tự động nên không hỏi trực tiếp. Quyết định nghiệp vụ người dùng đã trả lời (hủy đơn, staff chỉ xem, lịch sử, phân trang, 404) đã áp vào requirement. Dưới đây là phần chưa có câu trả lời và phần đã được nền mới (FOUNDATION-CHANGES.md, 2026-10-06) giải quyết. Mọi file spec vẫn `draft`.

## A. Cần người quyết ở phạm vi ORD
1. [RESOLVED] quyết định (mặc định, người dùng ủy quyền 2026-10-06): staff/admin sắp xếp mới nhất trước, như customer (ORD-REQ-20261006-092320743 BR6).
2. [RESOLVED] quyết định (mặc định, người dùng ủy quyền 2026-10-06): ô tìm mã đơn khớp chính xác, không phân biệt hoa thường (BR7).
3. [RESOLVED] quyết định (mặc định, người dùng ủy quyền 2026-10-06): lịch sử trạng thái hiển thị cũ nhất trước (ORD-REQ-20261006-092320812 BR7). Khóa sắp xếp đã chốt là thứ tự ghi `seq`, không phụ thuộc chiều hiển thị.
4. [RESOLVED K-16, S-03, SB-19] Staff/admin xem đơn của người khác không ghi audit: danh sách và màn đơn không lộ dữ liệu cá nhân với staff (SB-08(c)); áp ở ORD-REQ-20261006-092320743 BR8.

## B. Trước đây "Nền cần sửa", nay nền đã áp dụng
5. [RESOLVED K-13, S-04] SB-08 viết lại thành ba ngoại lệ: ORD giữ mặc định staff không thấy người nhận, điện thoại, địa chỉ; staff xem người nhận ở SHP (khi vận đơn `pending`, `shipped`, `failed`, có audit). Áp ở ORD-REQ-20261006-092320768 BR4.
6. [RESOLVED E-13] Entity `OrderStatusHistory` đã có (`order_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `reason`, chỉ thêm). Áp ở ORD-DB (bảng `order_status_history`, trigger chặn UPDATE, DELETE, SB-32).
7. [RESOLVED E-12, V-09, V-06] Order có `tracking_number` (bản sao, ghi từ ShipmentShipped, cập nhật từ ShipmentTrackingChanged), `cancel_reason` (mã `customer_request`, `admin`, `payment_failed`), `cancelled_by_role`, `confirmed_at`, `paid_at`, `delivered_at`, `payment_expires_at`, `shipping_method_id`. Văn bản lý do người nhập chỉ nằm ở lịch sử và audit, event chỉ mang mã.
8. [RESOLVED K-03c, E-18] ShipmentFailed không đổi trạng thái (chỉ ghi một dòng lịch sử); ShipmentReturned: `shipped -> returned` (cuối). Áp ở ORD-REQ-20261006-092320790 BR8, trạng thái `returned` ở ORD-DB, màn danh sách và chi tiết.
9. [RESOLVED K-03a, A-02] Đơn COD `pending -> confirmed` do CHK gọi `ORD.confirmCod` trong giao dịch đặt hàng, không qua event. Áp ở ORD-REQ-20261006-120227589 (mới) và ORD-REQ-20261006-092320790 BR10.
10. [RESOLVED K-03d, S-05, SB-24] Admin hủy đơn `paid` cũng hoàn tiền tự động như khách (do `system`, có audit). Áp ở ORD-REQ-20261006-092320834 BR5, BR12.
11. [RESOLVED R-02] `roles.md` liệt kê staff xem đơn, bàn giao và cập nhật kết quả giao ở SHP; khớp ORD-REQ-20261006-092320743 BR9.

## C. Phụ thuộc epic khác
12. [RESOLVED K-02, K-03b, K-04, V-05, S-05, ADR-005] PAY: hoàn tiền đơn `paid` bị hủy tự động theo Payment thật; thanh toán muộn thì PAY hoàn `late_payment`, ORD không đổi đơn đã đóng, riêng đơn `paid` nhận StockCommitFailed thì tự hủy (M-04); hết lượt thử báo bằng `is_final` trong PaymentFailed (tối đa `PAY_MAX_ATTEMPTS` lượt do PAY, mặc định 3, ADR-005, M-06); hoàn thất bại thử lại 3 lần rồi admin. Áp ở ORD-REQ-20261006-092320790 BR5, BR9, BR11 và ORD-REQ-20261006-092320834 BR5, BR7.
13. [RESOLVED K-03a, A-02] CHK: giao diện `createPending`, `confirmCod`, `countOpenOrders`, `getSummary` đã vào bảng giao diện module; chữ ký chốt ở ORD-API, yêu cầu ở ORD-REQ-20261006-120227589.
14. [RESOLVED K-03c, V-09] SHP: ShipmentFailed, ShipmentReturned, ShipmentTrackingChanged đã có chuyển hoặc handler ở ORD.

## Lệch so với epic khác (đã đồng bộ nền 2026-10-06)
Danh sách lúc chạy sdlc-test-design, nay có kết quả đồng bộ.

1. [RESOLVED K-03a, A-02] **CHK**: đã thêm ORD-REQ-20261006-120227589 cho `createPending`, `confirmCod`, `countOpenOrders`, `getSummary`; test `ORD-TC-20261006-111225380` chuyển sang requirement mới, thêm `ORD-TC-20261006-120227769`, `ORD-TC-20261006-120227861`, `ORD-TC-20261006-120227953`; ORD-REQ-20261006-092320790 BR10 đã hết đánh dấu cần làm rõ.
2. [RESOLVED E-06, E-12] **CHK, ORD-DB**: Order có `shipping_method_id` và `shipping_address` gồm `line1`, `ward`, `city` (không có quận, E-12).
3. [RESOLVED, quyết định thiết kế của ORD] **CHK, ORD-DB (lỗi thiết kế thứ tự lịch sử)**: lịch sử sắp theo khóa thứ tự ghi `seq` (identity), không dựa `created_at` hay `id` uuid; test khóa lỗi `ORD-TC-20261006-111226057` đã đổi sang assert `seq`.
4. **PAY**: (a) [RESOLVED A-02, A-04] `findForPayment` đã có ở bảng giao diện, yêu cầu ở ORD-REQ-20261006-120227681; (b) [RESOLVED K-03b, V-05] `is_final` thay hằng số 3, test `ORD-TC-20261006-111225350` đã đổi; (c) [RESOLVED K-04] ORD tự đặt `payment_status` = `cancelled` khi hủy (không có PaymentCancelled), test hủy pending và hủy COD đã đổi; (d) [RESOLVED E-19, K-04] bảng cho phép của `payment_status` nhận PaymentFailed từ `failed` (PAY thử lại không có event), ORD-REQ-20261006-092320790 BR5; (e) [RESOLVED] liên kết "Xem thanh toán" đã có (`ord-order-detail-payment-link`), hộp thoại hủy trỏ kết quả hoàn tiền sang màn của PAY.
5. **SHP**: (a) [RESOLVED A-02] `findForShipment`, `findByCode`, `findOwned`, `getRecipient` ở ORD-REQ-20261006-120227681; (b) [RESOLVED K-13, S-04] ORD vẫn ẩn người nhận với staff, SHP là nơi staff thấy (có audit); (c) [RESOLVED V-09] ShipmentTrackingChanged cập nhật `tracking_number`, test `ORD-TC-20261006-120228504`; (d) [RESOLVED] liên kết "Theo dõi vận chuyển" đã có (`ord-order-detail-tracking-link`); (e) [RESOLVED K-03c, E-18] ShipmentFailed ghi lịch sử, ShipmentReturned sang `returned`, test `ORD-TC-20261006-111225767` và `ORD-TC-20261006-120228419`.
6. **INV**: [RESOLVED K-01, K-02] INV là bên duy nhất giữ đồng hồ; StockReservationExpired đến khi đơn đã `paid` bị ORD từ chối theo bảng chuyển (test `ORD-TC-20261006-111225795`); StockCommitFailed: đơn `paid` bị hủy do hệ thống (M-04, R-02, test `ORD-TC-20261006-140000100`), đơn khác là no-op có log (test `ORD-TC-20261006-120228595`).
7. **PRJ**: (a) [RESOLVED ADR-023] `type` lỗi là `urn:ecom:error:<code>` (test `ORD-TC-20261006-111226306` assert nguyên giá trị); (b) [RESOLVED ADR-021] `audit.record(tx, ...)` của platform, bảng `audit_logs` thuộc PRJ; (c) [RESOLVED S-01, SB-14] bậc C 120 mỗi phút mỗi IP cho tra cứu, bậc D 30 mỗi phút cho danh sách quản trị, bậc B cho hủy (10 mỗi phút mỗi người, số do ORD chọn); test `ORD-TC-20261006-111225088` đã đổi.
8. [RESOLVED ADR-016, AUTH-API] **AUTH**: thứ tự kiểm 429, 401, `Origin` (403 `csrf_failed`) và 415, role, 400, 404, 409; CSRF theo `Origin`, không có token; `ORD-TC-20261006-111226396` đã viết lại, các ca còn lại bỏ "CSRF token".
9. [RESOLVED ADR-011, SB-27] **T17 (mất event)**: event ghi outbox cùng giao dịch; ORD-SEC T17 chuyển sang `test` với `ORD-TC-20261006-120228687`.

## Nền còn thiếu sau lần sửa 2026-10-06
1. [RESOLVED M-04, R-02] **Đơn `paid` nhận StockCommitFailed**: nền đợt 2 thêm `paid -> cancelled` do hệ thống (`cancel_reason` `stock_commit_failed`, `cancelled_by_role` `system`, OrderCancelled `reason` `stock_commit_failed`); PAY không hoàn lần hai. Áp ở ORD-REQ-20261006-092320790 BR11, BR14, ORD-DB, ORD-API, ORD-SEC T22, `ORD-TC-20261006-140000100`.
1a. [RESOLVED M-04, R-02, làm rõ đợt 2b] **StockCommitFailed đến khi đơn còn `pending`**: nền thêm `pending -> cancelled` do hệ thống (`cancel_reason` `stock_commit_failed`, `cancelled_by_role` `system`, OrderCancelled `was_paid` = false); PaymentSucceeded đến sau cho đơn đã `cancelled` thì ORD no-op có log và PAY hoàn `late_payment` (một giao dịch thắng); loại phương án bắt INV chỉ phát sau khi ORD đã `paid`. Áp ở ORD-REQ-20261006-092320790 BR1, BR11, BR14, test `ORD-TC-20261006-140000200`.
2. [RESOLVED M-03, R-15] **Event cho `shipped -> returned`**: nền đợt 2 thêm OrderReturned (ORD phát; PAY đóng Payment COD `pending`, NTF báo khách). Áp ở ORD-REQ-20261006-092320790 BR3, BR8, ORD-DB, ORD-API, `ORD-TC-20261006-120228419`.
3. [RESOLVED R-05, đợt 3] **Dòng lịch sử cho ShipmentFailed**: nền đợt 3 chốt đúng cách hiểu của ORD: một dòng `OrderStatusHistory` `shipped -> shipped` với `reason` là mã giao thất bại, CHECK `from_status = to_status` chỉ cho `shipped`. ORD-DB, ORD-REQ-20261006-092320790 BR8 đã khớp.
4. [RESOLVED R-05, đợt 3] **`OrderStatusHistory.seq`**: `entities.md` đợt 3 đã ghi quy ước cột kỹ thuật `seq` (identity) cho OrderStatusHistory, ShipmentStatusHistory. ORD-DB khớp.
5. [RESOLVED R-41, đợt 3] **Giới hạn tần suất của hủy đơn**: SB-14 bậc B đã có hàng "hủy đơn" 10 mỗi phút; ORD-API, ORD-SEC T3, ORD-REQ-20261006-092320834 BR10 khớp.
6. [RESOLVED M-08, R-30] **Cột Phụ thuộc của ORD** giữ AUTH có chủ đích (hai khóa ngoại tới `users`), ghi ở Ghi chú cột Phụ thuộc của `architecture.md`; ORD-API, ORD-DB khớp, không có hàng ORD trong bảng Giao diện module.
7. [RESOLVED M-13] **DSH "bảy trạng thái"**: DSH sửa thành tám (kể cả `returned`) và báo cáo theo `Order.paid_at` ở epic DSH. Phía ORD, doanh thu và sản phẩm bán chạy của giao diện đọc DSH theo `paid_at` (ORD-REQ-20261006-120227681 BR6, `ORD-TC-20261006-120228155`).
8. [RESOLVED R-28, M-02] **Tên giao diện của ORD** khớp bảng Giao diện module ở `architecture.md` (CHK: `createPending(..., payment_expires_at, tx)`, `confirmCod`, `countOpenOrders`, `getSummary`; PAY `findForPayment`; SHP `findForShipment`, `findByCode`, `findOwned`, `getRecipient`; REV `getDeliveredItems`; DSH `countByStatus`, `getOrderSeries`, `listRecent`, `getTopProducts`); `getForPayment` không còn trong thiết kế nào.

## Đồng bộ nền đợt 3 (2026-10-06)
1. [RESOLVED R-04, áp dụng ở epic, nền chưa có hàng giao diện] **Hủy `paid`/`confirmed` chỉ khi Shipment còn `pending`**: nền giao ORD và SHP chốt cơ chế. Quyết định: thêm yêu cầu ORD-REQ-20261006-150000100 (`lockForHandoff(order_id, tx)` do SHP gọi trong giao dịch bàn giao, đặt cờ `handoff_locked_at`; khách và admin hủy đơn đã khóa nhận 409). Cần sdlc-impact ở SHP (SHP-REQ-20261006-101103855, SHP-DB, câu 9 của SHP) và một hàng SHP -> ORD ở bảng Giao diện module của nền.
2. [RESOLVED R-03] **Đơn `grand_total > 0`**: ORD-REQ-20261006-120227589 BR2 và ORD-DB (CHECK `grand_total > 0`) khớp; test `ORD-TC-20261006-120227861` thêm ca 0 đồng.
3. [RESOLVED R-19] **OrderExpired** mang `order_code`, `user_id` (NTF nhận, chỉ `in_app`): ORD-REQ-20261006-092320790 BR3, ORD-DB, ORD-API, test `ORD-TC-20261006-111225320`.
4. [RESOLVED R-17] **StockCommitFailed `reservation_missing`**: ORD xử lý như hai mã kia (ORD-REQ-20261006-092320790 BR11, ORD-API); test `ORD-TC-20261006-140000100`, `ORD-TC-20261006-120228595`.
5. [RESOLVED R-05, R-41] Hai mục nền cũ về `seq` và giới hạn tần suất hủy đơn đã được nền đợt 3 ghi (mục B và "Nền còn thiếu").

## Nhật ký đồng bộ nền 2026-10-06
- `requirements/ORD-REQ-20261006-092320716.md` (K-03/E-18, S-01/SB-14, A-01): thêm `returned` vào tập lọc (tám trạng thái), BR8 giới hạn tần suất bậc C và thứ tự ổn định; `links` tới AUTH-REQ-20261006-095515808; bỏ đánh dấu cần làm rõ về AUTH.
- `requirements/ORD-REQ-20261006-092320743.md` (K-16/S-03, R-02, E-18, S-01): BR3 tám trạng thái; BR8 đánh dấu [RESOLVED] không audit; BR9 ghi R-02; BR10 bậc D; bỏ câu hỏi mở về roles.md; `links` tới AUTH.
- `requirements/ORD-REQ-20261006-092320768.md` (K-13/S-04, E-12/V-09, K-01, E-06): `payment_expires_at`, địa chỉ bản chụp có `line1` (không quận), `tracking_number` là bản sao, BR8 liên kết PAY và SHP, BR9 bậc C; ba kịch bản biên mới (hạn thanh toán, đổi mã vận đơn, COD); bỏ câu hỏi mở và đánh dấu cần làm rõ đã được nền quyết; `links` tới AUTH, SHP, PAY.
- `requirements/ORD-REQ-20261006-092320790.md` (K-01, K-02, K-03a-d, K-04, E-18, E-19, V-04, V-05, V-06, V-09, ADR-011): viết lại: tám trạng thái, `returned`, COD qua `confirmCod`, `is_final`, ShipmentFailed ghi lịch sử, ShipmentTrackingChanged, StockCommitFailed no-op, bảng cho phép của `payment_status`, ORD tự đặt `payment_status` khi hủy, outbox và ProcessedEvent, audit hủy tự động; `roles` thêm `system`; consumers 11 event; thêm hai câu hỏi mở mới về nền.
- `requirements/ORD-REQ-20261006-092320812.md` (E-13, K-03c, thứ tự ghi): entity OrderStatusHistory, thêm dòng giao thất bại, `returned`, lý do là văn bản hoặc mã, BR7 thứ tự theo `seq`; bỏ câu hỏi mở entity.
- `requirements/ORD-REQ-20261006-092320834.md` (K-03d, S-05, K-02, K-04, V-06, ADR-021, ADR-016, SB-24): lý do văn bản chỉ vào lịch sử và audit, event mang mã; hoàn tiền tự động cho cả admin; bỏ đánh dấu cần làm rõ và câu hỏi mở về PAY, SB-24; audit qua `audit.record`; CSRF theo `Origin`; bậc B; kịch bản mới (hủy pending đặt `payment_status`, CSRF).
- `requirements/ORD-REQ-20261006-120227589.md` (thêm, K-01, K-03a, A-02, ADR-012, SB-33): giao diện CHK `createPending`, `confirmCod`, `countOpenOrders`, `getSummary`.
- `requirements/ORD-REQ-20261006-120227681.md` (thêm, A-02, A-04, ADR-020, K-13): giao diện đọc cho PAY, SHP, REV, DSH; tám trạng thái.
- `flows/ORD-FLOW-20261006-092320857.md` (K-03, E-18, ADR-016, SB-14): thêm 429 và CSRF, `returned`, ShipmentFailed, sơ đồ 3 cho giao diện nội bộ; covers thêm hai requirement mới.
- `design/ORD-DB-20261006-092703753.md` (E-12, E-13, E-18, K-01, K-03, ADR-011, ADR-012, ADR-021, SB-32): thêm bảng `order_status_history` thuộc entity OrderStatusHistory với `seq`, trạng thái `returned`, các cột mới của `orders`, bản chụp địa chỉ không quận, outbox, ProcessedEvent, audit, giao dịch tạo đơn, giao diện đọc; bỏ câu hỏi mở.
- `design/ORD-API-20261006-092703780.md` (ADR-023, ADR-016, ADR-014, ADR-011, A-02): thứ tự kiểm khớp AUTH-API, `type` URN, bậc giới hạn, `payment_expires_at`, bảng giao diện module, consumes thêm StockCommitFailed và ShipmentTrackingChanged; bỏ câu hỏi mở.
- `design/ORD-SEC-20261006-092703802.md` (S-01, S-04, ADR-011, ADR-021, SB-27, SB-35): T3, T6, T9, T10, T13, T16, T17 theo baseline mới; thêm T19 (PII qua giao diện nội bộ), T20 (event trùng, lệch thứ tự), T21 (gọi sai `confirmCod`, `createPending`); viết lại rủi ro còn lại.
- `ui/order-list.md`, `ui/order-admin-list.md` (E-18, SB-14): thêm `returned` ("Đã hoàn") vào bộ lọc và nhãn, trạng thái 429.
- `ui/order-detail.md` (K-01, K-03c-d, K-13, E-18, V-09): hạn thanh toán, liên kết Xem thanh toán và Theo dõi vận chuyển, dòng giao thất bại và `returned`, COD đã thu, thông báo hoàn tiền tự động; thêm testid `ord-order-detail-payment-expires`, `ord-order-detail-payment-link`, `ord-order-detail-tracking-link`.
- `tests/` (sửa): 111224310 không đổi; 111224341, 111224487 (tám trạng thái); 111224869, 111224900, 111224930 (địa chỉ `line1`, không quận); 111225088 (bậc C theo IP, bậc B, bậc D); 111225234, 111225263, 111225291, 111225320 (payload, outbox, ProcessedEvent, bỏ `reservation_id`); 111225350 (viết lại theo `is_final`, audit `system`); 111225380 (chuyển sang ORD-REQ-20261006-120227589); 111225410, 111225467 (bảng `payment_status`, ORD tự đặt `cancelled`); 111225552, 111225590, 111226087 (`is_final`); 111225620 (không route cho giao diện nội bộ); 111225649, 111225737 (ProcessedEvent, outbox); 111225708 (COD thu tự động sau OrderDelivered); 111225767 (chỉ ShipmentFailed ghi lịch sử); 111226057 (thứ tự `seq`); 111226117, 111226147, 111226176, 111226206 (event mang mã lý do, `cancel_reason`, `payment_status` khi hủy); 111226244, 111226276, 111226306, 111226366, 111226396 (viết lại, `Origin`), 111720190 (`Origin`, `type` URN, thứ tự 429); các ca E2E 111226558, 111226588, 111226646.
- `tests/` (thêm, 12 test case và 1 E2E): ORD-TC-20261006-120227769, -120227861, -120227953 (REQ giao diện CHK); -120228061, -120228155, -120228244, -120228334 (REQ giao diện đọc); -120228419 (ShipmentReturned), -120228504 (ShipmentTrackingChanged), -120228595 (StockCommitFailed), -120228687 (outbox, event trùng, T17, T20), -121202827 (hạn thanh toán); ORD-E2E-20261006-121317047 (hạn thanh toán, giao thất bại, hoàn về).

### Đợt 2
- `requirements/ORD-REQ-20261006-092320790.md` (M-04, R-02, M-03, R-15, M-06, R-06, R-18): BR1 thêm `paid -> cancelled` do hệ thống; BR3 thêm OrderReturned và `reason` `stock_commit_failed`; BR8 `returned` phát OrderReturned; BR9 `PAY_MAX_ATTEMPTS`, `reason` mã; BR11 viết lại (đơn `paid` nhận StockCommitFailed tự hủy, PAY không hoàn lần hai); BR14 audit hủy hệ thống; thêm kịch bản ORD-6; hai câu hỏi mở cũ thành [RESOLVED], thêm câu hỏi mở StockCommitFailed đến khi đơn còn `pending`.
- `requirements/ORD-REQ-20261006-092320834.md` (M-04): BR3 thêm mã hủy hệ thống `stock_commit_failed`.
- `requirements/ORD-REQ-20261006-092320812.md` (M-04, R-02, R-15): BR3 thêm lý do `stock_commit_failed`; kịch bản đơn `paid` bị hệ thống hủy; ghi OrderReturned ở dòng `returned`.
- `requirements/ORD-REQ-20261006-120227681.md` (M-13): DSH "tám trạng thái"; doanh thu, `getOrderSeries` (phần đã thu tiền) và `getTopProducts` theo `paid_at`; Xung đột thành [RESOLVED].
- `flows/ORD-FLOW-20261006-092320857.md` (M-04, M-03): sơ đồ 2 thêm `paid -> cancelled` do StockCommitFailed, `returned` phát OrderReturned.
- `design/ORD-DB-20261006-092703753.md` (M-04, R-02, M-03, R-15, M-13): `cancel_reason` thêm `stock_commit_failed`; bảng chuyển thêm `paid -> cancelled` hệ thống và event OrderReturned; cột kèm theo, audit hủy hệ thống; chỉ mục `paid_at`, tổng hợp DSH theo `paid_at`.
- `design/ORD-API-20261006-092703780.md` (M-03, M-04, M-08, R-15, R-30, M-13): `emits` thêm OrderReturned; consumes StockCommitFailed hủy đơn `paid`; `depends_on` AUTH có chủ đích khớp Ghi chú cột Phụ thuộc; giao diện DSH theo `paid_at`; lý do lịch sử thêm `stock_commit_failed`.
- `design/ORD-SEC-20261006-092703802.md` (M-04, R-02, M-03, R-15): thêm T22 (hủy tự động do StockCommitFailed), T8 ghi PAY không hoàn lần hai; Rủi ro còn lại cập nhật (đua đã giải quyết, OrderReturned đã có).
- `ui/order-detail.md` (M-04): nhãn cố định cho lý do `stock_commit_failed` ("Hết hàng giữ chỗ, đã hoàn tiền").
- `tests/ORD-TC-20261006-120228595.md` (M-04): đổi ca đơn `paid` no-op thành ca đơn `shipped`, `delivered` no-op; `tests/ORD-TC-20261006-120228419.md` (M-03, R-15): ShipmentReturned phát đúng một OrderReturned; `tests/ORD-TC-20261006-120228155.md` (M-13): thêm đơn COD thu tiền ngoài khoảng, doanh thu theo `paid_at`.
- `tests/ORD-TC-20261006-140000100.md` (thêm, M-04, R-02, T22): StockCommitFailed hủy đơn `paid` do hệ thống, audit, một OrderCancelled, trùng và audit lỗi.
- `questions.md` (M-03, M-04, M-06, M-08, M-13, R-28, R-30): mục 1, 2, 6, 7, 8 và C.12, Lệch 6 thành [RESOLVED]; thêm 1a (nay [RESOLVED], đợt 2b). Còn câu hỏi mở chờ nền: 3 (R-05), 4 (R-05), 5 (giới hạn tần suất hủy đơn, R-41).
- Làm rõ đợt 2b (M-04, R-02): `requirements/ORD-REQ-20261006-092320790.md` (BR1, BR11, BR14, kịch bản ORD-9, Xung đột; câu hỏi mở 1a đóng), `ORD-REQ-20261006-092320834.md` (BR3), `ORD-REQ-20261006-092320812.md` (BR3), `flows/ORD-FLOW-20261006-092320857.md` (sơ đồ 2: `pending -> cancelled` do StockCommitFailed), `design/ORD-DB` (bảng chuyển, cột kèm theo, audit), `design/ORD-API` (consumes), `design/ORD-SEC` (T22, Rủi ro còn lại), `tests/ORD-TC-20261006-120228595.md` (no-op chỉ ngoài `pending`, `paid`); thêm `tests/ORD-TC-20261006-140000200.md` (StockCommitFailed hủy đơn `pending`, PaymentSucceeded đến sau no-op, audit lỗi rollback). `questions.md`: 1a thành [RESOLVED].

### Đợt 3 (ORD đồng bộ nền R-03, R-04, R-05, R-17, R-19, R-41)
- `requirements/ORD-REQ-20261006-150000100.md` (thêm, R-04): khóa hủy đơn khi SHP bắt đầu bàn giao; `permission-rows.md` (thêm, một dòng `system`).
- `requirements/ORD-REQ-20261006-092320834.md` (R-04, R-41): BR2, BR10, kịch bản 409 khi đơn đã khóa bàn giao; `links` thêm hai ID.
- `requirements/ORD-REQ-20261006-092320790.md` (R-04, R-17, R-19): BR1, BR3, BR11, kịch bản OrderExpired có `order_code`, `user_id`.
- `requirements/ORD-REQ-20261006-120227589.md` (R-03): BR2 `grand_total > 0`, kịch bản đơn 0 đồng.
- `requirements/ORD-REQ-20261006-092320743.md`, `ORD-REQ-20261006-092320812.md`, `ui/order-admin-list.md`, `design/ORD-API-20261006-092703780.md`: thay các chuỗi câu hỏi mở bằng quyết định đã chốt.
- `design/ORD-DB` (R-03, R-04, R-05, R-19): CHECK `grand_total > 0`, cột `handoff_locked_at`, điều kiện hủy, mục 9a, ghi chú `seq`; `design/ORD-API` (R-04, R-17, R-19, R-41): `lockForHandoff`, `can_cancel`, 409; `design/ORD-SEC` (R-03, R-04, R-41): thêm T23, Rủi ro còn lại; `flows` (R-04); `ui/order-detail.md` (R-04).
- `tests/` (thêm 4: `ORD-TC-20261006-150000300`, `-150000400`, `-150000500`, `-150000600`; sửa: `-111225320`, `-111225088`, `-111226466`, `-120227861`, `-120228595`, `-140000100`).

## Quyết định thay người dùng 2026-10-06
- Câu A1 (sắp xếp danh sách staff/admin): mới nhất trước; lý do: nhất quán với customer, là mặc định đã dựng.
- Câu A2 (ô tìm mã đơn): khớp chính xác, không phân biệt hoa thường; lý do: mã đơn 12 ký tự ngẫu nhiên, khớp một phần làm dễ dò mã và nặng truy vấn (SB-06, SB-14).
- Câu A3 (thứ tự lịch sử): cũ nhất trước, khóa sắp xếp là `seq`; lý do: đúng tiến trình đơn, đã khớp R-05.
- Nền còn thiếu 3, 4, 5 (ShipmentFailed ghi lịch sử, `seq`, giới hạn tần suất hủy đơn): giữ cách hiểu của ORD, nền đợt 3 đã xác nhận (R-05, R-41); lý do: khớp nền, không cần quyết thêm.
- R-04 (đóng cửa sổ hủy đơn đã bàn giao): ORD khóa bằng cờ `handoff_locked_at` do SHP đặt qua `lockForHandoff(order_id, tx)`; lý do: ORD không phụ thuộc SHP (tránh vòng), cờ cùng giao dịch bàn giao nên đóng được cửa sổ; rủi ro nếu chọn sai: SHP không áp dụng thì cửa sổ vẫn mở (SHP ghi log đối soát), và cần thêm hàng giao diện ở nền.
- R-03 (đơn 0 đồng): ORD từ chối `grand_total <= 0` ở `createPending` và CHECK CSDL; lý do: theo nền, v1 không có đơn 0 đồng.
- R-19 (OrderExpired): payload thêm `order_code`, `user_id`; lý do: NTF báo `in_app`, theo nền.
- R-17 (`reservation_missing`): ORD hủy đơn `pending`/`paid` do hệ thống như hai mã kia; lý do: tiền đã được PAY hoàn `late_payment`, không để đơn kẹt `paid`.

## Đợt bán hộ 2026-10-15 (spec/changes/ban-ho-sale-nguon-don-20261015.md)
Chạy tự động, mọi câu đã có quyết định của người dùng ("chạy làm hết đi để done"), không còn `[OPEN]`.

1. [RESOLVED] Đơn hộ của khách có tài khoản: gắn `user_id` chỉ khi sale chọn khách từ kết quả tra của USR (SAL truyền `user_id`), ORD không tự ghép theo email hay điện thoại; khách thấy đơn trong danh sách của mình nhưng không thấy nguồn, người tạo, ghi chú, giá vốn (ORD-REQ-20261006-092320716 BR1, ORD-REQ-20261006-092320768 BR10).
2. [RESOLVED] Phương thức thanh toán đơn hộ: `cod`, `cash`, `bank_transfer`; vào `confirmed` ngay; ORD không tự đặt `payment_status` `succeeded`, ghi nhận tiền đã thu do PAY và SAL chốt (ORD-REQ-20261015-092748715 BR2, ORD-REQ-20261006-092320790 BR15).
3. [RESOLVED] Tên người tạo: tra tên hiện tại bằng `AuthApi.getDisplayNames` (khớp SHP-API và DSH-API), không lưu bản chụp tên ở Order.
4. [RESOLVED] Sale không hủy đơn ở ORD (403, ORD-REQ-20261006-092320834 không đổi); sale đọc đơn, lịch sử và danh sách của mình.
5. [RESOLVED] Danh sách đơn của sale dùng `GET /api/v1/admin/orders` với phạm vi `created_by` = phiên; `GET /api/v1/sales/orders` của SAL là cửa riêng cùng quy tắc sở hữu (SAL tự quyết cách gọi).
6. [RESOLVED] `GET /api/v1/order-sources` thêm role `staff` và tham số `include_inactive` (staff, admin): staff cần nguồn đã tắt để lọc đơn cũ; lead đã chấp nhận, SAL không cần sửa (SAL chỉ gọi với vai sale hoặc admin, mặc định nguồn đang bật).
7. [RESOLVED] Audit đơn hộ: ORD là bên ghi audit duy nhất cho việc tạo đơn (`order.created_ho`, cùng giao dịch, ORD-REQ-20261015-092748715 BR9). Đề nghị cho SAL: SAL-DB, SAL-API, SAL-REQ bỏ phần ghi AuditLog `sales.create_order` (và TC nhắc nó), giữ audit các thao tác riêng của SAL nếu có (không phải việc tạo đơn).
8. [RESOLVED] Số thứ tự mã đơn: bộ đếm cập nhật trong CÙNG giao dịch tạo đơn và dòng bộ đếm bị khóa tới khi giao dịch kết thúc, nên (a) giao dịch hoàn tác thì số của nó cũng hoàn tác, giao dịch kế tiếp lấy lại đúng số đó, không có lỗ; (b) giao dịch khác không thể xen vào giữa vì chờ ở khóa dòng; (c) dãy số của ngày liên tục 00001, 00002, ... không bị bỏ trống. Chỉ khi cách cấp đổi sang ngoài giao dịch thì mới có lỗ. Spec vẫn không đòi dãy liên tục (ORD-REQ-20261015-092748640 BR2). ADR-024 và SAL-DB còn ghi "số bị bỏ trống": việc sửa là của lead.

## Nền cần sửa
- spec/architecture.md; Bảng "Giao diện module": thêm hàng SAL -> ORD (`OrderApi.createHo(input, tx)`, `OrderApi.listSources(options?)`), DSH -> ORD (`OrderApi.getSourcesReport`, `OrderApi.getSalesReport`), SHP -> ORD (`OrderApi.getShipmentDisplay(order_ids)`; `findForShipment` trả thêm `created_by`) và ORD -> AUTH (`AuthApi.getDisplayNames`); cao; ORD
- spec/architecture.md; ADR-012 thứ tự khóa: thêm dòng bộ đếm mã đơn (`order_code_counters`) ngay trước Order, chỉ đường tạo đơn (`createPending`, `createHo`) lấy khóa này; trung bình; ORD
- spec/architecture.md; ADR-024 sửa câu "giao dịch hoàn tác thì số bị bỏ trống" cho khớp: bộ đếm cập nhật trong cùng giao dịch nên số hoàn tác theo, spec không đòi dãy liên tục; thấp; ORD
- spec/architecture.md; ADR-013 danh sách job nền: thêm `ord.sweep-code-counters` (xóa dòng `order_code_counters` cũ hơn hai ngày, tối đa 500 dòng mỗi lượt); thấp; ORD
- spec/domain/entities.md; `OrderStatusHistory.actor_role` thêm `sale` (dòng `pending` của đơn hộ do sale tạo); thấp; ORD
- spec/domain/entities.md; thêm ghi chú: bộ đếm mã đơn `order_code_counters` là bảng kỹ thuật của Order (không phải entity nghiệp vụ); thấp; ORD
- spec/domain/entities.md; Order thêm `handoff_locked_at` đã có ở ORD-DB: không đổi; thấp; ORD

## Tài liệu đã có chủ nhưng không nằm trong sổ change-control (cần lead đưa vào sổ hoặc xử lý khi duyệt)
- `spec/epics/ORD/ui/order-detail.md` và `order-admin-list.md` (đã duyệt, roles chưa có `sale`): phần mới nằm ở ba màn draft `order-list-source`, `order-detail-source`, `order-source-admin`; khi dựng gộp theo ghi chú trong màn.
- `spec/epics/ORD/requirements/ORD-REQ-20261006-092320812.md` (lịch sử trạng thái, roles chưa có `sale`): quyền sale đọc lịch sử nằm ở ORD-REQ-20261015-092748640 BR6 và ORD-API.
- `spec/epics/ORD/requirements/ORD-REQ-20261006-092320834.md` (hủy đơn): không đổi, sale 403 theo quy tắc từ chối mặc định.
