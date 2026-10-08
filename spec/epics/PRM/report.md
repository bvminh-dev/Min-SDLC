---
epic: PRM
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       545 passed, 545 total
---
# Báo cáo triển khai: PRM

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền (mã lỗi, schema đầu vào, tính tiền), rồi API quản trị và giao diện nội bộ, rồi consumer và job, rồi giao diện web, rồi E2E. Mọi task `done`; không có task `blocked`. Module `promotion` (`apps/api/src/modules/promotion/`, cột Phụ thuộc là `-`: không import module nào ngoài điểm vào của `platform`), web ở `apps/web/` (route `/admin/coupons`, `/admin/coupons/new`, `/admin/coupons/[id]`).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261007001000_promotion_tables` (2 bảng, 3 enum, 14 CHECK gồm CHECK nhiều cột của giá trị theo loại và bất biến `consumed_count + reserved_count <= usage_limit`, unique `code` và `order_id`, chỉ mục một phần), schema Prisma `promotion.prisma` | PRM-DB-20261006-101036519 | - | done |
| 2 | Nền của module: sổ mã lỗi (8 mã snake_case kèm trường `code`), schema đầu vào đóng (zod), tính tiền giảm bằng BigInt (`discount.ts`) | PRM-API-20261006-101036543, PRM-SEC-20261006-101036568 | 1 | done |
| 3 | API quản trị coupon: tạo, danh sách, chi tiết, sửa (khóa lạc quan `version`), xóa mềm, bật, tắt; khóa dòng, audit cùng giao dịch, bậc D 30 mỗi phút mỗi người | PRM-API-20261006-101036543, PRM-DB-20261006-101036519, PRM-SEC-20261006-101036568 | 1, 2 | done |
| 4 | Giao diện nội bộ `PromotionApi.evaluate` (bộ đếm thử sai ở kho đếm platform, `count_attempt`) và `PromotionApi.reserve(..., tx)` (khóa dòng coupon, đếm mỗi người dưới khóa, SAVEPOINT, hết hạn và hết chỗ theo giờ CSDL trong câu UPDATE) | PRM-API-20261006-101036543, PRM-DB-20261006-101036519, PRM-SEC-20261006-101036568 | 1, 2 | done |
| 5 | Consumer `promotion` của bốn event (OrderConfirmed, PaymentSucceeded tiêu thụ; OrderCancelled, OrderExpired nhả), CouponRedeemed qua outbox, idempotent theo `event_id` và theo trạng thái lượt | PRM-DB-20261006-101036519, PRM-API-20261006-101036543 | 1, 4 | done |
| 6 | Job `promotion.expire-coupons` (mỗi phút, lô 500, `SKIP LOCKED`, hạn thời gian, CouponExpired qua outbox) và `promotion.reconcile` (chỉ báo, không sửa) | PRM-DB-20261006-101036519, PRM-SEC-20261006-101036568 | 1, 5 | done |
| 7 | Kiểm lệch ma trận quyền phủ route của PRM trên AppModule thật, kiểm giao diện module và ranh giới | PRM-SEC-20261006-101036568, PRM-API-20261006-101036543 | 3, 4 | done |
| 8 | Màn danh sách coupon (tab trạng thái, tìm tiền tố, bật tắt, hộp thoại xóa, trạng thái 429 có thoát) | ui/admin-coupon-list | 3 | done |
| 9 | Màn tạo và sửa coupon (một biểu mẫu, giờ Việt Nam, khung Đã dùng, xung đột phiên bản, không sửa được) | ui/admin-coupon-edit | 3 | done |
| 10 | E2E trình duyệt thật, bảng đột biến PRM và cổng kiểm của nó | PRM-E2E-20261006-101037836, PRM-E2E-20261006-101037859, PRM-E2E-20261006-101037882, PRM-E2E-20261006-101037906 | 6, 7, 8, 9 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (78 TC, 4 E2E). TC API chạy trên PostgreSQL thật (`ecom_test`) với nhiều giao dịch thật chạy song song (pool 16); ORD, PAY, CRT, CHK chưa có code nên event của ORD và PAY (OrderConfirmed, PaymentSucceeded, OrderCancelled, OrderExpired) và lời gọi `reserve` của CHK dựng trong test theo đúng phong bì và chữ ký của spec, consumer của PRM là consumer thật đăng ký qua outbox. E2E chạy Chromium thật (playwright-core) với API thật và bản build production của web. Có thêm test bổ sung dưới cùng ID TC (JSON nửa cặp thay thế lẻ, Unicode `ß`/`ı` ở mã, CSRF, tải hỗn hợp kiểm bảo toàn sổ), và hai test mang ID `PRM-DB-20261006-101036519` (đối soát) vì spec không có TC cho việc đó (Lệch spec mục 15). Mọi dòng pass.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| PRM-E2E-20261006-101037836 | E2E | apps/api/test/e2e/prm.e2e.spec.ts | pass | E2E Chromium thật, giờ nhập theo giờ Việt Nam |
| PRM-E2E-20261006-101037859 | E2E | apps/api/test/e2e/prm.e2e.spec.ts | pass | E2E Chromium thật |
| PRM-E2E-20261006-101037882 | E2E | apps/api/test/e2e/prm.e2e.spec.ts | pass | E2E Chromium thật |
| PRM-E2E-20261006-101037906 | E2E | apps/api/test/e2e/prm.e2e.spec.ts | pass | E2E Chromium thật; bước 2 đã sửa khớp ui và PRM-REQ-20261006-101036252 BR3 (nút Xóa có), xem Lệch spec mục 9 |
| PRM-TC-20261006-101036592 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | - |
| PRM-TC-20261006-101036615 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | - |
| PRM-TC-20261006-101036639 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | - |
| PRM-TC-20261006-101036662 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | Kiểm lệch ma trận trên AppModule thật (`auditPermissions`, `@Action`) ở `apps/api/test/promotion/guard.spec.ts` |
| PRM-TC-20261006-101036686 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | - |
| PRM-TC-20261006-101036709 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | - |
| PRM-TC-20261006-101036732 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | 50 lần lặp, hai admin thật chạy song song |
| PRM-TC-20261006-101036756 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | - |
| PRM-TC-20261006-101036781 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | - |
| PRM-TC-20261006-101036805 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | Cũng có E2E giao diện (xung đột phiên bản, banner, tải lại) trong `apps/api/test/e2e/prm.e2e.spec.ts` |
| PRM-TC-20261006-101036829 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | - |
| PRM-TC-20261006-101036858 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | - |
| PRM-TC-20261006-101036882 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | 50 lần lặp, hai admin thật chạy song song |
| PRM-TC-20261006-101036906 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | - |
| PRM-TC-20261006-101036930 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | - |
| PRM-TC-20261006-101036954 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | - |
| PRM-TC-20261006-101036977 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | cả ca xóa đua nhau (20 lần) |
| PRM-TC-20261006-101037001 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | - |
| PRM-TC-20261006-101037026 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | Cũng có E2E giao diện (lỗi trên bảng "Coupon đã hết hạn", "Coupon đã hết lượt") trong `apps/api/test/e2e/prm.e2e.spec.ts` |
| PRM-TC-20261006-101037049 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | - |
| PRM-TC-20261006-101037073 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | 50 lần lặp, hai admin thật chạy song song |
| PRM-TC-20261006-101037097 | TC | apps/api/test/promotion/admin-state.spec.ts | pass | - |
| PRM-TC-20261006-101037121 | TC | apps/api/test/promotion/admin-read.spec.ts | pass | - |
| PRM-TC-20261006-101037145 | TC | apps/api/test/promotion/admin-read.spec.ts | pass | - |
| PRM-TC-20261006-101037169 | TC | apps/api/test/promotion/admin-read.spec.ts | pass | Cũng có E2E giao diện (staff thấy "Không có quyền truy cập") trong `apps/api/test/e2e/prm.e2e.spec.ts`; kiểm lệch ma trận trên AppModule thật ở `guard.spec.ts` |
| PRM-TC-20261006-101037193 | TC | apps/api/test/promotion/admin-read.spec.ts | pass | - |
| PRM-TC-20261006-101037216 | TC | apps/api/test/promotion/admin-read.spec.ts | pass | - |
| PRM-TC-20261006-101037240 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-101037263 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | Thời gian đo xen kẽ từng cặp (100 cặp), trung vị lệch dưới 30%: con số tạm của TC, xem Lệch spec |
| PRM-TC-20261006-101037286 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-101037309 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | Đồng hồ giả của platform đặt vào đầu cửa sổ cố định 10 phút |
| PRM-TC-20261006-101037333 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-101037357 | TC | apps/api/test/promotion/discount.spec.ts | pass | - |
| PRM-TC-20261006-101037382 | TC | apps/api/test/promotion/discount.spec.ts | pass | - |
| PRM-TC-20261006-101037406 | TC | apps/api/test/promotion/discount.spec.ts | pass | Thêm 2000 ca ngẫu nhiên so với tính tay BigInt độc lập; 0 < giảm <= tạm tính |
| PRM-TC-20261006-101037430 | TC | apps/api/test/promotion/discount.spec.ts | pass | - |
| PRM-TC-20261006-101037453 | TC | apps/api/test/promotion/discount.spec.ts | pass | - |
| PRM-TC-20261006-101037477 | TC | apps/api/test/promotion/discount.spec.ts | pass | - |
| PRM-TC-20261006-101037501 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-101037525 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-101037548 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-101037572 | TC | apps/api/test/promotion/expiry.spec.ts | pass | YẾU: ranh giới giờ thử bằng tham số `now` của dịch vụ (đường chạy thật dùng `now()` của CSDL), xem Lệch spec |
| PRM-TC-20261006-101037596 | TC | apps/api/test/promotion/expiry.spec.ts | pass | YẾU: ranh giới giờ thử bằng tham số `now` của dịch vụ; phần PATCH, enable, disable, DELETE chạy qua API thật với coupon quá hạn theo giờ CSDL, xem Lệch spec |
| PRM-TC-20261006-101037619 | TC | apps/api/test/promotion/expiry.spec.ts | pass | Job nền không chạy trong test (JobRunner.start không được gọi); hạn tính từ giờ CSDL |
| PRM-TC-20261006-101037642 | TC | apps/api/test/promotion/expiry.spec.ts | pass | YẾU: hai instance là hai ứng dụng trong cùng một tiến trình test (khóa tư vấn của JobRunner và SKIP LOCKED); thêm ca SKIP LOCKED xác định bằng giao dịch giữ khóa, xem Lệch spec |
| PRM-TC-20261006-101037666 | TC | apps/api/test/promotion/expiry.spec.ts | pass | - |
| PRM-TC-20261006-101037690 | TC | apps/api/test/promotion/reserve.spec.ts | pass | - |
| PRM-TC-20261006-101037713 | TC | apps/api/test/promotion/reserve.spec.ts | pass | - |
| PRM-TC-20261006-101037738 | TC | apps/api/test/promotion/reserve.spec.ts | pass | 100 lần lặp, hai giao dịch thật chạy song song; thêm 20 luồng với usage_limit 5 |
| PRM-TC-20261006-101037761 | TC | apps/api/test/promotion/reserve.spec.ts | pass | - |
| PRM-TC-20261006-101037786 | TC | apps/api/test/promotion/reserve.spec.ts | pass | - |
| PRM-TC-20261006-101037811 | TC | apps/api/test/promotion/reserve.spec.ts | pass | Thêm hai lời gọi đồng thời (20 lần) và ca lượt đã nhả |
| PRM-TC-20261006-101938311 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | ORD, PAY chưa có code: event dựng theo đúng phong bì và payload của events.md |
| PRM-TC-20261006-101938352 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-101938390 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-101938430 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-101938470 | TC | apps/api/test/promotion/reserve.spec.ts | pass | Schema chặn trường lạ `amount` bằng reason `invalid_argument` (xem Lệch spec) |
| PRM-TC-20261006-101938512 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-101938552 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-101938589 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | 100 lần lặp, cả hai thứ tự cam kết; không bế tắc đo bằng pg_stat_database.deadlocks |
| PRM-TC-20261006-101938628 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-101938666 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-113100101 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-113100151 | TC | apps/api/test/promotion/reserve.spec.ts | pass | - |
| PRM-TC-20261006-113100202 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261006-113100303 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-113100404 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | SIGKILL thật bằng tiến trình con (`test/fixtures/prm-then-die.ts`) cho cả tiêu thụ ở file này và job hết hạn ở `expiry.spec.ts` |
| PRM-TC-20261006-113100505 | TC | apps/api/test/promotion/admin-read.spec.ts | pass | YẾU: hai instance là hai ứng dụng trong cùng một tiến trình test dùng chung PostgreSQL; cũng có E2E giao diện (429, banner, thử lại) trong `apps/api/test/e2e/prm.e2e.spec.ts` |
| PRM-TC-20261006-130100101 | TC | apps/api/test/promotion/admin-create.spec.ts | pass | - |
| PRM-TC-20261006-130100202 | TC | apps/api/test/promotion/admin-update.spec.ts | pass | - |
| PRM-TC-20261006-130100303 | TC | apps/api/test/promotion/evaluate.spec.ts | pass | - |
| PRM-TC-20261006-130100404 | TC | apps/api/test/promotion/reserve.spec.ts | pass | 100 lần lặp, cộng 20 luồng của U1 và 20 luồng của U2 |
| PRM-TC-20261006-130100505 | TC | apps/api/test/promotion/reserve.spec.ts | pass | - |
| PRM-TC-20261006-130100606 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | - |
| PRM-TC-20261007-144433030 | TC | apps/api/test/promotion/expiry.spec.ts | pass | TC mới (sdlc-impact): coupon `disabled` quá hạn trả `coupon_not_found` trước job và `coupon_expired` sau job; hạn tính theo giờ CSDL thật |
| PRM-TC-20261007-144433185 | TC | apps/api/test/promotion/lifecycle.spec.ts | pass | TC mới: job đối soát chỉ báo, không tự sửa, trần báo 1000; cũng ở `review.spec.ts` (REV-PRM-09, REV-PRM-15) |
| PRM-TC-20261007-144433343 | TC | apps/api/test/promotion/expiry.spec.ts | pass | TC mới: lô 500, hạn thời gian, tín hiệu hủy, `SKIP LOCKED` của job hết hạn; cũng ở `review.spec.ts` (REV-PRM-15) |
| PRM-TC-20261007-144433497 | TC | apps/api/test/promotion/review.spec.ts | pass | TC mới: 40 lời gọi mã sai song song chỉ trả lời đúng 10 lần (REV-PRM-03; `it.failing` cũ đã thành `it`), kèm ca trộn mã đúng và sai |

## Kiểm đột biến
Epic có TC `lỗi` kiểm mối đe dọa SEC nên gài đột biến có chủ ý: 76 đột biến (74 của lượt đầu, sau sdlc-impact đổi hai và thêm hai cho thao tác đếm nguyên tử `take`, `refund`; nền `platform` vẫn không có đột biến, chỉ có ở `evaluate.service.ts`), mỗi SB `Kiểm bằng: test` của PRM-SEC (SB-05, 07, 11, 14, 23, 24, 25, 27, 30, 33) có ít nhất một đột biến, kể cả migration (CHECK, unique) và hai mã nền của module (guard, sổ). Chạy lại bằng script chung: `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-prm.json --cwd apps/api` (từ gốc repo, cần `docker compose up -d db minio minio-bucket minio-policy`; mỗi đột biến chạy đúng một TC bằng `-t`). `apps/api/scripts/check-mutations.mjs` kiểm riêng bảng (SB phủ, đoạn cần phá còn đúng một lần, ID có trong test) và `apps/api/test/tooling/mutations-prm.spec.ts` chạy cổng đó. PRM không sửa mã nền (`platform`) nên không có đột biến vào nền. Một đột biến lọt là ca tương đương có lý do (Lệch spec mục 17); lần chạy đầu có ba đột biến không bị bắt hay không biên dịch được và đã sửa: ghi quản trị không khóa dòng (test xóa đua nhau chưa nhắm tới), job hết hạn bỏ `SKIP LOCKED` (đua nhau không xác định nên lọt; nay có test xác định bằng giao dịch giữ khóa), đột biến `@Public` không biên dịch (đổi thành `@Roles('customer')`); đột biến bộ đọc JSON của nền bị bỏ khỏi bảng vì mọi trường chữ của PRM đã bị khuôn regex hay enum chặn trước khi tới bộ đọc.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-05, SB-07, T1: staff được tạo coupon (sai ma trận) | PRM-TC-20261006-101036662 | bắt |
| SB-05, T1: danh sách coupon mở cho customer | PRM-TC-20261006-101037169 | bắt |
| SB-07, T1: customer được xem chi tiết coupon | PRM-TC-20261006-101037169 | bắt |
| SB-07, T1: staff được xóa coupon | PRM-TC-20261006-101036906 | bắt |
| SB-07, T1: staff được tắt coupon | PRM-TC-20261006-101036906 | bắt |
| SB-07, T1: staff được sửa coupon | PRM-TC-20261006-101036805 | bắt |
| SB-07, T6: tạo coupon không ghi audit | PRM-TC-20261006-101036592 | bắt |
| SB-07, T6: sửa coupon ghi audit sai hành động | PRM-TC-20261006-101036756 | bắt |
| SB-07, T6: xóa coupon ghi audit sai hành động | PRM-TC-20261006-101036906 | bắt |
| SB-07, T6: bật và tắt coupon ghi audit chung một hành động | PRM-TC-20261006-101037001 | bắt |
| SB-11, T8: percentage nhận value tới 1000 | PRM-TC-20261006-101036639 | bắt |
| SB-11, T8: CHECK của CSDL cho percentage tới 1000 | PRM-TC-20261006-101036639 | bắt |
| SB-11, T8: coupon fixed nhận max_discount khi tạo | PRM-TC-20261006-101036686 | bắt |
| SB-11, T8: coupon fixed nhận max_discount khi sửa (chỉ còn CHECK của CSDL, trả 500) | PRM-TC-20261006-101037453 | bắt |
| SB-11, T8: CHECK của CSDL cho fixed có max_discount bị bỏ | PRM-TC-20261006-101037453 | bắt |
| SB-11: trường lạ (status, consumed_count) được nhận khi tạo | PRM-TC-20261006-101036686 | bắt |
| SB-11: mã đổi hoa TRƯỚC khi kiểm khuôn (ß, ı, ſ lọt thành mã khác) | PRM-TC-20261006-101036709 | bắt |
| SB-11: hạn bằng đúng giờ máy chủ vẫn nhận (bỏ dấu bằng) | PRM-TC-20261006-101036709 | bắt |
| SB-11: trần số lượt 1.000.000 thành 100.000.000 | PRM-TC-20261006-101036709 | bắt |
| SB-11: đổi type khi sửa được chấp nhận | PRM-TC-20261006-101036781 | bắt |
| SB-11: usage_limit nhỏ hơn số đang dùng được ghi (CHECK của CSDL trả 500) | PRM-TC-20261006-101036829 | bắt |
| SB-11, T8: tạo nhận per_user_limit 0 (bỏ kiểm khoảng) | PRM-TC-20261006-130100101 | bắt |
| SB-11, T9: tiền tố q chứa NUL hay nửa cặp thay thế lẻ không bị chặn (500) | PRM-TC-20261006-101037145 | bắt |
| SB-11, T9: tiền tố q dài tới 2000 ký tự | PRM-TC-20261006-101037145 | bắt |
| SB-11, T9: % và _ trong q không được thoát (khớp mọi mã) | PRM-TC-20261006-101037193 | bắt |
| SB-11: danh sách trả cả coupon đã xóa mềm | PRM-TC-20261006-101037121 | bắt |
| SB-14, T9: bậc D 30 mỗi phút thành 3000 | PRM-TC-20261006-113100505 | bắt |
| SB-14, T9: các endpoint quản trị không còn chung bộ đếm (mỗi route một bộ) | PRM-TC-20261006-113100505 | bắt |
| SB-14, T4: ngưỡng 10 lần sai thành 1000 | PRM-TC-20261006-101037309 | bắt |
| SB-14, T4: mã không có không ghi vào bộ đếm thử sai (được hoàn lượt như mã tìm thấy) | PRM-TC-20261006-101037309 | bắt |
| SB-14, T4: mã tìm thấy không được hoàn lượt đã đếm (per_user_limit_reached hay mã đúng bị tính một lần sai) | PRM-TC-20261006-130100303 | bắt |
| SB-14, T4: đếm không nguyên tử (check rồi mới đếm như cặp cũ): 40 lời gọi sai song song đều qua cổng | PRM-TC-20261007-144433497 | bắt |
| SB-14, T4: too_many_attempts không chặn mã đúng | PRM-TC-20261006-101037309 | bắt |
| SB-14, T4: bộ đếm thử sai dùng chung giữa mọi người dùng | PRM-TC-20261006-101037309 | bắt |
| SB-14, T15: count_attempt=false vẫn tính và bị chặn | PRM-TC-20261006-113100303 | bắt |
| SB-14, T4: coupon đang tắt không tính một lần sai (phân biệt được với mã không có) | PRM-TC-20261006-101037263 | bắt |
| SB-23, T3: reserve nhận trường amount từ bên gọi | PRM-TC-20261006-101938470 | bắt |
| SB-23, T8: tiền giảm vượt tạm tính (bỏ chặn tạm tính) | PRM-TC-20261006-101037477 | bắt |
| SB-23, T8: làm tròn lên thay vì xuống | PRM-TC-20261006-101037406 | bắt |
| SB-23, T8: bỏ mức giảm tối đa | PRM-TC-20261006-101037357 | bắt |
| SB-23, T8: tạm tính vượt 1 tỷ được nhận | PRM-TC-20261006-101037286 | bắt |
| SB-23: giá trị tối thiểu đúng bằng tạm tính bị từ chối | PRM-TC-20261006-101037548 | bắt |
| SB-23: tiền giảm bằng 0 vẫn được áp (bỏ no_discount) | PRM-TC-20261006-101037382 | bắt |
| SB-23, T3: CouponRedeemed mang amount lấy từ payload event thay vì từ lượt | PRM-TC-20261006-101938311 | bắt |
| SB-24, SB-25, T5: tiêu thụ không kiểm trạng thái lượt (thanh toán trễ sau khi nhả) | PRM-TC-20261006-101938390 | bắt |
| SB-24, T5: nhả không kiểm trạng thái lượt (event khác event_id nhả hai lần) | PRM-TC-20261006-101938352 | bắt |
| SB-25, T5: lượt tiêu thụ cuối không đưa coupon sang exhausted | PRM-TC-20261006-101037786 | bắt |
| SB-25, T5: trả lượt consumed không đưa coupon exhausted về active | PRM-TC-20261006-113100101 | bắt |
| SB-25, T10: evaluate và reserve không kiểm hạn theo giờ CSDL (trạng thái đã lưu active) | PRM-TC-20261006-101037619 | bắt |
| SB-25, T10: reserve tính quá hạn sai (overdue luôn false) | PRM-TC-20261006-101037619 | bắt |
| SB-25, T10: ranh giới hạn (đúng expires_at vẫn còn hạn) | PRM-TC-20261006-101037596 | bắt |
| SB-25, T2: evaluate bỏ kiểm hết chỗ (consumed + reserved >= usage_limit) | PRM-TC-20261006-101037713 | bắt |
| SB-25, T2: reserve bỏ khóa dòng coupon (FOR UPDATE) | PRM-TC-20261006-130100404 | bắt |
| SB-25, T2 (lưới thứ hai, tương đương): câu UPDATE giữ lượt bỏ điều kiện hết chỗ | - | lọt (tương đương, xem Lệch spec mục 17) |
| SB-25, T2: CHECK consumed_count + reserved_count <= usage_limit ở CSDL bị bỏ | PRM-TC-20261006-101037738 | bắt |
| SB-25, T11: reserve lặp cùng đơn không chống trùng (bỏ ON CONFLICT order_id) | PRM-TC-20261006-101037811 | bắt |
| SB-25, T11: unique(order_id) ở CSDL bị bỏ | PRM-TC-20261006-101037811 | bắt |
| SB-25, T11: mã khác cho cùng đơn được giữ thêm | PRM-TC-20261006-101037811 | bắt |
| SB-25, T5: handler không khóa dòng lượt (FOR UPDATE) nên PaymentSucceeded và OrderCancelled đua nhau | PRM-TC-20261006-101938589 | bắt |
| SB-25, T10: job hết hạn bỏ ranh giới (đúng expires_at chưa chuyển expired) | PRM-TC-20261006-101037572 | bắt |
| SB-27, T14: tiêu thụ không ghi CouponRedeemed vào outbox | PRM-TC-20261006-101938311 | bắt |
| SB-27, T14: job hết hạn không ghi CouponExpired vào outbox | PRM-TC-20261006-101037572 | bắt |
| SB-27, T14: job hết hạn chọn cả coupon exhausted (phát CouponExpired sai) | PRM-TC-20261006-101037642 | bắt |
| SB-27: job hết hạn bỏ SKIP LOCKED (hai instance cùng lô) | PRM-TC-20261006-101037642 | bắt |
| SB-34, T10: job hết hạn không giới hạn lô | PRM-TC-20261006-101037642 | bắt |
| SB-34: job hết hạn không có hạn thời gian của lần chạy | PRM-TC-20261006-101037642 | bắt |
| SB-34: job hết hạn bỏ qua tín hiệu hủy của JobRunner | PRM-TC-20261006-101037642 | bắt |
| SB-34: hạn thời gian của job lớn hơn chu kỳ (chạy chồng) | PRM-TC-20261006-101037642 | bắt |
| SB-34: chu kỳ job đối soát đổi thành mỗi phút | PRM-TC-20261006-101037642 | bắt |
| SB-30, T7: sửa bỏ điều kiện version trong câu UPDATE (hai admin đều thắng) | PRM-TC-20261006-101036805 | bắt |
| SB-30, T7: sửa không tăng version | PRM-TC-20261006-101036756 | bắt |
| SB-30, T7: bật và tắt không tăng version | PRM-TC-20261006-101037001 | bắt |
| SB-24, T7: ghi quản trị không khóa dòng coupon (hai admin xóa cùng lúc đều ghi audit) | PRM-TC-20261006-101036977 | bắt |
| SB-33, T12: giới hạn mỗi người đếm cả lượt released | PRM-TC-20261006-130100505 | bắt |
| SB-33, T12: giới hạn mỗi người bằng used > limit (vượt thêm một lượt) | PRM-TC-20261006-130100303 | bắt |
| SB-33, T12: giới hạn mỗi người đếm theo mọi người dùng (bỏ lọc user_id) | PRM-TC-20261006-130100505 | bắt |

## Lệch spec
Số TC, E2E ở bảng trên là toàn bộ của epic (78 TC, 4 E2E); mọi dòng pass. Các mục dưới có nhãn; mục `[cần quyết]` cần người hoặc `sdlc-impact`, `sdlc-foundation`; mục `[chưa làm]` là việc spec yêu cầu mà chưa làm được vì epic khác chưa có code. Lượt đầu PRM không sửa mã module khác (chỉ thêm `PromotionModule` vào `app.module.ts`; hạ tầng test `test/support/db.ts`, `test/e2e/server.ts`, `test/e2e/support.ts` thêm bảng coupon vào danh sách dọn và cổng dựng dữ liệu).

1. [đã chọn] Tên lớp giao diện module: mã dùng `PromotionApi` (cùng quy ước `<Tên>Api` của `CatalogApi`, `InventoryApi`: module phơi lớp ở điểm vào duy nhất) trong khi PRM-API (mục Giao diện nội bộ, Giao tiếp giữa module), PRM-REQ-20261006-101036327 BR1, PRM-REQ-20261006-101036470 BR1, CRT-API, CHK-API và các TC của PRM ghi `PromotionService`; bảng "Giao diện module" của `architecture.md` chỉ ghi tên phương thức (`evaluate(..., count_attempt = true)`, `reserve(..., tx)`), không ghi tên lớp (lặp lại bài học L68 của PRD và INV). Chữ ký đúng bảng (`evaluate(input)` với `count_attempt` mặc định true, `reserve(input, tx)`), kiểm bằng `apps/api/test/promotion/guard.spec.ts`. Đã sửa spec (sdlc-impact, spec/changes/PRM-API-20261006-101036543.md): `PromotionApi` ở PRM-API, PRM-REQ, PRM-TC-20261006-101037240, CRT-API, CRT-REQ, CHK-API, CHK-REQ và cột Phương thức của bảng; `guard.spec.ts` đọc lại bảng.
2. [đã chọn] Mã `invalid_argument` dùng trong mã mà PRM-API chưa liệt kê ở danh sách lý do lỗi: `reserve` và `evaluate` trả `{ ok: false, reason: 'invalid_argument' }` khi đầu vào sai hình dạng (khóa lạ như `amount`, kiểu sai, `user_id` hay `order_id` không phải uuid, `count_attempt` không phải boolean); PRM-TC-20261006-101938470 nêu đúng `invalid_argument` cho trường lạ `amount` nhưng PRM-API không có. Đã thêm vào PRM-API (sdlc-impact). Không có mã HTTP nào ngoài tám mã của PRM-API (`code_taken`, `field_immutable`, `coupon_not_editable`, `usage_limit_below_used`, `version_mismatch`, `invalid_transition`, `coupon_expired`, `coupon_exhausted`) cộng mã nền `validation-failed`, `not-found`, `rate-limited`, `unauthenticated`, `forbidden`, `csrf_failed`; mỗi lỗi nghiệp vụ có thêm trường `code` trong problem+json như ví dụ của PRM-API. Test: PRM-TC-20261006-101036615 (`code_taken`), PRM-TC-20261006-101938470 (`invalid_argument`), `guard.spec.ts` (sổ mã sạch, đủ tám mã).
3. [đã chọn] `items_subtotal` lớn hơn 1.000.000.000 là `invalid_subtotal`: spec chỉ nêu "đến 1.000.000.000" ở PRM-REQ-20261006-101036352 BR7 và CHECK `amount` <= 1.000.000.000, không nói lý do lỗi khi vượt; nếu cho qua thì percentage 100 phần trăm của tạm tính lớn hơn 1 tỷ làm CHECK `amount` hỏng và trả 500. Rủi ro: CHK không áp coupon được cho tạm tính trên 1 tỷ đồng. Test: PRM-TC-20261006-101037286, đột biến "tạm tính vượt 1 tỷ được nhận".
4. [đã chọn] Hai requirement đã duyệt mâu thuẫn về coupon `disabled` đã quá hạn khi tra: PRM-REQ-20261006-101036327 BR4 bước 2 (mọi coupon `disabled` là `coupon_not_found`, để không lộ mã có thật mà đang tắt, PRM-SEC T4) và PRM-REQ-20261006-101036424 BR4 ("coupon `disabled` quá hạn vẫn bị từ chối `coupon_expired` khi tra"). Mã làm theo ...327 (thứ tự kiểm và T4); trước đây không TC nào kiểm ca này. Đã chốt (người dùng ủy quyền): theo ...327, sửa PRM-REQ-20261006-101036424 BR4 và thêm PRM-TC-20261007-144433030 (test `expiry.spec.ts`); cùng một mã còn đổi từ `coupon_not_found` sang `coupon_expired` khi job đổi trạng thái sang `expired` (tối đa 1 phút), đã ghi vào BR4.
5. [đã chọn] Thứ tự kiểm của `PATCH /admin/coupons/{id}` trong mã: schema (400), 404, `field_immutable` và ràng buộc theo loại (`value` ngoài miền của percentage, `max_discount` cho fixed: 400, vì cần dòng coupon), `coupon_not_editable`, `usage_limit_below_used`, rồi `version_mismatch`; câu `UPDATE ... WHERE version = :đang-giữ` là cổng khóa lạc quan duy nhất (không kiểm version lần hai trước đó). Hệ quả: body không đổi trường nào thì 200 dù version cũ (PRM-REQ-20261006-101036227 BR10 không nói). PRM-API ghi 400 trước 404 nên khác ở ca sai theo loại trên coupon không tồn tại (404). Test: PRM-TC-20261006-101036805, PRM-TC-20261006-101036829, PRM-TC-20261006-101036882, PRM-TC-20261006-101036781.
6. [đã chọn] Lỗi 400 theo trường dùng dạng của nền PRJ `errors: [{ field, code }]` (mã trường `required`, `invalid_format`, `out_of_range`, `too_short`, `too_long`, `unknown_field`) thay vì `{ field, message }` ở ví dụ của PRM-API; giao diện đọc `field` nên không ảnh hưởng.
7. [đã chọn] Mỗi dòng của danh sách trả thêm `min_order_value` và `max_discount` (PRM-REQ-20261006-101036299 BR5 liệt kê hẹp hơn): ui/admin-coupon-list cần chúng cho cột "Giảm" ("10% tối đa 50.000 đ, từ 200k"). Thêm trường không làm TC nào đỏ; PRM-API và BR5 nay ghi đủ trường (sdlc-impact; danh sách trả 16 trường). Test: PRM-TC-20261006-101037121, PRM-E2E-20261006-101037882.
8. [đã chọn] Dữ liệu minh họa của TC dùng mã `P10`, `P1`, `P15` ngắn hơn 4 ký tự (PRM-REQ-20261006-101036201 BR2, CHECK `coupons_code_format`): test dùng `PX10`, `PX01`, `PX15`. Dữ liệu TC đã sửa (sdlc-impact). Test: PRM-TC-20261006-101037357, PRM-TC-20261006-101037382, PRM-TC-20261006-101037406.
9. [đã chọn] PRM-E2E-20261006-101037906 bước 2 nói dòng coupon `Hết hạn` không có `prm-admin-coupon-list-delete`, trong khi ui/admin-coupon-list (cột Xóa "hiện với Đang chạy, Đã tắt, Hết hạn, Hết lượt"; mục Ghi chú: "Xóa vẫn hiện để admin dọn danh sách"), PRM-REQ-20261006-101036252 BR3 và PRM-TC-20261006-101036930 (xóa coupon hết hạn trả 204) đều cho xóa; hai tài liệu đã duyệt không cùng đúng (cùng họ L64). Code và giao diện làm theo ui và REQ (có nút Xóa, không có nút Tắt, Bật); test E2E giữ phần Tắt, Bật không hiện và kiểm nút Xóa có mặt rồi xóa luôn OLD20., bước 2 của E2E đã sửa (sdlc-impact, bỏ "hay `prm-admin-coupon-list-delete`") nên test khớp spec.
10. [đã chọn] Chỉ mục tìm theo tiền tố là chỉ mục một phần `coupons_code_prefix_idx (code text_pattern_ops) WHERE status <> 'deleted'` thay vì chỉ mục đầy đủ như PRM-DB: Prisma không đọc lại lớp toán tử btree nên `db:check` luôn báo lệch với chỉ mục không một phần; danh sách quản trị luôn có `status <> 'deleted'` nên dùng được chỉ mục này. Kiểm: `pnpm --filter @ecom/api db:check` (với `SHADOW_DATABASE_URL`) và `PRM-TC-20261006-101037193`.
11. [đã chọn] ProcessedEvent ghi `consumer = 'promotion'` (tên module, như `inventory` của INV) thay vì `PRM` (PRM-DB mục Giao dịch và khóa 5); CouponRedeemed mang `aggregate_type = coupon_redemption`, `aggregate_id` = id của lượt (thứ tự theo `aggregate_id`, ADR-011), CouponExpired mang `aggregate_type = coupon`, `aggregate_id` = id coupon; consumer thật chưa có (events.md ghi Consumers `-`). Test: PRM-TC-20261006-101938311, PRM-TC-20261006-101037572.
12. [đã chọn] `reserve` cho đơn đã có lượt: cùng mã và cùng `user_id` thì trả lượt cũ; mã khác, người khác hay lượt đã `released` (đơn hủy hay hết hạn) là `order_already_has_coupon` (PRM-REQ-20261006-101036447 BR7 chỉ nói cùng mã và mã khác): không để lượt đã nhả "sống lại" bằng một lời gọi lặp. Test: PRM-TC-20261006-101037811.
13. [đã chọn] YẾU: PRM-TC-20261006-101037572 và PRM-TC-20261006-101037596 thử ranh giới giờ (09:59:59, đúng 10:00:00, 10:00:01; job lúc +30 giây) bằng tham số `now` tùy chọn của `evaluate`, `reserve` và job (chỉ test dùng; đường chạy thật dùng `now()` của CSDL ngay trong câu SQL qua `COALESCE`) chứ không đổi đồng hồ CSDL; mốc là tương đối so với giờ CSDL lúc dựng nên không có mốc cứng quanh hôm nay. Nâng bằng CSDL có đồng hồ giả hoặc `pg_sleep` tới đúng ranh giới. Các ca không có `now` (job chưa chạy mà đã quá hạn 5 phút, bật coupon quá hạn, PATCH coupon quá hạn) dùng giờ CSDL thật.
14. [đã chọn] YẾU: PRM-TC-20261006-101037642 (hai instance chạy job cùng lúc) và PRM-TC-20261006-113100505 (hai instance dùng chung bộ đếm bậc D) chạy hai ứng dụng trong cùng một tiến trình test với PostgreSQL chung; nâng bằng hai tiến trình riêng. Ca `SKIP LOCKED` của job được kiểm xác định (một giao dịch giữ khóa một coupon, job vẫn xử lý coupon còn lại và không treo), không dựa vào đua nhau.
15. [đã chọn] Không TC nào nhắc job đối soát bộ đếm và giới hạn lô, hạn thời gian, tín hiệu hủy của job hết hạn (cùng họ L61): PRM-DB mục 7 và 8 mô tả nhưng `check-tests` không bắt. Test có thật: ca giới hạn lô và hạn thời gian chạy dưới ID PRM-TC-20261006-101037642, ca đối soát và tải hỗn hợp chạy dưới ID `PRM-DB-20261006-101036519` (không phải TC nên không có dòng ở bảng kết quả). Job đối soát chạy chu kỳ 24 giờ kể từ lúc khởi động tiến trình (`JobRunner` chỉ có `every`, PRM-DB mục 8 ghi "ban đêm, chu kỳ chốt ở tech-design"); ADR-013 chưa liệt kê job đối soát của PRM: đã ghi vào ADR-013 (giống INV) và thêm hai TC (PRM-TC-20261007-144433185 đối soát, PRM-TC-20261007-144433343 lô và hạn thời gian) qua sdlc-impact; test cũ mang ID PRM-DB nay mang ID TC mới.
16. [đã chọn] PRM-TC-20261006-101037263 đặt ngưỡng thời gian "trung vị lệch dưới 30%" là con số tạm (questions.md mục D): test đo xen kẽ từng cặp (100 cặp, không đo tuần tự) và dùng đúng ngưỡng đó; người đã chốt giữ 30% (đo 0,5 đến 5,9%, kể cả dưới tải; hạ 15% được nếu muốn). Lần chạy có thể đỏ khi máy tải nặng (nhiễu đo); chưa thấy đỏ ở các lần chạy đã ghi.
17. [đã chọn] Đột biến lọt có chủ ý (tương đương): bỏ điều kiện `consumed_count + reserved_count < usage_limit` khỏi câu `UPDATE` giữ lượt (SB-25). Kiểm hết chỗ đã nằm trong `verdict` dưới khóa dòng coupon (`FOR UPDATE`) nên câu UPDATE chỉ là lưới an toàn thứ hai theo PRM-DB mục 4 (e), không quan sát được khác biệt; bất biến vẫn do CHECK `coupons_used_le_limit` giữ (đột biến bỏ CHECK bị bắt) và đột biến bỏ `FOR UPDATE` bị bắt bởi PRM-TC-20261006-130100404. Rủi ro: nếu sau này bỏ khóa dòng thì lưới này là chỗ duy nhất, nên giữ.
18. [đã chọn] Web: ô Loại là `<select>` (ui ghi "nhóm chọn"; E2E chọn bằng nhãn), kiểm ở trình duyệt chỉ để báo sớm và server kiểm lại tất cả (SB-11), giờ nhập và hiển thị Asia/Ho_Chi_Minh tính tay UTC+7 rồi gửi UTC (không phụ thuộc `Intl`), lỗi 429 của danh sách và biểu mẫu có đường thoát (nút Thử lại bấm được ngay, tự tải lại khi hết `Retry-After`, PRM-TC-20261006-113100505 chạy cả ở E2E), nút Bật, Tắt không hiện cho coupon Hết hạn và Hết lượt, chú thích "quá hạn" cho coupon Đang chạy hoặc Đã tắt đã qua `expires_at`. Liên kết "Coupon" ở thanh đầu trang (chỉ admin) và nút Tải lại trong banner xung đột chưa có testid vì `spec/testids.md` không khai; muốn E2E cho chúng thì thêm vào ui rồi sinh lại testids (việc của người). Test: PRM-E2E-20261006-101037836, PRM-E2E-20261006-101037859, PRM-E2E-20261006-101037882, PRM-TC-20261006-101036805, PRM-TC-20261006-101037026.
19. [chưa làm] Các bên gọi và bên phát event chưa có code: CRT (`evaluate` ở giỏ), CHK (`evaluate`, `reserve` trong giao dịch đặt hàng), ORD (OrderConfirmed, OrderCancelled, OrderExpired), PAY (PaymentSucceeded). Hai giao diện nội bộ và bốn consumer mới được kiểm bằng lời gọi trực tiếp và event dựng đúng phong bì của events.md; chữ ký phải được CRT và CHK xác nhận khi dựng (mục 1).
20. [đã chọn] Không có lần "test đỏ đúng lý do" cho từng TC: module và test viết trong cùng một lượt (mã trước, rồi TC chạy xanh); bù bằng bảng đột biến (74 chỗ phá, mỗi chỗ làm một TC cụ thể đỏ) và test tải hỗn hợp. Rủi ro: TC xanh vì khẳng định yếu mà đột biến chưa nghĩ tới; reviewer nên chọn đột biến riêng theo điều kiện trong câu SQL (bỏ `AND status = 'active'`, đổi `>=` thành `>`, bỏ `FOR UPDATE` ở từng chỗ).
21. [đã chọn] PRM-SEC T6 (audit) và T13 (event giả) ghi `Kiểm bằng: review` nhưng cũng có test: audit của năm thao tác ghi ở PRM-TC-20261006-101036592, PRM-TC-20261006-101036756, PRM-TC-20261006-101036906, PRM-TC-20261006-101037001; T13 (PRM không có endpoint nhận event) kiểm bằng `guard.spec.ts` (không có route nào ngoài `/admin/coupons` chứa coupon hay promotion). Handler event là tác nhân `system` không audit (PRM-REQ-20261006-101036470 BR11).
22. [đã chọn] `clean_run: pass`: chạy trong `git worktree` (HEAD cộng tệp đã sửa và chưa theo dõi chép sang, vì chưa có commit cho các epic PRD, INV, PRM), `pnpm install --frozen-lockfile --offline`, rồi `scan:secrets`, `check:boundaries`, `lint`, `typecheck`, `test` (524 pass, 0 skip, 70 bộ) và `build` bằng `env -i` chỉ với PATH, HOME, `TEST_DB_BASE`, `NEXT_TELEMETRY_DISABLED`, `STORAGE_TEST_ENDPOINT` và dịch vụ docker db, minio như workflow CI. Chưa chạy trên GitHub Actions thật (chưa push). Lần chạy toàn repo đầu trong cây làm việc có một test của PRJ chập chờn (PRJ-TC-20261006-100124883 ca `staging`: `portOpen` thấy cổng ngẫu nhiên của `freePort` đang mở, nghi bị tiến trình khác trên máy chiếm), pass khi chạy riêng và pass ở bản sạch; không liên quan PRM, để người xử lý nếu tái diễn.
23. [đã chọn] Sửa mã nền sau sdlc-impact (review PRM REV-PRM-03): `RateLimitService` (`apps/api/src/modules/platform/http/rate-limit.ts`) thêm `take(key, limit, windowSeconds)` nguyên tử (một câu UPSERT) và `refund`, giữ `check`, `hitCounter`, `reset`; PRM `evaluate` đếm bằng `take` TRƯỚC khi tra mã và `refund` khi tìm thấy; AUTH `changePassword` (`auth.api.ts`) dùng `take` cho cả hai bộ đếm. `it.failing` của REV-PRM-03 đổi thành `it` (PRM-TC-20261007-144433497, `review.spec.ts`). TC kiểm từng chỗ sửa: PRJ-TC-20261007-144433649 (`take`, `refund`, 40 lời gọi song song), PRM-TC-20261007-144433497, USR-TC-20261007-144433797 (AUTH `changePassword` song song, `interface.spec.ts`); đột biến bảng PRM có thêm hai chỗ (bỏ `refund` khi tìm thấy, đếm không nguyên tử). Đánh đổi: quá 10 lời gọi `evaluate` đồng thời của một người bị chặn thận trọng dù có mã đúng; bộ đếm đọc ra lớn hơn số lần sai thật vì lời gọi vượt ngưỡng vẫn tăng (PRM-TC-20261006-101037309 nay mong 12 thay 10).
