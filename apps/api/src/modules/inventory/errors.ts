import { registerProblem } from '../platform';
// Nạp điểm vào của catalog trước để mã `product-archived` (PRD khai, INV dùng lại cùng mã và status) đã có trong sổ; sổ mã báo trùng nếu khai lần hai.
import '../catalog';

// Mã lỗi của INV (INV-API mục Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `not-found`, `idempotency-key-required`, `idempotency-key-reused`, `rate-limited`, `unauthenticated`, `forbidden`, `csrf_failed` là mã nền của platform;
// `product-archived` (409) PRD đã khai, INV dùng lại, không khai lần hai.
const defs: [string, number, string][] = [
  ['no-change', 400, 'New on-hand quantity equals the current one'],
  ['stock-limit-exceeded', 409, 'Stock would exceed the per-product limit'],
  ['insufficient-stock', 409, 'Requested quantity exceeds available stock'],
  ['below-reserved', 409, 'New on-hand quantity is below the reserved quantity'],
  ['stock-version-conflict', 409, 'Stock record was changed by someone else'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });
