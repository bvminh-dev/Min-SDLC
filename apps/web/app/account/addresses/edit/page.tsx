'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { RequireRole } from '../../../../components/RequireRole';
import { AddressForm } from '../AddressForm';

function Edit() {
  const id = useSearchParams().get('id') ?? '';
  return <AddressForm id={id} />;
}
export default function EditAddressPage() {
  return <RequireRole roles={['customer']}><Suspense fallback={null}><Edit /></Suspense></RequireRole>;
}
