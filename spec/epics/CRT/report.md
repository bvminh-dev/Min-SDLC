---
epic: CRT
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: CRT

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền của module (cấu hình, mã lỗi, schema đóng, bảng bậc, cổng gọi module khác), rồi phần tính tiền và đọc giỏ, rồi các thao tác ghi, giao diện nội bộ cho CHK, consumer event và job, rồi test API, giao diện web, E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. Phụ thuộc sang epic khác chỉ qua `CatalogApi`, `InventoryApi`, `PromotionApi`, `ShippingApi` (cột Phụ thuộc của CRT ở `architecture.md`).

Lượt triển khai đầu bị ngắt giữa chừng (phiên kết thúc). Lượt này kiểm lại trạng thái thật trước khi làm tiếp: mã `modules/cart/`, migration, test và web đã có gần đủ, chưa có báo cáo. Phát hiện và sửa: (a) `write.service.ts` đang mang một đột biến chưa khôi phục (`mutate.mjs` bị giết giữa lượt đột biến SB-23 T11: `update` tính `line_total` theo giá đã lưu thay vì giá hiện hành), làm đỏ `CRT-TC-20261006-104452063`; (b) bốn đột biến `lọt` (IDOR của PATCH, gộp vượt 99 ở câu INSERT, bộ đếm ghi giỏ dùng chung, `SKIP LOCKED` của job) nên thêm test bắt (Lệch spec 12); (c) `typecheck` đỏ ở `crt.e2e.spec.ts`; (d) `PRM-TC-20261006-101036662` đỏ vì hai route giỏ chứa chữ `coupon` (Lệch spec 8); (e) ba testid của khối tóm tắt khi lỗi hay hết phiên chưa có ở web (Lệch spec 7).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261009000100_cart_tables` và `cart.prisma`: bảng `carts`, `cart_items`, enum `cart_status`, CHECK (số lượng 1..99, giá lúc thêm 1..1.000.000.000, mã và thành phố 1..50 ký tự, cặp vận chuyển, `converted` khi và chỉ khi có đơn, `version` từ 1), unique một phần một giỏ `active` mỗi người, unique `(cart_id, product_id)`, khóa ngoại tới `products` và `shipping_methods`, chỉ mục cho job; quan hệ ngược ở `catalog.prisma`, `shipping.prisma` | CRT-DB-20261006-103824563 | - | done |
| 2 | Nền của module: hằng số và bảng bậc SB-14 (`config.ts`), 12 mã lỗi qua `registerProblem` (`errors.ts`), schema đầu vào đóng chống `__proto__`, NUL và trường tiền (`policy.ts`), cổng gọi PRD, INV, PRM, SHP có hạn 2 giây và lỗi đổi sang `DependencyError` (`deps.service.ts`) | CRT-API-20261006-103824592, CRT-SEC-20261006-103824617 | 1 | done |
| 3 | Sửa nền `platform`: `DomainError.options.status` để cùng một mã `type` có hai status (`product-unavailable` 404 khi thêm, 409 khi tăng dòng ngừng bán) | CRT-API-20261006-103824592 | 2 | done |
| 4 | Tính tiền thuần bằng BigInt (`pricing.ts`) và đọc giỏ (`read.service.ts`): giá hiện hành từ PRD, tồn từ INV, mã kiểm lại với `count_attempt` = false, phí tính lại ở SHP, tổng không âm, huy hiệu chỉ đọc CSDL của CRT | CRT-REQ-20261006-103226486, CRT-REQ-20261006-103226562, CRT-REQ-20261006-103226588 | 2 | done |
| 5 | Thêm, đổi số lượng, xóa dòng, làm trống giỏ, cập nhật giá (`write.service.ts`, `cart.controller.ts`): khóa dòng giỏ, gộp bằng câu INSERT có điều kiện, trần 50 dòng, kiểm tồn mềm, gọi module khác trước khi mở giao dịch | CRT-REQ-20261006-103226376, CRT-REQ-20261006-103226406, CRT-REQ-20261006-103226434, CRT-REQ-20261006-103226460, CRT-REQ-20261006-103226486 | 3, 4 | done |
| 6 | Áp và gỡ mã giảm giá, chọn vận chuyển (mã cũ giữ khi mã mới lỗi, giỏ trống 409 `cart-empty` không gọi PRM hay SHP, 503 khi module lỗi) | CRT-REQ-20261006-103226511, CRT-REQ-20261006-103226537 | 4 | done |
| 7 | Giao diện nội bộ cho CHK `CartApi.snapshotForCheckout` và `CartApi.lockForCheckout(user_id, tx)` (`cart.api.ts`, điểm vào công khai `index.ts`) | CRT-REQ-20261006-103226562 | 4 | done |
| 8 | Consumer `cart` của CheckoutCompleted (giỏ sang `converted`) và ProductArchived (đánh dấu dòng, lô 1000), job `cart.abandon` mỗi giờ (30 ngày, lô, hạn thời gian, `SKIP LOCKED`) | CRT-REQ-20261006-103226614 | 1, 2 | done |
| 9 | Test API trên PostgreSQL thật (9 bộ ở `apps/api/test/cart`; PRD, INV, PRM, SHP chạy thật; đua song song thật; tiến trình bị SIGKILL; `auditPermissions` trên `AppModule` thật) và đổi theo của test nền | CRT-SEC-20261006-103824617 | 5, 6, 7, 8 | done |
| 10 | Giao diện web: khối Thêm vào giỏ (trang chi tiết, thẻ sản phẩm), huy hiệu giỏ ở đầu trang, trang `/cart`, khối tóm tắt đơn (mã, vận chuyển, tổng) | ui/add-to-cart, ui/cart, ui/cart-summary | 5, 6 | done |
| 11 | E2E trình duyệt thật (Chromium, bản build production của web, API thật, cổng điều khiển dựng dữ liệu) | CRT-E2E-20261006-104523348, CRT-E2E-20261006-104523405, CRT-E2E-20261006-104523460, CRT-E2E-20261006-104523521, CRT-E2E-20261006-104523568, CRT-E2E-20261006-104523612 | 10 | done |
| 12 | Bảng đột biến CRT (`apps/api/scripts/mutations-crt.json`, 111 đột biến) và cổng kiểm (`test/tooling/mutations-crt.spec.ts`) | CRT-SEC-20261006-103824617 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 | done |
| 13 | Trần tạm tính 10.000.000.000 (REV-CRT-13, sdlc-impact 2026-10-13): 409 `cart-limit-exceeded` khi thêm, tăng số lượng, chọn vận chuyển; xem giỏ báo `shipping.error` `cart_limit_exceeded` và blocker thay cho `service_unavailable` mãi; `lockForCheckout` ném cùng lỗi; thông báo và khóa nút ở web; 10 đột biến mới | CRT-REQ-20261006-103226537, CRT-REQ-20261006-103226562, CRT-API-20261006-103824592 | 4, 5, 6, 7, 10 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (87 TC, 6 E2E; bốn TC `CRT-TC-20261013-...` do sdlc-impact thêm cho trần tạm tính và job có hạn thời gian). Một TC có thể có nhiều test mang cùng ID (ca bổ sung từ đột biến). Ngoài các ID này còn test mang ID tài liệu CRT-DB (lược đồ, `test/cart/db.spec.ts`) và CRT-SEC (bảng đột biến, `test/tooling/mutations-crt.spec.ts`). PRD, INV, PRM, SHP chạy thật trong test API (không bản giả); số lời gọi đếm bằng `jest.spyOn` trên các lớp `*Api`.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| CRT-E2E-20261006-104523348 | E2E | apps/api/test/e2e/crt.e2e.spec.ts | pass | Customer thêm sản phẩm từ trang chi tiết, đổi số lượng rồi xóa khỏi giỏ |
| CRT-E2E-20261006-104523405 | E2E | apps/api/test/e2e/crt.e2e.spec.ts | pass | Customer áp mã SALE10, chọn vận chuyển rồi thấy tổng đúng |
| CRT-E2E-20261006-104523460 | E2E | apps/api/test/e2e/crt.e2e.spec.ts | pass | YẾU: ca thứ hai (503 và 401 của `GET /cart`) dùng `page.route` giả phản hồi lỗi, không phải PRD hay phiên thật hỏng; trang production render thật, xem Lệch spec 7 |
| CRT-E2E-20261006-104523521 | E2E | apps/api/test/e2e/crt.e2e.spec.ts | pass | Customer thấy giá đã đổi và xác nhận bằng nút cập nhật giá |
| CRT-E2E-20261006-104523568 | E2E | apps/api/test/e2e/crt.e2e.spec.ts | pass | Customer làm trống giỏ: bấm giữ giỏ trước rồi xác nhận làm trống |
| CRT-E2E-20261006-104523612 | E2E | apps/api/test/e2e/crt.e2e.spec.ts | pass | Customer gặp dòng sản phẩm ngừng bán, xóa dòng đó rồi đi tiếp |
| CRT-TC-20261006-104451036 | TC | apps/api/test/cart/add.spec.ts | pass | Thêm sản phẩm đầu tiên tạo giỏ mới |
| CRT-TC-20261006-104451082 | TC | apps/api/test/cart/add.spec.ts | pass | Thêm sản phẩm đã có thì gộp số lượng vào một dòng |
| CRT-TC-20261006-104451131 | TC | apps/api/test/cart/add.spec.ts | pass | Sản phẩm không bán được cho cùng một 404, không dò được sản phẩm chưa công bố |
| CRT-TC-20261006-104451178 | TC | apps/api/test/cart/add.spec.ts | pass | Số lượng sai và trường tiền lạ bị 400, giỏ không đổi |
| CRT-TC-20261006-104451226 | TC | apps/api/test/cart/add.spec.ts | pass | Thêm quá số còn bán bị 409 và giỏ không đổi |
| CRT-TC-20261006-104451291 | TC | apps/api/test/cart/add.spec.ts | pass | Guest nhận 401, staff và admin nhận 403, không tạo giỏ |
| CRT-TC-20261006-104451335 | TC | apps/api/test/cart/add.spec.ts | pass | Gộp tới đúng 99 rồi vượt 99 |
| CRT-TC-20261006-104451389 | TC | apps/api/test/cart/add.spec.ts | pass | Giới hạn 50 dòng: dòng thứ 50 được, dòng thứ 51 bị từ chối, gộp vẫn được |
| CRT-TC-20261006-104451453 | TC | apps/api/test/cart/add.spec.ts | pass | Hai yêu cầu thêm đầu tiên cùng lúc chỉ ra một giỏ |
| CRT-TC-20261006-104451601 | TC | apps/api/test/cart/add.spec.ts | pass | Gộp vào dòng cũ làm mới giá lúc thêm |
| CRT-TC-20261006-104451652 | TC | apps/api/test/cart/edit.spec.ts | pass | Tăng rồi giảm số lượng của một dòng |
| CRT-TC-20261006-104451706 | TC | apps/api/test/cart/edit.spec.ts | pass | Tăng quá tồn bị 409, dòng giữ nguyên |
| CRT-TC-20261006-104451802 | TC | apps/api/test/cart/edit.spec.ts | pass | Dòng của người khác, dòng không có và id sai định dạng cùng một 404 |
| CRT-TC-20261006-104451879 | TC | apps/api/test/cart/edit.spec.ts | pass | Số lượng ngoài 1..99 và trường lạ bị 400 |
| CRT-TC-20261006-104451945 | TC | apps/api/test/cart/edit.spec.ts | pass | Giảm khi đã vượt tồn được phép và đặt đúng số cũ không đổi gì |
| CRT-TC-20261006-104452006 | TC | apps/api/test/cart/edit.spec.ts | pass | Dòng của sản phẩm ngừng bán chỉ giảm được |
| CRT-TC-20261006-104452063 | TC | apps/api/test/cart/edit.spec.ts | pass | Đổi số lượng không làm mới giá lúc thêm |
| CRT-TC-20261006-104452119 | TC | apps/api/test/cart/edit.spec.ts | pass | Hai yêu cầu đổi cùng một dòng cùng lúc không gây lỗi |
| CRT-TC-20261006-104452170 | TC | apps/api/test/cart/edit.spec.ts | pass | Xóa một dòng, dòng còn lại nguyên vẹn |
| CRT-TC-20261006-104452215 | TC | apps/api/test/cart/edit.spec.ts | pass | Xóa dòng của người khác, xóa lần hai, id lạ đều 404; guest 401, staff 403 |
| CRT-TC-20261006-104452267 | TC | apps/api/test/cart/edit.spec.ts | pass | Xóa dòng cuối cùng bỏ luôn mã và lựa chọn vận chuyển |
| CRT-TC-20261006-104452317 | TC | apps/api/test/cart/edit.spec.ts | pass | Xóa dòng ngừng bán gỡ blocker khỏi giỏ |
| CRT-TC-20261006-104452371 | TC | apps/api/test/cart/edit.spec.ts | pass | Hai tab cùng xóa một dòng: một 204, một 404 |
| CRT-TC-20261006-104452418 | TC | apps/api/test/cart/edit.spec.ts | pass | Làm trống giỏ xóa dòng, mã và vận chuyển |
| CRT-TC-20261006-104452493 | TC | apps/api/test/cart/edit.spec.ts | pass | Làm trống không đăng nhập hoặc sai role bị chặn và không đụng giỏ người khác |
| CRT-TC-20261006-104452550 | TC | apps/api/test/cart/edit.spec.ts | pass | Làm trống giỏ trống hoặc chưa có giỏ vẫn 204, không tạo giỏ |
| CRT-TC-20261006-104452611 | TC | apps/api/test/cart/edit.spec.ts | pass | Làm trống giỏ 50 dòng trong một giao dịch |
| CRT-TC-20261006-104452670 | TC | apps/api/test/cart/edit.spec.ts | pass | Làm trống đua với thêm sản phẩm: không có kết quả nửa vời |
| CRT-TC-20261006-104452716 | TC | apps/api/test/cart/view.spec.ts | pass | Xem giỏ tính tạm tính theo giá hiện hành |
| CRT-TC-20261006-104452775 | TC | apps/api/test/cart/view.spec.ts | pass | Giá đổi hiện giá cũ và cập nhật giá xác nhận giá mới |
| CRT-TC-20261006-104452823 | TC | apps/api/test/cart/guard.spec.ts | pass | Xem giỏ không đăng nhập hoặc sai role |
| CRT-TC-20261006-104452875 | TC | apps/api/test/cart/add.spec.ts | pass | PRD không trả lời thì cả giỏ 503, không đoán giá |
| CRT-TC-20261006-104452935 | TC | apps/api/test/cart/view.spec.ts | pass | Chưa có giỏ: giỏ trống và huy hiệu bằng 0, không tạo bản ghi |
| CRT-TC-20261006-104452994 | TC | apps/api/test/cart/view.spec.ts | pass | Dòng ngừng bán hiện nhưng không tính vào tạm tính |
| CRT-TC-20261006-104453050 | TC | apps/api/test/cart/rev.spec.ts | pass | Giỏ 50 dòng giá lớn nhất: số không tràn, mỗi mô-đun một lời gọi theo lô |
| CRT-TC-20261006-104453118 | TC | apps/api/test/cart/view.spec.ts | pass | Tên sản phẩm chứa HTML hiển thị nguyên văn, không thực thi |
| CRT-TC-20261006-104453162 | TC | apps/api/test/cart/coupon.spec.ts | pass | Áp mã SALE10 rồi gỡ mã |
| CRT-TC-20261006-104453207 | TC | apps/api/test/cart/coupon.spec.ts | pass | Chưa đủ giá trị đơn tối thiểu |
| CRT-TC-20261006-104453261 | TC | apps/api/test/cart/coupon.spec.ts | pass | Mã không có, đã tắt, đã xóa cùng một 404 và không dò được mã |
| CRT-TC-20261006-104453306 | TC | apps/api/test/cart/coupon.spec.ts | pass | Thử sai 10 lần thì bị khóa, kể cả mã đúng |
| CRT-TC-20261006-104453359 | TC | apps/api/test/cart/coupon.spec.ts | pass | Giỏ trống và đầu vào sai không gọi PRM |
| CRT-TC-20261006-104453404 | TC | apps/api/test/cart/coupon.spec.ts | pass | Mã bị giữ khi giỏ đổi: mất hiệu lực rồi tự áp lại |
| CRT-TC-20261006-104453444 | TC | apps/api/test/cart/coupon.spec.ts | pass | Xem giỏ nhiều lần với mã đã tắt không làm khách bị khóa |
| CRT-TC-20261006-104453501 | TC | apps/api/test/cart/coupon.spec.ts | pass | Áp mã mới lỗi thì mã cũ giữ nguyên |
| CRT-TC-20261006-104453546 | TC | apps/api/test/cart/coupon.spec.ts | pass | Quá 10 lần gọi áp mã mỗi phút bị 429 rate-limited |
| CRT-TC-20261006-104453603 | TC | apps/api/test/cart/shipping.spec.ts | pass | Chọn phương thức vận chuyển và phí đổi theo ngưỡng miễn phí |
| CRT-TC-20261006-104453658 | TC | apps/api/test/cart/shipping.spec.ts | pass | Phương thức tắt hoặc không có cùng một 409, lựa chọn cũ giữ nguyên |
| CRT-TC-20261006-104453717 | TC | apps/api/test/cart/rev.spec.ts | pass | Giỏ trống hoặc đầu vào sai không gọi SHP |
| CRT-TC-20261006-104453780 | TC | apps/api/test/cart/shipping.spec.ts | pass | Ngưỡng miễn phí so sánh lớn hơn hoặc bằng |
| CRT-TC-20261006-104453829 | TC | apps/api/test/cart/shipping.spec.ts | pass | Phụ thuộc thành phố không phân biệt hoa thường và dấu |
| CRT-TC-20261006-104453875 | TC | apps/api/test/cart/shipping.spec.ts | pass | Phương thức bị tắt sau khi chọn thì báo lỗi và cho chọn lại |
| CRT-TC-20261006-104453932 | TC | apps/api/test/cart/view.spec.ts | pass | Tổng = tạm tính trừ giảm giá cộng phí |
| CRT-TC-20261006-104453980 | TC | apps/api/test/cart/guard.spec.ts | pass | YẾU: CHK chưa có mã nên `CartApi` do test gọi thay CHK (khóa trong `TransactionService.run` của test); chưa thử với CHK thật, xem Lệch spec 10 |
| CRT-TC-20261006-104454027 | TC | apps/api/test/cart/view.spec.ts | pass | YẾU: CHK chưa có mã nên `CartApi` do test gọi thay CHK (khóa trong `TransactionService.run` của test); chưa thử với CHK thật, xem Lệch spec 10 |
| CRT-TC-20261006-104454073 | TC | apps/api/test/cart/view.spec.ts | pass | Trường tiền trong body của bất kỳ endpoint giỏ nào bị 400 |
| CRT-TC-20261006-104454120 | TC | apps/api/test/cart/view.spec.ts | pass | YẾU: CHK chưa có mã nên `CartApi` do test gọi thay CHK (khóa trong `TransactionService.run` của test); chưa thử với CHK thật, xem Lệch spec 10 |
| CRT-TC-20261006-104454175 | TC | apps/api/test/cart/view.spec.ts | pass | Tổng bằng 0 là hợp lệ |
| CRT-TC-20261006-104454222 | TC | apps/api/test/cart/view.spec.ts | pass | Chưa chọn vận chuyển thì tổng ước tính |
| CRT-TC-20261006-104454280 | TC | apps/api/test/cart/rev.spec.ts | pass | YẾU: CHK chưa có mã nên `CartApi` do test gọi thay CHK (khóa trong `TransactionService.run` của test); chưa thử với CHK thật, xem Lệch spec 10 |
| CRT-TC-20261006-104454338 | TC | apps/api/test/cart/view.spec.ts | pass | Tổng lớn nhất không tràn số |
| CRT-TC-20261006-104454411 | TC | apps/api/test/cart/view.spec.ts | pass | Dòng đủ hàng hiện ok |
| CRT-TC-20261006-104454471 | TC | apps/api/test/cart/view.spec.ts | pass | Dòng thiếu hàng không bị tự giảm và chặn thanh toán |
| CRT-TC-20261006-104454533 | TC | apps/api/test/cart/view.spec.ts | pass | Hết hàng hẳn và thêm quá tồn |
| CRT-TC-20261006-104454589 | TC | apps/api/test/cart/view.spec.ts | pass | Đúng bằng tồn là đủ, tăng thêm một thì từ chối |
| CRT-TC-20261006-104454655 | TC | apps/api/test/cart/view.spec.ts | pass | Không lộ tồn thật: dòng đủ hàng không có available, số còn lại không quá 99 |
| CRT-TC-20261006-104454713 | TC | apps/api/test/cart/add.spec.ts | pass | INV không trả lời: dòng unknown, không chặn, thêm thì 503 |
| CRT-TC-20261006-104454768 | TC | apps/api/test/cart/view.spec.ts | pass | Sản phẩm active chưa có bản ghi kho coi như hết hàng |
| CRT-TC-20261006-104454824 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | YẾU: phong bì event do test dựng theo `events.md` và giao bằng `EventsService.deliver` thật; CHK chưa có mã nên chưa có outbox và relay thật của CHK phát CheckoutCompleted, xem Lệch spec 10 |
| CRT-TC-20261006-104454878 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | ProductArchived đánh dấu dòng ở mọi giỏ active |
| CRT-TC-20261006-104454936 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | YẾU: phong bì event do test dựng theo `events.md` và giao bằng `EventsService.deliver` thật; CHK chưa có mã nên chưa có outbox và relay thật của CHK phát CheckoutCompleted, xem Lệch spec 10 |
| CRT-TC-20261006-104454980 | TC | apps/api/test/cart/edit.spec.ts | pass | Dòng của giỏ bỏ dở không sửa được |
| CRT-TC-20261006-104455032 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | Mất ProductArchived vẫn không tính dòng ngừng bán |
| CRT-TC-20261006-104455112 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | Mốc 30 ngày của job bỏ dở |
| CRT-TC-20261006-104455174 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | Chỉ xem giỏ không giữ giỏ còn hoạt động |
| CRT-TC-20261006-104455235 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | Job và thao tác của khách đua nhau không để lại trạng thái nửa vời |
| CRT-TC-20261006-104455293 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | YẾU: phong bì event do test dựng theo `events.md` và giao bằng `EventsService.deliver` thật; CHK chưa có mã nên chưa có outbox và relay thật của CHK phát CheckoutCompleted, xem Lệch spec 10 |
| CRT-TC-20261006-113000110 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | YẾU: phong bì event do test dựng theo `events.md` và giao bằng `EventsService.deliver` thật; CHK chưa có mã nên chưa có outbox và relay thật của CHK phát CheckoutCompleted, xem Lệch spec 10 |
| CRT-TC-20261006-113000220 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | YẾU: phong bì event do test dựng theo `events.md` và giao bằng `EventsService.deliver` thật; CHK chưa có mã nên chưa có outbox và relay thật của CHK phát CheckoutCompleted, xem Lệch spec 10; tiến trình con bị SIGKILL thật |
| CRT-TC-20261006-113000330 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | Hai bản job bỏ dở chạy cùng lúc không xử lý trùng và log đếm đúng |
| CRT-TC-20261006-113000440 | TC | apps/api/test/cart/coupon.spec.ts | pass | Mã hết lượt dùng mỗi người bị 409 per-user-limit-reached và không tính lượt sai |
| CRT-TC-20261006-113000550 | TC | apps/api/test/cart/add.spec.ts | pass | Quá 120 lần ghi giỏ mỗi phút bị 429 rate-limited |
| CRT-TC-20261006-113000660 | TC | apps/api/test/cart/view.spec.ts | pass | YẾU: CHK chưa có mã nên `CartApi` do test gọi thay CHK (khóa trong `TransactionService.run` của test); chưa thử với CHK thật, xem Lệch spec 10 |
| CRT-TC-20261007-085336986 | TC | apps/api/test/e2e/crt.e2e.spec.ts | pass | Thử mã giảm giá quá nhiều trên giỏ hiện thử lại sau N giây, nút Áp dụng mở lại khi hết giờ chờ |
| CRT-TC-20261013-205743594 | TC | apps/api/test/cart/limit.spec.ts | pass | Thêm hay tăng số lượng vượt 10.000.000.000 bị 409 `cart-limit-exceeded`, đúng trần thì được, giảm hay giữ luôn được (ba ca: thêm và tăng, gộp vào dòng có sẵn, dòng ngừng bán không tính) |
| CRT-TC-20261013-205743712 | TC | apps/api/test/cart/limit.spec.ts | pass | Giá tăng làm giỏ vượt trần: xem giỏ báo `cart_limit_exceeded`, blocker, SHP không bị gọi, chọn vận chuyển 409, bớt hàng thì hết báo |
| CRT-TC-20261013-205743812 | TC | apps/api/test/cart/limit.spec.ts | pass | `CartApi.lockForCheckout` ném `cart-limit-exceeded`, `snapshotForCheckout` trả `can_checkout` false |
| CRT-TC-20261013-211638383 | TC | apps/api/test/cart/lifecycle.spec.ts | pass | Job `cart.abandon` tôn trọng hạn thời gian, tín hiệu hủy, giới hạn lô, idempotent (test sẵn có gắn thêm ID, L61) |

## Kiểm đột biến
Bảng 111 đột biến chạy bằng script chung `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-crt.json --cwd apps/api` (mỗi đột biến chạy đúng TC của nó); cổng `node apps/api/scripts/check-mutations.mjs` bắt buộc mỗi SB `Kiểm bằng: test` của CRT-SEC (SB-05, SB-06, SB-11, SB-12, SB-14, SB-23, SB-27, SB-30, SB-37, SB-38) có ít nhất một đột biến, đoạn cần phá còn đúng một lần, test và ID có thật. Phủ cả mã nền sửa kèm (`platform/errors/problem.ts`), giao diện web (`CartSummary.tsx`, `cart/page.tsx`) và từng CHECK, unique, khóa ngoại của migration. Kết quả lượt cuối: 108 đột biến của lượt đầu: 102 bắt, 2 tương đương, 4 lọt (đã sửa test rồi chạy lại đúng 4 đột biến đó: cả 4 bắt); 3 đột biến thêm ở lượt này: bắt; 2 đột biến của web chạy lại sau khi sửa giao diện: bắt. Tổng 111: 109 bắt, 2 tương đương, 0 lọt. Hai đột biến tương đương có lý do (trần 99 của `available` không đầu vào nào chạm tới). Lượt đột biến đầu để lộ 4 `lọt` thật, đã thêm test bắt (Lệch spec 12). Lượt sdlc-impact 2026-10-13 thêm 10 đột biến cho trần tạm tính (hàng "Trần giỏ" cuối bảng; cùng 12 hàng của review `mutations-crt.json` có 134 hàng, check-mutations hợp lệ): cả 10 bắt, 0 lọt.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-06, T1: tìm dòng để sửa không lọc theo người dùng (IDOR PATCH) | CRT-TC-20261006-104451802 | bắt |
| SB-06, T1: xóa dòng không lọc theo người dùng (IDOR DELETE) | CRT-TC-20261006-104452215 | bắt |
| SB-06, T1: xóa dòng của giỏ không còn active | CRT-TC-20261006-104451802 | bắt |
| SB-06, T13: giao dịch sửa số lượng không kiểm giỏ còn active (job bỏ dở đua) | CRT-TC-20261006-104455235 | bắt |
| SB-05, T4: staff được làm trống giỏ | CRT-TC-20261006-104452493 | bắt |
| SB-05, T4: staff được xem giỏ | CRT-TC-20261006-104452823 | bắt |
| SB-05, T4: staff được xem huy hiệu giỏ | CRT-TC-20261006-104452823 | bắt |
| SB-05, T4: staff được thêm vào giỏ | CRT-TC-20261006-104451291 | bắt |
| SB-05, T4: staff được xóa một dòng | CRT-TC-20261006-104452215 | bắt |
| SB-05, T4: admin được áp mã (sai ma trận, kiểm quyền trên AppModule) | CRT-TC-20261006-104451291 | bắt |
| SB-05, T4: staff được chọn vận chuyển (sai ma trận) | CRT-TC-20261006-104451291 | bắt |
| SB-11, T2: endpoint thêm vào giỏ mất schema kiểm | CRT-TC-20261006-104451291 | bắt |
| SB-23, T2: schema không còn từ chối trường lạ (unit_price, total, discount, fee) | CRT-TC-20261006-104454073 | bắt |
| SB-11, T3: số lượng không còn trần 99 ở schema | CRT-TC-20261006-104451178 | bắt |
| SB-11, T3: số lượng 0 qua được schema | CRT-TC-20261006-104451178 | bắt |
| SB-11, T3: số thực qua được schema | CRT-TC-20261006-104451178 | bắt |
| SB-11: khóa __proto__ không còn bị từ chối | CRT-TC-20261006-104451178 | bắt |
| SB-11: ký tự điều khiển NUL qua được schema của mã và thành phố | CRT-TC-20261006-104453359 | bắt |
| SB-11: product_id dài vô hạn qua được schema | CRT-TC-20261006-104451178 | bắt |
| SB-23, T2, T11: tiền tính theo giá đã lưu thay vì giá hiện hành | CRT-TC-20261006-104452775 | bắt |
| SB-23: tạm tính cộng cả dòng ngừng bán | CRT-TC-20261006-104452994 | bắt |
| SB-23: tổng cộng giảm giá thay vì trừ | CRT-TC-20261006-104453932 | bắt |
| SB-23: cờ tổng ước tính luôn false | CRT-TC-20261006-104454222 | bắt |
| SB-23: giảm giá có thể vượt tạm tính (tổng âm) | CRT-TC-20261006-104454175 | bắt |
| SB-23: thêm vào giỏ lưu giá sai thay vì giá hiện hành | CRT-TC-20261006-104451036 | bắt |
| SB-23, T11: đổi số lượng trả thành tiền theo giá đã lưu | CRT-TC-20261006-104452063 | bắt |
| SB-23, T11: cập nhật giá không đổi gì | CRT-TC-20261006-104452775 | bắt |
| SB-23: ngưỡng miễn phí tính trên tạm tính đã bị giảm một đồng | CRT-TC-20261006-104453780 | bắt |
| SB-23: gộp vào dòng cũ không làm mới giá lúc thêm | CRT-TC-20261006-104451601 | bắt |
| SB-23: gộp vào dòng cũ không mở lại dòng đã đánh dấu ngừng bán | CRT-TC-20261006-104451601 | bắt |
| SB-23: mã lưu theo chuỗi khách gõ thay vì mã chuẩn hóa của PRM | CRT-TC-20261006-104453162 | bắt |
| SB-23: thành phố bị đổi chữ hoa khi lưu | CRT-TC-20261006-104453829 | bắt |
| SB-23: số mã giảm giá báo thiếu bằng 0 khi chưa đủ đơn tối thiểu | CRT-TC-20261006-104453207 | bắt |
| SB-23: hết lượt mỗi người không kèm limit và used | CRT-TC-20261006-113000440 | bắt |
| SB-05, T5: mã không có trả sai mã lỗi (phân biệt với mã đã tắt) | CRT-TC-20261006-104453261 | bắt |
| SB-11, T3: trần số lượng của cấu hình nâng lên 100 | CRT-TC-20261006-104451335 | bắt |
| SB-11, T3: trần số dòng của cấu hình nâng lên 51 | CRT-TC-20261006-104451389 | bắt |
| SB-11, T3: dòng thứ 51 qua được kiểm trần | CRT-TC-20261006-104451389 | bắt |
| SB-11, T3: gộp vượt 99 không bị chặn ở câu INSERT | CRT-TC-20261006-104451335 | bắt |
| SB-38, T9: gộp ghi đè số lượng thay vì cộng | CRT-TC-20261006-104451082 | bắt |
| SB-37, T8: kiểm tồn chỉ so số thêm, bỏ số đã có trong giỏ | CRT-TC-20261006-104451226 | bắt |
| SB-06, T1: sản phẩm không bán được vẫn thêm được | CRT-TC-20261006-104451131 | bắt |
| SB-37: giảm số lượng cũng bị kiểm tồn | CRT-TC-20261006-104451945 | bắt |
| SB-37: tăng lên đúng bằng tồn bị từ chối | CRT-TC-20261006-104454589 | bắt |
| SB-11: dòng ngừng bán cũng không giảm được | CRT-TC-20261006-104452006 | bắt |
| SB-30, T9: đổi số lượng bằng số cũ vẫn tăng version | CRT-TC-20261006-104451945 | bắt |
| SB-30, T9: thao tác sửa không tăng version | CRT-TC-20261006-104452418 | bắt |
| SB-30, T9: thao tác sửa không ghi last_activity_at | CRT-TC-20261006-104451945 | bắt |
| SB-38, T9: làm trống không bỏ mã và vận chuyển | CRT-TC-20261006-104452418 | bắt |
| SB-30, T9: làm trống giỏ trống vẫn tăng version | CRT-TC-20261006-104452550 | bắt |
| SB-38, T9: xóa dòng cuối không bỏ mã và vận chuyển | CRT-TC-20261006-104452267 | bắt |
| SB-38, T9: khóa giỏ khi thêm bị bỏ (trần 50 dòng đua nhau) | CRT-TC-20261006-104451389 | bắt |
| SB-38, T9: tạo giỏ không dùng ON CONFLICT (hai giỏ active) | CRT-TC-20261006-104451453 | bắt |
| SB-38, T9: giao dịch khóa của CHK không khóa dòng giỏ | CRT-TC-20261006-104454280 | bắt |
| SB-38: giỏ trống cũng bị khóa trong giao dịch của CHK | CRT-TC-20261006-104454027 | bắt |
| SB-23: snapshot trả cả dòng ngừng bán trong tạm tính | CRT-TC-20261006-104454120 | bắt |
| SB-23: snapshot luôn cho phép thanh toán | CRT-TC-20261006-104454120 | bắt |
| SB-30: snapshot trả cart_version sai | CRT-TC-20261006-104453980 | bắt |
| SB-14, T5: áp mã không tính lượt sai (count_attempt false) | CRT-TC-20261006-104453306 | bắt |
| SB-14, T6: xem giỏ tính lượt sai của mã (count_attempt true) | CRT-TC-20261006-104453444 | bắt |
| SB-14, T5: áp mã giới hạn nâng lên 11 lần mỗi phút | CRT-TC-20261006-104453546 | bắt |
| SB-14, T7: ghi giỏ nâng lên 121 lần mỗi phút | CRT-TC-20261006-113000550 | bắt |
| SB-14, T7: ghi giỏ không dùng chung bộ đếm | CRT-TC-20261006-113000550 | bắt |
| SB-14, T7: xem giỏ nâng lên 121 lần mỗi phút | CRT-TC-20261006-113000550 | bắt |
| SB-14, T7: chọn vận chuyển nâng lên 61 lần mỗi phút | CRT-TC-20261006-104453603 | bắt |
| SB-14, T7: xem giỏ gọi PRD từng sản phẩm thay vì một lời gọi theo lô | CRT-TC-20261006-104453050 | bắt |
| SB-14: hạn lời gọi mô-đun khác nâng lên 20 giây | CRT-TC-20261006-104454713 | bắt |
| SB-14, T7: xem giỏ không thể xảy ra khi PRD lỗi vẫn trả 200 | CRT-TC-20261006-104452875 | bắt |
| SB-14: INV lỗi làm hỏng cả giỏ thay vì dòng unknown | CRT-TC-20261006-104454713 | bắt |
| SB-14: phương thức vận chuyển bị tắt sau khi chọn làm hỏng xem giỏ | CRT-TC-20261006-104453875 | bắt |
| SB-14: lỗi method-unavailable của SHP thành 503 khi chọn | CRT-TC-20261006-104453658 | bắt |
| SB-18, T14: log lỗi phụ thuộc ghi thông điệp của bên kia (mã giảm giá, email) | CRT-TC-20261006-104453359 | bắt |
| SB-37, T8: dòng đủ hàng kèm số còn lại thật | CRT-TC-20261006-104454655 | bắt |
| SB-37: đúng bằng tồn bị coi là thiếu | CRT-TC-20261006-104454589 | bắt |
| SB-37: hết hàng hẳn bị coi là thiếu một phần | CRT-TC-20261006-104454533 | bắt |
| SB-37: dòng ngừng bán không thành blocker | CRT-TC-20261006-104452317 | bắt |
| SB-37, T8: số còn lại hiển thị không chặn 99 (tương đương: available luôn nhỏ hơn số lượng yêu cầu tối đa 99) | - | lọt (tương đương: available chỉ xuất hiện khi thiếu hàng nên luôn nhỏ hơn số lượng yêu cầu (tối đa 99): trần 99 là phòng thủ, không có đầu vào nào chạm tới) |
| SB-37, T8: hàm cap số còn lại ở lỗi insufficient-stock (tương đương như trần 99) | - | lọt (tương đương: insufficient-stock chỉ phát khi tổng sau khi thêm lớn hơn tồn, mà tổng không vượt 99 nên available luôn dưới 99: cap là phòng thủ, không có đầu vào nào chạm tới) |
| SB-27, T13: CheckoutCompleted đổi cả giỏ không còn active (event khác event_id) | CRT-TC-20261006-104455293 | bắt |
| SB-27, T13: CheckoutCompleted ghi converted_order_id sai | CRT-TC-20261006-104454824 | bắt |
| SB-27, T13: consumer ghi ProcessedEvent dưới tên khác | CRT-TC-20261006-104454824 | bắt |
| SB-27, T12: ProductArchived đánh dấu cả dòng của giỏ converted | CRT-TC-20261006-104454878 | bắt |
| SB-27: ProductArchived chỉ xử lý lô đầu | CRT-TC-20261006-104454878 | bắt |
| SB-27: event payload sai hình dạng làm CheckoutCompleted ném lỗi | CRT-TC-20261006-104454936 | bắt |
| SB-34, T9: job bỏ dở không dùng SKIP LOCKED (xử lý trùng giữa hai bản) | CRT-TC-20261006-113000330 | bắt |
| SB-34: job bỏ dở không giới hạn lô | CRT-TC-20261006-113000330 | bắt |
| SB-34: mốc 30 ngày của job nới thành 29 ngày | CRT-TC-20261006-104455112 | bắt |
| SB-34: job đánh dấu giỏ MỚI hơn mốc thay vì cũ hơn | CRT-TC-20261006-104455112 | bắt |
| SB-27: job đánh dấu lại cả giỏ đã abandoned hay converted | CRT-TC-20261006-104455112 | bắt |
| SB-11, T3: CHECK số lượng cho phép 0 ở CSDL | CRT-TC-20261006-104451335 | bắt |
| SB-11, T3: CHECK số lượng cho phép 100 ở CSDL | CRT-TC-20261006-104451335 | bắt |
| SB-11, T3: CHECK giá lúc thêm cho phép 0 | CRT-TC-20261006-104451335 | bắt |
| SB-11, T3: CHECK giá lúc thêm bỏ trần 1 tỷ | CRT-TC-20261006-104451335 | bắt |
| SB-11, T3: CHECK lý do không còn bán bị bỏ | CRT-TC-20261006-104451335 | bắt |
| SB-11: CHECK độ dài mã giảm giá nới ra 60 | CRT-TC-20261006-104451453 | bắt |
| SB-11: CHECK độ dài thành phố nới ra 60 | CRT-TC-20261006-104451453 | bắt |
| SB-11: CHECK cặp phương thức và thành phố bị bỏ | CRT-TC-20261006-104451453 | bắt |
| SB-27: CHECK converted khi và chỉ khi có converted_order_id bị bỏ | CRT-TC-20261006-104451453 | bắt |
| SB-30: CHECK version từ 1 bị nới | CRT-TC-20261006-104451453 | bắt |
| SB-38, T9: unique một giỏ active mỗi người bị bỏ | CRT-TC-20261006-104451453 | bắt |
| SB-38, T9: unique (cart_id, product_id) bị bỏ | CRT-TC-20261006-104451082 | bắt |
| SB-38: xóa giỏ không còn kéo theo dòng (CASCADE thành RESTRICT) | CRT-TC-20261006-104451335 | bắt |
| SB-06: sản phẩm có trong giỏ xóa được (RESTRICT thành CASCADE) | CRT-TC-20261006-104451335 | bắt |
| SB-06: phương thức vận chuyển đang dùng ở giỏ xóa được | CRT-TC-20261006-104451453 | bắt |
| Nền (platform): status riêng của một lần ném bị bỏ qua | CRT-TC-20261006-104452006 | bắt |
| Nền (platform): status riêng không kiểm khoảng 4xx, 5xx | CRT-TC-20261006-104452006 | bắt |
| SB-12, T15: tên sản phẩm ở giỏ render dạng HTML thô | CRT-TC-20261006-104453118 | bắt |
| SB-23, T2: giỏ tính tạm tính ở trình duyệt thay vì lấy từ máy chủ | CRT-E2E-20261006-104523405 | bắt |
| SB-23, T2: tạm tính vượt miền của PRM bị coi là dịch vụ lỗi thay vì không có mức giảm (xem giỏ) | CRT-TC-20261006-104453261 | bắt |
| SB-23, T2: áp mã với tạm tính vượt miền của PRM thành 500 (lý do invalid_subtotal không đổi sang no-discount) | CRT-TC-20261006-104453261 | bắt |
| SB-38, T9: giảm số lượng khi PRD lỗi vẫn thành công theo giá đã lưu (không 503) | CRT-TC-20261006-104452875 | bắt |
| Trần giỏ: thêm sản phẩm không kiểm trần tạm tính | CRT-TC-20261013-205743594 | bắt |
| Trần giỏ: tăng số lượng không kiểm trần tạm tính | CRT-TC-20261013-205743594 | bắt |
| Trần giỏ: đúng trần 10 tỷ cũng bị chặn (> thành >=) | CRT-TC-20261013-205743594 | bắt |
| Trần giỏ: dòng đang sửa bị đếm hai lần (không loại dòng của chính sản phẩm đó) | CRT-TC-20261013-205743594 | bắt |
| Trần giỏ: dòng ngừng bán bị tính vào tạm tính của trần | CRT-TC-20261013-205743594 | bắt |
| Trần giỏ: chọn vận chuyển cho giỏ vượt trần vẫn gọi SHP (503 mãi) | CRT-TC-20261013-205743712 | bắt |
| Trần giỏ: xem giỏ vượt trần vẫn hỏi SHP (báo service_unavailable mãi) | CRT-TC-20261013-205743712 | bắt |
| Trần giỏ: giỏ vượt trần không chặn thanh toán (không có blocker) | CRT-TC-20261013-205743712 | bắt |
| Trần giỏ: lockForCheckout để giỏ vượt trần lọt sang CHK | CRT-TC-20261013-205743812 | bắt |
| Trần giỏ: hằng trần đổi từ 10 tỷ thành 1 tỷ | CRT-TC-20261013-205743594 | bắt |

## Lệch spec
Không sửa spec trong lúc triển khai. Các mục dưới là lựa chọn mặc định đã làm, việc chưa làm hoặc chỗ cần người quyết (chuyển `sdlc-impact` hay `sdlc-foundation`).

1. [đã chọn] **Tên lớp giao diện nội bộ cho CHK**: mã phơi `CartApi` (`apps/api/src/modules/cart/cart.api.ts`, export ở `index.ts`) theo quy ước `<Tên>Api` của `CatalogApi`, `InventoryApi`, `PromotionApi`, `ShippingApi`, `OrderApi`; CRT-API, CRT-REQ-20261006-103226562 và CHK-API-20261006-105800712 (hàng CRT) viết `CartService.snapshotForCheckout` và `CartService.lockForCheckout`, còn bảng "Giao diện module" của `architecture.md` chỉ ghi tên phương thức. Chữ ký và hình dạng kết quả khớp đúng CHK-API (`(user_id)` và `(user_id, tx)`; `{ ok: true, cart_id, cart_version, lines, items_subtotal, coupon_code, shipping_method_id, shipping_city, can_checkout, issues }` hay `{ ok: false, reason: 'cart_empty' }`). Lần thứ sáu cùng kiểu; chữ `CartService` ở CRT-API, CRT-REQ-562, CHK-API và tên lớp ở bảng đã đổi. Test: CRT-TC-20261006-104453980, CRT-TC-20261006-104454280 và các khẳng định hình dạng ở `test/cart/guard.spec.ts`. **Đã đồng bộ (2026-10-13, báo cáo spec/changes/crt-dong-bo-spec-20261013.md):** CRT-API, CRT-REQ-20261006-103226562, CRT-TC-20261006-104453980, CRT-DB và CHK-API cùng bốn requirement của CHK nay ghi `CartApi`.
2. [đã chọn] **`product-unavailable` có hai status trong spec**: bảng mã lỗi của CRT-API ghi 404, nhưng mục PATCH và CRT-REQ-20261006-103226406 BR4 đòi 409 `product-unavailable` khi tăng số lượng dòng đã ngừng bán. Mã làm đúng cả hai (cùng `type`, 404 ở `POST /cart/items`, 409 ở `PATCH`) bằng `DomainError.options.status` (sửa mã nền `platform/errors/registry.ts`, `problem.ts`, `problem.filter.ts`; chỉ nhận số nguyên 4xx hay 5xx, ngoài khoảng bỏ qua). Test của chỗ sửa nền: CRT-TC-20261006-104452006 và CRT-TC-20261006-104451131 (`test/platform/errors-logging.spec.ts`), hành vi ở `test/cart/edit.spec.ts`; hai đột biến ở `problem.ts`. Bảng mã lỗi của CRT-API và ADR-023 (một mã hai status) đã ghi. **Đã đồng bộ:** CRT-API ghi `product-unavailable` 404 khi thêm và 409 khi PATCH tăng dòng ngừng bán (một mã hai status, ADR-023 đã ghi).
3. [đã chọn] **`POST /cart/refresh-prices` không tăng `version` và không đổi `last_activity_at`**: CRT-REQ-20261006-103226486 BR6 chỉ nói đặt giá đã lưu bằng giá hiện hành và trả giỏ; BR4 của CRT-REQ-20261006-103226614 liệt kê các thao tác ghi `last_activity_at` mà không có cập nhật giá. Tiền luôn theo giá hiện hành nên thao tác không đổi số tiền nào; CHK dựa vào `cart_version` để bắt giỏ đổi (`cart-changed`) vẫn không bỏ sót vì `unit_price` CHK nhận luôn là giá hiện hành. Rủi ro: giỏ chỉ bấm cập nhật giá vẫn có thể bị job bỏ dở sau 30 ngày. Test: CRT-TC-20261006-104452775 (`test/cart/view.spec.ts`), đột biến "cập nhật giá không đổi gì".
4. [đã chọn] **Tạm tính ngoài miền của PRM và giỏ chỉ còn dòng ngừng bán**: PRM `evaluate` chỉ nhận tạm tính 1..1.000.000.000 (`invalid_subtotal`) và spec CRT không có lý do này (giỏ có thể tới 4.950.000.000.000). Mã đổi `invalid_subtotal` và tạm tính 0 (chỉ còn dòng ngừng bán, không gọi PRM) thành `no_discount`: xem giỏ giữ mã, giảm 0, `coupon.reason` = `no_discount`; áp mã 409 `no-discount`. Test: CRT-TC-20261006-104453261 (ca tạm tính 2.000.000.000), CRT-TC-20261006-104453359; hai đột biến. Từ 2026-10-13: CRT chặn giỏ có tạm tính trên 10.000.000.000 ở nguồn (Lệch spec 15), nên chỉ giỏ lớn hơn 1.000.000.000 mà không quá 10.000.000.000 còn gặp `invalid_subtotal` của PRM.
5. [đã chọn] **PRD không trả lời khi GIẢM số lượng thì vẫn 503**: CRT-REQ-20261006-103226406 BR3 nói giảm luôn được (không bị chặn bởi tồn), BR7 đòi `line_total` theo giá hiện hành, nên cần PRD; không đoán giá (đóng khi không chắc). INV lỗi không ảnh hưởng thao tác giảm (không gọi INV). Test: CRT-TC-20261006-104452875 (ca PATCH), đột biến SB-38 T9 "giảm khi PRD lỗi vẫn thành công".
6. [đã chọn] **Log của module cart dùng `user_id` đã băm, nhưng dòng `request` của platform ghi `user_id` nguyên văn**: CRT-SEC T14 đòi log chỉ có `user_id` đã băm. Mọi dòng log của `module: 'cart'` dùng `hashId` (12 ký tự SHA-256) và không có mã giảm giá, thành phố, email; dòng `request` (`platform/http/app-setup.ts`) kèm `user_id` thật, `route` và `status`, không dữ liệu khác. Test (ca bổ sung mang ID TC gần nhất vì T14 kiểm bằng `review`): CRT-TC-20261006-104453359 ở `test/cart/rev.spec.ts`. Người duyệt chọn giữ `user_id` ở dòng `request` (mọi epic đã dựa vào để truy vết) hay băm; đổi là sửa mã nền và test của PRJ, không làm trong CRT (đã chọn giữ nguyên văn theo SB-18). **Đã đồng bộ:** CRT-SEC T14, CRT-REQ-20261006-103226376 BR11 và ...103226511 BR10 ghi "`user_id` ghi theo SB-18" (SB-18 ở nền đã chốt dạng nguyên văn, băm tùy chọn); mã CRT giữ băm.
7. [đã chọn] **Giao diện** (spec ui không nêu hoặc nêu mơ hồ): (a) khối Thêm vào giỏ ở thẻ sản phẩm của danh sách là bản gọn (`compact`: luôn thêm 1, không ô số lượng) vì thẻ nhỏ, trang chi tiết có đủ ô số lượng; (b) huy hiệu "Giỏ" ở `HeaderLinks` cho customer, đọc `GET /cart/summary`, cập nhật qua sự kiện `cart:changed`; (c) trang `/cart`; liên kết "Tiến hành thanh toán" trỏ `/checkout` (CHK chưa có trang, khóa khi giỏ có blocker); (d) trạng thái `lỗi` và `hết phiên` của khối tóm tắt (`crt-cart-summary-error`, `-retry`, `-session-expired`) chỉ hiện khi cả giỏ không tải được (khối tóm tắt dùng chung phản hồi `GET /cart` nên không có lỗi riêng), kèm banner cấp trang `crt-cart-error`, `crt-cart-session-expired`; test E2E ca này mang ID `CRT-E2E-20261006-104523460` vì spec chưa có TC riêng cho trạng thái lỗi của giỏ (cần `sdlc-impact` nếu muốn TC riêng) và dùng `page.route` giả phản hồi (YẾU); (e) thành phố lấy từ sổ địa chỉ của USR qua `GET /me/addresses` do giao diện gọi trực tiếp (CRT không gọi USR); (f) mọi tên hằng của spec testid đều dùng đúng `spec/testids.md` (script đối chiếu: không testid nào thừa hay thiếu).
8. [đã chọn] **Sửa nền kèm không đổi hành vi module khác** (mỗi chỗ có test): (a) `apps/api/src/app.module.ts` thêm `CartModule` (kiểm bởi `test/cart/guard.spec.ts`, CRT-TC-20261006-104451291, `AppModule` thật); (b) `prisma/schema/catalog.prisma` thêm `cartItems CartItem[]` và `shipping.prisma` thêm `carts Cart[]` (phía ngược của khóa ngoại, Prisma cần; PRD, SHP không đọc các bảng này; `test/cart/db.spec.ts` CRT-DB-20261006-103824563 và `check:boundaries`); (c) `test/promotion/guard.spec.ts` (PRM-TC-20261006-101036662): câu "PRM không có endpoint nào cho khách" lọc theo chữ `coupon` nên bắt nhầm `PUT` và `DELETE /api/v1/cart/coupon` của CRT; đã loại đúng hai route đó (route của CRT, ma trận ghi CRT-REQ-20261006-103226511), khẳng định vẫn đỏ với route lạ; (d) `test/e2e/server.ts`, `test/e2e/support.ts`, `test/support/*`: thêm cổng điều khiển và dữ liệu mồi của giỏ (`/seed-cart`, `/cart`, `/cart-count`), cùng `TRUNCATE` thêm bảng giỏ; (e) web: `AccountMenu.tsx` (`crtExpiredTestId`), `HeaderLinks.tsx`, `products/page.tsx`, `products/[id]/page.tsx` (khối Thêm vào giỏ). Các sửa nền khác trong cây làm việc (SHP, PAY: `order_code`, bảng thanh toán, `.env.example`) thuộc epic khác, không tính ở đây.
9. [đã chọn] **Hạn 2 giây dùng `Promise.race`**: lời gọi sang PRD, INV, PRM, SHP là phương thức trong tiến trình nên không hủy được; kết quả muộn bị bỏ. Hạn được gọi TRƯỚC khi mở giao dịch của giỏ (không giữ khóa lúc chờ), nên kiểm tồn và giá có thể cũ vài mili giây; CHK `reserve` là cổng cuối. Test: CRT-TC-20261006-104452875, CRT-TC-20261006-104454713, đột biến `deps.service.ts`.
10. [đã chọn] **CHK chưa có mã**: `CartApi` chưa có bên gọi thật và CheckoutCompleted chưa có bên phát thật. Test dùng `CartApi` trực tiếp (kể cả `lockForCheckout` trong giao dịch của test, pool `DB_POOL_MAX` = 2 không treo) và phong bì event dựng theo `events.md` giao bằng `EventsService.deliver` thật; các dòng YẾU ở trên: phía `CartApi` là CRT-TC-20261006-104453980, CRT-TC-20261006-104454027, CRT-TC-20261006-104454120, CRT-TC-20261006-104454280, CRT-TC-20261006-113000660; phía event là CRT-TC-20261006-104454824, CRT-TC-20261006-104454936, CRT-TC-20261006-104455293, CRT-TC-20261006-113000110, CRT-TC-20261006-113000220. Cách nâng bằng chứng khi CHK xong: chạy lại các TC này với CHK thật gọi `CartApi` và phát CheckoutCompleted qua outbox, relay thật (E2E đặt hàng từ giỏ ở epic CHK).
11. [đã chọn] **Hai đột biến tương đương** (có lý do trong bảng, kiểm bởi `test/tooling/mutations-crt.spec.ts` với trần 3 và lý do dài hơn 40 ký tự): trần 99 của `available` ở `pricing.ts` và hàm `cap` ở `write.service.ts`; `available` chỉ xuất hiện khi thiếu hàng nên luôn nhỏ hơn số lượng yêu cầu (tối đa 99).
12. [đã chọn] **Test thêm từ đột biến lọt** (mang ID của TC gần nhất): CRT-TC-20261006-104451802 (gọi PRD, INV không xảy ra khi dòng không thuộc người dùng: lớp tìm dòng không còn được lớp khóa che), CRT-TC-20261006-104451335 (hai yêu cầu gộp cùng lúc 50 + 30 + 30: đúng một bên 409, không 500), CRT-TC-20261006-113000550 (ghi luân phiên ba endpoint dùng chung một bộ đếm 120), CRT-TC-20261006-113000330 (job không chờ giỏ đang bị khóa), CRT-TC-20261006-104453261 (tạm tính ngoài miền), CRT-TC-20261006-104452875 (PATCH khi PRD lỗi). Bảng đột biến có thêm 3 đột biến cho mục 4 và 5.
13. [cần quyết] **Kit: `mutate.mjs` chỉ khôi phục tệp khi nhận `SIGINT`, `SIGTERM`** (`.claude/skills/sdlc-review/scripts/mutate.mjs`): phiên bị giết (SIGKILL) giữa lượt đột biến để lại một đột biến trong mã nguồn và test đỏ khó hiểu (đã gặp ở CRT, mục đầu của báo cáo). Đề xuất cho `sdlc-retro`: ghi bản gốc ra tệp sao lưu trước khi gài và khôi phục ở lần chạy kế tiếp (hoặc kiểm `git diff` rỗng trước khi chạy). Không sửa `.claude/` trong lượt này.
14. [đã chọn] **Cách chạy `clean_run`** (mã chưa commit nên chỉ gần giống CI; theo công thức PRJ mục 34 và PAY mục 16): `git worktree add --detach` tại `c557cdb`, phủ 161 tệp sửa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH` (Node 24.21.0 từ nvm, `/opt/homebrew/bin`, `/usr/bin`, `/bin`), `HOME` rỗng, `CI=true`, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`, `PLAYWRIGHT_BROWSERS_PATH`; `pnpm install --frozen-lockfile --offline --store-dir <kho của máy>`; PostgreSQL 16 và MinIO của Docker (`-p minsdlc-r`). Đã chạy: install, scan:secrets, check:boundaries, lint, typecheck, test (132 bộ, 1109 test, 735 giây), build, đều exit 0. Một lần chạy giữa chừng đỏ 9 bộ E2E chỉ vì máy chủ E2E mồ côi của lần chạy bị hủy trước đó còn giữ cổng 3100 đến 3103 (test E2E báo đúng lỗi này; đã dừng tiến trình rồi chạy lại từ đầu, sạch). Không chạy: workflow trên GitHub (chưa push), `check-migration-compat --base` (chỉ cho pull request), `psql -f 01-app-roles.sql` (máy không có `psql`; `globalSetup` chạy cùng tệp), `migrate deploy` và `db:check` riêng (migration chạy trên CSDL trống ở `globalSetup` và `test/cart/db.spec.ts`). Riêng CRT: 12 bộ, 165 test xanh (`test/cart`, `test/e2e/crt.e2e.spec.ts`, `test/tooling/mutations-crt.spec.ts`, `test/platform/errors-logging.spec.ts`).
15. [đã chọn] **Trần tạm tính 10.000.000.000 của giỏ** (REV-CRT-13, sdlc-impact 2026-10-13): người dùng chốt CRT chặn ở nguồn vì SHP nhận `subtotal` 0 đến 10.000.000.000 và PRM 1 đến 1.000.000.000. Mã: 409 `cart-limit-exceeded` (kèm `max_subtotal`) khi thêm, tăng số lượng (kiểm bằng giá hiện hành của PRD trước khi mở giao dịch, `assertUnderCap` ở `write.service.ts`) và chọn vận chuyển; xem giỏ giỏ vượt trần vì giá tăng thì `shipping.error` = `cart_limit_exceeded`, `checkout_blockers` thêm `cart_limit_exceeded`, SHP không bị gọi; `CartApi.lockForCheckout` ném cùng lỗi, `snapshotForCheckout` trả `can_checkout` false; web hiện thông báo và khóa nút thanh toán. Rủi ro: kiểm ở thao tác ghi là kiểm mềm ngoài khóa (hai thao tác đồng thời có thể cùng qua; khi đó xem giỏ báo blocker, không số sai). Test: CRT-TC-20261013-205743594, CRT-TC-20261013-205743712, CRT-TC-20261013-205743812; test cũ của giỏ tối đa (`view.spec.ts`) đổi kỳ vọng `service_unavailable` thành `cart_limit_exceeded`, `guard.spec.ts` đếm 18 mã lỗi.
