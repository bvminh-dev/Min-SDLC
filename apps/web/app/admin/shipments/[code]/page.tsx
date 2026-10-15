'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Forbidden, Modal, NotFound, Note, ShipmentBadge, Skel, ToastView, useCall, useToast, type Err } from '../../../../components/ShipmentParts';
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
const STEPS = ['Đã tạo', 'Đang giao', 'Đã giao'];
const STEP_ICONS = ['box', 'truck', 'check'];
const stepOf = (st: string): number | null => (st === 'pending' ? 0 : st === 'shipped' || st === 'failed' ? 1 : st === 'delivered' ? 2 : null);

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
    <Modal title={ship ? 'Bàn giao' : 'Sửa mã vận đơn'} icon="truck" tone={ship ? '' : 'violet'} testid={`${t}-form`} sticky onClose={() => !busy && onClose()}>
      <div className="ps-form">
        <label>{ship ? 'Mã vận đơn' : 'Mã mới'}
          <input value={value} autoFocus disabled={busy} autoComplete="off" onChange={(e) => setValue(upperTracking(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && trimmed && !busy && void submit()} data-testid={`${t}-${ship ? 'tracking-input' : 'input'}`} />
        </label>
      </div>
      {msg && inline && <p role="alert" className="field-error" data-testid={`${t}-error`}><span className="i i-alert" aria-hidden="true" />{msg}</p>}
      {msg && !inline && (
        <div role="alert" className="field-error" data-testid={ship ? `${t}-blocked` : `${t}-error`}>
          <span className="i i-alert" aria-hidden="true" />{msg}
          {err?.reload && !rateText && <> <button type="button" className="btn btn-sm" onClick={onReload} data-testid={ship ? `${P}-result-reload` : `${t}-reload`}>Tải lại</button></>}
        </div>
      )}
      {busy && ship && <p className="muted small" style={{ margin: 0 }} role="status" data-testid={`${t}-loading`}>Đang bàn giao...</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${t}-cancel`}>Hủy</button>
        <button type="button" className="btn btn-primary tight" disabled={busy || !trimmed || (!ship && trimmed === current)} onClick={() => void submit()} data-testid={ship ? `${t}-confirm` : `${t}-save`}>{ship ? 'Bàn giao' : 'Lưu'}</button>
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
  const title = kind === 'deliver' ? 'Giao xong' : kind === 'return' ? 'Hàng về kho' : 'Giao thất bại';
  return (
    <Modal title={title} icon={kind === 'deliver' ? 'check' : kind === 'return' ? 'undo' : 'alert'} tone={kind === 'deliver' ? 'green' : kind === 'return' ? 'violet' : 'red'} sticky={kind === 'fail'} onClose={() => !busy && onClose()}>
      {kind === 'deliver' && <p className="ps-sub">Đơn đã giao thành công? Không hoàn tác được.</p>}
      {kind === 'return' && <p className="ps-sub">Hàng đã về kho? Không hoàn tác được. Hàng nhập lại kho trừ khi lý do là Hàng hỏng.</p>}
      {kind === 'fail' && (
        <div className="ps-form">
          <label>Lý do
            <select value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} data-testid={`${P}-fail-reason`}>
              <option value="">Chọn lý do</option>
              {FAIL_REASONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
          <label>Ghi chú <span className="opt">(tùy chọn)</span>
            <textarea value={note} rows={3} disabled={busy} onChange={(e) => setNote(e.target.value)} data-testid={`${P}-fail-note`} />
          </label>
          <p className={`ps-ctr${over ? ' over' : ''}`}>{note.length}/{NOTE_MAX}</p>
        </div>
      )}
      {msg && (
        <div role="alert" className="field-error" data-testid={`${P}-result-error`}>
          <span className="i i-alert" aria-hidden="true" />{msg}
          {err?.reload && !rateText && <> <button type="button" className="btn btn-sm" onClick={onReload} data-testid={`${P}-result-reload`}>Tải lại</button></>}
        </div>
      )}
      {busy && <p className="muted small" style={{ margin: 0 }} role="status" data-testid={`${P}-result-loading`}>Đang cập nhật...</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-result-cancel`}>Hủy</button>
        <button type="button" className={`btn tight ${kind === 'fail' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (kind === 'fail' && (!reason || over))} onClick={() => void submit()}
          data-testid={`${P}-${kind === 'deliver' ? 'deliver-confirm' : kind === 'fail' ? 'fail-confirm' : 'return-confirm'}`}>Xác nhận</button>
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
  if (view === 'notfound') return <NotFound testid={`${P}-not-found`} backTestid={`${P}-not-found-back`} backHref={back} backLabel="Vận đơn" />;
  if (view === 'loading' && !data) return <main className="page" data-testid={`${P}-loading`} aria-busy="true"><Skel n={3} /></main>;
  if (view === 'error' || view === 'rate' || !data) {
    return (
      <main className="page">
        <Note tone="red" icon="alert" role="alert" testid={`${P}-error`}>
          {view === 'rate' && limit.left > 0 ? limitedText(limit.left) : 'Không tải được vận đơn.'} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button>
        </Note>
      </main>
    );
  }

  const s = data.shipment;
  const rec = s ? (s.recipient ?? data.recipient ?? null) : null;
  const actions = !s ? [] : s.status === 'pending' ? [['ship', 'Bàn giao']] : s.status === 'shipped' ? [['deliver', 'Giao xong'], ['fail', 'Giao thất bại'], ['edit', 'Sửa mã']] : s.status === 'failed' ? [['return', 'Về kho']] : [];
  const actionId: Record<string, string> = { ship: 'ship', deliver: 'deliver', fail: 'fail', edit: 'edit-tracking', return: 'return' };
  const actionStyle: Record<string, [string, string]> = { ship: ['btn btn-primary tight', 'truck'], deliver: ['btn btn-primary tight', 'check'], fail: ['btn btn-danger-soft tight', 'alert'], edit: ['btn tight', 'pencil'], return: ['btn btn-primary tight', 'undo'] };
  const step = s ? stepOf(s.status) : null;
  return (
    <main className="page">
      <Link className="back" href={back} data-testid={`${P}-back-link`}><span className="i i-left" aria-hidden="true" />Vận đơn</Link>
      <div className="ps-hero">
        <div className="ps-hero-main">
          <h1>Đơn <span className="ps-code" data-testid={`${P}-order-code`}>{data.order_code}</span>{s && <ShipmentBadge status={s.status} testid={`${P}-status-badge`} />}</h1>
          {s?.tracking_number && <div className="sub"><span className="i i-tag" aria-hidden="true" style={{ width: '1rem', height: '1rem' }} /><span className="ps-code" data-testid={`${P}-tracking`}>{s.tracking_number}</span></div>}
        </div>
        {actions.length > 0 && (
          <div className="ps-actions" style={{ margin: 0 }}>
            {actions.map(([k, label]) => <button key={k} type="button" className={actionStyle[k][0]} onClick={() => setDlg(k as typeof dlg)} data-testid={`${P}-${actionId[k]}`}><span className={`i i-${actionStyle[k][1]}`} aria-hidden="true" />{label}</button>)}
          </div>
        )}
      </div>
      {!s && <div className="empty" data-testid={`${P}-no-shipment`}><span className="tile tile-lg gray"><span className="i i-box" aria-hidden="true" /></span><strong>Chưa có vận đơn</strong></div>}
      {step !== null && (
        <ol className="ps-steps">
          {STEPS.map((t, i) => <li key={t} className={`${i <= step ? 'step-done' : ''}${s?.status === 'failed' && i === step ? ' bad' : ''}`} aria-current={i === step ? 'step' : undefined}><span className="dot"><span className={`i i-${s?.status === 'failed' && i === step ? 'alert' : STEP_ICONS[i]}`} aria-hidden="true" /></span>{t}</li>)}
        </ol>
      )}

      <div className="ps-cols">
        <section className="ps-card" data-testid={`${P}-history`}>
          <h2><span className="i i-nav" aria-hidden="true" />Hành trình</h2>
          {histView === 'loading' && !history && <Skel n={1} />}
          {histView === 'error' && <Note tone="red" icon="alert" role="alert" testid={`${P}-history-error`}>Không tải được. <button className="btn" onClick={() => void loadHistory()} data-testid={`${P}-history-retry`}>Thử lại</button></Note>}
          {histView !== 'error' && history && history.length === 0 && <p className="ps-empty-line" data-testid={`${P}-history-empty`}>Chưa có lịch sử.</p>}
          {histView !== 'error' && history && history.length > 0 && (
            <ol className="ps-tl">
              {history.map((h, k) => {
                const bad = h.event === 'status_changed' && h.status === 'failed';
                return (
                  <li key={k} data-testid={`${P}-history-item`}>
                    <span className={`ps-dot ${bad ? 'red' : k === history.length - 1 ? 'blue' : ''}`}><span className={`i i-${bad ? 'alert' : k === history.length - 1 ? 'truck' : 'check'}`} aria-hidden="true" /></span>
                    <span className="body">
                      {historyText(h, false)}
                      {bad && (h.reason_code || h.note) && (
                        <> · <span className="pre" data-testid={`${P}-history-reason`}>{[h.reason_code ? failReasonText(h.reason_code) : '', h.note ?? ''].filter(Boolean).join(' · ')}</span></>
                      )}
                      <span className="ps-time" data-testid={`${P}-history-time`}>{formatOrderTime(h.at)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {s && (
          <aside className="ps-col">
            <section className="ps-card">
              <h2><span className="i i-user" aria-hidden="true" />Người nhận</h2>
              {rec
                ? <div className="ps-person" data-testid={`${P}-recipient`}><div><span className="i i-user" aria-hidden="true" /><span>{rec.receiver}</span></div><div><span className="i i-phone" aria-hidden="true" /><span>{rec.phone}</span></div><div><span className="i i-pin" aria-hidden="true" /><span>{rec.line1}, {rec.ward}, {rec.city}</span></div></div>
                : <p className="ps-empty-line" data-testid={`${P}-recipient-hidden`}>Thông tin người nhận được ẩn theo chính sách dữ liệu</p>}
            </section>
            <section className="ps-card">
              <h2><span className="i i-truck" aria-hidden="true" />Vận chuyển</h2>
              <dl className="kv">
                <dt>Phương thức</dt><dd data-testid={`${P}-method`}>{s.method_name}</dd>
                {typeof s.cod_amount === 'number' && s.cod_amount > 0 && <><dt>COD</dt><dd className="money" data-testid={`${P}-cod`}>{formatPrice(s.cod_amount)}</dd></>}
                {s.shipped_at && <><dt>Bàn giao</dt><dd className="tabular" data-testid={`${P}-shipped-at`}>{formatOrderTime(s.shipped_at)}</dd></>}
                {s.delivered_at && <><dt>Giao xong</dt><dd className="tabular" data-testid={`${P}-delivered-at`}>{formatOrderTime(s.delivered_at)}</dd></>}
              </dl>
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
  return <Suspense fallback={<main className="page"><Skel n={1} /></main>}><DetailView code={String(params.code ?? '')} /></Suspense>;
}

export default function AdminShipmentDetailPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
