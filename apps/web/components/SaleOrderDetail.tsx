'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { ORDER_STATUS_LABEL, formatOrderTime, paymentText } from '../lib/order';
import { cancelText, type SaleOrderDetail as Detail } from '../lib/sales';
import { useCountdown } from './useCountdown';

const P = 'sal-sale-order-detail';
type View = 'loading' | 'ready' | 'notfound' | 'error' | 'rate' | 'login';

/**
 * Chi tiết đơn hộ (ui/sale-order-detail, SAL-REQ-20261015-092711321): chỉ đọc, không nút sửa hay hủy (hủy là việc của admin ở ORD). Sale chỉ thấy đơn mình tạo, admin thấy mọi đơn hộ kèm người tạo.
 * 404 chung cho đơn của người khác, không tồn tại, mã sai và đơn khách tự đặt. Không có giá vốn, `user_id` hay email khách (SB-42). Ghi chú đơn và ghi chú dòng là văn bản thuần: React escape,
 * xuống dòng giữ bằng CSS `white-space: pre-wrap`, không bao giờ `dangerouslySetInnerHTML` (SB-12, SB-45).
 */
export function SaleOrderDetail({ code }: { code: string }) {
  const [view, setView] = useState<View>('loading');
  const [o, setO] = useState<Detail | null>(null);
  const seq = useRef(0);
  const limit = useCountdown();
  const wasLimited = useRef(false);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const r = await api<Detail>(`/sales/orders/${encodeURIComponent(code)}`);
    if (id !== seq.current) return;
    if (r.status === 200 && typeof r.body.code === 'string') { setO(r.body); setView('ready'); }
    else if (r.status === 404) setView('notfound'); // cùng một giao diện cho mọi lý do (SB-44)
    else if (r.status === 401) setView('login');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [code]); // limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  if (view === 'loading' && !o) return <main className="page page-mid" data-testid={`${P}-loading`} aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></main>;
  if (view === 'notfound') {
    return (
      <main className="page page-narrow">
        <section className="panel empty" data-testid={`${P}-not-found`}>
          <span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span>
          <h1>Không tìm thấy đơn này.</h1>
          <Link className="btn btn-primary tight" href="/sales/orders" data-testid={`${P}-back`}>Đơn của tôi</Link>
        </section>
      </main>
    );
  }
  if (view === 'login') return <main className="page page-mid"><div role="alert" className="banner banner-error" data-testid={`${P}-login-expired`}>Phiên đăng nhập đã hết hạn. <Link href={`/login?next=${encodeURIComponent(`/sales/orders/${code}`)}&reason=expired`}>Đăng nhập</Link></div></main>;
  if (view === 'rate' && limit.left > 0) return <main className="page page-mid"><div role="alert" className="banner banner-error" data-testid={`${P}-rate-limited`}>Thao tác quá nhanh, tự tải lại sau {limit.left} giây. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div></main>;
  if (view === 'error' || !o) return <main className="page page-mid"><div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được đơn. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div></main>;

  const a = o.shipping_address;
  const address = [a.line1, a.ward, a.district, a.city].filter((x) => x && x.trim()).join(', ');
  return (
    <main className="page page-mid" data-testid={`${P}-container`}>
      <Link className="back" href="/sales/orders" data-testid={`${P}-back`}><span className="i i-left" aria-hidden="true" />Đơn của tôi</Link>
      <div className="page-head">
        <h1>Đơn <span className="mono ord-h-code" data-testid={`${P}-code`}>{o.code}</span></h1>
        <div className="actions">
          <span className="badge" data-status={o.status} data-testid={`${P}-status`}>{ORDER_STATUS_LABEL[o.status]}</span>
          <span className="muted small" data-testid={`${P}-created-at`}>Tạo {formatOrderTime(o.created_at)}</span>
        </div>
      </div>
      <div className="stack">
        <section className="panel stack-sm">
          <p>Nguồn: <b data-testid={`${P}-source`}>{o.source.name}</b></p>
          {o.created_by && <p>Người tạo: <b data-testid={`${P}-created-by`}>{o.created_by.name ?? 'Không rõ'}</b></p>}
          <p data-testid={`${P}-payment`}>{paymentText(o.payment_method, o.payment_status)}</p>
          {o.status === 'cancelled' && o.cancel_reason && <p className="field-error" data-testid={`${P}-cancel-reason`}>Lý do hủy: {cancelText(o.cancel_reason)}</p>}
        </section>
        <section className="panel stack-sm">
          <p>Khách: <b data-testid={`${P}-customer`}>{o.customer.name} · {o.customer.phone}</b>{o.customer.has_account && <> <span className="badge" data-testid={`${P}-has-account`}>Đã gắn tài khoản khách</span></>}</p>
          <div className="ord-addr" data-testid={`${P}-address`}><span>Giao tới: {a.receiver} · {a.phone}</span><span>{address}</span></div>
          {o.note ? <p className="ord-note" data-testid={`${P}-note`}>Ghi chú đơn: {o.note}</p> : <p className="muted" data-testid={`${P}-note-empty`}>Không có ghi chú</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Sản phẩm</h2></div>
          <ul className="list">
            {o.items.map((i) => (
              <li key={i.product_id} data-testid={`${P}-item`}>
                <div className="grow"><div className="strong">{i.name}</div><div className="muted small">{formatPrice(i.unit_price)} × {i.quantity}</div>{i.note && <div className="small ord-note" data-testid={`${P}-item-note`}>Ghi chú: {i.note}</div>}</div>
                <span className="money">{formatPrice(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="kv ord-totals">
            <dt>Tạm tính</dt><dd className="right" data-testid={`${P}-items-total`}>{formatPrice(o.items_total)}</dd>
            <dt>Phí vận chuyển</dt><dd className="right" data-testid={`${P}-shipping-fee`}>{formatPrice(o.shipping_fee)}</dd>
            <dt className="strong">Tổng cộng</dt><dd className="right money ord-grand" data-testid={`${P}-grand-total`}>{formatPrice(o.grand_total)}</dd>
          </dl>
        </section>
      </div>
    </main>
  );
}
