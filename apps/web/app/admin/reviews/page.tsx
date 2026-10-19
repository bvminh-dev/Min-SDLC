'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ImageStrip, ReviewPager, ReviewStatusBadge, RevDialog, Spin, Stars, useQueryGo } from '../../../components/ReviewParts';
import { RequireRole } from '../../../components/RequireRole';
import { ToastView, useToast } from '../../../components/ShipmentParts';
import { api, type ApiResult } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useLoginRedirect } from '../../../lib/prd';
import { REASON_MAX, REVIEW_STATUSES, UUID_RE, codePoints, reviewStatusText, type AdminReview, type AdminReviewList } from '../../../lib/review';
import { SkRows } from '../../../components/Skeleton';

const LIMIT = 20;
const P = 'rev-admin-moderation';
const BASE = '/admin/reviews';
type Kind = 'approve' | 'reject' | 'hide' | 'unhide' | 'delete';
const DONE: Record<Kind, string> = { approve: 'Đã duyệt đánh giá', reject: 'Đã từ chối đánh giá', hide: 'Đã ẩn đánh giá', unhide: 'Đã bỏ ẩn đánh giá', delete: 'Đã xóa đánh giá' };
const TITLE: Record<'reject' | 'hide' | 'delete', string> = { reject: 'Từ chối đánh giá', hide: 'Ẩn đánh giá', delete: 'Xóa đánh giá' };
const CONFIRM: Record<'reject' | 'hide', string> = { reject: 'Từ chối', hide: 'Ẩn' };
interface ActErr { text: string; reload?: boolean }

/**
 * Kiểm duyệt đánh giá (ui/admin-moderation): chỉ admin. Hàng đợi chờ duyệt (mặc định) và các tab đã đăng, bị từ chối, bị ẩn; bộ lọc `status`, `product_id`, `rating`, `page` nằm trên URL.
 * Nút theo trạng thái: Duyệt, Từ chối (chờ duyệt); Ẩn (đã đăng); Bỏ ẩn (bị ẩn); Xóa (mọi dòng). Hộp thoại có ô lý do không đóng khi bấm ra ngoài; mọi nút khóa trong lúc gọi API.
 */
function ModerationInner() {
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = REVIEW_STATUSES.find((s) => s === sp.get('status')) ?? 'pending';
  const productId = UUID_RE.test(sp.get('product_id') ?? '') ? (sp.get('product_id') as string) : '';
  const rating = ['1', '2', '3', '4', '5'].includes(sp.get('rating') ?? '') ? (sp.get('rating') as string) : '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const filtering = Boolean(productId || rating);

  const [data, setData] = useState<AdminReviewList | null>(null);
  const [errStatus, setErrStatus] = useState(0);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [prodInput, setProdInput] = useState(productId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: 'reject' | 'hide' | 'delete'; row: AdminReview } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; kind: Kind } | null>(null);
  const [actErr, setActErr] = useState<ActErr | null>(null);
  const { toast, show } = useToast();
  const seq = useRef(0);
  const busy = acting !== null;

  const go = useQueryGo(BASE);

  // Ô mã sản phẩm: chỉ đưa lên URL khi rỗng hoặc đúng dạng uuid (API chỉ nhận uuid); gõ dở thì chờ.
  useEffect(() => { setProdInput(productId); }, [productId]);
  const prodTrim = prodInput.trim();
  const prodInvalid = prodTrim !== '' && !UUID_RE.test(prodTrim);
  useEffect(() => {
    if (prodTrim === productId || prodInvalid) return;
    const t = setTimeout(() => go({ product_id: prodTrim || null }), 300);
    return () => clearTimeout(t);
  }, [prodTrim, productId, prodInvalid, go]);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT), status });
    if (productId) qs.set('product_id', productId);
    if (rating) qs.set('rating', rating);
    const r = await api<AdminReviewList>(`/admin/reviews?${qs}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) {
      const pages = Math.max(1, Math.ceil((r.body.total ?? 0) / LIMIT));
      if (typeof r.body.pending_count === 'number') setPendingCount(r.body.pending_count);
      // Trang vượt cuối (sau khi xử lý hết dòng của trang cuối): về trang cuối có dữ liệu.
      if (r.body.items.length === 0 && (r.body.total ?? 0) > 0 && page > pages) { go({ page: pages > 1 ? String(pages) : null }, true, true); return; }
      setData(r.body); setView('ready');
    } else if (expired(r)) return;
    else { setData(null); setView('error'); setErrStatus(r.status); }
  }, [page, status, productId, rating]); // expired, go đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);

  const openDialog = (kind: 'reject' | 'hide' | 'delete', row: AdminReview) => { setActErr(null); setReason(''); setReasonErr(null); setDialog({ kind, row }); };
  const closeDialog = () => { if (busy) return; setDialog(null); setActErr(null); setReasonErr(null); };

  const fail = (r: ApiResult) => {
    if (r.status === 404) setActErr({ text: 'Đánh giá không còn tồn tại', reload: true });
    else if (r.status === 409) setActErr({ text: 'Đánh giá đã được xử lý', reload: true });
    else if (r.status === 403) setActErr({ text: 'Không có quyền' });
    else if (r.status === 429) setActErr({ text: `Bạn thao tác quá nhanh, thử lại sau ${r.retryAfter ?? 60} giây.` });
    else setActErr({ text: 'Không thực hiện được' });
  };

  const run = async (kind: Kind, row: AdminReview, body?: { reason: string }) => {
    if (busy) return;
    setActing({ id: row.id, kind }); setActErr(null);
    const r = kind === 'delete'
      ? await api(`/reviews/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      : await api(`/admin/reviews/${encodeURIComponent(row.id)}/${kind}`, { method: 'POST', body });
    setActing(null);
    if (r.ok) { setDialog(null); show({ text: DONE[kind], testid: `${P}-action-success` }); void load(); return; }
    if (expired(r)) { setDialog(null); return; }
    if (r.status === 400 && (r.fieldErrors.reason)) { setReasonErr(r.fieldErrors.reason === 'too_long' ? 'Tối đa 500 ký tự' : 'Vui lòng nhập lý do'); return; }
    fail(r);
  };

  const confirmReason = () => {
    if (!dialog || dialog.kind === 'delete') return;
    const t = reason.trim();
    if (t === '') { setReasonErr('Vui lòng nhập lý do'); return; }
    if (codePoints(t) > REASON_MAX) { setReasonErr(`Tối đa ${REASON_MAX} ký tự`); return; }
    void run(dialog.kind, dialog.row, { reason: t });
  };

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const clear = () => { setProdInput(''); go({ product_id: null, rating: null }); };
  const tabs = REVIEW_STATUSES.map((s) => ({ v: s, t: reviewStatusText(s) }));
  const reasonOver = codePoints(reason.trim()) > REASON_MAX;
  const reasonError = reasonOver ? `Tối đa ${REASON_MAX} ký tự` : reasonErr;

  const errBox = actErr && (
    <div role="alert" className="banner banner-error" data-testid={`${P}-action-error`}>
      {actErr.text}
      {actErr.reload && <>{' '}<button type="button" className="btn" onClick={() => { setDialog(null); setActErr(null); void load(); }} data-testid={`${P}-action-reload`}>Tải lại</button></>}
    </div>
  );

  return (
    <main className="page">
      <div className="page-head"><h1>Đánh giá</h1></div>
      <div className="seg rd-seg" role="tablist" aria-label="Trạng thái đánh giá" data-testid={`${P}-tabs`}>
        {tabs.map((t) => (
          <button key={t.v} type="button" role="tab" aria-selected={status === t.v} onClick={() => go({ status: t.v === 'pending' ? null : t.v })}>
            {t.t}{t.v === 'pending' && pendingCount !== null && <span className="rd-n rd-n-amber" data-testid={`${P}-pending-count`}>{pendingCount}</span>}
          </button>
        ))}
      </div>
      <div className="rd-bar-tools">
        <div className="rd-search">
          <span className="i i-search" aria-hidden="true" />
          <input type="text" value={prodInput} placeholder="Mã sản phẩm" aria-label="Lọc theo mã sản phẩm" autoComplete="off" aria-invalid={prodInvalid ? true : undefined} onChange={(e) => setProdInput(e.target.value)} data-testid={`${P}-filter-product`} />
          {prodInvalid && <p className="field-error">Mã sản phẩm phải là uuid</p>}
        </div>
        <select value={rating} aria-label="Lọc theo sao" onChange={(e) => go({ rating: e.target.value || null })} data-testid={`${P}-filter-rating`}>
          <option value="">Mọi sao</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={String(n)}>{n} sao</option>)}
        </select>
        {(filtering || prodInvalid) && !emptyAll && <button type="button" className="btn btn-ghost btn-sm" onClick={clear} data-testid={`${P}-filter-clear`}><span className="i i-x" aria-hidden="true" />Bỏ lọc</button>}
      </div>

      {!dialog && errBox}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errStatus === 403 ? 'Không có quyền' : 'Không tải được danh sách.'}{errStatus !== 403 && <>{' '}<button type="button" className="btn btn-sm" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></>}</div>}
      {view === 'loading' && <SkRows n={5} lines={3} trail testid={`${P}-loading`} />}

      {emptyAll && (filtering || page > 1
        ? <div className="empty" data-testid={`${P}-empty-filter`}><span className="tile tile-lg gray"><span className="i i-filter" aria-hidden="true" /></span><strong>Không khớp bộ lọc</strong><button type="button" className="btn btn-sm" onClick={clear} data-testid={`${P}-filter-clear`}>Bỏ lọc</button></div>
        : <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg green"><span className="i i-okc" aria-hidden="true" /></span><strong>{status === 'pending' ? 'Hết đánh giá chờ duyệt' : 'Chưa có đánh giá'}</strong></div>)}

      {data && view === 'ready' && items.length > 0 && (
        <>
          <ul className="rd-cards" data-testid={`${P}-list`}>
            {items.map((it) => {
              const isOpen = open.has(it.id);
              const long = (it.comment ?? '').length > 120 || (it.comment ?? '').includes('\n');
              const cur = acting?.id === it.id ? acting.kind : null;
              return (
                <li key={it.id} className="rd-card rd-mod" data-testid={`${P}-row`} data-id={it.id} data-status={it.status}>
                  <div className="rd-mod-main">
                    <div className="rd-card-head">
                      <div className="rev-prod grow">
                        <span className="tile gray"><span className="i i-box" aria-hidden="true" /></span>
                        <div className="rd-mod-who">
                          <span className="strong truncate" data-testid={`${P}-row-product`}>{it.product?.name}</span>
                          <span className="small muted truncate"><span data-testid={`${P}-row-reviewer`}>{it.reviewer?.display_name}</span> · <span className="tabular">{formatDateTime(it.created_at)}</span></span>
                        </div>
                      </div>
                      <Stars value={it.rating} testid={`${P}-row-rating`} />
                      <ReviewStatusBadge status={it.status} />
                    </div>
                    {it.comment && <p className={`pre rd-comment rev-clamp${isOpen ? ' open' : ''}`} data-testid={`${P}-row-comment`} onClick={() => long && toggle(it.id)}>{it.comment}</p>}
                    {long && <button type="button" className="btn-link small" aria-expanded={isOpen} onClick={() => toggle(it.id)}>{isOpen ? 'Thu gọn' : 'Xem thêm'}</button>}
                    <ImageStrip images={it.images} testid={`${P}-row-images`} />
                    {it.moderation_reason && <p className="rd-reason"><span className="i i-alert" aria-hidden="true" /><span className="strong">Lý do: </span><span className="pre" data-testid={`${P}-row-reason`}>{it.moderation_reason}</span></p>}
                  </div>
                  <div className="rd-mod-actions">
                    {it.status === 'pending' && <button type="button" className="btn btn-primary btn-icon" aria-label="Duyệt" title="Duyệt" disabled={busy} aria-busy={cur === 'approve'} onClick={() => void run('approve', it)} data-testid={`${P}-row-approve`}>{cur === 'approve' ? <Spin /> : <span className="i i-check" aria-hidden="true" />}</button>}
                    {it.status === 'pending' && <button type="button" className="btn btn-icon" aria-label="Từ chối" title="Từ chối" disabled={busy} onClick={() => openDialog('reject', it)} data-testid={`${P}-row-reject`}><span className="i i-xc" aria-hidden="true" /></button>}
                    {it.status === 'published' && <button type="button" className="btn btn-icon" aria-label="Ẩn" title="Ẩn" disabled={busy} onClick={() => openDialog('hide', it)} data-testid={`${P}-row-hide`}><span className="i i-eyeoff" aria-hidden="true" /></button>}
                    {it.status === 'hidden' && <button type="button" className="btn btn-icon" aria-label="Bỏ ẩn" title="Bỏ ẩn" disabled={busy} aria-busy={cur === 'unhide'} onClick={() => void run('unhide', it)} data-testid={`${P}-row-unhide`}>{cur === 'unhide' ? <Spin /> : <span className="i i-eye" aria-hidden="true" />}</button>}
                    <button type="button" className="btn btn-icon btn-danger-soft" aria-label="Xóa" title="Xóa" disabled={busy} onClick={() => openDialog('delete', it)} data-testid={`${P}-row-delete`} />
                  </div>
                </li>
              );
            })}
          </ul>
          <ReviewPager testPrefix={P} page={page} limit={LIMIT} total={data.total} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}

      {dialog && dialog.kind !== 'delete' && (
        <RevDialog sticky title={`${TITLE[dialog.kind]}?`} icon={dialog.kind === 'reject' ? 'xc' : 'eyeoff'} tone={dialog.kind === 'reject' ? 'red' : 'violet'} testid={`${P}-${dialog.kind}-dialog`} onClose={closeDialog}>
          <p>{dialog.row.reviewer?.display_name} · {dialog.row.product?.name}</p>
          <div className="field">
            <label htmlFor="rev-mod-reason">Lý do</label>
            <textarea id="rev-mod-reason" rows={3} value={reason} placeholder="Khách sẽ thấy lý do này" autoComplete="off" aria-invalid={reasonError ? true : undefined} disabled={busy}
              onChange={(e) => { setReason(e.target.value); setReasonErr(null); }} data-testid={`${P}-${dialog.kind}-reason`} />
            <div className="between">
              <p className="field-error" role={reasonError ? 'alert' : undefined} data-testid={reasonError ? `${P}-reason-error` : undefined}>{reasonError}</p>
              <p className={`small muted tabular${reasonOver ? ' rev-over' : ''}`}>{codePoints(reason.trim())} / {REASON_MAX}</p>
            </div>
          </div>
          {errBox}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={closeDialog} data-testid={`${P}-${dialog.kind}-dismiss`}>Giữ nguyên</button>
            <button type="button" className="btn btn-danger" disabled={busy} aria-busy={busy} onClick={confirmReason} data-testid={`${P}-${dialog.kind}-confirm`}>{busy && <Spin />}{CONFIRM[dialog.kind]}</button>
          </div>
        </RevDialog>
      )}
      {dialog && dialog.kind === 'delete' && (
        <RevDialog title={`${TITLE.delete}?`} icon="trash" testid={`${P}-delete-dialog`} onClose={closeDialog}>
          <p>{dialog.row.reviewer?.display_name} · không khôi phục được</p>
          {errBox}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={closeDialog} data-testid={`${P}-delete-dismiss`}>Giữ nguyên</button>
            <button type="button" className="btn btn-danger" disabled={busy} aria-busy={busy} onClick={() => void run('delete', dialog.row)} data-testid={`${P}-delete-confirm`}>{busy && <Spin />}Xóa</button>
          </div>
        </RevDialog>
      )}
      <ToastView toast={toast} />
    </main>
  );
}

export default function AdminReviewsPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="page"><SkRows n={4} lead={false} /></main>}><ModerationInner /></Suspense>
    </RequireRole>
  );
}
