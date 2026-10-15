'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Field } from './Form';
import { useCountdown } from './useCountdown';
import { api, type ApiResult } from '../lib/api';
import { STATUS_LABEL, fromLocalInput, isOverdue, num, parseInt0, toLocalInput, type Coupon } from '../lib/coupon';
import { useLoginRedirect } from '../lib/prd';
import { limitedText } from '../lib/stock';

const MAX = 1_000_000_000, MAX_LIMIT = 1_000_000;
const MSG = {
  code: '4 đến 20 ký tự gồm chữ, số, gạch dưới, gạch ngang', taken: 'Mã này đã được dùng (kể cả mã đã xóa)', pct: 'Phần trăm từ 1 đến 100', fixed: 'Số tiền từ 1 đến 1.000.000.000',
  max: 'Từ 1 đến 1.000.000.000', min: 'Từ 0 đến 1.000.000.000', expires: 'Hạn phải sau thời điểm hiện tại hoặc thiếu hạn', limit: 'Từ 1 đến 1.000.000', perUser: 'Từ 1 đến 1.000.000, hoặc để trống nếu không giới hạn',
};
type Errors = Partial<Record<'code' | 'value' | 'max_discount' | 'min_order_value' | 'expires_at' | 'usage_limit' | 'per_user_limit', string>>;
const FIELD_MSG: Record<string, (type: string) => string> = {
  code: () => MSG.code, value: (t) => (t === 'percentage' ? MSG.pct : MSG.fixed), max_discount: () => MSG.max, min_order_value: () => MSG.min, expires_at: () => MSG.expires, usage_limit: () => MSG.limit, per_user_limit: () => MSG.perUser,
};

/** Biểu mẫu tạo và sửa coupon dùng chung (ui/admin-coupon-edit): loại quyết định ô nào hiện; khi sửa Mã và Loại khóa; coupon Hết hạn hoặc Hết lượt khóa mọi ô và ẩn nút Lưu. */
export function CouponForm({ id }: { id?: string }) {
  const router = useRouter();
  const expired = useLoginRedirect();
  const editing = Boolean(id);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'forbidden' | 'rate'>(editing ? 'loading' : 'ready');
  const [code, setCode] = useState(''), [type, setType] = useState<'percentage' | 'fixed'>('percentage'), [value, setValue] = useState('');
  const [maxDiscount, setMaxDiscount] = useState(''), [minOrder, setMinOrder] = useState('0'), [expiresAt, setExpiresAt] = useState('');
  const [usageLimit, setUsageLimit] = useState(''), [perUser, setPerUser] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<'conflict' | 'not-editable' | 'other' | null>(null);
  const [saving, setSaving] = useState(false);
  const limit = useCountdown();
  const seq = useRef(0), wasLimited = useRef(false);

  const fill = (c: Coupon) => {
    setCoupon(c); setCode(c.code); setType(c.type); setValue(String(c.value)); setMaxDiscount(c.max_discount === null ? '' : String(c.max_discount)); setMinOrder(String(c.min_order_value));
    setExpiresAt(toLocalInput(c.expires_at)); setUsageLimit(String(c.usage_limit)); setPerUser(c.per_user_limit === null ? '' : String(c.per_user_limit));
  };
  const load = useCallback(async () => {
    if (!id) return;
    const mine = ++seq.current;
    setView('loading');
    const r = await api<Coupon>(`/admin/coupons/${encodeURIComponent(id)}`);
    if (mine !== seq.current) return;
    if (r.status === 200 && typeof r.body.id === 'string') { fill(r.body); setView('ready'); setErrors({}); setBanner(null); return; }
    if (expired(r)) return;
    if (r.status === 404) setView('notfound');
    else if (r.status === 403) setView('forbidden');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [id]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const locked = Boolean(coupon && (coupon.status === 'expired' || coupon.status === 'exhausted' || isOverdue(coupon))) || banner === 'not-editable';
  const used = coupon ? coupon.consumed_count + coupon.reserved_count : 0;

  /** Kiểm ở trình duyệt (chỉ để báo sớm; server kiểm lại tất cả, SB-11). Trả `null` khi có lỗi. */
  const validate = () => {
    const e: Errors = {};
    const c = code.trim(), v = parseInt0(value), mx = maxDiscount.trim() === '' ? null : parseInt0(maxDiscount), mn = parseInt0(minOrder), ul = parseInt0(usageLimit), pu = perUser.trim() === '' ? null : parseInt0(perUser);
    const exp = fromLocalInput(expiresAt);
    if (!editing && !/^[A-Za-z0-9_-]{4,20}$/.test(c)) e.code = MSG.code;
    if (v === null || v < 1 || v > (type === 'percentage' ? 100 : MAX)) e.value = type === 'percentage' ? MSG.pct : MSG.fixed;
    if (type === 'percentage' && maxDiscount.trim() !== '' && (mx === null || mx < 1 || mx > MAX)) e.max_discount = MSG.max;
    if (mn === null || mn > MAX) e.min_order_value = MSG.min;
    if (!exp || (!editing && new Date(exp).getTime() <= Date.now())) e.expires_at = MSG.expires;
    if (ul === null || ul < 1 || ul > MAX_LIMIT) e.usage_limit = MSG.limit;
    if (perUser.trim() !== '' && (pu === null || pu < 1 || pu > MAX_LIMIT)) e.per_user_limit = MSG.perUser;
    setErrors(e);
    return Object.keys(e).length ? null : { c, v: v!, mx, mn: mn!, exp: exp!, ul: ul!, pu };
  };

  const fail = (r: ApiResult) => {
    if (r.status === 400 && r.code === 'validation-failed') {
      const e: Errors = {};
      for (const k of Object.keys(r.fieldErrors)) { const f = k as keyof Errors; if (f in FIELD_MSG) e[f] = FIELD_MSG[f](type); }
      setErrors(e); if (!Object.keys(e).length) setBanner('other');
    } else if (r.status === 409 && r.code === 'code_taken') setErrors({ code: MSG.taken });
    else if (r.status === 409 && r.code === 'usage_limit_below_used') setErrors({ usage_limit: `Không nhỏ hơn ${num(Number(r.body?.used ?? used))} (đã dùng cộng đang giữ)` });
    else if (r.status === 409 && r.code === 'version_mismatch') setBanner('conflict');
    else if (r.status === 409 && r.code === 'coupon_not_editable') setBanner('not-editable');
    else if (r.status === 429) { limit.start(r.retryAfter); setBanner('other'); }
    else if (r.status === 404) setView('notfound');
    else setBanner('other');
  };

  const submit = async () => {
    if (saving || locked) return;
    setBanner(null);
    const f = validate();
    if (!f) return;
    setSaving(true);
    // Ô giờ chỉ có phút: không đổi thì KHÔNG gửi `expires_at`, nếu không mỗi lần sửa trường khác sẽ cắt giây của hạn đã lưu (23:59:59 thành 23:59:00).
    const keepExpiry = editing && coupon !== null && expiresAt === toLocalInput(coupon.expires_at);
    const common = { value: f.v, min_order_value: f.mn, ...(keepExpiry ? {} : { expires_at: f.exp }), usage_limit: f.ul, per_user_limit: f.pu, ...(type === 'percentage' ? { max_discount: f.mx } : {}) };
    const r = editing
      ? await api(`/admin/coupons/${encodeURIComponent(id!)}`, { method: 'PATCH', body: { version: coupon!.version, ...common } })
      : await api('/admin/coupons', { method: 'POST', body: { code: f.c, type, ...common } });
    setSaving(false);
    if (r.status === 200 || r.status === 201) { router.push('/admin/coupons'); return; }
    if (expired(r)) return;
    fail(r);
  };

  const row = (label: string, k: keyof Errors, testid: string, input: (id: string, d: string | undefined) => ReactNode, hint?: string): ReactNode => (
    <Field label={label} error={errors[k]} errorTestId={`${testid}-error`} field={k} hint={hint}>{input}</Field>
  );

  if (view === 'loading') return <main className="page page-narrow"><div data-testid="prm-admin-coupon-edit-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></main>;
  if (view === 'notfound') return <main className="page page-narrow"><div className="empty panel" data-testid="prm-admin-coupon-edit-not-found"><span className="tile tile-lg gray"><span className="i i-ticket" aria-hidden="true" /></span><h1>Coupon không còn tồn tại</h1><Link className="btn" href="/admin/coupons">Về coupon</Link></div></main>;
  if (view === 'forbidden') return <main className="page page-narrow"><div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-edit-error">Bạn không có quyền</div></main>;
  if (view === 'rate' && limit.left > 0) return <main className="page page-narrow"><div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-edit-error">{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid="prm-admin-coupon-edit-retry">Thử lại</button></div></main>;
  if (view === 'error' || view === 'rate') return <main className="page page-narrow"><div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-edit-error">Không tải được coupon. <button className="btn" onClick={() => void load()} data-testid="prm-admin-coupon-edit-retry">Thử lại</button></div></main>;

  const off = saving || locked;
  const usedPct = coupon && coupon.usage_limit > 0 ? Math.min(100, Math.round((used / coupon.usage_limit) * 100)) : 0;
  return (
    <main className="page page-narrow">
      <Link href="/admin/coupons" className="back"><span className="i i-left" aria-hidden="true" /> Coupon</Link>
      <div className="page-head">
        <h1>{editing ? <span className="ip-code">{coupon?.code}</span> : 'Tạo coupon'}</h1>
        {coupon && <span className="badge" data-status={coupon.status} data-testid="prm-admin-coupon-edit-status-badge">{STATUS_LABEL[coupon.status]}</span>}
      </div>
      {coupon && (
        <div className="panel ip-sum" style={{ marginBottom: '1rem' }}>
          <p className="small muted" data-testid="prm-admin-coupon-edit-usage-summary">Đã dùng {num(coupon.consumed_count)} · Đang giữ {num(coupon.reserved_count)} · Còn lại {num(coupon.remaining)} / {num(coupon.usage_limit)}</p>
          <span className="ip-bar" data-lv={coupon.status === 'exhausted' ? 'out' : 'brand'} aria-hidden="true"><i style={{ width: `${usedPct}%` }} /></span>
        </div>
      )}
      {locked && <div className="banner banner-info" data-testid="prm-admin-coupon-edit-not-editable">Hết hạn hoặc hết lượt: không sửa được</div>}
      {banner === 'conflict' && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-edit-conflict-error">Coupon vừa được người khác sửa. <button className="btn" onClick={() => void load()}>Tải lại</button></div>}
      {banner === 'other' && <div role="alert" className="banner banner-error">{limit.left > 0 ? limitedText(limit.left) : 'Không lưu được, thử lại.'}</div>}

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="panel">
        <div className="ip-grid2">
          {row('Mã *', 'code', 'prm-admin-coupon-edit-code', (fid, d) => (
            <input id={fid} aria-describedby={d} value={code} maxLength={20} disabled={off || editing} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="prm-admin-coupon-edit-code" />
          ))}
          <div className="field">
            <label htmlFor="prm-type">Loại *</label>
            <select id="prm-type" value={type} disabled={off || editing} onChange={(e) => { setType(e.target.value as 'percentage' | 'fixed'); setErrors((x) => ({ ...x, value: undefined, max_discount: undefined })); }} data-testid="prm-admin-coupon-edit-type">
              <option value="percentage">Phần trăm</option><option value="fixed">Số tiền cố định</option>
            </select>
          </div>
          {row(`Giá trị * (${type === 'percentage' ? '%' : 'đ'})`, 'value', 'prm-admin-coupon-edit-value', (fid, d) => (
            <input id={fid} aria-describedby={d} inputMode="numeric" value={value} disabled={off} onChange={(e) => setValue(e.target.value)} data-testid="prm-admin-coupon-edit-value" />
          ))}
          {type === 'percentage' && row('Giảm tối đa (đ)', 'max_discount', 'prm-admin-coupon-edit-max-discount', (fid, d) => (
            <input id={fid} aria-describedby={d} inputMode="numeric" placeholder="Không trần" value={maxDiscount} disabled={off} onChange={(e) => setMaxDiscount(e.target.value)} data-testid="prm-admin-coupon-edit-max-discount" />
          ))}
          {row('Đơn tối thiểu (đ)', 'min_order_value', 'prm-admin-coupon-edit-min-order', (fid, d) => (
            <input id={fid} aria-describedby={d} inputMode="numeric" value={minOrder} disabled={off} onChange={(e) => setMinOrder(e.target.value)} data-testid="prm-admin-coupon-edit-min-order" />
          ))}
          {row('Hết hạn * (giờ VN)', 'expires_at', 'prm-admin-coupon-edit-expires-at', (fid, d) => (
            <input id={fid} aria-describedby={d} type="datetime-local" value={expiresAt} disabled={off} onChange={(e) => setExpiresAt(e.target.value)} data-testid="prm-admin-coupon-edit-expires-at" />
          ))}
          {row('Tổng lượt *', 'usage_limit', 'prm-admin-coupon-edit-usage-limit', (fid, d) => (
            <input id={fid} aria-describedby={d} inputMode="numeric" value={usageLimit} disabled={off} onChange={(e) => setUsageLimit(e.target.value)} data-testid="prm-admin-coupon-edit-usage-limit" />
          ))}
          {row('Lượt mỗi người', 'per_user_limit', 'prm-admin-coupon-edit-per-user-limit', (fid, d) => (
            <input id={fid} aria-describedby={d} inputMode="numeric" placeholder="Không giới hạn" value={perUser} disabled={off} onChange={(e) => setPerUser(e.target.value)} data-testid="prm-admin-coupon-edit-per-user-limit" />
          ))}
        </div>
        <div className="form-actions sticky-save ip-formfoot">
          <button type="button" className="btn tight" onClick={() => router.push('/admin/coupons')} data-testid="prm-admin-coupon-edit-cancel">Hủy</button>
          {!locked && <button type="submit" className="btn btn-primary tight" disabled={saving} data-testid="prm-admin-coupon-edit-save">{saving ? 'Đang lưu...' : 'Lưu'}</button>}
        </div>
      </form>
    </main>
  );
}
