'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, minutesText } from '../../components/Form';
import { api } from '../../lib/api';

const SENT = 'Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'limited' | 'error'>('idle');
  const [retry, setRetry] = useState<number>();

  // Hết giờ chờ (Retry-After) thì mở khóa nút lại: giao diện không giữ trạng thái "bị giới hạn" mãi (AUTH-REQ BR giới hạn tần suất, ui "nút khóa tới hết giờ").
  useEffect(() => {
    if (state !== 'limited') return;
    const t = setTimeout(() => setState('idle'), (retry ?? 60) * 1000);
    return () => clearTimeout(t);
  }, [state, retry]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (state === 'sending') return;
    // chỉ kiểm định dạng, không bao giờ nói email có tài khoản hay không (SB-02)
    if (!EMAIL_RE.test(email.trim())) { setFieldError(email.trim() ? 'Email không đúng định dạng' : 'Nhập email'); return; }
    setFieldError(undefined); setState('sending');
    const r = await api('/auth/password/forgot', { method: 'POST', body: { email } });
    if (r.status === 202) setState('sent');
    else if (r.status === 400) { setFieldError('Email không đúng định dạng'); setState('idle'); }
    else if (r.status === 429) { setRetry(r.retryAfter); setState('limited'); }
    else setState('error');
  };

  if (state === 'sent') {
    return (
      <main className="center"><section className="card auth-card">
        <div role="status" className="auth-done" data-testid="auth-forgot-password-sent">
          <span className="tile tile-lg green"><span className="i i-mail" aria-hidden="true" /></span>
          <strong>Đã gửi email</strong>
          <span className="muted">{SENT}</span>
        </div>
        <p className="auth-alt"><Link href="/login" data-testid="auth-forgot-password-login-link"><span className="i i-left" aria-hidden="true" /> Đăng nhập</Link></p>
      </section></main>
    );
  }
  const busy = state === 'sending';
  return (
    <main className="center"><section className="card auth-card">
      <span className="auth-logo" aria-hidden="true">E</span>
      <h1>Quên mật khẩu</h1>
      {state === 'limited' && <div role="alert" className="banner banner-error" data-testid="auth-forgot-password-rate-limited">Thử quá nhiều lần, chờ {minutesText(retry)}.</div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="auth-forgot-password-error">Không gửi được. <button type="button" className="btn" onClick={() => void submit()} data-testid="auth-forgot-password-retry">Thử lại</button></div>}
      <form className="auth-form" onSubmit={submit} noValidate data-testid="auth-forgot-password-form" aria-busy={busy}>
        <Field label="Email" error={fieldError} errorTestId="auth-forgot-password-field-error" field="email">
          {(id, d) => <input id={id} aria-describedby={d} type="email" autoComplete="email" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} data-testid="auth-forgot-password-email" />}
        </Field>
        <button className="btn btn-primary" disabled={busy || state === 'limited'} data-testid="auth-forgot-password-submit">{busy ? 'Đang gửi...' : 'Gửi hướng dẫn'}</button>
        {busy && <span className="sr-only" role="status" data-testid="auth-forgot-password-loading">Đang gửi...</span>}
      </form>
      <p className="auth-alt"><Link href="/login" data-testid="auth-forgot-password-login-link"><span className="i i-left" aria-hidden="true" /> Đăng nhập</Link></p>
    </section></main>
  );
}
