'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Spinner, useRemaining } from '../../components/PaymentParts';
import { useCountdown } from '../../components/useCountdown';
import { api, type ApiResult } from '../../lib/api';
import { announceCart, couponErrorText, couponWarning, minus, type Cart } from '../../lib/cart';
import {
  SESSION_CLOSED, addressText, availabilityText, blockerText, completeUrl, payErrorOf, payErrorText, priceLine, sessionStatusOf, waitText,
  type ChkView, type PayError, type PlaceOut, type ShipOption, type UserAddress,
} from '../../lib/checkout';
import { formatPrice } from '../../lib/format';
import { formatRemaining, newIdemKey } from '../../lib/payment';
import { Blocked, LOGIN_HREF, type Block } from './Blocked';

const WARN_SECONDS = 300; // dưới 5 phút bộ đếm phiên đổi màu cảnh báo
const RETRY_NETWORK_MS = 1000; // lỗi mạng khi đặt hàng: tự gửi lại một lần, GIỮ NGUYÊN Idempotency-Key

type Screen = { k: 'creating' } | { k: 'loading' } | { k: 'ready' } | { k: 'error' } | { k: 'login-expired' } | { k: 'blocked'; block: Block };
type Opts = null | { k: 'ok'; options: ShipOption[] } | { k: 'needs-address' } | { k: 'empty' } | { k: 'error' };
type Notice =
  | { k: 'price'; previous: number; next: number; lines: { name: string; was: number; now: number }[] }
  | { k: 'cart-changed' } | { k: 'unavailable' } | { k: 'place-error'; text: string }
  | { k: 'stock'; items: { name: string; requested: number; available: number }[] };
interface Flags { addrChanged: boolean; addrGone: boolean; shipGone: boolean }
const NO_FLAGS: Flags = { addrChanged: false, addrGone: false, shipGone: false };
interface Errs { address?: string; shipping?: string; pay?: PayError; payText?: string; coupon?: string; cancel?: string }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sessionIdFromUrl = (): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session'));
const setUrl = (id: string | null) => { if (typeof window !== 'undefined') window.history.replaceState(null, '', id ? `/checkout?session=${encodeURIComponent(id)}` : '/checkout'); };

function Radio({ testid, name, checked, disabled, onChange, children }: { testid: string; name: string; checked: boolean; disabled: boolean; onChange: () => void; children: React.ReactNode }) {
  return <label className="crt-opt"><input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} data-testid={testid} /> <span className="grow">{children}</span></label>;
}

/** Khung chờ hai cột của màn checkout (bốn khối và tóm tắt); `testid` phân biệt bước tạo phiên với bước đọc phiên. */
function CheckoutSkeleton({ testid }: { testid: string }) {
  return (
    <main className="page" aria-busy="true" data-testid={testid}><div className="page-head"><h1>Thanh toán</h1></div>
      <div className="crt-grid"><div className="stack"><div className="skeleton crt-sk" /><div className="skeleton crt-sk" /><div className="skeleton crt-sk" /></div><div className="skeleton crt-sk-sum" /></div></main>
  );
}

export function Checkout() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ k: 'creating' });
  const [view, setView] = useState<ChkView | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [opts, setOpts] = useState<Opts>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [flags, setFlags] = useState<Flags>(NO_FLAGS);
  const [errs, setErrs] = useState<Errs>({});
  const [code, setCode] = useState('');
  const couponWait = useCountdown();
  const placeWait = useCountdown();
  const createWait = useCountdown();
  const sid = useRef<string | null>(null);
  const seq = useRef(0); // lần đọc bản xem lại mới nhất (bỏ phản hồi cũ)
  const gen = useRef(0); // lần mở phiên mới nhất
  const lock = useRef(false);
  const viewRef = useRef<ChkView | null>(null);
  viewRef.current = view;

  const blocked = (block: Block) => setScreen({ k: 'blocked', block });
  /** Lỗi chung của mọi thao tác trên phiên: đổi cả màn. Trả true khi đã đổi màn (bên gọi dừng). */
  const common = (r: ApiResult): boolean => {
    if (r.status === 401) { setScreen({ k: 'login-expired' }); return true; }
    if (r.code === SESSION_CLOSED) { blocked({ kind: sessionStatusOf(r) === 'cancelled' ? 'session-closed' : 'session-expired' }); return true; }
    if (r.code === 'checkout-session-not-found') { void start(true); return true; }
    if (r.code === 'email-not-verified') { blocked({ kind: 'email-not-verified' }); return true; }
    if (r.code === 'cart-empty') { blocked({ kind: 'cart-empty' }); return true; }
    if (r.code === 'cart-already-ordered') { blocked({ kind: 'already-ordered' }); return true; }
    return false;
  };

  const loadAddresses = useCallback(async () => {
    const r = await api<{ items: UserAddress[] }>('/me/addresses', { silentExpired: true });
    if (r.status === 200 && Array.isArray(r.body.items)) setAddresses(r.body.items);
  }, []);

  /** Đọc lại bản xem lại (không gia hạn phiên), phí từng phương thức và sổ địa chỉ. `quiet`: giữ màn hiện tại, lỗi chỉ hiện banner. */
  const refresh = useCallback(async (quiet = true): Promise<'ok' | 'gone' | 'stop'> => {
    const id = sid.current;
    if (!id) return 'gone';
    const n = ++seq.current;
    const r = await api<any>(`/checkout/sessions/${encodeURIComponent(id)}`, { silentExpired: true }); // ba dạng phản hồi (open, completed, expired, cancelled)
    if (n !== seq.current) return 'stop';
    if (r.status === 404 && !quiet) return 'gone';
    if (r.status === 200 && r.body.status === 'completed') { router.replace(completeUrl(String(r.body.order_code ?? ''), { replayed: true })); return 'stop'; }
    if (r.status === 200 && (r.body.status === 'expired' || r.body.status === 'cancelled')) { blocked({ kind: r.body.status === 'cancelled' ? 'session-closed' : 'session-expired' }); return 'stop'; }
    if (r.status === 200 && r.body.status === 'open' && Array.isArray(r.body.lines)) {
      const v = r.body as ChkView;
      if (v.blockers.includes('cart_empty')) { blocked({ kind: 'cart-empty' }); return 'stop'; }
      setView(v); setLoadErr(false); setScreen({ k: 'ready' });
      void loadAddresses();
      if (!v.address || v.address.address_id === null) setOpts({ k: 'needs-address' });
      else {
        const o = await api<{ options: ShipOption[] }>(`/checkout/sessions/${encodeURIComponent(id)}/shipping-options`, { silentExpired: true });
        if (n !== seq.current) return 'stop';
        if (o.status === 200 && Array.isArray(o.body.options)) setOpts({ k: 'ok', options: o.body.options });
        else if (o.code === 'address-required' || o.code === 'address-unavailable') setOpts({ k: 'needs-address' });
        else if (o.code === 'no-shipping-methods') setOpts({ k: 'empty' });
        else if (common(o)) return 'stop';
        else setOpts({ k: 'error' });
      }
      return 'ok';
    }
    if (common(r)) return 'stop';
    if (quiet && viewRef.current) setLoadErr(true); else setScreen({ k: 'error' });
    return 'stop';
  }, [router, loadAddresses]); // `common` và `blocked` chỉ dùng setter và ref ổn định

  const createFailure = (r: ApiResult) => {
    if (r.status === 401) return blocked({ kind: 'login-expired' });
    if (r.code === 'email-not-verified') return blocked({ kind: 'email-not-verified' });
    if (r.code === 'cart-empty') return blocked({ kind: 'cart-empty' });
    if (r.code === 'cart-already-ordered') return blocked({ kind: 'already-ordered' });
    if (r.code === 'cart-has-unavailable-items') {
      const ids: string[] = Array.isArray(r.body?.issues) ? r.body.issues.map((i: { product_id: string }) => i.product_id) : [];
      void cartNames().then((m) => blocked({ kind: 'unavailable-items', names: ids.map((p) => m.get(p) ?? 'Sản phẩm không còn bán') }));
      return;
    }
    if (r.status === 429) { createWait.start(r.retryAfter); return blocked({ kind: 'rate-limited', seconds: r.retryAfter ?? 60 }); }
    return blocked({ kind: 'error' });
  };

  /** Tên sản phẩm của giỏ (GET /cart) để liệt kê hàng ngừng bán; lỗi thì trả bản đồ rỗng. */
  const cartNames = async (): Promise<Map<string, string>> => {
    const c = await api<Cart>('/cart', { silentExpired: true });
    return new Map(c.status === 200 && Array.isArray(c.body.items) ? c.body.items.map((l) => [l.product_id, l.name] as const) : []);
  };

  /** Mở phiên: dùng lại phiên trong địa chỉ (`?session=`) nếu còn, không thì tạo (hoặc lấy lại phiên `open` của giỏ) bằng POST /checkout/sessions. */
  const start = useCallback(async (fresh: boolean) => {
    const g = ++gen.current;
    setView(null); setNotice(null); setFlags(NO_FLAGS); setErrs({}); setOpts(null); setLoadErr(false); setCode('');
    let id = fresh ? null : sessionIdFromUrl();
    if (fresh) setUrl(null);
    if (id) {
      sid.current = id;
      setScreen({ k: 'loading' });
      const st = await refresh(false);
      if (st !== 'gone') return;
      sid.current = null; id = null; setUrl(null);
    }
    setScreen({ k: 'creating' });
    const r = await api<{ id: string }>('/checkout/sessions', { method: 'POST', body: {}, silentExpired: true });
    if (g !== gen.current) return; // có lần mở khác chen vào
    if (r.ok && typeof r.body.id === 'string') {
      sid.current = r.body.id; setUrl(r.body.id); setScreen({ k: 'loading' });
      await refresh(false);
      return;
    }
    createFailure(r);
  }, [refresh]);

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => { void startRef.current(false); return () => { seq.current += 1; gen.current += 1; }; }, []);
  // Hết thời gian chờ 429 của lần mở phiên: thông báo tự mất và mở lại đúng một lần (lại 429 thì chờ tiếp theo Retry-After mới).
  const wasLimited = useRef(false);
  useEffect(() => {
    if (createWait.left > 0) { wasLimited.current = true; return; }
    if (wasLimited.current) { wasLimited.current = false; void startRef.current(true); }
  }, [createWait.left]);

  const left = useRemaining(view?.expires_at, () => void refresh()); // về 0: đọc lại, máy chủ trả `expired` nếu phiên đã quá hạn

  const act = async (name: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(name);
    try { await fn(); } finally { lock.current = false; setBusy(null); }
  };
  const url = (suffix: string) => `/checkout/sessions/${encodeURIComponent(sid.current ?? '')}${suffix}`;
  const changed = () => { setNotice(null); setErrs((e) => ({ ...e, cancel: undefined })); };

  const chooseAddress = (a: UserAddress) => void act('address', async () => {
    setErrs((e) => ({ ...e, address: undefined })); setFlags((f) => ({ ...f, addrGone: false }));
    const r = await api(url('/address'), { method: 'PUT', body: { address_id: a.id }, silentExpired: true });
    if (r.ok) { setFlags((f) => ({ ...f, addrChanged: false })); changed(); await refresh(); return; }
    if (common(r)) return;
    if (r.status === 404) { setErrs((e) => ({ ...e, address: 'Địa chỉ này không còn tồn tại' })); void loadAddresses(); return; }
    setErrs((e) => ({ ...e, address: r.status === 429 ? waitText(r.retryAfter) : 'Không chọn được địa chỉ. Thử lại.' }));
  });
  const confirmAddress = () => void act('address', async () => {
    const id = view?.address?.address_id;
    if (!id) return;
    const r = await api(url('/address'), { method: 'PUT', body: { address_id: id }, silentExpired: true }); // chọn lại cùng địa chỉ: máy chủ làm mới bản chụp
    if (r.ok) { setFlags((f) => ({ ...f, addrChanged: false })); changed(); await refresh(); return; }
    if (common(r)) return;
    if (r.status === 404) { setFlags((f) => ({ ...f, addrChanged: false, addrGone: true })); await refresh(); return; }
    setErrs((e) => ({ ...e, address: 'Không xác nhận được địa chỉ. Thử lại.' }));
  });
  const chooseShipping = (o: ShipOption) => void act('shipping', async () => {
    setErrs((e) => ({ ...e, shipping: undefined })); setFlags((f) => ({ ...f, shipGone: false }));
    const r = await api(url('/shipping-method'), { method: 'PUT', body: { method_id: o.method_id }, silentExpired: true });
    if (r.ok) { changed(); await refresh(); return; }
    if (common(r)) return;
    if (r.code === 'shipping-method-unavailable') { setFlags((f) => ({ ...f, shipGone: true })); await refresh(); return; }
    setErrs((e) => ({ ...e, shipping: r.status === 429 ? waitText(r.retryAfter) : 'Không tính được phí, thử lại' }));
  });
  const choosePayment = (m: 'vnpay' | 'cod') => void act('payment', async () => {
    setErrs((e) => ({ ...e, pay: undefined, payText: undefined }));
    const r = await api(url('/payment-method'), { method: 'PUT', body: { payment_method: m }, silentExpired: true });
    if (r.ok) { changed(); await refresh(); return; }
    if (common(r)) return;
    const pe = payErrorOf(r);
    setErrs((e) => (pe ? { ...e, pay: pe } : { ...e, payText: r.status === 429 ? waitText(r.retryAfter) : 'Không chọn được phương thức thanh toán. Thử lại.' }));
  });
  const applyCoupon = (e?: FormEvent) => {
    e?.preventDefault();
    if (lock.current || couponWait.left > 0) return;
    const c = code.trim();
    if (c.length < 1 || c.length > 50) { setErrs((x) => ({ ...x, coupon: 'Mã phải từ 1 đến 50 ký tự' })); return; }
    void act('coupon', async () => {
      setErrs((x) => ({ ...x, coupon: undefined }));
      const r = await api(url('/coupon'), { method: 'PUT', body: { code: c }, silentExpired: true });
      if (r.ok) { setCode(''); changed(); await refresh(); return; }
      if (common(r)) return;
      if (r.code === 'too-many-attempts' || r.status === 429) { const s = Number(r.body?.retry_after_seconds); couponWait.start(r.retryAfter ?? (s > 0 ? s : undefined)); return; }
      setErrs((x) => ({ ...x, coupon: couponErrorText(r) }));
    });
  };
  const removeCoupon = () => void act('coupon', async () => {
    setErrs((x) => ({ ...x, coupon: undefined }));
    const r = await api(url('/coupon'), { method: 'DELETE', silentExpired: true });
    if (r.status === 204) { changed(); await refresh(); return; }
    if (common(r)) return;
    setErrs((x) => ({ ...x, coupon: r.status === 429 ? waitText(r.retryAfter) : 'Không gỡ được mã. Thử lại.' }));
  });
  const cancel = () => void act('cancel', async () => {
    const r = await api(url(''), { method: 'DELETE', silentExpired: true });
    if (r.status === 204 || r.status === 404) { router.push('/cart'); return; }
    if (r.code === 'checkout-session-completed') { router.replace(completeUrl(String(r.body?.order_code ?? ''), { replayed: true })); return; }
    if (r.status === 401) { setScreen({ k: 'login-expired' }); return; }
    setErrs((e) => ({ ...e, cancel: 'Không hủy được phiên. Thử lại.' }));
  });

  const place = async () => {
    const v = viewRef.current;
    if (!v || lock.current) return;
    lock.current = true; setBusy('place'); setNotice(null);
    // Khóa mới cho MỖI lần khách chủ động bấm (cả khi bấm "Xác nhận và đặt hàng" sau 409 giá đổi); chỉ lần tự gửi lại do lỗi mạng mới dùng lại khóa này.
    const key = newIdemKey();
    const send = () => api<PlaceOut>(url('/place-order'), { method: 'POST', body: { expected_grand_total: v.expected_grand_total, cart_version: v.cart_version }, headers: { 'Idempotency-Key': key }, silentExpired: true });
    let r = await send();
    if (r.status === 0) { await sleep(RETRY_NETWORK_MS); r = await send(); }
    if (r.ok && r.body.order?.code) {
      announceCart(null);
      router.push(completeUrl(r.body.order.code, { replayed: r.body.replayed, deadline: r.body.payment_deadline }));
      return; // giữ khóa nút tới khi chuyển trang (chặn bấm đôi)
    }
    lock.current = false; setBusy(null);
    await failPlace(r, v);
  };
  const failPlace = async (r: ApiResult, v: ChkView) => {
    if (common(r)) return;
    const pe = payErrorOf(r);
    switch (r.code) {
      case 'price-changed': {
        const was = new Map(v.lines.map((l) => [l.product_id, l.unit_price]));
        const lines = (Array.isArray(r.body?.review?.lines) ? r.body.review.lines : []).filter((l: { product_id: string; unit_price: number }) => was.has(l.product_id) && was.get(l.product_id) !== l.unit_price)
          .map((l: { product_id: string; name: string; unit_price: number }) => ({ name: l.name, was: was.get(l.product_id) as number, now: l.unit_price }));
        setNotice({ k: 'price', previous: Number(r.body?.previous_grand_total ?? v.expected_grand_total), next: Number(r.body?.review?.grand_total), lines });
        await refresh(); return;
      }
      case 'cart-changed': setNotice({ k: 'cart-changed' }); await refresh(); return;
      case 'insufficient-stock': {
        const items = (Array.isArray(r.body?.items) ? r.body.items : []).map((i: { name: string; requested: number; available: number }) => ({ name: i.name, requested: i.requested, available: i.available }));
        setNotice({ k: 'stock', items }); await refresh(); return;
      }
      case 'address-changed': setFlags((f) => ({ ...f, addrChanged: true })); await refresh(); return;
      case 'address-unavailable': setFlags((f) => ({ ...f, addrGone: true })); await refresh(); return;
      case 'shipping-method-unavailable': setFlags((f) => ({ ...f, shipGone: true })); await refresh(); return;
      case 'cart-has-unavailable-items': setNotice({ k: 'unavailable' }); await refresh(); return;
      case 'coupon-invalid': case 'checkout-incomplete': await refresh(); return;
    }
    if (pe) { setErrs((e) => ({ ...e, pay: pe })); await refresh(); return; }
    if (r.status === 429) { placeWait.start(r.retryAfter); setNotice({ k: 'place-error', text: '' }); return; }
    if (r.code === 'cart-limit-exceeded') { setNotice({ k: 'place-error', text: 'Giỏ hàng vượt giá trị tối đa, chưa có gì bị tính. Hãy bớt sản phẩm trong giỏ.' }); return; }
    setNotice({ k: 'place-error', text: r.status === 503 || r.status === 0 ? 'Chưa đặt được đơn, chưa có gì bị tính, hãy thử lại.' : 'Chưa đặt được đơn, chưa có gì bị tính. Thử lại sau.' });
  };

  // ---------------------------------------------------------------- hiển thị
  // Tạo phiên và đọc phiên dùng CÙNG một khung hai cột: kết quả thường gặp là màn checkout, nên không đổi độ rộng giữa hai bước (màn bị chặn hiếm hơn và tự đổi sang khung hẹp)
  if (screen.k === 'creating') return <CheckoutSkeleton testid="chk-checkout-blocked-loading" />;
  if (screen.k === 'blocked') {
    const b = screen.block.kind === 'rate-limited' ? { kind: 'rate-limited' as const, seconds: createWait.left > 0 ? createWait.left : screen.block.seconds } : screen.block;
    return <Blocked block={b} onRetry={() => void start(false)} onRestart={() => void start(true)} onVerified={() => void start(false)} />;
  }
  if (screen.k === 'login-expired') return <main className="page"><div role="alert" className="banner banner-error" data-testid="chk-checkout-login-expired">Phiên đăng nhập đã hết hạn. <a href={LOGIN_HREF}>Đăng nhập</a></div></main>;
  if (screen.k === 'loading' || (!view && screen.k === 'ready')) {
    return <CheckoutSkeleton testid="chk-checkout-loading" />;
  }
  if (screen.k === 'error' || !view) {
    return (
      <main className="page"><div className="page-head"><h1>Thanh toán</h1></div><div role="alert" className="banner banner-error" data-testid="chk-checkout-error">Không tải được thanh toán.{' '}
        <button type="button" className="btn" onClick={() => void start(false)} data-testid="chk-checkout-retry">Thử lại</button></div>
        <button type="button" className="btn btn-primary" disabled data-testid="chk-checkout-place-order">Đặt hàng</button></main>
    );
  }

  const off = busy !== null;
  const placing = busy === 'place';
  const addr = view.address;
  const addrOk = addr && addr.address_id !== null ? addr : null;
  const addrChangedShown = flags.addrChanged || addrOk?.changed === true;
  const addrGoneShown = flags.addrGone || (addr !== null && addr.address_id === null);
  const sh = view.shipping;
  const shipId = sh && !('error' in sh) ? sh.method_id : null;
  const shipGoneShown = flags.shipGone || (sh !== null && 'error' in sh && sh.error === 'method_unavailable');
  const coupon = view.coupon;
  const blockers = view.blockers;
  const payErr = errs.pay ?? (blockers.includes('amount_out_of_range_online') ? ({ kind: 'range', min: 5000, max: 999_999_999 } as PayError) : blockers.includes('zero_total') ? ({ kind: 'zero' } as PayError) : blockers.includes('too_many_open_orders') ? ({ kind: 'open-orders' } as PayError) : null);
  const canPlace = view.can_place_order && !addrChangedShown && !off && !loadErr && placeWait.left === 0;
  const showUnavailable = notice?.k === 'unavailable' || blockers.includes('cart_unavailable_items');

  return (
    <main className="page">
      <div className="page-head">
        <h1>Thanh toán</h1>
        <div className="actions">
          {left !== null && <span className={`timer crt-timer${left < WARN_SECONDS ? ' timer-warn' : ''}`} role="timer" data-warn={left < WARN_SECONDS} data-testid="chk-checkout-session-timer"><span className="i i-clock" aria-hidden="true" /><span className="crt-vh">Phiên còn </span>{formatRemaining(left)}</span>}
          <button type="button" className="btn btn-sm" disabled={off} onClick={cancel} data-testid="chk-checkout-cancel"><span className="i i-left" aria-hidden="true" />Giỏ hàng<span className="crt-vh"> (quay lại)</span></button>
        </div>
      </div>
      {errs.cancel && <p role="alert" className="field-error">{errs.cancel}</p>}

      {loadErr && <div role="alert" className="banner banner-error" data-testid="chk-checkout-error">Không tải được thanh toán.{' '}<button type="button" className="btn" onClick={() => void refresh()} data-testid="chk-checkout-retry">Thử lại</button></div>}
      {notice?.k === 'price' && (
        <div role="alert" className="banner banner-info" data-testid="chk-checkout-price-changed">
          <p><strong>Giá đã đổi:</strong> tổng cũ {formatPrice(notice.previous)} → mới {formatPrice(Number.isFinite(notice.next) ? notice.next : view.grand_total)}</p>
          {notice.lines.length > 0 && <ul>{notice.lines.map((l, i) => <li key={i}>{l.name}: {priceLine(l.was, l.now)}</li>)}</ul>}
          <button type="button" className="btn btn-primary tight" disabled={!canPlace} onClick={() => void place()} data-testid="chk-checkout-price-changed-confirm">Xác nhận và đặt hàng</button>
        </div>
      )}
      {notice?.k === 'cart-changed' && (
        <div role="alert" className="banner banner-info" data-testid="chk-checkout-cart-changed">Giỏ hàng đã đổi ở nơi khác.{' '}
          <button type="button" className="btn" disabled={off} onClick={() => void act('reload', async () => { await refresh(); })} data-testid="chk-checkout-cart-changed-reload">Tải lại</button></div>
      )}
      {showUnavailable && <div role="alert" className="banner banner-error" data-testid="chk-checkout-unavailable-items">Có sản phẩm ngừng bán. <Link href="/cart">Về giỏ hàng</Link></div>}
      {notice?.k === 'stock' && (
        <div role="alert" className="banner banner-error" data-testid="chk-checkout-stock-error">
          <p>Không đủ hàng. Chưa có đơn nào được tạo.</p>
          <ul>{notice.items.map((i, k) => <li key={k} data-testid="chk-checkout-stock-error-item">{i.name}: cần {i.requested}, còn {i.available}</li>)}</ul>
          <Link href="/cart" className="btn tight" data-testid="chk-checkout-stock-error-back">Về giỏ hàng</Link>
        </div>
      )}
      {notice?.k === 'place-error' && (notice.text !== '' || placeWait.left > 0) && (
        <div role="alert" className="banner banner-error" data-testid="chk-checkout-place-error">{notice.text || `${waitText(placeWait.left)}. Chưa có đơn nào được tạo.`}</div>
      )}

      <div className="crt-grid">
        <div>
          <fieldset className="plain crt-steps" disabled={off}>
            <section className="panel" data-testid="chk-checkout-address-section">
              <div className="crt-step"><span className={`crt-num${addrOk ? ' done' : ''}`}>{addrOk ? <span className="i i-check" aria-hidden="true" /> : '1'}</span><h2>Địa chỉ</h2>
                <Link href="/account/addresses/new" className="btn btn-sm crt-step-act" data-testid="chk-checkout-address-add">Địa chỉ mới</Link></div>
              {addresses === null && <div className="skeleton" aria-busy="true" />}
              {addresses !== null && addresses.length === 0 && <p className="crt-note" data-testid="chk-checkout-address-empty">Chưa có địa chỉ</p>}
              {addresses !== null && addresses.length > 0 && (
                <div role="radiogroup" aria-label="Địa chỉ giao hàng" className="crt-opts">
                  {addresses.map((a) => (
                    <Radio key={a.id} testid="chk-checkout-address-option" name="chk-address" checked={addrOk?.address_id === a.id} disabled={off} onChange={() => chooseAddress(a)}>
                      <strong>{a.receiver}</strong> · {a.phone}{a.is_default && <> <span className="badge" data-status="paid">Mặc định</span></>}<span className="crt-sub">{addressText(a)}</span>
                    </Radio>
                  ))}
                </div>
              )}
              {addrChangedShown && addrOk && (
                <div role="alert" className="banner banner-info" data-testid="chk-checkout-address-changed">
                  <p><strong>Địa chỉ đã cập nhật:</strong> {addrOk.receiver} · {addrOk.phone}, {addressText(addrOk)}</p>
                  <button type="button" className="btn btn-primary tight" disabled={off} onClick={confirmAddress} data-testid="chk-checkout-address-confirm">Dùng địa chỉ mới</button>
                </div>
              )}
              {addrGoneShown && <p role="alert" className="field-error" data-testid="chk-checkout-address-unavailable">Địa chỉ đã chọn không còn, hãy chọn lại</p>}
              {errs.address && <p role="alert" className="field-error" data-testid="chk-checkout-address-error">{errs.address}</p>}
            </section>

            <section className={`panel${opts?.k === 'needs-address' ? ' dim' : ''}`} data-testid="chk-checkout-shipping-section">
              <div className="crt-step"><span className={`crt-num${shipId ? ' done' : ''}`}>{shipId ? <span className="i i-check" aria-hidden="true" /> : '2'}</span><h2>Vận chuyển</h2></div>
              {opts === null && <div className="skeleton" aria-busy="true" />}
              {opts?.k === 'needs-address' && <p className="crt-note" data-testid="chk-checkout-shipping-needs-address">Chọn địa chỉ để xem phí</p>}
              {opts?.k === 'empty' && <p role="alert" className="field-error" data-testid="chk-checkout-shipping-empty">Chưa có phương thức vận chuyển nào đang bật</p>}
              {opts?.k === 'error' && <p role="alert" className="field-error" data-testid="chk-checkout-shipping-error">Không tính được phí <button type="button" className="btn btn-sm" onClick={() => void refresh()}>Thử lại</button></p>}
              {opts?.k === 'ok' && (
                <div role="radiogroup" aria-label="Phương thức vận chuyển" className="crt-opts">
                  {opts.options.map((o) => (
                    <Radio key={o.method_id} testid="chk-checkout-shipping-option" name="chk-shipping" checked={shipId === o.method_id} disabled={off} onChange={() => chooseShipping(o)}>
                      <span className="crt-optrow">{o.name}{o.free_shipping ? <span className="badge" data-status="paid" data-testid="chk-checkout-shipping-free">Miễn phí</span> : <span className="muted">{formatPrice(o.fee)}</span>}</span>
                    </Radio>
                  ))}
                </div>
              )}
              {shipGoneShown && <p role="alert" className="field-error" data-testid="chk-checkout-shipping-unavailable">Phương thức này không còn được dùng, hãy chọn lại</p>}
              {errs.shipping && <p role="alert" className="field-error" data-testid="chk-checkout-shipping-error">{errs.shipping}</p>}
            </section>

            <section className="panel" data-testid="chk-checkout-payment-section">
              <div className="crt-step"><span className={`crt-num${view.payment_method ? ' done' : ''}`}>{view.payment_method ? <span className="i i-check" aria-hidden="true" /> : '3'}</span><h2>Thanh toán</h2></div>
              <div role="radiogroup" aria-label="Phương thức thanh toán" className="crt-opts">
                <Radio testid="chk-checkout-payment-vnpay" name="chk-pay" checked={view.payment_method === 'vnpay'} disabled={off} onChange={() => choosePayment('vnpay')}><span className="crt-optrow"><span><span className="i i-card" aria-hidden="true" /> VNPay</span><span className="muted">Trả online</span></span></Radio>
                <Radio testid="chk-checkout-payment-cod" name="chk-pay" checked={view.payment_method === 'cod'} disabled={off} onChange={() => choosePayment('cod')}><span className="crt-optrow"><span><span className="i i-bag" aria-hidden="true" /> COD</span><span className="muted">Trả khi nhận</span></span></Radio>
              </div>
              {view.payment_note && (
                <p className="crt-note" data-testid="chk-checkout-payment-note"><span className="i i-info" aria-hidden="true" />
                  {view.payment_note.confirmed_immediately ? 'Xác nhận ngay, trả tiền khi nhận hàng.' : `Giữ hàng ${view.payment_note.hold_minutes} phút sau khi đặt, hãy thanh toán trong thời gian đó.`}
                </p>
              )}
              {payErr?.kind === 'range' && <p role="alert" className="field-error" data-testid="chk-checkout-payment-error-range">{payErrorText(payErr)}</p>}
              {payErr?.kind === 'zero' && <p role="alert" className="field-error" data-testid="chk-checkout-payment-error-zero">{payErrorText(payErr)}</p>}
              {payErr?.kind === 'open-orders' && <p role="alert" className="field-error" data-testid="chk-checkout-payment-error-open-orders">{payErrorText(payErr)}. <Link href="/orders">Xem danh sách đơn</Link></p>}
              {errs.payText && <p role="alert" className="field-error">{errs.payText}</p>}
            </section>

            <section className="panel" data-testid="chk-checkout-coupon-section">
              <div className="crt-step"><span className="crt-num alt"><span className="i i-ticket" aria-hidden="true" /></span><h2>Mã giảm giá</h2></div>
              {coupon?.applied && (
                <p className="crt-applied" data-testid="chk-checkout-coupon-applied"><span className="grow"><strong>{coupon.code}</strong> <span className="crt-off">{minus(coupon.discount)}</span></span>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Gỡ mã" disabled={off} onClick={removeCoupon} data-testid="chk-checkout-coupon-remove"><span className="i i-x" aria-hidden="true" /></button></p>
              )}
              {coupon && !coupon.applied && (
                <div role="alert" className="banner banner-info" data-testid="chk-checkout-coupon-invalid">{couponWarning(coupon)}{' '}
                  <button type="button" className="btn btn-quiet" disabled={off} onClick={removeCoupon} data-testid="chk-checkout-coupon-remove">Gỡ</button></div>
              )}
              {!coupon?.applied && (
                <form onSubmit={applyCoupon} className="crt-coupon">
                  <input value={code} maxLength={60} aria-label="Mã giảm giá" placeholder="Nhập mã" disabled={off} onChange={(e) => setCode(e.target.value)} data-testid="chk-checkout-coupon-input" />
                  <button className="btn" disabled={off || couponWait.left > 0 || code.trim() === ''} aria-busy={busy === 'coupon'} data-testid="chk-checkout-coupon-apply">{busy === 'coupon' && <Spinner />}Áp dụng</button>
                </form>
              )}
              {couponWait.left > 0 && <p role="alert" className="field-error" data-testid="chk-checkout-coupon-retry-after">Thử lại sau {couponWait.left} giây</p>}
              {errs.coupon && couponWait.left === 0 && <p role="alert" className="field-error" data-testid="chk-checkout-coupon-error">{errs.coupon}</p>}
            </section>
          </fieldset>
        </div>

        <aside className="panel crt-sum" aria-label="Đơn của bạn" data-testid="chk-checkout-summary">
          <h2><span className="i i-bag" aria-hidden="true" />Đơn của bạn</h2>
          <ul className="crt-slines">
            {view.lines.map((l) => {
              const av = availabilityText(l.availability);
              return (
                <li key={l.product_id} data-testid="chk-checkout-line">
                  <span className="grow">{l.name} <span className="muted">× {l.quantity}</span>
                    {av && <span className="crt-warn" data-testid="chk-checkout-line-availability"><span className="i i-alert" aria-hidden="true" />{av}</span>}</span>
                  <strong className="money">{formatPrice(l.line_total)}</strong>
                </li>
              );
            })}
          </ul>
          <dl className="crt-rows">
            <div><dt>Tạm tính</dt><dd data-testid="chk-checkout-summary-subtotal">{formatPrice(view.items_subtotal)}</dd></div>
            <div className={view.discount > 0 ? 'crt-off' : undefined}><dt>Giảm giá{coupon?.applied ? ` (${coupon.code})` : ''}</dt><dd data-testid="chk-checkout-summary-discount">{view.discount > 0 ? minus(view.discount) : formatPrice(view.discount)}</dd></div>
            <div><dt>Vận chuyển</dt>
              <dd data-testid="chk-checkout-summary-shipping-fee">{view.shipping_fee === null ? 'Chưa chọn' : sh && !('error' in sh) && sh.free_shipping ? 'Miễn phí' : formatPrice(view.shipping_fee)}</dd></div>
            <div className="crt-grand"><dt>Tổng cộng</dt><dd data-testid="chk-checkout-summary-total">{formatPrice(view.grand_total)}</dd></div>
          </dl>
          {view.total_is_estimate && <p className="crt-note" data-testid="chk-checkout-summary-total-estimate">Chưa gồm phí vận chuyển</p>}
          {addrOk && <p className="crt-note" data-testid="chk-checkout-summary-address"><span className="i i-pin" aria-hidden="true" />{addrOk.receiver}, {addressText(addrOk)}</p>}
          {!view.can_place_order && (
            <ul className="crt-todo" data-testid="chk-checkout-blockers" aria-label="Còn thiếu">
              {blockers.length > 0 ? blockers.map((b) => <li key={b}><span className="i i-alert" aria-hidden="true" />{blockerText(b)}</li>) : <li><span className="i i-alert" aria-hidden="true" />Chưa kiểm tra đủ thông tin, hãy tải lại.</li>}
            </ul>
          )}
          <button type="button" className="btn btn-primary crt-go" disabled={!canPlace} aria-busy={placing} onClick={() => void place()} data-testid="chk-checkout-place-order">{placing ? <Spinner /> : <span className="i i-check" aria-hidden="true" />}Đặt hàng</button>
          {placing && <p role="status" className="crt-note" data-testid="chk-checkout-placing">Đang đặt hàng...</p>}
        </aside>
      </div>
    </main>
  );
}
