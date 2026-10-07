'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { secondsText } from '../../components/Form';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

type View = 'init' | 'verifying' | 'success' | 'invalid' | 'pending' | 'error';
const COOLDOWN = 60;

export default function VerifyEmailPage() {
  const router = useRouter();
  const { status, user, refresh } = useAuth();
  const token = useRef<string | null>(null); // token chỉ trong bộ nhớ trang (fragment, SB-28)
  const [view, setView] = useState<View>('init');
  const [left, setLeft] = useState(0); // đếm ngược sau khi gửi lại
  const [sent, setSent] = useState(false);
  const [limited, setLimited] = useState<number | null>(null);
  const [already, setAlready] = useState(false);
  const started = useRef(false);

  const verify = useCallback(async () => {
    setView('verifying');
    // gọi bằng POST khi tải trang, không dùng GET để bộ quét link của hộp thư không tiêu thụ token (REQ-665 BR1)
    const r = await api('/auth/verify-email', { method: 'POST', body: { token: token.current } });
    if (r.status === 200) { setView('success'); await refresh(); } // làm mới phiên: chip "chưa xác minh" biến mất
    else if (r.status === 400) setView('invalid');
    else setView('error');
  }, [refresh]);

  // Token ở fragment (SB-28): đọc lúc tải và cả khi chỉ đổi fragment (mở liên kết khác trong cùng tab), rồi xóa khỏi thanh địa chỉ.
  useEffect(() => {
    const consume = () => {
      const m = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
      if (!m) return;
      started.current = true;
      token.current = decodeURIComponent(m[1]);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setSent(false); setLimited(null);
      void verify();
    };
    consume();
    window.addEventListener('hashchange', consume);
    return () => window.removeEventListener('hashchange', consume);
  }, [verify]);

  // không có token: chỉ customer chưa xác minh vào màn chờ; guest về đăng nhập
  useEffect(() => {
    if (started.current || status === 'loading' || view !== 'init') return;
    if (status === 'error') { setView('error'); return; }
    if (!user) router.replace('/login?next=%2Fverify-email&reason=required');
    else if (user.role !== 'customer') router.replace('/');
    else if (user.email_verified) { setAlready(true); setView('pending'); }
    else setView('pending');
  }, [status, user, view, router]);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const resend = async () => {
    setLimited(null);
    const r = await api('/auth/verify-email/resend', { method: 'POST' });
    if (r.status === 202) { setSent(true); setLeft(COOLDOWN); }
    else if (r.status === 429) setLimited(r.retryAfter ?? 60);
    else if (r.status === 409) setAlready(true);
    else if (r.status === 401) { /* hộp thoại phiên hết hạn do lớp gọi API bật; không phiên thì về đăng nhập */ if (r.code !== 'session_expired') router.replace('/login?next=%2Fverify-email&reason=required'); }
    else setView('error');
  };
  const isCustomer = user?.role === 'customer';
  // không `disabled` trong lúc đếm ngược (chỉ mờ đi): bấm sớm vẫn gọi API và nhận 429, server là nơi chặn (xem report.md, Lệch spec)
  const resendButton = (
    <button className={`btn btn-primary ${left > 0 ? 'dim' : ''}`} onClick={() => void resend()} data-testid="auth-verify-email-resend">Gửi lại email xác minh</button>
  );

  return (
    <main className="center"><section className="card">
      <h1>Xác minh email</h1>
      {(view === 'init' || view === 'verifying') && <p data-testid="auth-verify-email-verifying" role="status">Đang xác minh...</p>}
      {view === 'success' && (
        <div data-testid="auth-verify-email-success">
          <div role="status" className="banner banner-ok">Đã xác minh email</div>
          {user ? <Link className="btn btn-primary" href="/" data-testid="auth-verify-email-continue">Tiếp tục mua sắm</Link>
            : <Link className="btn btn-primary" href="/login" data-testid="auth-verify-email-login-link">Đăng nhập</Link>}
        </div>
      )}
      {view === 'invalid' && (
        <div data-testid="auth-verify-email-invalid-link">
          <p>Liên kết không còn hiệu lực. Nếu bạn đã xác minh, hãy đăng nhập.</p>
          {isCustomer ? resendButton : <Link className="btn btn-primary" href="/login" data-testid="auth-verify-email-login-link">Đăng nhập</Link>}
        </div>
      )}
      {view === 'pending' && (
        <div>
          {already ? (
            <div data-testid="auth-verify-email-already-verified">
              <div role="status" className="banner banner-ok">Email của bạn đã được xác minh.</div>
              <Link className="btn btn-primary" href="/" data-testid="auth-verify-email-continue">Tiếp tục mua sắm</Link>
            </div>
          ) : (
            <div data-testid="auth-verify-email-pending">
              <p>Chúng tôi đã gửi email xác minh tới <strong>{user?.email}</strong>. Hãy mở liên kết trong email.</p>
              {sent && <p role="status" data-testid="auth-verify-email-resend-sent">Đã gửi lại. Kiểm tra hộp thư của bạn.{left > 0 ? ` Gửi lại được sau ${left} giây.` : ''}</p>}
              {limited !== null && <div role="alert" className="banner banner-error" data-testid="auth-verify-email-rate-limited">Bạn gửi quá nhanh, thử lại sau {secondsText(limited)}.</div>}
              {resendButton}
            </div>
          )}
        </div>
      )}
      {view === 'error' && (
        <div role="alert" className="banner banner-error" data-testid="auth-verify-email-error">
          Không thực hiện được. Thử lại. <button className="btn" onClick={() => (token.current ? void verify() : router.refresh())} data-testid="auth-verify-email-retry">Thử lại</button>
        </div>
      )}
    </section></main>
  );
}
