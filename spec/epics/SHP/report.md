---
epic: SHP
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: SHP

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền của module (mã lỗi, schema đầu vào, công thức phí), rồi API phương thức và báo phí, rồi lõi chuyển trạng thái vận đơn và bàn giao, rồi consumer event của ORD, rồi API đọc, rồi giao diện nội bộ và kiểm quyền, rồi giao diện web, rồi E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. Module `shipping` (`apps/api/src/modules/shipping/`, cột Phụ thuộc chỉ ORD) chỉ import `../platform` và điểm vào công khai `../order` (`OrderApi`, `OrderBusinessError`); bảng của SHP chỉ có khóa ngoại tới `orders` (ORD) và bảng của chính SHP; SHP không SELECT bảng `orders` (SB-35, `pnpm check:boundaries` sạch). Epic có TC `lỗi` kiểm mối đe dọa SEC nên *Kiểm đột biến* có mặt (task 13).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261007001200_shipping_tables` (3 bảng, 3 enum, CHECK tên, phí, `rule`, mã vận đơn gắn trạng thái, tiền thu hộ, `delivered_at`, lý do và ghi chú; unique tên không phân biệt hoa thường, unique mã vận đơn, unique một phần vận đơn còn hiệu lực mỗi đơn; khóa ngoại RESTRICT; cột `seq` identity; trigger chỉ-thêm và thu quyền), schema Prisma `shipping.prisma` (quan hệ ngược `shipments` ở `order.prisma`) | SHP-DB-20261006-101603015 | - | done |
| 2 | Nền của module: sổ chín mã lỗi (`registerProblem`), schema đầu vào đóng (zod, chặn `__proto__`, NUL, nửa cặp thay thế lẻ), bảng chuyển trạng thái `TRANSITIONS` (nguồn duy nhất), chuẩn hóa tên thành phố, công thức phí, bảng bậc SB-14 | SHP-API-20261006-101603042, SHP-SEC-20261006-101603066 | 1 | done |
| 3 | API phương thức vận chuyển: admin tạo (khóa advisory, trần 20), sửa, bật, tắt (khóa lạc quan `version`), danh sách; customer xem phương thức đang bật; báo phí `quote` (chỉ đọc) | SHP-API-20261006-101603042, SHP-DB-20261006-101603015 | 1, 2 | done |
| 4 | Lõi chuyển trạng thái vận đơn và bàn giao: khóa dòng, `UPDATE ... WHERE status = :cũ`, `OrderApi.lockForHandoff(order_id, tx)` sau khi khóa vận đơn và trước khi ghi `shipped`, lịch sử, audit, outbox cùng giao dịch; sửa mã, giao xong, thất bại, hoàn hàng | SHP-API-20261006-101603042, SHP-DB-20261006-101603015, SHP-SEC-20261006-101603066 | 1, 2 | done |
| 5 | Consumer `shipping` của OrderPaid, OrderConfirmed (tạo vận đơn `pending`, `ON CONFLICT DO NOTHING`, idempotent theo `event_id` và theo đơn) và OrderCancelled (hủy vận đơn `pending`; lệch thì log `error`) | SHP-DB-20261006-101603015, SHP-API-20261006-101603042 | 2, 4 | done |
| 6 | API đọc: danh sách vận đơn cho staff, admin (lọc, sắp, phân trang, bậc D), chi tiết theo mã đơn (serializer theo role, khối `recipient` kèm audit), lịch sử theo `seq` | SHP-API-20261006-101603042, SHP-DB-20261006-101603015 | 1, 2 | done |
| 7 | Giao diện nội bộ `ShippingApi` (`listActiveMethods`, `quote`) cho CRT, CHK; kiểm lệch ma trận quyền và danh sách route trên AppModule thật; kiểm mã lỗi trong mã so với SHP-API | SHP-API-20261006-101603042, SHP-SEC-20261006-101603066 | 3, 4, 5, 6 | done |
| 8 | Test API trên PostgreSQL thật (62 TC, đua song song thật, tiến trình bị SIGKILL, hai instance dùng chung CSDL) và bẫy bổ sung của review (ma trận event, chuỗi biên, trần tài nguyên, tải hỗn hợp, rollback) | SHP-TC-20261006-102133000, SHP-TC-20261006-102134039 | 3, 4, 5, 6, 7 | done |
| 9 | Màn theo dõi vận chuyển của customer `/orders/{code}/shipment` (liên kết từ chi tiết đơn của ORD) | ui/shipment-tracking | 6 | done |
| 10 | Màn danh sách và chi tiết vận đơn của staff, admin (bàn giao, sửa mã, giao xong, thất bại, hoàn hàng, lịch sử, 429 có đường thoát) | ui/shipment-admin-list, ui/shipment-admin-detail | 6, 4 | done |
| 11 | Màn quản lý phương thức vận chuyển của admin (tạo, sửa, bật, tắt, trần 20, xung đột phiên bản) | ui/shipping-method-admin | 3 | done |
| 12 | E2E trình duyệt thật, điểm điều khiển và dữ liệu mồi cho E2E (`/seed-shipping-method`, `/seed-shipment`, `/shipment`) | SHP-E2E-20261006-102134090, SHP-E2E-20261006-102134118, SHP-E2E-20261006-102134145, SHP-E2E-20261006-102134172, SHP-E2E-20261006-102134197, SHP-E2E-20261006-102134222 | 9, 10, 11 | done |
| 13 | Bảng đột biến SHP và cổng kiểm của nó (`scripts/mutations-shp.json`, `test/tooling/mutations-shp.spec.ts`) | SHP-SEC-20261006-101603066 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 | done |
| 14 | Đồng bộ sau review SHP (sdlc-impact): migration `20261008000100_shipping_order_code` (cột `order_code` bất biến: bước mở rộng, backfill, CHECK, trigger), ghi `order_code` lúc tạo vận đơn, danh sách đọc từ cột (hết N+1), lịch sử lấy 100 dòng MỚI NHẤT, ba TC mới và đột biến tương ứng | SHP-DB-20261006-101603015, SHP-API-20261006-101603042, SHP-TC-20261008-091406341, SHP-TC-20261008-091406444, SHP-TC-20261008-091406542 | 1, 6, 5 | done |
| 15 | Bốn E2E mới cho mục 19 (5xx màn quản trị, lỗi lịch sử riêng, 401 `session_expired`, `ship-blocked`) và đột biến web tương ứng | SHP-E2E-20261008-091406629, SHP-E2E-20261008-091406726, SHP-E2E-20261008-091406820, SHP-E2E-20261008-091406911 | 10, 11, 12 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (59 TC, 10 E2E; sau sdlc-impact thêm 3 TC và 4 E2E mới). TC API chạy trên PostgreSQL thật (`ecom_test`, dựng lại từ migration mỗi lần chạy) với ORD thật (`OrderModule` cùng `AppModule`), nhiều giao dịch thật chạy song song (pool 16): bàn giao đua hủy đơn 200 vòng, hai nhân viên bàn giao 100 vòng, giao xong đua thất bại 100 vòng, hai admin tạo phương thức ở vị trí 20 trong 50 vòng, tiến trình con bị `SIGKILL` sau commit, hai instance dùng chung một CSDL cho bộ đếm bậc D. Ngoài 56 TC còn 6 bẫy rút từ bài học các epic trước (`apps/api/test/shipping/rev.spec.ts`: ma trận event x trạng thái, chuỗi biên, trần tài nguyên gấp triệu lần, đếm giới hạn song song, tải hỗn hợp 40 vận đơn kiểm bảo toàn, rollback khi audit hay lịch sử lỗi, `__proto__`, pool nhỏ), kiểm từng CHECK, unique, khóa ngoại ở `db.spec.ts` và bảng đột biến; các test này mang ID TC liên quan và ID tài liệu thiết kế. E2E chạy bằng Jest và `playwright-core` điều khiển Chromium thật trên bản build production của web và API thật (`apps/api/test/e2e/shp.e2e.spec.ts`): sáu E2E của spec cộng `SHP-WEB-01` đến `SHP-WEB-04` (tên `__proto__` và HTML là văn bản, trần 20 và xung đột phiên bản, quyền, liên kết từ ORD) và hai ca 429 có đường thoát (`SHP-TC-20261006-102134039`, `SHP-TC-20261006-130000001` ở giao diện, kiểm thêm ở API). Hàng của hai TC đó và các TC có nhiều tầng ghi file test API.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| SHP-E2E-20261006-102134090 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261006-102134118 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261006-102134145 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261006-102134172 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261006-102134197 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261006-102134222 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261008-091406629 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | lỗi 5xx dựng bằng `page.route` trả problem+json 500 kèm CORS (API thật khó tự lỗi 5xx); bàn tay người: chưa thử với máy chủ lỗi thật |
| SHP-E2E-20261008-091406726 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | - |
| SHP-E2E-20261008-091406820 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | phiên hết hạn thật (đồng hồ giả của API tua 31 phút), không dựng 401 |
| SHP-E2E-20261008-091406911 | E2E | apps/api/test/e2e/shp.e2e.spec.ts | pass | `order-not-shippable` thật (đơn `cancelled` còn vận đơn `pending`) và `shipment-invalid-transition` thật (nhân viên khác bàn giao trước) |
| SHP-TC-20261006-102133000 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261006-102133028 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261006-102133054 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261006-102133082 | TC | apps/api/test/shipping/guard.spec.ts | pass | - |
| SHP-TC-20261006-102133111 | TC | apps/api/test/shipping/db.spec.ts | pass | - |
| SHP-TC-20261006-102133136 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261006-102133162 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261006-102133186 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261006-102133211 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133235 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133259 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133284 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133308 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133333 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133358 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133383 | TC | apps/api/test/shipping/catalog.spec.ts | pass | - |
| SHP-TC-20261006-102133407 | TC | apps/api/test/shipping/create.spec.ts | pass | - |
| SHP-TC-20261006-102133431 | TC | apps/api/test/shipping/create.spec.ts | pass | - |
| SHP-TC-20261006-102133455 | TC | apps/api/test/shipping/create.spec.ts | pass | TC đã sửa qua sdlc-impact (log error của relay mang event_id, attempts, correlation_id; 10 dòng warn của handler mang order_id): test khẳng định cả hai. Xem Lệch spec 4 |
| SHP-TC-20261006-102133480 | TC | apps/api/test/shipping/create.spec.ts | pass | - |
| SHP-TC-20261006-102133505 | TC | apps/api/test/shipping/create.spec.ts | pass | - |
| SHP-TC-20261006-102133529 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-102133553 | TC | apps/api/test/shipping/guard.spec.ts | pass | - |
| SHP-TC-20261006-102133578 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-102133602 | TC | apps/api/test/shipping/db.spec.ts | pass | - |
| SHP-TC-20261006-102133626 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-102133650 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-102133675 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-102133699 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-102133722 | TC | apps/api/test/shipping/tracking.spec.ts | pass | - |
| SHP-TC-20261006-102133746 | TC | apps/api/test/shipping/tracking.spec.ts | pass | - |
| SHP-TC-20261006-102133770 | TC | apps/api/test/shipping/tracking.spec.ts | pass | - |
| SHP-TC-20261006-102133795 | TC | apps/api/test/shipping/result.spec.ts | pass | - |
| SHP-TC-20261006-102133819 | TC | apps/api/test/shipping/result.spec.ts | pass | - |
| SHP-TC-20261006-102133844 | TC | apps/api/test/shipping/result.spec.ts | pass | - |
| SHP-TC-20261006-102133868 | TC | apps/api/test/shipping/result.spec.ts | pass | - |
| SHP-TC-20261006-102133893 | TC | apps/api/test/shipping/result.spec.ts | pass | - |
| SHP-TC-20261006-102133916 | TC | apps/api/test/shipping/result.spec.ts | pass | TC đã sửa qua sdlc-impact (giao diện kiểm bằng onerror và tiêu đề trang, khớp SHP-WEB-01 ở `shp.e2e.spec.ts`). Xem Lệch spec 5 |
| SHP-TC-20261006-102133941 | TC | apps/api/test/shipping/result.spec.ts | pass | - |
| SHP-TC-20261006-102133965 | TC | apps/api/test/shipping/read.spec.ts | pass | - |
| SHP-TC-20261006-102133988 | TC | apps/api/test/shipping/read.spec.ts | pass | - |
| SHP-TC-20261006-102134013 | TC | apps/api/test/shipping/read.spec.ts | pass | - |
| SHP-TC-20261006-102134039 | TC | apps/api/test/shipping/read.spec.ts | pass | - |
| SHP-TC-20261006-102134063 | TC | apps/api/test/shipping/read.spec.ts | pass | - |
| SHP-TC-20261006-102147270 | TC | apps/api/test/shipping/cancel.spec.ts | pass | - |
| SHP-TC-20261006-102147299 | TC | apps/api/test/shipping/cancel.spec.ts | pass | - |
| SHP-TC-20261006-102147325 | TC | apps/api/test/shipping/cancel.spec.ts | pass | - |
| SHP-TC-20261006-102147349 | TC | apps/api/test/shipping/history.spec.ts | pass | - |
| SHP-TC-20261006-102147373 | TC | apps/api/test/shipping/history.spec.ts | pass | - |
| SHP-TC-20261006-102147397 | TC | apps/api/test/shipping/db.spec.ts | pass | - |
| SHP-TC-20261006-102147421 | TC | apps/api/test/shipping/history.spec.ts | pass | - |
| SHP-TC-20261006-102147445 | TC | apps/api/test/shipping/cancel.spec.ts | pass | - |
| SHP-TC-20261006-110000001 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-120000001 | TC | apps/api/test/shipping/cancel.spec.ts | pass | - |
| SHP-TC-20261006-130000001 | TC | apps/api/test/shipping/ship.spec.ts | pass | - |
| SHP-TC-20261006-130000002 | TC | apps/api/test/shipping/methods.spec.ts | pass | - |
| SHP-TC-20261008-091406341 | TC | apps/api/test/shipping/ordercode.spec.ts | pass | - |
| SHP-TC-20261008-091406444 | TC | apps/api/test/shipping/ordercode.spec.ts | pass | câu backfill được trích từ file migration và chạy thật |
| SHP-TC-20261008-091406542 | TC | apps/api/test/shipping/review.spec.ts | pass | hai test: cấu hình ở `review.spec.ts`, pool 2 xử lý 8 OrderPaid ở `rev.spec.ts` |

## Kiểm đột biến
230 đột biến: 228 bắt, 2 lọt do tương đương (có lý do), 0 chưa xử lý (17 đột biến thêm sau sdlc-impact: cột `order_code` và migration của nó, N+1, lịch sử 100 dòng mới nhất, `DB_POOL_MAX`, log `order-read-failed`, năm chỗ phá giao diện của bốn E2E mới; đã chạy bằng `mutate.mjs` toàn bộ 23 đột biến mới hoặc sửa chữ, đều bắt; 207 đột biến còn lại giữ kết quả lượt trước, chỉ kiểm lại bằng `check-mutations.mjs` rằng đoạn cần phá còn đúng một lần) chọn theo từng điều kiện trong câu SQL, từng nhánh trạng thái, từng mã lỗi, từng SB `Kiểm bằng: test` của SHP-SEC (16 SB: SB-05, 06, 07, 08, 11, 12, 13, 14, 18, 19, 20, 23, 24, 27, 30, 32), từng CHECK, unique, khóa ngoại, trigger và thu quyền của migration, công thức phí và chuẩn hóa tên thành phố, bảng chuyển trạng thái `TRANSITIONS` (từng ô `from`), và phần nền sửa kèm (CSRF của platform); chạy bằng script chung `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-shp.json --cwd apps/api` (bảng JSON, mỗi đột biến chạy đúng một TC hoặc một test, test nền xanh trước, tệp được khôi phục sau mỗi lần). Cổng kiểm của chính bảng: `node apps/api/scripts/check-mutations.mjs apps/api/scripts/mutations-shp.json --sec spec/epics/SHP/design/SHP-SEC-20261006-101603066.md` (đoạn cần phá còn đúng một lần, SB test nào cũng có đột biến, test và ID có thật), có test `apps/api/test/tooling/mutations-shp.spec.ts`. Lượt chạy đầu lọt 14 chỗ và 1 chỗ hỏng biên dịch: 7 lỗ hổng test thật (đã thêm test: ngưỡng miễn phí và `version` vượt trần, tên trùng khi sửa, sắp tên không phân biệt hoa thường, xóa đơn hay phương thức khi vận đơn không có lịch sử, phương thức đúng của đơn), 3 kiểm trùng với câu `UPDATE ... AND version` (một giữ và khóa bằng test thứ tự `version-conflict` trước `tracking-number-unchanged`, hai bỏ khỏi mã), 2 đột biến vô tác dụng (đã bỏ), 2 tương đương (còn lại bên dưới); đột biến hỏng biên dịch đã bỏ. Hai lọt còn lại là tương đương có lý do (cột Kết quả); bỏ cả khóa dòng `FOR UPDATE` lẫn điều kiện `status` của `UPDATE` thì `SHP-TC-20261006-102133941` đỏ (thử tay). Mười chỗ phá giao diện (E2E bắt: trạng thái có thời hạn không thoát, 404 lẫn với lỗi chung, nút hành động sai trạng thái, nút xác nhận không khóa, ô mã không chữ hoa, mất bộ lọc, ô nhập cắt dữ liệu, thiếu `version`, HTML thô ở tên và ghi chú) nằm cuối bảng.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-05, T4: staff được tạo phương thức (sai ma trận) | SHP-TC-20261006-102133082 | bắt |
| SB-05, T4: staff xem được danh sách phương thức quản trị | SHP-TC-20261006-102133082 | bắt |
| SB-05, T4: staff được sửa phương thức | SHP-TC-20261006-102133082 | bắt |
| SB-05, T4: staff được tắt phương thức | SHP-TC-20261006-102133082 | bắt |
| SB-05, T3: customer được bàn giao vận đơn | SHP-TC-20261006-102133553 | bắt |
| SB-05, T3: customer được sửa mã vận đơn | SHP-TC-20261006-102133553 | bắt |
| SB-05, T3: customer được báo giao thất bại | SHP-TC-20261006-102133893 | bắt |
| SB-05, T3: customer được xác nhận giao xong | SHP-TC-20261006-102133893 | bắt |
| SB-05, T3: customer được hoàn hàng | SHP-TC-20261006-102133893 | bắt |
| SB-05, T3: customer xem danh sách vận đơn | SHP-TC-20261006-102133553 | bắt |
| SB-05, T3: staff được báo phí (quote chỉ customer) | SHP-TC-20261006-102133308 | bắt |
| SB-05: staff xem phương thức đang bật của customer | SHP-TC-20261006-102133235 | bắt |
| SB-05, T1: lịch sử không còn cho customer | SHP-TC-20261006-102133082 | bắt |
| SB-05, T11: thêm route HTTP nhận event của ORD (không có đường HTTP nào để giả event) | SHP-TC-20261006-102147397 | bắt |
| SB-32, T13: thêm route sửa lịch sử vận đơn | SHP-TC-20261006-102147397 | bắt |
| SB-06, T1: customer xem chi tiết bằng findByCode (đơn người khác lộ) | SHP-TC-20261006-102134013 | bắt |
| SB-06, T1: lịch sử của đơn người khác không kiểm sở hữu | SHP-TC-20261006-102147373 | bắt |
| SB-06, T2: mã sai định dạng trả 400 thay vì cùng 404 (tách được mã sai định dạng khỏi mã không có) | SHP-TC-20261006-102134013 | bắt |
| SB-08, T10: customer thấy cod_amount | SHP-TC-20261006-102133965 | bắt |
| SB-08, T9: staff luôn thấy người nhận (kể cả đã giao) | SHP-TC-20261006-102134063 | bắt |
| SB-08, T9: staff không còn thấy người nhận khi failed | SHP-TC-20261006-102134063 | bắt |
| SB-08, T9: staff thấy người nhận cả khi returned | SHP-TC-20261006-102134063 | bắt |
| SB-08, T9: admin không còn thấy người nhận khi đã giao | SHP-TC-20261006-102134063 | bắt |
| SB-08, T10: customer thấy lý do thất bại ở lịch sử | SHP-TC-20261006-102147349 | bắt |
| SB-08, T10: customer thấy ghi chú ở lịch sử | SHP-TC-20261006-102147349 | bắt |
| SB-08, T9: danh sách nhận tham số email (tìm theo dữ liệu cá nhân) | SHP-TC-20261006-102134039 | bắt |
| SB-08, T10: ShipmentFailed mang ghi chú nội bộ | SHP-TC-20261006-102133819 | bắt |
| SB-08, SB-19, T9: audit xem người nhận ghi cả địa chỉ | SHP-TC-20261006-102133988 | bắt |
| SB-19, T9: lần xem người nhận không còn audit (đổi tên hành động) | SHP-TC-20261006-102133988 | bắt |
| SB-19, T9: lỗi audit xem người nhận bị nuốt (vẫn trả recipient) | SHP-TC-20261006-102133988 | bắt |
| SB-08, T9: danh sách của staff trả cả địa chỉ (recipient) | SHP-TC-20261006-102133988 | bắt |
| SB-08: staff thấy cod_amount sai (0) | SHP-TC-20261006-102133988 | bắt |
| SB-08: staff không thấy version | SHP-TC-20261006-102133988 | bắt |
| SB-08: lý do thất bại chỉ cho failed (bỏ returned) | SHP-TC-20261006-102134063 | bắt |
| SB-08, T22: log bỏ qua event ghi cả payload | SHP-TC-20261006-102133431 | bắt |
| SB-11, T5: body chấp nhận khóa lạ (shipped_at, status, fee, is_active) | SHP-TC-20261006-102133529 | bắt |
| SB-11: khóa __proto__ của JSON lọt qua schema đóng | SHP-TC-20261006-102133111 | bắt |
| SB-11, T8: mã vận đơn tối thiểu 8 -> 1 | SHP-TC-20261006-102133675 | bắt |
| SB-11, T8: mã vận đơn tối đa 30 -> 60 | SHP-TC-20261006-102133675 | bắt |
| SB-11, T8: kiểm khuôn mã vận đơn SAU khi đổi chữ hoa (ſ thành S lọt khuôn) | SHP-TC-20261006-102133602 | bắt |
| SB-11, T8: mã vận đơn không bỏ khoảng trắng đầu cuối | SHP-TC-20261006-102133675 | bắt |
| SB-11, T14: ghi chú tối đa 300 -> 3000 ký tự | SHP-TC-20261006-102133916 | bắt |
| SB-11, T14: độ dài đếm theo đơn vị UTF-16 thay vì ký tự | SHP-TC-20261006-102133916 | bắt |
| SB-11, T14: ghi chú cho phép NUL (ký tự điều khiển) | SHP-TC-20261006-102133893 | bắt |
| SB-11, T14: tên, thành phố, mã đơn cho phép NUL | SHP-TC-20261006-102133111 | bắt |
| SB-11, T14: ghi chú trim làm mất kiểm chỉ khoảng trắng (không chuyển thành không có) | SHP-TC-20261006-102133819 | bắt |
| SB-11, T6: phí cơ bản tối đa 1.000.000 -> 10.000.000 | SHP-TC-20261006-102133186 | bắt |
| SB-11, T6: phụ thu tối đa 500.000 -> 5.000.000 | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: ngưỡng miễn phí tối đa -> gấp 10 | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: ngưỡng miễn phí nhận số âm | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: tối đa 63 thành phố -> 640 | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: phụ thu > 0 không bắt buộc có thành phố | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: số thực được nhận làm tiền (bỏ kiểm số nguyên) | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: tên phương thức tối thiểu 2 -> 1 | SHP-TC-20261006-102133186 | bắt |
| SB-11, T6: tên phương thức tối đa 80 -> 800 | SHP-TC-20261006-102133111 | bắt |
| SB-11, T5: tên không cắt khoảng trắng (2 khoảng trắng vẫn là tên) | SHP-TC-20261006-102133186 | bắt |
| SB-11, T5: báo phí tối đa subtotal gấp 10 | SHP-TC-20261006-102133308 | bắt |
| SB-11, T5: city của báo phí 100 -> 1000 ký tự | SHP-TC-20261006-102133308 | bắt |
| SB-11: lý do thất bại nhận giá trị ngoài danh sách | SHP-TC-20261006-102133893 | bắt |
| SB-11: mã đơn của danh sách tối đa 32 -> 3200 | SHP-TC-20261006-102134039 | bắt |
| SB-11, T17: version tối đa int32 bị bỏ (vượt int32 gây lỗi CSDL thô) | SHP-TC-20261006-102133136 | bắt |
| SB-11, T17: lịch sử trả tối đa 100 -> 1000 dòng | SHP-TC-20261006-102134039 | bắt |
| SB-11, T17: tracking_number của danh sách khớp tiền tố (LIKE) | SHP-TC-20261006-102134063 | bắt |
| SB-13, T15: nền bỏ kiểm Origin của CSRF (POST từ trang khác nguồn lọt) | SHP-TC-20261006-102133578 | bắt |
| SB-13, T15: nền bỏ PATCH khỏi các phương thức đổi dữ liệu của CSRF | SHP-TC-20261006-102133578 | bắt |
| SB-14, T16: danh sách vận đơn bỏ giới hạn bậc D (30 -> 300) | SHP-TC-20261006-102134039 | bắt |
| SB-14, T16: danh sách vận đơn dùng bậc C trong bộ nhớ (không đúng giữa các instance) | SHP-TC-20261006-102134039 | bắt |
| SB-14, T25: thao tác ghi của staff 30 -> 300 | SHP-TC-20261006-130000001 | bắt |
| SB-14, T25: thao tác ghi của staff dùng bậc C trong bộ nhớ | SHP-TC-20261006-130000001 | bắt |
| SB-14, T25: quản trị phương thức 30 -> 300 | SHP-TC-20261006-130000002 | bắt |
| SB-14, T25: đọc và ghi quản trị không còn chung bộ đếm | SHP-TC-20261006-130000002 | bắt |
| SB-14, T16: báo phí 120 -> 1200 | SHP-TC-20261006-102133383 | bắt |
| SB-14, T16: tra cứu 120 -> 1200 | SHP-TC-20261006-102133383 | bắt |
| SB-14, T16: chi tiết và lịch sử không chung hạn mức | SHP-TC-20261006-102133383 | bắt |
| SB-14, T16: tra cứu chi tiết bỏ @RateLimit | SHP-TC-20261006-102133383 | bắt |
| SB-18, T22: log lệch của OrderCancelled ghi user_id | SHP-TC-20261006-102147299 | bắt |
| SB-18, T22: log nhận mã đơn là chuỗi bất kỳ của payload (rò rỉ dữ liệu cá nhân) | SHP-TC-20261006-102133308 | bắt |
| SB-18: log tạo vận đơn không có mã đơn (bỏ order_code) | SHP-TC-20261006-102133431 | bắt |
| SB-19, T12: audit của chuyển trạng thái đổi tên hành động | SHP-TC-20261006-102133529 | bắt |
| SB-19, T12: audit ghi sai role (luôn admin) | SHP-TC-20261006-102133529 | bắt |
| SB-19, T12: audit sửa mã vận đơn đổi tên hành động | SHP-TC-20261006-102133722 | bắt |
| SB-19, T12: audit tạo phương thức đổi tên hành động | SHP-TC-20261006-102133000 | bắt |
| SB-19, T12: audit sửa phương thức ghi giá trị sau thay cho trước | SHP-TC-20261006-102133028 | bắt |
| SB-19, T12: audit tạo vận đơn theo event ghi role admin thay cho system | SHP-TC-20261006-102133407 | bắt |
| SB-19, T12: audit hủy vận đơn theo event không ghi nguồn event | SHP-TC-20261006-102147270 | bắt |
| SB-19, T12: audit tắt hoặc bật phương thức dùng chung một tên | SHP-TC-20261006-102133054 | bắt |
| SB-19, T12: audit sửa mã vận đơn quên ghi mã cũ | SHP-TC-20261006-102133722 | bắt |
| SB-20, T21: 409 mã vận đơn trùng kèm giá trị của vận đơn khác | SHP-TC-20261006-102133602 | bắt |
| SB-23, T5: ngưỡng miễn phí dùng > thay cho >= | SHP-TC-20261006-102133333 | bắt |
| SB-23, T5: phụ thuộc phụ thu bị bỏ khỏi phí | SHP-TC-20261006-102133284 | bắt |
| SB-23, T5: phụ thu áp cả khi không khớp thành phố | SHP-TC-20261006-102133333 | bắt |
| SB-23, T5: so khớp thành phố theo chứa chuỗi (Hà khớp Hà Giang) | SHP-TC-20261006-102133333 | bắt |
| SB-23: chuẩn hóa tên thành phố không bỏ dấu | SHP-TC-20261006-102133333 | bắt |
| SB-23: chuẩn hóa tên thành phố không đổi đ thành d | SHP-TC-20261006-102133333 | bắt |
| SB-23: chuẩn hóa tên thành phố không gộp khoảng trắng | SHP-TC-20261006-102133284 | bắt |
| SB-23: chuẩn hóa tên thành phố không chuyển chữ thường | SHP-TC-20261006-102133333 | bắt |
| SB-23, T23: báo phí bỏ kiểm phương thức đã tắt | SHP-TC-20261006-102133308 | bắt |
| SB-23, T23: danh sách của customer gồm cả phương thức đã tắt | SHP-TC-20261006-102133211 | bắt |
| SB-23: danh sách của customer sắp theo tên thay cho phí | SHP-TC-20261006-102133211 | bắt |
| SB-23: danh sách của customer không phân biệt hoa thường khi cùng phí (bỏ lower) | SHP-TC-20261006-102133259 | bắt |
| SB-23, T6: rule đọc từ CSDL không qua schema | SHP-TC-20261006-102133308 | bắt |
| SB-23: số tiền thu hộ của đơn COD bằng 0 | SHP-TC-20261006-102133407 | bắt |
| SB-23: đơn online cũng thu hộ | SHP-TC-20261006-102133407 | bắt |
| SB-23, T5: giao diện nội bộ trả phí 0 khi phương thức tắt | SHP-TC-20261006-102133308 | bắt |
| SB-23: giao diện nội bộ nhận subtotal âm | SHP-TC-20261006-102133308 | bắt |
| SB-23: giao diện nội bộ nhận subtotal thực | SHP-TC-20261006-102133308 | bắt |
| SB-23: giao diện nội bộ nhận thành phố rỗng | SHP-TC-20261006-102133308 | bắt |
| SB-24, T7: bàn giao nhận cả vận đơn đã shipped | SHP-TC-20261006-102133650 | bắt |
| SB-24, T7: giao xong nhận cả vận đơn failed | SHP-TC-20261006-102133868 | bắt |
| SB-24, T7: thất bại nhận cả vận đơn pending | SHP-TC-20261006-102133868 | bắt |
| SB-24, T7: hoàn hàng nhận cả vận đơn shipped (bỏ qua failed) | SHP-TC-20261006-102133893 | bắt |
| SB-24, T7: hoàn hàng nhận cả vận đơn delivered | SHP-TC-20261006-102133868 | bắt |
| SB-24, T20: bảng chuyển cho phép hủy vận đơn shipped (nguồn duy nhất của hủy theo event) | SHP-TC-20261006-102133480 | bắt |
| SB-24, T7: bỏ kiểm trạng thái hiện tại trong bảng chuyển | SHP-TC-20261006-102133868 | bắt |
| SB-24, T7: bàn giao đích sai (shipped thành delivered) | SHP-TC-20261006-102133529 | bắt |
| SB-24, T20: bỏ lockForHandoff khỏi giao dịch bàn giao | SHP-TC-20261006-102133626 | bắt |
| SB-24, T20: lỗi nghiệp vụ của lockForHandoff bị nuốt (vẫn bàn giao đơn đã hủy) | SHP-TC-20261006-102133626 | bắt |
| SB-24, T20: lỗi order_not_found của ORD thành order-not-shippable | SHP-TC-20261006-102133626 | bắt |
| SB-24, T8: unique mã vận đơn không đổi thành 409 (500) | SHP-TC-20261006-102133602 | bắt |
| SB-24, T8: sửa mã trùng mã khác không đổi thành 409 | SHP-TC-20261006-102133746 | bắt |
| SB-24, T7: sửa mã không kiểm trạng thái shipped | SHP-TC-20261006-102133746 | bắt |
| SB-30, T7: sửa mã không kiểm version | SHP-TC-20261006-102133770 | bắt |
| SB-24: sửa mã trùng mã hiện tại (chỉ khác hoa thường) không bị từ chối | SHP-TC-20261006-102133770 | bắt |
| SB-24, T7: sửa mã không tăng version | SHP-TC-20261006-102133722 | bắt |
| SB-24, T7: chuyển trạng thái không tăng version | SHP-TC-20261006-102133529 | bắt |
| SB-24, T7: bỏ khóa dòng vận đơn (FOR UPDATE) khi đọc | SHP-TC-20261006-102133770 | bắt |
| SB-24, T7: lock bỏ điều kiện status <> cancelled (có vận đơn cancelled cũ thì thao tác nhầm dòng cũ) | SHP-TC-20261006-102147270 | bắt |
| SB-24: bỏ điều kiện status cũ ở câu UPDATE chuyển trạng thái (lớp bảo vệ thứ hai; còn khóa dòng) | - | lọt: khi còn khóa dòng (lớp bảo vệ kép: khóa dòng FOR UPDATE và điều kiện status của UPDATE); bỏ cả hai thì SHP-TC-20261006-102133941 đỏ, đã thử tay, xem report |
| SB-24, T7: restockable bị đảo (damaged vẫn nhập kho) | SHP-TC-20261006-102133844 | bắt |
| SB-24: restockable lấy dòng failed CŨ NHẤT thay cho mới nhất | SHP-TC-20261006-102133844 | bắt |
| SB-24: restockable luôn true | SHP-TC-20261006-102133844 | bắt |
| SB-24, T18: tạo vận đơn cho cả đơn không còn paid hoặc confirmed | SHP-TC-20261006-102133431 | bắt |
| SB-24, T18: tạo vận đơn bỏ ON CONFLICT DO NOTHING (hai event cùng đơn gây lỗi) | SHP-TC-20261006-102133480 | bắt |
| SB-24, T18: tạo vận đơn thiếu dòng lịch sử pending (sai trạng thái đầu) | SHP-TC-20261006-102133407 | bắt |
| SB-24, T20: hủy theo event nhận cả vận đơn đã shipped | SHP-TC-20261006-102147299 | bắt |
| SB-24: hủy theo event không tăng version | SHP-TC-20261006-102147270 | bắt |
| SB-24: hủy theo event bỏ dòng lịch sử cancelled | SHP-TC-20261006-102147270 | bắt |
| SB-24: tạo vận đơn chọn sai phương thức (bỏ shipping_method_id của đơn) | SHP-TC-20261006-102133407 | bắt |
| SB-27, T19: chuyển trạng thái không ghi event vào outbox | SHP-TC-20261006-102133529 | bắt |
| SB-27, T19: ShipmentShipped dùng sai loại event | SHP-TC-20261006-102133529 | bắt |
| SB-27, T19: ShipmentDelivered dùng sai loại event | SHP-TC-20261006-102133795 | bắt |
| SB-27, T19: ShipmentFailed dùng sai loại event | SHP-TC-20261006-102133819 | bắt |
| SB-27, T19: ShipmentReturned dùng sai loại event | SHP-TC-20261006-102133844 | bắt |
| SB-27: sửa mã phát ShipmentShipped thay cho ShipmentTrackingChanged | SHP-TC-20261006-102133722 | bắt |
| SB-27, T19: event gắn vào mã đơn thay cho mã vận đơn (aggregate_id) | SHP-TC-20261006-102133529 | bắt |
| SB-27: ShipmentShipped không mang mã vận đơn | SHP-TC-20261006-102133529 | bắt |
| SB-27: ShipmentFailed không mang order_code | SHP-TC-20261006-102133819 | bắt |
| SB-27: ShipmentFailed lấy user_id sai (id đơn) | SHP-TC-20261006-102133819 | bắt |
| SB-27: ShipmentReturned thiếu restockable | SHP-TC-20261006-102133844 | bắt |
| SB-27: sửa mã không phát ShipmentTrackingChanged | SHP-TC-20261006-102133722 | bắt |
| SB-27: consumer sai tên (chống trùng không cùng khóa với event_id đã xử lý) | SHP-TC-20261006-102133407 | bắt |
| SB-30, T24: tạo phương thức bỏ khóa advisory (vượt trần 20) | SHP-TC-20261006-102133162 | bắt |
| SB-30, T24: trần phương thức 20 -> 21 | SHP-TC-20261006-102133162 | bắt |
| SB-30, T24: trần phương thức so sánh > thay cho >= | SHP-TC-20261006-102133162 | bắt |
| SB-30, T24: sửa phương thức không tăng version | SHP-TC-20261006-102133028 | bắt |
| SB-30, T24: bật lại phương thức đang bật không bị từ chối | SHP-TC-20261006-102133186 | bắt |
| SB-30, T24: sửa phương thức không kiểm version ở câu UPDATE (khóa lạc quan) | SHP-TC-20261006-102133136 | bắt |
| SB-30, T24: bật tắt không kiểm version ở câu UPDATE (khóa lạc quan) | SHP-TC-20261006-102133186 | bắt |
| SB-24: tạo vận đơn không kiểm phương thức của đơn có ở SHP (khóa ngoại làm ném lỗi và relay giao lại tới hết lượt) | SHP-TC-20261006-102133431 | bắt |
| SB-30: bật tắt không tăng version | SHP-TC-20261006-102133054 | bắt |
| SB-30: tên phương thức trùng không đổi thành 409 (tạo) | SHP-TC-20261006-102133111 | bắt |
| SB-30: sửa tên trùng không đổi thành 409 | SHP-TC-20261006-102133136 | bắt |
| SB-30: danh sách quản trị sắp cũ nhất trước | SHP-TC-20261006-102133000 | bắt |
| SB-30: phương thức không tồn tại khi tắt không 404 (id sai định dạng) | SHP-TC-20261006-102133136 | bắt |
| SB-24: chi tiết lấy vận đơn cancelled mới nhất thay cho vận đơn còn hiệu lực | SHP-TC-20261006-102134063 | bắt |
| SB-32, R-05: lịch sử sắp theo created_at giảm dần thay cho seq | SHP-TC-20261006-102147421 | bắt |
| SB-32, R-05: lịch sử sắp theo id (không có thứ tự ghi) | SHP-TC-20261006-102147421 | bắt |
| SB-11: danh sách sắp ngược (oldest thành newest) | SHP-TC-20261006-102133988 | bắt |
| SB-11: danh sách bỏ bộ lọc trạng thái | SHP-TC-20261006-102133988 | bắt |
| SB-11: danh sách bỏ bộ lọc mã đơn | SHP-TC-20261006-102134063 | bắt |
| SB-11: danh sách không phân trang (OFFSET 0) | SHP-TC-20261006-102134063 | bắt |
| SB-11: tổng danh sách đếm không theo điều kiện lọc | SHP-TC-20261006-102133988 | bắt |
| SB-11: tie-break của danh sách theo id bỏ | SHP-TC-20261006-102134063 | bắt |
| SB-11: mã đơn của dòng danh sách rỗng | SHP-TC-20261006-102134063 | bắt |
| SB-11, T6: bỏ CHECK tên phương thức 2..80 | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: bỏ CHECK phí cơ bản 0..1.000.000 | SHP-TC-20261006-102133111 | bắt |
| SB-11, T6: bỏ CHECK rule là đối tượng | SHP-TC-20261006-102133111 | bắt |
| SB-30: tên phương thức duy nhất thành không duy nhất | SHP-TC-20261006-102133111 | bắt |
| SB-30: tên phương thức duy nhất không phân biệt hoa thường thành phân biệt | SHP-TC-20261006-102133111 | bắt |
| SB-11, T8: bỏ CHECK định dạng mã vận đơn | SHP-TC-20261006-102133602 | bắt |
| SB-24, T8: định dạng mã vận đơn cho chữ thường | SHP-TC-20261006-102133602 | bắt |
| SB-24, T8, T20: bỏ CHECK mã vận đơn gắn với trạng thái (pending, cancelled không có mã) | SHP-TC-20261006-102133602 | bắt |
| SB-23: bỏ CHECK tiền thu hộ không âm | SHP-TC-20261006-102133602 | bắt |
| SB-24: bỏ CHECK delivered phải có delivered_at | SHP-TC-20261006-102133602 | bắt |
| SB-24, T8: mã vận đơn duy nhất thành không duy nhất | SHP-TC-20261006-102133602 | bắt |
| SB-24, T18: một vận đơn còn hiệu lực mỗi đơn thành không duy nhất | SHP-TC-20261006-102133602 | bắt |
| SB-24, T18: unique vận đơn còn hiệu lực bỏ điều kiện status <> cancelled (vận đơn hủy cũng chặn tạo mới) | SHP-TC-20261006-102133602 | bắt |
| SB-32, SB-19: bỏ CHECK lý do chỉ ở dòng failed | SHP-TC-20261006-102147397 | bắt |
| SB-32, SB-12: ghi chú tối đa 300 -> 3000 ở CSDL | SHP-TC-20261006-102147397 | bắt |
| SB-32, SB-12: ghi chú không còn gắn với dòng failed ở CSDL | SHP-TC-20261006-102147397 | bắt |
| SB-32, R-05: seq thành cột thường (không identity) | SHP-TC-20261006-102147397 | bắt |
| SB-32, T13: bỏ trigger chặn UPDATE, DELETE lịch sử | SHP-TC-20261006-102147397 | bắt |
| SB-32, T13: trigger chỉ chặn UPDATE, không chặn DELETE | SHP-TC-20261006-102147397 | bắt |
| SB-32, T13: không thu quyền UPDATE, DELETE, TRUNCATE của vai trò ứng dụng | SHP-TC-20261006-102147397 | bắt |
| SB-32, T13: thu quyền thiếu TRUNCATE | - | lọt: vai trò app_runtime không được cấp TRUNCATE ngay từ đầu (quyền mặc định của nền chỉ SELECT, INSERT, UPDATE, DELETE nên TRUNCATE bị từ chối kể cả khi bỏ dòng REVOKE); dòng REVOKE chỉ phòng khi nền đổi quyền mặc định |
| SB-24, T18: bỏ khóa ngoại vận đơn tới đơn | SHP-TC-20261006-102133480 | bắt |
| SB-24, T18: khóa ngoại vận đơn tới đơn thành CASCADE | SHP-TC-20261006-102133480 | bắt |
| SB-24: bỏ khóa ngoại vận đơn tới phương thức | SHP-TC-20261006-102133480 | bắt |
| SB-24: khóa ngoại vận đơn tới phương thức thành CASCADE | SHP-TC-20261006-102133480 | bắt |
| SB-32: bỏ khóa ngoại lịch sử tới vận đơn | SHP-TC-20261006-102133480 | bắt |
| SB-32: khóa ngoại lịch sử tới vận đơn thành CASCADE (xóa vận đơn kéo xóa lịch sử) | SHP-TC-20261006-102133480 | bắt |
| SB-14, T17: bỏ index (status, created_at, id) của danh sách vận đơn | SHP-TC-20261006-102134039 | bắt |
| SB-14, T17: bỏ index (created_at, id) của danh sách vận đơn | SHP-TC-20261006-102134039 | bắt |
| SB-08, T10 (web): nút "Đã chép" không về lại chữ cũ (trạng thái có thời hạn không có đường thoát) | SHP-E2E-20261006-102134197 | bắt |
| SB-06, T2 (web): 404 của customer hiện khối lỗi chung thay cho khối không tìm thấy (tách được đơn người khác) | SHP-E2E-20261006-102134197 | bắt |
| SB-24, T7 (web): vận đơn pending có nút Giao xong | SHP-E2E-20261006-102134118 | bắt |
| SB-11 (web): nút xác nhận thất bại không khóa khi chưa chọn lý do hoặc ghi chú quá dài | SHP-E2E-20261006-102134145 | bắt |
| SB-11, T8 (web): ô mã vận đơn không tự đổi chữ hoa | SHP-E2E-20261006-102134118 | bắt |
| SB-08 (web): quay lại danh sách mất bộ lọc | SHP-E2E-20261006-102134172 | bắt |
| SB-30 (web): biểu mẫu sửa phương thức làm mất ngưỡng miễn phí (ô nhập độ phân giải thấp cắt dữ liệu) | SHP-E2E-20261006-102134090 | bắt |
| SB-30 (web): tắt phương thức không gửi version (khóa lạc quan) | SHP-E2E-20261006-102134090 | bắt |
| SB-12, T14 (web): tên phương thức hiện bằng HTML thô (XSS) | SHP-E2E-20261006-102134145 | bắt |
| SB-12, T14 (web): ghi chú thất bại hiện bằng HTML thô (XSS) | SHP-E2E-20261006-102134145 | bắt |
| SB-14, T17: danh sách gọi lại ORD cho từng dòng (N+1 trở lại) | SHP-TC-20261008-091406341 | bắt |
| SB-24, T18: tạo vận đơn không ghi order_code (cột chụp mã đơn rỗng) | SHP-TC-20261008-091406341 | bắt |
| SB-11: bộ lọc mã đơn của danh sách không còn khớp (bỏ điều kiện order_id) | SHP-TC-20261008-091406341 | bắt |
| SB-11, T6: bỏ CHECK khuôn order_code của vận đơn | SHP-TC-20261008-091406444 | bắt |
| SB-24: khuôn order_code cho phép chữ L (khác bảng Crockford của mã đơn) | SHP-TC-20261008-091406444 | bắt |
| SB-24: order_code đổi được sau khi đã có mã (bỏ chặn bất biến) | SHP-TC-20261008-091406444 | bắt |
| SB-24: trigger bất biến chặn cả lần điền đầu tiên từ rỗng | SHP-TC-20261008-091406444 | bắt |
| SB-24: backfill nối sai khóa (shipping_method_id thay cho order_id) | SHP-TC-20261008-091406444 | bắt |
| SB-24: backfill ghi đè cả dòng đã có mã (bỏ điều kiện IS NULL) | SHP-TC-20261008-091406444 | bắt |
| SB-31, T20 (L71): DB_POOL_MAX cho phép 1 kết nối (handler giữ một kết nối rồi đọc ORD bằng kết nối thứ hai nên treo) | SHP-TC-20261008-091406542 | bắt |
| SB-18, T22: log lỗi đọc đơn của handler không mang order_id | SHP-TC-20261006-102133455 | bắt |
| SB-11, T17: lịch sử lấy 100 dòng CŨ nhất thay cho 100 dòng mới nhất (mất trạng thái hiện tại khi lịch sử dài) | SHP-TC-20261006-102134039 | bắt |
| SB-11 (web): lỗi 5xx của chi tiết vận đơn không hiện banner lỗi (coi như không tìm thấy) | SHP-E2E-20261008-091406629 | bắt |
| SB-11 (web): lỗi tải lịch sử không hiện banner lỗi riêng (nuốt lỗi, coi như đã tải) | SHP-E2E-20261008-091406726 | bắt |
| SB-05 (web): hộp thoại phiên hết hạn của chi tiết vận đơn mang sai testid | SHP-E2E-20261008-091406820 | bắt |
| SB-24, T20 (web): bàn giao bị order-not-shippable không có nút Tải lại vận đơn | SHP-E2E-20261008-091406911 | bắt |
| SB-24, T7 (web): bàn giao bị shipment-invalid-transition không có nút Tải lại vận đơn | SHP-E2E-20261008-091406911 | bắt |

## Lệch spec
Mục 1 đến 7 đã được người quyết và `sdlc-impact` đồng bộ spec (2026-10-08, báo cáo tác động `spec/changes/SHP-API-20261006-101603042.md`); các mục sau là lựa chọn mặc định đã làm, việc đã đồng bộ hoặc việc còn thiếu (mục 23, 24 còn cần quyết). Không sửa spec trong lúc triển khai.

1. [đã chọn] **Tên lớp giao diện nội bộ**: SHP-API, CHK-API (dòng 166, 167) và CRT-API (dòng 113) ghi `ShippingService.listActiveMethods` và `ShippingService.quote`; mã phơi `ShippingApi` ở điểm vào công khai `modules/shipping/index.ts` theo `CatalogApi`, `InventoryApi`, `PromotionApi`, `OrderApi` (cùng L68: bảng Giao diện module của `architecture.md` chỉ ghi tên phương thức, không ghi tên lớp, nên mỗi epic tự đặt). Test `SHP-TC-20261006-102133284` (giao diện nội bộ so với endpoint) và `SHP-SEC-20261006-101603066` T3, T4 (tên lớp và hai phương thức) khóa tên `ShippingApi`. Đã đồng bộ: spec đổi thành `ShippingApi` ở SHP-API, CHK-API, CRT-API, CHK-REQ BR1, CRT-REQ BR3, `SHP-TC-20261006-102133383` và hai hàng của bảng Giao diện module.
2. [đã chọn] **Hình dạng lỗi của `quote` nội bộ**: SHP-API ghi `{ fee, free_shipping }` "hoặc lỗi `method-unavailable`", CHK-API (dòng 167) ghi `{ ok: false, reason: "method-unavailable" }`; mã chọn theo SHP-API (bên cung cấp): ném `DomainError('method-unavailable')` cho phương thức không có, đã tắt hay `method_id` sai định dạng (CRT-API: "tắt, không tồn tại" cùng một mã); `subtotal` hay `city` ngoài miền ném `RangeError` (đầu vào sai là lỗi lập trình của bên gọi, như `CatalogApi`). Endpoint HTTP vẫn tách: không có phương thức 404 `not-found`, đã tắt 409 `method-unavailable`. Test `SHP-TC-20261006-102133308`. Đã đồng bộ: người chọn giữ mã (ném `DomainError('method-unavailable')`, `RangeError` cho đầu vào ngoài miền); SHP-API, CHK-API (dòng 167), CRT-API (dòng 113) và đoạn Hành vi lỗi của giao diện SHP ở architecture.md đã sửa theo mã.
3. [đã chọn] **`user_id` của ShipmentFailed**: SHP-DB (mục 1) và SHP-API nói `findByCode` và `findForShipment` trả `order_code`, `user_id`, nhưng ORD-API (đã review, `internal.service.ts`) trả `{ order_id, code, status, payment_method, grand_total, shipping_method_id }`, không có `user_id`; ShipmentFailed cần `user_id` cho NTF (V-01). `fail` gọi `OrderApi.findForPayment(order_id)` (giao diện của PAY, có `user_id`) để lấy `user_id`: ngoài năm hàm của hàng SHP -> ORD ở bảng Giao diện module. Test `SHP-TC-20261006-102133819` (đủ năm khóa, `user_id` đúng chủ đơn). Đã đồng bộ: người chọn giữ mã; hàng SHP -> ORD của architecture.md thêm `OrderApi.findForPayment`, SHP-DB (mục 1 và 9) và SHP-API đổi chữ (`findByCode`, `findForShipment` không trả `user_id`); ORD không đổi.
4. [đã chọn] `SHP-TC-20261006-102133455` (hết YẾU): TC đòi "log có đúng 1 dòng mức error nêu ORD-5, `event_id` và `correlation_id`". Dòng error duy nhất do relay của nền ghi (`outbox event hết lượt thử`), có `event_id`, `attempts` và `correlation_id` nhưng không có mã đơn: OrderPaid chỉ mang `order_id` và ORD đang lỗi nên SHP không đọc được mã đơn. Handler ghi `warn` (`order-read-failed`) mang `order_id` ở mỗi lần lỗi. Test khóa: đúng một dòng error, 10 lần giao, 9 khoảng chờ 5, 10, 20, 40, 80, 160, 320, 600, 600 giây, không lần 11, `stuckCount` = 1. Đã đồng bộ: TC sửa (relay ghi một error mang `event_id`, `attempts`, `correlation_id`; handler ghi 10 warn mang `order_id`), test khẳng định cả 10 dòng warn.
5. [đã chọn] `SHP-TC-20261006-102133916` (hết YẾU): phần giao diện của TC (`<script>alert(1)</script>` trong ghi chú không chạy, bắt sự kiện dialog) kiểm ở `SHP-WEB-01` (`apps/api/test/e2e/shp.e2e.spec.ts`) bằng HTML có `onerror` đổi tiêu đề trang và đếm phần tử `b`, `img` trong khối lý do, không dùng `<script>` và không bắt dialog (React đặt chuỗi làm văn bản nên cả hai cách đều thấy chuỗi nguyên văn). Phần API và CSDL của TC (300 và 301 ký tự, đếm ký tự Unicode, lưu nguyên văn, không vào log) kiểm đủ. Đã đồng bộ: người chọn chấp nhận cách kiểm `onerror` và tiêu đề trang; TC ghi lại cách kiểm đó (khớp `SHP-WEB-01`).
6. [đã chọn] **`order_code` của danh sách vận đơn**: SHP-API đòi `order_code` ở mỗi dòng nhưng SHP-DB không có cột đó và SB-35 cấm SHP đọc bảng `orders`; `OrderApi` không có hàm đọc theo lô. `list` gọi `OrderApi.getSummary(order_id)` mỗi dòng trên trang (tối đa 100 lời gọi nhỏ chạy song song, mã đơn khác nhau). Chấp nhận được ở v1 (limit mặc định 20, bậc D 30 lần mỗi phút) nhưng là N+1. Đã đồng bộ và CÀI: người chọn thêm cột `order_code` (bản chụp, bất biến) vào `shipments`: migration `20261008000100_shipping_order_code` (bước mở rộng: cột NULL được, backfill bằng UPDATE nối `orders`, CHECK khuôn mã đơn, trigger bất biến), `lifecycle.service.ts` ghi lúc tạo vận đơn, `read.service.ts` đọc từ cột và không gọi `OrderApi` từng dòng; `SHP-TC-20261008-091406341` và `SHP-TC-20261008-091406444`, 12 đột biến. Việc cho người: migration thu hẹp `SET NOT NULL` ở bản phát hành sau (kèm `-- contract-step`), rồi bỏ `?? ''` ở `read.service.ts`.
7. [đã chọn] **Hold-and-wait của handler tạo vận đơn** (L71): SHP-DB mục 4 yêu cầu đọc đơn bằng `OrderApi.findForShipment` "ngoài giao dịch" trong khi handler chạy trong giao dịch giao event của `EventsService.deliver` (giữ một kết nối): mỗi event cần hai kết nối. Relay giao lần lượt nên pool tối thiểu 2 là đủ (test `SHP-SEC-20261006-101603066` T20 với `DB_POOL_MAX` = 2 xử lý 8 event); nhưng giao song song nhiều event hơn số kết nối của pool (ví dụ 8 `deliver` cùng lúc ở `DB_POOL_MAX` = 3) bị treo tới hạn chờ của pool (đã tái hiện: 8 trên 8 lỗi). Hiện chỉ test và job song song mới gặp. Đã đồng bộ: người chọn ghi giới hạn (không đổi chữ ký ORD): SHP-DB (Giao dịch và khóa 4), SHP-API (`findForShipment` không nhận `tx`), architecture.md (hàng SHP -> ORD, ADR-011, ADR-012), PRJ-REQ BR3 và PRJ-DB mục 9 ghi `DB_POOL_MAX` tối thiểu 2; mã nền (`config.ts`) khớp, có `SHP-TC-20261008-091406542` (cấu hình dưới 2 bị từ chối, pool 2 xử lý 8 OrderPaid) và một đột biến.
8. [đã chọn] **Mã lỗi**: mọi mã HTTP trong mã đã có trong SHP-API (chín mã `shipping-method-name-taken`, `too-many-methods`, `method-state-unchanged`, `version-conflict`, `method-unavailable`, `shipment-invalid-transition`, `tracking-number-taken`, `tracking-number-unchanged`, `order-not-shippable`, đúng 409) cộng mã nền; test `SHP-SEC-20261006-101603066` T21 so sổ mã và mọi `DomainError('...')` trong `modules/shipping` với tài liệu SHP-API (không mã nào ngoài spec). Mã log (không phải mã HTTP) spec chưa nêu ngoài `shipment-order-cancelled-mismatch`: `order-not-found`, `order-not-shippable` (log của consumer, cùng chuỗi nhưng khác nơi dùng), `order-read-failed`, `shipment-exists`, `shipment-none`, `shipping-method-missing`, `shipping-method-rule-invalid`; mã trường của lỗi 400: `required`, `invalid_format`, `out_of_range`, `too_long`, `too_short`, `unknown_field` (quy ước nền); khi `rule` trong CSDL sai cấu trúc trả 500 `internal-error` kèm log error.
9. [đã chọn] **Chọn cho chỗ spec để ngỏ** (mỗi chỗ có test): (a) `rule` tùy chọn khi tạo phương thức (khóa vắng nhận mặc định không miễn phí, không phụ thu), PATCH thay nguyên `rule`, PATCH chỉ có `version` bị 400 (không đổi gì mà vẫn tăng `version` và ghi audit); (b) sửa mã kiểm theo thứ tự trạng thái, `version`, mã không đổi; bật, tắt kiểm trạng thái (`method-state-unchanged`) trước `version` (TC 102133186 nêu); (c) `{id}` phương thức sai định dạng là 404; (d) tên thành phố của `surcharge_cities` được cắt khoảng trắng và phần tử chỉ khoảng trắng bị từ chối; (e) mã vận đơn kiểm khuôn ASCII `A-Za-z0-9-` rồi MỚI đổi chữ hoa (BR3 ghi "đổi chữ hoa rồi khớp": `ſ` thành `S` lọt khuôn); (f) ghi chú thất bại cắt khoảng trắng đầu cuối, rỗng coi như không có, cho phép xuống dòng và tab; (g) `tracking_number` của danh sách phải đúng khuôn (sai thì 400), `order_code` 1..32 ký tự; (h) khối `recipient` đặt trong `shipment`, `reason_code` và `note` lấy từ dòng `failed` mới nhất cho cả vận đơn `returned` (SHP-API; BR5 chỉ nêu `failed`); (i) vận đơn của một đơn là vận đơn còn hiệu lực, nếu không có thì vận đơn `cancelled` mới nhất (customer thấy `status` `cancelled`, không mã); (j) audit: hành động `shipping.shipment.<create|cancel|ship|tracking|deliver|fail|return>`, `shipping.method.<create|update|enable|disable>`, `shipment.view_recipient` (spec chỉ nêu tên cuối) với `target_type` `shipment`, `target_id` là id vận đơn, `after: { order_code }` cho lần xem người nhận, nguồn event ở `reason`.
10. [đã chọn] **Bậc SB-14 theo nhóm bộ đếm**: tra cứu chi tiết và lịch sử chung một bộ đếm bậc C (nhóm `shp-lookup`), `quote` bộ đếm riêng, `GET /shipping/methods` dùng mặc định bậc C của nền (SHP-API không khai số); bậc D: năm thao tác ghi của staff chung một bộ đếm, năm endpoint quản trị phương thức chung một bộ đếm (đọc và ghi, TC 130000002), danh sách riêng. Khóa đếm là người dùng đã đăng nhập (không phải IP): nền chỉ cung cấp khóa này cho route cần đăng nhập (ADR-014). Test 429 `SHP-TC-20261006-102133383`, `SHP-TC-20261006-130000001`, `SHP-TC-20261006-130000002`, `SHP-TC-20261006-102134039` (hai instance dùng chung PostgreSQL), 40 yêu cầu song song chỉ qua đúng 30 (đếm nguyên tử).
11. [đã chọn] **`created_at` của lịch sử**: cột mặc định `clock_timestamp()` (SHP-DB ghi `now()`, đứng yên trong giao dịch và là giờ BẮT ĐẦU giao dịch, L66); mã luôn ghi `created_at`, `shipped_at`, `delivered_at`, `updated_at` bằng đồng hồ ứng dụng lấy SAU khi có khóa dòng vận đơn. `seq` là khóa thứ tự (TC 102147421).
12. [đã chọn] **Phương thức của đơn không có ở SHP khi tạo vận đơn** (`shipping_method_id` của đơn trỏ tới phương thức không tồn tại, trái nền CHK): log `error` `shipping-method-missing` rồi coi là đã xử lý (không ném lỗi để relay không giao lại 10 lần vô ích); hậu quả: đơn đã thanh toán không có vận đơn, cần xử lý tay. Rủi ro thấp (không có API xóa phương thức, CHK kiểm phương thức khi đặt đơn).
13. [đã chọn] **Hủy hay bàn giao song song hai khóa**: bàn giao khóa `shipments` rồi `orders` (qua `lockForHandoff`), hủy của ORD chỉ khóa `orders` và handler OrderCancelled chỉ khóa `shipments`: không chu trình. Test đua 200 vòng với ORD thật (`SHP-TC-20261006-102147325`): hủy thắng thì `order-not-shippable` và vận đơn `pending` rồi `cancelled` sau OrderCancelled; bàn giao thắng thì ORD từ chối hủy (`order-not-cancellable`), không OrderCancelled, không log lệch. Điều kiện `status = :cũ` ở `UPDATE` và khóa dòng `FOR UPDATE` là lớp bảo vệ kép: bỏ MỘT trong hai thì kết cục không đổi (hai đột biến tương đương ở bảng *Kiểm đột biến*), bỏ CẢ HAI thì `SHP-TC-20261006-102133941` đỏ (đã thử tay, xem *Kiểm đột biến*).
14. [đã chọn] **Khóa `__proto__` của JSON**: zod âm thầm bỏ khóa `__proto__` khi sao chép khóa dư nên bước kiểm khóa lạ của `closedObject` không thấy; `closedObject` của SHP kiểm khóa này trên đầu vào thô trước khi vào zod (test `SHP-TC-20261006-102133111`). Cùng khe còn ở `closedObject` của các module khác (ORD, PRM, USR...): việc cho người ngoài SHP.
15. [đã chọn] **Hai test đo thời gian 404 đồng nhất** (`SHP-TC-20261006-102134013`): đo XEN KẼ từng cặp (`medianPairMs`, 30 cặp, đồng hồ giả sang cửa sổ mới sau mỗi cặp), ngưỡng chênh trung vị tuyệt đối 10 ms như ORD thay cho "dưới 30%" (spec chưa chốt số, `questions.md`); "nhiễu đo" không có.
16. [đã chọn] **Hạ tầng test thay thế**: TC nêu "stub ORD" nhưng test dùng ORD THẬT (`OrderModule` cùng `AppModule`) với đơn dựng thẳng bằng fixture, nên `lockForHandoff`, `findOwned`, `getRecipient` chạy qua mã thật; hai ca cần lỗi riêng của ORD (`order_not_found`, ORD tạm thời không đọc được) dùng `jest.spyOn` trên `OrderApi`. Kiểm thứ tự khóa của TC 102133626 bằng `jest.spyOn(lockForHandoff)`: lúc gọi, một kết nối khác không khóa được vận đơn (55P03) và `status` trong cùng giao dịch còn `pending`.
17. [đã chọn] **Mã đơn trong E2E có chữ `L`**: `SHP-E2E-20261006-102134172` và `SHP-E2E-20261006-102134222` dùng mã đơn `2N6R4T8W0KLA` không thuộc bảng Crockford của mã đơn (bỏ `I`, `L`, `O`, `U`), nên API trả 404 như đơn không có; E2E dùng `2N6R4T8W0KMA` (có chú thích). Đã đồng bộ: hai tài liệu E2E và ví dụ `ORD/ui/order-list.md` dùng `2N6R4T8W0KMA`. Còn một ví dụ vẽ cùng lỗi ở `SHP/ui/shipment-admin-list.md` dòng 30 (ngoài danh sách được ủy quyền): việc cho người.
18. [đã chọn] **Giao diện (spec ui không nêu hoặc nêu mơ hồ)**: đường dẫn `/orders/{code}/shipment`, `/admin/shipments`, `/admin/shipments/{code}`, `/admin/shipping-methods` (bộ lọc ở URL; chi tiết nhận `?back=` để về danh sách giữ bộ lọc); `status-filter` là hàng tab (E2E ghi "chọn", test bấm tab); nút "Tải lại vận đơn" khi `ship-blocked` dùng `shp-shipment-admin-detail-result-reload`, toast lỗi chung của phương thức dùng `toast-state` (testid chưa có trong spec); khối "Bạn không có quyền" (`*-forbidden`) thay `AccessDenied` của AUTH; hộp thoại hết phiên toàn cục đổi testid theo đường dẫn SHP (`expiredTestId`); bảng danh sách dùng `stack-table` như ORD (chưa ẩn riêng hai cột dưới `@4xl`); giờ hiển thị `dd/MM/yyyy HH:mm` (UTC+7); mã vận đơn tự đổi chữ hoa khi gõ và không đặt `maxLength` (độ dài sai do server trả 400 và web hiện câu thông báo), ghi chú thất bại có bộ đếm n/300 và khóa nút khi quá dài, chữ đang gõ dở ở ô thành phố được thêm khi Lưu (không mất dữ liệu); màn của customer chỉ cho role customer (429 hiện trong banner có đếm ngược, spec ui không nêu). Bốn trạng thái có thời hạn (toast, "Đã chép" 2 giây, 429 danh sách, 429 bàn giao) đều có bước kiểm thoát ở E2E.
19. [đã chọn] Đã có E2E (`SHP-E2E-20261008-091406629`, `...726`, `...820`, `...911`, chạy Chromium thật, có đột biến web) cho mục sau; trước đó spec chưa có E2E (và web đã có xử lý nhưng chưa test) cho: lỗi 5xx ở màn quản trị, lỗi lịch sử riêng ở màn admin, 401 `session_expired` ở màn SHP, bàn giao bị `order-not-shippable` hay `shipment-invalid-transition` ở giao diện (API đã kiểm đủ ở TC 102133626 và 102133650). Bảng nhãn `shipmentStatusText`, `failReasonText` an toàn với `__proto__` nhưng chỉ nhận enum từ API nên E2E không bắt được đột biến của chúng (tên phương thức và ghi chú, là dữ liệu người nhập thật, có `SHP-WEB-01`).
20. [đã chọn] **Mã nền sửa kèm**: (a) `apps/api/prisma/schema/order.prisma` thêm quan hệ ngược `shipments Shipment[]` vào `Order` (Prisma cần để khớp khóa ngoại `shipments.order_id`, `pnpm db:check` sạch; không đổi cột, không đổi mã của module `order`); kiểm bằng `SHP-TC-20261006-102133480` (khóa ngoại và `ON DELETE RESTRICT` ở `db.spec.ts`) và `pnpm db:check`; (b) `apps/api/test/order/create.spec.ts` (test của ORD, dòng `TRUNCATE orders` phải gồm `shipments` và `shipment_status_history` vì khóa ngoại của SHP chặn TRUNCATE): `ORD-TC-20261006-111225380`; (c) `apps/api/test/support/db.ts` (`truncateAll` thêm ba bảng SHP), `apps/api/test/e2e/server.ts` và `support.ts` (điểm điều khiển SHP), `apps/web/components/HeaderLinks.tsx` và `AccountMenu.tsx` (liên kết menu, testid hộp thoại hết phiên theo đường dẫn SHP): kiểm bằng `SHP-E2E-20261006-102134118`, `SHP-E2E-20261006-102134197` và các E2E AUTH, ORD, PRD, INV, PRM chạy lại ở lần chạy toàn repo. Mã `modules/platform/`, `modules/order/` không sửa.
21. [đã chọn] **ORD**: `ORD-TC-20261006-111720124` (YẾU ở report ORD: bước "handler SHP bật, shipment chuyển cancelled" chưa kiểm vì SHP chưa có code) nay có test thật ở `SHP-TC-20261006-102147325` (OrderCancelled của ORD thật đi qua relay tới handler SHP, vận đơn `pending` thành `cancelled`), và `lockForHandoff` được gọi trong giao dịch bàn giao (cửa sổ R-04 đóng, report ORD mục 11). ORD-E2E-20261006-111226558: liên kết "Theo dõi vận chuyển" chỉ hiện khi đơn có `tracking_number` (ORD đã làm vậy) nên E2E ORD (đơn `paid`) không mở màn; màn `/orders/{code}/shipment` có thật, kiểm bằng `SHP-WEB-04` (từ chi tiết đơn `shipped` bấm liên kết tới màn theo dõi). Việc cho người: nâng `YẾU` của ORD ở report ORD (không thuộc epic này).
22. [đã chọn] `clean_run: pass` (chạy ở lượt implement, trước review và sdlc-impact; sau sdlc-impact chỉ chạy lại `pnpm test` toàn repo ở cây làm việc: 102 bộ, 799 pass, 0 skip, 559 giây, cộng lint, typecheck, build, `check:boundaries`, `scan:secrets` đều thoát 0; chưa dựng lại `git worktree` sạch, việc cho người nếu cần): chạy trong `git worktree` tại HEAD (5781d41) cộng tệp đã sửa và chưa theo dõi chép sang từ cây làm việc (mã các epic AUTH đến SHP chưa commit nên bản clone tại HEAD không có; so từng tệp bằng `cmp`: giống hệt trừ `report.md`), `pnpm install --frozen-lockfile --offline`, rồi `scan:secrets`, `check:boundaries`, `lint`, `typecheck`, `test` (99 bộ, 780 pass, 0 skip) và `build` bằng `env -i` chỉ với PATH (Node 24 và pnpm), HOME (Chromium của playwright), `CI`, `TEST_DB_BASE`, `NEXT_TELEMETRY_DISABLED`, `STORAGE_TEST_ENDPOINT` và dịch vụ docker db, minio như workflow CI; cả sáu lệnh thoát 0. Hai lần chạy `test` đầu đỏ 16 test ở 5 bộ dùng MinIO thật (`image.minio`, `avatar-cache`, `storage.minio`, E2E PRD, E2E USR) với `storage PUT 507` (MinIO báo hết chỗ: đĩa của máy ảo Docker đầy 98%, còn 0,7 đến 0,8 GB; do môi trường chứ không do mã: bốn bộ đầu chạy riêng trong bản clone sạch pass 19 trên 19, và lần chạy thứ ba cả `pnpm test` pass). Workflow GitHub chưa chạy trên máy chủ (chưa push); MinIO ở CI chưa kiểm (xem report PRD).
23. [cần quyết] **Test cài Node của PRJ để lại thư mục tạm**: `apps/api/test/tooling/project-setup.spec.ts` (`PRJ-TC-20261006-120200101`) tạo `ecom-node-ok-*` (bản sao repo đã cài, khoảng 678 MB) ở thư mục tạm và không xóa: mỗi lần chạy `pnpm test` để lại một thư mục (máy này có 58 thư mục trong `$TMPDIR` và 15 trong `/tmp`, hàng chục GB), góp phần làm đầy đĩa (còn 2 GB) và gây lỗi MinIO ở mục 22. Epic này đã dọn 8 thư mục do các lượt chạy của mình. Việc cho người: sửa test dọn thư mục (`finally` và `rmSync`) qua improve-kit hoặc PRJ.
24. [cần quyết] **Test đo bộ nhớ của PRD nhạy với thứ tự bộ test**: `PRD-TC-20261006-120604408` (`apps/api/test/catalog/image.spec.ts`, đo RSS tăng dưới 80 MB khi nhận PNG 25 megapixel) đỏ một lần ở lượt `pnpm test` đầu (RSS tăng 114 MB) và pass khi chạy riêng và ở ba lượt toàn repo sau: RSS của tiến trình Jest chung (`maxWorkers: 1`) phụ thuộc bộ test chạy trước nó, thêm 12 bộ SHP đổi thứ tự. Không do mã SHP; việc cho người: đo trong tiến trình con hoặc nới ngưỡng có lý do.
25. [đã chọn] **Lịch sử vận đơn cắt 100 dòng MỚI NHẤT** (đồng bộ review SHP, LOW): mã cũ lấy 100 dòng ĐẦU theo `seq` nên vận đơn sửa mã hơn 100 lần làm customer không thấy trạng thái hiện tại; người chọn ghi giới hạn là 100 dòng mới nhất rồi trả cũ nhất trước (SHP-API GET history, SHP-DB Giao dịch và khóa 8) và mã đổi theo: `read.service.ts` (`history`) lấy `ORDER BY seq DESC LIMIT 100` rồi sắp lại `seq ASC`; test `rev.spec.ts` (T17) khẳng định 152 dòng trả 100 dòng mới nhất kèm trạng thái cuối cho cả staff lẫn customer, hai đột biến mới và sửa.
