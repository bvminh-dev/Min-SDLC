'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PayPager, RefundBadge, Spinner, refundError, useMoney } from '../../../components/PaymentParts';
import { RequireRole } from '../../../components/RequireRole';
import { Forbidden, Modal, ToastView, useToast } from '../../../components/ShipmentParts';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '../../../lib/format';
import { formatOrderTime } from '../../../lib/order';
import { REFUND_STATUSES, refundReasonText, refundStatusText, type RefundList, type RefundRow } from '../../../lib/payment';
import { useLoginRedirect } from '../../../lib/prd';
import { limitedText } from '../../../lib/stock';
import { useQueryGo } from '../../../components/useQueryGo';

const P = 'pay-admin-refund-queue';
const LIMIT = 20;
const AUTO_MAX = 3; // số lần tự thử của hệ thống (PAY_REFUND_AUTO_ATTEMPTS mặc định 3; API không trả giá trị này)
const POLL_MS = 2000; // sau khi thử lại: đọc lại danh sách mỗi 2 giây khi còn dòng `requested`
const POLL_MAX_MS = 60_000;

/** Hộp thoại xác nhận thử lại hoàn tiền (không có ô nhập, nêu rõ không hoàn tác); nút xác nhận khóa ngay khi bấm. */
function RetryDialog({ row, onDone, onClose, onStale }: { row: RefundRow; onDone: (status: string | undefined) => void; onClose: () => void; onStale: () => void }) {
  const { busy, err, rateText, send } = useMoney();
  const submit = async () => {
    const r = await send(`/refunds/${encodeURIComponent(row.id)}/retry`, {}, { idem: row.id, map: refundError });
    if (!r) return;
    if (r.ok) { onClose(); onDone((r.body as { status?: string })?.status); }
    else if (['refund-in-progress', 'refund-not-retryable', 'payment-not-refundable'].includes(r.code ?? '')) onStale();
  };
  const msg = rateText ?? err;
  return (
    <Modal title={`Thử lại hoàn tiền ${formatPrice(row.amount)} cho đơn #${row.order_code}?`} testid={`${P}-retry-dialog`} onClose={() => !busy && onClose()}>
      <p>Hoàn tiền không thể hoàn tác và không đổi trạng thái đơn.</p>
      {msg && <div role="alert" className="field-error" data-testid={`${P}-retry-error`}>{msg}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-retry-dismiss`}>Hủy</button>
        <button type="button" className="btn btn-danger tight" disabled={busy} onClick={() => void submit()} data-testid={`${P}-retry-confirm`}>{busy ? <><Spinner /> Đang gửi...</> : 'Xác nhận thử lại'}</button>
      </div>
    </Modal>
  );
}

/** Hàng đợi hoàn tiền (ui/admin-refund-queue): staff và admin xem, hoàn tiền thất bại đứng trước; chỉ admin có nút Thử lại. Bộ lọc nằm trên URL (`?status=&page=`). */
function QueueInner() {
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const status = REFUND_STATUSES.find((s) => s === sp.get('status')) ?? '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);

  const [draft, setDraft] = useState<string>(status);
  const [data, setData] = useState<RefundList | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [errText, setErrText] = useState('Không tải được danh sách hoàn tiền.');
  const [filterErr, setFilterErr] = useState(false);
  const [retryRow, setRetryRow] = useState<RefundRow | null>(null);
  const [stalled, setStalled] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const { toast, show } = useToast(5000);
  const seq = useRef(0);
  const dataRef = useRef<RefundList | null>(null);
  const pause = useRef(0);
  dataRef.current = data;

  useEffect(() => { setDraft(status); }, [status]);
  const go = useQueryGo('/admin/refunds'); // cộng dồn các lần đổi liền nhau (REV-REV-12)

  const load = useCallback(async () => {
    const n = ++seq.current;
    const have = dataRef.current !== null;
    if (!have) setView('loading');
    setFilterErr(false);
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    const r = await api<RefundList>(`/admin/refunds?${qs}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); return; }
    if (expired(r)) return;
    if (r.status === 429) pause.current = Date.now() + (r.retryAfter ?? 60) * 1000;
    if (r.status === 403) setView('forbidden');
    else if (r.status === 400) { setFilterErr(true); setView('ready'); } // giữ bảng cũ
    else if (!have) { setErrText(r.status === 429 ? `${limitedText(r.retryAfter)}.` : 'Không tải được danh sách hoàn tiền.'); setView('error'); }
  }, [page, status]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  // Còn dòng `requested` (vừa thử lại): đọc lại mỗi 2 giây tối đa 60 giây, rồi dừng và mời kiểm tra lại.
  const hasRequested = data?.items.some((r) => r.status === 'requested') ?? false;
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
  const items = data?.items ?? [];
  const empty = view === 'ready' && data !== null && items.length === 0 && !filterErr;
  return (
    <main className="wide">
      <h1>Hoàn tiền</h1>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); go({ status: draft || null }); }}>
        <select value={draft} aria-label="Trạng thái hoàn tiền" onChange={(e) => setDraft(e.target.value)} data-testid={`${P}-filter-status`}>
          <option value="">Tất cả</option>
          {REFUND_STATUSES.map((s) => <option key={s} value={s}>{refundStatusText(s)}</option>)}
        </select>
        <button type="submit" className="btn tight" data-testid={`${P}-filter-apply`}>Lọc</button>
      </form>
      {filterErr && <p role="alert" className="field-error" data-testid={`${P}-filter-error`}>Bộ lọc không hợp lệ.</p>}
      {stalled && <div role="status" className="banner banner-info">Đang xử lý, kiểm tra lại sau. <button className="btn" onClick={() => { setPollKey((k) => k + 1); void load(); }}>Kiểm tra lại</button></div>}

      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid={`${P}-loading`} aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {empty && (status === 'failed'
        ? <div data-testid={`${P}-no-failed`}><p>Không có hoàn tiền thất bại cần xử lý.</p></div>
        : <div data-testid={`${P}-empty`}><p className="hint">{status ? 'Không có hoàn tiền nào ở trạng thái này.' : 'Chưa có hoàn tiền nào.'}</p></div>)}
      {data && items.length > 0 && (
        <>
          <div className={`table-wrap${view === 'loading' ? ' dim' : ''}`} data-testid={`${P}-table`}>
            <table className="stack-table">
              <thead><tr><th>Mã đơn</th><th className="num">Số tiền</th><th>Lý do</th><th>Trạng thái</th><th>Lần tự thử</th><th>Tạo lúc</th>{admin && <th><span className="sr-only">Thao tác</span></th>}</tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} data-testid={`${P}-row`} data-code={r.order_code}>
                    <td data-label="Mã đơn" className="mono"><Link href={`/admin/payments/${encodeURIComponent(r.payment_id)}`} data-testid={`${P}-order-link`}>{r.order_code}</Link></td>
                    <td data-label="Số tiền" className="num">{formatPrice(r.amount)}</td>
                    <td data-label="Lý do">{refundReasonText(r.reason)}</td>
                    <td data-label="Trạng thái"><RefundBadge status={r.status} testid={`${P}-row-status`} /></td>
                    <td data-label="Lần tự thử" className="tabular">{r.auto_attempt_no != null ? `${r.auto_attempt_no}/${AUTO_MAX}` : '-'}</td>
                    <td data-label="Tạo lúc" className="tabular">{formatOrderTime(r.created_at)}</td>
                    {admin && <td>{r.status === 'failed' && <button type="button" className="btn tight" onClick={() => setRetryRow(r)} data-testid={`${P}-refund-retry`}>Thử lại</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PayPager testPrefix={P} page={page} limit={LIMIT} total={data.total} unit="hoàn tiền" disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null })} />
        </>
      )}

      {admin && retryRow && (
        <RetryDialog row={retryRow} onClose={() => setRetryRow(null)} onStale={() => void load()}
          onDone={(st) => { show(st === 'failed' ? { text: 'Cổng từ chối hoàn tiền, dòng vẫn ở trạng thái thất bại.', error: true } : { text: st === 'succeeded' ? 'Hoàn tiền thành công' : 'Đã gửi yêu cầu thử lại hoàn tiền', testid: `${P}-retry-success` }); void load(); }} />
      )}
      <ToastView toast={toast} />
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><QueueInner /></Suspense>;
}

export default function AdminRefundsPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
