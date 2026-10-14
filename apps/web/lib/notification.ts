'use client';
// Gọi API thông báo và sự kiện cho huy hiệu giữa chuông và trang danh sách (như `cart.ts`): mọi màn đổi trạng thái đọc báo cho chuông đọc lại số.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiResult } from './api';
import { POLL_MS, type Notif } from './notification-const';

export * from './notification-const';
export const NTF_EVENT = 'ntf:changed';
export const announceNotifications = (): void => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(NTF_EVENT)); };

/** Đánh dấu một thông báo đã đọc; báo cho chuông. Trả kết quả để bên gọi quyết định hiện lỗi hay vẫn điều hướng (ui/notification-list: lỗi thì vẫn điều hướng và hiện toast). */
export async function markRead(id: string): Promise<ApiResult<{ notification: Notif; unread_count: number }>> {
  const r = await api<{ notification: Notif; unread_count: number }>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  if (r.ok) announceNotifications();
  return r;
}
export async function markAllRead(): Promise<ApiResult<{ updated: number; unread_count: number }>> {
  const r = await api<{ updated: number; unread_count: number }>('/notifications/read-all', { method: 'POST', body: {} });
  if (r.ok) announceNotifications();
  return r;
}

/** Số chưa đọc cho huy hiệu: đọc lúc mount, mỗi 60 giây khi tab hiện, khi có sự kiện đổi và khi tab hiện lại. Lỗi đếm thì giấu huy hiệu (`null`), không chặn chuông; 401 thì `gone` (chuông biến mất). */
export function useUnreadCount(enabled: boolean): { count: number | null; gone: boolean; refresh: () => void } {
  const [count, setCount] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++seq.current;
    const r = await api<{ unread_count: number }>('/notifications/unread-count', { silentExpired: true });
    if (!alive.current || n !== seq.current) return;
    if (r.status === 200 && typeof r.body.unread_count === 'number') setCount(r.body.unread_count);
    else if (r.status === 401) setGone(true);
    else setCount(null);
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!enabled) { setCount(null); return () => { alive.current = false; }; }
    void refresh();
    const tick = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const on = () => void refresh();
    const vis = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener(NTF_EVENT, on);
    document.addEventListener('visibilitychange', vis);
    return () => { alive.current = false; clearInterval(tick); window.removeEventListener(NTF_EVENT, on); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, refresh]);
  const again = useCallback(() => void refresh(), [refresh]); // tham chiếu ổn định: dùng trong deps của useEffect ở chuông (không thì tải lại vô hạn)
  return { count, gone, refresh: again };
}
