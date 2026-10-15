'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MAX_QTY, announceCart, stockText } from '../lib/cart';
import { Spinner } from './PaymentParts';

type Msg = { kind: 'success' } | { kind: 'stock'; text: string } | { kind: 'limit'; text: string } | { kind: 'gone' } | { kind: 'quantity' } | { kind: 'error' } | { kind: 'expired' } | { kind: 'rate'; text: string };
/** Thông báo thành công tự ẩn sau vài giây (đường thoát của trạng thái có thời hạn, ui/add-to-cart); lỗi ở lại tới khi khách thao tác tiếp. */
export const SUCCESS_MS = 4000;

/**
 * Khối "Thêm vào giỏ" nhúng ở trang chi tiết và thẻ sản phẩm của PRD (CRT-REQ-20261006-103226376). Guest vẫn thấy nút, bấm thì nhận 401 và được đưa tới đăng nhập kèm quay lại trang này;
 * staff, admin không thấy khối (server vẫn từ chối 403). Thêm là phép cộng nên nút và ô số lượng khóa khi đang gửi (BR10). `compact` (thẻ trong danh sách): luôn thêm một sản phẩm, không có ô số lượng.
 */
export function AddToCart({ productId, compact }: { productId: string; compact?: boolean }) {
  const { status, user } = useAuth();
  const path = usePathname();
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (status === 'ready' && user && user.role !== 'customer') return null;

  const n = Number(qty);
  const valid = /^\d{1,3}$/.test(qty.trim()) && n >= 1 && n <= MAX_QTY;
  const set = (v: number) => setQty(String(Math.min(MAX_QTY, Math.max(1, v))));
  const submit = async () => {
    if (busy) return;
    if (!compact && !valid) { setMsg({ kind: 'quantity' }); return; }
    setBusy(true); setMsg(null);
    const r = await api<{ summary?: { item_count: number }; available?: number }>('/cart/items', { method: 'POST', body: { product_id: productId, quantity: compact ? 1 : n }, silentExpired: true });
    setBusy(false);
    if (r.status === 200 || r.status === 201) {
      setMsg({ kind: 'success' }); setQty('1'); announceCart(r.body.summary?.item_count ?? null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg((m) => (m?.kind === 'success' ? null : m)), SUCCESS_MS);
    } else if (r.status === 401) setMsg({ kind: 'expired' });
    else if (r.code === 'insufficient-stock') setMsg({ kind: 'stock', text: stockText(r.body?.available) });
    else if (r.code === 'quantity-limit-exceeded') setMsg({ kind: 'limit', text: `Mỗi sản phẩm tối đa ${MAX_QTY}` });
    else if (r.code === 'cart-limit-exceeded') setMsg({ kind: 'limit', text: 'Giỏ hàng đã đạt giá trị tối đa' });
    else if (r.code === 'cart-line-limit-reached') setMsg({ kind: 'limit', text: 'Giỏ đã đủ 50 sản phẩm' });
    else if (r.code === 'product-unavailable') setMsg({ kind: 'gone' });
    else if (r.status === 400) setMsg({ kind: 'quantity' });
    else if (r.status === 429) setMsg({ kind: 'rate', text: `Thao tác quá nhanh, thử lại sau ${r.retryAfter ?? 60} giây` });
    else setMsg({ kind: 'error' });
  };
  const next = typeof window === 'undefined' ? path : window.location.pathname + window.location.search;
  const gone = msg?.kind === 'gone';
  const ic = (n: string) => <span className={`i i-${n}`} aria-hidden="true" />;
  return (
    <div className={`add-to-cart ct-atc${compact ? ' compact' : ''}`}>
      <div className="ct-atc-row">
        {!compact && (
          <div className="ct-qty">
            <label htmlFor={`atc-${productId}`} className="sr-only">Số lượng</label>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Giảm" disabled={busy || gone || n <= 1} onClick={() => set((valid ? n : 1) - 1)} data-testid="crt-add-to-cart-quantity-decrease"></button>
            <input id={`atc-${productId}`} inputMode="numeric" value={qty} disabled={busy || gone} aria-invalid={!valid} onChange={(e) => setQty(e.target.value)} data-testid="crt-add-to-cart-quantity" />
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Tăng" disabled={busy || gone || n >= MAX_QTY} onClick={() => set((valid ? n : 0) + 1)} data-testid="crt-add-to-cart-quantity-increase"></button>
          </div>
        )}
        <button type="button" className="btn btn-primary" disabled={busy || gone || (!compact && !valid)} aria-busy={busy} onClick={() => void submit()} data-testid="crt-add-to-cart-submit">
          {busy ? <Spinner /> : ic('cart')}Thêm vào giỏ
        </button>
      </div>
      {msg?.kind === 'quantity' && <p className="field-error" role="alert" data-testid="crt-add-to-cart-error-quantity">Chọn từ 1 đến {MAX_QTY}</p>}
      {msg?.kind === 'success' && <p role="status" aria-live="polite" className="ct-ok" data-testid="crt-add-to-cart-success">{ic('okc')}<span>Đã thêm vào giỏ</span> <Link href="/cart" data-testid="crt-add-to-cart-view-cart">Xem giỏ</Link></p>}
      {msg?.kind === 'stock' && <p role="alert" className="field-error" data-testid="crt-add-to-cart-error-stock">{msg.text}</p>}
      {(msg?.kind === 'limit' || msg?.kind === 'rate') && <p role="alert" className="field-error" data-testid="crt-add-to-cart-error-limit">{msg.text}</p>}
      {gone && <p role="alert" className="field-error" data-testid="crt-add-to-cart-unavailable">Sản phẩm không còn bán</p>}
      {msg?.kind === 'error' && <div role="alert" className="banner banner-error" data-testid="crt-add-to-cart-error">Không thêm được vào giỏ. <button type="button" className="btn" onClick={() => void submit()} data-testid="crt-add-to-cart-retry">Thử lại</button></div>}
      {msg?.kind === 'expired' && <div role="alert" className="banner banner-error" data-testid="crt-add-to-cart-session-expired">Phiên đã hết hạn. <a href={`/login?next=${encodeURIComponent(next)}&reason=expired`}>Đăng nhập</a></div>}
    </div>
  );
}
