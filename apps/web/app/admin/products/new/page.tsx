'use client';
import { ProductEditor } from '../../../../components/ProductEditor';
import { RequireRole } from '../../../../components/RequireRole';

export default function NewProductPage() {
  return <RequireRole roles={['admin']}><ProductEditor /></RequireRole>;
}
