'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ForbiddenView, RangeBar, RateBanner, Skeleton } from '../../../../components/DashboardParts';
import { useQueryGo } from '../../../../components/ReviewParts';
import { RequireRole } from '../../../../components/RequireRole';
import { appliedRange, count, DELETED_ACCOUNT_LABEL, failed, formatYmd, money, rangeQuery, useBlock, useCsvExport, type SalesReport } from '../../../../lib/dashboard';

const P = 'dsh-analytics-sales';

/**
 * Báo cáo theo sale (ui/analytics-sales, DSH-REQ-20261015-092608849): số đơn và doanh thu theo người tạo đơn hộ, kèm dòng cố định "Khách tự đặt (website)" ở cuối bảng, làm cơ sở tính lương sale.
 * Tên người tạo là chữ do người dùng đặt: chỉ hiện là văn bản thuần (React thoát), không bao giờ dựng HTML từ tên; hai người trùng tên vẫn là hai dòng (gom theo mã người dùng, mã rút gọn ở tooltip).
 * Thứ tự dòng lấy nguyên từ máy chủ (khớp tệp CSV). Doanh thu là giá trị đơn, đơn hủy, hết hạn, hoàn về không được tính. Lỗi tra tên (503) không bao giờ hiện bảng thiếu tên.
 */
function Inner() {
  const sp = useSearchParams();
  const go = useQueryGo('/admin/reports/sales');
  const from = sp.get('from'), to = sp.get('to');
  const b = useBlock<SalesReport>(`/admin/reports/sales${rangeQuery(from, to)}`);
  const csv = useCsvExport();
  const d = b.data;
  if (b.status === 'forbidden') return <ForbiddenView />;
  const applied = appliedRange(from, to);
  const exporting = csv.state === 'loading';
  /** Áp dụng đúng khoảng đang xem thì tải lại (cùng đường dẫn nên URL không đổi); khác thì đổi URL. */
  const apply = (f: string, t: string): void => { csv.clear(); const same = (f || null) === from && (t || null) === to; go({ from: f || null, to: t || null }); if (same) b.reload(); };
  return (
    <main className="page">
      <Link className="back" href="/admin/dashboard"><span className="i i-left" aria-hidden="true" />Dashboard</Link>
      <div className="page-head"><h1>Báo cáo theo sale</h1></div>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={b.status === 'invalid'} asOf={d?.as_of} onApply={apply} onReset={() => { csv.clear(); go({ from: null, to: null }); }}>
        <button type="button" className="btn" disabled={!d || failed(b) || exporting} onClick={() => d && void csv.run(`/admin/reports/sales${rangeQuery(d.from, d.to, { format: 'csv' })}`, `bao-cao-sale_${d.from}_${d.to}.csv`)} data-testid={`${P}-export-csv`}>
          <span className="i i-download" aria-hidden="true" /> Xuất CSV
        </button>
        {exporting && <span className="small muted" role="status" data-testid={`${P}-export-loading`}>Đang tạo tệp</span>}
      </RangeBar>
      {csv.state === 'error' && <div role="alert" className="field-error" data-testid={`${P}-export-error`}>Không xuất được tệp CSV. Bấm Xuất CSV để thử lại.</div>}
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo theo sale. <button type="button" className="btn btn-sm" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
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
              <Link className="btn tight" href="/admin/reports/sales">30 ngày qua</Link>
            </div>
          )}
          <div className="panel panel-flush" data-testid={`${P}-table`}>
            <div className="table-wrap">
              <table className="stack-table">
                <thead><tr><th>Người tạo đơn</th><th className="num">Số đơn</th><th className="num">Doanh thu</th></tr></thead>
                <tbody>
                  {d.items.map((x) => (
                    <tr key={x.user_id} data-testid={`${P}-row`} data-user={x.user_id}>
                      <td data-label="Người tạo đơn" className="strong" title={`${x.name} (${x.user_id.slice(0, 8)})`}>
                        {x.name === DELETED_ACCOUNT_LABEL ? <span data-testid={`${P}-row-deleted`}>{x.name}</span> : x.name}
                      </td>
                      <td data-label="Số đơn" className="num tabular">{count(x.orders)}</td>
                      <td data-label="Doanh thu" className="num tabular">{money(x.revenue)}</td>
                    </tr>
                  ))}
                  <tr className="dsh-website-row" data-testid={`${P}-website-row`}>
                    <td data-label="Người tạo đơn" className="muted">{d.website.name}</td>
                    <td data-label="Số đơn" className="num tabular">{count(d.website.orders)}</td>
                    <td data-label="Doanh thu" className="num tabular">{money(d.website.revenue)}</td>
                  </tr>
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

export default function SalesReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="page"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
