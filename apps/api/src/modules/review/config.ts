// Biến cấu hình và hằng số của REV (ADR-007, REV-DB, REV-API). Kho object S3 (STORAGE_*) là phần dùng chung của platform (platform/storage/config.ts).
import { cfg, registerConfigSchema, type RateLimitOptions } from '../platform';

export const REVIEW_VARS = {
  /** Kiểm duyệt trước (ADR-007, ADR-018, câu 18 của questions.md): mặc định bật; đổi bằng biến môi trường và khởi động lại, không có công tắc lúc vận hành. */
  REVIEW_PRE_MODERATION: cfg.bool({ default: true }),
  /** Hạn thời gian xử lý một ảnh (REV-SEC T9): quá hạn coi như ảnh không xử lý nổi. */
  REV_IMAGE_PROCESS_TIMEOUT_MS: cfg.int({ default: 10_000, min: 50 }),
};
registerConfigSchema(REVIEW_VARS);

// Hằng số nghiệp vụ đã chốt ở spec (REV-REQ, REV-DB, REV-API, questions.md); đổi phải chạy sdlc-impact.
export const SCOPE = 'review.create'; // scope Idempotency-Key (REV-DB mục 1)
export const COMMENT_MAX = 2000; // REV-REQ-20261006-103135117
export const REASON_MAX = 500; // lý do từ chối, ẩn (REV-REQ-20261006-103135835)
export const IMAGE_MAX_COUNT = 5; // ảnh mỗi đánh giá (BR6 của REV-REQ ...207)
export const IMAGE_MAX_BYTES = 5_242_880; // 5 MB (ADR-010)
export const IMAGE_MAX_PIXELS = 25_000_000; // 25 megapixel đầu vào (ADR-018)
export const IMAGE_MAX_EDGE = 1600; // cạnh dài sau xử lý (ADR-018)
export const IMAGE_ORPHAN_AGE_MS = 24 * 3600_000; // ảnh chưa gắn và ảnh của đánh giá đã xóa dọn sau 24 giờ (ADR-022)
export const IMAGE_CACHE_CONTROL = 'public, max-age=300'; // ADR-018 (phát ảnh), cùng USR
export const SWEEP_BATCH = 100; // số ảnh mỗi lô của job dọn (REV-DB mục 8, SB-34)
export const SWEEP_BUDGET_MS = 50_000; // hạn thời gian một lượt job (SB-34)
export const SWEEP_JOB_MS = 3_600_000; // mỗi giờ (ADR-013)
export const SWEEP_JOB_NAME = 'rev.sweep-orphan-images';
export const OBJECT_SWEEP_JOB_NAME = 'rev.sweep-orphan-objects'; // quét object ở kho không có dòng review_images (REV-DB mục 8b, REV-REV-16)
export const OBJECT_SWEEP_MAX = 500; // trần số object xóa mỗi lượt (ADR-018, SB-34): cấu hình hay dữ liệu sai cũng không xóa quá chừng này mỗi lượt
export const IMAGE_PREFIX = 'reviews/'; // tiền tố khóa object của ảnh đánh giá
export const IMAGE_KEY_RE = /^reviews\/[0-9a-f-]{36}\.webp$/; // khớp CHECK `storage_key` của review_images
export const REVIEW_WINDOW_MS = 90 * 24 * 3600_000; // 90 ngày kể từ delivered_at (câu 16 của questions.md)
export const NAME_BATCH = 100; // `getDisplayNames` và `getSummaries` nhận tối đa 100 id mỗi lần (limit tối đa 100)
export const DEP_TIMEOUT_MS = 2000; // hủy lời gọi sang PRD, ORD, AUTH sau 2 giây
export const REVIEW_STATUSES = ['pending', 'published', 'rejected', 'hidden'] as const; // trạng thái lọc được (`deleted` bị 400)
export type ReviewStatus = (typeof REVIEW_STATUSES)[number] | 'deleted';
export const SORTS = ['newest', 'highest', 'lowest'] as const;
export const ANONYMOUS_NAME = 'Khách hàng';

/**
 * Bảng bậc SB-14 cho REV (REV-API, REV-DB mục 10, ADR-014): tạo, sửa, tải ảnh là bậc B (mỗi giờ mỗi người, bảng PostgreSQL của platform nên đúng giữa các instance), đọc công khai là bậc C (120 mỗi phút, trong bộ nhớ),
 * mọi đọc và thao tác còn lại bậc C hay D. Khóa đếm mặc định của platform: người dùng đã đăng nhập, không phải IP (xem report, Lệch spec).
 */
export const LIMITS = {
  create: { tier: 'B', limit: 10, windowSeconds: 3600 },
  edit: { tier: 'B', limit: 30, windowSeconds: 3600 },
  upload: { tier: 'B', limit: 20, windowSeconds: 3600 },
  eligibility: { tier: 'C', limit: 120, windowSeconds: 60 },
  publicRead: { tier: 'C', limit: 120, windowSeconds: 60 },
  mine: { tier: 'C', limit: 120, windowSeconds: 60, group: 'rev-mine' }, // danh sách và chi tiết của tôi chung hạn mức
  remove: { tier: 'B', limit: 30, windowSeconds: 3600, group: 'rev-delete' },
  admin: { tier: 'D', limit: 60, windowSeconds: 60, group: 'rev-admin' }, // hàng đợi và mọi thao tác kiểm duyệt chung một bộ đếm
} as const satisfies Record<string, RateLimitOptions>;

/**
 * Bảng chuyển trạng thái đánh giá hợp lệ (REV-DB mục Giao dịch và khóa, E-22, SB-24): NGUỒN DUY NHẤT cho mã chuyển trạng thái của kiểm duyệt.
 * `delete` đi từ mọi trạng thái trừ `deleted` (xử lý riêng ở ReviewService); `edit` (published -> pending) cũng ở ReviewService.
 */
export const MODERATION = {
  approve: { from: ['pending'], to: 'published', event: 'ReviewPublished', reason: false },
  reject: { from: ['pending'], to: 'rejected', event: null, reason: true },
  hide: { from: ['published'], to: 'hidden', event: 'ReviewHidden', reason: true },
  unhide: { from: ['hidden'], to: 'published', event: 'ReviewPublished', reason: false },
} as const satisfies Record<string, { from: readonly ReviewStatus[]; to: ReviewStatus; event: string | null; reason: boolean }>;
export type ModerationName = keyof typeof MODERATION;
export const LIVE_STATUSES = ['pending', 'published', 'rejected', 'hidden'] as const;
