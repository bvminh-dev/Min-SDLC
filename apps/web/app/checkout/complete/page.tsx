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

  if (view === 'expired') return <main className="page page-narrow"><div role="alert" className="banner banner-error" data-testid="chk-checkout-complete-login-expired">Phiên đăng nhập đã hết hạn. <a href={LOGIN_HREF}>Đăng nhập</a></div></main>;
  if (view === 'error') return <main className="page page-narrow"><section className="panel"><div className="empty" role="alert" data-testid="chk-checkout-complete-error"><span className="tile tile-lg red"><span className="i i-alert" aria-hidden="true" /></span><strong>Không tải được kết quả</strong><p>Đơn có thể đã được tạo.</p><Link href="/orders" className="btn btn-primary"><span className="i i-receipt" aria-hidden="true" />Danh sách đơn hàng</Link></div></section></main>;
  if (view === 'loading' || !order || !q) return <main className="page page-narrow"><section className="panel" aria-busy="true" data-testid="chk-checkout-complete-loading"><div className="empty"><span className="tile tile-lg gray"><span className="i i-receipt" aria-hidden="true" /></span><strong><Spinner />Đang tạo đơn</strong></div></section></main>;

  const vnpay = order.payment_method === 'vnpay';
  const closed = order.status === 'expired' || order.status === 'cancelled';
  const lapsed = vnpay && (closed || (order.status === 'pending' && left === 0));
  const waiting = vnpay && order.status === 'pending' && !lapsed;
  const pay = `/orders/${encodeURIComponent(order.code)}/payment`;
  const tone = lapsed ? { c: 'red', i: 'alert' } : waiting ? { c: 'amber', i: 'clock' } : { c: 'green', i: 'check' };
  return (
    <main className="page page-narrow"><section className="panel crt-done" aria-label="Kết quả đặt hàng">
      <span className={`tile tile-lg ${tone.c} crt-done-ic`}><span className={`i i-${tone.i}`} aria-hidden="true" /></span>
      <h1>{vnpay ? 'Đã tạo đơn' : 'Đặt hàng thành công'} <span className="crt-code">#<span className="mono" data-testid="chk-checkout-complete-order-code">{order.code}</span></span></h1>
      {q.replayed && <p className="badge" role="status" data-testid="chk-checkout-complete-replayed">Đơn đã đặt trước đó</p>}
      <div className="crt-done-sum">
        <span className="badge"><span className={`i i-${vnpay ? 'card' : 'bag'}`} aria-hidden="true" />{vnpay ? 'VNPay' : 'COD'}</span>
        <span className="muted">Tổng cộng</span><strong className="crt-done-total" data-testid="chk-checkout-complete-total">{formatPrice(order.grand_total)}</strong>
      </div>

      {waiting && deadline && left !== null && (
        <p className="crt-deadline" data-testid="chk-checkout-complete-deadline"><span className="i i-clock" aria-hidden="true" />Giữ hàng tới {formatClock(deadline)} (còn {formatRemaining(left)})</p>
      )}
      {waiting && <p role="alert" className="banner banner-info" data-testid="chk-checkout-complete-expiry-warning">Quá hạn, đơn sẽ tự hết hạn.</p>}
      {lapsed && <p role="alert" className="banner banner-info" data-testid="chk-checkout-complete-expiry-warning">Đơn đã quá hạn, không thanh toán được nữa. Hãy thêm lại sản phẩm vào giỏ.</p>}
      {vnpay && !waiting && !lapsed && <p className="muted">{ORDER_STATUS_LABEL[order.status]}</p>}
      {!vnpay && (
        <div data-testid="chk-checkout-complete-cod"><p className="muted">{order.status === 'confirmed' ? 'Đã xác nhận, trả tiền khi nhận hàng.' : ORDER_STATUS_LABEL[order.status]}</p></div>
      )}

      <div className="crt-done-actions">
        {waiting && <div data-testid="chk-checkout-complete-online"><Link href={pay} className="btn btn-primary" data-testid="chk-checkout-complete-pay-now"><span className="i i-card" aria-hidden="true" />Thanh toán ngay</Link></div>}
        <Link href={`/orders/${encodeURIComponent(order.code)}`} className="btn" data-testid="chk-checkout-complete-view-order"><span className="i i-receipt" aria-hidden="true" />Xem đơn</Link>
        {!vnpay && <Link href="/products" className="btn" data-testid="chk-checkout-complete-continue-shopping"><span className="i i-tag" aria-hidden="true" />Mua sắm tiếp</Link>}
      </div>
    </section></main>
  );
}

export default function Page() { return <RequireRole roles={['customer']}><Complete /></RequireRole>; }
