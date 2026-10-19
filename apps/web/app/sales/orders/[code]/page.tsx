'use client';
import { useParams } from 'next/navigation';
import { RequireRole } from '../../../../components/RequireRole';
import { SaleOrderDetail } from '../../../../components/SaleOrderDetail';

/** Chi tiết đơn hộ (ui/sale-order-detail, SAL-REQ-20261015-092711321): chỉ sale và admin; đơn của người khác hay không có cùng màn "không tìm thấy". */
export default function SaleOrderDetailPage() {
  const { code } = useParams<{ code: string }>();
  return <RequireRole roles={['sale', 'admin']}><SaleOrderDetail code={code} /></RequireRole>;
}
