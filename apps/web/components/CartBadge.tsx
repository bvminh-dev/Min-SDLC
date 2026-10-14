'use client';
import Link from 'next/link';
import { badgeText, useCartBadge } from '../lib/cart';

/** Huy hiệu giỏ ở đầu trang (CRT ui/add-to-cart): chỉ customer; tổng số lượng, 99 trở lên là "99+"; giỏ trống hay lỗi thì biểu tượng không số (lỗi nhẹ, không chặn việc khác). */
export function CartBadge() {
  const n = useCartBadge(true);
  return (
    <Link href="/cart" className="cart-badge" aria-label={n > 0 ? `Giỏ hàng, ${n} sản phẩm` : 'Giỏ hàng'} data-testid="crt-add-to-cart-badge">
      <span aria-hidden="true">Giỏ</span>
      {n > 0 && <span className="cart-count" data-testid="crt-add-to-cart-badge-count">{badgeText(n)}</span>}
    </Link>
  );
}
