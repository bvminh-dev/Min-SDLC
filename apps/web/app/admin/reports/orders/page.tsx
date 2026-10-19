'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Chart, ForbiddenView, RangeBar, RateBanner, Skeleton } from '../../../../components/DashboardParts';
import { useQueryGo } from '../../../../components/ReviewParts';
import { RequireRole } from '../../../../components/RequireRole';
import { appliedRange, bucketLabel, count, failed, formatYmd, GRAN_TEXT, moneyOrDash, percentText, rangeQuery, STATUS_ORDER, useBlock, type OrdersReport } from '../../../../lib/dashboard';
import { ORDER_STATUS_LABEL } from '../../../../lib/order';
import { SkRows } from '../../../../components/Skeleton';

const P = 'dsh-analytics-orders';

/** Báo cáo đơn (ui/analytics-orders): số đếm và giá trị đơn, KHÔNG phải doanh thu; tỷ lệ và giá trị trung bình là "—" khi không có đơn (không bao giờ 0%). */
function Inner() {
  const sp = useSearchParams();
  const go = useQueryGo('/admin/reports/orders');
  const from = sp.get('from'), to = sp.get('to');
  const b = useBlock<OrdersReport>(`/admin/reports/orders${rangeQuery(from, to)}`);
  const d = b.data;
  if (b.status === 'forbidden') return <ForbiddenView />;
  const applied = appliedRange(from, to);
  return (
    <main className="page">
      <Link className="back" href="/admin/dashboard"><span className="i i-left" aria-hidden="true" />Dashboard</Link>
      <div className="page-head"><h1>Đơn hàng</h1></div>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={b.status === 'invalid'} asOf={d?.as_of} onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null })} />
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo. <button type="button" className="btn btn-sm" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <div className="stack">
          <section className="stat-grid" aria-label="Tổng">
            <div className="stat"><span className="tile"><span className="i i-receipt" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total`}>{count(d.totals.total)}</b><span className="lbl">Tổng đơn</span></div></div>
            <div className="stat"><span className="tile red"><span className="i i-xc" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-cancel-rate`}>{percentText(d.totals.cancel_rate)}</b><span className="lbl">Tỷ lệ hủy</span></div></div>
            <div className="stat"><span className="tile amber"><span className="i i-clock" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-expired-rate`}>{percentText(d.totals.expired_rate)}</b><span className="lbl">Tỷ lệ hết hạn</span></div></div>
            <div className="stat"><span className="tile green"><span className="i i-bag" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-aov`}>{moneyOrDash(d.totals.average_order_value)}</b><span className="lbl">Trung bình/đơn</span></div></div>
          </section>
          {d.totals.total === 0 && (
            <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span><strong>Chưa có đơn</strong><span className="small">{formatYmd(d.from)} – {formatYmd(d.to)}</span></div>
          )}
          <section className="panel">
            <div className="panel-head"><h2 data-testid={`${P}-granularity`}>Theo {GRAN_TEXT[d.granularity]}{d.granularity === 'week' ? ' (từ thứ Hai)' : ''}</h2></div>
            <Chart testid={`${P}-chart`} title={`Số đơn theo ${GRAN_TEXT[d.granularity]}`} unit="đơn" format={(n) => count(n)}
              points={d.buckets.map((x) => ({ key: x.bucket_start, label: bucketLabel(d.granularity, x.bucket_start), value: x.total, text: `${count(x.total)} đơn` }))} />
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Trạng thái</h2></div>
            <ul className="dsh-bars rd-bars" data-testid={`${P}-by-status`}>
              {STATUS_ORDER.map((s) => {
                const n = d.totals.by_status[s], pct = d.totals.total ? (n * 100) / d.totals.total : 0;
                return <li key={s}><span className="badge" data-status={s}>{ORDER_STATUS_LABEL[s]}</span><span className="dsh-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span><strong className="tabular">{count(n)} <span className="muted">({d.totals.total ? percentText(pct) : '—'})</span></strong></li>;
              })}
            </ul>
          </section>
          <div className="panel panel-flush" data-testid={`${P}-table`}>
            <div className="table-wrap">
              <table className="stack-table">
                <thead><tr><th>Mốc</th><th className="num">Tổng</th>{STATUS_ORDER.map((s) => <th key={s} className="num">{ORDER_STATUS_LABEL[s]}</th>)}</tr></thead>
                <tbody>
                  {d.buckets.map((x) => (
                    <tr key={x.bucket_start} data-testid={`${P}-row`} data-bucket={x.bucket_start}>
                      <td data-label="Mốc" className="tabular">{bucketLabel(d.granularity, x.bucket_start)}</td>
                      <td data-label="Tổng" className="num tabular strong">{count(x.total)}</td>
                      {STATUS_ORDER.map((s) => <td key={s} data-label={ORDER_STATUS_LABEL[s]} className={`num tabular${x.by_status[s] ? '' : ' rd-zero'}`}>{count(x.by_status[s])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="small muted" data-testid={`${P}-note`}><span className="i i-info" aria-hidden="true" /> Số đơn, không phải doanh thu.</p>
        </div>
      )}
    </main>
  );
}

export default function OrdersReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="page"><SkRows n={4} lead={false} /></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
