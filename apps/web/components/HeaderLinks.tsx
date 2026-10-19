'use client';
import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { CartBadge } from './CartBadge';
import { CategoryStrip } from './CategoryStrip';
import { HeaderSearch } from './HeaderSearch';
import { NotificationBell } from './NotificationBell';

/**
 * Đầu trang. Khách và customer: kiểu sàn TMĐT (ô tìm kiếm, giỏ, chuông, dải danh mục; guest có Đăng nhập, Đăng ký; đơn hàng, thanh toán, đánh giá nằm trong menu tài khoản).
 * Staff và admin: hàng liên kết quản trị ("Đơn hàng", "Tồn kho", "Vận đơn", "Thanh toán", "Hoàn tiền" cho staff và admin; "Dashboard", "Vận chuyển", "Coupon", "Nguồn đơn", "Báo cáo nguồn", "Báo cáo sale", "Đánh giá" cho admin).
 */
export function HeaderLinks() {
  const { status, user } = useAuth();
  const staff = status === 'ready' && (user?.role === 'staff' || user?.role === 'admin');
  const admin = status === 'ready' && user?.role === 'admin';
  const sale = status === 'ready' && user?.role === 'sale';
  if (sale) {
    // Sale: tạo đơn hộ và "Đơn của tôi" (SAL, ui/sale-create-order, ui/sale-order-list); các màn quản trị khác theo quyền của role sale ở epic tương ứng.
    return (
      <>
        <div className="navlinks">
          <Link href="/products">Sản phẩm</Link>
          <Link href="/sales/orders/new">Tạo đơn</Link>
          <Link href="/sales/orders">Đơn của tôi</Link>
          <Link href="/admin/shipments">Vận đơn</Link>
        </div>
        <NotificationBell />
      </>
    );
  }
  if (staff) {
    return (
      <>
        <div className="navlinks">
          <Link href="/products">Sản phẩm</Link>
          <Link href="/admin/orders">Đơn hàng</Link>
          <Link href="/admin/inventory">Tồn kho</Link>
          <Link href="/admin/shipments">Vận đơn</Link>
          <Link href="/admin/payments">Thanh toán</Link>
          <Link href="/admin/refunds">Hoàn tiền</Link>
          {admin && <Link href="/sales/orders/new">Tạo đơn hộ</Link>}
          {admin && <Link href="/sales/orders">Đơn hộ</Link>}
          {admin && <Link href="/admin/dashboard">Dashboard</Link>}
          {admin && <Link href="/admin/shipping-methods">Vận chuyển</Link>}
          {admin && <Link href="/admin/coupons">Coupon</Link>}
          {admin && <Link href="/admin/order-sources">Nguồn đơn</Link>}
          {admin && <Link href="/admin/reports/sources">Báo cáo nguồn</Link>}
          {admin && <Link href="/admin/reports/sales">Báo cáo sale</Link>}
          {admin && <Link href="/admin/reviews">Đánh giá</Link>}
        </div>
        <NotificationBell />
      </>
    );
  }
  return (
    <>
      <HeaderSearch />
      {status === 'ready' && user?.role === 'customer' && <><CartBadge /><NotificationBell /></>}
      {status === 'ready' && !user && (
        <div className="authlinks"><Link className="btn" href="/login">Đăng nhập</Link><Link className="btn btn-primary tight" href="/register">Đăng ký</Link></div>
      )}
      <CategoryStrip />
    </>
  );
}
