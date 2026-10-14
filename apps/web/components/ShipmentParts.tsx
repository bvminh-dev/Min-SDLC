'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type ApiResult } from '../lib/api';
import { useLoginRedirect } from '../lib/prd';
import { shipmentStatusText } from '../lib/shipping';
import { limitedText } from '../lib/stock';
import { useCountdown } from './useCountdown';

export interface Err { text: string; field?: boolean; reload?: boolean }

/** Gọi một thao tác ghi: khóa nút khi đang gửi, 401 chuyển về đăng nhập, 429 hiện đếm ngược và tự mất khi hết giờ chờ (nút vẫn bấm được ngay), lỗi khác do `map` quyết định. */
export function useCall() {
  const expired = useLoginRedirect();
  const limit = useCountdown();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);
  const [rate, setRate] = useState(false);
  const call = async (path: string, method: 'POST' | 'PATCH', body: unknown, map: (r: ApiResult) => Err): Promise<ApiResult | null> => {
    setBusy(true); setErr(null); setRate(false);
    const r = await api(path, { method, body });
    setBusy(false);
    if (r.ok) return r;
    if (expired(r)) return null;
    if (r.status === 429) { limit.start(r.retryAfter); setRate(true); return null; }
    setErr(map(r));
    return null;
  };
  return { busy, err, rateText: rate && limit.left > 0 ? limitedText(limit.left) : null, call };
}

/** Hộp thoại: `sticky` (có ô nhập) không đóng khi bấm ra ngoài (luật I20 của evon); Escape luôn đóng. */
export function Modal({ title, testid, onClose, sticky, children }: { title: string; testid?: string; onClose: () => void; sticky?: boolean; children: ReactNode }) {
  return (
    <div className="backdrop" onMouseDown={(e) => { if (!sticky && e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-testid={testid}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Trang "không có quyền" của SHP (customer mở màn của staff, admin hoặc API trả 403). */
export function Forbidden({ testid }: { testid: string }) {
  return (
    <main className="center">
      <section className="card" data-testid={testid}>
        <h1>Bạn không có quyền xem trang này</h1>
        <Link className="btn btn-primary" href="/">Về trang chủ</Link>
      </section>
    </main>
  );
}

/** Khối "không tìm thấy" dùng chung: cùng một giao diện cho mã sai định dạng, không tồn tại và đơn của người khác (SB-06). */
export function NotFound({ testid, backTestid, backHref, backLabel }: { testid: string; backTestid: string; backHref: string; backLabel: string }) {
  return (
    <main className="center">
      <section className="card" data-testid={testid}>
        <p className="hint">404</p>
        <h1>Không tìm thấy đơn hàng</h1>
        <p>Đơn không tồn tại hoặc bạn không có quyền xem đơn này.</p>
        <Link className="btn btn-primary" href={backHref} data-testid={backTestid}>{backLabel}</Link>
      </section>
    </main>
  );
}

export function ShipmentBadge({ status, testid }: { status: string; testid: string }) {
  return <span className="badge" data-status={`ship-${status}`} data-testid={testid}>{shipmentStatusText(status)}</span>;
}

/** Thông báo ngắn tự tắt sau `ms` (đường thoát của trạng thái có thời hạn); `text` đổi thì tính lại thời hạn. */
export function useToast(ms = 4000): { toast: { text: string; testid?: string; error?: boolean } | null; show: (t: { text: string; testid?: string; error?: boolean }) => void } {
  const [toast, setToast] = useState<{ text: string; testid?: string; error?: boolean } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), ms); return () => clearTimeout(t); }, [toast, ms]);
  return { toast, show: setToast };
}

export function ToastView({ toast }: { toast: { text: string; testid?: string; error?: boolean } | null }) {
  return toast ? <div className={`toast${toast.error ? ' toast-error' : ''}`} role="status" data-testid={toast.testid}>{toast.text}</div> : null;
}
