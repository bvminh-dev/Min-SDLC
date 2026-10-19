'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Bone } from './Skeleton';

interface Cat { id: string; name: string; parent_id: string | null }
let cache: Cat[] | null = null; // toàn bộ danh mục; layout giữ component qua các trang nên tải một lần

/** Icon theo tên danh mục (từ khóa), rơi về vòng xoay khi không khớp. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const ICONS: [RegExp, string][] = [[/dien|phone|may/, 'phone'], [/nha|bep|noi that/, 'box'], [/thoi trang|ao|giay|phu kien/, 'bag'], [/qua|gift/, 'gift'], [/sach|van phong/, 'list']];
const FALLBACK = ['tag', 'layers', 'gift', 'heart'];
export const catIcon = (name: string, i: number): string => ICONS.find(([re]) => re.test(fold(name)))?.[1] ?? FALLBACK[i % FALLBACK.length];

function Strip() {
  const path = usePathname();
  const sp = useSearchParams();
  const [cats, setCats] = useState<Cat[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    void api<{ items: Cat[] }>('/categories').then((r) => {
      if (r.status === 200 && Array.isArray(r.body.items)) { cache = r.body.items; setCats(cache); }
    });
  }, []);
  const onList = path === '/products';
  const current = onList ? sp.get('category') : null;
  // Danh mục con đang chọn thì mục gốc chứa nó sáng lên
  let active = current;
  for (let n = 0; active && n < 4; n++) { const c = cats.find((x) => x.id === active); if (!c?.parent_id) break; active = c.parent_id; }
  const roots = cats.filter((c) => !c.parent_id);
  return (
    <nav className="cat-strip" aria-label="Danh mục">
      <Link href="/products" className={onList && !current ? 'on' : undefined} aria-current={onList && !current ? 'page' : undefined} data-testid="header-cat-all"><span className="i i-list" aria-hidden="true" /> Tất cả</Link>
      {cats.length === 0 && [72, 96, 84, 110, 90].map((w, i) => <Bone key={i} w={w} h={20} round />)}
      {roots.map((c, i) => (
        <Link key={c.id} href={`/products?category=${c.id}`} className={active === c.id ? 'on' : undefined} aria-current={active === c.id ? 'page' : undefined}>
          <span className={`i i-${catIcon(c.name, i)}`} aria-hidden="true" /> {c.name}
        </Link>
      ))}
    </nav>
  );
}

/** Dải danh mục dưới ô tìm kiếm (kiểu các sàn TMĐT): "Tất cả" rồi các danh mục gốc, bấm để lọc danh sách sản phẩm; mục đang chọn sáng lên. */
export function CategoryStrip() {
  return <Suspense fallback={<nav className="cat-strip" aria-label="Danh mục" />}><Strip /></Suspense>;
}
