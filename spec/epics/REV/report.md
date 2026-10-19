---
epic: REV
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: REV

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền của module (cấu hình, lỗi, schema đầu vào, Idempotency-Key), sửa nền kèm theo của ORD, xử lý ảnh, tạo, sửa, xóa, kiểm duyệt, đọc, ghép vào AppModule, test API, giao diện web, E2E và bảng đột biến. Mọi task `done`; không có task `blocked`. REV phụ thuộc PRD (`CatalogApi.getSummaries`), ORD (`OrderApi.getDeliveredItems` và `hasUndeliveredItems` mới), AUTH (`AuthApi.getDisplayNames`) qua điểm vào `index.ts` của từng module (kiểm bằng `check:boundaries`); phần dùng chung của platform không khai (ADR-012).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261010000100_review_tables` và `review.prisma` (2 bảng, 2 enum, CHECK, hai unique một phần, chỉ mục một phần theo `status = 'published'`, chỉ mục biểu thức cho job dọn, khóa ngoại RESTRICT) và quan hệ ngược ở `auth.prisma`, `catalog.prisma`, `order.prisma` | REV-DB-20261006-103618216 | - | done |
| 2 | Nền của module: biến `REVIEW_PRE_MODERATION` và `REV_IMAGE_PROCESS_TIMEOUT_MS`, mã lỗi `review-conflict`, schema zod đóng (điểm, bình luận NFC, `image_ids`, lý do, truy vấn), `Idempotency-Key`, `Cache-Control: no-store`, bảng bậc SB-14, bảng chuyển trạng thái kiểm duyệt | REV-API-20261006-103618306, REV-SEC-20261006-103618395 | 1 | done |
| 3 | Sửa nền ORD: `OrderApi.hasUndeliveredItems(user_id, product_id)` để phân biệt `not_delivered` với `not_purchased` (REV-REQ BR3), kèm test nền | REV-REQ-20261006-103135296 | - | done |
| 4 | Ảnh đính kèm: bộ xử lý (magic bytes, kích thước từ tiêu đề, re-encode WebP bỏ metadata), tải lên theo luồng, gắn ảnh trong giao dịch, job `rev.sweep-orphan-images` | REV-REQ-20261006-103135207, REV-SEC-20261006-103618395 | 1, 2 | done |
| 5 | Tạo đánh giá và kiểm điều kiện (mua có xác minh, cửa sổ 90 ngày, một đánh giá mỗi sản phẩm, `Idempotency-Key`, đua tạo đồng thời), điểm, bình luận | REV-REQ-20261006-103134939, REV-REQ-20261006-103135029, REV-REQ-20261006-103135117, REV-REQ-20261006-103135296 | 1, 2, 3, 4 | done |
| 6 | Sửa (về `pending` khi bật kiểm duyệt trước, `ReviewUnpublished`, `ReviewRatingChanged`) và xóa (chủ, admin, audit, `ReviewDeleted`) | REV-REQ-20261006-103135385, REV-REQ-20261006-103135477 | 5 | done |
| 7 | Kiểm duyệt (duyệt, từ chối, ẩn, bỏ ẩn) và hàng đợi của admin, audit và event cùng giao dịch | REV-REQ-20261006-103135835, REV-REQ-20261006-103135744 | 5 | done |
| 8 | Đọc công khai (phân trang, lọc, sắp xếp, `summary`, tên đã che qua AUTH), đọc của tôi | REV-REQ-20261006-103135566, REV-REQ-20261006-103135655 | 5 | done |
| 9 | Ghép `ReviewModule` vào `AppModule`, ma trận quyền (`@Action`), ranh giới module, điểm điều khiển E2E | REV-API-20261006-103618306 | 5, 6, 7, 8 | done |
| 10 | Test API trên PostgreSQL thật (14 tệp ở `apps/api/test/review`, S3 giả tự dựng kiểm SigV4 và MinIO thật, tiến trình bị SIGKILL, pool 2 kết nối, consumer thật của PRD, tải hỗn hợp kiểm bảo toàn) và test nền của ORD | REV-SEC-20261006-103618395, REV-DB-20261006-103618216 | 9 | done |
| 11 | Giao diện web: `/products/{id}/reviews`, form viết và sửa, `/me/reviews`, `/admin/reviews`, liên kết ở chi tiết sản phẩm và thanh đầu trang | ui/product-reviews, ui/review-form, ui/my-reviews, ui/admin-moderation | 8 | done |
| 12 | E2E trình duyệt thật (API thật, kho ảnh MinIO thật, luồng THẬT đặt hàng COD, bàn giao, giao hàng, đánh giá, duyệt, điểm ở trang sản phẩm) và điểm điều khiển `/seed-review`, `/review-state`, `/set-pre-moderation` | REV-E2E-20261006-104528360, REV-E2E-20261006-104528391, REV-E2E-20261006-104528424, REV-E2E-20261006-104528456, REV-E2E-20261006-104528486, REV-E2E-20261006-104528519, REV-E2E-20261006-104528550, REV-E2E-20261006-104528580, REV-E2E-20261006-104528614, REV-E2E-20261006-140000006 | 10, 11 | done |
| 13 | Bảng đột biến REV và cổng kiểm của nó (`scripts/mutations-rev.json`, `test/tooling/mutations-rev.spec.ts`) | REV-SEC-20261006-103618395 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (100 TC, 10 E2E; chín TC mới của đợt đồng bộ spec 2026-10-13). Ngoài các ID này còn các test mang ID tài liệu REV-DB và REV-SEC (lược đồ, cấu hình, ma trận quyền, ranh giới, tải hỗn hợp, ma trận thao tác x trạng thái, XSS trên DOM, bảng đột biến), test kho MinIO thật (`images.minio.spec.ts`, chỉ chạy khi có `STORAGE_TEST_ENDPOINT`) và test của nền sửa kèm mang ID TC gần nhất (`apps/api/test/order/rev-undelivered.spec.ts`, `apps/api/test/order/guard.spec.ts`, `apps/api/test/catalog/guard.spec.ts`, `apps/api/test/order/create.spec.ts`). Cột Test code ghi tệp chính; một TC có thể có thêm bản ở tệp khác (ví dụ ma trận quyền ở `guard.spec.ts`).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| REV-E2E-20261006-104528360 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | YẾU: tệp ảnh JPEG 1200 x 900 (khoảng vài trăm KB), không phải 1 MB; kho ảnh là MinIO thật khi có STORAGE_TEST_ENDPOINT, S3 giả khi không |
| REV-E2E-20261006-104528391 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528424 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528456 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528486 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528519 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528550 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528580 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-104528614 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-E2E-20261006-140000006 | E2E | apps/api/test/e2e/rev.e2e.spec.ts | pass | - |
| REV-TC-20261006-104523767 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104523823 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104523878 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104523936 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104523993 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524045 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524095 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524159 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524227 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524289 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524335 | TC | apps/api/test/review/create.spec.ts | pass | YẾU: log ghi vào bộ nhớ của test (không có log kho ảnh và audit thật ngoài ca từ chối ảnh) |
| REV-TC-20261006-104524378 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104524423 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524472 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104524515 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104524600 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524655 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524722 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524795 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-104524858 | TC | apps/api/test/review/images.spec.ts | pass | YẾU: EXIF kiểm bằng metadata của sharp và tìm chuỗi nhị phân (không có exiftool); kho ảnh là S3 giả (bản kho MinIO thật ở `apps/api/test/review/images.minio.spec.ts`) |
| REV-TC-20261006-104524926 | TC | apps/api/test/review/images.spec.ts | pass | - |
| REV-TC-20261006-104524981 | TC | apps/api/test/review/images.spec.ts | pass | - |
| REV-TC-20261006-104525035 | TC | apps/api/test/review/images.spec.ts | pass | - |
| REV-TC-20261006-104525092 | TC | apps/api/test/review/images.spec.ts | pass | - |
| REV-TC-20261006-104525146 | TC | apps/api/test/review/images.spec.ts | pass | YẾU: lỗi kho là S3 giả trả 500, chưa thử lỗi kết nối thật tới kho |
| REV-TC-20261006-104525199 | TC | apps/api/test/review/images.spec.ts | pass | YẾU: luồng giả 60 MB thay vì 200 MB (Content-Length đã vượt trần nên server từ chối không đọc thân); đường cắt luồng đo bằng tệp 5.242.881 byte; bộ nhớ đo bằng rss của tiến trình test |
| REV-TC-20261006-104525257 | TC | apps/api/test/review/images.spec.ts | pass | - |
| REV-TC-20261006-104525319 | TC | apps/api/test/review/images.spec.ts | pass | YẾU: "PNG bom" 30000 x 30000 là tệp chỉ có tiêu đề khai kích thước (hàm `pngClaiming`), không phải ảnh thật nén 60 KB; thời gian và bộ nhớ đo trong tiến trình test |
| REV-TC-20261006-104525374 | TC | apps/api/test/review/images.spec.ts | pass | - |
| REV-TC-20261006-104525433 | TC | apps/api/test/review/eligibility.spec.ts | pass | - |
| REV-TC-20261006-104525491 | TC | apps/api/test/review/eligibility.spec.ts | pass | Có thêm test nền ở `apps/api/test/order/rev-undelivered.spec.ts` (sửa mã nền `OrderApi.hasUndeliveredItems`, nay có TC riêng của ORD: ORD-TC-20261013-223014153) |
| REV-TC-20261006-104525553 | TC | apps/api/test/review/eligibility.spec.ts | pass | - |
| REV-TC-20261006-104525611 | TC | apps/api/test/review/eligibility.spec.ts | pass | - |
| REV-TC-20261006-104525678 | TC | apps/api/test/review/eligibility.spec.ts | pass | - |
| REV-TC-20261006-104525730 | TC | apps/api/test/review/eligibility.spec.ts | pass | - |
| REV-TC-20261006-104525777 | TC | apps/api/test/review/eligibility.spec.ts | pass | - |
| REV-TC-20261006-104525824 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104525890 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104525946 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104526003 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104526059 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104526113 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104526165 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104526228 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-104526283 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526332 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526385 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526433 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526488 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526559 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526616 | TC | apps/api/test/review/delete.spec.ts | pass | - |
| REV-TC-20261006-104526681 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104526741 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104526797 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104526852 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104526911 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104526974 | TC | apps/api/test/review/public.spec.ts | pass | - |
| REV-TC-20261006-104527032 | TC | apps/api/test/review/public.spec.ts | pass | YẾU: AUTH có CHECK họ tên không rỗng nên khách C có họ tên rỗng không dựng được; ca "Khách hàng" chỉ kiểm ở hàm che `maskName` |
| REV-TC-20261006-104527123 | TC | apps/api/test/review/public.spec.ts | pass | Sau đồng bộ 2026-10-13: TC nêu guest theo IP và người dùng đã đăng nhập theo người dùng; test đo cả hai |
| REV-TC-20261006-104527184 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527235 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527298 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527360 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527404 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527469 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527537 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527598 | TC | apps/api/test/review/mine.spec.ts | pass | - |
| REV-TC-20261006-104527652 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527717 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527768 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527829 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527875 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527917 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527955 | TC | apps/api/test/review/admin.spec.ts | pass | - |
| REV-TC-20261006-104527996 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528036 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528071 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528104 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528138 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528170 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528202 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528234 | TC | apps/api/test/review/moderate.spec.ts | pass | Dùng kiểm Origin (ADR-016, questions.md mục "Dọn sót CSRF"); tiêu đề TC đã sửa theo ADR-016 (2026-10-13) |
| REV-TC-20261006-104528265 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528296 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-104528328 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-140000001 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-140000002 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261006-140000003 | TC | apps/api/test/review/moderate.spec.ts | pass | - |
| REV-TC-20261006-140000004 | TC | apps/api/test/review/create.spec.ts | pass | - |
| REV-TC-20261006-140000005 | TC | apps/api/test/review/moderate.spec.ts | pass | PRD là consumer giả (đăng ký `prd-fake`) đúng TC; consumer thật của PRD kiểm ở REV-TC-20261006-140000007 |
| REV-TC-20261006-140000007 | TC | apps/api/test/review/edit.spec.ts | pass | - |
| REV-TC-20261013-223014272 | TC | apps/api/test/review/mutants.spec.ts | pass | Ca hai bước cùng đúng (REV-REV-11): đơn giao quá 90 ngày cộng đơn mới đang giao trả `not_delivered`; kiểm thêm `pending`, `confirmed`, `paid` và `cancelled`, `returned`, `expired` |
| REV-TC-20261013-223014373 | TC | apps/api/test/review/eligibility.spec.ts | pass | Đơn hoàn trả hoặc hủy sau khi đã đánh giá (BR9, v1): ORD v1 coi `delivered` là cuối nên điều kiện dựng bằng sửa thẳng CSDL |
| REV-TC-20261013-223014474 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | Job `rev.sweep-orphan-images`: khóa advisory giữ bởi kết nối khác thì `skipped`; mô phỏng instance thứ hai bằng kết nối CSDL thứ hai trong cùng tiến trình test |
| REV-TC-20261013-223014571 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | Job `rev.sweep-orphan-objects` (REV-REV-16): kho S3 giả; chưa thử với kho thật có hàng chục nghìn object |
| REV-TC-20261013-223014665 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | Xóa bậc B 30 mỗi giờ |
| REV-TC-20261013-223014766 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | "Của tôi" chung bộ đếm bậc C 120 mỗi phút |
| REV-TC-20261013-223014868 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | Admin chung bộ đếm bậc D 60 mỗi phút |
| REV-TC-20261013-223014967 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | `review-eligibility` bậc C 120 mỗi phút |
| REV-TC-20261013-223015066 | TC | apps/api/test/review/jobs-limits.spec.ts | pass | 503 `service-unavailable` khi PRD, ORD hay AUTH lỗi hoặc quá hạn 2 giây (lỗi do `jest.spyOn` trên lớp thật) |
| REV-TC-20261015-092750203 | TC | apps/api/test/review/eligibility.spec.ts | pass | Đợt bán hộ: REV không sửa mã, chỉ thêm ca; đơn hộ `user_id` rỗng dựng bằng `insertOrder` (khớp `getDeliveredItems(user_id)`), đơn hộ gắn tài khoản được đánh giá |

## Kiểm đột biến
Bảng có 163 đột biến (130 của implement, 15 của review, 18 của đợt đồng bộ spec 2026-10-13: 16 cho `rev.sweep-orphan-objects`, hai job dọn ảnh, các bậc giới hạn tần suất, 503 và hook web `useQueryGo`; 18 đột biến mới đều bắt ở lần chạy đầu) chạy bằng `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-rev.json --cwd apps/api` (mỗi dòng một lệnh Jest hẹp theo TC); cổng kiểm của chính bảng: `node apps/api/scripts/check-mutations.mjs apps/api/scripts/mutations-rev.json --sec spec/epics/REV/design/REV-SEC-20261006-103618395.md` (phủ 17 SB `Kiểm bằng: test`: SB-05, 06, 07, 08, 10, 11, 12, 13, 14, 18, 19, 20, 24, 27, 32, 36, 40) và `apps/api/test/tooling/mutations-rev.spec.ts`. Phủ cả mã nền sửa kèm (`platform/http/csrf.guard.ts`, `order/internal.service.ts`), mười ba ràng buộc của migration và hai hàm của web. Lần chạy đầu: 125 bắt, 5 lọt: (1) cửa sổ 1 giờ của giới hạn tạo thành 2 giờ (test tua đồng hồ 61 phút nên cả hai cửa sổ cùng qua; sửa test: đặt đồng hồ ở đầu cửa sổ 2 giờ và khẳng định `Retry-After` trong 3590 đến 3600), (2) `OFFSET` khổng lồ (tương đương, đã ghi `equivalent`), (3) và (4) khóa ngoại `reviews.product_id`, `reviews.user_id` thành CASCADE (bị khóa RESTRICT của `review_images` và của `orders` che; sửa test: đánh giá không ảnh, người dùng chỉ có đánh giá), (5) log ảnh bị từ chối ghi `bytes_read` 0 (sửa test: ca 5.242.881 byte phải đọc tới ngưỡng). Chạy lại các dòng đó: đều bắt. Sau khi đổi tên test cho các dòng migration, chạy lại 13 dòng: đều bắt. Bảng dưới là kết quả cuối; mọi lần chạy đều khôi phục tệp (kiểm bằng `check-mutations.mjs` sau cùng: mỗi đoạn cần phá còn đúng một lần).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| T4 SB-11: điểm 0 được nhận (cận dưới 1 thành 0) | REV-TC-20261006-104524423 | bắt |
| T4 SB-11: điểm 6 được nhận (cận trên 5 thành 6) | REV-TC-20261006-104524423 | bắt |
| T4 SB-11: điểm thập phân 4.5 được nhận | REV-TC-20261006-104524423 | bắt |
| T4 SB-05, SB-11: trường lạ user_id, status, order_item_id không còn bị từ chối | REV-TC-20261006-104523993 | bắt |
| T4 SB-11: khóa __proto__ của JSON không còn bị bắt | REV-TC-20261006-104523993 | bắt |
| T7 SB-11: bình luận 2001 ký tự được nhận | REV-TC-20261006-104524655 | bắt |
| T7 SB-11: NUL trong bình luận không còn bị từ chối | REV-TC-20261006-104524655 | bắt |
| T7 SB-12: bình luận không chuẩn hóa NFC | REV-TC-20261006-104524600 | bắt |
| T7 SB-12: bình luận không cắt khoảng trắng hai đầu | REV-TC-20261006-104524600 | bắt |
| T7 SB-11: bình luận sai kiểu (số, mảng) được coi là không có | REV-TC-20261006-104524655 | bắt |
| T20 SB-06: 6 ảnh được nhận (trần 5 thành 6) | REV-TC-20261006-104525257 | bắt |
| T20 SB-06: id ảnh sai định dạng chui vào truy vấn | REV-TC-20261006-104525035 | bắt |
| T14 SB-11: lý do rỗng được nhận khi từ chối, ẩn | REV-TC-20261006-104528138 | bắt |
| T14 SB-11: lý do 501 ký tự được nhận | REV-TC-20261006-104528138 | bắt |
| T4 SB-11: PATCH body rỗng được nhận | REV-TC-20261006-104526059 | bắt |
| T17 SB-11: sắp xếp mặc định của danh sách công khai không còn newest | REV-TC-20261006-104526681 | bắt |
| T17 SB-11: lọc rating nhận cả 0 và 6 | REV-TC-20261006-104526852 | bắt |
| T3 SB-05: hàng đợi admin mặc định không còn pending | REV-TC-20261006-104527652 | bắt |
| T1 SB-06: danh sách của tôi nhận status=deleted | REV-TC-20261006-104527404 | bắt |
| T6 SB-14: tạo 10 lần mỗi giờ thành 11 | REV-TC-20261006-104524095 | bắt |
| T6 SB-14: cửa sổ 1 giờ của tạo thành 2 giờ | REV-TC-20261006-104524095 | bắt |
| T6 SB-14: sửa 30 lần mỗi giờ thành 31 | REV-TC-20261006-104524095 | bắt |
| T9 SB-14: tải ảnh 20 lần mỗi giờ thành 21 | REV-TC-20261006-104524095 | bắt |
| T17 SB-14: đọc công khai 120 mỗi phút thành 121 | REV-TC-20261006-104527123 | bắt |
| T5 SB-36: cửa sổ đánh giá 90 ngày thành 91 | REV-TC-20261006-104525553 | bắt |
| T9 SB-10: ảnh tối đa 5.242.880 byte thành 5.242.881 | REV-TC-20261006-104525199 | bắt |
| T8 SB-10: trần 25 megapixel thành 26 megapixel | REV-TC-20261006-104525319 | bắt |
| T8 SB-10: cạnh dài sau xử lý 1600 thành 1700 | REV-TC-20261006-104524858 | bắt |
| T9 SB-10: hạn dọn ảnh 24 giờ thành 25 giờ | REV-TC-20261006-104525374 | bắt |
| T12 SB-24: duyệt nhận cả đánh giá hidden | REV-TC-20261006-104528104 | bắt |
| T12 SB-24: ẩn nhận cả đánh giá pending | REV-TC-20261006-104528104 | bắt |
| T12 SB-24: bỏ ẩn nhận cả đánh giá published | REV-TC-20261006-104528104 | bắt |
| T14 SB-19: từ chối không ghi lý do | REV-TC-20261006-104528036 | bắt |
| T16 SB-27: bỏ ẩn không phát ReviewPublished | REV-TC-20261006-140000003 | bắt |
| T16 SB-27: ẩn không phát ReviewHidden | REV-TC-20261006-104528071 | bắt |
| T16 SB-27: duyệt không phát ReviewPublished | REV-TC-20261006-104527996 | bắt |
| T13 SB-24: kiểm duyệt trước mặc định tắt | REV-TC-20261006-104523767 | bắt |
| T7 SB-11: bình luận tối đa 2000 thành 2001 (hằng số cấu hình) | REV-TC-20261006-104524722 | bắt |
| T6 SB-14: eligibility không còn báo already_reviewed | REV-TC-20261006-104525777 | bắt |
| T5 SB-36: not_delivered và not_purchased đổi chỗ | REV-TC-20261006-104525491 | bắt |
| T5 SB-36: biên 90 ngày không bao gồm | REV-TC-20261006-104525678 | bắt |
| T5 SB-36: chọn dòng đơn giao xa nhất thay vì gần nhất | REV-TC-20261006-104525730 | bắt |
| T11 SB-06: sản phẩm archived vẫn được đánh giá | REV-TC-20261006-104524045 | bắt |
| T6 SB-14: vi phạm unique không đổi thành 409 already_reviewed | REV-TC-20261006-104524227 | bắt |
| T6 SB-14: deleted vẫn giữ chỗ khi tạo | REV-TC-20261006-104524159 | bắt |
| T13 SB-24: tắt kiểm duyệt trước mà vẫn không tự công bố | REV-TC-20261006-104523823 | bắt |
| T1 SB-06: sửa đánh giá không kiểm chủ | REV-TC-20261006-104525946 | bắt |
| T1 SB-06: customer xóa đánh giá không kiểm chủ | REV-TC-20261006-104526385 | bắt |
| T3 SB-07: mọi người xóa như admin | REV-TC-20261006-104526385 | bắt |
| T12 SB-24: sửa đánh giá hidden, rejected được nhận | REV-TC-20261006-104526003 | bắt |
| T13 SB-24: sửa đánh giá published khi bật kiểm duyệt vẫn giữ published | REV-TC-20261006-140000001 | bắt |
| T13 SB-24: đánh giá pending bị đặt edited_at khi sửa | REV-TC-20261006-104525824 | bắt |
| T12 SB-24: sửa giá trị y hệt vẫn ghi và tăng updated_at | REV-TC-20261006-104526165 | bắt |
| T16 SB-27: ReviewUnpublished mang điểm mới thay vì điểm đã đăng | REV-TC-20261006-140000007 | bắt |
| T16 SB-27: ReviewRatingChanged đảo old và new | REV-TC-20261006-140000002 | bắt |
| T16 SB-27: sửa chỉ bình luận cũng phát ReviewRatingChanged | REV-TC-20261006-104525890 | bắt |
| T14 SB-19: admin xóa ghi deleted_by_role customer | REV-TC-20261006-104526332 | bắt |
| T14 SB-19, SB-32: admin xóa không ghi audit | REV-TC-20261006-104526332 | bắt |
| T16 SB-27: xóa không phát ReviewDeleted | REV-TC-20261006-104526283 | bắt |
| T9 SB-10: ảnh của đánh giá bị xóa không thành mồ côi | REV-TC-20261006-104526283 | bắt |
| T12 SB-24: kiểm duyệt không kiểm trạng thái hiện tại | REV-TC-20261006-104528104 | bắt |
| T12 SB-24: duyệt đánh giá đã xóa trả 409 thay 404 | REV-TC-20261006-104528202 | bắt |
| T14 SB-19: audit ghi sai hành động | REV-TC-20261006-104527996 | bắt |
| T16 SB-27: kiểm duyệt không phát event | REV-TC-20261006-104527996 | bắt |
| T14 SB-19: lý do kiểm duyệt không được ghi | REV-TC-20261006-104528036 | bắt |
| T16 SB-27: bỏ ẩn đặt lại published_at | REV-TC-20261006-140000003 | bắt |
| T12 SB-24: moderated_by không ghi admin | REV-TC-20261006-104527996 | bắt |
| T11 SB-05, SB-06: danh sách công khai lộ cả đánh giá chưa published | REV-TC-20261006-104526681 | bắt |
| T11 SB-05: summary tính cả đánh giá chưa published | REV-TC-20261006-104524378 | bắt |
| T16 SB-27: điểm trung bình cắt thay vì làm tròn nửa lên | REV-TC-20261006-104524472 | bắt |
| T16 SB-27: sản phẩm chưa có đánh giá cho avg 0 thay vì null | REV-TC-20261006-104524515 | bắt |
| T17 SB-14: total không theo bộ lọc rating | REV-TC-20261006-104526741 | bắt |
| T17 SB-14: sắp xếp điểm cao không phụ thuộc mới nhất khi cùng điểm | REV-TC-20261006-104526741 | bắt |
| T11 SB-06: sản phẩm draft, archived vẫn xem được đánh giá công khai | REV-TC-20261006-104526797 | bắt |
| T17 SB-14: trang quá cuối chạy OFFSET khổng lồ (điều kiện `skip < total` bỏ đi) | - | lọt (tương đương: PostgreSQL nhận OFFSET tới 9,2e18 và trả rỗng, điều kiện chỉ bỏ một truy vấn thừa; ghi `equivalent` trong bảng) |
| T10 SB-08: danh sách công khai lộ user_id | REV-TC-20261006-104526681 | bắt |
| T1 SB-06: chi tiết của tôi không kiểm chủ | REV-TC-20261006-104527298 | bắt |
| T1 SB-06: tổng của danh sách của tôi đếm cả người khác | REV-TC-20261006-104527184 | bắt |
| T1 SB-06: danh sách của tôi trả cả đánh giá của người khác | REV-TC-20261006-104527184 | bắt |
| T10 SB-08: lý do kiểm duyệt trả cả cho đánh giá pending, published | REV-TC-20261006-104527184 | bắt |
| T13 SB-24: edit_requires_review không theo trạng thái | REV-TC-20261006-104527184 | bắt |
| T3 SB-05: hàng đợi pending xếp mới nhất trước | REV-TC-20261006-104527652 | bắt |
| T3 SB-05: pending_count đếm trạng thái khác | REV-TC-20261006-104527717 | bắt |
| T3 SB-05: bộ lọc rating của hàng đợi bị bỏ | REV-TC-20261006-104527717 | bắt |
| T10 SB-08: tên che dùng từ đầu thay vì từ cuối | REV-TC-20261006-104527032 | bắt |
| T10 SB-08: một từ vẫn bị che | REV-TC-20261006-104527032 | bắt |
| T19 SB-20: lý do ảnh quá lớn bị đổi thành corrupt | REV-TC-20261006-104525199 | bắt |
| T8 SB-10: ảnh lưu với Content-Type jpeg | REV-TC-20261006-104524858 | bắt |
| T20 SB-06: gắn ảnh không kiểm người tải | REV-TC-20261006-104525035 | bắt |
| T20 SB-06: gắn ảnh đã gắn vào đánh giá khác | REV-TC-20261006-104525035 | bắt |
| T9 SB-10: ảnh quá hạn vẫn gắn được (cửa đua với job dọn) | REV-TC-20261006-104525374 | bắt |
| T9 SB-10: job dọn xóa cả ảnh đang gắn | REV-TC-20261006-104525374 | bắt |
| T9 SB-10: ảnh gỡ khỏi đánh giá đã xóa không đặt orphaned_at | REV-TC-20261006-104526283 | bắt |
| T9 SB-10: job dọn không báo lỗi khi kho lỗi | REV-TC-20261006-104525374 | bắt |
| T19 SB-20: lỗi kho ảnh để lọt chi tiết (đổi sang 503 nhưng thân khác) | REV-TC-20261006-104525146 | bắt |
| T8 SB-10: tệp không phải JPEG, PNG, WebP không bị từ chối theo magic bytes | REV-TC-20261006-104524981 | bắt |
| T8 SB-10: đúng 25 megapixel bị từ chối | REV-TC-20261006-104525319 | bắt |
| T8 SB-10: ảnh nhỏ bị phóng to | REV-TC-20261006-104524858 | bắt |
| T8 SB-10, T10 SB-08: kích thước đọc từ tiêu đề không còn chặn bom giải nén | REV-TC-20261006-104525319 | bắt |
| T8 SB-10: ảnh hỏng báo sai lý do | REV-TC-20261006-104524981 | bắt |
| T3 SB-05, SB-07: staff được tạo đánh giá | REV-TC-20261006-104523936 | bắt |
| T3 SB-07: admin được sửa nội dung đánh giá | REV-TC-20261006-104526113 | bắt |
| T3 SB-07: staff được xóa đánh giá | REV-TC-20261006-104526488 | bắt |
| T3 SB-07: staff được duyệt đánh giá | REV-TC-20261006-104528170 | bắt |
| T3 SB-07: customer được xem hàng đợi | REV-TC-20261006-104527768 | bắt |
| T3 SB-07: staff được tải ảnh | REV-TC-20261006-104525092 | bắt |
| T6 SB-40: Idempotency-Key 7 ký tự được nhận | REV-TC-20261006-140000004 | bắt |
| T6 SB-40: Idempotency-Key 65 ký tự được nhận | REV-TC-20261006-140000004 | bắt |
| T18 SB-08: phản hồi riêng tư cho phép lưu bộ nhớ đệm chung | REV-TC-20261006-104523767 | bắt |
| T5 SB-36: đơn đã giao tính là chưa giao | REV-TC-20261006-104525491 | bắt |
| T5 SB-36: đơn của người khác tính là chưa giao | REV-TC-20261006-104525491 | bắt |
| DB SB-11: CHECK điểm cho 0 | REV-TC-20261006-104524423 | bắt |
| DB SB-11: CHECK bình luận 2001 | REV-TC-20261006-104524655 | bắt |
| DB SB-11: CHECK lý do 501 | REV-TC-20261006-104528138 | bắt |
| DB SB-24: CHECK deleted đi cùng deleted_at bị bỏ | REV-TC-20261006-104524423 | bắt |
| DB SB-14: unique theo dòng đơn không còn một phần (deleted giữ chỗ) | REV-TC-20261006-104524159 | bắt |
| DB SB-14: unique theo (người dùng, sản phẩm) bị bỏ | REV-TC-20261006-104524227 | bắt |
| DB SB-06: khóa ngoại tới sản phẩm thành CASCADE | REV-TC-20261006-104526283 | bắt |
| DB SB-06: khóa ngoại tới người dùng thành CASCADE | REV-TC-20261006-104526283 | bắt |
| DB SB-10: khóa kho cho phép đuôi khác | REV-TC-20261006-104524858 | bắt |
| DB SB-10: ảnh thứ 6 được nhận (position 1 đến 6) | REV-TC-20261006-104525257 | bắt |
| DB SB-10: ảnh rộng 1601 được nhận | REV-TC-20261006-104524858 | bắt |
| DB SB-10: review_id và position không còn đi cùng nhau | REV-TC-20261006-104525257 | bắt |
| DB SB-10: unique (review_id, position) bị bỏ | REV-TC-20261006-104525257 | bắt |
| SB-12 (web): điểm trung bình hiển thị hai chữ số thập phân | REV-E2E-20261006-104528550 | bắt |
| SB-12 (web): nhãn trạng thái Chờ duyệt đổi chữ | REV-E2E-20261006-104528360 | bắt |
| T18 SB-08, SB-18: log tạo đánh giá ghi nội dung bình luận | REV-TC-20261006-104524335 | bắt |
| T18 SB-18: log kiểm duyệt ghi lý do | REV-TC-20261006-104528328 | bắt |
| T18 SB-18: log ảnh bị từ chối thiếu độ dài đã đọc | REV-TC-20261006-104525199 | bắt |
| T15 SB-13: Origin lạ không còn bị từ chối khi duyệt (nền CSRF) | REV-TC-20261006-104528234 | bắt |
| REV-REV-16 SB-34: job quét object xóa cả object chưa quá 24 giờ | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object xóa cả object đang có dòng review_images | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object xóa cả khóa không đúng dạng reviews/<uuid>.webp | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object không có trần 500 mỗi lượt | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object không đóng khi bảng tham chiếu rỗng hay sai kho | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object chỉ đóng khi bảng rỗng, không đóng khi khóa không có trong kho | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object không báo lỗi sau lượt khi có object xóa lỗi | REV-TC-20261013-223014571 | bắt |
| REV-REV-16 SB-34: job quét object đăng ký chu kỳ 1 giây thay vì mỗi giờ | REV-TC-20261013-223014571 | bắt |
| REV-DB mục 8 SB-34: giới hạn lô của job ảnh 100 thành 1000 | REV-TC-20261013-223014474 | bắt |
| REV-DB mục 8 SB-34: job ảnh xóa dòng dù object chưa xóa được khỏi kho | REV-TC-20261013-223014474 | bắt |
| REV-DB mục 10 SB-14: xóa đánh giá 30 thành 31 lần mỗi giờ | REV-TC-20261013-223014665 | bắt |
| REV-DB mục 10 SB-14: danh sách và chi tiết của tôi không chung bộ đếm | REV-TC-20261013-223014766 | bắt |
| REV-DB mục 10 SB-14: bộ đếm admin 60 thành 61 lần mỗi phút | REV-TC-20261013-223014868 | bắt |
| REV-DB mục 10 SB-14: hàng đợi và thao tác admin không chung bộ đếm | REV-TC-20261013-223014868 | bắt |
| REV-DB mục 10 SB-14: review-eligibility 120 thành 121 lần mỗi phút | REV-TC-20261013-223014967 | bắt |
| REV-API SB-20: lỗi của PRD, ORD, AUTH ném nguyên lỗi gốc thay vì 503 service-unavailable | REV-TC-20261013-223015066 | bắt |
| REV-REV-12 giao diện: lần đổi bộ lọc thứ hai dựng URL từ chuỗi cũ của lần render, sống lại bộ lọc vừa bỏ | REV-E2E-20261006-104528550 | bắt |
| REV-REV-12 giao diện: go({ page }) bị xóa page vừa đặt | REV-E2E-20261006-104528550 | bắt |

## Lệch spec
1. [đã chọn] Thêm `OrderApi.hasUndeliveredItems(user_id, product_id)` (đơn `pending`, `confirmed`, `paid`, `shipped` của chính người dùng chứa sản phẩm) ngoài bảng Giao diện module (hàng REV -> ORD chỉ có `getDeliveredItems`, chỉ trả đơn `delivered`). Lý do: REV-REQ-20261006-103135296 BR3 bước 4 và REV-TC-20261006-104525491 đòi phân biệt `not_delivered` với `not_purchased`, mà `getDeliveredItems` không cho biết có đơn chưa giao hay không và REV không được đọc bảng của ORD (SB-35). Đơn `cancelled`, `expired`, `returned` coi là `not_purchased` (spec không nêu `returned`). Sửa mã nền ORD (`apps/api/src/modules/order/internal.service.ts`, `order.api.ts`): test nền ở `apps/api/test/order/rev-undelivered.spec.ts` (REV-TC-20261006-104525491) và `apps/api/test/order/guard.spec.ts` (danh sách phương thức và số đối số của `OrderApi`, thêm `hasUndeliveredItems: 2`). [đã đồng bộ 2026-10-13] bảng Giao diện module (hàng REV gọi ORD), ORD-API (phương thức thứ 16) và REV-API (Giao tiếp giữa module) ghi phương thức này; ORD có TC riêng ORD-TC-20261013-223014153 (test `apps/api/test/order/rev-undelivered.spec.ts`).
2. [đã chọn] Tạo đánh giá gọi `IdempotencyService.run` từ service (`ReviewService.create`) thay vì decorator `@Idempotent`: decorator giữ giao dịch của khóa suốt handler, còn dữ kiện của PRD (`getSummaries`), ORD (`getDeliveredItems`, `hasUndeliveredItems`) phải đọc ngoài giao dịch (SB-31, hold-and-wait, bài học L71, L87, L117). Dữ kiện đọc TRƯỚC giao dịch của khóa, quyết định (404, 409) nằm trong giao dịch nên lỗi 4xx hoàn tác cả dòng khóa (không lưu phản hồi lỗi); gửi lại cùng khóa cùng nội dung trả đúng phản hồi 201 cũ kèm `Idempotent-Replayed: true`. `request_hash` băm trên thân ĐÃ chuẩn hóa (cắt khoảng trắng, NFC) chứ không phải thân thô: hai thân khác nhau chỉ ở khoảng trắng hai đầu coi là cùng nội dung. REV-TC-20261006-140000004, REV-TC-20261006-104524227, test pool 2 kết nối ở `apps/api/test/review/load.spec.ts`.
3. [đã chọn] Giới hạn tần suất cho endpoint mà REV-API chưa nêu bậc: xóa đánh giá bậc B 30 mỗi giờ mỗi người; hỏi điều kiện (`review-eligibility`) bậc C 120 mỗi phút; danh sách và chi tiết của tôi bậc C 120 mỗi phút (chung bộ đếm); hàng đợi admin và bốn thao tác kiểm duyệt bậc D 60 mỗi phút chung một bộ đếm. Ba bậc spec đã nêu (tạo 10, sửa 30, tải ảnh 20 mỗi giờ; đọc công khai 120 mỗi phút) đúng số. Rủi ro: số tự chọn có thể chặn thao tác hợp lệ của người dùng cực bận; đổi ở `apps/api/src/modules/review/config.ts` (`LIMITS`), nên chốt ở sdlc-impact. [đã đồng bộ 2026-10-13] REV-DB mục 10 và cột Lỗi của REV-API ghi các bậc này; test mới ở `apps/api/test/review/jobs-limits.spec.ts` (REV-TC-20261013-223014665, ...766, ...868, ...967).
4. [đã chọn] Khóa đếm giới hạn tần suất dùng mặc định của platform (người dùng đã đăng nhập, không thì IP), nên đọc công khai của người đã đăng nhập đếm theo người, không theo IP như REV-REQ ...566 BR9 và REV-TC-20261006-104527123 ghi; ca guest theo IP đúng (YẾU ở bảng kết quả). Cùng lựa chọn với SHP, CRT. [đã đồng bộ 2026-10-13] REV-REQ ...566 BR9, REV-SEC T17 và REV-TC ...527123 ghi bộ đếm theo người dùng đã đăng nhập, guest theo IP; test `public.spec.ts` đo cả hai ca.
5. [đã chọn] Phản hồi có thêm trường ngoài REV-API (chỉ thêm, không đổi trường có sẵn): `images[].id` ở phản hồi tạo, sửa, danh sách và chi tiết của tôi (để form sửa gửi lại đủ `image_ids`, không cắt mất ảnh hiện có khi chỉ sửa chữ; công khai và admin không có `id`), và `product.status` ở danh sách và chi tiết của tôi (để hiện chú thích "Sản phẩm đã ngừng bán"). [đã đồng bộ 2026-10-13] REV-API ghi `images[].id` (chỉ phản hồi của chủ) và `product.status`. Kiểm ở REV-TC-20261006-104524926, REV-TC-20261006-104527537 và E2E REV-SEC T8 (sửa không cắt ảnh).
6. [đã chọn] Mã lỗi dùng trong mã mà REV-API chưa liệt kê: `service-unavailable` (503) khi PRD, ORD hoặc AUTH quá hạn 2 giây hay lỗi (chi tiết chỉ vào log, SB-31); `internal-error` (500) khi kho ảnh ghi lỗi (REV-TC-20261006-104525146 cho phép 500 hoặc 502; USR dùng 503 cho cùng tình huống, REV theo TC); `image-invalid` với `reason` = `corrupt` cho form multipart sai (không có đúng một phần `file`), vì `reason` chỉ thuộc tập cố định `type`, `size`, `dimensions`, `corrupt` (T19). Mọi mã còn lại đã có trong REV-API (`review-conflict` với `code` `already_reviewed`, `not_purchased`, `not_delivered`, `window_expired`, `review_not_editable`, `invalid_review_state`; `unknown_field`, `invalid_rating`, `too_long`, `invalid_characters`, `invalid_type`, `too_many_images`, `invalid_image`, `required`, `invalid_format`). [đã đồng bộ 2026-10-13] REV-API ghi `service-unavailable` (503) và `internal-error` (500); TC mới REV-TC-20261013-223015066 (test `jobs-limits.spec.ts`).
7. [đã chọn] Job `rev.sweep-orphan-images` không dùng `FOR UPDATE SKIP LOCKED` như REV-DB mục 8: xóa object khỏi kho phải ngoài giao dịch (SB-31) nên không giữ khóa dòng; thay bằng con trỏ `id` theo lô 100, hạn thời gian 50 giây mỗi lượt, một bản duy nhất trên cụm do `JobRunner` (khóa tư vấn), xóa object TRƯỚC rồi xóa dòng (kiểm lại điều kiện quá hạn và chưa gắn ở câu DELETE), object xóa lỗi thì giữ dòng cho lượt sau và job báo lỗi. Thêm một quy tắc ngoài spec để đóng cửa đua giữa dọn và gắn: ảnh chưa gắn quá 24 giờ không còn gắn được (400 `invalid_image`). REV-TC-20261006-104525374. [đã đồng bộ 2026-10-13] REV-DB mục 8 ghi khóa advisory của `JobRunner` (không `SKIP LOCKED`) và hai job; TC mới REV-TC-20261013-223014474 (test `jobs-limits.spec.ts`: khóa advisory, giới hạn lô, hạn thời gian, idempotent, xóa object trước dòng).
8. [đã chọn] Điểm trung bình tính bằng số nguyên trên phân bố sao (nửa lên một chữ số, `floor((20 x tổng + số) / (2 x số)) / 10`) thay vì `round()` của SQL; cùng kết quả (3,75 thành 3,8; 4,5 giữ 4,5) và không có sai số số thực. `total` suy từ cùng truy vấn phân bố (một truy vấn nhóm thay vì hai). REV-TC-20261006-104524472.
9. [đã chọn] Chữ "CSRF token" còn trong tiêu đề REV-TC-20261006-104528234 ("Duyệt thiếu CSRF token hoặc sai Origin") và bước Given của REV-TC-20261006-104523936 ("mọi bên có CSRF token hợp lệ") dù ADR-016 và `questions.md` đã bỏ token đồng bộ; code và test theo ADR-016 (kiểm `Origin`, 403 `csrf_failed`, 415 sai Content-Type). [đã đồng bộ 2026-10-13] hai TC đã sửa chữ theo ADR-016: tiêu đề của ...528234 là "Duyệt thiếu Origin hoặc sai Origin bị 403", Given của ...523936 nêu `Origin` thuộc danh sách cho phép.
10. [đã chọn] Tên hiển thị che theo REV-REQ ...566 BR4 ngay ở REV từ `getDisplayNames` (hàm `maskName`); AUTH có CHECK `users_full_name_len` (họ tên không rỗng) nên ca "thiếu họ tên thành Khách hàng" của REV-TC-20261006-104527032 không dựng được bằng dữ liệu thật, chỉ kiểm ở hàm che (YẾU ở bảng kết quả). Ảnh đại diện (`avatar_url`) trả công khai theo câu 20 của questions.md.
11. [đã chọn] Nhật ký có thêm bốn dòng thông tin không chứa nội dung người dùng: `review-created`, `review-edited`, `review-deleted`, `review-moderated` (chỉ `review_id`, trạng thái, độ dài bình luận hoặc lý do, mã hành động, `correlation_id`), để REV-TC-20261006-104524335 kiểm "dòng log của yêu cầu có review_id, độ dài comment"; không có `user_id` nguyên văn trong log (bài học L115). Log từ chối ảnh chỉ có `reason` và `bytes_read`.
12. [đã chọn] Không có endpoint nào cho ma trận quyền hai hàng "Chấm điểm sao khi tạo hoặc sửa đánh giá" và "Viết bình luận khi tạo hoặc sửa đánh giá" (luật điểm và bình luận nằm trong schema của tạo và sửa) và hàng job dọn ảnh (`system`): test ma trận ở `apps/api/test/review/guard.spec.ts` miễn ba hàng này (`exempt`), mọi hàng còn lại (12 hàng) đều có `@Action` khớp.
13. [đã chọn] Sửa mã nền của test (không sửa mã nền của module khác ngoài ORD): `apps/api/test/support/db.ts` và `apps/api/test/e2e/server.ts` thêm `reviews`, `review_images` vào danh sách bảng làm sạch; `apps/api/test/order/create.spec.ts` thêm hai bảng đó vào câu `TRUNCATE` (khóa ngoại `reviews.order_item_id`, REV-TC-20261006-104526283); `apps/api/test/catalog/guard.spec.ts` loại route `/products/:product_id/review*` khỏi phạm vi PRD (REV-TC-20261006-104523936). Không đổi hành vi của module nào.
14. [đã chọn] E2E: `apps/api/test/e2e/server.ts` có thêm ba điểm điều khiển (`/seed-review`, `/review-state`, `/set-pre-moderation`); bật hoặc tắt kiểm duyệt trước lúc chạy chỉ có ở máy chủ E2E (thay hàm đọc cấu hình của một `ConfigService`), còn ở nơi khác là biến môi trường `REVIEW_PRE_MODERATION` và khởi động lại (câu 18 của questions.md). Luồng THẬT (đặt hàng COD, bàn giao, giao hàng qua SHP và ORD, đánh giá, admin duyệt, điểm hiện ở `rev-product-reviews-avg` và `prd-product-detail-rating`) chạy trong một test mang cả REV-E2E-20261006-104528391 và REV-SEC T5, T16; trạng thái có thời hạn có đường thoát (429 của form viết, nút gửi mở lại khi hết giờ chờ) ở test mang REV-SEC T6.
15. [đã chọn] Giao diện: liên kết "Xem đánh giá" đặt cạnh dòng điểm của chi tiết sản phẩm PRD (ui/product-reviews nói mở từ dòng "★ 4,5 (10 đánh giá)"; testid PRD cũ giữ nguyên); thông báo "Đã lưu thay đổi" của form sửa hiện ở `/me/reviews?saved=` (chuyển trang rồi hiện toast mang testid `rev-review-form-save-success`, vì E2E đòi "quay về Đánh giá của tôi"); nháp (sao, chữ, ảnh đã tải) lưu vào `sessionStorage` khi bị 401; `rev-product-reviews-count` hiện "N đánh giá"; sửa không thay đổi gì thì không gọi API và hiện "Bạn chưa thay đổi gì."; 429 ở trang admin chỉ hiện chữ báo kèm số giây (spec không khai 429 cho admin). Hai lần đổi bộ lọc liên tiếp ngay lập tức trên trang công khai (chọn lại "Tất cả sao" rồi đổi sắp xếp trước khi trang tải xong) làm lần đổi thứ hai dùng URL cũ và giữ bộ lọc sao (E2E REV-E2E-20261006-104528550 chờ bộ lọc áp xong rồi mới đổi sắp xếp); người dùng thật không đổi nhanh tới mức đó; lỗi đã sửa ở review (REV-REV-12, hook `useQueryGo`) và nay ở mọi trang danh sách (mục 22). [đã đồng bộ 2026-10-13, REV-REV-12] ui/product-reviews ghi chỗ đặt liên kết; lỗi đổi bộ lọc liền nhau đã sửa ở mười trang còn lại bằng hook dùng chung `useQueryGo` (mục 22).
16. [đã chọn] Hạn lưu (ADR-022): Review `deleted` là xóa mềm không hạn nên không có job xóa cứng; ảnh mồ côi và ảnh của đánh giá đã xóa dọn sau 24 giờ; AuditLog, OutboxEvent, IdempotencyKey do PRJ giữ. Không có việc nào còn chờ.
17. [đã chọn] Cách chạy `clean_run` (làm khi implement, theo công thức PRJ mục 34 và NTF mục 20; mã chưa commit nên chỉ gần giống CI). Kết quả trong bản clone: install, scan:secrets, check:boundaries, lint, typecheck, build đều qua; `pnpm test` lượt đầu 1572 qua, 1 đỏ (mục 20), lượt hai toàn bộ qua (`test_result`). `git worktree add --detach` tại `c557cdb`, phủ các tệp sửa, tệp xóa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH`, `HOME` là thư mục rỗng riêng, `CI=true`, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`, `PLAYWRIGHT_BROWSERS_PATH`; `pnpm install --frozen-lockfile --offline --store-dir <kho của máy>`; PostgreSQL 16 và MinIO của Docker (`-p minsdlc-r`). Không chạy: workflow trên GitHub (chưa push), `check-migration-compat --base` (chỉ cho pull request).
18. [đã chọn] Bằng chứng YẾU và cách nâng: REV-TC-20261006-104524858 (EXIF kiểm bằng metadata của sharp, không có exiftool trên máy; kho S3 giả; nâng: bản kho MinIO thật đã có ở `apps/api/test/review/images.minio.spec.ts`, còn exiftool thì cài vào CI); REV-TC-20261006-104525146 (kho lỗi là S3 giả trả 500; nâng: ngắt kết nối thật tới MinIO); REV-TC-20261006-104525199 (luồng 60 MB thay vì 200 MB; nâng: bộ phát luồng vô hạn thật qua socket); REV-TC-20261006-104525319 (PNG bom chỉ có tiêu đề; nâng: sinh PNG thật 30000 x 30000 nén ra khoảng 60 KB ngoài repo); REV-TC-20261006-104527032 (không dựng được họ tên rỗng, xem mục 10); REV-TC-20261006-104524335 (log trong bộ nhớ của test; nâng: quét log của tiến trình thật); REV-E2E-20261006-104528360 (ảnh khoảng vài trăm KB thay vì 1 MB; kho ảnh MinIO thật khi đặt `STORAGE_TEST_ENDPOINT`).
19. [cần quyết] Workflow trên GitHub (`.github/workflows/ci.yml`) chưa được chạy (mã chưa commit và chưa push); `clean_run: pass` là bản clone cục bộ, chưa phải CI thật; chờ đẩy lên để có bằng chứng CI thật.
20. [cần quyết] Test NTF-TC-20261006-104223817 (`apps/api/test/notification/customer-events.spec.ts`, mã của epic NTF, không sửa ở đây) đỏ chập chờn: dòng `expect(await seen('abc')).toBe(false)` quét chuỗi `abc` trong toàn bộ log, mà log chứa `event_id`, `correlation_id` uuid ngẫu nhiên (hệ thập lục phân có thể chứa `abc`); lượt `pnpm test` đầu trong bản clone đỏ đúng test này, chạy riêng ba lần và lượt hai toàn bộ đều qua. Cần sửa test của NTF (tìm giá trị dữ liệu, không tìm chuỗi ngắn trong log) qua lượt review hay sdlc-impact của NTF; không ảnh hưởng REV.

21. [đã chọn] Đồng bộ spec 2026-10-13 (`spec/changes/rev-dong-bo-spec-20261013.md`), REV-REV-16: CÀI job `rev.sweep-orphan-objects` (`apps/api/src/modules/review/image.service.ts` `sweepObjects`, đăng ký ở `review.module.ts`, hằng ở `config.ts`): liệt kê kho theo tiền tố `reviews/`, xóa object dạng `reviews/<uuid>.webp` không có dòng `review_images` (so theo `storage_key`) và quá 24 giờ, trần 500 mỗi lượt, đóng khi không chắc (bảng rỗng hoặc không khóa nào của bảng có trong kho: không xóa gì, báo lỗi), xóa lỗi một object thì đi tiếp và báo lỗi sau lượt, idempotent; đổi `STORAGE_PUBLIC_BASE_URL` không ảnh hưởng vì tham chiếu là `storage_key`. Chọn thêm điều kiện "không khóa nào của bảng có trong kho" ngoài PRD và USR để bắt sai bucket hay endpoint khi bảng không rỗng. Cửa đua hẹp ở mốc 24 giờ của job dọn dòng chưa đóng (REV-SEC Rủi ro còn lại). REV-TC-20261013-223014474, ...571; test `apps/api/test/review/jobs-limits.spec.ts`; 8 + 2 đột biến bắt.
22. [đã chọn] Đồng bộ spec 2026-10-13, REV-REV-12 (lỗi web chung): hook `useQueryGo` chuyển sang `apps/web/components/useQueryGo.ts` (ReviewParts vẫn xuất lại tên cũ cho các trang đã nhập từ đây) cùng phần thuần `apps/web/lib/query-go.ts` (`nextQuery`, `QueryAccumulator`, `withQuery`); mười nơi còn tự dựng `go` từ `useSearchParams()` đã đổi sang hook: `apps/web/app/products/page.tsx`, `payments/page.tsx`, `notifications/page.tsx`, `admin/products`, `admin/coupons`, `admin/inventory`, `admin/payments`, `admin/refunds`, `admin/shipments` và `apps/web/components/OrderList.tsx`. Hook gộp luật "`go({ page })` không xóa `page` vừa đặt" (trước đây hai kiểu `keepPage` và `!('page' in change)` tùy trang). Chứng minh: `apps/api/test/review/query-go.spec.ts` (hàm thuần: lần đổi thứ hai không làm sống lại bộ lọc vừa bỏ; bài quét mã: không tệp web nào còn tự dựng `go` bằng `useCallback` từ `URLSearchParams(sp.toString())`) và hai đột biến bắt; E2E của ba trang REV (REV-E2E-20261006-104528550) giữ nguyên. Chưa có E2E trình duyệt riêng cho từng trang cũ: rủi ro thấp vì cùng một cài đặt.
23. [đã chọn] Đồng bộ spec 2026-10-13: ca BR3 hai bước (REV-TC-20261013-223014272) dùng lại test REV-REV-11 ở `mutants.spec.ts` (mở rộng: không tạo gì khi 409, `pending`, `confirmed`, `paid`, `cancelled`, `returned`, `expired`, đơn mới giao xong gắn đúng dòng); ca hoàn trả hoặc hủy sau khi đã đánh giá (REV-TC-20261013-223014373, BR9) ở `eligibility.spec.ts`: ORD v1 coi `delivered` là cuối nên điều kiện dựng bằng sửa thẳng CSDL (CHECK `orders_delivered_at`, `orders_cancel_pair`, `orders_tracking_status` buộc đổi thêm cột). `public.spec.ts` (REV-TC-20261006-104527123) đo cả guest theo IP và người dùng đã đăng nhập theo người dùng. Lượt chạy cuối của đợt đồng bộ: 209 bộ, 1788 test, 1788 pass (`test_result`).
24. [đã chọn] **Đợt bán hộ 2026-10-15**: REV không đổi mã: `getDeliveredItems(user_id, product_id)` của ORD khớp theo `user_id` của người hỏi nên đơn hộ không `user_id` không bao giờ khớp (REV-REQ-20261006-103135296 BR10); `NTF/REV` chỉ thêm ca REV-TC-20261015-092750203 ở `test/review/eligibility.spec.ts`.
