'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AddToCart } from '../../../components/AddToCart';
import { StockLabel } from '../../../components/StockLabel';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { formatPrice, formatRating } from '../../../lib/format';
import { fetchStock } from '../../../lib/inventory';
import { rateLimitedText } from '../../../lib/prd';

interface Detail {
  id: string; name: string; sku: string; price: number; description: string | null;
  images: { id: string; url: string }[];
  category: { id: string; name: string; slug?: string; path?: { id: string; name: string }[] } | null;
  rating_avg: number | null; rating_count: number;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Detail | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [stock, setStock] = useState<boolean | undefined>(undefined);
  const [img, setImg] = useState(0);
  const limit = useCountdown();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading'); setStock(undefined); setImg(0);
    // Tồn kho không phụ thuộc PRD: gọi song song, đúng một lần cho mỗi lần mở; lỗi thì không nhãn, không banner.
    void fetchStock([id]).then((m) => { if (n === seq.current) setStock(m?.get(id)); });
    const r = await api<Detail>(`/products/${encodeURIComponent(id)}`);
    if (n !== seq.current) return;
    if (r.status === 200) { setP(r.body); setView('ready'); }
    else if (r.status === 404) setView('notfound'); // draft, archived, không tồn tại, id sai: cùng một giao diện
    else { if (r.status === 429) limit.start(r.retryAfter); setView('error'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (view === 'loading') {
    return (
      <main className="page" data-testid="prd-product-detail-loading" aria-busy="true">
        <div className="ct-detail"><div className="skeleton skeleton-card" style={{ height: '24rem' }} /><div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></div>
      </main>
    );
  }
  if (view === 'notfound') {
    return <main className="page"><div className="empty" data-testid="prd-product-detail-not-found"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không tìm thấy sản phẩm</strong><Link className="btn" href="/products"><span className="i i-left" aria-hidden="true" /> Sản phẩm</Link></div></main>;
  }
  if (view === 'error' || !p) {
    return (
      <main className="page">
        <div role="alert" className="banner banner-error" data-testid="prd-product-detail-error">
          {limit.left > 0 ? rateLimitedText(limit.left) : 'Không tải được sản phẩm.'}{' '}
          <button className="btn" disabled={limit.left > 0} onClick={() => void load()} data-testid="prd-product-detail-retry">Thử lại</button>
        </div>
      </main>
    );
  }

  const rating = formatRating(p.rating_avg, p.rating_count, true);
  const images = Array.isArray(p.images) ? p.images : [];
  const cat = p.category;
  const crumbs = [...(cat?.path ?? []), ...(cat ? [{ id: cat.id, name: cat.name }] : [])];
  return (
    <main className="page">
      <nav aria-label="Đường dẫn" className="ct-crumbs" data-testid="prd-product-detail-breadcrumb">
        <Link href="/products">Sản phẩm</Link>
        {crumbs.map((c) => (
          <span key={c.id}><span className="i i-right" aria-hidden="true" /><Link href={`/products?category=${encodeURIComponent(c.id)}`}>{c.name}</Link></span>
        ))}
        <span><span className="i i-right" aria-hidden="true" /><span aria-current="page">{p.name}</span></span>
      </nav>
      <div className="ct-detail">
        <div>
          <div className="ct-gallery" data-testid="prd-product-detail-gallery">{images[img] ? <img src={images[img].url} alt={p.name} /> : <span className="i i-image" aria-hidden="true" />}</div>
          {images.length > 0 && (
            <div className="ct-thumbs">
              {images.map((im, i) => (
                <button key={im.id} type="button" className={`ct-thumb${i === img ? ' on' : ''}`} aria-label={`Ảnh ${i + 1}`} aria-pressed={i === img} onClick={() => setImg(i)} data-testid="prd-product-detail-thumbnail" data-id={im.id}><img src={im.url} alt="" /></button>
              ))}
            </div>
          )}
        </div>
        <div className="panel ct-info">
          <h1 data-testid="prd-product-detail-name">{p.name}</h1>
          <div className="ct-subline">
            <span className="muted"><span className="i i-tag" aria-hidden="true" /> <span data-testid="prd-product-detail-sku">{p.sku}</span></span>
            {cat && <Link className="ct-chip" href={`/products?category=${encodeURIComponent(cat.id)}`} data-testid="prd-product-detail-category">{cat.name}</Link>}
          </div>
          <p className="ct-bigprice" data-testid="prd-product-detail-price">{formatPrice(p.price)}</p>
          <div className="ct-subline">
            {rating ? <span className="ct-rate" data-testid="prd-product-detail-rating">{rating}</span> : <span className="muted" data-testid="prd-product-detail-rating-empty">Chưa có đánh giá</span>}
            <Link href={`/products/${encodeURIComponent(p.id)}/reviews`}><span className="i i-message" aria-hidden="true" /> Xem đánh giá</Link>
            <StockLabel inStock={stock} testId="prd-product-detail-stock" />
          </div>
          <AddToCart productId={p.id} />
        </div>
      </div>
      {p.description && p.description.trim() !== '' && (
        <section className="panel ct-desc">
          <div className="panel-head"><h2><span className="i i-list" aria-hidden="true" /> Mô tả</h2></div>
          <div className="pre" data-testid="prd-product-detail-description">{p.description}</div>
        </section>
      )}
    </main>
  );
}
