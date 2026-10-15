'use client';
import type { ReactNode } from 'react';
import { clampStars, isHttpUrl, isReviewStatus, reviewStatusText, type ReviewImage } from '../lib/review';

/** Số sao có chữ thay thế "4 trên 5 sao" (không chỉ dựa vào hình hay màu). Chữ nằm trong phần tử mang testid. */
export function Stars({ value, testid }: { value: unknown; testid?: string }) {
  const n = clampStars(value);
  return (
    <span className="stars" data-testid={testid} data-rating={n}>
      <span aria-hidden="true">{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>
      <span className="sr-only">{n} trên 5 sao</span>
    </span>
  );
}

/** Badge trạng thái đánh giá: có chữ, không chỉ màu. */
export function ReviewStatusBadge({ status, testid }: { status: string; testid?: string }) {
  return <span className="badge" data-status={isReviewStatus(status) ? `rev-${status}` : undefined} data-testid={testid}>{reviewStatusText(status)}</span>;
}

/** Dải ảnh đính kèm: bấm ảnh mở ảnh lớn ở tab mới; chỉ nhận URL http(s). Không có ảnh thì không vẽ gì. */
export function ImageStrip({ images, testid }: { images: ReviewImage[] | null | undefined; testid: string }) {
  const list = (Array.isArray(images) ? images : []).filter((i) => i && isHttpUrl(i.url));
  if (list.length === 0) return null;
  return (
    <ul className="rev-images" data-testid={testid}>
      {list.map((im, i) => (
        <li key={`${im.url}-${i}`}>
          <a href={im.url} target="_blank" rel="noopener noreferrer" aria-label={`Xem ảnh ${i + 1} cỡ lớn`}><img src={im.url} alt={`Ảnh đính kèm ${i + 1}`} loading="lazy" /></a>
        </li>
      ))}
    </ul>
  );
}

/** Ảnh đại diện chỉ khi là http(s); không thì chữ cái đầu vẽ bằng CSS (không nằm trong văn bản, nên phần tử chứa tên chỉ có đúng chuỗi tên). Tên người viết là văn bản (React escape), lấy nguyên chuỗi server đã che. */
export function ReviewerAvatar({ name, url }: { name: string; url?: string | null }) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span className="rev-avatar" aria-hidden="true" data-letter={letter}>
      {isHttpUrl(url) ? <img src={url} alt="" width={28} height={28} /> : null}
    </span>
  );
}

/** Phân trang gọn "‹ 1 / 2 ›" với testid `${testPrefix}-page-prev` và `-page-next`. */
export function ReviewPager({ testPrefix, page, limit, total, onPage, disabled }: { testPrefix: string; page: number; limit: number; total: number; onPage: (p: number) => void; disabled?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav className="rev-pager" aria-label="Phân trang">
      <button type="button" className="btn btn-icon" aria-label="Trang trước" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testPrefix}-page-prev`}><span className="i i-left" aria-hidden="true" /></button>
      <span className="tabular" aria-live="polite"><span className="sr-only">Trang </span>{page} / {pages}</span>
      <button type="button" className="btn btn-icon" aria-label="Trang sau" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testPrefix}-page-next`}><span className="i i-right" aria-hidden="true" /></button>
    </nav>
  );
}

/** Huy hiệu "Đã mua" (đánh giá của người đã mua hàng). */
export function VerifiedBadge({ testid }: { testid?: string }) {
  return <span className="badge rev-verified" data-testid={testid}><span className="i i-check" aria-hidden="true" />Đã mua</span>;
}

/** Hộp thoại có ô icon màu ở tiêu đề (cùng hành vi `Modal` của SHP: Esc đóng, bấm nền đóng trừ khi `sticky`). */
export function RevDialog({ title, testid, onClose, sticky, icon = 'alert', tone = 'red', children }: { title: string; testid?: string; onClose: () => void; sticky?: boolean; icon?: string; tone?: string; children: ReactNode }) {
  return (
    <div className="backdrop" onMouseDown={(e) => { if (!sticky && e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-testid={testid}>
        <div className="dlg-head"><span className={`tile ${tone}`}><span className={`i i-${icon}`} aria-hidden="true" /></span><h2>{title}</h2></div>
        {children}
      </div>
    </div>
  );
}

/** Vòng xoay trong nút đang gọi API (cùng lớp `spinner` của PAY). */
export const Spin = () => <span className="spinner" aria-hidden="true" />;

/**
 * Đổi tham số truy vấn trên URL, cộng dồn các lần đổi liền nhau (REV-REV-12, bài học L135). Cài đặt ở `useQueryGo.ts`
 * (phần thuần ở `lib/query-go.ts`) để mọi trang danh sách có bộ lọc dùng chung; tên xuất ở đây giữ cho các trang
 * REV và DSH đã nhập từ `ReviewParts`. Hai lần đổi liền nhau trước khi `useSearchParams` kịp cập nhật không được
 * dựng URL từ chuỗi cũ của lần render (nếu không, lần hai làm sống lại bộ lọc lần một vừa bỏ).
 */
export { useQueryGo } from './useQueryGo';
