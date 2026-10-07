'use client';
import Link from 'next/link';
import { ROLE_LABEL, type Role } from '../lib/auth';

/** Màn "Không có quyền truy cập" (AUTH-REQ-20261006-095515918 BR7): người đã đăng nhập vào trang ngoài quyền. Guest không bao giờ thấy màn này. */
export function AccessDenied({ role, error, onRetry }: { role?: Role; error?: boolean; onRetry?: () => void }) {
  if (error) {
    return (
      <main className="center">
        <div role="alert" className="banner banner-error" data-testid="auth-access-denied-error">
          Không kiểm tra được quyền. Thử lại.{' '}
          <button className="btn" data-testid="auth-access-denied-retry" onClick={onRetry}>Thử lại</button>
        </div>
      </main>
    );
  }
  return (
    <main className="center">
      <section className="card" data-testid="auth-access-denied-container">
        <h1>Không có quyền truy cập</h1>
        <p data-testid="auth-access-denied-message">Bạn đang đăng nhập với vai trò {role ? ROLE_LABEL[role] : 'hiện tại'}. Trang này dành cho vai trò khác.</p>
        <Link className="btn btn-primary" href="/" data-testid="auth-access-denied-home">Về trang chủ</Link>
      </section>
    </main>
  );
}
