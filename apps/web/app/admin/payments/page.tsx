'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PayBadge, PayPager } from '../../../components/PaymentParts';
import { RequireRole } from '../../../components/RequireRole';
import { Forbidden } from '../../../components/ShipmentParts';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '../../../lib/format';
import { formatOrderTime } from '../../../lib/order';
import { PAY_STATUSES, methodText, payStatusText, type PaymentList, type PayStatus } from '../../../lib/payment';
import { useLoginRedirect } from '../../../lib/prd';
import { limitedText } from '../../../lib/stock';
import { useQueryGo } from '../../../components/useQueryGo';

const P = 'pay-admin-payment-list';
const LIMIT = 20;

/**
 * Quản lý thanh toán (ui/admin-payment-list): staff và admin lọc theo trạng thái, phương thức, mã đơn (khớp chính xác), lối tắt "COD chờ thu", phân trang 20.
 * Bộ lọc nằm trên URL (`?status=&method=&order_code=&page=`) để từ chi tiết quay lại vẫn giữ. Không có ô tìm theo email, tên, điện thoại.
 */
function ListInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = PAY_STATUSES.find((s) => s === sp.get('status')) ?? '';
  const method = sp.get('method') === 'vnpay' || sp.get('method') === 'cod' ? (sp.get('method') as string) : '';
  const orderCode = (sp.get('order_code') ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || method || orderCode);
  const codPending = method === 'cod' && status === 'pending';

  const [draft, setDraft] = useState({ status: status as string, method, code: orderCode });
  const [data, setData] = useState<PaymentList | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [errText, setErrText] = useState('Không tải được danh sách thanh toán.');
  const [filterErr, setFilterErr] = useState(false);
  const seq = useRef(0);

  useEffect(() => { setDraft({ status, method, code: orderCode }); }, [status, method, orderCode]);
  const go = useQueryGo('/admin/payments'); // cộng dồn các lần đổi liền nhau (REV-REV-12)
  const back = sp.toString();
  const detail = (id: string) => `/admin/payments/${encodeURIComponent(id)}${back ? `?back=${encodeURIComponent(back)}` : ''}`;

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading'); setFilterErr(false);
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (method) qs.set('method', method);
    if (orderCode) qs.set('order_code', orderCode);
    const r = await api<PaymentList>(`/admin/payments?${qs}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 403) setView('forbidden');
    else if (r.status === 400) { setFilterErr(true); setView('ready'); } // giữ nguyên bảng cũ
    else { setErrText(r.status === 429 ? `${limitedText(r.retryAfter)}.` : 'Không tải được danh sách thanh toán.'); setView('error'); }
  }, [page, status, method, orderCode]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  if (view === 'forbidden') return <Forbidden testid={`${P}-forbidden`} />;
  const items = data?.items ?? [];
  const empty = view === 'ready' && data !== null && items.length === 0 && !filterErr;
  const clear = () => router.push('/admin/payments', { scroll: false });
  return (
    <main className="wide">
      <h1>Thanh toán</h1>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); go({ status: draft.status || null, method: draft.method || null, order_code: draft.code.trim() || null }); }}>
        <select value={draft.status} aria-label="Trạng thái" onChange={(e) => setDraft({ ...draft, status: e.target.value })} data-testid={`${P}-filter-status`}>
          <option value="">Tất cả trạng thái</option>
          {PAY_STATUSES.map((s: PayStatus) => <option key={s} value={s}>{payStatusText(s)}</option>)}
        </select>
        <select value={draft.method} aria-label="Phương thức" onChange={(e) => setDraft({ ...draft, method: e.target.value })} data-testid={`${P}-filter-method`}>
          <option value="">Tất cả phương thức</option>
          <option value="vnpay">VNPay</option>
          <option value="cod">COD</option>
        </select>
        <input value={draft.code} placeholder="Mã đơn" aria-label="Mã đơn" autoComplete="off" onChange={(e) => setDraft({ ...draft, code: e.target.value })} data-testid={`${P}-filter-order-code`} />
        <button type="submit" className="btn tight" data-testid={`${P}-filter-apply`}>Lọc</button>
        {filtering && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${P}-filter-clear`}>Xóa bộ lọc</button>}
      </form>
      <div className="actions-row">
        <button type="button" className={`btn tight${codPending ? ' btn-current' : ''}`} aria-pressed={codPending} onClick={() => go({ method: 'cod', status: 'pending', order_code: null })} data-testid={`${P}-filter-cod-pending`}>COD chờ thu</button>
      </div>
      {filterErr && <p role="alert" className="field-error" data-testid={`${P}-filter-error`}>Bộ lọc không hợp lệ (mã đơn tối đa 32 ký tự).</p>}

      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid={`${P}-loading`} aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {empty && (filtering || page > 1
        ? <div data-testid={`${P}-no-match`}><p>Không có thanh toán khớp bộ lọc.</p><button type="button" className="btn" onClick={clear}>Xóa bộ lọc</button></div>
        : <div data-testid={`${P}-empty`}><p className="hint">Chưa có thanh toán nào.</p></div>)}
      {data && items.length > 0 && (
        <>
          <div className={`table-wrap${view === 'loading' ? ' dim' : ''}`} data-testid={`${P}-table`}>
            <table className="stack-table">
              <thead><tr><th>Mã đơn</th><th>Phương thức</th><th className="num">Số tiền</th><th>Trạng thái</th><th>Lượt thử</th><th>Tạo lúc</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="row-click" data-testid={`${P}-row`} data-code={p.order_code} onClick={() => router.push(detail(p.id))}>
                    <td data-label="Mã đơn" className="mono"><Link href={detail(p.id)} onClick={(e) => e.stopPropagation()}>{p.order_code}</Link></td>
                    <td data-label="Phương thức">{methodText(p.method)}</td>
                    <td data-label="Số tiền" className="num">{formatPrice(p.amount)}</td>
                    <td data-label="Trạng thái"><PayBadge status={p.status} method={p.method} testid={`${P}-row-status`} /></td>
                    <td data-label="Lượt thử" className="tabular">{p.method === 'vnpay' ? `${p.attempt_no}/${p.max_attempts}` : '-'}</td>
                    <td data-label="Tạo lúc" className="tabular">{formatOrderTime(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PayPager testPrefix={P} page={page} limit={LIMIT} total={data.total} unit="thanh toán" disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null })} />
        </>
      )}
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  if (user?.role === 'customer') return <Forbidden testid={`${P}-forbidden`} />; // customer không gọi API (server vẫn trả 403)
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><ListInner /></Suspense>;
}

export default function AdminPaymentsPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
