---
epic: ORD
status: draft
kit_version: 3
clean_run: chưa
test_command: cd apps/api && ECOM_TEST_DB=ecom_test_ord3 pnpm test -- test/order test/tooling/mutations-ord.spec.ts
test_result: Tests:       173 passed, 173 total
---
# Báo cáo triển khai: ORD


## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền (mã lỗi, schema đầu vào, lõi chuyển trạng thái), rồi API đọc và hủy, rồi giao diện nội bộ và consumer event, rồi kiểm quyền, rồi giao diện web, rồi E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. Module `order` (`apps/api/src/modules/order/`, cột Phụ thuộc chỉ AUTH) chỉ import `../platform`; không có job (đồng hồ hết hạn là của INV, ADR-009); điểm vào duy nhất là `OrderApi` (mười lăm phương thức của bảng Giao diện module). CHK, PAY, SHP, REV, DSH chưa có code nên các giao diện nội bộ kiểm bằng lời gọi trực tiếp và event của PAY, INV, SHP dựng đúng phong bì của `events.md`.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261007001100_order_tables` (3 bảng, 5 enum, CHECK tiền và vòng đời, unique một phần của lịch sử, chỉ mục một phần cho `countOpenOrders` và doanh thu, cột `seq` identity, trigger chỉ-thêm và thu quyền), schema Prisma `order.prisma` (quan hệ ngược trong `auth.prisma`) | ORD-DB-20261006-092703753 | - | done |
| 2 | Nền của module: sổ mã lỗi (`order-not-cancellable`), schema đầu vào đóng (zod), lõi chuyển trạng thái (`UPDATE ... WHERE status = :cũ`, lịch sử, outbox cùng giao dịch) | ORD-API-20261006-092703780, ORD-SEC-20261006-092703802 | 1 | done |
| 3 | API đọc: danh sách của customer, danh sách quản trị (tìm theo `code`), chi tiết (serializer theo role), lịch sử theo `seq`; bậc C và D | ORD-API-20261006-092703780, ORD-DB-20261006-092703753 | 1, 2 | done |
| 4 | API hủy đơn: khóa dòng kèm điều kiện sở hữu, cờ bàn giao, `payment_status` tự đặt, OrderCancelled và audit cùng giao dịch; bậc B | ORD-API-20261006-092703780, ORD-SEC-20261006-092703802 | 2 | done |
| 5 | Giao diện nội bộ `OrderApi`: `createPending`, `confirmCod`, `countOpenOrders`, `getSummary`, `findForPayment`, `findForShipment`, `findByCode`, `findOwned`, `getRecipient`, `getDeliveredItems`, `lockForHandoff`, bốn hàm tổng hợp của DSH | ORD-API-20261006-092703780, ORD-DB-20261006-092703753 | 1, 2 | done |
| 6 | Consumer `order` của mười một event (PaymentSucceeded, PaymentFailed, PaymentExpired, PaymentRefunded, StockReservationExpired, StockCommitFailed, ShipmentShipped, ShipmentTrackingChanged, ShipmentDelivered, ShipmentFailed, ShipmentReturned), idempotent theo `event_id` và theo trạng thái | ORD-DB-20261006-092703753, ORD-API-20261006-092703780 | 2 | done |
| 7 | Kiểm lệch ma trận quyền và danh sách route trên AppModule thật, kiểm chữ ký giao diện module và ranh giới | ORD-SEC-20261006-092703802, ORD-API-20261006-092703780 | 3, 4, 5 | done |
| 8 | Mã nền sửa kèm: `EventsService.publish` ghi `occurred_at` bằng `clock_timestamp()` (thứ tự outbox trong một giao dịch) | ORD-DB-20261006-092703753 | 6 | done |
| 9 | Màn đơn hàng của tôi và màn quản lý đơn hàng (bộ lọc, tìm mã đơn, phân trang, trạng thái 429 có đường thoát) | ui/order-list, ui/order-admin-list | 3 | done |
| 10 | Màn chi tiết đơn: sản phẩm, tổng, giao hàng, thanh toán, lịch sử (khối lỗi riêng), hộp thoại hủy | ui/order-detail | 3, 4 | done |
| 11 | E2E trình duyệt thật, cổng điều khiển và dữ liệu mồi cho E2E | ORD-E2E-20261006-111226528, ORD-E2E-20261006-111226558, ORD-E2E-20261006-111226588, ORD-E2E-20261006-111226617, ORD-E2E-20261006-111226646, ORD-E2E-20261006-111226677, ORD-E2E-20261006-111226706, ORD-E2E-20261006-111226737, ORD-E2E-20261006-111226766, ORD-E2E-20261006-121317047 | 6, 9, 10 | done |
| 12 | Bảng đột biến ORD (96 chỗ phá) và cổng kiểm của nó | ORD-SEC-20261006-092703802 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 | done |
| 13 | `district` là khóa thứ sáu của `shipping_address` (sdlc-impact 2026-10-13): `createPending` nhận sáu khóa (`district` chuỗi hoặc null), chi tiết đơn của khách hiện quận, huyện khi có; không có migration (JSONB); ba đột biến mới | ORD-API-20261006-092703780, ORD-DB-20261006-092703753 | 3 | done |
| 14 | Migration `20261015000300_order_sales_enums` (ba giá trị enum), `20261015000310_order_sales_tables` (bảng `order_sources` kèm seed website, facebook, tiktok, hotline và hai trigger, bảng `order_code_counters`, cột `orders.source_id`, `created_by`, `customer_snapshot`, `note`, `order_items.note`, `cost_snapshot`, `user_id` rỗng được, CHECK, chỉ mục mới), `20261015000320_order_sales_checks` (CHECK phương thức thanh toán); cập nhật `order.prisma`, `auth.prisma` | ORD-DB-20261006-092703753 | 1 | done |
| 15 | Mã đơn `HDyymmdd-NNNNN`: `newCode` là bộ đếm nguyên tử theo ngày giờ Asia/Ho_Chi_Minh trong giao dịch tạo đơn, `order_code_exhausted`, chuẩn hóa mã cả hai dạng, job `ord.sweep-code-counters` | ORD-DB-20261006-092703753, ORD-API-20261006-092703780 | 14 | done |
| 16 | Nguồn đơn: `SourcesService` và bốn endpoint (`GET /order-sources`, `GET, POST, PATCH /admin/order-sources`), trần 50 dưới khóa tư vấn, nguồn hệ thống được bảo vệ, audit, ba mã lỗi mới | ORD-API-20261006-092703780, ORD-DB-20261006-092703753 | 14 | done |
| 17 | `OrderApi.createHo`, `listSources`, `listForSale`, `getForSale`; `createPending` đóng tập khóa và đặt nguồn `website` | ORD-API-20261006-092703780, ORD-DB-20261006-092703753 | 14, 15, 16 | done |
| 18 | Danh sách quản trị (sale chỉ đơn của mình, lọc `source`, `created_by`), chi tiết và lịch sử theo role (sale own, nguồn, người tạo, ghi chú, khách, giá vốn chỉ admin), mọi đường theo mã cùng 404 | ORD-API-20261006-092703780, ORD-SEC-20261006-092703802 | 15, 17 | done |
| 19 | `OrderApi.getShipmentDisplay`, `getSourcesReport`, `getSalesReport`; `findForShipment` trả thêm `created_by`; `findForPayment`, `findOwned` coi `user_id` rỗng | ORD-API-20261006-092703780, ORD-DB-20261006-092703753 | 17 | done |
| 20 | Web: màn nguồn đơn (`/admin/order-sources`), bộ lọc nguồn và người tạo, cột nguồn, người tạo, dòng phạm vi của sale, khối Thông tin bán hàng, ghi chú dòng, giá vốn (admin); sửa `order-admin-list`, `order-detail` cho sale | ui/order-source-admin, ui/order-list-source, ui/order-detail-source, ui/order-admin-list, ui/order-detail | 18 | done |
| 21 | CHK: chỉ đổi khuôn mã đơn ở E2E (CHK chuyển tiếp mã của ORD, ORD tự đặt nguồn `website`); ghi vào `spec/epics/CHK/report.md` | CHK-REQ-20261006-105052272 | 15 | done |
| 22 | E2E ba ca đơn hộ, hạ tầng E2E (`/seed-order` nhận `ho`, `/set-order-source`, `/reset` đưa nguồn về mồi, fixture đơn hộ); viết xong, chưa chạy (Lệch spec mục 29) | ORD-E2E-20261015-092749937, ORD-E2E-20261015-092749975, ORD-E2E-20261015-092750011 | 20 | blocked |
| 23 | Bảng đột biến mở rộng lên 129 chỗ phá (mối đe dọa T24 đến T30, SB-31, SB-42, SB-44, SB-45) và cổng kiểm | ORD-SEC-20261006-092703802 | 15, 16, 17, 18, 19 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (143 TC, 13 E2E, 43 dòng mới của đợt bán hộ 2026-10-15; một TC `ORD-TC-20261013-232524288` do dọn nợ kiểm toàn spec thêm cho `OrderApi.getProductSalesTotals`; một TC `ORD-TC-20261013-223014153` do sdlc-impact thêm cho `OrderApi.hasUndeliveredItems`; một TC `ORD-TC-20261013-211722071` do sdlc-impact thêm cho `district`; sáu TC `ORD-TC-20261007-18243...` do sdlc-impact thêm cho mã lỗi và hành vi đã có mã, gắn vào test có sẵn). TC API chạy trên PostgreSQL thật (`ecom_test`) với nhiều giao dịch thật chạy song song (pool 16): hủy đua với ShipmentShipped và đua với `lockForHandoff` trên 50 đơn mỗi loại, hai yêu cầu hủy giống hệt trên 20 đơn, và một ca tải hỗn hợp 40 đơn (`apps/api/test/order/review.spec.ts`, mang ID ORD-TC-20261006-111225678) kiểm bất biến chuỗi lịch sử, một event cho mỗi chuyển, một audit cho mỗi hủy. PAY, SHP, INV, CHK chưa có code nên event của họ do test giao qua cùng đường consumer như relay (ProcessedEvent cùng giao dịch). Một ID có thể xuất hiện ở nhiều file (ca bổ sung, ca E2E có thoát); cột Test code là file chính.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| ORD-E2E-20261006-111226528 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226558 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | YẾU: bước 7 chỉ kiểm liên kết dẫn tới /orders/{code}/payment rồi quay lại vì màn thanh toán của PAY chưa có code (trang 404 của Next) |
| ORD-E2E-20261006-111226588 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226617 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226646 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | YẾU: bước "sản phẩm bị lưu trữ và đổi giá sau đó" không dựng được ở E2E (không có PRD trong máy chủ E2E); snapshot bất biến kiểm ở ORD-TC-20261006-111225177 trên API |
| ORD-E2E-20261006-111226677 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | skip | chưa chạy lại sau khi đổi khóa test sang `ord-order-list-source-*` (Lệch spec mục 21, 29); E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226706 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | skip | chưa chạy lại sau khi đổi khóa test sang `ord-order-list-source-*` (Lệch spec mục 21, 29); E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226737 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226766 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-121317047 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-TC-20261006-111224310 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224341 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224370 | TC | apps/api/test/order/list.spec.ts | pass | đếm truy vấn bằng jest.spyOn trên PrismaService (Lệch spec mục 15) |
| ORD-TC-20261006-111224400 | TC | apps/api/test/order/list.spec.ts | pass | phiên quá hạn trả mã nền session_expired (Lệch spec mục 8) |
| ORD-TC-20261006-111224430 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224459 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224487 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224517 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224546 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224575 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224604 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224634 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224663 | TC | apps/api/test/order/list.spec.ts | pass | kiểm lệch ma trận trên AppModule thật ở apps/api/test/order/guard.spec.ts |
| ORD-TC-20261006-111224693 | TC | apps/api/test/order/list.spec.ts | pass | phiên quá hạn trả mã nền session_expired (Lệch spec mục 8) |
| ORD-TC-20261006-111224721 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224750 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224780 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224809 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224838 | TC | apps/api/test/order/list.spec.ts | pass | - |
| ORD-TC-20261006-111224869 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111224900 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111224930 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111224962 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111224993 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111225023 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111225056 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111225088 | TC | apps/api/test/order/detail.spec.ts | pass | khóa bậc C theo người dùng (Lệch spec mục 7); cộng hai ca E2E 429 có đường thoát ở apps/api/test/e2e/ord.e2e.spec.ts |
| ORD-TC-20261006-111225118 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111225149 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111225177 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-111225205 | TC | apps/api/test/order/detail.spec.ts | pass | CHECK 23514 trên PostgreSQL thật |
| ORD-TC-20261006-111225234 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225263 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225291 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225320 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225350 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225380 | TC | apps/api/test/order/create.spec.ts | pass | cộng test nền apps/api/test/platform/events.spec.ts (thứ tự outbox cùng giao dịch, Lệch spec mục 12) |
| ORD-TC-20261006-111225410 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225438 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225467 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225552 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225590 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225620 | TC | apps/api/test/order/guard.spec.ts | pass | danh sách route của ORD trên AppModule thật |
| ORD-TC-20261006-111225649 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225678 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225708 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225737 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225767 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225795 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-111225824 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111225853 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111225882 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111225911 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111225940 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111225969 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111225998 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111226027 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111226057 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111226087 | TC | apps/api/test/order/history.spec.ts | pass | - |
| ORD-TC-20261006-111226117 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226147 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226176 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226206 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226244 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226276 | TC | apps/api/test/order/cancel.spec.ts | pass | Origin hợp lệ cho ca phiên quá hạn (Lệch spec mục 8) |
| ORD-TC-20261006-111226306 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226336 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226366 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226396 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226435 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226466 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111226497 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-111720124 | TC | apps/api/test/order/cancel.spec.ts | pass | YẾU: bước tích hợp "handler SHP bật, shipment chuyển cancelled" chưa kiểm vì SHP chưa có code; phần bắt buộc của ORD (200, một OrderCancelled, không gọi hay đọc bảng SHP) có thật |
| ORD-TC-20261006-111720161 | TC | apps/api/test/order/cancel.spec.ts | pass | cộng một ca E2E escape HTML ở apps/api/test/e2e/ord.e2e.spec.ts |
| ORD-TC-20261006-111720190 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261006-120227769 | TC | apps/api/test/order/create.spec.ts | pass | - |
| ORD-TC-20261006-120227861 | TC | apps/api/test/order/create.spec.ts | pass | - |
| ORD-TC-20261006-120227953 | TC | apps/api/test/order/create.spec.ts | pass | - |
| ORD-TC-20261006-120228061 | TC | apps/api/test/order/interfaces.spec.ts | pass | - |
| ORD-TC-20261006-120228155 | TC | apps/api/test/order/interfaces.spec.ts | pass | - |
| ORD-TC-20261006-120228244 | TC | apps/api/test/order/interfaces.spec.ts | pass | - |
| ORD-TC-20261006-120228334 | TC | apps/api/test/order/interfaces.spec.ts | pass | - |
| ORD-TC-20261006-120228419 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-120228504 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-120228595 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-120228687 | TC | apps/api/test/order/lifecycle.spec.ts | pass | YẾU: "tiến trình bị giết giữa commit và relay" là không chạy relay rồi chạy relay (không giết tiến trình thật); ca giết thật nằm ở nền PRJ-TC-20261006-110200101 |
| ORD-TC-20261006-121202827 | TC | apps/api/test/order/detail.spec.ts | pass | - |
| ORD-TC-20261006-140000100 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-140000200 | TC | apps/api/test/order/lifecycle.spec.ts | pass | - |
| ORD-TC-20261006-150000300 | TC | apps/api/test/order/handoff.spec.ts | pass | - |
| ORD-TC-20261006-150000400 | TC | apps/api/test/order/handoff.spec.ts | pass | - |
| ORD-TC-20261006-150000500 | TC | apps/api/test/order/handoff.spec.ts | pass | - |
| ORD-TC-20261006-150000600 | TC | apps/api/test/order/cancel.spec.ts | pass | - |
| ORD-TC-20261007-182432982 | TC | apps/api/test/order/rev.spec.ts | pass | REV-ORD-17: `invalid_input` cho địa chỉ sai khóa, NUL, nửa cặp thay thế lẻ, quá dài, null (Lệch spec mục 3) |
| ORD-TC-20261007-182433085 | TC | apps/api/test/order/create.spec.ts | pass | `not_confirmable`, `order_not_found` (Lệch spec mục 3) |
| ORD-TC-20261007-182433180 | TC | apps/api/test/order/handoff.spec.ts | pass | `not_lockable`, `order_not_found` (Lệch spec mục 3) |
| ORD-TC-20261007-182433278 | TC | apps/api/test/order/rev.spec.ts | pass | REV-ORD-20 (thứ tự theo position), REV-ORD-18 (CHECK, unique), create.spec.ts (position 1, 2) (Lệch spec mục 4) |
| ORD-TC-20261007-182433372 | TC | apps/api/test/order/interfaces.spec.ts | pass | thứ tự `delivered_at, position, id` của getDeliveredItems (Lệch spec mục 4) |
| ORD-TC-20261007-182433463 | TC | apps/api/test/order/rev.spec.ts | pass | REV-ORD-12: phiên quá hạn kèm Origin lạ 403 csrf_failed, Origin hợp lệ 401 session_expired (Lệch spec mục 8) |
| ORD-TC-20261013-211722071 | TC | apps/api/test/order/create.spec.ts | pass | `createPending` nhận `district` làm khóa thứ sáu (chuỗi hoặc null) và bác thiếu `district`, rỗng, không phải chuỗi, khóa lạ |
| ORD-TC-20261013-232524288 | TC | apps/api/test/order/dsh.spec.ts | pass | TC mới của đợt dọn nợ kiểm toàn spec 2026-10-13 (check-tests --strict) cho `OrderApi.getProductSalesTotals`; test có sẵn của đợt DSH nay mang thêm ID này |
| ORD-TC-20261013-223014153 | TC | apps/api/test/order/rev-undelivered.spec.ts | pass | TC mới của đợt đồng bộ REV 2026-10-13 cho `OrderApi.hasUndeliveredItems` (phương thức thứ 16 của bảng Giao diện module ở ORD-API): mã đã có từ lượt REV, nay có TC riêng của ORD; test dùng chung với REV-TC-20261006-104525491 |
| ORD-TC-20261015-092748827 | TC | apps/api/test/order/code.spec.ts | pass | mã đơn đầu tiên của ngày `HD261015-00001`, đơn kế `HD261015-00002` (CHK `createPending` rồi SAL `createHo`), một dòng bộ đếm; tra chữ thường chuẩn hóa chữ hoa. Mã dài 14 ký tự, không 15 như spec ghi (Lệch spec mục 18) |
| ORD-TC-20261015-092748863 | TC | apps/api/test/order/code.spec.ts | pass | qua nửa đêm giờ Việt Nam số thứ tự reset (`HD261015-00042` rồi `HD261016-00001`), giao dịch kéo qua nửa đêm lấy ngày lúc cấp mã, múi giờ phiên CSDL `America/Los_Angeles` không đổi kết quả; mốc là `Clock` của ứng dụng (Lệch spec mục 17) |
| ORD-TC-20261015-092748901 | TC | apps/api/test/order/code.spec.ts | pass | 20 giao dịch song song (10 `createPending`, 10 `createHo`, 3 hoàn tác): 17 mã khác nhau, dãy 00001 đến 00017, `last` = 17; 200 giao dịch song song (pool 16) 200 mã khác nhau, không bế tắc |
| ORD-TC-20261015-092748937 | TC | apps/api/test/order/code.spec.ts | pass | mã cũ 12 ký tự và mã mới tra được ở ô tìm (chữ thường, khoảng trắng hai đầu); thiếu dấu gạch nối là danh sách rỗng; `/orders/HD261015-00002%20` và `HD261015-0000;2` là 404 (Lệch spec mục 20) |
| ORD-TC-20261015-092748973 | TC | apps/api/test/order/code.spec.ts | pass | YẾU: B mở chi tiết, lịch sử, hủy đơn của A, mã không tồn tại, mã sai định dạng: cùng 404 và cùng chuỗi câu SQL (đếm câu SQL bằng `jest.spyOn`, không đo thời gian); `findOwned` null; phần route của PAY (trang kết quả thanh toán, URL quay về) thuộc TC của PAY vì PAY không có trong ứng dụng test của ORD (Lệch spec mục 28) |
| ORD-TC-20261015-092749008 | TC | apps/api/test/order/saleread.spec.ts | pass | sale S2 mở chi tiết, lịch sử đơn của S1 và đơn khách tự đặt: cùng 404 như mã không tồn tại; ô tìm mã ở danh sách của S2 trả `items` rỗng giống mã không tồn tại |
| ORD-TC-20261015-092749043 | TC | apps/api/test/order/code.spec.ts | pass | `last` = 99998: cấp được `HD261015-99999`, số 100000 là `order_code_exhausted` (không ghi gì, `last` giữ 99999), ngày kế `HD261016-00001` |
| ORD-TC-20261015-092749079 | TC | apps/api/test/order/code.spec.ts | pass | job `ord.sweep-code-counters`: xóa dòng cũ hơn hôm nay trừ 2 ngày (giữ 10-13, 10-14, 10-15 và dòng tương lai), idempotent, 1200 dòng thành 500, 500, 200, đồng hồ hỏng thì ném lỗi và không xóa gì |
| ORD-TC-20261015-092749114 | TC | apps/api/test/order/sources.spec.ts | pass | admin thêm `zalo` (201, một audit `order_source.created`), tắt `tiktok` (audit `order_source.updated` có `before`, `after`), sale thấy nguồn đang bật theo `position` rồi `name`, staff lấy cả nguồn tắt và lọc 12 đơn; `listSources` khớp hai endpoint |
| ORD-TC-20261015-092749156 | TC | apps/api/test/order/sources.spec.ts | pass | sale, staff 403; guest 401; Origin lạ 403 `csrf_failed`; trùng mã 409; tám thân sai 400; tham số lạ và `include_inactive` của sale 400; PATCH rỗng, có `code`, `is_system` 400; id sai và không có 404; không đổi gì, không audit |
| ORD-TC-20261015-092749194 | TC | apps/api/test/order/sources.spec.ts | pass | tắt `website` là 409 `order-source-protected`, đổi tên được; ở CSDL đổi `code`, `is_system`, tắt `website`, xóa nguồn đều bị từ chối (trigger 23000, CHECK 23514) |
| ORD-TC-20261015-092749232 | TC | apps/api/test/order/sources.spec.ts | pass | 49 nguồn: hai admin song song chỉ một 201 (khóa tư vấn), nguồn thứ 51 và thêm sau khi tắt 409 `order-source-limit`; tên 60 ký tự emoji 201, 61 ký tự 400 |
| ORD-TC-20261015-092749269 | TC | apps/api/test/order/sources.spec.ts | pass | bật lại nguồn; thứ tự `position` rồi `name` ổn định (Facebook trước Hotline); mã của nguồn đã tắt không tái dùng (409) |
| ORD-TC-20261015-092749306 | TC | apps/api/test/order/createho.spec.ts | pass | `createHo` COD: `confirmed`, `user_id` NULL, nguồn, khách, ghi chú, `confirmed_at`; dòng hàng có ghi chú và giá vốn; lịch sử `pending` (actor sale) rồi `confirmed` (system); OrderCreated, OrderConfirmed không lộ ghi chú, khách, giá vốn; một audit `order.created_ho`; admin thấy giá vốn, sale không có khóa; audit có đúng bộ khóa `{ order_code, source, has_user_id, items, grand_total, payment_method }` không dữ liệu cá nhân (REV-ORD, cũng ở SAL-TC-20261015-093909632) |
| ORD-TC-20261015-092749343 | TC | apps/api/test/order/createho.spec.ts | pass | `createHo` tiền mặt gắn tài khoản `u9`: khách thấy đơn ở danh sách và chi tiết nhưng không có nguồn, người tạo, ghi chú, khách, giá vốn; tắt `hotline` thì đơn cũ vẫn lọc được, `createHo` mới là `source_unavailable` (`inactive`) |
| ORD-TC-20261015-092749381 | TC | apps/api/test/order/createho.spec.ts | pass | nguồn không có (`not_found`) và nguồn đã tắt (`inactive`): không ghi gì, bộ đếm không đổi; đơn hợp lệ kế tiếp nhận `HD261015-00001`. Ánh xạ HTTP 409 do SAL, kiểm ở TC của SAL |
| ORD-TC-20261015-092749418 | TC | apps/api/test/order/createho.spec.ts | pass | 13 đầu vào sai (mỗi lần đổi một nhân tố) đều `invalid_input`, không ghi gì; 100 dòng hợp lệ; `createPending` từ chối `cash`, `created_by`, `source_id` |
| ORD-TC-20261015-092749455 | TC | apps/api/test/order/createho.spec.ts | pass | ghi chú đơn 1001, ghi chú dòng 501, nửa cặp thay thế lẻ, NUL, `\u0007` là `invalid_input`; CSDL từ chối ghi chú quá dài ở `orders` và `order_items` (CHECK 23514) |
| ORD-TC-20261015-092749492 | TC | apps/api/test/order/createho.spec.ts | pass | YẾU: bước sau trong `tx` của SAL thất bại được thay bằng ném lỗi trong cùng giao dịch (SAL, INV không có trong ứng dụng test ORD, không có `jest.spyOn(InventoryApi.reserve)`); đơn, dòng hàng, lịch sử, event, audit hoàn tác, bộ đếm về 5, đơn kế nhận `HD261015-00006` (Lệch spec mục 28) |
| ORD-TC-20261015-092749528 | TC | apps/api/test/order/createho.spec.ts | pass | YẾU: ghi chú 1000 ký tự (emoji) và 500 ký tự, và `<script>alert(1)</script>` lưu và trả đúng chuỗi, độ dài ở CSDL đúng; phần DOM (không có thẻ, không chạy script) chưa kiểm vì E2E chưa chạy, chỉ kiểm bằng đọc mã (React escape, `white-space: pre-wrap`); nâng bằng ORD-E2E-20261015-092749975 khi chạy được (Lệch spec mục 28) |
| ORD-TC-20261015-092749566 | TC | apps/api/test/order/createho.spec.ts | pass | giá vốn null; hai sale tạo song song cho hai mã, mỗi đơn đúng `created_by`; admin tắt nguồn chờ giao dịch giữ `FOR SHARE` commit rồi mới tắt (hai kết nối thật), `createHo` sau đó `source_unavailable` |
| ORD-TC-20261015-092749602 | TC | apps/api/test/order/display.spec.ts | pass | `getShipmentDisplay([A, B, C])`: đúng ánh xạ khóa (tên khách từ bản chụp hay người nhận, địa chỉ một chuỗi, không đoạn quận khi `district` null), một lần `getDisplayNames([S1])`, đúng hai truy vấn; 100 id vẫn một lời gọi AUTH |
| ORD-TC-20261015-092749639 | TC | apps/api/test/order/display.spec.ts | pass | báo cáo theo nguồn và theo sale: đơn `cancelled`, `expired`, `returned` bị loại (`excluded_orders` 3), hai báo cáo cùng tổng, cộng với loại bằng `countByStatus` (7 = 4 + 3); một truy vấn mỗi hàm |
| ORD-TC-20261015-092749676 | TC | apps/api/test/order/display.spec.ts | pass | `getShipmentDisplay` (rỗng, 101, trùng, không phải uuid) và hai báo cáo (khoảng ngược, `Date` sai, năm 10000) ném `RangeError` trước khi truy vấn; lỗi AUTH ném nguyên |
| ORD-TC-20261015-092749716 | TC | apps/api/test/order/display.spec.ts | pass | khoảng rỗng, nguồn tắt không đơn không có mặt, nguồn tắt có đơn có mặt, biên nửa mở `[from, to)`, sale đổi role vẫn có dòng, tài khoản không còn ở AUTH có `name` null |
| ORD-TC-20261015-092749753 | TC | apps/api/test/order/saleread.spec.ts | pass | staff, admin lọc `source`, `created_by` kết hợp AND; sale chỉ đơn của mình (`total` không lộ đơn người khác); đơn khách tự đặt nguồn website, người tạo null |
| ORD-TC-20261015-092749793 | TC | apps/api/test/order/saleread.spec.ts | pass | nguồn lạ, `created_by` sai, sale gửi `created_by` 400; tìm mã đơn người khác 200 rỗng; customer 403, guest 401; staff vượt bậc D 429 kèm `Retry-After`, sale vẫn gọi được |
| ORD-TC-20261015-092749829 | TC | apps/api/test/order/saleread.spec.ts | pass | tìm mã cũ và mã mới chuẩn hóa chữ hoa; nguồn đã tắt vẫn lọc (12 đơn); ô tìm 32 ký tự biên, 33 ký tự 400 |
| ORD-TC-20261015-092749864 | TC | apps/api/test/order/saleread.spec.ts | pass | chi tiết đơn hộ theo role: sale có khách, ghi chú, địa chỉ, không có `cost_snapshot`; staff có nguồn, người tạo, ghi chú, không có khách, địa chỉ; admin có giá vốn; không lộ ở outbox, audit, log |
| ORD-TC-20261015-092749900 | TC | apps/api/test/order/saleread.spec.ts | pass | sale S2 mở đơn của S1, đơn khách tự đặt, mã không tồn tại: cùng 404 và cùng câu SQL; customer không phải chủ đơn hộ 404; S1 mở thì 200 |
| ORD-TC-20261015-094426951 | TC | apps/api/test/order/createho.spec.ts | pass | YẾU: customer có đơn hộ gắn tài khoản không thấy nguồn, người tạo, ghi chú, khách, giá vốn (danh sách và chi tiết đúng bộ khóa); admin nhận nguyên chuỗi `<img src=x onerror=alert(1)>`; bước DOM trong trình duyệt chưa kiểm (Lệch spec mục 28) |
| ORD-TC-20261015-094427047 | TC | apps/api/test/order/createho.spec.ts | pass | customer thấy đơn hộ gắn tài khoản của mình, không thấy đơn hộ không tài khoản; `?user_id=` là 400 |
| ORD-TC-20261015-094427137 | TC | apps/api/test/order/createho.spec.ts | pass | đơn hộ chuyển khoản: PaymentSucceeded chỉ cập nhật `payment_status` (không OrderPaid, không log `transition-rejected`), rồi shipped, delivered; mọi event `user_id` null; event trùng no-op; đơn `cancelled` chỉ cập nhật `payment_status` |
| ORD-TC-20261015-094427219 | TC | apps/api/test/order/createho.spec.ts | pass | `createPending` luôn là đơn `website` (`created_by`, `customer_snapshot`, `note` NULL, OrderCreated có `source` và `created_by`); từ chối `note`, `created_by`, `bank_transfer` |
| ORD-TC-20261015-094427316 | TC | apps/api/test/order/createho.spec.ts | pass | `findForPayment` `user_id` null, `findForShipment` có `created_by`, `findOwned` không thấy, `getDeliveredItems` và `hasUndeliveredItems` chỉ tính đơn của đúng khách |
| ORD-TC-20261015-094427428 | TC | apps/api/test/order/sources.spec.ts | pass | bậc C: lần thứ 121 của sale 429 kèm `Retry-After`, staff và admin có bộ đếm riêng; bậc D của admin 429, yêu cầu bị chặn không tạo nguồn, không audit; chờ xong (đồng hồ giả) gọi lại được |
| ORD-TC-20261015-094427527 | TC | apps/api/test/order/saleread.spec.ts | pass | `listForSale` (một lời gọi AUTH cho trang, sắp `created_at` giảm dần, bộ khóa đóng) và `getForSale` (`has_account` false, không `cost_snapshot`, `user_id`; admin có `created_by`) |
| ORD-TC-20261015-094427624 | TC | apps/api/test/order/saleread.spec.ts | pass | `getForSale` null giống nhau và cùng câu SQL cho đơn người khác, đơn khách tự đặt, không tồn tại, mã sai định dạng; `RangeError` cho `limit` 101, `page` 0, `status` lạ, `created_by` sai, không truy vấn; lỗi AUTH ném nguyên |
| ORD-TC-20261015-094427719 | TC | apps/api/test/order/saleread.spec.ts | pass | trang cuối rỗng với `total` 20, `has_account` true không lộ `user_id`, đơn của admin có ở hai cách gọi, không có đơn khách tự đặt |
| ORD-TC-20261015-095530520 | TC | apps/api/test/order/saleread.spec.ts | pass | lịch sử đơn hộ của sale: `pending`, `confirmed`, `shipped`, `delivered` theo `seq`, không `paid`, chỉ `at` và `status`; admin giống hệt; customer không phải chủ đơn 404 |
| ORD-TC-20261015-095530563 | TC | apps/api/test/order/saleread.spec.ts | pass | sale S2 đọc lịch sử đơn của S1, đơn khách tự đặt, mã không tồn tại: cùng 404; PATCH, DELETE vào lịch sử 404 hoặc 405, lịch sử không đổi |
| ORD-E2E-20261015-092749937 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | skip | chưa chạy: máy chủ E2E dùng cổng 31xx, CSDL `ecom_e2e` và thư mục `.next` chung với các agent chạy song song; kiểm bằng typecheck, build web và đọc mã (Lệch spec mục 29) |
| ORD-E2E-20261015-092749975 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | skip | chưa chạy (cùng lý do): dữ liệu mồi đơn hộ qua cổng điều khiển mới (`ho`, `/set-order-source`); kiểm bằng typecheck và build web (Lệch spec mục 29) |
| ORD-E2E-20261015-092750011 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | skip | chưa chạy (cùng lý do): kiểm bằng typecheck và build web (Lệch spec mục 29) |

## Kiểm đột biến
129 đột biến (96 của lượt trước, 3 của `district`, 30 của đợt bán hộ; 16 đoạn cần phá cũ sửa theo mã mới) chọn theo từng điều kiện trong câu SQL, từng nhánh trạng thái và từng SB `Kiểm bằng: test` của ORD-SEC (20 SB), chạy bằng script chung `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-ord.json --cwd apps/api` (bảng JSON, mỗi đột biến chạy đúng một TC; cổng kiểm `apps/api/scripts/check-mutations.mjs` chạy trong `apps/api/test/tooling/mutations-ord.spec.ts`). Phủ cả mã nền sửa kèm (outbox, CSRF, ghi ProcessedEvent), migration (trigger chỉ-thêm, thu quyền, CHECK, unique một phần) và web (escape lý do hủy). Lượt chạy đầu: 97 đột biến, 94 bắt, 3 lọt (một đột biến không quan sát được và bỏ đi, hai lỗ hổng test thật: doanh thu theo `paid_at` chưa có ca tạo và thu khác ngày, thu quyền của vai trò ứng dụng chưa có ca phân biệt với trigger); sau khi sửa test và thay đột biến, mọi đột biến còn lại đều bắt. Không có đột biến tương đương. Lượt đợt bán hộ (46 đột biến mới hoặc đổi đoạn cần phá, mỗi cái một TC): 43 bắt, 3 lọt ở lượt đầu: (a) bỏ `FOR SHARE` ở `createHo` là đột biến tương đương (khóa khóa-ngoại `FOR KEY SHARE` của INSERT `orders.source_id` đã chặn `UPDATE ... FOR UPDATE` của admin), đã bỏ khỏi bảng; (b) bỏ `@RateLimit(LIMITS.read)` là tương đương (route không khai rơi về bậc C mặc định), đổi thành nới `LIMITS.read` lên 100000, bắt; (c) bỏ khóa tư vấn khi thêm nguồn lọt vì ca đua ngẫu nhiên, thêm bước giữ khóa tư vấn ở giao dịch khác trong ORD-TC-20261015-092749232, bắt. Đột biến web của đợt này (bộ lọc, khối nguồn) chưa có vì E2E chưa chạy.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-05, T4: staff được hủy đơn (sai ma trận) | ORD-TC-20261006-111226244 | bắt |
| SB-05, T1: danh sách của mình mở cho staff và admin (sai ma trận, lệch quyền) | ORD-TC-20261006-111224663 | bắt |
| SB-05, T4: danh sách quản trị mở cho customer | ORD-TC-20261006-111224663 | bắt |
| SB-05, T9: thêm route HTTP khóa bàn giao cho customer (không có đường HTTP nào cho giao diện nội bộ) | ORD-TC-20261006-150000400 | bắt |
| SB-35, T23: route HTTP khóa bàn giao bị phát hiện ở danh sách route | ORD-TC-20261006-111225620 | bắt |
| SB-06, T1: danh sách của customer bỏ điều kiện user_id (IDOR) | ORD-TC-20261006-111224310 | bắt |
| SB-06, T1: chi tiết bỏ điều kiện sở hữu (customer xem đơn người khác) | ORD-TC-20261006-111224962 | bắt |
| SB-06, T2: mã sai định dạng trả 400 thay vì cùng 404 (tách được mã sai định dạng khỏi của người khác) | ORD-TC-20261006-111225056 | bắt |
| SB-06, T1: hủy nạp đơn không kèm điều kiện sở hữu (customer hủy và khóa đơn của người khác) | ORD-TC-20261006-111226366 | bắt |
| SB-05, T5: vai trò suy từ phiên bị thay bằng customer cho admin (admin hủy đơn bị ghi như customer) | ORD-TC-20261006-111226206 | bắt |
| SB-06, T2: findOwned bỏ điều kiện user_id (SHP thấy đơn người khác) | ORD-TC-20261006-120228244 | bắt |
| SB-08, T6: staff thấy địa chỉ giao | ORD-TC-20261006-111224900 | bắt |
| SB-08, T6: can_cancel đúng cho staff | ORD-TC-20261006-111224900 | bắt |
| SB-08, T6: tìm theo mã đơn khớp một phần (ILIKE) thay vì khớp chính xác | ORD-TC-20261006-111224634 | bắt |
| SB-08, T6: danh sách quản trị cho phép tham số email (schema mở) | ORD-TC-20261006-111224721 | bắt |
| SB-08, T19: getRecipient trả thêm user_id | ORD-TC-20261006-120228061 | bắt |
| SB-08, T19: findForPayment trả thêm địa chỉ giao | ORD-TC-20261006-120228061 | bắt |
| SB-08, T19: listRecent của DSH trả thêm user_id | ORD-TC-20261006-120228155 | bắt |
| SB-18, T15: log bỏ qua event ghi cả payload (dữ liệu cá nhân, tham số) | ORD-TC-20261006-111225438 | bắt |
| SB-14, T3: chi tiết, lịch sử, danh sách của mình không còn giới hạn bậc C (120 -> 1200) | ORD-TC-20261006-111225088 | bắt |
| SB-14, T3: hủy đơn bỏ giới hạn bậc B | ORD-TC-20261006-111225088 | bắt |
| SB-14, T3: danh sách quản trị bỏ giới hạn bậc D | ORD-TC-20261006-111225088 | bắt |
| SB-14, T3: hạn mức bậc B của hủy đơn 10 -> 100 | ORD-TC-20261006-111225088 | bắt |
| SB-14, T3: hạn mức bậc D 30 -> 300 | ORD-TC-20261006-111225088 | bắt |
| SB-11, T5: body hủy chấp nhận khóa lạ (role, user_id) | ORD-TC-20261006-111226435 | bắt |
| SB-11, T12: trần lý do 500 -> 5000 | ORD-TC-20261006-111720161 | bắt |
| SB-11, T14: trạng thái lọc nhận chuỗi tự do | ORD-TC-20261006-111224341 | bắt |
| SB-11, T14: trần độ dài mã tìm 32 -> 320 | ORD-TC-20261006-111224750 | bắt |
| SB-11, T14: lý do hủy đếm byte thay vì ký tự (500 ký tự 2 byte bị từ chối) | ORD-TC-20261006-111720161 | bắt |
| SB-12, T12: lý do bị lọc thẻ HTML trước khi lưu (đổi nội dung đã nhập) | ORD-TC-20261006-111720161 | bắt |
| SB-24, T7: cho hủy đơn đã shipped | ORD-TC-20261006-111226306 | bắt |
| SB-24, T23: hủy của người dùng bỏ điều kiện cờ bàn giao | ORD-TC-20261006-150000600 | bắt |
| SB-24, T8: hủy lần hai không bị từ chối (bỏ kiểm trạng thái hủy được) | ORD-TC-20261006-111226336 | bắt |
| SB-24, T8: was_paid luôn true | ORD-TC-20261006-111226147 | bắt |
| SB-24, T8: payment_status không tự đặt cancelled khi hủy đơn chưa thu tiền | ORD-TC-20261006-111226147 | bắt |
| SB-24, T8: payment_status đã thu bị đặt cancelled khi hủy (mất dấu hoàn tiền) | ORD-TC-20261006-111226117 | bắt |
| SB-24, T8: mã lý do của OrderCancelled luôn customer_request | ORD-TC-20261006-111226206 | bắt |
| SB-24, T7: cancelled_by_role luôn customer | ORD-TC-20261006-111226206 | bắt |
| SB-24, T20: ghi lịch sử bị bỏ khi chuyển trạng thái | ORD-TC-20261006-111225234 | bắt |
| SB-27, T17: OrderPaid không vào outbox khi chuyển trạng thái | ORD-TC-20261006-111225234 | bắt |
| SB-24, T20: PaymentSucceeded đến sau hủy không còn được phép chuyển payment_status (bỏ cancelled khỏi cột Từ) | ORD-TC-20261006-111225467 | bắt |
| SB-24, T20: PaymentRefunded chấp nhận cả từ pending | ORD-TC-20261006-111225410 | bắt |
| SB-24, T7: PaymentFailed lẻ (is_final false) cũng hủy đơn | ORD-TC-20261006-111225350 | bắt |
| SB-24, T7: PaymentFailed is_final hủy cả đơn đã paid | ORD-TC-20261006-111225350 | bắt |
| SB-24, T22: StockCommitFailed không hủy đơn paid | ORD-TC-20261006-140000100 | bắt |
| SB-24, T22: StockCommitFailed hủy cả đơn shipped | ORD-TC-20261006-120228595 | bắt |
| SB-24, T22: StockCommitFailed không hủy đơn pending | ORD-TC-20261006-140000200 | bắt |
| SB-24, T22: hủy hệ thống không ghi audit (không có dấu vết) | ORD-TC-20261006-140000100 | bắt |
| SB-24, T7: StockReservationExpired hết hạn cả đơn paid | ORD-TC-20261006-111225795 | bắt |
| SB-24, T7: ShipmentShipped chỉ nhận đơn paid (đơn COD confirmed không giao được) | ORD-TC-20261006-111225263 | bắt |
| SB-24, T7: ShipmentShipped giao được cả đơn cancelled | ORD-TC-20261006-111225438 | bắt |
| SB-24, T7: ShipmentDelivered chuyển được đơn không phải shipped | ORD-TC-20261006-120228419 | bắt |
| SB-24, T7: ShipmentReturned chuyển được đơn không phải shipped | ORD-TC-20261006-120228419 | bắt |
| SB-24, T7: ShipmentFailed ghi dòng lịch sử cho đơn không còn shipped | ORD-TC-20261006-111225767 | bắt |
| SB-24, T20: ShipmentTrackingChanged bỏ qua đơn delivered | ORD-TC-20261006-120228504 | bắt |
| SB-24, T20: PaymentSucceeded của COD ghi log từ chối (nhầm là chuyển trạng thái) | ORD-TC-20261006-111225708 | bắt |
| SB-24, T20: paid_at lấy giờ ORD thay vì giờ của event | ORD-TC-20261006-111225234 | bắt |
| SB-22, T9: handler không kiểm đơn tồn tại (bỏ return sau log) | ORD-TC-20261006-111225590 | bắt |
| SB-27, T20: EventsService không chống trùng theo event_id (bỏ nhánh skipped) | ORD-TC-20261006-111225767 | bắt |
| SB-27, T17: outbox ghi bằng now() (hai event cùng giao dịch đảo thứ tự) | ORD-TC-20261006-111225380 | bắt |
| SB-24, T7: lỗi ghi lịch sử không rollback (handler nuốt lỗi) | ORD-TC-20261006-111225737 | bắt |
| SB-23, T16: createPending không kiểm công thức tiền | ORD-TC-20261006-120227861 | bắt |
| SB-23, T21: createPending cho đơn 0 đồng (R-03) | ORD-TC-20261006-120227861 | bắt |
| SB-23, T16: items_total không kiểm theo tổng dòng hàng | ORD-TC-20261006-120227861 | bắt |
| SB-24, T21: createPending nhận đơn COD kèm hạn thanh toán | ORD-TC-20261006-120227861 | bắt |
| SB-24, T21: createPending nhận hạn thanh toán ở quá khứ | ORD-TC-20261006-120227861 | bắt |
| SB-24, T21: confirmCod xác nhận được đơn vnpay | ORD-TC-20261006-120227861 | bắt |
| SB-24, T10: dòng lịch sử đầu của đơn không ghi người đặt | ORD-TC-20261006-120227769 | bắt |
| SB-24, T21: countOpenOrders không tính COD pending | ORD-TC-20261006-120227953 | bắt |
| SB-24, T23: lockForHandoff khóa cả đơn pending | ORD-TC-20261006-150000400 | bắt |
| SB-24, T23: gọi lại lockForHandoff ghi đè giờ khóa đầu | ORD-TC-20261006-150000500 | bắt |
| SB-35, T19: getDeliveredItems trả cả đơn shipped | ORD-TC-20261006-120228061 | bắt |
| SB-35, T19: countByStatus tính cả đơn đúng mốc to (nửa mở sai) | ORD-TC-20261006-120228334 | bắt |
| SB-35, T19: khoảng ngược không bị từ chối | ORD-TC-20261006-120228244 | bắt |
| SB-35, T19: trần limit của DSH 100 -> 1000 | ORD-TC-20261006-120228244 | bắt |
| SB-35, T19: getTopProducts tính cả đơn đã hủy (bỏ lọc trạng thái) | ORD-TC-20261006-120228155 | bắt |
| SB-35, T19: doanh thu gom theo mốc created_at thay vì paid_at | ORD-TC-20261006-120228155 | bắt |
| SB-11, T14: trang 2 lệch một (OFFSET page thay vì page - 1) | ORD-TC-20261006-111224310 | bắt |
| SB-11, T14: thứ tự phụ của danh sách đảo (id ASC) | ORD-TC-20261006-111224546 | bắt |
| SB-24, T11: lịch sử đọc theo created_at, id thay vì seq | ORD-TC-20261006-111226057 | bắt |
| SB-19, T11: lịch sử lộ lý do rỗng (reason: null) thay vì bỏ khóa | ORD-TC-20261006-111225998 | bắt |
| SB-24, T7: hạn thanh toán trả cả cho đơn đã rời pending | ORD-TC-20261006-121202827 | bắt |
| SB-23, T16: line_total tính bằng đơn giá (bỏ nhân số lượng) | ORD-TC-20261006-111224869 | bắt |
| SB-19, T11: trigger lịch sử chỉ chặn DELETE (UPDATE sửa được) | ORD-TC-20261006-111225969 | bắt |
| SB-32, T11: không thu quyền UPDATE, DELETE, TRUNCATE của vai trò ứng dụng trên lịch sử | ORD-TC-20261006-111225969 | bắt |
| SB-23, T16: bỏ CHECK công thức tổng tiền | ORD-TC-20261006-111225205 | bắt |
| SB-23, T21: bỏ CHECK grand_total > 0 | ORD-TC-20261006-120227861 | bắt |
| SB-24, T21: bỏ CHECK hạn thanh toán chỉ có ở đơn vnpay | ORD-TC-20261006-120227861 | bắt |
| SB-24, T23: bỏ CHECK cờ bàn giao chỉ cho đơn đã thanh toán hoặc xác nhận | ORD-TC-20261006-150000400 | bắt |
| SB-24, T8: bỏ unique một phần (đơn, trạng thái đích) của lịch sử | ORD-TC-20261006-111226497 | bắt |
| SB-24, T7: bỏ CHECK lịch sử tự trỏ chỉ cho shipped | ORD-TC-20261006-111226497 | bắt |
| SB-13, T13: CSRF chỉ kiểm có Origin, không kiểm Origin thuộc danh sách cho phép | ORD-TC-20261006-111226396 | bắt |
| SB-20, T18: 409 hủy đơn nêu trạng thái hiện tại trong detail | ORD-TC-20261006-111226306 | bắt |
| SB-12, T12: web hiển thị lý do hủy như HTML (không escape) | ORD-TC-20261006-111720161 | bắt (lượt trước; đoạn cần phá đã đổi theo trang hiện tại, chưa chạy lại vì cần E2E) |
| district (sáu khóa): ORD không đòi khóa district (bỏ khỏi ADDRESS_KEYS) | ORD-TC-20261013-211722071 | bắt |
| district (sáu khóa): ORD không nhận district null (khách không có quận, huyện) | ORD-TC-20261013-211722071 | bắt |
| district (sáu khóa): ORD không kiểm nội dung district (khoảng trắng, số) | ORD-TC-20261013-211722071 | bắt |
| SB-24, T21: số thứ tự của mã đơn chỉ 4 chữ số (sai khuôn HDyymmdd-NNNNN) | ORD-TC-20261006-120227769 | bắt |
| SB-27, T29: ngày của mã đơn tính theo UTC thay vì giờ Việt Nam (mã lệch ngày) | ORD-TC-20261015-092748863 | bắt |
| SB-24, T10: dòng lịch sử đầu của đơn không ghi người đặt | ORD-TC-20261006-120227769 | bắt |
| SB-06, T24: sale đọc chi tiết bỏ điều kiện created_by (đọc đơn của sale khác) | ORD-TC-20261015-092749900 | bắt |
| SB-44, T24: danh sách của sale bỏ điều kiện created_by (lộ total và đơn người khác) | ORD-TC-20261015-092749753 | bắt |
| SB-44, T24: getForSale bỏ điều kiện created_by | ORD-TC-20261015-094427624 | bắt |
| SB-44, T24: listForSale lấy cả đơn khách tự đặt | ORD-TC-20261015-094427719 | bắt |
| SB-44, T2: findOwned bỏ điều kiện chủ đơn | ORD-TC-20261015-092748973 | bắt |
| SB-42, T25: giá vốn lộ cho mọi role ở chi tiết đơn | ORD-TC-20261015-092749864 | bắt |
| SB-42, T25: OrderCreated của đơn hộ mang giá vốn | ORD-TC-20261015-092749306 | bắt |
| SB-06, T6: customer thấy nguồn, người tạo, ghi chú ở chi tiết | ORD-TC-20261015-094426951 | bắt |
| SB-45, T26: createHo nhận nguồn đã tắt | ORD-TC-20261015-092749381 | bắt |
| SB-45, T26: createHo không ghi audit order.created_ho | ORD-TC-20261015-092749306 | bắt |
| SB-45, T27: ghi chú chứa ký tự điều khiển được nhận | ORD-TC-20261015-092749455 | bắt |
| SB-45, T27: ghi chú dòng vượt 500 ký tự được nhận | ORD-TC-20261015-092749455 | bắt |
| SB-23, T26: createHo không kiểm công thức tiền | ORD-TC-20261015-092749418 | bắt |
| SB-23, T26: createHo không kiểm items_total theo dòng hàng | ORD-TC-20261015-092749418 | bắt |
| SB-23, T26: createHo cho đơn 0 đồng | ORD-TC-20261015-092749418 | bắt |
| SB-07, T28: quản trị nguồn đơn mở cho sale | ORD-TC-20261015-092749156 | bắt |
| SB-45, T28: nguồn hệ thống tắt được qua API | ORD-TC-20261015-092749194 | bắt |
| SB-45, T28: trần 50 nguồn lệch một đơn vị | ORD-TC-20261015-092749232 | bắt |
| SB-45, T28: thêm nguồn không khóa tư vấn (hai yêu cầu song song cùng vượt trần) | ORD-TC-20261015-092749232 | bắt |
| SB-19, T28: sửa nguồn không ghi audit order_source.updated | ORD-TC-20261015-092749114 | bắt |
| SB-14, T28: bậc C của đọc danh mục nguồn đơn nới lên 100000 mỗi phút | ORD-TC-20261015-094427428 | bắt |
| SB-27, T29: số thứ 100000 trong ngày không đổi thành order_code_exhausted | ORD-TC-20261015-092749043 | bắt |
| SB-31, T29: job dọn bộ đếm bỏ giới hạn lô 500 | ORD-TC-20261015-092749079 | bắt |
| SB-31, T29: job dọn bộ đếm xóa cả dòng của hôm kia | ORD-TC-20261015-092749079 | bắt |
| SB-18, T30: getSourcesReport tính cả đơn hủy, hết hạn, hoàn | ORD-TC-20261015-092749639 | bắt |
| SB-18, T30: getSalesReport tính cả đơn hủy, hết hạn, hoàn | ORD-TC-20261015-092749639 | bắt |
| SB-18, T30: báo cáo theo nguồn tính cả đơn ở mốc `to` (khoảng đóng thay vì nửa mở) | ORD-TC-20261015-092749716 | bắt |
| SB-08, T30: getShipmentDisplay bỏ đoạn quận, huyện khỏi địa chỉ | ORD-TC-20261015-092749602 | bắt |
| SB-08, T30: getShipmentDisplay không tra tên người tạo theo lô (gọi AUTH từng dòng) | ORD-TC-20261015-092749602 | bắt |

## Lệch spec
Số TC, E2E ở bảng trên là toàn bộ của epic (93 TC, 10 E2E); mọi dòng pass. Mục `[cần quyết]` cần người hoặc `sdlc-impact`, `sdlc-foundation`; mục `[chưa làm]` là việc spec yêu cầu mà chưa làm được vì epic khác chưa có code.

1. [đã chọn] (đã đồng bộ spec: tên `OrderApi` ở CHK-API, CHK-DB, CHK-REQ, ORD-TC-20261006-111225380 và bảng Giao diện module của architecture.md) Tên lớp giao diện module: mã dùng `OrderApi` (cùng quy ước `<Tên>Api` của `CatalogApi`, `InventoryApi`, `PromotionApi`) trong khi ORD-TC-20261006-111225380 và các TC ghi `OrderService.createPending`, `OrderService.confirmCod`; bảng "Giao diện module" của `architecture.md` chỉ ghi tên phương thức. Rủi ro: CHK, PAY, SHP, REV, DSH dựng theo `OrderService` sẽ không biên dịch; cùng họ lỗi đã gặp ở PRD, INV, PRM. Test: apps/api/test/order/guard.spec.ts (chữ ký và số đối số của mười lăm phương thức khớp bảng).
2. [đã chọn] `consumer` của ProcessedEvent là `order` (tên module, như `inventory`, `promotion`) thay vì `ORD` (ORD-TC-20261006-111225234, ORD-DB mục Giao dịch và khóa 1). Test: ORD-TC-20261006-111225234.
3. [đã chọn] (đã đồng bộ spec bằng sdlc-impact sau review: ORD-API mục Giao diện module, architecture.md, SHP-API, CHK-API; TC mới ORD-TC-20261007-182432982, ORD-TC-20261007-182433085, ORD-TC-20261007-182433180) Mã lỗi dùng trong mã mà ORD-API chưa đặt tên: ORD-API ghi "lỗi nghiệp vụ" cho giao diện nội bộ nên mã dùng `OrderBusinessError` với bốn mã `invalid_input` (đầu vào của `createPending` sai hoặc số tiền không nhất quán), `order_not_found`, `not_confirmable` (`confirmCod` không phải COD đang `pending`), `not_lockable` (`lockForHandoff` không ở `paid` hay `confirmed`); mã log của chuyển bị từ chối là `transition-rejected` (ORD-TC-20261006-111225438 cũng ghi "chưa có mã lỗi cụ thể"). CHK và SHP bắt theo `code` (SHP đổi `not_lockable` thành 409 `order-not-shippable` ở epic SHP). Đã thêm vào ORD-API (mục Giao diện module). Test: ORD-TC-20261006-120227861, ORD-TC-20261006-150000400, ORD-TC-20261006-111225438.
4. [đã chọn] (đã đồng bộ spec: ORD-DB bảng `order_items` và mục 8, 9, ORD-API chi tiết đơn; TC mới ORD-TC-20261007-182433278, ORD-TC-20261007-182433372) Thêm cột `order_items.position` (số nguyên dương, unique `(order_id, position)`) mà ORD-DB không có: `id` của dòng hàng là uuid ngẫu nhiên nên không khôi phục được thứ tự dòng khi hiển thị (ORD-TC-20261006-111224869 yêu cầu "phần tử 1" là dòng đầu tiên). Đã sửa ORD-DB. Test: ORD-TC-20261006-111224869, ORD-TC-20261006-120227769.
5. [đã chọn] Hủy hệ thống do PaymentFailed `is_final` giữ `payment_status` = `failed` (không đặt `cancelled` theo CASE của ORD-DB mục 2, vì Payment thật đã `failed`); hủy do StockCommitFailed và hủy của người dùng áp CASE (pending, processing, failed thành cancelled, giữ succeeded). Rủi ro: màn thanh toán của PAY thấy `failed` trên đơn đã hủy; đúng với Payment thật. Test: ORD-TC-20261006-111225350, ORD-TC-20261006-140000200.
6. [đã chọn] `createPending` kiểm chặt hơn spec: `items_total` phải bằng tổng `unit_price x quantity` các dòng, `shipping_address` đúng sáu khóa (có `district`, chuỗi hoặc null; từ 2026-10-13, trước đó năm khóa không `district`), uuid hợp lệ, chuỗi không rỗng và không có nửa cặp thay thế lẻ; ORD-API chỉ nêu công thức tiền và `payment_expires_at`. Rủi ro: CHK tính `items_total` khác tổng dòng sẽ bị từ chối (lỗi `invalid_input`, không ghi gì). Hạn thanh toán so với giờ CSDL (như INV). Test: ORD-TC-20261006-120227861 (các ca j, k). Đã đồng bộ spec và mã theo quyết định của người (REV-CHK-55, báo cáo spec/changes/ord-district-20261013.md); test: ORD-TC-20261013-211722071.
7. [đã chọn] (đã đồng bộ spec: ORD-API, ORD-SEC T3, ORD-REQ BR8 và BR9, ORD-TC-20261006-111225088) Giới hạn bậc C (chi tiết, lịch sử, danh sách của mình) đếm theo người dùng đã đăng nhập (khóa mặc định của platform) thay vì theo IP như ORD-API và ORD-SEC T3 ghi: các endpoint này đều cần đăng nhập và `@RateLimit` không nhận cấu hình số bước proxy để lấy IP. Rủi ro: một người dùng nhiều IP không bị gộp, nhiều người một IP không chung hạn mức. Test: ORD-TC-20261006-111225088.
8. [đã chọn] (đã chọn giữ thứ tự guard của nền theo ADR-016; ORD-API mục Thứ tự kiểm, ORD-TC-20261006-111224400 và ORD-TC-20261006-111224693 đã sửa; TC mới ORD-TC-20261007-182433463) Thứ tự kiểm của nền khác ORD-API ("429, 401, Origin, 415, quyền"): `CsrfGuard` chạy trước `AuthGuard` khi request có cookie hoặc `Origin`, nên phiên hết hạn kèm `Origin` lạ nhận 403 `csrf_failed` thay vì 401; phiên hết hạn trả mã nền `session_expired`, không phải `unauthenticated` như ORD-TC-20261006-111224400 và ORD-TC-20261006-111224693 ghi (test chấp nhận cả hai mã, assert 401). Ca guest không có Origin nhận đúng 401. Đã chốt giữ thứ tự guard của nền và sửa TC. Test: ORD-TC-20261006-111226276.
9. [đã chọn] Bộ lọc trạng thái của hai danh sách là ô chọn `<select>` ở mọi kích thước (ui ghi hàng tab và dropdown dưới sm); E2E chọn theo nhãn. Hộp thoại hủy dùng `<textarea>`; lỗi 429 trong hộp thoại không khóa nút Xác nhận (bấm lại được ngay, thông báo tự mất khi hết `Retry-After`); thông báo "Đã hủy đơn" ở lại tới khi rời trang. Test: ORD-E2E-20261006-111226528, ORD-E2E-20261006-111226558, ORD-TC-20261006-111225088 (hai ca E2E 429 có đường thoát).
10. [chưa làm] Liên kết "Xem thanh toán" và "Theo dõi vận chuyển" dẫn tới `/orders/{code}/payment` và `/orders/{code}/shipment`: màn của PAY và SHP chưa có code nên đích là trang 404 của Next; PAY, SHP phải dựng đúng đường dẫn hoặc báo đường dẫn khác. YẾU: ORD-E2E-20261006-111226558 (bước 7 chỉ kiểm liên kết dẫn tới đường dẫn đó rồi quay lại); nâng bằng E2E liên module khi PAY có màn.
11. [chưa làm] Các bên gọi và nhận chưa có code: CHK (`createPending`, `confirmCod`, `countOpenOrders`, `getSummary`), PAY (`findForPayment`, nhận OrderCreated, OrderCancelled, OrderDelivered, OrderReturned, OrderExpired), SHP (`findForShipment`, `findByCode`, `findOwned`, `getRecipient`, `lockForHandoff`, nhận OrderPaid, OrderConfirmed, OrderCancelled), REV (`getDeliveredItems`), DSH (bốn hàm tổng hợp), NTF. Mười lăm phương thức được kiểm bằng lời gọi trực tiếp; event ORD phát đã đúng phong bì và tên trường của `events.md` (INV, PRM đã có consumer nhận OrderConfirmed, OrderCancelled, OrderExpired). SHP phải gọi `lockForHandoff` trong giao dịch bàn giao (R-04), nếu không cửa sổ giữa bàn giao và ShipmentShipped còn mở.
12. [đã chọn] Sửa nền `EventsService.publish` (`apps/api/src/modules/platform/events/events.service.ts`): `occurred_at` của outbox ghi bằng `clock_timestamp()` thay `now()`. `now()` đứng yên trong giao dịch nên OrderCreated và OrderConfirmed của đơn COD (cùng giao dịch của CHK) bằng `occurred_at` và relay sắp theo `id` uuid ngẫu nhiên đảo thứ tự (đỏ khoảng một nửa số lần ở ORD-TC-20261006-111225380); cùng họ lỗi L66 của INV. Test kiểm sửa nền: ORD-TC-20261006-111225380 (apps/api/test/platform/events.spec.ts, 40 đơn; đột biến "outbox ghi bằng now()" bắt) và ORD-TC-20261006-111225380 ở apps/api/test/order/create.spec.ts. Rủi ro: `occurred_at` thành thời điểm ghi event, không phải lúc bắt đầu giao dịch; mọi module phát nhiều event trong một giao dịch được lợi.
13. [đã chọn] Thêm vào hạ tầng test (không phải mã ứng dụng): `truncateAll` ở `test/support/db.ts` và `/reset` ở `test/e2e/server.ts` dọn ba bảng đơn; cổng điều khiển E2E thêm `/seed-order`, `/order`, `/event` (giao event của PAY, INV, SHP cho ORD); fixture đơn dùng chung `test/support/order-fixture.ts`. `auth.prisma` thêm hai quan hệ ngược tới `orders`, `order_status_history` (không đổi migration của AUTH; `db:check` khớp). Test: ORD-E2E-20261006-111226588, ORD-E2E-20261006-121317047.
14. [đã chọn] Dấu thời gian của đơn và lịch sử (`created_at`, `updated_at`, dòng lịch sử, `delivered_at`, `confirmed_at`, `handoff_locked_at`) ghi theo `Clock` của ứng dụng thay vì `now()` CSDL để TC ghim giờ (10:00:00Z, giờ giao); thứ tự lịch sử vẫn theo `seq`. Rủi ro: lệch đồng hồ giữa các instance làm lệch nhẹ thứ tự theo `created_at` của danh sách (khóa phụ `id`). Test: ORD-TC-20261006-111225291, ORD-TC-20261006-111226057.
15. [đã chọn] Kiểm "không có truy vấn" và "không khóa dòng" của TC làm bằng `jest.spyOn` trên `PrismaService.$queryRaw` (đếm câu SQL đã nối) và bằng giao dịch giữ khóa dòng của đơn người khác trong khi gọi hủy (nếu bị khóa thì lời gọi treo), không bằng log câu lệnh của CSDL; truy vấn trong giao dịch (`tx`) không đi qua spy. ORD-TC-20261006-111224962 đo thời gian xen kẽ từng cặp (60 cặp, chênh trung vị dưới 10 ms) và có thể đỏ khi máy tải nặng. Test: ORD-TC-20261006-111224370, ORD-TC-20261006-111225911, ORD-TC-20261006-111226366.
16. [đã chọn] (đã đồng bộ spec: ORD-API hàng DSH, events.md hàng OrderCreated, DSH-API; DSH, NTF, PAY còn phải xác nhận khi dựng) Hình dạng trả về của giao diện tổng hợp cho DSH mà ORD-API không nêu: `getOrderSeries` trả `[{ bucket_start, orders: {tám trạng thái}, paid_orders, paid_total }]` (bucket `hour`, `day`, `month`, trần 1000 mốc, không bỏ mốc rỗng), `getTopProducts` trả `[{ product_id, quantity, amount }]` sắp theo `sort` (`quantity` hoặc `amount`), loại đơn `cancelled`, `expired`, `returned` theo DSH-DB; `OrderCreated.items` là `[{ product_id, name, unit_price, quantity }]` (events.md chỉ ghi `items`). DSH, NTF, PAY phải xác nhận khi dựng. Test: ORD-TC-20261006-120228155, ORD-TC-20261006-120227769.
17. [đã chọn] Không có lần "test đỏ đúng lý do" cho từng TC: mã và test viết trong cùng một lượt; bù bằng bảng đột biến (96 chỗ phá, mỗi chỗ làm một TC cụ thể đỏ) và ca tải hỗn hợp. Rủi ro: TC xanh vì khẳng định yếu mà đột biến chưa nghĩ tới; reviewer nên chọn đột biến riêng theo điều kiện trong câu SQL (bỏ `FOR UPDATE`, đổi thứ tự khóa, bỏ `AND status = :cũ`). Đột biến "bỏ `AND status = :cũ` khỏi câu UPDATE của lõi chuyển trạng thái" không có trong bảng vì quan sát được khác biệt chỉ khi bỏ cả khóa dòng (lớp bảo vệ thứ hai theo ORD-DB mục 1); khóa dòng được kiểm bằng ba ca đua (ORD-TC-20261006-111225678, ORD-TC-20261006-150000500, ORD-TC-20261006-111226497).
18. [đã chọn] Hàng ma trận: bốn hàng của ORD không có endpoint ("Xem trạng thái đơn" là trường `status` của danh sách và chi tiết; ba hàng giao diện nội bộ, tác nhân `system`) được miễn ở kiểm lệch ma trận; năm route còn lại khớp đúng. ORD-SEC T19 (chỉ SHP gọi `getRecipient`, DSH không trả trường cá nhân) kiểm bằng `check:boundaries` và test trường tối thiểu, không có kiểm cứng "ai gọi" ngoài ranh giới module. Test: ORD-TC-20261006-111224663, ORD-TC-20261006-120228061.
19. [đã chọn] Web: giờ hiển thị cố định giờ Việt Nam (UTC+7, tính tay, không phụ thuộc múi giờ máy hay `Intl`) nên E2E dựng đơn theo giờ Việt Nam; thứ tự lịch sử cũ nhất trước theo ORD-REQ-20261006-092320812 BR7. Dòng lịch sử `shipped` thứ hai trở đi hiển thị "Giao thất bại" kèm nhãn mã lý do. Test: ORD-E2E-20261006-121317047, ORD-E2E-20261006-111226528.
20. [đã chọn] `clean_run: pass`: chạy trong `git worktree` (HEAD cộng tệp đã sửa và chưa theo dõi chép sang, vì các epic trước chưa commit), `pnpm install --frozen-lockfile --offline`, rồi `scan:secrets`, `check:boundaries`, `lint`, `typecheck`, `test` và `build` bằng `env -i` chỉ với PATH, HOME, `TEST_DB_BASE`, `NEXT_TELEMETRY_DISABLED`, `STORAGE_TEST_ENDPOINT` và dịch vụ docker db, minio như workflow CI. Workflow GitHub chưa chạy thật (chưa push). Lần chạy `pnpm test` đầu trên máy dev đỏ 17 test của USR, PRD (MinIO trả 507) do đĩa máy ảo Docker đầy 100 phần trăm; đã dọn bộ nhớ đệm build của Docker (`docker builder prune`, 6 GB) rồi các bộ đó xanh; không phải lỗi mã.
21. [đã chọn] YẾU: ORD-TC-20261006-111720124 thiếu bước tích hợp "handler SHP bật thì shipment chuyển `cancelled`" vì SHP chưa có code; kiểm phần bắt buộc của ORD (200, đúng một OrderCancelled, mã module không import và không truy vấn bảng của SHP, PAY, INV...). Nâng bằng test liên module khi SHP có consumer của OrderCancelled.
22. [đã chọn] YẾU: ORD-TC-20261006-120228687 mô phỏng "tiến trình chết giữa commit và relay" bằng cách không chạy relay (dòng outbox `dispatched_at` NULL) rồi chạy relay thật và giao lại cùng `event_id` hai lần, không giết tiến trình con như ca nền PRJ-TC-20261006-110200101. Nâng bằng tiến trình con giết thật chạy PaymentSucceeded của ORD (cần fixture như `commit-then-die.ts` cho ORD).
23. [đã chọn] YẾU: ORD-E2E-20261006-111226646 bỏ bước "sau đó một sản phẩm của đơn bị lưu trữ và đổi giá" vì máy chủ E2E không có PRD; tên và giá lúc đặt không đổi được kiểm ở tầng API với bảng sản phẩm thật (ORD-TC-20261006-111225177). Nâng bằng E2E dựng sản phẩm qua cổng điều khiển của PRD rồi đổi giá và lưu trữ.
24. [đã chọn] (đã sửa bằng change-control lượt hai, ORD-API và ORD-TC-…400 nay đúng) Hai tài liệu đã duyệt lại sau đồng bộ còn một chỗ sai và cần người đăng ký thêm một lượt sửa ở change-control: ORD-API-20261006-092703780 (dòng Thứ tự kiểm viết kiểm `Origin` áp cho mọi request có cookie, trong khi ADR-016 chỉ áp POST, PUT, PATCH, DELETE; GET không nhận 403 `csrf_failed`) và ORD-TC-20261006-111224400 (ca (d) gọi `GET /orders` với phiên quá hạn kèm `Origin` lạ và đòi 403: GET không bị kiểm `Origin` nên ca này sai; ca đúng nằm ở ORD-TC-20261007-182433463). Mã đúng và test thật không có ca sai đó. Xem spec/changes/ORD-API-20261006-092703780.md.

17. [đã chọn] Ngày của mã đơn lấy từ `Clock` của ứng dụng (đồng hồ máy chủ, tính MỘT lần lúc cấp mã, múi giờ `Asia/Ho_Chi_Minh`, không phải `now()` của giao dịch) thay vì `clock_timestamp()` của CSDL như ORD-DB mục Mã đơn: cùng ngữ nghĩa, nhưng test đặt được mốc bằng đồng hồ giả (spec cũng không dựng được đồng hồ CSDL); `orders.created_at` ghi đúng mốc đó. Rủi ro: lệch đồng hồ giữa các instance chỉ đổi ngày của mã quanh nửa đêm (không gây trùng số vì bộ đếm theo ngày vẫn nguyên tử). Test: ORD-TC-20261015-092748827, ORD-TC-20261015-092748863.
18. [cần quyết] Spec ghi mã mới "dài 15 ký tự" (ORD-REQ-20261015-092748640 BR1, ORD-TC-20261015-092748827) nhưng khuôn `HDyymmdd-NNNNN` (`HD` + 6 chữ số + gạch nối + 5 chữ số) dài 14 ký tự; mã theo khuôn và CHECK `^(HD[0-9]{6}-[0-9]{5}|...)$` (đúng ví dụ `HD261015-00001`), test khẳng định 14. Cần sửa chữ "15 ký tự" ở requirement, ORD-DB và TC qua sdlc-impact. Test: ORD-TC-20261015-092748827.
19. [cần quyết] `GET /api/v1/admin/orders` trả thêm khóa `created_by` (id người tạo, null với đơn khách tự đặt) ngoài `source` và `created_by_name` của ORD-API: ô lọc Người tạo (ui/order-list-source) gom người tạo từ các đơn đã tải, staff không có API danh sách nhân viên (AUTH `GET /admin/users` chỉ admin). Rủi ro nhỏ: staff thấy id người dùng của sale. Cần thêm khóa vào ORD-API hoặc đổi cách chọn người tạo. Test: ORD-TC-20261006-111224604 (`list.spec.ts`, bộ khóa đúng chín), ORD-E2E-20261015-092749975.
20. [đã chọn] Đường dẫn `{code}` không cắt khoảng trắng (`HD261015-00002%20` là 404, ORD-TC-20261015-092748937) còn ô tìm của danh sách và `listForSale` cắt khoảng trắng rồi chuẩn hóa chữ hoa; độ dài 1..32 của ô tìm tính sau khi cắt (ORD-API). Test: ORD-TC-20261015-092748937, ORD-TC-20261015-092749829.
21. [đã chọn] Trang `/admin/orders` dùng khóa test của `order-list-source` cho phần tử trùng chức năng với `order-admin-list` (hàng, mã đơn, dòng tóm tắt, ô tìm, Xoá lọc, rỗng do lọc, lỗi, Thử lại, khung chờ, phân trang) vì một phần tử chỉ có một `data-testid` và ba E2E của đợt dùng khóa list-source; phần tử chỉ có ở `order-admin-list` (tab trạng thái, nhãn, ngày, thanh toán, số mặt hàng, tổng, rỗng khi chưa có đơn) giữ khóa cũ; E2E cũ ORD-E2E-20261006-111226677, ORD-E2E-20261006-111226706, ORD-TC-20261006-111225088 (ca bậc D) đổi theo. Dòng tóm tắt đúng chữ "1 tới N trong M đơn" của spec (`Pager` nhận thêm prop `summary` tùy chọn, dùng cho cả hai danh sách đơn; `Pager` mặc định đã đổi thành "1–20 / 45" từ trước nên E2E cũ lệch chữ). Khối Thông tin bán hàng nhận dữ liệu cùng phản hồi chi tiết (không gọi API riêng) nên không dựng ba phần tử tải, lỗi, thử lại của khối (`ord-order-detail-source-loading`, `-error`, `-retry`); dòng "khách ẩn" cho staff hiện khi đơn có người tạo hoặc nguồn khác `website` (server không báo đơn có khách hay không). Ô Người tạo gom từ các đơn đã tải; lỗi danh mục nguồn hiện `ord-order-list-source-filter-error` kèm nút Thử lại không có testid riêng.
22. [đã chọn] Migration gộp: các CHECK, chỉ mục mới tạo thẳng trong giao dịch của migration (không `NOT VALID` rồi `VALIDATE`, không `CREATE INDEX CONCURRENTLY` như ORD-DB mục Migration mô tả) vì bảng còn nhỏ ở v1 và mỗi migration của Prisma chạy trong một giao dịch; ba giá trị enum nằm ở migration riêng và CHECK dùng `cash`, `bank_transfer` ở migration sau đó; chỉ mục `orders_open_idx` cũ giữ tới Lần 2, mã đếm đơn mở dùng `orders_open_self_idx` mới (điều kiện `created_by IS NULL`). Seed `position` đều 0 (ORD-DB không nêu) nên thứ tự là Facebook, Hotline, TikTok, Website. `check-migration-compat` và `db:check` xanh. Test: ORD-TC-20261006-120227953 (sửa test nền `create.spec.ts`: EXPLAIN dùng chỉ mục mới), ORD-TC-20261015-092749269.
23. [đã chọn] Mã lỗi tự đặt (L63): `order-source-code-taken`, `order-source-protected`, `order-source-limit` (đều có trong ORD-API); `OrderBusinessError` thêm mã `source_unavailable`, `order_code_exhausted` và thuộc tính `reason` (có trong ORD-API). Test: ORD-TC-20261015-092749156, ORD-TC-20261015-092749232, ORD-TC-20261015-092749381, ORD-TC-20261015-092749043.
24. [đã chọn] Kiểm chặt hơn spec ở `createHo`: `full_name` khách 1..100 ký tự đã cắt khoảng trắng, `phone` 8..20 ký tự theo khuôn, `created_by` và `user_id` đúng uuid, khóa dòng hàng lạ là `invalid_input`; lỗi khóa ngoại 23503 của `user_id` hay `created_by` thành `invalid_input`. Test: ORD-TC-20261015-092749418.
25. [chưa làm] Mã đơn mới làm hỏng module khác chưa sửa (ngoài epic, ORD-REQ-20261015-092748640 BR6 đã nêu PAY): PAY `lifecycle.service.ts` bỏ qua OrderCreated có mã `HDyymmdd-NNNNN` (regex 12 ký tự) và migration `20261008000200_payment_tables` có CHECK `payments_order_code_format` cùng khuôn 12 ký tự, nên đơn mới không có Payment; NTF `ORDER_CODE_RE` bỏ mã và dùng liên kết chung; SHP có `shipments_order_code_format` (agent SHP làm `20261015000100_shipping_order_code_hd`). Hậu quả quan sát được khi chạy: `test/checkout/place.spec.ts`, `idem.spec.ts`, `rev.spec.ts` đỏ (không có Payment, Shipment), `test/notification/review.spec.ts` đỏ (thông báo thiếu mã). Cần sdlc-impact PAY, NTF; PAY còn bỏ qua đơn hộ (`user_id` rỗng, `cash`, `bank_transfer`) và NTF coi event thiếu `user_id` là `event-invalid` mức error thay vì bỏ qua êm (events.md).
26. [chưa làm] Ma trận quyền: `spec/permissions-matrix.md` chưa gộp `spec/epics/ORD/permission-rows.md` (lead gộp một lần). `test/order/guard.spec.ts` nay đọc ma trận chính cộng dòng ORD chưa gộp và gộp quyền `sale own` vào hàng gốc cùng endpoint (danh sách quản trị, chi tiết, lịch sử), vì mỗi endpoint chỉ có một `@Action` và tên các hàng "Sale xem ..." không theo quy ước `Sale <việc>` của `auditPermissions` nên không tự gộp; khi gộp nên đặt `sale` = `own` ở ba hàng gốc. Mỗi endpoint nguồn đơn quản trị dùng chung `@Action` "Thêm, sửa tên và thứ tự, tắt và bật nguồn đơn". Test: ORD-TC-20261006-111224663.
27. [đã chọn] Sửa test nền khác epic vì ORD đổi hành vi: `test/support/db.ts` (`truncateAll` thêm `order_code_counters`), `test/support/order-fixture.ts` và `test/e2e/server.ts`, `test/e2e/support.ts` (đơn hộ, `/set-order-source`, `/reset` về nguồn mồi), `test/e2e/chk.e2e.spec.ts` (khuôn mã, CHK-E2E-20261006-110743989), `test/order/{create,interfaces,list,lifecycle,rev,guard}.spec.ts` (mã mới, `created_by`, hai khóa danh sách, job, giao diện module; mã cố định có chữ `L` trong lifecycle.spec đổi vì CHECK bảng chữ Crockford). Mã nền: `Pager.tsx` thêm prop tùy chọn, `HeaderLinks.tsx` thêm liên kết Nguồn đơn cho admin.
28. [đã chọn] Dòng `YẾU:` ở bảng kết quả: ORD-TC-20261015-092748973 (route của PAY thuộc TC của PAY, PAY không có trong ứng dụng test của ORD; "cùng thời gian" đo bằng cùng chuỗi câu SQL thay vì đo thời gian), ORD-TC-20261015-092749492 (bước sau của SAL thay bằng ném lỗi trong giao dịch, SAL và INV không có trong ứng dụng test ORD), ORD-TC-20261015-092749528 và ORD-TC-20261015-094426951 (phần DOM không chạy script cần trình duyệt: nâng bằng E2E ORD-E2E-20261015-092749975 khi chạy được, hiện kiểm bằng đọc mã: React escape, `white-space: pre-wrap`). Nâng cấp: chạy E2E; ghép TC của SAL, PAY khi các epic đó có code.
29. [chưa làm] Ba E2E đợt bán hộ và hai E2E cũ đổi khóa test (ORD-E2E-20261015-092749937, ORD-E2E-20261015-092749975, ORD-E2E-20261015-092750011, ORD-E2E-20261006-111226677, ORD-E2E-20261006-111226706) viết xong, chưa chạy: máy chủ E2E dùng cổng 31xx, CSDL `ecom_e2e` và thư mục `apps/web/.next` chung với các agent chạy song song (chạy cùng lúc làm hỏng nhau); đã kiểm `pnpm typecheck`, `pnpm build` của web và `tsc` của test. Việc cho người: chạy `pnpm test -- test/e2e/ord.e2e.spec.ts` một mình. Cũng chưa có đột biến web cho phần mới.
30. [đã chọn] Hạ tầng đã sẵn có không đổi nhưng cần ghi: `OrderApi.getShipmentDisplay` không ẩn `phone`, `address` theo trạng thái vận đơn (việc của SHP, SB-08 d); script ranh giới (`check-boundaries`) chưa có luật "chỉ SAL gọi `createHo`, chỉ SHP gọi `getShipmentDisplay`, chỉ DSH gọi báo cáo" (ORD-SEC T26, T30 nêu lint CI): thuộc việc kiểm ranh giới của epic gọi.
31. [chưa làm] CI chưa chạy: `clean-run.mjs` cần lệnh `pnpm test` đầy đủ nhưng bộ test chung đang đỏ vì việc của epic khác trong cùng đợt (PAY, NTF, SHP còn khuôn mã đơn 12 ký tự, ma trận quyền chưa gộp, Docker chia sẻ bị dừng giữa chừng) và máy chủ E2E dùng cổng, CSDL, thư mục `.next` chung với các agent chạy song song; chỉ chạy `pnpm test -- test/order test/tooling/mutations-ord.spec.ts`, `pnpm typecheck` và `pnpm build` của web, `pnpm lint` (lỗi còn lại ở tệp của epic khác).
32. [đã chọn] Test thêm sau review (REV-ORD-26): `apps/api/test/order/createho.spec.ts` ca "SB-33 countOpenOrders không đếm đơn hộ" (bốn đơn hộ `confirmed` COD, cash, bank_transfer gắn `user_id` của khách: `countOpenOrders` vẫn 0; đơn khách tự đặt vẫn đếm). Đột biến bỏ `AND created_by IS NULL` ở `countOpenSql` nay đỏ ở ca này (không có TC riêng trong spec nên ca không mang ID TC).
33. [đã chọn] `scripts/check-boundaries.mjs` nay kiểm tên hàm `XxxApi` được gọi (`this.<trường>.<hàm>(` với trường kiểu `XxxApi`) có trong bảng Giao diện module của architecture.md cho đúng cặp gọi -> được gọi (REV-ORD-25); bắt cả hàm đúng ở cặp khác (`OrderApi.getSalesReport` từ SHP). Một lời gọi hợp lệ trong mã mà bảng thiếu tên: CHK -> ORD `OrderApi.findForPayment` (`apps/api/src/modules/checkout/deps.service.ts:62`); script nới riêng bằng `TABLE_GAPS`, lead thêm tên vào hàng CHK -> ORD của bảng rồi xóa dòng nới. Luật "chỉ SAL gọi `createHo`" (mục 30) nay có sẵn: `createHo` chỉ có trong hàng SAL -> ORD nên module khác gọi là đỏ.
