'use client';
import { RequireRole } from '../../../components/RequireRole';
import { SaleOrderList } from '../../../components/SaleOrderList';

/** Đơn của tôi (ui/sale-order-list, SAL-REQ-20261015-092711222): chỉ sale và admin; customer và staff thấy màn không có quyền. */
export default function SaleOrdersPage() {
  return <RequireRole roles={['sale', 'admin']}><SaleOrderList /></RequireRole>;
}
