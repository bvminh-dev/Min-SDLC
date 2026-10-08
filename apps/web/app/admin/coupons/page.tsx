'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Pager } from '../../../components/Pager';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { FILTERS, STATUS_LABEL, describeDiscount, formatVn, isOverdue, num, type Coupon, type CouponStatus } from '../../../lib/coupon';
import { useLoginRedirect } from '../../../lib/prd';
import { limitedText } from '../../../lib/stock';

interface Result { items: Coupon[]; page: number; limit: number; total: number }
const LIMIT = 20;
const TOGGLE_ERRORS: Record<string, string> = { coupon_expired: 'Coupon đã hết hạn', coupon_exhausted: 'Coupon đã hết lượt', invalid_transition: 'Trạng thái đã đổi, đã tải lại' };

function CouponList() {
  const router = useRouter();
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = (sp.get('status') ?? '') as CouponStatus | '';
  const q = (sp.get('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(status || q);

  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'rate'>('loading');
  const [search, setSearch] = useState(q);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<{ coupon: Coupon; busy: boolean; error: string | null } | null>(null);
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  useEffect(() => { setSearch(q); }, [q]);
  const go = useCallback((change: Record<string, string | null>, keepPage = false) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(change)) { if (v) n.set(k, v); else n.delete(k); }
    if (!keepPage) n.delete('page');
    const s = n.toString();
    router.push(s ? `/admin/coupons?${s}` : '/admin/coupons', { scroll: false });
  }, [sp, router]);
  // Gõ rồi chờ 300 ms (hoặc Enter) mới tìm; tiền tố tối đa 20 ký tự.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => go({ q: search.trim().slice(0, 20) || null }), 300);
    return () => clearTimeout(t);
  }, [search, q, go]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    if (q) qs.set('q', q);
    const r = await api<Result>(`/admin/coupons?${qs}`);
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 403) setView('forbidden');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
  }, [page, status, q]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  // Hết giờ chờ (429) thì tự tải lại; nút Thử lại cũng dùng được ngay (trạng thái có thời hạn có đường thoát).
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const toggle = async (c: Coupon) => {
    if (busy) return;
    setBusy(c.id); setToggleError(null);
    const r = await api(`/admin/coupons/${c.id}/${c.status === 'active' ? 'disable' : 'enable'}`, { method: 'POST' });
    setBusy(null);
    if (r.status === 200) { await load(); return; }
    if (expired(r)) return;
    setToggleError(r.status === 429 ? limitedText(r.retryAfter) : r.status === 404 ? 'Coupon không còn tồn tại' : r.status === 409 && r.code && TOGGLE_ERRORS[r.code] ? TOGGLE_ERRORS[r.code] : 'Không thực hiện được, thử lại.');
    if (r.status === 409 || r.status === 404) await load();
  };
  const confirmDelete = async () => {
    if (!del || del.busy) return;
    setDel({ ...del, busy: true, error: null });
    const r = await api(`/admin/coupons/${del.coupon.id}`, { method: 'DELETE' });
    if (r.status === 204) {
      setDel(null);
      if (page > 1 && (data?.items.length ?? 0) <= 1) go({ page: page - 1 > 1 ? String(page - 1) : null }, true); else await load();
      return;
    }
    if (expired(r)) return;
    setDel({ coupon: del.coupon, busy: false, error: r.status === 404 ? 'Coupon không còn tồn tại' : r.status === 429 ? limitedText(r.retryAfter) : 'Không xóa được, thử lại.' });
    if (r.status === 404) void load();
  };

  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const clear = () => router.push('/admin/coupons', { scroll: false });

  return (
    <main className="wide">
      <div className="between">
        <h1>Coupon</h1>
        <Link className="btn btn-primary tight" href="/admin/coupons/new" data-testid="prm-admin-coupon-list-create">+ Tạo coupon</Link>
      </div>
      <div className="toolbar">
        <select value={status} aria-label="Trạng thái" onChange={(e) => go({ status: e.target.value || null })} data-testid="prm-admin-coupon-list-status-filter">
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="search" value={search} maxLength={20} placeholder="Tìm mã bắt đầu bằng..." aria-label="Tìm mã bắt đầu bằng"
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ q: search.trim().slice(0, 20) || null })} data-testid="prm-admin-coupon-list-search" />
        {filtering && !emptyAll && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid="prm-admin-coupon-list-clear-filter">Xóa bộ lọc</button>}
      </div>

      {toggleError && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-toggle-error">{toggleError}</div>}
      {view === 'forbidden' && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-error">Bạn không có quyền xem trang này</div>}
      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-error">{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid="prm-admin-coupon-list-retry">Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-error">Không tải được danh sách coupon. <button className="btn" onClick={() => void load()} data-testid="prm-admin-coupon-list-retry">Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid="prm-admin-coupon-list-loading" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div data-testid="prm-admin-coupon-list-empty-filtered"><p>Không có coupon phù hợp.</p><button type="button" className="btn" onClick={clear} data-testid="prm-admin-coupon-list-clear-filter">Xóa bộ lọc</button></div>
        : <div data-testid="prm-admin-coupon-list-empty"><p>Chưa có coupon nào.</p><Link className="btn" href="/admin/coupons/new">Tạo coupon</Link></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? 'prm-admin-coupon-list-loading' : undefined}>
            <table className="stack-table">
              <thead><tr><th>Mã</th><th>Giảm</th><th>Hết hạn</th><th className="num">Lượt dùng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
              <tbody>
                {items.map((c) => {
                  const closed = c.status === 'expired' || c.status === 'exhausted';
                  return (
                    <tr key={c.id} className="row-click" data-testid="prm-admin-coupon-list-row" data-id={c.id} onClick={() => router.push(`/admin/coupons/${c.id}`)}>
                      <td data-label="Mã" className="mono" data-testid="prm-admin-coupon-list-code">{c.code}</td>
                      <td data-label="Giảm" data-testid="prm-admin-coupon-list-discount">{describeDiscount(c)}</td>
                      <td data-label="Hết hạn" data-testid="prm-admin-coupon-list-expires-at">{formatVn(c.expires_at)}</td>
                      <td data-label="Lượt dùng" className="num" data-testid="prm-admin-coupon-list-usage">{`${num(c.consumed_count + c.reserved_count)}/${num(c.usage_limit)} (còn ${num(c.remaining)})`}</td>
                      <td data-label="Trạng thái">
                        <span className="badge" data-status={c.status} data-testid="prm-admin-coupon-list-status-badge">{STATUS_LABEL[c.status]}</span>
                        {isOverdue(c) && <span className="hint"> quá hạn</span>}
                      </td>
                      <td data-label="Thao tác" onClick={(e) => e.stopPropagation()}>
                        <span className="actions-row">
                          <Link className="btn tight" href={`/admin/coupons/${c.id}`} data-testid="prm-admin-coupon-list-edit">{closed ? 'Xem' : 'Sửa'}</Link>
                          {!closed && <button className="btn tight" disabled={busy !== null} onClick={() => void toggle(c)} data-testid="prm-admin-coupon-list-toggle">{c.status === 'active' ? 'Tắt' : 'Bật'}</button>}
                          <button className="btn btn-danger-soft tight" onClick={() => setDel({ coupon: c, busy: false, error: null })} data-testid="prm-admin-coupon-list-delete">Xóa</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager testPrefix="prm-admin-coupon-list" unit="coupon" page={data.page ?? page} limit={data.limit ?? LIMIT} total={data.total} shown={items.length} onPage={(p) => go({ page: p > 1 ? String(p) : null }, true)} />
        </>
      )}

      {del && (
        <div className="backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="prm-del-title" onKeyDown={(e) => e.key === 'Escape' && !del.busy && setDel(null)}>
            <h2 id="prm-del-title">Xóa coupon {del.coupon.code}?</h2>
            <p>Mã không còn dùng được và không thể khôi phục.</p>
            {del.error && <p className="field-error" role="alert" data-testid="prm-admin-coupon-list-delete-error">{del.error}</p>}
            <div className="actions">
              <button className="btn" disabled={del.busy} onClick={() => setDel(null)} data-testid="prm-admin-coupon-list-delete-cancel">Hủy</button>
              <button className="btn btn-danger-soft tight" disabled={del.busy} onClick={() => void confirmDelete()} data-testid="prm-admin-coupon-list-delete-confirm">{del.busy ? 'Đang xóa...' : 'Xóa'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function CouponListPage() {
  return <RequireRole roles={['admin']}><Suspense fallback={null}><CouponList /></Suspense></RequireRole>;
}
