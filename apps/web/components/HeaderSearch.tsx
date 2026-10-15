'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Ô tìm kiếm ở đầu trang (kiểu các sàn TMĐT): gõ rồi Enter hoặc bấm kính lúp để sang danh sách sản phẩm với `?q=`. */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim().slice(0, 100);
    router.push(t ? `/products?q=${encodeURIComponent(t)}` : '/products');
  };
  return (
    <form className="hsearch" role="search" onSubmit={submit} data-testid="header-search">
      <span className="i i-search" aria-hidden="true" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm sản phẩm" aria-label="Tìm sản phẩm" maxLength={100} />
      <button type="submit" aria-label="Tìm"><span className="i i-search" aria-hidden="true" /></button>
    </form>
  );
}
