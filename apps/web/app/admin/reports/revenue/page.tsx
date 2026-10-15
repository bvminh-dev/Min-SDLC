'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Chart, ForbiddenView, RangeBar, RateBanner, Skeleton } from '../../../../components/DashboardParts';
import { useQueryGo } from '../../../../components/ReviewParts';
import { RequireRole } from '../../../../components/RequireRole';
import { appliedRange, bucketLabel, count, failed, formatYmd, GRAN_TEXT, money, rangeQuery, useBlock, type RevenueReport } from '../../../../lib/dashboard';

const P = 'dsh-analytics-revenue';

/** Báo cáo doanh thu (ui/analytics-revenue): số tiền theo PAY, độ mịn do máy chủ chọn theo số ngày, đủ mốc kể cả mốc 0; hoàn tiền tính vào ngày hoàn. */
function Inner() {
  const sp = useSearchParams();
  const go = useQueryGo('/admin/reports/revenue');
  const from = sp.get('from'), to = sp.get('to');
  const b = useBlock<RevenueReport>(`/admin/reports/revenue${rangeQuery(from, to)}`);
  const d = b.data;
  if (b.status === 'forbidden') return <ForbiddenView />;
  const applied = appliedRange(from, to);
  const empty = d && d.totals.gross === 0 && d.totals.refunded === 0 && d.totals.payment_count === 0;
  return (
    <main className="page">
      <Link className="back" href="/admin/dashboard"><span className="i i-left" aria-hidden="true" />Dashboard</Link>
      <div className="page-head"><h1>Doanh thu</h1></div>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={b.status === 'invalid'} asOf={d?.as_of} onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null })} />
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo. <button type="button" className="btn btn-sm" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <div className="stack">
          <section className="stat-grid" aria-label="Tổng">
            <div className="stat"><span className="tile green"><span className="i i-trend" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-gross`}>{money(d.totals.gross)}</b><span className="lbl">Thu</span></div></div>
            <div className="stat"><span className="tile red"><span className="i i-undo" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-refunded`}>{money(d.totals.refunded)}</b><span className="lbl">Hoàn tiền</span></div></div>
            <div className="stat"><span className="tile"><span className="i i-card" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-net`}>{money(d.totals.net)}</b><span className="lbl">Thuần</span></div></div>
            <div className="stat"><span className="tile violet"><span className="i i-receipt" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-count`}>{count(d.totals.payment_count)}</b><span className="lbl">Giao dịch</span></div></div>
          </section>
          {empty && (
            <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span><strong>Chưa có giao dịch</strong><span className="small">{formatYmd(d.from)} – {formatYmd(d.to)}</span><Link className="btn btn-sm" href="/admin/reports/revenue" onClick={() => go({ from: null, to: null })}>30 ngày</Link></div>
          )}
          <section className="panel">
            <div className="panel-head"><h2 data-testid={`${P}-granularity`}>Theo {GRAN_TEXT[d.granularity]}{d.granularity === 'week' ? ' (từ thứ Hai)' : ''}</h2></div>
            <Chart testid={`${P}-chart`} title={`Doanh thu thuần theo ${GRAN_TEXT[d.granularity]}`} unit="đồng"
              points={d.buckets.map((x) => ({ key: x.bucket_start, label: bucketLabel(d.granularity, x.bucket_start), value: x.net, text: `thuần ${money(x.net)}, thu ${money(x.gross)}, hoàn ${money(x.refunded)}` }))} />
          </section>
          <div className="panel panel-flush" data-testid={`${P}-table`}>
            <div className="table-wrap">
              <table className="stack-table">
                <thead><tr><th>Mốc</th><th className="num">Thu</th><th className="num">Hoàn</th><th className="num">Thuần</th><th className="num">GD</th></tr></thead>
                <tbody>
                  {d.buckets.map((x) => (
                    <tr key={x.bucket_start} data-testid={`${P}-row`} data-bucket={x.bucket_start}>
                      <td data-label="Mốc" className="tabular">{bucketLabel(d.granularity, x.bucket_start)}</td>
                      <td data-label="Thu" className="num tabular">{money(x.gross)}</td>
                      <td data-label="Hoàn" className="num tabular">{money(x.refunded)}</td>
                      <td data-label="Thuần" className="num tabular strong">{money(x.net)}</td>
                      <td data-label="GD" className="num tabular">{count(x.payment_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Phương thức</h2></div>
            <ul className="list rd-methods">
              {([['vnpay', 'VNPay', 'card', ''], ['cod', 'COD', 'bag', 'amber']] as const).map(([k, label, ic, tone]) => (
                <li key={k} data-testid={`${P}-method-${k}`}>
                  <span className={`tile ${tone}`}><span className={`i i-${ic}`} aria-hidden="true" /></span>
                  <strong className="grow">{label}</strong>
                  <span className="small muted tabular">Thu {money(d.by_method[k].gross)} · Hoàn {money(d.by_method[k].refunded)}</span>
                  <span className="money tabular">{money(d.by_method[k].net)}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className="small muted" data-testid={`${P}-note`}><span className="i i-info" aria-hidden="true" /> Thu trừ hoàn; hoàn tính theo ngày hoàn.</p>
        </div>
      )}
    </main>
  );
}

export default function RevenueReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="page"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
