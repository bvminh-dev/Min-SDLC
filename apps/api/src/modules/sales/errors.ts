import { errorRegistry, registerProblem } from '../platform';
// Nạp điểm vào của INV trước để `insufficient-stock` đã có trong sổ; mã dùng chung với CHK (`no-shipping-methods`, `shipping-method-unavailable`, `price-changed`, `dependency-unavailable`)
// khai có điều kiện cùng status và title (CHK không nằm trong cột Phụ thuộc của SAL nên không import được; sổ báo trùng nếu khai lần hai).
import '../inventory';

// Mã lỗi HTTP riêng của SAL (SAL-API mục Danh mục lỗi, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `unauthenticated`, `forbidden`, `csrf_failed`, `not-found`, `idempotency-key-required`, `idempotency-key-reused`, `rate-limited` là mã nền của platform.
const defs: [string, number, string][] = [
  ['order-source-unavailable', 409, 'Order source is not available'],
  ['product-unavailable', 409, 'Some products are no longer sold'],
  ['customer-not-found', 422, 'Customer account not found'],
  ['order-total-out-of-range', 422, 'Order total is out of the allowed range'],
  // dùng lại mã của CHK và INV (nếu module đó chưa nạp thì khai ở đây cùng status, title)
  ['shipping-method-unavailable', 409, 'Shipping method is not available'],
  ['no-shipping-methods', 409, 'No shipping method is available'],
  ['price-changed', 409, 'The order total changed since it was last shown'],
  ['insufficient-stock', 409, 'Requested quantity exceeds available stock'],
  ['dependency-unavailable', 503, 'A dependent service is unavailable; nothing was changed'],
];
for (const [code, status, title] of defs) if (!errorRegistry.get(code)) registerProblem({ code, status, title });
