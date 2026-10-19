import { registerProblem } from '../platform';

// Mã lỗi HTTP của ORD (ORD-API mục Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `unauthenticated`, `forbidden`, `csrf_failed`, `not-found`, `rate-limited` là mã nền của platform.
registerProblem({ code: 'order-not-cancellable', status: 409, title: 'Order cannot be cancelled in its current state' });
registerProblem({ code: 'order-source-code-taken', status: 409, title: 'Order source code is already taken' });
registerProblem({ code: 'order-source-protected', status: 409, title: 'System order source cannot be deactivated' });
registerProblem({ code: 'order-source-limit', status: 409, title: 'Order source limit reached' });

/**
 * Lỗi nghiệp vụ của giao diện nội bộ (không có HTTP): bên gọi (CHK, SHP, SAL) bắt theo `code`.
 * `invalid_input` (đầu vào của createPending hay createHo sai, số tiền không nhất quán), `order_not_found`, `not_confirmable` (confirmCod: không phải COD pending), `not_lockable` (lockForHandoff: không ở paid hay confirmed),
 * `source_unavailable` (createHo: nguồn không có hoặc đã tắt; `reason` là `not_found` hoặc `inactive`), `order_code_exhausted` (hết 99999 số trong ngày, hạ tầng).
 */
export type OrderErrorCode = 'invalid_input' | 'order_not_found' | 'not_confirmable' | 'not_lockable' | 'source_unavailable' | 'order_code_exhausted';
export class OrderBusinessError extends Error {
  constructor(readonly code: OrderErrorCode, message: string = code, readonly reason?: 'not_found' | 'inactive') { super(message); this.name = 'OrderBusinessError'; }
}
