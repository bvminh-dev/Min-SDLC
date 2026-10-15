'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AddToCart } from '../../components/AddToCart';
import { CategoryTree } from '../../components/CategoryTree';
import { Pager } from '../../components/Pager';
import { StockLabel } from '../../components/StockLabel';
import { useCountdown } from '../../components/useCountdown';
import { api } from '../../lib/api';
import { formatPrice, formatRating, parseMoney } from '../../lib/format';
import { fetchStock } from '../../lib/inventory';
import { rateLimitedText, useCategories } from '../../lib/prd';
import { useQueryGo } from '../../components/useQueryGo';

interface Card { id: string; name: string; price: number; image_url: string | null; category: { id: string; name: string } | null; rating_avg: number | null; rating_count: number }
interface Result { items: Card[]; page: number; limit: number; total: number }
const LIMIT = 20;
const SORTS: [string, string][] = [['newest', 'Mới nhất'], ['price_asc', 'Giá tăng'], ['price_desc', 'Giá giảm']];

function ProductList() {
  const router = useRouter();
  const sp = useSearchParams();
  const category = sp.get('category');
  const q = (sp.get('q') ?? '').trim();
  const minPrice = sp.get('min_price') ?? '';
  const maxPrice = sp.get('max_price') ?? '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const rawSort = sp.get('sort') ?? '';
  const sort = !q && rawSort === 'relevance' ? 'newest' : rawSort || (q ? 'relevance' : 'newest'); // có q mà chưa chọn thì gửi relevance
  const filtering = Boolean(category || q || minPrice || maxPrice);

  const cats = useCategories();
  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'rate'>('loading');
  const [stock, setStock] = useState<Map<string, boolean> | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [filters, setFilters] = useState(false);
  const [search, setSearch] = useState(q);
  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);
  const [priceError, setPriceError] = useState('');
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  useEffect(() => { setSearch(q); setMin(minPrice); setMax(maxPrice); setPriceError(''); }, [q, minPrice, maxPrice]);

  const go = useQueryGo('/products'); // cộng dồn các lần đổi liền nhau (REV-REV-12)

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (category) qs.set('category_id', category);
    if (minPrice) qs.set('min_price', minPrice);
    if (maxPrice) qs.set('max_price', maxPrice);
    if (q) qs.set('q', q);
    if (q || sort !== 'relevance') qs.set('sort', sort);
    const r = await api<Result>(`/products${q ? '/search' : ''}?${qs}`);
    if (id !== seq.current) return; // bỏ kết quả cũ
    if (r.status === 200 && Array.isArray(r.body.items)) {
      setData(r.body); setView('ready'); setStock(null);
      // Nhãn tồn kho: một lời gọi theo lô sau khi có danh sách; lỗi thì không nhãn, lưới vẫn đủ.
      void fetchStock(r.body.items.map((c) => c.id)).then((m) => { if (id === seq.current) setStock(m); });
    } else if (r.status === 429) { setView('rate'); limit.start(r.retryAfter); }
    else setView('error');
  }, [page, category, minPrice, maxPrice, q, sort]);
  useEffect(() => { void load(); }, [load]);
  // Hết giờ chờ 429: banner mất, nút mở lại và tải lại danh sách.
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const locked = limit.left > 0;
  const submitSearch = (e: FormEvent) => { e.preventDefault(); if (!locked) go({ q: search.trim().slice(0, 100) || null }); };
  const applyPrice = (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
    const a = min.trim() === '' ? null : parseMoney(min), b = max.trim() === '' ? null : parseMoney(max);
    if ((min.trim() !== '' && a === null) || (max.trim() !== '' && b === null)) { setPriceError('Giá phải là số nguyên không âm'); return; }
    if (a !== null && b !== null && a > b) { setPriceError('Giá từ không được lớn hơn giá đến'); return; }
    setPriceError('');
    go({ min_price: a === null ? null : String(a), max_price: b === null ? null : String(b) });
  };
  const clear = () => router.push('/products', { scroll: false });
  const hrefFor = (id: string | null) => { const n = new URLSearchParams(sp.toString()); n.delete('page'); if (id) n.set('category', id); else n.delete('category'); const s = n.toString(); return s ? `/products?${s}` : '/products'; };
  const catName = category ? cats.items.find((c) => c.id === category)?.name : undefined;
  const title = q ? `Kết quả cho "${q}"` : catName ?? 'Sản phẩm';
  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;

  const ic = (n: string) => <span className={`i i-${n}`} aria-hidden="true" />;
  return (
    <main className="page">
      <div className="page-head">
        <h1>{title}</h1>
        {data && view === 'ready' && <span className="muted small">{data.total} sản phẩm</span>}
      </div>
      <div className="ct-shop">
        <aside className={`ct-side${drawer ? ' open' : ''}`} aria-label="Danh mục">
          <div className="ct-side-head"><h2>{ic('folder')} Danh mục</h2><button type="button" className="btn btn-ghost btn-icon ct-m" aria-label="Đóng" onClick={() => setDrawer(false)}>{ic('x')}</button></div>
          {cats.state === 'loading' && <div className="skeleton" />}
          {cats.state === 'error' && <div role="alert" className="banner banner-error" data-testid="prd-product-list-category-error">Không tải được danh mục. <button className="btn" onClick={() => void cats.reload()}>Thử lại</button></div>}
          {cats.state === 'ready' && cats.items.length === 0 && <p className="hint" data-testid="prd-product-list-category-empty">Chưa có danh mục.</p>}
          {cats.state === 'ready' && cats.items.length > 0 && <CategoryTree items={cats.items} selected={category} hrefFor={hrefFor} onPick={() => setDrawer(false)} />}
        </aside>
        {drawer && <div className="scrim ct-m" onClick={() => setDrawer(false)} />}

        <section className="ct-main">
          <div className="ct-bar">
            <form className="ct-search" role="search" onSubmit={submitSearch}>
              {ic('search')}
              <input type="search" value={search} maxLength={100} placeholder="Tìm tên hoặc mã" aria-label="Tìm sản phẩm" onChange={(e) => setSearch(e.target.value)} data-testid="prd-product-list-search-input" />
              <button className="btn btn-primary tight" disabled={locked} data-testid="prd-product-list-search-submit">Tìm</button>
            </form>
            {/* Dưới md: lọc giá và sắp xếp nằm sau nút "Bộ lọc"; từ md trở lên luôn hiện. */}
            <div className="ct-mbtns ct-m">
              <button type="button" className="btn" onClick={() => setDrawer(true)} aria-expanded={drawer}>{ic('folder')} Danh mục</button>
              <button type="button" className="btn" aria-expanded={filters} aria-controls="shop-filters" onClick={() => setFilters((v) => !v)}>{ic('sliders')} Bộ lọc</button>
            </div>
            <form id="shop-filters" className={`ct-filters${filters ? ' open' : ''}`} onSubmit={applyPrice}>
              <input inputMode="numeric" value={min} placeholder="Giá từ" aria-label="Giá từ" onChange={(e) => setMin(e.target.value)} data-testid="prd-product-list-min-price" />
              <span className="muted ct-dash" aria-hidden="true">–</span>
              <input inputMode="numeric" value={max} placeholder="Giá đến" aria-label="Giá đến" onChange={(e) => setMax(e.target.value)} data-testid="prd-product-list-max-price" />
              <button className="btn tight" disabled={locked} aria-label="Lọc giá" data-testid="prd-product-list-apply-price">{ic('check')} Lọc</button>
              <select value={sort} aria-label="Sắp xếp" disabled={locked} onChange={(e) => go({ sort: e.target.value })} data-testid="prd-product-list-sort">
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {q && <option value="relevance">Liên quan</option>}
              </select>
              {filtering && !(emptyAll) && <button type="button" className="btn btn-ghost tight" onClick={clear} data-testid="prd-product-list-clear-filter">{ic('x')} Xóa lọc</button>}
            </form>
          </div>
          {priceError && <p className="field-error" role="alert">{priceError}</p>}

          {view === 'rate' && locked && <div role="alert" className="banner banner-error" data-testid="prd-product-list-rate-limited">Bạn thao tác quá nhanh, thử lại sau ít giây. <span className="hint">({rateLimitedText(limit.left)})</span></div>}
          {view === 'error' && <div role="alert" className="banner banner-error" data-testid="prd-product-list-error">Không tải được danh sách sản phẩm. <button className="btn" onClick={() => { setView('loading'); void load(); }} data-testid="prd-product-list-retry">Thử lại</button></div>}
          {view === 'loading' && !data && (
            <div className="ct-grid" data-testid="prd-product-list-loading" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton skeleton-card" />)}</div>
          )}
          {emptyAll && (filtering || page > 1
            ? <div className="empty" data-testid="prd-product-list-empty-filtered"><span className="tile tile-lg gray">{ic('search')}</span><strong>Không có kết quả</strong><button type="button" className="btn" onClick={clear} data-testid="prd-product-list-clear-filter">Xóa bộ lọc</button></div>
            : <div className="empty" data-testid="prd-product-list-empty"><span className="tile tile-lg gray">{ic('inbox')}</span><strong>Chưa có sản phẩm</strong></div>)}
          {data && items.length > 0 && view !== 'error' && (
            <>
              <ul className={`ct-grid${view === 'ready' ? '' : ' dim'}`}>
                {items.map((c) => {
                  const rating = formatRating(c.rating_avg, c.rating_count);
                  return (
                    <li key={c.id} className="ct-card">
                      <Link href={`/products/${c.id}`} className="ct-card-link" data-testid="prd-product-list-card" data-id={c.id}>
                        <div className="ct-img" data-testid="prd-product-list-card-image">{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : ic('image')}</div>
                        <span className="ct-name" data-testid="prd-product-list-card-name">{c.name}</span>
                        <span className="ct-price" data-testid="prd-product-list-card-price">{formatPrice(c.price)}</span>
                        <span className="ct-meta"><span className={rating ? 'ct-rate' : 'muted'} data-testid="prd-product-list-card-rating">{rating ?? 'Chưa có đánh giá'}</span></span>
                        <StockLabel inStock={stock?.get(c.id)} testId="prd-product-list-card-stock" />
                      </Link>
                      <AddToCart productId={c.id} compact />
                    </li>
                  );
                })}
              </ul>
              <Pager testPrefix="prd-product-list" page={data.page ?? page} limit={data.limit ?? LIMIT} total={data.total} shown={items.length} onPage={(p) => go({ page: p > 1 ? String(p) : null }, true)} disabled={locked} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ProductsPage() {
  return <Suspense fallback={null}><ProductList /></Suspense>;
}
