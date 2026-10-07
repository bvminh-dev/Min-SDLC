'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Field, PasswordInput, minutesText } from '../../components/Form';
import { api } from '../../lib/api';

const MSG: Record<string, string> = {
  required: 'Nhập mật khẩu mới', too_short: 'Mật khẩu cần từ 10 ký tự', too_long: 'Mật khẩu dài tối đa 128 ký tự',
  too_common: 'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác', same_as_email: 'Mật khẩu không được trùng email', invalid_format: 'Mật khẩu không hợp lệ',
};

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useRef<string | null>(null); // chỉ trong bộ nhớ trang, không localStorage hay cookie (SB-28)
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [state, setState] = useState<'idle' | 'sending' | 'invalid' | 'limited' | 'error'>('idle');
  const [retry, setRetry] = useState<number>();

  useEffect(() => {
    const m = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
    token.current = m ? decodeURIComponent(m[1]) : null;
    if (m) window.history.replaceState(null, '', window.location.pathname + window.location.search); // xóa token khỏi thanh địa chỉ
    if (!token.current) setState('invalid');
    setReady(true);
  }, []);

  // Hết giờ chờ (Retry-After) thì mở khóa nút lại: giao diện không giữ trạng thái "bị giới hạn" mãi (AUTH-REQ BR giới hạn tần suất, ui "nút khóa tới hết giờ").
  useEffect(() => {
    if (state !== 'limited') return;
    const t = setTimeout(() => setState('idle'), (retry ?? 60) * 1000);
    return () => clearTimeout(t);
  }, [state, retry]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (state === 'sending' || !token.current) return;
    setState('sending'); setFieldError(undefined);
    const r = await api('/auth/password/reset', { method: 'POST', body: { token: token.current, new_password: password } });
    if (r.status === 200) { router.replace('/login?reset=ok'); return; } // không tự đăng nhập; mọi phiên cũ đã bị thu hồi
    if (r.status === 400 && r.code === 'invalid_or_expired_token') { setState('invalid'); return; }
    if (r.status === 400) { setFieldError(MSG[r.fieldErrors.new_password] ?? 'Mật khẩu không hợp lệ'); setState('idle'); return; } // token chưa bị dùng, sửa và gửi lại
    if (r.status === 429) { setRetry(r.retryAfter); setState('limited'); return; }
    setState('error'); // token vẫn giữ trong bộ nhớ trang
  };

  if (!ready) return <main className="center"><p>Đang tải...</p></main>;
  if (state === 'invalid') {
    return (
      <main className="center"><section className="card" data-testid="auth-reset-password-invalid-link">
        <h1>Liên kết không còn hiệu lực</h1>
        <Link className="btn btn-primary" href="/forgot-password" data-testid="auth-reset-password-request-new">Yêu cầu liên kết mới</Link>
      </section></main>
    );
  }
  const busy = state === 'sending';
  return (
    <main className="center"><section className="card">
      <h1>Đặt mật khẩu mới</h1>
      {state === 'limited' && <div role="alert" className="banner banner-error" data-testid="auth-reset-password-rate-limited">Bạn thử quá nhiều lần, thử lại sau {minutesText(retry)}.</div>}
      {state === 'error' && <div role="alert" className="banner banner-error" data-testid="auth-reset-password-error">Không đặt lại được. Thử lại. <button type="button" className="btn" onClick={() => void submit()} data-testid="auth-reset-password-retry">Thử lại</button></div>}
      <form onSubmit={submit} noValidate data-testid="auth-reset-password-form" aria-busy={busy}>
        <Field label="Mật khẩu mới" error={fieldError} errorTestId="auth-reset-password-field-error" field="new_password" hint="Từ 10 đến 128 ký tự, không phải mật khẩu phổ biến">
          {(id, d) => <PasswordInput id={id} describedBy={d} autoComplete="new-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} data-testid="auth-reset-password-new-password" toggleTestId="auth-reset-password-toggle" />}
        </Field>
        <button className="btn btn-primary" disabled={busy || state === 'limited'} data-testid="auth-reset-password-submit">{busy ? 'Đang lưu...' : 'Đặt mật khẩu mới'}</button>
        {busy && <span className="hint" data-testid="auth-reset-password-loading"> Đang lưu...</span>}
      </form>
    </section></main>
  );
}
