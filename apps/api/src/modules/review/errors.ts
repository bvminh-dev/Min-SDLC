import { registerProblem } from '../platform';

// Mã lỗi HTTP của REV (REV-API mục Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>; lỗi nghiệp vụ có thêm trường `code` snake_case (DomainError.options.extra):
//   review-conflict: already_reviewed, not_purchased, not_delivered, window_expired (tạo), review_not_editable (sửa), invalid_review_state (kiểm duyệt).
// `validation-failed`, `not-found`, `rate-limited`, `idempotency-key-required`, `idempotency-key-reused`, `image-invalid` (reason: type, size, dimensions, corrupt) và `unauthenticated`, `forbidden`, `csrf_failed` là mã nền của platform.
registerProblem({ code: 'review-conflict', status: 409, title: 'Review cannot be created or changed' });
