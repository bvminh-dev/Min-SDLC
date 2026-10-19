'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatPrice } from '../lib/format';
import { ORDER_STATUS_LABEL, STATUS_ORDER, formatOrderTime, paymentText, type OrderStatus } from '../lib/order';
import type { SaleOrderRow, SaleSource } from '../lib/sales';
import { limitedText } from '../lib/stock';
import { Pager } from './Pager';
import { useCountdown } from './useCountdown';
import { useQueryGo } from './useQueryGo';
import { SkRows } from './Skeleton';

const P = 'sal-sale-order-list';
const LIMIT = 20;
const ic = (n: string) => <span className={`i i-${n}`} aria-hidden="true" />;
const PAY_ICON: Record<string, string> = { cod: 'box', cash: 'cash', bank_transfer: 'bank', vnpay: 'card' };
interface Result { items: SaleOrderRow[]; page: number; limit: number; total: number }

/**
 * Đơn của tôi (ui/sale-order-list, SAL-REQ-20261015-092711222): sale thấy đơn mình tạo, admin thấy mọi đơn hộ kèm cột Người tạo và ô lọc người tạo. Bộ lọc và trang nằm trên URL
 * (`?status=&source=&code=&created_by=&page=`); sale không bao giờ gửi `created_by` (server trả 400). Tìm mã đơn của người khác, đơn khách tự đặt hay mã không tồn tại cùng ra danh sách rỗng (SB-44).
 * Tên khách, nguồn, người tạo là văn bản thuần, React escape. 429 có đường thoát (tự tải lại khi hết `Retry-After`, nút Thử lại bấm được ngay).
 */
function SaleOrderListInner() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const router = useRouter();
  const sp = useSearchParams();
  const status = (sp.get('status') ?? '') as OrderStatus | '';
  const code = (sp.get('code') ?? '').trim();
  const source = sp.get('source') ?? '';
  const creator = admin ? (sp.get('created_by') ?? '') : '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || code || source || creator);

  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'rate' | 'login'>('loading');
  const [search, setSearch] = useState(code);
  const [sources, setSources] = useState<Map<string, string>>(new Map()); // mã nguồn -> tên: danh mục đang bật cộng nguồn đã thấy trong kết quả (nguồn đã tắt vẫn lọc được)
  const [creators, setCreators] = useState<Map<string, string>>(new Map()); // người tạo gom từ các đơn đã tải; không có endpoint liệt kê sale ở v1
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);
  const go = useQueryGo('/sales/orders');

  useEffect(() => { setSearch(code); }, [code]);
  useEffect(() => { // gõ rồi chờ 300 ms (hoặc Enter) mới tìm; mã đơn chữ hoa, tối đa 32 ký tự
    if (search.trim().toUpperCase() === code) return;
    const timer = setTimeout(() => go({ code: search.trim().toUpperCase().slice(0, 32) || null }), 300);
    return () => clearTimeout(timer);
  }, [search, code, go]);
  useEffect(() => {
    void (async () => {
      const r = await api<{ items: SaleSource[] }>('/order-sources');
      if (r.status === 200 && Array.isArray(r.body.items)) setSources((m) => { const n = new Map(m); for (const o of r.body.items) n.set(o.code, o.name); return n; });
    })();
  }, []);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (code) qs.set('code', code);
    if (source) qs.set('source', source);
    if (creator) qs.set('created_by', creator);
    const r = await api<Result>(`/sales/orders?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) {
      setData(r.body); setView('ready');
      setSources((m) => { const n = new Map(m); for (const o of r.body.items) n.set(o.source.code, o.source.name); return n; });
      setCreators((m) => { const n = new Map(m); for (const o of r.body.items) if (o.created_by?.id) n.set(o.created_by.id, o.created_by.name ?? 'Không rõ'); return n; });
    } else if (r.status === 401) setView('login');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error'); // 400 (bộ lọc không hợp lệ) cũng vào đây
  }, [page, status, code, source, creator]); // limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const clear = () => router.push('/sales/orders', { scroll: false });

  return (
    <main className="page">
      <div className="page-head"><h1>Đơn của tôi</h1><div className="actions"><Link className="btn btn-primary tight" href="/sales/orders/new" data-testid={`${P}-new`}>Tạo đơn hộ</Link></div></div>
      <div className="ord-bar sal-bar">
        <div className="seg" role="group" aria-label="Trạng thái" data-testid={`${P}-status-filter`}>
          <button type="button" aria-pressed={status === ''} onClick={() => go({ status: null })}>Tất cả</button>
          {STATUS_ORDER.map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => go({ status: s })}>{ORDER_STATUS_LABEL[s]}</button>)}
        </div>
        <div className="ord-search">
          <span className="i i-search" aria-hidden="true" />
          <input type="search" value={search} maxLength={32} placeholder="Mã đơn" aria-label="Tìm theo mã đơn" autoComplete="off" onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go({ code: search.trim().toUpperCase().slice(0, 32) || null })} data-testid={`${P}-search`} />
        </div>
        <label className="ord-filter">{ic('tag')}Nguồn
          <select value={source} onChange={(e) => go({ source: e.target.value || null })} data-testid={`${P}-source-filter`}>
            <option value="">Tất cả</option>
            {[...sources].map(([c, name]) => <option key={c} value={c}>{name}</option>)}
            {source && !sources.has(source) && <option value={source}>{source}</option>}
          </select>
        </label>
        {admin && (
          <label className="ord-filter">{ic('user')}Người tạo
            <select value={creator} onChange={(e) => go({ created_by: e.target.value || null })} data-testid={`${P}-created-by-filter`}>
              <option value="">Tất cả</option>
              {[...creators].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              {creator && !creators.has(creator) && <option value={creator}>Người tạo đã chọn</option>}
            </select>
          </label>
        )}
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet btn-sm tight sal-clear" onClick={clear} data-testid={`${P}-clear-filter`}>{ic('x')}Xoá lọc</button>}
      </div>

      {view === 'login' && <div role="alert" className="banner banner-error" data-testid={`${P}-login-expired`}>Phiên đăng nhập đã hết hạn. <Link href="/login?next=%2Fsales%2Forders&reason=expired">Đăng nhập</Link></div>}
      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={`${P}-rate-limited`}>Thao tác quá nhanh, tự tải lại sau {limit.left} giây. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được danh sách đơn. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <SkRows n={5} lead="square" lines={3} trail testid={`${P}-loading`} />}
      {emptyAll && (filtering || page > 1
        ? <div className="empty panel" data-testid={`${P}-empty-filtered`}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có đơn nào khớp.</strong><button type="button" className="btn" onClick={clear} data-testid={`${P}-clear-filter`}>Xoá lọc</button></div>
        : <div className="empty panel" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-receipt" aria-hidden="true" /></span><strong>{admin ? 'Chưa có đơn hộ nào.' : 'Bạn chưa tạo đơn hộ nào.'}</strong><Link className="btn btn-primary tight" href="/sales/orders/new">{ic('plus')}Tạo đơn hộ</Link></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? `${P}-loading` : undefined}>
            <table className="stack-table ord-table">
              <thead><tr><th>Mã đơn</th><th>Ngày tạo</th><th>Khách</th><th>Nguồn</th>{admin && <th>Người tạo</th>}<th>Trạng thái</th><th>Thanh toán</th><th className="num">Tổng</th></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.code} className="row-click" data-testid={`${P}-row`} data-code={o.code} onClick={() => router.push(`/sales/orders/${o.code}`)}>
                    <td data-label="Mã đơn" className="mono ord-code ord-c1"><Link href={`/sales/orders/${o.code}`} onClick={(e) => e.stopPropagation()} data-testid={`${P}-code`}>{o.code}</Link><span className="sal-sub-line">{o.items_count} sản phẩm</span></td>
                    <td data-label="Ngày tạo" className="muted" data-testid={`${P}-created-at`}>{formatOrderTime(o.created_at)}</td>
                    <td data-label="Khách" data-testid={`${P}-customer`}><span className="sal-who">{o.customer.name}</span> <span className="muted sal-sub-line">{o.customer.phone}</span></td>
                    <td data-label="Nguồn" data-testid={`${P}-source`}>{ic('tag')} {o.source.name}</td>
                    {admin && <td data-label="Người tạo" className="muted" data-testid={`${P}-created-by`}>{o.created_by?.name ?? '—'}</td>}
                    <td data-label="Trạng thái"><span className="badge" data-status={o.status} data-testid={`${P}-status-badge`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                    <td data-label="Thanh toán" data-testid={`${P}-payment`}>{ic(PAY_ICON[o.payment_method] ?? 'card')} {paymentText(o.payment_method, o.payment_status)}</td>
                    <td data-label="Tổng" className="num money ord-c2" data-testid={`${P}-total`}>{formatPrice(o.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix={P} page={page} limit={LIMIT} total={data.total} shown={items.length} unit="đơn" summary={(a, b, n) => `${a} tới ${b} trong ${n} đơn`} disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}
      {view === 'rate' && limit.left === 0 && <p className="hint">{limitedText(limit.left)}</p>}
    </main>
  );
}

export function SaleOrderList() {
  return <Suspense fallback={<main className="page"><SkRows n={4} lead={false} /></main>}><SaleOrderListInner /></Suspense>;
}
