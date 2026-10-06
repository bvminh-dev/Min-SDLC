---
epic: PRJ
status: draft
test_command: pnpm test
test_result: Tests:       113 passed, 113 total
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

## Kết quả test
Mỗi test case của epic một dòng. Mọi test chạy trên PostgreSQL 16 thật (docker compose, cổng 5433), không mock giao dịch hay trigger. Công cụ test: Jest (`apps/api`, thư mục `apps/api/test`); test của công cụ gốc (script CI, hook, workflow) cũng nằm ở đó để chỉ có một công cụ test.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| PRJ-TC-20261006-100124068 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | Chạy `pnpm dev` thật qua scripts/smoke.mjs (cổng ngẫu nhiên, biến lấy từ .env.example, CSDL docker compose). Ứng dụng chạy bằng vai trò hạn chế `ecom_app` trên CSDL test của `TEST_DB_BASE` (cùng cấu hình với job verify của CI, không còn phụ thuộc `ecom_dev`). Chưa chạy trong container sạch và chưa đo mốc 15 phút (job smoke của CI làm việc đó). |
| PRJ-TC-20261006-100124092 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | Dự án pnpm tạm với lockfile lệch (ERR_PNPM_OUTDATED_LOCKFILE) và kiểm thứ tự bước trong ci.yml; chưa chạy trên GitHub Actions thật. |
| PRJ-TC-20261006-100124114 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | - |
| PRJ-TC-20261006-100124136 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | Git repo tạm với hook thật (.githooks/pre-commit); CI quét bằng scripts/scan-secrets.mjs; --no-verify đã thử. Mẫu quét đã mở rộng (URL có mật khẩu, `;`, JSON camelCase, tên chữ thường) và có ca dương tính từng dạng. |
| PRJ-TC-20261006-100124159 | TC | apps/api/test/tooling/ci-guards.spec.ts | pass | Dùng đầu ra `pnpm audit --json` giả (fixture) và `pnpm` giả trong PATH (in `{"error"}` rồi thoát 1: cổng phải thoát 2, không in `high=0`); không gọi registry thật trong test. Lịch tuần nằm ở .github/workflows/audit.yml (chưa chạy thật). |
| PRJ-TC-20261006-100124183 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | Test chạy `pnpm lint`, `pnpm typecheck` với môi trường rỗng (`env -i`) và kiểm ci.yml (không lọc đường dẫn, không secrets.*); `pnpm test` và `pnpm build` với môi trường rỗng chạy tay ở bước kiểm cuối. |
| PRJ-TC-20261006-100124207 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | Fixture hai chiều; thông báo nêu "liên lạc ngược chiều chỉ bằng domain event". |
| PRJ-TC-20261006-100124230 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | - |
| PRJ-TC-20261006-100124253 | TC | apps/api/test/platform/db.spec.ts | pass | - |
| PRJ-TC-20261006-100124276 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | - |
| PRJ-TC-20261006-100124299 | TC | apps/api/test/platform/db.spec.ts | pass | Rút ngắn 30 giây xuống 3 giây bằng DB_CONNECT_RETRY_SECONDS; assert thử lại có giới hạn và không lộ mật khẩu. |
| PRJ-TC-20261006-100124322 | TC | apps/api/test/platform/db.spec.ts | pass | Ngắt CSDL bằng proxy TCP tới PostgreSQL thật (không dừng container dùng chung). |
| PRJ-TC-20261006-100124346 | TC | apps/api/test/platform/seed.spec.ts | pass | - |
| PRJ-TC-20261006-100124369 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | Hai tiến trình `prisma migrate deploy` song song trên CSDL trống. |
| PRJ-TC-20261006-100124391 | TC | apps/api/test/platform/db.spec.ts | pass | - |
| PRJ-TC-20261006-100124415 | TC | apps/api/test/tooling/lint-and-web.spec.ts | pass | - |
| PRJ-TC-20261006-100124438 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | - |
| PRJ-TC-20261006-100124463 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124486 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124510 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124533 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124556 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124579 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124603 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124626 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-100124650 | TC | apps/api/test/platform/http.spec.ts | pass | Đồng hồ giả (Clock). Ca `@RateLimit` bậc chặt hơn kiểm ở PRJ-TC-20261006-110200110. |
| PRJ-TC-20261006-100124673 | TC | apps/api/test/platform/http.spec.ts | pass | Ký tự xuống dòng kiểm ở mức hàm resolveCorrelationId vì client HTTP của Node từ chối gửi header như vậy; các ca còn lại qua HTTP thật. |
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
| PRJ-TC-20261006-100125420 | TC | apps/api/test/platform/audit.spec.ts | pass | Kết nối bằng vai trò `ecom_app`: UPDATE, DELETE, TRUNCATE và `SET app.audit_purge` rồi DELETE đều `permission denied`; test SB-32 cùng tệp kiểm trigger với superuser và vai trò có quyền bảng. |
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
| PRJ-TC-20261006-110200106 | TC | apps/api/test/platform/events.spec.ts | pass | Hai JobRunner (mỗi cái một kết nối pg riêng, hai phiên khác nhau) trong cùng tiến trình Jest, không phải hai tiến trình HĐH; khóa tư vấn tính theo phiên nên tương đương. |
| PRJ-TC-20261006-110200107 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-110200108 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-110200109 | TC | apps/api/test/platform/http.spec.ts | pass | - |
| PRJ-TC-20261006-110200110 | TC | apps/api/test/platform/http.spec.ts | pass | Hai instance = hai ứng dụng Nest trong cùng tiến trình dùng chung một PostgreSQL thật (bộ đếm bậc C tách theo instance). |
| PRJ-TC-20261006-110200111 | TC | apps/api/test/platform/http.spec.ts | pass | Verifier VNPay thật kiểm ở test của PAY. Bậc E mặc định 300/phút/IP kiểm bằng 301 yêu cầu. |
| PRJ-TC-20261006-110200112 | TC | apps/api/test/platform/audit.spec.ts | pass | - |
| PRJ-TC-20261006-110200113 | TC | apps/api/test/platform/audit.spec.ts | pass | - |
| PRJ-TC-20261006-110200114 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | - |
| PRJ-TC-20261006-110200115 | TC | apps/api/test/tooling/boundaries.spec.ts | pass | - |
| PRJ-TC-20261006-120200101 | TC | apps/api/test/tooling/project-setup.spec.ts | pass | Node sai giả lập bằng `pnpm install --config.node-version=22.11.0` (đúng số của TC, không phụ thuộc Node cài sẵn); Node đúng là Node đang chạy test (CI lấy từ `.nvmrc`). Không còn đường dẫn máy dev trong test. |
| PRJ-TC-20261006-120200102 | TC | apps/api/test/platform/config.spec.ts | pass | Giá trị bí mật hợp lệ kiểm ở mức loadConfig (prod cần TLS nên không khởi động thật được với PostgreSQL docker không TLS); ca lỗi chạy ứng dụng thật, stderr không có giá trị. |
| PRJ-TC-20261006-120200103 | TC | apps/api/test/platform/config.spec.ts | pass | - |
| PRJ-TC-20261006-120200104 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-120200105 | TC | apps/api/test/platform/events.spec.ts | pass | - |
| PRJ-TC-20261006-120200106 | TC | apps/api/test/tooling/db-migrations.spec.ts | pass | Kiểm tương thích ngược bằng quy tắc regex (scripts/check-migration-compat.mjs), bước thu hẹp hợp lệ phải có dòng `-- contract-step:`. |

## Lệch spec
Không sửa file nào trong `spec/` (trừ báo cáo này). Chỗ spec thiếu, mâu thuẫn hoặc không làm được trong repo được chọn mặc định hợp lý như dưới; mục cần người quyết có ghi "cần quyết".

1. **Số phiên bản công cụ** (spec chỉ ghim Node 24 và pnpm): chọn NestJS 11, Prisma 6.19, TypeScript 5.9, zod 3.25, pino 9, Jest 30 + ts-jest 29, Next.js 15 + React 19.1, ESLint 9. Không dùng các bản mới nhất trên npm (NestJS 12, Prisma 8 rc, TypeScript 7, zod 4, ESLint 10) vì chưa ổn định với nhau; không đổi stack so với ADR.
2. **`SessionContext`**: PRJ-REQ/PRJ-API ghi `{user_id, role, email_verified}`, ADR-012 (đợt 4) thêm `display_name`; cài `display_name?` (tùy chọn). Không có cách phân biệt guest trong interface: guest là `null`.
3. **`@RateLimit`**: PRJ-REQ BR7 ghi `{ tier, perWindow, window }`, PRJ-API và PRJ-TC-20261006-110200110 ghi `{ tier, limit, windowSeconds, key }`; làm theo PRJ-API/TC. Hợp đồng đếm theo kết quả của ADR-014 (`check`, `hit`, `reset`) không có chữ ký ở PRJ-API: cài `RateLimitService.check(key, limit, windowSeconds)`, `hitCounter(key, windowSeconds)` (cần thêm `windowSeconds` vì cửa sổ không nằm trong khóa), `reset(key)`; chưa có TC riêng. Cần quyết chữ ký chính thức qua sdlc-impact.
4. **Seed**: PRJ-REQ-563 BR9 nói `APP_ENV` là "dev hoặc test" nhưng BR1 của PRJ-REQ-735 chỉ cho `dev`, `staging`, `prod`. Seed chỉ chạy khi `APP_ENV=dev`; test chạy với `APP_ENV=dev`.
5. **Biến cấu hình bổ sung** (spec nói "đổi bằng cấu hình" nhưng không đặt tên): `DB_CONNECT_RETRY_SECONDS` (30), `DB_TRANSACTION_TIMEOUT_MS` (10000), `DB_TRANSACTION_RETRIES` (3), `DB_STATEMENT_TIMEOUT_MS` (15000, truyền cho PostgreSQL qua tham số kết nối `options`). `PORT` mặc định 3001 (web giữ 3000). Cần đưa tên vào danh sách ADR-007 qua sdlc-foundation.
6. **Phạm vi quy tắc prod**: TLS của `DATABASE_URL` bắt buộc ở staging và prod (PRJ-REQ-563 BR7); bí mật không giữ chỗ, CORS không `*`, `LOG_LEVEL` không debug/trace chỉ ở prod (PRJ-REQ-735 BR4). `CORS_ALLOWED_ORIGINS` chứa `*` ở dev vẫn khởi động được (đúng PRJ-TC-20261006-100124927) nhưng không bao giờ phản chiếu `*`: chỉ nguồn khớp đúng mới được cấp header.
7. **Bí mật rỗng ở prod**: spec vừa coi rỗng là "thiếu" (BR2) vừa là "giữ chỗ" (BR4); báo "thiếu hoặc rỗng" (một lý do cho cả hai).
8. **CSRF**: spec nói "khi dùng cookie phiên" nhưng tên cookie phiên do AUTH đặt, PRJ chưa biết; kiểm Origin/Referer cho mọi POST/PUT/PATCH/DELETE có header `Cookie` bất kỳ. Cookie SameSite=Lax do AUTH đặt khi cấp phiên (ngoài PRJ).
9. **Audit gộp**: `coalesce: { key, window }` của PRJ-REQ BR10; khóa gộp thật là `(actor_id, action)` theo PRJ-DB mục 2, `key` chỉ để mô tả. Hai yêu cầu song song vẫn có thể ghi hai dòng (đã nêu ở PRJ-DB).
10. **`@Idempotent`**: handler nhận `tx` của khóa qua `@DbTx()`; mã trạng thái lưu lấy từ `@HttpCode` hoặc mặc định (POST 201); chỉ phản hồi thành công được lưu (4xx và 5xx rollback cùng khóa).
11. **`@SystemEndpoint`**: phản hồi mặc định theo kiểu VNPay `{RspCode, Message}` HTTP 200 (`97` chữ ký sai, `99` lỗi hệ thống), module PAY ghi đè được qua `reject`/`internalError`. Bậc E mặc định 300 yêu cầu mỗi phút mỗi IP vì SB-14 nói số do PAY chốt (cần quyết khi làm PAY).
12. **Thứ tự kiểm**: 413 và 415 xảy ra ở middleware trước giới hạn tần suất, nên không tính vào bộ đếm; guard theo thứ tự giới hạn tần suất, CSRF, xác thực và quyền, rồi schema (interceptor), rồi `Idempotency-Key`.
13. **Event không có consumer**: relay đánh dấu `dispatched_at` ngay (không có ai nhận); `publishAfterCommit` gọi ngoài giao dịch thì phát ở `setImmediate`.
14. **Test trước, code sau**: khung platform được dựng theo thiết kế trước rồi test viết ngay sau (không có lần chạy "fail đúng lý do" trước cho từng test). Thay vào đó đã phá mã có chủ ý 5 chỗ (bỏ cờ `app.audit_purge`, cắt trần backoff, bỏ `email` khỏi bộ che, bỏ kiểm Origin, bỏ `DO NOTHING` của ProcessedEvent) và test tương ứng đều đỏ, rồi khôi phục.
15. **Bằng chứng yếu hơn mô tả TC**: PRJ-TC-20261006-100124068 chạy `pnpm dev` thật nhưng không trong container sạch, không đo 15 phút; PRJ-TC-20261006-100124159 dùng đầu ra `pnpm audit` giả; PRJ-TC-20261006-110200106 dùng hai `JobRunner` (hai phiên PostgreSQL) trong một tiến trình Jest; PRJ-TC-20261006-120200101 dùng Node 22.23.2 và 24.21.0 thay cho 22.11.0 và 24.1.0; PRJ-TC-20261006-100124673 kiểm ký tự xuống dòng ở mức hàm. Workflow GitHub Actions chưa được chạy trên GitHub.
16. **Kiểm tương thích ngược migration** (PRJ-TC-20261006-120200106) là quy tắc regex trên SQL cộng dòng `-- contract-step:` để khai bước thu hẹp; không chứng minh được ngữ nghĩa, người review vẫn phải xem.
17. **`audit_logs`** (đã sửa ở lần hai, task 26): làm theo PRJ-DB mục 12 và PRJ-SEC T19 thay cho đường cờ `app.audit_purge` mà PRJ-DB mục 12 mô tả. Migration `20261006000500_platform_app_roles` thêm vai trò nhóm `app_runtime` (INSERT, SELECT trên `audit_logs`) và `app_retention` (SELECT, DELETE), trigger `BEFORE TRUNCATE`, và trigger DELETE chỉ cho qua khi vai trò đăng nhập của phiên (`session_user`) là thành viên `app_retention` (superuser dev/test vẫn qua, đúng vai trò quản trị). Không còn cờ `app.audit_purge`. Vai trò đăng nhập `ecom_app`, `ecom_retention` do `docker/initdb/01-app-roles.sql` tạo (docker compose, CI, globalSetup dùng cùng tệp). `DATABASE_URL` của ứng dụng là `ecom_app`; migration chạy bằng `MIGRATE_DATABASE_URL` (superuser, qua `apps/api/scripts/migrate.mjs`); job dọn audit dùng `RETENTION_DATABASE_URL` (biến mới, tùy chọn, rỗng thì dùng `DATABASE_URL`, nên cần đưa tên vào ADR-007 qua sdlc-foundation). PRJ-DB mục 12 và PRJ-SEC mục rủi ro (cờ mức ứng dụng) nên được sửa theo cách này qua sdlc-impact. Bảng khác của PRJ chưa là bảng chỉ thêm theo thiết kế nên giữ đủ quyền cho `app_runtime`; quyền mặc định của bảng mới cấp cho `app_runtime`, bảng chỉ thêm của epic sau phải tự `REVOKE` như `audit_logs`. Còn lại: mật khẩu hai vai trò ở prod do vận hành đặt (task 21, `docs/runbook-prod.md`); các test chung vẫn chạy bằng superuser `ecom`, chỉ test audit, smoke dùng `ecom_app` thật.
18. **`pnpm install` đặt `core.hooksPath=.githooks`** vào cấu hình git cục bộ của repo (script `prepare`, bỏ qua khi `CI`) để hook quét bí mật chạy; không tạo commit nào.
19. **Chưa làm trang lỗi web** (404, 500): thuộc epic có màn đầu tiên (AUTH) theo PRJ-REQ-820 BR11; `apps/web` chỉ có trang placeholder.
20. **Hạ tầng ngoài mã, không làm và không kiểm được trong repo (task 21, blocked)**: sao lưu tự động RPO 24 giờ, RTO 4 giờ và khôi phục thử trước go-live (PRJ-REQ-563 BR10); log giữ 30 ngày ở host (PRJ-REQ-908 BR1); kho bí mật của host (PRJ-REQ-735 BR5); bật "Require status checks" để PR đỏ không merge (PRJ-REQ-475 BR3). Kiểm bằng review trước go-live.
21. **Spec có chỗ in thừa**: PRJ-TC-20261006-120200101 lặp "**Given** **Given**" ở bước Given (không ảnh hưởng nội dung).
22. **Lần hai theo review (task 22 đến 30)**: không sửa `spec/`. Test viết đỏ trước rồi sửa: (1) hygiene test quét `apps/api/test` tìm đường dẫn Homebrew, nvm, home (đỏ khi đặt thử một tệp vi phạm); Node sai giả lập bằng `--config.node-version`. Bằng chứng đỏ của CSDL smoke (`ecom_dev` vs `ecom_ci`) chỉ suy ra từ mã (không `DROP DATABASE ecom_dev` được trong môi trường này), xanh với CSDL test. (2) audit-gate và (3) scan-secrets: ca mới đỏ trên mã cũ (thoát 0 với `{"error"}`; không bắt URL có mật khẩu). (4) che log: đỏ trên mã cũ (message, thuộc tính, cause, msg, tên `pwd`, `apiKey`...). (5) migration thêm, đỏ khi bỏ migration (8 test audit đỏ). (6) route-audit: thêm kiểm guard toàn cục. (7) JobRunner: ba test mới đỏ trên mã cũ. (8) bỏ lọc `user_id` ở SELECT idempotency làm test mới đỏ (đã thử đột biến rồi khôi phục).
23. **Số thẻ che theo kiểm Luhn**: 13 đến 19 chữ số liền hoặc nhóm 4-4-4-4, 4-6-5 ngăn bằng dấu cách hoặc gạch, chỉ che khi qua Luhn để UUID, mã `20261006-100124068`, timestamp không bị che nhầm; chuỗi 16 chữ số tùy ý không qua Luhn không bị che (đổi lại ít báo nhầm). Email trong chuỗi tự do cũng bị che.
24. **JobRunner khi thân job không dừng sau hủy**: chờ `JOB_ABORT_GRACE_MS` (5 giây) rồi ngắt kết nối giữ khóa (khóa tư vấn mất theo phiên), log `error`, cùng tiến trình không chạy chồng cho tới khi thân dừng. Một thân không tôn trọng AbortSignal vẫn có thể chạy chồng với instance khác; giới hạn đã nêu. `LEASE_MS` = 2 x (hạn job 60 giây + hạn chờ hủy 5 giây) = 130 giây (trước là 60 giây). Hợp đồng `JobDef.run` thêm `signal` (tương thích ngược).
25. **Quét bí mật**: giá trị tên-gán cần >= 16 ký tự và có ít nhất một chữ số (tránh báo nhầm tên hàm, khóa i18n); URL có mật khẩu bỏ qua host `localhost`, `127.0.0.1`, `[::1]` và mật khẩu giữ chỗ. Dòng giả của test đánh dấu `scan-secrets:allow`. Bí mật dạng khác (không có tên gợi ý, ít hơn 16 ký tự, không chữ số) vẫn lọt: giới hạn của quét theo mẫu.
26. **Cũng làm từ mục LOW của review**: `ProblemFilter` ánh xạ `HttpException` 503 thành `service-unavailable` (chưa có test riêng); khóa log trùng đổi tên (`env` thành `app_env` ở `config ok`, `module` thành `job_module` ở log lỗi job).
27. **Việc còn lại (LOW của review chưa làm)**: test bậc A, D, `@RateLimit({key})`, `RateLimitService.check/hitCounter/reset`, CSRF với PUT/PATCH/DELETE, khóa 64 và 65 ký tự (mục 10); relay log `error` mỗi 3 giây khi mất CSDL (mục 12); `AuditService.record` còn nhận `PrismaClient`, script ranh giới chỉ thấy import tương đối, action GitHub ghim theo tag (mục 13, ghim SHA đã đưa vào runbook); cảnh báo `TRUST_PROXY_HOPS=0` ở prod, kiểm mật khẩu giữ chỗ của `DATABASE_URL`, log khi ngắt kết nối giữa chừng (mục 14); runtime bỏ qua im lặng route thiếu schema (`validation.ts:33`, nay CI bắt bằng route-audit); hướng dẫn cấm gọi hệ thống ngoài trong `@Idempotent` (SB-31); chạy workflow GitHub Actions thật một lần (runbook mục 7).
