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
      <main className="wide" data-testid="prd-product-detail-loading" aria-busy="true">
        <div className="detail"><div className="skeleton skeleton-card" /><div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></div>
        <div className="skeleton" style={{ height: '6rem' }} />
      </main>
    );
  }
  if (view === 'notfound') {
    return <main className="wide"><div data-testid="prd-product-detail-not-found"><p>Không tìm thấy sản phẩm.</p><Link href="/products">Về danh sách sản phẩm</Link></div></main>;
  }
  if (view === 'error' || !p) {
    return (
      <main className="wide">
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
  return (
    <main className="wide">
      <nav aria-label="Đường dẫn" className="crumbs" data-testid="prd-product-detail-breadcrumb">
        {[...(cat?.path ?? []), ...(cat ? [{ id: cat.id, name: cat.name }] : [])].map((c) => (
          <span key={c.id}><Link href={`/products?category=${encodeURIComponent(c.id)}`}>{c.name}</Link> › </span>
        ))}
        <span aria-current="page">{p.name}</span>
      </nav>
      <div className="detail">
        <div>
          <div className="gallery" data-testid="prd-product-detail-gallery">{images[img] ? <img src={images[img].url} alt={p.name} /> : null}</div>
          {images.length > 0 && (
            <div className="thumbs">
              {images.map((im, i) => (
                <button key={im.id} type="button" className={`thumb${i === img ? ' thumb-on' : ''}`} aria-label={`Ảnh ${i + 1}`} aria-pressed={i === img} onClick={() => setImg(i)} data-testid="prd-product-detail-thumbnail" data-id={im.id}><img src={im.url} alt="" /></button>
              ))}
            </div>
          )}
        </div>
        <div>
          <h1 data-testid="prd-product-detail-name">{p.name}</h1>
          <p className="hint">Mã: <span data-testid="prd-product-detail-sku">{p.sku}</span></p>
          <p className="price" data-testid="prd-product-detail-price">{formatPrice(p.price)}</p>
          <div className="rating-line">
            {rating ? <p data-testid="prd-product-detail-rating">{rating}</p> : <p className="hint" data-testid="prd-product-detail-rating-empty">Chưa có đánh giá</p>}
            <Link href={`/products/${encodeURIComponent(p.id)}/reviews`}>Xem đánh giá</Link>
          </div>
          <p><StockLabel inStock={stock} testId="prd-product-detail-stock" /></p>
          <AddToCart productId={p.id} />
          {cat && <p>Danh mục: <Link href={`/products?category=${encodeURIComponent(cat.id)}`} data-testid="prd-product-detail-category">{cat.name}</Link></p>}
        </div>
      </div>
      {p.description && p.description.trim() !== '' && (
        <section>
          <h2>Mô tả</h2>
          <div className="pre" data-testid="prd-product-detail-description">{p.description}</div>
        </section>
      )}
    </main>
  );
}
