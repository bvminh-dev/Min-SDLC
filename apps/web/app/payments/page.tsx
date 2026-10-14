'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PayBadge, PayPager, RefundBadge } from '../../components/PaymentParts';
import { RequireRole } from '../../components/RequireRole';
import { api } from '../../lib/api';
import { formatPrice } from '../../lib/format';
import { formatOrderTime } from '../../lib/order';
import { PAY_STATUSES, attemptText, methodText, payHref, payStatusText, type PaymentDetail, type PaymentList, type PayStatus } from '../../lib/payment';
import { useLoginRedirect } from '../../lib/prd';
import { limitedText } from '../../lib/stock';
import { useQueryGo } from '../../components/useQueryGo';

const P = 'pay-payment-history';
const LIMIT = 20;

/** Khung chi tiết bên phải: lượt thử và hoàn tiền; không hành động tiền (chỉ liên kết sang màn thanh toán của đơn). */
function Detail({ id }: { id: string }) {
  const expired = useLoginRedirect();
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [d, setD] = useState<PaymentDetail | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading'); setD(null);
    const r = await api<PaymentDetail>(`/payments/${encodeURIComponent(id)}`);
    if (n !== seq.current) return;
    if (r.status === 200 && typeof r.body.id === 'string') { setD(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 404 || r.status === 400) setView('notfound');
    else setView('error');
  }, [id]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  if (view === 'loading') return <aside aria-busy="true"><div className="skeleton" /><div className="skeleton" /></aside>;
  if (view === 'notfound') return <aside className="card-block" data-testid={`${P}-detail-notfound`}><p>Không tìm thấy thanh toán</p></aside>;
  if (view === 'error' || !d) return <aside><div role="alert" className="banner banner-error">Không tải được chi tiết thanh toán. <button className="btn" onClick={() => void load()}>Thử lại</button></div></aside>;
  return (
    <aside className="card-block" data-testid={`${P}-detail`}>
      <h2>Đơn <span className="mono">{d.order_code}</span></h2>
      <p className="tabular">{formatPrice(d.amount)} · {methodText(d.method)} · {payStatusText(d.status, d.method)}</p>
      <h3>Các lượt thử</h3>
      {d.attempts.length === 0 ? <p className="hint">Chưa có</p> : (
        <ul className="timeline">{d.attempts.map((a) => <li key={a.attempt_no} data-testid={`${P}-detail-attempt`}>Lượt {a.attempt_no} · {attemptText(a)} <span className="hint tabular">{formatOrderTime(a.created_at)}</span></li>)}</ul>
      )}
      <h3>Hoàn tiền</h3>
      {d.refunds.length === 0 ? <p className="hint">Chưa có</p> : (
        <ul className="timeline">{d.refunds.map((r, i) => <li key={i} data-testid={`${P}-detail-refund`}><span className="tabular">{formatPrice(r.amount)}</span> · <RefundBadge status={r.status} customer /> <span className="hint tabular">{formatOrderTime(r.created_at)}</span></li>)}</ul>
      )}
      {(d.can_retry || d.can_initiate) && <Link className="btn btn-primary" href={payHref(d.order_code)} data-testid={`${P}-detail-pay-link`}>Thử thanh toán lại</Link>}
    </aside>
  );
}

/** Lịch sử thanh toán của tôi (ui/payment-history): bộ lọc nằm trên URL (`?status=&order_code=&page=`); bấm một dòng mở chi tiết ở khung bên cạnh (hẹp thì ngay bên dưới). */
function HistoryInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = PAY_STATUSES.find((s) => s === sp.get('status')) ?? '';
  const orderCode = (sp.get('order_code') ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || orderCode);

  const [draftStatus, setDraftStatus] = useState<string>(status);
  const [draftCode, setDraftCode] = useState(orderCode);
  const [data, setData] = useState<PaymentList | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errText, setErrText] = useState('Không tải được lịch sử thanh toán.');
  const [filterErr, setFilterErr] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { setDraftStatus(status); setDraftCode(orderCode); }, [status, orderCode]);
  const go = useQueryGo('/payments'); // cộng dồn các lần đổi liền nhau (REV-REV-12)
  const apply = () => go({ status: draftStatus || null, order_code: draftCode.trim() || null });
  const clear = () => { setDraftStatus(''); setDraftCode(''); router.push('/payments', { scroll: false }); };

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading'); setFilterErr(false);
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (orderCode) qs.set('order_code', orderCode);
    const r = await api<PaymentList>(`/payments?${qs}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 400) { setFilterErr(true); setView('ready'); } // giữ nguyên danh sách hiện có
    else { setErrText(r.status === 429 ? `${limitedText(r.retryAfter)}.` : 'Không tải được lịch sử thanh toán.'); setView('error'); }
  }, [page, status, orderCode]); // expired đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  const items = data?.items ?? [];
  const loadingFirst = view === 'loading' && !data;
  const empty = view === 'ready' && data !== null && items.length === 0 && !filterErr;
  const overPage = empty && data!.total > 0 && page > 1;
  return (
    <main className="wide">
      <h1>Lịch sử thanh toán</h1>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <select value={draftStatus} aria-label="Trạng thái" onChange={(e) => setDraftStatus(e.target.value)} data-testid={`${P}-filter-status`}>
          <option value="">Tất cả trạng thái</option>
          {PAY_STATUSES.map((s: PayStatus) => <option key={s} value={s}>{payStatusText(s)}</option>)}
        </select>
        <input value={draftCode} placeholder="Mã đơn" aria-label="Mã đơn" autoComplete="off" onChange={(e) => setDraftCode(e.target.value)} data-testid={`${P}-filter-order-code`} />
        <button type="submit" className="btn tight" data-testid={`${P}-filter-apply`}>Lọc</button>
        {filtering && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${P}-filter-clear`}>Xóa bộ lọc</button>}
      </form>
      {filterErr && <p role="alert" className="field-error" data-testid={`${P}-filter-error`}>Bộ lọc không hợp lệ (mã đơn tối đa 32 ký tự).</p>}

      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {loadingFirst && <div data-testid={`${P}-loading`} aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {empty && !overPage && (filtering
        ? <div data-testid={`${P}-no-match`}><p>Không có thanh toán khớp bộ lọc.</p></div>
        : <div data-testid={`${P}-empty`}><p>Bạn chưa có thanh toán nào.</p><Link className="btn" href="/products" data-testid={`${P}-empty-shop`}>Mua sắm</Link></div>)}
      {overPage && <div><p>Trang này không có thanh toán nào.</p><button type="button" className="btn" onClick={() => go({ page: null })} data-testid={`${P}-page-reset`}>Về trang 1</button></div>}
      {data && items.length > 0 && (
        <div className="cols">
          <section>
            <div className={`table-wrap${view === 'loading' ? ' dim' : ''}`} data-testid={`${P}-list`}>
              <table className="stack-table">
                <thead><tr><th>Mã đơn</th><th>Phương thức</th><th className="num">Số tiền</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={`row-click${selected === p.id ? ' row-on' : ''}`} data-testid={`${P}-row`} data-code={p.order_code} aria-selected={selected === p.id} onClick={() => setSelected(p.id)}>
                      <td data-label="Mã đơn" className="mono"><button type="button" className="btn-link" onClick={() => setSelected(p.id)}>{p.order_code}</button></td>
                      <td data-label="Phương thức">{methodText(p.method)}</td>
                      <td data-label="Số tiền" className="num">{formatPrice(p.amount)}</td>
                      <td data-label="Trạng thái"><PayBadge status={p.status} method={p.method} testid={`${P}-row-status`} /></td>
                      <td data-label="Ngày" className="tabular">{formatOrderTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PayPager testPrefix={P} page={page} limit={LIMIT} total={data.total} unit="thanh toán" disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null })} />
          </section>
          {selected ? <Detail key={selected} id={selected} /> : <aside className="card-block"><p className="hint">Chọn một thanh toán để xem chi tiết.</p></aside>}
        </div>
      )}
    </main>
  );
}

export default function PaymentHistoryPage() {
  return <RequireRole roles={['customer']}><Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><HistoryInner /></Suspense></RequireRole>;
}
