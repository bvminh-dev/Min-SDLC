---
epic: NTF
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: NTF

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền của module (cấu hình, mẫu nội dung, bộ chuyển thư SES), rồi sửa nền kèm theo của platform (consumer hai pha), consumer 18 event, job gửi email và dọn dữ liệu, API đọc, test API, giao diện web, E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. Phụ thuộc duy nhất sang epic khác là `AuthApi` (`getUserContact`, `listActiveUserIdsByRole`) của AUTH; bên ngoài, SES chỉ được thử bằng bộ giả lập tự dựng (xem các dòng YẾU và Lệch spec).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261009000300_notification_tables` và `notification.prisma` (2 bảng, 5 enum, CHECK, unique, hai unique một phần chưa đọc, FK CASCADE tới `users`, hai trigger vòng đời, chỉ mục) và quan hệ ngược ở `auth.prisma` | NTF-DB-20261006-103815422 | - | done |
| 2 | Nền của module: biến cấu hình (`SES_*`, `MAIL_FROM`, `APP_BASE_URL`), mẫu nội dung cố định cho 15 loại thông báo và 12 loại email, dựng thư (escape HTML, làm sạch họ tên), bộ chuyển thư SES v2 ký SigV4 và bản "chưa cấu hình" | NTF-API-20261006-103815515, NTF-SEC-20261006-103815605 | 1 | done |
| 3 | Sửa nền platform: consumer hai pha (`subscribePrepared`, `SKIP`), consumer raw cho hai event token (`subscribeRaw`), `idle()` | NTF-DB-20261006-103815422, NTF-API-20261006-103815515, NTF-SEC-20261006-103815605 | 1 | done |
| 4 | Consumer `NTF` của 16 event qua outbox: kiểm dạng payload, hỏi AUTH ngoài giao dịch, ghi thông báo và email cùng `processed_events`, chống trùng theo `event_id` và khóa tự nhiên | NTF-TC-20261006-104222533, NTF-TC-20261006-104222599, NTF-TC-20261006-104222664, NTF-TC-20261006-104222732, NTF-TC-20261006-104222796, NTF-TC-20261006-104222863, NTF-TC-20261006-104222929, NTF-TC-20261006-104223060, NTF-TC-20261006-104223757, NTF-TC-20261006-104225139, NTF-TC-20261006-104226204 | 1, 2, 3 | done |
| 5 | Gửi email: job mỗi phút (nhận việc `FOR UPDATE SKIP LOCKED`, thuê 2 phút, hạn mức theo người nhận, thử lại 1 rồi 5 phút, hộp thư chết `failed`), email chứa bí mật trong handler (0, 2, 5 giây, quét `lost`) | NTF-TC-20261006-104223120, NTF-TC-20261006-104223184, NTF-TC-20261006-104223250, NTF-TC-20261006-104223313, NTF-TC-20261006-104223377, NTF-TC-20261006-104223436, NTF-TC-20261006-104223500, NTF-TC-20261006-104223567, NTF-TC-20261006-104223630, NTF-TC-20261006-104223696 | 2, 3, 4 | done |
| 6 | API đọc: danh sách, đếm chưa đọc, đánh dấu một, đánh dấu tất cả (IDOR, 404 cùng nội dung, CSRF, giới hạn tần suất bậc C, hạn lưu 180 ngày) | NTF-TC-20261006-104301925, NTF-TC-20261006-104302157, NTF-TC-20261006-104302303, NTF-TC-20261006-104302787, NTF-TC-20261006-104303133 | 1 | done |
| 7 | Job dọn dữ liệu quá hạn (`notification.cleanup`: thông báo 180 ngày, email 90 ngày, lô 1000) và ca đua, giới hạn lô, thuê dòng | NTF-TC-20261006-104222999 | 1, 5 | done |
| 8 | Test API trên PostgreSQL thật (9 bộ ở `apps/api/test/notification`, SES giả tự dựng kiểm SigV4, tiến trình bị SIGKILL, pool 2 kết nối, producer thật của AUTH và ORD) và test lược đồ, cấu hình, ma trận quyền, ranh giới | NTF-SEC-20261006-103815605, NTF-DB-20261006-103815422 | 4, 5, 6, 7 | done |
| 9 | Giao diện web: chuông thông báo ở thanh đầu trang và trang danh sách `/notifications` | ui/notification-bell, ui/notification-list | 6 | done |
| 10 | E2E trình duyệt thật (API thật, SES giả, event thật qua outbox, luồng đặt hàng COD thật) và điểm điều khiển `/seed-notification`, `/publish`, `/ses-mails`, `/run-email-job` | NTF-E2E-20261006-104226408, NTF-E2E-20261006-104226475, NTF-E2E-20261006-104226538, NTF-E2E-20261006-104226604 | 8, 9 | done |
| 11 | Bảng đột biến NTF và cổng kiểm của nó (`scripts/mutations-ntf.json`, `test/tooling/mutations-ntf.spec.ts`) | NTF-SEC-20261006-103815605 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (87 TC, 4 E2E). Ngoài các ID này còn các test mang ID tài liệu NTF-DB và NTF-SEC (lược đồ, cấu hình, bộ chuyển thư, ma trận quyền, bảng đột biến) và test của nền sửa kèm mang ID TC gần nhất (`test/platform/events.spec.ts`). Bản chính của các TC SES dùng bộ chuyển thư giả (`FakeMail`); ca đường thật qua `SesTransport` và SES giả tự dựng nằm ở `test/notification/ses.spec.ts`.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| NTF-E2E-20261006-104226408 | E2E | apps/api/test/e2e/ntf.e2e.spec.ts | pass | YẾU: trình duyệt thật và API thật, nhưng email đi qua SES giả tự dựng; chưa thử với SES thật |
| NTF-E2E-20261006-104226475 | E2E | apps/api/test/e2e/ntf.e2e.spec.ts | pass | - |
| NTF-E2E-20261006-104226538 | E2E | apps/api/test/e2e/ntf.e2e.spec.ts | pass | - |
| NTF-E2E-20261006-104226604 | E2E | apps/api/test/e2e/ntf.e2e.spec.ts | pass | - |
| NTF-TC-20261006-104222533 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222599 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222664 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222732 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222796 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222863 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222929 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104222999 | TC | apps/api/test/notification/consume.spec.ts | pass | - |
| NTF-TC-20261006-104223060 | TC | apps/api/test/notification/consume.spec.ts | pass | Sau đồng bộ 2026-10-13: thêm `//intranet`, `//2130706433`, `///` (consume.spec.ts, db.spec.ts, web.spec.ts) và ca migration mới (db.spec.ts) |
| NTF-TC-20261006-104223120 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: bộ chuyển thư giả (FakeMail) ở bản chính và SES giả tự dựng (FakeSes) ở ca ses.spec; chưa thử với SES thật |
| NTF-TC-20261006-104223184 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: SES giả tự dựng, chưa thử với SES thật; chữ ký SigV4 có vectơ hằng số tính ngoài mã (ses.spec) |
| NTF-TC-20261006-104223250 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: lỗi throttling do bộ chuyển thư giả trả, chưa thử với SES thật |
| NTF-TC-20261006-104223313 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: lỗi vĩnh viễn do bộ chuyển thư giả trả, chưa thử với SES thật |
| NTF-TC-20261006-104223377 | TC | apps/api/test/notification/email.spec.ts | pass | - |
| NTF-TC-20261006-104223436 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: SES giả, chưa thử với SES thật; thời gian 0, 2, 7 giây đo bằng đồng hồ giả |
| NTF-TC-20261006-104223500 | TC | apps/api/test/notification/email.spec.ts | pass | - |
| NTF-TC-20261006-104223567 | TC | apps/api/test/notification/email.spec.ts | pass | - |
| NTF-TC-20261006-104223630 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: SES giả tự dựng, chưa thử với SES thật. Sau đồng bộ 2026-10-13 TC kiểm trường JSON `Subject`, `Destination.ToAddresses`, `Body` của yêu cầu SES v2 (ca qua `SesTransport` thật tới SES giả ở `apps/api/test/notification/ses.spec.ts`; bản `email.spec.ts` kiểm cùng nội dung trên bộ chuyển thư giả) |
| NTF-TC-20261006-104223696 | TC | apps/api/test/notification/email.spec.ts | pass | YẾU: hai lần chạy job trong cùng một tiến trình test (hai kết nối CSDL), không phải hai tiến trình hệ điều hành; SES giả |
| NTF-TC-20261006-104223757 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104223817 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104223876 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104223940 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224006 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224069 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224135 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224202 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224270 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224334 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224398 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224463 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224530 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224598 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224668 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224734 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224802 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224870 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104224940 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225009 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225075 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225139 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225207 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225276 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225336 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225404 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225469 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-104225530 | TC | apps/api/test/notification/account-events.spec.ts | pass | YẾU: SES giả, chưa thử với SES thật; liên kết kiểm trên thân thư giả |
| NTF-TC-20261006-104225595 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104225660 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104225728 | TC | apps/api/test/notification/account-events.spec.ts | pass | YẾU: SES giả, chưa thử với SES thật |
| NTF-TC-20261006-104225796 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104225862 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104225928 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104225997 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104226068 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104226136 | TC | apps/api/test/notification/account-events.spec.ts | pass | - |
| NTF-TC-20261006-104226204 | TC | apps/api/test/notification/alerts.spec.ts | pass | - |
| NTF-TC-20261006-104226272 | TC | apps/api/test/notification/alerts.spec.ts | pass | - |
| NTF-TC-20261006-104226338 | TC | apps/api/test/notification/alerts.spec.ts | pass | - |
| NTF-TC-20261006-104301546 | TC | apps/api/test/notification/alerts.spec.ts | pass | - |
| NTF-TC-20261006-104301655 | TC | apps/api/test/notification/alerts.spec.ts | pass | - |
| NTF-TC-20261006-104301770 | TC | apps/api/test/notification/alerts.spec.ts | pass | - |
| NTF-TC-20261006-104301925 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302026 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302157 | TC | apps/api/test/notification/read.spec.ts | pass | Sau đồng bộ 2026-10-13: khẳng định "cùng dãy câu SQL" thay ngưỡng thời gian 30% |
| NTF-TC-20261006-104302228 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302303 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302379 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302461 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302542 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302615 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302702 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302787 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302866 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104302943 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104303037 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104303133 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104303212 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-104303290 | TC | apps/api/test/notification/read.spec.ts | pass | - |
| NTF-TC-20261006-122758583 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-122759638 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-122800705 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-122801753 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-140547263 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-140547355 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-140547444 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261006-140547532 | TC | apps/api/test/notification/customer-events.spec.ts | pass | - |
| NTF-TC-20261015-092750240 | TC | apps/api/test/notification/customer-events.spec.ts | pass | Lệch nhỏ: `SKIP` của `prepare` không ghi ProcessedEvent (platform, như `recipient-not-found`), TC viết có dòng ProcessedEvent; ca kiểm 0 dòng và giao lại vô hại. Chỉ `user_id: null` hay rỗng là đơn hộ; khóa vắng hẳn vẫn là event hỏng (giữ NTF-TC-20261006-104224870) |

## Kiểm đột biến
Bảng có 100 đột biến (98 của implement cộng hai của đợt đồng bộ spec 2026-10-13, cả hai bắt ở lần chạy đầu; đột biến "CHECK link cho phép https và //" nay phá migration mới `20261013000300_notification_link_hardening`) chạy bằng `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-ntf.json --cwd apps/api` (mỗi dòng một lệnh Jest hẹp theo TC). Lần chạy đầu: 95 bắt, 3 lọt (log kèm payload dùng khóa `token_ref` bị bộ che của platform che giúp nên không phân biệt được; lý do khóa tự do bị chuẩn hóa lần hai khi dựng thư; ký tự điều khiển không phải khoảng trắng chưa có ca). Đã vá test (ca `ref:` không bị che, kiểm `data` lưu chỉ có mã chuẩn hóa, họ tên có ký tự điều khiển) và chạy lại ba dòng đó: cả ba bắt. Chạy xong đã so mã (băm SHA-1 trước và sau trên `apps/api/src`, `apps/api/prisma`, `apps/web`): không tệp nào đổi (mutate.mjs không khôi phục khi bị SIGKILL; lần này không bị ngắt). Mỗi SB `Kiểm bằng: test` của NTF-SEC có ít nhất một đột biến bắt được: SB-03, SB-05, SB-06, SB-07, SB-08, SB-11, SB-12, SB-13, SB-14, SB-18, SB-26, SB-27, SB-31, SB-34. Phủ cả nền sửa kèm (`events.service.ts`, `csrf.guard.ts`), từng CHECK, unique, khóa ngoại, trigger của migration và hàm thuần cùng hai trạng thái lỗi của giao diện (E2E). Cột Test đỏ của các đột biến theo tài liệu NTF-SEC hay NTF-DB ghi TC có cùng chủ đề trong bộ test đó (xem tên test).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| T1, T9 SB-06, SB-08: người nhận không tồn tại không bị bỏ qua (FK lỗi, event giao lại mãi) | NTF-TC-20261006-104222664 | bắt |
| T8 SB-27: bỏ ON CONFLICT ở INSERT notifications (khóa tự nhiên payment_id không còn chặn) | NTF-TC-20261006-104224270 | bắt |
| T10 SB-05, SB-07: cảnh báo tồn thấp gửi cả customer | NTF-TC-20261006-104226204 | bắt |
| T10 SB-05, SB-07: hoàn tiền thất bại gửi cả staff | NTF-TC-20261006-104226272 | bắt |
| SB-34: trần người nhận 200 thành 201 | NTF-TC-20261006-104301770 | bắt |
| T7 SB-18: log event token kèm payload (token thô vào log) | NTF-TC-20261006-104225796 | bắt |
| T15, BR5 SB-11: order_code không kiểm khuôn (liên kết lấy từ dữ liệu event) | NTF-TC-20261006-122800705 | bắt |
| T4 SB-12: mã vận đơn 31 ký tự lọt khuôn | NTF-TC-20261006-104224734 | bắt |
| T4 SB-12: mã vận đơn tối thiểu 8 thành 9 | NTF-TC-20261006-104224668 | bắt |
| BR2: was_paid không phải boolean cũng nêu hoàn tiền | NTF-TC-20261006-104225139 | bắt |
| BR1 K-03: is_final chuỗi cũng coi là cuối | NTF-TC-20261006-104225469 | bắt |
| T18 SB-34: reason giao thất bại tự do được đưa vào mẫu | NTF-TC-20261006-104224598 | bắt |
| BR3: amount 0 của PaymentSucceeded được nhận | NTF-TC-20261006-104224202 | bắt |
| BR3: số thực được coi là số tiền hợp lệ | NTF-TC-20261006-104223940 | bắt |
| BR3: định dạng tiền mất dấu chấm ngăn nghìn | NTF-TC-20261006-104223757 | bắt |
| BR8: giờ Việt Nam lệch một giờ | NTF-TC-20261006-104223817 | bắt |
| BR7: hạn thanh toán đã qua vẫn được nhắc | NTF-TC-20261006-104223817 | bắt |
| T18 BR7: lý do khóa của admin đi thẳng vào mẫu | NTF-TC-20261006-104225928 | bắt |
| BR1: dùng on_hand thay available | NTF-TC-20261006-104226204 | bắt |
| BR1: 8 ký tự đầu thành 9 | NTF-TC-20261006-104226204 | bắt |
| T9 SB-08: UserRegistered ghi email của payload vào data thông báo | NTF-TC-20261006-104226068 | bắt |
| BR3 token: token_ref tới 129 ký tự | NTF-TC-20261006-104225796 | bắt |
| BR4: expires_at đúng lúc xử lý vẫn gửi | NTF-TC-20261006-104226136 | bắt |
| T4 SB-12: HTML không escape < và > | NTF-TC-20261006-104223630 | bắt |
| T3 BR7: lời chào dài 51 ký tự | NTF-TC-20261006-104223630 | bắt |
| T3 SB-11: họ tên vào tiêu đề thư | NTF-TC-20261006-104223630 | bắt |
| T15 BR8: liên kết email không dùng APP_BASE_URL | NTF-TC-20261006-104223060 | bắt |
| T3 SB-11: ký tự xuống dòng trong họ tên không bị thay | NTF-TC-20261006-104223630 | bắt |
| T4 SB-12: dữ liệu email hỏng được chèn nguyên (order_code không kiểm lại) | NTF-TC-20261006-104225530 | bắt |
| L113 SB-11: nửa cặp thay thế lẻ không bị bỏ | NTF-TC-20261006-104222599 | bắt |
| T11 SB-26: email giao dịch gửi cả địa chỉ chưa xác minh | NTF-TC-20261006-104223377 | bắt |
| T5 SB-14: hạn mức email thường 30 thành 31 | NTF-TC-20261006-104223500 | bắt |
| T5 SB-14: cửa sổ 24 giờ thành 25 giờ | NTF-TC-20261006-104223500 | bắt |
| T5 SB-14: hạn mức email đặt lại 10 thành 11 | NTF-TC-20261006-104223567 | bắt |
| T5 SB-14: cửa sổ 1 giờ của email đặt lại thành 2 giờ | NTF-TC-20261006-104223567 | bắt |
| T17 SB-34: lần thử lại thứ hai sau 1 phút thay vì 5 phút | NTF-TC-20261006-104223250 | bắt |
| T17 SB-34: lỗi vĩnh viễn vẫn thử lại | NTF-TC-20261006-104223313 | bắt |
| T17 SB-34: không thuê dòng khi nhận việc (hai job gửi trùng) | NTF-TC-20261006-104223696 | bắt |
| L102 SB-34: lô 50 thành 500 dòng | NTF-TC-20261006-104223696 | bắt |
| BR6 T17: thử lại email bí mật 2 giây rồi 2 giây | NTF-TC-20261006-104223436 | bắt |
| T2 SB-03, SB-18: token vào log khi gửi bí mật thất bại | NTF-TC-20261006-104223436 | bắt |
| T2 SB-03, SB-26: token đi vào dedupe_key của bản ghi | NTF-TC-20261006-104223184 | bắt |
| BR6: bản ghi bí mật kẹt chỉ chờ 1 phút | NTF-TC-20261006-104223436 | bắt |
| T14: ký SigV4 sai dịch vụ (s3 thay ses) | NTF-TC-20261006-104223120 | bắt |
| T17: throttling coi là lỗi vĩnh viễn | NTF-TC-20261006-104223120 | bắt |
| T14: lỗi chữ ký coi là tạm thời | NTF-TC-20261006-104223120 | bắt |
| T15 SB-09: APP_BASE_URL http được chấp nhận ngoài dev | NTF-TC-20261006-104223120 | bắt |
| T15 SB-16: gốc URL có đường dẫn con được chấp nhận | NTF-TC-20261006-104223120 | bắt |
| T1 SB-06: UPDATE đánh dấu đọc không ràng buộc user_id | NTF-TC-20261006-104302157 | bắt |
| T1 SB-06: SELECT phân biệt đã đọc không ràng buộc user_id | NTF-TC-20261006-104302157 | bắt |
| T1 SB-06: read-all đánh dấu cả thông báo người khác | NTF-TC-20261006-104302026 | bắt |
| T1 SB-06: danh sách không lọc theo người gọi | NTF-TC-20261006-104303037 | bắt |
| T1 SB-06: đếm chưa đọc tính cả người khác | NTF-TC-20261006-104302026 | bắt |
| BR4: đếm chưa đọc tính cả đã đọc | NTF-TC-20261006-104301925 | bắt |
| BR1: sắp cũ nhất trước | NTF-TC-20261006-104302787 | bắt |
| T1 SB-06: id sai dạng không đi cùng đường (500 thay vì 404) | NTF-TC-20261006-104302157 | bắt |
| BR3: up_to ở tương lai không bị kẹp | NTF-TC-20261006-104302542 | bắt |
| BR4: hạn lưu hiển thị 180 thành 182 ngày | NTF-TC-20261006-104303212 | bắt |
| BR2: bỏ lọc theo type | NTF-TC-20261006-104302866 | bắt |
| BR2: bỏ lọc theo status | NTF-TC-20261006-104302866 | bắt |
| T1, T10 SB-05, SB-07: staff và admin bị chặn khỏi lịch sử (code lệch ma trận) | NTF-TC-20261006-104303290 | bắt |
| T12 SB-14: read-all không giới hạn tần suất | NTF-TC-20261006-104303133 | bắt |
| BR2: POST read trả 201 thay vì 200 | NTF-TC-20261006-104301925 | bắt |
| T1 SB-11: trường lạ trong body không bị từ chối | NTF-TC-20261006-104302379 | bắt |
| T1 SB-11: tham số lạ user_id ở danh sách không bị từ chối | NTF-TC-20261006-104303037 | bắt |
| T12 SB-11: type không kiểm theo 15 loại | NTF-TC-20261006-104302943 | bắt |
| BR3 SB-11: up_to không kiểm dạng ISO có múi giờ | NTF-TC-20261006-104302379 | bắt |
| T13 SB-13: CSRF không kiểm Origin | NTF-TC-20261006-104302303 | bắt |
| ADR-022: hạn lưu email 90 thành 92 ngày | NTF-TC-20261006-104222999 | bắt |
| ADR-022: lô dọn 1000 thành 2000 | NTF-TC-20261006-104222999 | bắt |
| SB-27: SKIP không được coi là đã xử lý (platform) | NTF-TC-20261006-104222664 | bắt |
| SB-31, L71: pha chuẩn bị chạy TRONG giao dịch (hold-and-wait ở pool nhỏ) | NTF-TC-20261006-104222863 | bắt |
| SB-27, K-14: handler raw của event token không chạy | NTF-TC-20261006-104223184 | bắt |
| K-14: subscribeRaw nhận cả event đi outbox | NTF-TC-20261006-104223184 | bắt |
| NTF-DB: title tối đa 120 thành 121 | NTF-TC-20261006-104223060 | bắt |
| NTF-DB: body tối đa 500 thành 501 | NTF-TC-20261006-104223060 | bắt |
| T15 SB-11: CHECK link cho phép https và // | NTF-TC-20261006-104223060 | bắt |
| NTF-DB: CHECK data là đối tượng bị gỡ | NTF-TC-20261006-104223060 | bắt |
| SB-24: CHECK status và read_at bị gỡ | NTF-TC-20261006-104223060 | bắt |
| NTF-DB: độ dài dedupe_key 120 thành 121 (notifications) | NTF-TC-20261006-104301655 | bắt |
| NTF-DB: attempts tối đa 3 thành 4 | NTF-TC-20261006-104223184 | bắt |
| NTF-DB: delivery_reason 50 thành 51 | NTF-TC-20261006-104223184 | bắt |
| T2 SB-03: CHECK email bí mật không có data bị gỡ | NTF-TC-20261006-104223184 | bắt |
| T8 SB-27: unique (user_id, dedupe_key) thành chỉ mục thường | NTF-TC-20261006-104222863 | bắt |
| T8 SB-27: unique email (user_id, type, dedupe_key) thành chỉ mục thường | NTF-TC-20261006-104301655 | bắt |
| BR4 SB-27: unique một phần low_stock thành chỉ mục thường | NTF-TC-20261006-104301655 | bắt |
| BR4 SB-27: unique một phần refund_failed thành chỉ mục thường | NTF-TC-20261006-104301655 | bắt |
| NTF-DB: khóa ngoại notifications CASCADE thành RESTRICT | NTF-TC-20261006-104301655 | bắt |
| SB-24: trigger thông báo cho phép read quay lại unread | NTF-TC-20261006-104302461 | bắt |
| SB-24: trigger thông báo cho phép sửa nội dung | NTF-TC-20261006-104302461 | bắt |
| SB-24: trigger email cho phép đổi trạng thái cuối | NTF-TC-20261006-104302461 | bắt |
| NTF-DB: enum kênh có thêm email | NTF-TC-20261006-140547263 | bắt |
| UI: huy hiệu hiện "99+" từ 99 | NTF-TC-20261006-104302702 | bắt |
| T10 UI: customer thấy loại tồn kho | NTF-TC-20261006-104303290 | bắt |
| T15 UI: liên kết ngoài được điều hướng | NTF-TC-20261006-104223060 | bắt |
| UI 429: trang danh sách không nêu "Thử lại sau ít giây" | NTF-E2E-20261006-104226604 | bắt |
| UI 500: khung chuông không nêu thông điệp lỗi tải | NTF-E2E-20261006-104226604 | bắt |
| UI: Esc không đóng khung (esc handler bỏ) | NTF-E2E-20261006-104226408 | bắt |
| T15 REV-NTF-04: CHECK link quay về biểu thức cũ cho qua `//` đầu (migration mới) | NTF-TC-20261006-104223060 | bắt |
| T1 REV-NTF-11: id sai dạng trả 404 ngay không chạy câu SQL nào (khác dãy câu SQL của hai nhánh kia) | NTF-TC-20261006-104302157 | bắt |


## Lệch spec
1. [đã chọn] Sửa nền `apps/api/src/modules/platform/events/events.service.ts` và `index.ts` (consumer hai pha `subscribePrepared` kèm `SKIP`, consumer thuần bộ nhớ `subscribeRaw` cho hai event token, `idle()`). NTF-DB mục Giao dịch và khóa 2 đòi gọi AUTH TRƯỚC khi mở giao dịch (SB-31), trong khi `deliver` của PRJ chèn `processed_events` rồi chạy handler trong giao dịch nên handler phải giữ kết nối thứ nhất rồi xin kết nối thứ hai (hold-and-wait, L71, L87, L117). Chọn thêm pha `prepare` chạy ngoài giao dịch (kiểm dạng payload, hỏi AUTH, ném lỗi tạm thời cho relay giao lại, trả `SKIP` khi không cần xử lý) và pha `handle` trong giao dịch; `subscribe` cũ giữ nguyên. Event token không có `processed_events` (không qua outbox, K-14) nên chạy bằng `subscribeRaw` sau commit của AUTH. Test của chỗ sửa: NTF-TC-20261006-104222732 (prepare ngoài giao dịch, lỗi tạm thời không để lại dấu vết), NTF-TC-20261006-104222664 (SKIP không giao lại), NTF-TC-20261006-104223184 (raw, lỗi chỉ log không payload, `idle`) ở `apps/api/test/platform/events.spec.ts`; NTF-TC-20261006-104222863 ở `apps/api/test/notification/review.spec.ts` (pool 2 kết nối, 30 việc đồng thời không treo). Cả bốn đều có đột biến bắt được (bảng trên). Rủi ro: hai đường giao event (`handler` và `prepared`) cùng sống ở platform; consumer hai pha gọi `prepare` cả khi event đã xử lý (một lời gọi AUTH thừa trước khi bị chặn ở `processed_events`).
2. [đã chọn] Nền (ADR-011, PRJ-API/PRJ-REQ) chưa nêu consumer hai pha, `SKIP` và consumer raw cho event token: [đã đồng bộ 2026-10-13] ADR-011 (consumer hai pha, `SKIP`, `subscribeRaw`, `idle()`), PRJ-REQ BR12 và BR13, PRJ-DB mục 5, PRJ-API và NTF-DB mục Giao dịch và khóa 1 và 2 nay ghi dạng hai pha (`spec/changes/nen-dong-bo-20261013.md`, `spec/changes/ntf-dong-bo-spec-20261013.md`); chỗ sửa của mục 1 có spec bảo chứng.
3. [đã chọn] [đã đồng bộ 2026-10-13: ADR-010 và NTF-API ghi cách gọi này, NTF-TC ...630 kiểm trường JSON] Gửi email bằng Amazon SES v2 `POST /v2/email/outbound-emails` với nội dung `Simple` (JSON có trường riêng `Subject`, `Destination.ToAddresses`, `Body.Text`, `Body.Html`) ký SigV4 bằng bộ ký dùng chung của platform (`signV4`, dịch vụ `ses`), không thêm AWS SDK (ADR-010 nêu "qua SDK") và không dựng thông điệp MIME bằng tay: không có chỗ để chèn header `Bcc`, `Subject` qua xuống dòng (T3). Hệ quả: NTF-TC-20261006-104223630 kiểm các trường JSON và tập khóa của thông điệp thay vì header MIME thô như TC mô tả (xem YẾU ở mục 5). Rủi ro: SES thật có thể đòi header hay cấu hình khác với SES giả; đã có vectơ HẰNG SỐ tính ngoài mã bằng Python (`hmac`, `hashlib`) cho chữ ký vùng `ap-southeast-1` dịch vụ `ses` trong `test/notification/ses.spec.ts` (vectơ tự tính ngoài mã, không phải vectơ do AWS phát hành).
4. [đã chọn] Biến cấu hình thêm ngoài ADR-007 (chỉ liệt kê `SES_REGION`, `MAIL_FROM`, `APP_BASE_URL`): `SES_ACCESS_KEY`, `SES_SECRET_KEY` (bí mật, bắt buộc ngoài dev theo NTF-API "khóa truy cập SES lấy từ kho bí mật của host") và `SES_ENDPOINT` (tùy chọn, cho điểm cuối riêng hay bộ giả lập; không bắt buộc ngoài dev). [đã đồng bộ 2026-10-13] ADR-007 liệt kê đủ sáu biến và NTF-API mục Dịch vụ ngoài trỏ về ADR-007. Mặc định dev: khóa trống thì mọi email thất bại ngay với mã `ses_unconfigured` (không gọi mạng, thông báo trong ứng dụng không bị ảnh hưởng); `APP_BASE_URL` trống ở dev dùng `http://localhost:3801`; ngoài dev `APP_BASE_URL` và `SES_ENDPOINT` phải https (khởi động dừng nêu tên biến). Đã ghi vào `.env.example`.
5. [đã chọn] Bằng chứng YẾU về SES: NTF-TC-20261006-104223120, NTF-TC-20261006-104223184, NTF-TC-20261006-104223250, NTF-TC-20261006-104223313, NTF-TC-20261006-104223436, NTF-TC-20261006-104223630, NTF-TC-20261006-104223696, NTF-TC-20261006-104225530, NTF-TC-20261006-104225728 và NTF-E2E-20261006-104226408 chạy với bộ chuyển thư giả (`FakeMail`) hoặc SES giả tự dựng (`FakeSes`, kiểm chữ ký bằng chính hàm ký của mã, hạn mức và hạn gọi 10 giây không có ở SES giả) và đồng hồ giả; NTF-TC-20261006-104223696 còn dùng hai lần chạy job trong cùng một tiến trình test (hai kết nối CSDL) thay vì hai tiến trình hệ điều hành. Chưa thử với SES thật (sandbox hay production). Cách nâng bằng chứng: chạy một lượt với tài khoản SES sandbox (người gửi và người nhận đã xác minh), so chữ ký SigV4 và nội dung nhận được, thêm ca chạy hai tiến trình `node` thật cho job gửi.
6. [đã chọn] Hai trigger vòng đời ngoài NTF-DB (migration): `notifications` chỉ `unread -> read`, `read_at` và nội dung bất biến; `email_deliveries` chỉ rời `pending` một lần, trạng thái cuối bất biến. Lớp bảo vệ thứ hai của SB-24 (mã dùng điều kiện `status` trong câu UPDATE là lớp một). Ca: NTF-TC-20261006-104302461 (bản db.spec) và các đột biến trigger trong bảng trên. [đã đồng bộ 2026-10-13, REV-NTF-09] NTF-DB nay ghi hai trigger ở Trạng thái hợp lệ và Migration mục 3.
7. [đã chọn] Hạn lưu 180 ngày áp cả cho `unread_count` và `POST /notifications/{id}/read` (thông báo quá hạn chưa bị dọn: không đếm, đánh dấu cho 404), không chỉ cho danh sách (NTF-REQ-20261006-103209345 BR4 chỉ nêu danh sách): nếu không, chuông đếm số thông báo mà người dùng không bao giờ thấy. NTF-TC-20261006-104303212 kiểm cả hai.
8. [đã chọn] Hàm dọn là job riêng `notification.cleanup` (mỗi giờ, đăng ký với `JobRunner`) thay vì hàm do job dọn chung của platform gọi: SB-35 giao việc dọn bảng của module cho module chủ, `RetentionService` của platform không đổi. Lô 1000, mỗi lô một giao dịch, hạn thời gian cho cả lượt (SB-34). NTF-TC-20261006-104222999. Log ghi số bản ghi ở khóa `deliveries` (tên `email_deliveries` bị bộ che của platform thay bằng `[REDACTED]` vì chứa "email").
9. [đã chọn] SB-18 chưa nêu dạng `user_id` được phép trong log (L115): NTF-TC-20261006-104222664 và NTF-TC-20261006-140547355 đòi log nêu `user_id` của người nhận không tồn tại nên mã ghi uuid nguyên văn (chỉ khi đúng dạng uuid, ngược lại `null`; không bao giờ email, họ tên, payload, giá trị trường lạ). CRT chọn băm. [đã đồng bộ 2026-10-13] SB-18 chốt `user_id` nguyên văn cho mọi module; NTF-SEC T7 ghi "log theo SB-18"; mã NTF không đổi.
10. [đã chọn] Trần 200 người nhận (NTF-REQ-20261006-103209168 BR6): `AuthApi.listActiveUserIdsByRole` tự cắt ở 200 nên NTF không phân biệt "đúng 200" với "nhiều hơn 200"; ghi log warn `recipients-capped` mỗi khi nhận đủ 200 id. NTF-TC-20261006-104301770 (A và B) qua.
11. [đã chọn] Hạn mức email theo người nhận (bậc E của SB-14): đếm `sent` trong 24 giờ dưới `pg_advisory_xact_lock` theo người nhận ở bước nhận việc, nhưng `sent` chỉ được ghi sau khi SES trả lời; một lượt job xử lý tuần tự và `JobRunner` chỉ cho một lượt chạy trên toàn cụm nên không vượt ngưỡng. Hai lần `sendDue` chạy song song thật sự (chỉ có ở test) cùng thấy dưới ngưỡng ở khe giữa nhận việc và ghi `sent` (thừa tối đa số dòng đang bay). [đã khắc phục ở review NTF, REV-NTF-01: bước nhận việc đếm thêm dòng đang gửi dở của lượt khác (`delivery_reason = 'sending'`, còn thuê), ca REV-NTF-P01 ở `apps/api/test/notification/rev.spec.ts`; số test sau review: 1445.] Email bí mật đếm thêm bản ghi `pending` dưới 5 phút để các yêu cầu dồn dập không cùng lọt.
12. [đã chọn] Nội dung spec chưa nêu, chọn mặc định hợp lý: liên kết của `payment_failed` và `order_cancelled` là `/orders/<mã>` (hoặc `/orders`); `PasswordChanged` thiếu hay sai `changed_at` thì dùng `occurred_at` của phong bì và log warn; mọi event đơn đòi `order_id` đúng uuid (spec chỉ nêu cho OrderDelivered và OrderExpired), sai thì không tạo gì và log error; `payment_id` của PaymentFailed không bắt buộc (không dùng); khóa chống trùng mặc định `<type>:<event_id>`. Rủi ro: producer gửi `order_id` rỗng sẽ không có thông báo (có log error).
13. [đã chọn] `consumer` của `processed_events` là `NTF` (viết hoa, đúng spec), khác `cart`, `shipping`, `payment` (tên module): không ảnh hưởng chống trùng vì mỗi consumer một cặp khóa.
14. [đã chọn] Giao diện: `ntf-notification-list-status-filter` là nhóm ba nút (tab) có `aria-pressed` và không có dropdown riêng dưới `sm` (ui/notification-list nêu "dropdown dưới sm"; [đã đồng bộ 2026-10-13, REV-NTF-15] ui/notification-list nay ghi nhóm nút ở mọi khổ, không dropdown): nhóm nút tự xuống dòng ở 375px; chuông là chữ "Chuông" kèm huy hiệu (chưa có thư viện biểu tượng); khung 5 thông báo đóng bằng Esc hay chạm ngoài; huy hiệu làm mới mỗi 60 giây khi tab hiện và sau mọi thao tác đọc; điều hướng chỉ tới đường dẫn nội bộ (`safeLink`). Trên điện thoại khung phủ gần hết chiều ngang (CSS `max-width: 480px`), chưa có ca E2E ở khổ này.
15. [chưa làm] E2E hay đột biến cho trạng thái "hết phiên" (401) của chuông (chuông biến mất) và của trang danh sách (chuyển về đăng nhập): mã có xử lý nhưng chưa có ca (L116). Hai trạng thái lỗi 500 và 429 đã có E2E kèm đột biến (NTF-E2E-20261006-104226604) và có đường thoát (Thử lại; toast lỗi đánh dấu tự biến mất sau 4 giây).
16. [chưa làm] Tùy chọn nhận email và liên kết hủy đăng ký: spec NTF v1 không có; bounce và complaint từ SES không xử lý (đã chốt chấp nhận ở NTF-SEC Rủi ro còn lại, phải xử lý trước khi chạy production có lưu lượng thật). Thông báo `failed` và `skipped` trong `email_deliveries` là "hộp thư chết" giữ 90 ngày, chưa có màn xem hay cách đẩy lại.
17. [đã chọn] Sửa nền của test và mã module khác kèm theo (L53): `apps/api/src/modules/platform/events/events.service.ts`, `apps/api/src/modules/platform/index.ts` (mục 1, test ở mục 1); `apps/api/prisma/schema/auth.prisma` thêm hai quan hệ ngược `notifications`, `emailDeliveries` (khóa ngoại NTF tới `users`, không đổi cột; kiểm bằng `check-migrations` khớp migration); `apps/api/test/support/app.ts` (`baseEnv` tự thêm năm biến SES cho staging và prod), `apps/api/test/support/db.ts` (thêm hai bảng vào `TABLES`), `apps/api/test/payment/guard.spec.ts` (môi trường prod thêm biến SES để chỉ còn biến của PAY là thứ thiếu; NTF-TC-20261006-104223436 và NTF-SEC T14 trong `ses.spec.ts` kiểm cùng cơ chế), `apps/api/test/e2e/server.ts` và `support.ts` (SES giả, bảng thông báo ở `/reset`, bốn điểm điều khiển). Tăng số tiến trình nền: `main.ts` đã gọi `jobs.start()` nên hai job mới của NTF tự chạy.
18. [đã chọn] Dữ liệu thời gian của các ca đọc theo `now()` của CSDL (thông báo `created_at` do CSDL đặt bằng `clock_timestamp()`), còn job gửi email theo `Clock` của ứng dụng (đồng hồ giả của test); `next_attempt_at` của dòng email mới lấy từ `Clock`. Mốc cố định `2026-10-06T...` trong test giữ lại đúng như ví dụ của TC kèm chú thích `fixed-clock:` (prepare đọc `Clock` đã giả).
19. [đã chọn] Ngưỡng "cùng bậc thời gian" của NTF-TC-20261006-104302157 (chênh trung vị dưới 30%) là mặc định chưa có người chốt (questions.md câu 21): đo xen kẽ bằng `medianPairMs` trên 30 cặp cho hai cặp nhánh; chạy 3 lần liên tiếp đều qua, nhưng ngưỡng 30% trên máy tải nặng có thể chập chờn. [đã chốt 2026-10-13, REV-NTF-11] bỏ ngưỡng, thay bằng khẳng định "cùng dãy câu SQL": TC sửa lại và `apps/api/test/notification/read.spec.ts` ghi văn bản và thứ tự mọi câu truy vấn của ba nhánh 404 (người khác, id không tồn tại, id sai dạng) rồi đòi ba dãy bằng nhau; đột biến "id sai dạng trả 404 ngay không chạy câu SQL nào" bắt được.
20. [đã chọn] Cách chạy `clean_run` (làm khi implement, theo công thức PRJ mục 34; mã chưa commit nên chỉ gần giống CI): `git worktree add --detach` tại `c557cdb`, phủ các tệp sửa, tệp xóa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH`, `HOME` là thư mục rỗng riêng (HOME rỗng chuỗi làm pnpm báo "Could not find the homedir"), `CI=true`, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`, `PLAYWRIGHT_BROWSERS_PATH`; `pnpm install --frozen-lockfile --offline --store-dir <kho của máy>`; PostgreSQL 16 và MinIO của Docker (`-p minsdlc-r`). Đã chạy trong bản clone: install, scan:secrets, check:boundaries, lint, typecheck, test, build, đều qua (kết quả ở `test_result`). Không chạy: workflow trên GitHub (chưa push), `check-migration-compat --base` (chỉ cho pull request; chạy trực tiếp trên tệp migration mới thì qua trong `db.spec.ts`), `psql -f 01-app-roles.sql` (`globalSetup` chạy cùng tệp).

21. [đã chọn] Đồng bộ spec 2026-10-13 (`spec/changes/ntf-dong-bo-spec-20261013.md`): CHECK `notifications.link` không cho `//` đầu (biểu thức `^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$`). Migration `20261009000300_notification_tables` đã áp dụng nên KHÔNG sửa tại chỗ; migration mới `apps/api/prisma/migrations/20261013000300_notification_link_hardening/migration.sql` thêm CHECK `notifications_link_internal_v2` rồi bỏ CHECK cũ, bước thu hẹp có dòng `-- contract-step: 20261009000300_notification_tables` để qua `check-migration-compat` (chạy trực tiếp trên tệp: qua; ca ở `db.spec.ts` kiểm cả hai chiều: có dòng thì qua, bỏ dòng thì đỏ). `db.spec.ts` kiểm `//intranet`, `//2130706433`, `///`, `//a`, `//` bị CHECK từ chối và `/`, `/a/b`, `/_x`, `/-x` được nhận; chỉ còn CHECK `v2`.
22. [đã chọn] Đồng bộ spec 2026-10-13: `safeLink` ở web (`apps/web/lib/notification-const.ts:24`) giữ nguyên biểu thức `^/(?!/)[A-Za-z0-9/_-]*$` (cùng ngôn ngữ với CHECK mới; chỉ sửa chú thích). Trang `/notifications` đổi hàm `go` tự dựng sang hook dùng chung `useQueryGo` (`apps/web/components/useQueryGo.ts`, REV-REV-12): cùng hành vi (đổi bộ lọc về trang 1, `go({ page })` giữ trang) và nay cộng dồn hai lần đổi liền nhau.
23. [đã chọn] Đồng bộ spec 2026-10-13, REV-NTF-08: ca mới `NTF-TC-20261006-104223630` ở `apps/api/test/notification/ses.spec.ts` chạy job gửi qua `SesTransport` thật tới SES giả và kiểm yêu cầu JSON (khóa cấp cao chỉ `Content`, `Destination`, `FromEmailAddress`; `Destination` chỉ có `ToAddresses`; không CR hay LF ở trường tiêu đề và địa chỉ; lời chào bỏ xuống dòng; HTML escape).
24. [đã chọn] Quyết định (5) của đợt đồng bộ ("job nền có TC cho NTF nếu NTF-DB thiếu"): không thiếu, `check-tests --strict` không báo job nào của NTF; không thêm TC. 429 ở bảng lỗi NTF-API đã có sẵn ở cả bốn endpoint. Lượt chạy cuối của đợt đồng bộ: 209 bộ, 1788 test, 1788 pass (`test_result`).
25. [đã chọn] **Đợt bán hộ 2026-10-15**: `ORDER_CODE_RE` nhận cả `HDyymmdd-NNNNN` (trước đó mã mới bị bỏ khỏi nội dung và liên kết chung); `planEvent` trả `{ ok: false, skip: true }` cho 11 event đơn, thanh toán, vận đơn có `user_id` `null` hay `''` và `prepare` trả `SKIP` không log (events.md mục Đơn hộ). Khóa `user_id` vắng hẳn vẫn là event hỏng log error (NTF-TC-20261006-104224870 còn nguyên, ORD phát `null` chứ không bỏ khóa). `SKIP` không ghi ProcessedEvent (hành vi platform có sẵn) trong khi NTF-TC-20261015-092750240 viết "ProcessedEvent có dòng cho mỗi event_id": ca kiểm 0 dòng; lead xem có cần sửa TC hay đổi sang nhánh `handle` rỗng.
26. [cần quyết] Sale đọc thông báo của chính mình GIỐNG HỆT staff (sửa sau review AUTH đợt bán hộ): bốn `@Roles` của `apps/api/src/modules/notification/notification.controller.ts` thêm `sale`, trang web `/notifications` mở cho `sale`, chuông thông báo hiện ở đầu trang của sale; ma trận `spec/permissions-matrix.md` cột `sale` của bốn hàng endpoint NTF (NTF-REQ-20261006-103209256 ba hàng, NTF-REQ-20261006-103209345 một hàng) đặt `own`. Test: `apps/api/test/notification/guard.spec.ts` (sale đọc, đánh dấu đọc; cột sale bằng cột staff; ma trận bỏ sale thì bị báo). Giữ nguyên: các hàng tạo thông báo từ event (do hệ thống) có cột `sale` `-` (người nhận theo `user_id` của chủ nên thông báo như `password_changed` vẫn tạo cho sale, không lọc theo role), và `typesFor` ở web cho sale chỉ các loại của customer (không `low_stock`, như cảnh báo tồn chỉ gửi staff, admin). Lệch spec: hai requirement NTF trên có `roles:` chưa gồm `sale`: cần `sdlc-impact` thêm `sale` vào `roles:` (lead làm; tài liệu requirement KHÔNG sửa ở đây).
