'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccessDenied } from '../../../../components/AccessDenied';
import { CustomerCard, type Customer } from '../../../../components/CustomerCard';
import { RequireRole } from '../../../../components/RequireRole';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { SkRows } from '../../../../components/Skeleton';

// Mở thẻ khách bằng đường dẫn có `id`: chỉ admin (USR-REQ-20261006-101004117 BR1). Staff nhận 403 từ máy chủ, giao diện chuyển tới màn không có quyền.
function ById() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'forbidden' | 'error'>('loading');
  const [c, setC] = useState<Customer | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await api<Customer>(`/admin/customers/${encodeURIComponent(id)}`);
      if (r.status === 200) { setC(r.body); setView('ready'); }
      else if (r.status === 404) setView('notfound');
      else if (r.status === 403) setView('forbidden');
      else if (r.status === 401 && r.code !== 'session_expired') router.replace(`/login?next=${encodeURIComponent(`/admin/customers/${id}`)}&reason=expired`);
      else if (r.status !== 401) setView('error');
    })();
  }, [id, router]);
  if (view === 'forbidden') return <AccessDenied role={user?.role} />;
  return (
    <main className="page page-mid">
      <Link href="/admin/customers" className="back"><span className="i i-left" aria-hidden="true" /> Khách hàng</Link>
      <div className="page-head"><h1>Hồ sơ khách</h1></div>
      {view === 'loading' && <SkRows n={1} lines={3} testid="usr-customer-lookup-loading" />}
      {view === 'notfound' && <div className="empty panel" data-testid="usr-customer-lookup-not-found"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có khách này</strong></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="usr-customer-lookup-error">Không tra cứu được.</div>}
      {view === 'ready' && c && <CustomerCard c={c} role="admin" />}
    </main>
  );
}

export default function CustomerByIdPage() {
  return <RequireRole roles={['staff', 'admin']}><ById /></RequireRole>;
}
