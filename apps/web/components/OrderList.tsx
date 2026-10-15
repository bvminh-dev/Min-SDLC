'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { ORDER_STATUS_LABEL, STATUS_ORDER, formatOrderTime, paymentText, type OrderRow, type OrderStatus } from '../lib/order';
import { useLoginRedirect } from '../lib/prd';
import { limitedText } from '../lib/stock';
import { Pager } from './Pager';
import { useCountdown } from './useCountdown';
import { useQueryGo } from './useQueryGo';

interface Result { items: OrderRow[]; page: number; limit: number; total: number }
const LIMIT = 20;

/**
 * Danh sách đơn dùng chung màn của customer (`order-list`) và của staff, admin (`order-admin-list`): khác nhau ở khóa test, ô tìm theo mã đơn, cột thanh toán.
 * Bộ lọc và trang nằm trên URL (`?status=&code=&page=`); tải lại là gọi lại API (không bộ nhớ đệm); trạng thái 429 có đường thoát (tự tải lại khi hết `Retry-After`, nút Thử lại bấm được ngay).
 */
function OrderListInner({ admin }: { admin: boolean }) {
  const p = admin ? 'ord-order-admin-list' : 'ord-order-list';
  const base = admin ? '/admin/orders' : '/orders';
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = (sp.get('status') ?? '') as OrderStatus | '';
  const code = admin ? (sp.get('code') ?? '').trim() : '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || code);

  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'rate'>('loading');
  const [search, setSearch] = useState(code);
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  useEffect(() => { setSearch(code); }, [code]);
  const go = useQueryGo(base); // cộng dồn các lần đổi liền nhau (REV-REV-12)
  // Gõ rồi chờ 300 ms (hoặc Enter) mới tìm; mã đơn chữ hoa, tối đa 32 ký tự (khớp schema của API).
  useEffect(() => {
    if (!admin || search.trim() === code) return;
    const t = setTimeout(() => go({ code: search.trim().slice(0, 32) || null }), 300);
    return () => clearTimeout(t);
  }, [search, code, go, admin]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (code) qs.set('code', code);
    const r = await api<Result>(`${admin ? '/admin/orders' : '/orders'}?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [page, status, code, admin]); // expired, limit đổi mỗi lần render nên không đưa vào deps
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
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ code: search.trim().slice(0, 32) || null })} data-testid={`${p}-search`} />
          </div>
        )}
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet btn-sm tight" onClick={clear} data-testid={`${p}-clear-filter`}><span className="i i-x" aria-hidden="true" />Xoá lọc</button>}
      </div>

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={`${p}-error`}>{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid={`${p}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${p}-error`}>Không tải được đơn. <button className="btn" onClick={() => void load()} data-testid={`${p}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid={`${p}-loading`} aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div className="empty" data-testid={`${p}-empty-filtered`}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có đơn khớp</strong><button type="button" className="btn" onClick={clear} data-testid={`${p}-clear-filter`}>Xoá lọc</button></div>
        : <div className="empty" data-testid={`${p}-empty`}><span className="tile tile-lg gray"><span className="i i-receipt" aria-hidden="true" /></span><strong>Chưa có đơn</strong>{!admin && <Link className="btn btn-primary tight" href="/products">Mua sắm</Link>}</div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? `${p}-loading` : undefined}>
            <table className="stack-table ord-table">
              <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Trạng thái</th>{admin && <th>Thanh toán</th>}<th className="num">SP</th><th className="num">Tổng</th></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.code} className="row-click" data-testid={`${p}-row`} data-code={o.code} onClick={() => router.push(`/orders/${o.code}`)}>
                    <td data-label="Mã đơn" className="mono ord-code ord-c1"><Link href={`/orders/${o.code}`} onClick={(e) => e.stopPropagation()} data-testid={`${p}-code`}>{o.code}</Link></td>
                    <td data-label="Ngày" className="muted" data-testid={`${p}-created-at`}>{formatOrderTime(o.created_at)}</td>
                    <td data-label="Trạng thái"><span className="badge" data-status={o.status} data-testid={`${p}-status-badge`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                    {admin && <td data-label="Thanh toán" data-testid={`${p}-payment`}><span className="badge" data-status={`pay-${o.payment_status}`}>{paymentText(o.payment_method, o.payment_status)}</span></td>}
                    <td data-label="SP" className="num" data-testid={`${p}-item-count`} aria-label={`${o.item_count} sản phẩm`}><span className="ord-count"><span className="i i-box" aria-hidden="true" />{o.item_count}</span></td>
                    <td data-label="Tổng" className="num money ord-c2" data-testid={`${p}-total`}>{formatPrice(o.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix={p} page={page} limit={LIMIT} total={data.total} shown={items.length} unit="đơn" disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}
    </main>
  );
}

export function OrderList({ admin }: { admin: boolean }) {
  return <Suspense fallback={<main className="page"><div aria-busy="true"><div className="skeleton" /></div></main>}><OrderListInner admin={admin} /></Suspense>;
}
