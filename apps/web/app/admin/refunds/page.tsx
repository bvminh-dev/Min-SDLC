'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PayPager, RefundBadge, Spinner, refundError, useMoney } from '../../../components/PaymentParts';
import { RequireRole } from '../../../components/RequireRole';
import { Forbidden, Modal, Note, Skel, ToastView, useToast } from '../../../components/ShipmentParts';
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
    <Modal title="Thử lại hoàn tiền" icon="undo" tone="amber" testid={`${P}-retry-dialog`} onClose={() => !busy && onClose()}>
      <p className="ps-sub"><strong>{formatPrice(row.amount)}</strong> · đơn <span className="ps-code">{row.order_code}</span>. Không hoàn tác được.</p>
      {msg && <div role="alert" className="field-error" data-testid={`${P}-retry-error`}><span className="i i-alert" aria-hidden="true" />{msg}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-retry-dismiss`}>Hủy</button>
        <button type="button" className="btn btn-danger tight" disabled={busy} onClick={() => void submit()} data-testid={`${P}-retry-confirm`}>{busy ? <><Spinner />Đang gửi...</> : 'Thử lại'}</button>
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
    <main className="page">
      <div className="page-head"><h1>Hoàn tiền</h1></div>
      <form className="ps-filters" onSubmit={(e) => { e.preventDefault(); go({ status: draft || null }); }}>
        <select value={draft} aria-label="Trạng thái hoàn tiền" onChange={(e) => setDraft(e.target.value)} data-testid={`${P}-filter-status`}>
          <option value="">Tất cả</option>
          {REFUND_STATUSES.map((s) => <option key={s} value={s}>{refundStatusText(s)}</option>)}
        </select>
        <button type="submit" className="btn tight" data-testid={`${P}-filter-apply`}>Lọc</button>
      </form>
      {filterErr && <p role="alert" className="ps-err" data-testid={`${P}-filter-error`}><span className="i i-alert" aria-hidden="true" />Bộ lọc không hợp lệ.</p>}
      {stalled && <Note tone="warn" icon="clock" role="status">Đang xử lý. <button className="btn" onClick={() => { setPollKey((k) => k + 1); void load(); }}>Kiểm tra lại</button></Note>}

      {view === 'error' && <Note tone="red" icon="alert" role="alert" testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></Note>}
      {view === 'loading' && !data && <div data-testid={`${P}-loading`}><Skel n={6} /></div>}
      {empty && (status === 'failed'
        ? <div className="empty" data-testid={`${P}-no-failed`}><span className="tile tile-lg green"><span className="i i-okc" aria-hidden="true" /></span><strong>Không có hoàn tiền lỗi</strong></div>
        : <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-undo" aria-hidden="true" /></span><strong>{status ? 'Không có kết quả' : 'Chưa có hoàn tiền'}</strong></div>)}
      {data && items.length > 0 && (
        <>
          <div className={`panel panel-flush${view === 'loading' ? ' dim' : ''}`} data-testid={`${P}-table`}>
            <table className="stack-table ps-table">
              <thead><tr><th>Đơn</th><th className="num">Số tiền</th><th>Lý do</th><th>Trạng thái</th><th>Tự thử</th><th>Tạo lúc</th>{admin && <th><span className="sr-only">Thao tác</span></th>}</tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} data-testid={`${P}-row`} data-code={r.order_code}>
                    <td data-label="Đơn"><Link className="ps-code" href={`/admin/payments/${encodeURIComponent(r.payment_id)}`} data-testid={`${P}-order-link`}>{r.order_code}</Link></td>
                    <td data-label="Số tiền" className="num money">{formatPrice(r.amount)}</td>
                    <td data-label="Lý do">{refundReasonText(r.reason)}</td>
                    <td data-label="Trạng thái"><RefundBadge status={r.status} testid={`${P}-row-status`} /></td>
                    <td data-label="Tự thử" className="tabular">{r.auto_attempt_no != null ? `${r.auto_attempt_no}/${AUTO_MAX}` : '-'}</td>
                    <td data-label="Tạo lúc" className="ps-time">{formatOrderTime(r.created_at)}</td>
                    {admin && <td className="ps-act">{r.status === 'failed' && <button type="button" className="btn btn-sm" onClick={() => setRetryRow(r)} data-testid={`${P}-refund-retry`}>Thử lại</button>}</td>}
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
          onDone={(st) => { show(st === 'failed' ? { text: 'Cổng từ chối, vẫn thất bại.', error: true } : { text: st === 'succeeded' ? 'Hoàn tiền thành công' : 'Đã gửi yêu cầu thử lại', testid: `${P}-retry-success` }); void load(); }} />
      )}
      <ToastView toast={toast} />
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="page"><Skel n={1} /></main>}><QueueInner /></Suspense>;
}

export default function AdminRefundsPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
