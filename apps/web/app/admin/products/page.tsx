'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Pager } from '../../../components/Pager';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, formatPrice, STATUS_LABEL, type ProductStatus } from '../../../lib/format';
import { flattenTree, rateLimitedText, useCategories, useLoginRedirect } from '../../../lib/prd';

interface Row { id: string; name: string; sku: string; price: number; status: ProductStatus; category: { id: string; name: string } | null; updated_at: string }
interface Result { items: Row[]; page: number; limit: number; total: number }
const LIMIT = 20;
const STATUSES: [string, string][] = [['', 'Tất cả'], ['draft', 'Nháp'], ['active', 'Đang bán'], ['archived', 'Đã lưu trữ']];

function ProductAdminList() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();
  const expired = useLoginRedirect();
  const status = sp.get('status') ?? '';
  const category = sp.get('category_id') ?? '';
  const q = (sp.get('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || category || q);

  const cats = useCategories();
  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'rate'>('loading');
  const [search, setSearch] = useState(q);
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  useEffect(() => { setSearch(q); }, [q]);
  const go = useCallback((change: Record<string, string | null>, keepPage = false) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(change)) { if (v) n.set(k, v); else n.delete(k); }
    if (!keepPage) n.delete('page');
    const s = n.toString();
    router.push(s ? `/admin/products?${s}` : '/admin/products', { scroll: false });
  }, [sp, router]);
  // Gõ rồi chờ 300 ms (hoặc Enter) mới tìm.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => go({ q: search.trim().slice(0, 100) || null }), 300);
    return () => clearTimeout(t);
  }, [search, q, go]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (category) qs.set('category_id', category);
    if (q) qs.set('q', q);
    const r = await api<Result>(`/admin/products?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 403) { setData(null); setView('forbidden'); }
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [page, status, category, q]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const isAdmin = user?.role === 'admin';
  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const create = <Link className="btn btn-primary tight" href="/admin/products/new" data-testid="prd-admin-product-list-create">+ Tạo sản phẩm</Link>;
  const clear = () => router.push('/admin/products', { scroll: false });
  const open = (id: string) => router.push(`/admin/products/${id}`);

  return (
    <main className="wide">
      <div className="between">
        <h1>Sản phẩm</h1>
        {isAdmin && !(emptyAll && !filtering && page === 1) && create}
      </div>
      <div className="toolbar">
        <select value={status} aria-label="Trạng thái" onChange={(e) => go({ status: e.target.value || null })} data-testid="prd-admin-product-list-status-filter">
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={category} aria-label="Danh mục" onChange={(e) => go({ category_id: e.target.value || null })} data-testid="prd-admin-product-list-category-filter">
          <option value="">Mọi danh mục</option>
          {flattenTree(cats.items).map((c) => <option key={c.id} value={c.id} style={{ paddingLeft: c.depth * 14 }}>{c.name}</option>)}
        </select>
        <input type="search" value={search} maxLength={100} placeholder="Tìm tên hoặc mã sku" aria-label="Tìm sản phẩm"
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ q: search.trim().slice(0, 100) || null })} data-testid="prd-admin-product-list-search" />
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid="prd-admin-product-list-clear-filter">Xóa bộ lọc</button>}
      </div>

      {view === 'forbidden' && <div role="alert" className="banner banner-error" data-testid="prd-admin-product-list-error">Bạn không có quyền xem trang này.</div>}
      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="prd-admin-product-list-error">{rateLimitedText(limit.left)}</div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="prd-admin-product-list-error">Không tải được danh sách sản phẩm. <button className="btn" onClick={() => void load()} data-testid="prd-admin-product-list-retry">Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid="prd-admin-product-list-loading" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div data-testid="prd-admin-product-list-empty-filtered"><p>Không có sản phẩm phù hợp.</p><button type="button" className="btn" onClick={clear} data-testid="prd-admin-product-list-clear-filter">Xóa bộ lọc</button></div>
        : <div data-testid="prd-admin-product-list-empty"><p>Chưa có sản phẩm nào.</p>{isAdmin && create}</div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`table-wrap${view === 'ready' ? '' : ' dim'}`}>
            <table className="stack-table">
              <thead><tr><th>Mã</th><th>Tên</th><th>Danh mục</th><th>Giá</th><th>Trạng thái</th><th>Cập nhật</th><th>Mở</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="row-click" data-testid="prd-admin-product-list-row" data-id={p.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) open(p.id); }}>
                    <td data-label="Mã" data-testid="prd-admin-product-list-sku">{p.sku}</td>
                    <td data-label="Tên" data-testid="prd-admin-product-list-name">{p.name}</td>
                    <td data-label="Danh mục">{p.category?.name ?? ''}</td>
                    <td data-label="Giá" data-testid="prd-admin-product-list-price">{formatPrice(p.price)}</td>
                    <td data-label="Trạng thái"><span className="badge" data-status={p.status} data-testid="prd-admin-product-list-status-badge">{STATUS_LABEL[p.status] ?? p.status}</span></td>
                    <td data-label="Cập nhật" data-testid="prd-admin-product-list-updated-at">{formatDateTime(p.updated_at)}</td>
                    <td><Link href={`/admin/products/${p.id}`}>{isAdmin ? 'Sửa' : 'Xem'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix="prd-admin-product-list" page={data.page ?? page} limit={data.limit ?? LIMIT} total={data.total} shown={items.length} onPage={(p) => go({ page: p > 1 ? String(p) : null }, true)} />
        </>
      )}
    </main>
  );
}

export default function AdminProductsPage() {
  return <RequireRole roles={['staff', 'admin']}><Suspense fallback={null}><ProductAdminList /></Suspense></RequireRole>;
}
