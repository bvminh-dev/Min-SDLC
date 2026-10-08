'use client';
import { CouponForm } from '../../../../components/CouponForm';
import { RequireRole } from '../../../../components/RequireRole';

export default function NewCouponPage() {
  return <RequireRole roles={['admin']}><CouponForm /></RequireRole>;
}
