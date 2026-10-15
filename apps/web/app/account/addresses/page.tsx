'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { RequireRole } from '../../../components/RequireRole';
import { addressLine } from '../../../components/CustomerCard';
import { api } from '../../../lib/api';

interface Address { id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; is_default: boolean }
const LIMIT = 10;
const TOASTS: Record<string, string> = { added: 'Đã thêm địa chỉ', saved: 'Đã lưu địa chỉ' };

function AddressList() {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<Address[]>([]);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'expired'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ a: Address; busy: boolean; error?: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; testId?: string; error?: boolean } | null>(() => (TOASTS[params.get('toast') ?? ''] ? { text: TOASTS[params.get('toast')!] } : null));
  const [bannerError, setBannerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ items: Address[] }>('/me/addresses');
    if (r.status === 200) { setItems(r.body.items); setView('ready'); }
    else if (r.status === 401 && r.code !== 'session_expired') { setView('expired'); router.replace('/login?next=%2Faccount%2Faddresses&reason=expired'); }
    else if (r.status !== 401) setView('error');
  }, [router]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  const failText = (r: { status: number; retryAfter?: number }) => (r.status === 429 ? `Bạn thao tác quá nhanh, thử lại sau ${r.retryAfter ?? 60} giây.` : 'Không thực hiện được. Thử lại.');
  const setDefault = async (a: Address) => {
    setBusyId(a.id); setBannerError(null);
    const r = await api(`/me/addresses/${a.id}`, { method: 'PATCH', body: { is_default: true } });
    setBusyId(null);
    if (r.status === 200) { setItems((xs) => xs.map((x) => ({ ...x, is_default: x.id === a.id })).sort((x, y) => Number(y.is_default) - Number(x.is_default))); setToast({ text: 'Đã đặt làm mặc định', testId: 'usr-address-list-default-toast' }); return; }
    if (r.status === 404) { setToast({ text: 'Địa chỉ này không còn tồn tại', testId: 'usr-address-list-not-found', error: true }); void load(); return; }
    setBannerError(failText(r));
  };
  const doDelete = async () => {
    if (!confirm) return;
    setConfirm({ ...confirm, busy: true, error: undefined });
    const r = await api(`/me/addresses/${confirm.a.id}`, { method: 'DELETE' });
    if (r.status === 204) { setConfirm(null); setToast({ text: 'Đã xóa địa chỉ', testId: 'usr-address-list-deleted-toast' }); void load(); return; }
    if (r.status === 404) { setConfirm(null); setToast({ text: 'Địa chỉ này không còn tồn tại', testId: 'usr-address-list-not-found', error: true }); void load(); return; }
    setConfirm({ ...confirm, busy: false, error: failText(r) });
  };

  if (view === 'expired') return <main className="center"><p role="status" data-testid="usr-address-list-session-expired">Phiên đã hết hạn, đang chuyển tới đăng nhập...</p></main>;
  if (view === 'loading') return <main className="page page-mid"><section className="auth-addr-grid" data-testid="usr-address-list-loading" aria-busy="true"><div className="skeleton auth-sk" /><div className="skeleton auth-sk" /></section></main>;
  if (view === 'error') return <main className="page page-mid"><div role="alert" className="banner banner-error" data-testid="usr-address-list-error">Không tải được sổ địa chỉ. <button className="btn" data-testid="usr-address-list-retry" onClick={() => { setView('loading'); void load(); }}>Thử lại</button></div></main>;
  const full = items.length >= LIMIT;
  return (
    <main className="page page-mid">
      <Link className="back" href="/account/profile"><span className="i i-left" aria-hidden="true" /> Hồ sơ</Link>
      <div className="page-head">
        <h1>Sổ địa chỉ</h1>
        <div className="actions">
          {full
            ? <button className="btn btn-sm" disabled aria-disabled="true" data-testid="usr-address-list-add">Thêm địa chỉ</button>
            : <Link className="btn btn-sm btn-primary tight" href="/account/addresses/new" data-testid="usr-address-list-add">Thêm địa chỉ</Link>}
        </div>
      </div>
      {full && <div role="status" className="banner banner-info" data-testid="usr-address-list-limit-notice">Đủ {LIMIT} địa chỉ, xóa bớt để thêm.</div>}
      {bannerError && <div role="alert" className="banner banner-error" data-testid="usr-address-list-error">{bannerError}</div>}
      {items.length === 0 && <div className="empty panel" data-testid="usr-address-list-empty"><span className="tile tile-lg gray"><span className="i i-pin" aria-hidden="true" /></span><strong>Chưa có địa chỉ</strong></div>}
      <ul className="auth-addr-grid">
        {items.map((a) => (
          <li key={a.id} className={`auth-addr${a.is_default ? ' is-default' : ''}`} data-testid="usr-address-list-row" data-id={a.id}>
            <div className="auth-addr-top">
              <span className={`tile ${a.is_default ? '' : 'gray'}`}><span className="i i-pin" aria-hidden="true" /></span>
              <strong className="auth-addr-who" data-testid="usr-address-list-receiver">{a.receiver} · {a.phone}</strong>
              {a.is_default && <span className="badge" data-status="active" data-testid="usr-address-list-default-badge">Mặc định</span>}
            </div>
            <p className="auth-addr-text" data-testid="usr-address-list-text">{addressLine(a)}</p>
            <div className="auth-addr-actions">
              {!a.is_default && <button className="btn btn-sm auth-ic" disabled={busyId === a.id} onClick={() => void setDefault(a)} data-testid="usr-address-list-set-default"><span className="i i-check" aria-hidden="true" /> {busyId === a.id ? 'Đang lưu...' : 'Đặt mặc định'}</button>}
              <span className="auth-addr-icons">
                <Link className="btn btn-sm btn-ghost btn-icon auth-ic" href={`/account/addresses/edit?id=${a.id}`} aria-label="Sửa" data-testid="usr-address-list-edit"><span className="i i-pencil" aria-hidden="true" /></Link>
                <button className="btn btn-sm btn-ghost btn-icon auth-ic auth-danger" aria-label="Xóa" onClick={() => setConfirm({ a, busy: false })} data-testid="usr-address-list-delete"><span className="i i-trash" aria-hidden="true" /></button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {confirm && (
        <div className="backdrop" onClick={() => !confirm.busy && setConfirm(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !confirm.busy && setConfirm(null)}>
            <div className="dlg-head"><span className="tile red"><span className="i i-trash" aria-hidden="true" /></span><h2 id="del-title">Xóa địa chỉ?</h2></div>
            <p className="truncate">{confirm.a.receiver}, {confirm.a.line1}</p>
            {confirm.error && <p className="field-error" role="alert" data-testid="usr-address-list-delete-error">{confirm.error}</p>}
            <div className="actions">
              <button className="btn" disabled={confirm.busy} onClick={() => setConfirm(null)} data-testid="usr-address-list-delete-cancel">Giữ lại</button>
              <button className="btn btn-danger auth-ic" disabled={confirm.busy} onClick={() => void doDelete()} data-testid="usr-address-list-delete-confirm"><span className="i i-trash" aria-hidden="true" /> {confirm.busy ? 'Đang xóa...' : 'Xóa'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast${toast.error ? ' toast-error' : ''}`} role="status" data-testid={toast.testId}>{toast.text}</div>}
    </main>
  );
}

export default function AddressesPage() {
  return <RequireRole roles={['customer']}><Suspense fallback={null}><AddressList /></Suspense></RequireRole>;
}
