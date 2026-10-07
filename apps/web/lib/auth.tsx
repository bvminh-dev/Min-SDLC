'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export type Role = 'customer' | 'staff' | 'admin';
export interface User { id: string; email: string; full_name: string; role: Role; email_verified: boolean }
type Status = 'loading' | 'ready' | 'error';
interface Ctx { status: Status; user: User | null; refresh: () => Promise<void>; clear: () => void }

export const ROLE_LABEL: Record<Role, string> = { customer: 'Khách hàng', staff: 'Nhân viên', admin: 'Quản trị' };
/** Trang mặc định sau đăng nhập theo role (khi không có `next` hợp lệ). */
export const homeFor = (role: Role): string => (role === 'admin' ? '/admin/users' : '/');

const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = (): Ctx => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth ngoài AuthProvider');
  return c;
};

/** Trạng thái đăng nhập của trang: lấy từ GET /auth/session (không gia hạn phiên). 401 là guest; lỗi mạng hoặc 5xx là `error`. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const refresh = useCallback(async () => {
    const r = await api<{ user: User }>('/auth/session', { silentExpired: true });
    if (r.status === 200) { setUser(r.body.user); setStatus('ready'); }
    else if (r.status === 401) { setUser(null); setStatus('ready'); }
    else setStatus('error');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const clear = useCallback(() => { setUser(null); setStatus('ready'); }, []);
  const value = useMemo(() => ({ status, user, refresh, clear }), [status, user, refresh, clear]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
