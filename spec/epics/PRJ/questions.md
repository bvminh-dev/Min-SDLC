# Câu hỏi còn mở của epic PRJ (sdlc-research, tech-design, ui-ux, test-design)

Chạy tự động nên không hỏi trực tiếp; ở mọi bước hỏi đã chọn phương án khuyến nghị theo `DECISIONS-ecommerce.md` và roadmap. Mọi file spec của PRJ vẫn `draft`; requirement `draft` được dùng làm đầu vào cho các phase sau (đã được phép).
Phạm vi: PRJ làm sáu mục con của roadmap (Project setup, Database setup, API structure, Environment configuration, Error handling, Logging), mỗi mục một requirement (xem `requirements/`). Sau lần sửa nền 2026-10-06, PRJ sở hữu bốn entity nền tảng dùng chung (AuditLog, OutboxEvent, ProcessedEvent, IdempotencyKey) và cung cấp outbox, idempotency, job nền, giới hạn tần suất theo bậc; PRJ không có màn hình (xem mục C).

## A. Cần người quyết ở phạm vi PRJ
1. [RESOLVED] Định danh `type` của lỗi problem+json: ADR-023, URN `urn:ecom:error:<mã>`; đã áp ở PRJ-REQ-20261006-095422820 BR2, PRJ-API và test case về lỗi kiểm dữ liệu (trước đây đề xuất `urn:ecom:problem:`). IPN là ngoại lệ định dạng (ADR-006, BR12).
2. [RESOLVED] Chống CSRF: ADR-016, kiểm `Origin`/`Referer` cộng SameSite=Lax, chỉ nhận `application/json`; áp ở PRJ-REQ-20261006-095422650 BR6; token đồng bộ loại ở v1.
3. [RESOLVED] Giới hạn tần suất: SB-14 và ADR-014 (bậc A đến E; bảng PostgreSQL cho bậc A, B, bộ nhớ cho bậc C, không Redis); áp ở PRJ-REQ-20261006-095422650 BR7. Mức 120 mỗi phút là bậc C mặc định.
   - [OPEN] Bậc D, E nền chưa gán kho đếm (ADR-014 để tech-design). PRJ chọn bảng PostgreSQL cho cả hai (PRJ-API); người duyệt xác nhận.
4. [RESOLVED] Role của requirement hạ tầng: `system` (R-01, KT-02); bốn requirement (475, 563, 735, 908) đổi `roles: [admin]` thành `roles: [system]`. Ma trận quyền còn cột `system` đang `-` ở các dòng PRJ, người dùng thêm sau.
5. [OPEN] Mô hình triển khai migration (áp lúc deploy, thay đổi phá vỡ hai bước): nền chưa quyết, ADR-025 ở backlog (SAU); giữ mặc định ở PRJ-REQ-20261006-095422563 BR4. Sao lưu: RPO, RTO, thời gian giữ bản sao lưu (mặc định đề xuất 7 ngày) cũng chưa có trong nền.
6. [OPEN] Chính sách bí mật hợp lệ ở prod (độ dài tối thiểu, mẫu giữ chỗ bị cấm); nền tảng host và kho bí mật cụ thể chưa nêu tên (ADR-007 chỉ nói chung). (PRJ-REQ-20261006-095422735)
7. [OPEN] Phiên bản Node cụ thể và công cụ test (mặc định Jest theo NestJS). (PRJ-REQ-20261006-095422475 BR7)
8. Ai đọc audit qua ứng dụng:
   - [RESOLVED] Chỉ admin đọc (ADR-021, E-02); áp ở PRJ-REQ-20261006-095422908 BR9.
   - [OPEN] Có cần API hoặc màn đọc audit ở v1 không; hiện chỉ truy vấn bằng quyền CSDL. Nếu cần thì thêm requirement và dòng ma trận quyền.

## B. Phụ thuộc epic khác
9. [RESOLVED] AUTH và guard: interface `SessionContext {user_id, role, email_verified}` ở platform, AUTH cài đặt (ADR-012; AUTH-REQ-20261006-095515808, AUTH-REQ-20261006-095515918); giới hạn bậc A do AUTH chốt (SB-14). Admin đầu tiên: lệnh seed biến môi trường của AUTH (SB-29, R-03); AUTH chưa có requirement riêng cho lệnh seed (AUTH không có "seed" trong requirement), ghi nhận cho AUTH.
10. [RESOLVED] INV, PRM: giữ hàng và coupon dùng SQL thô tham số hóa và `tx` của PRJ (SB-25, ADR-012); links tới INV-REQ-20261006-101122538 và PRM-REQ-20261006-101036470 ở PRJ-REQ-20261006-095422563. PRM dùng bậc A cho mã giảm giá (SB-14).
11. [RESOLVED] PAY, USR, REV, NTF, PRD, INV khai biến môi trường: qua `registerConfigSchema` của PRJ (ADR-007); `RESERVATION_TTL` và `REVIEW_PRE_MODERATION` là hằng số vận hành đi qua cấu hình (PRJ-REQ-20261006-095422735 BR10). Mỗi epic khai biến của mình ở tech-design của epic đó.
12. ORD: ORD-API còn host giữ chỗ `https://example.invalid/problems/...`, ORD đổi sang `urn:ecom:error:order-not-cancellable` khi ORD đồng bộ nền (ORD-REQ-20261006-092320768, ORD-REQ-20261006-092320834). Audit và outbox của ORD dùng hạ tầng PRJ (PRJ-DB). Không sửa ORD ở đây.
13. PAY: IPN dùng `@SystemEndpoint({ verifier })` của PRJ và định dạng `RspCode` (PAY-REQ-20261006-103110513); PAY chốt verifier và hạn mức bậc E.

## C. Giao diện và E2E
Epic PRJ không có màn hình nào: roadmap PRJ chỉ có sáu mục con hạ tầng; health và lỗi là API. Không chạy `sdlc-ui-ux` cho PRJ nên không có tài liệu màn; `check-ui` báo "requirement chưa có màn" cho cả sáu requirement (đúng chủ ý). Không có luồng E2E vì E2E đòi testid trong `spec/testids.md`; toàn bộ phủ bằng 78 test case TC (mọi mục kịch bản của 6 requirement, mọi mối đe dọa SEC có "Kiểm bằng test").
[OPEN] Trang lỗi chung (404, 500) và khung ứng dụng web của Next.js chưa có epic nào sở hữu: nền chưa quyết (đề xuất: epic có màn đầu tiên, hoặc thêm vào roadmap PRJ).

## D. Chỗ yếu của requirement (checklist chất lượng)
- Các con số mặc định chưa có số liệu: body 1 MB, hạn giao dịch 10 giây, `statement_timeout` 15 giây, thử lại kết nối 30 giây, 15 phút dựng dự án, relay vài giây và 10 lần thử, `processed_events` giữ 30 ngày, cửa sổ gộp audit 60 giây. Đã ghi là mặc định; đo được nhưng cần người xác nhận.
- Mối đe dọa SEC không có test case: T1 (hook, có TC kiểm hook), T21 (script, có TC), T22 (script, có TC), T12 (script và review, có TC). T23 nay kiểm bằng test giết tiến trình (SB-27).
- Chỗ chưa kiểm hết: audit chỉ ghi tách giao dịch khi gộp lần xem dashboard (hai yêu cầu song song có thể ghi hai dòng); một OutboxEvent lỗi mãi chặn aggregate của nó (xem PRJ-SEC, Rủi ro còn lại).

## Nền còn thiếu sau lần sửa 2026-10-06
Không sửa nền trong epic này. Mỗi dòng cần `sdlc-foundation` hoặc `sdlc-impact` khi nền được duyệt lại.
- `spec/domain/entities.md`: bảng UNLOGGED `rate_limit_counters` (ADR-014 B) không phải entity; nếu muốn mọi bảng của PRJ có entity thì thêm, hoặc ghi chú ngoại lệ "bảng hạ tầng tạm". PRJ-DB đang ghi nó ngoài bảng entity.
- `spec/architecture.md`: ADR-014 chưa gán kho đếm cho bậc D, E (PRJ tạm chọn PostgreSQL); ADR-022 chưa có hạn lưu cho ProcessedEvent (PRJ tạm chọn 30 ngày) và dòng `processed_events` cần liệt kê.
- `spec/architecture.md`: ADR-025 (mô hình triển khai migration, tương thích ngược) còn ở backlog; trang lỗi chung và khung web chưa có chủ.
- `spec/security-baseline.md`: chưa có SB riêng cho `Idempotency-Key` (T27 của PRJ-SEC ghi SB `-`); cân nhắc thêm vào nhóm Toàn vẹn dữ liệu.
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
- `design/PRJ-API-20261006-095847320.md`: URN theo ADR-023; bậc giới hạn tần suất; `Idempotency-Key` và scope; `@SystemEndpoint`; CSRF theo ADR-016; thứ tự kiểm thêm idempotency; giao diện cho module (`events`, `jobs`, `IdempotencyService`, `SessionContext`); bỏ các [OPEN] đã quyết.
- `design/PRJ-SEC-20261006-095847406.md`: gán SB cho T8 (SB-14), T10 (SB-31), T12 và T22 (SB-35), T19 (SB-32), T23 (SB-27, kiểm bằng test); T18 thêm `system`; thêm T25 đến T30 (consumer trùng SB-27, token thô K-14, idempotency, bộ đếm nhiều instance SB-14, endpoint hệ thống SB-05/13/22, audit chứa dữ liệu cá nhân SB-08/19); cập nhật Rủi ro còn lại.
- `tests/`: sửa 5 test (`100124650` bậc C, `100125091` URN ADR-023, `100125327`, `100125420` bỏ ghi chú chờ nền, `100125518` phong bì event); thêm 15 test case `110200101` đến `110200115` cho outbox (K-14, SB-27, ADR-011), consumer idempotent, job và retention (ADR-013, ADR-022), Idempotency-Key (ADR-017), bậc B nhiều instance (ADR-014), `@SystemEndpoint`, audit `system` và dashboard (K-16), audit không chứa dữ liệu cá nhân, SB-35.
- `questions.md`: đánh dấu [RESOLVED] mục A1 đến A4, A8 (một phần), B9 đến B11; thay "Nền cần sửa" bằng "Nền còn thiếu sau lần sửa 2026-10-06".
