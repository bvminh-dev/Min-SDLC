---
epic: ORD
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
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

## Kết quả test
Mọi TC và E2E của epic một dòng (102 TC, 10 E2E; một TC `ORD-TC-20261013-232524288` do dọn nợ kiểm toàn spec thêm cho `OrderApi.getProductSalesTotals`; một TC `ORD-TC-20261013-223014153` do sdlc-impact thêm cho `OrderApi.hasUndeliveredItems`; một TC `ORD-TC-20261013-211722071` do sdlc-impact thêm cho `district`; sáu TC `ORD-TC-20261007-18243...` do sdlc-impact thêm cho mã lỗi và hành vi đã có mã, gắn vào test có sẵn). TC API chạy trên PostgreSQL thật (`ecom_test`) với nhiều giao dịch thật chạy song song (pool 16): hủy đua với ShipmentShipped và đua với `lockForHandoff` trên 50 đơn mỗi loại, hai yêu cầu hủy giống hệt trên 20 đơn, và một ca tải hỗn hợp 40 đơn (`apps/api/test/order/review.spec.ts`, mang ID ORD-TC-20261006-111225678) kiểm bất biến chuỗi lịch sử, một event cho mỗi chuyển, một audit cho mỗi hủy. PAY, SHP, INV, CHK chưa có code nên event của họ do test giao qua cùng đường consumer như relay (ProcessedEvent cùng giao dịch). Một ID có thể xuất hiện ở nhiều file (ca bổ sung, ca E2E có thoát); cột Test code là file chính.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| ORD-E2E-20261006-111226528 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226558 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | YẾU: bước 7 chỉ kiểm liên kết dẫn tới /orders/{code}/payment rồi quay lại vì màn thanh toán của PAY chưa có code (trang 404 của Next) |
| ORD-E2E-20261006-111226588 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226617 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226646 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | YẾU: bước "sản phẩm bị lưu trữ và đổi giá sau đó" không dựng được ở E2E (không có PRD trong máy chủ E2E); snapshot bất biến kiểm ở ORD-TC-20261006-111225177 trên API |
| ORD-E2E-20261006-111226677 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
| ORD-E2E-20261006-111226706 | E2E | apps/api/test/e2e/ord.e2e.spec.ts | pass | E2E Chromium thật (API thật trên PostgreSQL thật, bản build production của web) |
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

## Kiểm đột biến
96 đột biến chọn theo từng điều kiện trong câu SQL, từng nhánh trạng thái và từng SB `Kiểm bằng: test` của ORD-SEC (16 SB), chạy bằng script chung `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-ord.json --cwd apps/api` (bảng JSON, mỗi đột biến chạy đúng một TC; cổng kiểm `apps/api/scripts/check-mutations.mjs` chạy trong `apps/api/test/tooling/mutations-ord.spec.ts`). Phủ cả mã nền sửa kèm (outbox, CSRF, ghi ProcessedEvent), migration (trigger chỉ-thêm, thu quyền, CHECK, unique một phần) và web (escape lý do hủy). Lượt chạy đầu: 97 đột biến, 94 bắt, 3 lọt (một đột biến không quan sát được và bỏ đi, hai lỗ hổng test thật: doanh thu theo `paid_at` chưa có ca tạo và thu khác ngày, thu quyền của vai trò ứng dụng chưa có ca phân biệt với trigger); sau khi sửa test và thay đột biến, mọi đột biến còn lại đều bắt. Không có đột biến tương đương.

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
| SB-24, T21: mã đơn ngắn hơn 12 ký tự | ORD-TC-20261006-120227769 | bắt |
| SB-06, T2: mã đơn tuần tự thay vì ngẫu nhiên mật mã học (dễ đoán) | ORD-TC-20261006-120227769 | bắt |
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
| SB-12, T12: web hiển thị lý do hủy như HTML (không escape) | ORD-TC-20261006-111720161 | bắt |
| district (sáu khóa): ORD không đòi khóa district (bỏ khỏi ADDRESS_KEYS) | ORD-TC-20261013-211722071 | bắt |
| district (sáu khóa): ORD không nhận district null (khách không có quận, huyện) | ORD-TC-20261013-211722071 | bắt |
| district (sáu khóa): ORD không kiểm nội dung district (khoảng trắng, số) | ORD-TC-20261013-211722071 | bắt |

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
