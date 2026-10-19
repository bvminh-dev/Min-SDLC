---
epic: PRJ
status: draft
kit_version: 3
clean_run: pass
test_command: pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: PRJ

## Kế hoạch task
Thứ tự theo phụ thuộc: khung dự án, cấu hình, log, lỗi, DB và migration, rồi các module platform (HTTP, quyền, giới hạn tần suất, idempotency, audit, outbox, job), cuối cùng công cụ CI. Cột Nguồn: ID tài liệu spec mà task thực hiện. PRJ không có màn hình nên không có task giao diện; `apps/web` chỉ là khung và trang placeholder (không có testid). Task 21 là phần hạ tầng ngoài mã, `blocked` vì không thể làm hoặc kiểm trong repo này (xem Lệch spec mục 20 và `docs/runbook-prod.md`).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Khung monorepo: package.json gốc (pnpm@10.15.1, engines), pnpm-workspace, .nvmrc, .npmrc engine-strict, .gitignore, docker-compose db, .env.example, apps/api NestJS, apps/web Next tối thiểu | PRJ-REQ-20261006-095422475 | - | done |
| 2 | Bốn lệnh chuẩn pnpm lint, typecheck, test, build; ESLint cấm Unsafe, process.env ngoài module cấu hình, console.*; Jest là công cụ test duy nhất | PRJ-REQ-20261006-095422475, PRJ-REQ-20261006-095422563 | 1 | done |
| 3 | Module cấu hình: schema zod lúc khởi động, registerConfigSchema, quy tắc prod, fail-fast nêu tên biến | PRJ-REQ-20261006-095422735, PRJ-SEC-20261006-095847406 | 1 | done |
| 4 | Logger pino JSON, bộ che dữ liệu nhạy cảm, correlation_id qua AsyncLocalStorage | PRJ-REQ-20261006-095422908 | 3 | done |
| 5 | Sổ mã lỗi, DomainError, bộ lọc ngoại lệ toàn cục problem+json | PRJ-REQ-20261006-095422820, PRJ-API-20261006-095847320 | 4 | done |
| 6 | Prisma schema theo module và bốn migration (audit_logs kèm trigger, outbox, idempotency, rate_limit_counters UNLOGGED); kiểm lệch schema và kiểm tương thích ngược | PRJ-DB-20261006-095847232, PRJ-REQ-20261006-095422563 | 1 | done |
| 7 | PrismaService, TransactionService (READ COMMITTED, hạn 10 giây, thử lại 40001/40P01), chờ CSDL 30 giây lúc khởi động, 503 khi mất CSDL | PRJ-REQ-20261006-095422563, PRJ-DB-20261006-095847232 | 3, 5, 6 | done |
| 8 | Middleware HTTP: X-Request-Id, IP tin cậy, header an toàn, CORS, giới hạn 1 MB và 415 | PRJ-REQ-20261006-095422650, PRJ-API-20261006-095847320 | 4, 5 | done |
| 9 | Guard mặc định từ chối, SessionContext, @Public, @Roles, @SystemEndpoint, CSRF theo Origin, test quét route | PRJ-REQ-20261006-095422650, PRJ-SEC-20261006-095847406 | 5, 8 | done |
| 10 | Schema zod bắt buộc (@Validate), từ chối trường lạ, phân trang dùng chung | PRJ-REQ-20261006-095422650 | 5 | done |
| 11 | Giới hạn tần suất bậc A đến E (PostgreSQL UNLOGGED cho A, B, D, E; bộ nhớ cho C), Retry-After | PRJ-REQ-20261006-095422650, PRJ-DB-20261006-095847232 | 7, 9 | done |
| 12 | Idempotency-Key: @Idempotent, IdempotencyService trong cùng giao dịch, phát lại, 422, 400 | PRJ-REQ-20261006-095422650, PRJ-DB-20261006-095847232 | 7, 9, 10 | done |
| 13 | Health liveness và readiness | PRJ-API-20261006-095847320 | 7, 9 | done |
| 14 | AuditService (cùng giao dịch, bộ che, gộp mỗi phút), trigger chặn UPDATE/DELETE | PRJ-REQ-20261006-095422908, PRJ-DB-20261006-095847232 | 4, 7 | done |
| 15 | Outbox: events.publish, publishAfterCommit, subscribe, relay at-least-once theo aggregate, ProcessedEvent, backoff, OUTBOX_MAX_ATTEMPTS | PRJ-REQ-20261006-095422563, PRJ-DB-20261006-095847232, PRJ-FLOW-20261006-095422996 | 7 | done |
| 16 | JobRunner (pg_try_advisory_lock trên kết nối riêng), job retention, rate-limit-gc, outbox-relay | PRJ-REQ-20261006-095422563, PRJ-DB-20261006-095847232 | 7, 15 | done |
| 17 | Lệnh seed chỉ chạy ở dev | PRJ-REQ-20261006-095422563 | 3 | done |
| 18 | Kiểm ranh giới module và truy cập bảng chéo module (scripts/check-boundaries.mjs) | PRJ-REQ-20261006-095422475, PRJ-SEC-20261006-095847406 | 1, 6 | done |
| 19 | Quét bí mật (hook trước commit và CI), cổng quét lỗ hổng phụ thuộc (mức high) | PRJ-REQ-20261006-095422475, PRJ-SEC-20261006-095847406 | 1 | done |
| 20 | Workflow GitHub Actions (ci.yml, audit.yml hàng tuần), smoke từ .env.example, kiểm NEXT_PUBLIC_* khi build web | PRJ-REQ-20261006-095422475, PRJ-REQ-20261006-095422735 | 2, 6, 18, 19 | done |
| 21 | Sao lưu tự động ở prod, giữ log 30 ngày ở host, kho bí mật của host, chặn merge khi CI đỏ (cấu hình hạ tầng, kiểm bằng review) | PRJ-REQ-20261006-095422563, PRJ-REQ-20261006-095422908 | - | blocked |
| 22 | Sửa lần hai theo review: test chạy được trên runner sạch (bỏ đường dẫn Homebrew/nvm, giả lập Node sai bằng `--config.node-version`), smoke dùng cùng CSDL và vai trò với job verify | PRJ-REQ-20261006-095422475 | 20 | done |
| 23 | Cổng quét lỗ hổng đóng khi lỗi (registry lỗi, `{"error"}`, thiếu metadata, thoát khác 0 không lỗ hổng thì thoát 2) | PRJ-REQ-20261006-095422475, PRJ-SEC-20261006-095847406 | 19 | done |
| 24 | Quét bí mật bắt URL có mật khẩu, gán kết thúc bằng `;`, khóa JSON camelCase, tên chữ thường | PRJ-REQ-20261006-095422475, PRJ-SEC-20261006-095847406 | 19 | done |
| 25 | Bộ che log theo mẫu (số thẻ qua Luhn, Bearer/Basic, password=, URL có userinfo, email) cho msg, err (message, stack, cause, thuộc tính), giá trị lồng; mở rộng tên trường | PRJ-REQ-20261006-095422908 | 4 | done |
| 26 | Vai trò CSDL ứng dụng: `ecom_app` chỉ INSERT/SELECT `audit_logs`, `ecom_retention` cho job dọn, trigger chặn TRUNCATE, bỏ cờ `app.audit_purge`, migration 20261006000500, `RETENTION_DATABASE_URL`, `MIGRATE_DATABASE_URL` | PRJ-DB-20261006-095847232, PRJ-SEC-20261006-095847406 | 14, 16 | done |
| 27 | Test quét route chạy trên AppModule thật và kiểm guard toàn cục có mặt | PRJ-REQ-20261006-095422650 | 9 | done |
| 28 | JobRunner hủy thân job bằng AbortSignal khi quá hạn, nhả khóa sau khi thân dừng; `LEASE_MS` lớn hơn hạn job cộng hạn chờ hủy | PRJ-REQ-20261006-095422563, PRJ-DB-20261006-095847232 | 15, 16 | done |
| 29 | Test idempotency theo `user_id` (hai người cùng khóa và scope) | PRJ-REQ-20261006-095422650 | 12 | done |
| 30 | `docs/runbook-prod.md`: liệt kê việc hạ tầng của task 21, người làm, cách kiểm (task 21 vẫn `blocked`) | PRJ-REQ-20261006-095422563, PRJ-REQ-20261006-095422908 | 21 | done |
| 31 | Test cho `RateLimitService.check/hitCounter/reset`, `@RateLimit` bậc A, bậc D (cửa sổ tùy chỉnh, hai instance) và khóa `key`; năm TC mới | PRJ-REQ-20261006-095422650, PRJ-API-20261006-095847320 | 11 | done |
| 32 | Cổng kiểm cứng hơn theo TC mới cho T1, T3, T11, T21: quét bí mật đỏ khi git lỗi hoặc không có tệp nào, build web đọc cả tệp `.env` của web, lint cấm `Unsafe` qua ngoặc vuông và tách thuộc tính, thêm TC cho từng ca | PRJ-REQ-20261006-095422475, PRJ-REQ-20261006-095422563, PRJ-REQ-20261006-095422735, PRJ-SEC-20261006-095847406 | 19, 23, 24 | done |
| 33 | Sửa test của dự án: bỏ đường dẫn máy dev trong mẫu của test vệ sinh, cài pnpm của TC Node đúng chạy ở bản sao tạm thay vì repo thật (phát hiện từ clean_run) | PRJ-REQ-20261006-095422475 | 22 | done |
| 34 | Đồng bộ spec qua sdlc-impact: sửa sáu tài liệu, sáu báo cáo `spec/changes/`, duyệt mười TC mới | PRJ-REQ-20261006-095422650, PRJ-REQ-20261006-095422563, PRJ-API-20261006-095847320, PRJ-DB-20261006-095847232, PRJ-SEC-20261006-095847406, PRJ-TC-20261006-120200101 | 31, 32 | done |
| 35 | Chạy lại bốn lệnh chuẩn trong bản clone sạch (`git worktree`, `env -i`, PostgreSQL docker) để đặt `clean_run: pass` | PRJ-REQ-20261006-095422475 | 33, 34, 36 | done |
| 36 | Bổ sung test từ phát hiện của review độc lập: CSRF với PUT, PATCH, DELETE, HSTS, mặc định từ chối khi chạy thật, biên độ dài `Idempotency-Key` | PRJ-REQ-20261006-095422650 | 31 | done |

## Kết quả test
Mỗi test case của epic một dòng. Mọi test chạy trên PostgreSQL 16 thật (docker compose, cổng 5433), không mock giao dịch hay trigger. Công cụ test: Jest (`apps/api`, thư mục `apps/api/test`); test của công cụ gốc (script CI, hook, workflow) cũng nằm ở đó để chỉ có một công cụ test.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| PRJ-TC-20261006-100124068 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | YẾU: Chạy `pnpm dev` thật qua scripts/smoke.mjs (cổng ngẫu nhiên, biến lấy từ .env.example, CSDL docker compose). Ứng dụng chạy bằng vai trò hạn chế `ecom_app` trên CSDL test của `TEST_DB_BASE` (cùng cấu hình với job verify của CI, không còn phụ thuộc `ecom_dev`). Chưa chạy trong container sạch và chưa đo mốc 15 phút (job smoke của CI làm việc đó). |
| PRJ-TC-20261006-100124092 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | YẾU: Dự án pnpm tạm với lockfile lệch (ERR_PNPM_OUTDATED_LOCKFILE) và kiểm thứ tự bước trong ci.yml; chưa chạy trên GitHub Actions thật. |
| PRJ-TC-20261006-100124114 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | - |
| PRJ-TC-20261006-100124136 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | Git repo tạm với hook thật (.githooks/pre-commit); CI quét bằng scripts/scan-secrets.mjs; --no-verify đã thử. Mẫu quét đã mở rộng (URL có mật khẩu, `;`, JSON camelCase, tên chữ thường) và có ca dương tính từng dạng. |
| PRJ-TC-20261006-100124159 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | YẾU: Dùng đầu ra `pnpm audit --json` giả (fixture) và `pnpm` giả trong PATH (in `{"error"}` rồi thoát 1: cổng phải thoát 2, không in `high=0`); không gọi registry thật trong test. Lịch tuần nằm ở .github/workflows/audit.yml (chưa chạy thật). |
| PRJ-TC-20261006-100124183 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | Test chạy `pnpm lint`, `pnpm typecheck` với môi trường rỗng (`env -i`) và kiểm ci.yml (không lọc đường dẫn, không secrets.*); `pnpm test` và `pnpm build` với môi trường rỗng chạy tay ở bước kiểm cuối. |
| PRJ-TC-20261006-100124207 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | Fixture hai chiều; thông báo nêu "liên lạc ngược chiều chỉ bằng domain event". |
| PRJ-TC-20261006-100124230 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | - |
| PRJ-TC-20261006-100124253 | TC | apps/api/test/platform/db.spec.ts | pass | - |
| PRJ-TC-20261006-100124276 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | - |
| PRJ-TC-20261006-100124299 | TC | apps/api/test/platform/db.spec.ts | pass | Rút ngắn 30 giây xuống 3 giây bằng DB_CONNECT_RETRY_SECONDS; assert thử lại có giới hạn và không lộ mật khẩu. |
| PRJ-TC-20261006-100124322 | TC | apps/api/test/platform/db.spec.ts | pass | Ngắt CSDL bằng proxy TCP tới PostgreSQL thật (không dừng container dùng chung). |
| PRJ-TC-20261006-100124346 | TC | apps/api/test/platform/seed.spec.ts | pass | Seed chỉ chạy ở `APP_ENV=dev`. Đối chứng "dev và test" của TC thành "dev" (việc người, xem Lệch spec mục 29) |
| PRJ-TC-20261006-100124369 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | Hai tiến trình `prisma migrate deploy` song song trên CSDL trống. |
| PRJ-TC-20261006-100124391 | TC | apps/api/test/platform/db.spec.ts | pass | - |
| PRJ-TC-20261006-100124415 | TC | apps/api/test/tooling/lint-and-web.spec.ts | pass | - |
| PRJ-TC-20261006-100124438 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | - |
| PRJ-TC-20261006-100124463 | TC | apps/api/test/platform/http.spec.ts | pass | Thêm ca HSTS: có ở staging, không ở dev; đột biến bỏ HSTS làm test đỏ |
| PRJ-TC-20261006-100124486 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124510 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124533 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124556 | TC | apps/api/test/platform/http.spec.ts | pass | Thêm ca chạy thật: route không khai quyền nhận 403 với guest, customer, admin; đột biến cho qua khi thiếu quyền làm test đỏ |
| PRJ-TC-20261006-100124579 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124603 | TC | apps/api/test/platform/http.spec.ts | pass | Thêm ca PUT, PATCH, DELETE (nguồn lạ 403, hợp lệ qua); đột biến chỉ giữ POST làm test đỏ. Đợt `sdlc-impact` AUTH: Then đổi sang `csrf_failed`, thêm ca `Origin` lạ không cookie (một test riêng cùng ID ở cuối `http.spec.ts`) |
| PRJ-TC-20261006-100124626 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124650 | TC | apps/api/test/platform/http.spec.ts | pass | Đồng hồ giả (Clock). Ca `@RateLimit` bậc chặt hơn kiểm ở PRJ-TC-20261006-110200110. |
| PRJ-TC-20261006-100124673 | TC | apps/api/test/platform/http.spec.ts | pass | YẾU: Ký tự xuống dòng kiểm ở mức hàm resolveCorrelationId vì client HTTP của Node từ chối gửi header như vậy; các ca còn lại qua HTTP thật. |
| PRJ-TC-20261006-100124695 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124743 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124768 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124791 | TC | apps/api/test/platform/db.spec.ts | pass | - |
| PRJ-TC-20261006-100124815 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124838 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124861 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100124883 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100124905 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100124927 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100124950 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100124974 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100124999 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100125022 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-100125046 | TC | apps/api/test/tooling/lint-and-web.spec.ts | pass | Build dừng ở scripts/check-public-env.mjs trước `next build` nên không có tệp build nào chứa giá trị; ca bỏ biến thì `pnpm build` thật chạy ở bước kiểm cuối. |
| PRJ-TC-20261006-100125068 | TC | apps/api/test/tooling/lint-and-web.spec.ts | pass | - |
| PRJ-TC-20261006-100125091 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125114 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125137 | TC | apps/api/test/platform/db.spec.ts | pass | - |
| PRJ-TC-20261006-100125161 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | Dùng lỗi not-found dùng chung của platform. |
| PRJ-TC-20261006-100125184 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125208 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125232 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125256 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125280 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125304 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125327 | TC | apps/api/test/platform/audit.spec.ts | pass | Thao tác hủy đơn thử trong FixtureController; ORD thật kiểm ở test của ORD. |
| PRJ-TC-20261006-100125350 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125373 | TC | apps/api/test/platform/audit.spec.ts | pass | - |
| PRJ-TC-20261006-100125396 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125420 | TC | apps/api/test/platform/audit.spec.ts | pass | Kết nối bằng vai trò `ecom_app`: UPDATE, DELETE, TRUNCATE và `SET app.audit_purge` rồi DELETE đều `permission denied`; test SB-32 cùng tệp kiểm trigger với superuser và vai trò có quyền bảng nhưng không phải `app_retention`, cờ vô hiệu. Ghi chú của TC còn nhắc cờ `app.audit_purge` (việc người, xem Lệch spec mục 29) |
| PRJ-TC-20261006-100125447 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125471 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-100125494 | TC | apps/api/test/platform/audit.spec.ts | pass | - |
| PRJ-TC-20261006-100125518 | TC | apps/api/test/platform/events.spec.ts | pass | Relay chạy sau và ngoài ngữ cảnh request; job do JobRunner chạy. |
| PRJ-TC-20261006-100125541 | TC | apps/api/test/platform/errors-logging.spec.ts | pass | - |
| PRJ-TC-20261006-110200101 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-110200102 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-110200103 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-110200104 | TC | apps/api/test/platform/events.spec.ts | pass | Giết tiến trình thật: tiến trình con commit rồi bị SIGKILL, relay chạy sau ở tiến trình khác. |
| PRJ-TC-20261006-110200105 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-110200106 | TC | apps/api/test/platform/events.spec.ts | pass | YẾU: Hai JobRunner (mỗi cái một kết nối pg riêng, hai phiên khác nhau) trong cùng tiến trình Jest, không phải hai tiến trình HĐH; khóa tư vấn tính theo phiên nên tương đương. |
| PRJ-TC-20261006-110200107 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-110200108 | TC | apps/api/test/platform/http.spec.ts | pass | Thêm biên độ dài khóa 7, 8, 64, 65 ký tự |
| PRJ-TC-20261006-110200109 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-110200110 | TC | apps/api/test/platform/http.spec.ts | pass | Hai instance = hai ứng dụng Nest trong cùng tiến trình dùng chung một PostgreSQL thật (bộ đếm bậc C tách theo instance). |
| PRJ-TC-20261006-110200111 | TC | apps/api/test/platform/http.spec.ts | pass | Verifier VNPay thật kiểm ở test của PAY. Bậc E mặc định 300/phút/IP kiểm bằng 301 yêu cầu. |
| PRJ-TC-20261006-110200112 | TC | apps/api/test/platform/audit.spec.ts | pass | - |
| PRJ-TC-20261006-110200113 | TC | apps/api/test/platform/audit.spec.ts | pass | - |
| PRJ-TC-20261006-110200114 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | - |
| PRJ-TC-20261006-110200115 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | - |
| PRJ-TC-20261006-120200101 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | YẾU: Node sai giả lập bằng `pnpm install --frozen-lockfile --config.node-version=22.11.0` trong bản sao tạm (đúng số của TC, nhưng không có Node 22.11.0 thật); Node đúng là Node 24 đang chạy test, cài trong bản sao tạm (`--ignore-scripts`), không đụng repo thật (TC đã sửa cách dựng theo PRJ-TC này). Không còn đường dẫn máy dev trong test |
| PRJ-TC-20261006-120200102 | TC | apps/api/test/platform/config.spec.ts | pass | Giá trị bí mật hợp lệ kiểm ở mức loadConfig (prod cần TLS nên không khởi động thật được với PostgreSQL docker không TLS); ca lỗi chạy ứng dụng thật, stderr không có giá trị. |
| PRJ-TC-20261006-120200103 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-120200104 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-120200105 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-120200106 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | Kiểm tương thích ngược bằng quy tắc regex (scripts/check-migration-compat.mjs), bước thu hẹp hợp lệ phải có dòng `-- contract-step:`. |
| PRJ-TC-20261006-160720924 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | Bậc A: lần 1 đến 3 qua, lần 4 bị 429, tách theo người dùng và theo IP guest, Retry-After nguyên trong 1..60, qua cửa sổ thì qua lại. Đột biến `windowSeconds` và `limit` đã thử |
| PRJ-TC-20261006-160721024 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | Bậc D, cửa sổ 10 giây, hai ứng dụng Nest trong cùng tiến trình dùng chung PostgreSQL thật; sang cửa sổ mới sau 11 giây |
| PRJ-TC-20261006-160721116 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | `key` theo tham số `account`: khác người dùng cùng khóa đếm chung, khác khóa đếm riêng, route khác không đếm chung |
| PRJ-TC-20261006-160721210 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | `check` không tạo và không tăng bộ đếm, `hitCounter` 1, 2, 3, 4, `reset` về 1; chạy trên PostgreSQL thật, đồng hồ giả |
| PRJ-TC-20261006-160721307 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | `limit` 0, cửa sổ mới, `reset` khóa chưa có không lỗi, khóa độc lập, không va chạm bộ đếm của `@RateLimit` |
| PRJ-TC-20261007-144433649 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | TC mới (sdlc-impact review PRM): `take` nguyên tử (40 lời gọi song song chỉ qua đúng 10, `count` 1 đến 40 không trùng), `refund` không xuống dưới 0, `reset`, cửa sổ mới; PostgreSQL thật |
| PRJ-TC-20261013-184314241 | TC | apps/api/test/platform/rate-limit.spec.ts | pass | TC mới (sdlc-impact đợt nền 2026-10-13, REV-REV-15, L133): cùng đường dẫn khác method hoặc khác độ dài cửa sổ (GET, PUT 3 mỗi 3600 giây, DELETE 100 mỗi 60 giây) không trừ lượt của nhau ở đầu giờ; ĐỎ trước khi sửa `rate-limit.ts` (PUT lần đầu nhận 429), xanh sau; PostgreSQL thật, đồng hồ giả |
| PRJ-TC-20261013-184314345 | TC | apps/api/test/platform/client-ip.spec.ts | pass | TC mới (đợt nền 2026-10-13, REV-PAY-02): `clientIp` và `normalizeIp` đổi IPv4 ánh xạ IPv6 về `a.b.c.d` ở IP kết nối và `X-Forwarded-For`, giữ nguyên chuỗi khác; test đơn vị (không phụ thuộc máy chủ) |
| PRJ-TC-20261013-184314446 | TC | apps/api/test/platform/events.spec.ts | pass | TC mới (đợt nền 2026-10-13, L129, REV-NTF-05): `DB_POOL_MAX` = 2, tám event song song qua consumer hai pha không treo; lỗi tạm thời ở `prepare` và `SKIP` không để lại ProcessedEvent; PostgreSQL thật |
| PRJ-TC-20261013-184314546 | TC | apps/api/test/platform/events.spec.ts | pass | TC mới (đợt nền 2026-10-13, L85): payload `null`, mảng, chuỗi, số bị bác trước `prepare` và `handle`, log không chứa payload, đánh dấu đã xử lý; `{}` vẫn tới handler; PostgreSQL thật |
| PRJ-TC-20261013-185818272 | TC | apps/api/test/platform/events.spec.ts | pass | TC mới (đợt nền 2026-10-13, L70): `jobs.register` từ chối tên trùng, lịch là chu kỳ `every` từ lúc khởi động (lần đầu sau một chu kỳ, khởi động lại đếm lại); PostgreSQL thật |
| PRJ-TC-20261006-160721401 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | Tám dạng bí mật, mỗi dạng một ca dương tính, chín dòng âm tính, ca `scan-secrets:allow` |
| PRJ-TC-20261006-160721494 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | Thư mục không phải git và kho không có tệp: thoát mã 2; `--staged` rỗng thoát 0. Đỏ trên mã cũ (thoát 0 với "sạch (0 tệp)" và in stack) |
| PRJ-TC-20261006-160721590 | TC | apps/api/test/tooling/lint-and-web.spec.ts | pass | Bốn tên tệp `.env*` với bốn dạng tên cấm, dạng `export`, dòng chú thích, thư mục sai thoát mã 2. Đỏ trên mã cũ (chỉ đọc biến môi trường tiến trình) |
| PRJ-TC-20261006-160721686 | TC | apps/api/test/tooling/lint-and-web.spec.ts | pass | ESLint thật trên mã giả: ngoặc vuông, tách thuộc tính, trong giao dịch. Đỏ trên cấu hình cũ (chỉ khớp `.property.name`) |
| PRJ-TC-20261006-160721784 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | Bốn đầu vào hỏng, `pnpm` giả ba kiểu, kết quả hợp lệ qua; không gọi registry thật |
| PRJ-TC-20261006-180338418 | TC | apps/api/test/platform/http.spec.ts | pass | TC thêm ở đợt `sdlc-impact` AUTH: thứ tự kiểm của nền (415, 429, CSRF 403, 401, role 403, schema 400); fixture `/fx/ordered`; đột biến đổi thứ tự `CsrfGuard` và `AuthGuard` làm test đỏ |

## Kiểm đột biến
Gài đột biến có chủ ý vào mã (bản sao lưu rồi khôi phục, `git diff` sạch sau đó), chạy bộ test của đối tượng. Mỗi SB `Kiểm bằng: test` của PRJ (SB-16, SB-18, SB-20, SB-27, SB-32, SB-40) có ít nhất một dòng; thêm các cổng kiểm và hàm mới của lượt này. Ba đột biến lọt ở lượt đầu của review độc lập (CSRF PUT, PATCH, DELETE, HSTS, mặc định từ chối khi chạy thật) đã được bù bằng test và nay bắt. Một đột biến ban đầu lọt (bỏ kiểm `{"error"}` của audit-gate vẫn qua vì kiểm `metadata` bắt cùng ca): thay bằng hai đột biến độc lập ở hai dòng cuối.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-16: bỏ danh sách tiền tố bí mật giữ chỗ ở prod (`config.ts`) | PRJ-TC-20261006-100124905, PRJ-TC-20261006-120200102 | bắt |
| SB-18: bộ che bỏ khóa `passw` (`redact.ts`) | PRJ-TC-20261006-100125350 | bắt |
| SB-20: phản hồi 500 kèm `message` của lỗi (`problem.filter.ts`) | PRJ-TC-20261006-100125114, PRJ-TC-20261006-100125396 | bắt |
| SB-27: ProcessedEvent đổi `DO NOTHING` thành `DO UPDATE` (`events.service.ts`) | PRJ-TC-20261006-110200105, PRJ-TC-20261006-120200105 | bắt |
| SB-32: cấp UPDATE trên `audit_logs` cho `app_runtime` (migration 20261006000500) | PRJ-TC-20261006-100125420 | bắt |
| SB-40: bỏ lọc `user_id` ở SELECT của idempotency (`idempotency.ts`) | PRJ-TC-20261006-110200109 | bắt |
| `RateLimitService.check` đổi `<` thành `<=` | PRJ-TC-20261006-160721210, PRJ-TC-20261006-160721307 | bắt |
| `RateLimitService.reset` không xóa gì | PRJ-TC-20261006-160721210, PRJ-TC-20261006-160721307 | bắt |
| `RateLimitGuard` bỏ qua `key` tùy chỉnh | PRJ-TC-20261006-160721116 | bắt |
| `RateLimitGuard` luôn dùng cửa sổ 60 giây thay `windowSeconds` | PRJ-TC-20261006-160721024 | bắt |
| scan-secrets: quét 0 tệp thoát 0 | PRJ-TC-20261006-160721494 | bắt |
| scan-secrets: bỏ mẫu URL có mật khẩu | PRJ-TC-20261006-160721401 | bắt |
| check-public-env: bỏ đọc tệp `.env` | PRJ-TC-20261006-160721590 | bắt |
| ESLint: UNSAFE_SQL chỉ khớp `property.name` | PRJ-TC-20261006-160721686 | bắt |
| audit-gate: pnpm thoát 1 mà không có lỗ hổng thì cho qua | PRJ-TC-20261006-160721784 | bắt |
| audit-gate: không đòi `metadata.vulnerabilities` | PRJ-TC-20261006-160721784 | bắt |
| CSRF chỉ kiểm POST (bỏ PUT, PATCH, DELETE) | PRJ-TC-20261006-100124603 | bắt |
| HSTS bỏ (`app-setup.ts`) | PRJ-TC-20261006-100124463 | bắt |
| AuthGuard cho qua khi route không khai quyền (`session.ts`) | PRJ-TC-20261006-100124556 | bắt |
| `Idempotency-Key` đổi độ dài tối đa 64 thành 65, tối thiểu 8 thành 7 (`idempotency.ts`) | PRJ-TC-20261006-110200108 | bắt |
| Relay bỏ thứ tự theo aggregate (`outbox-relay.ts`) | PRJ-TC-20261006-120200104 | bắt |
| `requestHash` bỏ thân yêu cầu (`idempotency.ts`) | PRJ-TC-20261006-110200108, PRJ-TC-20261006-110200109 | bắt |
| JobRunner bỏ hủy thân job khi quá hạn (`job-runner.ts`) | PRJ-TC-20261006-110200106 | bắt |

## Lệch spec
Lượt triển khai đầu không sửa `spec/`; lượt đóng epic sửa spec qua `sdlc-impact` (mục 28). Chỗ spec thiếu, mâu thuẫn hoặc không làm được trong repo được chọn mặc định hợp lý như dưới; mục đã được spec sửa theo ghi "spec đã sửa". Nhãn: `[đã chọn]` quyết định mặc định đã làm, `[chưa làm]` spec yêu cầu mà chưa làm, `[cần quyết]` cần người quyết.

1. [đã chọn] **Số phiên bản công cụ** (spec chỉ ghim Node 24 và pnpm): chọn NestJS 11, Prisma 6.19, TypeScript 5.9, zod 3.25, pino 9, Jest 30 + ts-jest 29, Next.js 15 + React 19.1, ESLint 9. Không dùng các bản mới nhất trên npm (NestJS 12, Prisma 8 rc, TypeScript 7, zod 4, ESLint 10) vì chưa ổn định với nhau; không đổi stack so với ADR.
2. [đã chọn] **`SessionContext`**: PRJ-REQ/PRJ-API ghi `{user_id, role, email_verified}`, ADR-012 (đợt 4) thêm `display_name`; cài `display_name?` (tùy chọn). Không có cách phân biệt guest trong interface: guest là `null`.
3. [đã chọn] **`@RateLimit`**: PRJ-REQ BR7 ghi `{ tier, perWindow, window }`, PRJ-API và PRJ-TC-20261006-110200110 ghi `{ tier, limit, windowSeconds, key }`; làm theo PRJ-API/TC. Hợp đồng đếm theo kết quả của ADR-014 (`check`, `hit`, `reset`) không có chữ ký ở PRJ-API: cài `RateLimitService.check(key, limit, windowSeconds)`, `hitCounter(key, windowSeconds)` (cần thêm `windowSeconds` vì cửa sổ không nằm trong khóa), `reset(key)`. Spec đã sửa qua sdlc-impact (BR7 theo `{ tier, limit, windowSeconds, key }`, PRJ-API có chữ ký `RateLimitService`) và có năm TC mới (PRJ-TC-20261006-160720924, 160721024, 160721116, 160721210, 160721307).
4. [đã chọn] **Seed**: PRJ-REQ-563 BR9 nói `APP_ENV` là "dev hoặc test" nhưng BR1 của PRJ-REQ-735 chỉ cho `dev`, `staging`, `prod`. Seed chỉ chạy khi `APP_ENV=dev`; test chạy với `APP_ENV=dev`. Spec đã sửa: BR9 bỏ "hoặc test", ADR-007 ghi tập đóng `dev`, `staging`, `prod`; chỉ còn đối chứng của PRJ-TC-20261006-100124346 nói "dev và test" (việc người, mục 29).
5. [đã chọn] **Biến cấu hình bổ sung** (spec nói "đổi bằng cấu hình" nhưng không đặt tên): `DB_CONNECT_RETRY_SECONDS` (30), `DB_TRANSACTION_TIMEOUT_MS` (10000), `DB_TRANSACTION_RETRIES` (3), `DB_STATEMENT_TIMEOUT_MS` (15000, truyền cho PostgreSQL qua tham số kết nối `options`). `PORT` mặc định 3802 (web giữ 3801). Spec đã sửa: ADR-007 liệt kê các biến, PRJ-REQ-20261006-095422563 BR5 và BR8 nêu tên biến.
6. [đã chọn] **Phạm vi quy tắc prod**: TLS của `DATABASE_URL` bắt buộc ở staging và prod (PRJ-REQ-563 BR7); bí mật không giữ chỗ, CORS không `*`, `LOG_LEVEL` không debug/trace chỉ ở prod (PRJ-REQ-735 BR4). `CORS_ALLOWED_ORIGINS` chứa `*` ở dev vẫn khởi động được (đúng PRJ-TC-20261006-100124927) nhưng không bao giờ phản chiếu `*`: chỉ nguồn khớp đúng mới được cấp header.
7. [đã chọn] **Bí mật rỗng ở prod**: spec vừa coi rỗng là "thiếu" (BR2) vừa là "giữ chỗ" (BR4); báo "thiếu hoặc rỗng" (một lý do cho cả hai).
8. [đã chọn] **CSRF**: spec nói "khi dùng cookie phiên" nhưng tên cookie phiên do AUTH đặt, PRJ chưa biết; kiểm Origin/Referer cho mọi POST/PUT/PATCH/DELETE có header `Cookie` bất kỳ. Cookie SameSite=Lax do AUTH đặt khi cấp phiên (ngoài PRJ).
9. [đã chọn] **Audit gộp**: `coalesce: { key, window }` của PRJ-REQ BR10; khóa gộp thật là `(actor_id, action)` theo PRJ-DB mục 2, `key` chỉ để mô tả. Hai yêu cầu song song vẫn có thể ghi hai dòng (đã nêu ở PRJ-DB).
10. [đã chọn] **`@Idempotent`**: handler nhận `tx` của khóa qua `@DbTx()`; mã trạng thái lưu lấy từ `@HttpCode` hoặc mặc định (POST 201); chỉ phản hồi thành công được lưu (4xx và 5xx rollback cùng khóa).
11. [cần quyết] **`@SystemEndpoint`**: phản hồi mặc định theo kiểu VNPay `{RspCode, Message}` HTTP 200 (`97` chữ ký sai, `99` lỗi hệ thống), module PAY ghi đè được qua `reject`/`internalError`. Bậc E mặc định 300 yêu cầu mỗi phút mỗi IP vì SB-14 nói số do PAY chốt (cần quyết khi làm PAY).
12. [đã chọn] **Thứ tự kiểm**: 413 và 415 xảy ra ở middleware trước giới hạn tần suất, nên không tính vào bộ đếm; guard theo thứ tự giới hạn tần suất, CSRF, xác thực và quyền, rồi schema (interceptor), rồi `Idempotency-Key`.
13. [đã chọn] **Event không có consumer**: relay đánh dấu `dispatched_at` ngay (không có ai nhận); `publishAfterCommit` gọi ngoài giao dịch thì phát ở `setImmediate`.
14. [đã chọn] **Test trước, code sau**: khung platform được dựng theo thiết kế trước rồi test viết ngay sau (không có lần chạy "fail đúng lý do" trước cho từng test). Thay vào đó đã phá mã có chủ ý 5 chỗ (bỏ cờ `app.audit_purge`, cắt trần backoff, bỏ `email` khỏi bộ che, bỏ kiểm Origin, bỏ `DO NOTHING` của ProcessedEvent) và test tương ứng đều đỏ, rồi khôi phục.
15. [đã chọn] **Bằng chứng yếu hơn mô tả TC** (các dòng `YẾU:` ở bảng Kết quả test), kèm cách nâng: PRJ-TC-20261006-100124068 chạy `pnpm dev` thật nhưng không trong container sạch, không đo 15 phút (nâng: chạy job `smoke` của CI trên GitHub rồi đo từ clone); PRJ-TC-20261006-100124092 kiểm thứ tự bước ci.yml bằng đọc tệp, chưa chạy trên GitHub Actions (nâng: chạy workflow thật một lần, runbook mục 7); PRJ-TC-20261006-100124159 dùng đầu ra `pnpm audit` giả (nâng: chạy `audit.yml` thật với gói có lỗ hổng đã biết); PRJ-TC-20261006-110200106 dùng hai `JobRunner` (hai phiên PostgreSQL) trong một tiến trình Jest (nâng: hai tiến trình HĐH, như PRJ-TC-20261006-110200104); PRJ-TC-20261006-120200101 giả lập Node 22.11.0 bằng `--config.node-version` (nâng: chạy job CI với Node 22.11.0 thật); PRJ-TC-20261006-100124673 kiểm ký tự xuống dòng ở mức hàm vì client HTTP của Node từ chối gửi (nâng: gửi qua socket thô). Workflow GitHub Actions chưa được chạy trên GitHub.
16. [đã chọn] **Kiểm tương thích ngược migration** (PRJ-TC-20261006-120200106) là quy tắc regex trên SQL cộng dòng `-- contract-step:` để khai bước thu hẹp; không chứng minh được ngữ nghĩa, người review vẫn phải xem.
17. [đã chọn] **`audit_logs`** (đã sửa ở lần hai, task 26): làm theo PRJ-DB mục 12 và PRJ-SEC T19 thay cho đường cờ `app.audit_purge` mà PRJ-DB mục 12 mô tả. Migration `20261006000500_platform_app_roles` thêm vai trò nhóm `app_runtime` (INSERT, SELECT trên `audit_logs`) và `app_retention` (SELECT, DELETE), trigger `BEFORE TRUNCATE`, và trigger DELETE chỉ cho qua khi vai trò đăng nhập của phiên (`session_user`) là thành viên `app_retention` (superuser dev/test vẫn qua, đúng vai trò quản trị). Không còn cờ `app.audit_purge`. Vai trò đăng nhập `ecom_app`, `ecom_retention` do `docker/initdb/01-app-roles.sql` tạo (docker compose, CI, globalSetup dùng cùng tệp). `DATABASE_URL` của ứng dụng là `ecom_app`; migration chạy bằng `MIGRATE_DATABASE_URL` (superuser, qua `apps/api/scripts/migrate.mjs`); job dọn audit dùng `RETENTION_DATABASE_URL` (biến mới, tùy chọn, rỗng thì dùng `DATABASE_URL`, tên đã vào ADR-007; ADR-007 ghi "rỗng thì job dọn không chạy" khác mã, xem mục 29). PRJ-DB mục 12 và PRJ-SEC (T19, mục rủi ro) đã được sửa theo cách này qua sdlc-impact. Bảng khác của PRJ chưa là bảng chỉ thêm theo thiết kế nên giữ đủ quyền cho `app_runtime`; quyền mặc định của bảng mới cấp cho `app_runtime`, bảng chỉ thêm của epic sau phải tự `REVOKE` như `audit_logs`. Còn lại: mật khẩu hai vai trò ở prod do vận hành đặt (task 21, `docs/runbook-prod.md`); các test chung vẫn chạy bằng superuser `ecom`, chỉ test audit, smoke dùng `ecom_app` thật.
18. [đã chọn] **`pnpm install` đặt `core.hooksPath=.githooks`** vào cấu hình git cục bộ của repo (script `prepare`, bỏ qua khi `CI`) để hook quét bí mật chạy; không tạo commit nào.
19. [chưa làm] **Chưa làm trang lỗi web** (404, 500): thuộc epic có màn đầu tiên (AUTH) theo PRJ-REQ-820 BR11; `apps/web` chỉ có trang placeholder.
20. [chưa làm] **Hạ tầng ngoài mã, không làm và không kiểm được trong repo (task 21, blocked)**: sao lưu tự động RPO 24 giờ, RTO 4 giờ và khôi phục thử trước go-live (PRJ-REQ-563 BR10); log giữ 30 ngày ở host (PRJ-REQ-908 BR1); kho bí mật của host (PRJ-REQ-735 BR5); bật "Require status checks" để PR đỏ không merge (PRJ-REQ-475 BR3). Kiểm bằng review trước go-live.
21. [đã chọn] **Spec có chỗ in thừa**: PRJ-TC-20261006-120200101 lặp "**Given** **Given**" ở bước Given. Spec đã sửa (bỏ nhãn lặp, ghi cách dựng thật).
22. [đã chọn] **Lần hai theo review (task 22 đến 30)**: không sửa `spec/`. Test viết đỏ trước rồi sửa: (1) hygiene test quét `apps/api/test` tìm đường dẫn Homebrew, nvm, home (đỏ khi đặt thử một tệp vi phạm); Node sai giả lập bằng `--config.node-version`. Bằng chứng đỏ của CSDL smoke (`ecom_dev` vs `ecom_ci`) chỉ suy ra từ mã (không `DROP DATABASE ecom_dev` được trong môi trường này), xanh với CSDL test. (2) audit-gate và (3) scan-secrets: ca mới đỏ trên mã cũ (thoát 0 với `{"error"}`; không bắt URL có mật khẩu). (4) che log: đỏ trên mã cũ (message, thuộc tính, cause, msg, tên `pwd`, `apiKey`...). (5) migration thêm, đỏ khi bỏ migration (8 test audit đỏ). (6) route-audit: thêm kiểm guard toàn cục. (7) JobRunner: ba test mới đỏ trên mã cũ. (8) bỏ lọc `user_id` ở SELECT idempotency làm test mới đỏ (đã thử đột biến rồi khôi phục).
23. [đã chọn] **Số thẻ che theo kiểm Luhn**: 13 đến 19 chữ số liền hoặc nhóm 4-4-4-4, 4-6-5 ngăn bằng dấu cách hoặc gạch, chỉ che khi qua Luhn để UUID, mã `20261006-100124068`, timestamp không bị che nhầm; chuỗi 16 chữ số tùy ý không qua Luhn không bị che (đổi lại ít báo nhầm). Email trong chuỗi tự do cũng bị che.
24. [đã chọn] **JobRunner khi thân job không dừng sau hủy**: chờ `JOB_ABORT_GRACE_MS` (5 giây) rồi ngắt kết nối giữ khóa (khóa tư vấn mất theo phiên), log `error`, cùng tiến trình không chạy chồng cho tới khi thân dừng. Một thân không tôn trọng AbortSignal vẫn có thể chạy chồng với instance khác; giới hạn đã nêu. `LEASE_MS` = 2 x (hạn job 60 giây + hạn chờ hủy 5 giây) = 130 giây (trước là 60 giây). Hợp đồng `JobDef.run` thêm `signal` (tương thích ngược).
25. [đã chọn] **Quét bí mật**: giá trị tên-gán cần >= 16 ký tự và có ít nhất một chữ số (tránh báo nhầm tên hàm, khóa i18n); URL có mật khẩu bỏ qua host `localhost`, `127.0.0.1`, `[::1]` và mật khẩu giữ chỗ. Dòng giả của test đánh dấu `scan-secrets:allow`. Bí mật dạng khác (không có tên gợi ý, ít hơn 16 ký tự, không chữ số) vẫn lọt: giới hạn của quét theo mẫu.
26. [đã chọn] **Cũng làm từ mục LOW của review**: `ProblemFilter` ánh xạ `HttpException` 503 thành `service-unavailable` (chưa có test riêng); khóa log trùng đổi tên (`env` thành `app_env` ở `config ok`, `module` thành `job_module` ở log lỗi job).
27. [chưa làm] **Việc còn lại (LOW của review chưa làm)**: (bậc A, D, `key`, `check/hitCounter/reset`, CSRF với PUT/PATCH/DELETE và khóa Idempotency 64 và 65 ký tự đã có test); relay log `error` mỗi 3 giây khi mất CSDL (mục 12); `AuditService.record` còn nhận `PrismaClient`, script ranh giới chỉ thấy import tương đối, action GitHub ghim theo tag (mục 13); cảnh báo `TRUST_PROXY_HOPS=0` ở prod, kiểm mật khẩu giữ chỗ của `DATABASE_URL`, log khi ngắt kết nối giữa chừng (mục 14); runtime bỏ qua im lặng route thiếu schema (`validation.ts`, CI bắt bằng route-audit); hướng dẫn cấm gọi hệ thống ngoài trong `@Idempotent` (SB-31); chạy workflow GitHub Actions thật một lần (runbook mục 7).
28. [đã chọn] **Đồng bộ spec theo bài học L31, L32, L33 (lượt đóng epic)**: sửa sáu tài liệu qua `sdlc-impact` (báo cáo `spec/changes/`): PRJ-REQ-20261006-095422650 (BR7), PRJ-REQ-20261006-095422563 (BR5, BR8, BR9), PRJ-API-20261006-095847320 (chữ ký `RateLimitService`), PRJ-DB-20261006-095847232 (mục 11, 12, Migration, seed), PRJ-SEC-20261006-095847406 (T19, T24, rủi ro còn lại), PRJ-TC-20261006-120200101; thêm mười TC mới (năm cho giới hạn tần suất, năm cho các mối đe dọa T1, T3, T11, T21) đã duyệt. Các sửa này ghi theo mã đã chạy và đã review, không đổi hành vi.
29. [cần quyết] **Việc của người, ngoài danh sách tệp được phép sửa**: (a) PRJ-TC-20261006-100124346 còn đối chiếu "Ở dev và test lệnh seed chạy được" (`APP_ENV` chỉ có `dev`); (b) PRJ-TC-20261006-100125420 còn ghi chú kết nối job dọn "đặt cờ `app.audit_purge`" (cơ chế là vai trò `app_retention`); (c) `spec/architecture.md` ADR-007 ghi `RETENTION_DATABASE_URL` "rỗng thì job dọn không chạy" nhưng mã dùng `DATABASE_URL` khi rỗng (`retention.service.ts`), nên ở staging và prod mà không đặt biến này thì DELETE audit bị từ chối: sửa ADR-007 hoặc đổi mã (nên bắt buộc đặt biến ở staging và prod); (d) mật khẩu `ecom_app`, `ecom_retention` ở prod (runbook).
30. [đã chọn] **Cổng quét bí mật đỏ khi hỏng** (từ TC T1 mới): `scripts/scan-secrets.mjs` thoát 2 khi không đọc được danh sách tệp từ git và khi quét CI mà có 0 tệp (trước đây thoát 0 hoặc nổ stack); `--staged` rỗng vẫn thoát 0. Rủi ro: repo hoàn toàn rỗng thì CI đỏ (hợp lý).
31. [đã chọn] **Build web kiểm cả tệp `.env` của web** (từ TC T3 mới): `apps/web/scripts/check-public-env.mjs` đọc `.env`, `.env.local`, `.env.<môi trường>[.local]` của web ngoài biến môi trường tiến trình, thêm `--dir`; thư mục sai thoát 2. Không đọc `.env` ngoài thư mục web.
32. [đã chọn] **Lint cấm `Unsafe` qua ngoặc vuông và tách thuộc tính** (từ TC T11 mới): `eslint.config.mjs` thêm hai dạng AST. Bí mật dạng khác vẫn lọt nếu gọi động (`prisma[name]`): giới hạn của lint tĩnh.
33. [đã chọn] **Test cài pnpm chạy ở bản sao tạm** (phát hiện nhờ clean_run): bước "Node 24 cài được" của PRJ-TC-20261006-120200101 trước chạy `pnpm install` trên repo thật, trên máy kho pnpm khác làm hỏng Prisma Client đã sinh và bộ seed lỗi "did not initialize yet"; nay chạy ở bản sao tạm với `--ignore-scripts`. Test vệ sinh đường dẫn máy dev dựng mẫu từ đoạn để chính tệp không chứa đường dẫn máy.
34. [đã chọn] **Cách chạy `clean_run`** (không được commit nên chỉ gần giống CI): `git worktree add --detach` từ HEAD (e87647e) rồi phủ các tệp đã sửa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH` (Node 24.21.0 từ nvm, `/opt/homebrew/bin` cho pnpm, `/usr/bin`, `/bin`), `HOME` rỗng, `CI=true`, `TEST_DB_BASE`; `pnpm install --frozen-lockfile --offline` dùng kho pnpm của máy; PostgreSQL 16 docker (cổng 5433). Đã chạy: install, scan:secrets, check:boundaries, `migrate deploy` và `db:check` (CSDL `ecom_ci`, `ecom_shadow`), lint, typecheck, test, build, tất cả qua. Không chạy: `psql -f 01-app-roles.sql` (máy không có `psql`; `globalSetup` của test chạy cùng tệp), `check-migration-compat --base` (chỉ cho pull request), job `smoke` riêng (đã chạy trong test, PRJ-TC-20261006-100124068), bước `pnpm/action-setup`, `setup-node` (workflow chưa chạy trên GitHub, xem mục 15).

Cập nhật sau review AUTH (`sdlc-impact`, `spec/changes/AUTH-API-20261006-100006077.md`): spec PRJ khớp mã đã chạy (CSRF `csrf_failed` và kiểm `Origin` cả khi không cookie, thứ tự kiểm của nền, sổ mã lỗi cho `_`); thêm một TC (PRJ-TC-20261006-180338418) và một test cho ca không cookie của PRJ-TC-20261006-100124603; mã nền (`platform`) không đổi trong đợt này. `test_result` là số của riêng các bộ test PRJ (13 suite, không tính `test/auth` và `test/e2e`): 125 cộng 2.
35. [đã chọn] Dọn tồn đọng sau khi kit cải tiến (2026-10-07), `kit_version: 3`: (a) tùy chọn `narrow` của `auditPermissions` (`apps/api/src/modules/platform/http/route-audit.ts`) không còn nơi dùng nên đã xóa, kèm test mới `apps/api/test/platform/route-audit.spec.ts` (3 ca: khớp thì sạch; role rộng hơn hay hẹp hơn hàng ma trận, thiếu `@Action`, `@Action` lạ đều đỏ; ma trận rỗng và phạm vi rỗng đỏ) vì spec PRJ không có TC riêng cho cổng lệch ma trận; (b) `test_result` là số của riêng các bộ test PRJ nay là 14 suite, 132 test (`test/platform` và các spec trong `test/tooling` trừ bảng đột biến của USR); toàn repo là 35 suite, 268 test; (c) `NEXT_TELEMETRY_DISABLED=1` đã có ở `apps/api/test/e2e/support.ts` (tiến trình web) và nay cả ở `.github/workflows/ci.yml` (job `verify`); `clean_run` chạy lại ở AUTH và USR cùng lượt (xem report của hai epic), cùng bản clone sạch chạy lint, typecheck, test, build đều exit 0.
36. [đã chọn] Sửa nền sau sdlc-impact (review PRM REV-PRM-03): `RateLimitService` (`rate-limit.ts`) thêm `take(key, limit, windowSeconds)` nguyên tử (một câu UPSERT, trả `{ allowed, count, retryAfter }`) và `refund(key, windowSeconds)`; giữ nguyên `check`, `hitCounter`, `reset` (không còn nơi dùng trong `src`, còn PRJ-TC-20261006-160721210 và PRJ-TC-20261006-160721307 kiểm). TC kiểm chỗ sửa: PRJ-TC-20261007-144433649. `test_result` nay là 545 do chạy lại toàn repo. Chưa có đột biến riêng của PRJ cho `take` (PRM và AUTH có đột biến đếm không nguyên tử ở bảng của họ).

37. [đã chọn] Đồng bộ nền 2026-10-13 (theo bài học L70, L82, L84, L85, L129, L133 và review REV-REV-15, REV-PAY-02, REV-NTF-05; báo cáo ở `spec/changes/nen-dong-bo-20261013.md`, `PRJ-REQ-20261006-095422563.md`, `PRJ-REQ-20261006-095422650.md`, `PRJ-REQ-20261006-095422735.md`): mã nền đổi ba chỗ, đều có test và TC mới: (a) `rate-limit.ts` khóa bộ đếm của `@RateLimit` thành `<bậc>:<method cộng đường dẫn mẫu hoặc group>:<windowSeconds>s:<chủ thể>` (PRJ-TC-20261013-184314241, ĐỎ trước khi sửa vì PUT 3600 giây và DELETE 60 giây cùng đường dẫn dùng chung một dòng ở đầu giờ); (b) `client-ip.ts` thêm `normalizeIp` (IPv4 ánh xạ IPv6 về `a.b.c.d` một lần cho mọi module), PAY bỏ `normalizeIp` riêng và dùng chung (PRJ-TC-20261013-184314345; bảng đột biến `mutations-pay.json` trỏ lại `client-ip.ts`); (c) `events.service.ts` `deliver` bác payload không phải đối tượng trước `prepare` và `handle` (PRJ-TC-20261013-184314546); thêm TC cho consumer hai pha ở `DB_POOL_MAX` = 2 (PRJ-TC-20261013-184314446) và lịch job (PRJ-TC-20261013-185818272, không đổi mã). Spec PRJ-REQ-563, 650, 735, PRJ-DB, PRJ-API và `architecture.md` (ADR-007, 010, 011, 012, 013, 014, 016, 023, bảng Giao diện module) đã sửa và duyệt lại. `test_result` là toàn repo, số cập nhật ở frontmatter sau lượt chạy cuối của đợt này (không gồm E2E, xem mục 38).

38. [chưa làm] E2E (`apps/api/test/e2e/*.e2e.spec.ts`) KHÔNG chạy được trong đợt đồng bộ nền 2026-10-13: cổng 3100 (web của E2E) đang bị một tiến trình `next-server` ngoài dự án này giữ (thư mục chạy `/Users/fullstackdev/workspace/torus-engineering/Laravel/LMS-013/KTS-OMS/apps/OMS-Storefront`, khởi động 2026-10-12 09:07), và `startE2e` từ chối chạy khi cổng bị giữ để không xanh giả; không dừng tiến trình đó vì không phải của dự án này. Việc của người: dừng nó rồi chạy lại `NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test` đầy đủ (gồm E2E). Mã nền đổi ở đợt này (khóa bộ đếm, `clientIp`, bác payload) chỉ được kiểm bằng test tích hợp, chưa bằng E2E.
