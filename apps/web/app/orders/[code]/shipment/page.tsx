'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NotFound, ShipmentBadge } from '../../../../components/ShipmentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { useCountdown } from '../../../../components/useCountdown';
import { api } from '../../../../lib/api';
import { formatOrderTime } from '../../../../lib/order';
import { useLoginRedirect } from '../../../../lib/prd';
import { historyText, type HistoryEntry, type Shipment, type ShipmentView } from '../../../../lib/shipping';
import { limitedText } from '../../../../lib/stock';

const STEPS = ['Đã tạo', 'Đang giao', 'Đã giao'];
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
  return <button type="button" className="btn tight" onClick={() => void copy()} data-testid="shp-shipment-tracking-copy">{state === 'copied' ? 'Đã chép' : state === 'failed' ? 'Không chép được' : 'Sao chép'}</button>;
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

  if (view === 'notfound') return <NotFound testid="shp-shipment-tracking-not-found" backTestid="shp-shipment-tracking-not-found-back" backHref="/orders" backLabel="Về danh sách đơn hàng" />;
  if (view === 'loading' && !data) return <main className="wide" data-testid="shp-shipment-tracking-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></main>;
  if (view === 'error' || view === 'rate' || !data) {
    return (
      <main className="wide">
        <div role="alert" className="banner banner-error" data-testid="shp-shipment-tracking-error">
          {view === 'rate' && limit.left > 0 ? limitedText(limit.left) : 'Không tải được thông tin vận chuyển.'} <button className="btn" onClick={() => void load()} data-testid="shp-shipment-tracking-retry">Thử lại</button>
        </div>
      </main>
    );
  }

  const s = data.shipment;
  const step = s ? stepOf(s.status) : null;
  return (
    <main className="wide">
      <p><Link href={`/orders/${encodeURIComponent(code)}`} data-testid="shp-shipment-tracking-back-link">← Quay lại đơn hàng</Link></p>
      <header className="row-link">
        <h1>Vận chuyển đơn <span className="mono" data-testid="shp-shipment-tracking-order-code">{data.order_code}</span></h1>
        {s && <ShipmentBadge status={s.status} testid="shp-shipment-tracking-status-badge" />}
      </header>

      {!s && <p className="hint" data-testid="shp-shipment-tracking-no-shipment">Đơn chưa được bàn giao cho vận chuyển.</p>}
      {s && (
        <>
          {step !== null && (
            <ol className="stepper" data-testid="shp-shipment-tracking-stepper" data-current={step}>
              {STEPS.map((t, i) => <li key={t} className={i <= step ? 'step-done' : ''} aria-current={i === step ? 'step' : undefined}>{t}</li>)}
            </ol>
          )}
          {s.status === 'failed' && <div role="status" className="banner banner-info" data-testid="shp-shipment-tracking-failed-notice">Giao hàng chưa thành công. Shop sẽ liên hệ với bạn.</div>}
          {s.status === 'cancelled' && <div role="status" className="banner banner-info" data-testid="shp-shipment-tracking-closed-notice">Vận đơn đã bị hủy.</div>}
          {s.status === 'returned' && <div role="status" className="banner banner-info" data-testid="shp-shipment-tracking-closed-notice">Hàng đã hoàn về kho.</div>}
          <section className="card-block">
            <h2>Thông tin</h2>
            <dl className="view-fields">
              <dt>Phương thức</dt><dd data-testid="shp-shipment-tracking-method">{s.method_name}</dd>
              {s.tracking_number && <><dt>Mã vận đơn</dt><dd><span className="mono" data-testid="shp-shipment-tracking-number">{s.tracking_number}</span> <CopyButton text={s.tracking_number} /></dd></>}
              {s.shipped_at && <><dt>Bàn giao</dt><dd className="tabular" data-testid="shp-shipment-tracking-shipped-at">{formatOrderTime(s.shipped_at)}</dd></>}
              {s.delivered_at && <><dt>Giao xong</dt><dd className="tabular" data-testid="shp-shipment-tracking-delivered-at">{formatOrderTime(s.delivered_at)}</dd></>}
            </dl>
          </section>
        </>
      )}

      <section className="card-block" data-testid="shp-shipment-tracking-history">
        <h2>Hành trình</h2>
        {histView === 'loading' && !history && <div aria-busy="true"><div className="skeleton" /></div>}
        {histView === 'error' && <div role="alert" className="banner banner-error" data-testid="shp-shipment-tracking-history-error">Không tải được hành trình. <button className="btn" onClick={() => void loadHistory()} data-testid="shp-shipment-tracking-history-retry">Thử lại</button></div>}
        {histView !== 'error' && history && history.length === 0 && <p className="hint" data-testid="shp-shipment-tracking-history-empty">Chưa có hành trình.</p>}
        {histView !== 'error' && history && history.length > 0 && (
          <ol className="timeline">
            {history.map((h, k) => (
              <li key={k} data-testid="shp-shipment-tracking-history-item">
                <span className="hint tabular" data-testid="shp-shipment-tracking-history-time">{formatOrderTime(h.at)}</span> {historyText(h, true)}
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
