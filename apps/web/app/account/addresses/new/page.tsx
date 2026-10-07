'use client';
import { RequireRole } from '../../../../components/RequireRole';
import { AddressForm } from '../AddressForm';

export default function NewAddressPage() {
  return <RequireRole roles={['customer']}><AddressForm /></RequireRole>;
}
