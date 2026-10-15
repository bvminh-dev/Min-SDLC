'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NotFound, Note, ShipmentBadge, Skel } from '../../../../components/ShipmentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { useCountdown } from '../../../../components/useCountdown';
import { api } from '../../../../lib/api';
import { formatOrderTime } from '../../../../lib/order';
import { useLoginRedirect } from '../../../../lib/prd';
import { historyText, type HistoryEntry, type Shipment, type ShipmentView } from '../../../../lib/shipping';
import { limitedText } from '../../../../lib/stock';

const STEPS = ['Đã tạo', 'Đang giao', 'Đã giao'];
const STEP_ICONS = ['box', 'truck', 'check'];
/** Bước hiện tại của thanh tiến trình (0 tới 2); hủy hoặc hoàn không nằm trên đường đi bình thường nên không có thanh. */
const stepOf = (s: Shipment['status']): number | null => (s === 'pending' ? 0 : s === 'shipped' || s === 'failed' ? 1 : s === 'delivered' ? 2 : null);

/** Nút Sao chép mã vận đơn: chữ đổi thành "Đã chép" đúng 2 giây rồi tự về lại (kể cả bấm liên tiếp hay rời trang). */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch { ok = false; }
    }
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };
  return <button type="button" className="btn btn-sm ps-copy" onClick={() => void copy()} data-testid="shp-shipment-tracking-copy"><span className={`i i-${state === 'copied' ? 'check' : 'copy'}`} aria-hidden="true" />{state === 'copied' ? 'Đã chép' : state === 'failed' ? 'Không chép được' : 'Sao chép'}</button>;
}

/** Theo dõi vận chuyển (ui/shipment-tracking): customer xem vận đơn của đơn mình; không thấy lý do, ghi chú, số tiền thu hộ hay người nhận. */
function Tracking({ code }: { code: string }) {
  const expired = useLoginRedirect();
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'rate'>('loading');
  const [data, setData] = useState<ShipmentView | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [histView, setHistView] = useState<'loading' | 'ready' | 'error'>('loading');
  const limit = useCountdown();
  const seq = useRef(0);
  const histSeq = useRef(0);
  const wasLimited = useRef(false);
  const base = `/shipping/orders/${encodeURIComponent(code)}/shipment`;

  const loadHistory = useCallback(async () => {
    const id = ++histSeq.current;
    setHistView('loading');
    const r = await api<{ items: HistoryEntry[] }>(`${base}/history`);
    if (id !== histSeq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setHistory(r.body.items); setHistView('ready'); } else if (!expired(r)) setHistView('error');
  }, [base]); // expired đổi mỗi lần render nên không đưa vào deps
  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    void loadHistory();
    const r = await api<ShipmentView>(base);
    if (id !== seq.current) return;
    if (r.status === 200 && typeof r.body.order_code === 'string') { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 404) setView('notfound'); // cùng một giao diện cho đơn của người khác, không tồn tại và mã sai định dạng
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [base, loadHistory]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  // Hết giờ chờ (429) thì tự tải lại; nút Thử lại bấm được ngay (trạng thái có thời hạn có đường thoát).
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  if (view === 'notfound') return <NotFound testid="shp-shipment-tracking-not-found" backTestid="shp-shipment-tracking-not-found-back" backHref="/orders" backLabel="Đơn hàng" />;
  if (view === 'loading' && !data) return <main className="page page-narrow" data-testid="shp-shipment-tracking-loading" aria-busy="true"><Skel n={3} /></main>;
  if (view === 'error' || view === 'rate' || !data) {
    return (
      <main className="page page-narrow">
        <Note tone="red" icon="alert" role="alert" testid="shp-shipment-tracking-error">
          {view === 'rate' && limit.left > 0 ? limitedText(limit.left) : 'Không tải được vận chuyển.'} <button className="btn" onClick={() => void load()} data-testid="shp-shipment-tracking-retry">Thử lại</button>
        </Note>
      </main>
    );
  }

  const s = data.shipment;
  const step = s ? stepOf(s.status) : null;
  return (
    <main className="page page-narrow">
      <Link className="back" href={`/orders/${encodeURIComponent(code)}`} data-testid="shp-shipment-tracking-back-link"><span className="i i-left" aria-hidden="true" />Đơn hàng</Link>
      <div className="page-head">
        <h1>Vận chuyển <span className="ps-code" data-testid="shp-shipment-tracking-order-code">{data.order_code}</span></h1>
        {s && <ShipmentBadge status={s.status} testid="shp-shipment-tracking-status-badge" />}
      </div>

      {!s && <div className="empty" data-testid="shp-shipment-tracking-no-shipment"><span className="tile tile-lg amber"><span className="i i-box" aria-hidden="true" /></span><strong>Đơn chưa được bàn giao cho vận chuyển.</strong></div>}
      {s && (
        <>
          {step !== null && (
            <ol className="ps-steps" data-testid="shp-shipment-tracking-stepper" data-current={step}>
              {STEPS.map((t, i) => <li key={t} className={`${i <= step ? 'step-done' : ''}${s.status === 'failed' && i === step ? ' bad' : ''}`} aria-current={i === step ? 'step' : undefined}><span className="dot"><span className={`i i-${s.status === 'failed' && i === step ? 'alert' : STEP_ICONS[i]}`} aria-hidden="true" /></span>{t}</li>)}
            </ol>
          )}
          {s.status === 'failed' && <Note tone="red" icon="alert" role="status" testid="shp-shipment-tracking-failed-notice">Giao hàng chưa thành công. Shop sẽ liên hệ với bạn.</Note>}
          {s.status === 'cancelled' && <Note icon="ban" role="status" testid="shp-shipment-tracking-closed-notice">Vận đơn đã bị hủy.</Note>}
          {s.status === 'returned' && <Note icon="undo" role="status" testid="shp-shipment-tracking-closed-notice">Hàng đã hoàn về kho.</Note>}
          <section className="ps-card">
            <dl className="kv">
              <dt>Phương thức</dt><dd data-testid="shp-shipment-tracking-method">{s.method_name}</dd>
              {s.tracking_number && <><dt>Mã vận đơn</dt><dd><span className="ps-track-no" style={{ justifyContent: 'flex-start' }}><span className="ps-code" data-testid="shp-shipment-tracking-number">{s.tracking_number}</span><CopyButton text={s.tracking_number} /></span></dd></>}
              {s.shipped_at && <><dt>Bàn giao</dt><dd className="tabular" data-testid="shp-shipment-tracking-shipped-at">{formatOrderTime(s.shipped_at)}</dd></>}
              {s.delivered_at && <><dt>Giao xong</dt><dd className="tabular" data-testid="shp-shipment-tracking-delivered-at">{formatOrderTime(s.delivered_at)}</dd></>}
            </dl>
          </section>
        </>
      )}

      <section className="ps-card" data-testid="shp-shipment-tracking-history">
        <h2><span className="i i-nav" aria-hidden="true" />Hành trình</h2>
        {histView === 'loading' && !history && <Skel n={1} />}
        {histView === 'error' && <Note tone="red" icon="alert" role="alert" testid="shp-shipment-tracking-history-error">Không tải được. <button className="btn" onClick={() => void loadHistory()} data-testid="shp-shipment-tracking-history-retry">Thử lại</button></Note>}
        {histView !== 'error' && history && history.length === 0 && <p className="ps-empty-line" data-testid="shp-shipment-tracking-history-empty">Chưa có hành trình.</p>}
        {histView !== 'error' && history && history.length > 0 && (
          <ol className="ps-tl">
            {history.map((h, k) => (
              <li key={k} data-testid="shp-shipment-tracking-history-item">
                <span className={`ps-dot ${k === history.length - 1 ? 'blue' : ''}`}><span className={`i i-${k === history.length - 1 ? 'truck' : 'check'}`} aria-hidden="true" /></span>
                <span className="body">{historyText(h, true)}<span className="ps-time" data-testid="shp-shipment-tracking-history-time">{formatOrderTime(h.at)}</span></span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

export default function ShipmentTrackingPage() {
  const params = useParams<{ code: string }>();
  return <RequireRole roles={['customer']}><Tracking code={String(params.code ?? '')} /></RequireRole>;
}
