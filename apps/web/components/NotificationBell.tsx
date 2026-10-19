'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatOrderTime } from '../lib/order';
import { PANEL_LIMIT, badgeText, markAllRead, markRead, safeLink, useUnreadCount, type Notif, type NotifList } from '../lib/notification';
import { SkRows } from './Skeleton';

const P = 'ntf-notification-bell';
const ICON: Record<string, [string, string]> = { // loại -> [icon, màu ô]
  order_created: ['receipt', ''], order_confirmed: ['okc', 'green'], payment_succeeded: ['card', 'green'], payment_failed: ['card', 'red'], order_cancelled: ['ban', 'red'], order_expired: ['clock', 'gray'],
  refund_succeeded: ['undo', 'violet'], refund_failed: ['undo', 'red'], order_shipped: ['truck', ''], shipment_failed: ['truck', 'red'], order_delivered: ['box', 'green'], order_returned: ['undo', 'amber'],
  welcome: ['gift', 'violet'], password_changed: ['key', 'amber'], low_stock: ['layers', 'amber'],
};

/**
 * Chuông thông báo trên thanh đầu trang (ui/notification-bell, phương án A): huy hiệu số chưa đọc (ẩn khi 0, "99+" khi lớn hơn 99), bấm mở khung 5 thông báo mới nhất, "Đánh dấu tất cả đã đọc", "Xem tất cả".
 * Đóng bằng Esc hay chạm ngoài. Văn bản thông báo hiện dạng văn bản thuần (React escape, SB-12). Lỗi đếm thì giấu huy hiệu, không chặn chuông; 401 thì chuông biến mất.
 */
export function NotificationBell() {
  const router = useRouter();
  const { count, gone, refresh } = useUnreadCount(true);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<Notif[]>([]);
  const [errText, setErrText] = useState('Không tải được');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading');
    const r = await api<NotifList>(`/notifications?limit=${PANEL_LIMIT}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setItems(r.body.items); setView('ready'); }
    else { setErrText(r.status === 429 ? 'Thử lại sau ít giây' : 'Không tải được'); setView('error'); }
  }, []);
  useEffect(() => { if (open) { void load(); refresh(); } }, [open, load, refresh]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (gone) return null;

  const unreadHere = items.some((i) => i.status === 'unread');
  const openRow = async (n: Notif) => {
    const to = safeLink(n.link);
    if (n.status === 'unread') {
      const r = await markRead(n.id); // đánh dấu trước rồi mới điều hướng; lỗi thì vẫn điều hướng (ui/notification-list)
      if (r.ok) setItems((cur) => cur.map((i) => (i.id === n.id ? { ...i, status: 'read' } : i)));
    }
    if (to) { setOpen(false); router.push(to); }
  };
  const all = async () => {
    setBusy(true);
    const r = await markAllRead();
    setBusy(false);
    if (r.ok) setItems((cur) => cur.map((i) => ({ ...i, status: 'read' as const })));
    else { setErrText('Không đánh dấu được'); setView('error'); }
  };

  const shown = count === null ? '' : badgeText(count);
  return (
    <div className="menu ntf-bell" ref={box}>
      <button type="button" className="ntf-trigger" aria-haspopup="true" aria-expanded={open} aria-label={count ? `Thông báo, ${count} chưa đọc` : 'Thông báo'} onClick={() => setOpen((o) => !o)} data-testid={`${P}-trigger`}>
        {shown && <span className="ntf-badge" data-testid={`${P}-badge`}>{shown}</span>}
      </button>
      {open && (
        <div className="popover ntf-panel" role="dialog" aria-label="Thông báo" data-testid={`${P}-panel`}>
          <div className="ntf-head">
            <strong>Thông báo</strong>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Đọc hết" title="Đọc hết" disabled={busy || view !== 'ready' || !unreadHere} onClick={() => void all()} data-testid={`${P}-mark-all-read`}><span className="i i-check" aria-hidden="true" /> Đọc hết</button>
          </div>
          {view === 'loading' && <SkRows n={3} testid={`${P}-loading`} />}
          {view === 'error' && (
            <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button type="button" className="btn tight" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>
          )}
          {view === 'ready' && items.length === 0 && <div className="empty" data-testid={`${P}-empty`}><span className="tile gray"><span className="i i-bell" aria-hidden="true" /></span><span>Chưa có thông báo</span></div>}
          {view === 'ready' && items.length > 0 && (
            <ul className="ntf-rows">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`ntf-row${n.status === 'unread' ? ' ntf-unread' : ''}`} onClick={() => void openRow(n)} data-testid={`${P}-row`}>
                    <span className={`tile ${(ICON[n.type] ?? ['bell', ''])[1]}`}><span className={`i i-${(ICON[n.type] ?? ['bell', ''])[0]}`} aria-hidden="true" /></span>
                    <span className="ntf-text">
                      <span className="ntf-title">{n.title}</span>
                      <span className="ntf-body">{n.body}</span>
                      <span className="hint tabular" title={n.created_at}>{formatOrderTime(n.created_at)}</span>
                    </span>
                    {n.status === 'unread' && <span className="ntf-dot" data-testid={`${P}-unread-dot`}><span className="sr-only">Chưa đọc</span></span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="btn btn-quiet" onClick={() => setOpen(false)} data-testid={`${P}-view-all`}>Xem tất cả</Link>
        </div>
      )}
    </div>
  );
}
