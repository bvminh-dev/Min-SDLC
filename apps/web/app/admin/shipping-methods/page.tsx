'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Forbidden, Modal, ToastView, useCall, useToast } from '../../../components/ShipmentParts';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatPrice } from '../../../lib/format';
import { useLoginRedirect } from '../../../lib/prd';
import type { ShippingMethod } from '../../../lib/shipping';
import { limitedText } from '../../../lib/stock';

const P = 'shp-shipping-method-admin';
const MAX_METHODS = 20;
const MAX = { base_fee: 1_000_000, free_over: 10_000_000_000, surcharge: 500_000, cities: 63 };
const MSG = { name: 'Tên 2 tới 80 ký tự', base_fee: 'Phí cơ bản là số nguyên từ 0 tới 1.000.000', free_over: 'Miễn phí từ là số nguyên từ 0 tới 10.000.000.000, để trống nếu không miễn', surcharge: 'Phụ thu là số nguyên từ 0 tới 500.000', cities: 'Cần ít nhất một thành phố khi có phụ thu (tối đa 63, mỗi tên 1 tới 50 ký tự)' };
type Field = keyof typeof MSG;

interface Form { id?: string; version?: number; name: string; base_fee: string; free_over: string; surcharge: string; cities: string[]; city: string }
const blank = (): Form => ({ name: '', base_fee: '', free_over: '', surcharge: '', cities: [], city: '' });
/** Dữ liệu sửa lấy nguyên giá trị đã lưu (số nguyên, không làm tròn). */
const fromMethod = (m: ShippingMethod): Form => ({
  id: m.id, version: m.version, name: m.name, base_fee: String(m.base_fee), free_over: m.rule?.free_over == null ? '' : String(m.rule.free_over),
  surcharge: m.rule?.surcharge ? String(m.rule.surcharge) : '', cities: Array.isArray(m.rule?.surcharge_cities) ? [...m.rule.surcharge_cities] : [], city: '',
});
const intIn = (s: string, max: number): boolean => /^\d{1,12}$/.test(s.trim()) && Number(s.trim()) <= max;
const sameCity = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Thành phố của biểu mẫu: các thẻ đã thêm cộng chữ đang gõ dở (không để mất khi bấm Lưu mà chưa bấm Enter). */
const allCities = (f: Form): string[] => { const c = f.city.trim(); return c && !f.cities.some((x) => sameCity(x, c)) ? [...f.cities, c] : f.cities; };
function validate(f: Form): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  const n = f.name.trim().length;
  if (n < 2 || n > 80) e.name = MSG.name;
  if (!intIn(f.base_fee, MAX.base_fee)) e.base_fee = MSG.base_fee;
  if (f.free_over.trim() !== '' && !intIn(f.free_over, MAX.free_over)) e.free_over = MSG.free_over;
  const sur = f.surcharge.trim() === '' ? 0 : intIn(f.surcharge, MAX.surcharge) ? Number(f.surcharge.trim()) : null;
  const cities = allCities(f);
  if (sur === null) e.surcharge = MSG.surcharge;
  else if ((sur > 0 && cities.length === 0) || cities.length > MAX.cities || cities.some((c) => c.length > 50)) e.cities = MSG.cities;
  return e;
}
/** Tên trường của lỗi 400 (`rule.surcharge_cities`, `base_fee`...) về ô của biểu mẫu. */
const fieldOf = (s: string): Field | null => (s === 'name' ? 'name' : s === 'base_fee' ? 'base_fee' : s.endsWith('free_over') ? 'free_over' : s.endsWith('surcharge_cities') ? 'cities' : s.endsWith('surcharge') ? 'surcharge' : null);

function MethodForm({ initial, onClose, onSaved, onReload }: { initial: Form; onClose: () => void; onSaved: () => void; onReload: (id: string) => Promise<Form | null> }) {
  const uid = useId();
  const [f, setF] = useState<Form>(initial);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [srv, setSrv] = useState<Partial<Record<Field, string>>>({});
  const [taken, setTaken] = useState(false);
  const [conflict, setConflict] = useState(false);
  const { busy, err, rateText, call } = useCall();
  const errors = validate(f);
  const edit = (patch: Partial<Form>, field?: Field) => { setF((x) => ({ ...x, ...patch })); if (field) { setTouched((t) => ({ ...t, [field]: true })); setSrv((s) => ({ ...s, [field]: undefined })); } setTaken(false); };
  const addCity = () => { const c = f.city.trim(); if (!c) return; setF((x) => ({ ...x, cities: x.cities.some((y) => sameCity(y, c)) ? x.cities : [...x.cities, c], city: '' })); setTouched((t) => ({ ...t, cities: true })); };
  const shown = (k: Field): string | undefined => srv[k] ?? (touched[k] ? errors[k] : undefined);

  const save = async () => {
    setSrv({}); setTaken(false); setConflict(false);
    const sur = f.surcharge.trim() === '' ? 0 : Number(f.surcharge.trim());
    const body = { name: f.name.trim(), base_fee: Number(f.base_fee.trim()), rule: { free_over: f.free_over.trim() === '' ? null : Number(f.free_over.trim()), surcharge: sur, surcharge_cities: allCities(f) } };
    const r = await call(f.id ? `/admin/shipping/methods/${f.id}` : '/admin/shipping/methods', f.id ? 'PATCH' : 'POST', f.id ? { ...body, version: f.version } : body, (x) => {
      if (x.status === 400) {
        const m: Partial<Record<Field, string>> = {};
        for (const k of Object.keys(x.fieldErrors)) { const fd = fieldOf(k); if (fd) m[fd] = MSG[fd]; }
        setSrv(m);
        return { text: Object.keys(m).length ? '' : 'Dữ liệu không hợp lệ' };
      }
      if (x.code === 'shipping-method-name-taken') { setTaken(true); return { text: '' }; }
      if (x.code === 'version-conflict') { setConflict(true); return { text: '' }; }
      if (x.code === 'too-many-methods') return { text: `Đã đủ ${MAX_METHODS} phương thức, tắt hoặc sửa phương thức có sẵn` };
      if (x.status === 403) return { text: 'Bạn không có quyền thực hiện thao tác này' };
      if (x.status === 404) return { text: 'Phương thức không còn tồn tại' };
      return { text: 'Không lưu được. Thử lại.' };
    });
    if (r) onSaved();
  };
  const reload = async () => { const n = f.id ? await onReload(f.id) : null; if (n) { setF(n); setConflict(false); setSrv({}); } };
  const formError = rateText ?? err?.text;
  const fieldErr = (k: Field) => { const m = shown(k); return m ? <p role="alert" className="field-error" data-testid={`${P}-field-error`} data-field={k}>{m}</p> : null; };

  return (
    <Modal title={f.id ? 'Sửa phương thức vận chuyển' : 'Thêm phương thức vận chuyển'} testid={`${P}-form`} sticky onClose={() => !busy && onClose()}>
      <fieldset disabled={busy} className="plain">
        <label>Tên
          <input value={f.name} autoComplete="off" autoFocus onChange={(e) => edit({ name: e.target.value }, 'name')} data-testid={`${P}-name-input`} />
        </label>
        {fieldErr('name')}
        {taken && <p role="alert" className="field-error" data-testid={`${P}-name-taken`}>Tên này đã được dùng</p>}
        <label>Phí cơ bản (đ)
          <input inputMode="numeric" value={f.base_fee} autoComplete="off" onChange={(e) => edit({ base_fee: e.target.value }, 'base_fee')} data-testid={`${P}-base-fee-input`} />
        </label>
        {fieldErr('base_fee')}
        <label>Miễn phí từ (đ)
          <input inputMode="numeric" value={f.free_over} autoComplete="off" onChange={(e) => edit({ free_over: e.target.value }, 'free_over')} data-testid={`${P}-free-over-input`} />
        </label>
        <p className="hint">Để trống nếu không miễn phí</p>
        {fieldErr('free_over')}
        <label>Phụ thu vùng xa (đ)
          <input inputMode="numeric" value={f.surcharge} autoComplete="off" onChange={(e) => edit({ surcharge: e.target.value }, 'surcharge')} data-testid={`${P}-surcharge-input`} />
        </label>
        {fieldErr('surcharge')}
        <label htmlFor={`${uid}-city`}>Thành phố phụ thu</label>
        <div className="chips">
          {f.cities.map((c) => <span key={c} className="chip">{c} <button type="button" className="chip-x" aria-label={`Bỏ ${c}`} onClick={() => edit({ cities: f.cities.filter((x) => x !== c) }, 'cities')}>✕</button></span>)}
        </div>
        <div className="pw">
          <input id={`${uid}-city`} value={f.city} autoComplete="off" placeholder="Tên thành phố" onChange={(e) => edit({ city: e.target.value }, 'cities')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCity(); } }} data-testid={`${P}-cities-input`} />
          <button type="button" className="btn" onClick={addCity}>Thêm</button>
        </div>
        {fieldErr('cities')}
      </fieldset>
      {conflict && (
        <div role="alert" className="banner banner-error" data-testid={`${P}-conflict`}>
          Phương thức đã được người khác sửa <button type="button" className="btn" onClick={() => void reload()} data-testid={`${P}-conflict-reload`}>Tải lại dữ liệu</button>
        </div>
      )}
      {formError && <div role="alert" className="field-error" data-testid={`${P}-form-error`}>{formError}</div>}
      {busy && <p className="hint" role="status" data-testid={`${P}-saving`}>Đang lưu...</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose} data-testid={`${P}-cancel`}>Hủy</button>
        <button type="button" className="btn btn-primary tight" disabled={busy || Object.keys(errors).length > 0} onClick={() => void save()} data-testid={`${P}-save`}>Lưu</button>
      </div>
    </Modal>
  );
}

function Methods() {
  const expired = useLoginRedirect();
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'rate'>('loading');
  const [items, setItems] = useState<ShippingMethod[]>([]);
  const [total, setTotal] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [off, setOff] = useState<{ m: ShippingMethod; busy: boolean } | null>(null);
  const [toggling, setToggling] = useState(false);
  const { toast, show } = useToast();
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  const load = useCallback(async (): Promise<ShippingMethod[] | null> => {
    const id = ++seq.current;
    setView((v) => (v === 'ready' ? v : 'loading'));
    const r = await api<{ items: ShippingMethod[]; total: number }>(`/admin/shipping/methods?page=1&limit=${MAX_METHODS}`);
    if (id !== seq.current) return null;
    if (r.status === 200 && Array.isArray(r.body.items)) { setItems(r.body.items); setTotal(typeof r.body.total === 'number' ? r.body.total : r.body.items.length); setView('ready'); return r.body.items; }
    if (expired(r)) return null;
    if (r.status === 403) setView('forbidden');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
    return null;
  }, []); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  /** Bật hoặc tắt (kèm `version`); lỗi hiện bằng toast tự tắt, dòng được làm mới khi dữ liệu đã đổi. */
  const toggle = async (m: ShippingMethod, enable: boolean) => {
    if (toggling) return;
    setToggling(true); setMenu(null);
    const r = await api(`/admin/shipping/methods/${m.id}/${enable ? 'enable' : 'disable'}`, { method: 'POST', body: { version: m.version } });
    setToggling(false); setOff(null);
    if (r.ok) { show({ text: enable ? 'Đã bật phương thức' : 'Đã tắt phương thức', testid: `${P}-toast-state` }); await load(); return; }
    if (expired(r)) return;
    if (r.code === 'method-state-unchanged') { show({ text: 'Phương thức đã ở trạng thái này', testid: `${P}-toast-unchanged`, error: true }); await load(); return; }
    if (r.status === 429) { show({ text: limitedText(r.retryAfter), testid: `${P}-toast-state`, error: true }); return; }
    show({ text: r.code === 'version-conflict' ? 'Phương thức đã được người khác sửa, đã tải lại' : r.status === 403 ? 'Bạn không có quyền thực hiện thao tác này' : 'Không thực hiện được. Thử lại.', testid: `${P}-toast-state`, error: true });
    if (r.status === 409 || r.status === 404) await load();
  };
  const onSaved = () => { setForm(null); show({ text: 'Đã lưu phương thức', testid: `${P}-toast-saved` }); void load(); };
  const reloadOne = async (id: string): Promise<Form | null> => { const list = await load(); const m = list?.find((x) => x.id === id); return m ? fromMethod(m) : null; };

  if (view === 'forbidden') return <Forbidden testid={`${P}-forbidden`} />;
  const full = total >= MAX_METHODS;
  return (
    <main className="wide">
      <div className="between">
        <h1>Phương thức vận chuyển</h1>
        <button type="button" className="btn btn-primary tight" disabled={full || view !== 'ready'} onClick={() => setForm(blank())} data-testid={`${P}-add`}>+ Thêm phương thức</button>
      </div>
      {view === 'ready' && <p className="hint" data-testid={`${P}-count`}>{total} trên {MAX_METHODS} phương thức tối đa</p>}
      {view === 'ready' && full && <p className="hint" data-testid={`${P}-limit-note`}>Đã đủ {MAX_METHODS} phương thức, tắt hoặc sửa phương thức có sẵn</p>}

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được danh sách. <button className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && <div data-testid={`${P}-loading`} aria-busy="true">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {view === 'ready' && items.length === 0 && <p className="hint" data-testid={`${P}-empty`}>Chưa có phương thức vận chuyển nào. Khách chưa thể đặt hàng.</p>}
      {view === 'ready' && items.length > 0 && (
        <div className="table-wrap">
          <table className="stack-table" data-testid={`${P}-table`}>
            <thead><tr><th>Tên</th><th className="num">Phí cơ bản</th><th className="num">Miễn phí từ</th><th className="num">Phụ thu</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} data-testid={`${P}-row`} data-id={m.id}>
                  <td data-label="Tên" data-testid={`${P}-name`}>{m.name}</td>
                  <td data-label="Phí cơ bản" className="num" data-testid={`${P}-base-fee`}>{formatPrice(m.base_fee)}</td>
                  <td data-label="Miễn phí từ" className="num" data-testid={`${P}-free-over`}>{m.rule?.free_over == null ? '—' : formatPrice(m.rule.free_over)}</td>
                  <td data-label="Phụ thu" className="num" data-testid={`${P}-surcharge`}>{m.rule?.surcharge ? `+${formatPrice(m.rule.surcharge)} · ${m.rule.surcharge_cities?.length ?? 0} TP` : '—'}</td>
                  <td data-label="Trạng thái"><span className="badge" data-status={m.is_active ? 'ship-method-on' : 'ship-method-off'} data-testid={`${P}-status`}>{m.is_active ? 'Đang bật' : 'Đã tắt'}</span></td>
                  <td className="menu">
                    <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menu === m.id} aria-label={`Thao tác với ${m.name}`} onClick={() => setMenu(menu === m.id ? null : m.id)} data-testid={`${P}-row-menu`}>⋯</button>
                    {menu === m.id && (
                      <div className="menu-items" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(null)}>
                        <button type="button" role="menuitem" onClick={() => { setMenu(null); setForm(fromMethod(m)); }} data-testid={`${P}-edit`}>Sửa...</button>
                        {m.is_active
                          ? <button type="button" role="menuitem" onClick={() => { setMenu(null); setOff({ m, busy: false }); }} data-testid={`${P}-disable`}>Tắt phương thức...</button>
                          : <button type="button" role="menuitem" disabled={toggling} onClick={() => void toggle(m, true)} data-testid={`${P}-enable`}>Bật phương thức</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && <MethodForm initial={form} onClose={() => setForm(null)} onSaved={onSaved} onReload={reloadOne} />}
      {off && (
        <Modal title="Tắt phương thức" testid={`${P}-disable-confirm`} onClose={() => !toggling && setOff(null)}>
          <p>Tắt {off.m.name}? Khách sẽ không chọn được phương thức này; đơn đã tạo không đổi.</p>
          <div className="actions">
            <button type="button" className="btn" disabled={toggling} onClick={() => setOff(null)} data-testid={`${P}-disable-confirm-no`}>Giữ bật</button>
            <button type="button" className="btn btn-danger tight" disabled={toggling} onClick={() => void toggle(off.m, false)} data-testid={`${P}-disable-confirm-yes`}>Tắt</button>
          </div>
        </Modal>
      )}
      <ToastView toast={toast} />
    </main>
  );
}

function Guard() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Forbidden testid={`${P}-forbidden`} />; // staff, customer không gọi API (server vẫn trả 403)
  return <Methods />;
}

export default function ShippingMethodAdminPage() {
  return <RequireRole roles={['customer', 'staff', 'admin']}><Guard /></RequireRole>;
}
