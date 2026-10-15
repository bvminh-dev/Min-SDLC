'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MethodTag, PayBadge, RefundBadge, Spinner, refundError, useMoney } from '../../../../components/PaymentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { Forbidden, Modal, Note, Skel, ToastView, useToast } from '../../../../components/ShipmentParts';
import { api, type ApiResult } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { formatPrice, parseMoney } from '../../../../lib/format';
import { formatOrderTime } from '../../../../lib/order';
import { attemptText, failSentence, refundReasonText, webhookResultText, type AdminPaymentDetail, type AdminRefund } from '../../../../lib/payment';
import { useLoginRedirect } from '../../../../lib/prd';
import { limitedText } from '../../../../lib/stock';

const P = 'pay-admin-payment-detail';
const NOTE_MAX = 200;
const REASON_MIN = 5;
const REASON_MAX = 300;
const POLL_MS = 2000; // sau khi gửi hoàn tiền: thăm dò chi tiết mỗi 2 giây
const POLL_MAX_MS = 60_000; // tối đa 60 giây, rồi mời kiểm tra lại

/** Hộp thoại ghi nhận thu COD (đường dự phòng của thu tự động). Có ô nhập nên bấm ra ngoài không đóng (luật I20). Ô số tiền điền sẵn số phải thu nhưng server mới kiểm khớp. */
function CodDialog({ d, onDone, onClose, onStale }: { d: AdminPaymentDetail; onDone: () => void; onClose: () => void; onStale: () => void }) {
  const [amount, setAmount] = useState(String(d.amount));
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const { busy, err, rateText, send } = useMoney();
  const submit = async () => {
    if (busy) return;
    const n = parseMoney(amount);
    if (n === null || n <= 0) { setLocal('Số tiền đã thu phải là số nguyên dương'); return; }
    if (note.length > NOTE_MAX) { setLocal(`Ghi chú tối đa ${NOTE_MAX} ký tự`); return; }
    setLocal(null);
    const r = await send(`/payments/${encodeURIComponent(d.id)}/cod-collect`, { collected_amount: n, ...(note.trim() ? { note: note.trim() } : {}) }, {
      map: (x: ApiResult) => (x.code === 'order-not-delivered' ? 'Đơn chưa được giao'
        : x.code === 'payment-already-succeeded' ? 'Thanh toán đã được ghi nhận'
        : x.code === 'payment-not-cod' ? 'Thanh toán này không phải COD'
        : x.code === 'amount-mismatch' ? `Số tiền phải đúng ${formatPrice(d.amount)}`
        : x.status === 400 ? `Dữ liệu không hợp lệ (số tiền nguyên dương, ghi chú tối đa ${NOTE_MAX} ký tự)`
        : x.status === 403 ? 'Bạn không có quyền thực hiện thao tác này'
        : x.status === 404 ? 'Không tìm thấy thanh toán'
        : 'Không thực hiện được. Thử lại.'),
    });
    if (!r) return;
    if (r.ok) { onClose(); onDone(); } else if (r.code === 'payment-already-succeeded' || r.code === 'payment-not-cod') onStale();
  };
  const msg = rateText ?? local ?? err;
  return (
    <Modal title="Ghi nhận thu COD" icon="bag" tone="green" testid={`${P}-cod-dialog`} sticky onClose={() => !busy && onClose()}>
      <p className="ps-sub">Đơn <span className="ps-code">{d.order_code}</span> · phải thu <strong data-testid={`${P}-cod-due`}>{formatPrice(d.amount)}</strong></p>
      <div className="ps-form">
        <label>Đã thu (đ)
          <input value={amount} inputMode="numeric" disabled={busy} autoComplete="off" onChange={(e) => setAmount(e.target.value)} data-testid={`${P}-cod-amount`} />
        </label>
        <label>Ghi chú <span className="opt">(tùy chọn)</span>
          <textarea value={note} rows={2} disabled={busy} onChange={(e) => setNote(e.target.value)} data-testid={`${P}-cod-note`} />
        </label>
        <p className={`ps-ctr${note.length > NOTE_MAX ? ' over' : ''}`}>{note.length}/{NOTE_MAX}</p>
      </div>
      {msg && <div role="alert" className="field-error" data-testid={`${P}-cod-error`}><span className="i i-alert" aria-hidden="true" />{msg}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-cod-dismiss`}>Hủy</button>
        <button type="button" className="btn btn-primary tight" disabled={busy} onClick={() => void submit()} data-testid={`${P}-cod-confirm`}>{busy ? <><Spinner />Đang ghi...</> : 'Đã thu'}</button>
      </div>
    </Modal>
  );
}

type RefundResult = { status?: string };
/**
 * Hộp thoại hoàn tiền (chỉ admin): `create` hoàn toàn phần cho giao dịch (ô lý do bắt buộc 5 tới 300 ký tự), `retry` thử lại chính dòng Refund thất bại (không có ô nhập).
 * Hoàn tiền không hoàn tác nên luôn có cảnh báo; nút xác nhận khóa ngay khi bấm.
 */
function RefundDialog({ d, retryOf, onDone, onClose, onStale }: { d: AdminPaymentDetail; retryOf?: AdminRefund; onDone: (status: string | undefined) => void; onClose: () => void; onStale: () => void }) {
  const retry = Boolean(retryOf);
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const { busy, err, rateText, send } = useMoney();
  const trimmed = reason.trim();
  const submit = async () => {
    if (busy) return;
    if (!retry && (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX)) { setLocal(`Lý do từ ${REASON_MIN} đến ${REASON_MAX} ký tự`); return; }
    setLocal(null);
    const r = await send(retry ? `/refunds/${encodeURIComponent(retryOf!.id)}/retry` : `/payments/${encodeURIComponent(d.id)}/refunds`, retry ? {} : { reason: trimmed }, { idem: retry ? 'retry' : trimmed, map: refundError });
    if (!r) return;
    if (r.ok) { onClose(); onDone((r.body as RefundResult)?.status); }
    else if (['refund-in-progress', 'refund-use-retry', 'payment-not-refundable', 'refund-not-retryable'].includes(r.code ?? '')) onStale();
  };
  const msg = rateText ?? local ?? err;
  const amount = formatPrice(retryOf?.amount ?? d.amount);
  return (
    <Modal title={retry ? 'Thử lại hoàn tiền' : 'Hoàn tiền'} icon="undo" tone="red" testid={`${P}-refund-dialog`} sticky={!retry} onClose={() => !busy && onClose()}>
      <p className="ps-sub"><strong>{amount}</strong> · đơn <span className="ps-code">{d.order_code}</span></p>
      <Note tone="warn" icon="alert" testid={`${P}-refund-warning`}>Không hoàn tác, không đổi trạng thái đơn.</Note>
      {!retry && (
        <div className="ps-form">
          <label>Lý do
            <textarea value={reason} rows={3} disabled={busy} onChange={(e) => setReason(e.target.value)} data-testid={`${P}-refund-reason`} />
          </label>
          <p className={`ps-ctr${reason.length > REASON_MAX ? ' over' : ''}`}>{reason.length}/{REASON_MAX}</p>
        </div>
      )}
      {msg && <div role="alert" className="field-error" data-testid={`${P}-refund-error`}><span className="i i-alert" aria-hidden="true" />{msg}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={retry ? `${P}-refund-retry-dismiss` : `${P}-refund-dismiss`}>Hủy</button>
        <button type="button" className="btn btn-danger tight" disabled={busy} onClick={() => void submit()} data-testid={retry ? `${P}-refund-retry-confirm` : `${P}-refund-confirm`}>
          {busy ? <><Spinner />Đang gửi...</> : retry ? 'Thử lại' : 'Hoàn tiền'}
        </button>
      </div>
    </Modal>
  );
}

function DetailView({ id }: { id: string }) {
  const expired = useLoginRedirect();
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const backQuery = useSearchParams().get('back');
  const backHref = `/admin/payments${backQuery ? `?${backQuery}` : ''}`;
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'forbidden'>('loading');
  const [errText, setErrText] = useState('Không tải được thanh toán.');
  const [data, setData] = useState<AdminPaymentDetail | null>(null);
  const [dlg, setDlg] = useState<{ kind: 'cod' } | { kind: 'refund'; retryOf?: AdminRefund } | null>(null);
  const [stalled, setStalled] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const { toast, show } = useToast(5000);
  const seq = useRef(0);
  const dataRef = useRef<AdminPaymentDetail | null>(null);
  const pause = useRef(0);
  dataRef.current = data;

  const load = useCallback(async () => {
    const n = ++seq.current;
    const have = dataRef.current !== null;
    if (!have) setView('loading');
    const r = await api<AdminPaymentDetail>(`/admin/payments/${encodeURIComponent(id)}`);
    if (n !== seq.current) return;
    if (r.status === 200 && typeof r.body.id === 'string') { setData(r.body); setView('ready'); return; }
    if (expired(r)) return;
    // Có dữ liệu cũ thì lần đọc hụt (mạng, 5xx) không làm mất màn; 429 tạm dừng thăm dò tới hết Retry-After.
    if (r.status === 429) pause.current = Date.now() + (r.retryAfter ?? 60) * 1000;
    if (r.status === 404) { setData(null); setView('notfound'); }
    else if (r.status === 403) setView('forbidden');
    else if (!have) { setErrText(r.status === 429 ? `${limitedText(r.retryAfter)}.` : 'Không tải được thanh toán.'); setView('error'); }
  }, [id]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  // Có Refund đang `requested`: thăm dò mỗi 2 giây tối đa 60 giây (đường thoát: dừng và hiện "Đang xử lý, kiểm tra lại sau").
  const hasRequested = data?.refunds.some((r) => r.status === 'requested') ?? false;
  useEffect(() => {
    setStalled(false);
    if (!hasRequested) return;
    const start = Date.now();
    const t = setInterval(() => {
      if (Date.now() - start >= POLL_MAX_MS) { clearInterval(t); setStalled(true); return; }
      if (Date.now() < pause.current) return;
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [hasRequested, pollKey, load]);

  if (view === 'forbidden') return <Forbidden testid={`${P}-forbidden`} />;
  if (view === 'notfound') return <main className="page page-narrow"><Link className="back" href={backHref} data-testid={`${P}-back-link`}><span className="i i-left" aria-hidden="true" />Thanh toán</Link><section className="empty" data-testid={`${P}-notfound`}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><h1>Không tìm thấy thanh toán</h1></section></main>;
  if (view === 'loading' && !data) return <main className="page" data-testid={`${P}-loading`} aria-busy="true"><Skel n={3} /></main>;
  if (view === 'error' || !data) {
    return (
      <main className="page">
        <Note tone="red" icon="alert" role="alert" testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></Note>
      </main>
    );
  }

  const d = data;
  const webhooks = [...d.webhook_logs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // cũ nhất trước (đối soát theo thứ tự xảy ra)
  const canCod = d.method === 'cod' && d.status === 'pending';
  const canRefund = admin && d.method === 'vnpay' && d.status === 'succeeded' && d.refunds.length === 0;
  const done = (text: string, error?: boolean, testid?: string) => { show({ text, testid, error }); void load(); };
  const attemptTone = (st: string) => (st === 'succeeded' ? 'green' : st === 'failed' ? 'red' : '');
  const attemptIcon = (st: string) => (st === 'succeeded' ? 'check' : st === 'failed' ? 'x' : 'clock');
  return (
    <main className="page">
      <Link className="back" href={backHref} data-testid={`${P}-back-link`}><span className="i i-left" aria-hidden="true" />Thanh toán</Link>
      <div className="ps-hero">
        <div className="ps-hero-main">
          <h1>Đơn <span className="ps-code" data-testid={`${P}-order-code`}>{d.order_code}</span><PayBadge status={d.status} method={d.method} testid={`${P}-status-badge`} /></h1>
          <div className="sub"><span className="ps-amount sm" style={{ color: 'var(--fg)' }} data-testid={`${P}-amount`}>{formatPrice(d.amount)}</span><span data-testid={`${P}-method`}><MethodTag method={d.method} /></span></div>
        </div>
        {(canCod || canRefund) && (
          <div className="ps-actions" style={{ margin: 0 }}>
            {canCod && <button type="button" className="btn btn-primary tight" onClick={() => setDlg({ kind: 'cod' })} data-testid={`${P}-cod-button`}><span className="i i-bag" aria-hidden="true" />Đã thu COD</button>}
            {canRefund && <button type="button" className="btn btn-danger-soft tight" onClick={() => setDlg({ kind: 'refund' })} data-testid={`${P}-refund-button`}><span className="i i-undo" aria-hidden="true" />Hoàn tiền</button>}
          </div>
        )}
      </div>
      {stalled && <Note tone="warn" icon="clock" role="status">Đang xử lý. <button className="btn" onClick={() => { setPollKey((k) => k + 1); void load(); }}>Kiểm tra lại</button></Note>}

      <div className="ps-cols">
        <div className="ps-col">
          <section className="ps-card" data-testid={`${P}-refund-list`}>
            <h2><span className="i i-undo" aria-hidden="true" />Hoàn tiền{d.refunds.length > 0 && <span className="n">{d.refunds.length}</span>}</h2>
            {d.refunds.length === 0 ? <p className="ps-empty-line">Chưa có</p> : (
              <ul className="ps-tl">
                {d.refunds.map((r) => (
                  <li key={r.id} data-testid={`${P}-refund-item`}>
                    <span className={`ps-dot ${r.status === 'succeeded' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}`}><span className="i i-undo" aria-hidden="true" /></span>
                    <span className="body">
                      <span className="row"><span className="money">{formatPrice(r.amount)}</span><RefundBadge status={r.status} />
                        {admin && r.status === 'failed' && d.status === 'succeeded' && <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setDlg({ kind: 'refund', retryOf: r })} data-testid={`${P}-refund-retry`}>Thử lại</button>}
                      </span>
                      {refundReasonText(r.reason)}
                      {r.auto_attempt_no != null && <span className="muted"> · tự thử {r.auto_attempt_no}</span>}
                      {r.status === 'failed' && r.failure_reason && <> · <span className="ps-code">{r.failure_reason}</span></>}
                      {r.note && <> · <span className="pre">{r.note}</span></>}
                      <span className="ps-time">{formatOrderTime(r.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="ps-card" data-testid={`${P}-attempt-list`}>
            <h2><span className="i i-refresh" aria-hidden="true" />Lượt thử{d.attempts.length > 0 && <span className="n">{d.attempts.length}</span>}</h2>
            {d.attempts.length === 0 ? <p className="ps-empty-line">Chưa có</p> : (
              <ul className="ps-tl">
                {d.attempts.map((a) => (
                  <li key={a.attempt_no} data-testid={`${P}-attempt-item`}>
                    <span className={`ps-dot ${attemptTone(a.status)}`}><span className={`i i-${attemptIcon(a.status)}`} aria-hidden="true" /></span>
                    <span className="body">
                      Lượt {a.attempt_no} · {attemptText(a)}
                      {a.status === 'failed' && !a.reason && <> · {failSentence(null)}</>}
                      {a.gateway_code && <> · mã <span className="ps-code">{a.gateway_code}</span></>}
                      {a.txn_ref && <> · <span className="ps-code muted">{a.txn_ref}</span></>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="ps-col">
          <section className="ps-card" data-testid={`${P}-info`}>
            <h2><span className="i i-info" aria-hidden="true" />Thông tin</h2>
            <dl className="kv">
              <dt>Mã cổng</dt><dd className="ps-code">{d.provider_ref || '—'}</dd>
              <dt>Khách</dt><dd className="ps-code">{d.user_id || '—'}</dd>
              {d.expires_at && <><dt>Hết hạn</dt><dd className="tabular">{formatOrderTime(d.expires_at)}</dd></>}
              {d.paid_at && <><dt>Thu lúc</dt><dd className="tabular">{formatOrderTime(d.paid_at)}</dd></>}
            </dl>
          </section>
          <section className="ps-card" data-testid={`${P}-webhook-list`}>
            <h2><span className="i i-link" aria-hidden="true" />Webhook{webhooks.length > 0 && <span className="n">{webhooks.length}</span>}</h2>
            {webhooks.length === 0 ? <p className="ps-empty-line">Chưa có</p> : (
              <ul className="ps-tl">
                {webhooks.map((w, i) => <li key={i} data-testid={`${P}-webhook-item`}><span className="ps-dot blue"><span className="i i-link" aria-hidden="true" /></span><span className="body"><span className="ps-code">{w.rsp_code}</span> · {webhookResultText(w.result)}<span className="ps-time">{formatOrderTime(w.created_at)}</span></span></li>)}
              </ul>
            )}
          </section>
        </div>
      </div>

      {dlg?.kind === 'cod' && <CodDialog d={d} onClose={() => setDlg(null)} onStale={() => void load()} onDone={() => done('Đã ghi nhận thu tiền', false, `${P}-cod-success`)} />}
      {dlg?.kind === 'refund' && admin && (
        <RefundDialog d={d} retryOf={dlg.retryOf} onClose={() => setDlg(null)} onStale={() => void load()}
          onDone={(st) => (st === 'failed' ? done('Cổng từ chối hoàn tiền.', true) : done(st === 'succeeded' ? 'Hoàn tiền thành công' : 'Đã gửi hoàn tiền', false, `${P}-refund-success`))} />
      )}
      <ToastView toast={toast} />
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="page"><Skel n={1} /></main>}><DetailView id={String(params.id ?? '')} /></Suspense>;
}

export default function AdminPaymentDetailPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
