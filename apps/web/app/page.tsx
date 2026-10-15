'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { catIcon } from '../components/CategoryStrip';
import { formatPrice } from '../lib/format';

interface Card { id: string; name: string; price: number; image_url: string | null }
interface Cat { id: string; name: string; parent_id: string | null; product_count: number }

const STAFF_LINKS: { href: string; icon: string; label: string; tone: string; admin?: boolean }[] = [
  { href: '/admin/products', icon: 'tag', label: 'Sản phẩm', tone: '' },
  { href: '/admin/categories', icon: 'folder', label: 'Danh mục', tone: 'violet', admin: true },
  { href: '/admin/users', icon: 'users', label: 'Người dùng', tone: 'green', admin: true },
];
const PERKS = [
  { icon: 'truck', tone: '', title: 'Giao tận nơi', sub: 'Phí rõ ràng, miễn phí từ mức đơn' },
  { icon: 'card', tone: 'green', title: 'COD hoặc VNPay', sub: 'Chọn cách trả tiện nhất' },
  { icon: 'ticket', tone: 'amber', title: 'Mã giảm giá', sub: 'Nhập mã khi thanh toán' },
];
const TONES = ['', 'green', 'amber', 'violet', 'red'];
const CAT_ICON = ['tag', 'box', 'gift', 'layers', 'bag'];

export default function Home() {
  const { user } = useAuth();
  const [items, setItems] = useState<Card[] | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  useEffect(() => {
    let alive = true;
    void api<{ items: Card[] }>('/products?limit=8&sort=newest').then((r) => { if (alive) setItems(r.status === 200 && Array.isArray(r.body.items) ? r.body.items : []); });
    void api<{ items: Cat[] }>('/categories').then((r) => { if (alive && r.status === 200 && Array.isArray(r.body.items)) setCats(r.body.items.filter((c) => !c.parent_id)); });
    return () => { alive = false; };
  }, []);
  const staff = user && user.role !== 'customer';
  const links = STAFF_LINKS.filter((s) => !s.admin || user?.role === 'admin');
  const hero = (items ?? []).filter((p) => p.image_url).slice(0, 4);

  return (
    <main className="page" data-testid="home">
      {staff && (
        <div className="ct-shortcuts">
          {links.map((s) => (
            <Link key={s.href} href={s.href} className="stat ct-shortcut">
              <span className={`tile ${s.tone}`}><span className={`i i-${s.icon}`} aria-hidden="true" /></span>
              <b>{s.label}</b>
              <span className="i i-right muted" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}

      <section className="hm-hero">
        <div className="hm-copy">
          <span className="hm-eyebrow"><span className="i i-bag" aria-hidden="true" /> Ecom</span>
          <h1>Mua sắm <em>dễ hơn</em></h1>
          <p>{user ? `Chào ${user.full_name}.` : 'Hàng đủ loại, giao tận nơi.'}</p>
          <div className="row">
            <Link className="btn btn-primary tight hm-cta" href="/products"><span className="i i-bag" aria-hidden="true" /> Mua ngay</Link>
            {!user && <Link className="btn tight hm-cta" href="/register"><span className="i i-userplus" aria-hidden="true" /> Đăng ký</Link>}
          </div>
          {!user && <Link className="hm-login" href="/login">Đã có tài khoản? <b>Đăng nhập</b></Link>}
        </div>
        <div className={`hm-collage${hero.length ? '' : ' hm-collage-empty'}`} aria-hidden="true">
          {hero.length
            ? hero.map((p) => <span key={p.id} className="hm-shot"><img src={p.image_url ?? ''} alt="" /></span>)
            : [0, 1, 2, 3].map((i) => <span key={i} className="hm-shot"><span className={`i i-${CAT_ICON[i]}`} /></span>)}
        </div>
      </section>

      <ul className="hm-perks">
        {PERKS.map((p) => (
          <li key={p.title} className="hm-perk">
            <span className={`tile ${p.tone}`}><span className={`i i-${p.icon}`} aria-hidden="true" /></span>
            <span><b>{p.title}</b><span className="muted small">{p.sub}</span></span>
          </li>
        ))}
      </ul>

      {cats.length > 0 && (
        <section className="hm-sec">
          <div className="hm-sec-head"><h2><span className="i i-folder" aria-hidden="true" /> Danh mục</h2></div>
          <div className="hm-cats">
            {cats.map((c, i) => (
              <Link key={c.id} href={`/products?category=${c.id}`} className="hm-cat" data-testid="home-category">
                <span className={`tile ${TONES[i % TONES.length]}`}><span className={`i i-${catIcon(c.name, i)}`} aria-hidden="true" /></span>
                <b>{c.name}</b>
                <span className="hm-count">{c.product_count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="hm-sec">
        <div className="hm-sec-head">
          <h2><span className="i i-star" aria-hidden="true" /> Mới về</h2>
          <Link href="/products" className="hm-more">Tất cả <span className="i i-right" aria-hidden="true" /></Link>
        </div>
        {items === null && <div className="ct-grid" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-card" />)}</div>}
        {items !== null && items.length === 0 && <div className="empty"><span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span><strong>Chưa có sản phẩm</strong></div>}
        {items !== null && items.length > 0 && (
          <ul className="ct-grid">
            {items.map((p) => (
              <li key={p.id} className="ct-card">
                <Link href={`/products/${p.id}`} className="ct-card-link" data-testid="home-product">
                  <div className="ct-img">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="i i-image" aria-hidden="true" />}</div>
                  <span className="ct-name">{p.name}</span>
                  <span className="ct-price">{formatPrice(p.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
