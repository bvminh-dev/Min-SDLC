'use client';
import Link from 'next/link';
import { useAuth } from '../lib/auth';

/** Liên kết cho guest trên thanh đầu trang (đăng nhập, đăng ký); người đã đăng nhập thấy menu tài khoản thay thế. */
export function HeaderLinks() {
  const { status, user } = useAuth();
  if (status !== 'ready' || user) return null;
  return (<><Link href="/login">Đăng nhập</Link><Link href="/register">Đăng ký</Link></>);
}
