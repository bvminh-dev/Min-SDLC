'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { ORDER_STATUS_LABEL, formatOrderTime, paymentText } from '../lib/order';
import { cancelText, type SaleOrderDetail as Detail } from '../lib/sales';
import { useCountdown } from './useCountdown';
import { SkPanel, SkRows } from './Skeleton';

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

  if (view === 'loading' && !o) return <main className="page page-mid" data-testid={`${P}-loading`} aria-busy="true"><SkPanel n={3} /><SkRows n={3} lead="square" lines={3} trail /><SkPanel n={3} /></main>;
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
  // "Chuyển khoản · Chưa thu tiền" tách hai dòng; đơn đã hủy chưa thu thì nói rõ không thu, không để "Đã hủy" đứng một mình
  const [payMethod, payState] = paymentText(o.payment_method, o.payment_status).split(' · ');
  const cancelled = o.status === 'cancelled';
  const payTone = cancelled && o.payment_status !== 'succeeded' ? 'gray' : o.payment_status === 'succeeded' ? 'green' : o.payment_status === 'pending' || o.payment_status === 'processing' ? 'amber' : o.payment_status === 'failed' ? 'red' : 'gray';
  const payIcon = o.payment_method === 'bank_transfer' ? 'bank' : 'cash';
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
      {cancelled && o.cancel_reason && <div className="banner banner-error" data-testid={`${P}-cancel-reason`}><b>Đơn đã hủy.</b> Lý do hủy: {cancelText(o.cancel_reason)}</div>}
      <div className="stack">
        <section className="panel sal-d-check">
          <div>
            <div className="sal-d-cap"><span className="i i-user" aria-hidden="true" />Khách</div>
            <div className="sal-d-who"><span data-testid={`${P}-customer`}><b>{o.customer.name}</b> <span className="muted">· {o.customer.phone}</span></span>{o.customer.has_account && <span className="badge sal-d-acct" data-testid={`${P}-has-account`}>Đã gắn tài khoản khách</span>}</div>
          </div>
          <div>
            <div className="sal-d-cap"><span className="i i-pin" aria-hidden="true" />Giao tới</div>
            <div className="ord-addr" data-testid={`${P}-address`}><span><b>{a.receiver}</b> <span className="muted">· {a.phone}</span></span><span className="muted">{address}</span></div>
          </div>
          <div>
            <div className="sal-d-cap"><span className="i i-message" aria-hidden="true" />Ghi chú đơn</div>
            {o.note ? <div className="ord-note" data-testid={`${P}-note`}>{o.note}</div> : <div className="muted" data-testid={`${P}-note-empty`}>Không có ghi chú</div>}
          </div>
        </section>
        <div className="split">
          <section className="panel">
            <div className="panel-head"><h2><span className="i i-bag" aria-hidden="true" />Sản phẩm <span className="muted small">· {o.items.length} dòng</span></h2></div>
            <ul className="list">
              {o.items.map((i) => (
                <li key={i.product_id} data-testid={`${P}-item`}>
                  <span className="tile gray"><span className="i i-box" aria-hidden="true" /></span>
                  <div className="grow"><div className="strong">{i.name}</div><div className="muted small">{formatPrice(i.unit_price)} × {i.quantity}</div>{i.note && <div className="small ord-note sal-d-inote" data-testid={`${P}-item-note`}>Ghi chú: {i.note}</div>}</div>
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
          <div className="stack">
            <div className="ord-tile" data-testid={`${P}-payment`}>
              <span className={`tile ${payTone}`}><span className={`i i-${payIcon}`} aria-hidden="true" /></span>
              <span className="ord-tile-text"><b>{payMethod}</b><span className="muted small">{cancelled && o.payment_status !== 'succeeded' ? 'Đơn đã hủy, không thu tiền' : payState}</span></span>
            </div>
            <section className="panel">
              <div className="panel-head"><h2><span className="i i-receipt" aria-hidden="true" />Thông tin đơn</h2></div>
              <dl className="kv sal-d-kv">
                <dt><span className="i i-message" aria-hidden="true" />Nguồn</dt><dd data-testid={`${P}-source`}>{o.source.name}</dd>
                {o.created_by && <><dt><span className="i i-userplus" aria-hidden="true" />Người tạo</dt><dd data-testid={`${P}-created-by`}>{o.created_by.name ?? 'Không rõ'}</dd></>}
              </dl>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
