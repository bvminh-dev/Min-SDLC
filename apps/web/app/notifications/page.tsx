'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Pager } from '../../components/Pager';
import { RequireRole } from '../../components/RequireRole';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { STATUS_TABS, TYPE_LABEL, badgeText, isType, markAllRead, markRead, safeLink, typesFor, type Notif, type NotifList, type NotifType } from '../../lib/notification';
import { useLoginRedirect } from '../../lib/prd';
import { useQueryGo } from '../../components/useQueryGo';

const P = 'ntf-notification-list';
const LIMIT = 20;
/** Ô icon theo loại thông báo: [icon, màu]. */
const TYPE_ICON: Record<NotifType, [string, string]> = {
  order_created: ['receipt', ''], order_confirmed: ['okc', 'green'], payment_succeeded: ['card', 'green'], payment_failed: ['card', 'red'], order_cancelled: ['xc', 'red'],
  order_expired: ['clock', 'amber'], refund_succeeded: ['undo', 'green'], order_shipped: ['truck', ''], shipment_failed: ['truck', 'red'], order_delivered: ['box', 'green'],
  order_returned: ['undo', 'violet'], welcome: ['gift', 'violet'], password_changed: ['key', 'amber'], low_stock: ['layers', 'amber'], refund_failed: ['undo', 'red'],
};
/** Thời gian tương đối ngắn: "vừa xong", "5 phút", "2 giờ", "3 ngày"; quá 30 ngày thì ngày/tháng. */
const ago = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ`;
  if (m < 43_200) return `${Math.floor(m / 1440)} ngày`;
  const d = new Date(t + 7 * 3_600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Thông báo (ui/notification-list): tab Tất cả, Chưa đọc, Đã đọc và ô loại nằm trên URL (`?status=&type=&page=`); 20 dòng mỗi trang, mới nhất trước; văn bản thuần (React escape, SB-12). */
function ListInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();
  const expired = useLoginRedirect();
  const status = sp.get('status') === 'unread' || sp.get('status') === 'read' ? (sp.get('status') as 'unread' | 'read') : '';
  const type = isType(sp.get('type')) ? (sp.get('type') as string) : '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || type);
  const [data, setData] = useState<NotifList | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errText, setErrText] = useState('Không tải được thông báo.');
  const [toast, setToast] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const go = useQueryGo('/notifications'); // cộng dồn các lần đổi liền nhau (REV-REV-12)

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView((v) => (v === 'ready' ? v : 'loading')); // đổi tab hay trang thì giữ dữ liệu cũ (ui/notification-list: đang tải)
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (type) qs.set('type', type);
    const r = await api<NotifList>(`/notifications?${qs}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else { setErrText(r.status === 429 ? 'Thử lại sau ít giây' : r.status === 400 ? 'Bộ lọc không hợp lệ.' : 'Không tải được thông báo.'); setView('error'); }
  }, [page, status, type]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener('ntf:changed', on);
    return () => window.removeEventListener('ntf:changed', on);
  }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(false), 4000); return () => clearTimeout(t); }, [toast]);

  const one = async (n: Notif, navigate: boolean) => {
    const r = await markRead(n.id);
    if (!r.ok && !expired(r)) setToast(true);
    const to = navigate ? safeLink(n.link) : null;
    if (to) router.push(to); // lỗi đánh dấu thì vẫn điều hướng và hiện toast
  };
  const all = async () => {
    setBusy(true);
    const r = await markAllRead();
    setBusy(false);
    if (!r.ok && !expired(r)) setToast(true);
  };

  const unread = data?.unread_count ?? 0;
  const types = typesFor(user?.role);
  return (
    <main className="page page-mid">
      <div className="page-head">
        <h1>Thông báo</h1>
        <div className="actions">
          <button type="button" className="btn btn-sm" disabled={busy || unread === 0} onClick={() => void all()} data-testid={`${P}-mark-all-read`}><span className="i i-check" aria-hidden="true" />Đọc hết</button>
        </div>
      </div>
      <div className="rd-ntf-filters">
        <div role="group" aria-label="Trạng thái" className="seg" data-testid={`${P}-status-filter`}>
          {STATUS_TABS.map((t) => (
            <button type="button" key={t.value} aria-pressed={status === t.value} onClick={() => go({ status: t.value || null })}>
              {t.label}{t.value === 'unread' && <span className="rd-n" data-testid={`${P}-unread-count`}>{badgeText(unread) || '0'}</span>}
            </button>
          ))}
        </div>
        <select aria-label="Loại" value={type} onChange={(e) => go({ type: e.target.value || null })} data-testid={`${P}-type-filter`}>
          <option value="">Mọi loại</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        {filtering && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ status: null, type: null })} data-testid={`${P}-clear-filter`}><span className="i i-x" aria-hidden="true" />Bỏ lọc</button>}
      </div>

      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button type="button" className="btn btn-sm" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div aria-busy="true" data-testid={`${P}-loading`}>{[0, 1, 2, 3, 4].map((i) => <div className="skeleton" style={{ height: '4rem' }} key={i} />)}</div>}
      {data && view !== 'error' && (data.items.length === 0 ? (
        filtering || page > 1
          ? <div className="empty" data-testid={`${P}-empty-filtered`}><span className="tile tile-lg gray"><span className="i i-filter" aria-hidden="true" /></span><strong>Không có thông báo</strong><button type="button" className="btn btn-sm" onClick={() => go({ status: null, type: null, page: null })}>Bỏ lọc</button></div>
          : <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-bell" aria-hidden="true" /></span><strong>Chưa có thông báo</strong></div>
      ) : (
        <ul className="panel panel-flush rd-ntf-list">
          {data.items.map((n) => {
            const link = safeLink(n.link);
            const act = n.status === 'unread' || link;
            const [icon, tone] = TYPE_ICON[n.type] ?? ['bell', ''];
            return (
              <li key={n.id} className={`rd-ntf${n.status === 'unread' ? ' unread' : ''}`} data-testid={`${P}-row`}>
                <div className="rd-ntf-main" role={act ? 'button' : undefined} tabIndex={act ? 0 : undefined}
                  onClick={() => void (act ? one(n, true) : undefined)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void (act ? one(n, true) : undefined); }}>
                  <span className="rd-ntf-ico">
                    <span className={`tile ${tone}`}><span className={`i i-${icon}`} aria-hidden="true" /></span>
                    {n.status === 'unread' && <span className="rd-dot" data-testid={`${P}-unread-dot`}><span className="sr-only">Chưa đọc</span></span>}
                  </span>
                  <span className="rd-ntf-text">
                    <span className="rd-ntf-title" data-testid={`${P}-title`}>{n.title}</span>
                    <span className="rd-ntf-body" data-testid={`${P}-body`}>{n.body}</span>
                  </span>
                  <span className="small muted tabular rd-ntf-time" title={n.created_at} data-testid={`${P}-created-at`}>{ago(n.created_at)}</span>
                </div>
                {n.status === 'unread' && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Đã đọc" title="Đã đọc" onClick={() => void one(n, false)} data-testid={`${P}-mark-read`}><span className="i i-check" aria-hidden="true" /></button>}
              </li>
            );
          })}
        </ul>
      ))}
      {data && <Pager testPrefix={P} page={page} limit={LIMIT} total={data.total} shown={data.items.length} onPage={(p) => go({ page: p > 1 ? String(p) : null })} disabled={view === 'loading'} unit="thông báo" />}
      {toast && <div role="alert" className="toast toast-error" data-testid={`${P}-toast-error`}>Không đánh dấu được, thử lại.</div>}
    </main>
  );
}

export default function NotificationsPage() {
  return <RequireRole roles={['customer', 'staff', 'sale', 'admin']}><Suspense fallback={<main className="page" aria-busy="true"><div className="skeleton" /></main>}><ListInner /></Suspense></RequireRole>;
}
