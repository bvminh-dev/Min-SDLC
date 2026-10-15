'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, SESSION_EXPIRED_EVENT } from '../lib/api';
import { ROLE_LABEL, useAuth } from '../lib/auth';
import { crtExpiredTestId } from '../lib/cart';
import { payExpiredTestId } from '../lib/payment';
import { expiredTestId } from '../lib/shipping';

/** Menu tài khoản (AUTH-REQ-20261006-095515808, ...774): avatar, tên, email, role, chip chưa xác minh (chỉ customer), đăng xuất. */
export function AccountMenu() {
  const { user, clear } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!user) return null;

  const logout = async () => {
    setBusy(true); setFailed(false);
    const r = await api('/auth/logout', { method: 'POST', silentExpired: true });
    setBusy(false);
    if (r.status === 204 || r.status === 401) { clear(); setOpen(false); router.replace('/login'); return; } // 401: coi như đã đăng xuất
    setFailed(true); // mạng, 5xx hoặc 403 csrf_failed: phiên còn
  };

  return (
    <div className="menu" ref={box}>
      <button className="avatar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="auth-account-menu-trigger" aria-label="Tài khoản">
        {user.full_name.trim().charAt(0).toUpperCase() || '?'}
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="acct-head">
            <span className="avatar avatar-lg" aria-hidden="true">{user.full_name.trim().charAt(0).toUpperCase() || '?'}</span>
            <div className="acct-id">
              <p className="strong" data-testid="auth-account-menu-name">{user.full_name}</p>
              <p className="muted small" data-testid="auth-account-menu-email">{user.email}</p>
              <p data-testid="auth-account-menu-role"><span className="badge" data-role={user.role}>{ROLE_LABEL[user.role]}</span></p>
            </div>
          </div>
          {user.role === 'customer' && !user.email_verified && (
            <Link className="chip" href="/verify-email" onClick={() => setOpen(false)} data-testid="auth-account-menu-unverified">Chưa xác minh email</Link>
          )}
          {user.role === 'customer' && <Link className="btn btn-quiet" href="/orders" onClick={() => setOpen(false)}>Đơn hàng</Link>}
          {user.role === 'customer' && <Link className="btn btn-quiet" href="/payments" onClick={() => setOpen(false)}>Thanh toán</Link>}
          {user.role === 'customer' && <Link className="btn btn-quiet" href="/me/reviews" onClick={() => setOpen(false)}>Đánh giá</Link>}
          <Link className="btn btn-quiet" href="/account/profile" onClick={() => setOpen(false)}>Hồ sơ</Link>
          {user.role === 'customer' && <Link className="btn btn-quiet" href="/account/addresses" onClick={() => setOpen(false)}>Sổ địa chỉ</Link>}
          {user.role !== 'customer' && <Link className="btn btn-quiet" href="/admin/customers" onClick={() => setOpen(false)}>Khách hàng</Link>}
          {user.role !== 'customer' && <Link className="btn btn-quiet" href="/admin/products" onClick={() => setOpen(false)}>Sản phẩm</Link>}
          {user.role === 'admin' && <Link className="btn btn-quiet" href="/admin/categories" onClick={() => setOpen(false)}>Danh mục</Link>}
          {failed && (
            <div role="alert" className="banner banner-error" data-testid="auth-account-menu-error">
              Không đăng xuất được <button className="btn" onClick={() => void logout()} data-testid="auth-account-menu-retry">Thử lại</button>
            </div>
          )}
          {busy ? (
            <p className="muted small" data-testid="auth-account-menu-logout-loading">Đang thoát…</p>
          ) : (
            <button role="menuitem" className="btn btn-quiet" onClick={() => void logout()} data-testid="auth-account-menu-logout">Đăng xuất</button>
          )}
        </div>
      )}
    </div>
  );
}

/** Hộp thoại chặn thao tác khi API trả 401 `session_expired` ở bất kỳ màn nào. */
export function SessionExpiredDialog() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, on);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, on);
  }, []);
  if (!open) return null;
  const next = typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search;
  return (
    <div className="backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="se-title" data-testid={expiredTestId(path) ?? payExpiredTestId(path) ?? crtExpiredTestId(path) ?? 'auth-account-menu-session-expired'}>
        <div className="dlg-head"><span className="tile amber"><span className="i i-clock" aria-hidden="true" /></span><h2 id="se-title">Hết phiên</h2></div>
        <p>Đăng nhập lại để tiếp tục.</p>
        <a className="btn btn-primary" href={`/login?next=${encodeURIComponent(next)}&reason=expired`} data-testid="auth-account-menu-session-expired-login">Đăng nhập</a>
      </div>
    </div>
  );
}
