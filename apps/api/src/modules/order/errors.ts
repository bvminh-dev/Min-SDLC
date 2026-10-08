import { registerProblem } from '../platform';

// Mã lỗi HTTP của ORD (ORD-API mục Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>.
// `validation-failed`, `unauthenticated`, `forbidden`, `csrf_failed`, `not-found`, `rate-limited` là mã nền của platform.
registerProblem({ code: 'order-not-cancellable', status: 409, title: 'Order cannot be cancelled in its current state' });

/**
 * Lỗi nghiệp vụ của giao diện nội bộ (không có HTTP): bên gọi (CHK, SHP) bắt theo `code`. Mã dùng trong mã nhưng ORD-API chưa đặt tên (xem report, Lệch spec):
 * `invalid_input` (đầu vào của createPending sai hay số tiền không nhất quán), `order_not_found`, `not_confirmable` (confirmCod: không phải COD pending), `not_lockable` (lockForHandoff: không ở paid hay confirmed).
 */
export type OrderErrorCode = 'invalid_input' | 'order_not_found' | 'not_confirmable' | 'not_lockable';
export class OrderBusinessError extends Error {
  constructor(readonly code: OrderErrorCode, message: string = code) { super(message); this.name = 'OrderBusinessError'; }
}
