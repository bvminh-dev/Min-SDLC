import { z } from 'zod';
import { paginationQuery } from '../platform';
import { COMMENT_MAX, IMAGE_MAX_COUNT, REASON_MAX, REVIEW_STATUSES, SORTS } from './config';
import { UUID_RE } from './db';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_rating, too_long, invalid_characters, invalid_type, too_many_images, invalid_image, unknown_field, invalid_format.
// eslint-disable-next-line no-control-regex
const CONTROL_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // xuống dòng và tab hợp lệ; NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn
// nửa cặp thay thế lẻ (UTF-16 hỏng: JSON "\ud800" lẻ) không mã hóa được sang UTF-8 của PostgreSQL
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const len = (s: string): number => [...s].length; // ký tự Unicode (code point), khớp char_length() của PostgreSQL

/**
 * Đối tượng đóng: khóa lạ (`user_id`, `status`, `order_item_id`, `moderated_by`...) bị từ chối với `unknown_field` (SB-11, SB-05). Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư
 * (chống ô nhiễm nguyên mẫu) nên không còn thấy ở bước kiểm của chính nó: kiểm trên đầu vào thô TRƯỚC khi vào zod.
 */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  const inner = z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
  return z.unknown().superRefine((v, ctx) => {
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__proto__')) ctx.addIssue({ code: 'custom', path: ['__proto__'], message: 'unknown_field' });
  }).pipe(inner);
}

/** Điểm: số nguyên 1..5; thiếu hay `null` là `required`; thập phân, chuỗi, ngoài miền là `invalid_rating`. */
const rating = z.unknown().superRefine((v, ctx) => {
  if (v === undefined || v === null) ctx.addIssue({ code: 'custom', message: 'required' });
  else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) ctx.addIssue({ code: 'custom', message: 'invalid_rating' });
}).transform((v) => v as number);

/**
 * Bình luận: chuỗi, NFC, cắt khoảng trắng hai đầu, tối đa 2000 ký tự Unicode (đếm code point), không ký tự điều khiển (trừ xuống dòng, tab) và không nửa cặp thay thế lẻ (UTF-16 hỏng);
 * rỗng, toàn khoảng trắng hay `null` là không có (`null`). Sai kiểu là `invalid_type`.
 */
export const commentField = z.unknown().superRefine((v, ctx) => {
  if (v === null || v === undefined) return;
  if (typeof v !== 'string') { ctx.addIssue({ code: 'custom', message: 'invalid_type' }); return; }
  if (LONE_SURROGATE.test(v) || CONTROL_TEXT.test(v)) { ctx.addIssue({ code: 'custom', message: 'invalid_characters' }); return; }
  if (len(v.normalize('NFC').trim()) > COMMENT_MAX) ctx.addIssue({ code: 'custom', message: 'too_long' });
}).transform((v): string | null => (typeof v === 'string' ? v.normalize('NFC').trim() || null : null));

/** Danh sách `image_ids`: mảng tối đa 5 uuid không trùng; phần tử sai định dạng hay trùng là `invalid_image` (cùng mã với id của người khác, không tồn tại: không lộ ảnh của người khác, BR7). */
export const imageIds = z.unknown().superRefine((v, ctx) => {
  if (!Array.isArray(v)) { ctx.addIssue({ code: 'custom', message: 'invalid_type' }); return; }
  if (v.length > IMAGE_MAX_COUNT) { ctx.addIssue({ code: 'custom', message: 'too_many_images' }); return; }
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || !UUID_RE.test(x) || seen.has(x.toLowerCase())) { ctx.addIssue({ code: 'custom', message: 'invalid_image' }); return; }
    seen.add(x.toLowerCase());
  }
}).transform((v) => (v as string[]).map((x) => x.toLowerCase()));

export const createBody = closedObject({ rating, comment: commentField.optional(), image_ids: imageIds.optional() })
  .transform((b) => ({ rating: b.rating, comment: (b.comment ?? null) as string | null, image_ids: (b.image_ids ?? []) as string[] }));
/** Sửa một phần: ít nhất một trong `rating`, `comment`, `image_ids` (body rỗng là 400); `comment` có mặt (kể cả `null`) nghĩa là đặt lại bình luận. */
export const patchBody = closedObject({ rating: rating.optional(), comment: commentField.optional(), image_ids: imageIds.optional() }).superRefine((b, ctx) => {
  const o = b as Record<string, unknown>;
  if (!('rating' in o) && !('comment' in o) && !('image_ids' in o)) ctx.addIssue({ code: 'custom', path: ['rating'], message: 'required' });
}).transform((b) => {
  const o = b as { rating?: number; comment?: string | null; image_ids?: string[] };
  return { rating: o.rating, comment: o.comment, image_ids: o.image_ids } as { rating?: number; comment?: string | null; image_ids?: string[] };
});
export const emptyBody = closedObject({});

/** Lý do từ chối, ẩn: bắt buộc, cắt khoảng trắng, 1 đến 500 ký tự, không ký tự điều khiển (trừ xuống dòng, tab). Thiếu, rỗng, toàn khoảng trắng là `required`. */
const reason = z.unknown().superRefine((v, ctx) => {
  if (v === undefined || v === null) { ctx.addIssue({ code: 'custom', message: 'required' }); return; }
  if (typeof v !== 'string') { ctx.addIssue({ code: 'custom', message: 'invalid_type' }); return; }
  if (LONE_SURROGATE.test(v) || CONTROL_TEXT.test(v)) { ctx.addIssue({ code: 'custom', message: 'invalid_characters' }); return; }
  const t = v.normalize('NFC').trim();
  if (len(t) === 0) ctx.addIssue({ code: 'custom', message: 'required' });
  else if (len(t) > REASON_MAX) ctx.addIssue({ code: 'custom', message: 'too_long' });
}).transform((v) => (v as string).normalize('NFC').trim());
export const reasonBody = closedObject({ reason });

export const idParams = z.object({ id: z.string() }).strict();
export const productParams = z.object({ product_id: z.string() }).strict();

const ratingQuery = z.string().regex(/^[1-5]$/, { message: 'invalid_rating' }).transform(Number);
const status = z.enum(REVIEW_STATUSES, { errorMap: () => ({ message: 'invalid_format' }) });
export const publicListQuery = paginationQuery.extend({
  rating: ratingQuery.optional(),
  sort: z.enum(SORTS, { errorMap: () => ({ message: 'invalid_format' }) }).optional().transform((v) => v ?? 'newest'),
});
export const mineListQuery = paginationQuery.extend({ status: status.optional() });
export const adminListQuery = paginationQuery.extend({
  status: status.optional().transform((v) => v ?? 'pending'),
  product_id: z.string().refine((v) => UUID_RE.test(v), { message: 'invalid_format' }).transform((v) => v.toLowerCase()).optional(),
  rating: ratingQuery.optional(),
});

export type CreateBody = z.infer<typeof createBody>;
export type PatchBody = z.infer<typeof patchBody>;
export type ReasonBody = z.infer<typeof reasonBody>;
export type PublicListQuery = z.infer<typeof publicListQuery>;
export type MineListQuery = z.infer<typeof mineListQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
