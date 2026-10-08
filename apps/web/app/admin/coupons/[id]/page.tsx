'use client';
import { useParams } from 'next/navigation';
import { CouponForm } from '../../../../components/CouponForm';
import { RequireRole } from '../../../../components/RequireRole';

export default function EditCouponPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireRole roles={['admin']}><CouponForm key={id} id={id} /></RequireRole>;
}
