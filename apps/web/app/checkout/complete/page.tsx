'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequireRole } from '../../../components/RequireRole';
import { Spinner, useRemaining } from '../../../components/PaymentParts';
import { api } from '../../../lib/api';
import { validIso } from '../../../lib/checkout';
import { formatPrice } from '../../../lib/format';
import { ORDER_STATUS_LABEL, formatClock, type OrderDetail } from '../../../lib/order';
import { formatRemaining } from '../../../lib/payment';

interface Q { code: string; replayed: boolean; deadline: string | null }
const LOGIN_HREF = `/login?next=${encodeURIComponent('/orders')}&reason=expired`;

/**
 * Kết quả đặt hàng (ui/checkout-complete): đơn đọc từ chi tiết đơn của ORD (GET /orders/{code}), số tiền lấy nguyên từ phản hồi; `deadline` trên địa chỉ là `payment_deadline` của lần đặt,
 * khi không có (tải lại, mở lại) thì lấy `payment_expires_at` của đơn. Đếm ngược về 0 hoặc đơn đã hết hạn: bỏ khối thanh toán và nút Thanh toán ngay, chỉ còn thông tin hết hạn.
 */
function Complete() {
  const [q, setQ] = useState<Q | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'expired'>('loading');
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ({ code: p.get('code') ?? '', replayed: p.get('replayed') === '1', deadline: validIso(p.get('deadline')) });
  }, []);

  const load = useCallback(async (code: string) => {
    const r = await api<OrderDetail>(`/orders/${encodeURIComponent(code)}`, { silentExpired: true });
    if (r.status === 200 && typeof r.body.code === 'string') { setOrder(r.body); setView('ready'); }
    else if (r.status === 401) setView('expired');
    else setView((v) => (v === 'ready' ? v : 'error')); // lần đọc lại hụt (hết giờ đếm ngược) không làm mất thẻ đang hiện
  }, []);
  useEffect(() => { if (q?.code) void load(q.code); else if (q) setView('error'); }, [q, load]);

  const deadline = order && order.payment_method === 'vnpay' ? (q?.deadline ?? validIso(order.payment_expires_at)) : null;
  const left = useRemaining(deadline, () => { if (q?.code) void load(q.code); }); // về 0: đọc lại đơn (INV chạy job hết hạn thật, đồng hồ chỉ là gợi ý)

  if (view === 'expired') return <main className="center"><div role="alert" className="banner banner-error" data-testid="chk-checkout-complete-login-expired">Phiên đăng nhập đã hết hạn. <a href={LOGIN_HREF}>Đăng nhập</a></div></main>;
  if (view === 'error') return <main className="center"><div role="alert" className="banner banner-error" data-testid="chk-checkout-complete-error">Không tải được kết quả đặt hàng, đơn của bạn có thể đã được tạo, xem trong danh sách đơn. <Link href="/orders">Danh sách đơn hàng</Link></div></main>;
  if (view === 'loading' || !order || !q) return <main className="center"><section className="card card-block" aria-busy="true" data-testid="chk-checkout-complete-loading"><p><Spinner />Đang tạo đơn</p><div className="skeleton" /></section></main>;

  const vnpay = order.payment_method === 'vnpay';
  const closed = order.status === 'expired' || order.status === 'cancelled';
  const lapsed = vnpay && (closed || (order.status === 'pending' && left === 0));
  const waiting = vnpay && order.status === 'pending' && !lapsed;
  const pay = `/orders/${encodeURIComponent(order.code)}/payment`;
  return (
    <main className="center"><section className="card card-block" aria-label="Kết quả đặt hàng">
      <h1>{vnpay ? 'Đã tạo đơn' : 'Đặt hàng thành công'} #<span className="mono" data-testid="chk-checkout-complete-order-code">{order.code}</span></h1>
      {q.replayed && <p className="badge" role="status" data-testid="chk-checkout-complete-replayed">Đơn này đã được đặt trước đó</p>}
      <p className="between"><span>Tổng cộng</span><strong data-testid="chk-checkout-complete-total">{formatPrice(order.grand_total)}</strong></p>
      <p className="hint">{vnpay ? 'VNPay' : 'COD'}</p>

      {waiting && (
        <div data-testid="chk-checkout-complete-online">
          {deadline && left !== null && <p data-testid="chk-checkout-complete-deadline">Hàng được giữ tới {formatClock(deadline)} (còn {formatRemaining(left)})</p>}
          <Link href={pay} className="btn btn-primary tight" data-testid="chk-checkout-complete-pay-now">Thanh toán ngay</Link>
        </div>
      )}
      {waiting && <p role="alert" className="banner banner-info" data-testid="chk-checkout-complete-expiry-warning">⚠ Quá hạn mà chưa thanh toán thì đơn tự hết hạn.</p>}
      {lapsed && <p role="alert" className="banner banner-info" data-testid="chk-checkout-complete-expiry-warning">⚠ Đơn đã quá hạn thanh toán, đơn sẽ tự hết hạn (hoặc đã hết hạn) và không thanh toán được nữa. Giỏ hàng cần thêm lại sản phẩm.</p>}
      {vnpay && !waiting && !lapsed && <p className="hint">Trạng thái đơn: {ORDER_STATUS_LABEL[order.status]}</p>}
      {!vnpay && (
        <div data-testid="chk-checkout-complete-cod"><p>{order.status === 'confirmed' ? 'Đơn đã xác nhận. Trả tiền khi nhận hàng.' : `Trạng thái đơn: ${ORDER_STATUS_LABEL[order.status]}`}</p></div>
      )}

      <div className="actions-row">
        <Link href={`/orders/${encodeURIComponent(order.code)}`} className="btn tight" data-testid="chk-checkout-complete-view-order">Xem đơn hàng</Link>
        {!vnpay && <Link href="/products" className="btn tight" data-testid="chk-checkout-complete-continue-shopping">Tiếp tục mua sắm</Link>}
      </div>
    </section></main>
  );
}

export default function Page() { return <RequireRole roles={['customer']}><Complete /></RequireRole>; }
