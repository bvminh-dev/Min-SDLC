'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BlockError, ForbiddenView, Kpi, RangeBar, RateBanner, ReportLink, Skeleton } from '../../../components/DashboardParts';
import { useQueryGo } from '../../../components/ReviewParts';
import { RequireRole } from '../../../components/RequireRole';
import {
  appliedRange, count, failed, money, rangeQuery, STATUS_ORDER, useBlock,
  type CustomersBlock, type LowStockBlock, type OrdersBlock, type ProductsBlock, type RecentBlock, type RevenueBlock,
} from '../../../lib/dashboard';
import { formatOrderTime, ORDER_STATUS_LABEL, paymentText } from '../../../lib/order';
import { SkRows } from '../../../components/Skeleton';

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
  const od = orders.data;
  return (
    <main className="page">
      <div className="page-head"><h1>Dashboard</h1></div>
      <nav className="rd-bar-tools" aria-label="Báo cáo tính lương">
        <Link className="btn btn-sm" href={`/admin/reports/sources${reportQ}`} data-testid={`${P}-link-sources`}><span className="i i-chart" aria-hidden="true" /> Báo cáo theo nguồn đơn</Link>
        <Link className="btn btn-sm" href={`/admin/reports/sales${reportQ}`} data-testid={`${P}-link-sales`}><span className="i i-users" aria-hidden="true" /> Báo cáo theo sale</Link>
      </nav>
      <RateBanner testid={`${P}-rate-limit`} status={limited?.status} retryAfter={limited?.retryAfter} />
      <RangeBar p={P} applied={applied} invalid={invalid} asOf={asOf}
        onApply={(f, t) => go({ from: f || null, to: t || null })} onReset={() => go({ from: null, to: null })}>
        <button type="button" className="btn btn-icon" aria-label="Làm mới" onClick={refresh} data-testid={`${P}-refresh`}><span className="i i-refresh" aria-hidden="true" /></button>
      </RangeBar>
      {(revenue.data?.failed_refund_count ?? 0) > 0 && !failed(revenue) && (
        <div role="status" className="banner banner-info dsh-alert" data-testid={`${P}-refund-alert`}>
          <span>{revenue.data!.failed_refund_count} hoàn tiền lỗi</span>{' '}
          <Link href="/admin/refunds?status=failed" data-testid={`${P}-refund-alert-link`}>Xử lý</Link>
        </div>
      )}
      <section className="stat-grid" aria-label="Số liệu chính">
        <Kpi icon="trend" tone="green" label="Doanh thu"
          aside={revenue.data && !failed(revenue) ? <ReportLink href={`/admin/reports/revenue${reportQ}`} testid={`${P}-kpi-revenue-report-link`}>Xem báo cáo</ReportLink> : undefined}>
          {revenue.status === 'loading' && !revenue.data && <Skeleton testid={`${P}-kpi-revenue-loading`} rows={1} />}
          {failed(revenue) && <BlockError what="doanh thu" testid={`${P}-kpi-revenue-error`} retryTestid={`${P}-kpi-revenue-retry`} onRetry={revenue.reload} />}
          {revenue.data && !failed(revenue) && (
            <>
              <b className="tabular" data-testid={`${P}-kpi-revenue`}>{money(revenue.data.net)}</b>
              <span className="small muted tabular" data-testid={`${P}-kpi-revenue-detail`}>{count(revenue.data.payment_count)} giao dịch · hoàn {money(revenue.data.refunded)}</span>
              {revenue.data.net < 0 && <span className="small muted">Hoàn kỳ trước lớn hơn thu.</span>}
            </>
          )}
        </Kpi>
        <Kpi icon="receipt" label="Đơn"
          aside={od && !failed(orders) ? <ReportLink href={`/admin/reports/orders${reportQ}`} testid={`${P}-kpi-orders-report-link`}>Xem báo cáo</ReportLink> : undefined}>
          {orders.status === 'loading' && !od && <Skeleton testid={`${P}-kpi-orders-loading`} rows={1} />}
          {failed(orders) && <BlockError what="số đơn" testid={`${P}-kpi-orders-error`} retryTestid={`${P}-kpi-orders-retry`} onRetry={orders.reload} />}
          {od && !failed(orders) && (
            <>
              <b className="tabular" data-testid={`${P}-kpi-orders`}>{count(od.total)}</b>
              <span className="small muted tabular" data-testid={`${P}-kpi-orders-effective`}>Hiệu lực {count(od.effective)}</span>
            </>
          )}
        </Kpi>
        <Kpi icon="users" tone="violet" label="Khách">
          {customers.status === 'loading' && !customers.data && <Skeleton testid={`${P}-kpi-customers-loading`} rows={1} />}
          {failed(customers) && <BlockError what="số khách" testid={`${P}-kpi-customers-error`} retryTestid={`${P}-kpi-customers-retry`} onRetry={customers.reload} />}
          {customers.data && !failed(customers) && (
            <>
              <b className="tabular" data-testid={`${P}-kpi-customers`}>{count(customers.data.total)}</b>
              <span className="small muted tabular"><span data-testid={`${P}-kpi-customers-new`}>Mới {count(customers.data.new_in_range)}</span> · <span data-testid={`${P}-kpi-customers-locked`}>Khóa {count(customers.data.locked)}</span></span>
            </>
          )}
        </Kpi>
        <Kpi icon="tag" tone="amber" label="Sản phẩm">
          {products.status === 'loading' && !products.data && <Skeleton testid={`${P}-kpi-products-loading`} rows={1} />}
          {failed(products) && <BlockError what="số sản phẩm" testid={`${P}-kpi-products-error`} retryTestid={`${P}-kpi-products-retry`} onRetry={products.reload} />}
          {products.data && !failed(products) && (
            <>
              <b className="tabular" data-testid={`${P}-kpi-products`}>{count(products.data.by_status.active)}</b>
              <span className="small muted tabular" data-testid={`${P}-kpi-products-breakdown`}>Tổng {count(products.data.total)} · Nháp {count(products.data.by_status.draft)} · Ngừng {count(products.data.by_status.archived)}</span>
            </>
          )}
        </Kpi>
      </section>
      {od && !failed(orders) && (
        <ul className="rd-chips" data-testid={`${P}-kpi-orders-by-status`} aria-label="Đơn theo trạng thái">
          {STATUS_ORDER.map((s) => <li key={s}><span className="badge" data-status={s}>{ORDER_STATUS_LABEL[s]} <b className="tabular">{count(od.by_status[s])}</b></span></li>)}
        </ul>
      )}
      <div className="split rd-split">
        <section className="panel" aria-label="Đơn gần đây">
          <div className="panel-head"><h2><span className="tile gray"><span className="i i-clock" aria-hidden="true" /></span>Đơn gần đây</h2>{recent.data && recent.data.items.length > 0 && <Link className="btn btn-ghost btn-sm" href="/admin/orders" data-testid={`${P}-recent-orders-view-all`}>Tất cả<span className="i i-right" aria-hidden="true" /></Link>}</div>
          {recent.status === 'loading' && !recent.data && <Skeleton testid={`${P}-recent-orders-loading`} rows={5} />}
          {failed(recent) && <BlockError what="đơn gần đây" testid={`${P}-recent-orders-error`} retryTestid={`${P}-recent-orders-retry`} onRetry={recent.reload} />}
          {recent.data && !failed(recent) && (recent.data.items.length === 0
            ? <div className="empty" data-testid={`${P}-recent-orders-empty`}><span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span><strong>Chưa có đơn</strong></div>
            : (
              <ul className="list">
                {recent.data.items.map((o) => (
                  <li key={o.code} className="row-click rd-order" onClick={() => router.push(`/orders/${encodeURIComponent(o.code)}`)} data-testid={`${P}-recent-orders-row`} data-code={o.code}>
                    <div className="grow">
                      <Link className="mono strong" href={`/orders/${encodeURIComponent(o.code)}`} onClick={(e) => e.stopPropagation()} data-testid={`${P}-recent-orders-code`}>{o.code}</Link>
                      <div className="small muted truncate"><span className="tabular">{formatOrderTime(o.created_at)}</span> · <span data-testid={`${P}-recent-orders-payment`}>{paymentText(o.payment_method, o.payment_status)}</span></div>
                    </div>
                    <span className="badge" data-status={o.status} data-testid={`${P}-recent-orders-status`}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
                    <span className="money tabular rd-order-total" data-testid={`${P}-recent-orders-total`}>{money(o.grand_total)}</span>
                  </li>
                ))}
              </ul>
            ))}
        </section>
        <section className="panel" aria-label="Tồn thấp">
          <div className="panel-head">
            <h2><span className="tile red"><span className="i i-alert" aria-hidden="true" /></span>Tồn thấp{low.data ? <span className="rd-n rd-n-red" data-testid={`${P}-low-stock-count`}>{count(low.data.count)}</span> : null}</h2>
            {low.data && low.data.count > 0 && <Link className="btn btn-ghost btn-sm" href="/admin/inventory?tab=low" data-testid={`${P}-low-stock-view-all`}>Tất cả<span className="i i-right" aria-hidden="true" /></Link>}
          </div>
          {low.status === 'loading' && !low.data && <Skeleton testid={`${P}-low-stock-loading`} rows={5} />}
          {failed(low) && <BlockError what="tồn thấp" testid={`${P}-low-stock-error`} retryTestid={`${P}-low-stock-retry`} onRetry={low.reload} />}
          {low.data && !failed(low) && (low.data.count === 0
            ? <div className="empty" data-testid={`${P}-low-stock-empty`}><span className="tile tile-lg green"><span className="i i-okc" aria-hidden="true" /></span><strong>Đủ hàng</strong></div>
            : (
              <ul className="list rd-low">
                {low.data.items.map((i) => (
                  <li key={i.product_id} data-testid={`${P}-low-stock-row`}>
                    <Link className="grow" href={`/admin/inventory/${encodeURIComponent(i.product_id)}`}>
                      <span className="truncate strong">{i.name || '—'}</span>
                      <span className="mono small muted truncate">{i.sku}</span>
                    </Link>
                    <strong className="rd-low-n tabular" aria-label={`còn bán ${i.available}`}>{count(i.available)}</strong>
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
      <Suspense fallback={<main className="page"><SkRows n={4} lead={false} /></main>}><Inner /></Suspense>
    </RequireRole>
  );
}
