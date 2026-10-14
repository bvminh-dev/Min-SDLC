import { registerProblem } from '../platform';

// Mã lỗi HTTP của DSH (DSH-API mục Quy tắc chung, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `unauthenticated`, `forbidden`, `rate-limited` là mã nền của platform.
const defs: [string, number, string][] = [
  ['invalid-parameter', 400, 'Invalid parameter'],
  ['dashboard-source-unavailable', 503, 'Dashboard source unavailable'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });
