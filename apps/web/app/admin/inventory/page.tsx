'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Pager } from '../../../components/Pager';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useLoginRedirect } from '../../../lib/prd';
import { limitedText, num, type StockItem } from '../../../lib/stock';
import { useQueryGo } from '../../../components/useQueryGo';
import { SkRows } from '../../../components/Skeleton';

interface Result { items: StockItem[]; page: number; limit: number; total: number }
const LIMIT = 20;

function InventoryList() {
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const low = sp.get('tab') === 'low';
  const archived = sp.get('archived') ?? '';
  const sort = sp.get('sort') ?? '';
  const q = (sp.get('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(q || archived || sort);

  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'rate'>('loading');
  const [lowCount, setLowCount] = useState<number | null>(null);
  const [search, setSearch] = useState(q);
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  useEffect(() => { setSearch(q); }, [q]);
  const go = useQueryGo('/admin/inventory'); // cộng dồn các lần đổi liền nhau (REV-REV-12)
  // Gõ rồi chờ 300 ms (hoặc Enter) mới tìm.
  useEffect(() => {
    if (low || search.trim() === q) return;
    const t = setTimeout(() => go({ q: search.trim().slice(0, 100) || null }), 300);
    return () => clearTimeout(t);
  }, [search, q, go, low]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (!low) {
      if (q) qs.set('q', q);
      if (archived) qs.set('archived', archived);
      if (sort) qs.set('sort', sort);
    }
    const r = await api<Result>(`/admin/inventory${low ? '/low-stock' : ''}?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); if (low) setLowCount(r.body.total); }
    else if (expired(r)) return;
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [page, low, q, archived, sort]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  // Hết giờ chờ (429) thì tự tải lại; nút Thử lại cũng dùng được ngay (trạng thái có thời hạn có đường thoát).
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);
  // Số ở tab Tồn thấp: một lần gọi nhẹ khi đang ở tab Tất cả (không chặn màn nếu lỗi).
  useEffect(() => {
    if (low) return;
    void api<Result>('/admin/inventory/low-stock?page=1&limit=1').then((r) => { if (r.status === 200 && typeof r.body.total === 'number') setLowCount(r.body.total); });
  }, [low]);

  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const clear = () => router.push('/admin/inventory', { scroll: false });
  const open = (id: string) => router.push(`/admin/inventory/${id}`);
  // Mức tồn: đầy khi còn bán >= 3 lần ngưỡng.
  const lv = (p: StockItem) => (p.archived ? 'off' : p.available <= 0 ? 'out' : p.is_low_stock ? 'low' : 'ok');
  const pct = (p: StockItem) => (p.low_stock_threshold > 0 ? Math.min(100, Math.round((p.available / (p.low_stock_threshold * 3)) * 100)) : p.available > 0 ? 100 : 0);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Tồn kho</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={!low} className={!low ? 'on' : ''} onClick={() => go({ tab: null, q: null })} data-testid="inv-inventory-list-tab-all">Tất cả</button>
          <button role="tab" aria-selected={low} className={low ? 'on' : ''} onClick={() => go({ tab: 'low', q: null, archived: null, sort: null })} data-testid="inv-inventory-list-tab-low-stock"><span className="i i-alert" aria-hidden="true" /> Sắp hết{lowCount !== null ? ` (${lowCount})` : ''}</button>
        </div>
      </div>
      {!low && (
        <div className="toolbar">
          <div className="ip-search">
            <span className="i i-search" aria-hidden="true" />
            <input type="search" value={search} maxLength={100} placeholder="Tên hoặc SKU" aria-label="Tìm theo tên hoặc sku"
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ q: search.trim().slice(0, 100) || null })} data-testid="inv-inventory-list-search" />
          </div>
          <select value={archived} aria-label="Ngừng bán" onChange={(e) => go({ archived: e.target.value || null })} data-testid="inv-inventory-list-archived-filter">
            <option value="">Mọi trạng thái</option><option value="true">Ngừng bán</option><option value="false">Đang bán</option>
          </select>
          <select value={sort} aria-label="Sắp xếp" onChange={(e) => go({ sort: e.target.value || null })} data-testid="inv-inventory-list-sort">
            <option value="">Mới nhất</option><option value="available_asc">Ít hàng trước</option>
          </select>
          {filtering && !emptyAll && <button type="button" className="btn btn-ghost tight" onClick={clear} data-testid="inv-inventory-list-clear-filter"><span className="i i-x" aria-hidden="true" /> Xoá lọc</button>}
        </div>
      )}

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="inv-inventory-list-error">{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid="inv-inventory-list-retry">Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="inv-inventory-list-error">Không tải được tồn kho. <button className="btn" onClick={() => void load()} data-testid="inv-inventory-list-retry">Thử lại</button></div>}
      {view === 'loading' && !data && <SkRows n={6} lead="square" trail testid="inv-inventory-list-loading" />}
      {emptyAll && (low
        ? <div className="empty panel" data-testid="inv-inventory-list-empty-low-stock"><span className="tile tile-lg green"><span className="i i-okc" aria-hidden="true" /></span><strong>Không có hàng sắp hết</strong></div>
        : filtering || page > 1
          ? <div className="empty panel" data-testid="inv-inventory-list-empty-filtered"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có kết quả</strong><button type="button" className="btn" onClick={clear} data-testid="inv-inventory-list-clear-filter">Xoá lọc</button></div>
          : <div className="empty panel" data-testid="inv-inventory-list-empty"><span className="tile tile-lg gray"><span className="i i-layers" aria-hidden="true" /></span><strong>Chưa có bản ghi kho</strong></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? 'inv-inventory-list-loading' : undefined}>
            <table className="stack-table ip-table">
              <thead><tr><th>Sản phẩm</th><th>Còn bán</th><th className="num">Có</th><th className="num">Giữ</th><th className="num">Ngưỡng</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.product_id} className="row-click" data-testid="inv-inventory-list-row" data-id={p.product_id} onClick={() => open(p.product_id)}>
                    <td data-label="Sản phẩm">
                      <div className="ip-name">
                        <span className={`tile ${p.archived ? 'gray' : p.is_low_stock ? 'amber' : 'green'}`}><span className="i i-box" aria-hidden="true" /></span>
                        <div>
                          <a href={`/admin/inventory/${p.product_id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(p.product_id); }} data-testid="inv-inventory-list-name">{p.product?.name ?? '—'}</a>
                          <span className="ip-badges">
                            {p.is_low_stock && !p.archived && <span className="badge ip-low" data-testid="inv-inventory-list-low-badge">Sắp hết</span>}
                            {p.archived && <span className="badge" data-status="archived" data-testid="inv-inventory-list-archived-badge">Ngừng bán</span>}
                          </span>
                          <small className="mono" data-testid="inv-inventory-list-sku">{p.product?.sku ?? '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Còn bán">
                      <div className="ip-level"><b data-testid="inv-inventory-list-available">{num(p.available)}</b><span className="ip-bar" data-lv={lv(p)} aria-hidden="true"><i style={{ width: `${pct(p)}%` }} /></span></div>
                    </td>
                    <td data-label="Có" className="num" data-testid="inv-inventory-list-on-hand">{num(p.on_hand)}</td>
                    <td data-label="Giữ" className="num" data-testid="inv-inventory-list-reserved">{num(p.reserved)}</td>
                    <td data-label="Ngưỡng" className="num muted" data-testid="inv-inventory-list-threshold">{num(p.low_stock_threshold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix="inv-inventory-list" page={data.page ?? page} limit={data.limit ?? LIMIT} total={data.total} shown={items.length} onPage={(p) => go({ page: p > 1 ? String(p) : null }, true)} />
        </>
      )}
    </main>
  );
}

export default function InventoryListPage() {
  return <RequireRole roles={['staff', 'admin']}><Suspense fallback={null}><InventoryList /></Suspense></RequireRole>;
}
