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
  if (view === 'loading') return <main className="center"><section className="card" data-testid="usr-address-list-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></section></main>;
  if (view === 'error') return <main className="center"><div role="alert" className="banner banner-error" data-testid="usr-address-list-error">Không tải được sổ địa chỉ. <button className="btn" data-testid="usr-address-list-retry" onClick={() => { setView('loading'); void load(); }}>Thử lại</button></div></main>;
  const full = items.length >= LIMIT;
  return (
    <main className="center"><section className="card" style={{ maxWidth: '40rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Sổ địa chỉ</h1>
        {full
          ? <button className="btn" disabled aria-disabled="true" data-testid="usr-address-list-add">+ Thêm địa chỉ</button>
          : <Link className="btn" href="/account/addresses/new" data-testid="usr-address-list-add">{items.length === 0 ? 'Thêm địa chỉ đầu tiên' : '+ Thêm địa chỉ'}</Link>}
      </div>
      {full && <div role="status" className="banner banner-info" data-testid="usr-address-list-limit-notice">Bạn đã có {LIMIT} địa chỉ, xóa bớt để thêm mới</div>}
      {bannerError && <div role="alert" className="banner banner-error" data-testid="usr-address-list-error">{bannerError}</div>}
      {items.length === 0 && <p data-testid="usr-address-list-empty">Bạn chưa có địa chỉ nào.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((a) => (
          <li key={a.id} data-testid="usr-address-list-row" data-id={a.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '.75rem 1rem', marginBottom: '.75rem' }}>
            <p style={{ margin: 0 }}><strong data-testid="usr-address-list-receiver">{a.receiver} · {a.phone}</strong>{a.is_default && <> <span className="chip" data-testid="usr-address-list-default-badge">Mặc định</span></>}</p>
            <p style={{ margin: '.25rem 0' }} data-testid="usr-address-list-text">{addressLine(a)}</p>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {!a.is_default && <button className="btn btn-quiet" disabled={busyId === a.id} onClick={() => void setDefault(a)} data-testid="usr-address-list-set-default">{busyId === a.id ? 'Đang lưu...' : 'Đặt làm mặc định'}</button>}
              <Link className="btn btn-quiet" href={`/account/addresses/edit?id=${a.id}`} data-testid="usr-address-list-edit">Sửa</Link>
              <button className="btn btn-quiet" onClick={() => setConfirm({ a, busy: false })} data-testid="usr-address-list-delete">Xóa</button>
            </div>
          </li>
        ))}
      </ul>
      <p className="row-link"><Link href="/account/profile">‹ Hồ sơ của tôi</Link></p>
      {confirm && (
        <div className="backdrop" onClick={() => !confirm.busy && setConfirm(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !confirm.busy && setConfirm(null)}>
            <h2 id="del-title">Xóa địa chỉ này?</h2>
            <p>{confirm.a.receiver}, {confirm.a.line1}. Các đơn đã đặt không đổi.</p>
            {confirm.error && <p className="field-error" role="alert" data-testid="usr-address-list-delete-error">{confirm.error}</p>}
            <div className="actions">
              <button className="btn" disabled={confirm.busy} onClick={() => setConfirm(null)} data-testid="usr-address-list-delete-cancel">Giữ lại</button>
              <button className="btn btn-danger" disabled={confirm.busy} onClick={() => void doDelete()} data-testid="usr-address-list-delete-confirm">{confirm.busy ? 'Đang xóa...' : 'Xóa'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast${toast.error ? ' toast-error' : ''}`} role="status" data-testid={toast.testId}>{toast.text}</div>}
    </section></main>
  );
}

export default function AddressesPage() {
  return <RequireRole roles={['customer']}><Suspense fallback={null}><AddressList /></Suspense></RequireRole>;
}
