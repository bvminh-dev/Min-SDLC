'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BlockError, ForbiddenView, RangeBar, RateBanner, ReportLink, Skeleton } from '../../../components/DashboardParts';
import { useQueryGo } from '../../../components/ReviewParts';
import { RequireRole } from '../../../components/RequireRole';
import {
  appliedRange, count, defaultRange, failed, formatYmd, money, rangeQuery, STATUS_ORDER, useBlock,
  type CustomersBlock, type LowStockBlock, type OrdersBlock, type ProductsBlock, type RecentBlock, type RevenueBlock,
} from '../../../lib/dashboard';
import { formatOrderTime, ORDER_STATUS_LABEL, paymentText } from '../../../lib/order';

const P = 'dsh-admin-dashboard';

/** Dashboard quản trị (ui/admin-dashboard): sáu khối tải ĐỘC LẬP; ba khối theo khoảng ngày (doanh thu, đơn, khách mới), ba khối là số hiện tại. Khoảng ngày nằm trên URL (`?from=&to=`). */
function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const go = useQueryGo('/admin/dashboard');
  const from = sp.get('from'), to = sp.get('to');
  const q = rangeQuery(from, to);
  const revenue = useBlock<RevenueBlock>(`/admin/dashboard/revenue${q}`);
  const orders = useBlock<OrdersBlock>(`/admin/dashboard/orders${q}`);
  const customers = useBlock<CustomersBlock>(`/admin/dashboard/customers${q}`);
  const products = useBlock<ProductsBlock>('/admin/dashboard/products');
  const low = useBlock<LowStockBlock>('/admin/dashboard/low-stock');
  const recent = useBlock<RecentBlock>('/admin/dashboard/recent-orders');
  const blocks = [revenue, orders, customers, products, low, recent];
  const asOf = blocks.map((b) => b.data?.as_of).filter((x): x is string => !!x).sort().pop();
  const ranged = [revenue, orders, customers];
  const invalid = ranged.some((b) => b.status === 'invalid');
  const limited = blocks.find((b) => b.status === 'limited');
  const refresh = () => blocks.forEach((b) => b.reload());
  const applied = appliedRange(from, to);
  const reportQ = rangeQuery(from, to);

  if (blocks.some((b) => b.status === 'forbidden')) return <ForbiddenView />;
  return (
    <main className="wide">
      <h1>Dashboard</h1>
      <RateBanner testid={`${P}-rate-limit`} status={limited?.status} retryAfter={limited?.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={invalid} asOf={asOf}
        onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null })}>
        <button type="button" className="btn tight" onClick={refresh} data-testid={`${P}-refresh`}>Làm mới</button>
      </RangeBar>
      {(revenue.data?.failed_refund_count ?? 0) > 0 && !failed(revenue) && (
        <div role="status" className="banner banner-info dsh-alert" data-testid={`${P}-refund-alert`}>
          <span>{revenue.data!.failed_refund_count} hoàn tiền thất bại cần xử lý</span>{' '}
          <Link href="/admin/refunds?status=failed" data-testid={`${P}-refund-alert-link`}>Xem hàng đợi hoàn tiền</Link>
        </div>
      )}
      <section className="dsh-kpis" aria-label="Số liệu chính">
        <div className="dsh-kpi">
          <h2>Doanh thu thuần</h2>
          <p className="hint">Tiền thu thành công trừ hoàn tiền (theo PAY)</p>
          {revenue.status === 'loading' && !revenue.data && <Skeleton testid={`${P}-kpi-revenue-loading`} />}
          {failed(revenue) && <BlockError what="doanh thu" testid={`${P}-kpi-revenue-error`} retryTestid={`${P}-kpi-revenue-retry`} onRetry={revenue.reload} />}
          {revenue.data && !failed(revenue) && (
            <>
              <p className="dsh-big tabular" data-testid={`${P}-kpi-revenue`}>{money(revenue.data.net)}</p>
              <p className="hint tabular" data-testid={`${P}-kpi-revenue-detail`}>Thu {money(revenue.data.gross)} · Hoàn {money(revenue.data.refunded)} · {count(revenue.data.payment_count)} giao dịch</p>
              {revenue.data.net < 0 && <p className="hint">Hoàn tiền của kỳ trước lớn hơn tiền thu trong khoảng.</p>}
              <ReportLink href={`/admin/reports/revenue${reportQ}`} testid={`${P}-kpi-revenue-report-link`}>Xem báo cáo</ReportLink>
            </>
          )}
        </div>
        <div className="dsh-kpi">
          <h2>Tổng đơn</h2>
          {orders.status === 'loading' && !orders.data && <Skeleton testid={`${P}-kpi-orders-loading`} />}
          {failed(orders) && <BlockError what="số đơn" testid={`${P}-kpi-orders-error`} retryTestid={`${P}-kpi-orders-retry`} onRetry={orders.reload} />}
          {orders.data && !failed(orders) && (
            <>
              <p className="dsh-big tabular" data-testid={`${P}-kpi-orders`}>{count(orders.data.total)}</p>
              <p className="hint tabular" data-testid={`${P}-kpi-orders-effective`}>Hiệu lực {count(orders.data.effective)}</p>
              <ul className="dsh-statuses" data-testid={`${P}-kpi-orders-by-status`}>
                {STATUS_ORDER.map((s) => <li key={s}><span>{ORDER_STATUS_LABEL[s]}</span> <strong className="tabular">{count(orders.data!.by_status[s])}</strong></li>)}
              </ul>
              <ReportLink href={`/admin/reports/orders${reportQ}`} testid={`${P}-kpi-orders-report-link`}>Xem báo cáo</ReportLink>
            </>
          )}
        </div>
        <div className="dsh-kpi">
          <h2>Khách hàng</h2>
          {customers.status === 'loading' && !customers.data && <Skeleton testid={`${P}-kpi-customers-loading`} />}
          {failed(customers) && <BlockError what="số khách" testid={`${P}-kpi-customers-error`} retryTestid={`${P}-kpi-customers-retry`} onRetry={customers.reload} />}
          {customers.data && !failed(customers) && (
            <>
              <p className="dsh-big tabular" data-testid={`${P}-kpi-customers`}>{count(customers.data.total)}</p>
              <p className="hint tabular"><span data-testid={`${P}-kpi-customers-new`}>Mới {count(customers.data.new_in_range)}</span> · <span data-testid={`${P}-kpi-customers-locked`}>Khóa {count(customers.data.locked)}</span></p>
            </>
          )}
        </div>
        <div className="dsh-kpi">
          <h2>Sản phẩm đang bán</h2>
          {products.status === 'loading' && !products.data && <Skeleton testid={`${P}-kpi-products-loading`} />}
          {failed(products) && <BlockError what="số sản phẩm" testid={`${P}-kpi-products-error`} retryTestid={`${P}-kpi-products-retry`} onRetry={products.reload} />}
          {products.data && !failed(products) && (
            <>
              <p className="dsh-big tabular" data-testid={`${P}-kpi-products`}>{count(products.data.by_status.active)}</p>
              <p className="hint tabular" data-testid={`${P}-kpi-products-breakdown`}>Tổng {count(products.data.total)} · Nháp {count(products.data.by_status.draft)} · Ngừng bán {count(products.data.by_status.archived)}</p>
            </>
          )}
        </div>
      </section>
      <p className="hint">Khoảng ngày {formatYmd(revenue.data?.from ?? defaultRange().from)} tới {formatYmd(revenue.data?.to ?? defaultRange().to)} áp cho Doanh thu, Tổng đơn và Khách mới; Sản phẩm, Tồn thấp và Đơn gần đây là số hiện tại.</p>
      <div className="dsh-widgets">
        <section className="dsh-widget dsh-widget-wide" aria-label="Đơn gần đây">
          <div className="between"><h2>Đơn gần đây</h2>{recent.data && recent.data.items.length > 0 && <Link href="/admin/orders" data-testid={`${P}-recent-orders-view-all`}>Xem tất cả</Link>}</div>
          {recent.status === 'loading' && !recent.data && <Skeleton testid={`${P}-recent-orders-loading`} rows={5} />}
          {failed(recent) && <BlockError what="đơn gần đây" testid={`${P}-recent-orders-error`} retryTestid={`${P}-recent-orders-retry`} onRetry={recent.reload} />}
          {recent.data && !failed(recent) && (recent.data.items.length === 0
            ? <p className="hint" data-testid={`${P}-recent-orders-empty`}>Chưa có đơn hàng nào</p>
            : (
              <div className="table-wrap">
                <table className="stack-table">
                  <thead><tr><th>Mã đơn</th><th>Tạo lúc</th><th>Trạng thái</th><th>Thanh toán</th><th className="num">Giá trị đơn</th></tr></thead>
                  <tbody>
                    {recent.data.items.map((o) => (
                      <tr key={o.code} className="row-click" onClick={() => router.push(`/orders/${encodeURIComponent(o.code)}`)} data-testid={`${P}-recent-orders-row`} data-code={o.code}>
                        <td data-label="Mã đơn" className="mono"><Link href={`/orders/${encodeURIComponent(o.code)}`} onClick={(e) => e.stopPropagation()} data-testid={`${P}-recent-orders-code`}>{o.code}</Link></td>
                        <td data-label="Tạo lúc" className="tabular">{formatOrderTime(o.created_at)}</td>
                        <td data-label="Trạng thái"><span className="badge" data-testid={`${P}-recent-orders-status`}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span></td>
                        <td data-label="Thanh toán" data-testid={`${P}-recent-orders-payment`}>{paymentText(o.payment_method, o.payment_status)}</td>
                        <td data-label="Giá trị đơn" className="num tabular" data-testid={`${P}-recent-orders-total`}>{money(o.grand_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
        <section className="dsh-widget" aria-label="Tồn thấp">
          <div className="between">
            <h2>Tồn thấp{low.data ? <> (<span data-testid={`${P}-low-stock-count`}>{count(low.data.count)}</span>)</> : ''}</h2>
            {low.data && low.data.count > 0 && <Link href="/admin/inventory?tab=low" data-testid={`${P}-low-stock-view-all`}>Xem tất cả</Link>}
          </div>
          {low.status === 'loading' && !low.data && <Skeleton testid={`${P}-low-stock-loading`} rows={5} />}
          {failed(low) && <BlockError what="tồn thấp" testid={`${P}-low-stock-error`} retryTestid={`${P}-low-stock-retry`} onRetry={low.reload} />}
          {low.data && !failed(low) && (low.data.count === 0
            ? <p className="hint" data-testid={`${P}-low-stock-empty`}>Không có sản phẩm tồn thấp</p>
            : (
              <ul className="dsh-low">
                {low.data.items.map((i) => (
                  <li key={i.product_id} data-testid={`${P}-low-stock-row`}>
                    <Link href={`/admin/inventory/${encodeURIComponent(i.product_id)}`}><span>{i.name || '—'}</span> <span className="mono hint">{i.sku}</span> <strong className="tabular" aria-label={`còn bán ${i.available}`}>{count(i.available)}</strong></Link>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>
    </main>
  );
}

export default function AdminDashboardPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
