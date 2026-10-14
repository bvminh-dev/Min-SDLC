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
    <main className="wide">
      <h1>Sản phẩm bán chạy</h1>
      <p className="hint"><Link href="/admin/dashboard">Về dashboard</Link></p>
      <RateBanner testid={`${P}-rate-limit`} status={b.status} retryAfter={b.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={false} asOf={d?.as_of} onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null, sort: null, limit: null })}>
        <label className="dsh-field">Xếp theo
          <select value={sort} onChange={(e) => go({ sort: e.target.value === 'units' ? null : e.target.value })} data-testid={`${P}-sort`}>
            <option value="units">Số lượng</option><option value="amount">Giá trị</option>
          </select>
        </label>
        <label className="dsh-field">Số dòng
          <select value={limit} onChange={(e) => go({ limit: e.target.value === '10' ? null : e.target.value })} data-testid={`${P}-limit`}>
            {LIMITS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </RangeBar>
      {b.status === 'invalid' && <div role="alert" className="field-error" data-testid={`${P}-filter-error`}>Tham số không hợp lệ: khoảng tối đa 366 ngày, không sau hôm nay, Từ không sau Đến.</div>}
      {b.status === 'loading' && !d && <Skeleton testid={`${P}-loading`} rows={6} />}
      {failed(b) && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được báo cáo sản phẩm. <button type="button" className="btn tight" onClick={b.reload} data-testid={`${P}-retry`}>Thử lại</button></div>
      )}
      {d && !failed(b) && (
        <>
          <section className="dsh-kpis dsh-kpis-2" aria-label="Tổng của cả khoảng">
            <div className="dsh-kpi"><h2>Tổng số lượng bán</h2><p className="dsh-big tabular" data-testid={`${P}-units-total`}>{count(d.units_total)}</p></div>
            <div className="dsh-kpi"><h2>Sản phẩm khác nhau</h2><p className="dsh-big tabular" data-testid={`${P}-distinct`}>{count(d.distinct_products)}</p></div>
          </section>
          {d.items.length === 0
            ? <p className="hint" data-testid={`${P}-empty`}>Không có sản phẩm bán từ {formatYmd(d.from)} tới {formatYmd(d.to)}.</p>
            : (
              <div className="table-wrap" data-testid={`${P}-table`}>
                <table className="stack-table">
                  <thead><tr><th>Hạng</th><th>Sản phẩm</th><th className="num">Số lượng</th><th className="num">Giá trị hàng bán</th></tr></thead>
                  <tbody>
                    {d.items.map((x, i) => (
                      <tr key={x.product_id} data-testid={`${P}-row`} data-product={x.product_id}>
                        <td data-label="Hạng" className="tabular">{i + 1}</td>
                        <td data-label="Sản phẩm">{x.name || '—'}</td>
                        <td data-label="Số lượng" className="num tabular">{count(x.units_sold)}</td>
                        <td data-label="Giá trị hàng bán" className="num tabular">{money(x.items_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <p className="hint" data-testid={`${P}-note`}>Giá trị hàng bán là giá lúc đặt nhân số lượng, không phải doanh thu. Chỉ tính đơn đã thu tiền (theo ngày thu), không tính đơn hủy, hết hạn, hoàn về hay đã hoàn tiền.</p>
        </>
      )}
    </main>
  );
}

export default function ProductsReportPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
