'use client';
import { useParams } from 'next/navigation';
import { ProductEditor } from '../../../../components/ProductEditor';
import { RequireRole } from '../../../../components/RequireRole';

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireRole roles={['staff', 'admin']}><ProductEditor key={id} id={id} /></RequireRole>;
}
