'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CartSummary } from '../../components/CartSummary';
import { Spinner } from '../../components/PaymentParts';
import { RequireRole } from '../../components/RequireRole';
import { api } from '../../lib/api';
import { MAX_QTY, announceCart, blockerLines, lineErrorText, limitedText, type Cart, type CartLine } from '../../lib/cart';
import { formatPrice } from '../../lib/format';

const CLEARED_MS = 4000;

function CartLineRow({ line, busy, error, onQty, onRemove }: { line: CartLine; busy: 'qty' | 'remove' | undefined; error: string | undefined; onQty: (l: CartLine, q: number | null, raw?: string) => void; onRemove: (l: CartLine) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const gone = line.availability.status === 'unavailable';
  const a = line.availability;
  const shown = draft ?? String(line.quantity);
  const commit = () => { if (draft !== null && draft !== String(line.quantity)) onQty(line, null, draft); setDraft(null); };
  return (
    <li className={`crt-line${gone || busy === 'remove' ? ' dim' : ''}`} data-testid="crt-cart-line" data-id={line.id}>
      <div className="crt-img" data-testid="crt-cart-line-image">{line.image_url ? <img src={line.image_url} alt="" loading="lazy" /> : <span className="i i-image" aria-hidden="true" />}</div>
      <div className="crt-info">
        <Link href={`/products/${line.product_id}`} className="crt-name" data-testid="crt-cart-line-name">{line.name}</Link>
        <p className="crt-price">
          <span data-testid="crt-cart-line-unit-price">{formatPrice(line.unit_price)}</span>
          {line.previous_unit_price !== undefined && <> <s data-testid="crt-cart-line-previous-price">{formatPrice(line.previous_unit_price)}</s></>}
          {gone && <span className="badge" data-status="cancelled" data-testid="crt-cart-line-unavailable">Ngừng bán</span>}
        </p>
        {a.status === 'insufficient' && <p className="crt-warn" data-testid="crt-cart-line-stock-warning"><span className="i i-alert" aria-hidden="true" />Chỉ còn {a.available} sản phẩm</p>}
        {a.status === 'out_of_stock' && <p className="crt-warn" data-testid="crt-cart-line-stock-warning"><span className="i i-alert" aria-hidden="true" />Hết hàng</p>}
        {gone && <p className="crt-warn"><span className="i i-ban" aria-hidden="true" />Không còn bán</p>}
        {a.status === 'unknown' && <p className="crt-note" data-testid="crt-cart-stock-unknown">Chưa kiểm được tồn kho</p>}
        {error && <p role="alert" className="crt-warn" data-testid="crt-cart-line-error">{error}</p>}
      </div>
      <div className="crt-qty">
        <button type="button" aria-label="Giảm" disabled={!!busy || line.quantity <= 1} onClick={() => onQty(line, line.quantity - 1)} data-testid="crt-cart-line-quantity-decrease" />
        <input inputMode="numeric" aria-label={`Số lượng ${line.name}`} value={shown} disabled={!!busy || gone} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} data-testid="crt-cart-line-quantity" />
        <button type="button" aria-label="Tăng" disabled={!!busy || gone || line.quantity >= MAX_QTY} onClick={() => onQty(line, line.quantity + 1)} data-testid="crt-cart-line-quantity-increase" />
        {busy === 'qty' && <span data-testid="crt-cart-line-updating"><Spinner /></span>}
      </div>
      <p className="crt-total" data-testid="crt-cart-line-total">{formatPrice(line.line_total)}</p>
      <button type="button" className="btn btn-ghost btn-icon crt-del" aria-label={`Xóa ${line.name}`} disabled={!!busy} onClick={() => onRemove(line)} data-testid="crt-cart-line-remove" />
    </li>
  );
}

function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'expired'>('loading');
  const [errText, setErrText] = useState('');
  const [busy, setBusy] = useState<Record<string, 'qty' | 'remove'>>({});
  const [lineErr, setLineErr] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearErr, setClearErr] = useState(false);
  const [cleared, setCleared] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const load = useCallback(async (quiet = false) => {
    const n = ++seq.current;
    if (!quiet) setView('loading');
    const r = await api<Cart>('/cart', { silentExpired: true });
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setCart(r.body); setView('ready'); announceCart(r.body.item_count); }
    else if (r.status === 401) setView('expired');
    else { setErrText(r.status === 429 ? limitedText(r.retryAfter) : 'Không tải được giỏ hàng.'); setView('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const apply = (c: Cart) => { seq.current++; setCart(c); setView('ready'); announceCart(c.item_count); };

  const setBusyFor = (id: string, v: 'qty' | 'remove' | undefined) => setBusy((b) => { const n = { ...b }; if (v) n[id] = v; else delete n[id]; return n; });
  const onQty = async (line: CartLine, q: number | null, raw?: string) => {
    const want = q ?? (raw !== undefined && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
    setLineErr((e) => { const n = { ...e }; delete n[line.id]; return n; });
    if (!Number.isInteger(want) || want < 1 || want > MAX_QTY) { setLineErr((e) => ({ ...e, [line.id]: `Chọn từ 1 đến ${MAX_QTY}` })); return; } // ô sai: khôi phục giá trị cũ, không gửi
    if (want === line.quantity) return;
    setBusyFor(line.id, 'qty');
    const r = await api(`/cart/items/${line.id}`, { method: 'PATCH', body: { quantity: want }, silentExpired: true });
    setBusyFor(line.id, undefined);
    if (r.status === 200) await load(true);
    else if (r.status === 401) setView('expired');
    else { setLineErr((e) => ({ ...e, [line.id]: lineErrorText(r) })); if (r.status === 404) await load(true); }
  };
  const onRemove = async (line: CartLine) => {
    setBusyFor(line.id, 'remove');
    const r = await api(`/cart/items/${line.id}`, { method: 'DELETE', silentExpired: true });
    setBusyFor(line.id, undefined);
    if (r.status === 204 || r.status === 404) await load(true); // 404 của thao tác xóa là "đã xóa" (CRT-REQ-20261006-103226434 BR3)
    else if (r.status === 401) setView('expired');
    else setLineErr((e) => ({ ...e, [line.id]: r.status === 429 ? limitedText(r.retryAfter) : 'Không xóa được dòng. Thử lại.' }));
  };
  const refresh = async () => {
    setRefreshing(true);
    const r = await api<Cart>('/cart/refresh-prices', { method: 'POST', body: {}, silentExpired: true });
    setRefreshing(false);
    if (r.status === 200) apply(r.body); else if (r.status === 401) setView('expired');
  };
  const doClear = async () => {
    setClearBusy(true); setClearErr(false);
    const r = await api('/cart', { method: 'DELETE', silentExpired: true });
    setClearBusy(false);
    if (r.status === 204) {
      setClearOpen(false); setCleared(true); await load(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCleared(false), CLEARED_MS); // thông báo ngắn tự mất
    } else if (r.status === 401) { setClearOpen(false); setView('expired'); }
    else setClearErr(true);
  };

  if (view === 'loading') return (
    <main className="page" aria-busy="true" data-testid="crt-cart-loading"><div className="page-head"><h1>Giỏ hàng</h1></div><div className="crt-grid"><div className="panel"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div><div className="skeleton crt-sk-sum" data-testid="crt-cart-summary-loading" /></div></main>
  );
  // Khối tóm tắt khi giỏ không tải được (ui/cart-summary, trạng thái `lỗi`, `hết phiên`): tổng tiền không tính được nên nút thanh toán khóa; số tiền luôn do máy chủ tính, giao diện không đoán.
  const loginHref = `/login?next=${encodeURIComponent('/cart')}&reason=expired`;
  if (view === 'expired') return (
    <main className="page"><div className="page-head"><h1>Giỏ hàng</h1></div>
      <div role="alert" className="banner banner-error" data-testid="crt-cart-session-expired">Phiên đã hết hạn. <a href={loginHref}>Đăng nhập</a></div>
      <div className="crt-grid"><div />
        <aside className="panel crt-sum" aria-label="Tóm tắt đơn"><h2><span className="i i-receipt" aria-hidden="true" />Tóm tắt</h2>
          <p role="alert" className="crt-warn" data-testid="crt-cart-summary-session-expired">Phiên đã hết hạn. <a href={loginHref}>Đăng nhập</a></p></aside></div></main>
  );
  if (view === 'error' || !cart) return (
    <main className="page"><div className="page-head"><h1>Giỏ hàng</h1></div>
      <div role="alert" className="banner banner-error" data-testid="crt-cart-error">{errText} <button type="button" className="btn" onClick={() => void load()} data-testid="crt-cart-retry">Thử lại</button></div>
      <div className="crt-grid"><div />
        <aside className="panel crt-sum" aria-label="Tóm tắt đơn"><h2><span className="i i-receipt" aria-hidden="true" />Tóm tắt</h2>
          <div role="alert" className="banner banner-error" data-testid="crt-cart-summary-error">Không tính được tổng. <button type="button" className="btn" onClick={() => void load()} data-testid="crt-cart-summary-retry">Thử lại</button></div>
          <span className="btn btn-primary crt-go" role="link" aria-disabled="true">Thanh toán</span></aside></div></main>
  );

  const empty = cart.items.length === 0;
  const problems = blockerLines(cart);
  return (
    <main className="page">
      <div className="page-head"><h1>Giỏ hàng{!empty && <span className="badge crt-count">{cart.item_count}</span>}</h1>
        {!empty && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setClearErr(false); setClearOpen(true); }} data-testid="crt-cart-clear"><span className="i i-trash" aria-hidden="true" />Làm trống</button>}</div>
      {cleared && <p role="status" aria-live="polite" className="banner banner-ok" data-testid="crt-cart-clear-success">Đã làm trống giỏ</p>}
      {cart.price_changed && (
        <div role="status" className="banner banner-info" data-testid="crt-cart-price-changed-banner">Giá đã đổi.{' '}
          <button type="button" className="btn" disabled={refreshing} aria-busy={refreshing} onClick={() => void refresh()} data-testid="crt-cart-refresh-prices">{refreshing && <Spinner />}Cập nhật giá</button></div>
      )}
      {problems > 0 && <div role="alert" className="banner banner-error" data-testid="crt-cart-blockers-notice">Cần xử lý {problems} sản phẩm trước khi thanh toán</div>}
      {empty ? (
        <div className="crt-grid"><div className="panel" data-testid="crt-cart-empty"><div className="empty"><span className="tile tile-lg gray"><span className="i i-cart" aria-hidden="true" /></span><strong>Giỏ hàng trống</strong><Link href="/products" className="btn btn-primary" data-testid="crt-cart-empty-shop-link"><span className="i i-tag" aria-hidden="true" />Mua sắm</Link></div></div><CartSummary cart={cart} onCart={apply} /></div>
      ) : (
        <div className="crt-grid">
          <div className="panel panel-flush"><ul className="crt-list" data-testid="crt-cart-list">
            {cart.items.map((l) => <CartLineRow key={l.id} line={l} busy={busy[l.id]} error={lineErr[l.id]} onQty={(x, q, raw) => void onQty(x, q, raw)} onRemove={(x) => void onRemove(x)} />)}
          </ul></div>
          <CartSummary cart={cart} onCart={apply} />
        </div>
      )}
      {clearOpen && (
        <div className="backdrop"> {/* không đóng khi bấm ra ngoài: hành động không hoàn tác (ui/cart) */}
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" onKeyDown={(e) => { if (e.key === 'Escape' && !clearBusy) setClearOpen(false); }} data-testid="crt-cart-clear-dialog">
            <div className="dlg-head"><span className="tile red"><span className="i i-trash" aria-hidden="true" /></span><h2 id="clear-title">Làm trống giỏ hàng?</h2></div>
            <p>Xóa mọi sản phẩm, mã giảm giá và vận chuyển. Không hoàn tác được.</p>
            {clearErr && <p role="alert" className="field-error" data-testid="crt-cart-clear-error">Không làm trống được giỏ. Thử lại.</p>}
            <div className="actions">
              <button type="button" className="btn" disabled={clearBusy} onClick={() => setClearOpen(false)} data-testid="crt-cart-clear-dismiss">Giữ giỏ</button>
              <button type="button" className="btn btn-danger" disabled={clearBusy} aria-busy={clearBusy} onClick={() => void doClear()} data-testid="crt-cart-clear-confirm">{clearBusy && <Spinner />}Làm trống</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Page() { return <RequireRole roles={['customer']}><CartPage /></RequireRole>; }
