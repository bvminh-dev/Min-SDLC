'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PayBadge, RefundBadge, Spinner, refundError, useMoney } from '../../../../components/PaymentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { Forbidden, Modal, ToastView, useToast } from '../../../../components/ShipmentParts';
import { api, type ApiResult } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { formatPrice, parseMoney } from '../../../../lib/format';
import { formatOrderTime } from '../../../../lib/order';
import { attemptText, failSentence, methodText, refundReasonText, webhookResultText, type AdminPaymentDetail, type AdminRefund } from '../../../../lib/payment';
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
    <Modal title={`Ghi nhận đã thu COD cho đơn #${d.order_code}?`} testid={`${P}-cod-dialog`} sticky onClose={() => !busy && onClose()}>
      <p>Số tiền phải thu <strong className="tabular" data-testid={`${P}-cod-due`}>{formatPrice(d.amount)}</strong></p>
      <label>Số tiền đã thu
        <input value={amount} inputMode="numeric" disabled={busy} autoComplete="off" onChange={(e) => setAmount(e.target.value)} data-testid={`${P}-cod-amount`} />
      </label>
      <label>Ghi chú (tùy chọn, tối đa {NOTE_MAX} ký tự)
        <textarea value={note} rows={2} disabled={busy} onChange={(e) => setNote(e.target.value)} data-testid={`${P}-cod-note`} />
      </label>
      <p className={note.length > NOTE_MAX ? 'field-error' : 'hint'}>{note.length}/{NOTE_MAX}</p>
      {msg && <div role="alert" className="field-error" data-testid={`${P}-cod-error`}>{msg}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-cod-dismiss`}>Hủy</button>
        <button type="button" className="btn btn-primary tight" disabled={busy} onClick={() => void submit()} data-testid={`${P}-cod-confirm`}>{busy ? <><Spinner /> Đang ghi...</> : 'Xác nhận đã thu'}</button>
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
    <Modal title={retry ? `Thử lại hoàn tiền ${amount} cho đơn #${d.order_code}?` : `Hoàn toàn phần ${amount} cho đơn #${d.order_code}?`} testid={`${P}-refund-dialog`} sticky={!retry} onClose={() => !busy && onClose()}>
      <p className="banner banner-info" data-testid={`${P}-refund-warning`}>Hoàn tiền không thể hoàn tác và không đổi trạng thái đơn.</p>
      {!retry && (
        <>
          <label>Lý do (bắt buộc, {REASON_MIN} đến {REASON_MAX} ký tự)
            <textarea value={reason} rows={3} disabled={busy} onChange={(e) => setReason(e.target.value)} data-testid={`${P}-refund-reason`} />
          </label>
          <p className={reason.length > REASON_MAX ? 'field-error' : 'hint'}>{reason.length}/{REASON_MAX}</p>
        </>
      )}
      {msg && <div role="alert" className="field-error" data-testid={`${P}-refund-error`}>{msg}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={retry ? `${P}-refund-retry-dismiss` : `${P}-refund-dismiss`}>Hủy</button>
        <button type="button" className="btn btn-danger tight" disabled={busy} onClick={() => void submit()} data-testid={retry ? `${P}-refund-retry-confirm` : `${P}-refund-confirm`}>
          {busy ? <><Spinner /> Đang gửi...</> : retry ? 'Xác nhận thử lại' : 'Xác nhận hoàn tiền'}
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
  if (view === 'notfound') return <main className="wide"><p><Link href={backHref} data-testid={`${P}-back-link`}>← Về danh sách</Link></p><section className="card-block" data-testid={`${P}-notfound`}><p className="hint">404</p><h1>Không tìm thấy thanh toán</h1></section></main>;
  if (view === 'loading' && !data) return <main className="wide" data-testid={`${P}-loading`} aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></main>;
  if (view === 'error' || !data) {
    return (
      <main className="wide">
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>
      </main>
    );
  }

  const d = data;
  const webhooks = [...d.webhook_logs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // cũ nhất trước (đối soát theo thứ tự xảy ra)
  const canCod = d.method === 'cod' && d.status === 'pending';
  const canRefund = admin && d.method === 'vnpay' && d.status === 'succeeded' && d.refunds.length === 0;
  const done = (text: string, error?: boolean, testid?: string) => { show({ text, testid, error }); void load(); };
  return (
    <main className="wide">
      <p><Link href={backHref} data-testid={`${P}-back-link`}>← Về danh sách</Link></p>
      <header className="row-link">
        <h1>Thanh toán đơn <span className="mono" data-testid={`${P}-order-code`}>{d.order_code}</span></h1>
        <PayBadge status={d.status} method={d.method} testid={`${P}-status-badge`} />
      </header>
      <p><span data-testid={`${P}-method`}>{methodText(d.method)}</span> · <span className="tabular" data-testid={`${P}-amount`}>{formatPrice(d.amount)}</span></p>
      {stalled && <div role="status" className="banner banner-info">Đang xử lý, kiểm tra lại sau. <button className="btn" onClick={() => { setPollKey((k) => k + 1); void load(); }}>Kiểm tra lại</button></div>}
      {(canCod || canRefund) && (
        <div className="actions-row">
          {canCod && <button type="button" className="btn tight" onClick={() => setDlg({ kind: 'cod' })} data-testid={`${P}-cod-button`}>Ghi nhận đã thu COD</button>}
          {canRefund && <button type="button" className="btn btn-danger-soft tight" onClick={() => setDlg({ kind: 'refund' })} data-testid={`${P}-refund-button`}>Hoàn tiền</button>}
        </div>
      )}

      <div className="cols">
        <div>
          <section className="card-block" data-testid={`${P}-info`}>
            <h2>Thông tin</h2>
            <dl className="view-fields">
              <dt>Mã giao dịch cổng</dt><dd className="mono">{d.provider_ref || '—'}</dd>
              <dt>User id</dt><dd className="mono">{d.user_id || '—'}</dd>
              {d.expires_at && <><dt>Hết hạn</dt><dd className="tabular">{formatOrderTime(d.expires_at)}</dd></>}
              {d.paid_at && <><dt>Thu lúc</dt><dd className="tabular">{formatOrderTime(d.paid_at)}</dd></>}
            </dl>
          </section>
          <section className="card-block" data-testid={`${P}-webhook-list`}>
            <h2>Nhật ký webhook</h2>
            {webhooks.length === 0 ? <p className="hint">Chưa có</p> : (
              <ul className="timeline">
                {webhooks.map((w, i) => <li key={i} data-testid={`${P}-webhook-item`}><span className="hint tabular">{formatOrderTime(w.created_at)}</span> RspCode <span className="mono">{w.rsp_code}</span> · {webhookResultText(w.result)}</li>)}
              </ul>
            )}
          </section>
        </div>
        <div>
          <section className="card-block" data-testid={`${P}-refund-list`}>
            <h2>Hoàn tiền</h2>
            {d.refunds.length === 0 ? <p className="hint">Chưa có</p> : (
              <ul className="timeline">
                {d.refunds.map((r) => (
                  <li key={r.id} data-testid={`${P}-refund-item`}>
                    <span className="hint tabular">{formatOrderTime(r.created_at)}</span> <span className="tabular">{formatPrice(r.amount)}</span> · {refundReasonText(r.reason)} · <RefundBadge status={r.status} />
                    {r.auto_attempt_no != null && <span className="hint"> (tự thử {r.auto_attempt_no})</span>}
                    {r.status === 'failed' && r.failure_reason && <> · <span className="mono">{r.failure_reason}</span></>}
                    {r.note && <> · <span className="pre">{r.note}</span></>}
                    {admin && r.status === 'failed' && d.status === 'succeeded' && <> <button type="button" className="btn tight" onClick={() => setDlg({ kind: 'refund', retryOf: r })} data-testid={`${P}-refund-retry`}>Thử lại</button></>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card-block" data-testid={`${P}-attempt-list`}>
            <h2>Lượt thử</h2>
            {d.attempts.length === 0 ? <p className="hint">Chưa có</p> : (
              <ul className="timeline">
                {d.attempts.map((a) => (
                  <li key={a.attempt_no} data-testid={`${P}-attempt-item`}>
                    Lượt {a.attempt_no} · {attemptText(a)}
                    {a.status === 'failed' && !a.reason && <> · {failSentence(null)}</>}
                    {a.gateway_code && <> · mã cổng <span className="mono">{a.gateway_code}</span></>}
                    {a.txn_ref && <> · <span className="mono hint">{a.txn_ref}</span></>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {dlg?.kind === 'cod' && <CodDialog d={d} onClose={() => setDlg(null)} onStale={() => void load()} onDone={() => done('Đã ghi nhận thu tiền', false, `${P}-cod-success`)} />}
      {dlg?.kind === 'refund' && admin && (
        <RefundDialog d={d} retryOf={dlg.retryOf} onClose={() => setDlg(null)} onStale={() => void load()}
          onDone={(st) => (st === 'failed' ? done('Cổng từ chối hoàn tiền, xem dòng hoàn tiền bên dưới.', true) : done(st === 'succeeded' ? 'Hoàn tiền thành công' : 'Đã gửi yêu cầu hoàn tiền', false, `${P}-refund-success`))} />
      )}
      <ToastView toast={toast} />
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><DetailView id={String(params.id ?? '')} /></Suspense>;
}

export default function AdminPaymentDetailPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
