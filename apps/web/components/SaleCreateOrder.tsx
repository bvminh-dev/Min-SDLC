'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { fetchStock } from '../lib/inventory';
import { ITEM_NOTE_MAX, NOTE_MAX, SALE_PAYMENTS, createOutcome, fieldErrorText, len, lookupQuery, parseQty, type CreateOutcome, type ProductHit, type SaleCustomerHit, type SalePayment, type SaleSource, type ShipOption } from '../lib/sales';
import { limitedText, newKey } from '../lib/stock';
import { Field } from './Form';
import { StockLabel } from './StockLabel';
import { useCountdown } from './useCountdown';

const P = 'sal-sale-create-order';
const DRAFT_KEY = 'sal:create-order-draft';
interface Line { product_id: string; name: string; price: number; qty: string; note: string; inStock?: boolean }
interface Form {
  source: string; name: string; phone: string; same: boolean; receiver: string; rphone: string; line1: string; ward: string; district: string; city: string;
  lines: Line[]; method: string; payment: SalePayment; note: string; picked: { id: string; name: string } | null;
}
const EMPTY: Form = { source: '', name: '', phone: '', same: false, receiver: '', rphone: '', line1: '', ward: '', district: '', city: '', lines: [], method: '', payment: 'cod', note: '', picked: null };
type Ship = { k: 'prompt' } | { k: 'loading' } | { k: 'ok'; options: ShipOption[] } | { k: 'empty' } | { k: 'error' };
type Lookup = { k: 'idle' } | { k: 'loading' } | { k: 'results'; items: SaleCustomerHit[] } | { k: 'empty' } | { k: 'error'; text: string } | { k: 'limited' };
const t = (name: string): string => `${P}-${name}`;

/** Bản nháp giữ qua lần đăng nhập lại (401): chỉ trong sessionStorage của tab, xóa ngay khi đọc; lỗi lưu hay đọc thì bỏ qua (SAL-REQ-20261015-092711128 BR7). */
const stash = (f: Form): void => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* không có kho tạm: bỏ qua */ } };
const unstash = (): Form | null => { try { const v = sessionStorage.getItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); return v ? { ...EMPTY, ...JSON.parse(v) } : null; } catch { return null; } };

/**
 * Tạo đơn hộ (ui/sale-create-order, SAL-REQ-20261015-092710847, ...092710942, ...092711037, ...092711128): một trang hai cột, năm khối nhập và khối tóm tắt kèm nút Tạo đơn (phương án A). Giá, phí và tổng hiển thị chỉ để tham khảo:
 * server tính lại và so với `expected_grand_total` (409 `price-changed`). Không có ô hay cột giá vốn (SB-42). Lỗi KHÔNG xóa biểu mẫu; khóa `Idempotency-Key` giữ nguyên khi gửi lại cùng nội dung sau lỗi mạng,
 * sinh mới khi nội dung đổi. Họ tên, ghi chú, địa chỉ là văn bản thuần, React escape (SB-12).
 */
export function SaleCreateOrder() {
  const [f, setF] = useState<Form>(EMPTY);
  const [srcs, setSrcs] = useState<{ k: 'loading' } | { k: 'error' } | { k: 'ready'; items: SaleSource[] }>({ k: 'loading' });
  const [lookup, setLookup] = useState<Lookup>({ k: 'idle' });
  const [lkey, setLkey] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ items: ProductHit[]; stock: Map<string, boolean> | null } | 'empty' | null>(null);
  const [ship, setShip] = useState<Ship>({ k: 'prompt' });
  const [out, setOut] = useState<CreateOutcome | null>(null);
  const [bad, setBad] = useState<Map<string, string>>(new Map()); // product_id -> lý do đánh dấu dòng
  const [tick, setTick] = useState(0); // đổi để buộc tính lại phí (phương thức vừa bị tắt)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const lookupWait = useCountdown();
  const createWait = useCountdown();
  const sent = useRef<{ json: string; key: string; reuse: boolean } | null>(null);
  const submitting = useRef(false);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const locked = done !== null;

  const loadSources = useCallback(async () => {
    setSrcs({ k: 'loading' });
    const r = await api<{ items: SaleSource[] }>('/order-sources');
    if (r.status === 200 && Array.isArray(r.body.items)) setSrcs({ k: 'ready', items: r.body.items }); else setSrcs({ k: 'error' });
  }, []);
  useEffect(() => { void loadSources(); const d = unstash(); if (d) setF(d); }, [loadSources]);

  // --- tính tiền hiển thị (chỉ tham khảo)
  const itemsTotal = f.lines.reduce((s, l) => s + l.price * (parseQty(l.qty) ?? 0), 0);
  const city = f.city.trim();
  const fee = ship.k === 'ok' ? ship.options.find((o) => o.method_id === f.method)?.fee ?? null : null;
  const grand = fee === null ? null : itemsTotal + fee;
  const shipKey = `${city}|${itemsTotal}`;
  const allQty = f.lines.length > 0 && f.lines.every((l) => parseQty(l.qty) !== null);

  // Phí vận chuyển: gọi lại khi đổi thành phố hay tạm tính (chờ 300 ms); phương thức đã chọn không còn thì bỏ chọn.
  useEffect(() => {
    if (!city || !allQty || itemsTotal < 1 || locked) { setShip({ k: 'prompt' }); return; }
    let live = true;
    const timer = setTimeout(async () => {
      setShip({ k: 'loading' });
      const r = await api<{ options: ShipOption[] }>(`/sales/shipping-options?city=${encodeURIComponent(city)}&items_subtotal=${itemsTotal}`);
      if (!live) return;
      if (r.status === 200 && Array.isArray(r.body.options)) { setShip({ k: 'ok', options: r.body.options }); setF((x) => (x.method && !r.body.options.some((o) => o.method_id === x.method) ? { ...x, method: '' } : x)); }
      else if (r.code === 'no-shipping-methods') setShip({ k: 'empty' });
      else setShip({ k: 'error' });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [shipKey, allQty, locked, tick]);

  // --- tra khách có tài khoản
  const doLookup = async () => {
    if (!lkey.trim() || lookupWait.left > 0) return;
    setLookup({ k: 'loading' });
    const r = await api<{ items: SaleCustomerHit[] }>(`/sales/customers/lookup?${lookupQuery(lkey)}`);
    if (r.status === 200 && Array.isArray(r.body.items)) setLookup(r.body.items.length ? { k: 'results', items: r.body.items } : { k: 'empty' });
    else if (r.status === 429) { lookupWait.start(r.retryAfter); setLookup({ k: 'limited' }); }
    else if (r.status === 400) setLookup({ k: 'error', text: 'Số điện thoại hoặc email không hợp lệ.' });
    else setLookup({ k: 'error', text: 'Không tra được khách.' });
  };
  useEffect(() => { if (lookup.k === 'limited' && lookupWait.left === 0) setLookup({ k: 'idle' }); }, [lookup.k, lookupWait.left]);

  // --- tìm sản phẩm (đang bán) và nhãn còn hàng
  const doSearch = useCallback(async (text: string) => {
    if (!text.trim()) { setHits(null); return; }
    const r = await api<{ items: ProductHit[] }>(`/products/search?q=${encodeURIComponent(text.trim())}&limit=10`);
    if (r.status !== 200 || !Array.isArray(r.body.items)) { setHits(null); return; }
    if (!r.body.items.length) { setHits('empty'); return; }
    setHits({ items: r.body.items, stock: null });
    const stock = await fetchStock(r.body.items.map((i) => i.id));
    setHits((h) => (h && h !== 'empty' && h.items === r.body.items ? { ...h, stock } : h));
  }, []);
  useEffect(() => { const timer = setTimeout(() => void doSearch(q), 300); return () => clearTimeout(timer); }, [q, doSearch]);
  const add = (p: ProductHit, inStock?: boolean) => {
    setF((x) => (x.lines.some((l) => l.product_id === p.id)
      ? { ...x, lines: x.lines.map((l) => (l.product_id === p.id ? { ...l, qty: String(Math.min(100000, (parseQty(l.qty) ?? 0) + 1)) } : l)) }
      : { ...x, lines: [...x.lines, { product_id: p.id, name: p.name, price: p.price, qty: '1', note: '', inStock }] }));
    setOut(null);
  };

  const same = f.same;
  const receiver = same ? f.name : f.receiver, rphone = same ? f.phone : f.rphone;
  const missing = [
    !f.source && 'nguồn đơn', !(f.name.trim() && f.phone.trim()) && 'khách', !(receiver.trim() && rphone.trim() && f.line1.trim() && f.ward.trim() && city) && 'địa chỉ', !allQty && 'sản phẩm', !f.method && 'vận chuyển',
  ].filter((x): x is string => !!x);
  const fieldErr = out?.k === 'form' ? out.fields : {};
  const err = (name: string): string | undefined => (fieldErr[name] ? fieldErrorText(fieldErr[name]) : undefined);
  const blocked = missing.length > 0 || locked || busy || createWait.left > 0 || ship.k === 'empty';

  // lỗi nhập liệu: ô đầu tiên lỗi được focus
  useEffect(() => {
    if (out?.k !== 'form') return;
    const p = document.querySelector<HTMLElement>('.field-error[data-field]');
    const input = p ? document.querySelector<HTMLElement>(`[aria-describedby="${p.id}"]`) : null;
    input?.focus();
  }, [out]);

  const body = (expected?: number) => ({
    source_code: f.source, customer: { ...(f.picked ? { user_id: f.picked.id } : {}), full_name: f.name.trim(), phone: f.phone.trim() },
    shipping_address: { receiver: receiver.trim(), phone: rphone.trim(), line1: f.line1.trim(), ward: f.ward.trim(), district: f.district.trim() || null, city },
    shipping_method_id: f.method, payment_method: f.payment, note: f.note.trim() || null,
    items: f.lines.map((l) => ({ product_id: l.product_id, quantity: parseQty(l.qty) ?? 0, note: l.note.trim() || null })), expected_grand_total: expected ?? grand ?? 0,
  });
  const submit = async (expected?: number) => {
    if (blocked || submitting.current) return;
    submitting.current = true; setBusy(true); setOut(null); setBad(new Map());
    const payload = body(expected);
    const json = JSON.stringify(payload);
    const key = sent.current && sent.current.json === json && sent.current.reuse ? sent.current.key : newKey(); // cùng nội dung sau lỗi mạng: GIỮ khóa; nội dung đổi hay lỗi 4xx đã xử lý: khóa mới
    const r = await api('/sales/orders', { method: 'POST', body: payload, headers: { 'Idempotency-Key': key } });
    sent.current = { json, key, reuse: r.status === 0 || r.status >= 500 };
    const o = createOutcome(r);
    setBusy(false); submitting.current = false;
    if (o.k === 'done') { setDone(o.code); return; }
    if (o.k === 'login') stash(f);
    if (o.k === 'rate') createWait.start(o.seconds);
    if (o.k === 'source') { set({ source: '' }); void loadSources(); }
    if (o.k === 'products') setBad(new Map(o.ids.map((id) => [id, 'Ngừng bán'])));
    if (o.k === 'stock') setBad(new Map(o.items.map((i) => [i.product_id, `Cần ${i.requested}, còn ${i.available}`])));
    if (o.k === 'shipping') { set({ method: '' }); setTick((n) => n + 1); }
    if (o.k === 'customer') set({ picked: null });
    setOut(o);
    if (o.k === 'stock' && o.items[0]) setTimeout(() => document.querySelector<HTMLElement>(`[data-line="${o.items[0].product_id}"] input`)?.focus(), 0);
  };
  const reset = () => { setF(EMPTY); setDone(null); setOut(null); setBad(new Map()); setLookup({ k: 'idle' }); setLkey(''); setQ(''); setHits(null); sent.current = null; };

  const stockBanner = out?.k === 'stock' ? out.items : [];

  if (srcs.k === 'loading') return <main className="page" aria-busy="true" data-testid={t('loading')}><div className="page-head"><h1>Tạo đơn hộ</h1></div><div className="crt-grid"><div className="stack"><div className="skeleton crt-sk" /><div className="skeleton crt-sk" /><div className="skeleton crt-sk" /></div><div className="skeleton crt-sk-sum" /></div></main>;
  const noSource = srcs.k === 'ready' && srcs.items.length === 0;

  return (
    <main className="page">
      <div className="page-head"><h1>Tạo đơn hộ</h1><div className="actions"><Link className="btn" href="/sales/orders">Đơn của tôi</Link></div></div>
      {srcs.k === 'error' && <div role="alert" className="banner banner-error" data-testid={t('error')}>Không tải được dữ liệu lập đơn. <button className="btn" onClick={() => void loadSources()} data-testid={t('retry')}>Thử lại</button></div>}
      {out?.k === 'error' && <div role="alert" className="banner banner-error" data-testid={t('error')}>Không tải được dữ liệu lập đơn. <button className="btn" disabled={busy} onClick={() => void submit()} data-testid={t('retry')}>Thử lại</button></div>}
      {out?.k === 'login' && <div role="alert" className="banner banner-error" data-testid={t('login-expired')}>Phiên đăng nhập đã hết hạn. <Link href="/login?next=%2Fsales%2Forders%2Fnew&reason=expired">Đăng nhập</Link></div>}
      {out?.k === 'price' && <div role="alert" className="banner banner-info" data-testid={t('price-changed')}>Tổng đã đổi: cũ {formatPrice(out.previous)} → mới {formatPrice(out.next)} <button className="btn" disabled={busy} onClick={() => void submit(out.next)} data-testid={t('price-changed-confirm')}>Xác nhận tổng mới và tạo đơn</button></div>}
      {out?.k === 'source' && <div role="alert" className="banner banner-error" data-testid={t('source-unavailable')}>Nguồn đơn này vừa bị tắt, chọn nguồn khác.</div>}
      {out?.k === 'products' && <div role="alert" className="banner banner-error" data-testid={t('product-unavailable')}>Có sản phẩm không còn bán: {f.lines.filter((l) => bad.has(l.product_id)).map((l) => l.name).join(', ') || 'xem các dòng đánh dấu'}.</div>}
      {out?.k === 'stock' && <div role="alert" className="banner banner-error" data-testid={t('insufficient-stock')}>Không đủ hàng: {stockBanner.map((i) => `${i.name} (cần ${i.requested}, còn ${i.available})`).join(' · ')}</div>}
      {out?.k === 'shipping' && <div role="alert" className="banner banner-error" data-testid={t('shipping-unavailable')}>Phương thức vận chuyển vừa bị tắt, chọn lại.</div>}
      {out?.k === 'customer' && <div role="alert" className="banner banner-error" data-testid={t('customer-not-found')}>Tài khoản khách không hợp lệ, đã bỏ gắn.</div>}
      {out?.k === 'range' && <div role="alert" className="banner banner-error" data-testid={t('total-out-of-range')}>Tổng tiền vượt giới hạn 10.000.000.000 đ</div>}
      {out?.k === 'rate' && createWait.left > 0 && <div role="alert" className="banner banner-error" data-testid={t('rate-limited')}>Tạo đơn quá nhanh, thử lại sau {createWait.left} giây</div>}
      {out?.k === 'form' && <div role="alert" className="banner banner-error" data-testid={t('form-error')}>Có ô nhập chưa hợp lệ, xem các ô được đánh dấu.</div>}
      {done && (
        <section className="banner banner-ok" role="status" data-testid={t('done')}>
          <div>Đã tạo đơn <b className="mono" data-testid={t('done-code')}>{done}</b></div>
          <div className="row"><Link className="btn" href={`/sales/orders/${done}`} data-testid={t('done-open')}>Xem đơn</Link><button className="btn" onClick={reset} data-testid={t('done-new')}>Tạo đơn khác</button></div>
        </section>
      )}

      <div className="crt-grid">
        <fieldset className="stack sal-form" disabled={locked}>
          <section className="panel">
            <div className="panel-head"><h2>1. Nguồn đơn *</h2></div>
            {noSource
              ? <p className="muted" data-testid={t('source-empty')}>Chưa có nguồn đơn nào đang bật, nhờ admin bật nguồn.</p>
              : (
                <Field label="Nguồn đơn" error={err('source_code')} field="source_code">
                  {(id, d) => (
                    <select id={id} aria-describedby={d} value={f.source} onChange={(e) => { set({ source: e.target.value }); setOut(null); }} data-testid={t('source')}>
                      <option value="">Chọn nguồn đơn</option>
                      {srcs.k === 'ready' && srcs.items.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </select>
                  )}
                </Field>
              )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>2. Khách</h2></div>
            <div className="row">
              <input aria-label="Tra khách có tài khoản" placeholder="Điện thoại hoặc email khách" value={lkey} maxLength={254} onChange={(e) => setLkey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void doLookup(); } }} data-testid={t('lookup-key')} />
              <button type="button" className="btn" disabled={!lkey.trim() || lookup.k === 'loading' || lookupWait.left > 0} onClick={() => void doLookup()} data-testid={t('lookup-submit')}>Tra</button>
            </div>
            {lookup.k === 'results' && (
              <ul className="list" data-testid={t('lookup-results')}>
                {lookup.items.map((c) => (
                  <li key={c.id} data-testid={t('lookup-result')}>
                    <div className="grow"><b>{c.full_name}</b> <span className="muted">{c.phone ?? '—'} · {c.email}{c.status === 'locked' ? ' · đang khóa' : ''}</span></div>
                    <button type="button" className="btn" onClick={() => { set({ picked: { id: c.id, name: c.full_name }, name: c.full_name }); setLookup({ k: 'idle' }); }} data-testid={t('lookup-pick')}>Chọn</button>
                  </li>
                ))}
              </ul>
            )}
            {lookup.k === 'empty' && <p className="muted" data-testid={t('lookup-empty')}>Không thấy khách có tài khoản. Nhập khách mới bên dưới.</p>}
            {lookup.k === 'error' && <p role="alert" className="field-error" data-testid={t('lookup-error')}>{lookup.text} Bấm Tra để thử lại.</p>}
            {lookup.k === 'limited' && lookupWait.left > 0 && <p role="alert" className="field-error" data-testid={t('lookup-limited')}>Tra quá nhanh, thử lại sau {lookupWait.left} giây.</p>}
            {f.picked && <p className="row" data-testid={t('customer-selected')}>✓ Đang gắn tài khoản: <b>{f.picked.name}</b> <button type="button" className="btn btn-quiet btn-sm tight" onClick={() => set({ picked: null })} data-testid={t('customer-clear')}>Bỏ chọn</button></p>}
            <div className="split">
              <Field label="Họ tên *" error={err('customer.full_name')} field="customer.full_name">{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!err('customer.full_name')} maxLength={100} value={f.name} onChange={(e) => set({ name: e.target.value })} data-testid={t('customer-name')} />}</Field>
              <Field label="Điện thoại *" error={err('customer.phone')} field="customer.phone">{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!err('customer.phone')} inputMode="tel" maxLength={20} value={f.phone} onChange={(e) => set({ phone: e.target.value })} data-testid={t('customer-phone')} />}</Field>
            </div>
            <label className="row"><input type="checkbox" checked={same} onChange={(e) => set({ same: e.target.checked })} data-testid={t('same-as-customer')} /> Người nhận giống khách</label>
            {!same && (
              <div className="split">
                <Field label="Người nhận *" error={err('shipping_address.receiver')} field="shipping_address.receiver">{(id, d) => <input id={id} aria-describedby={d} maxLength={100} value={f.receiver} onChange={(e) => set({ receiver: e.target.value })} data-testid={t('receiver')} />}</Field>
                <Field label="SĐT người nhận *" error={err('shipping_address.phone')} field="shipping_address.phone">{(id, d) => <input id={id} aria-describedby={d} inputMode="tel" maxLength={20} value={f.rphone} onChange={(e) => set({ rphone: e.target.value })} data-testid={t('receiver-phone')} />}</Field>
              </div>
            )}
            {same && (err('shipping_address.receiver') || err('shipping_address.phone')) && <p role="alert" className="field-error">Họ tên hoặc điện thoại của khách không hợp lệ cho người nhận.</p>}
            <div className="split">
              <Field label="Địa chỉ *" error={err('shipping_address.line1')} field="shipping_address.line1">{(id, d) => <input id={id} aria-describedby={d} maxLength={200} value={f.line1} onChange={(e) => set({ line1: e.target.value })} data-testid={t('line1')} />}</Field>
              <Field label="Phường, xã *" error={err('shipping_address.ward')} field="shipping_address.ward">{(id, d) => <input id={id} aria-describedby={d} maxLength={100} value={f.ward} onChange={(e) => set({ ward: e.target.value })} data-testid={t('ward')} />}</Field>
              <Field label="Quận, huyện" error={err('shipping_address.district')} field="shipping_address.district">{(id, d) => <input id={id} aria-describedby={d} maxLength={100} value={f.district} onChange={(e) => set({ district: e.target.value })} data-testid={t('district')} />}</Field>
              <Field label="Thành phố *" error={err('shipping_address.city')} field="shipping_address.city">{(id, d) => <input id={id} aria-describedby={d} maxLength={100} value={f.city} onChange={(e) => set({ city: e.target.value })} data-testid={t('city')} />}</Field>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>3. Sản phẩm</h2></div>
            <input type="search" aria-label="Tìm sản phẩm theo tên hoặc mã hàng" placeholder="Tìm sản phẩm (tên hoặc mã hàng)" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void doSearch(q); } }} data-testid={t('product-search')} />
            {hits === 'empty' && <p className="muted" data-testid={t('product-empty')}>Không có sản phẩm nào khớp.</p>}
            {hits && hits !== 'empty' && (
              <ul className="list" data-testid={t('product-results')}>
                {hits.items.map((p) => (
                  <li key={p.id}><div className="grow"><b>{p.name}</b> <span className="muted">{formatPrice(p.price)}</span> <StockLabel inStock={hits.stock?.get(p.id)} testId={t('line-stock')} /></div>
                    <button type="button" className="btn" onClick={() => add(p, hits.stock?.get(p.id))} data-testid={t('product-add')}>Thêm</button></li>
                ))}
              </ul>
            )}
            {f.lines.length === 0
              ? <p className="muted" data-testid={t('lines-empty')}>Chưa có sản phẩm trong đơn.</p>
              : (
                <ul className="list">
                  {f.lines.map((l, i) => (
                    <li key={l.product_id} data-line={l.product_id} data-testid={t('line')} aria-invalid={bad.has(l.product_id)} className={bad.has(l.product_id) ? 'sal-line-bad' : undefined}>
                      <div className="grow">
                        <div><b>{l.name}</b> <span className="muted">{formatPrice(l.price)}</span> <StockLabel inStock={l.inStock} testId={t('line-stock')} />{bad.has(l.product_id) && <span className="field-error"> ⚠ {bad.get(l.product_id)}</span>}</div>
                        <div className="split">
                          <Field label="SL" error={err(`items.${i}.quantity`)} field={`items.${i}.quantity`}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={l.qty} onChange={(e) => { setF((x) => ({ ...x, lines: x.lines.map((y) => (y.product_id === l.product_id ? { ...y, qty: e.target.value } : y)) })); setBad((m) => { const n = new Map(m); n.delete(l.product_id); return n; }); }} data-testid={t('line-qty')} />}</Field>
                          <Field label="Ghi chú" error={err(`items.${i}.note`)} field={`items.${i}.note`}>{(id, d) => <input id={id} aria-describedby={d} maxLength={ITEM_NOTE_MAX} value={l.note} onChange={(e) => setF((x) => ({ ...x, lines: x.lines.map((y) => (y.product_id === l.product_id ? { ...y, note: e.target.value } : y)) }))} data-testid={t('line-note')} />}</Field>
                        </div>
                      </div>
                      <button type="button" className="btn btn-quiet" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((y) => y.product_id !== l.product_id) }))} data-testid={t('line-remove')}>Xóa</button>
                    </li>
                  ))}
                </ul>
              )}
            {(err('items') || err('items.0.product_id')) && <p role="alert" className="field-error">Danh sách sản phẩm chưa hợp lệ.</p>}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>4. Giao hàng</h2></div>
            {ship.k === 'prompt' && <p className="muted" data-testid={t('shipping-prompt')}>Nhập thành phố và thêm hàng để xem phí</p>}
            {ship.k === 'loading' && <p className="muted" aria-busy="true">Đang tính phí…</p>}
            {ship.k === 'empty' && <p className="muted" data-testid={t('shipping-empty')}>Chưa có phương thức vận chuyển nào đang bật</p>}
            {ship.k === 'error' && <p role="alert" className="field-error">Không tính được phí vận chuyển.</p>}
            {ship.k === 'ok' && (
              <div role="radiogroup" aria-label="Phương thức vận chuyển" className="stack-sm" data-testid={t('shipping-options')}>
                {ship.options.map((o) => (
                  <label key={o.method_id} className="crt-opt"><input type="radio" name="sal-ship" checked={f.method === o.method_id} onChange={() => { set({ method: o.method_id }); setOut(null); }} data-testid={t('shipping-option')} /> <span className="grow">{o.name}</span> <span className="money">{o.free_shipping ? 'Miễn phí' : formatPrice(o.fee)}</span></label>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>5. Thanh toán và ghi chú</h2></div>
            <div className="row" role="radiogroup" aria-label="Thanh toán">
              {SALE_PAYMENTS.map(([v, label]) => <label key={v} className="crt-opt"><input type="radio" name="sal-pay" checked={f.payment === v} onChange={() => set({ payment: v })} data-testid={t(`payment-${v.replace('_', '-')}`)} /> {label}</label>)}
            </div>
            <Field label="Ghi chú đơn" error={err('note')} field="note">{(id, d) => <textarea id={id} aria-describedby={d} rows={3} value={f.note} onChange={(e) => set({ note: e.target.value })} data-testid={t('note')} />}</Field>
            <p className="hint" data-testid={t('note-counter')}>{len(f.note)}/{NOTE_MAX}</p>
          </section>
        </fieldset>

        <aside className="panel stack-sm sal-summary" data-testid={t('summary')}>
          <h2>Tóm tắt</h2>
          <ul className="list">{f.lines.map((l) => <li key={l.product_id}><span className="grow">{l.name} x{parseQty(l.qty) ?? '?'}</span><span className="money">{formatPrice(l.price * (parseQty(l.qty) ?? 0))}</span></li>)}</ul>
          <dl className="kv">
            <dt>Tạm tính</dt><dd className="right" data-testid={t('items-total')}>{formatPrice(itemsTotal)}</dd>
            <dt>Phí vận chuyển</dt><dd className="right" data-testid={t('shipping-fee')}>{fee === null ? '—' : formatPrice(fee)}</dd>
            <dt className="strong">Tổng cộng</dt><dd className="right money" data-testid={t('grand-total')}>{grand === null ? '—' : formatPrice(grand)}</dd>
          </dl>
          <p className="muted small">Thanh toán: {SALE_PAYMENTS.find(([v]) => v === f.payment)?.[1]}</p>
          <button type="button" className="btn btn-primary" disabled={blocked} aria-busy={busy} onClick={() => void submit()} data-testid={t('submit')}>
            {busy && <span className="spinner" aria-hidden="true" data-testid={t('submitting')} />}Tạo đơn
          </button>
          {missing.length > 0 && !locked && <p className="hint" data-testid={t('submit-missing')}>Còn thiếu: {missing.join(', ')}</p>}
          {createWait.left > 0 && <p className="hint">{limitedText(createWait.left)}</p>}
        </aside>
      </div>
    </main>
  );
}
