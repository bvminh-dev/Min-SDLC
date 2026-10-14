---
epic: CHK
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: CHK

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền của module (cấu hình, mã lỗi, schema đóng, cổng gọi sáu module), rồi phần tính tiền và xem lại, phiên, thao tác chọn, đặt hàng một giao dịch, job, controller, test API, giao diện web, E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. Phụ thuộc sang epic khác chỉ qua `CartApi`, `AddressService`, `PromotionApi`, `InventoryApi`, `ShippingApi`, `OrderApi` (cột Phụ thuộc của CHK ở `architecture.md`); CHK không gọi PAY (PAY nhận OrderCreated qua outbox) và không có consumer nào. Giao diện web và E2E do một agent con viết theo brief của agent triển khai (mã API cố định trước); bảng đột biến và test API do agent triển khai.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261009000200_checkout_tables` và `checkout.prisma`: bảng `checkout_sessions`, enum `checkout_status` và `checkout_payment_method`, CHECK (completed khi và chỉ khi có `order_id` và `completed_at`, mã giảm giá 1..50 ký tự), unique một phần (một phiên open mỗi người, một completed mỗi giỏ, một phiên mỗi đơn), khóa ngoại tới `carts` RESTRICT, `addresses` SET NULL, `shipping_methods` SET NULL, `orders` RESTRICT, chỉ mục cho hai job; quan hệ ngược ở `cart.prisma`, `user.prisma`, `shipping.prisma`, `order.prisma` | CHK-DB-20261006-105800565 | - | done |
| 2 | Nền của module: năm biến cấu hình (`RESERVATION_TTL`, `CHK_*`), hằng số và bảng bậc SB-14 (`config.ts`), 29 mã lỗi qua `registerProblem` (`errors.ts`), schema đầu vào đóng chống `__proto__`, NUL và trường tiền (`policy.ts`), cổng gọi sáu module có hạn 2 giây (`deps.service.ts`) | CHK-API-20261006-105800712, CHK-SEC-20261006-105800857 | 1 | done |
| 3 | Sửa nền `platform`: `ProblemExtra` nhận đối tượng JSON và danh sách đối tượng (`items`, `issues`, `review`, `address` của lỗi) | CHK-API-20261006-105800712 | 2 | done |
| 4 | Tính tiền bằng bigint và xem lại đơn (`price.service.ts`, `view.service.ts`): tạm tính từ CRT, giảm giá từ PRM (`count_attempt` = false), phí từ SHP theo city của địa chỉ thật, blockers, `expected_grand_total` | CHK-REQ-20261006-105051681, CHK-REQ-20261006-105051825, CHK-REQ-20261006-105051977 | 2 | done |
| 5 | Vòng đời phiên (`session.service.ts`): tạo (điền sẵn, một phiên open mỗi người, khóa tư vấn), khóa dòng phiên, gia hạn 30 phút, hết hạn phát hiện lúc có yêu cầu tới kèm CheckoutExpired, hủy | CHK-REQ-20261006-105050948, CHK-REQ-20261006-105052414 | 1, 2 | done |
| 6 | Các thao tác chọn (`select.service.ts`): địa chỉ, vận chuyển, thanh toán (giới hạn số tiền và đơn mở), áp và gỡ mã | CHK-REQ-20261006-105051095, CHK-REQ-20261006-105051242, CHK-REQ-20261006-105051386, CHK-REQ-20261006-105051536 | 4, 5 | done |
| 7 | Đặt hàng một giao dịch (`place.service.ts`, `idem.ts`): khóa tư vấn, khóa phiên, kiểm điều kiện theo thứ tự BR2, `lockForCheckout`, kiểm giá, giới hạn đơn mở, `createPending`, giữ hàng INV, giữ lượt PRM, `confirmCod`, phiên completed, CheckoutCompleted, AuditLog, `Idempotency-Key`, bộ chặn hold-and-wait | CHK-REQ-20261006-105052272, CHK-REQ-20261006-105052127, CHK-REQ-20261006-105051825, CHK-REQ-20261006-105051977 | 4, 5, 6 | done |
| 8 | Hai job nền (`jobs.service.ts`): hết hạn phiên mỗi 5 phút (lô 1000, `SKIP LOCKED`, CheckoutExpired cùng giao dịch), xóa bản chụp địa chỉ phiên đã đóng quá 30 ngày hằng ngày | CHK-REQ-20261006-105052414 | 5 | done |
| 9 | Controller, module, điểm vào công khai và AppModule; mỗi route khai `@Roles`, `@Action` khớp ma trận, `@RateLimit`, `@Validate` | CHK-API-20261006-105800712, CHK-SEC-20261006-105800857 | 5, 6, 7, 8 | done |
| 10 | Test API trên PostgreSQL thật (10 bộ ở `apps/api/test/checkout`, `AppModule` thật; CRT, USR, PRM, INV, SHP, ORD, PAY chạy thật; đua song song thật; tiến trình bị SIGKILL; `auditPermissions`; lược đồ bằng SQL) và đổi theo của test nền, test ORD, PRM | CHK-SEC-20261006-105800857 | 9 | done |
| 11 | Giao diện web: trang `/checkout` (bốn khối chọn, tóm tắt, banner giá đổi, giỏ đổi, hết hàng), màn chặn, trang kết quả đặt hàng | ui/checkout, ui/checkout-blocked, ui/checkout-complete | 9 | done |
| 12 | E2E trình duyệt thật (Chromium, bản build production của web, API thật, cổng điều khiển dựng dữ liệu) | CHK-E2E-20261006-110743989, CHK-E2E-20261006-110744027, CHK-E2E-20261006-110744065, CHK-E2E-20261006-110744101, CHK-E2E-20261006-110744136, CHK-E2E-20261006-110744171, CHK-E2E-20261006-110744206, CHK-E2E-20261006-110744240, CHK-E2E-20261006-110744274 | 11 | done |
| 13 | Bảng đột biến CHK (`apps/api/scripts/mutations-chk.json`, 127 đột biến) và cổng kiểm (`test/tooling/mutations-chk.spec.ts`) | CHK-SEC-20261006-105800857 | 10, 12 | done |
| 14 | Đồng bộ spec và mã (sdlc-impact 2026-10-13): `district` là khóa thứ sáu của `shipping_address` (CHK truyền `district`, ORD nhận); 409 `cart-limit-exceeded` của CRT đi qua đặt hàng; TC mới cho `district`, 429 (xem lại, hủy phiên, gỡ mã), giỏ vượt trần và job có hạn thời gian; chín đột biến; `session_status`, `CartApi`, 429 ở bảng lỗi đã đồng bộ ở spec | CHK-API-20261006-105800712, CHK-REQ-20261006-105052272, CHK-REQ-20261006-105051095, CHK-DB-20261006-105800565 | 1, 2, 3, 4, 5, 6 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (106 TC, 9 E2E; sáu TC `CHK-TC-20261013-...` do sdlc-impact thêm cho `district`, 429, giỏ vượt trần và job có hạn thời gian). Một TC có thể có nhiều test mang cùng ID (ca bổ sung từ đột biến, mang đuôi trong ngoặc). Ngoài các ID này còn test mang ID tài liệu CHK-DB (lược đồ, `test/checkout/db.spec.ts`) và CHK-SEC (hold-and-wait, bảng đột biến, `review.spec.ts`, `test/tooling/mutations-chk.spec.ts`). CRT, USR, PRM, INV, SHP, ORD, PAY chạy thật trong test API (không bản giả); số lời gọi đếm và độ trễ, lỗi gài bằng `jest.spyOn` trên các lớp `*Api` (gọi hàm thật rồi ném lỗi hay chờ). Ba TC giao diện CHK-TC-20261007-085336884, CHK-TC-20261007-085336918, CHK-TC-20261007-085336951 chạy ở `chk.e2e.spec.ts` (trình duyệt thật).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| CHK-E2E-20261006-110743989 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Customer đặt đơn COD đầy đủ từ giỏ, có mã giảm giá |
| CHK-E2E-20261006-110744027 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Customer đặt đơn VNPay, thấy hạn giữ hàng và sang màn thanh toán |
| CHK-E2E-20261006-110744065 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Giá đổi lúc đang ở checkout: xác nhận giá mới rồi mới đặt được |
| CHK-E2E-20261006-110744101 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Hết hàng khi đặt: báo mặt hàng thiếu, về giỏ chỉnh số lượng rồi đặt lại |
| CHK-E2E-20261006-110744136 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Địa chỉ bị sửa trong lúc checkout: phải xác nhận địa chỉ mới |
| CHK-E2E-20261006-110744171 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | YẾU: "mở liên kết xác minh trong email" dựng bằng token của hộp thư giả (mailToken) rồi mở trang /verify-email, không qua NTF, xem Lệch spec 23 |
| CHK-E2E-20261006-110744206 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Phiên checkout hết hạn: bắt đầu lại, giỏ còn nguyên |
| CHK-E2E-20261006-110744240 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Mã giảm giá bị tắt lúc đặt: gỡ mã rồi đặt với tổng mới |
| CHK-E2E-20261006-110744274 | E2E | apps/api/test/e2e/chk.e2e.spec.ts | pass | Đặt đơn COD rồi hủy trước khi giao |
| CHK-TC-20261006-110700762 | TC | apps/api/test/checkout/session.spec.ts | pass | Tạo phiên từ giỏ có hàng, điền sẵn mã, vận chuyển và địa chỉ mặc định |
| CHK-TC-20261006-110700801 | TC | apps/api/test/checkout/db.spec.ts | pass | Mở lần hai (kể cả hai tab cùng lúc) trả lại đúng phiên cũ |
| CHK-TC-20261006-110700835 | TC | apps/api/test/checkout/session.spec.ts | pass | Tài khoản chưa xác minh email bị chặn tạo phiên |
| CHK-TC-20261006-110700870 | TC | apps/api/test/checkout/session.spec.ts | pass | Giỏ trống và giỏ có hàng ngừng bán đều không tạo phiên |
| CHK-TC-20261006-110700904 | TC | apps/api/test/checkout/guard.spec.ts | pass | Guest nhận 401, staff và admin nhận 403 |
| CHK-TC-20261006-110700937 | TC | apps/api/test/checkout/session.spec.ts | pass | Giỏ cũ không còn hiện hành thì phiên cũ bị đóng và phiên mới gắn giỏ mới |
| CHK-TC-20261006-110700980 | TC | apps/api/test/checkout/session.spec.ts | pass | Giới hạn 10 lần tạo phiên mỗi phút: lần thứ 11 bị 429 |
| CHK-TC-20261006-110701017 | TC | apps/api/test/checkout/session.spec.ts | pass | Body có số tiền, id giỏ hay user_id bị 400 |
| CHK-TC-20261006-110701050 | TC | apps/api/test/checkout/address.spec.ts | pass | Chọn địa chỉ khác thì bản chụp và phí vận chuyển tính lại |
| CHK-TC-20261006-110701084 | TC | apps/api/test/checkout/address.spec.ts | pass | Địa chỉ của người khác, không tồn tại, sai định dạng hay có trường lạ |
| CHK-TC-20261006-110701117 | TC | apps/api/test/checkout/address.spec.ts | pass | Địa chỉ đã chọn bị xóa thì đặt hàng bị từ chối và phiên bỏ địa chỉ |
| CHK-TC-20261006-110701151 | TC | apps/api/test/checkout/address.spec.ts | pass | Địa chỉ bị sửa sau khi chọn: 409 address-changed, xác nhận rồi đặt với nội dung mới |
| CHK-TC-20261006-110701185 | TC | apps/api/test/checkout/address.spec.ts | pass | Khách chưa có địa chỉ: không đặt được và không lấy được phí |
| CHK-TC-20261006-110701216 | TC | apps/api/test/checkout/address.spec.ts | pass | Đổi địa chỉ mặc định ở sổ địa chỉ không đổi lựa chọn của phiên đang mở |
| CHK-TC-20261006-110701249 | TC | apps/api/test/checkout/address.spec.ts | pass | Phản hồi chứa địa chỉ không bị lưu đệm và log không có dữ liệu cá nhân |
| CHK-TC-20261006-110701283 | TC | apps/api/test/checkout/select.spec.ts | pass | Lấy phí theo city của địa chỉ thật rồi chọn phương thức |
| CHK-TC-20261006-110701316 | TC | apps/api/test/checkout/select.spec.ts | pass | Ngưỡng miễn phí tính trên tạm tính trước giảm giá |
| CHK-TC-20261006-110701351 | TC | apps/api/test/checkout/address.spec.ts | pass | Chưa có địa chỉ thì chưa xem được phí |
| CHK-TC-20261006-110701388 | TC | apps/api/test/checkout/select.spec.ts | pass | Phương thức đã tắt, không tồn tại hay sai định dạng cùng một 409 |
| CHK-TC-20261006-110701426 | TC | apps/api/test/checkout/select.spec.ts | pass | Không có phương thức nào đang bật chặn đặt hàng |
| CHK-TC-20261006-110701463 | TC | apps/api/test/checkout/select.spec.ts | pass | Phương thức bị tắt sau khi chọn: đặt hàng 409 và phiên bỏ lựa chọn |
| CHK-TC-20261006-110701498 | TC | apps/api/test/checkout/select.spec.ts | pass | Tạm tính đúng bằng ngưỡng miễn phí thì miễn phí |
| CHK-TC-20261006-110701532 | TC | apps/api/test/checkout/select.spec.ts | pass | Body chọn phương thức có thêm phí bị 400 |
| CHK-TC-20261006-110701564 | TC | apps/api/test/checkout/select.spec.ts | pass | Chọn VNPay rồi đổi sang COD, phản hồi nêu hậu quả |
| CHK-TC-20261006-110701599 | TC | apps/api/test/checkout/select.spec.ts | pass | VNPay với số tiền 4999 bị 422, COD vẫn chọn được |
| CHK-TC-20261006-110701633 | TC | apps/api/test/checkout/select.spec.ts | pass | Đơn 0 đồng bị 422 ở cả hai phương thức |
| CHK-TC-20261006-110701666 | TC | apps/api/test/checkout/select.spec.ts | pass | Đã có 3 đơn VNPay chờ thanh toán thì không chọn VNPay được |
| CHK-TC-20261006-110701709 | TC | apps/api/test/checkout/select.spec.ts | pass | Giá trị phương thức lạ hay dữ liệu thẻ bị 400 và không lưu gì |
| CHK-TC-20261006-110701748 | TC | apps/api/test/checkout/select.spec.ts | pass | Biên số tiền VNPay: 5000 và 999999999 được, 1000000000 bị từ chối |
| CHK-TC-20261006-110701784 | TC | apps/api/test/checkout/select.spec.ts | pass | Giới hạn đơn COD mở tính riêng, 5 đơn COD thì chặn COD nhưng không chặn VNPay |
| CHK-TC-20261006-110701818 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Áp mã có khoảng trắng và chữ thường, rồi gỡ hai lần |
| CHK-TC-20261006-110701854 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Mã mới chưa đạt giá trị tối thiểu bị 409 và giữ mã cũ |
| CHK-TC-20261006-110701888 | TC | apps/api/test/checkout/coupon.spec.ts | pass | YẾU: không đo độ lệch thời gian phản hồi giữa ba mã (ghi chú của TC), xem Lệch spec 11 |
| CHK-TC-20261006-110701922 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Quá ngưỡng dò mã thì 429 kèm Retry-After |
| CHK-TC-20261006-110701956 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Mã đã lưu bị tắt lúc đặt: 409 coupon-invalid, không có đơn, gỡ mã rồi đặt được |
| CHK-TC-20261006-110701993 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Tạm tính đúng bằng giá trị tối thiểu thì mã hợp lệ |
| CHK-TC-20261006-110702031 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Mã làm tổng bằng 0: áp được nhưng không chọn được thanh toán |
| CHK-TC-20261006-110702065 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Coupon còn một lượt, hai khách cùng đặt: một người giữ được, người kia không có đơn |
| CHK-TC-20261006-110702099 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Xem lại đơn nhiều lần với mã đã tắt không làm khách bị khóa dò mã |
| CHK-TC-20261006-110702133 | TC | apps/api/test/checkout/view.spec.ts | pass | Xem lại đơn đầy đủ: tổng do máy chủ tính đúng công thức |
| CHK-TC-20261006-110702169 | TC | apps/api/test/checkout/view.spec.ts | pass | Chưa chọn gì: blockers liệt kê đủ và phí là null |
| CHK-TC-20261006-110702205 | TC | apps/api/test/checkout/view.spec.ts | pass | Phiên của người khác, không tồn tại cùng một 404 |
| CHK-TC-20261006-110702243 | TC | apps/api/test/checkout/view.spec.ts | pass | PRM quá 2 giây: không bịa số giảm giá, không cho đặt |
| CHK-TC-20261006-110702278 | TC | apps/api/test/checkout/view.spec.ts | pass | Phiên đã completed: xem lại chỉ trả trạng thái và mã đơn |
| CHK-TC-20261006-110702313 | TC | apps/api/test/checkout/view.spec.ts | pass | Giá PRD đổi giữa hai lần xem: tổng và expected_grand_total đổi theo |
| CHK-TC-20261006-110702349 | TC | apps/api/test/checkout/view.spec.ts | pass | Giỏ 50 dòng, giá 1.000.000.000, số lượng 99: tổng không tràn |
| CHK-TC-20261006-110702386 | TC | apps/api/test/checkout/place.spec.ts | pass | Số khớp thì đặt thành công với số do máy chủ tính |
| CHK-TC-20261006-110702421 | TC | apps/api/test/checkout/place.spec.ts | pass | Giá tăng sau khi xem: 409 price-changed kèm tổng mới, không tạo gì |
| CHK-TC-20261006-110702458 | TC | apps/api/test/checkout/place.spec.ts | pass | Gửi expected_grand_total thấp giả: đơn không bao giờ được tạo với số đó |
| CHK-TC-20261006-110702492 | TC | apps/api/test/checkout/place.spec.ts | pass | Giỏ đổi ở tab khác: 409 cart-changed kèm bản xem lại mới |
| CHK-TC-20261006-110702525 | TC | apps/api/test/checkout/place.spec.ts | pass | Body thiếu hoặc sai kiểu expected_grand_total và cart_version bị 400 |
| CHK-TC-20261006-110702559 | TC | apps/api/test/checkout/place.spec.ts | pass | Giá giảm cũng phải xác nhận lại |
| CHK-TC-20261006-110702592 | TC | apps/api/test/checkout/place.spec.ts | pass | Giá đổi lần nữa sau khi xác nhận thì lại 409 |
| CHK-TC-20261006-110702626 | TC | apps/api/test/checkout/place.spec.ts | pass | cart_version lệch thắng price-changed khi cả hai cùng xảy ra |
| CHK-TC-20261006-110702659 | TC | apps/api/test/checkout/place.spec.ts | pass | Đủ hàng ở cả hai lớp thì đặt được |
| CHK-TC-20261006-110702693 | TC | apps/api/test/checkout/place.spec.ts | pass | Một mặt hàng hết: 409 insufficient-stock chỉ nêu mặt hàng thiếu, không giữ gì |
| CHK-TC-20261006-110702727 | TC | apps/api/test/checkout/place.spec.ts | pass | Dòng sản phẩm ngừng bán chặn trước khi giữ hàng |
| CHK-TC-20261006-110702761 | TC | apps/api/test/checkout/place.spec.ts | pass | INV quá 2 giây: 503, không có đơn nào |
| CHK-TC-20261006-110702794 | TC | apps/api/test/checkout/place.spec.ts | pass | Còn đúng 2, mua 2: thành công và available về 0 |
| CHK-TC-20261006-110702827 | TC | apps/api/test/checkout/place.spec.ts | pass | YẾU: lặp 20 lần thay vì 50, cộng ca tải hỗn hợp 14 khách kiểm bảo toàn, xem Lệch spec 11 |
| CHK-TC-20261006-110702860 | TC | apps/api/test/checkout/place.spec.ts | pass | Lớp mềm báo đủ nhưng người khác mua hết đúng lúc: lớp cứng quyết |
| CHK-TC-20261006-110702894 | TC | apps/api/test/checkout/guard.spec.ts | pass | Đơn VNPay: Order pending, hai reservation hạn 15 phút trùng payment_expires_at của Order, một lượt coupon |
| CHK-TC-20261006-110702928 | TC | apps/api/test/checkout/place.spec.ts | pass | Đơn COD: reservation không có hạn |
| CHK-TC-20261006-110702962 | TC | apps/api/test/checkout/place.spec.ts | pass | Thiếu hàng: không có Order nào kể cả đơn pending rỗng |
| CHK-TC-20261006-110702996 | TC | apps/api/test/checkout/place.spec.ts | pass | Coupon hết lượt sau khi hàng đã giữ: hoàn tác cả hàng đã giữ |
| CHK-TC-20261006-110703029 | TC | apps/api/test/checkout/idem.spec.ts | pass | Lỗi gài sau khi INV giữ xong và trước khi cam kết: không còn gì trong CSDL |
| CHK-TC-20261006-110703063 | TC | apps/api/test/checkout/place.spec.ts | pass | Quá 15 phút không thanh toán: INV hết hạn, ORD expired, PRM nhả, CHK không làm gì |
| CHK-TC-20261006-110703096 | TC | apps/api/test/checkout/place.spec.ts | pass | Giỏ 50 dòng x 99, tất cả đủ hàng: 50 reservation |
| CHK-TC-20261006-110703129 | TC | apps/api/test/checkout/place.spec.ts | pass | Hai đơn VNPay liên tiếp cùng mặt hàng còn đủ: mỗi đơn có hạn riêng |
| CHK-TC-20261006-110703163 | TC | apps/api/test/checkout/guard.spec.ts | pass | CHK không nhận event: StockReserved, StockReleased giả không đổi phiên; không có endpoint nhận event |
| CHK-TC-20261006-110703196 | TC | apps/api/test/checkout/db.spec.ts | pass | Đặt đơn VNPay: một Order pending, hàng và coupon được giữ, phiên completed, CheckoutCompleted phát |
| CHK-TC-20261006-110703231 | TC | apps/api/test/checkout/place.spec.ts | pass | Đặt đơn COD: pending rồi confirmed trong một giao dịch, INV, PRM và SHP nhận OrderConfirmed |
| CHK-TC-20261006-110703267 | TC | apps/api/test/checkout/place.spec.ts | pass | Hết hàng lúc đặt: không có đơn, phiên còn open, CheckoutCompleted không phát |
| CHK-TC-20261006-110703301 | TC | apps/api/test/checkout/place.spec.ts | pass | Email bị bỏ xác minh giữa chừng: đặt hàng bị 403 |
| CHK-TC-20261006-110703334 | TC | apps/api/test/checkout/place.spec.ts | pass | Thiếu địa chỉ và thanh toán: 409 checkout-incomplete |
| CHK-TC-20261006-110703367 | TC | apps/api/test/checkout/place.spec.ts | pass | Body có dòng hàng, giá, tổng hoặc user_id bị 400 |
| CHK-TC-20261006-110703400 | TC | apps/api/test/checkout/place.spec.ts | pass | Guest 401, staff và admin 403, customer khác 404 |
| CHK-TC-20261006-110703453 | TC | apps/api/test/checkout/guard.spec.ts | pass | Yêu cầu từ Origin ngoài danh sách bị chặn CSRF |
| CHK-TC-20261006-110703521 | TC | apps/api/test/checkout/place.spec.ts | pass | Bấm đặt hai lần song song: một đơn, yêu cầu còn lại nhận lại đơn đó |
| CHK-TC-20261006-110703556 | TC | apps/api/test/checkout/place.spec.ts | pass | Hai phiên của cùng một giỏ: phiên thứ hai bị 409 cart-already-ordered |
| CHK-TC-20261006-110703589 | TC | apps/api/test/checkout/place.spec.ts | pass | YẾU: không dựng được hai phiên của hai giỏ cùng một người (nền cấm); test dùng hai yêu cầu song song khác khóa trên cùng phiên và ca đủ 3 đơn, xem Lệch spec 10 |
| CHK-TC-20261006-110703623 | TC | apps/api/test/checkout/place.spec.ts | pass | Đặt lần thứ 6 trong một phút bị 429 |
| CHK-TC-20261006-110703657 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Khách rời checkout: phiên cancelled, giỏ và kho không đổi |
| CHK-TC-20261006-110703691 | TC | apps/api/test/checkout/db.spec.ts | pass | YẾU: hai lượt job đồng thời trong cùng một tiến trình (hai kết nối), không phải hai tiến trình, xem Lệch spec 10 |
| CHK-TC-20261006-110703725 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Hủy phiên đã completed: 409 kèm mã đơn |
| CHK-TC-20261006-110703759 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Thao tác ghi lên phiên đã expired bị 409 checkout-session-closed |
| CHK-TC-20261006-110703793 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Hủy phiên của người khác hay không tồn tại cùng một 404 |
| CHK-TC-20261006-110703826 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Quá expires_at nhưng job chưa chạy: yêu cầu thấy phiên đã hết hạn ngay |
| CHK-TC-20261006-110703860 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Chỉ xem lại liên tục không kéo dài phiên |
| CHK-TC-20261006-110703893 | TC | apps/api/test/checkout/lifecycle.spec.ts | pass | Giỏ hiện hành đã khác giỏ của phiên: phiên bị cancelled khi có yêu cầu |
| CHK-TC-20261006-110703926 | TC | apps/api/test/checkout/db.spec.ts | pass | Phiên đã đóng quá 30 ngày: bản chụp địa chỉ bị xóa, bản ghi vẫn còn |
| CHK-TC-20261006-120840748 | TC | apps/api/test/checkout/idem.spec.ts | pass | Đặt hàng thiếu hoặc sai Idempotency-Key bị 400, không tạo gì |
| CHK-TC-20261006-120848703 | TC | apps/api/test/checkout/idem.spec.ts | pass | Gửi lại cùng Idempotency-Key trả đơn cũ; cùng khóa khác nội dung bị 422 |
| CHK-TC-20261006-120856566 | TC | apps/api/test/checkout/idem.spec.ts | pass | Đặt hàng thành công ghi một dòng audit không có dữ liệu cá nhân; thất bại không ghi |
| CHK-TC-20261006-120905422 | TC | apps/api/test/checkout/idem.spec.ts | pass | Giết tiến trình sau cam kết trước khi phát: CheckoutCompleted vẫn được giao đúng một lần hiệu lực |
| CHK-TC-20261006-122751355 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Khách đã dùng đủ per_user_limit lượt coupon: đặt bị 409 coupon-invalid, người khác vẫn đặt được |
| CHK-TC-20261006-122751396 | TC | apps/api/test/checkout/coupon.spec.ts | pass | Lượt coupon released không tính vào per_user_limit: A đặt được lượt thứ hai |
| CHK-TC-20261007-085336884 | TC | apps/api/test/e2e/chk.e2e.spec.ts | pass | Mở checkout quá 10 lần mỗi phút hiện thông báo thử lại sau N giây rồi mở lại được khi hết giờ chờ |
| CHK-TC-20261007-085336918 | TC | apps/api/test/e2e/chk.e2e.spec.ts | pass | Đơn VNPay chờ thanh toán: đếm ngược tới hạn giữ hàng rồi cảnh báo quá hạn và nút Thanh toán ngay không còn |
| CHK-TC-20261007-085336951 | TC | apps/api/test/e2e/chk.e2e.spec.ts | pass | Thử mã giảm giá quá nhiều ở checkout hiện thử lại sau N giây, nút Áp dụng mở lại khi hết giờ chờ |
| CHK-TC-20261013-210240854 | TC | apps/api/test/checkout/sync.spec.ts | pass | Đơn lưu `district` làm khóa thứ sáu (chuỗi và null) |
| CHK-TC-20261013-210241009 | TC | apps/api/test/checkout/sync.spec.ts | pass | Xem lại phiên: 120 lần mỗi phút, lần 121 là 429 kèm Retry-After; người khác không bị ảnh hưởng |
| CHK-TC-20261013-210241168 | TC | apps/api/test/checkout/sync.spec.ts | pass | Hủy phiên: 120 lần mỗi phút, lần 121 là 429 |
| CHK-TC-20261013-210241326 | TC | apps/api/test/checkout/sync.spec.ts | pass | Gỡ mã: 60 lần mỗi phút (chung bộ đếm chọn), lần 61 là 429 |
| CHK-TC-20261013-210241484 | TC | apps/api/test/checkout/sync.spec.ts | pass | Giỏ vượt trần do giá tăng: đặt hàng 409 `cart-limit-exceeded`, hoàn tác sạch; về đúng trần thì đặt được |
| CHK-TC-20261013-211638651 | TC | apps/api/test/checkout/sync.spec.ts | pass | Job hết hạn phiên và xóa bản chụp: hạn thời gian 0, tín hiệu hủy, giới hạn lô, idempotent |

## Kiểm đột biến
Bảng `apps/api/scripts/mutations-chk.json` (127 đột biến) chạy bằng script chung `.claude/skills/sdlc-review/scripts/mutate.mjs`; cổng kiểm `apps/api/scripts/check-mutations.mjs` (không `lọt` chưa giải thích, mỗi SB `Kiểm bằng: test` của CHK-SEC có ít nhất một đột biến, đoạn cần phá còn đúng một lần, test và ID có thật) chạy trong `test/tooling/mutations-chk.spec.ts`. Phủ: SB-05, SB-06, SB-08, SB-11, SB-13, SB-14, SB-18, SB-19, SB-20, SB-23, SB-24, SB-25, SB-26, SB-27, SB-31, SB-33, SB-40; từng CHECK, unique một phần, khóa ngoại của migration; nền sửa kèm (CSRF dùng cho route đặt hàng); giao diện (hàm thuần và hai đột biến E2E: bỏ `Idempotency-Key`, sai `cart_version`). Chạy trong bản sao của cây mã (`/tmp`) để không đụng máy chủ E2E đang chạy; lượt đầu 6 đột biến `lọt` (khóa dòng phiên khi đặt song song, `completed_at`, `Retry-After`, hạn gọi mặc định, hết hạn trong khe, nhánh `degraded` thừa) đã được sửa bằng test mới hoặc bỏ mã thừa rồi chạy lại: tất cả `bắt`. Cột Test đỏ ghi ID của TC (hoặc TC gần nhất khi test mang ID CHK-DB, CHK-SEC) và tệp test.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-06, T1: khóa dòng phiên không lọc theo người dùng (hủy phiên của người khác) (`session.service.ts`) | CHK-TC-20261006-110703793 (lifecycle.spec.ts) | bắt |
| SB-06, T1: đọc phiên không lọc theo người dùng (xem phiên của người khác) (`session.service.ts`) | CHK-TC-20261006-110702205 (view.spec.ts) | bắt |
| SB-06, T1: địa chỉ không tìm thấy trả mã khác 404 address-not-found (lộ khác biệt người khác và không có) (`select.service.ts`) | CHK-TC-20261006-110701084 (address.spec.ts) | bắt |
| SB-06, T1: phương thức vận chuyển sai định dạng trả 400 thay vì cùng 409 (`select.service.ts`) | CHK-TC-20261006-110701388 (select.spec.ts) | bắt |
| SB-05, T4: staff được đặt hàng (role của route place-order) (`checkout.controller.ts`) | CHK-TC-20261006-110703400 (place.spec.ts) | bắt |
| SB-05, T4: staff được tạo phiên (`checkout.controller.ts`) | CHK-TC-20261006-110700904 (session.spec.ts) | bắt |
| SB-23, T2: body đóng cho phép trường lạ (grand_total, items, user_id) (`policy.ts`) | CHK-TC-20261006-110703367 (place.spec.ts) | bắt |
| SB-23, T2: so khớp expected_grand_total bị bỏ (tin số của client) (`place.service.ts`) | CHK-TC-20261006-110702458 (place.spec.ts) | bắt |
| SB-23, T2: so khớp price-changed chỉ báo khi giá TĂNG (giảm giá không phải xác nhận) (`place.service.ts`) | CHK-TC-20261006-110702559 (place.spec.ts) | bắt |
| SB-23, T2: tổng tiền của đơn lệch công thức (items_total cộng 1) (`place.service.ts`) | CHK-TC-20261006-110702386 (place.spec.ts) | bắt |
| SB-23, T2: ngưỡng miễn phí tính trên tạm tính SAU giảm giá (`price.service.ts`) | CHK-TC-20261006-110701316 (select.spec.ts) | bắt |
| SB-23, T2: tổng cộng không trừ giảm giá (`price.service.ts`) | CHK-TC-20261006-110702133 (view.spec.ts) | bắt |
| SB-23, T2: tổng cộng không cộng phí vận chuyển (`price.service.ts`) | CHK-TC-20261006-110702133 (view.spec.ts) | bắt |
| SB-23, T11: phí tính theo city của bản chụp thay vì địa chỉ thật (bỏ đọc lại địa chỉ khi đặt) (`place.service.ts`) | CHK-TC-20261006-110701151 (address.spec.ts) | bắt |
| SB-23, T11: địa chỉ so updated_at bằng `===` (không phát hiện sửa) (`session.service.ts`) | CHK-TC-20261006-110701151 (address.spec.ts) | bắt |
| SB-23, T11: địa chỉ đã xóa không bỏ lựa chọn của phiên (`place.service.ts`) | CHK-TC-20261006-110701117 (address.spec.ts) | bắt |
| SB-23, T11: bản chụp địa chỉ không cập nhật sau address-changed (`place.service.ts`) | CHK-TC-20261006-110701151 (address.spec.ts) | bắt |
| SB-23, T11: đơn lưu bản chụp địa chỉ thiếu district (sáu khóa) | CHK-TC-20261013-210240854 | bắt |
| SB-23, T20: zero_total chỉ chặn số âm (`price.service.ts`) | CHK-TC-20261006-110701633 (select.spec.ts) | bắt |
| SB-23, T20: trần VNPay 1.000.000.000 (`config.ts`) | CHK-TC-20261006-110701748 (select.spec.ts) | bắt |
| SB-23, T20: sàn VNPay 4.999 (`config.ts`) | CHK-TC-20261006-110701599 (select.spec.ts) | bắt |
| SB-23, T20: giới hạn số tiền áp cho cả COD (`price.service.ts`) | CHK-TC-20261006-110701599 (select.spec.ts) | bắt |
| SB-23, T20: lúc đặt hàng không kiểm giới hạn số tiền (`place.service.ts`) | CHK-TC-20261006-110701633 (select.spec.ts) | bắt |
| SB-23: tổng tạm tính cắt về trần SHP (4,95 nghìn tỷ ném RangeError thành lỗi phụ thuộc) (`price.service.ts`) | CHK-TC-20261006-110702349 (view.spec.ts) | bắt |
| SB-26, T3: tạo phiên không kiểm email_verified (`session.service.ts`) | CHK-TC-20261006-110700835 (session.spec.ts) | bắt |
| SB-26, T3: đặt hàng không kiểm lại email_verified (`place.service.ts`) | CHK-TC-20261006-110703301 (place.spec.ts) | bắt |
| SB-25, T5: bỏ khóa dòng phiên (FOR UPDATE) khi đặt hàng song song (`session.service.ts`) | CHK-TC-20261006-110703521 (review.spec.ts) | bắt |
| SB-25, T5: phiên đã completed không phát lại đơn (lớp hai idempotency) (`place.service.ts`) | CHK-TC-20261006-110703521 (place.spec.ts) | bắt |
| SB-25, T5: bỏ kiểm giỏ đã có phiên completed (`place.service.ts`) | CHK-TC-20261006-110703556 (place.spec.ts) | bắt |
| SB-25, T5: completed_at của phiên lệch một ngày (`place.service.ts`) | CHK-TC-20261006-110703196 (place.spec.ts) | bắt |
| SB-25, T6: giữ hàng bị bỏ qua khi INV báo thiếu (`place.service.ts`) | CHK-TC-20261006-110702693 (place.spec.ts) | bắt |
| SB-25, T14: giữ lượt coupon thất bại không hoàn tác (`place.service.ts`) | CHK-TC-20261006-110702996 (place.spec.ts) | bắt |
| SB-25, T14: COD không xác nhận trong cùng giao dịch (`place.service.ts`) | CHK-TC-20261006-110703231 (place.spec.ts) | bắt |
| SB-25, T14: hạn giữ hàng truyền cho INV là rỗng (`place.service.ts`) | CHK-TC-20261006-110702894 (place.spec.ts) | bắt |
| SB-25, T14: hạn giữ hàng của COD vẫn có (không rỗng) (`place.service.ts`) | CHK-TC-20261006-110702928 (place.spec.ts) | bắt |
| SB-25, T14: RESERVATION_TTL mặc định 10 phút (`config.ts`) | CHK-TC-20261006-110702894 (place.spec.ts) | bắt |
| SB-25, T14: payment_expires_at của đơn là rỗng cho VNPay (`place.service.ts`) | CHK-TC-20261006-110702894 (place.spec.ts) | bắt |
| SB-25, T14: lỗi sau createPending không hoàn tác (bắt lỗi nuốt) (`deps.service.ts`) | CHK-TC-20261006-110703029 (place.spec.ts) | bắt |
| SB-25, T14: kiểm giữ lượt PRM không so khớp amount (`place.service.ts`) | CHK-TC-20261006-110702996 (review.spec.ts) | bắt |
| SB-33, T7: giới hạn đơn mở so `>` thay `>=` ở bước đặt (`place.service.ts`) | CHK-TC-20261006-110703589 (place.spec.ts) | bắt |
| SB-33, T7: giới hạn VNPay mặc định 4 (`config.ts`) | CHK-TC-20261006-110701666 (select.spec.ts) | bắt |
| SB-33, T7: giới hạn COD mặc định 6 (`config.ts`) | CHK-TC-20261006-110701784 (select.spec.ts) | bắt |
| SB-33, T7: chọn COD tính theo số đơn VNPay (`select.service.ts`) | CHK-TC-20261006-110701784 (select.spec.ts) | bắt |
| SB-33, T7: lý do per_user_limit_reached đổi thành mã khác (`price.service.ts`) | CHK-TC-20261006-122751355 (coupon.spec.ts) | bắt |
| SB-14, T9: tạo phiên 11 lần mỗi phút (`config.ts`) | CHK-TC-20261006-110700980 (session.spec.ts) | bắt |
| SB-14, T9: đặt hàng 6 lần mỗi phút (`config.ts`) | CHK-TC-20261006-110703623 (place.spec.ts) | bắt |
| SB-14, T8: áp mã không đếm dò mã (count_attempt = false) (`select.service.ts`) | CHK-TC-20261006-110701888 (coupon.spec.ts) | bắt |
| SB-14, T8: xem lại đếm vào bộ đếm dò mã (count_attempt = true) (`price.service.ts`) | CHK-TC-20261006-110702099 (coupon.spec.ts) | bắt |
| SB-14, T8: 429 của PRM đổi thành 503 (`select.service.ts`) | CHK-TC-20261006-110701922 (coupon.spec.ts) | bắt |
| SB-11, T19: số thực được nhận làm expected_grand_total (`policy.ts`) | CHK-TC-20261006-110702525 (place.spec.ts) | bắt |
| SB-11, T19: payment_method nhận giá trị lạ (`config.ts`) | CHK-TC-20261006-110701709 (select.spec.ts) | bắt |
| SB-11, T19: tạo phiên nhận trường lạ trong body (cart_id, user_id) (`policy.ts`) | CHK-TC-20261006-110701017 (session.spec.ts) | bắt |
| SB-40, T21: thiếu Idempotency-Key vẫn đặt được (`checkout.controller.ts`) | CHK-TC-20261006-120840748 (idem.spec.ts) | bắt |
| SB-40, T21: định dạng khóa 1..64 ký tự (`config.ts`) | CHK-TC-20261006-120840748 (idem.spec.ts) | bắt |
| SB-40, T21: request_hash không gồm tham số đường dẫn (id phiên) (`place.service.ts`) | CHK-TC-20261006-120848703 (idem.spec.ts) | bắt |
| SB-40, T21: phát lại trả 201 và replayed false (không phát lại đúng) (`place.service.ts`) | CHK-TC-20261006-120848703 (idem.spec.ts) | bắt |
| SB-40, T21: controller luôn trả 201 (`checkout.controller.ts`) | CHK-TC-20261006-110703521 (place.spec.ts) | bắt |
| SB-19, T13: AuditLog ghi action khác (`place.service.ts`) | CHK-TC-20261006-120856566 (idem.spec.ts) | bắt |
| SB-19, T13: AuditLog ghi actor_role system (`place.service.ts`) | CHK-TC-20261006-120856566 (idem.spec.ts) | bắt |
| SB-19, T13: AuditLog ghi dữ liệu cá nhân (địa chỉ) trong after (`place.service.ts`) | CHK-TC-20261006-120856566 (idem.spec.ts) | bắt |
| SB-19, T13: AuditLog target là phiên thay vì đơn (`place.service.ts`) | CHK-TC-20261006-120856566 (idem.spec.ts) | bắt |
| SB-27, T15: CheckoutCompleted mang type khác (`place.service.ts`) | CHK-TC-20261006-110703196 (place.spec.ts) | bắt |
| SB-27, T15: CheckoutCompleted thiếu order_id (`place.service.ts`) | CHK-TC-20261006-110703196 (place.spec.ts) | bắt |
| SB-27, T15: CheckoutExpired do job mang type khác (`jobs.service.ts`) | CHK-TC-20261006-110703691 (lifecycle.spec.ts) | bắt |
| SB-27, T15: CheckoutExpired lúc có yêu cầu tới mang payload có order_id (`session.service.ts`) | CHK-TC-20261006-110703826 (lifecycle.spec.ts) | bắt |
| SB-24: phiên quá hạn mà job chưa chạy vẫn đặt được (không kiểm expires_at) (`place.service.ts`) | CHK-TC-20261006-110703826 (lifecycle.spec.ts) | bắt |
| SB-24: xem lại không phát hiện giỏ khác giỏ của phiên (`view.service.ts`) | CHK-TC-20261006-110703893 (lifecycle.spec.ts) | bắt |
| SB-24: đặt hàng không phát hiện giỏ khác giỏ của phiên (`place.service.ts`) | CHK-TC-20261006-110703893 (lifecycle.spec.ts) | bắt |
| SB-24: job hết hạn bỏ điều kiện expires_at (`jobs.service.ts`) | CHK-TC-20261006-110703691 (lifecycle.spec.ts) | bắt |
| SB-24: job xóa bản chụp tính 20 ngày (`config.ts`) | CHK-TC-20261006-110703926 (lifecycle.spec.ts) | bắt |
| SB-08: job xóa bản chụp cả phiên open (`jobs.service.ts`) | CHK-TC-20261006-110703926 (lifecycle.spec.ts) | bắt |
| SB-24: hủy phiên không đổi trạng thái cancelled (`session.service.ts`) | CHK-TC-20261006-110703657 (lifecycle.spec.ts) | bắt |
| SB-24: hủy phiên completed thành công (204) (`session.service.ts`) | CHK-TC-20261006-110703725 (lifecycle.spec.ts) | bắt |
| SB-24: xem lại kéo dài phiên (có ghi gia hạn) (`view.service.ts`) | CHK-TC-20261006-110703860 (lifecycle.spec.ts) | bắt |
| SB-08, T10: phản hồi xem lại cho lưu đệm (Cache-Control public) (`checkout.controller.ts`) | CHK-TC-20261006-110701249 (address.spec.ts) | bắt |
| SB-18, T10: log chọn địa chỉ ghi nội dung địa chỉ (`select.service.ts`) | CHK-TC-20261006-110701249 (address.spec.ts) | bắt |
| SB-20, T17: insufficient-stock lộ mặt hàng đủ hàng cùng số tồn (`place.service.ts`) | CHK-TC-20261006-110702693 (place.spec.ts) | bắt |
| SB-20, T17: tình trạng hàng lộ số tồn của dòng đủ hàng (`price.service.ts`) | CHK-TC-20261006-110702133 (view.spec.ts) | bắt |
| SB-31, T18: hạn gọi module khác mặc định 3 giây (`config.ts`) | CHK-TC-20261006-110702761 (place.spec.ts) | bắt |
| SB-31, T18: lời gọi module khác không có hạn (`deps.service.ts`) | CHK-TC-20261006-110702761 (place.spec.ts) | bắt |
| SB-31, T18: mã lỗi của SHP bị nuốt thành lỗi phụ thuộc (`deps.service.ts`) | CHK-TC-20261006-110702243 (view.spec.ts) | bắt |
| SB-31, T18: bộ chặn hold-and-wait bị bỏ (pool 2 kết nối) (`place.service.ts`) | CHK-TC-20261006-110702761 (review.spec.ts) | bắt |
| SB-31, T18: bộ chặn cho phép cả pool (không chừa kết nối thứ hai) (`place.service.ts`) | CHK-TC-20261006-110702761 (review.spec.ts) | bắt |
| SB-31, T18: PRM quá hạn lúc đặt bị coi là mã không còn dùng được (strict bị bỏ) (`price.service.ts`) | CHK-TC-20261006-110702243 (review.spec.ts) | bắt |
| SB-31, T18: SHP quá hạn lúc xem lại không đánh dấu degraded (`view.service.ts`) | CHK-TC-20261006-110702243 (review.spec.ts) | bắt |
| SB-31, T18: quote ném method-unavailable bị đổi thành lỗi phụ thuộc (`price.service.ts`) | CHK-TC-20261006-110701463 (review.spec.ts) | bắt |
| SB-23, T2: giảm giá không bị chặn bằng tạm tính (`price.service.ts`) | CHK-TC-20261006-110702133 (review.spec.ts) | bắt |
| SB-14, T9: áp mã 11 lần mỗi phút (`config.ts`) | CHK-TC-20261006-110701922 (review.spec.ts) | bắt |
| SB-11, T19: mã giảm giá tối đa 51 ký tự (`config.ts`) | CHK-TC-20261006-110701888 (review.spec.ts) | bắt |
| SB-11, T19: khóa __proto__ của JSON không bị từ chối (`policy.ts`) | CHK-TC-20261006-110701017 (review.spec.ts) | bắt |
| SB-11, T19: id dài tùy ý được nhận (không giới hạn 100) (`policy.ts`) | CHK-TC-20261006-110701017 (review.spec.ts) | bắt |
| SB-24: thao tác ghi không gia hạn phiên (`session.service.ts`) | CHK-TC-20261006-110703860 (review.spec.ts) | bắt |
| SB-24: ghi lên phiên quá hạn không chuyển expired (`session.service.ts`) | CHK-TC-20261006-110703826 (review.spec.ts) | bắt |
| SB-24: đặt hàng bị từ chối không gia hạn phiên (`place.service.ts`) | CHK-TC-20261006-110702421 (review.spec.ts) | bắt |
| SB-24: tạo phiên mới đóng phiên cũ quá hạn thành cancelled (mất CheckoutExpired) (`session.service.ts`) | CHK-TC-20261006-110700937 (review.spec.ts) | bắt |
| SB-24: hủy phiên quá hạn thành cancelled (mất CheckoutExpired) (`session.service.ts`) | CHK-TC-20261006-110703657 (review.spec.ts) | bắt |
| SB-24: điền sẵn phương thức vận chuyển không kiểm còn bật (`session.service.ts`) | CHK-TC-20261006-110700762 (review.spec.ts) | bắt |
| SB-26: blocker email_not_verified bị bỏ khỏi bản xem lại (`view.service.ts`) | CHK-TC-20261006-110703301 (review.spec.ts) | bắt |
| SB-23: blocker số tiền VNPay sàn 4.999 (`view.service.ts`) | CHK-TC-20261006-110702349 (review.spec.ts) | bắt |
| SB-23: blocker zero_total bị bỏ (`view.service.ts`) | CHK-TC-20261006-110702349 (review.spec.ts) | bắt |
| SB-33: blocker too_many_open_orders bị bỏ (`view.service.ts`) | CHK-TC-20261006-110702349 (review.spec.ts) | bắt |
| BR2 (105051825): bản xem lại cart-changed lệch thứ tự với price-changed (`place.service.ts`) | CHK-TC-20261006-110702626 (place.spec.ts) | bắt |
| BR8 (105051825): coupon-invalid không ưu tiên hơn price-changed (`place.service.ts`) | CHK-TC-20261006-110701956 (coupon.spec.ts) | bắt |
| BR1 (105052272): phiên ghi sai hạn 30 phút (tạo phiên) (`session.service.ts`) | CHK-TC-20261006-110700762 (session.spec.ts) | bắt |
| BR3 (105051681): cờ address changed luôn false khi xem lại (`view.service.ts`) | CHK-TC-20261006-110701151 (address.spec.ts) | bắt |
| BR5 (105051681): blocker missing_address bị bỏ (`view.service.ts`) | CHK-TC-20261006-110702169 (view.spec.ts) | bắt |
| BR5 (105051681): can_place_order bỏ qua blockers (`view.service.ts`) | CHK-TC-20261006-110702169 (view.spec.ts) | bắt |
| SB-13, T12: CSRF bỏ qua khi Origin lạ ở place-order (guard nền cho phép mọi Origin) (`csrf.guard.ts`) | CHK-TC-20261006-110703453 (place.spec.ts) | bắt |
| SB-13, T12: CSRF không chặn phương thức DELETE (hủy phiên) (`csrf.guard.ts`) | CHK-TC-20261006-110703453 (guard.spec.ts) | bắt |
| Giao diện: trạng thái phiên đóng đọc trường status (mã HTTP) thay vì session_status (`checkout.ts`) | CHK-TC-20261006-110703759 (web-lib.spec.ts) | bắt |
| Giao diện: nhãn blocker tra trực tiếp (khóa của Object.prototype lọt) (`checkout.ts`) | CHK-TC-20261006-110702169 (web-lib.spec.ts) | bắt |
| Giao diện: nhãn tồn kho lộ sai số (Chỉ còn N + 1) (`checkout.ts`) | CHK-TC-20261006-110702693 (web-lib.spec.ts) | bắt |
| Giao diện: lỗi đơn 0 đồng ánh xạ thành lỗi khoảng VNPay (`checkout.ts`) | CHK-TC-20261006-110701599 (web-lib.spec.ts) | bắt |
| Giao diện: trang kết quả mất cờ replayed (`checkout.ts`) | CHK-TC-20261007-085336918 (web-lib.spec.ts) | bắt |
| Giao diện: giây chờ mặc định 30 thay vì 60 (`checkout.ts`) | CHK-TC-20261007-085336884 (web-lib.spec.ts) | bắt |
| CHK-DB: bỏ CHECK completed khi và chỉ khi có order_id (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: bỏ CHECK completed khi và chỉ khi có completed_at (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: bỏ CHECK độ dài mã giảm giá (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: unique phiên open mỗi người thành chỉ mục thường (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: unique phiên completed mỗi giỏ thành chỉ mục thường (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: unique phiên mỗi đơn thành chỉ mục thường (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: khóa ngoại tới carts ON DELETE CASCADE (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: khóa ngoại tới addresses ON DELETE RESTRICT (USR xóa cứng sau 30 ngày bị chặn) (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: khóa ngoại tới orders ON DELETE SET NULL (`migration.sql`) | CHK-TC-20261006-110703196 (db.spec.ts) | bắt |
| CHK-DB: chỉ mục job hết hạn sai điều kiện (`migration.sql`) | CHK-TC-20261006-110703691 (db.spec.ts) | bắt |
| Giao diện: đặt hàng không gửi Idempotency-Key (SB-40) (`Checkout.tsx`) | CHK-E2E-20261006-110743989 (chk.e2e.spec.ts) | bắt |
| Giao diện: đặt hàng gửi cart_version = 0 (SB-23) (`Checkout.tsx`) | CHK-E2E-20261006-110743989 (chk.e2e.spec.ts) | bắt |
| 429 (SB-14): xem lại phiên cho 1000 lần mỗi phút thay vì 120 | CHK-TC-20261013-210241009 | bắt |
| 429 (SB-14): hủy phiên cho 1000 lần mỗi phút thay vì 120 | CHK-TC-20261013-210241168 | bắt |
| 429 (SB-14): gỡ mã không có giới hạn tần suất | CHK-TC-20261013-210241326 | bắt |
| job hết hạn phiên bỏ qua hạn thời gian của lượt chạy | CHK-TC-20261013-211638651 | bắt |
| job hết hạn phiên bỏ qua tín hiệu hủy | CHK-TC-20261013-211638651 | bắt |
| job xóa bản chụp bỏ qua hạn thời gian của lượt chạy | CHK-TC-20261013-211638651 | bắt |

## Lệch spec
1. [đã chọn] **Tên lớp giao diện module**: CHK-API (bảng Giao tiếp giữa module) và vài CHK-REQ còn ghi `CartService`, `AddressService`, `InventoryService`, `PromotionService`; mã thật (đúng `architecture.md` đã đồng bộ) là `CartApi`, `PromotionApi`, `InventoryApi`, `ShippingApi`, `OrderApi`; riêng USR không có `*Api` cho địa chỉ: CHK gọi `AddressService.listAddresses` và `getAddress` (đúng bảng Giao diện module và `user/index.ts`). Lần thứ bảy cùng họ; CHK-API đã đổi `CartService`, `InventoryService` về tên thật, `AddressService` giữ nguyên. Kiểm: CHK-TC-20261006-110702894 (`guard.spec.ts` đối chiếu `deps.service.ts` với bảng của `architecture.md`). **Đã đồng bộ (2026-10-13, báo cáo spec/changes/chk-dong-bo-spec-20261013.md):** `CartService` thành `CartApi` ở CHK-API và bốn requirement; `AddressService` giữ nguyên.
2. [đã chọn] **Khóa `status` của `checkout-session-closed`**: CHK-API (Danh mục lỗi), CHK-REQ-20261006-105052414 và các TC CHK-TC-20261006-110703759, CHK-TC-20261006-110703826, CHK-TC-20261006-110703893 nêu "kèm `status`" (expired, cancelled), nhưng `status` là khóa chuẩn của problem+json (mã HTTP 409) mà nền cấm `extra` ghi đè (`RESERVED` của `buildProblem`). Mã dùng `session_status`; TC kiểm theo `session_status`; web đọc `session_status`. Tên trường ở CHK-API, REQ, TC đã đổi (không đổi nền: sẽ phá `status` số của RFC 9457). **Đã đồng bộ:** CHK-API, CHK-REQ ...105052272 và ...105052414 và ba TC ghi `session_status`.
3. [đã chọn] **GET xem lại và phiên đã đóng**: CHK-API liệt kê lỗi của GET chỉ 401, 403, 404, 503, nhưng CHK-TC-20261006-110703893 (và REQ ...105052414 ca biên giỏ `abandoned`) đòi `GET` trả 409 `checkout-session-closed` (cancelled) khi giỏ hiện hành khác giỏ của phiên, còn CHK-TC-20261006-110703860 đòi 200 `{ status: expired }` khi phiên quá hạn mà job chưa chạy, và REQ ...105051681 BR9 đòi 200 cho phiên đã đóng từ trước. Mã theo TC (409 khi vừa phát hiện giỏ đổi; 200 kèm trạng thái cho phiên đã đóng hay vừa hết hạn). CHK-API phải thêm 409 cho GET và nói rõ hai trường hợp. **Đã đồng bộ:** CHK-API ghi 409 (giỏ khác giỏ phiên), 200 chỉ trạng thái cho phiên đã đóng hay vừa quá hạn và 429 ở GET, DELETE gỡ mã, DELETE phiên; CHK-REQ ...105051681 BR9 và ...105052414 BR5 cùng chữ.
4. [đã chọn] **Mã blocker `cart_empty`**: BR5 của CHK-REQ-20261006-105051681 liệt kê 14 mã, không có mã cho giỏ bị làm trống sau khi mở phiên (API không có 409 cho GET). Mã thêm `cart_empty` (câu "Giỏ hàng đang trống" ở web); đặt hàng vẫn 409 `cart-empty`. Rủi ro: danh sách mã của spec thiếu một mã. Kiểm: `web-lib.spec.ts` (CHK-TC-20261006-110702169).
5. [đã chọn] **Biến `RESERVATION_TTL` đơn vị phút**: ADR-007 và CHK-API ghi "RESERVATION_TTL (15 phút)" nhưng nền chưa khai biến này (grep không thấy ở PRJ, INV, ORD, PAY); CHK khai trong `config.ts` (số nguyên phút, 1 đến 60, mặc định 15) cùng bốn biến `CHK_*`. Rủi ro: INV, PAY không đọc biến này (INV nhận `expires_at` từ CHK; PAY có `PAY_ATTEMPT_URL_TTL_MINUTES` riêng). Kiểm: CHK-TC-20261006-110702894 (hạn = giờ CSDL + 15 phút, `guard.spec.ts` kiểm mặc định và từ chối giá trị sai).
6. [đã chọn] **Sửa mã nền `platform`**: `ProblemExtra` (`errors/registry.ts`, xuất thêm `ProblemJson` ở `platform/index.ts`) nhận đối tượng JSON và danh sách đối tượng, vì CHK-API đòi `items`, `issues`, `review`, `address` là mảng hay đối tượng (kiểu cũ chỉ vô hướng và `string[]`, runtime vốn đã sao chép nguyên giá trị). Không đổi hành vi: `RESERVED` vẫn chặn đè khóa chuẩn. Kiểm: CHK-TC-20261006-110702693 và CHK-TC-20261006-110702421 (`test/platform/errors-logging.spec.ts`), kèm `insufficient-stock.items` ở `place.spec.ts`; đột biến cho CSRF của nền (CHK-TC-20261006-110703453) nằm trong bảng đột biến. Ngoài ra sửa hạ tầng test chung: `test/support/db.ts` (bảng `checkout_sessions` đứng đầu danh sách TRUNCATE) và `test/e2e/server.ts` (`/reset` cùng bảng, thêm năm endpoint điều khiển cho CHK).
7. [đã chọn] **Bộ chặn hold-and-wait** (`Gate` trong `idem.ts`): mỗi giao dịch đặt hàng giữ một kết nối rồi `lockForCheckout` của CRT đọc PRD, INV bằng kết nối thứ hai; N giao dịch cùng chờ kết nối thứ hai làm cạn pool (lần thứ ba cùng họ sau PAY và SHP). CHK chỉ cho ⌊DB_POOL_MAX / 2⌋ (tối thiểu 1) lượt đặt hàng chạy đồng thời, còn lại xếp hàng trước khi mở giao dịch. Spec không nêu; rủi ro: thông lượng đặt hàng đồng thời bị chặn bằng nửa pool (mặc định pool 10 thì 5). Đã ghi vào ADR-012. Kiểm: CHK-SEC-20261006-105800857 T18 (pool 2 kết nối, 6 khách đặt đồng thời; đột biến bỏ bộ chặn và nới bộ chặn đều bị bắt). **Đã đồng bộ:** CHK-SEC T18, CHK-DB (Giao dịch và khóa ý 3) và CHK-API ghi cơ chế `Gate` và giới hạn đã biết (REV-CHK-50: thao tác chọn của cùng khách chờ khóa phiên có thể làm đặt hàng 503 sau khoảng 2,6 giây khi pool chỉ 2; chấp nhận, rủi ro); ADR-012 đã ghi ở nền.
8. [đã chọn] **`Idempotency-Key` qua `IdempotencyService.run` thay `@Idempotent`**: decorator phát lại nguyên trạng thái 201 và thân đã lưu (`replayed` = false), còn spec đòi 200 kèm `replayed` = true; và thứ tự: khóa idempotency được chèn ở đầu giao dịch (trước khóa tư vấn và khóa dòng phiên) thay vì sau khóa tư vấn như CHK-DB mục 4; kết quả tương đương (khóa trùng đồng thời xếp hàng ở unique, khóa chỉ còn khi giao dịch thành công, lỗi 409, 422, 503 hoàn tác cả khóa). Hạn 24 giờ do nền tính theo đồng hồ ứng dụng, không theo giờ CSDL (CHK-TC-20261006-120848703 đặt đồng hồ về giờ thật để so). Kiểm: CHK-TC-20261006-120840748, CHK-TC-20261006-120848703, CHK-TC-20261006-110703521.
9. [đã chọn] **Bế tắc và lỗi tuần tự hóa**: CHK-DB mục 5 đòi thử lại tối đa 2 lần rồi 503; nền (`TransactionService`) thử lại `DB_TRANSACTION_RETRIES` (mặc định 3) lần rồi ném `internal-error`; CHK đổi `internal-error` từ nền thành 503 `dependency-unavailable`. Không có test dựng được bế tắc thật (thứ tự khóa cố định nên không xảy ra). Rủi ro: số lần thử 3 thay vì 2; nhánh đổi mã chưa có test riêng.
10. [đã chọn] **Hai TC không dựng được đúng như viết**: (a) CHK-TC-20261006-110703589 cần hai phiên `open` cho hai giỏ của cùng một người, nhưng nền cấm (unique một phiên `open` mỗi người và một giỏ `active` mỗi người), nên khóa tư vấn theo người dùng chỉ còn là lớp thừa của khóa dòng phiên: test dùng hai yêu cầu song song khác khóa trên cùng phiên (một 201, một 200 phát lại, tổng 3 đơn) và ca đủ 3 đơn thì 409; (b) CHK-TC-20261006-110703691 ghi "hai tiến trình" cho job: test chạy hai lượt job đồng thời trong cùng tiến trình (hai kết nối) chứng minh `SKIP LOCKED`. Hai điều này ghi YẾU ở bảng kết quả. Nâng bằng chứng: bổ sung TC dựng sẵn hai phiên qua SQL và chạy job bằng hai tiến trình con (mẫu `chk-then-die.ts`).
11. [đã chọn] **YẾU khác**: CHK-TC-20261006-110701888 (ghi chú TC đo độ lệch thời gian phản hồi giữa ba mã không được đo ở CHK: lỗi chung do PRM chọn, test kiểm nội dung giống hệt và bộ đếm; nâng: đo xen kẽ bằng `medianPairMs` sau khi PRM chốt ngưỡng), CHK-TC-20261006-110702827 (lặp 20 lần thay vì 50 để giữ thời gian chạy; cộng một ca tải hỗn hợp 14 khách kiểm bảo toàn ở `review.spec.ts`).
12. [đã chọn] **Thứ tự kiểm `checkout-incomplete` và `no-shipping-methods`**: CHK-TC-20261006-110701426 (đã có địa chỉ, COD, không chọn vận chuyển, SHP không có phương thức nào bật) đòi `no-shipping-methods` còn BR2 xếp `checkout-incomplete` trước: mã trả `no-shipping-methods` chỉ khi thiếu đúng một mục là vận chuyển và danh sách phương thức rỗng; thiếu nhiều mục thì `checkout-incomplete` kèm `missing`.
13. [đã chọn] **Tạm tính lớn**: CHK-TC-20261006-110702349 (4.950.000.000.000) vượt miền của SHP `quote` (0 đến 10.000.000.000, architecture.md) và của PRM (1 đến 1.000.000.000): CHK cắt `subtotal` về 10.000.000.000 khi hỏi phí (ngưỡng miễn phí luôn nhỏ hơn trần) và coi `invalid_subtotal` của PRM là `no_discount` (cùng cách CRT); tổng tính bằng bigint, không tràn. Rủi ro: ngưỡng miễn phí lớn hơn 10 tỷ không được tôn trọng (không có ở nghiệp vụ). Từ 2026-10-13: CRT chặn giỏ trên 10.000.000.000 ở nguồn và `lockForCheckout` ném 409 `cart-limit-exceeded` (CHK-TC-20261013-210241484); xem lại vẫn cắt về trần khi hỏi phí.
14. [đã chọn] **Số lỗi tạm thời của module khác**: mã lỗi 503 `dependency-unavailable` (CHK-API) chỉ dùng khi đặt, chọn, lấy phí; ở xem lại, PRM, SHP, ORD chậm thì 200 kèm `service_unavailable` và `can_place_order` = false mà không thêm mã blocker nào (không có mã trong BR5). Hạn 2 giây thật chỉ dùng ở CHK-TC-20261006-110702761 (INV); ở các test PRM, SHP chậm (CHK-TC-20261006-110702243 và ca hồi quy) đặt `CHK_DEPENDENCY_TIMEOUT_MS` 300 ms thay 2500 ms để giữ thời gian chạy.
15. [đã chọn] **Đồng hồ giả**: hạn phiên (`expires_at`), hạn giữ hàng và hạn job tính theo giờ CSDL (`clock_timestamp()`), nên "đồng hồ CSDL giả" của TC làm bằng SQL lùi mốc của phiên (`ageSession`) và tham số `now` của job (`expireOnce`, `purgeOnce`, INV `expireOnce`); test không dùng mốc ngày cố định. `fixed-clock:` không cần vì không có mốc cứng quanh hôm nay.
16. [đã chọn] **Thao tác chọn không kiểm giỏ hiện hành**: BR5 của CHK-REQ-20261006-105052414 nói "một yêu cầu tới phiên mà giỏ khác" tự hủy phiên; mã chỉ kiểm ở xem lại và đặt hàng (nơi đã gọi CRT), không ở các PUT chọn (tránh thêm lời gọi CRT mỗi thao tác); giỏ khác được phát hiện ở lần xem lại kế tiếp (web luôn tải lại sau mỗi lần chọn).
17. [đã chọn] **`address-changed` làm mới bản chụp ngay** (CHK-TC-20261006-110701151 đòi): lần đặt kế tiếp với cùng số thành công mà không cần PUT xác nhận; việc bắt khách xác nhận nằm ở giao diện (khóa nút Đặt hàng tới khi bấm `chk-checkout-address-confirm`, E2E CHK-E2E-20261006-110744136). Rủi ro: gọi API trực tiếp bỏ qua bước xác nhận (giống ca `price-changed`, nơi spec cũng chỉ bắt xác nhận bằng số mới).
18. [đã chọn] **Mã `PU2` ba ký tự** (CHK-TC-20261006-122751355, CHK-TC-20261006-122751396) vi phạm CHECK `coupons_code_format` của PRM (4 đến 20 ký tự): test dùng `PUTWO`; chỉ đổi tên mã.
19. [đã chọn] **Thiếu thông tin trong phản hồi**: `cart-already-ordered` không kèm mã đơn (CHK-API không đòi), nên khối "giỏ đã được đặt" ở web chỉ liên kết tới danh sách đơn (wireframe vẽ mã đơn); phiên rút gọn ở PUT coupon trả `{ coupon, discount, grand_total, total_is_estimate }` không có `expires_at` đúng CHK-API.
20. [đã chọn] **Index phụ** `checkout_sessions_cart_id_idx` (khóa ngoại RESTRICT tới `carts`) thêm ngoài CHK-DB để kiểm tra RESTRICT và truy vấn theo giỏ không quét bảng; không đổi hợp đồng. Migration Prisma mới: `20261009000200_checkout_tables` (`check-migrations` khớp schema).
21. [đã chọn] **Test sau mã**: mã và test viết cùng một lượt nên không có lần "fail đúng lý do" cho từng test (khác quy tắc test-first); bằng chứng thay thế là bảng đột biến 128 mục (mỗi SB `Kiểm bằng: test` của CHK-SEC có ít nhất một) và sáu đột biến lọt ở lượt đầu đã được sửa bằng test mới (khóa dòng phiên trong lúc đặt, hết hạn trong khe, Retry-After, hạn gọi mặc định, `completed_at`, mức giảm vượt tạm tính).
22. [đã chọn] **Giao diện lệch chữ spec** (mục "Lệch" của lượt web): dấu giảm giá hiển thị "−" thật, các E2E ghi "-" ASCII (như CRT); `chk-checkout-summary-discount` luôn hiện ("0 đ" khi không giảm, đúng CHK-E2E-20261006-110744240) khác giỏ; `chk-checkout-complete-expiry-warning` hiện cả lúc chờ (chữ tĩnh) và quá hạn (chữ quá hạn); `next.url` không truyền sang trang kết quả (nút Thanh toán ngay dựng `/orders/{code}/payment`, trùng giá trị API); trang `/checkout?session={id}` đặt bằng `history.replaceState` để tải lại không tốn lượt tạo phiên (10 mỗi phút); gửi lại email xác minh không có testid cho thông báo "đã gửi lại" (kiểm bằng chữ); `chk-checkout-address-add` mở `/account/addresses/new` nhưng USR không có tham số `next`, nên khách phải tự quay lại checkout (spec: "quay lại checkout giữ phiên"); `chk-checkout-complete-error` chỉ có banner kèm liên kết vì spec không nói khi nào hiện.
23. [chưa làm] **Nhánh giao diện chưa có test E2E**: tự gửi lại một lần cùng `Idempotency-Key` khi lỗi mạng, 401 hết phiên đăng nhập ở các màn CHK, banner 503 `chk-checkout-place-error`, chặn hàng ngừng bán ở bước đặt (`chk-checkout-unavailable-items`); đã làm trong mã nhưng chỉ phần hàm thuần có test (`web-lib.spec.ts`). Cũng: bước "mở liên kết xác minh trong email" của CHK-E2E-20261006-110744171 dựng bằng `mailToken` (hộp thư giả) rồi mở trang `/verify-email`, không qua NTF thật (ghi YẾU ở bảng kết quả); nâng bằng E2E có NTF khi NTF xong. Việc cho lượt review hoặc lượt web kế tiếp.
24. [đã chọn] **Sửa test của module khác** vì CHK thêm bảng và route: `test/order/create.spec.ts` (`TRUNCATE` thêm `checkout_sessions` vì bảng này có khóa ngoại tới `orders`, ORD-TC-20261006-111225380) và `test/promotion/guard.spec.ts` (bộ lọc "PRM không có endpoint nào cho khách" chấp nhận thêm hai route mã giảm giá của CHK, PRM-TC-20261006-101036662); sửa nền test này không đổi mã `src/` của ORD hay PRM.
25. [đã chọn] **Cách chạy `clean_run`** (mã chưa commit nên chỉ gần giống CI; theo công thức PRJ mục 34 và CRT mục 14): `git worktree add --detach` tại `c557cdb`, phủ 205 tệp sửa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH` (Node 24.21.0 từ nvm, `/opt/homebrew/bin`, `/usr/bin`, `/bin`), `HOME` rỗng, `CI=true`, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`, `PLAYWRIGHT_BROWSERS_PATH`; `pnpm install --frozen-lockfile --offline --store-dir <kho của máy>`; PostgreSQL 16 và MinIO của Docker (`-p minsdlc-r`). Đã chạy exit 0: install, scan:secrets, check:boundaries, lint, typecheck, test (147 bộ, 1283 test), build. Lượt đầu `pnpm test` đỏ một test do thứ tự dòng hàng phụ thuộc uuid ngẫu nhiên (CHK-TC-20261006-110701151, sửa test), nên `pnpm test` và `pnpm build` chạy lại trên cây đã sửa; các bước còn lại không đổi giữa hai lượt. Sau đó chỉ đổi một biểu thức chính quy trong `chk.e2e.spec.ts` (`\\d` thành `[0-9]`, để check-report không nhận nhầm là đường dẫn ổ đĩa), E2E chạy lại xanh (15 test, 45 giây) ở cây chính; không có máy chủ E2E mồ côi.
26. [đã chọn] **`district` trên đơn** (REV-CHK-55, sdlc-impact 2026-10-13): người dùng quyết giữ quận, huyện: `shipping_address` của đơn đóng với sáu khóa (`receiver`, `phone`, `line1`, `ward`, `district`, `city`), `district` là chuỗi hoặc null; `place.service.ts` truyền `district` của bản chụp, ORD nhận sáu khóa (báo cáo spec/changes/ord-district-20261013.md). Không có migration (cột JSONB). Test: CHK-TC-20261013-210240854; `place.spec.ts` và `address.spec.ts` đổi kỳ vọng thêm `district`. Việc người: vận đơn SHP (`getRecipient`) vẫn không có `district`; ORD-TC cũ còn viết "năm khóa".
