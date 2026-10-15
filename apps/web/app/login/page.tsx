'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Field, PasswordInput, secondsText } from '../../components/Form';
import { api } from '../../lib/api';
import { homeFor, useAuth, type User } from '../../lib/auth';
import { safeNext } from '../../lib/safe-next';

const CREDENTIALS = 'Sai email hoặc mật khẩu, hoặc tài khoản đang bị khóa tạm.';

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const next = safeNext(params.get('next'));
  const reason = params.get('reason');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'credentials' | 'limited' | 'error'>('idle');
  const [missing, setMissing] = useState<{ email?: string; password?: string }>({});
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
    const miss = { email: email.trim() ? undefined : 'Nhập email', password: password ? undefined : 'Nhập mật khẩu' };
    setMissing(miss);
    if (miss.email || miss.password) return;
    setState('sending');
    const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    if (r.status === 200) {
      await refresh();
      router.replace(next ?? homeFor(r.body.user.role)); // `next` chỉ là đường dẫn nội bộ (SB-28); khác thì về trang mặc định theo role
      return;
    }
    setPassword(''); // email giữ lại, mật khẩu xóa
    if (r.status === 401) setState('credentials');
    else if (r.status === 429) { setRetry(r.retryAfter); setState('limited'); }
    else setState('error');
  };

  const busy = state === 'sending';
  return (
    <main className="center"><section className="card auth-card">
      <span className="auth-logo" aria-hidden="true">E</span>
      <h1>Đăng nhập</h1>
      {params.get('reset') === 'ok' && <div role="status" className="banner banner-ok">Đã đổi mật khẩu</div>}
      {reason === 'expired' && <div role="status" className="banner banner-info" data-testid="auth-login-session-expired">Phiên đã hết hạn</div>}
      {reason === 'required' && <div role="status" className="banner banner-info" data-testid="auth-login-login-required">Đăng nhập để tiếp tục</div>}
      {state === 'limited' && <div role="alert" className="banner banner-error" data-testid="auth-login-rate-limited">Thử quá nhiều lần, chờ {secondsText(retry)}.</div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="auth-login-error">Không đăng nhập được. <button type="button" className="btn" onClick={() => void submit()} data-testid="auth-login-retry">Thử lại</button></div>}
      <form className="auth-form" onSubmit={submit} noValidate data-testid="auth-login-form" aria-busy={busy}>
        <Field label="Email" error={missing.email} errorTestId="auth-login-field-error" field="email">
          {(id, d) => <input id={id} aria-describedby={d} type="email" autoComplete="username" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} data-testid="auth-login-email" />}
        </Field>
        <Field label="Mật khẩu" error={missing.password} errorTestId="auth-login-field-error" field="password">
          {(id, d) => <PasswordInput id={id} describedBy={d} autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} data-testid="auth-login-password" toggleTestId="auth-login-password-toggle" />}
        </Field>
        {state === 'credentials' && <p className="field-error" role="alert" data-testid="auth-login-credentials-error">{CREDENTIALS}</p>}
        <p className="auth-forgot"><Link href="/forgot-password" data-testid="auth-login-forgot-link">Quên mật khẩu?</Link></p>
        <button className="btn btn-primary" disabled={busy || state === 'limited'} data-testid="auth-login-submit">{busy ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
        {busy && <span className="sr-only" role="status" data-testid="auth-login-loading">Đang gửi...</span>}
      </form>
      <p className="auth-alt"><span>Chưa có tài khoản?</span><Link href="/register" data-testid="auth-login-register-link">Đăng ký</Link></p>
    </section></main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
