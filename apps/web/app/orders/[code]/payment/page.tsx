'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MethodTag, PayBadge, RefundBadge, Spinner, useRemaining } from '../../../../components/PaymentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { Note, Skel } from '../../../../components/ShipmentParts';
import { useCountdown } from '../../../../components/useCountdown';
import { api } from '../../../../lib/api';
import { formatPrice } from '../../../../lib/format';
import { formatOrderTime } from '../../../../lib/order';
import { attemptText, failSentence, formatRemaining, newIdemKey, safeRedirect, type PaymentDetail, type PaymentList } from '../../../../lib/payment';
import { useLoginRedirect } from '../../../../lib/prd';
import { limitedText } from '../../../../lib/stock';

const P = 'pay-order-payment';
const POLL_MS = 3000; // thăm dò khi đang xử lý
const POLL_MAX_MS = 10 * 60_000; // tối đa 10 phút, sau đó dừng và mời kiểm tra lại
const PREPARE_MAX = 5; // PAY chưa tạo Payment: thử lại sau 1 giây, tối đa 5 lần
const REDIRECT_FALLBACK_MS = 10_000; // chuyển cổng không xảy ra (bị chặn, quay lại bằng bfcache): mở lại nút sau 10 giây

type Kind = 'cod' | 'ready' | 'processing' | 'reconciling' | 'success' | 'failed' | 'exhausted' | 'closed-expired' | 'closed-cancelled' | 'closed-other' | 'amount' | 'refunded';
/** Kết luận từ lỗi 409 hoặc 422 của thao tác; chỉ có hiệu lực khi trạng thái và số lượt vẫn như lúc nhận lỗi (đã đổi thì tin server). */
interface Override { kind: Kind; status: string; attempt: number }

function kindOf(d: PaymentDetail, ov: Override | null): Kind {
  if (ov && ov.status === d.status && ov.attempt === d.attempt_no) return ov.kind;
  if (d.method === 'cod' && d.status === 'pending') return 'cod';
  switch (d.status) {
    case 'pending': return d.can_initiate ? 'ready' : 'closed-expired';
    case 'processing': return 'processing';
    case 'succeeded': return 'success';
    case 'failed': return d.can_retry ? 'failed' : d.attempt_no >= d.max_attempts ? 'exhausted' : 'closed-other';
    case 'expired': return 'closed-expired';
    case 'cancelled': return 'closed-cancelled';
    case 'refunded': return 'refunded';
    default: return 'closed-other';
  }
}

const CLOSED_TEXT: Record<string, string> = { 'closed-expired': 'Đơn đã hết hạn thanh toán', 'closed-cancelled': 'Đơn đã bị hủy', 'closed-other': 'Đơn không còn thanh toán được' };

/** Thanh toán đơn (ui/order-payment): trạng thái chỉ đọc từ `GET /payments/{id}`; mọi tham số `vnp_*` trên địa chỉ bị bỏ qua. */
function Pay({ code }: { code: string }) {
  const expired = useLoginRedirect();
  const limit = useCountdown();
  const [view, setView] = useState<'loading' | 'preparing' | 'ready' | 'notfound' | 'error'>('loading');
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [acting, setActing] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [pollStale, setPollStale] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const seq = useRef(0);
  const idRef = useRef<string | null>(null);
  const dataRef = useRef<PaymentDetail | null>(null);
  const tries = useRef(0);
  const prepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lock = useRef(false);
  const key = useRef<{ sig: string; key: string } | null>(null);
  const limitLeft = useRef(0);
  const wasLimited = useRef(false);
  limitLeft.current = limit.left;
  dataRef.current = data;

  const load = useCallback(async () => {
    const n = ++seq.current;
    if (prepTimer.current) { clearTimeout(prepTimer.current); prepTimer.current = null; }
    const have = dataRef.current !== null;
    if (!have) setView((v) => (v === 'preparing' ? v : 'loading'));
    // Lỗi của lần tải: có dữ liệu cũ thì chỉ 401, 404, 429 đổi màn (lần thăm dò hụt do mạng không làm mất thẻ đang hiện).
    const fail = (r: { status: number; retryAfter?: number }): void => {
      if (r.status === 404 || r.status === 400) { idRef.current = null; setData(null); setView('notfound'); }
      else if (r.status === 429) { limit.start(r.retryAfter); if (!have) setView('error'); }
      else if (!have) setView('error');
    };
    let id = idRef.current;
    if (!id) {
      const l = await api<PaymentList>(`/payments?order_code=${encodeURIComponent(code)}&limit=1`);
      if (n !== seq.current) return;
      if (l.status !== 200 || !Array.isArray(l.body.items)) { if (!expired(l)) fail(l); return; }
      if (l.body.items.length === 0) {
        // PAY chưa xử lý OrderCreated: "Đang chuẩn bị thanh toán", thử lại sau 1 giây, tối đa 5 lần rồi hiện lỗi (có nút Thử lại).
        if (tries.current < PREPARE_MAX) { tries.current += 1; setView('preparing'); prepTimer.current = setTimeout(() => void load(), 1000); } else setView('error');
        return;
      }
      id = l.body.items[0].id;
      idRef.current = id;
    }
    const d = await api<PaymentDetail>(`/payments/${encodeURIComponent(id)}`);
    if (n !== seq.current) return;
    if (d.status === 200 && typeof d.body.id === 'string') { tries.current = 0; setData(d.body); setView('ready'); return; }
    if (!expired(d)) fail(d);
  }, [code]); // expired, limit đổi mỗi lần render nên không đưa vào deps

  useEffect(() => { void load(); }, [load]);
  // Rời trang: bỏ mọi phản hồi đang bay và mọi timer.
  useEffect(() => () => { seq.current += 1; if (prepTimer.current) clearTimeout(prepTimer.current); if (redirTimer.current) clearTimeout(redirTimer.current); }, []);
  // Hết giờ chờ 429 thì tự tải lại.
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);
  // Quay lại từ trang cổng bằng nút Back (bfcache): mở khóa và đọc lại trạng thái.
  useEffect(() => {
    const show = (e: PageTransitionEvent) => { if (e.persisted) { lock.current = false; setActing(false); setRedirecting(false); void load(); } };
    window.addEventListener('pageshow', show);
    return () => window.removeEventListener('pageshow', show);
  }, [load]);

  // Đang xử lý: thăm dò mỗi 3 giây, tối đa 10 phút; hết 10 phút dừng và hiện banner có nút kiểm tra lại.
  const processing = data?.status === 'processing';
  useEffect(() => {
    setPollStale(false);
    if (!processing) return;
    const start = Date.now();
    const t = setInterval(() => {
      if (Date.now() - start >= POLL_MAX_MS) { clearInterval(t); setPollStale(true); return; }
      if (limitLeft.current > 0) return;
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [processing, pollKey, load]);

  const left = useRemaining(data?.expires_at, () => void load()); // đồng hồ chỉ là gợi ý: về 0 thì đọc lại server

  const act = async (kind: 'initiate' | 'retry') => {
    if (lock.current || !data) return; // khóa đồng bộ: bấm lặp không có tác dụng
    lock.current = true; setActing(true); setActErr(null);
    const sig = `${kind}:${data.id}`;
    if (!key.current || key.current.sig !== sig) key.current = { sig, key: newIdemKey() };
    const r = await api<{ redirect_url?: string }>(`/payments/${encodeURIComponent(data.id)}/${kind}`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': key.current.key } });
    if (r.status > 0 && r.status < 500) key.current = null; // lỗi mạng hoặc 5xx: giữ khóa cho lần gửi lại của cùng lần bấm
    const url = r.ok ? safeRedirect(r.body.redirect_url) : null;
    if (url) {
      setRedirecting(true);
      redirTimer.current = setTimeout(() => { lock.current = false; setActing(false); setRedirecting(false); void load(); }, REDIRECT_FALLBACK_MS);
      window.location.assign(url);
      return;
    }
    lock.current = false; setActing(false);
    if (r.ok) { setActErr('Có lỗi, vui lòng thử lại.'); return; }
    if (expired(r)) return;
    const at = { status: data.status, attempt: data.attempt_no };
    const conclude = (k: Kind) => { setOverride({ kind: k, ...at }); void load(); };
    if (r.status === 429) { limit.start(r.retryAfter); return; }
    if (r.status === 404) { void load(); return; }
    switch (r.code) {
      case 'payment-in-progress': conclude('reconciling'); break;
      case 'attempts-exhausted': conclude('exhausted'); break;
      case 'payment-expired': conclude('closed-expired'); break;
      case 'order-not-pending': conclude('closed-cancelled'); break;
      case 'amount-out-of-range': conclude('amount'); break;
      case 'payment-not-startable': case 'payment-not-retryable': case 'payment-not-online': setActErr('Trạng thái thanh toán đã thay đổi, màn đã được cập nhật.'); void load(); break;
      default: setActErr('Có lỗi, vui lòng thử lại.');
    }
  };

  const back = <Link className="back" href={`/orders/${encodeURIComponent(code)}`} data-testid={`${P}-back-link`}><span className="i i-left" aria-hidden="true" />Đơn hàng</Link>;
  const rate = limit.left > 0 ? <Note tone="red" icon="clock" role="alert" testid={`${P}-ratelimited`}>{limitedText(limit.left)}</Note> : null;

  const errorBanner = (!data && view === 'error') || pollStale ? (
    <Note tone="red" icon="alert" role="alert" testid={`${P}-error`}>
      {pollStale ? 'Chưa có kết quả thanh toán.' : 'Không tải được thanh toán.'}
      <button className="btn" onClick={() => { tries.current = 0; setPollKey((k) => k + 1); void load(); }} data-testid={`${P}-error-retry`}>{pollStale ? 'Kiểm tra lại' : 'Thử lại'}</button>
    </Note>
  ) : null;

  if (view === 'notfound') {
    return <main className="page page-narrow">{back}<section className="empty" data-testid={`${P}-notfound`}><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><h1>Không tìm thấy thanh toán</h1></section></main>;
  }
  if (!data) {
    if (view === 'error') return <main className="page page-narrow">{back}{rate}{errorBanner}</main>;
    if (view === 'preparing') return <main className="page page-narrow">{back}<Note tone="blue" role="status" testid={`${P}-preparing`}><Spinner />Đang chuẩn bị thanh toán...</Note></main>;
    return <main className="page page-narrow" data-testid={`${P}-loading`} aria-busy="true">{back}<Skel n={3} /></main>;
  }

  const kind = kindOf(data, override);
  const online = data.method === 'vnpay';
  const lastFail = [...data.attempts].sort((a, b) => b.attempt_no - a.attempt_no).find((a) => a.status === 'failed');
  const timed = online && data.expires_at && (kind === 'ready' || kind === 'processing' || kind === 'failed');
  const busy = acting || redirecting || limit.left > 0;
  const payLabel = (text: string) => (acting || redirecting ? <><Spinner />Đang chuyển...</> : text);
  return (
    <main className="page page-narrow">
      {back}
      {rate}
      {errorBanner}
      <section className="panel ps-pay" data-testid={`${P}-summary`}>
        <div className="ps-top">
          <h1>Đơn <span className="ps-code">{data.order_code}</span></h1>
          <PayBadge status={data.status} method={data.method} testid={`${P}-status-badge`} />
        </div>
        <p className="ps-amount" style={{ margin: 0 }} data-testid={`${P}-amount`}>{formatPrice(data.amount)}</p>
        <div className="meta">
          <MethodTag method={data.method} />
          {online && <><span className="sep" aria-hidden="true" /><span className="ps-attempt-n" data-testid={`${P}-attempts-count`}>Lượt {data.attempt_no}/{data.max_attempts}</span></>}
        </div>
        {timed && (
          <span className={`ps-count${left !== null && left > 0 && left <= 60 ? ' low' : ''}`} data-testid={`${P}-countdown`}>
            <span className="i i-clock" aria-hidden="true" />{left === null ? '' : left > 0 ? `Còn ${formatRemaining(left)}` : 'Đang kiểm tra...'}
          </span>
        )}

        {kind === 'cod' && <Note tone="blue" icon="bag" className="center" testid={`${P}-cod-notice`}>Thanh toán khi nhận hàng</Note>}
        {kind === 'success' && <Note tone="green" icon="okc" className="center" role="status" testid={`${P}-success`}>Thanh toán thành công</Note>}
        {kind === 'refunded' && <Note icon="undo" className="center">Đã hoàn tiền</Note>}
        {kind === 'amount' && <Note tone="red" icon="alert" role="alert" testid={`${P}-amount-error`}>Số tiền này không thanh toán được qua VNPay. Liên hệ cửa hàng.</Note>}
        {(kind === 'closed-expired' || kind === 'closed-cancelled' || kind === 'closed-other') && <Note icon="ban" className="center" role="status" testid={`${P}-closed`}>{CLOSED_TEXT[kind]}</Note>}
        {kind === 'exhausted' && (
          <Note tone="red" icon="alert" role="status" testid={`${P}-exhausted`}>
            Hết {data.max_attempts} lượt. Đơn sẽ bị hủy.{lastFail && <> {failSentence(lastFail.reason)}.</>}
          </Note>
        )}
        {kind === 'reconciling' && <Note tone="blue" role="status" testid={`${P}-reconciling`}><Spinner />Đang đối soát với ngân hàng...</Note>}

        {kind === 'ready' && (
          <button type="button" className="btn btn-primary ps-big" disabled={busy} onClick={() => void act('initiate')} data-testid={`${P}-pay-button`}>{payLabel('Thanh toán')}</button>
        )}
        {kind === 'processing' && (
          <div className="ps-retry-line" data-testid={`${P}-processing`}>
            <Note tone="blue" role="status"><Spinner />Đang xác nhận với ngân hàng, đừng đóng trang.</Note>
            <button type="button" className="btn" disabled={busy} onClick={() => void act('initiate')} data-testid={`${P}-reopen-link`}><span className="i i-link" aria-hidden="true" />Mở lại</button>
          </div>
        )}
        {kind === 'failed' && (
          <div className="ps-retry-line" data-testid={`${P}-failed`}>
            <Note tone="red" icon="alert" role="status" testid={`${P}-failed-reason`}>{failSentence(lastFail?.reason)}</Note>
            <button type="button" className="btn btn-primary ps-big" disabled={busy} onClick={() => void act('retry')} data-testid={`${P}-retry-button`}>{acting || redirecting ? <><Spinner />Đang chuyển...</> : <><span className="i i-refresh" aria-hidden="true" />Thử lại</>}</button>
          </div>
        )}
        {(acting || redirecting) && <p className="muted small" style={{ margin: 0 }} role="status" data-testid={`${P}-redirecting`}>Đang chuyển tới VNPay...</p>}
        {actErr && <Note tone="red" icon="alert" role="alert">{actErr}</Note>}
      </section>

      {data.attempts.length > 0 && (
        <section className="ps-card">
          <h2><span className="i i-refresh" aria-hidden="true" />Lượt thử<span className="n">{data.attempts.length}</span></h2>
          <ul className="ps-tl" data-testid={`${P}-attempt-list`}>
            {data.attempts.map((a) => <li key={a.attempt_no} data-testid={`${P}-attempt-item`}><span className={`ps-dot ${a.status === 'succeeded' ? 'green' : a.status === 'failed' ? 'red' : ''}`}><span className={`i i-${a.status === 'succeeded' ? 'check' : a.status === 'failed' ? 'x' : 'clock'}`} aria-hidden="true" /></span><span className="body">Lượt {a.attempt_no} · {attemptText(a)}<span className="ps-time">{formatOrderTime(a.created_at)}</span></span></li>)}
          </ul>
        </section>
      )}
      {data.refunds.length > 0 && (
        <section className="ps-card">
          <h2><span className="i i-undo" aria-hidden="true" />Hoàn tiền</h2>
          <ul className="ps-tl" data-testid={`${P}-refund-list`}>
            {data.refunds.map((r, i) => <li key={i} data-testid={`${P}-refund-item`}><span className="ps-dot violet"><span className="i i-undo" aria-hidden="true" /></span><span className="body"><span className="tabular">{formatPrice(r.amount)}</span> · <RefundBadge status={r.status} customer /><span className="ps-time">{formatOrderTime(r.created_at)}</span></span></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function OrderPaymentPage() {
  const params = useParams<{ code: string }>();
  return <RequireRole roles={['customer']}><Pay code={String(params.code ?? '')} /></RequireRole>;
}
