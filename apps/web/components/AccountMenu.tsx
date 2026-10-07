'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, SESSION_EXPIRED_EVENT } from '../lib/api';
import { ROLE_LABEL, useAuth } from '../lib/auth';

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
          <p className="strong" data-testid="auth-account-menu-name">{user.full_name}</p>
          <p data-testid="auth-account-menu-email">{user.email}</p>
          <p data-testid="auth-account-menu-role">{ROLE_LABEL[user.role]}</p>
          {user.role === 'customer' && !user.email_verified && (
            <Link className="chip" href="/verify-email" onClick={() => setOpen(false)} data-testid="auth-account-menu-unverified">Email chưa xác minh</Link>
          )}
          <Link className="btn btn-quiet" href="/account/profile" onClick={() => setOpen(false)}>Hồ sơ của tôi</Link>
          {user.role === 'customer' && <Link className="btn btn-quiet" href="/account/addresses" onClick={() => setOpen(false)}>Sổ địa chỉ</Link>}
          {user.role !== 'customer' && <Link className="btn btn-quiet" href="/admin/customers" onClick={() => setOpen(false)}>Tra cứu khách</Link>}
          {failed && (
            <div role="alert" className="banner banner-error" data-testid="auth-account-menu-error">
              Không đăng xuất được. Thử lại. <button className="btn" onClick={() => void logout()} data-testid="auth-account-menu-retry">Thử lại</button>
            </div>
          )}
          {busy ? (
            <p data-testid="auth-account-menu-logout-loading">Đang đăng xuất...</p>
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
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, on);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, on);
  }, []);
  if (!open) return null;
  const next = typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search;
  return (
    <div className="backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="se-title" data-testid="auth-account-menu-session-expired">
        <h2 id="se-title">Phiên đã hết hạn</h2>
        <p>Hãy đăng nhập lại để tiếp tục.</p>
        <a className="btn btn-primary" href={`/login?next=${encodeURIComponent(next)}&reason=expired`} data-testid="auth-account-menu-session-expired-login">Đăng nhập</a>
      </div>
    </div>
  );
}
