'use client';
import { RequireRole } from '../../../../components/RequireRole';
import { SaleCreateOrder } from '../../../../components/SaleCreateOrder';

/** Tạo đơn hộ (ui/sale-create-order, SAL-REQ-20261015-092710847): chỉ sale và admin; chặn ở giao diện chỉ để tiện, server vẫn kiểm quyền (SB-05). */
export default function SaleCreateOrderPage() {
  return <RequireRole roles={['sale', 'admin']}><SaleCreateOrder /></RequireRole>;
}
