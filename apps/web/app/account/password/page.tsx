'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, PasswordInput, minutesText } from '../../../components/Form';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const MSG: Record<string, Record<string, string>> = {
  current_password: { incorrect: 'Mật khẩu hiện tại không đúng', required: 'Nhập mật khẩu hiện tại' },
  new_password: {
    too_short: 'Mật khẩu mới tối thiểu 10 ký tự', too_long: 'Mật khẩu mới tối đa 128 ký tự', same_as_email: 'Mật khẩu mới không được trùng email',
    too_common: 'Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác', same_as_current: 'Mật khẩu mới phải khác mật khẩu hiện tại', required: 'Nhập mật khẩu mới',
  },
};

function ChangePassword() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'error' | 'ok'>('idle');
  const [revoked, setRevoked] = useState(0);
  const limit = useCountdown(); // hết giờ chờ thì nút mở lại, banner mất (không giữ khóa mãi)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (state === 'sending' || limit.left > 0) return;
    setState('sending'); setErrors({});
    const r = await api<{ revoked_sessions: number }>('/me/password', { method: 'PUT', body: { current_password: current, new_password: next } });
    if (r.status === 200) { setRevoked(r.body.revoked_sessions); setCurrent(''); setNext(''); setState('ok'); void refresh(); return; }
    setState('idle');
    if (r.status === 400) { setErrors(r.fieldErrors); if (r.fieldErrors.current_password) setCurrent(''); if (r.fieldErrors.new_password) setNext(''); return; }
    if (r.status === 429) { limit.start(r.retryAfter); return; }
    if (r.status === 401 && r.code !== 'session_expired') { router.replace('/login?next=%2Faccount%2Fpassword&reason=expired'); return; }
    setState('error');
  };

  const busy = state === 'sending';
  const text = (f: string) => (errors[f] ? MSG[f]?.[errors[f]] ?? 'Giá trị không hợp lệ' : undefined);
  return (
    <main className="page auth-page auth-page-sm">
      <Link className="back" href="/account/profile" data-testid="usr-change-password-back"><span className="i i-left" aria-hidden="true" /> Hồ sơ</Link>
      <div className="page-head"><h1>Đổi mật khẩu</h1></div>
      <section className="panel">
      {state === 'ok' && <div role="status" className="banner banner-ok" data-testid="usr-change-password-success">Đã đổi mật khẩu{revoked > 0 ? `, đăng xuất ${revoked} thiết bị khác` : ''}.</div>}
      {limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="usr-change-password-rate-limited">Nhập sai quá nhiều, chờ {minutesText(limit.left)}.</div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="usr-change-password-error">Không đổi được mật khẩu. <button type="button" className="btn" onClick={() => void submit()} data-testid="usr-change-password-retry">Thử lại</button></div>}
      <form className="auth-form" onSubmit={submit} noValidate data-testid="usr-change-password-form" aria-busy={busy}>
        <Field label="Mật khẩu hiện tại" error={text('current_password')} errorTestId="usr-change-password-field-error" field="current_password">
          {(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="current-password" value={current} disabled={busy} onChange={(e) => setCurrent(e.target.value)} data-testid="usr-change-password-current" />}
        </Field>
        <Field label="Mật khẩu mới" error={text('new_password')} errorTestId="usr-change-password-field-error" field="new_password" hint="10–128 ký tự, khác mật khẩu hiện tại">
          {(id, d) => <PasswordInput id={id} describedBy={d} autoComplete="new-password" value={next} disabled={busy} onChange={(e) => setNext(e.target.value)} data-testid="usr-change-password-new" toggleTestId="usr-change-password-toggle" />}
        </Field>
        <button className="btn btn-primary" disabled={busy || limit.left > 0} data-testid="usr-change-password-submit">{busy ? 'Đang đổi...' : 'Đổi mật khẩu'}</button>
        {busy && <span className="sr-only" role="status" data-testid="usr-change-password-loading">Đang gửi...</span>}
      </form>
      </section>
    </main>
  );
}

export default function ChangePasswordPage() {
  return <RequireRole roles={['customer', 'staff', 'sale', 'admin']}><ChangePassword /></RequireRole>;
}
