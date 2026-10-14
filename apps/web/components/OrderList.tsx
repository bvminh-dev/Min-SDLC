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
    <main className="wide">
      <h1>{admin ? 'Quản lý đơn hàng' : 'Đơn hàng của tôi'}</h1>
      <div className="toolbar">
        <select value={status} aria-label="Trạng thái" onChange={(e) => go({ status: e.target.value || null })} data-testid={`${p}-status-filter`}>
          <option value="">Trạng thái: Tất cả</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
        </select>
        {admin && (
          <input type="search" value={search} maxLength={32} placeholder="Tìm theo mã đơn" aria-label="Tìm theo mã đơn" autoComplete="off"
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ code: search.trim().slice(0, 32) || null })} data-testid={`${p}-search`} />
        )}
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${p}-clear-filter`}>Xoá lọc</button>}
      </div>

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={`${p}-error`}>{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid={`${p}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${p}-error`}>Không tải được danh sách đơn. <button className="btn" onClick={() => void load()} data-testid={`${p}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid={`${p}-loading`} aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div data-testid={`${p}-empty-filtered`}><p>{admin ? 'Không có đơn nào khớp.' : 'Không có đơn nào ở trạng thái này.'}</p><button type="button" className="btn" onClick={clear} data-testid={`${p}-clear-filter`}>Xoá lọc</button></div>
        : <div data-testid={`${p}-empty`}><p className="hint">{admin ? 'Chưa có đơn hàng nào.' : 'Bạn chưa có đơn hàng nào.'}</p>{!admin && <Link href="/products">Tiếp tục mua sắm</Link>}</div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? `${p}-loading` : undefined}>
            <table className="stack-table">
              <thead><tr><th>Mã đơn</th><th>Ngày tạo</th><th>Trạng thái</th>{admin && <th>Thanh toán</th>}<th className="num">Sản phẩm</th><th className="num">Tổng</th></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.code} className="row-click" data-testid={`${p}-row`} data-code={o.code} onClick={() => router.push(`/orders/${o.code}`)}>
                    <td data-label="Mã đơn" className="mono"><Link href={`/orders/${o.code}`} onClick={(e) => e.stopPropagation()} data-testid={`${p}-code`}>{o.code}</Link></td>
                    <td data-label="Ngày tạo" data-testid={`${p}-created-at`}>{formatOrderTime(o.created_at)}</td>
                    <td data-label="Trạng thái"><span className="badge" data-status={o.status} data-testid={`${p}-status-badge`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                    {admin && <td data-label="Thanh toán" data-testid={`${p}-payment`}>{paymentText(o.payment_method, o.payment_status)}</td>}
                    <td data-label="Sản phẩm" className="num" data-testid={`${p}-item-count`}>{o.item_count} sản phẩm</td>
                    <td data-label="Tổng" className="num" data-testid={`${p}-total`}>{formatPrice(o.grand_total)}</td>
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
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><OrderListInner admin={admin} /></Suspense>;
}
