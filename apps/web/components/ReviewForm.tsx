'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, type ApiResult } from '../lib/api';
import { useLoginRedirect, rateLimitedText } from '../lib/prd';
import {
  COMMENT_MAX, IMAGE_ACCEPT, IMAGE_MAX, IMAGE_MAX_BYTES, codePoints, imageErrorText, imageIdOf, ineligibleText, isHttpUrl, newReviewKey, type MyReview, type ReviewImage,
} from '../lib/review';
import { Spin, VerifiedBadge } from './ReviewParts';
import { useCountdown } from './useCountdown';
import { SkForm, SkRows } from './Skeleton';

const P = 'rev-review-form';
interface FormImage { k: string; id: string | null; url: string }
type Lock = { kind: 'conflict' | 'ineligible' | 'not-editable'; text: string } | null;
type View = 'loading' | 'ready' | 'notfound' | 'rate' | 'error' | 'forbidden';

// Nháp trong phiên trình duyệt: giữ nội dung đã nhập khi bị đưa ra đăng nhập (401).
const draftKey = (mode: string, id: string) => `rev-form:${mode}:${id}`;
const readDraft = (k: string): { rating: number; comment: string; images: FormImage[] } | null => {
  try { const s = sessionStorage.getItem(k); sessionStorage.removeItem(k); return s ? JSON.parse(s) : null; } catch { return null; }
};
const writeDraft = (k: string, v: unknown) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sessionStorage có thể bị chặn */ } };
const dropDraft = (k: string) => { try { sessionStorage.removeItem(k); } catch { /* bỏ qua */ } };

const toFormImages = (list: ReviewImage[] | undefined): FormImage[] => (Array.isArray(list) ? list : []).filter((i) => i && isHttpUrl(i.url)).map((i, n) => ({ k: `e${n}-${i.url}`, id: imageIdOf(i), url: i.url }));

/**
 * Form viết (`/products/{id}/reviews/new`) và sửa (`/me/reviews/{id}/edit`) đánh giá, dùng chung một component (ui/review-form).
 * Viết: kiểm điều kiện rồi hiện form, `Idempotency-Key` mới mỗi lần mở và giữ nguyên khi gửi lại. Sửa: đổ sẵn từ GET /me/reviews/{id}, chỉ gửi phần đổi.
 */
export function ReviewForm(props: { mode: 'create'; productId: string } | { mode: 'edit'; reviewId: string }) {
  const edit = props.mode === 'edit';
  const targetId = props.mode === 'edit' ? props.reviewId : props.productId;
  const router = useRouter();
  const expired = useLoginRedirect();
  const limit = useCountdown();
  const dk = draftKey(props.mode, targetId);

  const [view, setView] = useState<View>('loading');
  const [productName, setProductName] = useState('');
  const [verified, setVerified] = useState(false);
  const [lock, setLock] = useState<Lock>(null);
  const [editNotice, setEditNotice] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<FormImage[]>([]);
  const [imagesReadonly, setImagesReadonly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ratingErr, setRatingErr] = useState<string | null>(null);
  const [commentErr, setCommentErr] = useState<string | null>(null);
  const [imageErr, setImageErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [noChange, setNoChange] = useState(false);
  const [rateOn, setRateOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'pending' | 'published' | null>(null);
  const [key, setKey] = useState(() => newReviewKey()); // một khóa cho mỗi lần mở form viết, giữ nguyên khi gửi lại sau lỗi
  const orig = useRef<{ rating: number; comment: string; ids: string[] } | null>(null);
  const count = useRef(0);
  const seq = useRef(0);
  const wasLimited = useRef(false);
  const ratingRef = useRef<HTMLDivElement>(null);

  useEffect(() => { count.current = images.length; }, [images]);

  const saveDraft = () => writeDraft(dk, { rating, comment, images });
  const applyDraft = () => {
    const d = readDraft(dk);
    if (!d) return;
    if (typeof d.rating === 'number') setRating(d.rating);
    if (typeof d.comment === 'string') setComment(d.comment);
    if (Array.isArray(d.images) && !edit) setImages(d.images.filter((i) => i && typeof i.id === 'string' && isHttpUrl(i.url)));
  };

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading'); setLock(null);
    if (!edit) {
      const [p, e] = await Promise.all([api<{ name: string }>(`/products/${encodeURIComponent(targetId)}`), api<{ eligible: boolean; reason: string | null }>(`/products/${encodeURIComponent(targetId)}/review-eligibility`)]);
      if (n !== seq.current) return;
      const bad = [p, e].find((r) => r.status !== 200);
      if (bad) {
        if (expired(bad)) return;
        if ([p, e].some((r) => r.status === 404)) setView('notfound');
        else if (bad.status === 429) { limit.start(bad.retryAfter); setView('rate'); }
        else if (bad.status === 403) setView('forbidden');
        else setView('error');
        return;
      }
      setProductName(String(p.body.name ?? ''));
      if (e.body.eligible) setVerified(true);
      else setLock({ kind: e.body.reason === 'already_reviewed' ? 'conflict' : 'ineligible', text: ineligibleText(e.body.reason) });
      applyDraft();
      setView('ready');
      return;
    }
    const r = await api<MyReview>(`/me/reviews/${encodeURIComponent(targetId)}`);
    if (n !== seq.current) return;
    if (r.status !== 200 || typeof r.body.id !== 'string') {
      if (expired(r)) return;
      if (r.status === 404) setView('notfound');
      else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
      else if (r.status === 403) setView('forbidden');
      else setView('error');
      return;
    }
    const rv = r.body;
    const imgs = toFormImages(rv.images);
    // Ảnh hiện có phải đi kèm id thì mới gửi lại được `image_ids` đầy đủ; thiếu id thì ảnh giữ nguyên và không sửa được (không bao giờ gửi danh sách thiếu làm cắt mất ảnh).
    const readonlyImgs = imgs.some((i) => !i.id);
    setProductName(String(rv.product?.name ?? ''));
    setVerified(true); setEditNotice(rv.edit_requires_review === true);
    setRating(Number(rv.rating) || 0); setComment(rv.comment ?? ''); setImages(imgs); setImagesReadonly(readonlyImgs);
    orig.current = { rating: Number(rv.rating) || 0, comment: rv.comment ?? '', ids: imgs.map((i) => i.id as string) };
    if (!rv.can_edit) setLock({ kind: 'not-editable', text: 'Đánh giá này không còn sửa được' });
    else applyDraft();
    setView('ready');
  }, [edit, targetId]); // expired, limit, applyDraft đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (limit.left > 0) wasLimited.current = true;
    else if (wasLimited.current) { wasLimited.current = false; setRateOn(false); if (view === 'rate') void load(); }
  }, [limit.left, view, load]);

  const locked = lock !== null;
  const trimmed = comment.trim();
  const over = codePoints(trimmed) > COMMENT_MAX;
  const full = images.length >= IMAGE_MAX;

  const pick = (n: number) => { setRating(n); setRatingErr(null); };
  const onStarKey = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const t = Math.min(5, Math.max(1, n + d));
    pick(t);
    (ratingRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[t - 1])?.focus();
  };

  const onFiles = async (files: File[]) => {
    setImageErr(null); setRateOn(false);
    setUploading(true);
    for (const f of files) {
      if (count.current >= IMAGE_MAX) { setImageErr('Tối đa 5 ảnh'); break; }
      if (f.size > IMAGE_MAX_BYTES) { setImageErr(imageErrorText('size')); continue; }
      const form = new FormData();
      form.append('file', f);
      const r = await api<{ image_id: string; url: string }>('/review-images', { method: 'POST', body: form });
      if (r.status === 201 && r.body.image_id && isHttpUrl(r.body.url)) {
        count.current += 1;
        setImages((x) => [...x, { k: `u-${r.body.image_id}`, id: r.body.image_id, url: r.body.url }]);
      } else if (r.status === 401) { saveDraft(); expired(r); break; }
      else if (r.status === 429) { limit.start(r.retryAfter); setRateOn(true); break; }
      else if (r.status === 400 && r.code === 'image-invalid') setImageErr(imageErrorText(String((r.body as { reason?: string }).reason ?? '')));
      else setImageErr(imageErrorText(null));
    }
    setUploading(false);
  };

  /** Đưa lỗi 400 theo trường vào đúng ô; trả true khi có ít nhất một lỗi được gán. */
  const fieldErrors = (fe: Record<string, string>): boolean => {
    let hit = false;
    for (const [field, code] of Object.entries(fe)) {
      if (field === 'rating') { setRatingErr(code === 'required' ? 'Vui lòng chọn số sao' : 'Điểm phải từ 1 đến 5'); hit = true; }
      else if (field === 'comment') { setCommentErr(code === 'too_long' ? 'Tối đa 2000 ký tự' : code === 'invalid_characters' ? 'Nhận xét có ký tự không hợp lệ' : 'Nhận xét không hợp lệ'); hit = true; }
      else if (field.startsWith('image_ids')) { setImageErr(code === 'too_many_images' ? 'Tối đa 5 ảnh' : 'Có ảnh không hợp lệ hoặc đã được dùng, hãy xóa ảnh đó rồi tải lại'); hit = true; }
    }
    return hit;
  };

  const fail = (r: ApiResult) => {
    if (r.status === 401) { saveDraft(); expired(r); return; }
    if (r.status === 429) { limit.start(r.retryAfter); setRateOn(true); return; }
    if (r.status === 404) { setView('notfound'); return; }
    if (r.status === 409) {
      const c = String(r.body?.code ?? '');
      if (c === 'already_reviewed') { setLock({ kind: 'conflict', text: ineligibleText(c) }); return; }
      if (c === 'not_purchased' || c === 'not_delivered' || c === 'window_expired') { setLock({ kind: 'ineligible', text: ineligibleText(c) }); return; }
      if (c === 'review_not_editable') { setLock({ kind: 'not-editable', text: 'Đánh giá này không còn sửa được' }); return; }
    }
    if (r.status === 400 && fieldErrors(r.fieldErrors)) return;
    if (r.status === 403) { setSubmitErr('Không có quyền'); return; }
    if (r.status === 422) setKey(newReviewKey()); // khóa cũ đã gắn với nội dung khác: lần gửi sau dùng khóa mới
    setSubmitErr('Không gửi được, thử lại.');
  };

  const submit = async () => {
    if (busy || uploading || locked || over || limit.left > 0) return;
    setSubmitErr(null); setCommentErr(null); setNoChange(false); setRateOn(false);
    if (rating < 1) { setRatingErr('Vui lòng chọn số sao'); ratingRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus(); return; }
    if (!edit) {
      setBusy(true);
      const body: Record<string, unknown> = { rating, image_ids: images.map((i) => i.id).filter((x): x is string => Boolean(x)) };
      if (trimmed) body.comment = trimmed;
      const r = await api<{ status: string }>(`/products/${encodeURIComponent(targetId)}/reviews`, { method: 'POST', body, headers: { 'Idempotency-Key': key } });
      if (r.status === 201) { dropDraft(dk); setDone(r.body.status === 'pending' ? 'pending' : 'published'); setBusy(false); return; }
      setBusy(false); fail(r);
      return;
    }
    // Sửa: chỉ gửi phần đổi. Ảnh: gửi `image_ids` đầy đủ (ảnh hiện có kèm ảnh mới) chỉ khi danh sách ảnh đã đổi.
    const o = orig.current;
    const body: Record<string, unknown> = {};
    if (!o || rating !== o.rating) body.rating = rating;
    if (!o || trimmed !== o.comment.trim()) body.comment = trimmed === '' ? null : trimmed;
    const ids = images.map((i) => i.id).filter((x): x is string => Boolean(x));
    if (!imagesReadonly && o && (ids.length !== o.ids.length || ids.some((x, i) => x !== o.ids[i]))) body.image_ids = ids;
    if (Object.keys(body).length === 0) { setNoChange(true); return; }
    setBusy(true);
    const r = await api<{ status: string }>(`/reviews/${encodeURIComponent(targetId)}`, { method: 'PATCH', body });
    if (r.ok) { dropDraft(dk); router.push(`/me/reviews?saved=${r.body.status === 'pending' ? 'pending' : '1'}`); return; } // busy giữ nguyên tới khi chuyển trang
    setBusy(false); fail(r);
  };

  const cancelHref = edit ? '/me/reviews' : `/products/${encodeURIComponent(targetId)}/reviews`;
  const shell = (children: ReactNode, testid?: string) => <main className="page page-narrow"><section className="panel" data-testid={testid} aria-busy={testid ? true : undefined}>{children}</section></main>;

  if (view === 'loading') return shell(<><SkRows n={1} lead="square" /><SkForm n={3} /></>, `${P}-loading`);
  if (view === 'notfound') {
    return (
      <main className="page page-narrow">
        <section className="panel empty" data-testid={`${P}-notfound`}>
          <span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span>
          <h1>{edit ? 'Không thấy đánh giá' : 'Không thấy sản phẩm'}</h1>
          <Link className="btn btn-primary tight" href={edit ? '/me/reviews' : '/products'}>{edit ? 'Đánh giá của tôi' : 'Sản phẩm'}</Link>
        </section>
      </main>
    );
  }
  if (view === 'rate') {
    return shell(<div role="alert" className="banner banner-error" data-testid={`${P}-ratelimit`}>{limit.left > 0 ? rateLimitedText(limit.left) : 'Thử lại sau ít phút.'}{' '}<button type="button" className="btn btn-sm" onClick={() => void load()}>Thử lại</button></div>);
  }
  if (view === 'error' || view === 'forbidden') {
    return shell(
      <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>
        {view === 'forbidden' ? 'Không có quyền' : 'Không tải được form.'}{' '}
        {view === 'error' && <button type="button" className="btn btn-sm" onClick={() => void load()}>Thử lại</button>}
      </div>,
    );
  }

  if (done) {
    const pending = done === 'pending';
    return (
      <main className="page page-narrow">
        <section className="panel">
          <div role="status" className="empty" data-testid={`${P}-success-${pending ? 'pending' : 'published'}`}>
            <span className={`tile tile-lg ${pending ? 'amber' : 'green'}`}><span className={`i i-${pending ? 'clock' : 'okc'}`} aria-hidden="true" /></span>
            <strong>Đã gửi đánh giá</strong>
            {pending && <p className="small" data-testid={`${P}-moderation-notice`}>Sẽ hiện sau khi được duyệt.</p>}
            {pending
              ? <Link className="btn btn-sm" href="/me/reviews">Đánh giá của tôi</Link>
              : <Link className="btn btn-sm" href={`/products/${encodeURIComponent(targetId)}/reviews`}>Xem đánh giá</Link>}
          </div>
        </section>
      </main>
    );
  }

  const countCp = codePoints(comment);
  const commentError = over ? 'Tối đa 2000 ký tự' : commentErr;
  return (
    <main className="page page-narrow">
      <div className="page-head"><h1>{!edit && <><span className="i i-star" aria-hidden="true" />&nbsp;</>}{edit ? 'Sửa đánh giá' : 'Viết đánh giá'}</h1></div>
      <section className="panel stack">
        <div className="row">
          <span className="tile gray"><span className="i i-box" aria-hidden="true" /></span>
          <strong className="grow truncate" data-testid={`${P}-product`}>{productName}</strong>
          {verified && <VerifiedBadge testid={`${P}-verified`} />}
        </div>

        {lock?.kind === 'conflict' && <div role="alert" className="banner banner-error" data-testid={`${P}-conflict`}>{lock.text}. <Link href="/me/reviews">Đánh giá của tôi</Link></div>}
        {lock?.kind === 'ineligible' && <div role="alert" className="banner banner-error" data-testid={`${P}-ineligible`}>{lock.text}</div>}
        {lock?.kind === 'not-editable' && <div role="alert" className="banner banner-error" data-testid={`${P}-not-editable`}>{lock.text}. <Link href="/me/reviews">Đánh giá của tôi</Link></div>}
        {edit && editNotice && !locked && <div className="banner banner-info" data-testid={`${P}-edit-notice`}>Lưu xong, đánh giá chờ duyệt lại và tạm ẩn.</div>}
        {submitErr && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>{submitErr}</div>}
        {rateOn && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid={`${P}-ratelimit`}>{rateLimitedText(limit.left)}</div>}

        <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <fieldset className="plain stack" disabled={busy || locked}>
            <div className="field">
              <div className="rev-label" id="rev-rating-label">Điểm *</div>
              <div ref={ratingRef} role="radiogroup" aria-labelledby="rev-rating-label" aria-required="true" aria-invalid={ratingErr ? true : undefined} aria-describedby={ratingErr ? 'rev-rating-err' : undefined} className="rev-stars-input" data-testid={`${P}-rating`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} sao`} tabIndex={rating === n || (rating === 0 && n === 1) ? 0 : -1}
                    className={`rev-star${n <= rating ? ' on' : ''}`} onClick={() => pick(n)} onKeyDown={(e) => onStarKey(e, n)}><span aria-hidden="true">★</span></button>
                ))}
              </div>
              {ratingErr && <p id="rev-rating-err" role="alert" className="field-error" data-testid={`${P}-rating-error`}>{ratingErr}</p>}
            </div>

            <div className="field">
              <div className="between">
                <label htmlFor="rev-comment" className="rev-label">Nhận xét</label>
                <p id="rev-comment-count" className={`small muted tabular${over ? ' rev-over' : ''}`} data-testid={`${P}-comment-counter`}>{countCp} / {COMMENT_MAX}</p>
              </div>
              <textarea id="rev-comment" rows={5} value={comment} autoComplete="off" placeholder="Chia sẻ trải nghiệm của bạn" aria-invalid={commentError ? true : undefined} aria-describedby="rev-comment-count" data-testid={`${P}-comment`}
                onChange={(e) => { setComment(e.target.value); setCommentErr(null); }} />
              {commentError && <p className="field-error" role="alert" data-testid={`${P}-comment-error`}>{commentError}</p>}
            </div>

            <div className="field">
              <div className="between">
                <div className="rev-label">Ảnh</div>
                <span className="small muted tabular" data-testid={`${P}-image-count`}>{images.length} / {IMAGE_MAX}</span>
              </div>
              <ul className="rev-thumbs rd-thumbs">
                {images.map((im, i) => (
                  <li key={im.k} data-testid={`${P}-image-item`}>
                    <img src={im.url} alt={`Ảnh ${i + 1}`} />
                    {!imagesReadonly && <button type="button" className="btn tight rev-thumb-x" aria-label={`Xóa ảnh ${i + 1}`} onClick={() => setImages((x) => x.filter((y) => y.k !== im.k))} data-testid={`${P}-image-remove`}><span className="i i-x" aria-hidden="true" /></button>}
                  </li>
                ))}
                {uploading && <li className="rd-uploading" data-testid={`${P}-image-uploading`} role="status"><progress aria-label="Đang tải ảnh" /></li>}
                {(
                  <li hidden={full || imagesReadonly}>
                    <label className={`rd-add${uploading ? ' is-disabled' : ''}`} title="Thêm ảnh">
                      <span className="i i-upload" aria-hidden="true" /><span className="sr-only">Thêm ảnh</span>
                      <input type="file" className="sr-only" accept={IMAGE_ACCEPT} multiple disabled={full || uploading || imagesReadonly || busy || locked} data-testid={`${P}-image-input`}
                        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void onFiles(fs); }} />
                    </label>
                  </li>
                )}
              </ul>
              <p className="small muted">≤ 5 MB · JPEG, PNG, WebP</p>
              {imageErr && <p role="alert" className="field-error" data-testid={`${P}-image-error`}>{imageErr}</p>}
            </div>
          </fieldset>

          {noChange && <p className="small muted" role="status">Chưa thay đổi gì.</p>}
          <div className="rd-form-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => router.push(cancelHref)} data-testid={`${P}-cancel`}>Hủy</button>
            {edit
              ? <button type="submit" className="btn btn-primary tight" disabled={busy || uploading || locked || over || limit.left > 0} aria-busy={busy} data-testid={`${P}-save`}>{busy && <Spin />}Lưu</button>
              : <button type="submit" className="btn btn-primary tight" disabled={busy || uploading || locked || over || limit.left > 0} aria-busy={busy} data-testid={`${P}-submit`}>{busy ? <Spin /> : <span className="i i-send" aria-hidden="true" />}Gửi</button>}
          </div>
        </form>
      </section>
    </main>
  );
}
