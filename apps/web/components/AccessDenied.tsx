'use client';
import Link from 'next/link';
import { ROLE_LABEL, type Role } from '../lib/auth';

/** Màn "Không có quyền truy cập" (AUTH-REQ-20261006-095515918 BR7): người đã đăng nhập vào trang ngoài quyền. Guest không bao giờ thấy màn này. */
export function AccessDenied({ role, error, onRetry }: { role?: Role; error?: boolean; onRetry?: () => void }) {
  if (error) {
    return (
      <main className="center">
        <div role="alert" className="banner banner-error" data-testid="auth-access-denied-error">
          Không kiểm tra được quyền
          <button className="btn" data-testid="auth-access-denied-retry" onClick={onRetry}>Thử lại</button>
        </div>
      </main>
    );
  }
  return (
    <main className="center">
      <section className="card" data-testid="auth-access-denied-container">
        <div className="empty">
          <span className="tile tile-lg red"><span className="i i-ban" aria-hidden="true" /></span>
          <h1>Không có quyền</h1>
          <p data-testid="auth-access-denied-message">Vai trò {role ? ROLE_LABEL[role] : 'của bạn'} không vào được trang này.</p>
        </div>
        <Link className="btn btn-primary" href="/" data-testid="auth-access-denied-home">Trang chủ</Link>
      </section>
    </main>
  );
}
