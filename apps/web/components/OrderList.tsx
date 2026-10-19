'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatPrice } from '../lib/format';
import { ORDER_STATUS_LABEL, STATUS_ORDER, formatOrderTime, paymentText, type OrderRow, type OrderStatus, type SourceOption } from '../lib/order';
import { useLoginRedirect } from '../lib/prd';
import { limitedText } from '../lib/stock';
import { Pager } from './Pager';
import { useCountdown } from './useCountdown';
import { useQueryGo } from './useQueryGo';

interface Result { items: OrderRow[]; page: number; limit: number; total: number }
const LIMIT = 20;

/** Khóa test của phần dùng chung giữa hai tài liệu `order-admin-list` và `order-list-source` (một trang `/admin/orders`): trang quản trị dùng khóa `order-list-source` (E2E đã duyệt), customer giữ khóa `order-list`. */
const SHARED = {
  admin: { row: 'ord-order-list-source-row', code: 'ord-order-list-source-code', clear: 'ord-order-list-source-clear', error: 'ord-order-list-source-error', retry: 'ord-order-list-source-retry', loading: 'ord-order-list-source-loading', emptyFiltered: 'ord-order-list-source-empty', empty: 'ord-order-admin-list-empty', search: 'ord-order-list-source-search', pager: 'ord-order-list-source' },
  mine: { row: 'ord-order-list-row', code: 'ord-order-list-code', clear: 'ord-order-list-clear-filter', error: 'ord-order-list-error', retry: 'ord-order-list-retry', loading: 'ord-order-list-loading', emptyFiltered: 'ord-order-list-empty-filtered', empty: 'ord-order-list-empty', search: 'ord-order-list-search', pager: 'ord-order-list' },
} as const;

/**
 * Danh sách đơn dùng chung màn của customer (`order-list`) và của staff, sale, admin (`order-admin-list` cộng `order-list-source`): khác nhau ở khóa test, ô tìm theo mã đơn, cột thanh toán, nguồn, người tạo.
 * Bộ lọc và trang nằm trên URL (`?status=&code=&source=&created_by=&page=`); tải lại là gọi lại API (không bộ nhớ đệm); trạng thái 429 có đường thoát (tự tải lại khi hết `Retry-After`, nút Thử lại bấm được ngay).
 * Sale chỉ thấy đơn của mình (server giới hạn, kể cả `total`), không có ô Người tạo; staff và admin lọc theo nguồn (kể cả nguồn đã tắt) và người tạo. Tên nguồn và người tạo là văn bản thuần, React escape.
 */
function OrderListInner({ admin }: { admin: boolean }) {
  const T = admin ? SHARED.admin : SHARED.mine;
  const p = admin ? 'ord-order-admin-list' : 'ord-order-list';
  const base = admin ? '/admin/orders' : '/orders';
  const { user } = useAuth();
  const sale = admin && user?.role === 'sale';
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = (sp.get('status') ?? '') as OrderStatus | '';
  const code = admin ? (sp.get('code') ?? '').trim() : '';
  const source = admin ? (sp.get('source') ?? '') : '';
  const creator = admin && !sale ? (sp.get('created_by') ?? '') : '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || code || source || creator);

  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'rate'>('loading');
  const [search, setSearch] = useState(code);
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);
  const [sources, setSources] = useState<SourceOption[] | null>(null); // danh mục nguồn cho ô lọc; null khi đang tải hay lỗi
  const [sourcesErr, setSourcesErr] = useState(false);
  const [creators, setCreators] = useState<Map<string, string>>(new Map()); // người tạo gom từ các đơn đã tải (id -> tên); không có API riêng

  useEffect(() => { setSearch(code); }, [code]);
  const go = useQueryGo(base); // cộng dồn các lần đổi liền nhau (REV-REV-12)
  // Gõ rồi chờ 300 ms (hoặc Enter) mới tìm; mã đơn chữ hoa, tối đa 32 ký tự (khớp schema của API).
  useEffect(() => {
    if (!admin || search.trim() === code) return;
    const t = setTimeout(() => go({ code: search.trim().slice(0, 32) || null }), 300);
    return () => clearTimeout(t);
  }, [search, code, go, admin]);

  // Danh mục nguồn cho ô lọc: staff, admin lấy cả nguồn đã tắt (lọc đơn cũ), sale chỉ nguồn đang bật (include_inactive là 400 với sale). Lỗi chỉ làm hỏng ô Nguồn, danh sách đơn vẫn dùng được.
  const loadSources = useCallback(async () => {
    setSourcesErr(false);
    const r = await api<{ items: SourceOption[] }>(user?.role === 'sale' ? '/order-sources' : '/order-sources?include_inactive=true');
    if (r.status === 200 && Array.isArray(r.body.items)) setSources(r.body.items); else if (!expired(r)) setSourcesErr(true);
  }, [user?.role]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { if (admin && user) void loadSources(); }, [admin, user, loadSources]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (code) qs.set('code', code);
    if (source) qs.set('source', source);
    if (creator) qs.set('created_by', creator);
    const r = await api<Result>(`${admin ? '/admin/orders' : '/orders'}?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) {
      setData(r.body); setView('ready');
      if (admin) setCreators((m) => { const n = new Map(m); for (const o of r.body.items) if (o.created_by && o.created_by_name) n.set(o.created_by, o.created_by_name); return n; });
    }
    else if (expired(r)) return;
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [page, status, code, source, creator, admin]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const clear = () => router.push(base, { scroll: false });

  return (
    <main className="page">
      <div className="page-head"><h1>{admin ? 'Đơn hàng' : 'Đơn của tôi'}</h1></div>
      <div className="ord-bar">
        <div className="seg" role="group" aria-label="Trạng thái" data-testid={`${p}-status-filter`}>
          <button type="button" aria-pressed={status === ''} onClick={() => go({ status: null })}>Tất cả</button>
          {STATUS_ORDER.map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => go({ status: s })}>{ORDER_STATUS_LABEL[s]}</button>)}
        </div>
        {admin && (
          <div className="ord-search">
            <span className="i i-search" aria-hidden="true" />
            <input type="search" value={search} maxLength={32} placeholder="Mã đơn" aria-label="Tìm theo mã đơn" autoComplete="off"
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ code: search.trim().slice(0, 32) || null })} data-testid={T.search} />
          </div>
        )}
        {admin && (sourcesErr
          ? <span role="alert" className="field-error" data-testid="ord-order-list-source-filter-error">Không tải được danh sách nguồn <button type="button" className="btn btn-quiet btn-sm tight" onClick={() => void loadSources()}>Thử lại</button></span>
          : (
            <label className="ord-filter">Nguồn
              <select value={source} disabled={!sources} aria-busy={!sources} data-testid={sale ? 'ord-order-list-source-filter-source-sale' : 'ord-order-list-source-filter-source'} onChange={(e) => go({ source: e.target.value || null })}>
                <option value="">Tất cả</option>
                {sources?.map((o) => <option key={o.code} value={o.code}>{o.is_active ? o.name : `${o.name} (đã tắt)`}</option>)}
                {source && sources && !sources.some((o) => o.code === source) && <option value={source}>{source}</option>}
              </select>
            </label>
          ))}
        {admin && !sale && (
          <label className="ord-filter">Người tạo
            <select value={creator} data-testid="ord-order-list-source-filter-creator" onChange={(e) => go({ created_by: e.target.value || null })}>
              <option value="">Tất cả</option>
              {[...creators].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              {creator && !creators.has(creator) && <option value={creator}>Người tạo đã chọn</option>}
            </select>
          </label>
        )}
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet btn-sm tight" onClick={clear} data-testid={T.clear}><span className="i i-x" aria-hidden="true" />Xoá lọc</button>}
      </div>
      {sale && <p className="muted small" data-testid="ord-order-list-source-scope-note">Đang xem: đơn do bạn tạo</p>}

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={T.error}>{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid={T.retry}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={T.error}>{admin ? 'Không tải được danh sách đơn.' : 'Không tải được đơn.'} <button className="btn" onClick={() => void load()} data-testid={T.retry}>Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid={T.loading} aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div className="empty" data-testid={T.emptyFiltered}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>{admin ? 'Không có đơn nào khớp.' : 'Không có đơn khớp'}</strong><button type="button" className="btn" onClick={clear} data-testid={T.clear}>Xoá lọc</button></div>
        : <div className="empty" data-testid={T.empty}><span className="tile tile-lg gray"><span className="i i-receipt" aria-hidden="true" /></span><strong>Chưa có đơn</strong>{!admin && <Link className="btn btn-primary tight" href="/products">Mua sắm</Link>}</div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? T.loading : undefined}>
            <table className="stack-table ord-table">
              <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Trạng thái</th>{admin && <th>Thanh toán</th>}{admin && <th>Nguồn</th>}{admin && <th>Người tạo</th>}<th className="num">SP</th><th className="num">Tổng</th></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.code} className="row-click" data-testid={T.row} data-code={o.code} onClick={() => router.push(`/orders/${o.code}`)}>
                    <td data-label="Mã đơn" className="mono ord-code ord-c1"><Link href={`/orders/${o.code}`} onClick={(e) => e.stopPropagation()} data-testid={T.code}>{o.code}</Link></td>
                    <td data-label="Ngày" className="muted" data-testid={`${p}-created-at`}>{formatOrderTime(o.created_at)}</td>
                    <td data-label="Trạng thái"><span className="badge" data-status={o.status} data-testid={`${p}-status-badge`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                    {admin && <td data-label="Thanh toán" data-testid={`${p}-payment`}><span className="badge" data-status={`pay-${o.payment_status}`}>{paymentText(o.payment_method, o.payment_status)}</span></td>}
                    {admin && <td data-label="Nguồn" data-testid="ord-order-list-source-cell">{o.source?.name ?? '—'}</td>}
                    {admin && <td data-label="Người tạo" className="muted" data-testid="ord-order-list-source-creator-cell">{o.created_by_name ?? '—'}</td>}
                    <td data-label="SP" className="num" data-testid={`${p}-item-count`} aria-label={`${o.item_count} sản phẩm`}><span className="ord-count"><span className="i i-box" aria-hidden="true" />{o.item_count}</span></td>
                    <td data-label="Tổng" className="num money ord-c2" data-testid={`${p}-total`}>{formatPrice(o.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix={T.pager} page={page} limit={LIMIT} total={data.total} shown={items.length} unit="đơn" summary={(a, b, n) => `${a} tới ${b} trong ${n} đơn`} disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}
    </main>
  );
}

export function OrderList({ admin }: { admin: boolean }) {
  return <Suspense fallback={<main className="page"><div aria-busy="true"><div className="skeleton" /></div></main>}><OrderListInner admin={admin} /></Suspense>;
}
