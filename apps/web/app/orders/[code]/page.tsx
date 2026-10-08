'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '../../../lib/format';
import { ORDER_STATUS_LABEL, formatClock, formatOrderTime, paymentText, reasonText, type HistoryItem, type OrderDetail } from '../../../lib/order';
import { useLoginRedirect } from '../../../lib/prd';
import { limitedText } from '../../../lib/stock';

type View = 'loading' | 'ready' | 'notfound' | 'error';

/** Chi tiết đơn (ui/order-detail): thông tin đơn, lịch sử trạng thái (khối tải riêng, lỗi riêng) và hủy đơn (hộp thoại). Customer chỉ thấy đơn của mình; staff không thấy địa chỉ; staff và admin vào qua danh sách quản trị. */
function OrderDetailView({ code }: { code: string }) {
  const { user } = useAuth();
  const expired = useLoginRedirect();
  const staffSide = user?.role !== 'customer';
  const [view, setView] = useState<View>('loading');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [histView, setHistView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cancelled, setCancelled] = useState(false);
  const seq = useRef(0);
  const histSeq = useRef(0);

  const loadHistory = useCallback(async () => {
    const id = ++histSeq.current;
    setHistView('loading');
    const r = await api<{ items: HistoryItem[] }>(`/orders/${encodeURIComponent(code)}/status-history`);
    if (id !== histSeq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setHistory(r.body.items); setHistView('ready'); } else if (!expired(r)) setHistView('error');
  }, [code]); // expired đổi mỗi lần render nên không đưa vào deps
  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    void loadHistory();
    const r = await api<OrderDetail>(`/orders/${encodeURIComponent(code)}`);
    if (id !== seq.current) return;
    if (r.status === 200 && typeof r.body.code === 'string') { setOrder(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 404) setView('notfound'); // cùng một giao diện cho đơn của người khác, không tồn tại và mã sai định dạng
    else setView('error');
  }, [code, loadHistory]);
  useEffect(() => { void load(); }, [load]);

  const back = staffSide ? '/admin/orders' : '/orders';
  if (view === 'loading' && !order) return <main className="wide" data-testid="ord-order-detail-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></main>;
  if (view === 'notfound') {
    return (
      <main className="center">
        <section className="card" data-testid="ord-order-detail-notfound">
          <p className="hint">404</p>
          <h1>Không tìm thấy đơn hàng</h1>
          <p>Đơn không tồn tại hoặc bạn không có quyền xem đơn này.</p>
          <Link className="btn btn-primary" href={back} data-testid="ord-order-detail-notfound-back">Về danh sách đơn hàng</Link>
        </section>
      </main>
    );
  }
  if (view === 'error' || !order) {
    return <main className="wide"><div role="alert" className="banner banner-error" data-testid="ord-order-detail-error">Không tải được đơn hàng. <button className="btn" onClick={() => void load()} data-testid="ord-order-detail-retry">Thử lại</button></div></main>;
  }

  const customer = user?.role === 'customer';
  // dòng "shipped" thứ hai trở đi trong lịch sử là giao thất bại (ORD-API: `status` = shipped lần thứ hai kèm mã lý do)
  let shippedSeen = false;
  const rows = (history ?? []).map((h) => { const failed = h.status === 'shipped' && shippedSeen; if (h.status === 'shipped') shippedSeen = true; return { ...h, failed }; });
  return (
    <main className="wide">
      <p><Link href={back} data-testid="ord-order-detail-back-link">← Quay lại danh sách</Link></p>
      <header className="row-link">
        <h1>Đơn <span className="mono" data-testid="ord-order-detail-code">{order.code}</span></h1>
        <span className="badge" data-status={order.status} data-testid="ord-order-detail-status-badge">{ORDER_STATUS_LABEL[order.status]}</span>
        <span className="hint" data-testid="ord-order-detail-created-at">{formatOrderTime(order.created_at)}</span>
        {order.can_cancel && <CancelDialogButton order={order} onDone={() => { setCancelled(true); void load(); }} onReload={() => void load()} />}
      </header>
      {cancelled && <div role="status" className="banner banner-ok" data-testid="ord-order-detail-cancel-success">Đã hủy đơn</div>}

      <section data-testid="ord-order-detail-items">
        <h2>Sản phẩm</h2>
        <table className="stack-table">
          <thead><tr><th>Sản phẩm</th><th className="num">Đơn giá</th><th className="num">Số lượng</th><th className="num">Thành tiền</th></tr></thead>
          <tbody>{order.items.map((i, k) => <tr key={k}><td data-label="Sản phẩm">{i.name}</td><td data-label="Đơn giá" className="num">{formatPrice(i.unit_price)}</td><td data-label="Số lượng" className="num">× {i.quantity}</td><td data-label="Thành tiền" className="num">{formatPrice(i.line_total)}</td></tr>)}</tbody>
        </table>
      </section>
      <section data-testid="ord-order-detail-totals">
        <p>Tạm tính: {formatPrice(order.items_total)}</p>
        <p>Giảm giá: {formatPrice(order.discount)}</p>
        <p>Phí giao hàng: {formatPrice(order.shipping_fee)}</p>
        <p className="strong">Tổng cộng: {formatPrice(order.grand_total)}</p>
      </section>

      <section>
        <h2>Giao hàng</h2>
        {order.shipping_address
          ? <div data-testid="ord-order-detail-address"><p>{order.shipping_address.receiver}</p><p>{order.shipping_address.phone}</p><p>{order.shipping_address.line1}, {order.shipping_address.ward}, {order.shipping_address.city}</p></div>
          : <p className="hint" data-testid="ord-order-detail-address-hidden">Thông tin người nhận được ẩn theo chính sách dữ liệu</p>}
        {order.tracking_number && <p>Mã vận đơn: <span className="mono" data-testid="ord-order-detail-tracking">{order.tracking_number}</span></p>}
        {customer && order.tracking_number && <Link href={`/orders/${order.code}/shipment`} data-testid="ord-order-detail-tracking-link">Theo dõi vận chuyển ›</Link>}
      </section>

      <section data-testid="ord-order-detail-payment">
        <h2>Thanh toán</h2>
        <p>{paymentText(order.payment_method, order.payment_status)}</p>
        {order.payment_expires_at && <p data-testid="ord-order-detail-payment-expires">Hạn thanh toán {formatClock(order.payment_expires_at)}</p>}
        {customer && <Link href={`/orders/${order.code}/payment`} data-testid="ord-order-detail-payment-link">Xem thanh toán ›</Link>}
      </section>

      <section data-testid="ord-order-detail-history">
        <h2>Lịch sử trạng thái</h2>
        {histView === 'loading' && !history && <div aria-busy="true"><div className="skeleton" /></div>}
        {histView === 'error' && <div role="alert" className="banner banner-error" data-testid="ord-order-detail-history-error">Không tải được lịch sử. <button className="btn" onClick={() => void loadHistory()} data-testid="ord-order-detail-history-retry">Thử lại</button></div>}
        {histView === 'ready' && (
          <ol className="timeline">
            {rows.map((h, k) => (
              <li key={k} data-testid="ord-order-detail-history-item">
                <span className="hint">{formatOrderTime(h.at)}</span> {h.failed ? 'Giao thất bại' : ORDER_STATUS_LABEL[h.status]}
                {h.reason && <span> · <span data-testid="ord-order-detail-history-reason">Lý do: {reasonText(h.status, h.reason, h.failed)}</span></span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

/** Nút Hủy đơn và hộp thoại xác nhận: có ô nhập nên bấm ra ngoài không đóng; 409 chung (đơn vừa đổi hay SHP đã khóa bàn giao) kèm nút Tải lại; 429 có đếm ngược và tự mở lại. */
function CancelDialogButton({ order, onDone, onReload }: { order: OrderDetail; onDone: () => void; onReload: () => void }) {
  const expired = useLoginRedirect();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; reload?: boolean } | null>(null);
  const limit = useCountdown();
  // hết giờ chờ (429) thì thông báo tự mất; nút Xác nhận hủy không bị khóa nên bấm lại được ngay (trạng thái có thời hạn có đường thoát)
  const wasLimited = useRef(false);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; setError((e) => (e?.text.startsWith('Thao tác quá nhanh') ? null : e)); } }, [limit.left]);

  const confirm = async () => {
    setBusy(true); setError(null);
    const r = await api(`/orders/${encodeURIComponent(order.code)}/cancel`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} });
    setBusy(false);
    if (r.status === 200) { setOpen(false); setReason(''); onDone(); return; }
    if (r.status === 401 && expired(r)) return;
    if (r.status === 409) setError({ text: 'Đơn không thể hủy ở trạng thái hiện tại', reload: true });
    else if (r.status === 400) setError({ text: 'Lý do tối đa 500 ký tự' });
    else if (r.status === 403) setError({ text: 'Bạn không có quyền hủy đơn này' });
    else if (r.status === 404) setError({ text: 'Không tìm thấy đơn hàng', reload: true });
    else if (r.status === 429) { limit.start(r.retryAfter); setError({ text: limitedText(r.retryAfter) }); }
    else if (r.status !== 401) setError({ text: 'Không hủy được đơn. Thử lại.' });
  };
  const close = () => { if (!busy) { setOpen(false); setError(null); } };

  return (
    <>
      <button className="btn btn-danger-soft tight" onClick={() => setOpen(true)} data-testid="ord-order-detail-cancel-button">Hủy đơn</button>
      {open && (
        <div className="backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ord-cancel-title" onKeyDown={(e) => e.key === 'Escape' && close()} data-testid="ord-order-detail-cancel-dialog">
            <h2 id="ord-cancel-title">Hủy đơn {order.code}?</h2>
            {order.status === 'paid' && <p data-testid="ord-order-detail-cancel-refund-notice">Đơn đã thanh toán: hủy sẽ hoàn tiền tự động toàn phần; xem kết quả ở màn thanh toán. Không thể hoàn tác.</p>}
            <label>Lý do (không bắt buộc)
              <textarea value={reason} maxLength={500} rows={3} disabled={busy} onChange={(e) => setReason(e.target.value)} data-testid="ord-order-detail-cancel-reason" />
            </label>
            {error && (
              <div role="alert" className="field-error" data-testid="ord-order-detail-cancel-error">
                {error.text}
                {error.reload && <> <button className="btn" onClick={() => { setOpen(false); setError(null); onReload(); }} data-testid="ord-order-detail-cancel-reload">Tải lại đơn</button></>}
              </div>
            )}
            <div className="actions">
              <button className="btn" disabled={busy} onClick={close} data-testid="ord-order-detail-cancel-dismiss">Giữ đơn</button>
              <button className="btn btn-danger tight" disabled={busy} onClick={() => void confirm()} data-testid="ord-order-detail-cancel-confirm">{busy ? 'Đang hủy...' : 'Xác nhận hủy'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function OrderDetailPage() {
  const params = useParams<{ code: string }>();
  return <RequireRole roles={['customer', 'staff', 'admin']}><OrderDetailView code={String(params.code ?? '')} /></RequireRole>;
}
