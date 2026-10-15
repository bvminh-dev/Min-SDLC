// Đánh giá sản phẩm (epic REV): kiểu dữ liệu, nhãn và định dạng dùng chung bốn màn `product-reviews`, `review-form`, `my-reviews`, `admin-moderation`.
// Spec không khai testid hộp thoại hết phiên riêng cho REV nên không có `expiredTestId` ở đây: hộp thoại dùng testid mặc định của AUTH.
import { own } from './shipping';

export type ReviewStatus = 'pending' | 'published' | 'rejected' | 'hidden';
export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'published', 'rejected', 'hidden'];

const STATUS_LABEL: Record<ReviewStatus, string> = { pending: 'Chờ duyệt', published: 'Đã đăng', rejected: 'Bị từ chối', hidden: 'Bị ẩn' };
/** Nhãn trạng thái; giá trị lạ từ API trả nguyên văn (không tra ra thuộc tính của Object.prototype). */
export const reviewStatusText = (s: string): string => own(STATUS_LABEL, s) ?? s;
export const isReviewStatus = (s: string | null | undefined): s is ReviewStatus => typeof s === 'string' && (REVIEW_STATUSES as string[]).includes(s);

export interface ReviewImage { id?: string; image_id?: string; url: string; width?: number; height?: number }
/** Ảnh có thể gắn lại khi sửa: API chi tiết đánh giá của tôi trả `id` (hoặc `image_id`) kèm `url`; thiếu thì không biết gắn lại bằng gì. */
export const imageIdOf = (i: ReviewImage): string | null => (typeof i.id === 'string' && i.id ? i.id : typeof i.image_id === 'string' && i.image_id ? i.image_id : null);

export interface PublicReview {
  id: string; rating: number; comment: string | null; images: ReviewImage[];
  reviewer: { display_name: string; avatar_url: string | null }; verified_purchase: boolean; published_at: string; edited_at: string | null;
}
export interface ReviewSummary { count: number; avg: number | null; distribution: Record<string, number> }
export interface PublicReviewList { items: PublicReview[]; page: number; limit: number; total: number; summary: ReviewSummary }

export interface MyReview {
  id: string; product: { id: string; name: string; image_url: string | null; status?: string }; status: ReviewStatus; rating: number; comment: string | null;
  images: ReviewImage[]; created_at: string; edited_at: string | null; moderation_reason?: string | null; can_edit: boolean; can_delete: boolean; edit_requires_review: boolean;
}
export interface MyReviewList { items: MyReview[]; page: number; limit: number; total: number }

export interface AdminReview {
  id: string; status: ReviewStatus; rating: number; comment: string | null; images: ReviewImage[]; created_at: string; edited_at: string | null;
  reviewer: { user_id?: string; display_name: string }; product: { id: string; name: string }; moderation_reason: string | null; moderated_at: string | null;
}
export interface AdminReviewList { items: AdminReview[]; page: number; limit: number; total: number; pending_count: number }

export const COMMENT_MAX = 2000;
export const REASON_MAX = 500;
export const IMAGE_MAX = 5;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const INELIGIBLE: Record<string, string> = {
  not_purchased: 'Chỉ đánh giá được sản phẩm đã mua',
  not_delivered: 'Bạn có thể đánh giá sau khi nhận hàng',
  window_expired: 'Đã quá 90 ngày kể từ khi nhận hàng',
  already_reviewed: 'Bạn đã đánh giá sản phẩm này',
};
/** Lý do chưa đánh giá được theo mã; mã lạ có chữ chung. */
export const ineligibleText = (code: string | null | undefined): string => (code ? own(INELIGIBLE, code) : undefined) ?? 'Chưa thể đánh giá sản phẩm này';

const IMAGE_ERR: Record<string, string> = {
  type: 'Chỉ nhận JPEG, PNG, WebP', size: 'Ảnh vượt 5 MB', dimensions: 'Ảnh quá lớn (tối đa 25 megapixel)', corrupt: 'Không đọc được ảnh',
};
/** Chữ lỗi tải ảnh theo `reason` của 400 `image_invalid`; reason lạ hoặc thiếu có chữ chung. */
export const imageErrorText = (reason: string | null | undefined): string => (reason ? own(IMAGE_ERR, reason) : undefined) ?? 'Không tải được ảnh. Thử lại.';

/** Điểm trung bình một chữ số thập phân, dấu phẩy: 3.75 thành "3,8"; `null` khi chưa có đánh giá. */
export const formatAvg = (avg: number | null | undefined): string | null => (typeof avg === 'number' && Number.isFinite(avg) ? avg.toFixed(1).replace('.', ',') : null);

/** Số code point (NFC) của chuỗi: emoji, chữ có dấu tổ hợp tính một; không dùng `.length` (UTF-16). */
export const codePoints = (s: string): number => Array.from(s.normalize('NFC')).length;

/** Chỉ http(s), hoặc đường dẫn cùng origin `/media/...` (ảnh qua proxy của web, xem rewrites ở next.config.mjs), mới được dùng làm nguồn ảnh (avatar_url, url ảnh) từ API. */
export const isHttpUrl = (u: unknown): u is string => typeof u === 'string' && /^(https?:\/\/|\/media\/)/i.test(u);

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Số nguyên 1..5 từ giá trị API (ngoài khoảng thì kẹp lại) để vẽ sao. */
export const clampStars = (n: unknown): number => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : 0; };

/** Khóa idempotency mới cho form viết (uuid v4, 36 ký tự trong khoảng 8 đến 64 `[A-Za-z0-9_-]` của ADR-017); có dự phòng khi trình duyệt không có randomUUID (trang không bảo mật). */
export function newReviewKey(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
