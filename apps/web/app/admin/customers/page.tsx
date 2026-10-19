'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, secondsText } from '../../../components/Form';
import { Pager } from '../../../components/Pager';
import { CustomerCard, type Customer } from '../../../components/CustomerCard';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { SkRows } from '../../../components/Skeleton';

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
      {busy && <SkRows n={1} lines={3} style={{ marginTop: '1rem' }} testid="usr-customer-lookup-loading" />}
      {state === 'notfound' && <div className="empty panel" style={{ marginTop: '1rem' }} data-testid="usr-customer-lookup-not-found"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có khách này</strong></div>}
      {result && !busy && <CustomerCard c={result} role={role} />}
    </main>
  );
}

// Admin: danh sách khách, gõ một phần email, tên hoặc điện thoại là lọc ngay (debounce 300ms), 20 khách mỗi trang.
function List() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Customer[]; total: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await api<{ items: Customer[]; total: number; limit: number }>(`/admin/customers/search?q=${encodeURIComponent(q.trim())}&page=${page}`);
      if (stale) return;
      if (r.status === 200) { setData(r.body); setError(false); } else if (r.status !== 401) setError(true);
      setLoading(false);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [q, page]);
  const items = data?.items ?? [];
  return (
    <main className="page page-mid">
      <div className="page-head"><h1>Khách hàng</h1></div>
      {error && <div role="alert" className="banner banner-error" data-testid="usr-customer-list-error">Không tải được danh sách.</div>}
      <div className="panel ip-lookup">
        <div className="ip-search">
          <span className="i i-search" aria-hidden="true" />
          <input type="search" aria-label="Lọc khách" placeholder="Lọc theo email, tên hoặc điện thoại" value={q} autoComplete="off" onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="usr-customer-list-filter" />
        </div>
      </div>
      {loading ? <SkRows n={5} style={{ marginTop: '1rem' }} role="status" aria-label="Đang tải" testid="usr-customer-list-loading" />
        : items.length === 0 ? <div className="empty panel" style={{ marginTop: '1rem' }} data-testid="usr-customer-list-empty"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có khách nào khớp</strong></div>
        : (
          <>
            <div className="ip-rows" data-testid="usr-customer-list">
              <div className="ip-row ip-row-head" aria-hidden="true"><span>Khách hàng</span><span>Email</span><span>Điện thoại</span><span>Ngày tạo</span><span>Trạng thái</span></div>
              {items.map((c) => (
                <Link key={c.id} href={`/admin/customers/${c.id}`} className="panel ip-row" data-testid="usr-customer-list-row">
                  <span className="ip-name"><span className="tile"><span className="i i-user" aria-hidden="true" /></span><b>{c.full_name}</b></span>
                  <span className="ip-wrap">{c.email}</span>
                  <span className="muted">{c.phone ?? '—'}</span>
                  <span className="muted">{new Date(c.created_at).toLocaleDateString('vi-VN')}</span>
                  <span className={`badge${c.status === 'locked' ? ' badge-locked' : ''}`} data-status={c.status === 'locked' ? undefined : 'active'}>{c.status === 'locked' ? 'Đã khóa' : 'Hoạt động'}</span>
                </Link>
              ))}
            </div>
            <Pager testPrefix="usr-customer-list" page={page} limit={data?.limit ?? 20} total={data?.total ?? 0} shown={items.length} unit="khách" onPage={setPage} />
          </>
        )}
    </main>
  );
}

function Page() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <List /> : <Lookup />; // staff chỉ tra theo email chính xác (bản che), không duyệt danh sách
}

export default function CustomerLookupPage() {
  return <RequireRole roles={['staff', 'admin']}><Page /></RequireRole>;
}
