'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ImageStrip, ReviewPager, ReviewStatusBadge, RevDialog, Spin, Stars, useQueryGo } from '../../../components/ReviewParts';
import { RequireRole } from '../../../components/RequireRole';
import { ToastView, useToast } from '../../../components/ShipmentParts';
import { useCountdown } from '../../../components/useCountdown';
import { api } from '../../../lib/api';
import { rateLimitedText, useLoginRedirect } from '../../../lib/prd';
import { REVIEW_STATUSES, formatDate, isHttpUrl, reviewStatusText, type MyReview, type MyReviewList } from '../../../lib/review';

const LIMIT = 20;
const P = 'rev-my-reviews';
const BASE = '/me/reviews';

/**
 * Đánh giá của tôi (ui/my-reviews): customer xem mọi đánh giá của mình theo trạng thái, sửa và xóa. Bộ lọc trạng thái và trang nằm trên URL (`?status=&page=`);
 * `?saved=1|pending` do form sửa gắn khi quay về để hiện thông báo "Đã lưu thay đổi" (rồi được gỡ khỏi URL). Lý do kiểm duyệt là văn bản thường.
 */
function MyReviewsInner() {
  const sp = useSearchParams();
  const expired = useLoginRedirect();
  const status = REVIEW_STATUSES.find((s) => s === sp.get('status')) ?? '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const saved = sp.get('saved');

  const [data, setData] = useState<MyReviewList | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'rate'>('loading');
  const [target, setTarget] = useState<MyReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [delErr, setDelErr] = useState<{ text: string; reload?: boolean } | null>(null);
  const limit = useCountdown();
  const delLimit = useCountdown();
  const { toast, show } = useToast();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  const go = useQueryGo(BASE);

  // Thông báo sau khi lưu ở form sửa: hiện một lần rồi gỡ `saved` khỏi URL.
  useEffect(() => {
    if (saved !== '1' && saved !== 'pending') return;
    show({ text: saved === 'pending' ? 'Đã lưu. Sẽ hiện lại sau khi được duyệt.' : 'Đã lưu thay đổi', testid: 'rev-review-form-save-success' });
    go({ saved: null }, true, true);
  }, [saved]); // show, go đổi mỗi lần render nên không đưa vào deps

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) qs.set('status', status);
    const r = await api<MyReviewList>(`/me/reviews?${qs}`);
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) {
      const pages = Math.max(1, Math.ceil((r.body.total ?? 0) / LIMIT));
      // Trang vượt cuối (sau khi xóa hết thẻ của trang cuối): về trang cuối có dữ liệu.
      if (r.body.items.length === 0 && (r.body.total ?? 0) > 0 && page > pages) { go({ page: pages > 1 ? String(pages) : null }, true, true); return; }
      setData(r.body); setView('ready');
    } else if (expired(r)) return;
    else if (r.status === 403) { setData(null); setView('forbidden'); }
    else if (r.status === 429) { setData(null); limit.start(r.retryAfter); setView('rate'); }
    else { setData(null); setView('error'); }
  }, [page, status]); // expired, limit, go đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  const closeDialog = () => { if (busy) return; setTarget(null); setDelErr(null); };
  const del = async () => {
    if (!target || busy || delLimit.left > 0) return;
    setBusy(true); setDelErr(null);
    const r = await api(`/reviews/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
    setBusy(false);
    if (r.status === 204 || r.status === 200) { setTarget(null); show({ text: 'Đã xóa đánh giá', testid: `${P}-delete-success` }); void load(); return; }
    if (expired(r)) { setTarget(null); return; }
    if (r.status === 404) setDelErr({ text: 'Đánh giá không còn tồn tại', reload: true });
    else if (r.status === 429) delLimit.start(r.retryAfter);
    else if (r.status === 403) setDelErr({ text: 'Không có quyền' });
    else setDelErr({ text: 'Không xóa được, thử lại' });
  };

  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const chips = [{ v: '', t: 'Tất cả' }, ...REVIEW_STATUSES.map((s) => ({ v: s as string, t: reviewStatusText(s) }))];

  return (
    <main className="page page-mid">
      <div className="page-head"><h1>Đánh giá của tôi</h1></div>
      <div className="seg rd-seg" role="group" aria-label="Lọc theo trạng thái" data-testid={`${P}-filter-status`}>
        {chips.map((c) => (
          <button key={c.v || 'all'} type="button" aria-pressed={status === c.v} onClick={() => go({ status: c.v || null })}>{c.t}</button>
        ))}
      </div>

      {view === 'forbidden' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không có quyền</div>}
      {view === 'rate' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{limit.left > 0 ? rateLimitedText(limit.left) : 'Thử lại sau ít phút.'}{' '}<button type="button" className="btn btn-sm" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được đánh giá.{' '}<button type="button" className="btn btn-sm" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && <div data-testid={`${P}-loading`} aria-busy="true"><div className="skeleton" style={{ height: '6rem' }} /><div className="skeleton" style={{ height: '6rem' }} /><div className="skeleton" style={{ height: '6rem' }} /></div>}

      {emptyAll && (status
        ? <div className="empty" data-testid={`${P}-empty-filter`}><span className="tile tile-lg gray"><span className="i i-filter" aria-hidden="true" /></span><strong>Không có đánh giá</strong><button type="button" className="btn btn-sm" onClick={() => go({ status: null })} data-testid={`${P}-filter-clear`}>Xem tất cả</button></div>
        : <div className="empty" data-testid={`${P}-empty`}><span className="tile tile-lg gray"><span className="i i-star" aria-hidden="true" /></span><strong>Chưa có đánh giá</strong><Link className="btn btn-sm" href="/orders">Đơn hàng</Link></div>)}

      {data && view === 'ready' && items.length > 0 && (
        <>
          <ul className="rd-cards" data-testid={`${P}-list`}>
            {items.map((it) => {
              const gone = Boolean(it.product?.status) && it.product.status !== 'active'; // đã ngừng bán: theo `product.status` của API (ảnh thiếu không đủ để kết luận)
              const showReason = (it.status === 'rejected' || it.status === 'hidden') && Boolean(it.moderation_reason);
              return (
                <li key={it.id} className="rd-card" data-testid={`${P}-item`} data-id={it.id} data-status={it.status}>
                  <div className="rd-card-head">
                    <div className="rev-prod grow" data-testid={`${P}-item-product`}>
                      {isHttpUrl(it.product?.image_url) ? <img className="rev-prod-img" src={it.product.image_url} alt="" /> : <span className="tile gray"><span className="i i-box" aria-hidden="true" /></span>}
                      {gone ? <span className="strong truncate">{it.product.name}</span> : <Link className="strong truncate" href={`/products/${encodeURIComponent(it.product?.id ?? '')}`}>{it.product?.name}</Link>}
                      {gone && <span className="badge" data-status="archived">Ngừng bán</span>}
                    </div>
                    <ReviewStatusBadge status={it.status} testid={`${P}-item-status`} />
                  </div>
                  <div className="rd-card-meta rd-card-meta-l">
                    <Stars value={it.rating} testid={`${P}-item-rating`} />
                    <span className="small muted tabular">{formatDate(it.created_at)}</span>
                    {it.edited_at && <span className="small muted">· sửa</span>}
                  </div>
                  {it.comment && <p className="pre rd-comment" data-testid={`${P}-item-comment`}>{it.comment}</p>}
                  <ImageStrip images={it.images} testid={`${P}-item-images`} />
                  {showReason && <p className="rd-reason"><span className="i i-alert" aria-hidden="true" /><span className="strong">Lý do: </span><span className="pre" data-testid={`${P}-item-reason`}>{it.moderation_reason}</span></p>}
                  {(it.can_edit || it.can_delete) && (
                    <div className="rd-actions">
                      {it.can_edit && it.edit_requires_review && <span className="small muted rd-actions-note"><span className="i i-info" aria-hidden="true" /> Sửa sẽ chờ duyệt lại</span>}
                      {it.can_edit && <Link className="btn btn-sm" href={`/me/reviews/${encodeURIComponent(it.id)}/edit`} data-testid={`${P}-item-edit`}>Sửa</Link>}
                      {it.can_delete && <button type="button" className="btn btn-sm btn-danger-soft" disabled={busy} onClick={() => { setDelErr(null); setTarget(it); }} data-testid={`${P}-item-delete`}>Xóa</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <ReviewPager testPrefix={P} page={page} limit={LIMIT} total={data.total} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
        </>
      )}

      {target && (
        <RevDialog title="Xóa đánh giá?" icon="trash" testid={`${P}-delete-dialog`} onClose={closeDialog}>
          <p>{target.product?.name} · không khôi phục được</p>
          {(delErr || delLimit.left > 0) && (
            <div role="alert" className="banner banner-error" data-testid={`${P}-delete-error`}>
              {delErr ? delErr.text : rateLimitedText(delLimit.left)}
              {delErr?.reload && <>{' '}<button type="button" className="btn btn-sm" onClick={() => { setTarget(null); setDelErr(null); void load(); }} data-testid={`${P}-delete-reload`}>Tải lại</button></>}
            </div>
          )}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={closeDialog} data-testid={`${P}-delete-dismiss`}>Giữ lại</button>
            <button type="button" className="btn btn-danger" disabled={busy || delLimit.left > 0} aria-busy={busy} onClick={() => void del()} data-testid={`${P}-delete-confirm`}>{busy && <Spin />}Xóa</button>
          </div>
        </RevDialog>
      )}
      <ToastView toast={toast} />
    </main>
  );
}

export default function MyReviewsPage() {
  return (
    <RequireRole roles={['customer']}>
      <Suspense fallback={<main className="page"><div aria-busy="true"><div className="skeleton" /></div></main>}><MyReviewsInner /></Suspense>
    </RequireRole>
  );
}
