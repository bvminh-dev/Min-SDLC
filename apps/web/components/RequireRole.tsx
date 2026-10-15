'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type Role } from '../lib/auth';
import { AccessDenied } from './AccessDenied';

/**
 * Chặn ở giao diện (chỉ tiện; server vẫn kiểm quyền): guest chuyển tới đăng nhập kèm đường dẫn quay lại; đã đăng nhập mà sai role thấy
 * màn không có quyền, không tải dữ liệu của trang (AUTH-REQ-20261006-095515918 BR7).
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { status, user, refresh } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const guest = status === 'ready' && !user;
  useEffect(() => {
    if (guest) router.replace(`/login?next=${encodeURIComponent(path)}&reason=required`);
  }, [guest, path, router]);
  if (status === 'loading' || guest) return <main className="center"><p className="muted"><span className="spinner" aria-hidden="true" />Đang tải…</p></main>;
  if (status === 'error') return <AccessDenied error onRetry={() => void refresh()} />;
  if (!user || !roles.includes(user.role)) return <AccessDenied role={user?.role} />;
  return <>{children}</>;
}
