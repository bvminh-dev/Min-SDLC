'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ImageStrip, ReviewPager, ReviewStatusBadge, Spin, Stars, useQueryGo } from '../../../components/ReviewParts';
import { RequireRole } from '../../../components/RequireRole';
import { Modal, ToastView, useToast } from '../../../components/ShipmentParts';
import { api, type ApiResult } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useLoginRedirect } from '../../../lib/prd';
import { REASON_MAX, REVIEW_STATUSES, UUID_RE, codePoints, reviewStatusText, type AdminReview, type AdminReviewList } from '../../../lib/review';

const LIMIT = 20;
const P = 'rev-admin-moderation';
const BASE = '/admin/reviews';
type Kind = 'approve' | 'reject' | 'hide' | 'unhide' | 'delete';
const DONE: Record<Kind, string> = { approve: 'Đã duyệt đánh giá', reject: 'Đã từ chối đánh giá', hide: 'Đã ẩn đánh giá', unhide: 'Đã bỏ ẩn đánh giá', delete: 'Đã xóa đánh giá' };
const TITLE: Record<'reject' | 'hide' | 'delete', string> = { reject: 'Từ chối đánh giá của', hide: 'Ẩn đánh giá của', delete: 'Xóa đánh giá của' };
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
    else if (r.status === 409) setActErr({ text: 'Đánh giá đã được xử lý hoặc không còn ở trạng thái này', reload: true });
    else if (r.status === 403) setActErr({ text: 'Không có quyền' });
    else if (r.status === 429) setActErr({ text: `Bạn thao tác quá nhanh, thử lại sau ${r.retryAfter ?? 60} giây.` });
    else setActErr({ text: 'Không thực hiện được, thử lại' });
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
      {actErr.reload && <>{' '}<button type="button" className="btn" onClick={() => { setDialog(null); setActErr(null); void load(); }} data-testid={`${P}-action-reload`}>Tải lại danh sách</button></>}
    </div>
  );

  return (
    <main className="wide">
      <h1>Kiểm duyệt đánh giá</h1>
      <div className="tabs" role="tablist" aria-label="Trạng thái đánh giá" data-testid={`${P}-tabs`}>
        {tabs.map((t) => (
          <button key={t.v} type="button" role="tab" aria-selected={status === t.v} className={`btn tight${status === t.v ? ' btn-current' : ''}`} onClick={() => go({ status: t.v === 'pending' ? null : t.v })}>
            {t.t}{t.v === 'pending' && pendingCount !== null && <> (<span data-testid={`${P}-pending-count`}>{pendingCount}</span>)</>}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div>
          <input type="text" value={prodInput} placeholder="Mã sản phẩm (uuid)" aria-label="Lọc theo mã sản phẩm" autoComplete="off" aria-invalid={prodInvalid ? true : undefined} onChange={(e) => setProdInput(e.target.value)} data-testid={`${P}-filter-product`} />
          {prodInvalid && <p className="field-error">Mã sản phẩm phải là mã uuid hợp lệ</p>}
        </div>
        <select value={rating} aria-label="Lọc theo sao" onChange={(e) => go({ rating: e.target.value || null })} data-testid={`${P}-filter-rating`}>
          <option value="">Tất cả sao</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={String(n)}>{n} sao</option>)}
        </select>
        {(filtering || prodInvalid) && !emptyAll && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid={`${P}-filter-clear`}>Xóa bộ lọc</button>}
      </div>

      {!dialog && errBox}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{errStatus === 403 ? 'Không có quyền' : 'Không tải được danh sách.'}{errStatus !== 403 && <>{' '}<button type="button" className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></>}</div>}
      {view === 'loading' && <div data-testid={`${P}-loading`} aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}

      {emptyAll && (filtering || page > 1
        ? <div className="notfound" data-testid={`${P}-empty-filter`}><p>Không có đánh giá nào khớp bộ lọc</p><button type="button" className="btn tight" onClick={clear} data-testid={`${P}-filter-clear`}>Xóa bộ lọc</button></div>
        : <div className="notfound" data-testid={`${P}-empty`}><p>{status === 'pending' ? 'Không có đánh giá nào chờ duyệt' : 'Không có đánh giá nào ở trạng thái này'}</p></div>)}

      {data && view === 'ready' && items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="stack-table" data-testid={`${P}-list`}>
              <thead><tr><th>Sản phẩm</th><th>Người viết</th><th>Sao</th><th>Nội dung</th><th>Ngày</th><th>Thao tác</th></tr></thead>
              <tbody>
                {items.map((it) => {
                  const isOpen = open.has(it.id);
                  const long = (it.comment ?? '').length > 120 || (it.comment ?? '').includes('\n');
                  const cur = acting?.id === it.id ? acting.kind : null;
                  return (
                    <tr key={it.id} className="row-click" data-testid={`${P}-row`} data-id={it.id} data-status={it.status} onClick={() => toggle(it.id)}>
                      <td data-label="Sản phẩm" data-testid={`${P}-row-product`}>{it.product?.name}</td>
                      <td data-label="Người viết" data-testid={`${P}-row-reviewer`}>{it.reviewer?.display_name}</td>
                      <td data-label="Sao"><Stars value={it.rating} testid={`${P}-row-rating`} /></td>
                      <td data-label="Nội dung">
                        <div>
                          <ReviewStatusBadge status={it.status} />
                          {it.comment && <p className={`pre rev-clamp${isOpen ? ' open' : ''}`} data-testid={`${P}-row-comment`}>{it.comment}</p>}
                          {long && <button type="button" className="btn-link" aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); toggle(it.id); }}>{isOpen ? 'Thu gọn' : 'Xem đầy đủ'}</button>}
                          <ImageStrip images={it.images} testid={`${P}-row-images`} />
                          {it.moderation_reason && <p className="rev-reason"><strong>Lý do: </strong><span className="pre" data-testid={`${P}-row-reason`}>{it.moderation_reason}</span></p>}
                        </div>
                      </td>
                      <td data-label="Ngày" className="tabular">{formatDateTime(it.created_at)}</td>
                      <td data-label="Thao tác" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {it.status === 'pending' && <button type="button" className="btn btn-primary tight" disabled={busy} aria-busy={cur === 'approve'} onClick={() => void run('approve', it)} data-testid={`${P}-row-approve`}>{cur === 'approve' && <Spin />}Duyệt</button>}
                          {it.status === 'pending' && <button type="button" className="btn tight" disabled={busy} onClick={() => openDialog('reject', it)} data-testid={`${P}-row-reject`}>Từ chối</button>}
                          {it.status === 'published' && <button type="button" className="btn tight" disabled={busy} onClick={() => openDialog('hide', it)} data-testid={`${P}-row-hide`}>Ẩn</button>}
                          {it.status === 'hidden' && <button type="button" className="btn tight" disabled={busy} aria-busy={cur === 'unhide'} onClick={() => void run('unhide', it)} data-testid={`${P}-row-unhide`}>{cur === 'unhide' && <Spin />}Bỏ ẩn</button>}
                          <button type="button" className="btn btn-danger-soft tight" disabled={busy} onClick={() => openDialog('delete', it)} data-testid={`${P}-row-delete`}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ReviewPager testPrefix={P} page={page} limit={LIMIT} total={data.total} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}

      {dialog && dialog.kind !== 'delete' && (
        <Modal sticky title={`${TITLE[dialog.kind]} ${dialog.row.reviewer?.display_name ?? ''}?`} testid={`${P}-${dialog.kind}-dialog`} onClose={closeDialog}>
          <div className="field">
            <label htmlFor="rev-mod-reason">Lý do (bắt buộc, 1 đến 500 ký tự). Khách chủ đánh giá sẽ thấy lý do này.</label>
            <textarea id="rev-mod-reason" rows={4} value={reason} autoComplete="off" aria-invalid={reasonError ? true : undefined} disabled={busy}
              onChange={(e) => { setReason(e.target.value); setReasonErr(null); }} data-testid={`${P}-${dialog.kind}-reason`} />
            <div className="between">
              <p className="field-error" role={reasonError ? 'alert' : undefined} data-testid={reasonError ? `${P}-reason-error` : undefined}>{reasonError}</p>
              <p className={`hint tabular${reasonOver ? ' rev-over' : ''}`}>{codePoints(reason.trim())} / {REASON_MAX}</p>
            </div>
          </div>
          {errBox}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={closeDialog} data-testid={`${P}-${dialog.kind}-dismiss`}>Giữ nguyên</button>
            <button type="button" className="btn btn-danger" disabled={busy} aria-busy={busy} onClick={confirmReason} data-testid={`${P}-${dialog.kind}-confirm`}>{busy && <Spin />}{CONFIRM[dialog.kind]}</button>
          </div>
        </Modal>
      )}
      {dialog && dialog.kind === 'delete' && (
        <Modal title={`${TITLE.delete} ${dialog.row.reviewer?.display_name ?? ''}?`} testid={`${P}-delete-dialog`} onClose={closeDialog}>
          <p>Đánh giá sẽ biến mất khỏi trang sản phẩm và không thể khôi phục.</p>
          {errBox}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={closeDialog} data-testid={`${P}-delete-dismiss`}>Giữ nguyên</button>
            <button type="button" className="btn btn-danger" disabled={busy} aria-busy={busy} onClick={() => void run('delete', dialog.row)} data-testid={`${P}-delete-confirm`}>{busy && <Spin />}Xóa đánh giá</button>
          </div>
        </Modal>
      )}
      <ToastView toast={toast} />
    </main>
  );
}

export default function AdminReviewsPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><ModerationInner /></Suspense>
    </RequireRole>
  );
}
