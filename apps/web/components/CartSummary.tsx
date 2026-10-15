'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { CITY_MAX } from '../lib/cart-const';
import { CHECKOUT_REASON, announceCart, couponErrorText, couponWarning, limitedText, minus, type Cart, type ShippingMethod } from '../lib/cart';
import { formatPrice } from '../lib/format';
import { Spinner } from './PaymentParts';
import { useCountdown } from './useCountdown';

const CITY_DEBOUNCE_MS = 500;

/**
 * Tóm tắt đơn trong giỏ (CRT ui/cart-summary): tạm tính, mã giảm giá, vận chuyển, tổng, nút sang thanh toán. Mọi số tiền lấy từ phản hồi của máy chủ (giao diện không tự cộng trừ, SB-23).
 * Mã chỉ gửi khi bấm Áp dụng hoặc Enter (không gửi khi gõ, tránh đếm lượt sai, T5); chọn phương thức hay đổi thành phố gửi ngay khi đủ cả hai, không có nút Lưu riêng.
 * 429 `too-many-attempts` hiện "thử lại sau N giây" và khóa nút Áp dụng tới hết giờ chờ rồi tự mở lại (đường thoát của trạng thái có thời hạn).
 */
export function CartSummary({ cart, onCart }: { cart: Cart; onCart: (c: Cart) => void }) {
  const empty = cart.items.length === 0;
  const [code, setCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponErr, setCouponErr] = useState('');
  const wait = useCountdown();
  const [methods, setMethods] = useState<ShippingMethod[] | null>(null);
  const [methodsErr, setMethodsErr] = useState(false);
  const [methodId, setMethodId] = useState(cart.shipping?.method_id ?? '');
  const [city, setCity] = useState(cart.shipping?.city ?? '');
  const [shipBusy, setShipBusy] = useState(false);
  const [shipErr, setShipErr] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(`${cart.shipping?.method_id ?? ''}|${cart.shipping?.city ?? ''}`);

  // Phương thức đang bật của SHP (GET /shipping/methods) và thành phố từ sổ địa chỉ của USR (giao diện gọi thẳng, CRT không gọi USR): chỉ khi giỏ có hàng.
  const loadMethods = useCallback(async () => {
    setMethodsErr(false);
    const r = await api<{ items: ShippingMethod[] }>('/shipping/methods', { silentExpired: true });
    if (r.status === 200 && Array.isArray(r.body.items)) setMethods(r.body.items); else setMethodsErr(true);
  }, []);
  useEffect(() => { if (!empty && methods === null && !methodsErr) void loadMethods(); }, [empty, methods, methodsErr, loadMethods]);
  useEffect(() => {
    if (empty) return;
    void api<{ items: { city: string }[] }>('/me/addresses', { silentExpired: true }).then((r) => { if (r.status === 200 && Array.isArray(r.body.items)) setCities([...new Set(r.body.items.map((a) => a.city).filter(Boolean))]); });
  }, [empty]);
  // Giỏ đổi từ máy chủ (xóa dòng cuối, làm trống, tắt phương thức): đồng bộ lựa chọn hiển thị.
  useEffect(() => { setMethodId(cart.shipping?.method_id ?? ''); setCity(cart.shipping?.city ?? ''); sent.current = `${cart.shipping?.method_id ?? ''}|${cart.shipping?.city ?? ''}`; if (cart.shipping === null) setShipErr(''); }, [cart.shipping?.method_id, cart.shipping?.city]);

  const apply = async (e?: FormEvent) => {
    e?.preventDefault();
    if (couponBusy || wait.left > 0) return;
    const c = code.trim();
    if (c.length < 1 || c.length > 50) { setCouponErr('Mã phải từ 1 đến 50 ký tự'); return; }
    setCouponBusy(true); setCouponErr('');
    const r = await api<Cart>('/cart/coupon', { method: 'PUT', body: { code: c }, silentExpired: true });
    setCouponBusy(false);
    if (r.status === 200) { onCart(r.body); setCode(''); announceCart(r.body.item_count); }
    else if (r.code === 'too-many-attempts') wait.start(r.retryAfter);
    else if (r.status === 429) setCouponErr(limitedText(r.retryAfter));
    else setCouponErr(couponErrorText(r));
  };
  const remove = async () => {
    if (couponBusy) return;
    setCouponBusy(true); setCouponErr('');
    const r = await api('/cart/coupon', { method: 'DELETE', silentExpired: true });
    if (r.status === 204) { const g = await api<Cart>('/cart', { silentExpired: true }); if (g.status === 200) onCart(g.body); } else setCouponErr(r.status === 429 ? limitedText(r.retryAfter) : 'Không gỡ được mã. Thử lại.');
    setCouponBusy(false);
  };

  const sendShipping = useCallback(async (m: string, c: string) => {
    const key = `${m}|${c.trim()}`;
    if (!m || !c.trim() || key === sent.current) return;
    setShipBusy(true); setShipErr('');
    const r = await api<Cart>('/cart/shipping', { method: 'PUT', body: { method_id: m, city: c.trim() }, silentExpired: true });
    setShipBusy(false);
    if (r.status === 200) { sent.current = key; onCart(r.body); }
    else if (r.code === 'method-unavailable') { setShipErr('Phương thức này không còn được dùng, hãy chọn lại'); void loadMethods(); }
    else if (r.code === 'cart-limit-exceeded') setShipErr('Giỏ hàng vượt giá trị tối đa, hãy bớt sản phẩm');
    else if (r.status === 429) setShipErr(limitedText(r.retryAfter));
    else if (r.status === 400) setShipErr(`Thành phố phải từ 1 đến ${CITY_MAX} ký tự`);
    else setShipErr('Không chọn được vận chuyển. Thử lại.');
  }, [onCart, loadMethods]);
  const pickMethod = (id: string) => { setMethodId(id); if (debounce.current) clearTimeout(debounce.current); void sendShipping(id, city); };
  const typeCity = (v: string) => {
    setCity(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void sendShipping(methodId, v), CITY_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const sh = cart.shipping;
  const shError = shipErr || (sh && 'error' in sh && sh.error === 'method_unavailable' ? 'Phương thức này không còn được dùng, hãy chọn lại' : sh && 'error' in sh && sh.error === 'service_unavailable' ? 'Chưa tính được phí vận chuyển lúc này' : sh && 'error' in sh && sh.error === 'cart_limit_exceeded' ? 'Giỏ hàng vượt giá trị tối đa, hãy bớt sản phẩm' : '');
  const coupon = cart.coupon;
  const locked = wait.left > 0;
  return (
    <aside className="panel crt-sum" aria-label="Tóm tắt đơn">
      <h2><span className="i i-receipt" aria-hidden="true" />Tóm tắt</h2>

      <div className="crt-sec">
        <h3 className="crt-lbl"><span className="i i-ticket" aria-hidden="true" />Mã giảm giá</h3>
        {coupon?.applied && (
          <p className="crt-applied" data-testid="crt-cart-summary-coupon-applied"><span className="grow"><strong>{coupon.code}</strong> <span className="crt-off">{minus(coupon.discount)}</span></span>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Gỡ mã" disabled={couponBusy} onClick={() => void remove()} data-testid="crt-cart-summary-coupon-remove"><span className="i i-x" aria-hidden="true" /></button></p>
        )}
        {coupon && !coupon.applied && (
          <div role="alert" className="banner banner-info" data-testid="crt-cart-summary-coupon-invalid">{couponWarning(coupon)}{' '}
            <button type="button" className="btn btn-quiet" disabled={couponBusy} onClick={() => void remove()} data-testid="crt-cart-summary-coupon-remove">Gỡ</button></div>
        )}
        {!coupon?.applied && (
          <form onSubmit={(e) => void apply(e)} className="crt-coupon">
            <input value={code} maxLength={60} aria-label="Mã giảm giá" placeholder="Nhập mã" disabled={couponBusy || empty} onChange={(e) => setCode(e.target.value)} data-testid="crt-cart-summary-coupon-input" />
            <button className="btn" disabled={couponBusy || locked || empty || code.trim() === ''} aria-busy={couponBusy} data-testid="crt-cart-summary-coupon-apply">{couponBusy && <Spinner />}Áp dụng</button>
          </form>
        )}
        {locked && <p role="alert" className="crt-warn" data-testid="crt-cart-summary-coupon-retry-after">Thử lại sau {wait.left} giây</p>}
        {couponErr && !locked && <p role="alert" className="crt-warn" data-testid="crt-cart-summary-coupon-error">{couponErr}</p>}
      </div>

      <div className="crt-sec">
        <h3 className="crt-lbl"><span className="i i-truck" aria-hidden="true" />Vận chuyển</h3>
        {empty ? <p className="crt-note">Thêm sản phẩm trước</p> : (
          <>
            {methods === null && !methodsErr && <div className="skeleton" aria-busy="true" />}
            {methodsErr && <p role="alert" className="crt-warn">Không tải được vận chuyển. <button type="button" className="btn btn-sm" onClick={() => void loadMethods()}>Thử lại</button></p>}
            {methods && methods.length === 0 && <p className="crt-note">Chưa có phương thức nào</p>}
            {methods && methods.length > 0 && (
              <div role="radiogroup" aria-label="Phương thức vận chuyển" className="crt-opts" data-testid="crt-cart-summary-shipping-method">
                {methods.map((m) => (
                  <label key={m.id} className="crt-opt"><input type="radio" name="ship-method" value={m.id} checked={methodId === m.id} disabled={shipBusy} onChange={() => pickMethod(m.id)} /> <span className="grow">{m.name}</span> <span className="muted">{formatPrice(m.base_fee)}</span></label>
                ))}
              </div>
            )}
            <div className="crt-city"><label htmlFor="crt-city">Thành phố</label>
              <input id="crt-city" value={city} list="crt-cities" maxLength={60} autoComplete="address-level2" disabled={shipBusy} onChange={(e) => typeCity(e.target.value)} onBlur={() => { if (debounce.current) clearTimeout(debounce.current); void sendShipping(methodId, city); }} data-testid="crt-cart-summary-shipping-city" />
              <datalist id="crt-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist></div>
          </>
        )}
        {shError && <p role="alert" className="crt-warn" data-testid="crt-cart-summary-shipping-error">{shError}</p>}
      </div>

      <dl className="crt-rows">
        <div><dt>Tạm tính</dt><dd data-testid="crt-cart-summary-subtotal">{formatPrice(cart.subtotal)}</dd></div>
        {cart.discount > 0 && <div className="crt-off"><dt>Giảm giá</dt><dd data-testid="crt-cart-summary-discount">{minus(cart.discount)}</dd></div>}
        <div><dt>Vận chuyển</dt>
          <dd data-testid="crt-cart-summary-shipping-fee">{sh && sh.fee !== null ? (sh.free_shipping ? 'Miễn phí' : formatPrice(sh.fee)) : cart.shipping_fee !== null ? formatPrice(cart.shipping_fee) : 'Chưa chọn'}</dd></div>
        <div className="crt-grand"><dt>Tổng cộng</dt><dd data-testid="crt-cart-summary-total">{formatPrice(cart.total)}</dd></div>
      </dl>
      {sh && sh.fee !== null && sh.free_shipping && <p className="crt-free" data-testid="crt-cart-summary-shipping-free"><span className="i i-gift" aria-hidden="true" />Miễn phí vận chuyển</p>}
      {cart.total_is_estimate && !empty && <p className="crt-note" data-testid="crt-cart-summary-total-estimate">Chưa gồm phí vận chuyển</p>}

      {cart.can_checkout
        ? <Link className="btn btn-primary crt-go" href="/checkout" data-testid="crt-cart-summary-checkout-link">Thanh toán<span className="i i-right" aria-hidden="true" /></Link>
        : <><span className="btn btn-primary crt-go" role="link" aria-disabled="true" data-testid="crt-cart-summary-checkout-link">Thanh toán<span className="i i-right" aria-hidden="true" /></span>
          <p className="crt-warn" data-testid="crt-cart-summary-checkout-disabled-reason"><span className="i i-info" aria-hidden="true" />{CHECKOUT_REASON(cart)}</p></>}
    </aside>
  );
}
