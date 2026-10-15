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
import { useQueryGo } from '../../../components/useQueryGo';

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
  const go = useQueryGo('/admin/coupons'); // cộng dồn các lần đổi liền nhau (REV-REV-12)
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

  const pctUsed = (c: Coupon) => (c.usage_limit > 0 ? Math.min(100, Math.round(((c.consumed_count + c.reserved_count) / c.usage_limit) * 100)) : 0);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Coupon</h1>
        <div className="actions"><Link className="btn btn-primary tight" href="/admin/coupons/new" data-testid="prm-admin-coupon-list-create">Tạo mã</Link></div>
      </div>
      <div className="toolbar">
        <select value={status} aria-label="Trạng thái" onChange={(e) => go({ status: e.target.value || null })} data-testid="prm-admin-coupon-list-status-filter">
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="ip-search">
          <span className="i i-search" aria-hidden="true" />
          <input type="search" value={search} maxLength={20} placeholder="Mã bắt đầu bằng…" aria-label="Tìm mã bắt đầu bằng"
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go({ q: search.trim().slice(0, 20) || null })} data-testid="prm-admin-coupon-list-search" />
        </div>
        {filtering && !emptyAll && <button type="button" className="btn btn-ghost tight" onClick={clear} data-testid="prm-admin-coupon-list-clear-filter"><span className="i i-x" aria-hidden="true" /> Xóa lọc</button>}
      </div>

      {toggleError && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-toggle-error">{toggleError}</div>}
      {view === 'forbidden' && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-error">Bạn không có quyền xem trang này</div>}
      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-error">{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid="prm-admin-coupon-list-retry">Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="prm-admin-coupon-list-error">Không tải được coupon. <button className="btn" onClick={() => void load()} data-testid="prm-admin-coupon-list-retry">Thử lại</button></div>}
      {view === 'loading' && !data && <div data-testid="prm-admin-coupon-list-loading" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div className="empty panel" data-testid="prm-admin-coupon-list-empty-filtered"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có kết quả</strong><button type="button" className="btn" onClick={clear} data-testid="prm-admin-coupon-list-clear-filter">Xóa lọc</button></div>
        : <div className="empty panel" data-testid="prm-admin-coupon-list-empty"><span className="tile tile-lg gray"><span className="i i-ticket" aria-hidden="true" /></span><strong>Chưa có coupon</strong><Link className="btn btn-primary tight" href="/admin/coupons/new"><span className="i i-plus" aria-hidden="true" /> Tạo mã</Link></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? 'prm-admin-coupon-list-loading' : undefined}>
            <table className="stack-table ip-table">
              <thead><tr><th>Mã</th><th>Giảm</th><th>Đã dùng</th><th>Hết hạn</th><th>Trạng thái</th><th><span className="ip-lbl">Thao tác</span></th></tr></thead>
              <tbody>
                {items.map((c) => {
                  const closed = c.status === 'expired' || c.status === 'exhausted';
                  const tone = c.status === 'active' ? 'green' : c.status === 'disabled' ? 'gray' : c.status === 'expired' ? 'amber' : 'red';
                  return (
                    <tr key={c.id} className="row-click" data-testid="prm-admin-coupon-list-row" data-id={c.id} onClick={() => router.push(`/admin/coupons/${c.id}`)}>
                      <td data-label="Mã"><span className="ip-name"><span className={`tile ${tone}`}><span className="i i-ticket" aria-hidden="true" /></span><span className="ip-code" data-testid="prm-admin-coupon-list-code">{c.code}</span></span></td>
                      <td data-label="Giảm"><span className="ip-val" data-testid="prm-admin-coupon-list-discount">{describeDiscount(c)}</span></td>
                      <td data-label="Đã dùng">
                        <span className="ip-usage"><span className="small" data-testid="prm-admin-coupon-list-usage">{`${num(c.consumed_count + c.reserved_count)}/${num(c.usage_limit)} (còn ${num(c.remaining)})`}</span><span className="ip-bar" data-lv={c.status === 'exhausted' ? 'out' : 'brand'} aria-hidden="true"><i style={{ width: `${pctUsed(c)}%` }} /></span></span>
                      </td>
                      <td data-label="Hết hạn"><span data-testid="prm-admin-coupon-list-expires-at">{formatVn(c.expires_at)}</span></td>
                      <td data-label="Trạng thái">
                        <span className="badge" data-status={c.status} data-testid="prm-admin-coupon-list-status-badge">{STATUS_LABEL[c.status]}</span>
                        {isOverdue(c) && <span className="ip-late"> quá hạn</span>}
                      </td>
                      <td data-label="" onClick={(e) => e.stopPropagation()}>
                        <span className="ip-acts">
                          <Link className="btn btn-ghost btn-icon ip-act" href={`/admin/coupons/${c.id}`} title={closed ? 'Xem' : 'Sửa'} data-testid="prm-admin-coupon-list-edit"><span className="ip-lbl">{closed ? 'Xem' : 'Sửa'}</span></Link>
                          {!closed && <button className="btn btn-ghost btn-icon ip-act" disabled={busy !== null} title={c.status === 'active' ? 'Tắt' : 'Bật'} onClick={() => void toggle(c)} data-testid="prm-admin-coupon-list-toggle"><span className={`i i-${c.status === 'active' ? 'ban' : 'okc'}`} aria-hidden="true" /><span className="ip-lbl">{c.status === 'active' ? 'Tắt' : 'Bật'}</span></button>}
                          <button className="btn btn-ghost btn-icon ip-act" style={{ color: 'var(--danger)' }} title="Xóa" onClick={() => setDel({ coupon: c, busy: false, error: null })} data-testid="prm-admin-coupon-list-delete"><span className="ip-lbl">Xóa</span></button>
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
            <div className="dlg-head"><span className="tile red"><span className="i i-trash" aria-hidden="true" /></span><h2 id="prm-del-title">Xóa {del.coupon.code}?</h2></div>
            <p>Không thể khôi phục.</p>
            {del.error && <p className="field-error" role="alert" data-testid="prm-admin-coupon-list-delete-error">{del.error}</p>}
            <div className="actions">
              <button className="btn" disabled={del.busy} onClick={() => setDel(null)} data-testid="prm-admin-coupon-list-delete-cancel">Hủy</button>
              <button className="btn btn-danger tight" disabled={del.busy} onClick={() => void confirmDelete()} data-testid="prm-admin-coupon-list-delete-confirm">{del.busy ? 'Đang xóa...' : 'Xóa'}</button>
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
