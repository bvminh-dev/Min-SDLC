'use client';
import Link from 'next/link';
import { useAuth } from '../lib/auth';

// Trang chủ tạm: cửa hàng (PRD, CRT...) thay thế ở epic sau; AUTH chỉ cần đích của đăng nhập và nút "Về trang chủ".
export default function Home() {
  const { user } = useAuth();
  return (
    <main className="center">
      <section className="card">
        <h1>Ecom</h1>
        <p>{user ? `Xin chào ${user.full_name}.` : 'Chào mừng. Hãy đăng nhập hoặc tạo tài khoản để mua sắm.'}</p>
        {user?.role === 'admin' && <p><Link href="/admin/users">Quản lý người dùng</Link></p>}
      </section>
    </main>
  );
}
