'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MethodTag, PayBadge, PayPager, RefundBadge } from '../../components/PaymentParts';
import { RequireRole } from '../../components/RequireRole';
import { Note, Skel } from '../../components/ShipmentParts';
import { api } from '../../lib/api';
import { formatPrice } from '../../lib/format';
import { formatOrderTime } from '../../lib/order';
import { PAY_STATUSES, attemptText, payHref, payStatusText, type PaymentDetail, type PaymentList, type PayStatus } from '../../lib/payment';
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

  if (view === 'loading') return <aside><Skel n={2} /></aside>;
  if (view === 'notfound') return <aside className="ps-card" data-testid={`${P}-detail-notfound`}><p className="ps-empty-line">Không tìm thấy thanh toán</p></aside>;
  if (view === 'error' || !d) return <aside><Note tone="red" icon="alert" role="alert">Không tải được. <button className="btn" onClick={() => void load()}>Thử lại</button></Note></aside>;
  return (
    <aside className="ps-card" data-testid={`${P}-detail`}>
      <h2><span className="i i-receipt" aria-hidden="true" />Đơn <span className="ps-code">{d.order_code}</span></h2>
      <div className="row" style={{ marginBottom: '.75rem' }}>
        <span className="ps-amount sm">{formatPrice(d.amount)}</span>
        <MethodTag method={d.method} />
        <span className="muted small">{payStatusText(d.status, d.method)}</span>
      </div>
      <h2 style={{ fontSize: '.875rem' }}><span className="i i-refresh" aria-hidden="true" />Lượt thử</h2>
      {d.attempts.length === 0 ? <p className="ps-empty-line">Chưa có</p> : (
        <ul className="ps-tl">{d.attempts.map((a) => <li key={a.attempt_no} data-testid={`${P}-detail-attempt`}><span className={`ps-dot ${a.status === 'succeeded' ? 'green' : a.status === 'failed' ? 'red' : ''}`}><span className={`i i-${a.status === 'succeeded' ? 'check' : a.status === 'failed' ? 'x' : 'clock'}`} aria-hidden="true" /></span><span className="body">Lượt {a.attempt_no} · {attemptText(a)}<span className="ps-time">{formatOrderTime(a.created_at)}</span></span></li>)}</ul>
      )}
      <h2 style={{ fontSize: '.875rem', marginTop: '1rem' }}><span className="i i-undo" aria-hidden="true" />Hoàn tiền</h2>
      {d.refunds.length === 0 ? <p className="ps-empty-line">Chưa có</p> : (
        <ul className="ps-tl">{d.refunds.map((r, i) => <li key={i} data-testid={`${P}-detail-refund`}><span className="ps-dot violet"><span className="i i-undo" aria-hidden="true" /></span><span className="body"><span className="tabular">{formatPrice(r.amount)}</span> · <RefundBadge status={r.status} customer /><span className="ps-time">{formatOrderTime(r.created_at)}</span></span></li>)}</ul>
      )}
      {(d.can_retry || d.can_initiate) && <Link className="btn btn-primary" style={{ marginTop: '1rem', width: '100%' }} href={payHref(d.order_code)} data-testid={`${P}-detail-pay-link`}>Thanh toán lại</Link>}
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
    <main className="page">
      <div className="page-head"><h1>Thanh toán</h1></div>
      <form className="ps-filters" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <select value={draftStatus} aria-label="Trạng thái" onChange={(e) => setDraftStatus(e.target.value)} data-testid={`${P}-filter-status`}>
          <option value="">Tất cả</option>
          {PAY_STATUSES.map((s: PayStatus) => <option key={s} value={s}>{payStatusText(s)}</option>)}
        </select>
        <input value={draftCode} placeholder="Mã đơn" aria-label="Mã đơn" autoComplete="off" onChange={(e) => setDraftCode(e.target.value)} data-testid={`${P}-filter-order-code`} />
        <button type="submit" className="btn tight" data-testid={`${P}-filter-apply`}>Lọc</button>
        {filtering && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${P}-filter-clear`}><span className="i i-x" aria-hidden="true" />Xóa lọc</button>}
      </form>
      {filterErr && <p role="alert" className="ps-err" data-testid={`${P}-filter-error`}><span className="i i-alert" aria-hidden="true" />Bộ lọc không hợp lệ (mã đơn tối đa 32 ký tự).</p>}

      {view === 'error' && <Note tone="red" icon="alert" role="alert" testid={`${P}-error`}>{errText} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></Note>}
      {loadingFirst && <div data-testid={`${P}-loading`}><Skel n={5} /></div>}
      {empty && !overPage && (filtering
        ? <div className="empty" data-testid={`${P}-no-match`}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có kết quả</strong></div>
        : <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-card" aria-hidden="true" /></span><strong>Chưa có thanh toán</strong><Link className="btn btn-primary" href="/products" data-testid={`${P}-empty-shop`}>Mua sắm</Link></div>)}
      {overPage && <div className="empty"><strong>Trang trống</strong><button type="button" className="btn" onClick={() => go({ page: null })} data-testid={`${P}-page-reset`}>Về trang 1</button></div>}
      {data && items.length > 0 && (
        <div className="ps-cols wide-l">
          <section>
            <div className={`panel panel-flush${view === 'loading' ? ' dim' : ''}`} data-testid={`${P}-list`}>
              <table className="stack-table ps-table">
                <thead><tr><th>Đơn</th><th>Phương thức</th><th className="num">Số tiền</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={`row-click${selected === p.id ? ' row-on' : ''}`} data-testid={`${P}-row`} data-code={p.order_code} aria-selected={selected === p.id} onClick={() => setSelected(p.id)}>
                      <td data-label="Đơn"><button type="button" className="btn-link ps-code" style={{ textDecoration: 'none' }} onClick={() => setSelected(p.id)}>{p.order_code}</button></td>
                      <td data-label="Phương thức"><MethodTag method={p.method} /></td>
                      <td data-label="Số tiền" className="num money">{formatPrice(p.amount)}</td>
                      <td data-label="Trạng thái"><PayBadge status={p.status} method={p.method} testid={`${P}-row-status`} /></td>
                      <td data-label="Ngày" className="ps-time">{formatOrderTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PayPager testPrefix={P} page={page} limit={LIMIT} total={data.total} unit="thanh toán" disabled={view !== 'ready'} onPage={(n) => go({ page: n > 1 ? String(n) : null })} />
          </section>
          {selected ? <Detail key={selected} id={selected} /> : <aside className="ps-card"><p className="ps-empty-line"><span className="i i-eye" aria-hidden="true" style={{ width: '1rem', height: '1rem', verticalAlign: '-.2em', marginRight: '.4rem' }} />Chọn một dòng</p></aside>}
        </div>
      )}
    </main>
  );
}

export default function PaymentHistoryPage() {
  return <RequireRole roles={['customer']}><Suspense fallback={<main className="page"><Skel n={1} /></main>}><HistoryInner /></Suspense></RequireRole>;
}
