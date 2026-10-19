'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Forbidden, Note, ShipmentBadge, Skel } from '../../../components/ShipmentParts';
import { Pager } from '../../../components/Pager';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatOrderTime } from '../../../lib/order';
import { useLoginRedirect } from '../../../lib/prd';
import { SHIPMENT_STATUSES, TRACKING_RE, detailHref, shipmentStatusText, type ShipmentRow, type ShipmentStatus } from '../../../lib/shipping';
import { limitedText } from '../../../lib/stock';
import { useQueryGo } from '../../../components/useQueryGo';

interface Result { items: ShipmentRow[]; page: number; limit: number; total: number }
const LIMIT = 20;
const P = 'shp-shipment-admin-list';
const DAY = 864e5;
/** Dòng nhắc dưới badge: đơn chờ bàn giao quá 24 giờ, hoặc giao thất bại cần xử lý. Ngưỡng 24 giờ tính trên giao diện (API không trả). */
const lateNote = (s: ShipmentRow): { text: string; red?: boolean } | null => {
  if (s.status === 'failed') return { text: 'Cần xử lý', red: true };
  const age = Date.now() - Date.parse(s.created_at);
  return s.status === 'pending' && age >= DAY ? { text: `Chờ ${Math.floor(age / DAY)} ngày` } : null;
};
const ageText = (iso: string): string => {
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  return h < 1 ? 'vừa tạo' : h < 24 ? `${Math.floor(h)} giờ trước` : `${Math.floor(h / 24)} ngày trước`;
};

/**
 * Vận đơn (ui/shipment-admin-list): staff, sale và admin xem hàng đợi, lọc theo trạng thái, tìm khớp chính xác theo mã đơn hoặc mã vận đơn, sắp xếp, phân trang 20. Có tên khách, điện thoại, địa chỉ (server trả null khi
 * vận đơn đã xong: hiện `—`, giao diện không tự ẩn theo trạng thái) và tên sale tạo đơn. Hàng chỉ bấm được với staff, admin: sale không có chi tiết (server trả 403) nên hàng của sale là chữ thường.
 * Bộ lọc nằm trên URL (`?status=&by=&q=&sort=&page=`) để từ chi tiết quay lại vẫn giữ; 429 có đếm ngược và tự tải lại khi hết giờ chờ.
 */
function ShipmentListInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const { user } = useAuth();
  const canOpen = user?.role === 'staff' || user?.role === 'admin'; // chi tiết chỉ staff, admin (SHP-API); sale chỉ xem danh sách
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
  const go = useQueryGo('/admin/shipments'); // cộng dồn các lần đổi liền nhau (REV-REV-12)
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
    <main className="page">
      <div className="page-head"><h1>Vận đơn</h1></div>
      <div className="seg" role="tablist" aria-label="Trạng thái" data-testid={`${P}-status-filter`} style={{ marginBottom: '.75rem' }}>
        {[{ v: '', t: 'Tất cả' }, ...SHIPMENT_STATUSES.map((s: ShipmentStatus) => ({ v: s as string, t: shipmentStatusText(s) }))].map((o) => (
          <button key={o.v || 'all'} type="button" role="tab" aria-selected={status === o.v} onClick={() => go({ status: o.v || null })}>{o.t}</button>
        ))}
      </div>
      <div className="shp-tools">
        <select className="shp-by" value={by} aria-label="Tìm theo" onChange={(e) => go({ by: e.target.value === 'order_code' ? null : e.target.value })} data-testid={`${P}-search-by`}>
          <option value="order_code">Mã đơn</option>
          <option value="tracking_number">Mã vận đơn</option>
        </select>
        <div className="shp-search">
          <span className="i i-search" aria-hidden="true" />
          <input type="search" value={search} maxLength={32} placeholder="Nhập mã đơn hoặc mã vận đơn" aria-label="Tìm theo mã đơn hoặc mã vận đơn" autoComplete="off"
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ q: search.trim() || null })} data-testid={`${P}-search`} />
        </div>
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${P}-clear-filter`}><span className="i i-x" aria-hidden="true" />Xoá lọc</button>}
        <select className="shp-sort" value={sort} aria-label="Sắp xếp" onChange={(e) => go({ sort: e.target.value === 'newest' ? null : e.target.value })} data-testid={`${P}-sort`}>
          <option value="newest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
        </select>
      </div>

      {view === 'rate' && limit.left > 0 && <Note tone="red" icon="clock" role="alert" testid={`${P}-error`}>{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></Note>}
      {view === 'error' && <Note tone="red" icon="alert" role="alert" testid={`${P}-error`}>Không tải được danh sách vận đơn. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></Note>}
      {view === 'loading' && !data && <div data-testid={`${P}-loading`}><Skel n={5} /></div>}
      {emptyAll && (filtering || page > 1
        ? <div className="empty" data-testid={`${P}-empty-filtered`}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có kết quả</strong><button type="button" className="btn" onClick={clear} data-testid={`${P}-clear-filter`}>Xoá lọc</button></div>
        : <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-truck" aria-hidden="true" /></span><strong>Chưa có vận đơn</strong></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? `${P}-loading` : undefined}>
            <table className="shp-table">
              <thead><tr><th>Trạng thái</th><th>Đơn</th><th>Khách</th><th className="m-hide">Giao đến</th><th className="m-hide shp-gon">Sale</th><th className="m-hide when">Tạo lúc</th></tr></thead>
              <tbody>
                {items.map((s) => {
                  const late = lateNote(s);
                  return (
                  <tr key={`${s.order_code}-${s.created_at}`} className={canOpen ? 'row-click' : undefined} data-flag={late?.red ? 'red' : late ? 'warn' : undefined} data-testid={`${P}-row`} data-code={s.order_code} onClick={canOpen ? () => router.push(detailHref(s.order_code, back)) : undefined}>
                    <td className="st" data-label="Trạng thái">
                      <ShipmentBadge status={s.status} testid={`${P}-status-badge`} />
                      {late && <div style={{ marginTop: '.35rem' }}><span className={`shp-late${late.red ? ' red' : ''}`}><span className={`i i-${late.red ? 'alert' : 'clock'}`} aria-hidden="true" />{late.text}</span></div>}
                    </td>
                    <td className="od" data-label="Đơn">
                      <span data-testid={`${P}-order-code`}>{canOpen
                        ? <Link className="ps-code" href={detailHref(s.order_code, back)} onClick={(e) => e.stopPropagation()}>{s.order_code}</Link> /* liên kết thật để mở chi tiết bằng bàn phím và đọc màn hình: cả hàng bấm được chỉ bằng chuột */
                        : <span className="ps-code">{s.order_code}</span>}</span>
                      <span className="shp-sub"><span className="shp-gon" data-testid={`${P}-method`}>{s.method_name} · </span>{s.tracking_number ? <span className="mono" data-testid={`${P}-tracking`}>{s.tracking_number}</span> : <><span data-testid={`${P}-tracking`} hidden>—</span>Chưa có mã vận đơn</>}</span>
                    </td>
                    <td className="cu" data-label="Khách">
                      <span className="shp-name" data-testid={`${P}-customer-name`}>{s.customer_name}</span>
                      <span className="shp-sub shp-gon" data-testid={`${P}-phone`}>{s.phone ?? '—'}</span>
                    </td>
                    <td className="m-hide ad" data-label="Giao đến"><div className="shp-addr" data-testid={`${P}-address`} title={s.address ?? undefined}>{s.address ?? <span className="shp-dash">—</span>}</div></td>
                    <td className="m-hide shp-gon" data-label="Sale" data-testid={`${P}-created-by-name`}>{s.created_by_name ?? '—'}</td>
                    <td className="m-hide when" data-label="Tạo lúc"><span className="ps-time" data-testid={`${P}-created-at`}>{formatOrderTime(s.created_at)}</span><span className="shp-sub">{ageText(s.created_at)}</span></td>
                  </tr>
                  );
                })}
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
  return <Suspense fallback={<main className="page"><Skel n={1} /></main>}><ShipmentListInner /></Suspense>;
}

export default function AdminShipmentsPage() {
  return <RequireRole roles={['customer', 'staff', 'sale', 'admin']}><Guard /></RequireRole>;
}
