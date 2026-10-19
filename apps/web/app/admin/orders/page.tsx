'use client';
import { OrderList } from '../../../components/OrderList';
import { RequireRole } from '../../../components/RequireRole';

/**
 * Quản lý đơn hàng (ui/order-admin-list và ui/order-list-source, ORD-REQ-20261006-092320743): staff và admin xem mọi đơn, sale chỉ đơn do mình tạo (server giới hạn);
 * lọc theo trạng thái, nguồn, người tạo (không có cho sale), tìm theo mã đơn; không có thao tác đổi đơn nào.
 */
export default function AdminOrdersPage() {
  return <RequireRole roles={['staff', 'sale', 'admin']}><OrderList admin /></RequireRole>;
}
