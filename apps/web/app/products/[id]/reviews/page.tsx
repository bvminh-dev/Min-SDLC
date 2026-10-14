'use client';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ImageStrip, ReviewPager, ReviewerAvatar, Stars, useQueryGo } from '../../../../components/ReviewParts';
import { useCountdown } from '../../../../components/useCountdown';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { formatAvg, formatDate, ineligibleText, type PublicReviewList } from '../../../../lib/review';

const LIMIT = 20;
const P = 'rev-product-reviews';
const SORTS: { v: string; t: string }[] = [{ v: 'newest', t: 'Mới nhất' }, { v: 'highest', t: 'Điểm cao' }, { v: 'lowest', t: 'Điểm thấp' }];

/**
 * Đánh giá của sản phẩm (ui/product-reviews): công khai cho mọi role. Bộ lọc `rating`, `sort` và `page` nằm trên URL; trang vượt cuối tự về trang cuối có dữ liệu;
 * kiểm điều kiện đánh giá (nút Viết đánh giá hoặc lý do) chỉ gọi khi là customer; 429 có đếm ngược và tự tải lại khi hết giờ chờ.
 * Bình luận và tên người viết luôn là văn bản thường (React escape, xuống dòng giữ bằng CSS), không HTML, không markdown.
 */
function ReviewsInner({ id }: { id: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const { status: authStatus, user } = useAuth();
  const rating = ['1', '2', '3', '4', '5'].includes(sp.get('rating') ?? '') ? (sp.get('rating') as string) : '';
  const sort = sp.get('sort') === 'highest' || sp.get('sort') === 'lowest' ? (sp.get('sort') as string) : 'newest';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const base = `/products/${encodeURIComponent(id)}/reviews`;

  const [data, setData] = useState<PublicReviewList | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'rate' | 'notfound'>('loading');
  const [name, setName] = useState<string | null>(null);
  const [elig, setElig] = useState<{ eligible: boolean; reason: string | null } | null>(null);
  const limit = useCountdown();
  const seq = useRef(0);
  const wasLimited = useRef(false);

  const go = useQueryGo(base);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
    if (rating) qs.set('rating', rating);
    const r = await api<PublicReviewList>(`/products/${encodeURIComponent(id)}/reviews?${qs}`, { silentExpired: true });
    if (n !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items) && r.body.summary) {
      const pages = Math.max(1, Math.ceil((r.body.total ?? 0) / LIMIT));
      // Trang vượt cuối (còn dữ liệu ở trang trước): về trang cuối có dữ liệu.
      if (r.body.items.length === 0 && (r.body.total ?? 0) > 0 && page > pages) { go({ page: pages > 1 ? String(pages) : null }, true, true); return; }
      setData(r.body); setView('ready');
    } else if (r.status === 404) { setData(null); setView('notfound'); }
    else if (r.status === 429) { setData(null); limit.start(r.retryAfter); setView('rate'); }
    else { setData(null); setView('error'); }
  }, [id, page, rating, sort]); // go, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);

  // Tên sản phẩm cho tiêu đề (không bắt buộc: lỗi thì bỏ qua).
  useEffect(() => {
    let live = true;
    void api<{ name: string }>(`/products/${encodeURIComponent(id)}`, { silentExpired: true }).then((r) => { if (live && r.status === 200 && typeof r.body.name === 'string') setName(r.body.name); });
    return () => { live = false; };
  }, [id]);

  // Điều kiện đánh giá chỉ hỏi khi là customer; guest, staff, admin không gọi và không thấy nút hay lý do.
  const role = authStatus === 'ready' ? user?.role : undefined;
  useEffect(() => {
    setElig(null);
    if (role !== 'customer') return;
    let live = true;
    void api<{ eligible: boolean; reason: string | null }>(`/products/${encodeURIComponent(id)}/review-eligibility`, { silentExpired: true }).then((r) => {
      if (live && r.status === 200 && typeof r.body.eligible === 'boolean') setElig({ eligible: r.body.eligible, reason: r.body.reason ?? null });
    });
    return () => { live = false; };
  }, [id, role]);

  if (view === 'notfound') {
    return (
      <main className="wide">
        <section className="notfound" data-testid={`${P}-notfound`}>
          <p className="big">404</p>
          <h1>Không tìm thấy sản phẩm</h1>
          <Link className="btn btn-primary tight" href="/products">Về danh sách sản phẩm</Link>
        </section>
      </main>
    );
  }

  const items = data?.items ?? [];
  const sum = data?.summary;
  const emptyAll = view === 'ready' && items.length === 0;
  const emptyFiltered = emptyAll && Boolean(rating) && (sum?.count ?? 0) > 0;
  const next = path + (sp.toString() ? `?${sp.toString()}` : '');

  return (
    <main className="wide">
      <nav aria-label="Đường dẫn" className="crumbs">
        <Link href="/products">Sản phẩm</Link> › <Link href={`/products/${encodeURIComponent(id)}`}>{name ?? 'Chi tiết sản phẩm'}</Link> › <span aria-current="page">Đánh giá</span>
      </nav>
      <h1>Đánh giá{name ? ` "${name}"` : ''}</h1>

      {view === 'rate' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được đánh giá, thử lại sau {limit.left > 0 ? `${limit.left} giây` : 'ít phút'}.{' '}<button type="button" className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được đánh giá.{' '}<button type="button" className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}

      {view === 'loading' && !data && (
        <div className="rev-layout" data-testid={`${P}-loading`} aria-busy="true">
          <div className="skeleton" style={{ height: '12rem' }} />
          <div><div className="skeleton" /><div className="skeleton" style={{ height: '5rem' }} /><div className="skeleton" style={{ height: '5rem' }} /><div className="skeleton" style={{ height: '5rem' }} /></div>
        </div>
      )}

      {data && sum && (
        <div className="rev-layout">
          <aside className="rev-side">
            <section className="card-block" data-testid={`${P}-summary`} aria-label="Tóm tắt đánh giá">
              <p className="rev-avg-line">
                {sum.count > 0 && formatAvg(sum.avg)
                  ? <><span className="rev-avg" data-testid={`${P}-avg`}>{formatAvg(sum.avg)}</span><span className="stars" aria-hidden="true">{'★'.repeat(Math.round(sum.avg ?? 0))}{'☆'.repeat(5 - Math.round(sum.avg ?? 0))}</span><span className="sr-only">Điểm trung bình {formatAvg(sum.avg)} trên 5 sao</span></>
                  : <span className="hint" data-testid={`${P}-avg`}>Chưa có đánh giá</span>}
              </p>
              <p data-testid={`${P}-count`}>{sum.count} đánh giá</p>
              <ul className="rev-dist" data-testid={`${P}-distribution`}>
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = Number(sum.distribution?.[String(star)]) || 0;
                  const pct = sum.count > 0 ? Math.round((n / sum.count) * 100) : 0;
                  return (
                    <li key={star}>
                      <span className="rev-dist-label">{star} sao</span>
                      <span className="rev-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                      <span className="tabular rev-dist-n">{n}</span>
                    </li>
                  );
                })}
              </ul>
              {authStatus === 'ready' && !user && <p><Link href={`/login?next=${encodeURIComponent(next)}`} data-testid={`${P}-login-prompt`}>Đăng nhập để viết đánh giá</Link></p>}
              {role === 'customer' && elig?.eligible && <Link className="btn btn-primary" href={`${base}/new`} data-testid={`${P}-write-button`}>Viết đánh giá</Link>}
              {role === 'customer' && elig && !elig.eligible && (
                <div>
                  <p className="hint" data-testid={`${P}-ineligible-reason`}>{ineligibleText(elig.reason)}</p>
                  {elig.reason === 'already_reviewed' && <p><Link href="/me/reviews">Đánh giá của tôi</Link></p>}
                </div>
              )}
            </section>
          </aside>

          <section className="rev-main">
            <div className="toolbar">
              <select value={sort} aria-label="Sắp xếp" onChange={(e) => go({ sort: e.target.value === 'newest' ? null : e.target.value })} data-testid={`${P}-sort`}>
                {SORTS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
              </select>
              <select value={rating} aria-label="Lọc theo sao" onChange={(e) => go({ rating: e.target.value || null })} data-testid={`${P}-filter-rating`}>
                <option value="">Tất cả sao</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={String(n)}>{n} sao</option>)}
              </select>
              {rating && !emptyFiltered && <button type="button" className="btn btn-quiet tight" onClick={() => go({ rating: null })} data-testid={`${P}-filter-clear`}>Xóa bộ lọc</button>}
            </div>

            {emptyFiltered && (
              <div className="notfound" data-testid={`${P}-empty-filter`}>
                <p>Không có đánh giá nào cho mức sao này</p>
                <button type="button" className="btn tight" onClick={() => go({ rating: null })} data-testid={`${P}-filter-clear`}>Xóa bộ lọc</button>
              </div>
            )}
            {emptyAll && !emptyFiltered && <div className="notfound" data-testid={`${P}-empty`}><p>Sản phẩm chưa có đánh giá</p></div>}
            {view === 'loading' && <div data-testid={`${P}-loading`} aria-busy="true"><div className="skeleton" style={{ height: '5rem' }} /><div className="skeleton" style={{ height: '5rem' }} /><div className="skeleton" style={{ height: '5rem' }} /></div>}
            {view === 'ready' && items.length > 0 && (
              <>
                <ul className="rev-list" data-testid={`${P}-list`}>
                  {items.map((it) => (
                    <li key={it.id} className="rev-item" data-testid={`${P}-item`} data-id={it.id}>
                      <div className="rev-item-head">
                        <Stars value={it.rating} testid={`${P}-item-rating`} />
                        <span className="rev-reviewer" data-testid={`${P}-item-reviewer`}><ReviewerAvatar name={String(it.reviewer?.display_name ?? '')} url={it.reviewer?.avatar_url} /><span>{String(it.reviewer?.display_name ?? '')}</span></span>
                        {it.verified_purchase !== false && <span className="badge rev-verified" data-testid={`${P}-item-verified`}><span aria-hidden="true">✓ </span>Đã mua hàng</span>}
                        <span className="hint tabular" data-testid={`${P}-item-date`}>{formatDate(it.published_at)}</span>
                        {it.edited_at && <span className="hint" data-testid={`${P}-item-edited`}>Đã chỉnh sửa</span>}
                      </div>
                      {it.comment && <p className="pre rev-comment" data-testid={`${P}-item-comment`}>{it.comment}</p>}
                      <ImageStrip images={it.images} testid={`${P}-item-images`} />
                    </li>
                  ))}
                </ul>
                <ReviewPager testPrefix={P} page={page} limit={LIMIT} total={data.total} onPage={(n) => go({ page: n > 1 ? String(n) : null }, true)} />
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default function ProductReviewsPage() {
  const { id } = useParams<{ id: string }>();
  return <Suspense fallback={<main className="wide"><div aria-busy="true"><div className="skeleton" /></div></main>}><ReviewsInner key={id} id={id} /></Suspense>;
}
