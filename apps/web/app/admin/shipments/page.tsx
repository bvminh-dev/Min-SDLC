'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Forbidden, ShipmentBadge } from '../../../components/ShipmentParts';
import { Pager } from '../../../components/Pager';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatOrderTime } from '../../../lib/order';
import { useLoginRedirect } from '../../../lib/prd';
import { SHIPMENT_STATUSES, TRACKING_RE, detailHref, shipmentStatusText, type ShipmentRow, type ShipmentStatus } from '../../../lib/shipping';
import { limitedText } from '../../../lib/stock';

interface Result { items: ShipmentRow[]; page: number; limit: number; total: number }
const LIMIT = 20;
const P = 'shp-shipment-admin-list';

/**
 * Vận đơn (ui/shipment-admin-list): staff và admin xem hàng đợi, lọc theo trạng thái, tìm khớp chính xác theo mã đơn hoặc mã vận đơn, sắp xếp, phân trang 20.
 * Bộ lọc nằm trên URL (`?status=&by=&q=&sort=&page=`) để từ chi tiết quay lại vẫn giữ; 429 có đếm ngược và tự tải lại khi hết giờ chờ.
 */
function ShipmentListInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = SHIPMENT_STATUSES.find((s) => s === sp.get('status')) ?? '';
  const by = sp.get('by') === 'tracking_number' ? 'tracking_number' : 'order_code';
  const q = (sp.get('q') ?? '').trim();
  const sort = sp.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || q);

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
    router.push(s ? `/admin/shipments?${s}` : '/admin/shipments', { scroll: false });
  }, [sp, router]);
  // Gõ rồi chờ 300 ms (hoặc Enter) mới tìm; khớp chính xác nên không cắt giá trị người nhập ngoài giới hạn 32 ký tự của API.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => go({ q: search.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [search, q, go]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    // Tìm theo mã vận đơn đang gõ dở (chưa đủ 8 ký tự): API chỉ nhận đúng khuôn nên sẽ 400 và hiện banner lỗi; không có mã nào khớp nên hiện trạng thái rỗng, không gọi API.
    if (q && by === 'tracking_number' && !TRACKING_RE.test(q)) { setData({ items: [], page, limit: LIMIT, total: 0 }); setView('ready'); return; }
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
    if (status) qs.set('status', status);
    if (q) qs.set(by, q);
    const r = await api<Result>(`/shipping/shipments?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 403) setView('forbidden');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [page, status, q, by, sort]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const clear = () => router.push('/admin/shipments', { scroll: false });
  const back = sp.toString();

  if (view === 'forbidden') return <Forbidden testid={`${P}-forbidden`} />;
  return (
    <main className="wide">
      <h1>Vận đơn</h1>
      <div className="tabs" role="tablist" aria-label="Trạng thái" data-testid={`${P}-status-filter`}>
        {[{ v: '', t: 'Tất cả' }, ...SHIPMENT_STATUSES.map((s: ShipmentStatus) => ({ v: s as string, t: shipmentStatusText(s) }))].map((o) => (
          <button key={o.v || 'all'} type="button" role="tab" aria-selected={status === o.v} className={`btn tight${status === o.v ? ' btn-current' : ''}`} onClick={() => go({ status: o.v || null })}>{o.t}</button>
        ))}
      </div>
      <div className="toolbar">
        <select value={by} aria-label="Tìm theo" onChange={(e) => go({ by: e.target.value === 'order_code' ? null : e.target.value })} data-testid={`${P}-search-by`}>
          <option value="order_code">Mã đơn</option>
          <option value="tracking_number">Mã vận đơn</option>
        </select>
        <input type="search" value={search} maxLength={32} placeholder="Nhập mã đơn hoặc mã vận đơn" aria-label="Tìm theo mã đơn hoặc mã vận đơn" autoComplete="off"
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ q: search.trim() || null })} data-testid={`${P}-search`} />
        <select value={sort} aria-label="Sắp xếp" onChange={(e) => go({ sort: e.target.value === 'newest' ? null : e.target.value })} data-testid={`${P}-sort`}>
          <option value="newest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
        </select>
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${P}-clear-filter`}>Xoá lọc</button>}
      </div>

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được danh sách vận đơn. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid={`${P}-loading`} aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div data-testid={`${P}-empty-filtered`}><p>Không có vận đơn nào khớp.</p><button type="button" className="btn" onClick={clear} data-testid={`${P}-clear-filter`}>Xoá lọc</button></div>
        : <div data-testid={`${P}-empty`}><p className="hint">Chưa có vận đơn nào.</p></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? `${P}-loading` : undefined}>
            <table className="stack-table">
              <thead><tr><th>Mã đơn</th><th>Mã vận đơn</th><th>Phương thức</th><th>Trạng thái</th><th>Ngày tạo</th></tr></thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.order_code} className="row-click" data-testid={`${P}-row`} data-code={s.order_code} onClick={() => router.push(detailHref(s.order_code, back))}>
                    <td data-label="Mã đơn" className="mono" data-testid={`${P}-order-code`}><Link href={detailHref(s.order_code, back)} onClick={(e) => e.stopPropagation()}>{s.order_code}</Link></td>{/* liên kết thật để mở chi tiết bằng bàn phím và đọc màn hình: cả hàng bấm được chỉ bằng chuột */}
                    <td data-label="Mã vận đơn" className="mono" data-testid={`${P}-tracking`}>{s.tracking_number ?? '—'}</td>
                    <td data-label="Phương thức" data-testid={`${P}-method`}>{s.method_name}</td>
                    <td data-label="Trạng thái"><ShipmentBadge status={s.status} testid={`${P}-status-badge`} /></td>
                    <td data-label="Ngày tạo" className="tabular" data-testid={`${P}-created-at`}>{formatOrderTime(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix={P} page={page} limit={LIMIT} total={data.total} shown={items.length} unit="vận đơn" disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><ShipmentListInner /></Suspense>;
}

export default function AdminShipmentsPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
