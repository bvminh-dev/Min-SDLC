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
    <main className="wide">
      <h1>Báo cáo doanh thu</h1>
      <p className="hint"><Link href="/admin/dashboard">Về dashboard</Link></p>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={b.status === 'invalid'} asOf={d?.as_of} onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null })} />
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo doanh thu. <button type="button" className="btn tight" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <>
          <section className="dsh-kpis dsh-kpis-4" aria-label="Tổng">
            <div className="dsh-kpi"><h2>Thu</h2><p className="dsh-big tabular" data-testid={`${P}-total-gross`}>{money(d.totals.gross)}</p></div>
            <div className="dsh-kpi"><h2>Hoàn tiền</h2><p className="dsh-big tabular" data-testid={`${P}-total-refunded`}>{money(d.totals.refunded)}</p></div>
            <div className="dsh-kpi"><h2>Doanh thu thuần</h2><p className="dsh-big tabular" data-testid={`${P}-total-net`}>{money(d.totals.net)}</p></div>
            <div className="dsh-kpi"><h2>Số giao dịch</h2><p className="dsh-big tabular" data-testid={`${P}-total-count`}>{count(d.totals.payment_count)}</p></div>
          </section>
          {empty && (
            <p className="hint" data-testid={`${P}-empty`}>Không có giao dịch từ {formatYmd(d.from)} tới {formatYmd(d.to)}. <Link href="/admin/reports/revenue" onClick={() => go({ from: null, to: null })}>30 ngày qua</Link></p>
          )}
          <h2 data-testid={`${P}-granularity`}>Doanh thu theo {GRAN_TEXT[d.granularity]}{d.granularity === 'week' ? ' (tuần bắt đầu thứ Hai)' : ''}</h2>
          <Chart testid={`${P}-chart`} title={`Doanh thu thuần theo ${GRAN_TEXT[d.granularity]}`} unit="đồng"
            points={d.buckets.map((x) => ({ key: x.bucket_start, label: bucketLabel(d.granularity, x.bucket_start), value: x.net, text: `thuần ${money(x.net)}, thu ${money(x.gross)}, hoàn ${money(x.refunded)}` }))} />
          <div className="table-wrap" data-testid={`${P}-table`}>
            <table className="stack-table">
              <thead><tr><th>Mốc</th><th className="num">Thu</th><th className="num">Hoàn tiền</th><th className="num">Thuần</th><th className="num">Giao dịch</th></tr></thead>
              <tbody>
                {d.buckets.map((x) => (
                  <tr key={x.bucket_start} data-testid={`${P}-row`} data-bucket={x.bucket_start}>
                    <td data-label="Mốc" className="tabular">{bucketLabel(d.granularity, x.bucket_start)}</td>
                    <td data-label="Thu" className="num tabular">{money(x.gross)}</td>
                    <td data-label="Hoàn tiền" className="num tabular">{money(x.refunded)}</td>
                    <td data-label="Thuần" className="num tabular">{money(x.net)}</td>
                    <td data-label="Giao dịch" className="num tabular">{count(x.payment_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Theo phương thức</h2>
          <ul className="dsh-methods">
            <li data-testid={`${P}-method-vnpay`}><strong>VNPay</strong> Thu {money(d.by_method.vnpay.gross)} · Hoàn {money(d.by_method.vnpay.refunded)} · Thuần {money(d.by_method.vnpay.net)}</li>
            <li data-testid={`${P}-method-cod`}><strong>COD</strong> Thu {money(d.by_method.cod.gross)} · Hoàn {money(d.by_method.cod.refunded)} · Thuần {money(d.by_method.cod.net)}</li>
          </ul>
          <p className="hint" data-testid={`${P}-note`}>Tiền theo PAY: thu thành công trừ hoàn tiền thành công. Hoàn tiền tính vào ngày hoàn.</p>
        </>
      )}
    </main>
  );
}

export default function RevenueReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
