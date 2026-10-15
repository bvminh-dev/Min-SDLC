'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, secondsText } from '../../../components/Form';
import { CustomerCard, type Customer } from '../../../components/CustomerCard';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/; // cùng dạng với server (USR-REQ-20261006-101004117 BR1); chỉ để khỏi gọi khi rõ ràng sai

function Lookup() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const [state, setState] = useState<'idle' | 'searching' | 'notfound' | 'error'>('idle');
  const [result, setResult] = useState<Customer | null>(null);
  const limit = useCountdown(); // hết giờ chờ thì nút mở lại, banner mất

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (state === 'searching' || limit.left > 0) return;
    const q = email.trim();
    if (!EMAIL_SHAPE.test(q)) { setFieldError(true); return; } // không gọi máy chủ
    setFieldError(false); setState('searching');
    const r = await api<Customer>(`/admin/customers?email=${encodeURIComponent(q)}`);
    if (r.status === 200) { setResult(r.body); setState('idle'); return; }
    setResult(null);
    if (r.status === 404) { setState('notfound'); return; }
    if (r.status === 429) { limit.start(r.retryAfter); setState('idle'); return; }
    if (r.status === 400) { setFieldError(true); setState('idle'); return; }
    if (r.status === 401 && r.code !== 'session_expired') { router.replace('/login?next=%2Fadmin%2Fcustomers&reason=expired'); return; }
    setState('error');
  };

  const busy = state === 'searching';
  const role = user?.role === 'admin' ? 'admin' : 'staff';
  return (
    <main className="page page-mid">
      <div className="page-head"><h1>Tra cứu khách</h1></div>
      {limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="usr-customer-lookup-rate-limited">Tra cứu quá nhanh, thử lại sau {secondsText(limit.left)}.</div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="usr-customer-lookup-error">Không tra cứu được. <button type="button" className="btn" onClick={() => void submit()} data-testid="usr-customer-lookup-retry">Thử lại</button></div>}
      <div className="panel ip-lookup">
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <div className="ip-search">
            <span className="i i-mail" aria-hidden="true" />
            <Field label="Email khách" error={fieldError ? 'Nhập email đầy đủ' : undefined} errorTestId="usr-customer-lookup-field-error" field="email">
              {(id, d) => <input id={id} aria-describedby={d} type="text" placeholder="an@shop.vn" value={email} disabled={busy} autoComplete="off" onChange={(e) => setEmail(e.target.value)} data-testid="usr-customer-lookup-email" />}
            </Field>
          </div>
          <button className="btn btn-primary tight" disabled={busy || limit.left > 0} data-testid="usr-customer-lookup-submit"><span className="i i-search" aria-hidden="true" /> {busy ? 'Đang tìm...' : 'Tìm'}</button>
        </form>
      </div>
      {busy && <div className="skeleton" style={{ marginTop: '1rem', height: '7rem' }} data-testid="usr-customer-lookup-loading" />}
      {state === 'notfound' && <div className="empty panel" style={{ marginTop: '1rem' }} data-testid="usr-customer-lookup-not-found"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có khách này</strong></div>}
      {result && !busy && <CustomerCard c={result} role={role} />}
    </main>
  );
}

export default function CustomerLookupPage() {
  return <RequireRole roles={['staff', 'admin']}><Lookup /></RequireRole>;
}
