'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Forbidden, Modal, NotFound, ShipmentBadge, ToastView, useCall, useToast, type Err } from '../../../../components/ShipmentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { useCountdown } from '../../../../components/useCountdown';
import { api, type ApiResult } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { formatPrice } from '../../../../lib/format';
import { formatOrderTime } from '../../../../lib/order';
import { useLoginRedirect } from '../../../../lib/prd';
import { FAIL_REASONS, failReasonText, historyText, listHref, upperTracking, type HistoryEntry, type ShipmentView } from '../../../../lib/shipping';
import { limitedText } from '../../../../lib/stock';

const P = 'shp-shipment-admin-detail';
const FORMAT_MSG = 'Mã gồm 8 tới 30 ký tự chữ, số hoặc gạch nối';
const NOTE_MAX = 300;

/** Lỗi chung của mọi thao tác; `specific` xử lý mã riêng của từng hộp thoại trước. */
const baseError = (r: ApiResult, specific?: (r: ApiResult) => Err | null): Err =>
  specific?.(r)
  ?? (r.code === 'shipment-invalid-transition' ? { text: 'Vận đơn đã đổi trạng thái', reload: true }
    : r.code === 'order-not-shippable' ? { text: 'Đơn đã bị hủy hoặc không còn sẵn sàng giao', reload: true }
    : r.status === 403 ? { text: 'Bạn không có quyền thực hiện thao tác này' }
    : r.status === 404 ? { text: 'Không tìm thấy đơn hàng', reload: true }
    : { text: 'Không thực hiện được. Thử lại.' });

type Done = (toast: { text: string; testid: string }) => void;
interface DlgProps { code: string; onDone: Done; onClose: () => void; onReload: () => void }

/** Bàn giao và Sửa mã dùng cùng khuôn: một ô mã vận đơn (tự đổi sang chữ hoa), có ô nhập nên bấm ra ngoài không đóng (luật I20). */
function TrackingDialog({ code, mode, current, version, onDone, onClose, onReload }: DlgProps & { mode: 'ship' | 'edit'; current?: string; version?: number }) {
  const ship = mode === 'ship';
  const t = ship ? `${P}-ship` : `${P}-edit`;
  const [value, setValue] = useState(current ?? '');
  const { busy, err, rateText, call } = useCall();
  const trimmed = value.trim();
  const submit = async () => {
    const r = await call(`/shipping/orders/${encodeURIComponent(code)}/shipment/${ship ? 'ship' : 'tracking-number'}`, ship ? 'POST' : 'PATCH', ship ? { tracking_number: trimmed } : { tracking_number: trimmed, version },
      (x) => baseError(x, (y) => {
        if (y.status === 400) return { text: FORMAT_MSG, field: true };
        if (y.code === 'tracking-number-taken') return { text: ship ? 'Mã này đã được dùng cho vận đơn khác' : 'Mã này đã được dùng', field: true };
        if (y.code === 'tracking-number-unchanged') return { text: 'Mã không thay đổi', field: true };
        if (y.code === 'version-conflict') return { text: 'Vận đơn đã được người khác cập nhật', reload: true };
        return null;
      }));
    if (r) { onClose(); onDone(ship ? { text: 'Đã bàn giao', testid: `${P}-toast-shipped` } : { text: 'Đã lưu mã vận đơn', testid: `${P}-toast-tracking` }); }
  };
  const msg = rateText ?? err?.text;
  const inline = !rateText && err?.field;
  return (
    <Modal title={ship ? 'Bàn giao vận đơn' : 'Sửa mã vận đơn'} testid={`${t}-form`} sticky onClose={() => !busy && onClose()}>
      <label>{ship ? 'Mã vận đơn' : 'Mã vận đơn mới'}
        <input value={value} autoFocus disabled={busy} autoComplete="off" onChange={(e) => setValue(upperTracking(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && trimmed && !busy && void submit()} data-testid={`${t}-${ship ? 'tracking-input' : 'input'}`} />
      </label>
      {msg && inline && <p role="alert" className="field-error" data-testid={`${t}-error`}>{msg}</p>}
      {msg && !inline && (
        <div role="alert" className="field-error" data-testid={ship ? `${t}-blocked` : `${t}-error`}>
          {msg}
          {err?.reload && !rateText && <> <button type="button" className="btn" onClick={onReload} data-testid={ship ? `${P}-result-reload` : `${t}-reload`}>Tải lại vận đơn</button></>}
        </div>
      )}
      {busy && ship && <p className="hint" role="status" data-testid={`${t}-loading`}>Đang bàn giao...</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${t}-cancel`}>Hủy</button>
        <button type="button" className="btn btn-primary tight" disabled={busy || !trimmed || (!ship && trimmed === current)} onClick={() => void submit()} data-testid={ship ? `${t}-confirm` : `${t}-save`}>{ship ? 'Bàn giao' : 'Lưu mã'}</button>
      </div>
    </Modal>
  );
}

/** Giao xong, Giao thất bại, Hàng đã về kho: kết quả giao. Hộp xác nhận không có ô nhập đóng được khi bấm ra ngoài; hộp thất bại có ô nhập nên không. */
function ResultDialog({ code, kind, onDone, onClose, onReload }: DlgProps & { kind: 'deliver' | 'fail' | 'return' }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const { busy, err, rateText, call } = useCall();
  const over = note.length > NOTE_MAX;
  const submit = async () => {
    const body = kind === 'fail' ? { reason_code: reason, ...(note.trim() ? { note: note.trim() } : {}) } : {};
    const r = await call(`/shipping/orders/${encodeURIComponent(code)}/shipment/${kind}`, 'POST', body, (x) => baseError(x, (y) => (y.status === 400 ? { text: 'Chọn lý do và nhập ghi chú tối đa 300 ký tự' } : null)));
    if (r) { onClose(); onDone({ text: 'Đã cập nhật vận đơn', testid: `${P}-toast-result` }); }
  };
  const msg = rateText ?? err?.text;
  const title = kind === 'deliver' ? 'Xác nhận giao xong' : kind === 'return' ? 'Xác nhận hàng về kho' : 'Giao thất bại';
  return (
    <Modal title={title} sticky={kind === 'fail'} onClose={() => !busy && onClose()}>
      {kind === 'deliver' && <p>Xác nhận đơn đã giao thành công? Không thể hoàn tác.</p>}
      {kind === 'return' && <p>Xác nhận hàng đã hoàn về kho? Không thể hoàn tác. Hàng nhập lại kho trừ khi lý do thất bại là Hàng hỏng.</p>}
      {kind === 'fail' && (
        <>
          <label>Lý do
            <select value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} data-testid={`${P}-fail-reason`}>
              <option value="">Chọn lý do</option>
              {FAIL_REASONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
          <label>Ghi chú (không bắt buộc)
            <textarea value={note} rows={3} disabled={busy} onChange={(e) => setNote(e.target.value)} data-testid={`${P}-fail-note`} />
          </label>
          <p className={over ? 'field-error' : 'hint'}>{note.length}/{NOTE_MAX}{over ? ' (quá dài)' : ''}</p>
        </>
      )}
      {msg && (
        <div role="alert" className="field-error" data-testid={`${P}-result-error`}>
          {msg}
          {err?.reload && !rateText && <> <button type="button" className="btn" onClick={onReload} data-testid={`${P}-result-reload`}>Tải lại vận đơn</button></>}
        </div>
      )}
      {busy && <p className="hint" role="status" data-testid={`${P}-result-loading`}>Đang cập nhật...</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-result-cancel`}>Hủy</button>
        <button type="button" className={`btn tight ${kind === 'fail' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (kind === 'fail' && (!reason || over))} onClick={() => void submit()}
          data-testid={`${P}-${kind === 'deliver' ? 'deliver-confirm' : kind === 'fail' ? 'fail-confirm' : 'return-confirm'}`}>{kind === 'fail' ? 'Xác nhận thất bại' : 'Xác nhận'}</button>
      </div>
    </Modal>
  );
}

function DetailView({ code }: { code: string }) {
  const expired = useLoginRedirect();
  const back = listHref(useSearchParams().get('back'));
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'forbidden' | 'rate'>('loading');
  const [data, setData] = useState<ShipmentView | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [histView, setHistView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dlg, setDlg] = useState<'ship' | 'edit' | 'deliver' | 'fail' | 'return' | null>(null);
  const { toast, show } = useToast();
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
    else if (r.status === 404) setView('notfound');
    else if (r.status === 403) setView('forbidden');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [base, loadHistory]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const reload = () => { setDlg(null); void load(); };
  const done: Done = (t) => { show(t); void load(); };

  if (view === 'forbidden') return <Forbidden testid={`${P}-forbidden`} />;
  if (view === 'notfound') return <NotFound testid={`${P}-not-found`} backTestid={`${P}-not-found-back`} backHref={back} backLabel="Về danh sách vận đơn" />;
  if (view === 'loading' && !data) return <main className="wide" data-testid={`${P}-loading`} aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></main>;
  if (view === 'error' || view === 'rate' || !data) {
    return (
      <main className="wide">
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>
          {view === 'rate' && limit.left > 0 ? limitedText(limit.left) : 'Không tải được vận đơn.'} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button>
        </div>
      </main>
    );
  }

  const s = data.shipment;
  const rec = s ? (s.recipient ?? data.recipient ?? null) : null;
  const actions = !s ? [] : s.status === 'pending' ? [['ship', 'Bàn giao']] : s.status === 'shipped' ? [['deliver', 'Giao xong'], ['fail', 'Giao thất bại'], ['edit', 'Sửa mã vận đơn']] : s.status === 'failed' ? [['return', 'Hàng đã về kho']] : [];
  const actionId: Record<string, string> = { ship: 'ship', deliver: 'deliver', fail: 'fail', edit: 'edit-tracking', return: 'return' };
  return (
    <main className="wide">
      <p><Link href={back} data-testid={`${P}-back-link`}>← Quay lại danh sách</Link></p>
      <header className="row-link">
        <h1>Vận đơn đơn <span className="mono" data-testid={`${P}-order-code`}>{data.order_code}</span></h1>
        {s && <ShipmentBadge status={s.status} testid={`${P}-status-badge`} />}
      </header>
      {!s && <p className="hint" data-testid={`${P}-no-shipment`}>Đơn này chưa có vận đơn.</p>}
      {actions.length > 0 && (
        <div className="actions-row">
          {actions.map(([k, label]) => <button key={k} type="button" className={`btn tight${k === 'ship' ? ' btn-current' : ''}`} onClick={() => setDlg(k as typeof dlg)} data-testid={`${P}-${actionId[k]}`}>{label}</button>)}
        </div>
      )}

      <div className="cols">
        <section className="card-block" data-testid={`${P}-history`}>
          <h2>Hành trình</h2>
          {histView === 'loading' && !history && <div aria-busy="true"><div className="skeleton" /></div>}
          {histView === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-history-error`}>Không tải được lịch sử. <button className="btn" onClick={() => void loadHistory()} data-testid={`${P}-history-retry`}>Thử lại</button></div>}
          {histView !== 'error' && history && history.length === 0 && <p className="hint" data-testid={`${P}-history-empty`}>Chưa có lịch sử.</p>}
          {histView !== 'error' && history && history.length > 0 && (
            <ol className="timeline">
              {history.map((h, k) => (
                <li key={k} data-testid={`${P}-history-item`}>
                  <span className="hint tabular" data-testid={`${P}-history-time`}>{formatOrderTime(h.at)}</span> {historyText(h, false)}
                  {h.event === 'status_changed' && h.status === 'failed' && (h.reason_code || h.note) && (
                    <> · <span className="pre" data-testid={`${P}-history-reason`}>{[h.reason_code ? failReasonText(h.reason_code) : '', h.note ?? ''].filter(Boolean).join(' · ')}</span></>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {s && (
          <aside>
            <section className="card-block">
              <h2>Người nhận</h2>
              {rec
                ? <div data-testid={`${P}-recipient`}><p>{rec.receiver}</p><p>{rec.phone}</p><p>{rec.line1}, {rec.ward}, {rec.city}</p></div>
                : <p className="hint" data-testid={`${P}-recipient-hidden`}>Thông tin người nhận được ẩn theo chính sách dữ liệu</p>}
            </section>
            <section className="card-block">
              <h2>Vận chuyển</h2>
              <p data-testid={`${P}-method`}>{s.method_name}</p>
              {s.tracking_number && <p>Mã vận đơn <span className="mono" data-testid={`${P}-tracking`}>{s.tracking_number}</span></p>}
              {typeof s.cod_amount === 'number' && s.cod_amount > 0 && <p data-testid={`${P}-cod`}>Thu hộ (COD) <span className="tabular">{formatPrice(s.cod_amount)}</span></p>}
              {s.shipped_at && <p>Bàn giao <span className="tabular" data-testid={`${P}-shipped-at`}>{formatOrderTime(s.shipped_at)}</span></p>}
              {s.delivered_at && <p>Giao xong <span className="tabular" data-testid={`${P}-delivered-at`}>{formatOrderTime(s.delivered_at)}</span></p>}
            </section>
          </aside>
        )}
      </div>

      {s && dlg === 'ship' && <TrackingDialog mode="ship" code={code} onDone={done} onClose={() => setDlg(null)} onReload={reload} />}
      {s && dlg === 'edit' && <TrackingDialog mode="edit" code={code} current={s.tracking_number ?? ''} version={s.version} onDone={done} onClose={() => setDlg(null)} onReload={reload} />}
      {s && (dlg === 'deliver' || dlg === 'fail' || dlg === 'return') && <ResultDialog kind={dlg} code={code} onDone={done} onClose={() => setDlg(null)} onReload={reload} />}
      <ToastView toast={toast} />
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  const params = useParams<{ code: string }>();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><DetailView code={String(params.code ?? '')} /></Suspense>;
}

export default function AdminShipmentDetailPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
