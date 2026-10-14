'use client';
import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { CartBadge } from './CartBadge';
import { NotificationBell } from './NotificationBell';

/** Liên kết trên thanh đầu trang: "Sản phẩm" cho mọi người, "Giỏ" (huy hiệu giỏ, CRT) cho customer, "Đơn hàng" cho mọi người đã đăng nhập (customer: của mình; staff, admin: quản lý), "Tồn kho", "Vận đơn", "Thanh toán", "Hoàn tiền" cho staff và admin ("Thanh toán" cho customer là lịch sử của mình), "Coupon" và "Kiểm duyệt đánh giá" cho admin, "Đánh giá của tôi" cho customer (REV); guest thêm đăng nhập, đăng ký (người đã đăng nhập thấy menu tài khoản thay thế). */
export function HeaderLinks() {
  const { status, user } = useAuth();
  return (
    <>
      <Link href="/products">Sản phẩm</Link>
      {status === 'ready' && user?.role === 'customer' && <CartBadge />}
      {status === 'ready' && user?.role === 'customer' && <Link href="/orders">Đơn hàng</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/orders">Đơn hàng</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/inventory">Tồn kho</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/shipments">Vận đơn</Link>}
      {status === 'ready' && user?.role === 'customer' && <Link href="/payments">Thanh toán</Link>}
      {status === 'ready' && user?.role === 'customer' && <Link href="/me/reviews">Đánh giá của tôi</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/payments">Thanh toán</Link>}
      {status === 'ready' && (user?.role === 'staff' || user?.role === 'admin') && <Link href="/admin/refunds">Hoàn tiền</Link>}
      {status === 'ready' && user?.role === 'admin' && <Link href="/admin/dashboard">Dashboard</Link>}
      {status === 'ready' && user?.role === 'admin' && <Link href="/admin/shipping-methods">Phương thức vận chuyển</Link>}
      {status === 'ready' && user?.role === 'admin' && <Link href="/admin/coupons">Coupon</Link>}
      {status === 'ready' && user?.role === 'admin' && <Link href="/admin/reviews">Kiểm duyệt đánh giá</Link>}
      {status === 'ready' && user && <NotificationBell />}
      {status === 'ready' && !user && (<><Link href="/login">Đăng nhập</Link><Link href="/register">Đăng ký</Link></>)}
    </>
  );
}
