'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '../../../components/Form';
import { api } from '../../../lib/api';

interface Address { id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; is_default: boolean }
const LABEL: Record<string, string> = { receiver: 'Nhập người nhận', phone: 'Nhập số điện thoại', line1: 'Nhập số nhà, đường', ward: 'Nhập phường, xã', city: 'Nhập tỉnh, thành phố' };
const MSG: Record<string, string> = { too_long: 'Quá dài', invalid_phone: 'Nhập số di động Việt Nam (10 chữ số, đầu 03, 05, 07, 08, 09)', invalid_format: 'Có ký tự không hợp lệ' };
const EMPTY = { receiver: '', phone: '', line1: '', ward: '', district: '', city: '' };

/** Thêm (id rỗng) hoặc sửa địa chỉ: một màn dùng chung (ui/address-form). Phần tử testid theo spec/testids.md. */
export function AddressForm({ id }: { id?: string }) {
  const router = useRouter();
  const [v, setV] = useState(EMPTY);
  const [isDefault, setIsDefault] = useState(false);
  const [lockDefault, setLockDefault] = useState(false);
  const [first, setFirst] = useState(false);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'limit' | 'error'>('idle');
  const [errText, setErrText] = useState('Không lưu được địa chỉ. Thử lại.');

  useEffect(() => {
    void (async () => {
      const r = await api<{ items: Address[] }>('/me/addresses');
      if (r.status === 401 && r.code !== 'session_expired') { router.replace('/login?reason=expired'); return; }
      if (r.status === 200) {
        if (id) {
          const a = r.body.items.find((x) => x.id === id);
          if (!a) setNotFound(true);
          else { setV({ receiver: a.receiver, phone: a.phone, line1: a.line1, ward: a.ward, district: a.district ?? '', city: a.city }); setIsDefault(a.is_default); setLockDefault(a.is_default); }
        } else if (r.body.items.length === 0) { setFirst(true); setIsDefault(true); setLockDefault(true); }
      }
      setReady(true);
    })();
  }, [id, router]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (state === 'sending' || notFound) return;
    const miss: Record<string, string> = {};
    for (const k of ['receiver', 'phone', 'line1', 'ward', 'city'] as const) if (!v[k].trim()) miss[k] = 'required';
    if (Object.keys(miss).length) { setErrors(miss); return; }
    setState('sending'); setErrors({});
    const body = { ...v, district: v.district.trim() || null, ...(lockDefault ? {} : { is_default: isDefault }) };
    const r = id ? await api(`/me/addresses/${id}`, { method: 'PATCH', body }) : await api('/me/addresses', { method: 'POST', body });
    if (r.status === 200 || r.status === 201) { router.push(`/account/addresses?toast=${id ? 'saved' : 'added'}`); return; }
    setState('idle');
    if (r.status === 400) { setErrors(r.fieldErrors); return; }
    if (r.status === 409) { setState('limit'); return; }
    if (r.status === 404) { setNotFound(true); return; }
    if (r.status === 401 && r.code !== 'session_expired') { router.replace('/login?reason=expired'); return; }
    setErrText(r.status === 429 ? `Bạn thao tác quá nhanh, thử lại sau ${r.retryAfter ?? 60} giây.` : 'Không lưu được địa chỉ. Thử lại.');
    setState('error');
  };

  if (!ready) return <main className="page auth-page auth-page-sm"><section className="panel" data-testid="usr-address-form-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></section></main>;
  const busy = state === 'sending';
  const err = (k: string) => (errors[k] ? (errors[k] === 'required' ? LABEL[k] ?? 'Bắt buộc' : MSG[errors[k]] ?? 'Giá trị không hợp lệ') : undefined);
  const input = (k: keyof typeof EMPTY, label: string, extra: Record<string, string> = {}) => (
    <Field label={label} error={err(k)} errorTestId="usr-address-form-field-error" field={k}>
      {(fid, d) => <input id={fid} aria-describedby={d} value={v[k]} disabled={busy || notFound} onChange={set(k)} data-testid={`usr-address-form-${k}`} {...extra} />}
    </Field>
  );
  return (
    <main className="page auth-page auth-page-sm">
      <Link className="back" href="/account/addresses"><span className="i i-left" aria-hidden="true" /> Sổ địa chỉ</Link>
      <div className="page-head"><h1>{id ? 'Sửa địa chỉ' : 'Thêm địa chỉ'}</h1></div>
      <section className="panel">
      {notFound && <div role="alert" className="banner banner-error" data-testid="usr-address-form-not-found">Địa chỉ không còn tồn tại. <Link href="/account/addresses">Về sổ địa chỉ</Link></div>}
      {state === 'limit' && <div role="alert" className="banner banner-info" data-testid="usr-address-form-limit-reached">Đủ 10 địa chỉ, xóa bớt để thêm. <Link href="/account/addresses">Về sổ địa chỉ</Link></div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="usr-address-form-error">{errText} <button type="button" className="btn" onClick={() => void submit()} data-testid="usr-address-form-retry">Thử lại</button></div>}
      <form className="auth-form" onSubmit={submit} noValidate data-testid="usr-address-form-form" aria-busy={busy}>
        <div className="auth-cols">
          {input('receiver', 'Người nhận', { autoComplete: 'name' })}
          {input('phone', 'Điện thoại', { autoComplete: 'tel', inputMode: 'tel', placeholder: '0901234567' })}
        </div>
        {input('line1', 'Số nhà, đường', { autoComplete: 'address-line1' })}
        <div className="auth-cols auth-cols-3">
          {input('ward', 'Phường, xã')}
          {input('district', 'Quận, huyện', { placeholder: 'Không bắt buộc' })}
          {input('city', 'Tỉnh, thành phố')}
        </div>
        <label className="auth-check">
          <input type="checkbox" checked={isDefault} disabled={busy || lockDefault || notFound} onChange={(e) => setIsDefault(e.target.checked)} data-testid="usr-address-form-default" /> Đặt làm mặc định
        </label>
        {lockDefault && <p className="hint" data-testid="usr-address-form-default-locked">{first ? 'Địa chỉ đầu tiên luôn là mặc định' : 'Đổi mặc định bằng cách chọn địa chỉ khác'}</p>}
        <div className="auth-actions">
          <Link className="btn" href="/account/addresses" data-testid="usr-address-form-cancel">Hủy</Link>
          <button className="btn btn-primary tight" disabled={busy || notFound} data-testid="usr-address-form-submit">{busy ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
        {busy && <span className="sr-only" role="status" data-testid="usr-address-form-loading">Đang lưu...</span>}
      </form>
      </section>
    </main>
  );
}
