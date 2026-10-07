'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, PasswordInput, minutesText } from '../../components/Form';
import { api } from '../../lib/api';

const MSG: Record<string, Record<string, string>> = {
  email: { required: 'Nhập email', invalid_format: 'Email không đúng định dạng', too_long: 'Email dài tối đa 254 ký tự' },
  password: { required: 'Nhập mật khẩu', too_short: 'Mật khẩu cần từ 10 ký tự', too_long: 'Mật khẩu dài tối đa 128 ký tự', too_common: 'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác', same_as_email: 'Mật khẩu không được trùng email', invalid_format: 'Mật khẩu không hợp lệ' },
  full_name: { required: 'Nhập họ tên', too_long: 'Họ tên dài tối đa 100 ký tự', invalid_format: 'Họ tên không hợp lệ' },
};
const text = (field: string, code?: string) => (code ? MSG[field]?.[code] ?? 'Giá trị không hợp lệ' : undefined);

export default function RegisterPage() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'limited' | 'error'>('idle');
  const [retry, setRetry] = useState<number>();

  // Hết giờ chờ (Retry-After) thì mở khóa nút lại: giao diện không giữ trạng thái "bị giới hạn" mãi (AUTH-REQ BR giới hạn tần suất, ui "nút khóa tới hết giờ").
  useEffect(() => {
    if (state !== 'limited') return;
    const t = setTimeout(() => setState('idle'), (retry ?? 60) * 1000);
    return () => clearTimeout(t);
  }, [state, retry]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending'); setErrors({});
    const r = await api('/auth/register', { method: 'POST', body: form });
    if (r.status === 202) { setState('done'); return; }
    if (r.status === 400) { setErrors(r.fieldErrors); setForm((f) => ({ ...f, password: '' })); setState('idle'); return; } // giữ nội dung đã nhập trừ mật khẩu
    if (r.status === 429) { setRetry(r.retryAfter); setState('limited'); return; }
    setState('error');
  };

  if (state === 'done') {
    return (
      <main className="center"><section className="card">
        <div role="status" className="banner banner-ok" data-testid="auth-register-success">Chúng tôi đã nhận đăng ký. Hãy kiểm tra email để xác minh rồi đăng nhập.</div>
        <Link className="btn btn-primary" href="/login" data-testid="auth-register-login-link">Đăng nhập</Link>
      </section></main>
    );
  }
  const busy = state === 'sending';
  return (
    <main className="center"><section className="card">
      <h1>Đăng ký tài khoản</h1>
      {state === 'limited' && <div role="alert" className="banner banner-error" data-testid="auth-register-rate-limited">Bạn thử quá nhiều lần, thử lại sau {minutesText(retry)}.</div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="auth-register-error">Không tạo được tài khoản. Thử lại. <button type="button" className="btn" onClick={(e) => void submit(e as unknown as FormEvent)} data-testid="auth-register-retry">Thử lại</button></div>}
      <form onSubmit={submit} noValidate data-testid="auth-register-form" aria-busy={busy}>
        <Field label="Họ tên" error={text('full_name', errors.full_name)} errorTestId="auth-register-field-error" field="full_name">
          {(id, d) => <input id={id} aria-describedby={d} autoComplete="name" value={form.full_name} disabled={busy} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="auth-register-full-name" />}
        </Field>
        <Field label="Email" error={text('email', errors.email)} errorTestId="auth-register-field-error" field="email">
          {(id, d) => <input id={id} aria-describedby={d} type="email" autoComplete="email" value={form.email} disabled={busy} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="auth-register-email" />}
        </Field>
        <Field label="Mật khẩu" error={text('password', errors.password)} errorTestId="auth-register-field-error" field="password" hint="Từ 10 đến 128 ký tự">
          {(id, d) => <PasswordInput id={id} describedBy={d} autoComplete="new-password" value={form.password} disabled={busy} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="auth-register-password" toggleTestId="auth-register-password-toggle" />}
        </Field>
        <button className="btn btn-primary" disabled={busy || state === 'limited'} data-testid="auth-register-submit">{busy ? 'Đang tạo...' : 'Tạo tài khoản'}</button>
        {busy && <span className="hint" data-testid="auth-register-loading"> Đang gửi...</span>}
      </form>
      <p className="row-link"><span>Đã có tài khoản?</span><Link href="/login" data-testid="auth-register-login-link">Đăng nhập</Link></p>
    </section></main>
  );
}
