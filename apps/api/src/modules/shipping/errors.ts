import { registerProblem } from '../platform';

// Mã lỗi HTTP của SHP (SHP-API mục đầu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `unauthenticated`, `forbidden`, `csrf_failed`, `not-found`, `rate-limited` là mã nền của platform.
const defs: [string, number, string][] = [
  ['shipping-method-name-taken', 409, 'Shipping method name already used'],
  ['too-many-methods', 409, 'Shipping method limit reached'],
  ['method-state-unchanged', 409, 'Shipping method is already in the requested state'],
  ['version-conflict', 409, 'Record was changed by someone else'],
  ['method-unavailable', 409, 'Shipping method is not available'],
  ['shipment-invalid-transition', 409, 'Shipment cannot change to the requested state'],
  ['tracking-number-taken', 409, 'Tracking number already used'],
  ['tracking-number-unchanged', 409, 'Tracking number is unchanged'],
  ['order-not-shippable', 409, 'Order cannot be shipped in its current state'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });
