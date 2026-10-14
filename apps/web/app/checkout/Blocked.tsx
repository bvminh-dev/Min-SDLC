'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Spinner } from '../../components/PaymentParts';
import { useCountdown } from '../../components/useCountdown';
import { api } from '../../lib/api';
import { waitText } from '../../lib/checkout';

/** Lý do chưa vào được checkout (ui/checkout-blocked): mỗi lần chỉ một lý do. */
export type Block =
  | { kind: 'email-not-verified' } | { kind: 'cart-empty' } | { kind: 'unavailable-items'; names: string[] } | { kind: 'already-ordered' }
  | { kind: 'rate-limited'; seconds: number } | { kind: 'session-expired' } | { kind: 'session-closed' } | { kind: 'error' } | { kind: 'login-expired' };

export const LOGIN_HREF = `/login?next=${encodeURIComponent('/checkout')}&reason=expired`;

/** Gửi lại email xác minh (endpoint của AUTH); mốc gửi lại sớm nhất 60 giây: trong lúc chờ nút mờ đi và hiện số giây còn lại (tự hết, không giữ mãi). */
function Resend({ onVerified }: { onVerified: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const cool = useCountdown();
  const send = async () => {
    if (busy || cool.left > 0) return;
    setBusy(true); setMsg('');
    const r = await api('/auth/verify-email/resend', { method: 'POST', silentExpired: true });
    setBusy(false);
    if (r.status === 202) { setMsg('Đã gửi lại email xác minh. Hãy mở liên kết trong email rồi quay lại thanh toán.'); cool.start(60); }
    else if (r.status === 429) { setMsg(waitText(r.retryAfter)); cool.start(r.retryAfter); }
    else if (r.status === 409) onVerified(); // đã xác minh: thử mở phiên lại
    else if (r.status === 401) setMsg('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
    else setMsg('Chưa gửi được email. Thử lại.');
  };
  return (
    <>
      <button type="button" className={`btn btn-primary tight${cool.left > 0 ? ' dim' : ''}`} aria-disabled={busy || cool.left > 0} aria-busy={busy} onClick={() => void send()} data-testid="chk-checkout-blocked-resend-verification">{busy && <Spinner />}Gửi lại email xác minh</button>
      {msg && <p role="status" className="hint">{msg}</p>}
      {cool.left > 0 && <p className="hint">Có thể gửi lại sau {cool.left} giây</p>}
    </>
  );
}

export function Blocked({ block, onRetry, onRestart, onVerified }: { block: Block; onRetry: () => void; onRestart: () => void; onVerified: () => void }) {
  const toCart = <Link href="/cart" className="btn tight" data-testid="chk-checkout-blocked-back-to-cart">Về giỏ hàng</Link>;
  return (
    <main className="center"><section className="card card-block" aria-label="Chưa thể thanh toán">
      <h1>Chưa thể thanh toán</h1>
      {block.kind === 'email-not-verified' && (
        <div data-testid="chk-checkout-blocked-email-not-verified"><p>✉ Bạn cần xác minh email trước khi đặt hàng.</p>
          <div className="actions-row"><Resend onVerified={onVerified} />{toCart}</div></div>
      )}
      {block.kind === 'cart-empty' && (
        <div data-testid="chk-checkout-blocked-cart-empty"><p>🛒 Giỏ hàng đang trống.</p>
          <Link href="/products" className="btn btn-primary tight" data-testid="chk-checkout-blocked-continue-shopping">Tiếp tục mua sắm</Link></div>
      )}
      {block.kind === 'unavailable-items' && (
        <div data-testid="chk-checkout-blocked-unavailable-items"><p>⚠ Có sản phẩm không còn bán:</p>
          <ul>{block.names.map((n, i) => <li key={i} data-testid="chk-checkout-blocked-unavailable-item">{n}</li>)}</ul>
          <Link href="/cart" className="btn btn-primary tight" data-testid="chk-checkout-blocked-back-to-cart">Về giỏ hàng để xóa</Link></div>
      )}
      {block.kind === 'already-ordered' && (
        <div data-testid="chk-checkout-blocked-already-ordered"><p>✓ Giỏ hàng này đã được đặt.</p>
          <Link href="/orders" className="btn btn-primary tight" data-testid="chk-checkout-blocked-view-orders">Xem đơn hàng</Link></div>
      )}
      {block.kind === 'rate-limited' && (
        <p role="alert" data-testid="chk-checkout-blocked-rate-limited">Bạn thao tác quá nhanh, thử lại sau {block.seconds} giây.</p>
      )}
      {block.kind === 'session-expired' && (
        <div data-testid="chk-checkout-blocked-session-expired"><p>⏱ Phiên thanh toán đã hết hạn, giỏ hàng của bạn vẫn còn.</p>
          <button type="button" className="btn btn-primary tight" onClick={onRestart} data-testid="chk-checkout-blocked-restart">Bắt đầu lại</button></div>
      )}
      {block.kind === 'session-closed' && (
        <div data-testid="chk-checkout-blocked-session-closed"><p>Phiên thanh toán này đã đóng.</p>
          <button type="button" className="btn btn-primary tight" onClick={onRestart} data-testid="chk-checkout-blocked-restart">Bắt đầu lại</button></div>
      )}
      {block.kind === 'error' && (
        <div role="alert" className="banner banner-error" data-testid="chk-checkout-blocked-error">Chưa mở được phiên thanh toán.{' '}
          <button type="button" className="btn" onClick={onRetry} data-testid="chk-checkout-blocked-retry">Thử lại</button></div>
      )}
      {block.kind === 'login-expired' && (
        <div role="alert" className="banner banner-error" data-testid="chk-checkout-blocked-login-expired">Phiên đăng nhập đã hết hạn. <a href={LOGIN_HREF}>Đăng nhập</a></div>
      )}
    </section></main>
  );
}
