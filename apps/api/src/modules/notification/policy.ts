import { z } from 'zod';
import { paginationQuery } from '../platform';
import { NOTIFICATION_TYPES } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
const enumOf = <T extends [string, ...string[]]>(values: T) => z.enum(values, { errorMap: () => ({ message: 'invalid_format' }) });

/**
 * Đối tượng đóng (SB-11): khóa lạ (`user_id`, `channel`...) bị từ chối với `unknown_field`. Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư nên kiểm trên đầu vào thô TRƯỚC khi vào zod.
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

/** `GET /notifications` (NTF-REQ-20261006-103209345 BR2): page từ 1, limit 1..100 (mặc định 20), status unread|read, type một trong 15 loại; tham số lạ là 400. */
export const listQuery = paginationQuery.extend({
  status: enumOf(['unread', 'read']).optional() as unknown as z.ZodOptional<z.ZodType<'unread' | 'read'>>,
  type: enumOf([...NOTIFICATION_TYPES] as [string, ...string[]]).optional() as unknown as z.ZodOptional<z.ZodType<(typeof NOTIFICATION_TYPES)[number]>>,
});
export type ListQuery = z.infer<typeof listQuery>;

/** `{id}` nhận chuỗi bất kỳ: id sai dạng uuid cùng 404 cùng nội dung với id không có (SB-06), nên không kiểm dạng ở schema. */
export const idParams = z.object({ id: z.string() }).strict();
export const emptyBody = closedObject({});

const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
/** ISO-8601 CÓ múi giờ và là ngày giờ có thật (2026-02-31 bị từ chối); trả mili giây, không âm (PostgreSQL không có năm 0, thời điểm trước 1970 coi như 1970: không thông báo nào cũ hơn). */
const upTo = z.string(str).superRefine((v, ctx) => {
  const ms = Date.parse(v);
  const [y, mo, d] = v.slice(0, 10).split('-').map(Number);
  const real = ISO_TZ.test(v) && !Number.isNaN(ms) && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (!real) ctx.addIssue({ code: 'custom', message: 'invalid_format' });
}).transform((v) => Math.max(Date.parse(v), 0));
export const readAllBody = closedObject({ up_to: upTo.optional() });
export type ReadAllBody = z.infer<typeof readAllBody>;
