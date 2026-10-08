import { registerProblem } from '../platform';

// Mã lỗi của USR (USR-API mục Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>; lỗi nghiệp vụ có thêm trường `code` snake_case
// (DomainError.options.extra). `validation-failed`, `not-found`, `rate-limited`, `unauthenticated`, `forbidden`, `csrf_failed`, `image-invalid` (dùng chung với PRD) là mã nền của platform.
const defs: [string, number, string][] = [
  ['address-limit-reached', 409, 'Address limit reached'],
  ['cannot-unset-default', 400, 'Cannot unset the default address'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });
