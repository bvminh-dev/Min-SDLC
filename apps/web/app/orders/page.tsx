'use client';
import { RequireRole } from '../../components/RequireRole';

// Chỗ giữ cho epic ORD (chưa có): AUTH chỉ cần đường dẫn cần đăng nhập để kiểm chuyển hướng và `next` (AUTH-E2E-20261006-100708000).
export default function OrdersPlaceholder() {
  return (
    <RequireRole roles={['customer', 'staff', 'admin']}>
      <main className="center"><section className="card"><h1>Đơn hàng</h1><p>Màn đơn hàng do epic ORD dựng.</p></section></main>
    </RequireRole>
  );
}
