---
epic: PAY
status: draft
kit_version: 3
clean_run: pass
test_command: E2E_PORT_BASE=3300 NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: PAY

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền của module (cấu hình, mã lỗi, schema đầu vào, ký VNPay, cổng), rồi lõi chuyển trạng thái, rồi consumer event của ORD, bắt đầu và thử lại thanh toán, IPN và đối soát, thu COD, hoàn tiền, API đọc, rồi test API, giao diện web, E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. Phụ thuộc duy nhất sang epic khác là `OrderApi.findForPayment` của ORD (ADR-005); bên ngoài, VNPay chỉ được thử bằng bộ giả lập (xem các dòng YẾU và Lệch spec).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261008000200_payment_tables` và `payment.prisma` (4 bảng, 6 enum, CHECK, unique `order_id`, unique `attempt_id` của hoàn tiền, unique một phần `provider_txn_no`, trigger vòng đời Payment và Refund, trigger chỉ-thêm của `payment_webhook_logs`, thu quyền UPDATE, TRUNCATE) | PAY-DB-20261006-103701241 | - | done |
| 2 | Nền của module: 17 mã lỗi (`registerProblem`), biến cấu hình `VNPAY_*` và `PAY_*` (khóa ký là bí mật, bắt buộc ngoài dev), schema đầu vào đóng, bảng bậc SB-14, khóa idempotency, ký và kiểm chữ ký HMAC-SHA512 của VNPay, giao diện cổng `VnpayGateway` (HTTP thật và giả lập) | PAY-API-20261006-103701335, PAY-SEC-20261006-103701420, PAY-TC-20261007-085337388, PAY-TC-20261007-085337421, PAY-TC-20261007-085337456 | 1 | done |
| 3 | Lõi chuyển trạng thái `PaymentCore` (khóa dòng, `TRANSITIONS` là nguồn duy nhất, lịch sử, audit, outbox cùng giao dịch) và `OutcomeService` (thành công, thất bại, trùng giao dịch cổng) | PAY-DB-20261006-103701241, PAY-API-20261006-103701335 | 1, 2 | done |
| 4 | Consumer `payment` của OrderCreated, OrderExpired, OrderCancelled, OrderDelivered, OrderReturned, StockCommitFailed (idempotent theo `event_id` và theo đơn; hoàn tiền toàn phần khi hủy đơn đã thu) | PAY-TC-20261006-104538540, PAY-TC-20261006-104538572, PAY-TC-20261006-104538604, PAY-TC-20261006-104539947, PAY-TC-20261006-104540014, PAY-TC-20261006-113000100, PAY-TC-20261006-113000400 | 3 | done |
| 5 | Bắt đầu và thử lại thanh toán: `initiate`, `retry` (đường dẫn ký, hạn không vượt `expires_at`, tối đa 3 lượt, khóa idempotency, giới hạn tần suất) | PAY-TC-20261006-104538705, PAY-TC-20261006-104538837, PAY-TC-20261006-104539749, PAY-TC-20261006-104539882, PAY-TC-20261006-113000300 | 3 | done |
| 6 | IPN (`/webhooks/vnpay/ipn`, công khai, kiểm chữ ký, số tiền, trùng, danh sách IP, bản ghi webhook chỉ-thêm) và job đối soát lượt thử quá hạn, job xóa nhật ký webhook quá 12 tháng | PAY-TC-20261006-104539001, PAY-TC-20261006-104539065, PAY-TC-20261006-104539164, PAY-TC-20261006-104539621, PAY-TC-20261006-104539718, PAY-TC-20261006-113000600 | 3, 5 | done |
| 7 | Thu COD: tự động khi OrderDelivered và đường dự phòng `cod-collect` của staff, admin | PAY-TC-20261006-104539358, PAY-TC-20261006-104539489, PAY-TC-20261006-113000100 | 3, 4 | done |
| 8 | Hoàn tiền: tự động (3 lần, hẹn thử lại 5 phút), thủ công của admin, thử lại, job quét hoàn tiền treo, trùng thanh toán hoàn đúng giao dịch thứ hai | PAY-TC-20261006-104540177, PAY-TC-20261006-104540245, PAY-TC-20261006-104540374, PAY-TC-20261006-104540407, PAY-TC-20261006-104540440, PAY-TC-20261006-113000500 | 3, 4, 6 | done |
| 9 | API đọc (customer: danh sách, chi tiết; staff, admin: danh sách, chi tiết, hàng đợi hoàn tiền) và giao diện nội bộ `PaymentApi` (`getRevenue`, `countFailedRefunds`) | PAY-TC-20261006-104540695, PAY-TC-20261006-104540728, PAY-TC-20261006-104540928, PAY-TC-20261006-104540996 | 3 | done |
| 10 | Test API trên PostgreSQL thật (17 bộ ở `apps/api/test/payment`, đua song song thật, tiến trình bị SIGKILL, cổng giả lập HTTP cục bộ) và test lược đồ, cấu hình, ma trận quyền | PAY-SEC-20261006-103701420, PAY-TC-20261006-113000250 | 4, 5, 6, 7, 8, 9 | done |
| 11 | Giao diện web của customer: trang thanh toán của đơn và lịch sử thanh toán | ui/order-payment, ui/payment-history | 5, 9 | done |
| 12 | Giao diện web của staff, admin: danh sách và chi tiết thanh toán, hàng đợi hoàn tiền (hoàn tiền, thử lại, thu COD, 429, 409) | ui/admin-payment-list, ui/admin-payment-detail, ui/admin-refund-queue | 7, 8, 9 | done |
| 13 | E2E trình duyệt thật với trang VNPay giả lập, điểm điều khiển và dữ liệu mồi (`/seed-payment`, `/seed-refund`, `/payment`, `/gateway`, `/relay`) | PAY-E2E-20261006-104612099, PAY-E2E-20261006-104612157, PAY-E2E-20261006-104612213, PAY-E2E-20261006-104612262, PAY-E2E-20261006-104612345, PAY-E2E-20261006-104612407, PAY-E2E-20261006-104612463, PAY-E2E-20261006-104612529, PAY-E2E-20261006-104612596 | 11, 12 | done |
| 14 | Bảng đột biến PAY và cổng kiểm của nó (`scripts/mutations-pay.json`, `test/tooling/mutations-pay.spec.ts`) | PAY-SEC-20261006-103701420 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (97 TC, 9 E2E). Ngoài các ID này còn các test mang ID tài liệu PAY-DB và PAY-SEC (lược đồ, giao diện đọc cho DSH, bảng đột biến) và các ca bẫy bổ sung mang ID TC gần nhất ở `test/payment/review.spec.ts`.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| PAY-E2E-20261006-104612099 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | YẾU: trình duyệt thật nhưng trang VNPay là trang giả (`/vnpay/pay`) của máy chủ E2E, IPN do trang giả ký bằng `sign` của mã; chưa thử với sandbox thật |
| PAY-E2E-20261006-104612157 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | YẾU: trang VNPay giả; chưa thử với sandbox thật |
| PAY-E2E-20261006-104612213 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | YẾU: trang VNPay giả; chưa thử với sandbox thật |
| PAY-E2E-20261006-104612262 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | YẾU: hoàn tiền qua cổng giả (`E2eGateway`); chưa thử với sandbox thật |
| PAY-E2E-20261006-104612345 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | - |
| PAY-E2E-20261006-104612407 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | - |
| PAY-E2E-20261006-104612463 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | YẾU: hoàn tiền qua cổng giả (`E2eGateway`); chưa thử với sandbox thật |
| PAY-E2E-20261006-104612529 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | YẾU: hoàn tiền lại qua cổng giả (`E2eGateway`); chưa thử với sandbox thật |
| PAY-E2E-20261006-104612596 | E2E | apps/api/test/e2e/pay.e2e.spec.ts | pass | - |
| PAY-TC-20261006-104538540 | TC | apps/api/test/payment/create.spec.ts | pass | - |
| PAY-TC-20261006-104538572 | TC | apps/api/test/payment/create.spec.ts | pass | - |
| PAY-TC-20261006-104538604 | TC | apps/api/test/payment/create.spec.ts | pass | - |
| PAY-TC-20261006-104538638 | TC | apps/api/test/payment/create.spec.ts | pass | - |
| PAY-TC-20261006-104538671 | TC | apps/api/test/payment/create.spec.ts | pass | - |
| PAY-TC-20261006-104538705 | TC | apps/api/test/payment/start.spec.ts | pass | YẾU: đường dẫn VNPay do `vnpay.ts` ký và test kiểm lại bằng chính hàm ký đó (cùng một cách hiểu tài liệu VNPay v2.1.0); chưa thử với sandbox thật |
| PAY-TC-20261006-104538738 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538772 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538804 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538837 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538871 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538903 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538935 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104538969 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-104539001 | TC | apps/api/test/payment/ipn.spec.ts | pass | YẾU: IPN do test tự ký bằng `sign` của mã; chưa thử với IPN thật của sandbox VNPay |
| PAY-TC-20261006-104539033 | TC | apps/api/test/payment/ipn.spec.ts | pass | YẾU: IPN thất bại (mã 24) do test tự ký; chưa thử với sandbox thật |
| PAY-TC-20261006-104539065 | TC | apps/api/test/payment/ipn.spec.ts | pass | YẾU: chữ ký đúng và sai đều dựng bằng `sign` của mã; chưa đối chiếu với vectơ ký do VNPay phát hành |
| PAY-TC-20261006-104539098 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539131 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539164 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539196 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539228 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539262 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539294 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-104539326 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539358 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539390 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539422 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539456 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539489 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539522 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-104539555 | TC | apps/api/test/payment/failure.spec.ts | pass | - |
| PAY-TC-20261006-104539587 | TC | apps/api/test/payment/failure.spec.ts | pass | - |
| PAY-TC-20261006-104539621 | TC | apps/api/test/payment/failure.spec.ts | pass | YẾU: API truy vấn `querydr` là máy chủ HTTP giả lập dựng theo tài liệu; chưa thử với sandbox thật |
| PAY-TC-20261006-104539653 | TC | apps/api/test/payment/failure.spec.ts | pass | YẾU: lỗi 500 của API truy vấn do máy chủ giả lập tạo; chưa thử với sandbox thật |
| PAY-TC-20261006-104539686 | TC | apps/api/test/payment/failure.spec.ts | pass | - |
| PAY-TC-20261006-104539718 | TC | apps/api/test/payment/failure.spec.ts | pass | YẾU: kết quả `querydr` thành công do máy chủ giả lập trả; chưa thử với sandbox thật |
| PAY-TC-20261006-104539749 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261006-104539782 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261006-104539817 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261006-104539848 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261006-104539882 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261006-104539914 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261006-104539947 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104539981 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104540014 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104540047 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104540079 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104540111 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104540144 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-104540177 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | YẾU: lệnh hoàn tiền (`refund`) gửi tới máy chủ giả lập dựng theo tài liệu; chưa thử với sandbox thật |
| PAY-TC-20261006-104540210 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-104540245 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | YẾU: cổng từ chối hoàn tiền là phản hồi của máy chủ giả lập; chưa thử với sandbox thật |
| PAY-TC-20261006-104540277 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-104540309 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-104540342 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-104540374 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-104540407 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540440 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540482 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540530 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540563 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540596 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540630 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540662 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-104540695 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540728 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540761 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540794 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540827 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540860 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540893 | TC | apps/api/test/payment/read.spec.ts | pass | - |
| PAY-TC-20261006-104540928 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104540963 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104540996 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104541031 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104541064 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104541095 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104541127 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-104541159 | TC | apps/api/test/payment/admin-read.spec.ts | pass | - |
| PAY-TC-20261006-113000100 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-113000200 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-113000250 | TC | apps/api/test/payment/success.spec.ts | pass | - |
| PAY-TC-20261006-113000300 | TC | apps/api/test/payment/start.spec.ts | pass | - |
| PAY-TC-20261006-113000400 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-113000500 | TC | apps/api/test/payment/refund-manual.spec.ts | pass | - |
| PAY-TC-20261006-113000600 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |
| PAY-TC-20261006-130000100 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-130000200 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-130000300 | TC | apps/api/test/payment/close.spec.ts | pass | - |
| PAY-TC-20261006-130000400 | TC | apps/api/test/payment/failure.spec.ts | pass | - |
| PAY-TC-20261006-130000500 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-150000100 | TC | apps/api/test/payment/refund-auto.spec.ts | pass | - |
| PAY-TC-20261006-150000200 | TC | apps/api/test/payment/retry.spec.ts | pass | - |
| PAY-TC-20261007-085337388 | TC | apps/api/test/payment/guard.spec.ts | pass | - |
| PAY-TC-20261007-085337421 | TC | apps/api/test/payment/secrets.spec.ts | pass | - |
| PAY-TC-20261007-085337456 | TC | apps/api/test/payment/secrets.spec.ts | pass | - |
| PAY-TC-20261013-193715406 | TC | apps/api/test/payment/failure.spec.ts | pass | YẾU: truy vấn `querydr` do cổng giả lập trả; chưa thử với sandbox thật |
| PAY-TC-20261013-193715507 | TC | apps/api/test/payment/failure.spec.ts | pass | YẾU: truy vấn `querydr` do cổng giả lập trả; chưa thử với sandbox thật |
| PAY-TC-20261013-193715606 | TC | apps/api/test/payment/reconcile-closed.spec.ts | pass | - |
| PAY-TC-20261013-193715697 | TC | apps/api/test/payment/reconcile-closed.spec.ts | pass | - |
| PAY-TC-20261013-193715799 | TC | apps/api/test/payment/refund-stuck.spec.ts | pass | YẾU: mã 94 và việc gọi lặp cùng mã yêu cầu do cổng giả lập; chưa thử với sandbox thật |
| PAY-TC-20261013-193715898 | TC | apps/api/test/payment/db-grants.spec.ts | pass | - |
| PAY-TC-20261013-193922887 | TC | apps/api/test/payment/db-grants.spec.ts | pass | - |
| PAY-TC-20261013-194320040 | TC | apps/api/test/payment/db-grants.spec.ts | pass | - |
| PAY-TC-20261013-194320138 | TC | apps/api/test/payment/ipn.spec.ts | pass | - |

## Kiểm đột biến
Đợt sdlc-impact 2026-10-13 (REV-PAY-01, 04, 10, 13) đưa bảng lên 316 đột biến: bỏ 3 đột biến bám mã đã đổi (lọc trạng thái Payment của câu chọn đối soát, cảnh báo Refund kẹt theo `created_at`, bỏ Payment `succeeded`) và thêm 26 đột biến cho cả hai hướng của đối soát Payment đã đóng (thành công thì Refund, thất bại thì chỉ ghi lượt), giới hạn lô, hạn 7 ngày và đóng lượt khi không chắc, kết thúc có hạn của Refund kẹt, `requested_at`, thu `DELETE`, `clock_timestamp()`, IP ngoài danh sách, job dọn; chạy lại các dòng mới bằng `mutate.mjs` trên bản sao ở `/tmp`: đều bắt (hai đột biến đầu lọt vì tương đương với lớp bảo vệ trong, đã gỡ lớp trong thừa hoặc dời kiểm hạn vào hàm đã khóa dòng rồi chạy lại: bắt; một đột biến bắt ở bộ rộng nhưng không ở TC hẹp nên bỏ khỏi bảng). Trước đó, sau review 2026-10-08 bảng có 293 đột biến (thêm 8 cho REV-PAY-02 đến 06 và 15, cùng sửa hai `find` của đột biến cũ bám dòng đã đổi); reviewer chạy riêng 38 đột biến chọn lại (34 bắt, 2 tương đương có lý do, 2 lọt là lỗ hổng test đã vá và bắt lại): xem `spec/epics/PAY/review.md`. Số liệu dưới đây là của lượt implement: 285 đột biến: 279 bắt, 6 lọt do tương đương (có lý do), 0 chưa xử lý. Bảng ở `apps/api/scripts/mutations-pay.json` (sinh một lần bằng công cụ ngoài repo, mỗi đột biến có đúng một chỗ `find`), chạy bằng `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-pay.json --cwd apps/api`; `test/tooling/mutations-pay.spec.ts` kiểm bảng bằng `check-mutations.mjs` (18 SB kiểm bằng test của PAY-SEC đều có đột biến). Lượt chạy đầu bắt 236, lọt 41 và 9 "hỏng biên dịch"; các đột biến này đã sửa bằng test thêm (khẳng định mảng `vnp_` ngoài phần ký, `version` tăng 1, rollback khi ghi event lỗi, `PaymentCore.move` từ trạng thái ngoài bảng, thu COD cho Payment đã đóng, Payment processing có lượt thử đã chốt, retry chung bộ đếm bậc E, StockCommitFailed cho Payment chưa thu, mã đơn có chữ S với `ſ`, IP giả ở X-Forwarded-For, bảng TRANSITIONS khớp trigger, kiểu hành động của khóa ngoại, nhật ký webhook chỉ-thêm) hoặc sửa cách gài (gài cả hai lớp bảo vệ trùng chức năng; `afterAll` nhả cổng giả để một khẳng định đỏ không làm kẹt bộ test và bị phân loại nhầm là "hỏng biên dịch"; đột biến số tiền không ném `SyntaxError`). 236 đột biến còn lại giữ kết quả lượt đầu (chỉ test được thêm, không bớt); 49 đột biến mới hoặc sửa đã chạy lại bằng `mutate.mjs`, đều bắt hoặc tương đương có lý do. Test đỏ ghi ID TC gần nhất của test mang ID đó; đột biến lược đồ (CHECK, unique, khóa ngoại, trigger, thu quyền) bị bắt bởi test lược đồ `apps/api/test/payment/db.spec.ts` (mang thêm ID TC liên quan ở cuối tên) hoặc `PAY-TC-20261006-113000600` cho nhật ký webhook.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-22 T1: bỏ lớp danh sách IP của cổng | PAY-TC-20261006-104539098 | bắt |
| SB-22 T1: danh sách IP đảo điều kiện (cho IP lạ qua) | PAY-TC-20261006-104539098 | bắt |
| SB-22 T1: tham số vnp_ dạng mảng không bị coi là sai chữ ký | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: bỏ kiểm chữ ký IPN | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: chữ ký sai nhưng ghi nhật ký là hợp lệ | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: sai chữ ký trả RspCode 00 | PAY-TC-20261006-104539065 | bắt |
| SB-22: không có lượt thử theo vnp_TxnRef thì không trả 01 | PAY-TC-20261006-104539098 | bắt |
| SB-22: tra lượt thử bằng mã tham chiếu bất kỳ (bỏ khuôn txn_ref khi ghi) | PAY-TC-20261006-104539098 | bắt |
| SB-23 T2: bỏ so số tiền IPN với Payment | PAY-TC-20261006-104539131 | bắt |
| SB-23 T2: số tiền IPN lấy từ gói tin thay vì Payment (so lỏng) | PAY-TC-20261006-104539131 | bắt |
| SB-22 T3: bỏ chặn phát lại thành công (lượt đã cuối vẫn xử lý) | PAY-TC-20261006-104539164 | bắt |
| SB-22 T3: IPN thất bại cũ gửi lại không bị chặn | PAY-TC-20261006-104539164 | bắt |
| SB-22 T3: trùng giao dịch cổng không trả 02 | PAY-TC-20261006-104539164 | bắt |
| SB-22 T3: nuốt lỗi trùng giao dịch cổng thay vì rollback và trả 02 | PAY-TC-20261006-104539164 | bắt |
| SB-22 T3: bỏ khóa dòng Payment ở IPN (đọc không khóa) | - | lọt: tương đương, lớp bảo vệ thứ hai: sau khi bỏ `FOR UPDATE`, câu UPDATE chuyển trạng thái vẫn chờ khóa dòng của giao dịch khác và có điều kiện `WHERE status = :cũ`, lượt thử chuyển trạng thái có điều kiện và `provider_txn_no` unique, nên hai IPN đồng thời vẫn cho đúng một 00 và một 02 (test chặn bằng khóa ngoài xác nhận cả hai); khóa chỉ làm đoạn đọc rồi quyết định tuần tự |
| SB-22: thành công không có mã giao dịch vẫn nhận | - | lọt: tương đương, lớp bảo vệ thứ hai: cột provider_txn_no có CHECK (succeeded phải có mã giao dịch) nên giao dịch vẫn rollback và trả 99; hành vi quan sát được không đổi |
| SB-22 T14: bỏ nhận biết đơn không còn pending (luôn coi là pending) | PAY-TC-20261006-104539228 | bắt |
| SB-18: mất mặt nạ nhật ký (ghi mọi tham số) | PAY-TC-20261006-104539001 | bắt |
| SB-18: nhật ký mang cả chữ ký | PAY-TC-20261006-104539001 | bắt |
| SB-18: bỏ giới hạn 64 ký tự của trường nhật ký | PAY-TC-20261006-104539001 | bắt |
| SB-18: log bảo mật in tham số vnp_Amount | PAY-TC-20261006-104539065 | bắt |
| SB-18: log IPN lỗi bất ngờ in chữ ký | PAY-TC-20261006-104539001 | bắt |
| SB-20: IPN lỗi bất ngờ lộ thông điệp lỗi | PAY-TC-20261006-104539001 | bắt |
| SB-22: lượt thất bại ánh xạ mã sai | PAY-TC-20261006-130000400 | bắt |
| SB-18: mã gốc của cổng không lưu ở lượt thất bại | PAY-TC-20261006-130000400 | bắt |
| SB-22: thành công với TransactionStatus khác 00 vẫn là thành công | PAY-TC-20261006-130000400 | bắt |
| SB-27: IPN không gọi hoàn tiền sau commit | PAY-TC-20261006-104539228 | bắt |
| SB-24 T14: thành công muộn của lượt timeout không được nhận | PAY-TC-20261006-104539522 | bắt |
| SB-24: Payment closed vẫn nhận thành công (bỏ kiểm đơn pending) | PAY-TC-20261006-104539228 | bắt |
| SB-24: hoàn trùng và muộn đảo nhãn | PAY-TC-20261006-104539262 | bắt |
| SB-24: trùng thanh toán không tính Payment refunded | PAY-TC-20261006-104539262 | bắt |
| SB-24 T19: is_final không dùng PAY_MAX_ATTEMPTS | PAY-TC-20261006-104539587 | bắt |
| SB-24: lượt cũ thất bại cũng làm Payment failed | PAY-TC-20261006-104539555 | bắt |
| SB-24: lượt thành công không chốt provider_txn_no | PAY-TC-20261006-104539001 | bắt |
| SB-24: Payment succeeded không ghi paid_at | PAY-TC-20261006-104539001 | bắt |
| SB-24: Refund muộn tạo bởi người dùng (không system) | PAY-TC-20261006-104539228 | bắt |
| SB-06 T6: bỏ điều kiện chủ sở hữu ở bước đọc đầu | PAY-TC-20261006-104538772 | bắt |
| SB-24: initiate cho COD | PAY-TC-20261006-104538804 | bắt |
| SB-23 T2: bỏ chặn số tiền dưới 5000 | PAY-TC-20261006-104538804 | bắt |
| SB-23 T2: bỏ chặn số tiền trên 999999999 | PAY-TC-20261006-104538671 | bắt |
| SB-24: retry nhận lượt 1 đang processing | PAY-TC-20261006-104539782 | bắt |
| SB-24: bấm lặp hết hạn vẫn trả đường dẫn cũ | PAY-TC-20261006-104538837 | bắt |
| SB-24: bấm lặp không kiểm trạng thái lượt thử | PAY-TC-20261006-104538837 | bắt |
| SB-24: initiate cho đơn đã đóng | PAY-TC-20261006-104538804 | bắt |
| SB-24: initiate đúng hạn (bỏ biên expires_at) | PAY-TC-20261006-104538871 | bắt |
| SB-24: retry cho Payment không failed | PAY-TC-20261006-104539782 | bắt |
| SB-24: retry cho đơn không pending | PAY-TC-20261006-104539782 | bắt |
| SB-24: retry hết hạn Payment vẫn nhận | PAY-TC-20261006-104539914 | bắt |
| SB-23 T2: hạn đường dẫn bỏ chặn bởi expires_at của Payment | PAY-TC-20261006-104538871 | bắt |
| SB-23: hạn đường dẫn sai TTL | PAY-TC-20261006-104538705 | bắt |
| SB-24: mã tham chiếu thiếu số lượt hai chữ số | PAY-TC-20261006-104538705 | bắt |
| SB-40: băm yêu cầu bỏ id Payment | PAY-TC-20261006-113000300 | bắt |
| SB-06: chi tiết lượt thử kèm Payment người khác (bỏ chủ ở lockById) | - | lọt: tương đương, đổi không làm thay đổi hành vi (hai câu if tương đương) |
| SB-07 T7: thu COD cho Payment online | PAY-TC-20261006-104539390 | bắt |
| SB-24 T4: thu COD lần hai không chặn | PAY-TC-20261006-104539456 | bắt |
| SB-24: thu COD khi đơn chưa giao | PAY-TC-20261006-104539422 | bắt |
| SB-24: thu COD khi Payment không pending | PAY-TC-20261006-104539456 | bắt |
| SB-23: thu COD không so số tiền | PAY-TC-20261006-104539422 | bắt |
| SB-19 T10: audit thu COD ghi system thay vì người ghi | PAY-TC-20261006-104539358 | bắt |
| SB-19 T10: audit thu COD mất ghi chú | PAY-TC-20261006-104539358 | bắt |
| SB-24 T4: thu COD chuyển bằng sai tên (bỏ thu thành event) | PAY-TC-20261006-104539358 | bắt |
| SB-24 T8: bỏ ON CONFLICT attempt_id khi tạo Refund | PAY-TC-20261006-104540014 | bắt |
| SB-24: hoàn tự động không có auto_attempt_no | PAY-TC-20261006-104540014 | bắt |
| SB-24 T10: audit hoàn tự động ghi như thủ công | PAY-TC-20261006-104540177 | bắt |
| SB-24 T7: hoàn thủ công cho COD | PAY-TC-20261006-104540530 | bắt |
| SB-24 T8: hoàn thủ công khi Payment không succeeded | PAY-TC-20261006-104540530 | bắt |
| SB-24 T8: hoàn thủ công bỏ kiểm Refund có sẵn | PAY-TC-20261006-104540530 | bắt |
| SB-24 T8: hoàn thủ công đảo mã refund-use-retry | PAY-TC-20261006-104540530 | bắt |
| SB-20 T11: 409 hoàn tiền lộ chi tiết | PAY-TC-20261006-104540530 | bắt |
| SB-18 T17: log lý do hoàn tiền | PAY-TC-20261006-104540662 | bắt |
| SB-24 T8: thử lại hoàn tiền khi đang requested | PAY-TC-20261006-104540440 | bắt |
| SB-24: thử lại hoàn tiền khi Payment không còn succeeded | PAY-TC-20261006-104540440 | bắt |
| SB-24: thử lại hoàn tiền không đổi mã yêu cầu | PAY-TC-20261006-104540440 | bắt |
| SB-19 T10: thử lại hoàn tiền không audit người thử lại | PAY-TC-20261006-104540440 | bắt |
| SB-24: Payment refunded cả khi hoàn giao dịch trùng | PAY-TC-20261006-104540374 | bắt |
| SB-27: không phát RefundSucceeded | PAY-TC-20261006-104540177 | bắt |
| SB-27: không phát RefundFailed | PAY-TC-20261006-104540245 | bắt |
| SB-20: lý do thất bại là mã của cổng | PAY-TC-20261006-104540245 | bắt |
| SB-24 T8: tự thử lại vượt số lần | PAY-TC-20261006-104540277 | bắt |
| SB-34: lịch tự thử lại sai khoảng | PAY-TC-20261006-104540277 | bắt |
| SB-34: job tự thử lại không bỏ hẹn khi Payment không còn succeeded | PAY-TC-20261006-104540277 | bắt |
| SB-31: gọi cổng trong giao dịch giữ khóa (settle trước khi cổng trả lời) | PAY-TC-20261006-104540309 | bắt |
| SB-24: dispatch coi lỗi lạ của cổng là từ chối | PAY-TC-20261006-104540309 | bắt |
| SB-24: settle không kiểm Refund còn requested | - | lọt: tương đương, lớp bảo vệ thứ hai: cả hai nhánh UPDATE ngay sau đó có `AND status = requested` và thoát khi không cập nhật được dòng nào, nên Refund đã chốt không bị ghi đè dù bỏ kiểm này; hành vi quan sát được không đổi |
| SB-34: job đối soát hoàn tiền không giới hạn lô | PAY-TC-20261006-104539686 | bắt |
| SB-24: StockCommitFailed chuyển nhầm (hoàn khi Payment không succeeded) | PAY-TC-20261006-113000400 | bắt |
| SB-23: đơn 0 đồng vẫn tạo Payment | PAY-TC-20261006-104538671 | bắt |
| SB-24: tạo Payment cho đơn đã đóng | PAY-TC-20261006-104538671 | bắt |
| SB-27 T3: bỏ ON CONFLICT (order_id) khi tạo Payment | PAY-TC-20261006-104538604 | bắt |
| SB-27 T15: handler OrderCreated nuốt lỗi ORD (không ném) | PAY-TC-20261006-104538638 | bắt |
| SB-24: hoàn theo was_paid (bỏ nhánh cảnh báo) | PAY-TC-20261006-104540079 | bắt |
| SB-24: lý do hoàn đảo order_cancelled và order_expired | PAY-TC-20261006-104540014 | bắt |
| SB-24 T14: OrderCancelled stock_commit_failed tạo Refund lần hai | PAY-TC-20261006-130000300 | bắt |
| SB-24: OrderExpired không phát PaymentExpired | PAY-TC-20261006-104539947 | bắt |
| SB-24: expire không nhận failed | PAY-TC-20261006-104540144 | bắt |
| SB-24: cancel không nhận processing | PAY-TC-20261006-104540111 | bắt |
| SB-24: cancel không nhận failed | PAY-TC-20261006-150000200 | bắt |
| SB-24: succeed không nhận failed | PAY-TC-20261006-104539522 | bắt |
| SB-24: fail nhận cả failed | PAY-TC-20261006-104539228 | bắt |
| SB-24: refund nhận cả expired | PAY-TC-20261006-104539228 | bắt |
| SB-24: OrderDelivered thu cả online pending | PAY-TC-20261006-113000200 | bắt |
| SB-24: OrderDelivered không dùng delivered_at | PAY-TC-20261006-113000100 | bắt |
| SB-19 T10: thu COD tự động không audit | PAY-TC-20261006-113000100 | bắt |
| SB-24: OrderReturned đóng cả online pending | PAY-TC-20261006-130000100 | bắt |
| SB-24: OrderReturned tự hoàn Payment online đã thu | PAY-TC-20261006-130000200 | bắt |
| SB-24: StockCommitFailed bỏ mã reservation_missing | PAY-TC-20261006-150000100 | bắt |
| SB-24: COD succeeded vẫn hoàn tự động | PAY-TC-20261006-104540342 | bắt |
| SB-24: handler không bỏ qua event cho Payment không có (ném thay vì cảnh báo) | PAY-TC-20261006-104540047 | bắt |
| SB-18 T17: log chép chuỗi lạ của payload | PAY-TC-20261006-104538604 | bắt |
| SB-22 T20: đối soát hỏi lượt chưa quá 2 phút | PAY-TC-20261006-104539686 | bắt |
| SB-22 T20: đối soát không thuê dòng (hỏi cổng nhiều lần) | PAY-TC-20261006-104539653 | bắt |
| SB-22 T20: đối soát nhận số tiền lệch | PAY-TC-20261006-104539718 | bắt |
| SB-22 T20: đối soát timeout ghi lý do khác | PAY-TC-20261006-104539621 | bắt |
| SB-34: đối soát xử lý lỗi cổng thành thất bại | PAY-TC-20261006-104539653 | bắt |
| SB-32 T22: job dọn nhật ký webhook dọn cả dòng mới | PAY-TC-20261006-113000600 | bắt |
| SB-34: job dọn nhật ký dừng sau một lô | PAY-TC-20261006-104539001 | bắt |
| SB-24: chuyển trạng thái tăng version sai | PAY-TC-20261006-104539001 | bắt |
| SB-27: chuyển trạng thái không phát event | PAY-TC-20261006-104539326 | bắt |
| SB-27: event ghi ngoài giao dịch (publish lỗi bị nuốt) | PAY-TC-20261006-104539326 | bắt |
| SB-24: PaymentSucceeded thiếu số tiền | PAY-TC-20261006-104539326 | bắt |
| SB-24: chuyển trạng thái bỏ kiểm cột Từ | PAY-TC-20261006-104539164 | bắt |
| SB-06 T6: danh sách customer bỏ điều kiện user_id | PAY-TC-20261006-104540695 | bắt |
| SB-06 T6: chi tiết customer bỏ điều kiện chủ | PAY-TC-20261006-104540794 | bắt |
| SB-06: chi tiết customer đọc với userId rỗng (quản trị) | PAY-TC-20261006-104540794 | bắt |
| SB-24: phân trang bỏ OFFSET | PAY-TC-20261006-104540695 | bắt |
| SB-24: sắp xếp danh sách tăng dần | PAY-TC-20261006-104540695 | bắt |
| SB-11: mã đơn đổi hoa bằng toUpperCase (ſ khớp nhầm) | PAY-TC-20261006-104541095 | bắt |
| SB-24: can_retry bỏ giới hạn lượt | PAY-TC-20261006-104540728 | bắt |
| SB-24: can_retry bỏ kiểm đơn pending | PAY-TC-20261006-104540728 | bắt |
| SB-24: can_retry bỏ kiểm hạn | PAY-TC-20261006-104540728 | bắt |
| SB-24: can_initiate cho Payment không pending | PAY-TC-20261006-104540728 | bắt |
| SB-20 T11: customer thấy user_id | PAY-TC-20261006-104540728 | bắt |
| SB-20 T11: customer thấy mã tham chiếu lượt thử | PAY-TC-20261006-104540728 | bắt |
| SB-20 T11: customer thấy lý do và mã gốc của hoàn tiền | PAY-TC-20261006-104540893 | bắt |
| SB-08 T11: chi tiết quản trị kèm email (dữ liệu cá nhân) | PAY-TC-20261006-104540996 | bắt |
| SB-18: chi tiết quản trị kèm chữ ký (payload webhook) | PAY-TC-20261006-104540996 | bắt |
| SB-24: hàng đợi hoàn tiền không đưa failed lên đầu | PAY-TC-20261006-104540928 | bắt |
| SB-34: chi tiết quản trị không giới hạn dòng nhật ký | PAY-TC-20261006-104539001 | bắt |
| SB-24: nhật ký webhook chi tiết xếp ngược | PAY-TC-20261006-104540996 | bắt |
| SB-05 T7: staff được bắt đầu thanh toán | PAY-TC-20261006-104538738 | bắt |
| SB-05 T7: admin được thử lại thanh toán | PAY-TC-20261006-104539817 | bắt |
| SB-05 T7: customer được ghi nhận thu COD | PAY-TC-20261006-104539390 | bắt |
| SB-05 T7: staff được hoàn tiền thủ công | PAY-TC-20261006-104540482 | bắt |
| SB-05 T7: staff được thử lại hoàn tiền | PAY-TC-20261006-104540482 | bắt |
| SB-05: staff xem danh sách thanh toán của customer | PAY-TC-20261006-104540761 | bắt |
| SB-05: admin xem chi tiết thanh toán của customer | PAY-TC-20261006-104540761 | bắt |
| SB-05: customer xem danh sách quản trị | PAY-TC-20261006-104541031 | bắt |
| SB-05: customer xem chi tiết quản trị | PAY-TC-20261006-104541031 | bắt |
| SB-05: customer xem hàng đợi hoàn tiền | PAY-TC-20261006-104541031 | bắt |
| SB-05 T1: IPN không khai @Public (guard từ chối cổng) | PAY-TC-20261006-104538738 | bắt |
| SB-14 T13: bỏ giới hạn bắt đầu thanh toán | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: bỏ giới hạn thử lại (retry) | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: bỏ giới hạn hoàn tiền | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: bỏ giới hạn đọc của customer | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: bỏ giới hạn IPN | PAY-TC-20261006-104539294 | bắt |
| SB-14 T13: bỏ giới hạn quản trị | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: bỏ giới hạn ghi nhận thu COD | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: ngưỡng bắt đầu thanh toán 11 | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: ngưỡng hoàn tiền 21 | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: ngưỡng IPN 301 | PAY-TC-20261006-104539294 | bắt |
| SB-14 T13: ngưỡng đọc 61 | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: ngưỡng quản trị 31 | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13: ngưỡng thu COD 31 | PAY-TC-20261006-104538969 | bắt |
| SB-14 T13/T21: khóa đếm IPN theo phiên thay vì IP | PAY-TC-20261006-104539294 | bắt |
| SB-14 T21: IPN không tin TRUST_PROXY_HOPS (IP từ X-Forwarded-For đầu) | PAY-TC-20261006-104539294 | bắt |
| SB-40: bỏ kiểm định dạng Idempotency-Key | PAY-TC-20261006-113000300 | bắt |
| SB-40: Idempotency-Key tối thiểu 1 ký tự | PAY-TC-20261006-113000300 | bắt |
| SB-40: Idempotency-Key nhận khóa dài hơn 64 ký tự | PAY-TC-20261006-113000500 | bắt |
| SB-40: hoàn tiền không dùng Idempotency-Key (băm bỏ lý do) | PAY-TC-20261006-113000500 | bắt |
| SB-40: thử lại hoàn tiền băm bỏ id | PAY-TC-20261006-113000500 | bắt |
| SB-11: bỏ chặn trường lạ (amount, user_id) | PAY-TC-20261006-104540563 | bắt |
| SB-11: bỏ chặn __proto__ | PAY-TC-20261006-104540563 | bắt |
| SB-11: collected_amount nhận số thực | PAY-TC-20261006-104539422 | bắt |
| SB-11: collected_amount nhận 0 | PAY-TC-20261006-104539422 | bắt |
| SB-11 T17: lý do tối thiểu 4 ký tự | PAY-TC-20261006-104540563 | bắt |
| SB-11 T17: lý do tối đa 301 ký tự | PAY-TC-20261006-104540563 | bắt |
| SB-11 T17: ghi chú COD tối đa 201 ký tự | PAY-TC-20261006-104539422 | bắt |
| SB-11: cho ký tự điều khiển (NUL) trong lý do | PAY-TC-20261006-104540563 | bắt |
| SB-12 T17: lý do bị biến đổi (cắt ký tự <) | PAY-TC-20261006-104540662 | bắt |
| SB-11: danh sách nhận trạng thái tùy ý | PAY-TC-20261006-104540827 | bắt |
| SB-11: order_code không giới hạn độ dài | PAY-TC-20261006-104540827 | bắt |
| SB-08 T11: admin lọc theo phương thức bất kỳ | PAY-TC-20261006-104541064 | bắt |
| SB-06: customer lọc được theo user_id | PAY-TC-20261006-104540794 | bắt |
| SB-23: khoảng số tiền VNPay dưới 4000 | PAY-TC-20261006-104538804 | bắt |
| SB-23: khoảng số tiền VNPay tới 1 tỷ | PAY-TC-20261006-104538671 | bắt |
| SB-34: hạn chờ hoàn tiền 1 phút | PAY-TC-20261006-104540309 | bắt |
| SB-34: lịch tự thử lại 5 phút rồi 5 phút | PAY-TC-20261006-104540277 | bắt |
| SB-16 T12: khóa ký không bị kiểm quy tắc bí mật ở prod | PAY-TC-20261007-085337388 | bắt |
| SB-16 T12: khóa ký không bắt buộc ở staging và prod | PAY-TC-20261007-085337388 | bắt |
| SB-15 T12: khóa ký có giá trị mặc định | PAY-TC-20261007-085337388 | bắt |
| SB-16: mã đối tác TMN không bắt buộc ngoài dev | PAY-TC-20261007-085337388 | bắt |
| SB-16: địa chỉ quay về không bắt buộc ngoài dev | PAY-TC-20261007-085337388 | bắt |
| SB-24: PAY_MAX_ATTEMPTS mặc định 4 | PAY-TC-20261006-104539587 | bắt |
| SB-24: PAY_REFUND_AUTO_ATTEMPTS mặc định 2 | PAY-TC-20261006-104540277 | bắt |
| SB-23: hạn đường dẫn mặc định 9 phút | PAY-TC-20261006-104538705 | bắt |
| SB-22 T1: chuỗi ký không sắp theo tên tham số | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: chuỗi ký bỏ mã hóa khoảng trắng thành + | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: chuỗi ký gồm cả vnp_SecureHashType | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: so sánh chữ ký không dùng timingSafeEqual | PAY-TC-20261006-104539065 | bắt |
| SB-22 T1: khóa ký rỗng vẫn xác thực | PAY-TC-20261007-085337388 | bắt |
| SB-22 T1: chữ ký hex ngắn hơn 128 ký tự được chấp nhận | - | lọt: tương đương, lớp bảo vệ thứ hai: chuỗi hex ngắn hơn 128 ký tự vẫn bị `a.length === b.length` ngay sau đó loại, nên so sánh không bao giờ thành công; hành vi quan sát được không đổi |
| SB-23: số tiền gửi cổng ×10 | PAY-TC-20261006-104538705 | bắt |
| SB-23: số tiền IPN chia hết 100 không bắt buộc | PAY-TC-20261006-104538705 | bắt |
| SB-23: số tiền IPN nhận 0 | PAY-TC-20261006-104538705 | bắt |
| SB-23: số tiền IPN nhận chuỗi không phải số | PAY-TC-20261006-104538705 | bắt |
| SB-24: giờ VNPay theo UTC | PAY-TC-20261006-104538705 | bắt |
| SB-22 T1: thành công chỉ cần ResponseCode 00 | PAY-TC-20261006-104538705 | bắt |
| SB-23: mô tả đơn kèm dữ liệu cá nhân | PAY-TC-20261006-104538705 | bắt |
| SB-23: chữ ký đường dẫn chỉ phủ vài tham số | PAY-TC-20261006-104538705 | bắt |
| SB-22: mã 24 không phải hủy bởi khách | PAY-TC-20261006-130000400 | bắt |
| SB-22: mã 11 không phải timeout | PAY-TC-20261006-130000400 | bắt |
| SB-22: mã 51 không phải declined | PAY-TC-20261006-130000400 | bắt |
| SB-31 T16: truy vấn không giới hạn hạn gọi | PAY-TC-20261006-104539653 | bắt |
| SB-22 T20: truy vấn không kiểm chữ ký phản hồi | PAY-TC-20261006-104539653 | bắt |
| SB-22: hoàn tiền không kiểm chữ ký phản hồi | PAY-TC-20261006-104540177 | bắt |
| SB-24: mã 99 của cổng coi là từ chối | PAY-TC-20261006-104540177 | bắt |
| SB-24: mã 91 coi là không có giao dịch | PAY-TC-20261006-104539621 | bắt |
| SB-24: hoàn tiền dùng loại một phần (03) | PAY-TC-20261006-104540177 | bắt |
| SB-23: hoàn tiền gửi số tiền không nhân 100 | PAY-TC-20261006-104540177 | bắt |
| SB-31: khóa ký rỗng vẫn gọi cổng | PAY-TC-20261006-104539653 | bắt |
| CHECK payments_amount_positive bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payments_attempt_no_range bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payments_expires_online bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payments_succeeded_paid_at bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payments_succeeded_provider_ref bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payments_order_code_format bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payments_version_nonneg bị vô hiệu | PAY-TC-20261006-104538604 | bắt |
| CHECK payment_attempts_attempt_no_range bị vô hiệu | PAY-TC-20261006-104539262 | bắt |
| CHECK payment_attempts_txn_ref_format bị vô hiệu | PAY-TC-20261006-104539262 | bắt |
| CHECK payment_attempts_reason_scope bị vô hiệu | PAY-TC-20261006-104539262 | bắt |
| CHECK payment_attempts_succeeded_txn_no bị vô hiệu | PAY-TC-20261006-104539262 | bắt |
| CHECK payment_attempts_resolved_at bị vô hiệu | PAY-TC-20261006-104539262 | bắt |
| CHECK payment_attempts_expiry_after_create bị vô hiệu | PAY-TC-20261006-104539262 | bắt |
| CHECK refunds_amount_positive bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_note_len bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_note_manual bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_requested_by_manual bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_failure_reason_scope bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_next_retry_scope bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_resolved_at bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_request_id_format bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK refunds_auto_attempt_range bị vô hiệu | PAY-TC-20261006-104540277 | bắt |
| CHECK payment_webhook_logs_rsp_code bị vô hiệu | PAY-TC-20261006-113000600 | bắt |
| CHECK payment_webhook_logs_payload_object bị vô hiệu | PAY-TC-20261006-113000600 | bắt |
| CHECK payment_webhook_logs_result_format bị vô hiệu | PAY-TC-20261006-113000600 | bắt |
| UNIQUE payments_order_id_key thành chỉ mục thường | PAY-TC-20261006-104538604 | bắt |
| UNIQUE payment_attempts_txn_ref_key thành chỉ mục thường | PAY-TC-20261006-104539262 | bắt |
| UNIQUE payment_attempts_payment_id_attempt_no_key thành chỉ mục thường | PAY-TC-20261006-104539262 | bắt |
| UNIQUE refunds_attempt_id_key thành chỉ mục thường | PAY-TC-20261006-104540277 | bắt |
| UNIQUE payment_attempts_provider_txn_no_key thành chỉ mục thường | PAY-TC-20261006-104539262 | bắt |
| FOREIGN KEY payments_order_id_fkey bị bỏ | PAY-TC-20261006-104538604 | bắt |
| FOREIGN KEY payment_attempts_payment_id_fkey bị bỏ | PAY-TC-20261006-104539262 | bắt |
| FOREIGN KEY refunds_payment_id_fkey bị bỏ | PAY-TC-20261006-104540277 | bắt |
| FOREIGN KEY refunds_attempt_id_fkey bị bỏ | PAY-TC-20261006-104540277 | bắt |
| FOREIGN KEY payments_order_id_fkey thành ON DELETE CASCADE | PAY-TC-20261006-104538604 | bắt |
| FOREIGN KEY payment_attempts_payment_id_fkey thành ON DELETE CASCADE | PAY-TC-20261006-104539262 | bắt |
| FOREIGN KEY refunds_attempt_id_fkey thành ON DELETE CASCADE | PAY-TC-20261006-104540277 | bắt |
| SB-21: thêm cột card_number vào payments | PAY-TC-20261006-104538540 | bắt |
| SB-21: thêm cột cvv vào payment_attempts | PAY-TC-20261006-104538540 | bắt |
| SB-32 T22: trigger nhật ký cho sửa | PAY-TC-20261006-113000600 | bắt |
| SB-32 T22: trigger nhật ký xóa dòng mới (12 thành 1 tháng) | PAY-TC-20261006-113000600 | bắt |
| SB-32 T22: trigger nhật ký không chặn xóa mọi dòng | PAY-TC-20261006-113000600 | bắt |
| SB-32 T22: trigger nhật ký chỉ chặn UPDATE | PAY-TC-20261006-113000600 | bắt |
| SB-32 T22: nhật ký không thu quyền UPDATE | PAY-TC-20261006-113000600 | bắt |
| SB-32 T22: nhật ký không thu quyền TRUNCATE | - | lọt: tương đương, đặc quyền TRUNCATE chưa bao giờ được cấp cho vai trò ứng dụng (nền chỉ cấp SELECT, INSERT, UPDATE, DELETE nên REVOKE TRUNCATE chỉ là lớp phòng thủ lặp); bỏ dòng này không đổi quyền thực tế nào, còn bỏ REVOKE UPDATE thì đột biến ngay trên đây đã bắt |
| SB-24: trigger vòng đời Payment cho pending sang refunded | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment chặn pending sang expired | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment cho processing sang pending | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment chặn processing sang failed | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment cho failed sang pending | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment chặn failed sang succeeded | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment cho succeeded sang cancelled | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger vòng đời Payment bỏ hẳn (điều kiện luôn sai) | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger Refund cho succeeded sang requested | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger Refund cho failed sang succeeded | PAY-TC-20261006-104539228 | bắt |
| SB-24: trigger Refund chặn failed sang requested | PAY-TC-20261006-104539228 | bắt |
| SB-13 T18: CSRF không kiểm Origin lạ | PAY-TC-20261006-104538935 | bắt |
| SB-13 T18: CSRF không đòi Origin khi có cookie | PAY-TC-20261006-104538935 | bắt |
| SB-13 T18: CSRF bỏ qua Referer hợp lệ | PAY-TC-20261006-104538935 | bắt |
| SB-25 T19: bỏ giới hạn số lượt thử (cả kiểm trước lẫn điều kiện trong câu UPDATE) | PAY-TC-20261006-104539782 | bắt |
| SB-24: initiate cho Payment không pending (gỡ kiểm trạng thái và kiểm chuyển trạng thái) | PAY-TC-20261006-104538804 | bắt |
| SB-34: job tự thử lại không chờ hẹn (cả câu chọn lẫn câu khóa dòng) | PAY-TC-20261006-104540245 | bắt |
| SB-34: job đối soát hoàn tiền hỏi lại ngay (bỏ ngưỡng 5 phút ở câu chọn lẫn câu thuê dòng) | PAY-TC-20261006-104540309 | bắt |
| REV-PAY-01 SB-22 T20: đối soát lại chỉ lượt của Payment còn mở (bỏ qua Payment đã đóng) | PAY-TC-20261013-193715406 | bắt |
| REV-PAY-01 SB-22 T20: Payment đã đóng, cổng báo thành công mà không tạo Refund (bỏ qua kết quả thành công) | PAY-TC-20261013-193715406 | bắt |
| REV-PAY-01 SB-22 T20: Payment đã đóng, cổng báo thất bại mà không ghi lượt | PAY-TC-20261013-193715507 | bắt |
| SB-34: đối soát bỏ giới hạn lô JOB_BATCH | PAY-TC-20261013-193715606 | bắt |
| REV-PAY-01 T20: lượt Payment đã đóng không bao giờ bị đóng khi quá hạn 7 ngày | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-01 T20: hạn 7 ngày bỏ ngưỡng (lượt mới quá 6 ngày cũng bị đóng) | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-01 T20: hạn 7 ngày áp cả cho Payment còn mở | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-01 T20: cổng lỗi quá hạn không đóng lượt | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-01 T20: số tiền lệch quá hạn không đóng lượt | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-01 T20: trùng mã giao dịch quá hạn không đóng lượt | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-01 T20: đóng lượt quá hạn nhưng chỉ log warn (không error) | PAY-TC-20261013-193715697 | bắt |
| REV-PAY-04 SB-34: Refund kẹt requested quá 1 giờ không bị kết thúc | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-04 SB-34: Refund kẹt kết thúc không chờ quá 1 giờ (bỏ ngưỡng) | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-04 SB-24: Refund kẹt kết thúc bằng mã lý do khác gateway-no-answer | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-04 SB-24: Refund kẹt kết thúc vẫn hẹn tự thử lại | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-04 SB-24: Refund kẹt kết thúc phát sai loại event (không phải RefundFailed) | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-04 SB-24: admin thử lại không đặt lại requested_at (đóng ngay lượt kế) | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-04 SB-24: tự thử lại không đặt lại requested_at | PAY-TC-20261013-193715799 | bắt |
| REV-PAY-13 SB-32 T23: vẫn cho vai trò ứng dụng xóa refunds | PAY-TC-20261013-193715898 | bắt |
| REV-PAY-13 SB-32 T23: vẫn cho vai trò ứng dụng xóa payment_attempts | PAY-TC-20261013-193715898 | bắt |
| REV-PAY-13 SB-32 T23: vẫn cho vai trò ứng dụng xóa payments | PAY-TC-20261013-193715898 | bắt |
| REV-PAY-13 SB-32 T23: thu cả UPDATE của vai trò ứng dụng (phá vòng đời) | PAY-TC-20261013-193715898 | bắt |
| SB-32 T22: created_at của nhật ký webhook dùng now() thay clock_timestamp() | PAY-TC-20261013-193922887 | bắt |
| REV-PAY-10 SB-22 T1: IP ngoài danh sách vẫn ghi nhật ký webhook | PAY-TC-20261013-194320138 | bắt |
| SB-34 T22: job dọn nhật ký không xóa theo lô (chỉ một lô đầu) | PAY-TC-20261013-194320040 | bắt |
| SB-32 T22: job dọn nhật ký xóa cả dòng chưa quá 12 tháng | PAY-TC-20261013-194320040 | bắt |

## Lệch spec
Không sửa spec trong lúc triển khai. Các mục dưới là lựa chọn mặc định đã làm, việc chưa làm hoặc chỗ cần người quyết.

1. [đã chọn] **IPN thất bại cũ gửi lại: 02** (đã đồng bộ spec 2026-10-13, `spec/changes/pay-reviews-20261013.md`): kịch bản cuối của `PAY-REQ-20261006-103110513` nay ghi `RspCode` 02 (BR3, BR5; 97 chỉ cho chữ ký sai, BR1); BR8 loại trừ lời gọi bị chặn ở lớp danh sách IP (REV-PAY-10). Mã không đổi; test `PAY-TC-20261006-104539164` khóa 02 và `PAY-TC-20261013-194320138` khóa việc IP ngoài danh sách nhận 99 mà không ghi nhật ký.
2. [đã chọn] **Đối soát Payment đã đóng** (REV-PAY-01, HIGH, đã sửa 2026-10-13): job đối soát nay hỏi cổng cho MỌI lượt `processing` quá hạn cộng 2 phút, kể cả của Payment `expired`, `cancelled`, `refunded` (`apps/api/src/modules/payment/reconcile.service.ts`: câu chọn không lọc theo trạng thái Payment). Cổng báo thành công thì lượt `succeeded`, Payment giữ nguyên và đúng một Refund `late_payment` (`duplicate_payment` cho `refunded`; unique `attempt_id`, khóa dòng Payment, lượt đã chốt không bị hỏi lại); báo thất bại thì chỉ ghi lượt `failed` `timeout`. Khi không chắc (cổng lỗi, số tiền lệch, trùng mã giao dịch) giữ lượt và thử lại; riêng Payment đã đóng quá 7 ngày kể từ hạn (`RECONCILE_CLOSED_WINDOW_MS`) thì đóng lượt `failed` `timeout` kèm log `error` `reconcile-closed-unresolved` (người vận hành đối chiếu tay). Spec đã sửa: `PAY-REQ-20261006-103110684` BR5, BR9, ca biên; `PAY-TC-20261006-104539686`; `PAY-DB-20261006-103701241` mục 9; `PAY-SEC-20261006-103701420` T20 và Rủi ro còn lại. Test: `PAY-TC-20261013-193715406` (thành công, không hoàn trùng), `PAY-TC-20261013-193715507` (thất bại), `PAY-TC-20261013-193715606` (giới hạn lô), `PAY-TC-20261013-193715697` (hạn 7 ngày); test cũ khóa hành vi bỏ qua (`failure.spec.ts`) đã thay.
3. [đã chọn] **Danh sách biến cấu hình của PAY**: ADR-007 và bảng biến ở `architecture.md` đã liệt kê đủ chín biến `VNPAY_*`, `PAY_*` (đồng bộ nền 2026-10-13; khóa ký `VNPAY_HASH_SECRET` là bí mật bắt buộc ngoài dev, từ chối giá trị giữ chỗ hoặc ngắn ở prod; kiểm bằng `PAY-TC-20261007-085337388`); PAY-API nay chỉ trỏ ADR-007. URL sandbox là mặc định của `VNPAY_PAY_URL`, `VNPAY_API_URL` và production không bị chặn dùng: ADR-007 không bắt buộc URL production nên không thêm kiểm ở cấu hình, ghi việc go-live ở PAY-SEC (Rủi ro còn lại).
4. [đã chọn] **Tên lớp giao diện nội bộ**: mã phơi `PaymentApi.getRevenue({ from, to }, bucket?)` (khoảng nửa mở UTC, `bucket` `hour`, `day`, `month` theo UTC) và `PaymentApi.countFailedRefunds()` ở điểm vào công khai `modules/payment/index.ts`, cùng kiểu `OrderApi`, `ShippingApi`; bảng Giao diện module ở `architecture.md` và mục "Cung cấp cho DSH" của PAY-API đã ghi đúng (2026-10-13); DSH-API, DSH-DB do agent DSH sửa. Test lược đồ và giao diện đọc cho DSH ở `apps/api/test/payment/api.spec.ts` (mang ID `PAY-SEC-20261006-103701420`); `getRevenue` ném `RangeError` khi số khoảng theo `bucket` vượt 1000 (đầu vào sai là lỗi của bên gọi).
5. [đã chọn] **Hoàn tiền chạy bất đồng bộ** (PAY-API đã đồng bộ 2026-10-13, REV-PAY-09: refunds và refunds retry luôn 202): `POST /payments/{id}/refunds` ghi Refund `requested` rồi trả 202; lệnh gửi cổng chạy sau commit (`dispatchSoon`), job quét hoàn tiền (`payment-refund-sweep`) nhặt lại khi tiến trình chết hoặc không có trả lời sau 5 phút, và kết thúc có hạn khi kẹt quá 1 giờ (mục 19). Test: `PAY-TC-20261006-104540596` (bấm hai lần chỉ một lệnh), `PAY-TC-20261006-104540309` (không trả lời thì chốt sau 5 phút), `PAY-TC-20261006-113000500` (khóa idempotency).
6. [đã chọn] **`vnp_IpAddr` là hằng `127.0.0.1`** ở đường dẫn thanh toán, truy vấn và hoàn tiền: PAY-API không nêu cách lấy IP khách và `initiate` có thể được gọi sau proxy; VNPay chỉ dùng trường này để ghi nhận. Khóa chữ ký không phụ thuộc IP. Việc cho người nếu VNPay sandbox đòi IP thật.
7. [đã chọn] **IPN khai `@Public`**: ma trận ghi guest = Y cho IPN (xác thực bằng chữ ký, không bằng phiên); `IpnController` luôn trả HTTP 200 với JSON `RspCode` (ngoại lệ có chủ đích của problem+json, ADR-006), đếm bậc E theo IP (khóa `ip:<IP>` kể cả khi có cookie) và có danh sách IP cho phép tùy chọn (`VNPAY_IPN_IP_ALLOWLIST`, mặc định trống). Test: `PAY-TC-20261006-104539294` (300 yêu cầu mỗi phút), `PAY-TC-20261006-104539065` (chữ ký). Số bước proxy tin cậy (`TRUST_PROXY_HOPS`) nạp vào một biến mức module (`setIpHops`) lúc khởi tạo vì decorator `@RateLimit` là dữ liệu tĩnh: nếu hai ứng dụng khác cấu hình cùng sống trong một tiến trình (chỉ xảy ra ở test) thì ứng dụng khởi tạo sau thắng.
8. [đã chọn] **Hold-and-wait của handler event** (L71): handler đọc ORD (`OrderApi.findForPayment`) TRƯỚC khi mở giao dịch của PAY và gọi cổng ngoài giao dịch (SB-31); giao event vẫn giữ một kết nối của `EventsService.deliver` nên mỗi event cần hai kết nối. Relay giao lần lượt nên `DB_POOL_MAX` tối thiểu 2 là đủ; `apps/api/test/payment/review.spec.ts` chạy ở pool 2 các đường HTTP song song và giao event tuần tự. Giao song song nhiều `deliver` hơn kích thước pool sẽ treo (ngoài thiết kế). Việc cho người: giữ `DB_POOL_MAX` ≥ 2 ở mọi môi trường.
9. [đã chọn] **Chọn cho chỗ spec để ngỏ** (mỗi chỗ có test): lượt thử mới hạn URL = min(`PAY_ATTEMPT_URL_TTL_MINUTES`, thời gian còn của Payment) (`PAY-TC-20261006-104538871`); lý do hoàn tiền thủ công 5 đến 300 ký tự đếm theo ký tự Unicode, lưu nguyên văn, không vào log (`PAY-TC-20261006-104540630`, `PAY-TC-20261006-104540662`); ghi nhận thu COD của staff, admin dùng bậc D 30 mỗi phút chung một bộ đếm vì spec không nêu số riêng (`apps/api/test/payment/guard.spec.ts`); mã lỗi trong mã đều có trong PAY-API (17 mã, kiểm ở `PAY-SEC-20261006-103701420`).
10. [đã chọn] **Giao diện (spec ui không nêu hoặc nêu mơ hồ)**: đường dẫn `/orders/{code}/payment`, `/payments`, `/admin/payments`, `/admin/payments/{id}`, `/admin/refunds` (bộ lọc ở URL); nhãn trạng thái COD đã thu là "Đã thanh toán" (spec ui chỉ ghi `succeeded`); staff chỉ xem hàng đợi hoàn tiền, không có nút thao tác tiền (`PAY-E2E-20261006-104612596`). Kiểm bằng các E2E của epic (`apps/api/test/e2e/pay.e2e.spec.ts`); 132 `data-testid` `pay-*` đều có trong mã web.
11. [đã chọn] **Sửa nền khác module để test chạy** (không đổi hành vi của module khác; mỗi chỗ có test kiểm): (a) `apps/api/prisma/schema/order.prisma` thêm quan hệ ngược `payment Payment?` vào `Order` (Prisma cần để khớp khóa ngoại `payments.order_id`; không đổi cột; kiểm bằng `PAY-TC-20261006-104538604` (unique `order_id`) và `pnpm db:check`); (b) `apps/api/test/support/app.ts`: `baseEnv` thêm `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` giả đủ mạnh vì `AppModule` nay khai ba biến bắt buộc ngoài dev; nếu thiếu thì `PRD-TC-20261006-100355691` (staging chỉ thiếu biến STORAGE) và `PRJ-TC-20261006-100124463` (HSTS ở staging, prod) đỏ; (c) `apps/api/test/order/create.spec.ts`: dòng `TRUNCATE` phải gồm bốn bảng PAY vì khóa ngoại `payments.order_id` chặn TRUNCATE (`ORD-TC-20261006-111225380`); (d) `apps/api/test/support/db.ts` (`TABLES` dọn bốn bảng PAY), `test/support/auth.ts` (tùy chọn `overrides` cho `createAuthApp` để thay cổng bằng bản giả), `test/e2e/server.ts` và `test/e2e/support.ts` (cổng giả, trang VNPay giả, điểm mồi dữ liệu): đều do mọi TC và E2E của PAY dùng.
12. [chưa làm] **Chưa thử VNPay sandbox thật**: mọi tương tác với cổng (ký, IPN, `querydr`, `refund`) chạy với máy chủ giả lập dựng theo tài liệu VNPay v2.1.0 và với chính hàm `sign` của mã. Các dòng YẾU (`PAY-TC-20261006-104538705`, `PAY-TC-20261006-104539001`, `PAY-TC-20261006-104539033`, `PAY-TC-20261006-104539065`, `PAY-TC-20261006-104539621`, `PAY-TC-20261006-104539653`, `PAY-TC-20261006-104539718`, `PAY-TC-20261006-104540177`, `PAY-TC-20261006-104540245`, `PAY-E2E-20261006-104612099`, `PAY-E2E-20261006-104612157`, `PAY-E2E-20261006-104612213`, `PAY-E2E-20261006-104612262`, `PAY-E2E-20261006-104612463`, `PAY-E2E-20261006-104612529`) nâng được bằng một lượt chạy với `VNPAY_TMN_CODE` và khóa của sandbox: đối chiếu chữ ký đường dẫn và IPN với vectơ do VNPay cấp, gọi thật `querydr` và `refund`, rồi đổi nhãn YẾU thành ghi chú thường.
13. [đã chọn] **`usr.e2e` đỏ chập chờn một lần** (đã sửa gốc ở review): lượt `pnpm test` toàn repo đầu tiên có một test rate-limit của USR đỏ (biên cửa sổ đếm); chạy lại thì xanh. Nguyên nhân: ca tra cứu khách bắn 31 yêu cầu vào bộ đếm bậc D (30 mỗi phút, cửa sổ cố định) mà không gọi `alignWindow()` như E2E của INV, ORD, SHP; nay đã gọi (`apps/api/test/e2e/usr.e2e.spec.ts:269`).
14. [đã chọn] **Test thêm từ bảng đột biến mang ID của TC gần nhất**: lược đồ (`apps/api/test/payment/db.spec.ts`, ID tài liệu `PAY-DB-20261006-103701241`) và các ca bẫy do đột biến lọt ở lượt chạy đầu (khẳng định mảng `vnp_` ngoài phần ký, `version` tăng 1, rollback khi ghi event lỗi, `PaymentCore.move` từ trạng thái ngoài bảng, thu COD cho Payment đã đóng, retry chung bộ đếm bậc E, StockCommitFailed cho Payment chưa thu tiền, mã đơn có chữ S với `ſ`, IP giả ở `X-Forwarded-For`, danh sách IP của cổng) nằm trong cùng bộ test của TC gần nhất và mang ID đó trong tên (`PAY-TC-20261006-104539065`, `PAY-TC-20261006-104539196`, `PAY-TC-20261006-104539001`, `PAY-TC-20261006-104539326`, `PAY-TC-20261006-104539164`, `PAY-TC-20261006-104539456`, `PAY-TC-20261006-104538969`, `PAY-TC-20261006-113000400`, `PAY-TC-20261006-104541095`, `PAY-TC-20261006-104539294`, `PAY-TC-20261006-104539098`), vì spec chưa có TC riêng cho các ca này. Riêng BR8, BR10 (danh sách IP) nay có `PAY-TC-20261013-194320138`; các ca còn lại vẫn mượn ID của TC gần nhất.
15. [đã chọn] **Sáu đột biến tương đương** (có lý do trong bảng, kiểm bằng `test/tooling/mutations-pay.spec.ts` với trần 6 và lý do dài hơn 40 ký tự): thành công không có mã giao dịch (CHECK của CSDL thay), bỏ khóa dòng ở IPN (UPDATE có điều kiện và unique thay), chủ ở `lockById` của chi tiết lượt thử (hai câu `if` tương đương), settle không kiểm `requested` (hai nhánh UPDATE có điều kiện), chữ ký hex ngắn (so độ dài thay) và thu quyền TRUNCATE (chưa từng được cấp). Các cặp lớp bảo vệ khác (số lượt tối đa, bắt đầu cho Payment không `pending`, hẹn thử lại hoàn tiền, ngưỡng 5 phút) được gài bằng một đột biến gỡ cả hai lớp, và đều bị bắt.
16. [đã chọn] **Cách chạy `clean_run`** (làm ở lượt review 2026-10-08, theo công thức PRJ mục 34; mã chưa commit nên chỉ gần giống CI): `git worktree add --detach` tại `c557cdb`, phủ các tệp sửa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH`, `HOME` rỗng, `CI=true`, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`, `PLAYWRIGHT_BROWSERS_PATH`; `pnpm install --frozen-lockfile --offline --store-dir <kho của máy>` (đổi `HOME` làm mất kho pnpm nên phải chỉ `--store-dir`; Chromium của E2E phải chỉ `PLAYWRIGHT_BROWSERS_PATH`, nếu không 9 bộ E2E đỏ vì không tìm thấy trình duyệt); PostgreSQL 16 và MinIO của Docker. Đã chạy: install, scan:secrets, check:boundaries, lint, typecheck, test, build, đều qua (số test ở `test_result`). Không chạy: workflow trên GitHub (chưa push), `check-migration-compat --base` (chỉ cho pull request), `psql -f 01-app-roles.sql` (máy không có `psql`; `globalSetup` chạy cùng tệp).
17. [đã chọn] **Sửa của review 2026-10-08** (chi tiết và bằng chứng ở `spec/epics/PAY/review.md`, mục *Kết quả sau sửa*): REV-PAY-02 (`ipOf` đổi IPv4 ánh xạ IPv6 `::ffff:a.b.c.d` về `a.b.c.d` để danh sách IP không từ chối mọi IPN thật), REV-PAY-03 (job đối soát sắp theo `updated_at` để lượt kẹt vĩnh viễn không chặn lượt mới), REV-PAY-04 (log `error` `refund-stuck` khi Refund `requested` quá 1 giờ), REV-PAY-05 (vectơ chữ ký hằng số ở `gateway.spec.ts`), REV-PAY-06 (hoàn tiền `00` kèm `vnp_TransactionStatus` 09 là `declined`), REV-PAY-07 (`usr.e2e` gọi `alignWindow()`), REV-PAY-08 (dữ liệu mồi của `shipping/read.spec` không chịu `statement_timeout`), REV-PAY-15 (test dispatch không gọi cổng cho Refund đã chốt; test CHECK số tiền hoàn âm); bảng đột biến có 293 đột biến (thêm 8). Mục 13 (`usr.e2e` chập chờn) đã sửa gốc.

18. [đã chọn] Đồng bộ nền 2026-10-13 (`spec/changes/nen-dong-bo-20261013.md`, REV-PAY-02, REV-PAY-14 và báo cáo mục 3): IPv4 ánh xạ IPv6 do `clientIp` của platform chuẩn hóa một lần nên `apps/api/src/modules/payment/http.ts` bỏ `normalizeIp` riêng (`ipOf` gọi thẳng `clientIp`; test `PAY-TC-20261006-104539098` import `normalizeIp` từ platform; bảng đột biến `mutations-pay.json` trỏ đột biến REV-PAY-02 sang `client-ip.ts`); ADR-007 liệt kê đủ chín biến `VNPAY_*`, `PAY_*`; bảng Giao diện module ghi `PaymentApi.getRevenue({ from, to }, bucket?)` và `countFailedRefunds()`. Việc người: URL sandbox VNPay là mặc định của `VNPAY_PAY_URL`, `VNPAY_API_URL` và mã không chặn dùng ở prod; chưa thử cổng sandbox thật; L103 (cách hỏi lại cổng cho Refund `requested`) đã chốt ở mục 19.


19. [đã chọn] **Đợt sdlc-impact PAY 2026-10-13** (`spec/changes/pay-reviews-20261013.md`; REV-PAY-01, 04, 09, 10, 13, 14; L61, L100, L103, L121): (a) Refund kẹt `requested` (BR6 của `PAY-REQ-20261006-103110946`): job hỏi lại bằng cùng `gateway_request_id`; quá 1 giờ kể từ lúc vào `requested` (cột mới `refunds.requested_at`, đặt lại khi tạo, admin thử lại, tự thử lại) mà cổng vẫn chưa chốt thì Refund `failed` (`failure_reason` `gateway-no-answer`, không hẹn tự thử), RefundFailed cho admin, log `error` `refund-stuck`; không tự chốt `succeeded` (hoàn trùng): `refund.service.ts` hàm `giveUp`, test `PAY-TC-20261013-193715799`; việc người: admin đối chiếu giao dịch hoàn ở cổng VNPay rồi mới thử lại. (b) Migration `20261013000100_payment_hardening`: thu `DELETE` của `app_runtime` trên `payments`, `payment_attempts`, `refunds` (UPDATE giữ vì ba bảng đổi trạng thái theo vòng đời), thêm `requested_at`; test bằng vai trò thật `ecom_app` (`PAY-TC-20261013-193715898`, PAY-SEC T23); `payment_webhook_logs.created_at` đã mặc định `clock_timestamp()` nay có test (`PAY-TC-20261013-193922887`); job dọn nhật ký có TC (`PAY-TC-20261013-194320040`). (c) Hạ tầng E2E: cổng cơ sở cấu hình được bằng `E2E_PORT_BASE` (mặc định 3100; không đặt mà 3100 đến 3103 bị dự án khác giữ thì global-setup tự chọn cơ sở khác còn trống; từ chối khi cổng bị chính E2E cũ giữ), `apps/api/test/support/e2e-ports.ts`, `apps/api/test/tooling/e2e-ports.spec.ts`, mọi URL cứng 3100 đến 3103 trong E2E đã đổi sang hằng của `test/e2e/support.ts`; E2E chạy với `E2E_PORT_BASE=3300` ở máy này (3100 do dự án khác giữ). (d) PAY-API thêm 429 vào bảng lỗi (L121). (e) Lượt chạy cuối: toàn repo GỒM E2E (`E2E_PORT_BASE=3300`): 205 bộ, 1762 test, 0 đỏ. Việc người còn lại: chạy VNPay sandbox thật (mục 12, kể cả mã 94 khi gọi lặp cùng mã yêu cầu, `vnp_IpAddr`, `vnp_TransactionStatus` của `querydr`); đặt URL production của VNPay trước go-live (URL sandbox mặc định không bị chặn ở prod); đối chiếu tay các lượt `reconcile-closed-unresolved` và Refund `gateway-no-answer`; chưa commit mã PAY nên `clean_run` vẫn là lượt review 2026-10-08.
