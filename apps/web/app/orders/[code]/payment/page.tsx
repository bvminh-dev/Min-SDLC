'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PayBadge, RefundBadge, Spinner, useRemaining } from '../../../../components/PaymentParts';
import { RequireRole } from '../../../../components/RequireRole';
import { useCountdown } from '../../../../components/useCountdown';
import { api } from '../../../../lib/api';
import { formatPrice } from '../../../../lib/format';
import { formatOrderTime } from '../../../../lib/order';
import { attemptText, failSentence, formatRemaining, methodText, newIdemKey, safeRedirect, type PaymentDetail, type PaymentList } from '../../../../lib/payment';
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

const CLOSED_TEXT: Record<string, string> = { 'closed-expired': 'Đơn đã hết hạn thanh toán', 'closed-cancelled': 'Đơn đã bị hủy', 'closed-other': 'Đơn không còn thanh toán được (đã hết hạn hoặc đã bị hủy)' };

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

  const back = <p><Link href={`/orders/${encodeURIComponent(code)}`} data-testid={`${P}-back-link`}>← Về đơn hàng</Link></p>;
  const rate = limit.left > 0 ? <div role="alert" className="banner banner-error" data-testid={`${P}-ratelimited`}>{limitedText(limit.left)}</div> : null;

  const errorBanner = (!data && view === 'error') || pollStale ? (
    <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>
      {pollStale ? 'Chưa nhận được kết quả thanh toán. Hãy kiểm tra lại.' : 'Không tải được thông tin thanh toán.'}{' '}
      <button className="btn" onClick={() => { tries.current = 0; setPollKey((k) => k + 1); void load(); }} data-testid={`${P}-error-retry`}>{pollStale ? 'Kiểm tra lại' : 'Thử lại'}</button>
    </div>
  ) : null;

  if (view === 'notfound') {
    return <main className="wide">{back}<section className="card-block" data-testid={`${P}-notfound`}><p className="hint">404</p><h1>Không tìm thấy thanh toán</h1><p>Thanh toán không tồn tại hoặc bạn không có quyền xem.</p></section></main>;
  }
  if (!data) {
    if (view === 'error') return <main className="wide">{back}{rate}{errorBanner}</main>;
    if (view === 'preparing') return <main className="wide">{back}<p role="status" className="banner banner-info" data-testid={`${P}-preparing`}><Spinner /> Đang chuẩn bị thanh toán...</p></main>;
    return <main className="wide" data-testid={`${P}-loading`} aria-busy="true">{back}<div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></main>;
  }

  const kind = kindOf(data, override);
  const online = data.method === 'vnpay';
  const lastFail = [...data.attempts].sort((a, b) => b.attempt_no - a.attempt_no).find((a) => a.status === 'failed');
  const timed = online && data.expires_at && (kind === 'ready' || kind === 'processing' || kind === 'failed');
  const busy = acting || redirecting || limit.left > 0;
  return (
    <main className="wide">
      {back}
      {rate}
      {errorBanner}
      <section className="card-block" data-testid={`${P}-summary`}>
        <header className="row-link">
          <h1>Thanh toán đơn <span className="mono">{data.order_code}</span></h1>
          <PayBadge status={data.status} method={data.method} testid={`${P}-status-badge`} />
        </header>
        <p className="price tabular" data-testid={`${P}-amount`}>{formatPrice(data.amount)}</p>
        <p>{methodText(data.method)}{online && <span className="hint tabular"> · <span data-testid={`${P}-attempts-count`}>Lượt {data.attempt_no}/{data.max_attempts}</span></span>}</p>
        {timed && (
          <p className="tabular" data-testid={`${P}-countdown`}>{left === null ? '' : left > 0 ? `Còn ${formatRemaining(left)} để thanh toán` : 'Đã hết thời gian dự kiến, đang kiểm tra lại với hệ thống'}</p>
        )}

        {kind === 'cod' && <div className="banner banner-info" data-testid={`${P}-cod-notice`}>Thanh toán khi nhận hàng. Tiền được ghi nhận tự động khi đơn giao xong.</div>}
        {kind === 'success' && <div role="status" className="banner banner-ok" data-testid={`${P}-success`}>✓ Thanh toán thành công</div>}
        {kind === 'refunded' && <p className="hint">Đơn đã được hoàn tiền.</p>}
        {kind === 'amount' && <div role="alert" className="banner banner-error" data-testid={`${P}-amount-error`}>Số tiền đơn không thanh toán được qua VNPay, vui lòng liên hệ cửa hàng.</div>}
        {(kind === 'closed-expired' || kind === 'closed-cancelled' || kind === 'closed-other') && <div role="status" className="banner banner-info" data-testid={`${P}-closed`}>{CLOSED_TEXT[kind]}</div>}
        {kind === 'exhausted' && (
          <div role="status" className="banner banner-error" data-testid={`${P}-exhausted`}>
            Đã hết {data.max_attempts} lượt thanh toán. Đơn sẽ bị hủy.{lastFail && <> {failSentence(lastFail.reason)}.</>}
          </div>
        )}
        {kind === 'reconciling' && <div role="status" className="banner banner-info" data-testid={`${P}-reconciling`}><Spinner /> Ngân hàng chưa báo kết quả, hệ thống đang đối soát. Đang đối soát với ngân hàng...</div>}

        {kind === 'ready' && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('initiate')} data-testid={`${P}-pay-button`}>{acting || redirecting ? <><Spinner /> Đang chuyển tới VNPay...</> : 'Thanh toán qua VNPay'}</button>
        )}
        {kind === 'processing' && (
          <div data-testid={`${P}-processing`}>
            <p role="status"><Spinner /> Đang xác nhận thanh toán với ngân hàng, vui lòng không đóng trang.</p>
            <button type="button" className="btn" disabled={busy} onClick={() => void act('initiate')} data-testid={`${P}-reopen-link`}>Mở lại trang thanh toán</button>
          </div>
        )}
        {kind === 'failed' && (
          <div data-testid={`${P}-failed`}>
            <p className="banner banner-error" role="status" data-testid={`${P}-failed-reason`}>{failSentence(lastFail?.reason)}</p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('retry')} data-testid={`${P}-retry-button`}>{acting || redirecting ? <><Spinner /> Đang chuyển tới VNPay...</> : 'Thử lại thanh toán'}</button>
          </div>
        )}
        {(acting || redirecting) && <p className="hint" role="status" data-testid={`${P}-redirecting`}>Đang chuyển tới VNPay...</p>}
        {actErr && <p role="alert" className="field-error">{actErr}</p>}
      </section>

      {data.attempts.length > 0 && (
        <section className="card-block">
          <h2>Các lượt thanh toán</h2>
          <ul className="timeline" data-testid={`${P}-attempt-list`}>
            {data.attempts.map((a) => <li key={a.attempt_no} data-testid={`${P}-attempt-item`}>Lượt {a.attempt_no} · {attemptText(a)} <span className="hint tabular">{formatOrderTime(a.created_at)}</span></li>)}
          </ul>
        </section>
      )}
      {data.refunds.length > 0 && (
        <section className="card-block">
          <h2>Hoàn tiền</h2>
          <ul className="timeline" data-testid={`${P}-refund-list`}>
            {data.refunds.map((r, i) => <li key={i} data-testid={`${P}-refund-item`}><span className="tabular">{formatPrice(r.amount)}</span> · <RefundBadge status={r.status} customer /> <span className="hint tabular">{formatOrderTime(r.created_at)}</span></li>)}
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
