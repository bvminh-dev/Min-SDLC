'use client';
import Link from 'next/link';
import { useAuth } from '../lib/auth';

/** Liên kết trên thanh đầu trang: "Sản phẩm" cho mọi người, "Đơn hàng" cho mọi người đã đăng nhập (customer: của mình; staff, admin: quản lý), "Tồn kho" cho staff và admin, "Coupon" cho admin; guest thêm đăng nhập, đăng ký (người đã đăng nhập thấy menu tài khoản thay thế). */
export function HeaderLinks() {
  const { status, user } = useAuth();
  return (
    <>
      <Link href="/products">Sản phẩm</Link>
      {status === 'ready' && user?.role === 'customer' && <Link href="/orders">Đơn hàng</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/orders">Đơn hàng</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/inventory">Tồn kho</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/shipments">Vận đơn</Link>}
      {status === 'ready' && user?.role === 'admin' && <Link href="/admin/shipping-methods">Phương thức vận chuyển</Link>}
      {status === 'ready' && user?.role === 'admin' && <Link href="/admin/coupons">Coupon</Link>}
      {status === 'ready' && !user && (<><Link href="/login">Đăng nhập</Link><Link href="/register">Đăng ký</Link></>)}
    </>
  );
}
