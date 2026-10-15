'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ForbiddenView, RangeBar, RateBanner, Skeleton } from '../../../../components/DashboardParts';
import { useQueryGo } from '../../../../components/ReviewParts';
import { RequireRole } from '../../../../components/RequireRole';
import { appliedRange, count, failed, formatYmd, money, rangeQuery, useBlock, type ProductsReport } from '../../../../lib/dashboard';

const P = 'dsh-analytics-products';
const LIMITS = ['5', '10', '20', '50'];

/** Báo cáo sản phẩm bán chạy (ui/analytics-products): chỉ đơn đã thu tiền, tính theo ngày thu; giá trị hàng bán KHÔNG phải doanh thu. Cách xếp và số dòng đổi là tải lại ngay. */
function Inner() {
  const sp = useSearchParams();
  const go = useQueryGo('/admin/reports/products');
  const from = sp.get('from'), to = sp.get('to');
  const sort = sp.get('sort') === 'amount' ? 'amount' : 'units';
  const limit = LIMITS.includes(sp.get('limit') ?? '') ? (sp.get('limit') as string) : '10';
  const extra: Record<string, string> = {};
  if (sp.get('sort')) extra.sort = sp.get('sort') as string;
  if (sp.get('limit')) extra.limit = sp.get('limit') as string;
  const b = useBlock<ProductsReport>(`/admin/reports/products${rangeQuery(from, to, extra)}`);
  const d = b.data;
  if (b.status === 'forbidden') return <ForbiddenView />;
  const applied = appliedRange(from, to);
  return (
    <main className="page">
      <Link className="back" href="/admin/dashboard"><span className="i i-left" aria-hidden="true" />Dashboard</Link>
      <div className="page-head"><h1>Bán chạy</h1></div>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={false} asOf={d?.as_of} onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null, sort: null, limit: null })}>
        <select value={sort} aria-label="Xếp theo" onChange={(e) => go({ sort: e.target.value === 'units' ? null : e.target.value })} data-testid={`${P}-sort`}>
          <option value="units">Số lượng</option><option value="amount">Giá trị</option>
        </select>
        <select value={limit} aria-label="Số dòng" onChange={(e) => go({ limit: e.target.value === '10' ? null : e.target.value })} data-testid={`${P}-limit`}>
          {LIMITS.map((l) => <option key={l} value={l}>{l} dòng</option>)}
        </select>
      </RangeBar>
      {b.status === 'invalid' && <div role="alert" className="banner banner-error" data-testid={`${P}-filter-error`}>Khoảng tối đa 366 ngày, không sau hôm nay, Từ không sau Đến.</div>}
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo. <button type="button" className="btn btn-sm" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <div className="stack">
          <section className="stat-grid rd-two" aria-label="Tổng của cả khoảng">
            <div className="stat"><span className="tile green"><span className="i i-box" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-units-total`}>{count(d.units_total)}</b><span className="lbl">Đã bán</span></div></div>
            <div className="stat"><span className="tile violet"><span className="i i-tag" aria-hidden="true" /></span><div><b className="tabular" data-testid={`${P}-distinct`}>{count(d.distinct_products)}</b><span className="lbl">Sản phẩm</span></div></div>
          </section>
          {d.items.length === 0
            ? <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span><strong>Chưa bán được</strong><span className="small">{formatYmd(d.from)} – {formatYmd(d.to)}</span></div>
            : (
              <div className="panel panel-flush" data-testid={`${P}-table`}>
                <div className="table-wrap">
                  <table className="stack-table">
                    <thead><tr><th>#</th><th>Sản phẩm</th><th className="num">SL</th><th className="num">Giá trị</th></tr></thead>
                    <tbody>
                      {d.items.map((x, i) => (
                        <tr key={x.product_id} data-testid={`${P}-row`} data-product={x.product_id}>
                          <td data-label="Hạng"><span className={`rd-rank${i < 3 ? ' top' : ''}`}>{i + 1}</span></td>
                          <td data-label="Sản phẩm" className="strong">{x.name || '—'}</td>
                          <td data-label="SL" className="num tabular">{count(x.units_sold)}</td>
                          <td data-label="Giá trị" className="num tabular">{money(x.items_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          <p className="small muted" data-testid={`${P}-note`}><span className="i i-info" aria-hidden="true" /> Chỉ đơn đã thu tiền; không phải doanh thu.</p>
        </div>
      )}
    </main>
  );
}

export default function ProductsReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="page"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
