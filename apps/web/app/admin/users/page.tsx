'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessDenied } from '../../../components/AccessDenied';
import { RequireRole } from '../../../components/RequireRole';
import { api } from '../../../lib/api';
import { ROLE_LABEL, useAuth, type Role } from '../../../lib/auth';

interface Row { id: string; email: string; full_name: string; role: Role; status: 'active' | 'locked'; email_verified: boolean; created_at: string }
interface Page { items: Row[]; page: number; limit: number; total: number }
const LIMIT = 20;
const T = 'auth-admin-user-list';
const STATUS_LABEL = { active: 'Hoạt động', locked: 'Đã khóa' } as const;
const ROLE_ERR: Record<string, string> = { cannot_change_own_role: 'Bạn không thể đổi role của chính mình', role_unchanged: 'Role không thay đổi', last_admin: 'Phải còn ít nhất một quản trị đang hoạt động' };
const LOCK_ERR: Record<string, string> = { cannot_lock_self: 'Bạn không thể khóa chính mình', already_locked: 'Tài khoản đã bị khóa', last_admin: 'Phải còn ít nhất một quản trị đang hoạt động' };

function UserList() {
  const router = useRouter();
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [menu, setMenu] = useState<string | null>(null);
  const [roleDlg, setRoleDlg] = useState<{ row: Row; value: Role; busy: boolean; error?: string } | null>(null);
  const [lockDlg, setLockDlg] = useState<{ row: Row; reason: string; busy: boolean; error?: string } | null>(null);
  const [toast, setToast] = useState<{ kind: 'role' | 'lock'; text: string; error?: boolean } | null>(null);
  const seq = useRef(0);

  // Ô tìm theo tiền tố email, từ 3 ký tự: dưới 3 ký tự thì không gọi tìm (giữ kết quả cũ) và nhắc dưới ô.
  useEffect(() => {
    const t = setTimeout(() => { if (search.length === 0 || search.length >= 3) { setQ(search); setPage(1); } }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView((v) => (v === 'ready' ? v : 'loading'));
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (role) qs.set('role', role);
    if (status) qs.set('status', status);
    if (q) qs.set('q', q);
    const r = await api<Page>(`/admin/users?${qs}`);
    if (id !== seq.current) return; // bỏ kết quả cũ
    if (r.status === 200) { setData(r.body); setView('ready'); }
    else if (r.status === 401 && r.code !== 'session_expired') router.replace('/login?next=%2Fadmin%2Fusers&reason=required');
    else if (r.status === 403) setView('forbidden');
    else if (r.status !== 401) setView('error');
  }, [page, role, status, q, router]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const patchRow = (id: string, p: Partial<Row>) => setData((d) => (d ? { ...d, items: d.items.map((r) => (r.id === id ? { ...r, ...p } : r)) } : d));

  const saveRole = async () => {
    if (!roleDlg) return;
    setRoleDlg({ ...roleDlg, busy: true, error: undefined });
    const r = await api(`/admin/users/${roleDlg.row.id}/role`, { method: 'PATCH', body: { role: roleDlg.value } });
    if (r.status === 200) { patchRow(roleDlg.row.id, { role: roleDlg.value }); setRoleDlg(null); setToast({ kind: 'role', text: 'Đã đổi role' }); return; }
    setRoleDlg({ ...roleDlg, busy: false, error: (r.code && ROLE_ERR[r.code]) || 'Không đổi được role. Thử lại.' });
  };
  const doLock = async () => {
    if (!lockDlg) return;
    setLockDlg({ ...lockDlg, busy: true, error: undefined });
    const r = await api(`/admin/users/${lockDlg.row.id}/lock`, { method: 'POST', body: lockDlg.reason.trim() ? { reason: lockDlg.reason.trim() } : {} });
    if (r.status === 200) { patchRow(lockDlg.row.id, { status: 'locked' }); setLockDlg(null); setToast({ kind: 'lock', text: 'Đã khóa tài khoản' }); return; }
    setLockDlg({ ...lockDlg, busy: false, error: (r.code && LOCK_ERR[r.code]) || 'Không khóa được. Thử lại.' });
  };
  const doUnlock = async (row: Row) => {
    setMenu(null);
    const r = await api(`/admin/users/${row.id}/unlock`, { method: 'POST' });
    if (r.status === 200) { patchRow(row.id, { status: 'active' }); setToast({ kind: 'lock', text: 'Đã mở khóa' }); return; }
    setToast({ kind: 'lock', text: r.code === 'not_locked' ? 'Tài khoản không ở trạng thái khóa' : 'Không mở khóa được. Thử lại.', error: true });
    void load(); // làm mới dòng
  };

  if (view === 'forbidden') return <AccessDenied role={me?.role} />;
  const filtered = !!(q || role || status);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(page * LIMIT, total);
  const tooShort = search.length > 0 && search.length < 3;
  const lockTooLong = (lockDlg?.reason.length ?? 0) > 200;

  return (
    <main className="wide">
      <h1>Người dùng</h1>
      <div className="toolbar">
        <div>
          <input aria-label="Tìm theo email" placeholder="Tìm theo email (từ 3 ký tự)" value={search} onChange={(e) => setSearch(e.target.value)} data-testid={`${T}-search`} />
          {tooShort && <p className="hint" role="status">Nhập ít nhất 3 ký tự để tìm</p>}
        </div>
        <select aria-label="Lọc role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} data-testid={`${T}-role-filter`}>
          <option value="">Mọi role</option>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select aria-label="Lọc trạng thái" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid={`${T}-status-filter`}>
          <option value="">Mọi trạng thái</option><option value="active">Hoạt động</option><option value="locked">Đã khóa</option>
        </select>
      </div>

      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${T}-error`}>Không tải được danh sách. <button className="btn" onClick={() => void load()} data-testid={`${T}-retry`}>Thử lại</button></div>}
      {view === 'loading' && <div data-testid={`${T}-loading`} aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div>}
      {view === 'ready' && data && data.items.length === 0 && (filtered
        ? <div data-testid={`${T}-empty-filtered`}><p>Không có người dùng khớp.</p><button className="btn" onClick={() => { setSearch(''); setQ(''); setRole(''); setStatus(''); setPage(1); }} data-testid={`${T}-clear-filter`}>Xóa lọc</button></div>
        : <p data-testid={`${T}-empty`}>Chưa có người dùng nào.</p>)}
      {view === 'ready' && data && data.items.length > 0 && (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Họ tên</th><th>Email</th><th>Role</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
            <tbody>
              {data.items.map((row) => {
                const self = row.id === me?.id;
                return (
                  <tr key={row.id} data-testid={`${T}-row`}>
                    <td>{row.full_name}</td>
                    <td data-testid={`${T}-email`}>{row.email}</td>
                    <td><span className="badge" data-testid={`${T}-role`}>{ROLE_LABEL[row.role]}</span></td>
                    <td><span className={`badge ${row.status === 'locked' ? 'badge-locked' : ''}`} data-testid={`${T}-status`}>{STATUS_LABEL[row.status]}</span></td>
                    <td style={{ position: 'relative' }}>
                      <button className="btn" aria-haspopup="menu" aria-expanded={menu === row.id} aria-label={`Thao tác với ${row.email}`} onClick={() => setMenu(menu === row.id ? null : row.id)} data-testid={`${T}-row-menu`}>⋯</button>
                      {menu === row.id && (
                        <div className="menu-items" role="menu">
                          <button role="menuitem" disabled={self} onClick={() => { setMenu(null); setRoleDlg({ row, value: row.role, busy: false }); }} data-testid={`${T}-change-role`}>Đổi role</button>
                          {row.status === 'active'
                            ? <button role="menuitem" disabled={self} onClick={() => { setMenu(null); setLockDlg({ row, reason: '', busy: false }); }} data-testid={`${T}-lock`}>Khóa tài khoản</button>
                            : <button role="menuitem" onClick={() => void doUnlock(row)} data-testid={`${T}-unlock`}>Mở khóa</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <div className="pager">
            <span data-testid={`${T}-summary`}>{from} tới {to} trong {total} người</span>
            {pages > 1 && (
              <div data-testid={`${T}-pagination`}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>{' '}
                <span>Trang {page}/{pages}</span>{' '}
                <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
              </div>
            )}
          </div>
        </>
      )}

      {roleDlg && (
        <div className="backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="rd-t">
          <h2 id="rd-t">Đổi role</h2>
          <p>{roleDlg.row.email}</p>
          <label htmlFor="rd-sel">Role mới</label>
          <select id="rd-sel" value={roleDlg.value} onChange={(e) => setRoleDlg({ ...roleDlg, value: e.target.value as Role })} data-testid={`${T}-role-select`}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {roleDlg.error && <p className="field-error" role="alert" data-testid={`${T}-role-error`}>{roleDlg.error}</p>}
          <div className="actions">
            <button className="btn" onClick={() => setRoleDlg(null)} data-testid={`${T}-role-cancel`}>Hủy</button>
            <button className="btn btn-primary" style={{ width: 'auto' }} disabled={roleDlg.busy} onClick={() => void saveRole()} data-testid={`${T}-role-save`}>{roleDlg.busy ? 'Đang lưu...' : 'Lưu'}</button>
          </div>
        </div></div>
      )}
      {lockDlg && (
        <div className="backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ld-t">
          <h2 id="ld-t">Khóa tài khoản</h2>
          <p>{lockDlg.row.email}: mọi phiên đăng nhập bị thu hồi và người này không đăng nhập được cho tới khi mở khóa.</p>
          <label htmlFor="ld-reason">Lý do (tùy chọn, tối đa 200 ký tự)</label>
          <textarea id="ld-reason" rows={3} value={lockDlg.reason} onChange={(e) => setLockDlg({ ...lockDlg, reason: e.target.value })} data-testid={`${T}-lock-reason`} />
          <p className={lockTooLong ? 'field-error' : 'hint'}>{lockDlg.reason.length}/200</p>
          {lockDlg.error && <p className="field-error" role="alert" data-testid={`${T}-lock-error`}>{lockDlg.error}</p>}
          <div className="actions">
            <button className="btn" onClick={() => setLockDlg(null)} data-testid={`${T}-lock-cancel`}>Hủy</button>
            <button className="btn btn-danger" disabled={lockDlg.busy || lockTooLong} onClick={() => void doLock()} data-testid={`${T}-lock-confirm`}>{lockDlg.busy ? 'Đang khóa...' : 'Khóa'}</button>
          </div>
        </div></div>
      )}
      {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status" data-testid={`${T}-toast-${toast.kind}`}>{toast.text}</div>}
    </main>
  );
}

export default function AdminUsersPage() {
  return <RequireRole roles={['admin']}><UserList /></RequireRole>;
}
