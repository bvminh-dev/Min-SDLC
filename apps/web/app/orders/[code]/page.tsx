'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '../../../lib/format';
import { ORDER_STATUS_LABEL, formatClock, formatOrderTime, paymentText, reasonText, type HistoryItem, type OrderDetail, type OrderStatus } from '../../../lib/order';
import { useLoginRedirect } from '../../../lib/prd';
import { limitedText } from '../../../lib/stock';
import { SkLines, SkPanel, SkRows } from '../../../components/Skeleton';

/** Vị trí trên thanh tiến trình (Đặt, Thanh toán, Giao, Nhận); -1 = đơn đã hủy/hết hạn, không vẽ thanh. */
const STAGE: Record<OrderStatus, number> = { pending: 0, confirmed: 0, paid: 1, shipped: 2, delivered: 3, returned: 3, cancelled: -1, expired: -1 };
const STEPS: [string, string][] = [['receipt', 'Đặt'], ['card', 'Thanh toán'], ['truck', 'Giao'], ['box', 'Nhận']];
type View = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * Chi tiết đơn (ui/order-detail, ui/order-detail-source): thông tin đơn, lịch sử trạng thái (khối tải riêng, lỗi riêng) và hủy đơn (hộp thoại). Customer chỉ thấy đơn của mình; sale chỉ đơn do mình tạo (không hủy);
 * staff không thấy địa chỉ và khách; staff, sale, admin vào qua danh sách quản trị và thấy khối Thông tin bán hàng (nguồn, người tạo, ghi chú); chỉ admin thấy giá vốn. Server loại khóa theo role,
 * giao diện chỉ hiện cái server đã trả. Ghi chú là văn bản thuần: React escape, xuống dòng giữ bằng CSS (SB-12, SB-45).
 */
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
  if (view === 'loading' && !order) return <main className="page page-mid" data-testid="ord-order-detail-loading" aria-busy="true"><SkPanel n={3} /><SkRows n={3} lead="square" lines={3} trail /><SkPanel n={3} /></main>;
  if (view === 'notfound') {
    return (
      <main className="page page-narrow">
        <section className="panel empty" data-testid="ord-order-detail-notfound">
          <span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span>
          <h1>Không thấy đơn</h1>
          <p>Đơn không tồn tại hoặc bạn không có quyền xem.</p>
          <Link className="btn btn-primary tight" href={back} data-testid="ord-order-detail-notfound-back">Về danh sách</Link>
        </section>
      </main>
    );
  }
  if (view === 'error' || !order) {
    return <main className="page page-mid"><div role="alert" className="banner banner-error" data-testid="ord-order-detail-error">Không tải được đơn. <button className="btn" onClick={() => void load()} data-testid="ord-order-detail-retry">Thử lại</button></div></main>;
  }

  const customer = user?.role === 'customer';
  const stage = STAGE[order.status];
  // dòng "shipped" thứ hai trở đi trong lịch sử là giao thất bại (ORD-API: `status` = shipped lần thứ hai kèm mã lý do)
  let shippedSeen = false;
  const rows = (history ?? []).map((h) => { const failed = h.status === 'shipped' && shippedSeen; if (h.status === 'shipped') shippedSeen = true; return { ...h, failed }; });
  const addr = order.shipping_address;
  const payTone = order.payment_status === 'succeeded' ? 'green' : order.payment_status === 'pending' || order.payment_status === 'processing' ? 'amber' : order.payment_status === 'failed' ? 'red' : 'gray';
  const payTile = (
    <>
      <span className={`tile ${payTone}`}><span className="i i-card" aria-hidden="true" /></span>
      <span className="ord-tile-text"><b>{paymentText(order.payment_method, order.payment_status)}</b>{order.payment_expires_at && <span className="muted small" data-testid="ord-order-detail-payment-expires"><span className="i i-clock" aria-hidden="true" /> {formatClock(order.payment_expires_at)}</span>}</span>
    </>
  );
  return (
    <main className="page page-mid">
      <Link className="back" href={back} data-testid="ord-order-detail-back-link"><span className="i i-left" aria-hidden="true" />Đơn hàng</Link>
      <div className="page-head">
        <h1>Đơn <span className="mono ord-h-code" data-testid="ord-order-detail-code">{order.code}</span></h1>
        <div className="actions">
          <span className="badge" data-status={order.status} data-testid="ord-order-detail-status-badge">{ORDER_STATUS_LABEL[order.status]}</span>
          <span className="muted small" data-testid="ord-order-detail-created-at">{formatOrderTime(order.created_at)}</span>
          {order.can_cancel && <CancelDialogButton order={order} onDone={() => { setCancelled(true); void load(); }} onReload={() => void load()} />}
        </div>
      </div>
      {cancelled && <div role="status" className="banner banner-ok" data-testid="ord-order-detail-cancel-success">Đã hủy đơn</div>}

      {stage >= 0 && (
        <ol className="ord-steps" aria-label="Tiến trình">
          {STEPS.map(([icon, label], k) => <li key={label} className={k <= stage ? 'done' : ''} aria-current={k === stage ? 'step' : undefined}><span className="tile"><span className={`i i-${k < stage ? 'check' : icon}`} aria-hidden="true" /></span><span className="small">{label}</span></li>)}
        </ol>
      )}

      <div className="split">
        <div className="stack">
          <section className="panel" data-testid="ord-order-detail-items">
            <div className="panel-head"><h2><span className="i i-bag" aria-hidden="true" />Sản phẩm</h2></div>
            <ul className="list">
              {order.items.map((i, k) => (
                <li key={k}>
                  <span className="tile gray"><span className="i i-box" aria-hidden="true" /></span>
                  <div className="grow">
                    <div className="strong">{i.name}</div><div className="muted small">{formatPrice(i.unit_price)} × {i.quantity}</div>
                    {i.note && <div className="small ord-note" data-testid="ord-order-detail-source-item-note">Ghi chú: {i.note}</div>}
                  </div>
                  <span className="money">{formatPrice(i.line_total)}{i.cost_snapshot !== undefined && <span className="muted small ord-cost" data-testid="ord-order-detail-source-cost">Giá vốn {i.cost_snapshot === null ? '—' : formatPrice(i.cost_snapshot)}</span>}</span>
                </li>
              ))}
            </ul>
            <dl className="kv ord-totals" data-testid="ord-order-detail-totals">
              <dt>Tạm tính</dt><dd className="right">{formatPrice(order.items_total)}</dd>
              <dt>Giảm giá</dt><dd className="right">{formatPrice(order.discount)}</dd>
              <dt>Giao hàng</dt><dd className="right">{formatPrice(order.shipping_fee)}</dd>
              <dt className="strong">Tổng</dt><dd className="right money ord-grand">{formatPrice(order.grand_total)}</dd>
            </dl>
          </section>

          <section className="panel" data-testid="ord-order-detail-history">
            <div className="panel-head"><h2><span className="i i-clock" aria-hidden="true" />Lịch sử</h2></div>
            {histView === 'loading' && !history && <SkLines n={3} />}
            {histView === 'error' && <div role="alert" className="banner banner-error" data-testid="ord-order-detail-history-error">Không tải được lịch sử. <button className="btn" onClick={() => void loadHistory()} data-testid="ord-order-detail-history-retry">Thử lại</button></div>}
            {histView === 'ready' && (
              <ol className="ord-tl">
                {rows.map((h, k) => (
                  <li key={k} data-testid="ord-order-detail-history-item" className={h.failed || h.status === 'cancelled' ? 'bad' : ''}>
                    <b>{h.failed ? 'Giao thất bại' : ORDER_STATUS_LABEL[h.status]}</b> <span className="muted small">{formatOrderTime(h.at)}</span>
                    {h.reason && <div className="muted small" data-testid="ord-order-detail-history-reason">{reasonText(h.status, h.reason, h.failed)}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2><span className="i i-pin" aria-hidden="true" />Nhận hàng</h2></div>
            {addr
              ? <div className="ord-addr" data-testid="ord-order-detail-address"><b>{addr.receiver}</b><span className="muted"><span className="i i-phone" aria-hidden="true" /> {addr.phone}</span><span className="muted">{[addr.line1, addr.ward, addr.district, addr.city].filter(Boolean).join(', ')}</span></div>
              : <p className="muted small" data-testid="ord-order-detail-address-hidden"><span className="i i-eyeoff" aria-hidden="true" /> Thông tin người nhận được ẩn theo chính sách dữ liệu</p>}
          </section>

          {order.source && (
            <section className="panel" data-testid="ord-order-detail-source-block">
              <div className="panel-head"><h2><span className="i i-bag" aria-hidden="true" />Thông tin bán hàng</h2></div>
              <dl className="kv">
                <dt>Nguồn</dt><dd data-testid="ord-order-detail-source-name">{order.source.name}</dd>
                <dt>Người tạo</dt><dd data-testid="ord-order-detail-source-creator">{order.created_by_name ?? '—'}</dd>
                {order.customer && <><dt>Khách</dt><dd data-testid="ord-order-detail-source-customer">{order.customer.full_name} · {order.customer.phone}</dd></>}
                {user?.role === 'staff' && (order.created_by_name != null || order.source.code !== 'website') && <><dt>Khách</dt><dd className="muted small" data-testid="ord-order-detail-source-customer-hidden"><span className="i i-eyeoff" aria-hidden="true" /> Thông tin khách được ẩn theo chính sách dữ liệu</dd></>}
                <dt>Ghi chú đơn</dt><dd className="ord-note" data-testid="ord-order-detail-source-note">{order.note ? order.note : '—'}</dd>
              </dl>
            </section>
          )}

          <section data-testid="ord-order-detail-payment">
            {customer
              ? <Link className="ord-tile" href={`/orders/${order.code}/payment`} data-testid="ord-order-detail-payment-link" aria-label="Xem thanh toán">{payTile}<span className="i i-right" aria-hidden="true" /></Link>
              : <div className="ord-tile">{payTile}</div>}
          </section>

          {order.tracking_number && (customer
            ? <Link className="ord-tile" href={`/orders/${order.code}/shipment`} data-testid="ord-order-detail-tracking-link" aria-label="Theo dõi vận chuyển"><span className="tile"><span className="i i-truck" aria-hidden="true" /></span><span className="ord-tile-text"><b className="mono" data-testid="ord-order-detail-tracking">{order.tracking_number}</b></span><span className="i i-right" aria-hidden="true" /></Link>
            : <div className="ord-tile"><span className="tile"><span className="i i-truck" aria-hidden="true" /></span><span className="ord-tile-text"><b className="mono" data-testid="ord-order-detail-tracking">{order.tracking_number}</b></span></div>)}
        </div>
      </div>
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
      <button className="btn btn-danger-soft btn-sm tight" onClick={() => setOpen(true)} data-testid="ord-order-detail-cancel-button"><span className="i i-ban" aria-hidden="true" />Hủy đơn</button>
      {open && (
        <div className="backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ord-cancel-title" onKeyDown={(e) => e.key === 'Escape' && close()} data-testid="ord-order-detail-cancel-dialog">
            <div className="dlg-head"><span className="tile red"><span className="i i-ban" aria-hidden="true" /></span><h2 id="ord-cancel-title">Hủy đơn {order.code}?</h2></div>
            {order.status === 'paid' && <p data-testid="ord-order-detail-cancel-refund-notice">Đã thanh toán: hoàn tiền toàn phần, không hoàn tác.</p>}
            <label>Lý do
              <textarea value={reason} maxLength={500} rows={3} disabled={busy} placeholder="Không bắt buộc" onChange={(e) => setReason(e.target.value)} data-testid="ord-order-detail-cancel-reason" />
            </label>
            {error && (
              <div role="alert" className="field-error" data-testid="ord-order-detail-cancel-error">
                {error.text}
                {error.reload && <> <button className="btn btn-sm" onClick={() => { setOpen(false); setError(null); onReload(); }} data-testid="ord-order-detail-cancel-reload">Tải lại</button></>}
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
  return <RequireRole roles={['customer', 'staff', 'sale', 'admin']}><OrderDetailView code={String(params.code ?? '')} /></RequireRole>;
}
