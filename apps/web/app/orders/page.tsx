'use client';
import { OrderList } from '../../components/OrderList';
import { RequireRole } from '../../components/RequireRole';

/** Đơn hàng của tôi (ui/order-list, ORD-REQ-20261006-092320716): chỉ customer; staff và admin thấy màn không có quyền (họ dùng /admin/orders). */
export default function OrdersPage() {
  return <RequireRole roles={['customer']}><OrderList admin={false} /></RequireRole>;
}
