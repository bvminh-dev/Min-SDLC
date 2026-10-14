'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Pager } from '../../components/Pager';
import { RequireRole } from '../../components/RequireRole';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatOrderTime } from '../../lib/order';
import { STATUS_TABS, TYPE_LABEL, badgeText, isType, markAllRead, markRead, safeLink, typesFor, type Notif, type NotifList } from '../../lib/notification';
import { useLoginRedirect } from '../../lib/prd';
import { useQueryGo } from '../../components/useQueryGo';

const P = 'ntf-notification-list';
const LIMIT = 20;

/** Thông báo của tôi (ui/notification-list, phương án A): tab Tất cả, Chưa đọc, Đã đọc và ô loại nằm trên URL (`?status=&type=&page=`); 20 dòng mỗi trang, mới nhất trước; văn bản thuần (React escape, SB-12). */
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
    <main>
      <div className="row-link">
        <h1>Thông báo của tôi</h1>
        <p className="hint">Chưa đọc: <strong className="tabular" data-testid={`${P}-unread-count`}>{badgeText(unread) || '0'}</strong></p>
      </div>
      <div className="ntf-filters">
        <div role="group" aria-label="Trạng thái" className="tabs" data-testid={`${P}-status-filter`}>
          {STATUS_TABS.map((t) => (
            <button type="button" key={t.value} className={`btn${status === t.value ? ' btn-current' : ''}`} aria-pressed={status === t.value} onClick={() => go({ status: t.value || null })}>
              {t.value === 'unread' ? `${t.label} (${badgeText(unread) || '0'})` : t.label}
            </button>
          ))}
        </div>
        <label className="ntf-type">Loại{' '}
          <select value={type} onChange={(e) => go({ type: e.target.value || null })} data-testid={`${P}-type-filter`}>
            <option value="">Tất cả</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        {filtering && <button type="button" className="btn btn-quiet" onClick={() => go({ status: null, type: null })} data-testid={`${P}-clear-filter`}>Xoá lọc</button>}
        <button type="button" className="btn" disabled={busy || unread === 0} onClick={() => void all()} data-testid={`${P}-mark-all-read`}>Đánh dấu tất cả đã đọc</button>
      </div>

      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button type="button" className="btn tight" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div aria-busy="true" data-testid={`${P}-loading`}>{[0, 1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}</div>}
      {data && view !== 'error' && (data.items.length === 0 ? (
        filtering || page > 1
          ? <div data-testid={`${P}-empty-filtered`}><p className="hint">Không có thông báo nào ở bộ lọc này.</p><button type="button" className="btn" onClick={() => go({ status: null, type: null, page: null })}>Xoá lọc</button></div>
          : <p className="hint" data-testid={`${P}-empty`}>Bạn chưa có thông báo nào.</p>
      ) : (
        <ul className="ntf-list">
          {data.items.map((n) => (
            <li key={n.id} className={`ntf-item${n.status === 'unread' ? ' ntf-unread' : ''}`} data-testid={`${P}-row`}>
              <div className="ntf-item-main" role={safeLink(n.link) || n.status === 'unread' ? 'button' : undefined} tabIndex={safeLink(n.link) || n.status === 'unread' ? 0 : undefined}
                onClick={() => void (n.status === 'unread' || safeLink(n.link) ? one(n, true) : undefined)}
                onKeyDown={(e) => { if (e.key === 'Enter') void (n.status === 'unread' || safeLink(n.link) ? one(n, true) : undefined); }}>
                {n.status === 'unread' && <span className="ntf-dot" data-testid={`${P}-unread-dot`}><span className="sr-only">Chưa đọc</span></span>}
                <span className="ntf-title" data-testid={`${P}-title`}>{n.title}</span>
                <span className="hint tabular" title={n.created_at} data-testid={`${P}-created-at`}>{formatOrderTime(n.created_at)}</span>
                <span className="ntf-body" data-testid={`${P}-body`}>{n.body}</span>
              </div>
              {n.status === 'unread' && <button type="button" className="btn tight" onClick={() => void one(n, false)} data-testid={`${P}-mark-read`}>Đã đọc</button>}
            </li>
          ))}
        </ul>
      ))}
      {data && <Pager testPrefix={P} page={page} limit={LIMIT} total={data.total} shown={data.items.length} onPage={(p) => go({ page: p > 1 ? String(p) : null })} disabled={view === 'loading'} unit="thông báo" />}
      {toast && <div role="alert" className="toast toast-error" data-testid={`${P}-toast-error`}>Không đánh dấu được, thử lại.</div>}
    </main>
  );
}

export default function NotificationsPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Suspense fallback={<main aria-busy="true"><div className="skeleton" /></main>}><ListInner /></Suspense></RequireRole>;
}
