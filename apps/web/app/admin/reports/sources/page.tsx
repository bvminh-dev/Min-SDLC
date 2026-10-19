'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ForbiddenView, RangeBar, RateBanner, Skeleton } from '../../../../components/DashboardParts';
import { useQueryGo } from '../../../../components/ReviewParts';
import { RequireRole } from '../../../../components/RequireRole';
import { appliedRange, count, failed, formatYmd, money, percentText, rangeQuery, useBlock, useCsvExport, type SourcesReport } from '../../../../lib/dashboard';
import { SkRows } from '../../../../components/Skeleton';

const P = 'dsh-analytics-sources';

/**
 * Báo cáo theo nguồn đơn (ui/analytics-sources, DSH-REQ-20261015-092608812): số đơn và doanh thu theo từng nguồn, cơ sở tính lương marketing. Doanh thu là GIÁ TRỊ ĐƠN (không phải tiền PAY) và đơn hủy, hết hạn,
 * hoàn về không được tính: hai dòng ghi chú luôn hiện cạnh con số. Thứ tự dòng và tên nguồn lấy nguyên từ máy chủ (khớp tệp CSV); tên nguồn do admin đặt nên chỉ hiện là văn bản thuần (React thoát).
 * Xuất CSV dùng khoảng đang xem (từ phản hồi), tệp do máy chủ dựng.
 */
function Inner() {
  const sp = useSearchParams();
  const go = useQueryGo('/admin/reports/sources');
  const from = sp.get('from'), to = sp.get('to');
  const b = useBlock<SourcesReport>(`/admin/reports/sources${rangeQuery(from, to)}`);
  const csv = useCsvExport();
  const d = b.data;
  if (b.status === 'forbidden') return <ForbiddenView />;
  const applied = appliedRange(from, to);
  const exporting = csv.state === 'loading';
  /** Áp dụng đúng khoảng đang xem thì tải lại (cùng đường dẫn nên URL không đổi); khác thì đổi URL. */
  const apply = (f: string, t: string): void => { csv.clear(); const same = (f || null) === from && (t || null) === to; go({ from: f || null, to: t || null }); if (same) b.reload(); };
  const share = (revenue: number): string => (d && d.totals.revenue > 0 ? percentText((revenue * 1000 / d.totals.revenue | 0) / 10) : '—'); // một chữ số thập phân, cắt (không làm tròn lên quá 100%)
  return (
    <main className="page">
      <Link className="back" href="/admin/dashboard"><span className="i i-left" aria-hidden="true" />Dashboard</Link>
      <div className="page-head"><h1>Báo cáo theo nguồn đơn</h1></div>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={b.status === 'invalid'} asOf={d?.as_of} onApply={apply} onReset={() => { csv.clear(); go({ from: null, to: null }); }}>
        <button type="button" className="btn" disabled={!d || failed(b) || exporting} onClick={() => d && void csv.run(`/admin/reports/sources${rangeQuery(d.from, d.to, { format: 'csv' })}`, `bao-cao-nguon-don_${d.from}_${d.to}.csv`)} data-testid={`${P}-export-csv`}>
          <span className="i i-download" aria-hidden="true" /> Xuất CSV
        </button>
        {exporting && <span className="small muted" role="status" data-testid={`${P}-export-loading`}>Đang tạo tệp</span>}
      </RangeBar>
      {csv.state === 'error' && <div role="alert" className="field-error" data-testid={`${P}-export-error`}>Không xuất được tệp CSV. Bấm Xuất CSV để thử lại.</div>}
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo theo nguồn đơn. <button type="button" className="btn btn-sm" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <div className="stack">
          <section className="stat-grid" aria-label="Tổng">
            <div className="stat"><span className="tile"><span className="i i-receipt" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-orders`}>{count(d.totals.orders)}</b><span className="lbl">Đơn được tính</span></div></div>
            <div className="stat"><span className="tile green"><span className="i i-trend" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-revenue`}>{money(d.totals.revenue)}</b><span className="lbl">Doanh thu (giá trị đơn)</span></div></div>
            <div className="stat"><span className="tile red"><span className="i i-xc" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-total-excluded`}>{count(d.totals.excluded_orders)}</b><span className="lbl">Đơn bị loại</span></div></div>
          </section>
          {d.totals.orders === 0 && (
            <div className="empty" data-testid={`${P}-empty`}>
              <span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span>
              <strong>Không có đơn được tính từ {formatYmd(d.from)} tới {formatYmd(d.to)}</strong>
              <Link className="btn tight" href="/admin/reports/sources">30 ngày qua</Link>
            </div>
          )}
          <div className="panel panel-flush" data-testid={`${P}-table`}>
            <div className="table-wrap">
              <table className="stack-table">
                <thead><tr><th>Nguồn</th><th className="num">Số đơn</th><th className="num">Doanh thu</th><th>Tỷ trọng</th></tr></thead>
                <tbody>
                  {d.items.map((x) => (
                    <tr key={x.source_id} data-testid={`${P}-row`} data-source={x.code}>
                      <td data-label="Nguồn" className="strong">{x.name}{!x.is_active && <> <span className="badge" data-testid={`${P}-row-inactive`}>đã tắt</span></>}</td>
                      <td data-label="Số đơn" className="num tabular">{count(x.orders)}</td>
                      <td data-label="Doanh thu" className="num tabular">{money(x.revenue)}</td>
                      <td data-label="Tỷ trọng" data-testid={`${P}-share`}>
                        <span className="dsh-share"><span className="dsh-meter" aria-hidden="true"><span style={{ width: `${d.totals.revenue > 0 ? (x.revenue * 100) / d.totals.revenue : 0}%` }} /></span><span className="tabular">{share(x.revenue)}</span></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="small muted" data-testid={`${P}-revenue-note`}><span className="i i-info" aria-hidden="true" /> Doanh thu là giá trị đơn (gồm phí vận chuyển, đã trừ giảm giá), không phải tiền đã thu.</p>
          <p className="small muted" data-testid={`${P}-excluded-note`}><span className="i i-info" aria-hidden="true" /> Không tính đơn đã hủy, hết hạn, hoàn về (cơ sở tính lương): số đơn bị loại {count(d.totals.excluded_orders)}.</p>
        </div>
      )}
    </main>
  );
}

export default function SourcesReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="page"><SkRows n={4} lead={false} /></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
