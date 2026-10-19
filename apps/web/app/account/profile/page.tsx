'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Avatar } from '../../../components/Avatar';
import { Field, minutesText } from '../../../components/Form';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { SkForm, SkRows } from '../../../components/Skeleton';

interface Profile { id: string; email: string; email_verified: boolean; full_name: string; phone: string | null; avatar_url: string | null; role: string }
const FIELD_MSG: Record<string, Record<string, string>> = {
  full_name: { required: 'Nhập họ tên', too_long: 'Họ tên tối đa 100 ký tự', invalid_format: 'Họ tên có ký tự không hợp lệ' },
  phone: { invalid_phone: 'Nhập số di động Việt Nam (10 chữ số, đầu 03, 05, 07, 08, 09)', invalid_format: 'Số điện thoại không hợp lệ' },
};
const ROLE: Record<string, string> = { customer: 'Khách hàng', staff: 'Nhân viên', sale: 'Bán hàng', admin: 'Quản trị' };
const AVATAR_MSG: Record<string, string> = {
  unsupported_type: 'Chỉ nhận JPG, PNG hoặc WebP', too_large: 'Ảnh quá 2 MB', corrupt: 'Ảnh bị hỏng hoặc quá lớn về kích thước', dimensions_exceeded: 'Ảnh bị hỏng hoặc quá lớn về kích thước', bad_form: 'Không đọc được tệp ảnh',
};

function ProfileView() {
  const router = useRouter();
  const { refresh, user } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'expired'>('loading');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarCode, setAvatarCode] = useState<string | undefined>();
  const limit = useCountdown();
  const file = useRef<HTMLInputElement>(null);

  const fill = (r: Profile) => { setP(r); setName(r.full_name); setPhone(r.phone ?? ''); };
  const toLogin = useCallback(() => { setView('expired'); router.replace('/login?next=%2Faccount%2Fprofile&reason=expired'); }, [router]); // điểm đánh dấu chuyển về đăng nhập; màn đăng nhập mang banner phiên hết hạn
  const load = useCallback(async () => {
    setView('loading');
    const r = await api<Profile>('/me');
    if (r.status === 200) { fill(r.body); setView('ready'); }
    else if (r.status === 401) toLogin();
    else setView('error');
  }, [toLogin]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  const dirty = !!p && (name !== p.full_name || phone !== (p.phone ?? ''));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!p || saving || !dirty) return;
    setSaving(true); setFailed(false); setErrors({});
    const r = await api<Profile>('/me', { method: 'PATCH', body: { full_name: name, phone } });
    setSaving(false);
    if (r.status === 200) { fill(r.body); setToast('Đã lưu hồ sơ'); void refresh(); return; }
    if (r.status === 400) { setErrors(r.fieldErrors); return; }
    if (r.status === 401 && r.code !== 'session_expired') { toLogin(); return; }
    if (r.status === 429) { setFailed(true); return; }
    setFailed(true);
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || uploading || limit.left > 0) return;
    setUploading(true); setAvatarError(null); setAvatarCode(undefined);
    const form = new FormData();
    form.append('file', f);
    const r = await api<{ avatar_url: string }>('/me/avatar', { method: 'PUT', body: form });
    setUploading(false);
    if (r.status === 200) { setP((x) => (x ? { ...x, avatar_url: r.body.avatar_url } : x)); setToast('Đã đổi ảnh đại diện'); return; }
    if (r.status === 429) { limit.start(r.retryAfter); return; }
    if (r.status === 401 && r.code !== 'session_expired') { toLogin(); return; }
    const reason = r.code === 'image-invalid' ? String((r.body as any).reason ?? '') : '';
    setAvatarCode(reason || 'error');
    setAvatarError(AVATAR_MSG[reason] ?? 'Không tải được ảnh. Thử lại.');
  };
  const removeAvatar = async () => {
    setAvatarError(null);
    const r = await api('/me/avatar', { method: 'DELETE' });
    if (r.status === 204) { setP((x) => (x ? { ...x, avatar_url: null } : x)); setToast('Đã xóa ảnh đại diện'); return; }
    setAvatarCode('error'); setAvatarError('Không xóa được ảnh. Thử lại.');
  };

  if (view === 'expired') return <main className="center"><p role="status" data-testid="usr-profile-session-expired">Phiên đã hết hạn, đang chuyển tới đăng nhập...</p></main>;
  if (view === 'loading') return <main className="page auth-page"><section className="panel" data-testid="usr-profile-loading" aria-busy="true"><SkRows n={1} lines={2} /><SkForm n={4} /></section></main>;
  if (view === 'error' || !p) return <main className="page auth-page"><div role="alert" className="banner banner-error" data-testid="usr-profile-error">Không tải được hồ sơ. <button className="btn" data-testid="usr-profile-retry" onClick={() => void load()}>Thử lại</button></div></main>;
  const busy = saving;
  const locked = uploading || limit.left > 0;
  return (
    <main className="page auth-page">
      <div className="page-head">
        <h1>Hồ sơ</h1>
        <div className="actions">
          <Link className="btn btn-sm" href="/account/password" data-testid="usr-profile-password-link"><span className="i i-key" aria-hidden="true" /> Mật khẩu</Link>
          {user?.role === 'customer' && <Link className="btn btn-sm" href="/account/addresses" data-testid="usr-profile-addresses-link"><span className="i i-pin" aria-hidden="true" /> Địa chỉ</Link>}
        </div>
      </div>
      <section className="panel stack">
        <div className="auth-hero" style={{ opacity: uploading ? 0.5 : 1 }}>
          <Avatar name={p.full_name} url={p.avatar_url} size={80} testId="usr-profile-avatar-image" />
          <div className="auth-hero-main">
            <strong className="auth-hero-name">{p.full_name}</strong>
            <span className="muted truncate" data-testid="usr-profile-email">{p.email}</span>
            <span className="row">
              <span className="badge" data-role={p.role}>{ROLE[p.role] ?? p.role}</span>
              <span className={`badge auth-vf ${p.email_verified ? 'ok' : 'wait'}`} data-testid="usr-profile-email-verified">{p.email_verified ? 'Đã xác minh' : 'Chưa xác minh'}</span>
            </span>
          </div>
          <div className="auth-hero-actions">
            <label className="btn btn-sm" aria-disabled={locked} title="JPG, PNG hoặc WebP, tối đa 2 MB">
              <span className="i i-upload" aria-hidden="true" /> Đổi ảnh
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={pick} data-testid="usr-profile-avatar-upload" />
            </label>
            {p.avatar_url && <button type="button" className="btn btn-sm btn-icon auth-ic" aria-label="Xóa ảnh" onClick={() => void removeAvatar()} data-testid="usr-profile-avatar-remove"><span className="i i-trash" aria-hidden="true" /></button>}
          </div>
        </div>
        <p className="hint auth-img-hint">JPG, PNG hoặc WebP, tối đa 2 MB{uploading && <span data-testid="usr-profile-avatar-uploading"> · Đang tải...</span>}</p>
        {avatarError && <p className="field-error" role="alert" data-testid="usr-profile-avatar-error" data-reason={avatarCode}>{avatarError}</p>}
        {limit.left > 0 && <p className="field-error" role="alert" data-testid="usr-profile-avatar-rate-limited">Tải ảnh quá nhiều, chờ {minutesText(limit.left)}.</p>}
        {failed && <div role="alert" className="banner banner-error" data-testid="usr-profile-error">Không lưu được. Thử lại.</div>}
        <form className="auth-form" onSubmit={save} noValidate data-testid="usr-profile-form" aria-busy={busy}>
          <div className="auth-cols">
            <Field label="Họ tên" error={errors.full_name ? FIELD_MSG.full_name[errors.full_name] ?? 'Họ tên không hợp lệ' : undefined} errorTestId="usr-profile-field-error" field="full_name">
              {(id, d) => <input id={id} aria-describedby={d} autoComplete="name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} data-testid="usr-profile-full-name" />}
            </Field>
            <Field label="Điện thoại" error={errors.phone ? FIELD_MSG.phone[errors.phone] ?? 'Số điện thoại không hợp lệ' : undefined} errorTestId="usr-profile-field-error" field="phone">
              {(id, d) => <input id={id} aria-describedby={d} autoComplete="tel" inputMode="tel" placeholder="0901234567" value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value)} data-testid="usr-profile-phone" />}
            </Field>
          </div>
          <div className="auth-actions">
            <button className="btn btn-primary tight" disabled={busy || !dirty} data-testid="usr-profile-save">{busy ? 'Đang lưu...' : 'Lưu'}</button>
          </div>
        </form>
      </section>
      {toast && <div className="toast" role="status" data-testid={toast === 'Đã lưu hồ sơ' ? 'usr-profile-saved' : undefined}>{toast}</div>}
    </main>
  );
}

export default function ProfilePage() {
  return <RequireRole roles={['customer', 'staff', 'sale', 'admin']}><ProfileView /></RequireRole>;
}
