# Câu hỏi của epic PRJ (sdlc-research, tech-design, ui-ux, test-design)

Chạy tự động nên không hỏi trực tiếp; ở mọi bước hỏi đã chọn phương án khuyến nghị theo `DECISIONS-ecommerce.md` và roadmap. Mọi file spec của PRJ vẫn `draft`; requirement `draft` được dùng làm đầu vào cho các phase sau (đã được phép).
Phạm vi: PRJ làm sáu mục con của roadmap (Project setup, Database setup, API structure, Environment configuration, Error handling, Logging), mỗi mục một requirement (xem `requirements/`). Sau lần sửa nền 2026-10-06, PRJ sở hữu bốn entity nền tảng dùng chung (AuditLog, OutboxEvent, ProcessedEvent, IdempotencyKey) và cung cấp outbox, idempotency, job nền, giới hạn tần suất theo bậc; PRJ không có màn hình (xem mục C).

## A. Cần người quyết ở phạm vi PRJ
1. [RESOLVED] Định danh `type` của lỗi problem+json: ADR-023, URN `urn:ecom:error:<mã>`; đã áp ở PRJ-REQ-20261006-095422820 BR2, PRJ-API và test case về lỗi kiểm dữ liệu (trước đây đề xuất `urn:ecom:problem:`). IPN là ngoại lệ định dạng (ADR-006, BR12).
2. [RESOLVED] Chống CSRF: ADR-016, kiểm `Origin`/`Referer` cộng SameSite=Lax, chỉ nhận `application/json`; áp ở PRJ-REQ-20261006-095422650 BR6; token đồng bộ loại ở v1.
3. [RESOLVED] Giới hạn tần suất: SB-14 và ADR-014 (bậc A đến E; bảng PostgreSQL cho bậc A, B, bộ nhớ cho bậc C, không Redis); áp ở PRJ-REQ-20261006-095422650 BR7. Mức 120 mỗi phút là bậc C mặc định.
   - [RESOLVED] Bậc D, E: nền đợt 3 đã gán kho đếm PostgreSQL cho cả hai (ADR-014, M-09, R-31), khớp PRJ-API; DSH dùng giao diện đếm của PRJ.
4. [RESOLVED] Role của requirement hạ tầng: `system` (R-01, KT-02); bốn requirement (475, 563, 735, 908) đổi `roles: [admin]` thành `roles: [system]`. Ma trận quyền còn cột `system` đang `-` ở các dòng PRJ, người dùng thêm sau.
5. [RESOLVED] Mô hình triển khai migration và sao lưu: quyết định (mặc định, người dùng ủy quyền 2026-10-06): migration áp bằng `prisma migrate deploy` ở bước deploy, tương thích ngược một phiên bản, thay đổi phá vỡ hai bước (khuyến nghị ADR-025); sao lưu hàng ngày, RPO 24 giờ, RTO 4 giờ, giữ 7 ngày, khôi phục thử trước go-live. Áp dụng ở PRJ-REQ-20261006-095422563 BR4, BR10; áp dụng ở epic, nền chưa có (ADR-025 còn ở backlog).
6. [RESOLVED] Chính sách bí mật hợp lệ ở prod và kho bí mật: quyết định (mặc định, người dùng ủy quyền 2026-10-06): biến nhạy cảm tối thiểu 32 ký tự; cấm rỗng, tiền tố `changeme`, `example`, `test`, `placeholder`, `your` (không phân biệt hoa thường) và chuỗi một ký tự lặp; không gắn tên kho bí mật, hợp đồng là biến môi trường nạp lúc khởi động (PRJ-REQ-20261006-095422735 BR4, BR5); áp dụng ở epic, nền chưa có.
7. [RESOLVED] Phiên bản Node và công cụ test: quyết định (mặc định, người dùng ủy quyền 2026-10-06): Node 24 LTS (`.nvmrc` = `24`, `engines.node` `>=24 <25`, `engine-strict`) và Jest (PRJ-REQ-20261006-095422475 BR7); áp dụng ở epic, nền chưa có.
8. Ai đọc audit qua ứng dụng:
   - [RESOLVED] Chỉ admin đọc (ADR-021, E-02); áp ở PRJ-REQ-20261006-095422908 BR9.
   - [RESOLVED] API hoặc màn đọc audit ở v1: quyết định (mặc định, người dùng ủy quyền 2026-10-06): không; chỉ truy vấn bằng quyền CSDL (vai trò chỉ đọc); cần thì thêm requirement và dòng ma trận quyền qua sdlc-impact. Chính sách xóa audit theo yêu cầu chủ dữ liệu: không có ở v1 vì audit chỉ chứa trạng thái đã lọc và hết hạn sau 12 tháng.

## B. Phụ thuộc epic khác
9. [RESOLVED] AUTH và guard: interface `SessionContext {user_id, role, email_verified}` ở platform, AUTH cài đặt (ADR-012; AUTH-REQ-20261006-095515808, AUTH-REQ-20261006-095515918); giới hạn bậc A do AUTH chốt (SB-14). Admin đầu tiên: lệnh seed biến môi trường của AUTH (SB-29, R-03); AUTH chưa có requirement riêng cho lệnh seed (AUTH không có "seed" trong requirement), ghi nhận cho AUTH.
10. [RESOLVED] INV, PRM: giữ hàng và coupon dùng SQL thô tham số hóa và `tx` của PRJ (SB-25, ADR-012); links tới INV-REQ-20261006-101122538 và PRM-REQ-20261006-101036470 ở PRJ-REQ-20261006-095422563. PRM dùng bậc A cho mã giảm giá (SB-14).
11. [RESOLVED] PAY, USR, REV, NTF, PRD, INV khai biến môi trường: qua `registerConfigSchema` của PRJ (ADR-007); `RESERVATION_TTL` và `REVIEW_PRE_MODERATION` là hằng số vận hành đi qua cấu hình (PRJ-REQ-20261006-095422735 BR10). Mỗi epic khai biến của mình ở tech-design của epic đó.
12. ORD: ORD-API còn host giữ chỗ `https://example.invalid/problems/...`, ORD đổi sang `urn:ecom:error:order-not-cancellable` khi ORD đồng bộ nền (ORD-REQ-20261006-092320768, ORD-REQ-20261006-092320834). Audit và outbox của ORD dùng hạ tầng PRJ (PRJ-DB). Không sửa ORD ở đây.
13. PAY: IPN dùng `@SystemEndpoint({ verifier })` của PRJ và định dạng `RspCode` (PAY-REQ-20261006-103110513); PAY chốt verifier và hạn mức bậc E.

## C. Giao diện và E2E
Epic PRJ không có màn hình nào: roadmap PRJ chỉ có sáu mục con hạ tầng; health và lỗi là API. Không chạy `sdlc-ui-ux` cho PRJ nên không có tài liệu màn; `check-ui` báo "requirement chưa có màn" cho cả sáu requirement (đúng chủ ý). Không có luồng E2E vì E2E đòi testid trong `spec/testids.md`; toàn bộ phủ bằng 78 test case TC (mọi mục kịch bản của 6 requirement, mọi mối đe dọa SEC có "Kiểm bằng test").
[RESOLVED] Trang lỗi chung (404, 500) và khung ứng dụng web của Next.js: quyết định (mặc định, người dùng ủy quyền 2026-10-06): epic có màn hình đầu tiên theo roadmap (AUTH) nhận ở sdlc-ui-ux của epic đó; không thêm màn vào PRJ (nền chưa có chủ, R-38 mức SAU).

## D. Chỗ yếu của requirement (checklist chất lượng)
- Các con số mặc định chưa có số liệu: body 1 MB, hạn giao dịch 10 giây, `statement_timeout` 15 giây, thử lại kết nối 30 giây, 15 phút dựng dự án, relay vài giây và 10 lần thử, `processed_events` giữ 30 ngày, cửa sổ gộp audit 60 giây. Đã ghi là mặc định; đo được nhưng cần người xác nhận.
- Mối đe dọa SEC không có test case: T1 (hook, có TC kiểm hook), T21 (script, có TC), T22 (script, có TC), T12 (script và review, có TC). T23 nay kiểm bằng test giết tiến trình (SB-27).
- Chỗ chưa kiểm hết: audit chỉ ghi tách giao dịch khi gộp lần xem dashboard (hai yêu cầu song song có thể ghi hai dòng); một OutboxEvent lỗi mãi chặn aggregate của nó (xem PRJ-SEC, Rủi ro còn lại).

## Nền còn thiếu sau lần sửa 2026-10-06
Không sửa nền trong epic này. Mỗi dòng cần `sdlc-foundation` hoặc `sdlc-impact` khi nền được duyệt lại.
- `spec/domain/entities.md`: bảng UNLOGGED `rate_limit_counters` (ADR-014 B) không phải entity; nếu muốn mọi bảng của PRJ có entity thì thêm, hoặc ghi chú ngoại lệ "bảng hạ tầng tạm". PRJ-DB đang ghi nó ngoài bảng entity (R-09 còn THIẾU ở nền).
- Đã có ở nền đợt 3 (không còn thiếu): ADR-014 gán PostgreSQL cho bậc D, E (R-31); ADR-022 có hạn ProcessedEvent 30 ngày (R-33); ADR-011 có `OUTBOX_MAX_ATTEMPTS` 10 và backoff (R-35); ADR-007 liệt kê biến cấu hình (R-36); ADR-017 định dạng khóa 8 đến 64 và `idempotency-key-required` (R-32); SB-40 cho Idempotency-Key (R-47).
- `spec/architecture.md`: ADR-025 (mô hình triển khai migration, tương thích ngược) còn ở backlog, PRJ áp dụng theo khuyến nghị; trang lỗi chung và khung web chưa có chủ (R-38, SAU); RPO, RTO, hạn giữ bản sao lưu chưa có trong nền, PRJ áp dụng 24 giờ, 4 giờ, 7 ngày.
- `spec/security-baseline.md`: SB-35 ghi kiểm "bằng script CI (lint ranh giới, kiểm lệch migration)", PRJ thêm quét tên bảng trong SQL thô (PRJ-REQ-20261006-095422475 BR11); xác nhận phạm vi.
- `spec/permissions-matrix.md`: cột `system` cho các dòng PRJ (người dùng sẽ thêm): job nền, handler event, CI ở các dòng 475, 563, 735, 908.

## Nhật ký đồng bộ nền 2026-10-06
- `requirements/PRJ-REQ-20261006-095422475.md`: roles `admin` thành `system` (R-01); viết lại BR5 theo `platform` cắt ngang và `SessionContext` (A-01, ADR-012); thêm BR11 (SB-35 không đọc bảng module khác) và kịch bản import `platform`; Xung đột chuyển [RESOLVED] cho role và `platform`; thêm link AUTH-REQ-20261006-095515808.
- `requirements/PRJ-REQ-20261006-095422563.md`: roles `system`; thêm BR12 đến BR16 (outbox ADR-011, ProcessedEvent consumer idempotent SB-27, job nền ADR-013, hạn lưu ADR-022, ngoại lệ token thô K-14); BR5 bổ sung truyền `tx`, thứ tự khóa, không gọi ngoài trong giao dịch (ADR-012, SB-31); BR9 theo SB-29, R-03; thêm kịch bản outbox (chính, lỗi, biên); links tới CHK, INV, PRM; Entity là OutboxEvent, ProcessedEvent (E-03).
- `requirements/PRJ-REQ-20261006-095422650.md`: BR5 theo `SessionContext` (ADR-012); BR6 theo ADR-016 (chỉ `application/json`, cùng site); BR7 viết lại theo bậc A đến E và kho đếm (SB-14, ADR-014, S-01, K-15); thêm BR12 (`@SystemEndpoint`, IPN) và BR13 (`Idempotency-Key`, ADR-017, E-04); thêm kịch bản bậc B nhiều instance, idempotency, endpoint hệ thống; Xung đột chuyển [RESOLVED]; Entity là IdempotencyKey.
- `requirements/PRJ-REQ-20261006-095422735.md`: roles `system`; thêm BR10 (hằng số vận hành qua cấu hình: `RESERVATION_TTL` K-01, `REVIEW_PRE_MODERATION` ADR-018, argon2id ADR-015) và BR11 (bí mật của `system`, SB-05).
- `requirements/PRJ-REQ-20261006-095422820.md`: `type` đổi sang `urn:ecom:error:<mã>` (ADR-023, ADR-006); thêm mã `idempotency-key-reused` 422; thêm BR12 ngoại lệ IPN và kịch bản; link PAY-REQ-20261006-103110513; Xung đột chuyển [RESOLVED].
- `requirements/PRJ-REQ-20261006-095422908.md`: roles `system`; BR7 theo ADR-021 (AuditLog, `actor_role` gồm `system`, phạm vi SB-19 gồm truy cập dữ liệu cá nhân của người khác, lọc `before`/`after`); BR9 chỉ admin đọc; thêm BR10 (gộp xem dashboard một dòng mỗi phút, K-16); BR6 theo phong bì event (ADR-011); thêm kịch bản `system`, gộp dashboard, lọc dữ liệu cá nhân; Entity là AuditLog (E-02).
- `flows/PRJ-FLOW-20261006-095422996.md`: thêm sơ đồ 3 (outbox, consumer idempotent, relay, token thô: ADR-011, K-14); sơ đồ 2 thêm bậc giới hạn tần suất, endpoint `system`, bước `Idempotency-Key` (ADR-014, ADR-017); chú thích cập nhật.
- `design/PRJ-DB-20261006-095847232.md`: viết lại: `entities` gồm AuditLog, OutboxEvent, ProcessedEvent, IdempotencyKey (E-02, E-03, E-04) với bảng, ràng buộc, chỉ mục; giao dịch, relay, consumer idempotent, idempotency, job nền, retention, trigger audit (ADR-011, ADR-013, ADR-017, ADR-021, ADR-022, SB-31, SB-32); bỏ phần "đề xuất chờ nền".
- `design/PRJ-API-20261006-095847320.md`: URN theo ADR-023; bậc giới hạn tần suất; `Idempotency-Key` và scope; `@SystemEndpoint`; CSRF theo ADR-016; thứ tự kiểm thêm idempotency; giao diện cho module (`events`, `jobs`, `IdempotencyService`, `SessionContext`); bỏ các câu hỏi mở đã quyết.
- `design/PRJ-SEC-20261006-095847406.md`: gán SB cho T8 (SB-14), T10 (SB-31), T12 và T22 (SB-35), T19 (SB-32), T23 (SB-27, kiểm bằng test); T18 thêm `system`; thêm T25 đến T30 (consumer trùng SB-27, token thô K-14, idempotency, bộ đếm nhiều instance SB-14, endpoint hệ thống SB-05/13/22, audit chứa dữ liệu cá nhân SB-08/19); cập nhật Rủi ro còn lại.
- `tests/`: sửa 5 test (`100124650` bậc C, `100125091` URN ADR-023, `100125327`, `100125420` bỏ ghi chú chờ nền, `100125518` phong bì event); thêm 15 test case `110200101` đến `110200115` cho outbox (K-14, SB-27, ADR-011), consumer idempotent, job và retention (ADR-013, ADR-022), Idempotency-Key (ADR-017), bậc B nhiều instance (ADR-014), `@SystemEndpoint`, audit `system` và dashboard (K-16), audit không chứa dữ liệu cá nhân, SB-35.
- `questions.md`: đánh dấu [RESOLVED] mục A1 đến A4, A8 (một phần), B9 đến B11; thay "Nền cần sửa" bằng "Nền còn thiếu sau lần sửa 2026-10-06".

## Nhật ký đồng bộ nền đợt 3 (2026-10-06)
- `requirements/PRJ-REQ-20261006-095422650.md`: `Idempotency-Key` đổi sang 8 đến 64 ký tự `[A-Za-z0-9_-]` và 400 `idempotency-key-required` (R-32, ADR-017, SB-40); kịch bản thiếu khóa thêm khóa 6 ký tự và khóa 8 ký tự hợp lệ; Xung đột bậc D, E thành [RESOLVED] theo nền (R-31).
- `requirements/PRJ-REQ-20261006-095422820.md`: sổ mã lỗi thêm `idempotency-key-required` (400); chủ trang lỗi chung web chốt là AUTH.
- `requirements/PRJ-REQ-20261006-095422563.md`: BR12 theo `OUTBOX_MAX_ATTEMPTS` 10, backoff 5 giây tới 10 phút, chỉ báo vận hành (R-35, ADR-011); BR15 thêm ProcessedEvent 30 ngày và job dọn riêng của USR, CHK, REV (R-33, R-34); BR4 thêm tương thích ngược; BR10 thêm RPO, RTO, hạn giữ.
- `requirements/PRJ-REQ-20261006-095422735.md`: BR3 thêm `OUTBOX_MAX_ATTEMPTS` và các biến của DSH, NTF, PAY (R-36, ADR-007); BR4 thêm chính sách bí mật 32 ký tự và mẫu giữ chỗ; BR5 thêm hợp đồng với kho bí mật của host.
- `requirements/PRJ-REQ-20261006-095422475.md`, `requirements/PRJ-REQ-20261006-095422908.md`: chốt Node 24 và Jest; chốt không có API đọc audit ở v1.
- `design/PRJ-API`, `design/PRJ-DB`, `flows/PRJ-FLOW`: regex khóa 8 đến 64, mã `idempotency-key-required`, hạn ProcessedEvent theo ADR-022, migration tương thích ngược, sao lưu.
- `design/PRJ-SEC-20261006-095847406.md`: T27 gán SB-40.
- `tests/`: sửa `110200108` (khóa ngắn hơn 8, `idempotency-key-required`); thêm `120200101` đến `120200106` (Node sai phiên bản, bí mật quá ngắn, biến cấu hình của epic khác, relay vượt `OUTBOX_MAX_ATTEMPTS`, dọn ProcessedEvent 30 ngày, migration tương thích ngược).

## Quyết định thay người dùng 2026-10-06
- Câu 3 (bậc D, E của giới hạn tần suất): PostgreSQL cho cả hai, vì nền đợt 3 đã chốt (ADR-014, R-31) và khớp PRJ-API. Rủi ro nếu sai: tải đếm lên CSDL, đổi sang Redis bằng ADR mới.
- Câu 5 (migration): `prisma migrate deploy` ở bước deploy, tương thích ngược một phiên bản, thay đổi phá vỡ hai bước, theo khuyến nghị ADR-025 và mặc định đã có. Rủi ro nếu sai: bản cũ lỗi trong lúc triển khai; nền chưa có ADR-025.
- Câu 5 (sao lưu): RPO 24 giờ, RTO 4 giờ, giữ 7 ngày, khôi phục thử trước go-live, vì cần con số kiểm được và 7 ngày là mặc định đã đề xuất. Rủi ro nếu sai: mất tối đa một ngày dữ liệu đơn hàng, nếu kinh doanh cần RPO ngắn hơn phải bật sao lưu liên tục (WAL).
- Câu 6 (bí mật hợp lệ): biến nhạy cảm tối thiểu 32 ký tự, cấm giá trị giữ chỗ (rỗng, `changeme`, `example`, `test`, `placeholder`, `your`, một ký tự lặp); không gắn tên kho bí mật vì nền chưa chọn host. Rủi ro nếu sai: bí mật của cổng thanh toán ngắn hơn 32 ký tự bị chặn khởi động ở prod, cần nới riêng.
- Câu 7 (công cụ): Node 24 LTS và Jest, vì Jest là mặc định NestJS và 24 là LTS hiện hành. Rủi ro nếu sai: phụ thuộc chưa hỗ trợ Node 24, hạ về Node 22 bằng một pull request.
- Câu 8 (audit): không có API đọc audit ở v1, không có chính sách xóa theo chủ dữ liệu, vì audit chỉ chứa trạng thái đã lọc. Rủi ro nếu sai: admin phải nhờ vận hành truy vấn CSDL; pháp lý yêu cầu xóa dữ liệu cá nhân thì cần thiết kế lại (trigger chặn xóa).
- Mục C (trang lỗi chung web): giao cho epic có màn hình đầu tiên (AUTH), không thêm màn vào PRJ. Rủi ro nếu sai: AUTH không nhận thì không ai làm 404 và 500 của web.
- R-32 (đồng bộ nền): PRJ đổi `Idempotency-Key` sang 8 đến 64 ký tự và 400 `idempotency-key-required`, vì nền đợt 3 đã chốt theo CHK. Rủi ro nếu sai: không đáng kể, khóa 16 ký tự vẫn hợp lệ.
- Mục D (con số mặc định: body 1 MB, giao dịch 10 giây, `statement_timeout` 15 giây, thử lại kết nối 30 giây, dựng dự án 15 phút, relay 10 lần, `processed_events` 30 ngày, gộp audit 60 giây): giữ nguyên làm giá trị v1, đổi qua cấu hình khi đo thực tế.
