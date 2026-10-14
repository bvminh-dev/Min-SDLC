import { errorRegistry, registerProblem } from '../platform';
// Nạp điểm vào của các module phụ thuộc trước để mã dùng chung (`insufficient-stock` của INV, `cart-empty`, `coupon-not-found`, `coupon-expired`, `coupon-exhausted`, `per-user-limit-reached`,
// `min-order-not-met`, `no-discount`, `too-many-attempts` của CRT) đã có trong sổ: CHK dùng lại cùng mã và status, sổ báo trùng nếu khai lần hai.
import '../cart';
import '../inventory';

// Mã lỗi HTTP riêng của CHK (CHK-API mục Danh mục lỗi, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `rate-limited`, `idempotency-key-required`, `idempotency-key-reused`, `unauthenticated`, `forbidden`, `csrf_failed` là mã nền.
const defs: [string, number, string][] = [
  ['email-not-verified', 403, 'Email must be verified before placing an order'],
  ['checkout-session-not-found', 404, 'Checkout session not found'],
  ['address-not-found', 404, 'Address not found'],
  ['cart-has-unavailable-items', 409, 'Cart has items that are no longer sold'],
  ['cart-already-ordered', 409, 'This cart has already been ordered'],
  ['cart-changed', 409, 'The cart changed since it was last shown'],
  ['checkout-incomplete', 409, 'Checkout is missing a required choice'],
  ['checkout-session-closed', 409, 'Checkout session is closed'],
  ['checkout-session-completed', 409, 'Checkout session is already completed'],
  ['address-required', 409, 'Choose a delivery address first'],
  ['address-unavailable', 409, 'The chosen address no longer exists'],
  ['address-changed', 409, 'The chosen address was changed after it was chosen'],
  ['no-shipping-methods', 409, 'No shipping method is available'],
  ['shipping-method-unavailable', 409, 'Shipping method is not available'],
  ['coupon-invalid', 409, 'The saved coupon can no longer be used'],
  ['price-changed', 409, 'The order total changed since it was last shown'],
  ['too-many-open-orders', 409, 'Too many open orders'],
  ['amount-out-of-range-online', 422, 'Online payment amount is out of the allowed range'],
  ['zero-total-unsupported', 422, 'Orders with a zero total are not supported'],
  ['dependency-unavailable', 503, 'A dependent service is unavailable; nothing was changed'],
  // dùng lại mã của CRT (nếu CRT chưa nạp thì khai ở đây cùng status, title)
  ['cart-empty', 409, 'Cart is empty'],
  ['coupon-not-found', 404, 'Coupon not found'],
  ['coupon-expired', 409, 'Coupon has expired'],
  ['coupon-exhausted', 409, 'Coupon has no uses left'],
  ['per-user-limit-reached', 409, 'Coupon per-user limit reached'],
  ['min-order-not-met', 409, 'Cart subtotal is below the coupon minimum'],
  ['no-discount', 409, 'Coupon gives no discount for this cart'],
  ['too-many-attempts', 429, 'Too many coupon attempts'],
  ['insufficient-stock', 409, 'Requested quantity exceeds available stock'],
];
for (const [code, status, title] of defs) if (!errorRegistry.get(code)) registerProblem({ code, status, title });
