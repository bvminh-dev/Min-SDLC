'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Chart, ForbiddenView, RangeBar, RateBanner, Skeleton } from '../../../../components/DashboardParts';
import { useQueryGo } from '../../../../components/ReviewParts';
import { RequireRole } from '../../../../components/RequireRole';
import { appliedRange, bucketLabel, count, failed, formatYmd, GRAN_TEXT, moneyOrDash, percentText, rangeQuery, STATUS_ORDER, useBlock, type OrdersReport } from '../../../../lib/dashboard';
import { ORDER_STATUS_LABEL } from '../../../../lib/order';

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
    <main className="wide">
      <h1>Báo cáo đơn hàng</h1>
      <p className="hint"><Link href="/admin/dashboard">Về dashboard</Link></p>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={b.status === 'invalid'} asOf={d?.as_of} onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null })} />
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo đơn hàng. <button type="button" className="btn tight" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <>
          <section className="dsh-kpis dsh-kpis-4" aria-label="Tổng">
            <div className="dsh-kpi"><h2>Tổng đơn</h2><p className="dsh-big tabular" data-testid={`${P}-total`}>{count(d.totals.total)}</p></div>
            <div className="dsh-kpi"><h2>Tỷ lệ hủy</h2><p className="dsh-big tabular" data-testid={`${P}-cancel-rate`}>{percentText(d.totals.cancel_rate)}</p></div>
            <div className="dsh-kpi"><h2>Tỷ lệ hết hạn</h2><p className="dsh-big tabular" data-testid={`${P}-expired-rate`}>{percentText(d.totals.expired_rate)}</p></div>
            <div className="dsh-kpi"><h2>Giá trị đơn trung bình</h2><p className="dsh-big tabular" data-testid={`${P}-aov`}>{moneyOrDash(d.totals.average_order_value)}</p></div>
          </section>
          {d.totals.total === 0 && <p className="hint" data-testid={`${P}-empty`}>Không có đơn từ {formatYmd(d.from)} tới {formatYmd(d.to)}.</p>}
          <h2 data-testid={`${P}-granularity`}>Số đơn theo {GRAN_TEXT[d.granularity]}{d.granularity === 'week' ? ' (tuần bắt đầu thứ Hai)' : ''}</h2>
          <Chart testid={`${P}-chart`} title={`Số đơn theo ${GRAN_TEXT[d.granularity]}`} unit="đơn" format={(n) => count(n)}
            points={d.buckets.map((x) => ({ key: x.bucket_start, label: bucketLabel(d.granularity, x.bucket_start), value: x.total, text: `${count(x.total)} đơn` }))} />
          <ul className="dsh-bars" data-testid={`${P}-by-status`}>
            {STATUS_ORDER.map((s) => {
              const n = d.totals.by_status[s], pct = d.totals.total ? (n * 100) / d.totals.total : 0;
              return <li key={s}><span className="dsh-bar-label">{ORDER_STATUS_LABEL[s]}</span><span className="dsh-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span><strong className="tabular">{count(n)} ({d.totals.total ? percentText(pct) : '—'})</strong></li>;
            })}
          </ul>
          <div className="table-wrap" data-testid={`${P}-table`}>
            <table className="stack-table">
              <thead><tr><th>Mốc</th><th className="num">Tổng</th>{STATUS_ORDER.map((s) => <th key={s} className="num">{ORDER_STATUS_LABEL[s]}</th>)}</tr></thead>
              <tbody>
                {d.buckets.map((x) => (
                  <tr key={x.bucket_start} data-testid={`${P}-row`} data-bucket={x.bucket_start}>
                    <td data-label="Mốc" className="tabular">{bucketLabel(d.granularity, x.bucket_start)}</td>
                    <td data-label="Tổng" className="num tabular">{count(x.total)}</td>
                    {STATUS_ORDER.map((s) => <td key={s} data-label={ORDER_STATUS_LABEL[s]} className="num tabular">{count(x.by_status[s])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" data-testid={`${P}-note`}>Đây là số đơn và giá trị đơn, không phải doanh thu. Doanh thu lấy ở báo cáo doanh thu (theo PAY); hai báo cáo có thể lệch ngắn hạn.</p>
        </>
      )}
    </main>
  );
}

export default function OrdersReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
