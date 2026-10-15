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
    if (r.status === 202) { setMsg('Đã gửi email. Mở liên kết rồi quay lại.'); cool.start(60); }
    else if (r.status === 429) { setMsg(waitText(r.retryAfter)); cool.start(r.retryAfter); }
    else if (r.status === 409) onVerified(); // đã xác minh: thử mở phiên lại
    else if (r.status === 401) setMsg('Phiên đăng nhập đã hết hạn.');
    else setMsg('Chưa gửi được email. Thử lại.');
  };
  return (
    <>
      <button type="button" className={`btn btn-primary tight${cool.left > 0 ? ' dim' : ''}`} aria-disabled={busy || cool.left > 0} aria-busy={busy} onClick={() => void send()} data-testid="chk-checkout-blocked-resend-verification">{busy ? <Spinner /> : <span className="i i-send" aria-hidden="true" />}Gửi lại email</button>
      {msg && <p role="status" className="muted small crt-b-msg">{msg}</p>}
      {cool.left > 0 && <p className="muted small crt-b-msg">Gửi lại sau {cool.left} giây</p>}
    </>
  );
}

type Tone = 'amber' | 'red' | 'green' | 'gray';
const Icon = ({ tone, icon }: { tone: Tone; icon: string }) => <span className={`tile tile-lg ${tone}`}><span className={`i i-${icon}`} aria-hidden="true" /></span>;

export function Blocked({ block, onRetry, onRestart, onVerified }: { block: Block; onRetry: () => void; onRestart: () => void; onVerified: () => void }) {
  const toCart = <Link href="/cart" className="btn tight" data-testid="chk-checkout-blocked-back-to-cart">Giỏ hàng</Link>;
  const restart = <button type="button" className="btn btn-primary tight" onClick={onRestart} data-testid="chk-checkout-blocked-restart">Bắt đầu lại</button>;
  return (
    <main className="page page-narrow"><div className="page-head"><h1>Chưa thể thanh toán</h1></div>
      <section className="panel crt-blocked" aria-label="Chưa thể thanh toán">
        {block.kind === 'email-not-verified' && (
          <div className="empty" data-testid="chk-checkout-blocked-email-not-verified"><Icon tone="amber" icon="mail" /><strong>Cần xác minh email</strong>
            <div className="row crt-b-actions"><Resend onVerified={onVerified} />{toCart}</div></div>
        )}
        {block.kind === 'cart-empty' && (
          <div className="empty" data-testid="chk-checkout-blocked-cart-empty"><Icon tone="gray" icon="cart" /><strong>Giỏ hàng trống</strong>
            <Link href="/products" className="btn btn-primary tight" data-testid="chk-checkout-blocked-continue-shopping"><span className="i i-tag" aria-hidden="true" />Mua sắm</Link></div>
        )}
        {block.kind === 'unavailable-items' && (
          <div className="empty" data-testid="chk-checkout-blocked-unavailable-items"><Icon tone="red" icon="alert" /><strong>Có sản phẩm ngừng bán</strong>
            <ul className="crt-b-names">{block.names.map((n, i) => <li key={i} data-testid="chk-checkout-blocked-unavailable-item">{n}</li>)}</ul>
            <Link href="/cart" className="btn btn-primary tight" data-testid="chk-checkout-blocked-back-to-cart">Về giỏ hàng</Link></div>
        )}
        {block.kind === 'already-ordered' && (
          <div className="empty" data-testid="chk-checkout-blocked-already-ordered"><Icon tone="green" icon="okc" /><strong>Giỏ này đã được đặt</strong>
            <Link href="/orders" className="btn btn-primary tight" data-testid="chk-checkout-blocked-view-orders"><span className="i i-receipt" aria-hidden="true" />Xem đơn</Link></div>
        )}
        {block.kind === 'rate-limited' && (
          <div className="empty" role="alert" data-testid="chk-checkout-blocked-rate-limited"><Icon tone="amber" icon="clock" /><strong>Quá nhanh, thử lại sau {block.seconds} giây</strong></div>
        )}
        {block.kind === 'session-expired' && (
          <div className="empty" data-testid="chk-checkout-blocked-session-expired"><Icon tone="amber" icon="clock" /><strong>Phiên hết hạn</strong><p>Giỏ hàng vẫn còn.</p>{restart}</div>
        )}
        {block.kind === 'session-closed' && (
          <div className="empty" data-testid="chk-checkout-blocked-session-closed"><Icon tone="gray" icon="ban" /><strong>Phiên đã đóng</strong>{restart}</div>
        )}
        {block.kind === 'error' && (
          <div className="empty" role="alert" data-testid="chk-checkout-blocked-error"><Icon tone="red" icon="alert" /><strong>Chưa mở được phiên</strong>
            <button type="button" className="btn btn-primary tight" onClick={onRetry} data-testid="chk-checkout-blocked-retry">Thử lại</button></div>
        )}
        {block.kind === 'login-expired' && (
          <div className="empty" role="alert" data-testid="chk-checkout-blocked-login-expired"><Icon tone="red" icon="key" /><strong>Phiên đăng nhập hết hạn</strong>
            <a href={LOGIN_HREF} className="btn btn-primary tight"><span className="i i-login" aria-hidden="true" />Đăng nhập</a></div>
        )}
      </section>
    </main>
  );
}
