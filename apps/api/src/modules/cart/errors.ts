import { errorRegistry, registerProblem } from '../platform';
// Nạp điểm vào của inventory và shipping trước để mã `insufficient-stock` (INV khai) và `method-unavailable` (SHP khai) đã có trong sổ: CRT dùng lại cùng mã và status, sổ báo trùng nếu khai lần hai.
import '../inventory';
import '../shipping';

// Mã lỗi HTTP riêng của CRT (CRT-API mục đầu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `rate-limited`, `service-unavailable`, `unauthenticated`, `forbidden`, `csrf_failed` là mã nền; `insufficient-stock` do INV khai (409, kèm `available`, `in_cart`), `method-unavailable` do SHP khai (409).
const defs: [string, number, string][] = [
  ['product-unavailable', 404, 'Product is not available'],
  ['cart-item-not-found', 404, 'Cart item not found'],
  ['coupon-not-found', 404, 'Coupon not found'],
  ['quantity-limit-exceeded', 409, 'Quantity per product would exceed the limit'],
  ['cart-line-limit-reached', 409, 'Cart already has the maximum number of lines'],
  ['cart-empty', 409, 'Cart is empty'],
  ['cart-limit-exceeded', 409, 'Cart subtotal would exceed the limit'],
  ['coupon-expired', 409, 'Coupon has expired'],
  ['coupon-exhausted', 409, 'Coupon has no uses left'],
  ['per-user-limit-reached', 409, 'Coupon per-user limit reached'],
  ['min-order-not-met', 409, 'Cart subtotal is below the coupon minimum'],
  ['no-discount', 409, 'Coupon gives no discount for this cart'],
  ['too-many-attempts', 429, 'Too many coupon attempts'],
];
for (const [code, status, title] of defs) if (!errorRegistry.get(code)) registerProblem({ code, status, title });
