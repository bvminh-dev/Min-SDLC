'use client';
import { ProductImport } from '../../../../components/ProductImport';
import { RequireRole } from '../../../../components/RequireRole';

// Chỉ admin (staff, sale không có mục menu và thấy màn không có quyền; server vẫn 403): màn admin-product-import.
export default function ImportProductsPage() {
  return <RequireRole roles={['admin']}><ProductImport /></RequireRole>;
}
