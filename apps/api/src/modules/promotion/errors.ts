import { DomainError, registerProblem, type ProblemExtra } from '../platform';

// Mã lỗi HTTP của PRM (PRM-API mục Endpoint và Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã snake_case của module>.
// `validation-failed`, `not-found`, `rate-limited`, `unauthenticated`, `forbidden`, `csrf_failed` là mã nền của platform; 404 của id sai định dạng, đã xóa hay không có đều là `not-found`.
// Lý do lỗi của giao diện nội bộ (`coupon_not_found`, `coupon_expired`, `coupon_exhausted`, `per_user_limit_reached`, `min_order_not_met`, `no_discount`, `invalid_subtotal`,
// `too_many_attempts`, `order_already_has_coupon`) là kết quả `{ ok: false, reason }`, không phải HTTP; chỉ `coupon_expired` và `coupon_exhausted` cũng là mã HTTP khi bật coupon.
const defs: [string, number, string][] = [
  ['code_taken', 409, 'Coupon code already used'],
  ['field_immutable', 400, 'Coupon code and type cannot change'],
  ['coupon_not_editable', 409, 'Coupon can no longer be edited'],
  ['usage_limit_below_used', 409, 'Usage limit is below the number of uses'],
  ['version_mismatch', 409, 'Coupon was changed by someone else'],
  ['invalid_transition', 409, 'Coupon status does not allow this action'],
  ['coupon_expired', 409, 'Coupon has expired'],
  ['coupon_exhausted', 409, 'Coupon has no uses left'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });

/** Lỗi nghiệp vụ của PRM: ngoài `type` còn trường `code` trong problem+json (PRM-API mục Hợp đồng dữ liệu, ví dụ 409 `code_taken`) và các trường phụ (`used`, `current_version`). */
export const problem = (code: string, o: { extra?: Record<string, ProblemExtra>; errors?: { field: string; code: string }[] } = {}): DomainError => new DomainError(code, { errors: o.errors, extra: { code, ...(o.extra ?? {}) } });
