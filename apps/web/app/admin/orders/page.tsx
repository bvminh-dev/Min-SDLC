'use client';
import { OrderList } from '../../../components/OrderList';
import { RequireRole } from '../../../components/RequireRole';

/** Quản lý đơn hàng (ui/order-admin-list, ORD-REQ-20261006-092320743): staff và admin xem, lọc, tìm theo mã đơn; không có thao tác đổi đơn nào. */
export default function AdminOrdersPage() {
  return <RequireRole roles={['staff', 'admin']}><OrderList admin /></RequireRole>;
}
